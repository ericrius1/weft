// The build-time half of weft: turns a .wgsl file into { code, reflection, line map }.
//
// 1. `#include "path"` is resolved (relative to the including file, or `weft/…` from the kit's shader library), each
//    file once, and every output line remembers where it came from so compile errors point at the real file:line.
// 2. The result is reflected with wgsl_reflect: struct layouts (offsets, sizes, array strides), bindings by variable
//    name, entry points (with the resources each one actually uses and compute workgroup sizes) and overrides. Which
//    bindings and overrides an entry uses is also worked out here from the syntax tree (entryNames), because
//    wgsl_reflect misses a name read only inside an index that follows a member access or another index
//    (`world.levels[i32(u.level.x)]` never counts `u`): the binding fell out of the pipeline layout and the pipeline
//    failed to build, and an override fell out of the constants and silently kept its default. Its parser also kept
//    only two statements of each `case` body; that is corrected below (caseBody) before anything is parsed.
// 3. Struct members can carry tweak annotations in a trailing comment: `// @range(0, 2)`, `// @range(0, 1, 0.01)`,
//    `// @color`. The debug overlay builds sliders from them.
// 4. A `.d.wgsl.ts` declaration is generated next to the shader, so `import s from './x.wgsl'` gives typed struct
//    fields and binding names (TS `allowArbitraryExtensions`).
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, sep } from 'node:path';
import { WgslReflect, WgslParser, TokenTypes } from 'wgsl_reflect/wgsl_reflect.module.js';
import { leanWgsl, stripComments } from './lean.js';

export interface FieldLayout {
  name: string; offset: number; size: number;
  /** normalised WGSL type: f32 · u32 · i32 · vec3f · mat4x4f · … · 'array' · 'struct' */
  type: string;
  array?: { count: number; stride: number; elem: string; elemStruct?: string };
  struct?: string;
  range?: number[]; color?: boolean;
}
export interface StructLayout { name: string; size: number; align: number; fields: FieldLayout[] }
export type BindingKind = 'uniform' | 'storage' | 'texture' | 'storageTexture' | 'sampler' | 'samplerComparison' | 'externalTexture';
export interface BindingInfo {
  name: string; group: number; binding: number; kind: BindingKind;
  access?: 'read' | 'read_write' | 'write';
  /** the declared type (normalised) */
  type: string;
  struct?: string; elem?: string; elemStruct?: string;
  texture?: { dim: GPUTextureViewDimension; sample: GPUTextureSampleType; multisampled: boolean };
  format?: string;
}
export interface EntryInfo { name: string; stage: 'vertex' | 'fragment' | 'compute'; resources: string[]; overrides: string[]; workgroupSize?: number[]; targets?: number }
export interface ShaderReflection {
  structs: Record<string, StructLayout>;
  bindings: Record<string, BindingInfo>;
  entries: EntryInfo[];
  overrides: Record<string, { type: string; id?: number }>;
}
export interface CompiledShader {
  id: string; label: string; code: string;
  files: string[];
  /** contiguous runs of output lines: [firstOutLine, fileIndex, firstSourceLine] … (1-based lines) */
  runs: number[];
  includes: string[];
  /** build-time only: absolute path of the .wgsl file that declared each struct (omitted from runtime bundle) */
  structFiles?: Record<string, string>;
  reflect: ShaderReflection;
}

export interface CompileOptions {
  root: string; libs: Record<string, string>;
  /** the browser given only the comment-free code its entry points reach (lean.ts: a change elsewhere in an included
   *  file then leaves its compiled pipelines in the browser's cache). Default true */
  lean?: boolean;
  /** wrap `@vertex` entry points that take `@builtin(instance_index)` with an override-gated Fibonacci reversed-Z
   *  micro-bias (`override WEFT_INST_BIAS: f32 = 0.0;`), enabled by `passes.ts` only for static non-indirect instanced
   *  opaque draws (constant-folded away when 0.0). Default true */
  autoInstanceBias?: boolean;
}

