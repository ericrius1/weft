// How long a uniform struct's set() takes: the compiled writers (packages/weft/src/struct.ts, from its dist) against
// the writer before them (packages/weft/test/struct-old.mjs: a search of the field list for every key, a type parsed
// for every vector and matrix). Two loads, as an app's frame has them:
//   frame   — weft's own Frame struct as View.update sets it, once a view a frame (27 fields: ten matrices,
//             vectors, scalars);
//   globals — an app's globals, 90 fields (vec4s, a few vec3 + f32 pairs, an array of four matrices, arrays of
//             vec4s), set as a game does: one set of 34 fields and two of 4, a frame.
// Run after `npm run build`:  node tools/struct-bench.mjs
// Prints ns a set for each writer and the ratio, the best of several rounds; and checks the two wrote the same bytes.
import { register } from 'node:module';
import { resolve } from 'node:path';

const weft = resolve(import.meta.dirname, '../packages/weft');
register('./test/hooks.mjs', `file://${weft}/`);
const { StructView } = await import(`${weft}/dist/src/struct.js`);
const { reflectWgsl, compileWgsl } = await import(`${weft}/dist/plugin/wgsl.js`);
const { writeStruct: writeOld } = await import(`${weft}/test/struct-old.mjs`);

// ---- weft's Frame, set as View.update does
const frameLayout = compileWgsl(resolve(weft, 'shaders/frame.wgsl'), { root: weft, libs: { weft: resolve(weft, 'shaders') } }).reflect.structs.Frame;
const m = () => new Float32Array(16).map((_, i) => Math.sin(i * 1.7) * 3);
const cam = { viewProj: m(), view: m(), proj: m(), invViewProj: m(), invProj: m(), invView: m(), prevViewProj: m(), viewProjRel: m(), invViewProjRel: m(), prevViewProjRel: m(),
  position: [10.5, 20.25, -3.125], forward: new Float32Array([0, 0, -1]), right: new Float32Array([1, 0, 0]), up: new Float32Array([0, 1, 0]),
  near: 0.1, jitter: [0.25, -0.25], fovY: 1.1, camLo: [1e-7, 2e-7, -3e-7], jitterNdc: [0.001, 0.002, -0.001, 0.0005] };
const mouse = [100, 200, 0, 0], user = [0, 0, 0, 0];
let tick = 0;
const frameValues = () => {
  const c = cam, w = 1920, h = 1080;
  tick++;
  return {
    viewProj: c.viewProj, view: c.view, proj: c.proj, invViewProj: c.invViewProj, invProj: c.invProj, invView: c.invView,
    prevViewProj: c.prevViewProj, camPos: c.position, time: tick / 60, camFwd: c.forward, dt: 1 / 60, camRight: c.right,
    near: c.near, camUp: c.up, frame: tick, res: [w, h], invRes: [1 / w, 1 / h], jitter: c.jitter, fovY: c.fovY,
    aspect: w / h, mouse, user,
    viewProjRel: c.viewProjRel, invViewProjRel: c.invViewProjRel, prevViewProjRel: c.prevViewProjRel, camLo: c.camLo,
    jitterNdc: c.jitterNdc,
  };
};

// ---- an app's globals: 90 fields, of which a frame sets 34 and then twice 4 more
const V4 = Array.from({ length: 70 }, (_, i) => `p${i}`);
const globalsLayout = reflectWgsl(`struct Globals {
  sunDir: vec3f, sunCos: f32,
  moonDir: vec3f, exposure: f32,
  wind: vec4f,
  cascades: array<mat4x4f, 4>,
  splits: vec4f,
  levels: array<vec4f, 4>,
  rects: array<vec4f, 4>,
  slots: array<vec4u, 144>,
  placeXf: array<vec4f, 3>,
  eyeDir: vec3f, eyeH: f32,
  count: u32, mode: i32, a: f32, b: f32,
  ${V4.map((n) => `${n}: vec4f,`).join(' ')}
}
@group(0) @binding(1) var<uniform> globals: Globals;
@fragment fn fs() -> @location(0) vec4f { return globals.wind; }`).structs.Globals;
const cascades = new Float32Array(64).map((_, i) => Math.cos(i));
const dir = [0.3, 0.8, 0.52], moonDir = new Float32Array([-0.3, 0.5, 0.8]);
const globalsSets = () => {
  const t = ++tick / 60;
  const big = {
    sunDir: dir, sunCos: dir[1], moonDir, exposure: 1.2, wind: [0.7, 0.7, 4, t],
    cascades, splits: [20, 80, 320, 1280], placeXf: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]],
    eyeDir: dir, eyeH: 12, count: 3, mode: -1,
  };
  for (let i = 0; i < 22; i++) big[V4[i]] = [t, i, 0.5, 1];
  const a = {}, b = {};
  for (let i = 30; i < 34; i++) a[V4[i]] = [i, t, 0, 0];
  for (let i = 40; i < 44; i++) b[V4[i]] = [i, t, 1, 1];
  return [big, a, b];
};

const fieldCount = (sets) => sets.reduce((n, s) => n + Object.keys(s).length, 0);
function bench(name, layout, makeSets) {
  const fresh = new StructView(layout), old = new StructView(layout);
  const now = (sets) => { for (const s of sets) fresh.set(s); };
  const was = (sets) => { for (const s of sets) writeOld(old, layout, 0, s); };
  // (the same bytes from both, on the same values)
  const probe = makeSets();
  now(probe); was(probe);
  if (Buffer.compare(Buffer.from(fresh.data), Buffer.from(old.data)) !== 0) throw new Error(`${name}: the two writers disagree`);
  // (the values made outside the timed part: a frame's objects are the app's cost either way)
  const N = 20000, sets = Array.from({ length: 64 }, makeSets);
  const time = (fn) => {
    let best = Infinity;
    for (let round = 0; round < 12; round++) {
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < N; i++) fn(sets[i & 63]);
      best = Math.min(best, Number(process.hrtime.bigint() - t0) / N);
    }
    return best;
  };
  for (let i = 0; i < 3; i++) { time(now); time(was); }
  const a = time(was), b = time(now);
  console.log(`${name.padEnd(8)} ${String(fieldCount(probe)).padStart(3)} fields in ${probe.length} set${probe.length > 1 ? 's' : ' '}   before ${a.toFixed(0).padStart(6)} ns   now ${b.toFixed(0).padStart(6)} ns   ${(a / b).toFixed(2)}x`);
}

console.log(`node ${process.version}, ${process.arch}`);
bench('frame', frameLayout, () => [frameValues()]);
bench('globals', globalsLayout, globalsSets);
