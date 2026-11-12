// The hand as a hand: its fingers' and thumb's joints with a person's ranges, and a solver that places several
// fingertips at once (a chord on the keys, a chord shape on a neck, a stop on a string) with the palm free to move
// within the wrist's and the arm's ease.
//
// The joints (body/anatomy.ts gives the ranges and their sources):
//  - each finger's knuckle (MCP) bends and spreads (abduction: + toward the thumb), each within its own range, and two
//    neighbours part only as far as the web between them lets them; the middle (PIP) and end (DIP) joints bend, the
//    end joint mostly with the middle (its tendon: about 0.7 of it, Rijpkema & Girard 1991), not wholly;
//  - the thumb's saddle (CMC: flexion across the palm, abduction out of it, the metacarpal's turn coupled to both so the
//    pad comes round to face the fingers as the thumb opposes), its MCP and its IP;
//  - the palm's arch: the ring and little fingers' metacarpals bend at their bases (a cupped hand curves, a hand spread
//    flat on the keys flattens), one number for the hand;
//  - fingers enslaved as a person's are (a finger's knuckle drags its resting neighbours some way, and no finger is held
//    further from its neighbours' bend than they let it: the ring finger lifts ~30° clear, not more), and fingertips
//    kept a finger's breadth apart.
//
// Everything is in the hand's own frame ("hand space", the same for either hand: x along the hand from the wrist, y
// toward the thumb, z out of the palm), taken from the body's bind skeleton, so a hand of any size works and the left
// is the right's mirror. `solveHand` is Levenberg–Marquardt on residuals (each fingertip's miss in mm, each joint's
// pull toward its rest, the couplings, the palm's move): 27 numbers — the palm's place and turn (6), the arch, four per
// finger, four for the thumb — warm-started from last frame, joints held inside their ranges (projected), the
// Jacobian analytic for the hinges (a hinge's tip moves as its axis crossed with the lever) and by differences only
// for the thumb's saddle and the arch. A few iterations a frame; converged ones stop at once.
import type { HeroAsset } from './asset.js';
import { type V3, sub, dot, cross, norm, rej } from './math.js';
import { JOINTS, SPREAD, ENSLAVE } from './body/anatomy.js';

/** the hand's numbers: the palm's move (0-2, hand space, m), its turn (3-5: a rotation vector — roll about the hand's
 *  way, its pitch (the wrist's flexion), its yaw (the wrist's deviation)), the arch (6), each finger's spread, knuckle,
 *  middle and end joints (index 7-10, middle 11-14, ring 15-18, little 19-22), the thumb's saddle flexion and
 *  abduction, its MCP and IP (23-26) */
export const HAND_N = 27;
export const HP_ARCH = 6;
/** where finger f's numbers start (f 1 index .. 4 little; 0 the thumb) */
export const hpOf = (f: number) => (f === 0 ? 23 : 7 + 4 * (f - 1));
const FN = ['thumb', 'index', 'middle', 'ring', 'pinky'];
/** the arch: how far the ring and little metacarpals bend palmward (rad) and turn toward the thumb, per unit of it */
const ARCH_B = [0, 0, 0, 0.12, 0.26], ARCH_G = [0, 0, 0, 0.1, 0.22];
/** the thumb's metacarpal turned (pronated) with its saddle's flexion and abduction (rad per rad) */
const PRON_F = 0.55, PRON_A = 0.35;
/** the end joint's share of the middle's bend (its tendon) */
export const DIP_K = 0.7;

/** a 3-vector's length (Math.hypot is slow) */
const len3 = (a: number, b: number, c: number) => Math.sqrt(a * a + b * b + c * c);
const rodr = (o: Float64Array, i: number, vx: number, vy: number, vz: number, kx: number, ky: number, kz: number, c: number, s: number) => {
  const d = (kx * vx + ky * vy + kz * vz) * (1 - c);
  o[i] = vx * c + (ky * vz - kz * vy) * s + kx * d;
  o[i + 1] = vy * c + (kz * vx - kx * vz) * s + ky * d;
  o[i + 2] = vz * c + (kx * vy - ky * vx) * s + kz * d;
};

/** a finger's three bones' ways (v), their ups (u, or null) and the thumb's pad (q) turned by a about k */
function turnAll(v: Float64Array, u: Float64Array | null, q: Float64Array, kx: number, ky: number, kz: number, a: number) {
  if (a === 0) return;
  const c = Math.cos(a), s = Math.sin(a);
  for (let j = 0; j < 9; j += 3) { rodr(v, j, v[j], v[j + 1], v[j + 2], kx, ky, kz, c, s); if (u) rodr(u, j, u[j], u[j + 1], u[j + 2], kx, ky, kz, c, s); }
  rodr(q, 0, q[0], q[1], q[2], kx, ky, kz, c, s);
}
/** o at i turned about (k0, k1, k2) by (c, s), then about K by (cb, sb) */
function rodr2(o: Float64Array, i: number, k0: number, k1: number, k2: number, c: number, s: number, K: Float64Array, cb: number, sb: number) {
  rodr(o, i, o[i], o[i + 1], o[i + 2], k0, k1, k2, c, s);
  rodr(o, i, o[i], o[i + 1], o[i + 2], K[0], K[1], K[2], cb, sb);
}

