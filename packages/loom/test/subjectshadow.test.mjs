// SubjectShadow's map far from the world's origin (render/subjectfit.ts, shaders/subject.wgsl): the receivers' matrix
// and the casters' light clip position, worked as a shader gets them (float32), against a double-precision orthographic
// light that shares no code with weft's Camera, at the origin, 1,000 km and 6,000 km out. A 1.4 m bird 4 m from the
// eye, points on it and on the ground under it along the sun. The map's texel is 2R/size: 5.5 mm at 256.
//   receivers: subjectAtRel(S, r), r relative to the scene's eye (doubles on the CPU, then float32)
//   casters:   subjectClipRel(S, r) (eye-relative) or clipAt(world) in the light's pass (a float32 world position)
// and, for the record, the old way (a view override's float32 viewProj times a float32 world position).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
const { Camera } = await import('../../weft/dist/src/camera.js');
const { fitSubject } = await import('../dist/render/subjectfit.js');
const { lookAt } = await import('../../weft/dist/src/math.js').catch(() => ({ lookAt: null }));

const f32 = Math.fround;
const mulF = (m, v) => [0, 1, 2, 3].map((r) => f32(f32(f32(f32(m[r]) * v[0]) + f32(f32(m[4 + r]) * v[1])) + f32(f32(f32(m[8 + r]) * v[2]) + f32(f32(m[12 + r]) * v[3]))));
const toMap = (c) => [c[0] * 0.5 + 0.5, 0.5 - c[1] * 0.5, c[2]];
const SIZE = 256, R = 0.7, REACH = 40;

/** the reference: the light as an orthographic box from its eye (doubles) looking along -sun, its rotation from
 *  yaw/pitch as a camera's (r = (cos yaw, 0, -sin yaw)), reversed-Z: the near plane 1, the far 0 */
function ref(le, sun, near, far, p) {
  const f = [-sun[0], -sun[1], -sun[2]];
  const yaw = Math.atan2(-f[0], -f[2]);
  const r = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const d = [p[0] - le[0], p[1] - le[1], p[2] - le[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return [dot(d, r) / R * 0.5 + 0.5, 0.5 - dot(d, u) / R * 0.5, (far - dot(d, f)) / (far - near)];
}

function run(origin) {
  const sunRaw = [0.35, 0.62, -0.7], sl = Math.hypot(...sunRaw), sun = sunRaw.map((x) => x / sl);
  const eye = [origin[0] + 3.1, origin[1] + 27.4, origin[2] - 2.2];
  const c = [eye[0] + 1.2, eye[1] - 1.1, eye[2] - 3.7];
  const cam = new Camera(), m = new Float32Array(16);
  const range = fitSubject(cam, c, R, sun, REACH, SIZE, eye, m);
  const le = cam.position;
  // (the light's frame as its pass gets it: camPos the float32 eye, camLo what float32 lost of it)
  const camPos = le.map(f32), camLo = cam.camLo;
  const pts = [];
  for (let i = 0; i < 40; i++) {
    const a = i * 2.39996, h = (i / 39) * 2 - 1;
    pts.push([c[0] + Math.cos(a) * R * 0.9 * Math.sqrt(1 - h * h), c[1] + h * R * 0.9, c[2] + Math.sin(a) * R * 0.9 * Math.sqrt(1 - h * h)]);
  }
  // (and the ground: points down the sun's ray past the bird, up to the reach)
  for (let t = 5; t < REACH; t += 7) pts.push([c[0] - sun[0] * t + 0.13, c[1] - sun[1] * t, c[2] - sun[2] * t - 0.07]);
  // (the old way: a view override, its viewProj float32, world positions float32)
  const old = new Camera(); old.viewOverride = (lookAt ?? (() => null))([le[0], le[1], le[2]], c, [0, 1, 0]) ?? null;
  if (old.viewOverride) { old.ortho = { halfWidth: R, halfHeight: R }; old.near = cam.near; old.far = cam.far; old.update(SIZE, SIZE); }
  const w = { recv: 0, recvZ: 0, castRel: 0, castRelZ: 0, castWorld: 0, castWorldZ: 0, old: 0, oldZ: 0 };
  const err = (a, b) => [Math.hypot(a[0] - b[0], a[1] - b[1]) * SIZE, Math.abs(a[2] - b[2]) * range];
  for (const p of pts) {
    const want = ref(le, sun, cam.near, cam.far, p);
    const rel = [f32(p[0] - eye[0]), f32(p[1] - eye[1]), f32(p[2] - eye[2]), 1];
    let [e, z] = err(toMap(mulF(m, rel)), want);
    w.recv = Math.max(w.recv, e); w.recvZ = Math.max(w.recvZ, z);
    w.castRel = w.recv; w.castRelZ = w.recvZ;   // (subjectClipRel is the same product)
    // (clipAt in the light's pass: fromEye = (p - camPos) - camLo in float32, of a float32 world position)
    const pw = p.map(f32);
    const fe = [0, 1, 2].map((i) => f32(f32(pw[i] - camPos[i]) - f32(camLo[i])));
    [e, z] = err(toMap(mulF(cam.viewProjRel, [...fe, 1])), want);
    w.castWorld = Math.max(w.castWorld, e); w.castWorldZ = Math.max(w.castWorldZ, z);
    if (old.viewOverride) { [e, z] = err(toMap(mulF(old.viewProj, [...pw, 1])), want); w.old = Math.max(w.old, e); w.oldZ = Math.max(w.oldZ, z); }
  }
  return w;
}

test('subject map: eye-relative receivers and casters hold the texel at the origin, 1,000 km and 6,000 km', () => {
  for (const [name, o] of [['origin', [0, 0, 0]], ['1,000 km', [1e6, 120, -7.3e5]], ['6,000 km', [-6e6, 300, 4.1e6]]]) {
    const w = run(o);
    console.log(`${name}: receivers/eye-relative casters ${w.recv.toExponential(2)} texel, ${(w.recvZ * 1000).toExponential(2)} mm deep; ` +
      `clipAt casters (float32 world) ${w.castWorld.toExponential(2)} texel, ${(w.castWorldZ * 1000).toExponential(2)} mm; ` +
      `the old way (override, world viewProj) ${w.old.toFixed(2)} texel, ${(w.oldZ * 1000).toFixed(1)} mm`);
    assert.ok(w.recv < 0.01, `${name}: receiver ${w.recv} texel`);
    assert.ok(w.recvZ < 1e-4, `${name}: receiver depth ${w.recvZ} m`);
    // (a float32 world position is itself only as good as float32 there: 1,000 km out ~3 cm, so clipAt casters are for
    // near the origin; far out, eye-relative casters)
    if (name === 'origin') { assert.ok(w.castWorld < 0.01); assert.ok(w.castWorldZ < 1e-4); }
  }
});
