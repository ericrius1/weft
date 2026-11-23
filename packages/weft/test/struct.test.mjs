// The struct writer (struct.ts): each struct's fields compiled once into writers. What it writes must be what the
// writer before it wrote (struct-old.mjs, kept as it was), bit for bit, for every field type and every shape of value
// a field takes: checked on a struct with them all, case by case and with a few thousand seeded random partial sets.
// Without a GPU. Run with `npm test` after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { writeStruct as writeOld } from './struct-old.mjs';

register('./hooks.mjs', import.meta.url);
const { StructView, StructArray } = await import('../dist/src/struct.js');
const { defineShader } = await import('../dist/src/shader.js');
const { reflectWgsl } = await import('../dist/plugin/wgsl.js');

const EVERY = `
struct Inner { tint: vec3f, gain: f32, id: u32, cell: vec2i, m: mat3x3f }
struct Outer { inner: Inner, list: array<Inner, 2>, k: f32, at: vec3u }
struct All {
  f: f32, u: u32, i: i32,
  v2: vec2f, v3: vec3f, v4: vec4f,
  i2: vec2i, i3: vec3i, i4: vec4i,
  u2: vec2u, u3: vec3u, u4: vec4u,
  m22: mat2x2f, m23: mat2x3f, m24: mat2x4f,
  m32: mat3x2f, m33: mat3x3f, m34: mat3x4f,
  m42: mat4x2f, m43: mat4x3f, m44: mat4x4f,
  af: array<f32, 5>, au: array<u32, 3>, ai: array<i32, 3>,
  av2: array<vec2f, 3>, av3: array<vec3f, 3>, av4: array<vec4f, 3>,
  au3: array<vec3u, 2>, ai4: array<vec4i, 2>,
  am22: array<mat2x2f, 2>, am33: array<mat3x3f, 2>, am44: array<mat4x4f, 2>, am43: array<mat4x3f, 2>,
  inner: Inner,
  list: array<Inner, 3>,
  deep: Outer,
  tail: f32,
}
struct Cell { hits: atomic<u32>, n: atomic<i32>, w: f32, pos: vec3f }
struct Pool { count: u32, cells: array<Cell, 4>, free: array<vec4f> }
@group(0) @binding(0) var<uniform> all: All;
@group(0) @binding(1) var<storage, read_write> pool: Pool;
@compute @workgroup_size(1) fn main() { let a = all.f; atomicStore(&pool.cells[0].hits, u32(a) + arrayLength(&pool.free)); }`;

const reflect = reflectWgsl(EVERY);
const S = reflect.structs;

test('the struct under test has every field type', () => {
  const types = new Set();
  for (const s of Object.values(S)) for (const f of s.fields) types.add(f.type === 'array' ? `array<${f.array.elem}>` : f.type);
  for (const t of ['f32', 'u32', 'i32', 'atomic<u32>', 'atomic<i32>', 'struct', 'array<struct>', 'array<f32>', 'array<u32>', 'array<i32>',
    ...['f', 'i', 'u'].flatMap((k) => [2, 3, 4].map((n) => `vec${n}${k}`)),
    ...[2, 3, 4].flatMap((c) => [2, 3, 4].map((r) => `mat${c}x${r}f`)),
    'array<vec2f>', 'array<vec3f>', 'array<vec4f>', 'array<vec3u>', 'array<vec4i>', 'array<mat2x2f>', 'array<mat3x3f>', 'array<mat4x4f>', 'array<mat4x3f>']) {
    assert.ok(types.has(t), `no field of type ${t} (has: ${[...types].join(' ')})`);
  }
  // (the runtime-sized array: count 0)
  assert.equal(S.Pool.fields.find((f) => f.name === 'free').array.count, 0);
});