/** one body's hand, from its bind skeleton */
export class HandModel {
  /** the hand bone and each finger's three (thumb first: metacarpal, proximal, distal; the others proximal, middle,
   *  distal) */
  readonly hb: number;
  readonly bones: number[][];
  /** the hand space in the bind's: the wrist, the hand's way, toward the thumb, out of the palm */
  readonly wrist: V3; readonly X: V3; readonly Y: V3; readonly Z: V3;
  /** the knuckles' width (index to little, m): the hand's own scale */
  readonly width: number;
  /** per finger (thumb first) in hand space: its base (the thumb's saddle, a finger's knuckle), its three bones' ways
   *  and their ups, the metacarpal's base and way (the arch turns about it) */
  readonly base = new Float64Array(15);
  readonly seg = new Float64Array(45);
  readonly up = new Float64Array(45);
  readonly piv = new Float64Array(15);
  readonly mAx = new Float64Array(15);
  readonly kAx = new Float64Array(15);
  /** the thumb's pad (the way it faces at the bind) and its saddle's abduction axis */
  readonly q0 = new Float64Array(3);
  readonly kAb = new Float64Array(3);
  /** each number's range */
  readonly lo = new Float64Array(HAND_N);
  readonly hi = new Float64Array(HAND_N);
  /** each number's comfortable band (past it, a held pose quickly costs: anatomy.ts's okLo/okHi) */
  readonly okLo = new Float64Array(HAND_N);
  readonly okHi = new Float64Array(HAND_N);
  /** the bind's finger lengths (m: thumb from its saddle, the others from the knuckle) */
  readonly lens = new Float64Array(5);

  private constructor(a: HeroAsset, T: 'L' | 'R', hb: number, ids: number[][]) {
    const side = T === 'L' ? 1 : -1;
    const H = a.bones[hb];
    this.hb = hb; this.bones = ids;
    const X = norm(sub(H.tail, H.head)), Y = norm(rej([0, 0, 1], X)), z = cross(X, Y);
    const Z: V3 = [z[0] * side, z[1] * side, z[2] * side];
    this.wrist = [...H.head] as V3; this.X = X; this.Y = Y; this.Z = Z;
    const toC = (p: V3, o: Float64Array, i: number, dir = false) => {
      const d = dir ? p : sub(p, H.head);
      o[i] = dot(d, X); o[i + 1] = dot(d, Y); o[i + 2] = dot(d, Z);
    };
    for (let f = 0; f < 5; f++) {
      const B = ids[f].map((i) => a.bones[i]);
      toC(B[0].head, this.base, f * 3);
      let L = 0;
      for (let k = 0; k < 3; k++) {
        const v = sub(B[k].tail, B[k].head);
        L += len3(v[0], v[1], v[2]);
        toC(v, this.seg, f * 9 + k * 3, true);
        toC(norm(B[k].up), this.up, f * 9 + k * 3, true);
      }
      this.lens[f] = L;
      // (a metacarpal: from near the wrist to the knuckle; the arch turns ring and little about their bases)
      const b = [this.base[f * 3], this.base[f * 3 + 1], this.base[f * 3 + 2]];
      for (let c = 0; c < 3; c++) this.piv[f * 3 + c] = b[c] * 0.18;
      const m = norm([b[0] * 0.82, b[1] * 0.82, b[2] * 0.82]);
      const k = norm(cross(m, [0, 0, 1]));
      this.mAx.set(m, f * 3); this.kAx.set(k, f * 3);
    }
    const kn = (f: number) => [this.base[f * 3], this.base[f * 3 + 1], this.base[f * 3 + 2]];
    const a1 = kn(1), a4 = kn(4);
    this.width = len3(a1[0] - a4[0], a1[1] - a4[1], a1[2] - a4[2]);
    // the thumb: its pad faces across the palm toward the fingers (away from the thumb's side, a little palmward)
    const t0 = norm([this.seg[0], this.seg[1], this.seg[2]]);
    this.q0.set(norm(rej([0.15, -1, 0.65], t0)));
    this.kAb.set(norm(cross(t0, [0, 0, 1])));
    // the ranges
    const k = this.width / 0.048;
    const set = (i: number, lo: number, hi: number, okLo = lo * 0.6, okHi = hi * 0.6) => { this.lo[i] = lo; this.hi[i] = hi; this.okLo[i] = okLo; this.okHi[i] = okHi; };
    const J = (d: { lo: number; hi: number; okLo: number; okHi: number }, i: number) => set(i, d.lo, d.hi, d.okLo, d.okHi);
    for (let c = 0; c < 3; c++) set(c, -0.06 * k, 0.06 * k);
    set(3, -0.55, 0.55); set(4, -0.55, 0.55); set(5, -0.5, 0.5);
    set(HP_ARCH, -0.25, 0.8, -0.1, 0.5);
    for (let f = 1; f <= 4; f++) {
      const o = hpOf(f);
      set(o, SPREAD.abd[f - 1][0], SPREAD.abd[f - 1][1]);
      J(JOINTS.mcp.flex, o + 1); J(JOINTS.pip.flex, o + 2); J(JOINTS.dip.flex, o + 3);
    }
    J(JOINTS.cmc.flex, 23); J(JOINTS.cmc.abd, 24); J(JOINTS.thumbMcp.flex, 25); J(JOINTS.thumbIp.flex, 26);
  }