export class WgslError extends Error {}

const INCLUDE = /^\s*#include\s+"([^"]+)"\s*;?\s*(\/\/.*)?$/;

function resolveInclude(spec: string, from: string, opts: CompileOptions): string {
  const withExt = spec.endsWith('.wgsl') ? spec : spec + '.wgsl';
  for (const [prefix, dir] of Object.entries(opts.libs)) {
    if (withExt.startsWith(prefix + '/')) return resolve(dir, withExt.slice(prefix.length + 1));
  }
  return resolve(dirname(from), withExt);
}

export function preprocess(entry: string, opts: CompileOptions) {
  const out: string[] = [];
  const files: string[] = [];
  const runs: number[] = [];
  const seen = new Set<string>();
  const structFiles: Record<string, string> = {};
  const rel = (p: string) => relative(opts.root, p).split(sep).join('/');
  let lastFile = -1, lastSrc = -2;
  const visit = (abs: string, from?: string, fromLine?: number, spec?: string) => {
    if (seen.has(abs)) return;
    seen.add(abs);
    if (!existsSync(abs)) throw new WgslError(`${from ? rel(from) : '?'}:${fromLine}: #include "${spec}" not found (${rel(abs)})`);
    const fi = files.push(rel(abs)) - 1;
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = INCLUDE.exec(lines[i]);
      if (m) { visit(resolveInclude(m[1], abs, opts), abs, i + 1, m[1]); continue; }
      const sm = /^\s*struct\s+(\w+)\b/.exec(lines[i]);
      if (sm && !(sm[1] in structFiles)) structFiles[sm[1]] = abs;
      if (fi !== lastFile || i + 1 !== lastSrc + 1) runs.push(out.length + 1, fi, i + 1);
      lastFile = fi; lastSrc = i + 1;
      out.push(lines[i]);
    }
  };
  visit(entry);
  return { code: out.join('\n'), files, runs, includes: [...seen].filter((f) => f !== entry), structFiles };
}

/** maps a 1-based output line back to { file, line } */
export function mapLine(runs: number[], files: string[], line: number) {
  let r = 0;
  for (let i = 0; i < runs.length; i += 3) if (runs[i] <= line) r = i; else break;
  return { file: files[runs[r + 1]], line: runs[r + 2] + (line - runs[r]) };
}

const SUFFIX: Record<string, string> = { f32: 'f', i32: 'i', u32: 'u', f16: 'h' };
export function normType(t: string): string {
  t = t.replace(/\s+/g, '');
  const m = /^(vec[234]|mat[234]x[234])<(f32|i32|u32|f16)>$/.exec(t);
  if (m) return m[1] + SUFFIX[m[2]];
  return t;
}

// trailing-comment annotations on struct members: `name: type, // @range(0, 1)`
function annotations(code: string) {
  const ann: Record<string, { range?: number[]; color?: boolean }> = {};
  let struct: string | null = null, depth = 0;
  for (const line of code.split('\n')) {
    const s = /^\s*struct\s+(\w+)/.exec(line);
    if (s) { struct = s[1]; depth = 0; }
    if (!struct) continue;
    const m = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(\w+)\s*:[^/]*\/\/(.*)$/.exec(line);
    if (m && m[1] !== 'struct') {
      const a: { range?: number[]; color?: boolean } = {};
      const r = /@range\(([^)]*)\)/.exec(m[2]);
      if (r) a.range = r[1].split(',').map((x) => Number(x.trim()));
      if (/@color\b/.test(m[2])) a.color = true;
      if (a.range || a.color) ann[`${struct}.${m[1]}`] = a;
    }
    const code0 = line.replace(/\/\/.*$/, '');
    for (const ch of code0) {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth <= 0) { struct = null; break; }
    }
  }
  return ann;
}

