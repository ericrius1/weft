import { type V3 } from './math.js';
import type { HeroAsset } from './asset.js';
import { Face, type FaceState } from './face.js';
import type { BodyGoal, BodyPose } from './body/solve.js';
/** what the body should be doing with the water (bending.ts) */
export interface BendPose {
    mode: 'idle' | 'draw' | 'hold' | 'push' | 'throw' | 'swirl' | 'wave' | 'flow' | 'freeze' | 'melt' | 'carryIce';
    target: V3;
    intensity: number;
    t: number;
    /** holding a ball of water between the palms: its radius (m) */
    orb?: number;
    /** holding (mode 'hold') a flame up in the right palm, open before the chest, steady; the left hand at rest */
    flame?: boolean;
}
/** one hand at an instrument: where the palm hovers, the hand's way (wrist to knuckles) and its palm's normal, and per
 *  finger (thumb, index, middle, ring, pinky) a fingertip target or null (resting curled) */
export interface HandGoal {
    palm: V3;
    fwd: V3;
    down: V3;
    tips: (V3 | null)[]; /** the fingers' curl (0 open .. 1 a fist; else a grip's) */
    curl?: number;
    /** the fingers closed round something held (0..1; a cup, a bowl): set, the hand holds rather than resting on keys —
     *  the fingers without a tip's target curl by `curl` and this, the thumb too */
    grip?: number;
    /** the way the elbow would rather point (world): a preference the arm's fit weighs against its ease (armFit) */
    elbow?: V3;
    /** how much that way counts against the arm's ease (default 0.35): more, and the elbow keeps to it while the hand
     *  turns through a move, rather than hopping to the other side when that side's a little easier for the wrist */
    elbowW?: number;
    /** the knuckles' line (its middle, world): set, the wrist goes a hand's length back from it along `fwd` (the body's
     *  own hand: a child's or a big man's), and `palm` is ignored */
    knuckles?: V3;
    /** the fingers without a tip's target hang loosely curled by `curl` (a strumming hand), not resting on keys */
    loose?: boolean;
    /** how far the hand may turn about its own way from the goal's palm (radians), as players' hands do (a fretting
     *  hand's knuckles tilt off the neck's line, a strumming palm faces the strings more or less square): the arm's fit
     *  takes whatever of it eases the forearm */
    turn?: number;
    /** held exactly (an instrument: a bow in the hand, a fiddle's neck): the wrist where the goal puts it (no reach
     *  limit), the hand along `fwd` with its palm to `down` as given (the wrist bending to it), so what's in the hand can
     *  be placed from it */
    exact?: boolean;
    /** the hand flat under the body's weight (a plank's, down dog's): the wrist bends back as far as a loaded wrist goes
     *  (~88°), and the arm's fit weighs the shoulder's turn too */
    bear?: boolean;
    /** the arm's fit weighs the shoulder's turn (the humerus's) as well as the forearm's and the wrist's (the body's own
     *  poses: body/solve.ts) */
    shoulder?: boolean;
    /** how free the palm is to move to its fingertips' targets (0, the default: where the goal puts it; 1: within the
     *  wrist's and the arm's ease — a few cm, a few tens of degrees — as a pianist's hand moves and turns to a chord):
     *  the hand's solve (fingers.ts) places the palm and the fingers together. Ignored when held `exact` */
    palmFree?: number;
    /** how much each fingertip's target counts (thumb first; default 1 each) */
    tipW?: number[];
    /** how square each finger comes down on its target (thumb first, 0..1: 1 its middle joint well bent and its end
     *  joint with it, the tip meeting the string end-on — a guitarist's or a violinist's stop) */
    square?: number[];
    /** how flat each finger lies along what it presses (thumb first, 0..1: 1 its middle and end joints straight — a
     *  guitar's barre, the index laid across every string; default 0) */
    lay?: number[];
    /** a surface under the fingers (world: a point on it, its normal out toward the hand) that the fingertips without a
     *  target keep `clear` (m) of — the keys' tops, a fingerboard — so a resting finger never sinks into it */
    floor?: {
        at: V3;
        n: V3;
        clear: number;
    };
}
/** sitting at an instrument: the pelvis on the seat, facing it, the feet's places, the hands' goals, where she looks;
 *  w how far she's sat down (0..1) */
