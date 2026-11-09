import { type V3 } from './math.js';
import type { HandGoal } from './rig.js';
export interface Implement {
    /** from the grip (the middle of the fist) to the head's centre (m) */
    reach: number;
    /** the head's radius (m): its surface meets the struck one */
    headR: number;
}
export interface StrokeSpec {
    /** contact time */
    t: number;
    /** the struck point on the surface (world), and the surface's normal there (out, toward the player) */
    at: V3;
    normal: V3;
    /** the head's way at contact (into the surface: dot(dir, normal) < 0), and its speed (m/s) */
    dir: V3;
    speed: number;
    /** the shaft's way at contact, grip → head (made perpendicular to dir) */
    shaft: V3;
    /** how far the shaft turns through the downswing (rad): a tap ~0.6, a full stroke ~1.4, overhead ~3 */
    cock: number;
    /** the downswing's length (s) */
    down: number;
    /** the share of the head's speed at contact that's the hand's own travel (0..1; the rest is the shaft's turn) */
    handShare: number;
    /** the hand at the top of the backswing (world) */
    top: V3;
    /** the lift from ready to the top (s), and the hang there before the downswing (s) */
    lift: number;
    hang: number;
    /** how long the head is on the surface (s), and how far it sinks into it at the deepest (m) */
    dwell: number;
    depth: number;
    /** the rebound's speed as a share of the strike's, and how long the way back to ready takes (s) */
    restitution: number;
    settle: number;
    /** where the hand rests after (world) and the shaft's way there; default: this stroke's top, lowered */
    ready?: {
        hand: V3;
        shaft: V3;
    };
    /** the chain's lag: each link of the chain this share of the downswing after the one before (default 0.1) */
    lag?: number;
    /** how long the hand takes to lose its speed after contact (s, default 0.12), and how far its follow carries it
     *  past the contact point along the stroke's way (m, default from its speed) */
    follow?: number;
    followDist?: number;
    /** the hand's speed leaving the top into the downswing, as a share of the downswing's mean speed (default 0.25: the
     *  elbow leading the hand down out of the top) */
    topFlow?: number;
    /** the least exponent of the shaft's turn through the downswing (its angle as s^p; default 2.2: from rest, fastest
     *  at contact — a whip) */
    whip?: number;
    /** how much further back the shaft lays early in the downswing as the hand starts down without it (rad, default
     *  0.22): the head lagging the hand, then snapping through — what makes a stroke read as a whip, not a slide */
    lay?: number;
}
export type StrokePhase = 'ready' | 'lift' | 'hang' | 'down' | 'contact' | 'rebound';
export interface StrokeState {
    phase: StrokePhase;
    /** the grip (the middle of the fist), the shaft's way (grip → head), the head's centre */
    hand: V3;
    shaft: V3;
    head: V3;
    /** the head's velocity (m/s, on the stroke's clock) */
    vel: V3;
    /** 0 → 1 through the lift and hang (the coil), through the downswing, through the rebound and settle */
    coil: number;
    swing: number;
    settle: number;
    /** how deep in the surface the head is (0..1 of the stroke's depth) */
    press: number;
    /** time from contact (negative before) */
    since: number;
}
/** the chain's own progress through a downswing (each 0..1): the hips first, the wrist last */
export interface ChainPhase {
    hips: number;
    trunk: number;
    shoulder: number;
    elbow: number;
    wrist: number;
}
/** a stroke's fixed geometry, worked out once */
export declare class Stroke {
    readonly s: StrokeSpec;
    readonly tool: Implement;
    readonly dir: V3;
    readonly shaft: V3;
    readonly axis: V3;
    /** the grip at contact, the shaft at the top, the downswing's exponent */
    readonly handC: V3;
    readonly shaftTop: V3;
    readonly p: number;
    readonly ready: {
        hand: V3;
        shaft: V3;
    };
    constructor(s: StrokeSpec, tool: Implement);
    /** the hand's speed at contact, and the head's (m/s) */
    readonly vHand: number;
    readonly vContact: number;
    /** the shaft's turn from the top through the downswing (0..1 of it → rad): s^p, laid further back early */
    turn(s: number): number;
    turnRate(s: number): number;
    /** when the lift starts (it's ready before), and when it's settled after (a sequence's flow may move both) */
    get begins(): number;
    get ends(): number;
    /** set by a sequence (Strokes): when this stroke's rise starts and the hand's velocity there; when its way back ends
     *  and the velocity it leaves with (0: a rest at ready) */
    riseAt?: number;
    riseVel: V3;
    endAt?: number;
    endVel: V3;
    /** the hand at the start of the downswing: where it is (the top), its velocity (the elbow leading it down) */
    get topVel(): V3;
    /** where the hand is when its follow is spent, and its velocity then (the rebound's start) */
    get followEnd(): {
        p: V3;
        v: V3;
        t: number;
    };
    /** the stroke at time t, coming from `from` (the previous stroke's ready, or this one's) and going to `to` */
    at(t: number, from?: {
        hand: V3;
        shaft: V3;
    }, to?: {
        hand: V3;
        shaft: V3;
    }): StrokeState;
    private get hangStart();
    /** the chain through the downswing: each link `lag` of it after the one before, eased through its own share */
    chain(st: StrokeState): ChainPhase;
}
/** a sequence of strokes on one clock: which one is going on at t, from where, to where */
export declare class Strokes {
    readonly rest: {
        hand: V3;
        shaft: V3;
    };
    readonly list: Stroke[];
    /** rest at ready between two strokes only when there's at least this long to (s); less, and the hand flows through */
    static REST: number;
    constructor(specs: StrokeSpec[], tool: Implement, rest: {
        hand: V3;
        shaft: V3;
    });
    at(t: number): {
        st: StrokeState;
        stroke: Stroke;
        index: number;
    };
}
/** a hand's goal for holding the implement in a hammer grip at the stroke's state: the shaft leaves the fist on the
 *  thumb's side toward the head; the forearm's way is the arm's (from the shoulder), square to the shaft. `right`: the
 *  right hand (the thumb is fwd × palm-normal); `shoulder` the arm's root, for the forearm's way */
export declare function gripGoal(st: {
    hand: V3;
    shaft: V3;
}, shoulder: V3, right: boolean, o?: {
    curl?: number;
    elbow?: V3;
    elbowW?: number;
    turn?: number;
    axis?: V3;
}): HandGoal;
//# sourceMappingURL=strike.d.ts.map