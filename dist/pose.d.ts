import { type V3 } from './math.js';
import { type HeroAsset } from './asset.js';
import { type FaceExpr } from './rig.js';
import { Face, type FaceState } from './face.js';
/** a pose in his body's frame: x his left, y up from the floor under him, z forward */
export interface Pose {
    /** the pelvis joint's place (standing: 0.8 m up) and turn [yaw, pitch, roll] */
    pelvis: V3;
    pelvisRot: V3;
    /** the chest's turn against the pelvis, the head's against the chest */
    spine: V3;
    head: V3;
    /** the wrists' targets, the palms' way (their normal), the elbows' way; the fingers' curl (0 open .. 1 a fist) */
    hand: [V3, V3];
    palm: [V3, V3];
    elbow: [V3, V3];
    curl: [number, number];
    /** the ankles' targets, each foot's way (heel to toe), its sole's way (down), the knee's way */
    foot: [V3, V3];
    footDir: [V3, V3];
    sole: [V3, V3];
    knee: [V3, V3];
    /** (optional) each hand's own way, wrist to knuckles, its length how far it overrides the forearm's (0..1): a palm
     *  flat on the floor (yoga: play/yoga) */
    handDir?: [V3, V3];
    /** (optional) each foot's toes' way from the ball, its length how far it overrides the foot's (0..1): toes bent flat
     *  on the floor under a raised heel */
    toeDir?: [V3, V3];
}
export declare function zeroPose(): Pose;
/** add w of p into o */
export declare function addPose(o: Pose, p: Pose, w: number): void;
/** a blend of poses (weights summing to 1) */
export declare function blendPoses(list: [Pose, number][]): Pose;
/** the face for the drawn face: an expression, eyes shut (beyond blinking), where the eyes look (null: ahead) */
export interface FaceGoal {
    expr: Partial<FaceExpr>;
    closed: number;
    rate: number;
}
declare const PROPS: readonly ["cushion", "tray", "pot", "cup"];
export type Prop = typeof PROPS[number];
/** where along the hand (wrist to fingertips, its fraction) a held cup's axis lies: over the palm's middle, toward the
 *  knuckles, the fingers curling round its far side */
