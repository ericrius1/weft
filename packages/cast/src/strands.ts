// Strands that ride a body: chains pinned at their roots to points the rig carries (a lock on the scalp, a bead string
// from a diadem, a cord on a mantle, a sash's tail at the waist), each point after the root carried by the medium
// round it (drag toward the air's or the water's own velocity: a breeze, a current, a shock's front passing through),
// falling under gravity (or floating: `grav` < 0), bent back toward its rest way by a spring of its own frequency, held
// to its length, kept out of the body's capsules.
//
// Made to be smooth whatever the frame rate and however fast the body moves:
//   - the roots are read once a frame and swept through it (each substep's root between last frame's and this one's),
//     so a fast head carries its strands, never jerks them;
//   - fixed substeps (`maxStep`), so the springs and the drag are the same at 30 fps and at 240;
//   - the bend is a force (a spring toward the rest way, its stiffness given as a frequency in Hz, so it can't be
//     stiffer than the step can carry), not a position snap re-applied every iteration;
//   - the drag relaxes each point's velocity exponentially toward the medium's (stable for any drag);
//   - the length is kept by follow-the-leader (each point put back on its parent's sphere, root to tip: exact in one
//     pass) with its velocity correction (Müller et al. 2012, "Fast simulation of inextensible hair and fur"), which
//     takes the energy that would otherwise ring along a chain.
//
// It runs on whatever clock it's given (a story clock that dilates: the strands slow with time). Points are kept in one
// Float32Array (x, y, z, radius) ready for the GPU.
import { type V3 } from './math.js';

export interface Capsule { a: V3; b: V3; r: number }
export interface ChainSpec {
  /** the root (world) and its rest way (world, unit) this frame — from the rig */
  root: () => { p: V3; dir: V3 };
  /** points (including the root) and the length between them */
  n: number; seg: number;
  /** the bend's spring at the root as a frequency (Hz): how fast a link swings back to its rest way (0: none, it
   *  hangs free); it falls off along the chain as (1 − i/n)^falloff */
  bend: number; falloff?: number;
  /** radius at the root and the tip (for drawing, and the collisions) */
  r0: number; r1: number;
  /** gravity's share (1: all of it; 0 weightless, as in water; < 0 floats up) */
  grav?: number;
  /** drag toward the medium's velocity (1/s: how quickly a point takes up the air's or the water's motion) */
  drag?: number;
  /** how much the rest way turns with the chain as it goes (0: every link toward the root's way, 1: each toward its
   *  parent link's own way — a filament arcs, a lock hangs) */
  follow?: number;
  /** follow-the-leader's velocity correction (0..1; ~0.9: smooth, a little lossy) */
  ftl?: number;
}

export class Strands {
  readonly pts: Float32Array;
  private vel: Float32Array;
  private off: number[] = [];
  readonly specs: ChainSpec[];
  private first = true;
  /** each chain's root and rest way at the end of the last step (the sweep's start) */
  private roots: { p: V3; dir: V3 }[] = [];
  /** the longest substep (s) */
  maxStep = 1 / 240;
  /** the most velocity (m/s) the constraints may add to a point in a substep (see step) */
  maxKick = 3;
  constructor(specs: ChainSpec[]) {
    this.specs = specs;
    let n = 0;
    for (const s of specs) { this.off.push(n); n += s.n; }
    this.pts = new Float32Array(n * 4);
    this.vel = new Float32Array(n * 3);
    specs.forEach((s, c) => {
      for (let i = 0; i < s.n; i++) this.pts[(this.off[c] + i) * 4 + 3] = s.r0 + (s.r1 - s.r0) * (i / Math.max(1, s.n - 1));
    });
  }
  /** the first point of chain c (its index in pts / 4) */
  start(c: number) { return this.off[c]; }
  get count() { return this.pts.length / 4; }

