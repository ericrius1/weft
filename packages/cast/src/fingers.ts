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
import { type V3, sub, dot, cross, norm, rej, dsin, dcos } from './math.js';
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
/** the thumb's metacarpal turned (pronated: the pad coming round to face the fingers) with its saddle's flexion across
 *  the palm and its abduction out of it (rad per rad; a fifth as much the other way, as it extends or adducts). The
 *  saddle's flexion here turns the metacarpal about the palm's normal, which by itself swings the pad to face the
 *  wrist; so the turn that keeps it facing the fingers and brings it round to them is large: at the tip-to-tip
 *  opposition with the little finger the pad has turned ~100° from the rest, and the thumb's tip reaches the little
 *  finger's creases (Kapandji's test: 8 of 10, the last two within 3-6 mm; World tools/hands/kapandji.mjs). It was
 *  0.55 and 0.35, ~36° at full opposition: the pint's thumb lay along the glass, the pick's and the stem's ended on
 *  the fingers' side. */
const PRON = [2.0, 0.8, 0.2];
/** a hand that isn't a built one (no header.hand, no ring and little metacarpals: the older bodies, Drake's) keeps the
 *  saddle it had — its thumb's bones aren't where a built hand's are, and its projects' poses were made with it */
const PRON_OLD = [0.55, 0.35, 1], CMC_OLD = { flex: [-25, 45, -10, 25], abd: [-20, 32, -8, 18] }, TMCP_OLD = [-10, 56, 0, 35];
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
  const c = dcos(a), s = dsin(a);
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
  /** the ring and little fingers' metacarpal bones when the body has them (`ring0`, `pinky0`: a built hand, header.hand):
   *  their ids (-1 none; index by finger, 3 and 4) and their bind head, tail and up in hand space (9 each) — they turn
   *  with the arch, about their own heads */
  readonly mc = [-1, -1, -1, -1, -1];
  readonly mcB = new Float64Array(45);

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
      const mi = f >= 3 ? a.index[FN[f] + '0' + T] : undefined;
      if (mi !== undefined) {
        // (a metacarpal bone: the arch turns about its own base, the 4th or 5th carpometacarpal joint)
        const MB = a.bones[mi];
        this.mc[f] = mi;
        toC(MB.head, this.mcB, f * 9); toC(MB.tail, this.mcB, f * 9 + 3); toC(norm(MB.up), this.mcB, f * 9 + 6, true);
        for (let c = 0; c < 3; c++) this.piv[f * 3 + c] = this.mcB[f * 9 + c];
      }
      const m = mi !== undefined ? norm([b[0] - this.piv[f * 3], b[1] - this.piv[f * 3 + 1], b[2] - this.piv[f * 3 + 2]]) : norm([b[0] * 0.82, b[1] * 0.82, b[2] * 0.82]);
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
    this.built = !!(a.header as { hand?: unknown } | undefined)?.hand || this.mc[3] >= 0;
    if (!this.built) {
      const d = Math.PI / 180, S = (i: number, r: number[]) => set(i, r[0] * d, r[1] * d, r[2] * d, r[3] * d);
      S(23, CMC_OLD.flex); S(24, CMC_OLD.abd); S(25, TMCP_OLD);
    }
    // (a built hand's thumb reaches the little finger's base: Kapandji's 9th step needs the column's flexion to ~62° and
    // the MCP's to ~75° — within real thumbs' active ranges (Hume et al. 1990: MCP to the mid 70s in many); the
    // comfortable bands stay where they were)
    if (this.built) { this.hi[23] = 62 * Math.PI / 180; this.hi[25] = 75 * Math.PI / 180; }
    this.pron = this.built ? PRON : PRON_OLD;
    // (the palm's skin, sampled: a third and two thirds of the way from the wrist to each knuckle, and the thenar between
    // the thumb's saddle and the index's knuckle, each out on the palm's side by the palm's thickness there (13 mm at a
    // 5.38 cm knuckle span: World tools/hands/handgeo.mjs) — what a neck held in the hand must keep clear of)
    const pz = 0.013 * this.width / 0.0538, P: number[] = [];
    for (let f = 1; f <= 4; f++) for (const u of [0.35, 0.7]) P.push(this.base[f * 3] * u, this.base[f * 3 + 1] * u, this.base[f * 3 + 2] * u + pz);
    P.push((this.base[0] + this.base[3]) / 2, (this.base[1] + this.base[4]) / 2, (this.base[2] + this.base[5]) / 2 + pz * 0.8);
    this.palmPts = Float64Array.from(P);
  }
  /** the palm's skin sampled (hand space, before the palm's move; 3 per point): see the constructor */
  readonly palmPts: Float64Array;

  /** a body's hand ('L' her left), or null if its fingers aren't each three bones */
  static of(a: HeroAsset, T: 'L' | 'R'): HandModel | null {
    const hb = a.index['hand' + T];
    if (hb === undefined) return null;
    const ids = FN.map((f) => [1, 2, 3].map((j) => a.index[f + j + T]));
    if (ids.some((r) => r.some((i) => i === undefined))) return null;
    return new HandModel(a, T, hb, ids);
  }

  /** a built hand (its file's own, header.hand; or one with the ring and little metacarpals) */
  readonly built: boolean;
  private readonly pron: number[];
  /** the saddle's turn (pronation, rad) for its flexion cf and abduction ca */
  thumbPron(cf: number, ca: number) { const p = this.pron; return (cf > 0 ? p[0] : p[0] * p[2]) * cf + (ca > 0 ? p[1] : p[1] * p[2]) * ca; }

  private mq = new Float64Array(9); private mk2 = new Float64Array(3);
  /** finger f's metacarpal posed by the arch in x (hand space, before the palm's move): its head, tail and up (o, 9) */
  mcPose(x: ArrayLike<number>, f: number, o: Float64Array) {
    o.set(this.mcB.subarray(f * 9, f * 9 + 9));
    const ar = x[HP_ARCH];
    if (!ARCH_B[f] || ar === 0) return;
    const m0 = this.mAx[f * 3], m1 = this.mAx[f * 3 + 1], m2 = this.mAx[f * 3 + 2];
    const p0 = this.piv[f * 3], p1 = this.piv[f * 3 + 1], p2 = this.piv[f * 3 + 2];
    const g = ARCH_G[f] * ar, be = ARCH_B[f] * ar, k = this.mk2;
    const cg = dcos(g), sg = dsin(g), cb = dcos(be), sb = dsin(be);
    rodr(k, 0, this.kAx[f * 3], this.kAx[f * 3 + 1], this.kAx[f * 3 + 2], -m0, -m1, -m2, cg, sg);
    for (const j of [0, 3]) { o[j] -= p0; o[j + 1] -= p1; o[j + 2] -= p2; rodr2(o, j, -m0, -m1, -m2, cg, sg, k, cb, sb); o[j] += p0; o[j + 1] += p1; o[j + 2] += p2; }
    rodr2(o, 6, -m0, -m1, -m2, cg, sg, k, cb, sb);
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
      turnAll(v, U ? u : null, q, m[0], m[1], m[2], this.thumbPron(cf, ca));
      // the MCP and the IP hinge toward the pad
      let kx = v[1] * q[2] - v[2] * q[1], ky = v[2] * q[0] - v[0] * q[2], kz = v[0] * q[1] - v[1] * q[0];
      const kl = len3(kx, ky, kz) || 1; kx /= kl; ky /= kl; kz /= kl;
      K[0] = kx; K[1] = ky; K[2] = kz;
      Zf[0] = q[0]; Zf[1] = q[1]; Zf[2] = q[2];
      const a1 = x[25], a2 = x[25] + x[26];
      P[0] = b[0]; P[1] = b[1]; P[2] = b[2];
      P[3] = P[0] + v[0]; P[4] = P[1] + v[1]; P[5] = P[2] + v[2];
      let c = dcos(a1), s = dsin(a1);
      rodr(v, 3, v[3], v[4], v[5], kx, ky, kz, c, s);
      if (U) { for (let j = 0; j < 3; j++) U[j] = u[j]; rodr(U, 3, u[3], u[4], u[5], kx, ky, kz, c, s); }
      P[6] = P[3] + v[3]; P[7] = P[4] + v[4]; P[8] = P[5] + v[5];
      c = dcos(a2); s = dsin(a2);
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
      const cg = dcos(g), sg = dsin(g);
      rodr(k, 0, this.kAx[f * 3], this.kAx[f * 3 + 1], this.kAx[f * 3 + 2], -m0, -m1, -m2, cg, sg);
      const cb = dcos(be), sb = dsin(be);
      for (let j = 0; j < 9; j += 3) { rodr2(v, j, -m0, -m1, -m2, cg, sg, k, cb, sb); if (U) rodr2(u, j, -m0, -m1, -m2, cg, sg, k, cb, sb); }
      rodr2(zf, 0, -m0, -m1, -m2, cg, sg, k, cb, sb);
      b[0] -= p0; b[1] -= p1; b[2] -= p2;
      rodr2(b, 0, -m0, -m1, -m2, cg, sg, k, cb, sb);
      b[0] += p0; b[1] += p1; b[2] += p2;
    }
    // the spread, about the palm's normal (as the arch has turned it)
    const al = x[o];
    if (al !== 0) {
      const c = dcos(al), s = dsin(al);
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
      const c = dcos(a), s = dsin(a);
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
  /** how flat each finger is laid along the surface (HandGoal.lay): its middle joints held down on it too (a barre) */
  lay: Float64Array;
  free: number;
  /** a resting finger's knuckle dragged by its neighbours (enslaving): set by solveHand's caller per finger (1: rests) */
  resting: Uint8Array;
  /** a surface under the hand (the keys' tops, a fingerboard): its normal and offset (n·p = d on it, hand space) and how
   *  far clear of it a fingertip without a target keeps (m; 0: no surface) */
  floor: Float64Array; clear: number;
  /** a prior on the hand's own numbers (HAND_N from the arch on: 21) — real hands' mean and precision (body/handprior.ts:
   *  pianists' at the keys) — and how much it counts (0: none). With fingertips held on their targets, the rest of the
   *  hand takes the posture real hands have with those fingers there (the Gaussian's conditional mean) */
  priorMu: Float64Array | null; priorP: Float64Array | null; wp: number;
  /** a neck held in the hand (a guitar's, a violin's; HandGoal.neck), hand space: a point on the fingerboard's surface
   *  over the neck's middle (0-2), the neck's way (3-5), out of the fingerboard (6-8), across it (9-11), the board's half
   *  width (12), the neck's depth under it (13), the air the palm's skin keeps from the wood (14), the clearance of the
   *  knuckles' and joints' centres (15: a finger's half thickness, so the skin just touches), its weight (16; 0: none).
   *  The palm's skin, the knuckles and the fingers' and thumb's joints are kept off the wood (optional: absent, none) */
  neck?: Float64Array;
}
/** a neck's cross-section (HandAsk.neck): the signed distance (m) of a point u across and v out of the board from the
 *  wood — the board's flat top (half width a), the neck's back a half ellipse b deep — and its gradient (out[0..1]) */
