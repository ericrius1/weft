// What the browser is given of a shader: its code with the comments gone and only what its entry points reach.
//
// Browsers keep compiled pipelines between visits, keyed on the shader they were given. Chrome (Dawn) keys on the WGSL
// text itself, so a comment edited in a file every shader includes, or a function added to it that most never call,
// made every one of them compile again on the next visit: measured on an RTX 5090, 51 of San Francisco's compute
// pipelines took 5-7 s again after a one-line comment in world.wgsl, against 0.1 s warm. WebKit keys on the Metal it
// makes from the WGSL (it drops comments and what's unused itself), so there a change reaches only the shaders whose
// Metal it changes. Given the lean code, both see a change only in a shader that uses what changed.
//
// - comments (`//` and nesting `/* */`) are removed and trailing whitespace trimmed; blank lines go;
// - module-scope declarations no entry point (`@vertex`, `@fragment`, `@compute`) reaches, directly or through what it
//   reaches, go: functions, structs, constants, overrides, variables and bindings, aliases. A name read only as a
//   member (`world.hills`) doesn't count. Directives (`enable`, `requires`, `diagnostic`) and `const_assert`s stay;
// - every code line kept is as it was, indentation and all, so a compile error's line and column, mapped back through
//   the new `runs`, still point at the source, and a project's replace of a whole code line still finds it.
// A module with no entry point (a library compiled on its own) keeps every declaration.

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;
const KEEP_ALWAYS = new Set(['enable', 'requires', 'diagnostic', 'const_assert']);
const ENTRY = /@(vertex|fragment|compute)\b/;

/** the code with its comments removed (each comment's newlines kept, so lines still line up) */
export function stripComments(code: string): string {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n' && code[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (code[i] === '/' && code[i + 1] === '*') { depth++; i += 2; continue; }
        if (code[i] === '*' && code[i + 1] === '/') { depth--; i += 2; continue; }
        if (code[i] === '\n') out += '\n';
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

interface Decl { start: number; end: number; name: string | null; keep: boolean; refs: Set<string> }

/** the names a stretch of code reads: identifiers not part of a number and not a member after `.` */
function refsOf(text: string): Set<string> {
  const refs = new Set<string>();
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const start = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
    if (!start) continue;
    const prev = i > 0 ? text[i - 1] : '';
    IDENT.lastIndex = i;
    const m = IDENT.exec(text)!;
    let j = i - 1;
    while (j >= 0 && /\s/.test(text[j])) j--;
    if (!/[A-Za-z0-9_]/.test(prev) && text[j] !== '.') refs.add(m[0]);
    i += m[0].length - 1;
  }
  return refs;
}

/** module-scope declarations of comment-free code: each one's span, its name, and whether it's kept regardless */
function declarations(code: string): Decl[] {
  const decls: Decl[] = [];
  const n = code.length;
  let i = 0;
  while (i < n) {
    while (i < n && /[\s;]/.test(code[i])) i++;
    if (i >= n) break;
    const start = i;
    // attributes: @name or @name(...)
    let attrs = '';
    for (;;) {
      while (i < n && /\s/.test(code[i])) i++;
      if (code[i] !== '@') break;
      const a0 = i;
      i++;
      IDENT.lastIndex = i;
      const m = IDENT.exec(code);
      if (m) i += m[0].length;
      while (i < n && /\s/.test(code[i])) i++;
      if (code[i] === '(') {
        let depth = 0;
        do { if (code[i] === '(') depth++; else if (code[i] === ')') depth--; i++; } while (i < n && depth > 0);
      }
      attrs += code.slice(a0, i) + ' ';
    }
    IDENT.lastIndex = i;
    const kw = IDENT.exec(code)?.[0] ?? '';
    // the declaration runs to a `;` outside any brackets, or (a function, a struct) to the `}` that closes its body
    const block = kw === 'fn' || kw === 'struct';
    let depth = 0;
    while (i < n) {
      const c = code[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        depth--;
        if (c === '}' && depth === 0 && block) { i++; break; }
      } else if (c === ';' && depth === 0) { i++; break; }
      i++;
    }
    const text = code.slice(start, i);
    let name: string | null = null;
    // fn NAME, struct NAME, alias NAME, const NAME, override NAME, var NAME, var<...> NAME, let NAME
    const m = /^(?:fn|struct|alias|const|override|let|var(?:\s*<[^>]*>)?)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(text.indexOf(kw)));
    if (m && kw !== 'const_assert') name = m[1];
    const keep = KEEP_ALWAYS.has(kw) || ENTRY.test(attrs) || !name;
    const refs = refsOf(text);
    if (name) refs.delete(name);
    decls.push({ start, end: i, name, keep, refs });
  }
  return decls;
}

/** A struct that's only ever the type of `var<uniform>` bindings (never in an array, another struct, a storage
 *  buffer, or built with `S(…)`), given only the fields this module reads: the ones after the last read are left
 *  out, and the unread ones before it renamed `_p<i>` (their types kept, so every offset stays). A uniform buffer may
 *  be larger than its struct, so the buffer written from the whole struct's layout still fits. A field added, or one
 *  renamed, then changes only the shaders that read past it. A field counts as read if `.name` appears anywhere
 *  (another struct's member of that name too: it errs toward keeping). */
