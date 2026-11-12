// The camera's camera-relative matrices (Camera.viewProjRel, prevViewProjRel): a point given as p − eye lands where
// the absolute matrices put p, this frame and last, for a camera that moves, near the origin and far from it. The far
// cases are checked against the same camera moved the same way near the origin (its absolute matrices are exact
// there), so the reference is independent of the code under test. Run with `npm test` after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
const { Camera } = await import('../dist/src/camera.js');

const W = 3840, H = 2160;
/** a 4x4 column-major matrix times (x, y, z, 1), in doubles; the screen position in 4K pixels */
const px = (m, x, y, z) => {
  const c = [0, 1, 2, 3].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
  return [(c[0] / c[3]) * W / 2, (c[1] / c[3]) * H / 2];
};
const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** a walk: (eye offset, yaw, pitch) a frame */
const path = [[0, 0, 0, 0.3, 0.05], [1.2, 0.1, -0.7, 0.32, 0.04], [2.9, 0.15, -1.6, 0.36, 0.02], [4.1, 0.2, -2.0, 0.37, 0.0], [30, 2, -9, 0.5, -0.1]];
const points = [[3, 1, -20], [-40, 5, -200], [800, -30, -2500], [1.5, 1.6, -4]];

function run(origin) {
  // (camera A at `origin` + the walk; camera B the same walk at the origin: the reference)
  const A = new Camera(), B = new Camera();
  for (const c of [A, B]) { c.fovY = 1; c.near = 0.1; }
  let worst = { now: 0, prev: 0 };
  path.forEach(([dx, dy, dz, yaw, pitch], f) => {
    if (f === 4) { A.cut(); B.cut(); }
    A.position = [origin[0] + dx, origin[1] + dy, origin[2] + dz]; B.position = [dx, dy, dz];
    for (const c of [A, B]) { c.yaw = yaw; c.pitch = pitch; c.update(W, H); }
    for (const [x, y, z] of points) {
      const pB = [dx + x, dy + y, dz + z];                      // the point near the origin, for B
      const rel = [x, y, z];                                    // the same point from the eye (doubles)
      worst.now = Math.max(worst.now, far(px(A.viewProjRel, ...rel), px(B.viewProj, ...pB)));
      worst.prev = Math.max(worst.prev, far(px(A.prevViewProjRel, ...rel), px(B.prevViewProj, ...pB)));
    }
  });
  return worst;
}

test('viewProjRel and prevViewProjRel put p − eye where the exact matrices put p: walking, near the origin and 1,000 and 6,000 km out, the first frame and after a cut', () => {
  for (const [name, o] of [['origin', [0, 0, 0]], ['1,000 km', [1e6, 120, -7.3e5]], ['6,000 km', [6e6, 2500, -4.1e6]]]) {
    const w = run(o);
    console.log(`  ${name.padEnd(9)} this frame ${w.now.toExponential(2)} px, last frame ${w.prev.toExponential(2)} px (4K)`);
    assert.ok(w.now < 0.01 && w.prev < 0.01, `${name}: ${w.now} / ${w.prev} px`);
  }
});

test('near the origin, prevViewProjRel · (p − eye) is prevViewProj · p of the same camera', () => {
  const c = new Camera(); c.fovY = 1;
  let worst = 0;
  path.slice(0, 4).forEach(([dx, dy, dz, yaw, pitch]) => {
    c.position = [dx, dy, dz]; c.yaw = yaw; c.pitch = pitch; c.update(W, H);
    for (const [x, y, z] of points) worst = Math.max(worst, far(px(c.prevViewProjRel, x, y, z), px(c.prevViewProj, dx + x, dy + y, dz + z)));
  });
  assert.ok(worst < 0.01, `${worst} px`);
});

// An independent reference, sharing no code with the camera: the pinhole's projection in doubles from the camera's
// definition (yaw 0 looks down -z, positive yaw turns left; right = (cos yaw, 0, -sin yaw), forward = (-sin yaw cos
// pitch, sin pitch, -cos yaw cos pitch), up = right x forward; x_ndc = f/aspect * right.d / forward.d).
const pinhole = (eye, yaw, pitch, fovY, p) => {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [-sy * cp, sp, -cy * cp], r = [cy, 0, -sy];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k = 1 / Math.tan(fovY / 2), z = dot(d, f);
  return [((k / (W / H)) * dot(d, r) / z) * W / 2, (k * dot(d, u) / z) * H / 2];
};

test('against a double-precision pinhole that shares no code with the camera: this and last frame, walking, at the origin, 1,000 and 6,000 km', () => {
  for (const [name, o] of [['origin', [0, 0, 0]], ['1,000 km', [1e6, 120, -7.3e5]], ['6,000 km', [6e6, 2500, -4.1e6]]]) {
    const c = new Camera(); c.fovY = 1; c.near = 0.1;
    let worst = { now: 0, prev: 0 }, last = null;
    for (const [dx, dy, dz, yaw, pitch] of path.slice(0, 4)) {
      const eye = [o[0] + dx, o[1] + dy, o[2] + dz];
      c.position = eye; c.yaw = yaw; c.pitch = pitch; c.update(W, H);
      for (const [x, y, z] of points) {
        const p = [eye[0] + x, eye[1] + y, eye[2] + z];
        worst.now = Math.max(worst.now, far(px(c.viewProjRel, x, y, z), pinhole(eye, yaw, pitch, 1, p)));
        const ref = last ? pinhole(last.eye, last.yaw, last.pitch, 1, p) : pinhole(eye, yaw, pitch, 1, p);
        worst.prev = Math.max(worst.prev, far(px(c.prevViewProjRel, x, y, z), ref));
      }
      last = { eye, yaw, pitch };
    }
    console.log(`  ${name.padEnd(9)} against the pinhole: this frame ${worst.now.toExponential(2)} px, last frame ${worst.prev.toExponential(2)} px (4K)`);
    assert.ok(worst.now < 0.01 && worst.prev < 0.01, `${name}: ${worst.now} / ${worst.prev} px`);
  }
});