function neckSd(u: number, v: number, a: number, b: number, out: Float64Array): number {
  if (v >= 0) {
    const au = Math.abs(u);
    if (au <= a) { out[0] = 0; out[1] = 1; return v; }
    const du = au - a, d = Math.sqrt(du * du + v * v) || 1e-9;
    out[0] = (u < 0 ? -du : du) / d; out[1] = v / d; return d;
  }
  const k = Math.sqrt((u * u) / (a * a) + (v * v) / (b * b)) || 1e-9;
  const gu = u / (a * a * k), gv = v / (b * b * k), gl = Math.sqrt(gu * gu + gv * gv) || 1e-9;
  const e = (k - 1) / gl;
  // (inside: the nearer of the back and the board's top)
  if (e < 0 && v > e) { out[0] = 0; out[1] = 1; return v; }
  out[0] = gu / gl; out[1] = gv / gl;
  return e;
}
const NSD = new Float64Array(2);
export const handAsk = (): HandAsk => ({ lay: new Float64Array(5), tgt: new Float64Array(15), w: new Float64Array(5), rest: new Float64Array(HAND_N), wr: new Float64Array(HAND_N), free: 0, resting: new Uint8Array(5),
  floor: new Float64Array(4), clear: 0, priorMu: null, priorP: null, wp: 0 });