export interface SeatPose {
    pelvis: V3;
    yaw: number;
    feet: [V3, V3];
    hands: [HandGoal, HandGoal];
    look: V3;
    lean: number;
    w: number;
    /** both shoulders up (0..1: a laugh's bounce, hero/table.ts) */
    shrug?: number;
    /** (Drake's dragon) each knee's way (world; left, right): astride a dragon's neck the knees go out round it, not up
     *  and ahead as at a piano's bench */
    knees?: [V3, V3];
    /** how quickly the feet follow their places (1/s; default 7): a quick move (a dismount's slide) wants them close */
    feetK?: number;
}
/** holding something before her, standing (a book, the kaleidoscope): each hand's goal (null: free) and how far it's
 *  gone to it (0..1), how far she stoops to reach it (0..1) */
export interface HoldPose {
    hands: [HandGoal | null, HandGoal | null];
    w: [number, number];
    stoop: number;
    /** how much of the stoop is in the knees (1, the default) rather than the back: a tall man at a low eyepiece bows */
    bend?: number;
    /** the goals are where the hands go in the world with the body as it leans flying or swimming (Aang's glider's grip,
     *  play/powers.ts): taken into the upright body the lean then tips, as the bending's target is (without it they're
     *  for the upright body, and the lean tips them along with it) */
    leaned?: boolean;
}
/** a prop's place in the world: its base point, its up, its front */
export interface PropPlace {
    at: V3;
    up: V3;
    fwd: V3;
}
export interface RigInput {
    dt: number;
    time: number;
    /** her feet's point on the ground (the root), facing (0 = toward -z), velocity, horizontal speed */
    pos: V3;
    yaw: number;
    vel: V3;
    speed: number;
    running: boolean;
    onGround: boolean;
    /** water around her legs (m) and a landing's downward speed (consumed) */
    wade: number;
    landImpact: number;
    pose: BendPose;
    look: V3 | null;
    wind: V3;
    /** the ground under a point at her feet's level (house floors, stair treads, the terrain) */
    ground: (x: number, z: number) => number;
    /** flying: the whole body leans (pitch forward, roll into turns) about the waist; the boost's wind-up (0..1) */
    flying?: boolean;
    flyPitch?: number;
    flyRoll?: number;
    boost?: number;
    /** a triple jump's front somersault under way (0..1, 0: none): tucked, the whole body turned once about the waist */
    flip?: number;
    /** in a skydive (0..1: how far into its pose) and how far head first (0 spread out on the air .. 1 a head-first dive):
     *  posed as flying, leaned by flyPitch */
    skydive?: number;
    diveDown?: number;
    /** in the air off a chain of jumps: which (2: the double, the arms thrown up overhead) and since it (s) */
    jump?: number;
    jumpT?: number;
    /** flying under a glider (0..1: Aang's, play/powers.ts): hanging from its grip, the legs together and long under him,
     *  trailing as he lies along his path — not a flyer's open float, a knee drawn up */
    glider?: number;
    seat?: SeatPose | null;
    hold?: HoldPose | null;
    /** a whole body from goals (body/solve.ts: yoga, fishing, singing, an instrument's seat ...) over the rest by w
     *  (0..1): the pelvis, the spine and the legs solved by their ease, the arms to the goal's hands */
    body?: {
        goal: BodyGoal;
        w: number;
    } | null;
    /** 0 none, 1 at the surface, 2 under water, 3 leaping out of it (a streamlined arc); the stroke cycle (0..1); the
     *  water's level */
    swim?: number;
    swimPhase?: number;
    waterLevel?: number | null;
    /** a body posed whole by another solver and blended over her own by w (yoga, play/yoga: a Pose solved on her skeleton
     *  by aang/rig.ts): its bones (her face, hair and cloth are then hers, from the blend) and where she looks */
    posed?: {
        bones: Float32Array;
        w: number;
        look: V3 | null;
    } | null;
    /** (Gong Bong) dancing on the spot to the music, over the rest: the pelvis dropped (m: the knees bend under it),
     *  shifted to the left (m), the chest turned (rad, + to the left) and rocked (rad, + forward), rolled (rad, + its
     *  left shoulder down), the head nodded (rad, + down) and tilted (rad, + toward the left shoulder) */
    groove?: Groove | null;
    /** what she stands on moving under her this frame (m: a bowl afloat, a deck that moves): the planted feet go with it */
    carry?: V3 | null;
}
export interface Groove {
    bounce: number;
    sway: number;
    twist: number;
    rock: number;
    roll: number;
    nod: number;
    tilt: number;
}
/** how much of the head's turn and nod (and tilt) the neck bone takes, the head the rest: by the two levels' ranges
 *  (body/anatomy.ts neckLow, neckUp: the lower neck two thirds of the nod, a little under half of the turn, the atlas
 *  most of it). A third of each, as it was, left the upper neck bent back ~35° (its limit 25°) flying and swimming */