export declare const GRIP_AT = 0.32;
/** each hand's posed frame (world): the wrist, its way (wrist to knuckles), the thumb's side and the palm's normal */
export interface HandFrame {
    wrist: V3;
    dir: V3;
    thumb: V3;
    palm: V3;
}
export declare class AangRig {
    asset: HeroAsset;
    bones: Float32Array<ArrayBuffer>;
    dq: Float32Array<ArrayBuffer>;
    nBones: number;
    private bind;
    private bi;
    private B;
    private len;
    /** his landmarks in bind space (pelvis, waist, chest, neck, head, shoulders, hips, ankles, balls...) */
    sk: Record<string, V3>;
    /** world joints for others (the props in his hands, the wind at his hands and feet, the camera) */
    J: {
        handL: V3;
        handR: V3;
        palmL: V3;
        palmR: V3;
        head: V3;
        mouth: V3;
        lip: V3;
        chest: V3;
        pelvis: V3;
        footL: V3;
        footR: V3;
        headFwd: V3;
        headUp: V3;
    };
    readonly face: Face;
    private fx;
    private fxBase;
    private gaze;
    private blink;
    private headYaw;
    private headPitch;
    /** each forearm's turn (rad, pronation +) as posed, the end of its range a request beyond it went to (1 pronation, -1
     *  supination, 0 none), and what was asked (for the gesture tools) */
    private tw;
    private twEnd;
    twAsk: number[];
    /** each hand as posed (left, right): what it holds is placed from it (`hold`) */
    readonly hands: [HandFrame, HandFrame];
    private dt;
    /** how far his hips have tipped over (garment.ts poseHang) */
    private hangK;
    /** (each hung from the hips: garment.ts hang; `frame` the bone it hangs in) */
    private chains;
    private chainAcc;
    private first;
    /** where each prop is: its base point, up and forward (world); null where it sits at its bind spot (unseen) */
    props: Record<Prop, {
        at: V3;
        up: V3;
        fwd: V3;
    } | null>;
    /** a prop held in a hand (0 the left), placed from that hand as it's posed — so it's always in the fingers, wherever
     *  the arm's limits leave the hand — by k (0..1, from where `props` puts it): a cup (its rim's radius r, its height h)
     *  in the hollow of the palm, its axis along the hand's thumb side, turned in the fingers toward `up` (world) as far
     *  as a grip lets (GRIP_TURN); `rest`: until it's taken, standing on that hand's palm (rather than where `props` puts
     *  it), tipped toward `up` as far as it would stay — or, the palm turned away from up, held round its side as the
     *  other hand would */
    holds: Partial<Record<Prop, {
        hand: 0 | 1;
        k: number;
        r: number;
        h: number;
        up?: V3;
        rest?: 0 | 1;
    }>>;
    /** where each prop was put this frame (world: its base and up) */
    held: Partial<Record<Prop, {
        at: V3;
        up: V3;
    }>>;
    get faceState(): {
        gaze: V3;
        blink: number;
        face: Readonly<FaceExpr>;
        s: FaceState;
    };
    get jawOpen(): number;
    constructor(asset: HeroAsset);
    /** a bone's bind head */
    bindHead(name: string): V3;
    /** re-seat the chains where he is now (after moving him by hand) */
    snap(): void;
    private setBone;
    /** a bone rigidly with another (the face's bones with the head) */
    private follow;
    skinPoint(i: number, p: V3): V3;
    skinDir(i: number, d: V3): V3;
    /** a bone's posed head / tail */
    joint(name: string): V3;
    /** the body frame's left and forward for a facing */
    static axes(yaw: number): {
        fwd: V3;
        left: V3;
    };
    /** pose him: P in his body frame at `root` (the floor under him) facing `yaw`; he looks at `look` (world) by lookW;
     *  the face's goal; the breeze on the tails; dt for the springs, the blinks and the chains */
    update(dt: number, root: V3, yaw: number, P: Pose, look: V3 | null, lookW: number, face: FaceGoal, wind: V3, bodyOnly?: boolean): void;
    /** one arm to its wrist target (body frame): the clavicle shrugs as the hand rises and reaches forward, the elbow
     *  bends toward its way, the hand turns so its palm faces `palmB` (hero/rig.ts armIK, its twist kept continuous) */
    private armIK;
    /** a held cup's frame from its hand as posed: its axis through the palm's hollow (the cup's radius and the palm's
     *  flesh out from the hand's middle), along the thumb's side turned toward the asked up about the palm's normal, the
     *  hand round its lower half */
    private gripFrame;
    /** a cup standing on a palm (the left's, cradled in his lap): on its middle, upright as far as it would stay (PALM_TURN
     *  from the palm's normal toward `up`) */
    private palmFrame;
    /** the fingers relaxed (a cascade: the index curling least) or curled toward a fist, the thumb swinging in (hero/rig.ts
     *  rigFingers without the instruments' targets) */
    private rigFingers;
    /** the drawn face's state (blinks, saccades, the gaze toward what he looks at, the expression) and the face's bones
     *  riding the head, the jaw opening */
    private rigFace;
    /** his legs as capsules for the sash's tails (per leg: thigh, shin; a, b, radius) */
    private legs;
    /** a point on a tail pushed out of his legs */
    /** a point of a chain out of his legs, out the side it was on a step before (`from`): through the middle it would
     *  come out the far side, a jump across the leg in a step */
    private pushLegs;
    /** the sash's tails (another's skirt panels): hanging from the hips (garment.ts hang), swinging with him and the wind, kept off his legs */
    private rigChains;
}
/** (the AangRig by what it is: any body posed from a Pose) */
export { AangRig as PoseRig };
//# sourceMappingURL=pose.d.ts.map