/** the prior's numbers: HAND_N from the arch (6) on */
const PR0 = HP_ARCH, PRN = HAND_N - HP_ARCH;
const PRD = new Float64Array(PRN), PRPd = new Float64Array(PRN);

/** the prior's precision (PRN x PRN, row-major, in place in `o`) with finger f's knuckle, middle and end joints let go
 *  by k (0..1): o <- (1 - k) o + k S, S the Schur complement that marginalises those three numbers out (the Gaussian
 *  over the rest as if they weren't seen; their rows and columns 0). A finger the prior shouldn't shape (an idle one at
 *  the keys, held by its own rests instead) leaves the others' posture as real hands have it. + - * / only (the hands'
 *  determinism across engines) */
export function priorLetGo(o: Float64Array, f: number, k: number) {
  if (k <= 0) return;
  const n = PRN, b0 = hpOf(f) + 1 - PR0, B = [b0, b0 + 1, b0 + 2];
  // (the 3x3 block's inverse by its adjugate)
  const a = (i: number, j: number) => o[B[i] * n + B[j]];
  const c00 = a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1), c01 = a(0, 2) * a(2, 1) - a(0, 1) * a(2, 2), c02 = a(0, 1) * a(1, 2) - a(0, 2) * a(1, 1);
  const det = a(0, 0) * c00 + a(1, 0) * c01 + a(2, 0) * c02;
  if (!(Math.abs(det) > 1e-18)) return;
  const inv = [c00, c01, c02, a(1, 2) * a(2, 0) - a(1, 0) * a(2, 2), a(0, 0) * a(2, 2) - a(0, 2) * a(2, 0), a(0, 2) * a(1, 0) - a(0, 0) * a(1, 2),
    a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0), a(0, 1) * a(2, 0) - a(0, 0) * a(2, 1), a(0, 0) * a(1, 1) - a(0, 1) * a(1, 0)].map((v) => v / det);
  const PB = LG; // (n x 3: each row's coupling to the block, times the block's inverse)
  for (let i = 0; i < n; i++) for (let q = 0; q < 3; q++) PB[i * 3 + q] = o[i * n + B[0]] * inv[q] + o[i * n + B[1]] * inv[3 + q] + o[i * n + B[2]] * inv[6 + q];
  const inB = (i: number) => i === B[0] || i === B[1] || i === B[2];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = o[i * n + j];
    const s = inB(i) || inB(j) ? 0 : v - (PB[i * 3] * o[B[0] * n + j] + PB[i * 3 + 1] * o[B[1] * n + j] + PB[i * 3 + 2] * o[B[2] * n + j]);
    TMP[i * n + j] = v + (s - v) * k;
  }
  o.set(TMP);
}
const LG = new Float64Array(PRN * 3), TMP = new Float64Array(PRN * PRN);

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
  readonly R = new Float64Array(9); readonly Rd = new Float64Array(27); readonly Rq = new Float64Array(9);
  readonly fP = new Float64Array(12); readonly fK = new Float64Array(3); readonly fZ = new Float64Array(3);
  readonly xt = new Float64Array(HAND_N); readonly b = new Float64Array(HAND_N); readonly act = new Int32Array(HAND_N);
}

