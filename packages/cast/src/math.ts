// Vector helpers for the cast: weft's small vector math (the same definitions, here so the package has no runtime
// dependency: a V3 is weft's V3, a plain [x, y, z]), plus a rotation about an axis, eases, a smooth bump, a critically
// damped spring stepped exactly, and the second-order follower (t3ssel8r's) that gives hands and head their
// follow-through.

export type V3 = [number, number, number];

export const add = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: ArrayLike<number>, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: ArrayLike<number>) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm = (a: ArrayLike<number>): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp3 = (a: ArrayLike<number>, b: ArrayLike<number>, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const saturate = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a: number, b: number, x: number) => { const t = saturate((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** the turn from a to b, the short way round (-pi..pi) */
export const angDiff = (a: number, b: number) => wrapAngle(b - a);

/** v turned by a about the unit axis k (Rodrigues) */
export function rotateAxis(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  const kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

// ---- the same last bit in every JS engine
// Math.sin, cos, exp, atan2... are each engine's own (Chrome 157 and Node 22 differ in the last bit of all but sqrt
// and hypot), and a solve that carries its numbers frame to frame in doubles (the hand's: fingers.ts) keeps those
// bits and grows them. These use only + - * / and sqrt, which IEEE fixes exactly, so a film rendered headless poses
// exactly as a visitor's browser does. fdlibm's kernels (Sun, 1993; their coefficients), Cody-Waite reduction.
const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11, INV_PIO2 = 6.36619772367581382433e-01;
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04, S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05, C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
const ksin = (x: number) => { const z = x * x; return x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6))))); };
const kcos = (x: number) => { const z = x * x; return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6))))); };
/** sine, the same bits everywhere (|x| up to ~1e6) */
export function dsin(x: number): number {
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return ksin(x);
  const n = Math.round(x * INV_PIO2), r = (x - n * PIO2_1) - n * PIO2_1T, q = n & 3;
  return q === 0 ? ksin(r) : q === 1 ? kcos(r) : q === 2 ? -ksin(r) : -kcos(r);
}
/** cosine, the same bits everywhere */
export function dcos(x: number): number {
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return kcos(x);
  const n = Math.round(x * INV_PIO2), r = (x - n * PIO2_1) - n * PIO2_1T, q = n & 3;
  return q === 0 ? kcos(r) : q === 1 ? -ksin(r) : q === 2 ? -kcos(r) : ksin(r);
}
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05, P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
const xf = new Float64Array(1), xi = new Uint32Array(xf.buffer);
/** e^x, the same bits everywhere (-700..700) */
export function dexp(x: number): number {
  if (x > 709) return Infinity;
  if (x < -708) return 0;
  const k = Math.round(x * INV_LN2), hi = x - k * LN2_HI, lo = k * LN2_LO, r = hi - lo, z = r * r;
  const c = r - z * (P1 + z * (P2 + z * (P3 + z * (P4 + z * P5))));
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  // (times 2^k, set straight into the exponent's bits)
  xi[0] = 0; xi[1] = (k + 1023) << 20;
  return y * xf[0];
}
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
const ATHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
/** arctangent, the same bits everywhere */
export function datan(x: number): number {
  const neg = x < 0; let a = neg ? -x : x, id = -1;
  if (a >= 0.4375) {
    if (a < 1.1875) { if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a); } else { id = 1; a = (a - 1) / (a + 1); } }
    else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a); } else { id = 3; a = -1 / a; }
  }
  const z = a * a, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  const r = id < 0 ? a - a * (s1 + s2) : ATHI[id] - ((a * (s1 + s2) - ATLO[id]) - a);
  return neg ? -r : r;
}
/** atan2(y, x), the same bits everywhere */
export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  if (x > 0) return datan(y / x);
  if (x === 0) return y > 0 ? 1.5707963267948966 : -1.5707963267948966;
  const t = datan(y / x);
  return y >= 0 ? t + 3.141592653589793 : t - 3.141592653589793;
}
/** rotateAxis with dsin/dcos: the same bits everywhere */
export function drotateAxis(v: V3, k: V3, a: number): V3 {
  const c = dcos(a), s = dsin(a);
  const kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}
