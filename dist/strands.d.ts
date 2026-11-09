import { type V3 } from './math.js';
export interface Capsule {
    a: V3;
    b: V3;
    r: number;
}
export interface ChainSpec {
    /** the root (world) and its rest way (world, unit) this frame — from the rig */
    root: () => {
        p: V3;
        dir: V3;
    };
    /** points (including the root) and the length between them */
    n: number;
    seg: number;
    /** the bend's spring at the root as a frequency (Hz): how fast a link swings back to its rest way (0: none, it
     *  hangs free); it falls off along the chain as (1 − i/n)^falloff */
    bend: number;
    falloff?: number;
    /** radius at the root and the tip (for drawing, and the collisions) */
    r0: number;
    r1: number;
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
export declare class Strands {
    readonly pts: Float32Array;
    private vel;
    private off;
    readonly specs: ChainSpec[];
    private first;
    /** each chain's root and rest way at the end of the last step (the sweep's start) */
    private roots;
    /** the longest substep (s) */
    maxStep: number;
    /** the most velocity (m/s) the constraints may add to a point in a substep (see step) */
    maxKick: number;
    constructor(specs: ChainSpec[]);
    /** the first point of chain c (its index in pts / 4) */
    start(c: number): number;
    get count(): number;
    /** lay every chain out along its rest way, still (the first frame, or after a jump) */
    reset(): void;
    /** a step of dt (s): `medium(p)` the air's or water's velocity at a point (m/s), the strands dragged toward it;
     *  `push(p)` an acceleration (m/s²); `caps` the body to keep out of */
    step(dt: number, caps: Capsule[], medium?: (p: V3) => V3, push?: ((p: V3) => V3) | null): void;
}
//# sourceMappingURL=strands.d.ts.map