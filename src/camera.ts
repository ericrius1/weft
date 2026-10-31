// A camera is just numbers: position + orientation + projection. Each kit View owns one and writes it into the
// group-0 Frame uniform at the start of every run. Reversed-Z, infinite far plane by default.
import { type V3, type M4, mat4, mat4Mul, mat4Invert, perspectiveReversed, perspectiveReversedFar, orthoReversed, lookAt, norm, sub, cross, frustumPlanes } from './math';

export class Camera {
  position: V3 = [0, 2, 5];
  /** radians: yaw 0 looks down -z, positive yaw turns left (counter-clockwise seen from above); pitch up is positive */
  yaw = 0;
  pitch = 0;
  roll = 0;
  fovY = (60 * Math.PI) / 180;
  near = 0.05;
  /** Infinity = infinite reversed-Z perspective */
  far = Infinity;
  /** orthographic half extents (shadow maps, 2D); when set the camera is orthographic */
  ortho: { halfWidth: number; halfHeight: number } | null = null;
  /** sub-pixel projection offset in pixels (TAA) */
  jitter: [number, number] = [0, 0];
  /** lens shift in normalised device units (x right, y up; 1 = half the frame): an off-axis frustum, the view's axis
   *  kept where it points while the frame slides across the image plane (tiles of a larger frame, a fulldome's cube-face
   *  halves, a rising front). Unlike `jitter` it's the camera's own and nothing per-frame resets it. */
  shift: [number, number] = [0, 0];
  /** set to a matrix to bypass yaw/pitch/roll (e.g. light views) */
  viewOverride: M4 | null = null;

  readonly view = mat4();
  readonly proj = mat4();
  readonly viewProj = mat4();
  readonly invViewProj = mat4();
  readonly invProj = mat4();
  readonly invView = mat4();
  readonly prevViewProj = mat4();
  readonly planes = new Float32Array(24);
  forward: V3 = [0, 0, -1];
  right: V3 = [1, 0, 0];
  up: V3 = [0, 1, 0];
  aspect = 1;
  private first = true;

  /** point the camera from `eye` at `target` (sets position, yaw, pitch; keeps roll) */
  lookAt(eye: ArrayLike<number>, target: ArrayLike<number>) {
    this.position = [eye[0], eye[1], eye[2]];
    const d = norm(sub(target, eye));
    this.yaw = Math.atan2(-d[0], -d[2]);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, d[1])));
    return this;
  }

  /** recompute matrices for a viewport (width, height in pixels) */
  update(width: number, height: number) {
    this.aspect = width / Math.max(1, height);
    if (!this.first) this.prevViewProj.set(this.viewProj);
    if (this.viewOverride) {
      this.view.set(this.viewOverride);
      mat4Invert(this.view, this.invView);
      this.right = norm([this.invView[0], this.invView[1], this.invView[2]]);
      this.up = norm([this.invView[4], this.invView[5], this.invView[6]]);
      this.forward = norm([-this.invView[8], -this.invView[9], -this.invView[10]]);
      this.position = [this.invView[12], this.invView[13], this.invView[14]];
    } else {
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const f: V3 = [-sy * cp, sp, -cy * cp];
      let r: V3 = [cy, 0, -sy];
      let u = cross(r, f);
      if (this.roll) {
        const c = Math.cos(this.roll), s = Math.sin(this.roll);
        const r2: V3 = [r[0] * c + u[0] * s, r[1] * c + u[1] * s, r[2] * c + u[2] * s];
        u = cross(r2, f);
        r = r2;
      }
      this.forward = f; this.right = r; this.up = u;
      const p = this.position;
      lookAt(p, [p[0] + f[0], p[1] + f[1], p[2] + f[2]], u, this.view);
      mat4Invert(this.view, this.invView);
    }
    if (this.ortho) {
      const { halfWidth: w, halfHeight: h } = this.ortho;
      orthoReversed(-w, w, -h, h, this.near, this.far === Infinity ? 1e4 : this.far, this.proj);
    } else if (this.far === Infinity) {
      perspectiveReversed(this.fovY, this.aspect, this.near, this.proj);
    } else {
      perspectiveReversedFar(this.fovY, this.aspect, this.near, this.far, this.proj);
    }
    if (this.jitter[0] || this.jitter[1] || this.shift[0] || this.shift[1]) {
      // a shift of the whole projection (ndc x += jx): written into the z column for perspective (clip x += jx * w,
      // w = -z), into the translation for orthographic; the TAA's sub-pixel jitter and the lens shift add
      const jx = (this.jitter[0] * 2) / width + this.shift[0], jy = (this.jitter[1] * 2) / height + this.shift[1];
      if (this.ortho) { this.proj[12] += jx; this.proj[13] += jy; }
      else { this.proj[8] -= jx; this.proj[9] -= jy; }
    }
    mat4Mul(this.proj, this.view, this.viewProj);
    mat4Invert(this.viewProj, this.invViewProj);
    mat4Invert(this.proj, this.invProj);
    frustumPlanes(this.viewProj, this.planes);
    if (this.first) { this.prevViewProj.set(this.viewProj); this.first = false; }
  }

  /** forget motion history (after a cut, so motion vectors don't smear) */
  cut() { this.first = true; }

  /** sphere-in-frustum test using the last update's planes */
  sees(c: ArrayLike<number>, r: number) {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) if (p[i] * c[0] + p[i + 1] * c[1] + p[i + 2] * c[2] + p[i + 3] < -r) return false;
    return true;
  }

  /** world-space ray through a pixel (for picking) */
  ray(px: number, py: number, width: number, height: number) {
    const x = (px / width) * 2 - 1, y = 1 - (py / height) * 2;
    const m = this.invViewProj;
    const tp = (z: number): V3 => {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    };
    const a = tp(1), b = tp(0.001);
    return { origin: a, dir: norm(sub(b, a)) };
  }
}
