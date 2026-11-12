// Grasps: how a hand holds a thing, as a person's does. A grasp is decided first by where the PALM sits on the thing
// and which kind of hold it is (a glass wrapped, a hammer's handle across the palm, a drumstick on its fulcrum, a bow
// at the frog, a pick between thumb and index, a tray on the fingertips), then each finger and the thumb close onto
// its surface by contact: every bone's pad that should touch lies on the skin of what's held, nothing passes into it
// or into the palm, the thumb opposing the fingers, every joint inside its range and near a comfortable bend.
//
// Everything is solved in the hand's own space (fingers.ts: x along the hand from the wrist, y toward the thumb, z out
// of the palm), so a grasp is a fixed relation between a hand and a shape of a given size: solve it once (`grasp`),
// then place the hand wherever the thing is (`graspGoal`: the shape's place and axis in the world, and which way round
// it the palm comes from) and the rig poses the fingers as solved (HandGoal.pose).
//
// Shapes: a capped cylinder (a glass, a handle, a stick, a pen; a flat one is a disc: a pick, a plate, a tray) or a
// ball (a cloth bunched in the fist). Sizes in metres. The pads' thicknesses are measured from the MakeHuman hand
// (World tools/hands/handgeo.mjs: the skin's distance from each finger bone, median), scaled with the knuckles' width.
import { HandModel, HAND_N, HP_ARCH, hpOf } from './fingers.js';
import { type V3, sub, add, scale, dot, cross, norm, rej, q30 } from './math.js';
import type { HandGoal } from './rig.js';

export type GraspKind = 'wrap' | 'power' | 'stick' | 'bow' | 'pinch' | 'tripod' | 'stem' | 'flat' | 'rim' | 'clasp' | 'cloth';
export const GRASPS: GraspKind[] = ['wrap', 'power', 'stick', 'bow', 'pinch', 'tripod', 'stem', 'flat', 'rim', 'clasp', 'cloth'];

/** what's held, in hand space or the world's: a capped cylinder about unit axis `a` through `c`, radius `r`, half
 *  length `h` (a disc when h is small), or a ball (h < 0) */
export interface Held { c: V3; a: V3; r: number; h: number }
/** the size asked: the radius (a cylinder's, a ball's, a disc's), its length, a disc's thickness */
export interface GraspSize { r?: number; len?: number; thick?: number }

/** a grasp solved: the hand's numbers (fingers.ts, palm's move 0), the held shape in hand space, and how well it holds:
 *  per finger (thumb first) the worst miss of the pads that should touch (m; 0 none asked), the deepest any skin goes
 *  into the shape (m, < 0 clear), the thumb's opposition (cos of the angle about the shape between the thumb's pad and
 *  the fingers' — -1 straight across), iterations spent */
export interface Grasp {
  kind: GraspKind; x: Float64Array; held: Held;
  touch: number[][]; miss: number[]; into: number; palmInto: number; opp: number; iters: number;
}

// ------------------------------------------------------------------------------------------------- the hand's skin
/** the pads' half-thickness at each bone (thumb first; m at a 5.38 cm knuckle span) */
const PAD = [[0.011, 0.009, 0.0075], [0.0095, 0.0078, 0.0062], [0.0100, 0.0080, 0.0065], [0.0095, 0.0074, 0.0062], [0.0080, 0.0064, 0.0054]];
/** the palm's skin, out of the palm (m at that span): mid-palm 13 mm (World tools/hands/handgeo.mjs: 9-17) */
const PALM_Z = 0.013;
const SPAN = 0.0538;

/** the signed distance from p to the held shape's surface (m, < 0 inside) */
export function heldSd(H: Held, p: ArrayLike<number>): number {
  const d0 = p[0] - H.c[0], d1 = p[1] - H.c[1], d2 = p[2] - H.c[2];
  const dd = d0 * d0 + d1 * d1 + d2 * d2;
  if (H.h < 0) return Math.sqrt(dd) - H.r;
  const ax = d0 * H.a[0] + d1 * H.a[1] + d2 * H.a[2];
  const dr = Math.sqrt(Math.max(0, dd - ax * ax)) - H.r, da = Math.abs(ax) - H.h;
  if (dr < 0 && da < 0) return Math.max(dr, da);
  const u = Math.max(dr, 0), v = Math.max(da, 0);
  return Math.sqrt(u * u + v * v);
}
/** the nearest point on the shape's axis (its centre, a ball's) */
function axisPt(H: Held, p: ArrayLike<number>): V3 {
  if (H.h < 0) return [...H.c] as V3;
  const t = Math.max(-H.h, Math.min(H.h, (p[0] - H.c[0]) * H.a[0] + (p[1] - H.c[1]) * H.a[1] + (p[2] - H.c[2]) * H.a[2]));
  return add(H.c, scale(H.a, t));
}