export declare const NECK: {
    turn: number;
    nod: number;
    tilt: number;
};
/** a chain segment's roll (its bone's up), carried on from last frame's: turned by the least rotation from last frame's
 *  way to this one's, then eased a fifth of the way a 60 Hz frame toward the roll it has off its rest shape (`rest`, taken on
 *  the carried one's side). The rest roll alone — the rest shape's up swung onto the segment — turns over when the
 *  segment swings far from its rest way (a panel hanging from tipped hips, whipping as they come up), and the cloth
 *  skinned to it turns inside out for a frame. `mem` keeps each segment's last way and up */
export declare function carryUp(mem: {
    up: V3[];
    dir: V3[];
}, i: number, dir: V3, rest: V3, reset: boolean, dt: number): V3;
/** a leg's two bones' ups (their fronts: the thigh's toward the knee's way, the shin's the same side of the hinge),
 *  each perpendicular to its bone about the knee's hinge: the axis across the bend once the knee is bent, the one
 *  across the hip-to-ankle line and the pole while it's near straight. The pole's rejection from the shin (what it
 *  was) flips the shin over when the bent shin lies along the pole — kneeling, a fold onto the heels — and the trousers
 *  twist with it; this doesn't */
export declare function legUps(thighD: V3, shinD: V3, hipToAnkle: V3, pole: V3): [V3, V3];
export declare function matToDQ(m: Float32Array, k: number, out: Float32Array, o: number): void;
/** two bones' dual quaternions (matToDQ's layout) mixed by w (the shorter way round), back to a rigid matrix */
export declare function dqMixToMat(a: Float32Array, b: Float32Array, w: number, m: Float32Array, k: number): void;
export interface FaceExpr {
    smile: number;
    jaw: number;
    pucker: number;
    frown: number;
    brows: number;
    tender: number;
    browDown: number;
    squint: number;
    wide: number;
    closed: number;
}
/** the most velocity (m/s) the constraints may add to a chain's point in a step (see Chain.step) */
export declare const MAX_KICK = 4;
export declare class HeroRig {
    asset: HeroAsset;
    bones: Float32Array<ArrayBuffer>;
    dq: Float32Array<ArrayBuffer>;
    nBones: number;
    private bind;
    private bi;
    private B;
    private len;
    /** her size against the 1.66 m the rig was tuned on */
    s: number;
    sk: Record<string, V3>;
    private shinTilt;
    /** the seat's shrug this frame (SeatPose.shrug by how far she's sat) */
    private seatShrug;
    /** how steeply she's climbing (0..1: a slope's rise along her way, 19° to 42°) */
    private climb;
    /** the body's own measures for the poses fitted to it (the air poses' streamline, the feet pointed): its shoulders'
     *  half width, its arm's length (shoulder to wrist), its foot's angle to its shin at rest */
    private fit;
    /** each elbow's way in the fitted streamline (overArm) */
    private overAim;
    /** each ankle's angle as its foot last left the ground (the swing eases it from there) */
    private ankA;
    private feet;
    private phase;
    private cadence;
    private runW;
    private gaitW;
    private moving;
    private duty;
    private stride;
    /** setting off at speed: how much further on the clock still has to go (caught up a little a frame) */
    private catchUp;
    private lastStep;
    private accLean;
    private lastFwdV;
    private slopeList;
    private slopeLean;
    private turnLean;
    private lastYaw;
    private idleT;
    private idleNext;
    private idleSide;
    private idleW;
    private armSw;
    /** running: each elbow's way from its shoulder as the pump means it (world), and how far the arm IK takes it */
    private elbAim;
    private elbAimW;
    private pelY;
    private pelYV;
    private crouch;
    private twist;
    private lean;
    private headYaw;
    private headPitch;
    private hands;
    private seatW;
    /** the face (cast/face.ts): moods, passing expressions, a sip, speech; the drawn face draws its state */
    readonly face: Face;
    /** its state as the older face's keys, and the body's own face this frame */
    private fx;
    private fxBase;
    private gaze;
    private blink;
    private chains;
    /** another of the cast's props (one-bone chains on the root: Aang's cushion and cup, Iroh's teapot): kept out of sight
     *  unless one's placed (placeProp) */
    private props;
    /** the props by name (their chains' names: 'pot', 'cup', 'cushion', 'tray'), and where each placed one is */
    private propBone;
    private propAt;
    private lastCaps;
    /** (the cloth's grace: her speed this frame, its billow's clock) */
    private graceSpeed;
    private graceT;
    private chainAcc;
    private first;
    private armT;
    private flowW;
    private flowPh;
    private prevMode;
    private palmV;
    private curlV;
    private gripV;
    private flyPd;
    private flowPd;
    private twPrev;
    private fdPrev;
    /** each arm as it's held this frame (radians): the forearm's roll from its middle, the wrist's flexion (+ toward the
     *  palm) and deviation (+ toward the thumb), the elbow's bend (0 straight) */
    readonly armStat: {
        roll: number;
        want: number;
        flex: number;
        dev: number;
        elbow: number;
    }[];
    /** each arm's last fitted elbow pole (armFit), for its continuity */
    private swPrev;
    /** the swivel's angular speed (rad/s, armSpring) */
    private swVel;
    /** the torso the elbows keep out of (armFit), against the shoulders' half-width: its half-width, how far in front
     *  and behind (a fuller figure's or a loose smock's further in front: TORSO in town/folk.ts) */
    torso: [number, number, number];
    /** each arm's hand turned about its own way (radians, within its goal's `turn`) */
    private psi;
    private flyW;
    private legLag;
    private surfW;
    private subW;
    private sprintW;
    private moveW;
    private floatY;
    private lastPos;
    /** the whole-body solver (body/solve.ts), set when the body's tools load (body/api.ts): a body goal waits for it */
    static bodyKit: typeof import('./body/solve.js') | null;
    /** the arm fit follows its own minimum frame on frame (armFit): elbows that slide, never flip. On by default (Drake's
     *  flute hold and reins, Codevember's day 9: goals every frame, and an elbow hopping round in a frame as the hand
     *  sways is the worst thing an arm can do on screen); false, each frame takes the best way round of all (Boulder's,
     *  Seven Havens' and San Francisco's arms before @ericrius1/cast) */
    static armContinuity: boolean;
    /** with armContinuity: the elbow's swivel follows the best one as a critically damped spring of this natural
     *  frequency (rad/s; 0, off: it steps to the best within its swing each frame, hurrying when it's far behind — its
     *  speed changing in a frame, a one-frame kick at the elbow). The swivel's speed then changes smoothly, and it
     *  still can't jump: a spring travels the way between (Codevember's day 9: 30) */
    static armSpring: number;
    /** a woman's body (the centre of mass's segments): Katara's */
    female: boolean;
    /** the body's suppleness (body/anatomy.ts FLEX: Iroh's an old man's, Aang's a supple airbender's): its forearm's turn
     *  and its wrist's bend scale with a share of it */
    flex: number;
    private bodyM;
    private bodyS;
    /** the body as solved last frame (its centre of mass, its support, its cost) and how far it was over the rest */
    bodyPose: BodyPose | null;
    private bodyWas;
    private bodyNormal;
    /** the arms' own state while the body poses them (their springs, swivels and turns kept apart from the rest's) */
    private bodyArm;
    /** each finger's curl toward its target (smoothed: a finger presses quickly and lifts a touch slower) */
    private tipsW;
    /** the hands as hands (fingers.ts: null for a body whose fingers aren't three bones each), their solves carried frame
     *  to frame, what's asked of them, the palm's move as last solved */
    /** the most iterations a hand's solve takes a frame: the palm's with its fingers, then the fingers' on the hand as
     *  the arm put it (each stops once its fingertips are within 0.2 mm) */
    static handIters: [number, number];
    /** a hand at keys (fingertip targets, nothing held): each finger's rest (index..little: MCP, PIP, DIP, rad) idle and
     *  playing, the spreads, the thumb's (saddle flexion, abduction, MCP, IP) idle and playing — set so the hand's plan
     *  extension (a fingertip's distance from its knuckle seen from above, over the finger's length), the fan and the
     *  idle fingers' hover match real pianists' (World tools/hands/planstats.mjs against tracked footage) */
    static keysHand: {
        idle: number[][];
        tip: number[][];
        fan: number[];
        thumbIdle: number[];
        thumbTip: number[];
        /** how hard a playing finger's joints and the playing thumb are drawn to those rests (the fingertip's target is
         *  per mm, so these shape the hand, not where the tips land) */
        wTip: number;
        wThumb: number;
    };
    private handM;
    private handS;
    private handQ;
    private palmX;
    /** the hand as the palm's solve placed it this frame (wrist, its way, its palm's; [9] set when it's this frame's) */
    private palmAt;
    /** each hand's fingertips' misses as the palm's solve left them (before the arm took the palm) */
    readonly palmMiss: Float64Array<ArrayBuffer>[];
    /** each hand's fingertips' misses after its solve (m; thumb first) and its iterations, for tools and tests */
    handMiss(i: number): Float64Array;
    handIters(i: number): number;
    /** each hand's solved numbers (fingers.ts HAND_N: the palm's move, the arch, the fingers', the thumb's) */
    handX(i: number): Float64Array;
    /** each hand's palm move as last solved (hand space: its move, m, and its turn's rotation vector) */
    handPalm(i: number): Float64Array;
    /** a foot touched down (footsteps), and the pedal under the right foot (0..1, at an instrument) */
    onPlant?: (foot: number, pos: V3, speed: number) => void;
    pedal: number;
    /** world joints for others (the water at her hands, the camera, sounds) */
    J: {
        handL: V3;
        handR: V3;
        head: V3;
        chest: V3;
        pelvis: V3;
        footL: V3;
        footR: V3;
        /** the head's forward and up (world): where the face looks, for a close-up's camera and a cup at the lips */
        headFwd: V3;
        headUp: V3;
        /** the lower lip's front (world): where a cup's rim goes for a sip (cast/sip.ts) */
        lip: V3;
    };
    /** a scene's expression over her own, by its weight */
    expr: {
        face: Partial<FaceExpr>;
        k: number;
        rate?: number;
    } | null;
    /** a player's breath over the body's own slow one (src/flute: the lungs filled between phrases, emptied along them):
     *  v how full (0..1), k how much it holds the chest (0..1); null, the body's own */
    breath: {
        v: number;
        k: number;
    } | null;
    /** hands' goals made from where a point on a bone was as last posed (the flute's: at the lips, from the head as it
     *  was last frame — its hook is asked before the body's posed): each hand's goal carried by how far that point has
     *  moved once the head's posed this frame, by its weight k, so a hold anchored to the head rides it with no frame's
     *  lag (walking, the body drops at each footfall faster than a frame's guess can follow: the flute and both hands
     *  jolted ~6 mm against the face at every step) */
    anchor: {
        bone: number;
        local: V3;
        was: V3;
        k: [number, number];
    } | null;
    /** the lungs as the chest shows them (eased), and the shoulders' rise with a full breath (rad, the clavicles') */
    private lungs;
    private breathK;
    private breathShrug;
    get jawOpen(): number;
    /** the face as the drawn face reads it: where the eyes look in the head's own axes (x her left, y up, z forward),
     *  how far they're shut, the expression */
    get faceState(): {
        gaze: V3;
        blink: number;
        face: Readonly<FaceExpr>;
        s: FaceState;
    };
    constructor(asset: HeroAsset);
    /** re-seat feet, hands and hair where she is now (after moving her by hand) */
    snap(): void;
    /** her arms let go of whatever of the rig's own state still holds them (a seat's or a form's weight, a grip, the
     *  arm swing's and the hands' springs, the wrists' turn): back to hanging at rest from the next frame. katara.ts
     *  calls it when nothing of hers is holding her hands up and they're up anyway */
    relaxArms(): void;
    /** take over from another of the cast mid-motion (cast.ts: K, a swap of bodies): their gait's clock and weights,
     *  their feet's plants and swings, the arm swing's and the hands' springs, the wrists' and fingers' state, the head's
     *  turn — so this body goes on from that one's pose at the moment of the swap rather than snapping to stand and
     *  springing its hands in from wherever they were the last time it was worn (the user, 2026-11-08: "the new
     *  character coming in just takes over from exact pose of last character"). World points are scaled about the feet
     *  (`pos`) by this body's size to theirs; the cloth and hair, their own, start at rest on the pose */
    carry(from: HeroRig, pos: V3): void;
    /** the arms' own state now (for a report when they're found stuck) */
    armState(): {
        seatW: number;
        flowW: number;
        flyW: number;
        surfW: number;
        subW: number;
        runW: number;
        gaitW: number;
        curl: number[];
        grip: number[];
        palm: number[];
        twist: number[];
        armSw: number[];
        tips: number[][];
        elbAim: number[];
    };
    /** rotate every posed bone (and the tracked joints) rigidly about a pivot: pitch about the body's side axis
     *  (positive leans forward), then roll about its forward axis; then raise it by `lift` */
    private leanBody;
    private setBone;
    skinPoint(i: number, p: V3): V3;
    skinDir(i: number, d: V3): V3;
    /** a bone's posed head, by name (the hands' fingertips for the instruments, the head for the camera) */
    joint(name: string): V3 | null;
    /** a bone's posed tail */
    jointTail(name: string): V3 | null;
    /** the props this body's mesh carries (its root's one-bone chains: Iroh's 'pot' and 'cup', Aang's 'cushion', 'tray',
     *  'pot', 'cup') */
    get propNames(): string[];
    /** a prop's bind frame: its base (the bone's head, where it stands), x the body's left, y up, z its front (a pot's
     *  spout) — the frame a PropPlace puts in the world */
    propBase(name: string): V3 | null;
    /** a prop put in the world (its base at `at`, its up and its front along `up` and `fwd`), or put away (null). It goes
     *  there at once (its bone and dual quaternion: a prop placed after the frame's update, from where the hands got to,
     *  is drawn this frame) and stays there each frame after, until it's moved or put away */
    placeProp(name: string, at: PropPlace | null): void;
    /** is a prop out (placed)? */
    propOut(name: string): boolean;
    private setProp;
    /** a hand as it's posed (world, from its bone): the palm's middle (where a HandGoal's palm goes), the hand's way
     *  (wrist to knuckles), the way its palm faces, its thumb's side */
    handFrame(side: 'L' | 'R'): {
        palm: V3;
        fwd: V3;
        down: V3;
        thumb: V3;
    };
    update(I: RigInput): void;
    /** the body solved for its goal and posed: the pelvis, the spine, the neck and the head, the legs; the arms through
     *  armIK (armFit's elbow, the wrist's limits, the fingers) to the goal's hands (or hanging); over the rest by w */
    private bodyPass;
    /** the body let go: the feet planted where they were last seen — the pose's over the gait's by its last weight (the
     *  rest's gait steps them back under her). Let go after a fade they're the gait's own, and a foot mid-step steps on:
     *  planted at a kneel's as she walked off, one was left behind her for a whole stride, her hips sinking to reach it */
    private bodyRelease;
    private swapArmState;
    private chainSkip;
    /** the chains' bones and the props' (posed after from their parents: left out of a blend) */
    private chainBones;
    /** how far her hips have tipped over (garment.ts poseHang: the hips' chains held to their rest shape by it) */
    private hangK;
    /** how far a posed body (yoga's, or the body pass's) is over hers this frame (the cloth drapes by it) */
    private posedW;
    private dqA;
    private dqB;
    /** another solver's bones over hers by w (each bone's dual quaternion blended: rigid, no shrinking at the joints);
     *  the chains' and the props' bones are left hers (the cloth and the hair hang from the blended body after) */
    private blendPosed;
    /** the joints others read (the hands for the water, the head for the camera, the lip for a cup), from the bones */
    private jointsFromBones;
    private liftFoot;
    /** the flight / swimming pose for this frame: each mode's pose mixed by how far she's in it */
    private airPose;
    /** an air pose's hand no higher overhead than this body's shoulder lifts easily (as overArm's): past it, tipped
     *  forward — the triple boost's fist straight up took a stiff body's shoulder past its limit */
    private capArm;
    /** an arm overhead in a streamline, fitted to this body (relative to its shoulder, the chest's axes: x her left, y up,
     *  z forward): the wrist over the head's middle, the arm straight at its own length (z: the pose's own depth), no
     *  higher than the body's shoulder lifts easily; the elbow out and back, the palm forward (the upper arms by the
     *  ears, the hands stacked palm to back) — turned together about the arm, where that's past the upper arm's turn for
     *  this body at this height, until it's within it (body/measure.ts' reading: from where raising the arm straight from
     *  hanging carries it, let go near straight up), the forearm's roll left as it was */
    private overArm;
    private resetFeet;
    private armIK;
    /** the wrist to the knuckles (the middle finger's), along the hand: the body's own (the hand bone runs on to the
     *  fingertips) */
    private knuckleLen;
    /** the elbow for a hand that must lie a given way (an instrument's, something held). The arm reaches the wrist from
     *  any elbow on a circle about the shoulder-wrist line (its swivel; Tolani & Badler's analytic arm); of those, the
     *  one where it's most at ease: the forearm's roll to the hand's thumb and the wrist's bend (flexion, deviation) each
     *  within their comfortable ranges (past them quickly worse, past a joint's limit far worse — the ergonomists' RULA
     *  bands), the elbow off the torso and not up over the shoulder, near the goal's preferred way and last frame's.
     *  Sampled round the circle, then refined. Returns the pole that bends the elbow there.
     *  Frame on frame it follows its own minimum: the best within as far as an elbow can swing in `dt` of where it was
     *  (so it slides, never jumps, when another way round becomes a little better — an elbow flipping over in one frame
     *  is the worst thing an arm can do on screen); when where it is has become much worse than the best (a joint's
     *  limit) it hurries over there, still through the way between; the first frame, or after a jump in time, it takes
     *  the best of all. */
    private armFit;
    private rigFingers;
    /** what's asked of hand i (fingers.ts HandAsk): each fingertip's target taken into hand space by `toC`, how much it
     *  counts (the goal's weight, the finger's own coming in and going), and every number's rest — a finger with no target
     *  rests as the rig's own fingers would (the keys' curve, a grip's, a loose hand's), one with a target drawn only
     *  lightly toward a relaxed curl */
    private askHand;
    private fl;
    private fl2;
    /** the palm and fingers solved together for a goal whose palm is free (HandGoal.palmFree): the goal handed back with
     *  the palm moved and turned as solved, for the arm to take (the fingers are solved again on the hand as the arm put
     *  it: chordFingers) */
    private chordPalm;
    /** the fingers solved on the hand as the arm has put it (the palm held), and posed */
    private chordFingers;
    private mcq;
    private static NO_TIPS;
    /** a built hand's fingers with nothing to reach: every number at its rest (askHand's: the curl's cascade, a grip's
     *  wrap, the keys'), within its limits, no solve; the arch with the grip (a fist's palm cups) */
    private restFingers;
    private fkP;
    private fkU;
    private fkK;
    private fkZ;
    /** a finger's spread and joint angles (bind-space, about the hand's own axes) that put its tip on a world point: the
     *  spread turns it toward the point; the curl (end joints coupled to the middle one, 2/3) is solved for the reach by
     *  bisection, then the knuckle aims the tip at it */
    private fingerIK;
    /** the thumb's swing in and its curl that put its tip on a world point */
    private thumbIK;
    private rigFace;
    private rigChains;
    /** the cloth's look, one for every way she moves (walking, running, riding, flying, gliding, swimming, sitting, the
     *  bending): its chain as the physics left it, taken as each segment's swing from where it hangs at rest, and that
     *  swing followed slowly (a critically damped spring of about a second: no fast flapping, a leg's kick or a gust
     *  eased in and out), held within a cone (wide on foot, narrow at speed in the air: she keeps her form), with a slow
     *  billow over it (a few degrees, about 2.6 s round, rippling down the chain, more in wind or at speed). Each
     *  segment keeps its length (at most a tenth longer in the fastest flight), and what's left is kept out of her legs
     *  and body */
    private grace;
}
//# sourceMappingURL=rig.d.ts.map