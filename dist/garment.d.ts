import type { HeroAsset } from './asset.js';
import { type V3 } from './math.js';
export declare const HANG_F = "hangF", HANG_B = "hangB";
/** how much of a bind-space point's pelvis share the hang bones take: none down to the seat (the waist, the hips and
 *  the seat ride the pelvis), all of it from the top of the thighs down */
export declare function hangShare(a: HeroAsset, y: number): number;
/** how much of that the front one takes (the rest the back one's), by where the point is round the hips: all of it in
 *  front, half at the sides, none behind */
export declare function frontShare(a: HeroAsset, x: number, z: number): number;
/** at load (each level of detail): the two hang bones appended to the skeleton (their bind frames upright at the hips'
 *  middle) and the pelvis's share of the clothes under the hips given to them (`hangShare`, `frontShare`); how many
 *  vertices changed */
export declare function fitGarments(a: HeroAsset): number;
/** the hang bones' skin matrices (column-major, bind -> posed), about the hips' middle carried where the two hip
 *  joints are now: the pelvis's rotation while it's upright, the thighs' rotations averaged (the shorter way) once it
 *  has tipped over or the thighs are raised before it (sitting, squatting, a tucked jump), between the two on the way;
 *  then the front one turned forward by half the legs' split (seen from the side) and the back one back by as much.
 *  `bones` is a rig's skin matrices, dt the frame's (the raised thighs' hold eased over it). Returns how far it has
 *  tipped (0 upright .. 1 over): the rigs hold the hips' chains to their rest shape by it (`HOLD`) */
export declare function poseHang(a: HeroAsset, bones: Float32Array, dt?: number): number;
/** how firmly (a pull a 60 Hz step, times how far the hips have tipped) the chains hung from tipped hips keep to their
 *  rest shape along the legs: left to hang free from hips that are the highest point (a dog), a panel falls either way
 *  — down the back toward the head as often as down the legs — and the cloth skinned half to it and half to a thigh
 *  tears across them and flips about */
export declare const HOLD = 0.35;
/** a bind-space point where the chains hang it: through the pelvis down to the seat, through the hang bones below it
 *  (the front one's in front, the back one's behind), blended between (rigs' `rigChains`: the rest shape the cloth is
 *  pulled toward) */
export declare function hang(a: HeroAsset, bones: Float32Array, p: V3): V3;
/** the frame a chain hangs in (its swing is followed in its axes): the pelvis's, or a hang bone's (the front one's or
 *  the back one's by where it hangs) when the chain's middle is under the seat */
export declare function hangBone(a: HeroAsset, pts: V3[]): number;
/** a wide sleeve's fit (hero.wgsl drapeSleeve, HeroMesh.sleeves): the forearms' bind elbows and wrists (left, right),
 *  the arm's own radius at each (the skin under the sleeve), the arms' bones, and the belly the sleeves are kept out of
 *  (an upright elliptic cylinder in the spine's bind frame: its middle's depth, half width, half depth, its bottom and
 *  top) */
export interface SleeveFit {
    elbow: [V3, V3];
    wrist: [V3, V3];
    rElbow: number;
    rWrist: number;
    bones: [[number, number, number], [number, number, number]];
    spine: number;
    belly: {
        zc: number;
        ax: number;
        az: number;
        y0: number;
        y1: number;
    };
}
/** at load: a robe's wide sleeves measured for the drape, and their cloth's share of the fingers given to the hand (a
 *  thumb curling round a cup otherwise drags the cuff's hem with it); null where there's no forearm to hang from */
export declare function sleeveFit(a: HeroAsset): SleeveFit | null;
//# sourceMappingURL=garment.d.ts.map