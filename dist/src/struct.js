const VEC = /^vec([234])([fiuh])$/;
const MAT = /^mat([234])x([234])([fh])$/;
export class StructView {
    def;
    base;
    structs;
    data;
    f32;
    u32;
    i32;
    constructor(def, data, base = 0, structs) {
        this.def = def;
        this.base = base;
        this.structs = structs;
        this.data = data ?? new ArrayBuffer(Math.max(16, Math.ceil(def.size / 16) * 16));
        this.f32 = new Float32Array(this.data);
        this.u32 = new Uint32Array(this.data);
        this.i32 = new Int32Array(this.data);
        if (!this.structs && 'shader' in def)
            this.structs = def.shader.reflect.structs;
    }
    /** byte offset of a top-level field */
    offset(field) {
        const f = planOf(this.def).get(field);
        if (!f)
            throw new Error(`struct ${this.def.name} has no field '${field}'`);
        return this.base + f.offset;
    }
    set(values) {
        writeStruct(this, this.def, this.base, values);
        return this;
    }
    get(field) {
        const f = this.def.fields.find((x) => x.name === field);
        if (!f)
            return undefined;
        return readField(this, f, this.base + f.offset);
    }
    /** every field as a plain object (used to carry values across a hot layout change) */
    toObject() {
        const o = {};
        for (const f of this.def.fields)
            o[f.name] = readField(this, f, this.base + f.offset);
        return o;
    }
    layoutOf(name) {
        const s = this.structs?.[name];
        if (!s)
            throw new Error(`unknown struct ${name}`);
        return s;
    }
}
/** each struct's fields by name, compiled the first time it's written (kept by its field list: a hot edit that
 *  changes a struct hands it a new one) */
const PLANS = new WeakMap();
function planOf(layout) {
    let p = PLANS.get(layout.fields);
    if (!p) {
        p = new Map();
        for (const f of layout.fields)
            if (!p.has(f.name))
                p.set(f.name, { offset: f.offset, write: writerOf(f.type, f) });
        PLANS.set(layout.fields, p);
    }
    return p;
}
function writeStruct(v, layout, base, values) {
    const plan = planOf(layout);
    for (const key in values) {
        const val = values[key];
        if (val === undefined)
            continue;
        const f = plan.get(key);
        if (!f)
            throw new Error(`struct ${layout.name} has no field '${key}' (fields: ${layout.fields.map((x) => x.name).join(', ')})`);
        f.write(v, base + f.offset, val);
    }
}
const writeF32 = (v, o, val) => { v.f32[o >> 2] = val; };
const writeU32 = (v, o, val) => { v.u32[o >> 2] = val; };
const writeI32 = (v, o, val) => { v.i32[o >> 2] = val; };
/** a vector of n components (never past the n-th: a vec3 doesn't spill into the next field), as far as `val` goes */
function vecWriter(n, kind) {
    if (kind === 'u')
        return (v, o, val) => { const a = val, t = v.u32, i = o >> 2; for (let k = 0; k < n && k < a.length; k++)
            t[i + k] = a[k]; };
    if (kind === 'i')
        return (v, o, val) => { const a = val, t = v.i32, i = o >> 2; for (let k = 0; k < n && k < a.length; k++)
            t[i + k] = a[k]; };
    return (v, o, val) => { const a = val, t = v.f32, i = o >> 2; for (let k = 0; k < n && k < a.length; k++)
        t[i + k] = a[k]; };
}
/** a matrix's floats into `t` from float index `at`: `len` of `a` from `from`, packed (cols × rows, a mat3's nine)
 *  or padded as the buffer is (each column `per` floats) */
