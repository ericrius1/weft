// CPU-side views of WGSL structs, laid out from the shader's own reflection (offsets, padding, array strides), so the
// TS writer and the WGSL struct can't drift apart. `set({ field: value })` writes only the named fields; vec3s never
// spill into the next field; mat3x3f accepts 9 packed or 12 padded floats.
//
// A struct's fields are compiled once into writers (PLANS: by name, each field's offset and a function that already
// knows its type), so a set() neither searches the field list nor parses a type: an app sets its globals several
// times a frame.
import type { StructDef, FieldLayout, StructLayout } from './shader';

export type DeepPartial<T> = T extends ArrayLike<number> ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

const VEC = /^vec([234])([fiuh])$/;
const MAT = /^mat([234])x([234])([fh])$/;

export class StructView<T = Record<string, unknown>> {
  readonly data: ArrayBuffer;
  readonly f32: Float32Array;
  readonly u32: Uint32Array;
  readonly i32: Int32Array;
  constructor(readonly def: StructDef<T> | StructLayout, data?: ArrayBuffer, readonly base = 0, private structs?: Record<string, StructLayout>) {
    this.data = data ?? new ArrayBuffer(Math.max(16, Math.ceil(def.size / 16) * 16));
    this.f32 = new Float32Array(this.data);
    this.u32 = new Uint32Array(this.data);
    this.i32 = new Int32Array(this.data);
    if (!this.structs && 'shader' in def) this.structs = def.shader.reflect.structs;
  }

  /** byte offset of a top-level field */
  offset(field: keyof T & string): number {
    const f = planOf(this.def).get(field);
    if (!f) throw new Error(`struct ${this.def.name} has no field '${field}'`);
    return this.base + f.offset;
  }

  set(values: DeepPartial<T>): this {
    writeStruct(this, this.def, this.base, values as Record<string, unknown>);
    return this;
  }

  get(field: keyof T & string): unknown {
    const f = this.def.fields.find((x) => x.name === field);
    if (!f) return undefined;
    return readField(this, f, this.base + f.offset);
  }

  /** every field as a plain object (used to carry values across a hot layout change) */
  toObject(): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    for (const f of this.def.fields) o[f.name] = readField(this, f, this.base + f.offset);
    return o;
  }

  layoutOf(name: string): StructLayout {
    const s = this.structs?.[name];
    if (!s) throw new Error(`unknown struct ${name}`);
    return s;
  }
}

// ---------------------------------------------------------------- writing
/** a value into the view at byte offset `o`, as one type */
type Write = (v: StructView<unknown>, o: number, val: unknown) => void;
interface FieldPlan { offset: number; write: Write }

/** each struct's fields by name, compiled the first time it's written (kept by its field list: a hot edit that
 *  changes a struct hands it a new one) */
const PLANS = new WeakMap<FieldLayout[], Map<string, FieldPlan>>();
function planOf(layout: StructLayout): Map<string, FieldPlan> {
  let p = PLANS.get(layout.fields);
  if (!p) {
    p = new Map();
    for (const f of layout.fields) if (!p.has(f.name)) p.set(f.name, { offset: f.offset, write: writerOf(f.type, f) });
    PLANS.set(layout.fields, p);
  }
  return p;
}

function writeStruct(v: StructView<unknown>, layout: StructLayout, base: number, values: Record<string, unknown>) {
  const plan = planOf(layout);
  for (const key in values) {
    const val = values[key];
    if (val === undefined) continue;
    const f = plan.get(key);
    if (!f) throw new Error(`struct ${layout.name} has no field '${key}' (fields: ${layout.fields.map((x) => x.name).join(', ')})`);
    f.write(v, base + f.offset, val);
  }
}

const writeF32: Write = (v, o, val) => { v.f32[o >> 2] = val as number; };
const writeU32: Write = (v, o, val) => { v.u32[o >> 2] = val as number; };
const writeI32: Write = (v, o, val) => { v.i32[o >> 2] = val as number; };

/** a vector of n components (never past the n-th: a vec3 doesn't spill into the next field), as far as `val` goes */
function vecWriter(n: number, kind: string): Write {
  if (kind === 'u') return (v, o, val) => { const a = val as ArrayLike<number>, t = v.u32, i = o >> 2; for (let k = 0; k < n && k < a.length; k++) t[i + k] = a[k]; };
  if (kind === 'i') return (v, o, val) => { const a = val as ArrayLike<number>, t = v.i32, i = o >> 2; for (let k = 0; k < n && k < a.length; k++) t[i + k] = a[k]; };
  return (v, o, val) => { const a = val as ArrayLike<number>, t = v.f32, i = o >> 2; for (let k = 0; k < n && k < a.length; k++) t[i + k] = a[k]; };
}

/** a matrix's floats into `t` from float index `at`: `len` of `a` from `from`, packed (cols × rows, a mat3's nine)
 *  or padded as the buffer is (each column `per` floats) */
function matInto(t: Float32Array, at: number, a: ArrayLike<number>, from: number, len: number, cols: number, rows: number, per: number) {
  if (rows === 3 && len === cols * 3) {
    for (let c = 0; c < cols; c++) for (let r = 0; r < 3; r++) t[at + c * per + r] = a[from + c * 3 + r];
    return;
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const src = c * per + r;
      if (src < len) t[at + c * per + r] = a[from + src];
    }
  }
}
function matWriter(cols: number, rows: number): Write {
  const per = rows === 2 ? 2 : 4;
  return (v, o, val) => { const a = val as ArrayLike<number>; matInto(v.f32, o / 4, a, 0, a.length, cols, rows, per); };
}

