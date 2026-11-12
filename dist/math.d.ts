export type V3 = [number, number, number];
export declare const add: (a: ArrayLike<number>, b: ArrayLike<number>) => V3;
export declare const sub: (a: ArrayLike<number>, b: ArrayLike<number>) => V3;
export declare const scale: (a: ArrayLike<number>, s: number) => V3;
export declare const dot: (a: ArrayLike<number>, b: ArrayLike<number>) => number;
export declare const cross: (a: ArrayLike<number>, b: ArrayLike<number>) => V3;
export declare const len: (a: ArrayLike<number>) => number;
export declare const dist: (a: ArrayLike<number>, b: ArrayLike<number>) => number;
export declare const norm: (a: ArrayLike<number>) => V3;
export declare const lerp: (a: number, b: number, t: number) => number;
export declare const lerp3: (a: ArrayLike<number>, b: ArrayLike<number>, t: number) => V3;
export declare const clamp: (x: number, a: number, b: number) => number;
export declare const saturate: (x: number) => number;
export declare const smoothstep: (a: number, b: number, x: number) => number;
export declare const wrapAngle: (a: number) => number;
/** the turn from a to b, the short way round (-pi..pi) */
export declare const angDiff: (a: number, b: number) => number;
/** v turned by a about the unit axis k (Rodrigues) */
export declare function rotateAxis(v: V3, k: V3, a: number): V3;
/** sine, the same bits everywhere (|x| up to ~1e6) */
export declare function dsin(x: number): number;
/** cosine, the same bits everywhere */
export declare function dcos(x: number): number;
/** e^x, the same bits everywhere (-700..700) */
export declare function dexp(x: number): number;
/** arctangent, the same bits everywhere */
export declare function datan(x: number): number;
/** atan2(y, x), the same bits everywhere */
export declare function datan2(y: number, x: number): number;
/** rotateAxis with dsin/dcos: the same bits everywhere */
export declare function drotateAxis(v: V3, k: V3, a: number): V3;
/** a number held to a grid of 2^-30 (~1e-9): what an engine's own maths left in its last bits (a curl damped by
 *  Math.exp) gone before a solve that would carry and grow them (exact: a power of two, a round) */
export declare const q30: (x: number) => number;
/** damp with dexp: the same bits everywhere */
export declare const ddamp: (cur: number, target: number, k: number, dt: number) => number;
/** toward a target at rate k (1/s), frame-rate independent */
export declare const damp: (cur: number, target: number, k: number, dt: number) => number;
export declare const damp3: (cur: V3, target: V3, k: number, dt: number) => V3;
export declare const ease: (t: number) => number;
/** the inverse of `ease` on 0..1: how far along a wind-up is for a value it has reached */
export declare const unease: (k: number) => number;
/** flight's throttle on its way to the cruise (0..1 of its wind-up -> 0..1 of the way from the start's pace to the
 *  cruise's): barely past a hop's pace the first two seconds, for fine moves, then on up to the cruise as ever */
export declare const throttle: (t: number) => number;
/** the inverse of `throttle`: how far along the wind-up is for a pace it has reached */
export declare const unthrottle: (k: number) => number;
/** minimum jerk 0..1: how a reaching hand or a swinging foot travels (zero velocity and acceleration at both ends) */
export declare const minJerk: (t: number) => number;
/** a half sine between a and b, else 0 */
export declare const bump: (u: number, a: number, b: number) => number;
/** v with its part along the unit n taken out */
export declare const rej: (v: V3, n: V3) => V3;
/** a critically damped spring toward `target` (natural frequency w, 1/s), stepped exactly: the value and its velocity */
export declare function cdSpring(x: number, v: number, target: number, w: number, dt: number): [number, number];
/** second-order follower: frequency f (Hz), damping z, response r (overshoot / anticipation) */
export declare class Spring3 {
    y: V3;
    yd: V3;
    xp: V3;
    k1: number;
    k2: number;
    k3: number;
    constructor(f: number, z: number, r: number, x0: V3);
    reset(x: V3): void;
    /** carry the state with a moving frame (flying, it follows her body, not the world) */
    shift(d: V3): void;
    update(dt: number, x: V3): V3;
}
//# sourceMappingURL=math.d.ts.map