function texInfo(typeName: string): BindingInfo['texture'] {
  const t = typeName.replace(/\s+/g, '');
  const ms = t.includes('multisampled');
  let dim: GPUTextureViewDimension = '2d';
  if (t.includes('_2d_array')) dim = '2d-array';
  else if (t.includes('_cube_array')) dim = 'cube-array';
  else if (t.includes('_cube')) dim = 'cube';
  else if (t.includes('_3d')) dim = '3d';
  else if (t.includes('_1d')) dim = '1d';
  let sample: GPUTextureSampleType = 'float';
  if (t.includes('depth')) sample = 'depth';
  else if (/<u32>/.test(t)) sample = 'uint';
  else if (/<i32>/.test(t)) sample = 'sint';
  return { dim, sample, multisampled: ms };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** How many statements the parser keeps of a `case` body that has three. */
function caseStatements(): number {
  const ast: Any[] = new WgslParser().parse('fn f(m: u32) { var a = 0; switch m { default: { a = 1; a = 2; a = 3; } } }');
  const sw = (ast[0]?.body as Any[] | undefined)?.find((s) => s?.astNodeType === 'switch');
  return sw?.cases?.[0]?.body?.length ?? -1;
}

// wgsl_reflect (1.6.0 and before) keeps only the first two statements of a `case` or `default` body. Its _case_body
// reads one statement, recurses for the rest, then keeps only the first of what the recursion returns
// (`[...statement, nextStatement[0]]`). The rest of the body was missing from the syntax tree, so a binding or override
// read only from the third statement on fell out of the entry's resources (wgsl_reflect's and entryNames' alike). The
// pipeline layout then lacked its group and the pipeline failed to build ("uses bindings in group 1 but [PipelineLayout]
// doesn't have a BindGroupLayout for this index"). For an override, the constant silently kept its default.
// Here the body is read as `_compound_statement` reads a block: statement by statement up to the closing brace
// (`fallthrough;` ends it, as before). The parser is replaced only while the probe shows the fault, so a fixed release
// is used as it ships.
if (caseStatements() !== 3) {
  const P = (WgslParser as Any).prototype;
  P._case_body = function caseBody(this: Any): Any[] {
    const body: Any[] = [];
    while (!this._check(TokenTypes.tokens.brace_right) && !this._isAtEnd()) {
      if (this._match(TokenTypes.keywords.fallthrough)) { this._consume(TokenTypes.tokens.semicolon, "Expected ';'"); break; }
      const s = this._statement();
      if (s === null) break;
      if (Array.isArray(s)) body.push(...s); else body.push(s);
    }
    return body;
  };
  if (caseStatements() !== 3) throw new Error('weft: wgsl_reflect\'s switch-case parsing could not be corrected (its parser changed): check plugin/wgsl.ts');
}

function fieldOf(m: Any, ann: Record<string, { range?: number[]; color?: boolean }>, structName: string): FieldLayout {
  const f: FieldLayout = { name: m.name, offset: m.offset, size: m.size, type: '' };
  if (m.isArray) {
    const fmt = m.format;
    const elemStruct = fmt?.isStruct ? fmt.name : undefined;
    f.type = 'array';
    f.array = { count: m.count, stride: m.stride, elem: elemStruct ? 'struct' : normType(fmt?.getTypeName?.() ?? fmt?.name ?? '?'), elemStruct };
  } else if (m.isStruct) {
    f.type = 'struct'; f.struct = m.type.name;
  } else {
    f.type = normType(m.type.getTypeName ? m.type.getTypeName() : m.type.name);
  }
  const a = ann[`${structName}.${m.name}`];
  if (a?.range) f.range = a.range;
  if (a?.color) f.color = true;
  return f;
}

/** The module-scope names an entry point's code reads, through every function it calls: each reachable function's
 *  body walked whole (every expression, index and argument at any depth), less the names its own parameters and
 *  local declarations shadow. */
function entryNames(ast: Any[], entry: string): Set<string> {
  const fns = new Map<string, Any>();
  for (const n of ast) if (n?.astNodeType === 'function') fns.set(n.name, n);
  const names = new Set<string>();
  const done = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const fn = fns.get(todo.pop()!);
    if (!fn || done.has(fn.name)) continue;
    done.add(fn.name);
    const local = new Set<string>(((fn.args ?? []) as Any[]).map((a) => a.name as string));
    const read: string[] = [];
    const seen = new WeakSet<object>();
    const visit = (n: Any) => {
      if (!n || typeof n !== 'object' || seen.has(n)) return;
      seen.add(n);
      if (Array.isArray(n)) { for (const c of n) visit(c); return; }
      const t = n.astNodeType;
      if ((t === 'let' || t === 'var' || t === 'const') && typeof n.name === 'string') local.add(n.name);
      else if (t === 'varExpr' && typeof n.name === 'string') read.push(n.name);
      else if (t === 'callExpr' && typeof n.name === 'string') todo.push(n.name);
      for (const k in n) if (k !== 'parent' && k !== 'calls') visit(n[k]);
    };
    visit(fn.body);
    for (const name of read) if (!local.has(name)) names.add(name);
  }
  return names;
}

