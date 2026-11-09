import { type V3 } from '../math.js';
import type { HeroAsset } from '../asset.js';
import type { HandGoal } from '../rig.js';
import { Skeleton, type M3 } from './measure.js';
export type Fr = {
    o: V3;
    x: V3;
    y: V3;
    z: V3;
};
export declare const frW: (f: Fr, l: V3) => V3;
export declare const frD: (f: Fr, l: V3) => V3;
export declare const frL: (f: Fr, w: V3) => V3;
/** turned about its own side axis (forward +), then its forward axis (to its right +), then its up (to its left +): the
 *  joint coordinates measure.ts reads back (R = Rx Rz Ry) */
export declare const frBend: (f: Fr, flex: number, side: number, turn: number) => Fr;
/** HeroRig's frEuler: yaw about its up, pitch about its side (forward +), roll about its forward */
export declare const frEuler: (f: Fr, yaw: number, pitch: number, roll: number) => Fr;
/** two-bone IK (as the rig's): the middle joint bending toward pole */
export declare function ik2(a: V3, target: V3, l1: number, l2: number, pole: V3, soft?: number): V3;
/** a foot: 'flat' its sole on the ground (`at` the sole's middle); 'ball' on the ball with the heel up as far as eases
 *  the leg (`at` the ball's point on the ground: the toes flat); 'top' the foot's top on the ground, toes pointing back
 *  (kneeling, upward dog; `at` the ball's top); 'free' in the air (`at` the ankle), pointed by `point` (0 square .. 1
 *  pointed). `yaw` the way the toes point (as the body's yaw: 0 toward -z). A knee on the ground (`knee`, its point):
 *  the shin then lies from it toward `at`. */
export interface FootGoal {
    kind: 'flat' | 'ball' | 'top' | 'free';
    at: V3;
    yaw: number;
    knee?: V3 | null;
    point?: number;
    /** free: where the knee would rather point (world) */
    kneeDir?: V3;
    /** how firmly the foot's place is held (default 1: a contact); under 1 a wish */
    w?: number;
}
/** a hand: its goal (HeroRig's HandGoal: palm or knuckles, the hand's way, its palm's, the fingertips), in the world or
 *  (`rel`) in the chest's own frame (x its left, y up, z forward, from the chest's base: placed from the solved chest);
 *  `bear`: flat under the body's weight (the wrist and knuckles to their loaded limits) */