  /** a body's hand ('L' her left), or null if its fingers aren't each three bones */
  static of(a: HeroAsset, T: 'L' | 'R'): HandModel | null {
    const hb = a.index['hand' + T];
    if (hb === undefined) return null;
    const ids = FN.map((f) => [1, 2, 3].map((j) => a.index[f + j + T]));
    if (ids.some((r) => r.some((i) => i === undefined))) return null;
    return new HandModel(a, T, hb, ids);
  }

  /** a hand-space point in the bind's (o, at i) */
  bindOf(c: ArrayLike<number>, i: number, o: number[] | Float64Array, dir = false) {
    const X = this.X, Y = this.Y, Z = this.Z, w = dir ? [0, 0, 0] : this.wrist;
    for (let k = 0; k < 3; k++) o[k] = w[k] + X[k] * c[i] + Y[k] * c[i + 1] + Z[k] * c[i + 2];
  }

  private sv = new Float64Array(9); private su = new Float64Array(9); private sz = new Float64Array(3); private sq = new Float64Array(3);
  private sb = new Float64Array(3); private sk = new Float64Array(3); private sm = new Float64Array(3);
  /** finger f posed by the numbers x, before the palm's move: its four joints (P: base, the two between, the tip; 12),
   *  each bone's up (U: 9, or null), the axis its hinges turn about (K), and (fingers) the axis it spreads about (Zf) */
  fk(x: ArrayLike<number>, f: number, P: Float64Array, U: Float64Array | null, K: Float64Array, Zf: Float64Array) {
    const v = this.sv, u = this.su, zf = this.sz, b = this.sb;
    v.set(this.seg.subarray(f * 9, f * 9 + 9));
    if (U) u.set(this.up.subarray(f * 9, f * 9 + 9));
    b[0] = this.base[f * 3]; b[1] = this.base[f * 3 + 1]; b[2] = this.base[f * 3 + 2];
    zf[0] = 0; zf[1] = 0; zf[2] = 1;
    if (f === 0) {
      // the saddle: abducted out of the palm, flexed across it, the metacarpal turned with both
      const ca = x[24], cf = x[23];
      const ka = this.kAb, q = this.sq, m = this.sm;
      q.set(this.q0);
      turnAll(v, U ? u : null, q, ka[0], ka[1], ka[2], ca);
      turnAll(v, U ? u : null, q, 0, 0, -1, cf);
      const l0 = len3(v[0], v[1], v[2]);
      m[0] = v[0] / l0; m[1] = v[1] / l0; m[2] = v[2] / l0;
      turnAll(v, U ? u : null, q, m[0], m[1], m[2], PRON_F * cf + PRON_A * ca);
      // the MCP and the IP hinge toward the pad
      let kx = v[1] * q[2] - v[2] * q[1], ky = v[2] * q[0] - v[0] * q[2], kz = v[0] * q[1] - v[1] * q[0];
      const kl = len3(kx, ky, kz) || 1; kx /= kl; ky /= kl; kz /= kl;
      K[0] = kx; K[1] = ky; K[2] = kz;
      Zf[0] = q[0]; Zf[1] = q[1]; Zf[2] = q[2];
      const a1 = x[25], a2 = x[25] + x[26];
      P[0] = b[0]; P[1] = b[1]; P[2] = b[2];
      P[3] = P[0] + v[0]; P[4] = P[1] + v[1]; P[5] = P[2] + v[2];
      let c = Math.cos(a1), s = Math.sin(a1);
      rodr(v, 3, v[3], v[4], v[5], kx, ky, kz, c, s);
      if (U) { for (let j = 0; j < 3; j++) U[j] = u[j]; rodr(U, 3, u[3], u[4], u[5], kx, ky, kz, c, s); }
      P[6] = P[3] + v[3]; P[7] = P[4] + v[4]; P[8] = P[5] + v[5];
      c = Math.cos(a2); s = Math.sin(a2);
      rodr(v, 6, v[6], v[7], v[8], kx, ky, kz, c, s);
      if (U) rodr(U, 6, u[6], u[7], u[8], kx, ky, kz, c, s);
      P[9] = P[6] + v[6]; P[10] = P[7] + v[7]; P[11] = P[8] + v[8];
      return;
    }
    const o = hpOf(f);
    // the arch: the metacarpal bent palmward at its base and turned toward the thumb (ring and little)
    const ar = x[HP_ARCH];
    if (ARCH_B[f] && ar !== 0) {
      const m0 = this.mAx[f * 3], m1 = this.mAx[f * 3 + 1], m2 = this.mAx[f * 3 + 2];
      const p0 = this.piv[f * 3], p1 = this.piv[f * 3 + 1], p2 = this.piv[f * 3 + 2];
      const g = ARCH_G[f] * ar, be = ARCH_B[f] * ar;
      // (rolled about the metacarpal's way, then bent about its own hinge, turned with it)
      const k = this.sk;
      const cg = Math.cos(g), sg = Math.sin(g);
      rodr(k, 0, this.kAx[f * 3], this.kAx[f * 3 + 1], this.kAx[f * 3 + 2], -m0, -m1, -m2, cg, sg);
      const cb = Math.cos(be), sb = Math.sin(be);
      for (let j = 0; j < 9; j += 3) { rodr2(v, j, -m0, -m1, -m2, cg, sg, k, cb, sb); if (U) rodr2(u, j, -m0, -m1, -m2, cg, sg, k, cb, sb); }
      rodr2(zf, 0, -m0, -m1, -m2, cg, sg, k, cb, sb);
      b[0] -= p0; b[1] -= p1; b[2] -= p2;
      rodr2(b, 0, -m0, -m1, -m2, cg, sg, k, cb, sb);
      b[0] += p0; b[1] += p1; b[2] += p2;
    }
    // the spread, about the palm's normal (as the arch has turned it)
    const al = x[o];
    if (al !== 0) {
      const c = Math.cos(al), s = Math.sin(al);
      for (let j = 0; j < 9; j += 3) { rodr(v, j, v[j], v[j + 1], v[j + 2], zf[0], zf[1], zf[2], c, s); if (U) rodr(u, j, u[j], u[j + 1], u[j + 2], zf[0], zf[1], zf[2], c, s); }
    }
    Zf[0] = zf[0]; Zf[1] = zf[1]; Zf[2] = zf[2];
    // the hinges: about the knuckle's axis (the first bone's way crossed with the palm's normal: bending toward the palm)
    let kx = v[1] * zf[2] - v[2] * zf[1], ky = v[2] * zf[0] - v[0] * zf[2], kz = v[0] * zf[1] - v[1] * zf[0];
    const kl = len3(kx, ky, kz) || 1; kx /= kl; ky /= kl; kz /= kl;
    K[0] = kx; K[1] = ky; K[2] = kz;
    P[0] = b[0]; P[1] = b[1]; P[2] = b[2];
    let a = 0;
    for (let j = 0; j < 3; j++) {
      a += x[o + 1 + j];
      const c = Math.cos(a), s = Math.sin(a);
      rodr(v, j * 3, v[j * 3], v[j * 3 + 1], v[j * 3 + 2], kx, ky, kz, c, s);
      if (U) rodr(U, j * 3, u[j * 3], u[j * 3 + 1], u[j * 3 + 2], kx, ky, kz, c, s);
      P[j * 3 + 3] = P[j * 3] + v[j * 3]; P[j * 3 + 4] = P[j * 3 + 1] + v[j * 3 + 1]; P[j * 3 + 5] = P[j * 3 + 2] + v[j * 3 + 2];
    }
  }
}