function arrayWriter(type: NonNullable<FieldLayout['array']>): Write {
  const { count, stride, elem, elemStruct } = type;
  const mm = MAT.exec(elem), em = VEC.exec(elem);
  const cols = mm ? Number(mm[1]) : 0, rows = mm ? Number(mm[2]) : 0, full = cols * rows, per = rows === 2 ? 2 : 4;
  const comps = em ? Number(em[1]) : 1;
  const kind = em ? em[2] : elem[0] === 'u' ? 'u' : elem[0] === 'i' ? 'i' : 'f';
  // (an element's own writer, for elements given one by one: made when first needed)
  let one: Write | null = null;
  return (v, o, val) => {
    const arr = val as ArrayLike<unknown>;
    if (!elemStruct && typeof arr[0] === 'number') {
      const nums = val as ArrayLike<number>;
      if (mm) {
        // a flat array of matrices, each one packed (column-major)
        const elems = count > 0 ? Math.min(count, Math.floor(nums.length / full)) : Math.floor(nums.length / full);
        for (let e = 0; e < elems; e++) matInto(v.f32, (o + e * stride) / 4, nums, e * full, full, cols, rows, per);
        return;
      }
      // a flat numeric array: scalars, or vectors packed back to back
      const elems = count > 0 ? Math.min(count, Math.floor(nums.length / comps)) : Math.floor(nums.length / comps);
      if (kind === 'f' && stride === comps * 4 && nums instanceof Float32Array) { v.f32.set(nums.subarray(0, elems * comps), o >> 2); return; }
      const t = kind === 'u' ? v.u32 : kind === 'i' ? v.i32 : v.f32;
      for (let e = 0; e < elems; e++) for (let k = 0; k < comps; k++) t[(o + e * stride + k * 4) >> 2] = nums[e * comps + k];
      return;
    }
    const n = count > 0 ? Math.min(count, arr.length) : arr.length;
    for (let e = 0; e < n; e++) {
      const x = arr[e];
      if (x === undefined) continue;
      if (elemStruct) writeStruct(v, v.layoutOf(elemStruct), o + e * stride, x as Record<string, unknown>);
      else (one ??= writerOf(elem, null))(v, o + e * stride, x);
    }
  };
}

/** the writers of the types that need nothing but their name (scalars, vectors, matrices), one each */
const WRITERS = new Map<string, Write>();
function writerOf(type: string, f: FieldLayout | null): Write {
  if (type === 'array' && f?.array) return arrayWriter(f.array);
  if (type === 'struct' && f?.struct) {
    const name = f.struct;
    return (v, o, val) => writeStruct(v, v.layoutOf(name), o, val as Record<string, unknown>);
  }
  let w = WRITERS.get(type);
  if (!w) {
    const vm = VEC.exec(type), mm = MAT.exec(type);
    if (type === 'f32') w = writeF32;
    else if (type === 'u32' || type === 'atomic<u32>') w = writeU32;
    else if (type === 'i32' || type === 'atomic<i32>') w = writeI32;
    else if (vm) w = vecWriter(Number(vm[1]), vm[2]);
    else if (mm) w = matWriter(Number(mm[1]), Number(mm[2]));
    // (said when such a field is written, not when its struct is first used)
    else w = () => { throw new Error(`weft: can't write a field of type ${type}`); };
    WRITERS.set(type, w);
  }
  return w;
}

function readField(v: StructView<unknown>, f: FieldLayout, o: number): unknown {
  const t = f.type;
  if (t === 'f32') return v.f32[o >> 2];
  if (t === 'u32') return v.u32[o >> 2];
  if (t === 'i32') return v.i32[o >> 2];
  const vm = VEC.exec(t);
  if (vm) {
    const n = Number(vm[1]);
    const arr = vm[2] === 'u' ? v.u32 : vm[2] === 'i' ? v.i32 : v.f32;
    return Array.from(arr.subarray(o >> 2, (o >> 2) + n));
  }
  const mm = MAT.exec(t);
  if (mm) return Array.from(v.f32.subarray(o >> 2, (o + f.size) >> 2));
  if (t === 'struct' && f.struct) {
    const l = v.layoutOf(f.struct);
    const out: Record<string, unknown> = {};
    for (const g of l.fields) out[g.name] = readField(v, g, o + g.offset);
    return out;
  }
  if (t === 'array' && f.array) {
    const out: unknown[] = [];
    for (let e = 0; e < f.array.count; e++) {
      if (f.array.elemStruct) {
        const l = v.layoutOf(f.array.elemStruct);
        const obj: Record<string, unknown> = {};
        for (const g of l.fields) obj[g.name] = readField(v, g, o + e * f.array.stride + g.offset);
        out.push(obj);
      } else {
        out.push(readField(v, { name: '', offset: 0, size: f.array.stride, type: f.array.elem }, o + e * f.array.stride));
      }
    }
    return out;
  }
  return undefined;
}

/** an array of structs in one ArrayBuffer (instance data, particles…): `arr.set(i, { … })` */
export class StructArray<T = Record<string, unknown>> {
  readonly data: ArrayBuffer;
  readonly stride: number;
  private view: StructView<T>;
  constructor(readonly def: StructDef<T>, readonly count: number) {
    this.stride = Math.ceil(def.size / def.align) * def.align;
    this.data = new ArrayBuffer(Math.max(16, this.stride * count));
    this.view = new StructView(def, this.data);
  }
  get f32() { return this.view.f32; }
  get u32() { return this.view.u32; }
  set(i: number, values: DeepPartial<T>) {
    writeStruct(this.view as StructView<unknown>, this.def, i * this.stride, values as Record<string, unknown>);
    return this;
  }
  /** byte offset of a field inside element i */
  offset(i: number, field: keyof T & string) {
    const f = planOf(this.def).get(field);
    if (!f) throw new Error(`struct ${this.def.name} has no field '${field}'`);
    return i * this.stride + f.offset;
  }
}