export function reflectWgsl(code: string): ShaderReflection {
  const r: Any = new WgslReflect(code);
  const ast: Any[] = new WgslParser().parse(code);
  const ann = annotations(code);
  const structs: Record<string, StructLayout> = {};
  for (const s of r.structs as Any[]) {
    structs[s.name] = { name: s.name, size: s.size, align: s.align, fields: s.members.map((m: Any) => fieldOf(m, ann, s.name)) };
  }
  const bindings: Record<string, BindingInfo> = {};
  const add = (v: Any, kind: BindingKind) => {
    const typeName = normType(v.type.getTypeName ? v.type.getTypeName() : v.type.name);
    const b: BindingInfo = { name: v.name, group: v.group, binding: v.binding, kind, type: typeName };
    if (kind === 'uniform' || kind === 'storage') {
      if (v.type.isStruct) b.struct = v.type.name;
      if (v.type.isArray) {
        const fmt = v.type.format;
        if (fmt?.isStruct) b.elemStruct = fmt.name; else b.elem = normType(fmt?.getTypeName?.() ?? fmt?.name ?? '?');
      }
    }
    if (kind === 'storage') b.access = v.access === 'read_write' ? 'read_write' : 'read';
    if (kind === 'storageTexture') {
      b.access = v.access === 'read_write' ? 'read_write' : v.access === 'read' ? 'read' : 'write';
      b.format = v.type.format?.name;
      b.texture = texInfo(typeName);
    }
    if (kind === 'texture') b.texture = texInfo(typeName);
    bindings[v.name] = b;
  };
  for (const v of r.uniforms) add(v, 'uniform');
  for (const v of r.storage) add(v, v.resourceType === 5 ? 'storageTexture' : 'storage');
  for (const v of r.textures) {
    const t = (v.type.getTypeName ? v.type.getTypeName() : v.type.name) as string;
    add(v, t.startsWith('texture_external') ? 'externalTexture' : 'texture');
  }
  for (const v of r.samplers) {
    const t = (v.type.getTypeName ? v.type.getTypeName() : v.type.name) as string;
    add(v, t.includes('comparison') ? 'samplerComparison' : 'sampler');
  }
  const entries: EntryInfo[] = [];
  for (const stage of ['vertex', 'fragment', 'compute'] as const) {
    for (const f of r.entry[stage] as Any[]) {
      const resources = new Set((f.resources as Any[]).map((x) => x.name as string));
      const used = new Set(((f.overrides ?? []) as Any[]).map((x) => x.name as string));
      for (const name of entryNames(ast, f.name)) {
        if (bindings[name]) resources.add(name);
        else if ((r.overrides as Any[]).some((o) => o.name === name)) used.add(name);
      }
      const e: EntryInfo = { name: f.name, stage, resources: [...resources], overrides: [...used] };
      if (stage === 'compute') e.workgroupSize = f.workgroupSize ?? [1, 1, 1];
      if (stage === 'fragment') e.targets = (f.outputs as Any[]).filter((o) => o.locationType === 'location').length;
      entries.push(e);
    }
  }
  const overrides: Record<string, { type: string; id?: number }> = {};
  for (const o of r.overrides as Any[]) overrides[o.name] = { type: normType(o.type?.name ?? 'f32') };
  return { structs, bindings, entries, overrides };
}