// ---- a seeded random (mulberry32), and values of every shape a field takes
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ODD = [0, -0, 1, -1, 0.1, 1 / 3, 1e-40, 3.4e38, 1e39, -1e39, 4294967295, 4294967296, -2147483648, 2147483648, 2.5, -2.5, NaN, Infinity, -Infinity, 16777217];
function num(r) { return r() < 0.25 ? ODD[Math.floor(r() * ODD.length)] : (r() - 0.5) * (r() < 0.5 ? 10 : 1e6); }
/** `n` numbers as a plain array or one of the typed arrays */
function nums(r, n) {
  const a = Array.from({ length: n }, () => num(r));
  const k = Math.floor(r() * 6);
  return k === 0 ? new Float32Array(a) : k === 1 ? new Float64Array(a) : k === 2 ? new Int32Array(a) : k === 3 ? new Uint32Array(a) : a;
}
const VEC = /^vec([234])/, MAT = /^mat([234])x([234])/;
const pick = (r, list) => list[Math.floor(r() * list.length)];
function valueOf(r, type, f, depth = 0) {
  if (type === 'f32' || type === 'u32' || type === 'i32' || type.startsWith('atomic')) return num(r);
  const vm = VEC.exec(type);
  if (vm) { const n = +vm[1]; return nums(r, pick(r, [n, n, n, n - 1, n + 1, n + 3, 0])); }
  const mm = MAT.exec(type);
  if (mm) { const c = +mm[1], rows = +mm[2], per = rows === 2 ? 2 : 4; return nums(r, pick(r, [c * rows, c * rows, c * per, c * per, c * per - 1, c * rows - 2, c * per + 5, 1, 0])); }
  if (type === 'struct') return partial(r, S[f.struct], depth + 1);
  if (type === 'array') {
    const { count, elem, elemStruct } = f.array, n = count || 6;
    const len = pick(r, [n, n, n - 1, n + 2, 1, 0]);
    if (elemStruct) return Array.from({ length: len }, () => (r() < 0.2 ? undefined : partial(r, S[elemStruct], depth + 1)));
    const em = VEC.exec(elem), xm = MAT.exec(elem);
    const comps = em ? +em[1] : xm ? +xm[1] * +xm[2] : 1;
    // (flat: all the elements' numbers back to back, a whole number of them or not; or the elements one by one)
    if (r() < 0.6) return nums(r, pick(r, [n * comps, n * comps, n * comps - 1, n * comps + comps, comps, n * comps + 1]));
    return Array.from({ length: len }, () => (r() < 0.15 ? undefined : valueOf(r, elem, null, depth + 1)));
  }
  throw new Error(`no value for ${type}`);
}
function partial(r, layout, depth = 0) {
  const o = {}, share = depth ? 0.6 : 0.35;
  for (const f of layout.fields) {
    if (r() > share) continue;
    o[f.name] = r() < 0.05 ? undefined : valueOf(r, f.type, f, depth);
  }
  return o;
}

/** the same bytes (a seeded noise, so what a write leaves alone shows too) under both writers, then `values` set
 *  through each at `base`: the two buffers */
function both(layout, values, seed, base = 0) {
  // (room past the struct for a runtime-sized array's elements; a flat one longer than that throws, under both)
  const size = Math.ceil((base + layout.size + 96) / 16) * 16, r = rng(seed ^ 0x9e3779b9);
  const noise = new Uint8Array(size).map(() => Math.floor(r() * 256));
  const a = noise.slice().buffer, b = noise.slice().buffer;
  const said = (fn) => { try { fn(); } catch (e) { return `${e.name}: ${e.message}`; } return null; };
  const now = said(() => new StructView(layout, a, base, S).set(values));
  const was = said(() => writeOld(new StructView(layout, b, base, S), layout, base, values));
  return [new Uint8Array(a), new Uint8Array(b), noise, now, was];
}
const same = (layout, values, seed = 1, base = 0) => {
  const [a, b, noise, now, was] = both(layout, values, seed, base);
  assert.equal(now, was);
  assert.deepEqual(a, b);
  return { bytes: a, touched: a.some((x, i) => x !== noise[i]), threw: !!now };
};