// ------------------------------------------------------------------------------------------------- what each finger is asked
/** sample points of a finger: 0-3 its joints (base, the two between, the tip), 4-6 its bones' middles */
interface FSpec {
  /** sample points (0-6) whose pads lie on the shape's skin */
  on?: number[];
  /** a loose hold: those pads this far off the skin (m) */
  gap?: number;
  /** the tip's (point 3's, or `at`'s) target (hand space) and its weight */
  tgt?: V3; tgtW?: number; at?: number;
  /** the finger's rest (fingers: MCP, PIP, DIP; the thumb: saddle flexion, abduction, MCP, IP) and how much it counts */
  rest: number[]; restW?: number;
  /** a finger's spread (fixed) */
  spread?: number;
  /** solved at all (else held at its rest) */
  solve?: boolean;
}
interface Plan { held: Held; arch: number; f: FSpec[]; /** the thumb opposes this finger's point (f, point) */ oppose?: [number, number];
  /** the way the shape is moved off the palm until the thumb's base clears it */
  lift?: V3 }

/** where along each bone its skin is sampled besides its middle (no thin thing slips between samples) */
const FR = [0.125, 0.25, 0.375, 0.625, 0.75, 0.875], NPT = 25;
const W_PEN = 4, W_ON = 3, W_REST = 6, W_DIP = 10;

/** solve one grasp: the hand's numbers that hold `kind` of `size` (hand M) */
export function grasp(M: HandModel, kind: GraspKind, size: GraspSize = {}): Grasp {
  const sc = M.width / SPAN;
  const P = plan(M, kind, size, sc);
  // (the thumb's metacarpal — the ball of the thumb — stands out of the palm: a thing laid across the palm sits on it,
  // the palm's hollow behind; the shape lifted off the palm until the thumb's base, swung a little out, clears it)
  if (P.lift) {
    const q = restPts(M, 0, P.f[0], P.arch);
    for (let it = 0; it < 4; it++) {
      let pen = 0;
      for (const i of [1, 2, 3, 5, 6]) pen = Math.max(pen, PAD[0][i === 1 ? 1 : 2] * sc - heldSd(P.held, pt(q, i)));
      if (pen <= 1e-5) break;
      P.held.c = add(P.held.c, scale(P.lift, pen));
      for (const F of P.f) if (F.tgt) F.tgt = add(F.tgt, scale(P.lift, pen));
    }
  }
  const x = new Float64Array(HAND_N);
  x[HP_ARCH] = Math.min(M.hi[HP_ARCH], Math.max(M.lo[HP_ARCH], P.arch));
  // (every finger at its rest first: the thumb is solved last, against the fingers as they lie)
  for (let f = 0; f < 5; f++) setRest(M, x, f, P.f[f]);
  const S = new Ctx(M, P, sc);
  let iters = 0;
  for (const f of [1, 2, 3, 4, 0]) {
    if (f === 0 && P.oppose) {
      // (the thumb's pad across the shape from that finger's point)
      const [of, op] = P.oppose, q = S.pts(x, of), pt: V3 = [q[op * 3], q[op * 3 + 1], q[op * 3 + 2]];
      const ap = axisPt(P.held, pt), dir = norm(sub(pt, ap));
      P.f[0].tgt = sub(ap, scale(dir, P.held.r + PAD[0][2] * sc));
    }
    if (P.f[f].solve === false) continue;
    // (from a few starts — its rest, opened, closed; the thumb also swung out of the palm and across it — the best
    // kept: a contact solve has more than one valley, a thumb under the thing or round it)
    const o = hpOf(f), n = f === 0 ? 4 : 3, i0 = f === 0 ? o : o + 1, r = x.slice(i0, i0 + n);
    const starts = f === 0 ? [[...r], ...S.grid(x, f, i0, 3)] : [[...r], r.map((v) => v * 0.4), r.map((v) => v + 0.35)];
    let best = Infinity, bx = r;
    for (const st of starts) {
      for (let k = 0; k < n; k++) x[i0 + k] = Math.min(M.hi[i0 + k], Math.max(M.lo[i0 + k], st[k]));
      const s = S.solve(x, f);
      iters += s.it;
      if (s.cost < best - 1e-9) { best = s.cost; bx = x.slice(i0, i0 + n); }
    }
    x.set(bx, i0);
  }
  for (let i = 6; i < HAND_N; i++) x[i] = q30(x[i]);
  // (how it holds)
  const miss = [0, 0, 0, 0, 0], touch: number[][] = [];
  let into = -Infinity, palmInto = -Infinity;
  for (let f = 0; f < 5; f++) {
    const q = S.pts(x, f), F = P.f[f];
    touch.push(F.on ?? []);
    for (let i = 0; i < NPT; i++) {
      const p = [q[i * 3], q[i * 3 + 1], q[i * 3 + 2]], s = heldSd(P.held, p) - S.pad(f, i);
      if (!(i === 0 || (f === 0 && (i === 4 || (i >= 7 && i < 13))))) into = Math.max(into, -s);
      if (F.on?.includes(i)) miss[f] = Math.max(miss[f], Math.abs(s - (F.gap ?? 0)));
      if (S.palmTest(f, i)) palmInto = Math.max(palmInto, -(S.palmSd(p) - S.pad(f, i)));
    }
  }
  // (the thumb's opposition: about the shape's axis, its pad (the end bone's middle) against the finger point it opposes,
  // or else the fingers' touching pads)
  let opp = 1;
  {
    const q0 = S.pts(x, 0), tp: V3 = [q0[18], q0[19], q0[20]];
    let fs: V3 = [0, 0, 0], n = 0;
    if (P.oppose) { const [of, op] = P.oppose, q = S.pts(x, of); fs = [q[op * 3], q[op * 3 + 1], q[op * 3 + 2]]; n = 1; }
    else for (let f = 1; f < 5; f++) { const on = P.f[f].on; if (!on?.length) continue; const q = S.pts(x, f); for (const i of on) { fs = add(fs, [q[i * 3], q[i * 3 + 1], q[i * 3 + 2]]); n++; } }
    if (n) {
      fs = scale(fs, 1 / n);
      const ap = axisPt(P.held, scale(add(tp, fs), 0.5));
      const u = P.held.h < 0 ? sub(tp, ap) : rej(sub(tp, ap), P.held.a), v = P.held.h < 0 ? sub(fs, ap) : rej(sub(fs, ap), P.held.a);
      opp = dot(norm(u), norm(v));
    }
  }
  return { kind, x, held: P.held, touch, miss, into, palmInto, opp, iters };
}