function stripIoAttrs(s: string): string {
  return s.replace(/@(?:builtin|location|interpolate)\s*\([^)]*\)|@invariant\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '<' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === '>' || c === ']' || c === '}') depth--;
    if (i === s.length || (c === ',' && depth === 0)) {
      const part = s.slice(start, i).trim();
      if (part) out.push(part);
      start = i + 1;
    }
  }
  return out;
}

/**
 * Wrap `@vertex` entry points that read `@builtin(instance_index)` with an override-gated Fibonacci reversed-Z
 * micro-bias (`override WEFT_INST_BIAS: f32 = 0.0;`). Preserves exact line numbers for every original source line so
 * `runs` error mapping stays exact, and leaves shaders without `@builtin(instance_index)` byte-identical.
 */
export function injectInstanceBias(code: string): string {
  if (!code.includes('@vertex') || !code.includes('instance_index') || /\bWEFT_INST_BIAS\b/.test(code)) return code;
  const bare = stripComments(code);

  // Map struct names -> their @builtin(position) and @builtin(instance_index) field names
  const posField = new Map<string, string>();
  const instField = new Map<string, string>();
  for (const m of bare.matchAll(/\bstruct\s+([A-Za-z_]\w*)\s*\{([^}]*)\}/g)) {
    const sName = m[1], body = m[2];
    for (const part of splitTopLevelCommas(body)) {
      const fm = /([A-Za-z_]\w*)\s*:/.exec(stripIoAttrs(part));
      if (!fm) continue;
      if (/@builtin\s*\(\s*position\s*\)/.test(part)) posField.set(sName, fm[1]);
      if (/@builtin\s*\(\s*instance_index\s*\)/.test(part)) instField.set(sName, fm[1]);
    }
  }

  // Scan code while skipping comments so edits apply at exact source offsets
  const n = code.length;
  const skipWsAndComments = (i: number): number => {
    while (i < n) {
      if (/\s/.test(code[i])) { i++; continue; }
      if (code[i] === '/' && code[i + 1] === '/') {
        while (i < n && code[i] !== '\n') i++;
        continue;
      }
      if (code[i] === '/' && code[i + 1] === '*') {
        let d = 1; i += 2;
        while (i < n && d > 0) {
          if (code[i] === '/' && code[i + 1] === '*') { d++; i += 2; }
          else if (code[i] === '*' && code[i + 1] === '/') { d--; i += 2; }
          else i++;
        }
        continue;
      }
      break;
    }
    return i;
  };

  const edits: { start: number; end: number; text: string }[] = [];
  const wrappers: string[] = [];
  let i = 0;
  while (i < n) {
    i = skipWsAndComments(i);
    if (i >= n) break;
    if (code.startsWith('@vertex', i) && !/[A-Za-z0-9_]/.test(code[i + 7] ?? '')) {
      const start = i;
      let j = skipWsAndComments(i + 7);
      if (!code.startsWith('fn', j) || /[A-Za-z0-9_]/.test(code[j + 2] ?? '')) { i = j; continue; }
      j = skipWsAndComments(j + 2);
      const nm = /^[A-Za-z_]\w*/.exec(code.slice(j));
      if (!nm) { i = j; continue; }
      const fnName = nm[0];
      j = skipWsAndComments(j + fnName.length);
      if (code[j] !== '(') { i = j; continue; }
      const pOpen = j;
      let depth = 0;
      for (; j < n; j++) {
        if (code[j] === '/' && code[j + 1] === '/') { while (j < n && code[j] !== '\n') j++; continue; }
        if (code[j] === '/' && code[j + 1] === '*') {
          let cd = 1; j += 2;
          while (j < n && cd > 0) {
            if (code[j] === '/' && code[j + 1] === '*') { cd++; j += 2; }
            else if (code[j] === '*' && code[j + 1] === '/') { cd--; j += 2; }
            else j++;
          }
          j--; continue;
        }
        if (code[j] === '(') depth++;
        else if (code[j] === ')' && --depth === 0) break;
      }
      const pClose = j;
      j = skipWsAndComments(pClose + 1);
      if (!code.startsWith('->', j)) { i = j; continue; }
      const retStart = j + 2;
      let brace = retStart;
      while (brace < n && code[brace] !== '{') {
        if (code[brace] === '/' && code[brace + 1] === '/') { while (brace < n && code[brace] !== '\n') brace++; continue; }
        if (code[brace] === '/' && code[brace + 1] === '*') {
          let cd = 1; brace += 2;
          while (brace < n && cd > 0) {
            if (code[brace] === '/' && code[brace + 1] === '*') { cd++; brace += 2; }
            else if (code[brace] === '*' && code[brace + 1] === '/') { cd--; brace += 2; }
            else brace++;
          }
          continue;
        }
        brace++;
      }
      if (brace >= n) break;
      i = brace + 1;

      const rawParams = stripComments(code.slice(pOpen + 1, pClose)).replace(/\s+/g, ' ').trim();
      const rawRet = stripComments(code.slice(retStart, brace)).replace(/\s+/g, ' ').trim();
      const parts = splitTopLevelCommas(rawParams);
      const strippedParams: string[] = [];
      const argNames: string[] = [];
      let iiExpr: string | null = null;
      let ok = true;
      for (const p of parts) {
        const clean = stripIoAttrs(p);
        const pm = /^([A-Za-z_]\w*)\s*:\s*(.+)$/.exec(clean);
        if (!pm) { ok = false; break; }
        const [, pName, pType] = pm;
        strippedParams.push(`${pName}: ${pType.trim()}`);
        argNames.push(pName);
        if (/@builtin\s*\(\s*instance_index\s*\)/.test(p)) iiExpr = pName;
        else if (instField.has(pType.trim())) iiExpr = `${pName}.${instField.get(pType.trim())}`;
      }
      if (!ok || !iiExpr) continue;

      const isDirect = /@builtin\s*\(\s*position\s*\)/.test(rawRet);
      const strippedRet = stripIoAttrs(rawRet);
      const posProp = !isDirect && /^[A-Za-z_]\w*$/.test(strippedRet) ? posField.get(strippedRet) : undefined;
      if (!isDirect && !posProp) continue;

      const origSpan = code.slice(start, brace);
      const nlCount = (origSpan.match(/\n/g) ?? []).length;
      const origName = `_weft_orig_${fnName}`;
      edits.push({
        start,
        end: brace,
        text: `fn ${origName}(${strippedParams.join(', ')}) -> ${strippedRet} ` + '\n'.repeat(nlCount),
      });
      if (isDirect) {
        wrappers.push(`@vertex fn ${fnName}(${rawParams}) -> ${rawRet} { return _weft_ibias(${origName}(${argNames.join(', ')}), ${iiExpr}); }`);
      } else {
        wrappers.push(`@vertex fn ${fnName}(${rawParams}) -> ${rawRet} { var _wo = ${origName}(${argNames.join(', ')}); _wo.${posProp} = _weft_ibias(_wo.${posProp}, ${iiExpr}); return _wo; }`);
      }
      continue;
    }
    i++;
  }

  if (!edits.length) return code;
  let out = '';
  let at = 0;
  for (const e of edits) {
    out += code.slice(at, e.start) + e.text;
    at = e.end;
  }
  out += code.slice(at);
  out += `\noverride WEFT_INST_BIAS: f32 = 0.0;\n`
    + `fn _weft_ibias(p: vec4f, ii: u32) -> vec4f { if (WEFT_INST_BIAS <= 0.0) { return p; } let h = (ii * 0x9e3779b1u) >> 27u; let z = p.z * (1.0 + f32(h) * WEFT_INST_BIAS); return vec4f(p.x, p.y, select(z, min(z, p.w), p.w > 0.0 && p.z <= p.w), p.w); }\n`
    + wrappers.join('\n') + '\n';
  return out;
}