/** the rotation vector w as a matrix (row-major) */
function rotM(w0: number, w1: number, w2: number, R: Float64Array, o = 0) {
  const a = len3(w0, w1, w2);
  if (a < 1e-9) { R.fill(0, o, o + 9); R[o] = R[o + 4] = R[o + 8] = 1; return; }
  const k0 = w0 / a, k1 = w1 / a, k2 = w2 / a, c = dcos(a), s = dsin(a), t = 1 - c;
  R[o] = c + k0 * k0 * t; R[o + 1] = k0 * k1 * t - k2 * s; R[o + 2] = k0 * k2 * t + k1 * s;
  R[o + 3] = k1 * k0 * t + k2 * s; R[o + 4] = c + k1 * k1 * t; R[o + 5] = k1 * k2 * t - k0 * s;
  R[o + 6] = k2 * k0 * t - k1 * s; R[o + 7] = k2 * k1 * t + k0 * s; R[o + 8] = c + k2 * k2 * t;
}

/** the weights: a fingertip's miss (per mm), the end joint's tendon, the webs and the enslaving bands (hinges past
 *  them), fingertips a finger's breadth apart, the palm's move (per its scale) and turn */
const W_LAY = 0.6, W_FLOOR = 1, W_PALM = 0.7, PALM_M = 0.02, PALM_R = 0.45, W_NECK = 1;
const PALM6 = Int32Array.from([0, 1, 2, 3, 4, 5]);
/** the couplings' weights (read each solve; for tools that take one out to see what it does): the comfortable band,
 *  the end joint's tendon, the webs, the enslaving bands, the fingertips' gaps */