function setRest(M: HandModel, x: Float64Array, f: number, F: FSpec) {
  const o = hpOf(f), lim = (i: number, v: number) => Math.min(M.hi[i], Math.max(M.lo[i], v));
  if (f === 0) { for (let j = 0; j < 4; j++) x[o + j] = lim(o + j, F.rest[j]); return; }
  x[o] = lim(o, F.spread ?? 0);
  for (let j = 0; j < 3; j++) x[o + 1 + j] = lim(o + 1 + j, F.rest[j]);
}

/** a finger's points and the residuals of its ask; a small Levenberg–Marquardt over its own numbers */
class Ctx {
  private Pk = new Float64Array(12); private K = new Float64Array(3); private Zf = new Float64Array(3);
  private q = new Float64Array(75);
  private palmX: number;
  constructor(readonly M: HandModel, readonly P: Plan, readonly sc: number) {
    this.palmX = Math.min(M.base[3], M.base[6], M.base[9], M.base[12]) - 0.004 * sc;
  }
  pad(f: number, i: number) { const r = PAD[f]; return (i < 4 ? (i === 0 ? r[0] : i === 3 ? r[2] * 0.85 : Math.min(r[i - 1], r[i])) : i < 7 ? r[i - 4] : r[((i - 7) / 6) | 0]) * this.sc; }
  /** finger f's points under x (hand space): 0-3 its joints, 4-6 its bones' middles, 7-24 six more along each bone */
  pts(x: ArrayLike<number>, f: number): Float64Array {
    const Pk = this.Pk, q = this.q;
    this.M.fk(x, f, Pk, null, this.K, this.Zf);
    q.set(Pk, 0);
    for (let j = 0; j < 3; j++) for (let c = 0; c < 3; c++) {
      const a = Pk[j * 3 + c], b = Pk[j * 3 + 3 + c];
      q[12 + j * 3 + c] = (a + b) / 2;
      for (let k = 0; k < 6; k++) { const t = FR[k]; q[21 + (j * 6 + k) * 3 + c] = a * (1 - t) + b * t; }
    }
    return q;
  }
  /** the palm as a box (hand space): from the wrist to just short of the knuckles, its skin out of the palm */
  palmSd(p: ArrayLike<number>) {
    const s = this.sc, hx = this.palmX / 2, cx = hx;
    const dx = Math.abs(p[0] - cx) - hx, dy = Math.abs(p[1] - 0.0) - 0.03 * s, dz = Math.abs(p[2] + 0.004 * s) - (PALM_Z + 0.004) * s;
    const m = Math.max(dx, dy, dz);
    if (m < 0) return m;
    const u = Math.max(dx, 0), v = Math.max(dy, 0), w = Math.max(dz, 0);
    return Math.sqrt(u * u + v * v + w * w);
  }
  palmTest(f: number, i: number) { return f === 0 ? i === 3 || i === 6 : i === 2 || i === 3 || i === 5 || i === 6; }
  private other: Float64Array[] = [];
  /** residuals of finger f's ask under x */
  res(x: Float64Array, f: number, out: number[], tag?: string[]) {
    out.length = 0;
    const T = (t: string) => { if (tag) while (tag.length < out.length) tag.push(t); };
    const F = this.P.f[f], H = this.P.held, q = this.pts(x, f), mm = 1000;
    for (let i = 0; i < NPT; i++) {
      if (f > 0 && i === 0) continue;
      if (f === 0 && (i === 0 || i === 4 || (i >= 7 && i < 13))) continue;
      const p = [q[i * 3], q[i * 3 + 1], q[i * 3 + 2]], pd = this.pad(f, i);
      const s = heldSd(H, p) - pd;
      if (F.on?.includes(i)) out.push(W_ON * (s - (F.gap ?? 0)) * mm);
      T('on' + i);
      out.push(s < 0 ? W_PEN * s * mm : 0);
      T('pen' + i);
      if (this.palmTest(f, i)) { const sp = this.palmSd(p) - pd; out.push(sp < 0 ? W_PEN * sp * mm : 0); T('palm' + i); }
      // (the thumb kept off the fingers: a breadth apart)
      if (f === 0 && i >= 2) {
        for (const Q of this.other) for (let j = 0; j < 7; j++) {
          const d0 = p[0] - Q[j * 3], d1 = p[1] - Q[j * 3 + 1], d2 = p[2] - Q[j * 3 + 2];
          const s2 = Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2) - pd - 0.007 * this.sc;
          out.push(s2 < 0 ? W_PEN * s2 * mm : 0);
        }
        T('fing' + i);
      }
    }
    if (F.tgt) { const at = F.at ?? 3, w = F.tgtW ?? 0.5; for (let c = 0; c < 3; c++) out.push(w * (q[at * 3 + c] - F.tgt[c]) * mm); T('tgt'); }
    const o = hpOf(f), rw = (F.restW ?? 0.15) * W_REST;
    if (f === 0) { for (let j = 0; j < 4; j++) out.push(rw * (x[o + j] - F.rest[j])); T('rest'); }
    else {
      for (let j = 0; j < 3; j++) out.push(rw * (x[o + 1 + j] - F.rest[j]));
      out.push(W_DIP * (x[o + 3] - 0.7 * x[o + 2]));
      // (past the comfortable band, a held bend costs)
      for (let j = 1; j <= 3; j++) { const v = x[o + j], hi = this.M.okHi[o + j] * 1.15; out.push(v > hi ? 8 * (v - hi) : 0); }
      // (a holding finger's knuckle not bent backward)
      out.push(x[o + 1] < -0.1 ? 80 * (x[o + 1] + 0.1) : 0);
    }
  }
  /** the best few of a coarse grid over the thumb's four numbers (its saddle swings far: a local solve alone can stay
   *  under the thing when it should come round it) */
  grid(x: Float64Array, f: number, i0: number, k: number): number[][] {
    const M = this.M, r: number[] = [], out: { c: number; v: number[] }[] = [];
    const at = (i: number, t: number) => M.lo[i] + (M.hi[i] - M.lo[i]) * t;
    const keep = x.slice(i0, i0 + 4);
    for (const a of [0.1, 0.35, 0.6, 0.85]) for (const b of [0.1, 0.35, 0.6, 0.9]) for (const c of [0.2, 0.55]) for (const d of [0.25, 0.6]) {
      const v = [at(i0, a), at(i0 + 1, b), at(i0 + 2, c), at(i0 + 3, d)];
      x.set(v, i0);
      this.res(x, f, r);
      let cost = 0; for (const e of r) cost += e * e;
      out.push({ c: cost, v });
    }
    x.set(keep, i0);
    out.sort((p, q) => p.c - q.c);
    return out.slice(0, k).map((o) => o.v);
  }
  solve(x: Float64Array, f: number): { it: number; cost: number } {
    const M = this.M, o = hpOf(f), ids = f === 0 ? [o, o + 1, o + 2, o + 3] : [o + 1, o + 2, o + 3];
    if (f === 0) { this.other = []; for (const g of [1, 2]) this.other.push(this.pts(x, g).slice()); }
    const n = ids.length, r0: number[] = [], r1: number[] = [];
    const cost = (r: number[]) => { let c = 0; for (const v of r) c += v * v; return c; };
    let lam = 1e-2, it = 0;
    this.res(x, f, r0);
    let c0 = cost(r0);
    const J: number[][] = [];
    for (it = 0; it < 60; it++) {
      // (the Jacobian by differences: a few numbers, cheap)
      for (let k = 0; k < n; k++) {
        const i = ids[k], v = x[i];
        x[i] = v + 1e-5; this.res(x, f, r1); x[i] = v;
        J[k] = r1.map((r, j) => (r - r0[j]) / 1e-5);
      }
      const A: number[][] = [], g: number[] = [];
      for (let a = 0; a < n; a++) {
        A[a] = [];
        for (let b = 0; b < n; b++) { let s = 0; for (let j = 0; j < r0.length; j++) s += J[a][j] * J[b][j]; A[a][b] = s; }
        let s = 0; for (let j = 0; j < r0.length; j++) s += J[a][j] * r0[j]; g[a] = s;
      }
      let ok = false;
      for (let tries = 0; tries < 8 && !ok; tries++) {
        const B = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lam) + 1e-6 : v))), d = solveN(B, g.map((v) => -v));
        const old = ids.map((i) => x[i]);
        for (let k = 0; k < n; k++) x[ids[k]] = Math.min(M.hi[ids[k]], Math.max(M.lo[ids[k]], x[ids[k]] + d[k]));
        this.res(x, f, r1);
        const c1 = cost(r1);
        if (c1 < c0) { ok = true; lam = Math.max(1e-6, lam * 0.3); const done = c0 - c1 < 1e-6 * (1 + c0); c0 = c1; r0.splice(0, r0.length, ...r1); if (done) return { it: it + 1, cost: c0 }; }
        else { for (let k = 0; k < n; k++) x[ids[k]] = old[k]; lam *= 10; }
      }
      if (!ok) break;
    }
    return { it, cost: c0 };
  }
}
/** a small dense solve (Gaussian elimination, partial pivots) */
function solveN(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    const d = A[i][i] || 1e-12;
    for (let r = i + 1; r < n; r++) { const k = A[r][i] / d; for (let c = i; c < n; c++) A[r][c] -= k * A[i][c]; b[r] -= k * b[i]; }
  }
  const xs = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * xs[c]; xs[i] = s / (A[i][i] || 1e-12); }
  return xs;
}

