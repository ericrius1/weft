// CPU-side views of WGSL structs, laid out from the shader's own reflection (offsets, padding, array strides), so the
// TS writer and the WGSL struct can't drift apart. `set({ field: value })` writes only the named fields; vec3s never
// spill into the next field; mat3x3f accepts 9 packed or 12 padded floats.
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
    const f = this.def.fields.find((x) => x.name === field);
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

function writeStruct(v: StructView<unknown>, layout: StructLayout, base: number, values: Record<string, unknown>) {
  for (const key in values) {
    const val = values[key];
    if (val === undefined) continue;
    const f = layout.fields.find((x) => x.name === key);
    if (!f) throw new Error(`struct ${layout.name} has no field '${key}' (fields: ${layout.fields.map((x) => x.name).join(', ')})`);
    writeField(v, f.type, f, base + f.offset, val);
  }
}

function writeScalar(v: StructView<unknown>, kind: string, byteOffset: number, x: number) {
  const i = byteOffset >> 2;
  if (kind === 'u') v.u32[i] = x;
  else if (kind === 'i') v.i32[i] = x;
  else v.f32[i] = x;
}

function writeField(v: StructView<unknown>, type: string, f: FieldLayout | null, o: number, val: unknown) {
  if (type === 'f32') { v.f32[o >> 2] = val as number; return; }
  if (type === 'u32' || type === 'atomic<u32>') { v.u32[o >> 2] = val as number; return; }
  if (type === 'i32' || type === 'atomic<i32>') { v.i32[o >> 2] = val as number; return; }
  const vm = VEC.exec(type);
  if (vm) {
    const n = Number(vm[1]), a = val as ArrayLike<number>;
    for (let k = 0; k < n && k < a.length; k++) writeScalar(v, vm[2], o + k * 4, a[k]);
    return;
  }
  const mm = MAT.exec(type);
  if (mm) {
    const cols = Number(mm[1]), rows = Number(mm[2]), a = val as ArrayLike<number>;
    const colStride = rows === 2 ? 8 : 16;
    const packed = a.length === cols * rows && rows === 3;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const src = packed ? c * rows + r : c * (colStride / 4) + r;
        if (src < a.length) v.f32[(o + c * colStride) / 4 + r] = a[src];
      }
    }
    return;
  }
  if (type === 'array' && f?.array) {
    const { count, stride, elem, elemStruct } = f.array;
    const arr = val as ArrayLike<unknown>;
    const n = count > 0 ? Math.min(count, arr.length) : arr.length;
    if (!elemStruct && typeof arr[0] === 'number' && MAT.test(elem)) {
      // a flat array of matrices, each one packed (column-major)
      const mm = MAT.exec(elem)!;
      const per = Number(mm[1]) * Number(mm[2]);
      const nums = val as ArrayLike<number>;
      const elems = count > 0 ? Math.min(count, Math.floor(nums.length / per)) : Math.floor(nums.length / per);
      for (let e = 0; e < elems; e++) writeField(v, elem, null, o + e * stride, Array.prototype.slice.call(nums, e * per, e * per + per));
      return;
    }
    if (!elemStruct && typeof arr[0] === 'number') {
      // a flat numeric array: scalars, or vectors packed back to back
      const em = VEC.exec(elem);
      const comps = em ? Number(em[1]) : 1;
      const kind = em ? em[2] : elem[0] === 'u' ? 'u' : elem[0] === 'i' ? 'i' : 'f';
      const nums = val as ArrayLike<number>;
      const elems = count > 0 ? Math.min(count, Math.floor(nums.length / comps)) : Math.floor(nums.length / comps);
      if (kind === 'f' && stride === comps * 4 && nums instanceof Float32Array) { v.f32.set(nums.subarray(0, elems * comps), o >> 2); return; }
      for (let e = 0; e < elems; e++) for (let k = 0; k < comps; k++) writeScalar(v, kind, o + e * stride + k * 4, nums[e * comps + k]);
      return;
    }
    for (let e = 0; e < n; e++) {
      const x = arr[e];
      if (x === undefined) continue;
      if (elemStruct) writeStruct(v, v.layoutOf(elemStruct), o + e * stride, x as Record<string, unknown>);
      else writeField(v, elem, null, o + e * stride, x);
    }
    return;
  }
  if (type === 'struct' && f?.struct) { writeStruct(v, v.layoutOf(f.struct), o, val as Record<string, unknown>); return; }
  throw new Error(`weft: can't write a field of type ${type}`);
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
    const f = this.def.fields.find((x) => x.name === field);
    if (!f) throw new Error(`struct ${this.def.name} has no field '${field}'`);
    return i * this.stride + f.offset;
  }
}
