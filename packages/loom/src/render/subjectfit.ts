// SubjectShadow's fit (render/subjectshadow.ts), kept apart from its GPU objects so a test can run it on weft's Camera
// alone (test/subjectshadow.test.mjs): the light's camera round a subject's sphere, its eye in doubles, and the
// receivers' matrix, which takes positions relative to the scene's eye.
import type { Camera } from '@ericrius1/weft';

/** place `cam` (a light camera, orthographic) round the sphere (c, r) seen from the sun (the unit direction toward
 *  it), its depth reaching `reach` m past the sphere, for a `size`-texel map; write into `m` the matrix that takes a
 *  position relative to `eye` (the scene camera's position, doubles) to the light's clip space. Returns the depth
 *  range (m), the near-to-far span of the light's projection */
export function fitSubject(cam: Camera, c: ArrayLike<number>, r: number, sun: ArrayLike<number>, reach: number, size: number, eye: ArrayLike<number>, m: Float32Array): number {
  const R = Math.max(r, 1e-3);
  const D = R + 1;
  const le: [number, number, number] = [c[0] + sun[0] * D, c[1] + sun[1] * D, c[2] + sun[2] * D];
  // (its eye in doubles, its rotation from the sun: lookAt, not a view override — an override's eye is read back from a
  // float32 inverse, centimetres off far from the origin — so its frame's camPos + camLo, and clipAt in its pass, are exact)
  cam.viewOverride = null;
  cam.lookAt(le, c);
  cam.roll = 0;
  cam.ortho = { halfWidth: R, halfHeight: R };
  cam.near = 0.5;
  cam.far = D + R + reach;
  cam.update(size, size);
  // (a point at q from the scene's eye is at q + (eye − the light's eye) from the light's: the difference in doubles)
  const v = cam.viewProjRel;
  const d0 = eye[0] - le[0], d1 = eye[1] - le[1], d2 = eye[2] - le[2];
  m.set(v);
  for (let i = 0; i < 4; i++) m[12 + i] = v[12 + i] + (v[i] * d0 + v[4 + i] * d1 + v[8 + i] * d2);
  return cam.far - cam.near;
}