export const HAND_W = { band: 6, dip: 4, web: 15, apart: 12, gap: 0.6 };
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
  const W_BAND = HAND_W.band, W_DIP = HAND_W.dip, W_WEB = HAND_W.web, W_APART = HAND_W.apart, W_GAP = HAND_W.gap;
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
  // real hands' posture (a Gaussian prior on the hand's own numbers: cost wp^2 d'P d, d the numbers from the mean)
  if (Q.wp > 0 && Q.priorP && Q.priorMu) {
    const Pm = Q.priorP, mu = Q.priorMu, w2 = Q.wp * Q.wp;
    for (let i = 0; i < PRN; i++) PRD[i] = x[PR0 + i] - mu[i];
    let c2 = 0;
    for (let i = 0; i < PRN; i++) { let t = 0; const o = i * PRN; for (let j = 0; j < PRN; j++) t += Pm[o + j] * PRD[j]; PRPd[i] = t; c2 += t * PRD[i]; }
    cost += w2 * c2;
    if (jac) for (let i = 0; i < PRN; i++) {
      g[PR0 + i] += w2 * PRPd[i];
      const o = i * PRN, oh = (PR0 + i) * N + PR0;
      for (let j = 0; j < PRN; j++) H[oh + j] += w2 * Pm[o + j];
    }
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
  // a laid finger (a barre): its middle and end joints down on the surface as well as its tip, so the whole finger
  // lies along it (by differences: only for a laid finger)
  if (Q.clear > 0) {
    const F = Q.floor, xt = S.xt, fq = S.fP, Rq = S.Rq;
    for (let f = 1; f <= 4; f++) {
      const lay = Q.lay[f];
      if (lay <= 0) continue;
      const pb = f * 12, C = COLS[free][f];
      for (const jj of [1, 2]) {
        const hAt = (PP: Float64Array, o: number, RR: Float64Array, xx: Float64Array) => {
          const l0 = PP[o + jj * 3], l1 = PP[o + jj * 3 + 1], l2 = PP[o + jj * 3 + 2];
          const w0 = xx[0] + RR[0] * l0 + RR[1] * l1 + RR[2] * l2, w1 = xx[1] + RR[3] * l0 + RR[4] * l1 + RR[5] * l2, w2 = xx[2] + RR[6] * l0 + RR[7] * l1 + RR[8] * l2;
          return F[0] * w0 + F[1] * w1 + F[2] * w2 - F[3];
        };
        const h = hAt(P, pb, R, x), wl = 1000 * W_LAY * lay, r = wl * (h - Q.clear);
        cost += r * r;
        if (!jac) continue;
        for (let a = 0; a < C.length; a++) {
          const c = C[a];
          xt.set(x); xt[c] += 1e-5;
          M.fk(xt, f, fq, null, S.fK, S.fZ);
          rotM(xt[3], xt[4], xt[5], Rq);
          GR[c] = wl * (hAt(fq, 0, Rq, xt) - h) / 1e-5;
        }
        accRow(H, g, r, C);
      }
    }
  }
  // a neck held: the palm's skin, the knuckles and the fingers' and thumb's joints off its wood (a residual per point
  // inside its clearance, along the wood's normal; the palm's points move with the palm alone, the joints with their
  // finger's numbers too, by differences)
  const NK = Q.neck;
  if (NK && NK[16] > 0) {
    const wN = 1000 * W_NECK * NK[16], Rd = S.Rd;
    const sdAt = (p0: number, p1: number, p2: number) => {
      const e0 = p0 - NK[0], e1 = p1 - NK[1], e2 = p2 - NK[2];
      return neckSd(e0 * NK[9] + e1 * NK[10] + e2 * NK[11], e0 * NK[6] + e1 * NK[7] + e2 * NK[8], NK[12], NK[13], NSD);
    };
    // (the palm's skin: only the palm can move it)
    if (free) {
      const L = M.palmPts;
      for (let i = 0; i < L.length; i += 3) {
        const l0 = L[i], l1 = L[i + 1], l2 = L[i + 2];
        const p0 = x[0] + R[0] * l0 + R[1] * l1 + R[2] * l2, p1 = x[1] + R[3] * l0 + R[4] * l1 + R[5] * l2, p2 = x[2] + R[6] * l0 + R[7] * l1 + R[8] * l2;
        const s = sdAt(p0, p1, p2);
        if (s >= NK[14]) continue;
        const r = wN * (NK[14] - s);
        cost += r * r;
        if (!jac) continue;
        const n0 = NSD[0] * NK[9] + NSD[1] * NK[6], n1 = NSD[0] * NK[10] + NSD[1] * NK[7], n2 = NSD[0] * NK[11] + NSD[1] * NK[8];
        GR[0] = -wN * n0; GR[1] = -wN * n1; GR[2] = -wN * n2;
        for (let k = 0; k < 3; k++) {
          const o = k * 9;
          const d0 = (Rd[o] * l0 + Rd[o + 1] * l1 + Rd[o + 2] * l2 - (p0 - x[0])) / 1e-5, d1 = (Rd[o + 3] * l0 + Rd[o + 4] * l1 + Rd[o + 5] * l2 - (p1 - x[1])) / 1e-5, d2 = (Rd[o + 6] * l0 + Rd[o + 7] * l1 + Rd[o + 8] * l2 - (p2 - x[2])) / 1e-5;
          GR[3 + k] = -wN * (n0 * d0 + n1 * d1 + n2 * d2);
        }
        accRow(H, g, r, PALM6);
      }
    }
    // (each finger's knuckle and middle joint, the thumb's two joints)
    const xt = S.xt, fq = S.fP, Rq = S.Rq;
    for (let f = 0; f < 5; f++) {
      const pb = f * 12, C = COLS[free][f];
      for (const jj of f === 0 ? [1, 2] : [0, 1]) {
        const at = (PP: Float64Array, o: number, RR: Float64Array, xx: Float64Array) => {
          const l0 = PP[o + jj * 3], l1 = PP[o + jj * 3 + 1], l2 = PP[o + jj * 3 + 2];
          return sdAt(xx[0] + RR[0] * l0 + RR[1] * l1 + RR[2] * l2, xx[1] + RR[3] * l0 + RR[4] * l1 + RR[5] * l2, xx[2] + RR[6] * l0 + RR[7] * l1 + RR[8] * l2);
        };
        const s = at(P, pb, R, x);
        if (s >= NK[15]) continue;
        const r = wN * (NK[15] - s);
        cost += r * r;
        if (!jac) continue;
        for (let a = 0; a < C.length; a++) {
          const c = C[a];
          xt.set(x); xt[c] += 1e-5;
          M.fk(xt, f, fq, null, S.fK, S.fZ);
          rotM(xt[3], xt[4], xt[5], Rq);
          GR[c] = -wN * (at(fq, 0, Rq, xt) - s) / 1e-5;
        }
        accRow(H, g, r, C);
      }
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