test('each field type, given whole: the same bytes as the writer before', () => {
  const r = rng(7);
  for (const layout of [S.All, S.Inner, S.Outer, S.Cell, S.Pool]) {
    for (const f of layout.fields) {
      for (let k = 0; k < 40; k++) same(layout, { [f.name]: valueOf(r, f.type, f) }, k);
    }
  }
});

test('the shapes that matter by name', () => {
  const m9 = [1, 2, 3, 4, 5, 6, 7, 8, 9], m12 = [1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0];
  // (a mat3x3f from nine packed floats or twelve padded: the same bytes either way)
  assert.deepEqual(same(S.All, { m33: m9 }).bytes, same(S.All, { m33: m12 }).bytes);
  assert.deepEqual(same(S.All, { m33: new Float32Array(m9) }).bytes, same(S.All, { m33: m12 }).bytes);
  // (a vec3 never spills into the next field, a short one leaves the rest)
  const v = new StructView(S.All, undefined, 0, S).set({ v4: [9, 9, 9, 9], v3: [1, 2, 3, 4, 5] });
  assert.deepEqual(v.get('v3'), [1, 2, 3]);
  assert.deepEqual(v.get('v4'), [9, 9, 9, 9]);
  v.set({ v4: [7, 7] });
  assert.deepEqual(v.get('v4'), [7, 7, 9, 9]);
  // (integers through their own arrays)
  v.set({ u: 4294967295, i: -5, u3: [1, 2, 4294967295], i4: [-1, -2, -3, -4] });
  assert.deepEqual([v.get('u'), v.get('i'), v.get('u3'), v.get('i4')], [4294967295, -5, [1, 2, 4294967295], [-1, -2, -3, -4]]);
  // (nested partials, an array of structs with a hole, a flat array of vec3s at their 16-byte stride)
  same(S.All, { inner: { gain: 2 }, deep: { inner: { tint: [1, 2, 3] }, list: [undefined, { id: 7, m: m9 }], at: [1, 2, 3] } });
  same(S.All, { list: [{ gain: 1 }, undefined, { cell: [3, -4] }, { gain: 99 }] });
  same(S.All, { av3: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), av4: new Float32Array(16).fill(2), af: new Float32Array([1, 2, 3, 4, 5, 6, 7]) });
  same(S.All, { am44: new Float32Array(32).map((_, i) => i), am33: Array.from({ length: 18 }, (_, i) => i), am43: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]] });
  // (undefined is skipped, and so is everything when nothing is given; nothing else is touched)
  assert.equal(same(S.All, { f: undefined, v3: undefined, inner: undefined }).touched, false);
  assert.equal(same(S.All, {}).touched, false);
  // (a storage struct: atomics, an array of structs, the runtime-sized tail)
  same(S.Pool, { count: 3, cells: [{ hits: 1, n: -1, w: 0.5, pos: [1, 2, 3] }, undefined, { hits: 4294967295 }], free: new Float32Array(24).fill(1.5) });
  same(S.Pool, { free: [[1, 2, 3, 4], undefined, [5, 6]] });
});

test('a few thousand random partial sets, at an offset too: the same bytes', () => {
  const r = rng(20261123);
  let touched = 0, threw = 0;
  for (let k = 0; k < 4000; k++) {
    const layout = pick(r, [S.All, S.All, S.All, S.Outer, S.Inner, S.Pool, S.Cell]);
    const base = r() < 0.3 ? 16 * Math.floor(r() * 5) : 0;
    const got = same(layout, partial(r, layout), k, base);
    if (got.touched) touched++;
    if (got.threw) threw++;
  }
  assert.ok(touched > 3000, `only ${touched} of the sets wrote anything`);
  // (the few that threw: a flat array longer than the room after a runtime-sized one, the same error from both)
  assert.ok(threw < 200, `${threw} of the sets threw`);
});

