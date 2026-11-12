import type { HeroAsset } from './asset.js';
import { type V3 } from './math.js';
/** the hand's numbers: the palm's move (0-2, hand space, m), its turn (3-5: a rotation vector — roll about the hand's
 *  way, its pitch (the wrist's flexion), its yaw (the wrist's deviation)), the arch (6), each finger's spread, knuckle,
 *  middle and end joints (index 7-10, middle 11-14, ring 15-18, little 19-22), the thumb's saddle flexion and
 *  abduction, its MCP and IP (23-26) */
export declare const HAND_N = 27;
export declare const HP_ARCH = 6;
/** where finger f's numbers start (f 1 index .. 4 little; 0 the thumb) */
export declare const hpOf: (f: number) => number;
/** the end joint's share of the middle's bend (its tendon) */
export declare const DIP_K = 0.7;
/** one body's hand, from its bind skeleton */
export declare class HandModel {
    /** the hand bone and each finger's three (thumb first: metacarpal, proximal, distal; the others proximal, middle,
     *  distal) */
    readonly hb: number;
    readonly bones: number[][];
    /** the hand space in the bind's: the wrist, the hand's way, toward the thumb, out of the palm */
    readonly wrist: V3;
    readonly X: V3;
    readonly Y: V3;
    readonly Z: V3;
    /** the knuckles' width (index to little, m): the hand's own scale */
    readonly width: number;
    /** per finger (thumb first) in hand space: its base (the thumb's saddle, a finger's knuckle), its three bones' ways
     *  and their ups, the metacarpal's base and way (the arch turns about it) */
    readonly base: Float64Array<ArrayBuffer>;
    readonly seg: Float64Array<ArrayBuffer>;
    readonly up: Float64Array<ArrayBuffer>;
    readonly piv: Float64Array<ArrayBuffer>;
    readonly mAx: Float64Array<ArrayBuffer>;
    readonly kAx: Float64Array<ArrayBuffer>;
    /** the thumb's pad (the way it faces at the bind) and its saddle's abduction axis */
    readonly q0: Float64Array<ArrayBuffer>;
    readonly kAb: Float64Array<ArrayBuffer>;
    /** each number's range */
    readonly lo: Float64Array<ArrayBuffer>;
    readonly hi: Float64Array<ArrayBuffer>;
    /** each number's comfortable band (past it, a held pose quickly costs: anatomy.ts's okLo/okHi) */
    readonly okLo: Float64Array<ArrayBuffer>;
    readonly okHi: Float64Array<ArrayBuffer>;
    /** the bind's finger lengths (m: thumb from its saddle, the others from the knuckle) */
    readonly lens: Float64Array<ArrayBuffer>;
    /** the ring and little fingers' metacarpal bones when the body has them (`ring0`, `pinky0`: a built hand, header.hand):
     *  their ids (-1 none; index by finger, 3 and 4) and their bind head, tail and up in hand space (9 each) — they turn
     *  with the arch, about their own heads */
    readonly mc: number[];
    readonly mcB: Float64Array<ArrayBuffer>;
    private constructor();
    /** a body's hand ('L' her left), or null if its fingers aren't each three bones */
    static of(a: HeroAsset, T: 'L' | 'R'): HandModel | null;
    private mq;
    private mk2;
    /** finger f's metacarpal posed by the arch in x (hand space, before the palm's move): its head, tail and up (o, 9) */
    mcPose(x: ArrayLike<number>, f: number, o: Float64Array): void;
    /** a hand-space point in the bind's (o, at i) */
    bindOf(c: ArrayLike<number>, i: number, o: number[] | Float64Array, dir?: boolean): void;
    private sv;
    private su;
    private sz;
    private sq;
    private sb;
    private sk;
    private sm;
    /** finger f posed by the numbers x, before the palm's move: its four joints (P: base, the two between, the tip; 12),
     *  each bone's up (U: 9, or null), the axis its hinges turn about (K), and (fingers) the axis it spreads about (Zf) */
    fk(x: ArrayLike<number>, f: number, P: Float64Array, U: Float64Array | null, K: Float64Array, Zf: Float64Array): void;
}
/** what's asked of a hand this frame (all in hand space): each fingertip's target (thumb first; 15) and how much it
 *  counts (0: none), each number's rest and how much it's drawn there, how free the palm is (0 held where it is) */
export interface HandAsk {
    tgt: Float64Array;
    w: Float64Array;
    rest: Float64Array;
    wr: Float64Array;
    /** how flat each finger is laid along the surface (HandGoal.lay): its middle joints held down on it too (a barre) */
    lay: Float64Array;
    free: number;
    /** a resting finger's knuckle dragged by its neighbours (enslaving): set by solveHand's caller per finger (1: rests) */
    resting: Uint8Array;
    /** a surface under the hand (the keys' tops, a fingerboard): its normal and offset (n·p = d on it, hand space) and how
     *  far clear of it a fingertip without a target keeps (m; 0: no surface) */
    floor: Float64Array;
    clear: number;
}
export declare const handAsk: () => HandAsk;
/** a hand's solve carried frame to frame: its numbers, the damping, each fingertip's miss after (m) */
export declare class HandSolve {
    x: Float64Array<ArrayBuffer>;
    lam: number;
    ready: boolean;
    miss: Float64Array<ArrayBuffer>;
    /** iterations taken last solve */
    iters: number;
    readonly P: Float64Array<ArrayBuffer>;
    readonly K: Float64Array<ArrayBuffer>;
    readonly Zf: Float64Array<ArrayBuffer>;
    readonly T: Float64Array<ArrayBuffer>;
    readonly J: Float64Array<ArrayBuffer>;
    readonly H: Float64Array<ArrayBuffer>;
    readonly g: Float64Array<ArrayBuffer>;
    readonly A: Float64Array<ArrayBuffer>;
    readonly dx: Float64Array<ArrayBuffer>;
    readonly xn: Float64Array<ArrayBuffer>;
    readonly R: Float64Array<ArrayBuffer>;
    readonly Rd: Float64Array<ArrayBuffer>;
    readonly Rq: Float64Array<ArrayBuffer>;
    readonly fP: Float64Array<ArrayBuffer>;
    readonly fK: Float64Array<ArrayBuffer>;
    readonly fZ: Float64Array<ArrayBuffer>;
    readonly xt: Float64Array<ArrayBuffer>;
    readonly b: Float64Array<ArrayBuffer>;
    readonly act: Int32Array<ArrayBuffer>;
}
/** how many solves have run and their iterations (all; and those with the palm free): for tools */
export declare const SOLVES: {
    n: number;
    iters: number;
    n1: number;
    iters1: number;
};
/** the hand solved for what's asked: S.x updated in place (warm: from last frame's), at most `iters` iterations;
 *  returns the cost. The palm's numbers are held at 0 unless the ask frees it */
export declare function solveHand(M: HandModel, S: HandSolve, Q: HandAsk, iters?: number): number;
/** the palm's move as solved (S.x 0-5) applied to a hand-space point (out at o) */
export declare function palmApply(S: HandSolve, p: ArrayLike<number>, i: number, out: Float64Array | number[], o?: number): void;
//# sourceMappingURL=fingers.d.ts.map