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
    planFields = null;
    plan = null;
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
    getPlan() {
        if (this.planFields !== this.def.fields || !this.plan) {
            this.planFields = this.def.fields;
            this.plan = planOf(this.def);
        }
        return this.plan;
    }
    /** byte offset of a top-level field */
    offset(field) {
        const f = this.getPlan()[field];
        if (!f)
            throw new Error(`struct ${this.def.name} has no field '${field}'`);
        return this.base + f.offset;
    }
    set(values) {
        writeStructWithPlan(this, this.def, this.getPlan(), this.base, values);
        return this;
    }
    /** write fields like set(), returning true if any 32-bit word changed its bit pattern */
    setChanged(values) {
        return writeStructWithPlan(this, this.def, this.getPlan(), this.base, values);
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
        p = Object.create(null);
        for (let i = 0; i < layout.fields.length; i++) {
            const f = layout.fields[i];
            if (!(f.name in p))
                p[f.name] = { offset: f.offset, write: writerOf(f.type, f) };
        }
        PLANS.set(layout.fields, p);
    }
    return p;
}
function writeStructWithPlan(v, layout, plan, base, values) {
    let changed = false;
    for (const key in values) {
        const val = values[key];
        if (val === undefined)
            continue;
        const f = plan[key];
        if (!f)
            throw new Error(`struct ${layout.name} has no field '${key}' (fields: ${layout.fields.map((x) => x.name).join(', ')})`);
        if (f.write(v, base + f.offset, val))
            changed = true;
    }
    return changed;
}
function writeStruct(v, layout, base, values) {
    return writeStructWithPlan(v, layout, planOf(layout), base, values);
}
const writeF32 = (v, o, val) => {
    const i = o >> 2, u = v.u32, prev = u[i];
    v.f32[i] = val;
    return u[i] !== prev;
};
const writeU32 = (v, o, val) => {
    const i = o >> 2, u = v.u32, prev = u[i];
    u[i] = val;
    return u[i] !== prev;
};
const writeI32 = (v, o, val) => {
    const i = o >> 2, t = v.i32, prev = t[i];
    t[i] = val;
    return t[i] !== prev;
};
/** a vector of n components (never past the n-th: a vec3 doesn't spill into the next field), as far as `val` goes */
function vecWriter(n, kind) {
    if (kind === 'u') {
        return (v, o, val) => {
            const a = val, al = a.length | 0, t = v.u32, i = o >> 2, lim = al < n ? al : n;
            let ch = false;
            for (let k = 0; k < lim; k++) {
                const idx = i + k, p = t[idx];
                t[idx] = a[k];
                if (t[idx] !== p)
                    ch = true;
            }
            return ch;
        };
    }
    if (kind === 'i') {
        return (v, o, val) => {
            const a = val, al = a.length | 0, t = v.i32, i = o >> 2, lim = al < n ? al : n;
            let ch = false;
            for (let k = 0; k < lim; k++) {
                const idx = i + k, p = t[idx];
                t[idx] = a[k];
                if (t[idx] !== p)
                    ch = true;
            }
            return ch;
        };
    }
    if (n === 2) {
        return (v, o, val) => {
            const a = val, len = a.length | 0, f = v.f32, u = v.u32, i = o >> 2;
            if (len >= 2) {
                const p0 = u[i], p1 = u[i + 1];
                f[i] = a[0];
                f[i + 1] = a[1];
                return u[i] !== p0 || u[i + 1] !== p1;
            }
            if (len === 1) {
                const p0 = u[i];
                f[i] = a[0];
                return u[i] !== p0;
            }
            return false;
        };
    }
    if (n === 3) {
        return (v, o, val) => {
            const a = val, len = a.length | 0, f = v.f32, u = v.u32, i = o >> 2;
            if (len >= 3) {
                const p0 = u[i], p1 = u[i + 1], p2 = u[i + 2];
                f[i] = a[0];
                f[i + 1] = a[1];
                f[i + 2] = a[2];
                return u[i] !== p0 || u[i + 1] !== p1 || u[i + 2] !== p2;
            }
            let ch = false;
            for (let k = 0; k < len; k++) {
                const idx = i + k, p = u[idx];
                f[idx] = a[k];
                if (u[idx] !== p)
                    ch = true;
            }
            return ch;
        };
    }
    if (n === 4) {
        return (v, o, val) => {
            const a = val, len = a.length | 0, f = v.f32, u = v.u32, i = o >> 2;
            if (len >= 4) {
                const p0 = u[i], p1 = u[i + 1], p2 = u[i + 2], p3 = u[i + 3];
                f[i] = a[0];
                f[i + 1] = a[1];
                f[i + 2] = a[2];
                f[i + 3] = a[3];
                return u[i] !== p0 || u[i + 1] !== p1 || u[i + 2] !== p2 || u[i + 3] !== p3;
            }
            let ch = false;
            for (let k = 0; k < len; k++) {
                const idx = i + k, p = u[idx];
                f[idx] = a[k];
                if (u[idx] !== p)
                    ch = true;
            }
            return ch;
        };
    }
    return (v, o, val) => {
        const a = val, al = a.length | 0, f = v.f32, u = v.u32, i = o >> 2, lim = al < n ? al : n;
        let ch = false;
        for (let k = 0; k < lim; k++) {
            const idx = i + k, p = u[idx];
            f[idx] = a[k];
            if (u[idx] !== p)
                ch = true;
        }
        return ch;
    };
}
/** a matrix's floats into `t` from float index `at`: `len` of `a` from `from`, packed (cols × rows, a mat3's nine)
 *  or padded as the buffer is (each column `per` floats) */
