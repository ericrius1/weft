// weft/motion's motionOf, worked through the camera's own matrices as a shader gets them (float32, jittered, eye-
// relative: clipRel / prevClipRel), against a double-precision pinhole that shares no code with the camera: the screen
// motion of a moving point without either frame's jitter, and its view distance then and now. A camera following a
// moving point (a chase camera on a bird) at the origin and 1,000 km out, the TAAU's jitter on, the first frame after
// a cut. The WGSL lines are mirrored here one for one (shaders/motion.wgsl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
const { Camera } = await import('../dist/src/camera.js');

const W = 1920, H = 1080;
const f32 = Math.fround;
/** a column-major 4x4 (as float32) times a vec4 (float32 arithmetic, as the GPU) */
const mulF = (m, v) => [0, 1, 2, 3].map((r) => f32(f32(f32(f32(m[r]) * v[0]) + f32(f32(m[4 + r]) * v[1])) + f32(f32(f32(m[8 + r]) * v[2]) + f32(f32(m[12 + r]) * v[3]))));
/** motion.wgsl motionOf, in float32 */
function motionOf(cur, prev, jit) {
  const a = [f32(cur[0] / cur[3]) - f32(jit[0]), f32(cur[1] / cur[3]) - f32(jit[1])];
  const b = [f32(prev[0] / prev[3]) - f32(jit[2]), f32(prev[1] / prev[3]) - f32(jit[3])];
  return [0.5 * (a[0] - b[0]), -0.5 * (a[1] - b[1]), prev[3], cur[3]];
}
/** the reference: a pinhole camera from its eye, yaw, pitch, fovY (doubles, no jitter): uv (0..1, y down) and depth */
function pinhole(eye, yaw, pitch, fovY, p) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [-sy * cp, sp, -cy * cp], r = [cy, 0, -sy];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  const t = Math.tan(fovY / 2), asp = W / H;
  const x = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / (z * t * asp), y = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / (z * t);
  return { uv: [x * 0.5 + 0.5, 0.5 - y * 0.5], dist: z };
}

function run(origin) {
  const cam = new Camera(); cam.fovY = 0.9; cam.near = 0.1;
  const jit = [[0.31, -0.22], [-0.4, 0.13], [0.07, 0.45], [-0.18, -0.36], [0.44, 0.02]];
  // (a bird flying a curve at 11 m/s, 60 fps; the eye 4 m behind and 1.5 m over it, turning with it; a feather point
  // on it that flaps)
  const bird = (k) => { const a = k * 0.03; return [origin[0] + Math.cos(a) * 20, origin[1] + 25 + 0.2 * Math.sin(k * 0.3), origin[2] + Math.sin(a) * 20]; };
  const pt = (k) => { const b = bird(k); return [b[0] + 0.5, b[1] + 0.1 * Math.sin(k * 0.38), b[2] + 0.2]; };
  let worst = { px: 0, dist: 0 }, prevPose = null;
  for (let k = 0; k < 5; k++) {
    if (k === 3) cam.cut();
    const b = bird(k), a = k * 0.03;
    const eye = [b[0] + Math.sin(a) * 4, b[1] + 1.5, b[2] - Math.cos(a) * 4];
    const yaw = Math.atan2(-(b[0] - eye[0]), -(b[2] - eye[2])), pitch = Math.atan2(b[1] - eye[1], Math.hypot(b[0] - eye[0], b[2] - eye[2]));
    cam.position = eye; cam.yaw = yaw; cam.pitch = pitch; cam.jitter = jit[k];
    cam.update(W, H);
    const pose = { eye, yaw, pitch };
    if (k > 0) {
      // (eye-relative positions from the CPU in doubles, as an app hands them: p - eye, the same point a frame ago - eye)
      const p = pt(k), q = pt(k - 1);
      const rel = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2], 1], relWas = [q[0] - eye[0], q[1] - eye[1], q[2] - eye[2], 1];
      const m = motionOf(mulF(cam.viewProjRel, rel), mulF(cam.prevViewProjRel, relWas), cam.jitterNdc);
      const was = k === 3 ? pose : prevPose;   // (after a cut the camera's last frame is this one)
      const now = pinhole(eye, yaw, pitch, cam.fovY, p), then = pinhole(was.eye, was.yaw, was.pitch, cam.fovY, q);
      const ref = [now.uv[0] - then.uv[0], now.uv[1] - then.uv[1]];
      worst.px = Math.max(worst.px, Math.hypot((m[0] - ref[0]) * W, (m[1] - ref[1]) * H));
      worst.dist = Math.max(worst.dist, Math.abs(m[3] - now.dist) / now.dist, Math.abs(m[2] - then.dist) / then.dist);
    }
    prevPose = pose;
  }
  return worst;
}

test('motionOf through the camera (float32, jittered, eye-relative) matches a double pinhole: the origin and 1,000 km out', () => {
  for (const [name, o] of [['origin', [0, 0, 0]], ['1,000 km', [1e6, 0, -7.3e5]]]) {
    const w = run(o);
    console.log(`  ${name.padEnd(9)} motion ${w.px.toExponential(2)} px (1080p), distances ${w.dist.toExponential(2)} relative`);
    assert.ok(w.px < 0.01 && w.dist < 1e-4, `${name}: ${w.px} px, ${w.dist}`);
  }
});

test('the jitter: Camera.jitterNdc holds this frame\'s and last frame\'s, the same after a cut', () => {
  const c = new Camera();
  c.jitter = [0.25, -0.5]; c.update(W, H);
  assert.deepEqual(c.jitterNdc.map((x) => +x.toFixed(9)), [+(0.5 / W).toFixed(9), +(-1 / H).toFixed(9), +(0.5 / W).toFixed(9), +(-1 / H).toFixed(9)]);
  c.jitter = [-0.1, 0.3]; c.update(W, H);
  assert.ok(Math.abs(c.jitterNdc[0] + 0.2 / W) < 1e-12 && Math.abs(c.jitterNdc[2] - 0.5 / W) < 1e-12);
  c.cut(); c.jitter = [0.4, 0.4]; c.update(W, H);
  assert.ok(Math.abs(c.jitterNdc[2] - c.jitterNdc[0]) < 1e-15 && Math.abs(c.jitterNdc[3] - c.jitterNdc[1]) < 1e-15);
});
