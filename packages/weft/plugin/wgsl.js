// The build-time half of weft: turns a .wgsl file into { code, reflection, line map }.
//
// 1. `#include "path"` is resolved (relative to the including file, or `weft/…` from the kit's shader library), each
//    file once, and every output line remembers where it came from so compile errors point at the real file:line.
// 2. The result is reflected with wgsl_reflect: struct layouts (offsets, sizes, array strides), bindings by variable
//    name, entry points (with the resources each one actually uses and compute workgroup sizes) and overrides.
// 3. Struct members can carry tweak annotations in a trailing comment: `// @range(0, 2)`, `// @range(0, 1, 0.01)`,
//    `// @color`. The debug overlay builds sliders from them.
// 4. A `.d.wgsl.ts` declaration is generated next to the shader, so `import s from './x.wgsl'` gives typed struct
//    fields and binding names (TS `allowArbitraryExtensions`).
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
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
            if (fi !== lastFile || i + 1 !== lastSrc + 1)
                runs.push(out.length + 1, fi, i + 1);
            lastFile = fi;
            lastSrc = i + 1;
            out.push(lines[i]);
        }
    };
    visit(entry);
    return { code: out.join('\n'), files, runs, includes: [...seen].filter((f) => f !== entry) };
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
export function reflectWgsl(code) {
    const r = new WgslReflect(code);
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
            const e = { name: f.name, stage, resources: [...new Set(f.resources.map((x) => x.name))], overrides: [...new Set((f.overrides ?? []).map((x) => x.name))] };
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
    return { id, label, code: pre.code, files: pre.files, runs: pre.runs, includes: pre.includes, reflect };
}
// ---------------------------------------------------------------- generated declarations
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
export function declaration(s, weftImport) {
    const { structs, bindings } = s.reflect;
    const body = [];
    for (const st of Object.values(structs)) {
        body.push(`export interface ${st.name} {`);
        for (const f of st.fields)
            body.push(`  ${f.name}: ${tsType(f.type, structs, f)};`);
        body.push('}');
    }
    const structMap = Object.keys(structs).map((n) => `${n}: ${n}`).join('; ');
    const bindingNames = Object.keys(bindings).map((n) => `'${n}'`).join(' | ') || 'never';
    body.push('', `declare const shader: Shader<{ ${structMap} }, ${bindingNames}>;`, 'export default shader;', '');
    const text = body.join('\n');
    const used = ['Vec2', 'Vec3', 'Vec4', 'Mat3', 'Mat4'].filter((t) => new RegExp(`\\b${t}\\b`).test(text));
    return [`// generated by weft from ${s.id} — do not edit`, `import type { Shader${used.map((t) => ', ' + t).join('')} } from '${weftImport}';`, '', text].join('\n');
}
export function writeDeclaration(file, s, weftImport) {
    const dts = file.replace(/\.wgsl$/, '.d.wgsl.ts');
    const text = declaration(s, weftImport);
    if (existsSync(dts) && readFileSync(dts, 'utf8') === text)
        return false;
    writeFileSync(dts, text);
    return true;
}
//# sourceMappingURL=wgsl.js.map