/** a number held to a grid of 2^-30 (~1e-9): what an engine's own maths left in its last bits (a curl damped by
 *  Math.exp) gone before a solve that would carry and grow them (exact: a power of two, a round) */
export const q30 = (x: number) => Math.round(x * 1073741824) / 1073741824;
/** damp with dexp: the same bits everywhere */
export const ddamp = (cur: number, target: number, k: number, dt: number) => cur + (target - cur) * (1 - dexp(-k * dt));

/** toward a target at rate k (1/s), frame-rate independent */
export const damp = (cur: number, target: number, k: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-k * dt));
export const damp3 = (cur: V3, target: V3, k: number, dt: number): V3 => {
  const t = 1 - Math.exp(-k * dt);
  return [cur[0] + (target[0] - cur[0]) * t, cur[1] + (target[1] - cur[1]) * t, cur[2] + (target[2] - cur[2]) * t];
};
export const ease = (t: number) => t * t * (3 - 2 * t);
/** the inverse of `ease` on 0..1: how far along a wind-up is for a value it has reached */
export const unease = (k: number) => { let a = 0, b = 1; for (let i = 0; i < 16; i++) { const m = (a + b) / 2; if (ease(m) < k) a = m; else b = m; } return (a + b) / 2; };
/** flight's throttle on its way to the cruise (0..1 of its wind-up -> 0..1 of the way from the start's pace to the
 *  cruise's): barely past a hop's pace the first two seconds, for fine moves, then on up to the cruise as ever */
export const throttle = (t: number) => ease(t) ** 1.6;
/** the inverse of `throttle`: how far along the wind-up is for a pace it has reached */
export const unthrottle = (k: number) => unease(k ** (1 / 1.6));
/** minimum jerk 0..1: how a reaching hand or a swinging foot travels (zero velocity and acceleration at both ends) */
export const minJerk = (t: number) => { const u = t < 0 ? 0 : t > 1 ? 1 : t; return u * u * u * (10 - 15 * u + 6 * u * u); };
/** a half sine between a and b, else 0 */
export const bump = (u: number, a: number, b: number) => (u > a && u < b ? Math.sin(((u - a) / (b - a)) * Math.PI) : 0);
/** v with its part along the unit n taken out */
export const rej = (v: V3, n: V3): V3 => { const d = dot(v, n); return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d]; };

/** a critically damped spring toward `target` (natural frequency w, 1/s), stepped exactly: the value and its velocity */
export function cdSpring(x: number, v: number, target: number, w: number, dt: number): [number, number] {
  const e0 = x - target, ex = Math.exp(-w * dt), j = v + w * e0;
  return [target + (e0 + j * dt) * ex, (v - w * j * dt) * ex];
}

/** second-order follower: frequency f (Hz), damping z, response r (overshoot / anticipation) */
export class Spring3 {
  y: V3; yd: V3 = [0, 0, 0]; xp: V3;
  k1: number; k2: number; k3: number;
  constructor(f: number, z: number, r: number, x0: V3) {
    this.k1 = z / (Math.PI * f); this.k2 = 1 / ((2 * Math.PI * f) ** 2); this.k3 = (r * z) / (2 * Math.PI * f);
    this.y = [...x0] as V3; this.xp = [...x0] as V3;
  }
  reset(x: V3) { this.y = [...x] as V3; this.xp = [...x] as V3; this.yd = [0, 0, 0]; }
  /** carry the state with a moving frame (flying, it follows her body, not the world) */
  shift(d: V3) { for (let i = 0; i < 3; i++) { this.y[i] += d[i]; this.xp[i] += d[i]; } }
  update(dt: number, x: V3): V3 {
    const k2 = Math.max(this.k2, 1.1 * ((dt * dt) / 4 + (dt * this.k1) / 2), dt * this.k1);
    for (let i = 0; i < 3; i++) {
      const xd = (x[i] - this.xp[i]) / dt;
      this.y[i] += dt * this.yd[i];
      this.yd[i] += (dt * (x[i] + this.k3 * xd - this.y[i] - this.k1 * this.yd[i])) / k2;
    }
    this.xp = [...x] as V3;
    return [...this.y] as V3;
  }
}