// ------------------------------------------------------------------------------------------------- the kinds
/** finger f posed at its rest numbers (hand space): its seven points */
function restPts(M: HandModel, f: number, F: FSpec, arch: number): Float64Array {
  const x = new Float64Array(HAND_N); x[HP_ARCH] = arch; setRest(M, x, f, F);
  const P = new Float64Array(12), K = new Float64Array(3), Z = new Float64Array(3);
  M.fk(x, f, P, null, K, Z);
  const q = new Float64Array(24);
  q.set(P, 0); q.set(K, 21);
  for (let j = 0; j < 3; j++) for (let c = 0; c < 3; c++) q[12 + j * 3 + c] = (P[j * 3 + c] + P[j * 3 + 3 + c]) / 2;
  return q;
}
const pt = (q: Float64Array, i: number): V3 => [q[i * 3], q[i * 3 + 1], q[i * 3 + 2]];
/** a finger bone's way, and its palm side (where its pad faces: the way the bone moves as it bends) */
function boneFrame(q: Float64Array, j: number): { v: V3; pad: V3; side: V3 } {
  const v = norm(sub(pt(q, j + 1), pt(q, j))), K: V3 = [q[21], q[22], q[23]];
  const pad = norm(cross(K, v));
  return { v, pad, side: norm(cross(v, pad)) };
}