/** what's asked of a hand this frame (all in hand space): each fingertip's target (thumb first; 15) and how much it
 *  counts (0: none), each number's rest and how much it's drawn there, how free the palm is (0 held where it is) */
export interface HandAsk {
  tgt: Float64Array; w: Float64Array;
  rest: Float64Array; wr: Float64Array;
  free: number;
  /** a resting finger's knuckle dragged by its neighbours (enslaving): set by solveHand's caller per finger (1: rests) */
  resting: Uint8Array;
  /** a surface under the hand (the keys' tops, a fingerboard): its normal and offset (n·p = d on it, hand space) and how
   *  far clear of it a fingertip without a target keeps (m; 0: no surface) */
  floor: Float64Array; clear: number;
}
export const handAsk = (): HandAsk => ({ tgt: new Float64Array(15), w: new Float64Array(5), rest: new Float64Array(HAND_N), wr: new Float64Array(HAND_N), free: 0, resting: new Uint8Array(5),
  floor: new Float64Array(4), clear: 0 });

/** a hand's solve carried frame to frame: its numbers, the damping, each fingertip's miss after (m) */
export class HandSolve {
  x = new Float64Array(HAND_N);
  lam = 1e-3;
  ready = false;
  miss = new Float64Array(5);
  /** iterations taken last solve */
  iters = 0;
  // scratch
  readonly P = new Float64Array(60); readonly K = new Float64Array(15); readonly Zf = new Float64Array(15);
  readonly T = new Float64Array(15);
  readonly J = new Float64Array(5 * 3 * HAND_N);
  readonly H = new Float64Array(HAND_N * HAND_N); readonly g = new Float64Array(HAND_N);
  readonly A = new Float64Array(HAND_N * HAND_N); readonly dx = new Float64Array(HAND_N); readonly xn = new Float64Array(HAND_N);
  readonly R = new Float64Array(9); readonly Rd = new Float64Array(27);
  readonly fP = new Float64Array(12); readonly fK = new Float64Array(3); readonly fZ = new Float64Array(3);
  readonly xt = new Float64Array(HAND_N); readonly b = new Float64Array(HAND_N); readonly act = new Int32Array(HAND_N);
}