function matInto(t, at, a, from, len, cols, rows, per) {
    if (rows === 3 && len === cols * 3) {
        for (let c = 0; c < cols; c++)
            for (let r = 0; r < 3; r++)
                t[at + c * per + r] = a[from + c * 3 + r];
        return;
    }
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            const src = c * per + r;
            if (src < len)
                t[at + c * per + r] = a[from + src];
        }
    }
}
function matWriter(cols, rows) {
    const per = rows === 2 ? 2 : 4;
    return (v, o, val) => { const a = val; matInto(v.f32, o / 4, a, 0, a.length, cols, rows, per); };
}
function arrayWriter(type) {
    const { count, stride, elem, elemStruct } = type;
    const mm = MAT.exec(elem), em = VEC.exec(elem);
    const cols = mm ? Number(mm[1]) : 0, rows = mm ? Number(mm[2]) : 0, full = cols * rows, per = rows === 2 ? 2 : 4;
    const comps = em ? Number(em[1]) : 1;
    const kind = em ? em[2] : elem[0] === 'u' ? 'u' : elem[0] === 'i' ? 'i' : 'f';
    // (an element's own writer, for elements given one by one: made when first needed)
    let one = null;
    return (v, o, val) => {
        const arr = val;
        if (!elemStruct && typeof arr[0] === 'number') {
            const nums = val;
            if (mm) {
                // a flat array of matrices, each one packed (column-major)
                const elems = count > 0 ? Math.min(count, Math.floor(nums.length / full)) : Math.floor(nums.length / full);
                for (let e = 0; e < elems; e++)
                    matInto(v.f32, (o + e * stride) / 4, nums, e * full, full, cols, rows, per);
                return;
            }
            // a flat numeric array: scalars, or vectors packed back to back
            const elems = count > 0 ? Math.min(count, Math.floor(nums.length / comps)) : Math.floor(nums.length / comps);
            if (kind === 'f' && stride === comps * 4 && nums instanceof Float32Array) {
                v.f32.set(nums.subarray(0, elems * comps), o >> 2);
                return;
            }
            const t = kind === 'u' ? v.u32 : kind === 'i' ? v.i32 : v.f32;
            for (let e = 0; e < elems; e++)
                for (let k = 0; k < comps; k++)
                    t[(o + e * stride + k * 4) >> 2] = nums[e * comps + k];
            return;
        }
        const n = count > 0 ? Math.min(count, arr.length) : arr.length;
        for (let e = 0; e < n; e++) {
            const x = arr[e];
            if (x === undefined)
                continue;
            if (elemStruct)
                writeStruct(v, v.layoutOf(elemStruct), o + e * stride, x);
            else
                (one ??= writerOf(elem, null))(v, o + e * stride, x);
        }
    };
}
/** the writers of the types that need nothing but their name (scalars, vectors, matrices), one each */
const WRITERS = new Map();
function writerOf(type, f) {
    if (type === 'array' && f?.array)
        return arrayWriter(f.array);
    if (type === 'struct' && f?.struct) {
        const name = f.struct;
        return (v, o, val) => writeStruct(v, v.layoutOf(name), o, val);
    }
    let w = WRITERS.get(type);
    if (!w) {
        const vm = VEC.exec(type), mm = MAT.exec(type);
        if (type === 'f32')
            w = writeF32;
        else if (type === 'u32' || type === 'atomic<u32>')
            w = writeU32;
        else if (type === 'i32' || type === 'atomic<i32>')
            w = writeI32;
        else if (vm)
            w = vecWriter(Number(vm[1]), vm[2]);
        else if (mm)
            w = matWriter(Number(mm[1]), Number(mm[2]));
        // (said when such a field is written, not when its struct is first used)
        else
            w = () => { throw new Error(`weft: can't write a field of type ${type}`); };
        WRITERS.set(type, w);
    }
    return w;
}
function readField(v, f, o) {
    const t = f.type;
    if (t === 'f32')
        return v.f32[o >> 2];
    if (t === 'u32')
        return v.u32[o >> 2];
    if (t === 'i32')
        return v.i32[o >> 2];
    const vm = VEC.exec(t);
    if (vm) {
        const n = Number(vm[1]);
        const arr = vm[2] === 'u' ? v.u32 : vm[2] === 'i' ? v.i32 : v.f32;
        return Array.from(arr.subarray(o >> 2, (o >> 2) + n));
    }
    const mm = MAT.exec(t);
    if (mm)
        return Array.from(v.f32.subarray(o >> 2, (o + f.size) >> 2));
    if (t === 'struct' && f.struct) {
        const l = v.layoutOf(f.struct);
        const out = {};
        for (const g of l.fields)
            out[g.name] = readField(v, g, o + g.offset);
        return out;
    }
    if (t === 'array' && f.array) {
        const out = [];
        for (let e = 0; e < f.array.count; e++) {
            if (f.array.elemStruct) {
                const l = v.layoutOf(f.array.elemStruct);
                const obj = {};
                for (const g of l.fields)
                    obj[g.name] = readField(v, g, o + e * f.array.stride + g.offset);
                out.push(obj);
            }
            else {
                out.push(readField(v, { name: '', offset: 0, size: f.array.stride, type: f.array.elem }, o + e * f.array.stride));
            }
        }
        return out;
    }
    return undefined;
}
/** an array of structs in one ArrayBuffer (instance data, particles…): `arr.set(i, { … })` */
export class StructArray {
    def;
    count;
    data;
    stride;
    view;
    constructor(def, count) {
        this.def = def;
        this.count = count;
        this.stride = Math.ceil(def.size / def.align) * def.align;
        this.data = new ArrayBuffer(Math.max(16, this.stride * count));
        this.view = new StructView(def, this.data);
    }
    get f32() { return this.view.f32; }
    get u32() { return this.view.u32; }
    set(i, values) {
        writeStruct(this.view, this.def, i * this.stride, values);
        return this;
    }
    /** byte offset of a field inside element i */
    offset(i, field) {
        const f = planOf(this.def).get(field);
        if (!f)
            throw new Error(`struct ${this.def.name} has no field '${field}'`);
        return i * this.stride + f.offset;
    }
}
//# sourceMappingURL=struct.js.map