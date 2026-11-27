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
import { leanWgsl } from './lean.js';
export class WgslError extends Error {
}
const INCLUDE = /^\s*#include\s+"([^"]+)"\s*;?\s*(\/\/.*)?$/;
function resolveInclude(spec, from, opts) {
    const withExt = spec.endsWith('.wgsl') ? spec : spec + '.wgsl';
    for (const [prefix, dir] of Object.entries(opts.libs)) {
        if (withExt.startsWith(prefix + '/'))
            return resolve(dir, withExt.slice(prefix.length + 1));
    }
    return resolve(dirname(from), withExt);
}
export function preprocess(entry, opts) {
    const out = [];
    const files = [];
    const runs = [];
    const seen = new Set();
    const structFiles = {};
    const rel = (p) => relative(opts.root, p).split(sep).join('/');
    let lastFile = -1, lastSrc = -2;
    const visit = (abs, from, fromLine, spec) => {
        if (seen.has(abs))
            return;
        seen.add(abs);
        if (!existsSync(abs))
            throw new WgslError(`${from ? rel(from) : '?'}:${fromLine}: #include "${spec}" not found (${rel(abs)})`);
        const fi = files.push(rel(abs)) - 1;
        const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const m = INCLUDE.exec(lines[i]);
            if (m) {
                visit(resolveInclude(m[1], abs, opts), abs, i + 1, m[1]);
                continue;
            }
            const sm = /^\s*struct\s+(\w+)\b/.exec(lines[i]);
            if (sm && !(sm[1] in structFiles))
                structFiles[sm[1]] = abs;
            if (fi !== lastFile || i + 1 !== lastSrc + 1)
                runs.push(out.length + 1, fi, i + 1);
            lastFile = fi;
            lastSrc = i + 1;
            out.push(lines[i]);
        }
    };
    visit(entry);
    return { code: out.join('\n'), files, runs, includes: [...seen].filter((f) => f !== entry), structFiles };
}
/** maps a 1-based output line back to { file, line } */
export function mapLine(runs, files, line) {
    let r = 0;
    for (let i = 0; i < runs.length; i += 3)
        if (runs[i] <= line)
            r = i;
        else
            break;
    return { file: files[runs[r + 1]], line: runs[r + 2] + (line - runs[r]) };
}
const SUFFIX = { f32: 'f', i32: 'i', u32: 'u', f16: 'h' };
export function normType(t) {
    t = t.replace(/\s+/g, '');
    const m = /^(vec[234]|mat[234]x[234])<(f32|i32|u32|f16)>$/.exec(t);
    if (m)
        return m[1] + SUFFIX[m[2]];
    return t;
}
// trailing-comment annotations on struct members: `name: type, // @range(0, 1)`
function annotations(code) {
    const ann = {};
    let struct = null, depth = 0;
    for (const line of code.split('\n')) {
        const s = /^\s*struct\s+(\w+)/.exec(line);
        if (s) {
            struct = s[1];
            depth = 0;
        }
        if (!struct)
            continue;
        const m = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(\w+)\s*:[^/]*\/\/(.*)$/.exec(line);
        if (m && m[1] !== 'struct') {
            const a = {};
            const r = /@range\(([^)]*)\)/.exec(m[2]);
            if (r)
                a.range = r[1].split(',').map((x) => Number(x.trim()));
            if (/@color\b/.test(m[2]))
                a.color = true;
            if (a.range || a.color)
                ann[`${struct}.${m[1]}`] = a;
        }
        const code0 = line.replace(/\/\/.*$/, '');
        for (const ch of code0) {
            if (ch === '{')
                depth++;
            else if (ch === '}' && --depth <= 0) {
                struct = null;
                break;
            }
        }
    }
    return ann;
}
function texInfo(typeName) {
    const t = typeName.replace(/\s+/g, '');
    const ms = t.includes('multisampled');
    let dim = '2d';
    if (t.includes('_2d_array'))
        dim = '2d-array';
    else if (t.includes('_cube_array'))
        dim = 'cube-array';
    else if (t.includes('_cube'))
        dim = 'cube';
    else if (t.includes('_3d'))
        dim = '3d';
    else if (t.includes('_1d'))
        dim = '1d';
    let sample = 'float';
    if (t.includes('depth'))
        sample = 'depth';
    else if (/<u32>/.test(t))
        sample = 'uint';
    else if (/<i32>/.test(t))
        sample = 'sint';
    return { dim, sample, multisampled: ms };
}
/** How many statements the parser keeps of a `case` body that has three. */
function caseStatements() {
    const ast = new WgslParser().parse('fn f(m: u32) { var a = 0; switch m { default: { a = 1; a = 2; a = 3; } } }');
    const sw = ast[0]?.body?.find((s) => s?.astNodeType === 'switch');
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
    const P = WgslParser.prototype;
    P._case_body = function caseBody() {
        const body = [];
        while (!this._check(TokenTypes.tokens.brace_right) && !this._isAtEnd()) {
            if (this._match(TokenTypes.keywords.fallthrough)) {
                this._consume(TokenTypes.tokens.semicolon, "Expected ';'");
                break;
            }
            const s = this._statement();
            if (s === null)
                break;
            if (Array.isArray(s))
                body.push(...s);
            else
                body.push(s);
        }
        return body;
    };
    if (caseStatements() !== 3)
        throw new Error('weft: wgsl_reflect\'s switch-case parsing could not be corrected (its parser changed): check plugin/wgsl.ts');
}
function fieldOf(m, ann, structName) {
    const f = { name: m.name, offset: m.offset, size: m.size, type: '' };
    if (m.isArray) {
        const fmt = m.format;
        const elemStruct = fmt?.isStruct ? fmt.name : undefined;
        f.type = 'array';
        f.array = { count: m.count, stride: m.stride, elem: elemStruct ? 'struct' : normType(fmt?.getTypeName?.() ?? fmt?.name ?? '?'), elemStruct };
    }
    else if (m.isStruct) {
        f.type = 'struct';
        f.struct = m.type.name;
    }
    else {
        f.type = normType(m.type.getTypeName ? m.type.getTypeName() : m.type.name);
    }
    const a = ann[`${structName}.${m.name}`];
    if (a?.range)
        f.range = a.range;
    if (a?.color)
        f.color = true;
    return f;
}
/** The module-scope names an entry point's code reads, through every function it calls: each reachable function's
 *  body walked whole (every expression, index and argument at any depth), less the names its own parameters and
 *  local declarations shadow. */