  /** lay every chain out along its rest way, still (the first frame, or after a jump) */
  reset() {
    this.roots = this.specs.map((s, c) => {
      const r = s.root();
      for (let i = 0; i < s.n; i++) {
        const k = this.off[c] + i;
        this.pts[k * 4] = r.p[0] + r.dir[0] * s.seg * i;
        this.pts[k * 4 + 1] = r.p[1] + r.dir[1] * s.seg * i - 0.002 * i * i;
        this.pts[k * 4 + 2] = r.p[2] + r.dir[2] * s.seg * i;
      }
      return { p: [...r.p] as V3, dir: [...r.dir] as V3 };
    });
    this.vel.fill(0);
    this.first = false;
  }

  /** a step of dt (s): `medium(p)` the air's or water's velocity at a point (m/s), the strands dragged toward it;
   *  `push(p)` an acceleration (m/s²); `caps` the body to keep out of */
  step(dt: number, caps: Capsule[], medium: (p: V3) => V3 = () => [0, 0, 0], push: ((p: V3) => V3) | null = null) {
    if (this.first) this.reset();
    if (dt <= 0) return;
    const P = this.pts, Vl = this.vel;
    const sub = Math.max(1, Math.ceil(dt / this.maxStep - 1e-9));
    const h = dt / sub;
    const most = Math.max(...this.specs.map((s) => s.n));
    const x0 = new Float64Array(3 * most), corr = new Float64Array(3 * most);
    this.specs.forEach((s, c) => {
      const o = this.off[c];
      const r0 = this.roots[c], r1 = s.root();
      const g = 9.8 * (s.grav ?? 1), drag = s.drag ?? 1.5, keep = Math.exp(-drag * h);
      const fo = s.follow ?? 0.6, ftl = s.ftl ?? 0.9, falloff = s.falloff ?? 2;
      for (let st = 0; st < sub; st++) {
        // the root, swept from last frame's to this one's
        const a = (st + 1) / sub;
        const root: V3 = [r0.p[0] + (r1.p[0] - r0.p[0]) * a, r0.p[1] + (r1.p[1] - r0.p[1]) * a, r0.p[2] + (r1.p[2] - r0.p[2]) * a];
        let dir: V3 = [r0.dir[0] + (r1.dir[0] - r0.dir[0]) * a, r0.dir[1] + (r1.dir[1] - r0.dir[1]) * a, r0.dir[2] + (r1.dir[2] - r0.dir[2]) * a];
        const dl0 = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        dir = [dir[0] / dl0, dir[1] / dl0, dir[2] / dl0];
        P[o * 4] = root[0]; P[o * 4 + 1] = root[1]; P[o * 4 + 2] = root[2];
        // the forces: the medium's drag (an exact exponential relaxation toward its velocity), gravity, the push, the
        // bend (a spring toward where the rest way, turned along the chain by `follow`, would put each point)
        let way = dir;
        for (let i = 1; i < s.n; i++) {
          const k = o + i;
          const x: V3 = [P[k * 4], P[k * 4 + 1], P[k * 4 + 2]];
          x0[i * 3] = x[0]; x0[i * 3 + 1] = x[1]; x0[i * 3 + 2] = x[2];
          const w = medium(x);
          const pa = push ? push(x) : null;
          const wHz = s.bend * Math.pow(Math.max(0, 1 - (i - 1) / s.n), falloff) * Math.PI * 2;
          const kb = wHz * wHz;
          // (from the parent as it was this substep: the root where it's swept to, the rest before they move)
          const pxo = i === 1 ? root[0] : x0[(i - 1) * 3], pyo = i === 1 ? root[1] : x0[(i - 1) * 3 + 1], pzo = i === 1 ? root[2] : x0[(i - 1) * 3 + 2];
          const tx = pxo + way[0] * s.seg, ty = pyo + way[1] * s.seg, tz = pzo + way[2] * s.seg;
          const acc: V3 = [kb * (tx - x[0]), kb * (ty - x[1]) - g, kb * (tz - x[2])];
          if (pa) { acc[0] += pa[0]; acc[1] += pa[1]; acc[2] += pa[2]; }
          for (let j = 0; j < 3; j++) {
            const v = w[j] + (Vl[k * 3 + j] - w[j]) * keep + acc[j] * h;
            Vl[k * 3 + j] = v;
            P[k * 4 + j] = x[j] + v * h;
          }
          // the next link's rest way: the root's, turned toward this link's own (as it was) by `follow`
          const lx = x0[i * 3] - (i === 1 ? root[0] : x0[(i - 1) * 3]), ly = x0[i * 3 + 1] - (i === 1 ? root[1] : x0[(i - 1) * 3 + 1]), lz = x0[i * 3 + 2] - (i === 1 ? root[2] : x0[(i - 1) * 3 + 2]);
          const ll = Math.hypot(lx, ly, lz) || 1;
          const nx = way[0] + (lx / ll - way[0]) * fo, ny = way[1] + (ly / ll - way[1]) * fo, nz = way[2] + (lz / ll - way[2]) * fo;
          const nl = Math.hypot(nx, ny, nz) || 1;
          way = [nx / nl, ny / nl, nz / nl];
        }
        // the constraints: out of the body, then follow-the-leader for the length (root to tip, exact)
        for (let i = 1; i < s.n; i++) {
          const k = o + i, kp = k - 1;
          let qx = P[k * 4], qy = P[k * 4 + 1], qz = P[k * 4 + 2];
          const r = P[k * 4 + 3];
          for (const cp of caps) {
            const abx = cp.b[0] - cp.a[0], aby = cp.b[1] - cp.a[1], abz = cp.b[2] - cp.a[2];
            const L2 = abx * abx + aby * aby + abz * abz || 1e-9;
            let u = ((qx - cp.a[0]) * abx + (qy - cp.a[1]) * aby + (qz - cp.a[2]) * abz) / L2;
            u = Math.max(0, Math.min(1, u));
            const cx = cp.a[0] + abx * u, cy = cp.a[1] + aby * u, cz = cp.a[2] + abz * u;
            const ex = qx - cx, ey = qy - cy, ez = qz - cz;
            const el = Math.hypot(ex, ey, ez), rr = cp.r + r;
            if (el < rr && el > 1e-6) { const m = rr / el; qx = cx + ex * m; qy = cy + ey * m; qz = cz + ez * m; }
          }
          const px = P[kp * 4], py = P[kp * 4 + 1], pz = P[kp * 4 + 2];
          const dx = qx - px, dy = qy - py, dz = qz - pz;
          const d = Math.hypot(dx, dy, dz) || 1e-9, f = s.seg / d;
          const fx = px + dx * f, fy = py + dy * f, fz = pz + dz * f;
          // (what the constraint moved it by: its velocity correction goes to its parent)
          corr[i * 3] = fx - P[k * 4]; corr[i * 3 + 1] = fy - P[k * 4 + 1]; corr[i * 3 + 2] = fz - P[k * 4 + 2];
          P[k * 4] = fx; P[k * 4 + 1] = fy; P[k * 4 + 2] = fz;
        }
        // the velocities from where the points went, each less its child's correction (DFTL) — the constraints' part
        // of it (what the corrections added over the integration's own) held under `maxKick`: a correction divided by
        // a tiny step (a story clock barely moving, a frame after a jump) would otherwise become a huge velocity that
        // flings the strand when the steps grow again
        for (let i = 1; i < s.n; i++) {
          const k = o + i;
          let kx = 0, ky = 0, kz = 0;
          const vx = Vl[k * 3], vy = Vl[k * 3 + 1], vz = Vl[k * 3 + 2];
          for (let j = 0; j < 3; j++) {
            const next = i + 1 < s.n ? corr[(i + 1) * 3 + j] : 0;
            const v = (P[k * 4 + j] - x0[i * 3 + j]) / h - ftl * next / h;
            const d = v - Vl[k * 3 + j];
            if (j === 0) kx = d; else if (j === 1) ky = d; else kz = d;
          }
          const km = Math.hypot(kx, ky, kz), f = km > this.maxKick ? this.maxKick / km : 1;
          Vl[k * 3] = vx + kx * f; Vl[k * 3 + 1] = vy + ky * f; Vl[k * 3 + 2] = vz + kz * f;
        }
      }
      this.roots[c] = { p: r1.p, dir: r1.dir };
    });
  }
}