test('what it refuses, it refuses in the same words', () => {
  const view = () => new StructView(S.All, undefined, 0, S);
  const said = (fn) => { try { fn(); } catch (e) { return e.message; } return null; };
  for (const values of [{ nope: 1 }, { f: 1, inner: { nope: 2 } }, { list: [{ gain: 1 }, { nope: 3 }] }, { deep: { list: [{ wrong: 1 }] } }]) {
    const now = said(() => view().set(values)), was = said(() => writeOld(view(), S.All, 0, values));
    assert.ok(was && /has no field/.test(was));
    assert.equal(now, was);
  }
  // (a type it can't write: said when that field is written, and only then)
  const odd = { name: 'Odd', size: 16, align: 4, fields: [{ name: 'ok', offset: 0, size: 4, type: 'f32' }, { name: 'flag', offset: 4, size: 4, type: 'bool' }, { name: 'grid', offset: 8, size: 8, type: 'array' }] };
  const o = new StructView(odd);
  o.set({ ok: 2 });
  assert.equal(o.f32[0], 2);
  for (const values of [{ flag: 1 }, { grid: [1, 2] }]) {
    assert.equal(said(() => o.set(values)), said(() => writeOld(o, odd, 0, values)));
    assert.match(said(() => o.set(values)), /can't write a field of type/);
  }
});

test('offsets by name; a struct array writes each element at its stride', () => {
  const sh = defineShader({ id: 'test/every.wgsl', label: 'every', code: EVERY, files: ['every'], runs: [], reflect });
  const v = new StructView(sh.structs.All);
  for (const f of S.All.fields) assert.equal(v.offset(f.name), f.offset);
  assert.throws(() => v.offset('nope'), /struct All has no field 'nope'/);
  const arr = new StructArray(sh.structs.Inner, 4);
  const stride = Math.ceil(S.Inner.size / S.Inner.align) * S.Inner.align;
  assert.equal(arr.stride, stride);
  assert.equal(arr.offset(2, 'gain'), 2 * stride + S.Inner.fields.find((f) => f.name === 'gain').offset);
  assert.throws(() => arr.offset(0, 'nope'), /has no field/);
  const want = new ArrayBuffer(arr.data.byteLength), old = new StructView(S.Inner, want, 0, S);
  const r = rng(3);
  for (let i = 0; i < 4; i++) {
    const values = partial(r, S.Inner, 1);
    arr.set(i, values);
    writeOld(old, S.Inner, i * stride, values);
  }
  assert.deepEqual(new Uint8Array(arr.data), new Uint8Array(want));
});

test('a hot edit that moves a field: written at its new place, by its new type', () => {
  const code = (extra) => `struct Sun { ${extra} dir: vec3f, power: f32 }
@group(0) @binding(0) var<uniform> sun: Sun;
@fragment fn fs() -> @location(0) vec4f { return vec4f(sun.dir * sun.power, 1.0); }`;
  const define = (c) => defineShader({ id: 'test/hot-struct.wgsl', label: 'hot', code: c, files: ['hot'], runs: [], reflect: reflectWgsl(c) });
  const sh = define(code(''));
  const def = sh.structs.Sun;
  const a = new StructView(def).set({ dir: [1, 2, 3], power: 4 });
  assert.deepEqual([...a.f32.subarray(0, 4)], [1, 2, 3, 4]);
  define(code('glow: vec4f,'));
  assert.equal(def.version, 2);
  // (the same def object, its fields new: a view made from it now writes the new layout)
  const b = new StructView(def).set({ dir: [1, 2, 3], power: 4, glow: [9, 9, 9, 9] });
  assert.deepEqual([...b.f32.subarray(0, 8)], [9, 9, 9, 9, 1, 2, 3, 4]);
  assert.equal(b.offset('dir'), 16);
});
