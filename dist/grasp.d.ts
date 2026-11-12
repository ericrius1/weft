import { HandModel } from './fingers.js';
import { type V3 } from './math.js';
import type { HandGoal } from './rig.js';
export type GraspKind = 'wrap' | 'power' | 'stick' | 'bow' | 'pinch' | 'tripod' | 'stem' | 'flat' | 'rim' | 'clasp' | 'cloth';
export declare const GRASPS: GraspKind[];
/** what's held, in hand space or the world's: a capped cylinder about unit axis `a` through `c`, radius `r`, half
 *  length `h` (a disc when h is small), or a ball (h < 0) */
export interface Held {
    c: V3;
    a: V3;
    r: number;
    h: number;
}
/** the size asked: the radius (a cylinder's, a ball's, a disc's), its length, a disc's thickness */
export interface GraspSize {
    r?: number;
    len?: number;
    thick?: number;
}
/** the bow's hold (plan 'bow'): each finger's spread (index..little, rad; + toward the thumb). Drawn in toward the
 *  middle finger (Checkpoint M: real bowing hands' index-little fan ~25 deg, ours was 46 and read as a claw from above;
 *  0.5.0 had [0.12, 0, -0.04, -0.06]) */
export declare const BOW: {
    readonly spread: readonly number[];
};
/** the bow hold's rests per finger (index..little: knuckle, middle, end; rad), from real bow holds (plan 'bow') */
export declare const BOWREST: readonly (readonly number[])[];
/** a grasp solved: the hand's numbers (fingers.ts, palm's move 0), the held shape in hand space, and how well it holds:
 *  per finger (thumb first) the worst miss of the pads that should touch (m; 0 none asked), the deepest any skin goes
 *  into the shape (m, < 0 clear), the thumb's opposition (cos of the angle about the shape between the thumb's pad and
 *  the fingers' — -1 straight across), iterations spent */
export interface Grasp {
    kind: GraspKind;
    x: Float64Array;
    held: Held;
    touch: number[][];
    miss: number[];
    into: number;
    palmInto: number;
    opp: number;
    iters: number;
}
/** the drumstick's matched grip (plan 'stick'), as numbers a tool can try others for: the stick's way in hand space, the
 *  point at the heel of the hand it lies on (m at a 5.38 cm knuckle span; z off the palm's skin) and how far along from
 *  there its middle is, each finger's rest (MCP, PIP, DIP), the points (fingers.ts sample 0-6) that touch it and how far
 *  off they may sit, spreads, the index's point the thumb opposes, the arch, the thumb's rest */
export declare const STICK: {
    axis: number[];
    heel: number[];
    along: number;
    rest: number[][];
    on: number[][];
    gap: number[];
    spread: number[];
    restW: number;
    fulcrum: number;
    arch: number;
    thumb: number[];
};
/** the signed distance from p to the held shape's surface (m, < 0 inside) */
export declare function heldSd(H: Held, p: ArrayLike<number>): number;
/** solve one grasp: the hand's numbers that hold `kind` of `size` (hand M) */
export declare function grasp(M: HandModel, kind: GraspKind, size?: GraspSize): Grasp;
/** where the grasp puts the hand for a thing held in the world: `at` is where the grasp's shape centre goes, `axis` its
 *  axis there (which way the thumb's side of it points: a glass's up, a hammer's head end; a disc's or tray's normal
 *  out of the palm's side), and the palm comes to it from `from` (a direction round the axis; or, given `near`, the
 *  way round that puts the wrist nearest that point — a shoulder, a point below the elbow). `side` 'L' her left. `hl`
 *  the hand bone's length (the rig's: HandGoal.palm sits 0.55 of it along). The goal holds exactly, its fingers posed
 *  as solved (HandGoal.pose). */
export declare function graspGoal(M: HandModel, g: Grasp, side: 'L' | 'R', hl: number, w: {
    at: V3;
    axis: V3;
    from?: V3;
    near?: V3;
    w?: number;
}): HandGoal;
/** the held shape in the world for a hand placed by graspGoal (to draw it, or to test it) */
export declare function heldWorld(g: Grasp, goal: HandGoal, side: 'L' | 'R', hl: number): Held;
//# sourceMappingURL=grasp.d.ts.map