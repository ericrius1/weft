const REG = (globalThis.__weftShaders ??= new Map());
function syncStructs(s, structs) {
    const out = s.structs;
    for (const [name, layout] of Object.entries(structs)) {
        const prev = out[name];
        if (prev) {
            const changed = JSON.stringify(layout) !== JSON.stringify({ name: prev.name, size: prev.size, align: prev.align, fields: prev.fields });
            Object.assign(prev, layout);
            if (changed)
                prev.version++;
        }
        else {
            out[name] = Object.assign({ shader: s, version: 1 }, layout);
        }
    }
}
export function defineShader(data) {
    const prev = REG.get(data.id);
    if (prev) {
        Object.assign(prev, { code: data.code, files: data.files, runs: data.runs, reflect: data.reflect, error: data.error, label: data.label });
        prev.bindings = data.reflect.bindings;
        syncStructs(prev, data.reflect.structs);
        prev.version++;
        for (const cb of listeners.get(prev) ?? [])
            cb(prev);
        return prev;
    }
    const s = {
        ...data,
        version: 1,
        structs: {},
        bindings: data.reflect.bindings,
        onChange(cb) {
            let set = listeners.get(s);
            if (!set)
                listeners.set(s, (set = new Set()));
            set.add(cb);
            return () => set.delete(cb);
        },
    };
    syncStructs(s, data.reflect.structs);
    REG.set(data.id, s);
    return s;
}
const listeners = new WeakMap();
/** maps a 1-based line of the preprocessed code back to its source file and line */
export function sourceLine(s, line) {
    const runs = s.runs;
    let r = 0;
    for (let i = 0; i < runs.length; i += 3)
        if (runs[i] <= line)
            r = i;
        else
            break;
    if (!runs.length)
        return { file: s.id, line };
    return { file: s.files[runs[r + 1]], line: runs[r + 2] + (line - runs[r]) };
}
/** every shader loaded so far (the debug overlay lists them) */
export const allShaders = () => [...REG.values()];
//# sourceMappingURL=shader.js.map