function plan(M: HandModel, kind: GraspKind, size: GraspSize, sc: number): Plan {
  const K = (f: number): V3 => [M.base[f * 3], M.base[f * 3 + 1], M.base[f * 3 + 2]];
  const zs = PALM_Z * sc;
  const len = size.len;
  const fingers = (rest: number[], on: number[], spread = [0.02, 0, -0.03, -0.07], extra: Partial<FSpec> = {}): FSpec[] =>
    [1, 2, 3, 4].map((f) => ({ rest, on, spread: spread[f - 1], restW: 0.1, ...extra }));
  switch (kind) {
    case 'wrap': case 'power': case 'clasp': {
      // the axis across the palm (toward the thumb), against the distal palm: a glass's nearly square to the fingers, a
      // handle's diagonal from the index's base to the heel of the hand
      const r = size.r ?? (kind === 'wrap' ? 0.035 : kind === 'clasp' ? 0.012 : 0.016);
      const tilt = kind === 'wrap' ? 0.18 : kind === 'clasp' ? 0.3 : 0.5;
      const a = norm([Math.sin(tilt), Math.cos(tilt), 0]);
      // (the contact line: across the distal palm, just short of the knuckles — the fingers wrap from there, and the thumb's
      // base has room to come up the near side)
      const kx = (K(1)[0] + K(2)[0] + K(3)[0]) / 3;
      const x0 = kx - 0.006 * sc, y0 = K(2)[1];
      const held: Held = { c: [x0, y0, zs + r], a, r, h: (len ?? (kind === 'clasp' ? 0.08 : 0.2)) / 2 };
      const f = fingers([0.7, 0.9, 0.6], [4, 5, 6], kind === 'wrap' ? [0.03, 0, -0.03, -0.08] : [0, 0, -0.02, -0.05]);
      // (the thumb round the other way: its pad on the far side, across from the fingers)
      // (the thumb's pad on the near side of the thing from the wrist, over the index: round a glass the thumb lies up its
      // side, the fingers round its front; round a handle it comes over to the fingers. Since a built hand's saddle turns
      // its pad as a person's does (fingers.ts PRON), the solve brings it on round a wide glass's front by itself)
      const R = r + PAD[0][2] * sc, phi = r > 0.025 ? 2.0 : 2.6;
      const far = add(held.c, scale([-Math.sin(phi), 0, -Math.cos(phi)], R));
      const th: FSpec = { rest: [0.35, 0.25, 0.35, 0.3], restW: 0.06, on: [6], tgt: add(far, scale(a, (r > 0.025 ? 0.06 : 0.022) * sc)), tgtW: 0.35, at: 3 };
      return { held, arch: kind === 'wrap' ? 0.25 + 3 * Math.max(0, 0.045 - r) : 0.55, f: [th, ...f] };
    }
    case 'cloth': {
      const r = size.r ?? 0.03;
      const held: Held = { c: [0.055 * sc, K(2)[1] - 0.004, zs + r - 0.004 * sc], a: [0, 1, 0], r, h: -1 };
      const f = fingers([0.7, 0.9, 0.6], [5, 6], [0.06, 0.01, -0.04, -0.1]);
      const th: FSpec = { rest: [0.3, 0.3, 0.3, 0.3], restW: 0.06, on: [6], tgt: add(held.c, scale(norm([-0.1, 0.5, 1]), r + PAD[0][2] * sc)), tgtW: 0.35 };
      return { held, arch: 0.4, f: [th, ...f] };
    }
    case 'stick': {
      // a drumstick: from the heel of the hand out between the thumb and the index; the fulcrum the thumb's pad against
      // the side of the index's middle bone; the others loosely round
      // (the stick crosses the palm at ~45° to the fingers — a drummer's matched grip: its butt out past the heel of the
      // hand, its fulcrum at the index's middle joint by the thumb's pad, so the curled fingers wrap round it rather than
      // lie along it)
      const r = size.r ?? 0.007;
      const a = norm([1, 1.05, 0.12]);
      const heel: V3 = [0.012 * sc, -0.032 * sc, zs + r];
      const held: Held = { c: add(heel, scale(a, 0.07 * sc)), a, r, h: (len ?? 0.4) / 2 };
      const f = fingers([0.95, 1.15, 0.6], [4, 5], [0.05, 0, -0.04, -0.09], { gap: 0.0015 });
      f[0] = { rest: [0.75, 1.25, 0.6], on: [1, 5], spread: 0.08, restW: 0.1 };
      // (the back fingers round it loosely, by their middle bones: they steady the stick, the fulcrum holds it)
      f[2] = { ...f[2], on: [5], gap: 0.003 }; f[3] = { ...f[3], rest: [1.05, 1.2, 0.6], on: [5], gap: 0.004 };
      const th: FSpec = { rest: [0.25, 0.2, 0.3, 0.25], restW: 0.06, on: [6], at: 6, tgtW: 0.6 };
      return { held, arch: 0.3, f: [th, ...f], oppose: [1, 5] };
    }
    case 'bow': {
      // a bow at the frog: the stick across the fingers under the middle and ring fingers' end joints, the index leaning
      // on it by its middle bone, the little finger's tip standing on top, the thumb bent, its tip under the stick
      const r = size.r ?? 0.0055;
      // (the stick in the crook of the curled fingers, on the pads of their middle bones, the tips coming round its far
      // side: the hand close over the stick, not hanging from it by its fingertips)
      const mid: FSpec = { rest: [0.3, 1.25, 0.75], restW: 0.3, spread: 0, on: [5] };
      const q = restPts(M, 2, mid, 0.15), bf = boneFrame(q, 1);
      const c = add(pt(q, 5), scale(bf.pad, PAD[2][1] * sc + r));
      // (slanted across the fingers toward the tip, as a violinist's hand leans on the stick by the index)
      const a = norm(rej([0.55, 1, 0], bf.pad));
      const held: Held = { c, a, r, h: (len ?? 0.7) / 2 };
      const top = scale(bf.pad, -1);
      const lq = restPts(M, 4, { rest: [0.35, 0.9, 0.55] }, 0.15);
      const lt = add(axisPt(held, pt(lq, 3)), scale(top, r + PAD[4][2] * sc));
      const f: FSpec[] = [
        { rest: [0.35, 0.95, 0.5], restW: 0.2, spread: 0.12, on: [5] },
        mid,
        { rest: [0.3, 1.25, 0.75], restW: 0.3, spread: -0.04, on: [5] },
        { rest: [0.35, 0.9, 0.55], restW: 0.2, spread: -0.06, on: [3], tgt: lt, tgtW: 0.5 },
      ];
      const th: FSpec = { rest: [0.4, 0.15, 0.55, 0.75], restW: 0.12, on: [3], tgtW: 0.6 };
      return { held, arch: 0.15, f: [th, ...f], oppose: [2, 5] };
    }
    case 'pinch': {
      // a pick between the thumb's pad and the side of the index's end bone (the thumb's side of it)
      const r = size.r ?? 0.013, h = (size.thick ?? 0.0008) / 2;
      const ix: FSpec = { rest: [0.55, 1.05, 0.55], restW: 0.4, spread: 0.02 };
      const q = restPts(M, 1, ix, 0.1), bf = boneFrame(q, 2);
      const side = dot(bf.side, [0, 1, 0]) > 0 ? bf.side : scale(bf.side, -1);
      const c = add(pt(q, 6), scale(side, PAD[1][2] * sc + h));
      const held: Held = { c: add(c, scale(bf.pad, r * 0.3)), a: side, r, h };
      const th: FSpec = { rest: [0.3, 0.1, 0.25, 0.35], restW: 0.08, on: [6], tgt: add(c, scale(side, 2 * h + PAD[0][2] * sc)), tgtW: 0.8, at: 6 };
      const curl: FSpec = { rest: [0.9, 1.15, 0.6], restW: 0.3, solve: true };
      return { held, arch: 0.2, f: [th, ix, { ...curl, spread: 0 }, { ...curl, spread: -0.03 }, { ...curl, spread: -0.07 }] };
    }
    case 'tripod': case 'stem': {
      // a pen resting on the side of the middle finger's end bone, the index's pad on it from above and the thumb's
      // from the side, running back over the web between thumb and index; a wine glass's stem pinched between the
      // thumb's pad and the index's, the middle under it
      const r = size.r ?? (kind === 'tripod' ? 0.0045 : 0.0035);
      if (kind === 'tripod') {
        const md: FSpec = { rest: [0.6, 0.8, 0.3], restW: 0.4, spread: 0, on: [6] };
        const q = restPts(M, 2, md, 0.1), bf = boneFrame(q, 2);
        const side = dot(bf.side, [0, 1, 0]) > 0 ? bf.side : scale(bf.side, -1);
        const c = add(pt(q, 6), scale(side, PAD[2][2] * sc + r));
        const web: V3 = add(K(1), [-0.016 * sc, 0.024 * sc, -0.012 * sc]);
        const a = norm(sub(web, c));
        const held: Held = { c, a, r, h: (len ?? 0.14) / 2 };
        const curl: FSpec = { rest: [0.9, 1.1, 0.55], restW: 0.3 };
        return { held, arch: 0.25, f: [{ rest: [0.35, 0.2, 0.3, 0.25], restW: 0.08, on: [6], tgtW: 0.6, at: 6 }, { rest: [0.5, 0.7, 0.35], restW: 0.15, spread: 0, on: [6] }, md, { ...curl, spread: -0.03 }, { ...curl, spread: -0.06 }], oppose: [1, 6] };
      }
      const ix: FSpec = { rest: [0.75, 0.8, 0.4], restW: 0.3, spread: 0, on: [6] };
      const q = restPts(M, 1, ix, 0.1), bf = boneFrame(q, 2);
      const c = add(pt(q, 6), scale(bf.pad, PAD[1][2] * sc + r));
      const held: Held = { c, a: norm([q[21], q[22], q[23]]), r, h: (len ?? 0.08) / 2 };
      const curl: FSpec = { rest: [1.0, 1.2, 0.6], restW: 0.3 };
      return { held, arch: 0.3, f: [{ rest: [0.4, 0.2, 0.3, 0.3], restW: 0.08, on: [6], tgtW: 0.7, at: 6 }, ix, { rest: [0.9, 0.9, 0.45], restW: 0.2, spread: -0.01, on: [5], gap: 0.001 }, { ...curl, spread: -0.04 }, { ...curl, spread: -0.08 }], oppose: [1, 6] };
    }
    case 'flat': {
      // a tray on the fingertips and the palm: its underside just over the palm's skin, the fingers fanned, their pads up
      // under it
      const h = (size.thick ?? 0.012) / 2, r = size.r ?? 0.2;
      const held: Held = { c: [0.06 * sc, 0, zs + 0.005 * sc + h], a: [0, 0, 1], r, h };
      const f = fingers([0.25, 0.25, 0.15], [3], [0.14, 0.04, -0.06, -0.15]);
      return { held, arch: -0.1, f: [{ rest: [-0.3, -0.3, 0.1, 0.1], restW: 0.5 }, ...f], lift: [0, 0, 1] };
    }
    case 'rim': {
      // a plate by its rim: the rim's edge running from the web between thumb and index across to the little finger's
      // end, the plate out over the fingers, which lie flat under it; the thumb on top, just inside the edge
      const h = (size.thick ?? 0.006) / 2, r = size.r ?? 0.12;
      const lq = restPts(M, 4, { rest: [0.15, 0.1, 0.05] }, 0), web: V3 = add(K(1), [-0.022 * sc, 0.016 * sc, 0]);
      const lp = pt(lq, 2), e = norm([lp[0] - web[0], lp[1] - web[1], 0]), n: V3 = [-e[1], e[0], 0];
      const nOut: V3 = n[0] > 0 ? n : scale(n, -1);
      // (its underside just on the fingers' pads as they lie)
      let zt = 0;
      for (let g = 1; g <= 3; g++) { const q = restPts(M, g, { rest: [0.15, 0.1, 0.05], spread: [0.08, 0.02, -0.04][g - 1] }, 0); for (const i of [3, 5, 6]) zt = Math.max(zt, pt(q, i)[2] + PAD[g][2] * sc * (i === 3 ? 0.85 : 1)); }
      const z0 = zt + h, mid: V3 = [(web[0] + lp[0]) / 2, (web[1] + lp[1]) / 2, z0];
      const held: Held = { c: add(mid, scale(nOut, r)), a: [0, 0, 1], r, h };
      const f = fingers([0.15, 0.1, 0.05], [6], [0.08, 0.02, -0.04, -0.1]);
      f[3].on = [];
      // (the index, by the rim's edge, lies flat under it: solved toward the plate it curls over the edge)
      f[0] = { ...f[0], on: [], solve: false };
      const top = add(add(web, scale(nOut, 0.016 * sc)), [0, 0, z0 + h + PAD[0][2] * sc]);
      const th: FSpec = { rest: [0.0, 0.5, 0.3, 0.2], restW: 0.05, on: [6], tgt: top, tgtW: 0.6, at: 6 };
      return { held, arch: 0, f: [th, ...f] };
    }
  }
}