function matInto(t, u, at, a, from, len, cols, rows, per) {
    let ch = false;
    if (rows === 3 && len === cols * 3) {
        for (let c = 0; c < cols; c++) {
            const dst = at + c * per, src = from + c * 3;
            for (let r = 0; r < 3; r++) {
                const idx = dst + r, p = u[idx];
                t[idx] = a[src + r];
                if (u[idx] !== p)
                    ch = true;
            }
        }
        return ch;
    }
    for (let c = 0; c < cols; c++) {
        const col = c * per;
        for (let r = 0; r < rows; r++) {
            const src = col + r;
            if (src < len) {
                const idx = at + src, p = u[idx];
                t[idx] = a[from + src];
                if (u[idx] !== p)
                    ch = true;
            }
        }
    }
    return ch;
}
function matWriter(cols, rows) {
    if (cols === 4 && rows === 4) {
        return (v, o, val) => {
            const a = val, al = a.length | 0, f = v.f32, u = v.u32, i = o >> 2, lim = al < 16 ? al : 16;
            let ch = false;
            for (let k = 0; k < lim; k++) {
                const idx = i + k, p = u[idx];
                f[idx] = a[k];
                if (u[idx] !== p)
                    ch = true;
            }
            return ch;
        };
    }
    const per = rows === 2 ? 2 : 4;
    return (v, o, val) => { const a = val; return matInto(v.f32, v.u32, o >> 2, a, 0, a.length | 0, cols, rows, per); };
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
        let ch = false;
        if (!elemStruct && typeof arr[0] === 'number') {
            const nums = val;
            if (mm) {
                // a flat array of matrices, each one packed (column-major)
                const elems = count > 0 ? Math.min(count, Math.floor(nums.length / full)) : Math.floor(nums.length / full);
                for (let e = 0; e < elems; e++)
                    if (matInto(v.f32, v.u32, (o + e * stride) >> 2, nums, e * full, full, cols, rows, per))
                        ch = true;
                return ch;
            }
            // a flat numeric array: scalars, or vectors packed back to back
            const elems = count > 0 ? Math.min(count, Math.floor(nums.length / comps)) : Math.floor(nums.length / comps);
            if (kind === 'f' && stride === comps * 4 && nums instanceof Float32Array) {
                const start = o >> 2, total = elems * comps;
                if (start + total > v.f32.length) {
                    v.f32.set(nums.subarray(0, total), start);
                    return true;
                }
                const f = v.f32, u = v.u32;
                for (let k = 0; k < total; k++) {
                    const idx = start + k, p = u[idx];
                    f[idx] = nums[k];
                    if (u[idx] !== p)
                        ch = true;
                }
                return ch;
            }
            if (kind === 'u') {
                const t = v.u32;
                for (let e = 0; e < elems; e++) {
                    const base = (o + e * stride) >> 2, src = e * comps;
                    for (let k = 0; k < comps; k++) {
                        const idx = base + k, p = t[idx];
                        t[idx] = nums[src + k];
                        if (t[idx] !== p)
                            ch = true;
                    }
                }
            }
            else if (kind === 'i') {
                const t = v.i32;
                for (let e = 0; e < elems; e++) {
                    const base = (o + e * stride) >> 2, src = e * comps;
                    for (let k = 0; k < comps; k++) {
                        const idx = base + k, p = t[idx];
                        t[idx] = nums[src + k];
                        if (t[idx] !== p)
                            ch = true;
                    }
                }
            }
            else {
                const f = v.f32, u = v.u32;
                for (let e = 0; e < elems; e++) {
                    const base = (o + e * stride) >> 2, src = e * comps;
                    for (let k = 0; k < comps; k++) {
                        const idx = base + k, p = u[idx];
                        f[idx] = nums[src + k];
                        if (u[idx] !== p)
                            ch = true;
                    }
                }
            }
            return ch;
        }
        const n = count > 0 ? Math.min(count, arr.length) : arr.length;
        for (let e = 0; e < n; e++) {
            const x = arr[e];
            if (x === undefined)
                continue;
            if (elemStruct) {
                if (writeStruct(v, v.layoutOf(elemStruct), o + e * stride, x))
                    ch = true;
            }
            else if ((one ??= writerOf(elem, null))(v, o + e * stride, x))
                ch = true;
        }
        return ch;
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
        const f = planOf(this.def)[field];
        if (!f)
            throw new Error(`struct ${this.def.name} has no field '${field}'`);
        return i * this.stride + f.offset;
    }
}
//# sourceMappingURL=struct.js.map