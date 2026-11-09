import type { V3 } from '../math.js';
import type { HeroAsset } from '../asset.js';
import { type JointName } from './anatomy.js';
export type M3 = number[];
/** Rp^T Rc */
export declare function relRot(p: M3, c: M3): M3;
/** the right side's mirrored into the left's (x flipped both sides) */
export declare const mirror: (R: M3) => M3;
/** R = Rx(a) Rz(b) Ry(c): [a, b, c] */
export declare function eulerXZY(R: M3): [number, number, number];
/** R = Rx(a) Ry(c) Rz(b): [a, b, c] */
export declare function eulerXYZ(R: M3): [number, number, number];
export interface Reading {
    joint: JointName;
    side: '' | 'L' | 'R';
    dof: string;
    /** the angle (radians) */
    v: number;
    /** past the comfortable band, as a fraction of the way to the limit (0 at ease, 1 at the limit) */
    strain: number;
    /** past its limit (a loaded joint's: its passive limit) */
    over: boolean;
    loaded?: boolean;
}
export interface BodyReading {
    joints: Reading[];
    /** the worst strain, and of what */
    worst: Reading | null;
    over: Reading[];
    /** the centre of mass (world), what's on the ground (world points), the centre's margin inside their hull (m: + in) */
    com: V3;
    support: V3[];
    margin: number | null;
}
export interface MeasureOpts {
    /** the body's flexibility (anatomy.ts FLEX) */
    flex?: number;
    female?: boolean;
    /** the ground under a point (for the support and what's loaded); none: nothing's on the ground */
    ground?: (x: number, z: number) => number;
    /** other support (a seat under the pelvis: its points, world) */
    seat?: V3[] | null;
    /** fingers too (default true) */
    fingers?: boolean;
}
/** a skeleton's bind frames and lengths, made once per asset */
export declare class Skeleton {
    readonly asset: HeroAsset;
    readonly bi: Record<string, number>;
    readonly frames: {
        o: V3;
        x: V3;
        y: V3;
        z: V3;
    }[];
    constructor(asset: HeroAsset);
    has(n: string): boolean;
    dir(n: string): V3;
    /** a bone's bind y (the 'up' it was posed with: the knee's front, the elbow's inside, the thumb's side) */
    up(n: string): V3;
}
/** every joint of a posed body read off its bones */
export declare function measure(sk: Skeleton, m: Float32Array, o?: MeasureOpts): BodyReading;
/** a point's signed distance inside the convex hull of points (m; + inside; one or two points: minus the distance to
 *  them) */
export declare function hullMargin(pts: [number, number][], p: [number, number]): number;
/** the convex hull, counter-clockwise (monotone chain) */
export declare function hull(pts: [number, number][]): [number, number][];
/** a reading's lines for a report: each DOF past its comfortable band (degrees, strain), worst first */
export declare function report(r: BodyReading, min?: number): string[];
//# sourceMappingURL=measure.d.ts.map