// ------------------------------------------------------------------------------------------------- in the world
/** where the grasp puts the hand for a thing held in the world: `at` is where the grasp's shape centre goes, `axis` its
 *  axis there (which way the thumb's side of it points: a glass's up, a hammer's head end; a disc's or tray's normal
 *  out of the palm's side), and the palm comes to it from `from` (a direction round the axis; or, given `near`, the
 *  way round that puts the wrist nearest that point — a shoulder, a point below the elbow). `side` 'L' her left. `hl`
 *  the hand bone's length (the rig's: HandGoal.palm sits 0.55 of it along). The goal holds exactly, its fingers posed
 *  as solved (HandGoal.pose). */
export function graspGoal(M: HandModel, g: Grasp, side: 'L' | 'R', hl: number, w: { at: V3; axis: V3; from?: V3; near?: V3; w?: number }): HandGoal {
  const H = g.held, sg = side === 'L' ? 1 : -1;
  const ah = H.a, palmC: V3 = [0.05 * M.width / SPAN, 0, 0];
  let nh = rej(sub(palmC, H.c), ah);
  if (Math.sqrt(dot(nh, nh)) < 1e-6) nh = rej([1, 0, 0], ah);
  nh = norm(nh);
  const bh = cross(ah, nh);
  const aw = norm(w.axis);
  const frame = (from: V3) => {
    const nw = norm(rej(from, aw)), bw = scale(cross(aw, nw), sg);
    const map = (v: ArrayLike<number>): V3 => { const p = dot(v, ah), q = dot(v, nh), r = dot(v, bh); return [aw[0] * p + nw[0] * q + bw[0] * r, aw[1] * p + nw[1] * q + bw[1] * r, aw[2] * p + nw[2] * q + bw[2] * r]; };
    const h = map([1, 0, 0]), p = map([0, 0, 1]), wrist = sub(w.at, map(H.c));
    return { h, p, wrist };
  };
  let from = w.from;
  if (!from) {
    // (round the axis, the way that puts the wrist nearest `near`)
    const u = norm(rej(Math.abs(aw[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], aw)), v = cross(aw, u);
    let best = Infinity;
    for (let k = 0; k < 72; k++) {
      const t = (k / 72) * Math.PI * 2, d = add(scale(u, Math.cos(t)), scale(v, Math.sin(t)));
      const F = frame(d), dd = w.near ? sub(F.wrist, w.near) : [0, 0, 0];
      const c = dot(dd, dd);
      if (c < best) { best = c; from = d; }
    }
  }
  const F = frame(from!);
  return { palm: add(F.wrist, scale(F.h, hl * 0.55)), fwd: F.h, down: F.p, tips: [null, null, null, null, null], grip: 1, curl: 0.5, exact: true, pose: g.x };
}
/** the held shape in the world for a hand placed by graspGoal (to draw it, or to test it) */
export function heldWorld(g: Grasp, goal: HandGoal, side: 'L' | 'R', hl: number): Held {
  const h = norm(goal.fwd), p = norm(rej(goal.down, h)), t = scale(cross(p, h), side === 'L' ? 1 : -1);
  const wrist = sub(goal.palm, scale(h, hl * 0.55));
  const m = (v: ArrayLike<number>): V3 => [h[0] * v[0] + t[0] * v[1] + p[0] * v[2], h[1] * v[0] + t[1] * v[1] + p[1] * v[2], h[2] * v[0] + t[2] * v[1] + p[2] * v[2]];
  return { c: add(wrist, m(g.held.c)), a: m(g.held.a), r: g.held.r, h: g.held.h };
}