/** the rotation vector w as a matrix (row-major) */
function rotM(w0: number, w1: number, w2: number, R: Float64Array, o = 0) {
  const a = len3(w0, w1, w2);
  if (a < 1e-9) { R.fill(0, o, o + 9); R[o] = R[o + 4] = R[o + 8] = 1; return; }
  const k0 = w0 / a, k1 = w1 / a, k2 = w2 / a, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  R[o] = c + k0 * k0 * t; R[o + 1] = k0 * k1 * t - k2 * s; R[o + 2] = k0 * k2 * t + k1 * s;
  R[o + 3] = k1 * k0 * t + k2 * s; R[o + 4] = c + k1 * k1 * t; R[o + 5] = k1 * k2 * t - k0 * s;
  R[o + 6] = k2 * k0 * t - k1 * s; R[o + 7] = k2 * k1 * t + k0 * s; R[o + 8] = c + k2 * k2 * t;
}

/** the weights: a fingertip's miss (per mm), the end joint's tendon, the webs and the enslaving bands (hinges past
 *  them), fingertips a finger's breadth apart, the palm's move (per its scale) and turn */
const W_FLOOR = 1, W_BAND = 6, W_DIP = 4, W_WEB = 15, W_APART = 12, W_GAP = 0.6, W_PALM = 0.7, PALM_M = 0.02, PALM_R = 0.45;
/** the fingertips kept this far apart (a share of the knuckles' width) */
const GAP = 0.26;

// (the numbers each fingertip moves with — the palm's when it's free, the arch for ring and little, its own four — and
// those of two neighbouring fingertips together)
const COLS: Int32Array[][] = [0, 1].map((free) => [0, 1, 2, 3, 4].map((f) => {
  const o = f === 0 ? 23 : 7 + 4 * (f - 1), c: number[] = [];
  if (free) c.push(0, 1, 2, 3, 4, 5);
  if (f >= 3) c.push(HP_ARCH);
  c.push(o, o + 1, o + 2, o + 3);
  return Int32Array.from(c);
}));
const COLS2: Int32Array[][] = [0, 1].map((free) => [0, 1, 2].map((f) => Int32Array.from([...new Set([...COLS[free][f + 1], ...COLS[free][f + 2]])])));
/** the scratch for one row's gradient over its columns */
const GR = new Float64Array(HAND_N);

/** a residual r on one number (gradient ci) into the normal equations */
function acc1(H: Float64Array, g: Float64Array, r: number, i: number, ci: number) {
  H[i * HAND_N + i] += ci * ci; g[i] += ci * r;
}
/** a residual r on two numbers */
function acc2(H: Float64Array, g: Float64Array, r: number, i: number, ci: number, j: number, cj: number) {
  const N = HAND_N;
  H[i * N + i] += ci * ci; H[j * N + j] += cj * cj; H[i * N + j] += ci * cj; H[j * N + i] += ci * cj;
  g[i] += ci * r; g[j] += cj * r;
}
/** a residual r with its gradient in GR over the columns C */
function accRow(H: Float64Array, g: Float64Array, r: number, C: Int32Array) {
  const N = HAND_N;
  for (let a = 0; a < C.length; a++) {
    const ca = C[a], ga = GR[ca];
    if (ga === 0) continue;
    g[ca] += ga * r;
    const o = ca * N;
    for (let b = 0; b < C.length; b++) H[o + C[b]] += ga * GR[C[b]];
  }
}

/** the cost, and with `jac` the normal equations (H, g) — the residuals each pass adds:
 *  fingertips' misses, each number's rest, the end joints' tendon, the webs, the enslaving, the tips' gaps, a surface,
 *  the palm */