export function compileWgsl(file: string, opts: CompileOptions): CompiledShader {
  const pre = preprocess(file, opts);
  const srcCode = opts.autoInstanceBias === false ? pre.code : injectInstanceBias(pre.code);
  let reflect: ShaderReflection;
  try {
    reflect = reflectWgsl(srcCode);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    // wgsl_reflect reports `line N` in output coordinates when it can: map it back
    const lm = /line[: ]+(\d+)/i.exec(msg);
    const where = lm ? mapLine(pre.runs, pre.files, Number(lm[1])) : null;
    throw new WgslError(`${where ? `${where.file}:${where.line}: ` : ''}WGSL parse error: ${msg}`);
  }
  const id = relative(opts.root, file).split(sep).join('/');
  const label = id.split('/').pop()!.replace(/\.wgsl$/, '');
  // (reflected whole, for the struct layouts and their tweak comments; the browser gets the lean code: lean.ts)
  const lean = opts.lean === false ? { code: srcCode, runs: pre.runs } : leanWgsl(srcCode, pre.runs);
  return { id, label, code: lean.code, files: pre.files, runs: lean.runs, includes: pre.includes, structFiles: pre.structFiles, reflect };
}

// ---------------------------------------------------------------- generated declarations

export interface DeclarationOptions {
  /** absolute path of the shader file being declared */
  file?: string;
  /** project root; only included shaders inside `root` (and outside `node_modules`) are imported by type */
  root?: string;
  /** import structs declared in project-local included .wgsl files instead of copying them into every .d.wgsl.ts */
  sharedTypes?: boolean;
}