function uniformStructs(code: string, decls: Decl[], live: Set<Decl>): Map<Decl, string> {
  const out = new Map<Decl, string>();
  const liveDecls = decls.filter((d) => live.has(d));
  const liveText = liveDecls.map((d) => code.slice(d.start, d.end)).join('\n');
  const members = new Set<string>();
  for (const m of liveText.matchAll(/\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) members.add(m[1]);
  for (const s of liveDecls) {
    const text = code.slice(s.start, s.end);
    if (!s.name || !/^struct\b/.test(text.replace(/^(?:\s*@\w+(?:\([^)]*\))?)*\s*/, ''))) continue;
    const name = s.name;
    const users = liveDecls.filter((d) => d !== s && d.refs.has(name));
    const uniform = users.filter((d) => /^(?:\s*@\w+(?:\([^)]*\))?)*\s*var\s*<\s*uniform\s*>/.test(code.slice(d.start, d.end)));
    if (!uniform.length) continue;
    const plain = users.every((d) => {
      const t = code.slice(d.start, d.end);
      if (uniform.includes(d)) return true;
      if (/^(?:\s*@\w+(?:\([^)]*\))?)*\s*(struct|var|const|override|alias)\b/.test(t)) return false;
      return !new RegExp(`\\b${name}\\s*\\(|array\\s*<\\s*${name}\\b|ptr\\s*<[^>]*\\b${name}\\b`).test(t);
    });
    if (!plain) continue;
    const open = text.indexOf('{'), close = text.lastIndexOf('}');
    if (open < 0 || close < open) continue;
    // fields: split at commas outside <>, (), []
    const body = text.slice(open + 1, close);
    const parts: { from: number; to: number }[] = [];
    let depth = 0, from = 0;
    for (let i = 0; i <= body.length; i++) {
      const c = body[i];
      if (c === '<' || c === '(' || c === '[') depth++;
      else if (c === '>' || c === ')' || c === ']') depth--;
      if (i === body.length || (c === ',' && depth === 0)) { parts.push({ from, to: i }); from = i + 1; }
    }
    const fields = parts.map((p) => {
      const seg = body.slice(p.from, p.to);
      const m = /^((?:\s*@\w+(?:\([^)]*\))?)*\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(seg);
      return m ? { ...p, nameAt: p.from + m[1].length, name: m[2] } : null;
    });
    if (fields.some((f, i) => !f && body.slice(parts[i].from, parts[i].to).trim())) continue;
    const real = fields.filter((f): f is NonNullable<typeof f> => !!f);
    let last = -1;
    real.forEach((f, i) => { if (members.has(f.name)) last = i; });
    last = Math.max(last, 0);
    if (last === real.length - 1 && real.every((f, i) => i > last || members.has(f.name))) continue;
    let nb = '';
    let at = 0;
    real.forEach((f, i) => {
      if (i > last) {
        nb += body.slice(at, f.from) + body.slice(f.from, f.to + 1).replace(/[^\n]/g, '');
        at = Math.min(f.to + 1, body.length);
      } else if (!members.has(f.name)) {
        nb += body.slice(at, f.nameAt) + `_p${i}`;
        at = f.nameAt + f.name.length;
      }
    });
    nb += body.slice(at);
    out.set(s, text.slice(0, open + 1) + nb + text.slice(close));
  }
  return out;
}

/** maps 1-based output lines of `runs` ([firstOutLine, fileIndex, firstSourceLine] …) to [fileIndex, sourceLine] */
function lineSource(runs: number[], line: number): [number, number] {
  let r = 0;
  for (let i = 0; i < runs.length; i += 3) if (runs[i] <= line) r = i; else break;
  return [runs[r + 1], runs[r + 2] + (line - runs[r])];
}

/** the lean code (see above) and its line map, in the same form as `runs` */
export function leanWgsl(code: string, runs: number[]): { code: string; runs: number[] } {
  const bare = stripComments(code);
  const decls = declarations(bare);
  const byName = new Map<string, Decl>();
  for (const d of decls) if (d.name) byName.set(d.name, d);
  const hasEntry = decls.some((d) => d.keep && d.name);
  const live = new Set<Decl>();
  const todo = decls.filter((d) => d.keep || !hasEntry);
  while (todo.length) {
    const d = todo.pop()!;
    if (live.has(d)) continue;
    live.add(d);
    for (const r of d.refs) { const t = byName.get(r); if (t && !live.has(t)) todo.push(t); }
  }
  // a struct only ever a uniform's type is cut after the last field read (see uniformStructs)
  const cut = uniformStructs(bare, decls, live);
  // the dropped declarations' characters removed, their newlines kept
  let kept = '';
  let at = 0;
  for (const d of decls) {
    const into = cut.get(d);
    if (live.has(d) && into === undefined) continue;
    kept += bare.slice(at, d.start) + (into ?? bare.slice(d.start, d.end).replace(/[^\n]/g, ''));
    at = d.end;
  }
  kept += bare.slice(at);
  const lines = kept.split('\n');
  const out: string[] = [];
  const outRuns: number[] = [];
  let lastFile = -1, lastSrc = -2;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k].replace(/\s+$/, '');
    if (!line) continue;
    const [fi, src] = runs.length ? lineSource(runs, k + 1) : [0, k + 1];
    if (fi !== lastFile || src !== lastSrc + 1) outRuns.push(out.length + 1, fi, src);
    lastFile = fi; lastSrc = src;
    out.push(line);
  }
  return { code: out.join('\n'), runs: outRuns };
}