function pass(M: HandModel, S: HandSolve, Q: HandAsk, x: Float64Array, jac: boolean): number {
  const P = S.P, K = S.K, Zf = S.Zf, T = S.T, R = S.R, J = S.J, H = S.H, g = S.g, N = HAND_N, fP = S.fP;
  rotM(x[3], x[4], x[5], R);
  for (let f = 0; f < 5; f++) {
    M.fk(x, f, fP, null, S.fK, S.fZ);
    P.set(fP, f * 12); K.set(S.fK, f * 3); Zf.set(S.fZ, f * 3);
    const l0 = fP[9], l1 = fP[10], l2 = fP[11];
    T[f * 3] = x[0] + R[0] * l0 + R[1] * l1 + R[2] * l2;
    T[f * 3 + 1] = x[1] + R[3] * l0 + R[4] * l1 + R[5] * l2;
    T[f * 3 + 2] = x[2] + R[6] * l0 + R[7] * l1 + R[8] * l2;
  }
  const free = Q.free > 0 ? 1 : 0;
  let cost = 0;
  if (jac) {
    H.fill(0); g.fill(0); J.fill(0);
    // each fingertip's Jacobian (3 x N rows; only its own numbers, the arch's and the palm's are non-zero)
    const Rd = S.Rd, xt = S.xt;
    if (free) { rotM(x[3] + 1e-5, x[4], x[5], Rd, 0); rotM(x[3], x[4] + 1e-5, x[5], Rd, 9); rotM(x[3], x[4], x[5] + 1e-5, Rd, 18); }
    for (let f = 0; f < 5; f++) {
      const jb = f * 3 * N, pb = f * 12, l0 = P[pb + 9], l1 = P[pb + 10], l2 = P[pb + 11];
      if (free) {
        J[jb] = 1; J[jb + N + 1] = 1; J[jb + 2 * N + 2] = 1;
        const r0 = R[0] * l0 + R[1] * l1 + R[2] * l2, r1 = R[3] * l0 + R[4] * l1 + R[5] * l2, r2 = R[6] * l0 + R[7] * l1 + R[8] * l2;
        for (let k = 0; k < 3; k++) {
          const o = k * 9;
          J[jb + 3 + k] = (Rd[o] * l0 + Rd[o + 1] * l1 + Rd[o + 2] * l2 - r0) / 1e-5;
          J[jb + N + 3 + k] = (Rd[o + 3] * l0 + Rd[o + 4] * l1 + Rd[o + 5] * l2 - r1) / 1e-5;
          J[jb + 2 * N + 3 + k] = (Rd[o + 6] * l0 + Rd[o + 7] * l1 + Rd[o + 8] * l2 - r2) / 1e-5;
        }
      }
      const k0 = K[f * 3], k1 = K[f * 3 + 1], k2 = K[f * 3 + 2];
      // (a hinge at joint j: the tip turns about its axis, the lever from j to the tip; turned with the palm)
      for (let j = f === 0 ? 1 : 0; j < 3; j++) {
        const c = f === 0 ? 24 + j : hpOf(f) + 1 + j;
        const r0 = l0 - P[pb + j * 3], r1 = l1 - P[pb + j * 3 + 1], r2 = l2 - P[pb + j * 3 + 2];
        const d0 = k1 * r2 - k2 * r1, d1 = k2 * r0 - k0 * r2, d2 = k0 * r1 - k1 * r0;
        J[jb + c] = R[0] * d0 + R[1] * d1 + R[2] * d2; J[jb + N + c] = R[3] * d0 + R[4] * d1 + R[5] * d2; J[jb + 2 * N + c] = R[6] * d0 + R[7] * d1 + R[8] * d2;
      }
      // (a finger's spread: the whole finger turns about the palm's normal through its knuckle)
      if (f > 0) {
        const c = hpOf(f), z0 = Zf[f * 3], z1 = Zf[f * 3 + 1], z2 = Zf[f * 3 + 2];
        const r0 = l0 - P[pb], r1 = l1 - P[pb + 1], r2 = l2 - P[pb + 2];
        const d0 = z1 * r2 - z2 * r1, d1 = z2 * r0 - z0 * r2, d2 = z0 * r1 - z1 * r0;
        J[jb + c] = R[0] * d0 + R[1] * d1 + R[2] * d2; J[jb + N + c] = R[3] * d0 + R[4] * d1 + R[5] * d2; J[jb + 2 * N + c] = R[6] * d0 + R[7] * d1 + R[8] * d2;
      }
      // (by differences: the thumb's saddle, the arch)
      for (let q = 0; q < 2; q++) {
        const c = f === 0 ? 23 + q : f >= 3 && q === 0 ? HP_ARCH : -1;
        if (c < 0) continue;
        xt.set(x); xt[c] += 1e-5;
        M.fk(xt, f, fP, null, S.fK, S.fZ);
        const d0 = (fP[9] - l0) / 1e-5, d1 = (fP[10] - l1) / 1e-5, d2 = (fP[11] - l2) / 1e-5;
        J[jb + c] = R[0] * d0 + R[1] * d1 + R[2] * d2; J[jb + N + c] = R[3] * d0 + R[4] * d1 + R[5] * d2; J[jb + 2 * N + c] = R[6] * d0 + R[7] * d1 + R[8] * d2;
      }
    }
  }
  // the fingertips' misses (per mm)
  for (let f = 0; f < 5; f++) {
    const w = Q.w[f];
    if (w <= 0) continue;
    const C = COLS[free][f];
    for (let k = 0; k < 3; k++) {
      const r = 1000 * w * (T[f * 3 + k] - Q.tgt[f * 3 + k]);
      cost += r * r;
      if (!jac) continue;
      const jr = f * 3 * N + k * N;
      for (let a = 0; a < C.length; a++) GR[C[a]] = 1000 * w * J[jr + C[a]];
      accRow(H, g, r, C);
    }
  }
  // each number's rest (a resting finger's knuckle dragged by its neighbours' bend from their rests)
  for (let i = 6; i < N; i++) {
    const w = Q.wr[i];
    if (w <= 0) continue;
    const f = i >= 23 ? 0 : 1 + ((i - 7) >> 2);
    if (f > 0 && Q.resting[f] && i === hpOf(f) + 1) {
      // (one residual per neighbour, each with its share of the pull)
      const n = (f > 1 ? 1 : 0) + (f < 4 ? 1 : 0), h = w / Math.sqrt(n);
      for (let side = -1; side <= 1; side += 2) {
        const nf = f + side;
        if (nf < 1 || nf > 4) continue;
        const j = hpOf(nf) + 1, d = ENSLAVE.drag[side < 0 ? f - 2 : f - 1];
        const r = h * (x[i] - Q.rest[i] - d * (x[j] - Q.rest[j]));
        cost += r * r;
        if (jac) acc2(H, g, r, i, h, j, -h * d);
      }
      continue;
    }
    const r = w * (x[i] - Q.rest[i]);
    cost += r * r;
    if (jac) acc1(H, g, r, i, w);
  }
  // past each joint's comfortable band: a pose held there is an effort (the house's discomfort, anatomy.ts)
  for (let i = 6; i < N; i++) {
    const v = x[i], e = v > M.okHi[i] ? v - M.okHi[i] : v < M.okLo[i] ? v - M.okLo[i] : 0;
    if (e === 0) continue;
    const r = W_BAND * e;
    cost += r * r;
    if (jac) acc1(H, g, r, i, W_BAND);
  }
  // the end joints with the middle ones (the tendon)
  for (let f = 1; f <= 4; f++) {
    const o = hpOf(f), r = W_DIP * (x[o + 3] - DIP_K * x[o + 2]);
    cost += r * r;
    if (jac) acc2(H, g, r, o + 3, W_DIP, o + 2, -W_DIP * DIP_K);
  }
  // the webs: two neighbours' spreads no further apart than the web between them lets them, nor crossed; their bends
  // no further apart than the enslaving lets them
  for (let f = 1; f < 4; f++) {
    const a = hpOf(f), b = hpOf(f + 1), d = x[a] - x[b];
    const e = d > SPREAD.web[f - 1] ? d - SPREAD.web[f - 1] : d < -0.05 ? d + 0.05 : 0;
    if (e !== 0) { const r = W_WEB * e; cost += r * r; if (jac) acc2(H, g, r, a, W_WEB, b, -W_WEB); }
    const ka = a + 1, kb = b + 1, ee = x[ka] - x[kb], ap = ENSLAVE.apart[f - 1];
    const e2 = ee > ap ? ee - ap : ee < -ap ? ee + ap : 0;
    if (e2 !== 0) { const r = W_APART * e2; cost += r * r; if (jac) acc2(H, g, r, ka, W_APART, kb, -W_APART); }
  }
  // the fingertips a finger's breadth apart (neighbours)
  const gap = GAP * M.width;
  for (let f = 1; f < 4; f++) {
    const d0 = T[f * 3] - T[f * 3 + 3], d1 = T[f * 3 + 1] - T[f * 3 + 4], d2 = T[f * 3 + 2] - T[f * 3 + 5], d = len3(d0, d1, d2);
    if (d >= gap || d < 1e-6) continue;
    const r = 1000 * W_GAP * (gap - d);
    cost += r * r;
    if (!jac) continue;
    const u0 = d0 / d, u1 = d1 / d, u2 = d2 / d, C = COLS2[free][f - 1], ja = f * 3 * N, jb = (f + 1) * 3 * N;
    for (let a = 0; a < C.length; a++) {
      const c = C[a];
      GR[c] = -1000 * W_GAP * (u0 * (J[ja + c] - J[jb + c]) + u1 * (J[ja + N + c] - J[jb + N + c]) + u2 * (J[ja + 2 * N + c] - J[jb + 2 * N + c]));
    }
    accRow(H, g, r, C);
  }
  // a surface: the fingertips without a target clear of it
  if (Q.clear > 0) {
    const F = Q.floor;
    for (let f = 0; f < 5; f++) {
      const k = 1 - Math.min(1, Q.w[f]);
      if (k <= 0) continue;
      const h = F[0] * T[f * 3] + F[1] * T[f * 3 + 1] + F[2] * T[f * 3 + 2] - F[3];
      if (h >= Q.clear) continue;
      const w = 1000 * W_FLOOR * k, r = w * (Q.clear - h);
      cost += r * r;
      if (!jac) continue;
      const C = COLS[free][f], jb = f * 3 * N;
      for (let a = 0; a < C.length; a++) { const c = C[a]; GR[c] = -w * (F[0] * J[jb + c] + F[1] * J[jb + N + c] + F[2] * J[jb + 2 * N + c]); }
      accRow(H, g, r, C);
    }
  }
  // the palm: its move and turn from where the goal put it
  if (free) {
    const wm = W_PALM / (PALM_M * Q.free), wr = W_PALM / (PALM_R * Q.free);
    for (let k = 0; k < 3; k++) {
      const a = wm * x[k], b = wr * x[3 + k];
      cost += a * a + b * b;
      if (jac) { acc1(H, g, a, k, wm); acc1(H, g, b, 3 + k, wr); }
    }
  }
  return cost;
}