function entryNames(ast, entry) {
    const fns = new Map();
    for (const n of ast)
        if (n?.astNodeType === 'function')
            fns.set(n.name, n);
    const names = new Set();
    const done = new Set();
    const todo = [entry];
    while (todo.length) {
        const fn = fns.get(todo.pop());
        if (!fn || done.has(fn.name))
            continue;
        done.add(fn.name);
        const local = new Set((fn.args ?? []).map((a) => a.name));
        const read = [];
        const seen = new WeakSet();
        const visit = (n) => {
            if (!n || typeof n !== 'object' || seen.has(n))
                return;
            seen.add(n);
            if (Array.isArray(n)) {
                for (const c of n)
                    visit(c);
                return;
            }
            const t = n.astNodeType;
            if ((t === 'let' || t === 'var' || t === 'const') && typeof n.name === 'string')
                local.add(n.name);
            else if (t === 'varExpr' && typeof n.name === 'string')
                read.push(n.name);
            else if (t === 'callExpr' && typeof n.name === 'string')
                todo.push(n.name);
            for (const k in n)
                if (k !== 'parent' && k !== 'calls')
                    visit(n[k]);
        };
        visit(fn.body);
        for (const name of read)
            if (!local.has(name))
                names.add(name);
    }
    return names;
}
export function reflectWgsl(code) {
    const r = new WgslReflect(code);
    const ast = new WgslParser().parse(code);
    const ann = annotations(code);
    const structs = {};
    for (const s of r.structs) {
        structs[s.name] = { name: s.name, size: s.size, align: s.align, fields: s.members.map((m) => fieldOf(m, ann, s.name)) };
    }
    const bindings = {};
    const add = (v, kind) => {
        const typeName = normType(v.type.getTypeName ? v.type.getTypeName() : v.type.name);
        const b = { name: v.name, group: v.group, binding: v.binding, kind, type: typeName };
        if (kind === 'uniform' || kind === 'storage') {
            if (v.type.isStruct)
                b.struct = v.type.name;
            if (v.type.isArray) {
                const fmt = v.type.format;
                if (fmt?.isStruct)
                    b.elemStruct = fmt.name;
                else
                    b.elem = normType(fmt?.getTypeName?.() ?? fmt?.name ?? '?');
            }
        }
        if (kind === 'storage')
            b.access = v.access === 'read_write' ? 'read_write' : 'read';
        if (kind === 'storageTexture') {
            b.access = v.access === 'read_write' ? 'read_write' : v.access === 'read' ? 'read' : 'write';
            b.format = v.type.format?.name;
            b.texture = texInfo(typeName);
        }
        if (kind === 'texture')
            b.texture = texInfo(typeName);
        bindings[v.name] = b;
    };
    for (const v of r.uniforms)
        add(v, 'uniform');
    for (const v of r.storage)
        add(v, v.resourceType === 5 ? 'storageTexture' : 'storage');
    for (const v of r.textures) {
        const t = (v.type.getTypeName ? v.type.getTypeName() : v.type.name);
        add(v, t.startsWith('texture_external') ? 'externalTexture' : 'texture');
    }
    for (const v of r.samplers) {
        const t = (v.type.getTypeName ? v.type.getTypeName() : v.type.name);
        add(v, t.includes('comparison') ? 'samplerComparison' : 'sampler');
    }
    const entries = [];
    for (const stage of ['vertex', 'fragment', 'compute']) {
        for (const f of r.entry[stage]) {
            const resources = new Set(f.resources.map((x) => x.name));
            const used = new Set((f.overrides ?? []).map((x) => x.name));
            for (const name of entryNames(ast, f.name)) {
                if (bindings[name])
                    resources.add(name);
                else if (r.overrides.some((o) => o.name === name))
                    used.add(name);
            }
            const e = { name: f.name, stage, resources: [...resources], overrides: [...used] };
            if (stage === 'compute')
                e.workgroupSize = f.workgroupSize ?? [1, 1, 1];
            if (stage === 'fragment')
                e.targets = f.outputs.filter((o) => o.locationType === 'location').length;
            entries.push(e);
        }
    }
    const overrides = {};
    for (const o of r.overrides)
        overrides[o.name] = { type: normType(o.type?.name ?? 'f32') };
    return { structs, bindings, entries, overrides };
}
export function compileWgsl(file, opts) {
    const pre = preprocess(file, opts);
    let reflect;
    try {
        reflect = reflectWgsl(pre.code);
    }
    catch (e) {
        const msg = e.message ?? String(e);
        // wgsl_reflect reports `line N` in output coordinates when it can: map it back
        const lm = /line[: ]+(\d+)/i.exec(msg);
        const where = lm ? mapLine(pre.runs, pre.files, Number(lm[1])) : null;
        throw new WgslError(`${where ? `${where.file}:${where.line}: ` : ''}WGSL parse error: ${msg}`);
    }
    const id = relative(opts.root, file).split(sep).join('/');
    const label = id.split('/').pop().replace(/\.wgsl$/, '');
    // (reflected whole, for the struct layouts and their tweak comments; the browser gets the lean code: lean.ts)
    const lean = opts.lean === false ? { code: pre.code, runs: pre.runs } : leanWgsl(pre.code, pre.runs);
    return { id, label, code: lean.code, files: pre.files, runs: lean.runs, includes: pre.includes, structFiles: pre.structFiles, reflect };
}
function tsType(t, structs, f) {
    if (f?.type === 'struct' && f.struct)
        return f.struct;
    if (f?.type === 'array' && f.array) {
        if (f.array.elemStruct)
            return `Partial<${f.array.elemStruct}>[]`;
        return `ArrayLike<number> | ${tsType(f.array.elem, structs)}[]`;
    }
    if (/^(f32|i32|u32|f16|atomic<.+>)$/.test(t))
        return 'number';
    if (/^vec2/.test(t))
        return 'Vec2';
    if (/^vec3/.test(t))
        return 'Vec3';
    if (/^vec4/.test(t))
        return 'Vec4';
    if (/^mat3x3/.test(t))
        return 'Mat3';
    if (/^mat4x4/.test(t))
        return 'Mat4';
    if (/^mat/.test(t))
        return 'ArrayLike<number>';
    if (structs[t])
        return t;
    return 'unknown';
}
export function declaration(s, weftImport, opts = {}) {
    const { structs, bindings } = s.reflect;
    const body = [];
    const sharedByFile = new Map();
    const canShare = (srcAbs) => {
        if (!opts.sharedTypes || !opts.file || !srcAbs || srcAbs === opts.file)
            return false;
        const norm = srcAbs.split(sep).join('/');
        if (norm.includes('/node_modules/'))
            return false;
        if (opts.root) {
            const r = relative(opts.root, srcAbs);
            if (r.startsWith('..') || r === '')
                return false;
        }
        return true;
    };
    for (const st of Object.values(structs)) {
        const srcAbs = s.structFiles?.[st.name];
        if (canShare(srcAbs)) {
            let relSpec = relative(dirname(opts.file), srcAbs).split(sep).join('/');
            if (!relSpec.startsWith('.'))
                relSpec = `./${relSpec}`;
            let list = sharedByFile.get(relSpec);
            if (!list)
                sharedByFile.set(relSpec, (list = []));
            list.push(st.name);
            continue;
        }
        body.push(`export interface ${st.name} {`);
        for (const f of st.fields)
            body.push(`  ${f.name}: ${tsType(f.type, structs, f)};`);
        body.push('}');
    }
    const sharedImports = [];
    const sharedExports = [];
    for (const [spec, names] of [...sharedByFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        sharedImports.push(`import type { ${names.join(', ')} } from '${spec}';`);
        sharedExports.push(`export type { ${names.join(', ')} };`);
    }
    const structMap = Object.keys(structs).map((n) => `${n}: ${n}`).join('; ');
    const bindingNames = Object.keys(bindings).map((n) => `'${n}'`).join(' | ') || 'never';
    if (sharedExports.length)
        body.unshift(...sharedExports);
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
export function writeDeclaration(file, s, weftImport, opts = {}) {
    const dts = file.replace(/\.wgsl$/, '.d.wgsl.ts');
    const text = declaration(s, weftImport, { ...opts, file });
    if (existsSync(dts) && readFileSync(dts, 'utf8') === text)
        return false;
    writeFileSync(dts, text);
    return true;
}
/** Convert a compiled shader into a portable, JSON-serializable manifest entry (expanded WGSL + reflection + line map). */
export function manifestEntry(s) {
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
export function buildShaderManifest(files, opts) {
    const entries = files.map((f) => manifestEntry(compileWgsl(resolve(opts.root, f), opts)));
    entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const shaders = {};
    for (const e of entries)
        shaders[e.id] = e;
    return { version: 1, shaders };
}
//# sourceMappingURL=wgsl.js.map