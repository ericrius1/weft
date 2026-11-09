// Vector helpers for the cast: weft's small vector math (the same definitions, here so the package has no runtime
// dependency: a V3 is weft's V3, a plain [x, y, z]), plus a rotation about an axis, eases, a smooth bump, a critically
// damped spring stepped exactly, and the second-order follower (t3ssel8r's) that gives hands and head their
// follow-through.
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a, b, x) => { const t = saturate((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** the turn from a to b, the short way round (-pi..pi) */
export const angDiff = (a, b) => wrapAngle(b - a);
/** v turned by a about the unit axis k (Rodrigues) */
export function rotateAxis(v, k, a) {
    const c = Math.cos(a), s = Math.sin(a);
    const kv = cross(k, v), kd = dot(k, v) * (1 - c);
    return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}
/** toward a target at rate k (1/s), frame-rate independent */
export const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
export const damp3 = (cur, target, k, dt) => {
    const t = 1 - Math.exp(-k * dt);
    return [cur[0] + (target[0] - cur[0]) * t, cur[1] + (target[1] - cur[1]) * t, cur[2] + (target[2] - cur[2]) * t];
};
export const ease = (t) => t * t * (3 - 2 * t);
/** the inverse of `ease` on 0..1: how far along a wind-up is for a value it has reached */
export const unease = (k) => { let a = 0, b = 1; for (let i = 0; i < 16; i++) {
    const m = (a + b) / 2;
    if (ease(m) < k)
        a = m;
    else
        b = m;
} return (a + b) / 2; };
/** flight's throttle on its way to the cruise (0..1 of its wind-up -> 0..1 of the way from the start's pace to the
 *  cruise's): barely past a hop's pace the first two seconds, for fine moves, then on up to the cruise as ever */
export const throttle = (t) => ease(t) ** 1.6;
/** the inverse of `throttle`: how far along the wind-up is for a pace it has reached */
export const unthrottle = (k) => unease(k ** (1 / 1.6));
/** minimum jerk 0..1: how a reaching hand or a swinging foot travels (zero velocity and acceleration at both ends) */
export const minJerk = (t) => { const u = t < 0 ? 0 : t > 1 ? 1 : t; return u * u * u * (10 - 15 * u + 6 * u * u); };
/** a half sine between a and b, else 0 */
export const bump = (u, a, b) => (u > a && u < b ? Math.sin(((u - a) / (b - a)) * Math.PI) : 0);
/** v with its part along the unit n taken out */
export const rej = (v, n) => { const d = dot(v, n); return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d]; };
/** a critically damped spring toward `target` (natural frequency w, 1/s), stepped exactly: the value and its velocity */
export function cdSpring(x, v, target, w, dt) {
    const e0 = x - target, ex = Math.exp(-w * dt), j = v + w * e0;
    return [target + (e0 + j * dt) * ex, (v - w * j * dt) * ex];
}
/** second-order follower: frequency f (Hz), damping z, response r (overshoot / anticipation) */
export class Spring3 {
    y;
    yd = [0, 0, 0];
    xp;
    k1;
    k2;
    k3;
    constructor(f, z, r, x0) {
        this.k1 = z / (Math.PI * f);
        this.k2 = 1 / ((2 * Math.PI * f) ** 2);
        this.k3 = (r * z) / (2 * Math.PI * f);
        this.y = [...x0];
        this.xp = [...x0];
    }
    reset(x) { this.y = [...x]; this.xp = [...x]; this.yd = [0, 0, 0]; }
    /** carry the state with a moving frame (flying, it follows her body, not the world) */
    shift(d) { for (let i = 0; i < 3; i++) {
        this.y[i] += d[i];
        this.xp[i] += d[i];
    } }
    update(dt, x) {
        const k2 = Math.max(this.k2, 1.1 * ((dt * dt) / 4 + (dt * this.k1) / 2), dt * this.k1);
        for (let i = 0; i < 3; i++) {
            const xd = (x[i] - this.xp[i]) / dt;
            this.y[i] += dt * this.yd[i];
            this.yd[i] += (dt * (x[i] + this.k3 * xd - this.y[i] - this.k1 * this.yd[i])) / k2;
        }
        this.xp = [...x];
        return [...this.y];
    }
}
//# sourceMappingURL=math.js.map