/** how many solves have run and their iterations (all; and those with the palm free): for tools */
export const SOLVES = { n: 0, iters: 0, n1: 0, iters1: 0 };

/** A x = b, A symmetric positive definite (n x n, row-major; Cholesky in place over A): false if it isn't */
function cholSolve(A: Float64Array, b: Float64Array, x: Float64Array, n: number): boolean {
  for (let j = 0; j < n; j++) {
    const rj = j * n;
    let s = A[rj + j];
    for (let k = 0; k < j; k++) s -= A[rj + k] * A[rj + k];
    if (s <= 1e-14) return false;
    const d = Math.sqrt(s), inv = 1 / d;
    A[rj + j] = d;
    for (let i = j + 1; i < n; i++) {
      const ri = i * n;
      let t = A[ri + j];
      for (let k = 0; k < j; k++) t -= A[ri + k] * A[rj + k];
      A[ri + j] = t * inv;
    }
  }
  for (let i = 0; i < n; i++) { const ri = i * n; let t = b[i]; for (let k = 0; k < i; k++) t -= A[ri + k] * x[k]; x[i] = t / A[ri + i]; }
  for (let i = n - 1; i >= 0; i--) { let t = x[i]; for (let k = i + 1; k < n; k++) t -= A[k * n + i] * x[k]; x[i] = t / A[i * n + i]; }
  return true;
}

