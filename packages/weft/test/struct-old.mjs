// The struct writer as it was up to weft 0.2.12 (src/struct.ts: a search of the field list for every key, a type
// parsed for every vector and matrix), kept as written, types taken off: what struct.test.mjs holds the compiled
// writers to, bit for bit. `v` is a StructView (its f32, u32, i32 and layoutOf).
const VEC = /^vec([234])([fiuh])$/;
const MAT = /^mat([234])x([234])([fh])$/;

export function writeStruct(v, layout, base, values) {
  for (const key in values) {
    const val = values[key];
    if (val === undefined) continue;
    const f = layout.fields.find((x) => x.name === key);
    if (!f) throw new Error(`struct ${layout.name} has no field '${key}' (fields: ${layout.fields.map((x) => x.name).join(', ')})`);
    writeField(v, f.type, f, base + f.offset, val);
  }
}

function writeScalar(v, kind, byteOffset, x) {
  const i = byteOffset >> 2;
  if (kind === 'u') v.u32[i] = x;
  else if (kind === 'i') v.i32[i] = x;
  else v.f32[i] = x;
}

function writeField(v, type, f, o, val) {
  if (type === 'f32') { v.f32[o >> 2] = val; return; }
  if (type === 'u32' || type === 'atomic<u32>') { v.u32[o >> 2] = val; return; }
  if (type === 'i32' || type === 'atomic<i32>') { v.i32[o >> 2] = val; return; }
  const vm = VEC.exec(type);
  if (vm) {
    const n = Number(vm[1]), a = val;
    for (let k = 0; k < n && k < a.length; k++) writeScalar(v, vm[2], o + k * 4, a[k]);
    return;
  }
  const mm = MAT.exec(type);
  if (mm) {
    const cols = Number(mm[1]), rows = Number(mm[2]), a = val;
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
    const arr = val;
    const n = count > 0 ? Math.min(count, arr.length) : arr.length;
    if (!elemStruct && typeof arr[0] === 'number' && MAT.test(elem)) {
      // a flat array of matrices, each one packed (column-major)
      const mm = MAT.exec(elem);
      const per = Number(mm[1]) * Number(mm[2]);
      const nums = val;
      const elems = count > 0 ? Math.min(count, Math.floor(nums.length / per)) : Math.floor(nums.length / per);
      for (let e = 0; e < elems; e++) writeField(v, elem, null, o + e * stride, Array.prototype.slice.call(nums, e * per, e * per + per));
      return;
    }
    if (!elemStruct && typeof arr[0] === 'number') {
      // a flat numeric array: scalars, or vectors packed back to back
      const em = VEC.exec(elem);
      const comps = em ? Number(em[1]) : 1;
      const kind = em ? em[2] : elem[0] === 'u' ? 'u' : elem[0] === 'i' ? 'i' : 'f';
      const nums = val;
      const elems = count > 0 ? Math.min(count, Math.floor(nums.length / comps)) : Math.floor(nums.length / comps);
      if (kind === 'f' && stride === comps * 4 && nums instanceof Float32Array) { v.f32.set(nums.subarray(0, elems * comps), o >> 2); return; }
      for (let e = 0; e < elems; e++) for (let k = 0; k < comps; k++) writeScalar(v, kind, o + e * stride + k * 4, nums[e * comps + k]);
      return;
    }
    for (let e = 0; e < n; e++) {
      const x = arr[e];
      if (x === undefined) continue;
      if (elemStruct) writeStruct(v, v.layoutOf(elemStruct), o + e * stride, x);
      else writeField(v, elem, null, o + e * stride, x);
    }
    return;
  }
  if (type === 'struct' && f?.struct) { writeStruct(v, v.layoutOf(f.struct), o, val); return; }
  throw new Error(`weft: can't write a field of type ${type}`);
}
