import { HeroRig, type Groove, type HandGoal } from './rig.js';
import { type V3 } from './math.js';
import type { HeroAsset } from './asset.js';
/** what an Actor needs of its mesh: the asset it was built from (a body's: a HeroAsset, whatever the mesh types it
 *  as — Drake's HeroMesh keeps only its MeshData), and a way to take the rig's pose (a project's HeroMesh.update(rig,
 *  jawOpen)) */
export interface ActorMesh {
    readonly asset: {
        header: HeroAsset['header'];
    };
    update(rig: never, jaw: number): void;
}
/** a body's frame on the floor: where it stands, its forward and its left (world) */
export interface Body {
    pos: V3;
    fwd: V3;
    left: V3;
    s: number;
}
/** a point in a body's frame (x its left, y up, z forward; metres at its own scale) */
export declare const P: (B: Body, x: number, y: number, z: number) => V3;
/** a direction in a body's frame */
export declare const D: (B: Body, x: number, y: number, z: number) => V3;
/** the rig's yaw facing a way (its forward is (-sin yaw, 0, -cos yaw)) */
export declare const yawOf: (d: ArrayLike<number>) => number;
export declare const fwdOf: (yaw: number) => V3;
export declare const leftOf: (yaw: number) => V3;
/** a hand round a handle: its posed frame (the wrist, the fingers' way, the thumb's, the palm's normal) and where the
 *  handle runs through the fist (its middle, its way out past the thumb) */
export interface Fist {
    W: V3;
    Z: V3;
    Y: V3;
    N: V3;
    G: V3;
    A: V3;
}
/** a goal and how it's eased: exact goals (a mallet in the fist) go straight in, the rest are eased toward */
export interface Hand {
    goal: HandGoal | null;
    rate?: number;
}
export declare class Actor<M extends ActorMesh = ActorMesh> {
    readonly mesh: M;
    readonly rig: HeroRig;
    pos: V3;
    yaw: number;
    vel: V3;
    t: number;
    private held;
    private heldW;
    private stoopV;
    /** each hand bone's bind frame's thumb way (its y), for its posed frame */
    private handBind;
    constructor(mesh: M, pos: V3, yaw: number);
    get s(): number;
    private moodNow;
    private moodK;
    /** the face's mood, set only when it changes (face.mood restarts its fade each time it's called) */
    mood(e: Parameters<HeroRig['face']['mood']>[0], k?: number, fade?: number): void;
    body(): Body;
    /** a hand's goal round a handle: its middle G, its way A (out past the thumb, toward what's at its end), the fingers
     *  about along F, the handle tilted toward the fingertips by `tilt` (rad); the fist closed by `grip` */
    fistGoal(side: 1 | -1, G: V3, A: V3, F: V3, o?: {
        tilt?: number;
        grip?: number;
        curl?: number;
        out?: number;
        exact?: boolean;
    }): HandGoal;
    /** a hand as posed now (after the rig's update): its frame, and the handle's middle and way through its fist */
    fist(side: 1 | -1, tilt?: number, out?: number): Fist;
    /** this frame: the hands' goals (null: hanging free), the stoop (and how much of it's in the knees), where it looks,
     *  its dance; posed, then sent to its mesh */
    pose(dt: number, hands: [Hand, Hand], stoop: number, bend: number, look: V3 | null, groove: Groove | null, stoopRate?: number): void;
    /** the mesh's uniforms and bones from the pose */
    send(): void;
}
/** a vector turned about a unit axis by a (Rodrigues) */
export declare function rot(v: V3, k: V3, a: number): V3;
//# sourceMappingURL=actor.d.ts.map