/** the hand solved for what's asked: S.x updated in place (warm: from last frame's), at most `iters` iterations;
 *  returns the cost. The palm's numbers are held at 0 unless the ask frees it */
export function solveHand(M: HandModel, S: HandSolve, Q: HandAsk, iters = 4): number {
  const N = HAND_N, x = S.x, lo = M.lo, hi = M.hi, palm = Q.free > 0 ? 0 : 6;
  if (!S.ready) { x.set(Q.rest); for (let k = 0; k < 6; k++) x[k] = 0; S.ready = true; S.lam = 1e-3; }
  for (let i = 0; i < N; i++) x[i] = i < palm ? 0 : Math.min(hi[i], Math.max(lo[i], x[i]));
  let c = pass(M, S, Q, x, true), stale = false;
  let n = 0;
  const act = S.act, A = S.A, b = S.b, dx = S.dx, xn = S.xn, H = S.H, g = S.g;
  for (; n < iters; n++) {
    // (converged: every fingertip within a fifth of a millimetre and nothing pulling much)
    let worst = 0;
    for (let f = 0; f < 5; f++) if (Q.w[f] > 0) worst = Math.max(worst, len3(S.T[f * 3] - Q.tgt[f * 3], S.T[f * 3 + 1] - Q.tgt[f * 3 + 1], S.T[f * 3 + 2] - Q.tgt[f * 3 + 2]));
    let gm = 0;
    for (let i = palm; i < N; i++) gm = Math.max(gm, Math.abs(g[i]));
    if (worst < 0.0002 && gm < 0.004) break;
    // (the numbers free this step: a number at its limit and pulled past it is held there — projecting a step that
    // wanted it further would turn the step off its way and stall the fit)
    let m = 0;
    for (let i = palm; i < N; i++) if (!((x[i] <= lo[i] + 1e-9 && g[i] > 0) || (x[i] >= hi[i] - 1e-9 && g[i] < 0))) act[m++] = i;
    let ok = false, gain = 0;
    for (let t = 0; t < 5 && !ok; t++) {
      for (let a = 0; a < m; a++) {
        const ia = act[a] * N;
        for (let q = 0; q < m; q++) A[a * m + q] = H[ia + act[q]];
        A[a * m + a] += S.lam * (H[ia + act[a]] + 1e-3);
        b[a] = -g[act[a]];
      }
      if (!cholSolve(A, b, dx, m)) { S.lam *= 10; continue; }
      // (a step no bigger than a quarter radian or two centimetres: it walks to the pose)
      let big = 0;
      for (let a = 0; a < m; a++) big = Math.max(big, Math.abs(dx[a]) / (act[a] < 3 ? 0.02 : 0.25));
      const k = big > 1 ? 1 / big : 1;
      xn.set(x);
      for (let a = 0; a < m; a++) { const i = act[a]; xn[i] = Math.min(hi[i], Math.max(lo[i], x[i] + dx[a] * k)); }
      const cn = pass(M, S, Q, xn, false);
      if (cn < c) { gain = (c - cn) / Math.max(c, 1e-9); x.set(xn); c = cn; ok = true; stale = false; S.lam = Math.max(1e-6, S.lam / 4); }
      else { S.lam = Math.min(1e6, S.lam * 6); stale = true; }
    }
    if (!ok) break;
    // (settled: the last step bought less than a hundredth of the cost — what's left is the targets' own compromise)
    if (gain < 0.01) { n++; break; }
    c = pass(M, S, Q, x, true);
  }
  S.iters = n;
  SOLVES.n++; SOLVES.iters += n; if (Q.free > 0) { SOLVES.n1++; SOLVES.iters1 += n; }
  // (the misses where it ended: a rejected trial left its own tips in S.T)
  if (stale) pass(M, S, Q, x, false);
  for (let f = 0; f < 5; f++) S.miss[f] = len3(S.T[f * 3] - Q.tgt[f * 3], S.T[f * 3 + 1] - Q.tgt[f * 3 + 1], S.T[f * 3 + 2] - Q.tgt[f * 3 + 2]);
  return c;
}

/** the palm's move as solved (S.x 0-5) applied to a hand-space point (out at o) */
export function palmApply(S: HandSolve, p: ArrayLike<number>, i: number, out: Float64Array | number[], o = 0) {
  const R = S.R, x = S.x;
  rotM(x[3], x[4], x[5], R);
  const l0 = p[i], l1 = p[i + 1], l2 = p[i + 2];
  out[o] = x[0] + R[0] * l0 + R[1] * l1 + R[2] * l2;
  out[o + 1] = x[1] + R[3] * l0 + R[4] * l1 + R[5] * l2;
  out[o + 2] = x[2] + R[6] * l0 + R[7] * l1 + R[8] * l2;
}