export interface BodyHand {
    goal: HandGoal;
    rel?: boolean;
    bear?: boolean;
    w?: number;
    /** the arm wished straight (its weight): an upward dog's, a plank's — locked out under the body */
    straight?: number;
}
export interface BodyGoal {
    /** the body's frame: where it is and the way it faces (yaw 0 toward -z, as the player's) */
    at: V3;
    yaw: number;
    feet: [FootGoal | null, FootGoal | null];
    hands: [BodyHand | null, BodyHand | null];
    /** sat: the sit bones' point (a seat's surface under them) */
    seat?: V3 | null;
    /** where the pelvis would be and how it's turned (each with its weight): `at` its point, `height` over `at`'s
     *  ground, `pitch` (forward +), `roll` (to its right +), `yaw` (from the body's facing, to the left +) */
    pelvis?: {
        at?: V3;
        w?: number;
        height?: number;
        hw?: number;
        pitch?: number;
        roll?: number;
        yaw?: number;
        rw?: number;
    };
    /** the spine's bend from the pelvis to the chest (forward +, to the right +, turned to the left +) wished, its weight */
    spine?: {
        flex?: number;
        side?: number;
        turn?: number;
        w?: number;
    };
    /** each leg's hip and knee flexion wished (null free), their weight (a plank's legs in line with it, a down dog's
     *  straight knees) */
    legs?: {
        hip?: [number | null, number | null];
        knee?: [number | null, number | null];
        w?: number;
    };
    look?: V3 | null;
    /** the head nodded on top of its look (+ down), and the neck kept long (0..1: the look taken more by the eyes) */
    nod?: number;
    neckLong?: number;
    /** keep the centre of mass over what holds the body up (0..1) */
    balance?: number;
    /** (s) the trunk eased toward its fit over about this long (a critically damped follow, where it is against `at`)
     *  rather than taken at once each frame: when the fit moves on — a foot lifted, the balance tipping to the other
     *  side — the body shifts its weight over instead of lurching there in a frame. Needs the state's `dt` */
    ease?: number;
    /** the body's suppleness (anatomy FLEX) */
    flex?: number;
    /** a breath (0 out .. 1 in): the chest lifts a little, the shoulders don't */
    breath?: number;
    /** a new pose, not a step along one (set by whoever jumps the goal; the solver clears it): the trunk fitted afresh
     *  from the goal's own hints as well as from where it was, and the better kept */
    fresh?: boolean;
    /** the solved body turned whole about its waist (the rig, after: a somersault's pitch, forward +; a cartwheel's roll,
     *  to its right +) and raised by `lift` (m): tumbling through the air */
    tumble?: {
        pitch: number;
        roll: number;
        lift: number;
    } | null;
}
/** a body's own measurements, from its bind skeleton */
export declare class BodyModel {
    readonly asset: HeroAsset;
    readonly female: boolean;
    readonly sk: Skeleton;
    readonly s: number;
    readonly P: Record<string, V3>;
    readonly L: Record<string, number>;
    readonly knuckle: [number, number];
    readonly FH: number;
    /** the toes' bind angle up from the foot's line (the toe joint's zero) */
    readonly toe0: number;
    constructor(asset: HeroAsset, female?: boolean);
    /** a bone's skin rotation for a posed frame built from its head-to-tail way and an up (as HeroRig.setBone builds it) */
    skinR(n: string, dir: V3, up: V3): M3;
}
/** a leg as posed: its joints and the ways its bones' ups point (for setBone) */
export interface LegPose {
    hip: V3;
    knee: V3;
    ankle: V3;
    ball: V3;
    toe: V3;
    pole: V3;
    footUp: V3;
    toeDir: V3;
    toeUp: V3;
    heel: number;
}
/** a hand's wrist target and its goal in the world */
export interface HandPose {
    wrist: V3;
    goal: HandGoal;
    bear: boolean;
    w: number;
}
export interface BodyPose {
    pel: Fr;
    mid: Fr;
    ch: Fr;
    waist: V3;
    chestBase: V3;
    neckBase: V3;
    headBase: V3;
    headTop: V3;
    nk: Fr;
    hd: Fr;
    legs: [LegPose, LegPose];
    hands: [HandPose | null, HandPose | null];
    com: V3;
    margin: number | null;
    support: V3[];
    cost: number;
    iters: number;
}
/** what the solver keeps between frames: the trunk's numbers, each knee's last pole, each heel's lift */
export declare class BodyState {
    x: number[] | null;
    pole: (V3 | null)[];
    heel: number[];
    lam: number;
    /** where the eyes and neck were turned (smoothed) */
    head: number[];
    /** the frame's time (s; set by whoever solves each frame), the goal's `at` last frame, and the trunk's numbers' rate
     *  (per s) under a goal's `ease` */
    dt: number;
    at: V3 | null;
    v: number[] | null;
    reset(): void;
}
export declare function spineSplit(flex: number, side: number, turn: number): [V3, V3];
/** the trunk posed from its nine numbers: the pelvis (its point and its turn from the body's frame), the spine's bend
 *  (shared over its segments) */
export interface Trunk {
    pel: Fr;
    mid: Fr;
    ch: Fr;
    chF: Fr;
    waist: V3;
    chestBase: V3;
    neckBase: V3;
    hips: [V3, V3];
    lu: V3;
    th: V3;
}
export declare function trunkOf(M: BodyModel, B0: Fr, breath: number, x: number[]): Trunk;
/** the shoulder for a wrist target (the clavicle's shrug and reach, as armIK's) */
export declare function shoulderOf(M: BodyModel, i: number, chF: Fr, target: V3): V3;
/** a leg's joints for its hip and its foot's goal (the knee by a pole, or the goal's kneeling point), and its joints
 *  read as measure.ts reads them */
export declare function legOf(M: BodyModel, k: number, i: number, T0: Trunk, f: FootGoal, heel: number, poleIn: V3 | null): {
    hip: V3;
    knee: V3;
    ankle: V3;
    ball: V3;
    toe: V3;
    pole: V3;
    footUp: V3;
    toeDir: V3;
    toeUp: V3;
    heel: number;
    sole: V3[];
    hipA: number[];
    kneeFlex: number;
    kneeRot: number;
    ankleA: number[];
    toeExt: number;
    legLen: number;
};
/** the body solved for its goal: the trunk fitted (iters LM iterations from last frame's), the legs' swivels and the
 *  head's turn chosen by ease */
export declare function solveBody(M: BodyModel, G: BodyGoal, S: BodyState, iters?: number, debug?: (terms: [string, number][]) => void): BodyPose;
//# sourceMappingURL=solve.d.ts.map