function tsType(t: string, structs: Record<string, StructLayout>, f?: FieldLayout): string {
  if (f?.type === 'struct' && f.struct) return f.struct;
  if (f?.type === 'array' && f.array) {
    if (f.array.elemStruct) return `Partial<${f.array.elemStruct}>[]`;
    return `ArrayLike<number> | ${tsType(f.array.elem, structs)}[]`;
  }
  if (/^(f32|i32|u32|f16|atomic<.+>)$/.test(t)) return 'number';
  if (/^vec2/.test(t)) return 'Vec2';
  if (/^vec3/.test(t)) return 'Vec3';
  if (/^vec4/.test(t)) return 'Vec4';
  if (/^mat3x3/.test(t)) return 'Mat3';
  if (/^mat4x4/.test(t)) return 'Mat4';
  if (/^mat/.test(t)) return 'ArrayLike<number>';
  if (structs[t]) return t;
  return 'unknown';
}

export function declaration(s: CompiledShader, weftImport: string, opts: DeclarationOptions = {}): string {
  const { structs, bindings } = s.reflect;
  const body: string[] = [];
  const sharedByFile = new Map<string, string[]>();
  const canShare = (srcAbs: string | undefined): srcAbs is string => {
    if (!opts.sharedTypes || !opts.file || !srcAbs || srcAbs === opts.file) return false;
    const norm = srcAbs.split(sep).join('/');
    if (norm.includes('/node_modules/')) return false;
    if (opts.root) {
      const r = relative(opts.root, srcAbs);
      if (r.startsWith('..') || r === '') return false;
    }
    return true;
  };
  for (const st of Object.values(structs)) {
    const srcAbs = s.structFiles?.[st.name];
    if (canShare(srcAbs)) {
      let relSpec = relative(dirname(opts.file!), srcAbs).split(sep).join('/');
      if (!relSpec.startsWith('.')) relSpec = `./${relSpec}`;
      let list = sharedByFile.get(relSpec);
      if (!list) sharedByFile.set(relSpec, (list = []));
      list.push(st.name);
      continue;
    }
    body.push(`export interface ${st.name} {`);
    for (const f of st.fields) body.push(`  ${f.name}: ${tsType(f.type, structs, f)};`);
    body.push('}');
  }
  const sharedImports: string[] = [];
  const sharedExports: string[] = [];
  for (const [spec, names] of [...sharedByFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    sharedImports.push(`import type { ${names.join(', ')} } from '${spec}';`);
    sharedExports.push(`export type { ${names.join(', ')} };`);
  }
  const structMap = Object.keys(structs).map((n) => `${n}: ${n}`).join('; ');
  const bindingNames = Object.keys(bindings).map((n) => `'${n}'`).join(' | ') || 'never';
  if (sharedExports.length) body.unshift(...sharedExports);
  body.push('', `declare const shader: Shader<{ ${structMap} }, ${bindingNames}>;`, 'export default shader;', '');
  const text = body.join('\n');
  const used = ['Vec2', 'Vec3', 'Vec4', 'Mat3', 'Mat4'].filter((t) => new RegExp(`\\b${t}\\b`).test(text));
  const head = [
    `// generated by weft from ${s.id} — do not edit`,
    `import type { Shader${used.map((t) => ', ' + t).join('')} } from '${weftImport}';`,
    ...sharedImports,
    '',
    text,
  ];
  return head.join('\n');
}

export function writeDeclaration(file: string, s: CompiledShader, weftImport: string, opts: DeclarationOptions = {}) {
  const dts = file.replace(/\.wgsl$/, '.d.wgsl.ts');
  const text = declaration(s, weftImport, { ...opts, file });
  if (existsSync(dts) && readFileSync(dts, 'utf8') === text) return false;
  writeFileSync(dts, text);
  return true;
}

// ---------------------------------------------------------------- portable shader manifest (for native wgpu / tooling)

export interface ShaderManifestEntry {
  id: string;
  label: string;
  /** first 16 hex chars of SHA-256 over `code` */
  sha256: string;
  code: string;
  files: string[];
  runs: number[];
  reflect: ShaderReflection;
}

export interface ShaderManifest {
  version: 1;
  shaders: Record<string, ShaderManifestEntry>;
}

/** Convert a compiled shader into a portable, JSON-serializable manifest entry (expanded WGSL + reflection + line map). */
export function manifestEntry(s: CompiledShader): ShaderManifestEntry {
  const sha256 = createHash('sha256').update(s.code).digest('hex').slice(0, 16);
  return {
    id: s.id,
    label: s.label,
    sha256,
    code: s.code,
    files: s.files,
    runs: s.runs,
    reflect: s.reflect,
  };
}

/** Compile a list of `.wgsl` files into a deterministic, UTF-16-sorted `ShaderManifest` for native engines or offline
 *  audits. Throws at the first file that fails to preprocess or reflect. */
export function buildShaderManifest(files: readonly string[], opts: CompileOptions): ShaderManifest {
  const entries = files.map((f) => manifestEntry(compileWgsl(resolve(opts.root, f), opts)));
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shaders: Record<string, ShaderManifestEntry> = {};
  for (const e of entries) shaders[e.id] = e;
  return { version: 1, shaders };
}

