// The heroine's procedural rig (after the waterbending game's, its locomotion rebuilt): joints posed in world space
// each frame, each bone's skin transform mapping its bind frame onto its posed frame, sent to the GPU as dual
// quaternions.
//
// Walking and running are one gait clock (cadence and stride from the speed, as people walk: about a stride a second
// at 1.4 m/s, a longer, quicker one running), the duty factor sliding from a walk's long stance to a run's flight.
// A planted foot never moves — it rolls heel strike -> flat -> onto the ball -> toe-off about its heel and its ball;
// a swinging foot travels on a minimum-jerk path, lifted early, reaching down for the heel, toward where the hip will
// be when it lands (re-aimed every frame, filtered). The pelvis rides over the stance foot: it rises to mid-stance
// and drops into double support walking (lowest at mid-stance running), sways over the stance foot, turns with the
// swinging leg and lists on its side; the chest counter-rotates and keeps the shoulders level; the head stays steady
// on its target; the arms swing opposite the legs a beat behind them through a follow-through spring. Setting off,
// the foot behind steps first, a short step; stopping, the last swing lands beside the other foot; standing, a foot
// left behind or turned steps back under her. On stairs the feet take the treads. Leaning: into acceleration, into
// turns, up slopes.
//
// Also: jumps (a running leap strides through the air, a standing one tucks), flight (hovering, gliding, boosting —
// posed bodies leaned whole along her path), swimming (treading water, breaststroke and crawl at the surface with her
// head floated out, floating, the pull-out and the dolphin kick under water, a streamlined leap — the same posed body;
// the hair and cloth buoyant and slow in the water), waterbending (arms that draw, hold, swirl and throw the water, the head
// and eyes on it), sitting at an instrument (pelvis on the seat, feet on the floor and the pedal, hands placed by the
// instrument's playable points, each finger reaching its own key by IK), the face (blinks, gaze, expression) and the
// braid, hair loops and tunic panels as verlet chains.
//
// (@ericrius1/cast: Boulder's hero rig — web/src/hero/rig.ts, from the waterbending game's — with every copy's later
// work merged back into one: Boulder's own to 01f163a (a seat let go walks on, setting off at speed, steps never off an
// edge, a deck that moves, the glider, held goals in a leaned body, the arm fit's elbow continuity and torso), Codevember's
// day 9 (the elbow's swivel as a spring: armSpring), Seven Havens' (a flame held in the palm), San Francisco's (the
// triple jump's flip, the skydive, the double jump's arms, props placed in the world, one body taking over from another
// mid-motion: carry) and Drake's (dancing on the spot: groove; a dragon's knees and a quick dismount's feet; the
// walking clock hurried by a foot left far behind; the breath; holds anchored to a bone; forearm twist limits; chains
// whose constraints can't fling them: MAX_KICK). See MIGRATION.md for what each project's copy differs by.)
import { type V3, add, sub, scale, norm, cross, dot, len, clamp, lerp, lerp3, smoothstep, rotateAxis, damp, drotateAxis, ddamp, q30, angDiff, ease, minJerk, rej, cdSpring, Spring3, bump } from './math.js';
import type { HeroAsset } from './asset.js';
import { MAX_BONES } from './asset.js';
import { poseHang, hang, hangBone, HOLD } from './garment.js';
import { Face, fromLegacy, toLegacy, blank, type FaceState } from './face.js';
import type { BodyGoal, BodyPose, BodyModel, BodyState } from './body/solve.js';
import { HandModel, HandSolve, handAsk, solveHand, hpOf, HP_ARCH, HAND_N, type HandAsk } from './fingers.js';
import { KEYS_PRIOR } from './body/handprior.js';

type Fr = { o: V3; x: V3; y: V3; z: V3 };
const frW = (f: Fr, l: V3): V3 => [f.o[0] + f.x[0] * l[0] + f.y[0] * l[1] + f.z[0] * l[2], f.o[1] + f.x[1] * l[0] + f.y[1] * l[1] + f.z[1] * l[2], f.o[2] + f.x[2] * l[0] + f.y[2] * l[1] + f.z[2] * l[2]];
const frD = (f: Fr, l: V3): V3 => [f.x[0] * l[0] + f.y[0] * l[1] + f.z[0] * l[2], f.x[1] * l[0] + f.y[1] * l[1] + f.z[1] * l[2], f.x[2] * l[0] + f.y[2] * l[1] + f.z[2] * l[2]];
const frL = (f: Fr, w: V3): V3 => { const d = sub(w, f.o); return [dot(d, f.x), dot(d, f.y), dot(d, f.z)]; };
const frRot = (f: Fr, axis: V3, a: number): Fr => (a === 0 ? f : { o: f.o, x: rotateAxis(f.x, axis, a), y: rotateAxis(f.y, axis, a), z: rotateAxis(f.z, axis, a) });
function frEuler(f: Fr, yaw: number, pitch: number, roll: number): Fr {
  let g = frRot(f, f.y, yaw);
  g = frRot(g, g.x, pitch);
  return frRot(g, g.z, roll);
}
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- what drives her
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
export interface HandGoal { palm: V3; fwd: V3; down: V3; tips: (V3 | null)[]; /** the fingers' curl (0 open .. 1 a fist; else a grip's) */ curl?: number;
  /** the fingers closed round something held (0..1; a cup, a bowl): set, the hand holds rather than resting on keys —
   *  the fingers without a tip's target curl by `curl` and this, the thumb too */
  grip?: number;
  /** what's held, as a shape (world): a cylinder about `axis` through `at` of radius `r` (a cup, a glass, a tool's
   *  handle, a bow's stick; `len` long, centred on `at`, else endless), or a ball (`axis` [0,0,0]). With `grip` set,
   *  each finger and the thumb close from open toward the grip's curl and stop where their skin meets its surface
   *  (`pad`: the finger's half-thickness at the pad, m, default 8.5 mm for a 4.8 cm-knuckled hand, scaled to the
   *  hand's) — nothing passes through what it holds, and the thumb opposes the fingers round it */
  around?: { at: V3; axis: V3; r: number; len?: number; pad?: number };
  /** a built hand's fingers posed as given (fingers.ts's numbers, HAND_N; the palm's six ignored): a grasp solved
   *  against what's held (grasp.ts graspGoal), blended in with the goal's weight. Set, `around` is not closed */
  pose?: ArrayLike<number>;
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
  floor?: { at: V3; n: V3; clear: number };
  /** how much real pianists' hands shape a built hand at the keys (0..1; body/handprior.ts): the fingertips with targets
   *  land on them, and the rest of the hand — the idle fingers, the thumb, the arch, how the playing fingers bend to
   *  their keys — takes the posture real hands have with those fingers down, rather than each finger's own rest
   *  (the Pianist sets it for a built hand: piano.ts forHand) */
  prior?: number }
/** sitting at an instrument: the pelvis on the seat, facing it, the feet's places, the hands' goals, where she looks;
 *  w how far she's sat down (0..1) */
export interface SeatPose { pelvis: V3; yaw: number; feet: [V3, V3]; hands: [HandGoal, HandGoal]; look: V3; lean: number; w: number;
  /** both shoulders up (0..1: a laugh's bounce, hero/table.ts) */
  shrug?: number;
  /** (Drake's dragon) each knee's way (world; left, right): astride a dragon's neck the knees go out round it, not up
   *  and ahead as at a piano's bench */
  knees?: [V3, V3];
  /** how quickly the feet follow their places (1/s; default 7): a quick move (a dismount's slide) wants them close */
  feetK?: number }
/** holding something before her, standing (a book, the kaleidoscope): each hand's goal (null: free) and how far it's
 *  gone to it (0..1), how far she stoops to reach it (0..1) */
export interface HoldPose { hands: [HandGoal | null, HandGoal | null]; w: [number, number]; stoop: number;
  /** how much of the stoop is in the knees (1, the default) rather than the back: a tall man at a low eyepiece bows */
  bend?: number;
  /** the goals are where the hands go in the world with the body as it leans flying or swimming (Aang's glider's grip,
   *  play/powers.ts): taken into the upright body the lean then tips, as the bending's target is (without it they're
   *  for the upright body, and the lean tips them along with it) */
  leaned?: boolean }

/** a prop's place in the world: its base point, its up, its front */
export interface PropPlace { at: V3; up: V3; fwd: V3 }

export interface RigInput {
  dt: number; time: number;
  /** her feet's point on the ground (the root), facing (0 = toward -z), velocity, horizontal speed */
  pos: V3; yaw: number; vel: V3; speed: number;
  running: boolean; onGround: boolean;
  /** water around her legs (m) and a landing's downward speed (consumed) */
  wade: number; landImpact: number;
  pose: BendPose; look: V3 | null; wind: V3;
  /** the ground under a point at her feet's level (house floors, stair treads, the terrain) */
  ground: (x: number, z: number) => number;
  /** flying: the whole body leans (pitch forward, roll into turns) about the waist; the boost's wind-up (0..1) */
  flying?: boolean; flyPitch?: number; flyRoll?: number; boost?: number;
  /** a triple jump's front somersault under way (0..1, 0: none): tucked, the whole body turned once about the waist */
  flip?: number;
  /** in a skydive (0..1: how far into its pose) and how far head first (0 spread out on the air .. 1 a head-first dive):
   *  posed as flying, leaned by flyPitch */
  skydive?: number; diveDown?: number;
  /** in the air off a chain of jumps: which (2: the double, the arms thrown up overhead) and since it (s) */
  jump?: number; jumpT?: number;
  /** flying under a glider (0..1: Aang's, play/powers.ts): hanging from its grip, the legs together and long under him,
   *  trailing as he lies along his path — not a flyer's open float, a knee drawn up */
  glider?: number;
  seat?: SeatPose | null;
  hold?: HoldPose | null;
  /** a whole body from goals (body/solve.ts: yoga, fishing, singing, an instrument's seat ...) over the rest by w
   *  (0..1): the pelvis, the spine and the legs solved by their ease, the arms to the goal's hands */
  body?: { goal: BodyGoal; w: number } | null;
  /** 0 none, 1 at the surface, 2 under water, 3 leaping out of it (a streamlined arc); the stroke cycle (0..1); the
   *  water's level */
  swim?: number; swimPhase?: number; waterLevel?: number | null;
  /** a body posed whole by another solver and blended over her own by w (yoga, play/yoga: a Pose solved on her skeleton
   *  by aang/rig.ts): its bones (her face, hair and cloth are then hers, from the blend) and where she looks */
  posed?: { bones: Float32Array; w: number; look: V3 | null } | null;
  /** (Gong Bong) dancing on the spot to the music, over the rest: the pelvis dropped (m: the knees bend under it),
   *  shifted to the left (m), the chest turned (rad, + to the left) and rocked (rad, + forward), rolled (rad, + its
   *  left shoulder down), the head nodded (rad, + down) and tilted (rad, + toward the left shoulder) */
  groove?: Groove | null;
  /** what she stands on moving under her this frame (m: a bowl afloat, a deck that moves): the planted feet go with it */
  carry?: V3 | null;
}
export interface Groove { bounce: number; sway: number; twist: number; rock: number; roll: number; nod: number; tilt: number }

// ---------------------------------------------------------------- flight poses
// A pose in her own (un-leaned) body axes — x her left, y up, z forward — that the whole body is then leaned into:
// wrists relative to the shoulders, palm normals, legs as [hip flexion, knee flexion, spread, foot point], the spine,
// extra lean / float. Poses blend linearly (hover -> glide -> boost).
interface AirPose {
  hand: V3[]; palm: V3[]; curl: number[]; grip: number[]; leg: number[][];
  /** each elbow's way (the chest's frame, as the hands; zero: the arms' own) */
  elbow: V3[];
  /** the arms overhead in a streamline, fitted to the body (0..1: HeroRig.overArm — the wrists stacked over the head's
   *  middle, the arms straight at its own length; the hands' keys then only give the stack its depth) */
  over: number;
  arch: number; twist: number; bend: number; hipPitch: number; headYaw: number; headPitch: number;
  pitch: number; roll: number; lift: number;
}
const newPose = (): AirPose => ({ hand: [[0, 0, 0], [0, 0, 0]], palm: [[0, 0, 0], [0, 0, 0]], curl: [0, 0], grip: [0, 0], leg: [[0, 0, 0, 0], [0, 0, 0, 0]], elbow: [[0, 0, 0], [0, 0, 0]], over: 0, arch: 0, twist: 0, bend: 0, hipPitch: 0, headYaw: 0, headPitch: 0, pitch: 0, roll: 0, lift: 0 });
const POSE_K = ['over', 'arch', 'twist', 'bend', 'hipPitch', 'headYaw', 'headPitch', 'pitch', 'roll', 'lift'] as const;
function mixPose(o: AirPose, p: AirPose, w: number) {
  if (w <= 1e-5) return;
  for (let i = 0; i < 2; i++) {
    for (let k = 0; k < 3; k++) { o.hand[i][k] += p.hand[i][k] * w; o.palm[i][k] += p.palm[i][k] * w; o.elbow[i][k] += p.elbow[i][k] * w; }
    o.curl[i] += p.curl[i] * w; o.grip[i] += p.grip[i] * w;
    for (let k = 0; k < 4; k++) o.leg[i][k] += p.leg[i][k] * w;
  }
  for (const k of POSE_K) o[k] += p[k] * w;
}
/** a cyclic keyframed curve (keys from u = 0, ascending): a smooth Hermite spline through them, so strokes flow */
type Key = [number, number[]];
function cyc(u: number, keys: Key[]): number[] {
  const n = keys.length;
  u -= Math.floor(u);
  let i = 0;
  for (let k = 0; k < n; k++) if (keys[k][0] <= u) i = k;
  const at = (j: number): Key => [keys[((j % n) + n) % n][0] + Math.floor(j / n), keys[((j % n) + n) % n][1]];
  const [t0, p0] = at(i - 1), [t1, p1] = at(i), [t2, p2] = at(i + 1), [t3, p3] = at(i + 2);
  const h = t2 - t1, t = (u - t1) / h, tt = t * t, ttt = tt * t;
  const a = 2 * ttt - 3 * tt + 1, b = ttt - 2 * tt + t, c = -2 * ttt + 3 * tt, d = ttt - tt;
  const s1 = h / (t2 - t0), s2 = h / (t3 - t1);
  return p1.map((v, k) => v * a + (p2[k] - p0[k]) * s1 * b + p2[k] * c + (p3[k] - p1[k]) * s2 * d);
}
const sideV = (v: number[], side: number): V3 => [v[0] * side, v[1], v[2]];
// swimming at the surface: treading water (sculling hands, slow eggbeater kicks), breaststroke (pull, breathe, kick,
// glide), front crawl (a long reach, a high-elbow recovery, the body rolling with each pull, a flutter kick)
function treadPose(t: number): AirPose {
  const P = newPose();
  const w = t * Math.PI * 2 * 0.7, s1 = Math.sin(w), c1 = Math.cos(w);
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1, ph = t * Math.PI * 2 * 0.55 + i * Math.PI;
    P.hand[i] = [side * (0.3 + 0.08 * s1), -0.27 + 0.02 * c1, 0.2 + 0.03 * c1];
    P.palm[i] = [side * 0.55 * c1, -1, 0];
    P.curl[i] = 0.2;
    P.leg[i] = [0.45 + 0.12 * Math.sin(ph), 0.95 + 0.28 * Math.cos(ph), 0.2, 0.35];
  }
  P.arch = 0.02;
  return P;
}
const BR_HAND: Key[] = [[0, [0.06, 0.46, 0.1]], [0.14, [0.3, 0.38, 0.14]], [0.28, [0.22, 0.08, 0.3]], [0.38, [0.05, 0.16, 0.26]], [0.52, [0.06, 0.46, 0.1]], [0.8, [0.06, 0.47, 0.1]]];
const BR_PALM: Key[] = [[0, [0, 0.1, 1]], [0.14, [0.8, 0, 0.6]], [0.28, [-0.6, -0.5, 0.6]], [0.38, [-1, 0, 0.2]], [0.52, [0, 0.1, 1]], [0.8, [0, 0.1, 1]]];
const BR_LEG: Key[] = [[0, [0, 0.06, -0.06, 1]], [0.28, [0.05, 0.25, -0.03, 0.8]], [0.42, [0.45, 1.9, 0.14, 0.1]], [0.52, [0.15, 0.9, 0.4, 0.2]], [0.62, [0, 0.08, -0.04, 1]], [0.8, [0, 0.06, -0.06, 1]]];
function breastPose(u: number): AirPose {
  const P = newPose();
  const h = cyc(u, BR_HAND), p = cyc(u, BR_PALM), l = cyc(u, BR_LEG);
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1;
    P.hand[i] = sideV(h, side); P.palm[i] = sideV(p, side); P.curl[i] = 0.15;
    P.leg[i] = [l[0], Math.max(0.03, l[1]), l[2], l[3]];
  }
  const breath = bump(u, 0.08, 0.42);
  P.arch = 0.12 + 0.18 * breath; P.pitch = -0.16 * breath; P.headPitch = 0.1 * breath; P.lift = 0.05 * breath;
  return P;
}
const CR_HAND: Key[] = [[0, [0.1, 0.45, 0.12]], [0.15, [0.06, 0.32, 0.26]], [0.32, [0.0, 0.04, 0.27]], [0.45, [0.13, -0.38, 0.14]], [0.55, [0.24, -0.3, -0.08]], [0.75, [0.33, 0.06, -0.18]], [0.9, [0.18, 0.38, -0.02]]];
/** the crawl's elbows: high, out and up toward the back, through the catch and the recovery (the arm's own way, out,
 *  down and back, left the forearm to roll half a turn) */
const CR_ELBOW: Key[] = [[0, [0.5, 0, -1]], [0.5, [0.5, 0, -1]]];
// (the recovery's palm: in to the thigh at the exit, back toward the feet under the high elbow, down at the entry — a
// quarter turn each way; it was keyed up to the sky and over, half a turn the forearm can't make, and it spun round)
const CR_PALM: Key[] = [[0, [0, 0, 1]], [0.15, [0, -0.5, 0.9]], [0.45, [0, -1, 0.2]], [0.55, [-0.8, -0.5, 0.2]], [0.75, [-0.25, -0.95, 0.15]], [0.9, [0.15, -0.3, 1]]];
function crawlPose(u: number): AirPose {
  const P = newPose();
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1, v = u + (i === 0 ? 0 : 0.5), ph = u * Math.PI * 6 + i * Math.PI;
    P.hand[i] = sideV(cyc(v, CR_HAND), side); P.palm[i] = sideV(cyc(v, CR_PALM), side); P.curl[i] = 0.12; P.elbow[i] = sideV(cyc(v, CR_ELBOW), side);
    P.leg[i] = [0.04 + 0.16 * Math.sin(ph), Math.max(0.03, 0.18 + 0.14 * Math.sin(ph + 1.2)), -0.05, 1];
  }
  P.roll = -0.5 * Math.sin(u * Math.PI * 2);
  P.headYaw = -0.7 * bump(u, 0.12, 0.45);
  P.arch = 0.05; P.lift = -0.12;
  return P;
}
// under water: floating (slow sculling, buoyant), the breaststroke pull-out (a long glide with the arms along the
// body, then the recovery and kick into a streamline), the dolphin kick (arms locked forward, the body a wave)
function floatPose(t: number): AirPose {
  const P = newPose();
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1, w = t * Math.PI * 2 * 0.32 + i * 0.5, ph = t * Math.PI * 2 * 0.4 + i * Math.PI;
    P.hand[i] = [side * (0.36 + 0.05 * Math.sin(w)), -0.14 + 0.04 * Math.cos(w), 0.12];
    P.palm[i] = [side * 0.4 * Math.cos(w), -1, 0];
    P.curl[i] = 0.25;
    P.leg[i] = [0.12 + 0.1 * Math.sin(ph), 0.35 + 0.12 * Math.sin(ph + 1), -0.02, 0.8];
  }
  P.headPitch = 0.1;
  return P;
}
const UB_HAND: Key[] = [[0, [0.04, 0.47, -0.01]], [0.12, [0.34, 0.3, 0.08]], [0.24, [0.3, -0.04, 0.17]], [0.34, [0.14, -0.45, 0.04]], [0.6, [0.14, -0.46, 0.03]], [0.71, [0.08, 0.08, 0.2]], [0.82, [0.04, 0.47, -0.01]]];
const UB_PALM: Key[] = [[0, [0, 0, 1]], [0.12, [0.8, 0, 0.6]], [0.24, [0, -0.8, 0.5]], [0.34, [-1, 0, 0.2]], [0.6, [-1, 0, 0.2]], [0.71, [-0.6, 0.3, 0.6]], [0.82, [0, 0, 1]]];
/** the pull-out's streamline: at the glide's start and back again after the recovery */
const UB_OVER: Key[] = [[0, [1]], [0.1, [0]], [0.72, [0]], [0.82, [1]]];
const UB_LEG: Key[] = [[0, [0, 0.05, -0.06, 1]], [0.62, [0, 0.05, -0.06, 1]], [0.72, [0.45, 1.85, 0.14, 0.15]], [0.8, [0.15, 0.8, 0.38, 0.25]], [0.88, [0, 0.06, -0.04, 1]]];
function pullOutPose(u: number): AirPose {
  const P = newPose();
  const h = cyc(u, UB_HAND), p = cyc(u, UB_PALM), l = cyc(u, UB_LEG);
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1;
    P.hand[i] = sideV(h, side); P.palm[i] = sideV(p, side); P.curl[i] = 0.12;
    P.leg[i] = [l[0], Math.max(0.03, l[1]), l[2], l[3]];
  }
  P.over = clamp(cyc(u, UB_OVER)[0], 0, 1);
  // (head down between the arms in the streamline, up to see ahead through the pull)
  P.arch = 0.05 + 0.08 * bump(u, 0.1, 0.4);
  P.headPitch = -0.3 + 0.3 * bump(u, 0.05, 0.75);
  return P;
}
/** a foot pointed: how far it's turned down from its angle at rest (rad, at flex 1; scaled by the body's flexibility —
 *  0.75: ~43°, inside the ankle's easy plantarflexion; it was 0.81 for everyone, past a stiffer body's limit) */
const POINT = 0.75;
/** the dolphin kick's elbows: out and toward the back, the arms locked over the head (the forearms were rolled ~180°) */
const DL_ELBOW: V3 = [0.7, 0, -0.7];
function dolphinPose(u: number, amp: number): AirPose {
  const P = newPose(), ph = u * Math.PI * 2;
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1;
    P.hand[i] = [side * 0.04, 0.47, -0.01 + 0.03 * amp * Math.sin(ph)];
    P.palm[i] = [0, 0, 1]; P.curl[i] = 0.1; P.elbow[i] = sideV(DL_ELBOW, side);
    P.over = 1;
    P.leg[i] = [0.1 * amp + 0.2 * amp * Math.sin(ph), 0.06 + 0.55 * amp * Math.max(0, Math.sin(ph + 1.1)), -0.08, 1];
  }
  P.headPitch = -0.3;
  P.hipPitch = -0.1 * amp * Math.sin(ph - 0.6); P.arch = 0.08 * amp * Math.sin(ph - 1.4); P.pitch = 0.06 * amp * Math.sin(ph - 2.2);
  return P;
}
// floating upright (arms open, palms down, one knee forward, breathing); gliding (long and level, arms swept back like
// wings, legs together and pointed); boosting (a tight streamline, arms along the body); the triple boost (a fist)
function hoverPose(t: number): AirPose {
  const P = newPose();
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1, br = Math.sin(t * 1.15 + i * 0.7);
    P.hand[i] = [side * (0.3 + 0.015 * br), -0.33 + 0.035 * br, 0.13 + 0.02 * Math.sin(t * 0.8 + i * 1.9)];
    P.palm[i] = [-side * 0.15, -1, 0.12];
    P.curl[i] = 0.3;
  }
  const a = Math.sin(t * 0.7), b = Math.sin(t * 0.7 + 1.3);
  P.leg[0] = [0.05 + 0.04 * a, 0.08, -0.06, 0.85];
  P.leg[1] = [0.38 + 0.06 * b, 0.8 + 0.1 * b, -0.09, 0.95];
  P.arch = 0.05 + 0.03 * Math.sin(t * 1.15);
  P.pitch = 0.04 * Math.sin(t * 0.5); P.roll = 0.035 * Math.sin(t * 0.37); P.lift = 0.035 * Math.sin(t * 1.25);
  return P;
}
function glidePose(t: number): AirPose {
  const P = newPose();
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1, soar = Math.sin(t * 0.9 + i * 0.5);
    P.hand[i] = [side * 0.4, -0.28 + 0.02 * soar, -0.08 - 0.03 * soar];
    // (palms down, as wings: facing forward with the arms swept back, the forearms rolled past their limit)
    P.palm[i] = [0, -1, 0.25];
    P.curl[i] = 0.2;
  }
  P.leg[0] = [-0.06, 0.07, -0.065, 1];
  P.leg[1] = [0.08, 0.34, -0.07, 1];
  P.arch = 0.14;
  return P;
}
function boostPose(t: number, flutter: number): AirPose {
  const P = newPose();
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1;
    P.hand[i] = [side * 0.15, -0.47, -0.1];
    P.palm[i] = [-side, 0, 0.4];
    P.curl[i] = 0.15;
    P.leg[i] = [-0.04 + flutter * Math.sin(t * 17 + i * 2), 0.03, -0.075, 1];
  }
  P.arch = 0.08;
  return P;
}
function triplePose(t: number): AirPose {
  const P = boostPose(t, 0.02);
  // (the fist made by the grip, the curl light: curled 0.95 on top of it, every knuckle past its limit)
  P.hand[1] = [0.05, 0.47, 0.1]; P.palm[1] = [0, 0, 1]; P.curl[1] = 0.2; P.grip[1] = 1;
  P.arch = 0.06;
  return P;
}
// the triple jump's somersault (a platformer's: knees hugged to the chest, the back rounded, the head tucked)
function tuckPose(): AirPose {
  const P = newPose();
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1;
    P.hand[i] = [side * 0.17, -0.36, 0.34];
    P.palm[i] = [-side * 0.6, -0.2, -0.8];
    P.curl[i] = 0.7; P.grip[i] = 0.5;
    P.leg[i] = [1.85, 2.2, side * 0.02 - 0.06, 0.9];
  }
  P.arch = -0.4; P.headPitch = 0.35; P.hipPitch = 0.2;
  return P;
}
// the skydive spread out on the air (the box: a skydiver's belly-to-earth arch): the arms out level with the shoulders,
// the forearms up past the head, palms to the ground; the knees bent, the shins up behind; the back arched, the chin up.
// Posed upright, leaned face down by flyPitch (pi/2) — so "up" here is toward her head, "forward" toward the ground
function skyPose(t: number): AirPose {
  const P = newPose();
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1, w = 0.012 * Math.sin(t * 7.3 + i * 2.1) + 0.008 * Math.sin(t * 11.1 + i);
    P.hand[i] = [side * (0.36 + w), 0.36 + w, 0.12];
    P.elbow[i] = [side * 1, -0.25, 0.1];
    P.palm[i] = [0, 0, 1];
    P.curl[i] = 0.15;
    P.leg[i] = [-0.2, 1.45 + 0.04 * Math.sin(t * 5.1 + i * 1.3), -0.17, 0.75];
  }
  P.arch = 0.32; P.headPitch = -0.35; P.hipPitch = -0.08;
  return P;
}
// the head-first dive: the arms back along the sides, the legs long and together, a little arch (the air flattening
// the hands back), buffeting
function headPose(t: number): AirPose {
  const P = boostPose(t, 0.02);
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1;
    P.hand[i] = [side * 0.2, -0.5, -0.06 + 0.01 * Math.sin(t * 9 + i)];
    P.palm[i] = [side * 0.2, 0, -1];
  }
  P.arch = 0.1; P.headPitch = -0.25;
  return P;
}
function flightPose(t: number, fwdSp: number, sp: number, vy: number, triple: number, roll: number, pitch: number, glider: number, sky = 0, down = 0): AirPose {
  if (sky > 0.999) { const Q = newPose(); mixPose(Q, skyPose(t), 1 - down); mixPose(Q, headPose(t), down); return Q; }
  const glide = smoothstep(1.5, 8, fwdSp), fast = smoothstep(14, 24, sp) * glide, tk = clamp(triple, 0, 1) * fast;
  let P = newPose();
  mixPose(P, hoverPose(t), 1 - glide);
  mixPose(P, glidePose(t), glide - fast);
  mixPose(P, boostPose(t, 0.012), fast - tk);
  mixPose(P, triplePose(t), tk);
  // diving head-first: streamlined
  const dive = smoothstep(1.75, 2.3, pitch) * glide * (1 - tk);
  if (dive > 0) { const Q = newPose(); mixPose(Q, P, 1 - dive); mixPose(Q, boostPose(t, 0), dive); P = Q; }
  // under a glider: the legs together and long, a little give at the knees (less as he lies along his way), the feet
  // pointed, swaying a touch with the air (the user's clip: Aang climbing away under his glider, legs hanging together)
  if (glider > 0) for (const i of [0, 1]) {
    const hang = [0.07 * (1 - glide) + 0.03 * Math.sin(t * 1.3 + i * 1.7), 0.06 + 0.16 * (1 - glide), -0.07, 1];
    for (let k = 0; k < 4; k++) P.leg[i][k] += (hang[k] - P.leg[i][k]) * glider;
  }
  // climbing: the arms rise and open, the back arches; banking: the outside arm rides higher
  const climb = clamp(vy / 9, 0, 1) * glide * (1 - tk);
  for (const i of [0, 1]) {
    const side = i === 0 ? 1 : -1, raise = side * roll;
    P.hand[i][1] += 0.14 * climb + 0.06 * raise;
    P.hand[i][0] += side * 0.05 * climb;
    P.hand[i][2] += 0.04 * climb - 0.12 * raise * glide;
  }
  P.arch += 0.12 * climb;
  P.twist += -roll * 0.1;
  if (sky > 0) { const Q = newPose(); mixPose(Q, P, 1 - sky); mixPose(Q, skyPose(t), sky * (1 - down)); mixPose(Q, headPose(t), sky * down); return Q; }
  return P;
}

/** two-bone IK: the middle joint, bending toward `pole`; a soft reach near full extension */
function ik2(a: V3, target: V3, l1: number, l2: number, pole: V3, soft = 0): V3 {
  const d = sub(target, a);
  let dl = len(d);
  const da = l1 + l2 - soft;
  if (soft > 0 && dl > da) dl = da + soft * (1 - Math.exp(-(dl - da) / soft));
  dl = clamp(dl, 1e-4, l1 + l2 - 1e-4);
  const dn = norm(d);
  const x = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let pp = rej(pole, dn);
  if (len(pp) < 1e-5) pp = [0, 1, 0];
  pp = norm(pp);
  return add(add(a, scale(dn, x)), scale(pp, h));
}

/** a hand's frame: its way (wrist to knuckles), its palm's way, its thumb's side; how far it may turn about its way */
/** (k: the body's suppleness, its forearm's and wrist's share of it: body/anatomy.ts flexOf) */
type HandFrame = { h: V3; p: V3; t: V3; turn?: number; bear?: boolean; hum?: boolean; k?: number; ew?: number };
/** a hand's goal moved bodily by d */
const shiftGoal = (g: HandGoal, d: V3): HandGoal => ({ ...g, palm: add(g.palm, d), tips: g.tips.map((t) => t && add(t, d)), knuckles: g.knuckles && add(g.knuckles, d) });
/** a hand turned about its own way */
const turnHand = (G: HandFrame, a: number): HandFrame => ({ ...G, p: rotateAxis(G.p, G.h, a), t: rotateAxis(G.t, G.h, a) });
/** a body's forearm turn and wrist ranges by its suppleness (the forearm's a quarter as supple as the spine, the wrist
 *  two fifths: body/anatomy.ts) */
const rollK = (G: HandFrame) => 1 + ((G.k ?? 1) - 1) * 0.25, wristK = (G: HandFrame) => 1 + ((G.k ?? 1) - 1) * 0.4;
/** how fast an arm's fit lets its elbow swing round the shoulder-wrist line (rad/s), and how much better (in the fit's
 *  own cost, and a share of it) a far way round must be before the elbow hurries over to it (boulder's hero rig, from
 *  Codevember's day 9: elbows that slide, never flip) */
const ARM_SWING = 9, ARM_FLIP = 2.5;
/** the forearm's whole turn (rad, about its length, from the elbow's way: the forearm's half and the wrist's): free to
 *  TW0, eased to at most TW1 past it */
const TW0 = 1.75, TW1 = 2.05;
/** how far a forearm rolls from its middle (pronation, supination) */
const ROLL_MAX = 1.48;
/** the upper arm's up (the elbow's inside, where the forearm folds to) and the forearm's (its roll's zero: the thumb
 *  that way is the forearm at its middle, neither turned palm down nor up) */
function armUps(ud: V3, fd: V3, pole: V3): [V3, V3] {
  const bend = rej(fd, ud), bl = len(bend);
  const pdir = norm(scale(rej(pole, ud), -1));
  let elbowUp = bl > 1e-5 ? lerp3(pdir, scale(bend, 1 / bl), smoothstep(0.02, 0.2, bl)) : pdir;
  elbowUp = len(elbowUp) > 1e-4 ? norm(elbowUp) : pdir;
  const hax = cross(ud, fd), hal = len(hax);
  const faUp = hal > 1e-6 ? rotateAxis(elbowUp, scale(hax, 1 / hal), Math.atan2(hal, dot(ud, fd))) : elbowUp;
  return [elbowUp, norm(rej(faUp, fd))];
}
/** the forearm's roll (about its own line) that brings its up round to a thumb's way: the short way */
function rollTo(faUp: V3, thumb: V3, fd: V3): number { const t = rej(thumb, fd); return Math.atan2(dot(cross(faUp, t), fd), dot(faUp, t)); }
/** the wrist's bend from the forearm to a hand: flexion (toward the palm, + ) and deviation (toward the thumb, +) */
function wristBend(fd: V3, G: HandFrame): [number, number] {
  const fh = dot(fd, G.h);
  return [Math.atan2(-dot(fd, G.p), fh), Math.atan2(-dot(fd, G.t), fh)];
}
// how far a wrist goes: flexion 70°, extension 57°, toward the thumb 20°, away 32° (and comfortably about half that)
const FLEX = [1.22, 1.0], DEV = [0.35, 0.56], FLEX_OK = [0.5, 0.35], DEV_OK = [0.14, 0.26], ROLL_OK = 0.85;
// (a hand flat under the body's weight: the wrist pressed back to ~88°, at ease to ~60°: anatomy.ts's loaded limits)
const FLEX_BEAR = [1.22, 1.54], FLEX_OK_BEAR = [0.5, 1.05];
/** how ill at ease an arm is holding a hand so (0 at its middle; a joint past its comfortable range quickly worse, past
 *  its limit far worse) */
function armEase(fd: V3, faUp: V3, G: HandFrame): number {
  const over = (x: number, ok: number, lim: number) => { const e = Math.max(0, x - ok), b = Math.max(0, x - lim); return 3 * e * e + 40 * b * b; };
  const tw = rollTo(faUp, G.t, fd);
  const [fl, dv] = wristBend(fd, G);
  const F = G.bear ? FLEX_BEAR : FLEX, FO = G.bear ? FLEX_OK_BEAR : FLEX_OK, rk = rollK(G), wk = wristK(G);
  return over(Math.abs(tw), ROLL_OK * rk, ROLL_MAX * rk) + 0.1 * tw * tw
    + (fl >= 0 ? over(fl, FO[0] * wk, F[0] * wk) : over(-fl, FO[1] * wk, F[1] * wk)) + (G.bear ? 0.05 : 0.25) * fl * fl
    + (dv >= 0 ? over(dv, DEV_OK[0] * wk, DEV[0] * wk) : over(-dv, DEV_OK[1] * wk, DEV[1] * wk)) + 0.25 * dv * dv;
}
/** a hand turned back toward the forearm's line until the wrist's within its limits (an ellipse through them) */
function wristLimit(fd: V3, G: HandFrame): HandFrame {
  const [fl, dv] = wristBend(fd, G);
  const wk = wristK(G);
  const e = Math.hypot(fl / ((G.bear ? FLEX_BEAR : FLEX)[fl >= 0 ? 0 : 1] * wk), dv / (DEV[dv >= 0 ? 0 : 1] * wk));
  if (e <= 1) return { h: G.h, p: G.p, t: G.t };
  const ax = cross(fd, G.h), sa = len(ax);
  if (sa < 1e-5) return { h: G.h, p: G.p, t: G.t };
  const n = scale(ax, 1 / sa), back = -Math.atan2(sa, dot(fd, G.h)) * (1 - 1 / e);
  return { h: rotateAxis(G.h, n, back), p: rotateAxis(G.p, n, back), t: rotateAxis(G.t, n, back) };
}

/** how ill at ease the shoulder is turning the humerus so (the elbow's inside against where raising the arm straight
 *  from hanging carries it: body/measure.ts's reading; turned in 80°, out 95°, at ease about half that) */
function humerusEase(CS: { x: V3; y: V3; z: V3 }, ud: V3, elbowUp: V3, side: number): number {
  const loc = (v: V3): V3 => [side * dot(v, CS.x), dot(v, CS.y), dot(v, CS.z)];
  const d = loc(ud), f = loc(elbowUp);
  const ax = cross([0, -1, 0], d), sa = len(ax);
  const ref: V3 = sa > 1e-5 ? rotateAxis([0, 0, 1], scale(ax, 1 / sa), Math.atan2(sa, -d[1])) : [0, 0, 1];
  const rot = -Math.atan2(dot(cross(ref, f), d), dot(ref, f));
  const over = (x: number, ok: number, lim: number) => { const e = Math.max(0, x - ok), b = Math.max(0, x - lim); return 3 * e * e + 40 * b * b; };
  return rot >= 0 ? over(rot, 0.78, 1.66) : over(-rot, 0.61, 1.4);
}

/** how much of the head's turn and nod (and tilt) the neck bone takes, the head the rest: by the two levels' ranges
 *  (body/anatomy.ts neckLow, neckUp: the lower neck two thirds of the nod, a little under half of the turn, the atlas
 *  most of it). A third of each, as it was, left the upper neck bent back ~35° (its limit 25°) flying and swimming */
export const NECK = { turn: 0.45, nod: 0.65, tilt: 0.5 };

/** a chain segment's roll (its bone's up), carried on from last frame's: turned by the least rotation from last frame's
 *  way to this one's, then eased a fifth of the way a 60 Hz frame toward the roll it has off its rest shape (`rest`, taken on
 *  the carried one's side). The rest roll alone — the rest shape's up swung onto the segment — turns over when the
 *  segment swings far from its rest way (a panel hanging from tipped hips, whipping as they come up), and the cloth
 *  skinned to it turns inside out for a frame. `mem` keeps each segment's last way and up */
export function carryUp(mem: { up: V3[]; dir: V3[] }, i: number, dir: V3, rest: V3, reset: boolean, dt: number): V3 {
  const pu = mem.up[i], pd = mem.dir[i];
  let u = rest;
  if (!reset && pu && pd) {
    const ax = cross(pd, dir), sa = len(ax);
    const c = norm(rej(sa > 1e-6 ? rotateAxis(pu, scale(ax, 1 / sa), Math.atan2(sa, dot(pd, dir))) : pu, dir));
    if (len(c) > 0.5) u = norm(rej(lerp3(c, dot(rest, c) < 0 ? scale(rest, -1) : rest, 1 - Math.pow(0.8, dt * 60)), dir));
  }
  if (!(len(u) > 0.5)) u = rest;
  mem.up[i] = u; mem.dir[i] = dir;
  return u;
}

/** a leg's two bones' ups (their fronts: the thigh's toward the knee's way, the shin's the same side of the hinge),
 *  each perpendicular to its bone about the knee's hinge: the axis across the bend once the knee is bent, the one
 *  across the hip-to-ankle line and the pole while it's near straight. The pole's rejection from the shin (what it
 *  was) flips the shin over when the bent shin lies along the pole — kneeling, a fold onto the heels — and the trousers
 *  twist with it; this doesn't */
export function legUps(thighD: V3, shinD: V3, hipToAnkle: V3, pole: V3): [V3, V3] {
  let ax = cross(hipToAnkle, pole);
  const hinge = cross(shinD, thighD), hb = len(hinge);
  if (len(ax) < 1e-5) ax = hb > 1e-5 ? hinge : cross(thighD, [0, 0, 1]);
  ax = norm(ax);
  // (bent: the hinge's own axis — a knee bends one way only, so its sign is the straight leg's)
  const k = smoothstep(0.15, 0.35, hb);
  if (k > 0) ax = norm(lerp3(ax, scale(hinge, 1 / hb), k));
  return [norm(cross(ax, thighD)), norm(cross(ax, shinD))];
}

export function matToDQ(m: Float32Array, k: number, out: Float32Array, o: number) {
  const m00 = m[k], m10 = m[k + 1], m20 = m[k + 2], m01 = m[k + 4], m11 = m[k + 5], m21 = m[k + 6], m02 = m[k + 8], m12 = m[k + 9], m22 = m[k + 10];
  let x: number, y: number, z: number, w: number;
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  const l = Math.hypot(x, y, z, w) || 1;
  x /= l; y /= l; z /= l; w /= l;
  const tx = m[k + 12], ty = m[k + 13], tz = m[k + 14];
  out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = w;
  out[o + 4] = 0.5 * (tx * w + ty * z - tz * y);
  out[o + 5] = 0.5 * (-tx * z + ty * w + tz * x);
  out[o + 6] = 0.5 * (tx * y - ty * x + tz * w);
  out[o + 7] = -0.5 * (tx * x + ty * y + tz * z);
}

/** two bones' dual quaternions (matToDQ's layout) mixed by w (the shorter way round), back to a rigid matrix */
export function dqMixToMat(a: Float32Array, b: Float32Array, w: number, m: Float32Array, k: number) {
  const sg = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -w : w, u = 1 - w;
  let x = a[0] * u + b[0] * sg, y = a[1] * u + b[1] * sg, z = a[2] * u + b[2] * sg, q = a[3] * u + b[3] * sg;
  let dx = a[4] * u + b[4] * sg, dy = a[5] * u + b[5] * sg, dz = a[6] * u + b[6] * sg, dw = a[7] * u + b[7] * sg;
  const l = Math.hypot(x, y, z, q) || 1;
  x /= l; y /= l; z /= l; q /= l; dx /= l; dy /= l; dz /= l; dw /= l;
  m[k] = 1 - 2 * (y * y + z * z); m[k + 1] = 2 * (x * y + z * q); m[k + 2] = 2 * (x * z - y * q); m[k + 3] = 0;
  m[k + 4] = 2 * (x * y - z * q); m[k + 5] = 1 - 2 * (x * x + z * z); m[k + 6] = 2 * (y * z + x * q); m[k + 7] = 0;
  m[k + 8] = 2 * (x * z + y * q); m[k + 9] = 2 * (y * z - x * q); m[k + 10] = 1 - 2 * (x * x + y * y); m[k + 11] = 0;
  // (the translation: 2 · dual · conj(real))
  m[k + 12] = 2 * (-dw * x + dx * q - dy * z + dz * y);
  m[k + 13] = 2 * (-dw * y + dx * z + dy * q - dz * x);
  m[k + 14] = 2 * (-dw * z - dx * y + dy * x + dz * q);
  m[k + 15] = 1;
}

// ---------------------------------------------------------------- the face rig (after autumnvibes' dancer)
export interface FaceExpr { smile: number; jaw: number; pucker: number; frown: number; brows: number; tender: number; browDown: number; squint: number; wide: number; closed: number }
const FACE_KEYS = ['smile', 'jaw', 'pucker', 'frown', 'brows', 'tender', 'browDown', 'squint', 'wide', 'closed'] as const;
const FACE_RIG = ['jaw', 'lipU', 'lipUL', 'lipUR', 'lipD', 'lipDL', 'lipDR', 'mouthL', 'mouthR', 'cheekL', 'cheekR', 'browInL', 'browInR', 'browOutL', 'browOutR'];
const FACE_POSE: Record<string, Partial<Record<keyof FaceExpr, V3>>> = {
  lipU: { smile: [0, 0.0006, -0.0002], jaw: [0, 0.0012, 0], pucker: [0, -0.0004, 0.0034], frown: [0, -0.0008, 0] },
  lipUS: { smile: [0.0006, 0.0012, -0.0006], jaw: [0, 0.001, 0], pucker: [-0.0022, 0, 0.0026], frown: [0, -0.0006, 0] },
  lipD: { smile: [0, 0.0003, -0.0002], pucker: [0, 0.0004, 0.0034], frown: [0, 0.0008, 0.001] },
  lipDS: { smile: [0.0004, 0.0004, -0.0004], pucker: [-0.002, 0, 0.0026], frown: [0, 0.0004, 0] },
  mouth: { smile: [0.0018, 0.0026, -0.0016], jaw: [0.0012, 0, 0], pucker: [-0.005, 0.0003, 0.0028], frown: [0.0004, -0.0034, -0.0005] },
  cheek: { smile: [0.0007, 0.003, 0.001], squint: [0, 0.0015, 0.0005], pucker: [-0.0012, -0.0004, -0.0006] },
  browIn: { brows: [0, 0.0035, 0.0004], tender: [0, 0.003, 0], browDown: [-0.0015, -0.0028, 0.0004], smile: [0, 0.0004, 0] },
  browOut: { brows: [0.0003, 0.0034, 0.0003], tender: [0, -0.001, 0], browDown: [0, -0.001, 0], smile: [0, 0.0004, 0] },
};
const JAW_OPEN = 0.16;
/** a modelled face (header.faceRig: lips, a jaw, teeth and brows built, not drawn) moves its bones as far as a real
 *  face's: per control, the offset (m, at 1.66 m tall; x out to the bone's own side) of each kind of face bone. The
 *  mouth's corners and lips from the speech's shapes (spread for ee, round for oo, press for m b p, tuck for f v) as
 *  well as the smile and the frown; the lower lip rides the jaw */
const MODELLED: Record<string, Partial<Record<'smile' | 'frown' | 'spread' | 'round' | 'press' | 'tuck' | 'teeth' | 'open' | 'smirk', V3>>> = {
  mouth: { smile: [0.0045, 0.0055, -0.002], frown: [0.0005, -0.0045, 0], spread: [0.005, 0.0004, -0.0018], round: [-0.0075, 0.0004, 0.0035], press: [-0.0005, 0, 0], open: [-0.0015, 0, 0] },
  lipU: { smile: [0, 0.0012, -0.0004], round: [0, 0.0005, 0.0042], press: [0, -0.0012, 0.0004], teeth: [0, 0.0022, 0.0006], tuck: [0, 0.0012, 0.0008] },
  lipUS: { smile: [0.0022, 0.0026, -0.0012], spread: [0.0028, 0.0006, -0.001], round: [-0.0042, 0.0004, 0.0032], press: [0, -0.001, 0.0003], teeth: [0, 0.0026, 0.0004], tuck: [0, 0.001, 0.0006] },
  lipD: { smile: [0, 0.0004, -0.0004], frown: [0, 0.0012, 0.0015], round: [0, -0.0004, 0.004], press: [0, 0.0028, 0.0008], tuck: [0, 0.0045, -0.0035], teeth: [0, -0.0012, 0] },
  lipDS: { smile: [0.0018, 0.0012, -0.001], frown: [0.0004, -0.001, 0], spread: [0.0026, -0.0004, -0.0008], round: [-0.0038, 0, 0.0032], press: [0, 0.0024, 0.0006], tuck: [0, 0.0036, -0.003], teeth: [0, -0.0014, 0] },
  cheek: { smile: [0.0012, 0.0045, 0.0018], round: [-0.0012, -0.0004, -0.0006], open: [-0.0008, -0.0035, -0.0004] },
};
const JAW_OPEN_MODELLED = 0.24;

// ---------------------------------------------------------------- verlet chains (braid, hair loops, panels)
interface Capsule { a: V3; b: V3; r: number }
/** p out of a capsule; given where it was a step before (`from`), out that side (through the middle it would come out
 *  the far side: a jump across a leg in a step) */
function capPush(p: V3, c: Capsule, from?: V3) {
  // (in plain numbers: a body's chains ask this of every capsule for every point five times a frame — as vectors it
  // was six arrays a call, the cast's most garbage by far)
  const a = c.a, b = c.b;
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const t = clamp(((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / Math.max(abx * abx + aby * aby + abz * abz, 1e-9), 0, 1);
  const qx = a[0] + abx * t, qy = a[1] + aby * t, qz = a[2] + abz * t;
  let dx = p[0] - qx, dy = p[1] - qy, dz = p[2] - qz, l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (l >= c.r) return;
  if (from) {
    const ex = from[0] - qx, ey = from[1] - qy, ez = from[2] - qz, el = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (ex * dx + ey * dy + ez * dz < 0 && el > 1e-6) { dx = ex; dy = ey; dz = ez; l = el; }
  }
  if (l > 1e-6) { const k = c.r / l; p[0] = qx + dx * k; p[1] = qy + dy * k; p[2] = qz + dz * k; }
}
class Chain {
  p: V3[]; pp: V3[]; rest: number[];
  /** (each point as the forces left it, before the constraints: step's scratch) */
  private pi: V3[];
  constructor(pts: V3[]) {
    this.p = pts.map((q) => [...q] as V3);
    this.pp = pts.map((q) => [...q] as V3);
    this.pi = pts.map((q) => [...q] as V3);
    this.rest = [];
    for (let i = 0; i < pts.length - 1; i++) this.rest.push(len(sub(pts[i + 1], pts[i])));
  }
  reset(pts: V3[]) { for (let i = 0; i < this.p.length; i++) { this.p[i] = [...pts[i]] as V3; this.pp[i] = [...pts[i]] as V3; } }
  shift(d: V3) { for (let i = 0; i < this.p.length; i++) { this.p[i] = add(this.p[i], d); this.pp[i] = add(this.pp[i], d); } }
  /** (drag > 1 in water; points under `surf` float up to it) */
  step(dt: number, target: V3[], pull: number[], wind: V3, caps: Capsule[], ground: (x: number, z: number) => number, gravity = 9.8, drag = 1, surf = -Infinity) {
    const P = this.p, PP = this.pp, n = P.length;
    const dmp = Math.exp(-1.2 * drag * dt);
    for (let i = 1; i < n; i++) {
      const p = P[i], q = PP[i];
      const u = i / (n - 1);
      const ka = (1 - Math.exp(-2 * drag * dt)) * (0.3 + 0.7 * u);
      const dx = (p[0] - q[0]) * dmp, dy = (p[1] - q[1]) * dmp, dz = (p[2] - q[2]) * dmp;
      PP[i] = [p[0], p[1], p[2]];
      p[0] += dx + (wind[0] * dt - dx) * ka;
      p[1] += dy + (wind[1] * dt - dy) * ka * 0.5 - gravity * dt * dt;
      p[2] += dz + (wind[2] * dt - dz) * ka;
      const k = pull[i];
      if (k > 0) { const g = target[i]; p[0] += (g[0] - p[0]) * k; p[1] += (g[1] - p[1]) * k; p[2] += (g[2] - p[2]) * k; }
    }
    P[0] = [...target[0]] as V3;
    const Pi = this.pi;
    for (let i = 1; i < n; i++) { const a = Pi[i], b = P[i]; a[0] = b[0]; a[1] = b[1]; a[2] = b[2]; }
    for (let it = 0; it < 5; it++) {
      for (let i = 0; i < n - 1; i++) {
        const a = P[i], b = P[i + 1];
        const d0 = b[0] - a[0], d1 = b[1] - a[1], d2 = b[2] - a[2];
        const l = Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2) || 1e-6;
        const k = (l - this.rest[i]) / l;
        if (i === 0) { b[0] -= d0 * k; b[1] -= d1 * k; b[2] -= d2 * k; }
        else { const h = k * 0.5; a[0] += d0 * h; a[1] += d1 * h; a[2] += d2 * h; b[0] -= d0 * h; b[1] -= d1 * h; b[2] -= d2 * h; }
      }
      for (let i = 1; i < n; i++) {
        for (let c = 0; c < caps.length; c++) capPush(P[i], caps[c], PP[i]);
        const g = ground(P[i][0], P[i][2]) + 0.01;
        if (P[i][1] < g) P[i][1] = g;
        if (P[i][1] < surf) P[i][1] += (surf - P[i][1]) * 0.35;
      }
    }
    // (what the constraints moved each point by goes into its velocity — verlet's — but no more of it than MAX_KICK:
    // a length or a capsule's correction in a tiny step, or a frame after a jump, would otherwise become a velocity that
    // flings the strand when the steps grow again: boulder's strands.ts, from Codevember's day 9)
    const mk = MAX_KICK * dt;
    for (let i = 1; i < n; i++) {
      const a = Pi[i], b = P[i], q = PP[i];
      const kx = b[0] - a[0], ky = b[1] - a[1], kz = b[2] - a[2], kl = Math.hypot(kx, ky, kz);
      if (kl > mk) { const f = 1 - mk / kl; q[0] += kx * f; q[1] += ky * f; q[2] += kz * f; }
    }
  }
}
/** the most velocity (m/s) the constraints may add to a chain's point in a step (see Chain.step) */
export const MAX_KICK = 4;
interface PhysChain { name: string; parent: number; bind: V3[]; b0: number; ch: Chain; pull: number[]; grav: number; prev?: V3[]; last?: V3[]; swing?: V3[]; swingV?: V3[]; drape?: number;
  /** each segment's last way and roll (carryUp) */
  roll: { up: V3[]; dir: V3[] };
  /** hung from the hips (garment.ts hang: the pelvis down to the seat, the hang bone below), its parent the frame it hangs in */
  hips?: boolean }

/** a foot: its point on the ground (the middle of the sole), planted or swinging (from, to, progress, duration), its
 *  facing, pitch (toe up +, heel up -) and the ground's slope under it */
interface Foot { p: V3; planted: boolean; from: V3; to: V3; t: number; dur: number; yaw: number; yaw0: number; lift: number; air: boolean; pitch: number; pitch0: number; slope: number; settle: boolean }

export class HeroRig {
  bones = new Float32Array(MAX_BONES * 16);
  dq = new Float32Array(MAX_BONES * 8);
  nBones: number;
  private bind: Fr[] = [];
  private bi: Record<string, number>;
  private B: HeroAsset['bones'];
  private len: number[] = [];
  /** her size against the 1.66 m the rig was tuned on */
  s: number;
  sk: Record<string, V3> = {};
  private shinTilt: number[] = [0, 0];
  /** the seat's shrug this frame (SeatPose.shrug by how far she's sat) */
  private seatShrug = 0;
  /** how steeply she's climbing (0..1: a slope's rise along her way, 19° to 42°) */
  private climb = 0;
  /** the body's own measures for the poses fitted to it (the air poses' streamline, the feet pointed): its shoulders'
   *  half width, its arm's length (shoulder to wrist), its foot's angle to its shin at rest */
  private fit = { shW: 0.17, arm: 0.52, foot: 1.19 };
  /** each elbow's way in the fitted streamline (overArm) */
  private overAim: V3[] = [[0.7, 0, -0.7], [-0.7, 0, -0.7]];
  /** each ankle's angle as its foot last left the ground (the swing eases it from there) */
  private ankA: number[] = [0, 0];
  private feet: Foot[] = [];
  // ---- the gait
  private phase = 0;
  private cadence = 0.9;
  private runW = 0;
  private gaitW = 0;
  private moving = false;
  private duty = 0.62;
  private stride = 1;
  /** setting off at speed: how much further on the clock still has to go (caught up a little a frame) */
  private catchUp = 0;
  private lastStep = 1;
  private accLean = 0; private lastFwdV = 0;
  private slopeList = 0; private slopeLean = 0; private turnLean = 0; private lastYaw = 0;
  private idleT = 0; private idleNext = 5; private idleSide = 1; private idleW = 0;
  private armSw: Spring3[] = [];
  /** running: each elbow's way from its shoulder as the pump means it (world), and how far the arm IK takes it */
  private elbAim: V3[] = [[0, -1, 0], [0, -1, 0]];
  private elbAimW = [0, 0];
  private pelY = 0; private pelYV = 0;
  private crouch = 0;
  private twist = 0;
  private lean = 0;
  private headYaw = 0; private headPitch = 0;
  private hands: Spring3[] = [];
  private seatW = 0;
  /** the face (cast/face.ts): moods, passing expressions, a sip, speech; the drawn face draws its state */
  readonly face = new Face();
  /** its state as the older face's keys, and the body's own face this frame */
  private fx: FaceExpr = { smile: 0.2, jaw: 0, pucker: 0, frown: 0, brows: 0, tender: 0, browDown: 0, squint: 0, wide: 0, closed: 0 };
  private fxBase = blank();
  private gaze: V3 = [0, 0, 1];
  private blink = 0;
  private chains: PhysChain[] = [];
  /** another of the cast's props (one-bone chains on the root: Aang's cushion and cup, Iroh's teapot): kept out of sight
   *  unless one's placed (placeProp) */
  private props: number[] = [];
  /** the props by name (their chains' names: 'pot', 'cup', 'cushion', 'tray'), and where each placed one is */
  private propBone = new Map<string, number>();
  private propAt = new Map<number, PropPlace>();
  private lastCaps: Capsule[] | null = null;
  /** (the cloth's grace: her speed this frame, its billow's clock) */
  private graceSpeed = 0;
  private graceT = 0;
  private chainAcc = 0;
  private first = true;
  private armT = 0;
  private flowW = 0; private flowPh = 0;
  private prevMode = 'idle';
  private palmV = [0, 0]; private curlV = [0.2, 0.2]; private gripV = [0, 0];
  private flyPd: V3[] = [[0, 0, 1], [0, 0, 1]];
  private flowPd: V3[] = [[0, -1, 0], [0, -1, 0]];
  private twPrev = [0, 0];
  private fdPrev: V3[] = [[0, 0, 1], [0, 0, 1]];
  /** each arm as it's held this frame (radians): the forearm's roll from its middle, the wrist's flexion (+ toward the
   *  palm) and deviation (+ toward the thumb), the elbow's bend (0 straight) */
  readonly armStat = [{ roll: 0, want: 0, flex: 0, dev: 0, elbow: 0 }, { roll: 0, want: 0, flex: 0, dev: 0, elbow: 0 }];
  /** each arm's last fitted elbow pole (armFit), for its continuity */
  private swPrev: (V3 | null)[] = [null, null];
  /** the swivel's angular speed (rad/s, armSpring) */
  private swVel = [0, 0];
  /** the torso the elbows keep out of (armFit), against the shoulders' half-width: its half-width, how far in front
   *  and behind (a fuller figure's or a loose smock's further in front: TORSO in town/folk.ts) */
  torso: [number, number, number] = [0.78, 0.5, 0.85];
  /** each arm's hand turned about its own way (radians, within its goal's `turn`) */
  private psi = [0, 0];
  private flyW = 0; private legLag = 0;
  private surfW = 0; private subW = 0; private sprintW = 0; private moveW = 0; private floatY = 0;
  private lastPos: V3 = [0, 0, 0];
  /** the whole-body solver (body/solve.ts), set when the body's tools load (body/api.ts): a body goal waits for it */
  static bodyKit: typeof import('./body/solve.js') | null = null;
  /** the arm fit follows its own minimum frame on frame (armFit): elbows that slide, never flip. On by default (Drake's
   *  flute hold and reins, Codevember's day 9: goals every frame, and an elbow hopping round in a frame as the hand
   *  sways is the worst thing an arm can do on screen); false, each frame takes the best way round of all (Boulder's,
   *  Seven Havens' and San Francisco's arms before @ericrius1/cast) */
  static armContinuity = true;
  /** with armContinuity: the elbow's swivel follows the best one as a critically damped spring of this natural
   *  frequency (rad/s; 0, off: it steps to the best within its swing each frame, hurrying when it's far behind — its
   *  speed changing in a frame, a one-frame kick at the elbow). The swivel's speed then changes smoothly, and it
   *  still can't jump: a spring travels the way between (Codevember's day 9: 30) */
  static armSpring = 0;
  /** a woman's body (the centre of mass's segments): Katara's */
  female: boolean;
  /** the body's suppleness (body/anatomy.ts FLEX: Iroh's an old man's, Aang's a supple airbender's): its forearm's turn
   *  and its wrist's bend scale with a share of it */
  flex = 1;
  private bodyM: BodyModel | null = null;
  private bodyS: BodyState | null = null;
  /** the body as solved last frame (its centre of mass, its support, its cost) and how far it was over the rest */
  bodyPose: BodyPose | null = null;
  private bodyWas = 0;
  private bodyNormal: Float32Array | null = null;
  /** the arms' own state while the body poses them (their springs, swivels and turns kept apart from the rest's) */
  private bodyArm: { tw: number[]; sw: (V3 | null)[]; swv: number[]; psi: number[]; tips: number[][]; fd: V3[] } | null = null;
  /** each finger's curl toward its target (smoothed: a finger presses quickly and lifts a touch slower) */
  private tipsW: number[][] = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
  /** the hands as hands (fingers.ts: null for a body whose fingers aren't three bones each), their solves carried frame
   *  to frame, what's asked of them, the palm's move as last solved */
  /** the most iterations a hand's solve takes a frame: the palm's with its fingers, then the fingers' on the hand as
   *  the arm put it (each stops once its fingertips are within 0.2 mm) */
  static handIters: [number, number] = [8, 6];
  /** a hand at keys (fingertip targets, nothing held): each finger's rest (index..little: MCP, PIP, DIP, rad) idle and
   *  playing, the spreads, the thumb's (saddle flexion, abduction, MCP, IP) idle and playing — set so the hand's plan
   *  extension (a fingertip's distance from its knuckle seen from above, over the finger's length), the fan and the
   *  idle fingers' hover match real pianists' (World tools/hands/planstats.mjs against tracked footage) */
  static keysHand = {
    idle: [[0.4, 0.35, 0.2], [0.4, 0.35, 0.2], [0.4, 0.35, 0.2], [0.55, 0.45, 0.25]],
    tip: [[0.6, 0.4, 0.2], [0.6, 0.4, 0.2], [0.6, 0.47, 0.24], [0.65, 0.5, 0.3]],
    fan: [0.08, 0.03, 0, -0.08],
    // (the thumb as a pianist's: its saddle turned out from the index as far as it goes and a little out of the palm, its
    // MCP and IP bent so the tip comes down onto the key's side and it reads shorter from above — real thumbs' plan
    // extension 0.79 playing, 0.82 idle, fanned ~24° from the index; straight from the saddle (the old rests) it was 0.97;
    // MCP 0.95 / IP 0.8 with the hand's pitch 0.12 (piano.ts forHand): playing 0.87, the wrist 30 mm over the lowest tip)
    thumbIdle: [-0.44, -0.35, 0.95, 0.8], thumbTip: [-0.44, -0.35, 0.95, 0.8], thumbHigh: [-0.28, -0.31, 0.23, 0.1],
    /** how hard a playing finger's joints and the playing thumb are drawn to those rests (the fingertip's target is
     *  per mm, so these shape the hand, not where the tips land) */
    wTip: 3, wThumb: 6,
    /** with HandGoal.prior: the real hands' prior's weight, and how much of their own rests' pull the idle fingers (and
     *  the idle thumb: times restThumb — real idle thumbs are bent) and the playing ones keep under it */
    wPrior: 1, restIdle: 0.25, restPlay: 1, restThumb: 4,
  };
  private handM: (HandModel | null)[] = [null, null];
  private handS = [new HandSolve(), new HandSolve()];
  private handQ: HandAsk[] = [handAsk(), handAsk()];
  private palmX = [new Float64Array(6), new Float64Array(6)];
  /** the hand as the palm's solve placed it this frame (wrist, its way, its palm's; [9] set when it's this frame's) */
  private palmAt = [new Float64Array(10), new Float64Array(10)];
  /** each hand's fingertips' misses as the palm's solve left them (before the arm took the palm) */
  readonly palmMiss = [new Float64Array(5), new Float64Array(5)];
  /** each hand's fingertips' misses after its solve (m; thumb first) and its iterations, for tools and tests */
  handMiss(i: number): Float64Array { return this.handS[i].miss; }
  handIters(i: number): number { return this.handS[i].iters; }
  /** each hand's solved numbers (fingers.ts HAND_N: the palm's move, the arch, the fingers', the thumb's) */
  handX(i: number): Float64Array { return this.handS[i].x; }
  /** each hand's palm move as last solved (hand space: its move, m, and its turn's rotation vector) */
  handPalm(i: number): Float64Array { return this.palmX[i]; }
  /** a foot touched down (footsteps), and the pedal under the right foot (0..1, at an instrument) */
  onPlant?: (foot: number, pos: V3, speed: number) => void;
  pedal = 0;
  /** world joints for others (the water at her hands, the camera, sounds) */
  J = { handL: [0, 0, 0] as V3, handR: [0, 0, 0] as V3, head: [0, 0, 0] as V3, chest: [0, 0, 0] as V3, pelvis: [0, 0, 0] as V3, footL: [0, 0, 0] as V3, footR: [0, 0, 0] as V3,
    /** the head's forward and up (world): where the face looks, for a close-up's camera and a cup at the lips */
    headFwd: [0, 0, 1] as V3, headUp: [0, 1, 0] as V3,
    /** the lower lip's front (world): where a cup's rim goes for a sip (cast/sip.ts) */
    lip: [0, 0, 0] as V3 };
  /** a scene's expression over her own, by its weight */
  expr: { face: Partial<FaceExpr>; k: number; rate?: number } | null = null;
  /** a player's breath over the body's own slow one (src/flute: the lungs filled between phrases, emptied along them):
   *  v how full (0..1), k how much it holds the chest (0..1); null, the body's own */
  breath: { v: number; k: number } | null = null;
  /** hands' goals made from where a point on a bone was as last posed (the flute's: at the lips, from the head as it
   *  was last frame — its hook is asked before the body's posed): each hand's goal carried by how far that point has
   *  moved once the head's posed this frame, by its weight k, so a hold anchored to the head rides it with no frame's
   *  lag (walking, the body drops at each footfall faster than a frame's guess can follow: the flute and both hands
   *  jolted ~6 mm against the face at every step) */
  anchor: { bone: number; local: V3; was: V3; k: [number, number] } | null = null;
  /** the lungs as the chest shows them (eased), and the shoulders' rise with a full breath (rad, the clavicles') */
  private lungs = 0.5;
  private breathK = 0;
  private breathShrug = 0;
  get jawOpen() { return this.fx.jaw; }
  /** the face as the drawn face reads it: where the eyes look in the head's own axes (x her left, y up, z forward),
   *  how far they're shut, the expression */
  get faceState(): { gaze: V3; blink: number; face: Readonly<FaceExpr>; s: FaceState } { return { gaze: this.gaze, blink: this.blink, face: this.fx, s: this.face.state }; }

  constructor(public asset: HeroAsset) {
    this.B = asset.bones;
    this.bi = asset.index;
    this.female = asset.header.char === 'hero';
    this.nBones = asset.bones.length;
    for (const b of this.B) {
      const z = norm(sub(b.tail, b.head));
      let x = cross(b.up, z);
      if (len(x) < 1e-5) x = cross([1, 0, 0], z);
      x = norm(x);
      this.bind.push({ o: b.head, x, y: cross(z, x), z });
      this.len.push(len(sub(b.tail, b.head)));
    }
    this.handM = [HandModel.of(asset, 'L'), HandModel.of(asset, 'R')];
    const g = (n: string) => this.B[this.bi[n]];
    this.sk = {
      pelvis: g('pelvis').head, waist: g('pelvis').tail, chestBase: g('chest').head, neckBase: g('neck').head, headBase: g('head').head, headTop: g('head').tail,
      clavL: g('clavL').head, shoulderL: g('uarmL').head, clavR: g('clavR').head, shoulderR: g('uarmR').head,
      hipL: g('thighL').head, hipR: g('thighR').head, ankleL: g('footL').head, ankleR: g('footR').head, ballL: g('toeL').head, ballR: g('toeR').head,
    };
    this.s = asset.header.height / 1.66;
    // (each shin's lean at rest, toward its foot: a swinging foot's ankle is read against it)
    {
      const sh = g('shinL'), ft = g('footL'), sd = norm(sub(sh.tail, sh.head)), fd = norm(sub(ft.tail, ft.head));
      this.fit = {
        shW: Math.abs(this.sk.shoulderL[0] - this.sk.shoulderR[0]) / 2,
        arm: this.len[this.bi.uarmL] + this.len[this.bi.farmL],
        foot: Math.acos(clamp(dot(sd, fd), -1, 1)),
      };
    }
    this.shinTilt = ['L', 'R'].map((T) => {
      const sh = g('shin' + T), sd = norm(sub(sh.tail, sh.head)), a = this.sk['ankle' + T], b = this.sk['ball' + T];
      const fb = norm([b[0] - a[0], 0, b[2] - a[2]]);
      return Math.atan2(dot(sd, fb), -sd[1]);
    });
    for (let i = 0; i < 2; i++) {
      this.hands.push(new Spring3(2.4, 0.75, 1.2, [0, 0, 0]));
      // the arm swing's own spring: the pendulum's lag and its settling when she stops
      this.armSw.push(new Spring3(1.9, 0.55, 0, [0, 0, 0]));
    }
    for (let i = 0; i < MAX_BONES; i++) { const k = i * 16; this.bones[k] = this.bones[k + 5] = this.bones[k + 10] = this.bones[k + 15] = 1; }
    for (const [name, pts] of Object.entries(asset.chains)) {
      const b0 = this.bi[name + '0'];
      if (b0 === undefined || pts.length < 2) continue;
      const named = asset.header.chainParents?.[name];
      if (named === 'root') { this.props.push(b0); this.propBone.set(name, b0); continue; }
      const hair = /pony|braid|loop|hair|bead/i.test(name);
      let parent = named && this.bi[named] !== undefined ? this.bi[named] : hair ? this.bi.head : /rib/i.test(name) ? this.bi.chest : this.bi.pelvis;
      const hips = parent === this.bi.pelvis;
      if (hips) parent = hangBone(asset, pts);
      const n = pts.length;
      // the root stays near its rest shape; the tip swings (hair loops are short and springy)
      const stiff = /loop/i.test(name) ? 0.35 : /panel|flap|tunic/i.test(name) ? 0.2 : 0.12;
      const pull = pts.map((_, i) => (i === 0 ? 1 : stiff * Math.pow(1 - i / n, 1.5) + 0.01));
      this.chains.push({ name, parent, bind: pts, b0, ch: new Chain(pts), pull, grav: /loop/i.test(name) ? 6 : 9.8, hips, roll: { up: [], dir: [] } });
    }
  }

  /** re-seat feet, hands and hair where she is now (after moving her by hand) */
  snap() { this.first = true; }

  /** her arms let go of whatever of the rig's own state still holds them (a seat's or a form's weight, a grip, the
   *  arm swing's and the hands' springs, the wrists' turn): back to hanging at rest from the next frame. katara.ts
   *  calls it when nothing of hers is holding her hands up and they're up anyway */
  relaxArms() {
    this.seatW = 0; this.flowW = 0;
    for (let i = 0; i < 2; i++) {
      this.gripV[i] = 0; this.curlV[i] = 0.2; this.palmV[i] = 0; this.elbAimW[i] = 0; this.twPrev[i] = 0; this.swPrev[i] = null; this.swVel[i] = 0; this.psi[i] = 0;
      this.tipsW[i].fill(0);
      this.handS[i].ready = false; this.palmX[i].fill(0);
      this.armSw[i]?.reset([0, 0, 0]);
    }
    this.first = true;
  }
  /** take over from another of the cast mid-motion (cast.ts: K, a swap of bodies): their gait's clock and weights,
   *  their feet's plants and swings, the arm swing's and the hands' springs, the wrists' and fingers' state, the head's
   *  turn — so this body goes on from that one's pose at the moment of the swap rather than snapping to stand and
   *  springing its hands in from wherever they were the last time it was worn (the user, 2026-11-08: "the new
   *  character coming in just takes over from exact pose of last character"). World points are scaled about the feet
   *  (`pos`) by this body's size to theirs; the cloth and hair, their own, start at rest on the pose */
  carry(from: HeroRig, pos: V3) {
    if (from === this || from.first) { this.snap(); return; }
    const r = this.s / from.s;
    const at = (p: V3): V3 => [pos[0] + (p[0] - pos[0]) * r, pos[1] + (p[1] - pos[1]) * r, pos[2] + (p[2] - pos[2]) * r];
    const v3 = (v: V3): V3 => [v[0], v[1], v[2]];
    // (the gait)
    this.phase = from.phase; this.cadence = from.cadence * Math.sqrt(from.s / this.s); this.runW = from.runW; this.gaitW = from.gaitW;
    this.moving = from.moving; this.duty = from.duty; this.stride = from.stride * r; this.lastStep = from.lastStep;
    this.accLean = from.accLean; this.lastFwdV = from.lastFwdV; this.slopeList = from.slopeList; this.slopeLean = from.slopeLean;
    this.turnLean = from.turnLean; this.lastYaw = from.lastYaw; this.climb = from.climb;
    this.idleT = from.idleT; this.idleNext = from.idleNext; this.idleSide = from.idleSide; this.idleW = from.idleW;
    this.catchUp = from.catchUp;
    this.pelY = pos[1] + (from.pelY - pos[1]) * r; this.pelYV = from.pelYV * r;
    this.crouch = from.crouch * r; this.twist = from.twist; this.lean = from.lean; this.headYaw = from.headYaw; this.headPitch = from.headPitch;
    this.feet = from.feet.map((f) => ({ ...f, p: at(f.p), from: at(f.from), to: at(f.to), lift: f.lift * r }));
    this.ankA = [...from.ankA];
    // (the air, the water, a seat, the bending's flow)
    this.seatW = from.seatW; this.seatShrug = from.seatShrug; this.flyW = from.flyW; this.legLag = from.legLag;
    this.surfW = from.surfW; this.subW = from.subW; this.sprintW = from.sprintW; this.moveW = from.moveW; this.floatY = from.floatY * r;
    this.flowW = from.flowW; this.flowPh = from.flowPh; this.prevMode = from.prevMode; this.armT = from.armT;
    // (the arms and hands)
    for (let i = 0; i < 2; i++) {
      const a = this.armSw[i], b = from.armSw[i];
      a.y = v3(b.y); a.yd = v3(b.yd); a.xp = v3(b.xp);
      const h = this.hands[i], g = from.hands[i];
      h.y = at(g.y); h.xp = at(g.xp); h.yd = [g.yd[0] * r, g.yd[1] * r, g.yd[2] * r];
      this.elbAim[i] = v3(from.elbAim[i]); this.elbAimW[i] = from.elbAimW[i];
      this.palmV[i] = from.palmV[i]; this.curlV[i] = from.curlV[i]; this.gripV[i] = from.gripV[i];
      this.flyPd[i] = v3(from.flyPd[i]); this.flowPd[i] = v3(from.flowPd[i]); this.fdPrev[i] = v3(from.fdPrev[i]);
      this.twPrev[i] = from.twPrev[i]; this.psi[i] = from.psi[i]; this.swVel[i] = from.swVel[i];
      this.swPrev[i] = from.swPrev[i] && v3(from.swPrev[i]!);
      this.tipsW[i] = [...from.tipsW[i]];
      this.handS[i].x.set(from.handS[i].x); this.handS[i].ready = from.handS[i].ready;
      for (let k = 0; k < 6; k++) this.palmX[i][k] = from.palmX[i][k] * (k < 3 ? r : 1);
      Object.assign(this.armStat[i], from.armStat[i]);
    }
    // (the face: where the eyes look, a blink under way, the expression)
    this.gaze = v3(from.gaze); this.blink = from.blink; this.fx = { ...from.fx };
    // (the breath as the chest shows it)
    this.lungs = from.lungs; this.breathK = from.breathK; this.breathShrug = from.breathShrug;
    // (the cloth and the hair: this body's own, started at rest on the pose — not where they hung the last time)
    for (const c of this.chains) { c.prev = undefined; c.last = undefined; c.swing = undefined; c.swingV = undefined; c.roll = { up: [], dir: [] }; }
    this.lastCaps = null;
    this.graceSpeed = from.graceSpeed; this.graceT = from.graceT; this.chainAcc = 0;
    // (a body pose's own arm state left behind: this body isn't in one)
    this.bodyWas = 0; this.bodyArm = null; this.bodyS?.reset();
    this.lastPos = v3(pos);
    this.first = false;
  }

  /** the arms' own state now (for a report when they're found stuck) */
  armState() {
    const r = (v: number) => +v.toFixed(3);
    return {
      seatW: r(this.seatW), flowW: r(this.flowW), flyW: r(this.flyW), surfW: r(this.surfW), subW: r(this.subW), runW: r(this.runW), gaitW: r(this.gaitW),
      curl: this.curlV.map(r), grip: this.gripV.map(r), palm: this.palmV.map(r), twist: this.twPrev.map(r), armSw: this.armSw.map((a) => r(a.y[0])),
      tips: this.tipsW.map((t) => t.map(r)), elbAim: this.elbAimW.map(r),
    };
  }

  // ---------------------------------------------------------------- bone transforms
  /** rotate every posed bone (and the tracked joints) rigidly about a pivot: pitch about the body's side axis
   *  (positive leans forward), then roll about its forward axis; then raise it by `lift` */
  private leanBody(pivot: V3, fwd: V3, left: V3, pitch: number, roll: number, lift: number) {
    const rot = (v: V3): V3 => rotateAxis(rotateAxis(v, left, pitch), fwd, roll);
    const cx = rot([1, 0, 0]), cy = rot([0, 1, 0]), cz = rot([0, 0, 1]);
    const t = add(sub(pivot, rot(pivot)), [0, lift, 0]);
    const o = this.bones;
    for (let i = 0; i < this.nBones; i++) {
      const k = i * 16;
      for (let c = 0; c < 4; c++) {
        const x = o[k + c * 4], y = o[k + c * 4 + 1], z = o[k + c * 4 + 2];
        o[k + c * 4] = cx[0] * x + cy[0] * y + cz[0] * z;
        o[k + c * 4 + 1] = cx[1] * x + cy[1] * y + cz[1] * z;
        o[k + c * 4 + 2] = cx[2] * x + cy[2] * y + cz[2] * z;
      }
      o[k + 12] += t[0]; o[k + 13] += t[1]; o[k + 14] += t[2];
    }
    const J = this.J as Record<string, V3>;
    for (const key of Object.keys(J)) J[key] = add(rot(J[key]), t);
  }

  private setBone(i: number | undefined, head: V3, tail: V3, up: V3) {
    if (i === undefined) return;
    const z = norm(sub(tail, head));
    let x = cross(up, z);
    if (len(x) < 1e-5) x = cross([1, 0, 0], z);
    x = norm(x);
    const y = cross(z, x);
    const bf = this.bind[i];
    const o = this.bones;
    const k = i * 16;
    const R = [bf.x, bf.y, bf.z];
    const t: V3 = [-dot(bf.x, bf.o), -dot(bf.y, bf.o), -dot(bf.z, bf.o)];
    for (let c = 0; c < 3; c++) {
      const a = R[0][c], b = R[1][c], cc = R[2][c];
      o[k + c * 4 + 0] = x[0] * a + y[0] * b + z[0] * cc;
      o[k + c * 4 + 1] = x[1] * a + y[1] * b + z[1] * cc;
      o[k + c * 4 + 2] = x[2] * a + y[2] * b + z[2] * cc;
      o[k + c * 4 + 3] = 0;
    }
    o[k + 12] = x[0] * t[0] + y[0] * t[1] + z[0] * t[2] + head[0];
    o[k + 13] = x[1] * t[0] + y[1] * t[1] + z[1] * t[2] + head[1];
    o[k + 14] = x[2] * t[0] + y[2] * t[1] + z[2] * t[2] + head[2];
    o[k + 15] = 1;
  }
  skinPoint(i: number, p: V3): V3 {
    const m = this.bones, k = i * 16;
    return [m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12], m[k + 1] * p[0] + m[k + 5] * p[1] + m[k + 9] * p[2] + m[k + 13], m[k + 2] * p[0] + m[k + 6] * p[1] + m[k + 10] * p[2] + m[k + 14]];
  }
  skinDir(i: number, d: V3): V3 {
    const m = this.bones, k = i * 16;
    return [m[k] * d[0] + m[k + 4] * d[1] + m[k + 8] * d[2], m[k + 1] * d[0] + m[k + 5] * d[1] + m[k + 9] * d[2], m[k + 2] * d[0] + m[k + 6] * d[1] + m[k + 10] * d[2]];
  }
  /** a bone's posed head, by name (the hands' fingertips for the instruments, the head for the camera) */
  joint(name: string): V3 | null {
    const i = this.bi[name];
    return i === undefined ? null : this.skinPoint(i, this.B[i].head);
  }
  /** a bone's posed tail */
  jointTail(name: string): V3 | null {
    const i = this.bi[name];
    return i === undefined ? null : this.skinPoint(i, this.B[i].tail);
  }

  // ---------------------------------------------------------------- props and hands (cast/pose.ts)
  /** the props this body's mesh carries (its root's one-bone chains: Iroh's 'pot' and 'cup', Aang's 'cushion', 'tray',
   *  'pot', 'cup') */
  get propNames(): string[] { return [...this.propBone.keys()]; }
  /** a prop's bind frame: its base (the bone's head, where it stands), x the body's left, y up, z its front (a pot's
   *  spout) — the frame a PropPlace puts in the world */
  propBase(name: string): V3 | null { const i = this.propBone.get(name); return i === undefined ? null : this.B[i].head; }
  /** a prop put in the world (its base at `at`, its up and its front along `up` and `fwd`), or put away (null). It goes
   *  there at once (its bone and dual quaternion: a prop placed after the frame's update, from where the hands got to,
   *  is drawn this frame) and stays there each frame after, until it's moved or put away */
  placeProp(name: string, at: PropPlace | null) {
    const i = this.propBone.get(name);
    if (i === undefined) return;
    if (!at) { this.propAt.delete(i); const b = this.B[i]; this.setBone(i, sub(b.head, [0, 500, 0]), sub(b.tail, [0, 500, 0]), b.up); }
    else { this.propAt.set(i, at); this.setProp(i, at); }
    matToDQ(this.bones, i * 16, this.dq, i * 8);
  }
  /** is a prop out (placed)? */
  propOut(name: string): boolean { const i = this.propBone.get(name); return i !== undefined && this.propAt.has(i); }
  private setProp(i: number, at: PropPlace) {
    // (the bind frame x left, y up, z front onto the place's own: a rigid move of the prop about its base)
    const b = this.B[i], up = norm(at.up), fwd = norm(rej(at.fwd, up)), x = cross(up, fwd);
    const R = (v: V3): V3 => [x[0] * v[0] + up[0] * v[1] + fwd[0] * v[2], x[1] * v[0] + up[1] * v[1] + fwd[1] * v[2], x[2] * v[0] + up[2] * v[1] + fwd[2] * v[2]];
    this.setBone(i, at.at, add(at.at, R(sub(b.tail, b.head))), R(b.up));
  }
  /** a hand as it's posed (world, from its bone): the palm's middle (where a HandGoal's palm goes), the hand's way
   *  (wrist to knuckles), the way its palm faces, its thumb's side */
  handFrame(side: 'L' | 'R'): { palm: V3; fwd: V3; down: V3; thumb: V3 } {
    const i = this.bi['hand' + side], b = this.B[i], f = this.bind[i];
    const wrist = this.skinPoint(i, b.head), h = norm(this.skinDir(i, f.z)), t = norm(rej(this.skinDir(i, f.y), h));
    const sgn = side === 'L' ? 1 : -1;
    return { palm: add(wrist, scale(h, this.len[i] * 0.55)), fwd: h, down: scale(cross(h, t), sgn), thumb: t };
  }

  // ---------------------------------------------------------------- the frame
  update(I: RigInput) {
    const dt = Math.max(1e-4, Math.min(I.dt, 1 / 20));
    // (the gait's clock on the frame's real length — the body went that far — up to a quarter second: on the springs'
    // capped one, below 20 frames a second the stride fell behind her and each planted foot was dragged a lunge's way)
    const gdt = Math.max(1e-4, Math.min(I.dt, 0.25));
    const sk = this.sk, s = this.s;
    const fwd: V3 = [-Math.sin(I.yaw), 0, -Math.cos(I.yaw)];
    const left: V3 = [-Math.cos(I.yaw), 0, Math.sin(I.yaw)];
    const B: Fr = { o: I.pos, x: left, y: [0, 1, 0], z: fwd };
    const pose = I.pose;
    const bendK = pose.intensity;
    const mode = pose.mode;
    if (mode !== this.prevMode) { this.armT = 0; this.prevMode = mode; }
    this.armT += dt;
    // (a teleport — far more than her velocity explains — re-seats everything as on the first frame)
    if (!this.first && len(sub(I.pos, this.lastPos)) > 3 + len(I.vel) * dt * 2) this.first = true;
    if (this.first) this.resetFeet(B, I.yaw, I.ground);
    const disp = sub(I.pos, this.lastPos);
    this.lastPos = [...I.pos] as V3;
    if (I.carry) for (const f of this.feet) if (f.planted) { f.p[0] += I.carry[0]; f.p[1] += I.carry[1]; f.p[2] += I.carry[2]; }

    // ---- sitting at an instrument (blended in and out)
    const seat = I.seat ?? null;
    this.seatW = seat ? seat.w : damp(this.seatW, 0, 6, dt);
    const sw = this.seatW;
    this.seatShrug = seat ? sw * (seat.shrug ?? 0) : damp(this.seatShrug, 0, 6, dt);

    // ---- flying / swimming: a posed body (in her own axes) leaned whole about the waist, floated at the surface
    const swim = I.swim ?? 0;
    const want = [I.flying ? 1 : 0, swim === 1 ? 1 : 0, swim >= 2 ? 1 : 0];
    if (this.first) { this.flyW = want[0]; this.surfW = want[1]; this.subW = want[2]; }
    // (a triple jump's flip: the air pose has her at once)
    this.flyW = damp(this.flyW, want[0], (I.flip ?? 0) > 0 ? 16 : 4, dt);
    this.surfW = damp(this.surfW, want[1], 3.5, dt);
    this.subW = damp(this.subW, want[2], swim === 3 ? 6 : 3.5, dt);
    const mk = Math.min(1, this.flyW + this.surfW + this.subW);
    const A = this.airPose(I, fwd, dt);
    const leanP = ((I.flyPitch ?? 0) + A.pitch) * mk, leanR = ((I.flyRoll ?? 0) + A.roll) * mk;
    // (the legs trail the body's pitching a moment: follow-through)
    this.legLag = this.first ? leanP : damp(this.legLag, leanP, 4, dt);
    const legTrail = clamp(leanP - this.legLag, -0.35, 0.35);
    const pivot: V3 = [I.pos[0], I.pos[1] + sk.waist[1], I.pos[2]];
    const leanRot = (v: V3): V3 => rotateAxis(rotateAxis(v, left, leanP), fwd, leanR);
    // (at the surface she floats with her head out: the body rides up or down to put it there — measured on the posed
    // body below; aiming uses last frame's)
    let lift = A.lift * mk + this.floatY;
    const unlean = (p: V3): V3 => add(rotateAxis(rotateAxis(sub(sub(p, [0, lift, 0]), pivot), fwd, -leanR), left, -leanP), pivot);
    const unleanD = (d: V3): V3 => rotateAxis(rotateAxis(d, fwd, -leanR), left, -leanP);

    // ---- the gait clock
    const v = I.speed;
    const dirH: V3 = v > 0.05 ? [I.vel[0] / v, 0, I.vel[2] / v] : fwd;
    const leftH: V3 = [dirH[2], 0, -dirH[0]];
    const wadeK = clamp(I.wade / 0.9, 0, 1), wadeDeep = smoothstep(0.55, 1.0, I.wade);
    // (a seat let go of walks on at once: its weight easing out after it held the gait off while he moved — the feet
    // left planted as he went on, off the air scooter at speed)
    const grounded = I.onGround && !I.flying && !swim && (!seat || sw < 0.02);
    const wasMoving = this.moving;
    this.moving = grounded && (this.moving ? v > 0.1 : v > 0.22);
    this.runW = damp(this.runW, smoothstep(2.2, 3.4, v) * (1 - 0.7 * wadeK), 3, dt);
    const runF = this.runW;
    // cadence (strides a second) and duty factor from the speed: a walk ~1 Hz at 1.4 m/s, a run ~1.5 Hz
    const vs = Math.max(v, 0.15);
    const fW = 0.62 + 0.27 * Math.min(vs, 2.4), fR = 1.3 + 0.06 * vs;
    // (up a steep slope — scrambling up a hillside — quicker, shorter steps, the weight on the uphill foot early: the
    // ground's rise along her way, from 0.35 a metre (19°) to 0.9 (42°))
    const rise = (I.ground(I.pos[0] + dirH[0] * 0.4 * s, I.pos[2] + dirH[2] * 0.4 * s) - I.ground(I.pos[0] - dirH[0] * 0.4 * s, I.pos[2] - dirH[2] * 0.4 * s)) / (0.8 * s);
    this.climb = damp(this.climb, grounded && v > 0.1 ? smoothstep(0.35, 0.9, rise) : 0, 4, dt);
    const climb = this.climb;
    const cadW = lerp(fW, fR, runF) * (1 - 0.12 * wadeK) * (1 + 0.8 * climb) / Math.sqrt(s);
    if (this.moving) this.cadence = damp(this.cadence, cadW, 6, dt);
    const beta0 = this.duty;
    this.duty = lerp(0.62 - 0.04 * smoothstep(0.5, 1.8, v), 0.34 - 0.06 * smoothstep(3, 5.6, v) - 0.05 * smoothstep(5.2, 7.5, v / Math.sqrt(s)), runF);
    const beta = this.duty;
    // (running, the stride the speed wants now: the cadence catching up as she speeds up would stretch it)
    if (this.moving) this.stride = lerp(vs / this.cadence, vs / cadW, runF);
    this.gaitW = damp(this.gaitW, this.moving ? 1 : 0, this.moving ? 6 : 4, dt);
    const gw = this.gaitW;
    // (the feet land close to one line walking — a light walk — wider standing)
    const stanceW = (lerp(lerp(0.055, 0.045, runF), 0.095, 1 - gw) + 0.08 * bendK) * s;
    const toeOut = 0.12 * (1 - 0.5 * runF);
    // standing idle the weight settles on one leg, the other resting softer — and every so often she shifts across
    const idleK = (1 - gw) * (1 - bendK) * (1 - mk) * (1 - sw) * (I.onGround ? 1 : 0);
    this.idleT += dt;
    if (this.idleT > this.idleNext) { this.idleT = 0; this.idleNext = 6 + Math.random() * 6; this.idleSide = -this.idleSide; }
    this.idleW = damp(this.idleW, this.idleSide * idleK, 1.5, dt);
    const stanceFwd = 0.18 * bendK * s;
    // (how far ahead of the hip a foot comes down; running, never further than the leg reaches from a runner's
    // height: speeding up, the walk's reach would put the foot down in a lunge)
    let stepAhead = this.stride * beta * lerp(0.4, 0.42, runF);
    if (runF > 0.001) stepAhead = Math.min(stepAhead, 0.45 * s);

    // touching down from the air: the feet land where they are
    const touchdown = grounded && (this.feet[0].air || this.feet[1].air);
    if (touchdown) for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      f.air = false; f.planted = true; f.t = 1; f.p = [f.p[0], I.ground(f.p[0], f.p[2]), f.p[2]];
      this.onPlant?.(i, f.p, v);
    }
    if (this.moving) {
      // setting off (or on landing): the foot further behind steps first — at its lift-off, the other planted
      if (!wasMoving || touchdown) {
        const b = [0, 1].map((i) => dot(sub(this.feet[i].p, I.pos), dirH));
        const k = this.feet[0].planted !== this.feet[1].planted ? (this.feet[0].planted ? 1 : 0) : b[0] <= b[1] ? 0 : 1;
        this.phase = (((beta - k * 0.5 - 0.001) % 1) + 1) % 1;
        for (const f of this.feet) if (!f.planted && !f.air) { f.planted = true; f.p = [...f.to] as V3; }
        // (setting off already at speed — off the air scooter, carried on at a run's pace with his feet under him —
        // the foot that stays down is as far through its stance as where it is says, the clock catching up to it over
        // the first step: left at its stance's start, it held the body up till it was far behind, the pelvis sunk to
        // reach it and the legs dragged back along the ground)
        const o = 1 - k, u0 = (this.phase + o * 0.5) % 1;
        const into = clamp((stepAhead - b[o]) / Math.max(this.stride * beta, 1e-3), 0, 0.8) * beta;
        this.catchUp = touchdown ? 0 : smoothstep(0.8, 1.5, v) * (u0 >= beta ? 1 - u0 + into : Math.max(0, into - u0));
      }
      const prev = this.phase;
      // (speeding up into a run, a stance foot left further behind than the leg can reach: the clock hurries on to
      // its lift-off, rather than the body sinking after it)
      let hurry = 0;
      if (runF > 0.001) for (const f of this.feet) if (f.planted) hurry = Math.max(hurry, smoothstep(0.62 * s, 0.8 * s, -dot(sub(f.p, I.pos), dirH)));
      // (walking too — Drake's dragon: turning sharply, the foot that was ahead is suddenly far behind; its lift-off
      // comes early rather than the hips sinking to keep it)
      let hurryW = 0;
      for (const f of this.feet) if (f.planted) hurryW = Math.max(hurryW, smoothstep(0.42 * s, 0.6 * s, Math.hypot(f.p[0] - I.pos[0], f.p[2] - I.pos[2])));
      const caught = Math.min(this.catchUp, gdt * 1.5);
      this.catchUp -= caught;
      this.phase = (this.phase + gdt * this.cadence * (1 + 2 * hurry * runF + 2.5 * hurryW * (1 - runF)) + caught) % 1;
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i];
        const u0 = (prev + i * 0.5) % 1, u = (this.phase + i * 0.5) % 1;
        // lift-off: the local phase crosses the duty factor (speeding up into a run the duty falls as the phase rises:
        // crossed between last frame's and this one's, the foot still goes — never left planted as she runs off)
        if (f.planted && (u0 < beta || (runF > 0.001 && u0 < beta0)) && u >= beta) this.liftFoot(f, (1 - beta) / this.cadence, (0.06 + 0.22 * runF + 0.14 * wadeK) * s);
      }
    } else if (grounded) {
      // standing: a foot left behind (or turned away, or stopping) steps back under her — one at a time
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i], o = this.feet[1 - i];
        const side = i === 0 ? 1 : -1;
        const rest = add(add(I.pos, scale(left, side * stanceW)), scale(fwd, side * stanceFwd));
        const d = Math.hypot(rest[0] - f.p[0], rest[2] - f.p[2]);
        const turned = Math.abs(angDiff(f.yaw, I.yaw + side * toeOut));
        if (f.planted && o.planted && (d > 0.13 * s || turned > 0.55) && this.lastStep > 0.12) {
          this.liftFoot(f, 0.3, (0.045 + 0.1 * wadeK) * s);
          f.settle = true;
          this.lastStep = 0;
          break;
        }
      }
    }
    this.lastStep += gdt;

    // ---- the feet
    const strikeP = lerp(0.26, 0.08, runF), offP = lerp(-0.85, -1.0, runF), midP = lerp(0.1, -0.55, runF), riseAt = lerp(0.55, 0.3, runF);
    // (where the body is really going, over the ground under it: pressed against a wall or a railing the speed she
    // wants is all into it and she goes nowhere — steps aimed by it went through. Never faster than she wants: a
    // re-seat's jump)
    let go: V3 = [I.vel[0], 0, I.vel[2]];
    if (!this.first) {
      go = [(disp[0] - (I.carry?.[0] ?? 0)) / gdt, 0, (disp[2] - (I.carry?.[2] ?? 0)) / gdt];
      const g = Math.hypot(go[0], go[2]);
      if (g > v) go = scale(go, v / g);
    }
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const side = i === 0 ? 1 : -1;
      const u = (this.phase + i * 0.5) % 1;
      if (I.flying || swim) {
        // flying / swimming: the legs are posed; the feet wait under the hips for the next landing
        f.p = add(add(I.pos, scale(left, side * stanceW)), [0, -0.1 * s, 0]);
        f.planted = false; f.air = true; f.yaw = I.yaw + side * toeOut; f.pitch = 0;
        continue;
      }
      if (sw > 0.001 && seat) {
        // sitting: each foot carried to its place (a little lift on the way), the right on the pedal — and along with
        // her when the seat goes somewhere (Aang's air scooter: else the feet trail far behind it)
        const goal = seat.feet[i];
        const k = 1 - Math.exp(-dt * (seat.feetK ?? 7));
        const lifted = (1 - Math.abs(sw * 2 - 1)) * 0.05;
        f.p = lerp3(add(f.p, disp), [goal[0], goal[1] + lifted, goal[2]], k);
        // (letting go, down onto the ground under it as the seat's weight runs out: the air scooter's ball gone, its
        // feet were still up on its sides, and dropped there in a frame)
        if (I.onGround) f.p[1] = lerp(I.ground(f.p[0], f.p[2]), f.p[1], smoothstep(0, 0.3, sw));
        // (never into the floor)
        { const g = I.ground(f.p[0], f.p[2]); if (f.p[1] < g) f.p[1] = g; }
        // (its step's ends carried along too — no swing pending: let go, it's put down where it is. It was put down where
        // the last step before the seat had aimed: off the scooter metres back along the way he came, the pelvis sunk to
        // reach it; a rider off the dragon's saddle, where "before" was the saddle's frame, metres away)
        f.from = [...f.p] as V3; f.to = [...f.p] as V3;
        f.yaw += angDiff(f.yaw, seat.yaw + side * 0.1) * k;
        f.pitch = damp(f.pitch, i === 1 ? -0.12 * this.pedal : 0, 12, dt);
        f.planted = sw > 0.98; f.air = false; f.t = 1;
        continue;
      }
      if (!I.onGround) {
        // airborne: a running leap strides through the air (the leading knee driven forward, the trailing leg
        // stretched back); a standing jump tucks; falling, the legs reach down for the landing
        const lk = smoothstep(1.5, 5, v), reach = smoothstep(-0.5, -4, I.vel[1]);
        const lead = i === 0;
        const fw = lead ? lerp(0.06, 0.32, lk) : lerp(-0.04, -0.36, lk);
        const upY = lerp(lead ? lerp(0.34, 0.24, lk) : lerp(0.3, 0.4, lk), 0.08, reach * 0.75);
        const tgt = add(add(I.pos, scale(left, side * stanceW * 0.8)), add(scale(fwd, fw * (1 - 0.45 * reach) * s), [0, upY * s, 0]));
        f.p = lerp3(add(f.p, disp), tgt, 1 - Math.exp(-dt * 10));
        f.planted = false; f.air = true; f.t = 0;
        f.yaw += angDiff(f.yaw, I.yaw + side * toeOut) * (1 - Math.exp(-dt * 8));
        f.pitch = damp(f.pitch, lead ? 0.12 : lerp(-0.25, -0.7, lk) * (1 - reach * 0.6), 8, dt);
        continue;
      }
      let pitch = 0;
      if (!f.planted) {
        // the swing: its progress by the gait clock while walking (by time when stepping on the spot), aimed every
        // frame at where the hip will be when it lands plus half a stance — stopping, beside the other foot
        // (by the clock: lands as the local phase comes round to 0 — past it, it's in its next stance)
        f.t = this.moving && !f.settle ? (u >= beta ? clamp((u - beta) / Math.max(1 - beta, 0.05), f.t, 1) : 1) : Math.min(1, f.t + gdt / f.dur);
        const t = f.t;
        let to: V3, at: V3 | null = null;
        if (this.moving && !f.settle) {
          const tl = (1 - t) * f.dur;
          at = add(I.pos, scale(go, tl));
          to = add(at, add(scale(dirH, stepAhead), scale(leftH, side * stanceW)));
        } else {
          // (settling: beside the planted foot, square to her facing)
          to = add(add(I.pos, scale(left, side * stanceW)), scale(fwd, side * stanceFwd));
        }
        to[1] = I.ground(to[0], to[2]);
        if (at) {
          // (never off an edge the body isn't going over: at a deck's railing the step ahead came down on the ground
          // metres below it, and the hips went down after the foot. Below where she'll be by more than a curb and more
          // steeply than a hillside is a drop: the foot comes back toward her until it's on what she stands on)
          const a = at, far = to, g0 = I.ground(a[0], a[2]);
          const drop = (q: V3) => g0 - q[1] > 0.35 * s + 1.5 * Math.hypot(q[0] - a[0], q[2] - a[2]);
          for (let k = 3; k >= 0 && drop(to); k--) { to = lerp3(a, far, k / 4); to[1] = I.ground(to[0], to[2]); }
        }
        f.to = lerp3(f.to, to, 1 - Math.exp(-dt * 16));
        let e = minJerk(Math.pow(t, 0.75));
        if (runF > 0.001 && this.moving && !f.settle) {
          // running, the runner's path: still going back with the ground as it leaves it, the heel kicked up behind,
          // the knee driven through, the foot reaching ahead and pawing back onto the ground — its way along the
          // stride the body's own plus the stance's sweep (g, from 0 to 1, leaving and meeting the ground at its speed)
          const k = (1 - beta) / beta, t2 = t * t, t3 = t2 * t;
          const g = -0.2 * k * (t3 - 2 * t2 + t) + (3 * t2 - 2 * t3) - 0.7 * k * (t3 - t2);
          e = lerp(e, clamp((1 - beta) * t + beta * g, -0.02, 1.05), runF);
        }
        const base = lerp3(f.from, f.to, e);
        // (the way from where it left the ground to where it lands — on a slope, the slope — and over steps clear of
        // them: as much higher as the ground pokes above that line anywhere along it (a stair's edges), most at the
        // swing's middle; never through the ground under the foot or just ahead of it, at its toes. It rose early to
        // the landing's height: running uphill that put the foot over the hip, the leg folded past its limits)
        let poke = 0;
        for (const q of [0.25, 0.5, 0.75]) poke = Math.max(poke, I.ground(lerp(f.from[0], f.to[0], q), lerp(f.from[2], f.to[2], q)) - lerp(f.from[1], f.to[1], q));
        const ahead = add(base, scale(dirH, 0.12 * s));
        base[1] = Math.max(lerp(f.from[1], f.to[1], e) + poke * Math.sin(Math.PI * clamp(t * 1.15, 0, 1)), I.ground(base[0], base[2]), I.ground(ahead[0], ahead[2]));
        // lifted early (the heel kicked up behind), reaching down for the strike
        f.p = add(base, [0, f.lift * 6.75 * t * (1 - t) * (1 - t) + f.lift * 0.35 * Math.sin(Math.PI * t), 0]);
        f.yaw = f.yaw0 + angDiff(f.yaw0, (this.moving && !f.settle ? Math.atan2(-dirH[0], -dirH[2]) : I.yaw) + side * toeOut) * ease(t);
        pitch = t < 0.5 ? lerp(Math.min(f.pitch0, 0), midP, ease(t / 0.5)) : lerp(midP, strikeP, ease((t - 0.5) / 0.5));
        if (f.settle) pitch *= 0.4;
        if (t >= 1) { f.planted = true; f.settle = false; f.p = [...f.to] as V3; this.onPlant?.(i, f.p, v); }
      } else {
        f.p[1] = I.ground(f.p[0], f.p[2]);
        // stance: heel strike (toe up) rolling flat, the heel rising onto the ball, toe-off
        if (this.moving) {
          const sp = clamp(u / beta, 0, 1);
          pitch = sp < 0.15 ? strikeP * (1 - ease(sp / 0.15)) : sp > riseAt ? offP * ease((sp - riseAt) / (1 - riseAt)) * 0.92 : 0;
        }
      }
      const free = side * this.idleW < 0 ? Math.abs(this.idleW) : 0;
      f.pitch = f.planted && !this.moving ? damp(f.pitch, -0.22 * free, 6, dt) : lerp(f.pitch, pitch, Math.min(1, gw * 4 + (f.planted ? 0 : 1)));
    }

    // the feet's geometry (the ankle each leg reaches for): flat along the ground's slope, rolled about the heel (toe
    // up) or the ball (heel up)
    const FH = Math.sqrt(Math.max(len(sub(sk.ballL, sk.ankleL)) ** 2 - (sk.ankleL[1] - sk.ballL[1]) ** 2, 1e-6));
    const footGeo = (i: number, pitch: number) => {
      const f = this.feet[i];
      const ffwd: V3 = [-Math.sin(f.yaw), 0, -Math.cos(f.yaw)];
      const fside: V3 = [Math.cos(f.yaw), 0, -Math.sin(f.yaw)];
      const ankleBind = i === 0 ? sk.ankleL : sk.ankleR, ballBind = i === 0 ? sk.ballL : sk.ballR;
      const rotS = (q: V3): V3 => add(f.p, rotateAxis(sub(q, f.p), fside, f.slope));
      const ankle0 = rotS(add(f.p, add(scale(ffwd, -FH * 0.5), [0, ankleBind[1], 0])));
      const ball0 = rotS(add(f.p, add(scale(ffwd, FH * 0.5), [0, ballBind[1], 0])));
      const pv = pitch >= 0 ? rotS(add(f.p, scale(ffwd, -FH * 0.5 - 0.055 * s))) : ball0;
      const rot = (q: V3): V3 => add(pv, rotateAxis(sub(q, pv), fside, pitch));
      const ankle = rot(ankle0), ball = rot(ball0);
      const fwdS = rotateAxis(ffwd, fside, f.slope);
      const toeDir = f.planted || pitch >= 0 ? fwdS : norm(lerp3(rotateAxis(fwdS, fside, pitch), fwdS, 0.35));
      return { ankle, fdir: sub(ball, ankle), toeDir, side: fside, ffwd };
    };
    const FG: ReturnType<typeof footGeo>[] = [];
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const ffwd: V3 = [-Math.sin(f.yaw), 0, -Math.cos(f.yaw)];
      const g0 = I.ground(f.p[0] - ffwd[0] * 0.1 * s, f.p[2] - ffwd[2] * 0.1 * s), g1 = I.ground(f.p[0] + ffwd[0] * 0.1 * s, f.p[2] + ffwd[2] * 0.1 * s);
      const down = f.planted ? 1 : 1 - smoothstep(0.02, 0.08, f.p[1] - I.ground(f.p[0], f.p[2]));
      // (a step's edge under the sole reads as a cliff: the slope only from gentle ground)
      const sl = Math.abs(g1 - g0) > 0.08 * s ? 0 : Math.atan2(g1 - g0, 0.2 * s);
      f.slope = damp(f.slope, clamp(sl, -0.45, 0.45) * down, 12, dt);
      FG.push(footGeo(i, f.pitch));
    }

    // ---- the pelvis: the stance's height, the gait's rise and fall, crouched to bend, compressed by landings, never
    // so high a planted foot can't be reached; swayed, turned and listed by the gait
    const legLen = this.len[this.bi.thighL] + this.len[this.bi.shinL];
    const standH = sk.pelvis[1];
    this.flowW = damp(this.flowW, mode === 'flow' ? 1 : 0, 2.5, dt);
    const flowPh = mode === 'flow' ? pose.t * TAU : this.flowPh;
    this.flowPh = flowPh;
    this.crouch = damp(this.crouch, 0.1 * bendK * s + (mode === 'push' || mode === 'throw' ? 0.04 * s : 0) + (mode === 'wave' ? 0.05 * s : 0) + 0.07 * this.flowW * s + 0.2 * (I.hold?.stoop ?? 0) * (I.hold?.bend ?? 1) * s, 6, dt);
    const ph = this.phase;
    const amp = gw * Math.min(1, v / 1.4);
    // walking, the pelvis vaults over the stance leg as over a stilt — highest at mid-stance, lowest in double support:
    // its height is what the loaded legs reach, a little short of straight (a trailing leg unloads as its heel rises,
    // and stops holding it up). Running it sinks into each stance and rises through the flight.
    const bobR = -0.03 * Math.cos(2 * TAU * (ph - beta * 0.5)) * gw * runF * s;
    const GV = I.groove;
    let py = I.pos[1] + standH - this.crouch - gw * 0.03 * runF * s + bobR - Math.min(I.wade * 0.08, 0.06) - (GV?.bounce ?? 0);
    if (I.landImpact > 0) { this.pelYV -= Math.min(I.landImpact * 0.22, 0.9); I.landImpact = 0; }
    const softMin = (a: number, b: number, k: number) => (a + b - Math.sqrt((a - b) * (a - b) + k * k)) * 0.5;
    const hipDrop = standH - sk.hipL[1];
    const reachOf = (i: number, ankle: V3) => {
      const hipW = frW(B, i === 0 ? sk.hipL : sk.hipR);
      const dxz = Math.hypot(ankle[0] - hipW[0], ankle[2] - hipW[2]);
      return ankle[1] + Math.sqrt(Math.max(0.01, (legLen * 0.996) ** 2 - dxz * dxz)) + hipDrop;
    };
    if (!(I.flying || swim) && sw < 0.5) {
      let reach = Infinity;
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i];
        const sp = this.moving ? clamp(((this.phase + i * 0.5) % 1) / beta, 0, 1) : 0;
        const w = f.planted ? 1 - smoothstep(lerp(0.6, 0.1, climb), lerp(1, 0.45, climb), sp) : smoothstep(0.8, 1, f.t);
        if (w <= 0.001) continue;
        const y = reachOf(i, FG[i].ankle) + (1 - w) * 0.12 * s;
        reach = reach === Infinity ? y : softMin(reach, y, 0.02 * s);
      }
      if (reach < Infinity) py = softMin(py, reach, 0.012 * s);
      // (climbing, never sunk more than a quarter of a leg below standing: the trailing foot far down the slope pulled
      // the hips down to it until the uphill leg folded flat — sitting in the grass, the legs out — on ~45° and up)
      if (climb > 0.001) py = Math.max(py, lerp(py, I.pos[1] + standH - this.crouch - 0.25 * legLen, climb));
    }
    if (this.first) { this.pelY = py; this.pelYV = 0; }
    if (!I.onGround || I.flying) { this.pelY = py; this.pelYV = 0; }
    else {
      // (a critically damped follower: smooth over stairs and bumps, quick enough to keep the gait's bob)
      [this.pelY, this.pelYV] = cdSpring(this.pelY, this.pelYV, py, 20, dt);
      if (this.pelY > py + 0.004) this.pelY = py + 0.004 + (this.pelY - py - 0.004) * Math.exp(-dt / 0.03);
      if (this.pelY < py - 0.12 * s) { this.pelY = py - 0.12 * s; this.pelYV = Math.max(this.pelYV, 0); }
    }
    // a planted foot the leg can't reach from there pushes off: its heel rises about the ball until it can
    if (!(I.flying || swim) && sw < 0.5 && I.onGround) for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      if (!f.planted || f.pitch > 0.001) continue;
      const need = this.pelY - 0.004;
      let p = f.pitch;
      for (let k = 0; k < 10 && reachOf(i, FG[i].ankle) < need && p > -1.15; k++) { p -= 0.08; FG[i] = footGeo(i, p); }
      f.pitch = p;
    }
    {
      const hl = frW(B, sk.hipL), hr = frW(B, sk.hipR);
      const across = Math.atan2(I.ground(hl[0], hl[2]) - I.ground(hr[0], hr[2]), Math.hypot(hl[0] - hr[0], hl[2] - hr[2]));
      const along = Math.atan2(I.ground(I.pos[0] + fwd[0] * 0.4 * s, I.pos[2] + fwd[2] * 0.4 * s) - I.ground(I.pos[0] - fwd[0] * 0.4 * s, I.pos[2] - fwd[2] * 0.4 * s), 0.8 * s);
      this.slopeList = damp(this.slopeList, I.onGround ? clamp(across * 0.4, -0.12, 0.12) : 0, 6, dt);
      this.slopeLean = damp(this.slopeLean, I.onGround ? clamp(along * 0.3, -0.12, 0.15) * gw : 0, 4, dt);
    }
    // leaning into a speed-up, back against a slowing; into a turn at speed
    const fwdV = dot(I.vel, fwd);
    const acc = this.first ? 0 : (fwdV - this.lastFwdV) / dt;
    this.lastFwdV = fwdV;
    this.accLean = damp(this.accLean, I.onGround && !I.flying ? clamp(acc * 0.022, -0.1, 0.12) : 0, 5, dt);
    const yawRate = this.first ? 0 : angDiff(this.lastYaw, I.yaw) / dt;
    this.lastYaw = I.yaw;
    this.turnLean = damp(this.turnLean, I.onGround ? clamp(-yawRate * v * 0.03, -0.2, 0.2) * gw : 0, 6, dt);

    // where she's attending to: the water while bending, else ahead / the camera's aim — never over her shoulder
    let look = seat && sw > 0.3 ? seat.look : I.look ?? add(I.pos, add(scale(fwd, 6), [0, 1.5, 0]));
    if (this.flowW > 0.01) {
      const yw = 0.46 * 1.15 * Math.sin(flowPh);
      const hl = add(I.pos, add(add(scale(fwd, Math.cos(yw) * 1.6 * s), scale(left, Math.sin(yw) * 1.6 * s)), [0, 1.5 * s, 0]));
      look = lerp3(look, hl, this.flowW);
    }
    const idle = (1 - this.gaitW) * (1 - bendK) * (1 - mk) * (1 - sw);
    if (idle > 0.01 && mode === 'idle') {
      const tt0 = I.time;
      look = add(look, scale(add(scale(left, (Math.sin(tt0 * 0.21) * 0.9 + Math.sin(tt0 * 0.53 + 1) * 0.35) * len(sub(look, I.pos)) * 0.12), [0, Math.sin(tt0 * 0.29 + 2) * 0.25, 0]), idle));
    }
    // flying she looks where she's going (a little below her path), unless she's bending
    if (mk > 0.001 && !(bendK > 0.2 || mode !== 'idle')) {
      const vv = len(I.vel), hs = Math.hypot(I.vel[0], I.vel[2]);
      const dh: V3 = hs > 0.5 ? [I.vel[0] / hs, 0, I.vel[2] / hs] : fwd;
      const el = vv > 0.8 ? clamp(Math.atan2(I.vel[1], hs) - 0.42 * Math.min(vv / 4, 1), -0.8, 0.3) : 0;
      const go = add(scale(dh, Math.cos(el)), [0, Math.sin(el), 0]);
      look = lerp3(look, add(I.pos, add(scale(go, 10), [0, 1.45 * s, 0])), mk);
    }
    {
      const to = sub(look, I.pos);
      const ang = Math.abs(angDiff(0, Math.atan2(dot(to, left), dot(to, fwd))));
      look = lerp3(look, add(I.pos, add(scale(fwd, 6), [0, 1.5, 0])), smoothstep(1.0, 1.7, ang));
    }
    const lookW = look;
    if (mk > 0.001) look = unlean(look);
    const toLook = sub(look, add(I.pos, [0, 1.4 * s, 0]));
    const lookYaw = clamp(angDiff(0, Math.atan2(dot(toLook, left), dot(toLook, fwd))), -1.4, 1.4);
    // a throw winds the torso back, then whips it through toward the target
    const tt = this.armT;
    const throwTwist = mode === 'push' || mode === 'throw' ? (tt < 0.12 ? -0.45 * ease(tt / 0.12) : tt < 0.3 ? -0.45 + 0.95 * ease((tt - 0.12) / 0.18) : 0.5 * (1 - ease(clamp((tt - 0.3) / 0.5, 0, 1)))) : 0;
    const flowTurn = this.flowW * 0.46 * Math.sin(flowPh);
    this.twist = damp(this.twist, clamp(lookYaw * 0.55, -0.7, 0.7) * Math.max(bendK, 0.3 * (1 - mk)) * (1 - this.flowW) * (1 - sw) + flowTurn + throwTwist, throwTwist !== 0 ? 18 : 6, dt);
    const leanWant = gw * (0.03 + 0.25 * runF) * Math.min(1, v / 2) + this.accLean + this.slopeLean + 0.06 * wadeK * gw
      + (mode === 'push' || mode === 'throw' ? 0.22 : 0) + (mode === 'hold' ? 0.06 : 0) - (mode === 'wave' ? 0.08 : 0) + 0.5 * (I.hold?.stoop ?? 0);
    this.lean = damp(this.lean, lerp(leanWant, seat?.lean ?? 0.15, sw), 5, dt);
    // the gait through the body
    const drift = Math.sin(I.time * 0.45) + 0.35 * Math.sin(I.time * 0.17 + 1.3);
    const sway = lerp(0.026, 0.009, runF) * s * Math.sin(TAU * (ph - 0.06)) * amp;
    const shift = idle * drift * 0.008 * s + this.idleW * 0.034 * s + sway + this.flowW * Math.sin(flowPh) * 0.065 * s + (GV?.sway ?? 0);
    const pelYaw = -amp * lerp(0.075, 0.11, runF) * Math.cos(TAU * ph);
    const pelList = amp * lerp(0.065, 0.03, runF) * Math.cos(TAU * (ph - 0.12)) + idle * drift * 0.012 + this.idleW * 0.09 + this.slopeList * (1 - mk);
    const chYaw = amp * lerp(0.09, 0.2, runF) * Math.cos(TAU * ph);
    let pelvis: V3 = [I.pos[0] + left[0] * shift, this.pelY, I.pos[2] + left[2] * shift];
    let pelFr: Fr = { o: pelvis, x: B.x, y: B.y, z: B.z };
    if (sw > 0.001 && seat) {
      // sitting: the pelvis eased from standing down onto the seat, turned to the instrument
      const sfwd: V3 = [-Math.sin(seat.yaw), 0, -Math.cos(seat.yaw)], sleft: V3 = [-Math.cos(seat.yaw), 0, Math.sin(seat.yaw)];
      const k = ease(sw);
      pelvis = lerp3(pelvis, seat.pelvis, k);
      const yaw = I.yaw + angDiff(I.yaw, seat.yaw) * k;
      const fw2: V3 = [-Math.sin(yaw), 0, -Math.cos(yaw)], lf2: V3 = [-Math.cos(yaw), 0, Math.sin(yaw)];
      void sfwd; void sleft;
      pelFr = { o: pelvis, x: lf2, y: [0, 1, 0], z: fw2 };
    }
    // (running, the pelvis tips forward with the lean — the trailing thigh then less far behind it — the spine above
    // taking the rest)
    const pelShare = lerp(0.4, 0.8, gw * runF);
    const pel = frEuler(pelFr, pelYaw * (1 - sw) + this.twist * 0.25 + A.twist * mk * 0.2, this.lean * pelShare + A.hipPitch * mk + 0.1 * sw, (pelList + this.turnLean) * (1 - sw) + A.bend * mk * 0.3);
    const rel = (q: V3): V3 => sub(q, sk.pelvis);
    const waistW = frW(pel, rel(sk.waist));
    this.setBone(this.bi.pelvis, pel.o, waistW, pel.z);
    // (the breath: the body's own slow rhythm, or a player's — set from what's at his lips — the chest lifting and
    // opening as the lungs fill, the shoulders rising with it, both eased so a breath taken quickly never pops)
    this.lungs = damp(this.lungs, this.breath ? clamp(this.breath.v, 0, 1) : 0.5, 7, dt);
    this.breathK = damp(this.breathK, this.breath ? clamp(this.breath.k, 0, 1) : 0, 4, dt);
    const breathe = lerp(Math.sin(I.time * 1.6) * 0.012, -(this.lungs - 0.5) * 0.05, this.breathK);
    this.breathShrug = this.breathK * (this.lungs - 0.45) * 0.1;
    const mid = frEuler(pel, (chYaw - pelYaw) * 0.2 * (1 - sw) + this.twist * 0.3 + A.twist * mk * 0.4, this.lean * (0.7 - pelShare) * 0.5 - A.arch * mk * 0.4, -pelList * 0.6 * (1 - sw) + A.bend * mk * 0.5);
    const chestBaseW = add(waistW, frD(mid, sub(sk.chestBase, sk.waist)));
    this.setBone(this.bi.spine, waistW, chestBaseW, mid.z);
    const ch = frEuler(pel, (chYaw - pelYaw) * (1 - sw) + this.twist * 0.75 + A.twist * mk + (GV?.twist ?? 0), this.lean * (1 - pelShare) + breathe - A.arch * mk - 0.06 * sw + (GV?.rock ?? 0),
      -pelList * 1.1 * (1 - sw) + A.bend * mk + (GV?.roll ?? 0));
    const chF: Fr = { o: chestBaseW, x: ch.x, y: ch.y, z: ch.z };
    const neckBaseW = frW(chF, sub(sk.neckBase, sk.chestBase));
    this.setBone(this.bi.chest, chestBaseW, neckBaseW, ch.z);
    // the head: toward what she's watching (limited, sprung quick enough that it stays steady over the shoulders)
    const lv = frL({ o: neckBaseW, x: ch.x, y: ch.y, z: ch.z }, look);
    const hyW = clamp(Math.atan2(lv[0], Math.max(lv[2], 0.05)), -0.8, 0.8) + A.headYaw * mk;
    const hpW = clamp(-Math.atan2(lv[1] - 0.15 * s, Math.hypot(lv[0], lv[2])), -0.6 - 0.35 * mk, 0.55) - A.headPitch * mk;
    this.headYaw = damp(this.headYaw, hyW, 7 + 7 * gw, dt);
    this.headPitch = damp(this.headPitch, hpW, 7 + 5 * gw, dt);
    const gNod = GV?.nod ?? 0, gTilt = GV?.tilt ?? 0;
    const nk = frEuler(ch, this.headYaw * NECK.turn, (this.headPitch + gNod) * NECK.nod, gTilt * 0.5);
    const headBaseW = add(neckBaseW, frD(nk, sub(sk.headBase, sk.neckBase)));
    this.setBone(this.bi.neck, neckBaseW, headBaseW, nk.z);
    const hd = frEuler(ch, this.headYaw, this.headPitch + gNod, gTilt);
    const headTopW = add(headBaseW, frD(hd, sub(sk.headTop, sk.headBase)));
    this.setBone(this.bi.head, headBaseW, headTopW, hd.z);
    this.J.chest = chestBaseW; this.J.pelvis = pelvis; this.J.head = add(headBaseW, scale(hd.y, 0.09 * s));
    this.J.headFwd = hd.z; this.J.headUp = hd.y;
    { const Fh = this.asset.header.face; this.J.lip = this.skinPoint(this.bi.head, [0, Fh.mouth_y - 0.007, (Fh.nose_tip?.[1] ?? this.asset.header.eye.z + 0.04) - 0.026]); }

    // ---- arms
    const target = mk > 0.001 ? unlean(pose.target) : pose.target;
    const pk = smoothstep(0.35, 1.0, leanP) * this.flyW;
    const chestC = frW(chF, [0, (sk.shoulderL[1] - sk.chestBase[1]) * 0.6, 0.05 * s]);
    const toT = norm(sub(target, chestC));
    const tRight = norm(cross(toT, [0, 1, 0]));
    const tUp = cross(tRight, toT);
    const t = this.armT;
    const armAmp = amp * lerp(0.36, 0.82, runF);
    for (const side of [1, -1]) {
      const i = side > 0 ? 0 : 1;
      const T = side > 0 ? 'L' : 'R';
      const shoulderBind = side > 0 ? sk.shoulderL : sk.shoulderR;
      const clavBind = side > 0 ? sk.clavL : sk.clavR;
      // relaxed: hanging from the shoulder, swinging opposite the legs a beat behind them (a little more forward than
      // back), the elbow bending as the arm comes forward; running, the elbows bend to pump, the hands cross a little
      const runA = gw * runF;
      // (the left arm leads when the right leg does: forward at the right heel strike, phase 0.5, plus the lag)
      const swing = side * armAmp * Math.cos(TAU * (ph - 0.5 - 0.06)) + armAmp * 0.18;
      // (running, the pump is locked to the legs — the spring's lag at a run's cadence would put the arms a quarter
      // of a stride out — reaching further back than forward, the elbow opening behind and closing in front)
      const pump = side * armAmp * Math.cos(TAU * (ph - 0.5 - 0.02)) - armAmp * 0.08;
      const sw0 = lerp(this.armSw[i].update(dt, [swing, 0, 0])[0], pump, runA);
      const elbR = 1.38 + 0.4 * clamp(sw0 / Math.max(armAmp, 0.1), -1, 1);
      const elb = lerp(0.3 + Math.max(0, sw0) * 0.55, elbR, runA) + 0.03 * breathe * 40 * idle;
      const abd = 0.155 + 0.05 * runA + 0.55 * wadeDeep;
      const uDir = rotateAxis([side * Math.sin(abd), -Math.cos(abd), 0], [1, 0, 0], -sw0 - 0.08 * wadeDeep);
      let fDir = rotateAxis(uDir, [1, 0, 0], -elb);
      this.elbAim[i] = frD(ch, uDir);
      fDir = norm(add(fDir, [-side * 0.35 * runA * Math.max(0, sw0) / Math.max(armAmp, 0.1), 0, 0]));
      const lu = this.len[this.bi['uarm' + T]], lf = this.len[this.bi['farm' + T]];
      let relaxedW = frW(chF, sub(add(shoulderBind, add(scale(uDir, lu), scale(fDir, lf * 0.97))), sk.chestBase));
      if (mk > 0.001) {
        const shW = frW(chF, sub(shoulderBind, sk.chestBase));
        let h = scale(A.hand[i], s);
        h = this.capArm(h);
        if (A.over > 0.001) {
          const o = this.overArm(side, h[2]);
          // (round the shoulder to it, the arm swung out to the side and up like a wing, its length eased apart: a
          // straight line from the hands at the hips — a dive's, into the water; flight's, bursting out of it — to
          // overhead went past the face, the elbows bent)
          const la = len(h), lb = len(o.t), k = A.over;
          if (la > 1e-4) {
            const ha = scale(h, 1 / la), hb = scale(o.t, 1 / lb), via = 4 * k * (1 - k) * (1 - dot(ha, hb)) * 0.5;
            h = scale(norm(add(add(scale(ha, 1 - k), scale(hb, k)), [side * via, 0, 0])), lerp(la, lb, k));
          } else h = lerp3(h, o.t, k);
          this.overAim[i] = o.aim;
          // (and on the way the palm down, as a wing's: a stiff body's forearm rolled past its limit otherwise)
          A.palm[i] = norm(add(lerp3(A.palm[i], o.palm, A.over), [0, -4 * A.over * (1 - A.over), 0]));
        }
        relaxedW = lerp3(relaxedW, add(shW, frD(ch, h)), mk);
      } else if (!I.onGround) {
        // in the air: arms open for balance (the arm opposite the leading leg forward, the other back and out)
        const shW = frW(chF, sub(shoulderBind, sk.chestBase));
        let airW = add(shW, add(scale(left, side * 0.32 * s), add(scale(fwd, (side > 0 ? -0.12 : 0.22) * s), [0, -0.14 * s, 0])));
        // (a double jump: both arms thrown up and out overhead, a Y, on the way up — let down as she comes down)
        const jt = I.jumpT ?? 9, yk = I.jump === 2 ? smoothstep(0, 0.12, jt) * (1 - smoothstep(0.4, 0.75, jt)) : 0;
        if (yk > 0) airW = lerp3(airW, add(shW, add(scale(left, side * 0.3 * s), add(scale(fwd, 0.06 * s), [0, 0.5 * s, 0]))), yk);
        relaxedW = lerp3(relaxedW, airW, 0.85);
      }
      let hand = relaxedW;
      let palm = 0, curl = lerp(0.42 + 0.2 * runF, A.curl[i], mk), grip = lerp(0.1 * runF, A.grip[i], mk);
      let bw = 0;
      const sideOff = scale(tRight, -side * 0.17 * s);
      const reach = (d: number) => add(add(chestC, scale(toT, d * s)), sideOff);
      if (bendK > 0.01 || mode !== 'idle') {
        let h = hand;
        switch (mode) {
          case 'draw': {
            // palms up, lifting the water from low to chest height
            const k = ease(clamp(t / 0.8, 0, 1));
            const low = add(add(chestC, [0, -0.42 * s, 0]), add(scale(toT, 0.3 * s), sideOff));
            h = lerp3(low, reach(0.42), k);
            palm = 1; curl = 0.35;
            break;
          }
          case 'hold': case 'wave': {
            if (mode === 'hold' && pose.flame) {
              // a flame in the right palm: the hand open and up before the chest, a little toward the middle, still
              // but for a breath; the left at rest
              if (side < 0) {
                h = add(reach(0.3), add(scale(tRight, -0.07 * s), [0, (-0.1 + 0.008 * Math.sin(I.time * 1.6)) * s, 0]));
                palm = 1; curl = 0.08;
              }
              break;
            }
            // flowing tai-chi: the leading hand out toward the water, the other in close and low, tracing slow
            // circles half a turn apart
            const w = 1.7, phi = i * Math.PI;
            const lead = side < 0;
            const r = (lead ? 0.12 : 0.09) * s;
            const circ = add(scale(tRight, Math.cos(I.time * w + phi) * r * 0.9), scale(tUp, Math.sin(I.time * w + phi) * r));
            const base = lead ? reach(0.36 + 0.06 * Math.sin(I.time * w * 0.5)) : add(reach(0.12), add(scale(tRight, -side * 0.06 * s), [0, -0.1 * s, 0]));
            h = add(base, circ);
            palm = lead ? -0.35 : 0.25; curl = lead ? 0.15 : 0.35;
            if (mode === 'wave') {
              const k = ease(clamp(t / 0.9, 0, 1));
              h = lerp3(h, add(chestC, add(add([0, 0.55 * s, 0], scale(fwd, 0.15 * s)), scale(left, side * 0.25 * s))), k);
              palm = -1; curl = 0.1;
            }
            break;
          }
          case 'swirl': {
            // stirring a great ball of water in front of her: the hands sweep across ahead of her chest
            const a = I.time * 2.6 + (i === 0 ? 0 : Math.PI);
            h = add(chestC, add(add(scale(fwd, (0.33 + 0.13 * Math.cos(a)) * s), scale(left, Math.sin(a) * 0.36 * s)), [0, (-0.1 + 0.07 * Math.sin(a * 2 + 0.6)) * s, 0]));
            palm = -0.55; curl = 0.15;
            break;
          }
          case 'push': case 'throw': {
            // anticipation (draw back), strike (the leading hand drives through toward the target while the other
            // pulls back to the hip), follow-through
            const lead = side < 0;
            const back = add(chestC, add(scale(toT, -0.12 * s), add(sideOff, [0, 0.05 * s, 0])));
            const out = lead ? add(reach(0.7), scale(tRight, 0.12 * s)) : add(chestC, add(scale(toT, -0.2 * s), add(scale(tRight, -side * 0.3 * s), [0, -0.25 * s, 0])));
            h = t < 0.12 ? lerp3(reach(0.35), back, ease(t / 0.12)) : t < 0.22 ? lerp3(back, out, ease((t - 0.12) / 0.1)) : lerp3(out, relaxedW, ease(clamp((t - 0.5) / 0.6, 0, 1)));
            palm = lead ? -0.05 : 0.3; curl = t < 0.22 ? -0.15 : 0.35;
            break;
          }
          case 'freeze': {
            // a sharp grip: fists pulled in, trembling with effort
            const tremble: V3 = [Math.sin(I.time * 41 + i) * 0.004, Math.sin(I.time * 37) * 0.004, 0];
            h = add(reach(0.3), add(tremble, [0, 0.02 * s, 0]));
            palm = -0.6; curl = 0.5; grip = 1;
            break;
          }
          case 'melt': {
            // open palms pushing out at the ice
            const k = ease(clamp(t / 0.5, 0, 1));
            h = lerp3(reach(0.25), reach(0.55), k);
            palm = -0.15; curl = -0.2;
            break;
          }
          case 'carryIce': {
            h = add(reach(0.5), [0, 0.08 * s, 0]);
            palm = -0.2; curl = 0.35; grip = 0.3;
            break;
          }
          case 'flow': {
            if ((pose.orb ?? 0) > 0) {
              // holding the ball: the left palm on its left side a little over it, the right a little under, rolled
              // round between them as the waist turns
              const R = pose.orb! + 0.03 * s;
              const roll = 0.45 * Math.sin(flowPh);
              const th = (side > 0 ? 0.35 : Math.PI + 0.35) + roll;
              const cl: V3 = [0.05 * Math.sin(flowPh) * s, (-0.2 + 0.03 * Math.cos(flowPh * 2)) * s, 0.4 * s];
              const lp: V3 = [cl[0] + Math.cos(th) * R, cl[1] + Math.sin(th) * R, cl[2]];
              const out = frD(ch, [Math.cos(th), Math.sin(th), 0]);
              let along = rej(this.fdPrev[i], out);
              along = len(along) > 1e-3 ? norm(along) : frD(ch, [0, 0, 1]);
              h = sub(add(chestC, frD(ch, lp)), scale(along, this.len[this.bi['hand' + T]] * 0.5));
              this.flowPd[i] = scale(out, -1);
              palm = 0; curl = 0.3;
              break;
            }
            // cloud hands: the arms rounded, the elbows sunk, each hand on its own side, half a turn apart
            const al = (side > 0 ? Math.PI / 2 : -Math.PI / 2) - flowPh;
            const ca = Math.cos(al), sa = Math.sin(al);
            h = add(chestC, frD(ch, [side * (0.11 + 0.13 * ca) * s, (-0.05 + 0.25 * sa) * s, (0.3 + 0.06 * sa) * s]));
            const up = smoothstep(-0.35, 0.45, sa);
            this.flowPd[i] = norm(lerp3([0, -1, 0], norm(add(scale(ch.z, -1), scale(ch.x, -side * 0.35))), up));
            palm = 0; curl = 0.16;
            break;
          }
          default:
            h = hand;
        }
        bw = mode === 'push' || mode === 'throw' || mode === 'melt' || mode === 'freeze' || mode === 'draw' ? 1 : mode === 'flow' ? this.flowW : clamp(bendK * 1.2, 0, 1);
        // lying along her path in flight, holding or drawing water, the hands take flight poses of their own
        if (pk > 0.001 && (mode === 'hold' || mode === 'draw' || mode === 'wave' || mode === 'swirl' || mode === 'idle')) {
          const lead = side < 0;
          const shW = frW(chF, sub(shoulderBind, sk.chestBase));
          const atSh = (x: number, y: number, z: number): V3 => add(shW, frD(ch, [side * x * s, y * s, z * s]));
          const phi = I.time * 1.7 + i * Math.PI;
          let fh = lead
            ? atSh(0.19 + 0.05 * Math.cos(phi), 0.47 + 0.04 * Math.sin(phi * 0.5), 0.19 + 0.07 * Math.sin(phi))
            : atSh(0.44 + 0.04 * Math.sin(phi), -0.03 + 0.05 * Math.cos(phi), 0.13 + 0.07 * Math.cos(phi));
          if (mode === 'draw' && lead) fh = lerp3(atSh(0.12, 0.12, 0.47), atSh(0.15, 0.3, 0.25), ease(clamp(t / 0.8, 0, 1)));
          h = lerp3(h, fh, pk);
          this.flyPd[i] = frD(ch, lead ? [side * 0.1, 0.25, 1] : [side * 0.45, -0.1, 1]);
          if (mode !== 'idle') bw = Math.max(bw, clamp(bendK * 1.2, 0, 1));
        }
        hand = lerp3(hand, h, bw);
      }
      // at an instrument: the hand's goal (the palm over the keys, its way and its palm down); holding something, its own
      // (something held in the world, flying or swimming — Aang's glider: its grip into the upright body the lean then
      // tips, as the bending's target is)
      const held = seat ? null : I.hold?.hands[i] ?? null;
      let goal = seat ? seat.hands[i] : held && I.hold?.leaned && mk > 0.001 ? {
        ...held, palm: unlean(held.palm), fwd: unleanD(held.fwd), down: unleanD(held.down), tips: held.tips.map((t) => t && unlean(t)),
        elbow: held.elbow && unleanD(held.elbow), knuckles: held.knuckles && unlean(held.knuckles),
      } : held;
      // (a hold anchored to a bone — the flute's to the head: carried by how far that point has moved since the hold
      // was made, so it rides the head with no frame's lag)
      const An = this.anchor;
      if (goal && An && An.k[i] > 1e-3) {
        const d = scale(sub(this.skinPoint(An.bone, An.local), An.was), An.k[i]);
        if (len(d) < 0.25 * s) goal = shiftGoal(goal, d);
      }
      let goalW = 0;
      const gw0 = seat ? sw * 1.4 - 0.4 : I.hold?.w[i] ?? 0;
      if (goal && gw0 > 0.001) {
        goalW = ease(clamp(gw0, 0, 1));
        // (a hand free to move to its fingertips: the palm and the fingers solved together first, the arm then given
        // the palm as solved)
        if ((goal.palmFree ?? 0) > 0 && !goal.exact && this.handM[i] && goal.tips.some((t) => t)) goal = this.chordPalm(i, side, T, goal, goalW, dt);
        // (the wrist sits back from the palm's middle along the hand)
        const hl = this.len[this.bi['hand' + T]];
        const wristT = goal.knuckles ? sub(goal.knuckles, scale(goal.fwd, this.knuckleLen(T))) : sub(goal.palm, scale(goal.fwd, hl * 0.55));
        hand = lerp3(hand, wristT, goalW);
        curl = lerp(curl, goal.curl ?? 0.55, goalW);
        grip = lerp(grip, 0, goalW);
      }
      this.palmV[i] = damp(this.palmV[i], palm, 10, dt);
      this.curlV[i] = damp(this.curlV[i], curl, 10, dt);
      this.gripV[i] = damp(this.gripV[i], grip, 12, dt);
      if (this.first) this.hands[i].reset(hand);
      this.hands[i].shift(disp);
      // (the follow-through spring only softens the hands' own motion: the arm swing has its own, the keys none, swim
      // strokes keep most of their timing)
      hand = lerp3(this.hands[i].update(dt, hand), hand, Math.max(lerp(0.45, 0.9, runF) * gw * (1 - mk), goalW, 0.8 * Math.min(1, this.surfW + this.subW)) * (1 - bw) + bw * 0);
      this.elbAimW[i] = runA * (1 - bw) * (1 - goalW) * (1 - mk);
      // (flying and swimming: the pose's own elbow where it has one — the crawl's high elbow)
      const ae = A.over > 0.001 ? lerp3(A.elbow[i], this.overAim[i], A.over) : A.elbow[i], ael = len(ae);
      if (mk > 0.001 && ael > 0.05) { this.elbAim[i] = norm(frD(ch, ae)); this.elbAimW[i] = Math.max(this.elbAimW[i], mk * Math.min(1, ael) * (1 - bw) * (1 - goalW)); }
      const pfw = pk * bw;
      let pw = Math.max(mk * (1 - bw), pfw);
      let pd = pfw > 0.001 ? norm(lerp3(frD(ch, A.palm[i]), this.flyPd[i], pfw / Math.max(pw, 1e-4))) : frD(ch, A.palm[i]);
      const fpw = mode === 'flow' ? this.flowW * bw : 0;
      if (fpw > 0.001) { pd = norm(lerp3(pw > 0.001 ? pd : this.flowPd[i], this.flowPd[i], fpw)); pw = Math.max(pw, fpw); }
      if (goal && goalW > 0.001) { pd = norm(lerp3(pw > 0.001 ? pd : goal.down, goal.down, goalW)); pw = Math.max(pw, goalW); }
      this.armIK(side, T, chF, ch, clavBind, shoulderBind, hand, this.palmV[i], this.curlV[i], this.gripV[i], pw > 0.001 ? pd : null, pw, goal && goalW > 0.001 ? goal : null, goalW, dt);
    }

    // ---- legs
    for (const side of [1, -1]) {
      const i = side > 0 ? 0 : 1;
      const T = side > 0 ? 'L' : 'R';
      const G = FG[i];
      const hipBind = side > 0 ? sk.hipL : sk.hipR;
      const hip = frW(pel, rel(hipBind));
      const ffwd = G.ffwd, fside = G.side;
      let fdir = G.fdir;
      const footLen = len(fdir);
      let ankle = G.ankle;
      const lt = this.len[this.bi['thigh' + T]], ls = this.len[this.bi['shin' + T]];
      const ft = this.feet[i];
      // (a foot just off the ground folds up behind rather than trailing on a straight leg — running fully, walking a
      // little less: its ankle drawn in toward the hip early in the swing, the heel kicked up)
      if (!ft.planted && !ft.air && this.moving && !ft.settle) {
        const kick = lerp(0.7, 1, runF) * gw * smoothstep(0, 0.15, ft.t) * (1 - smoothstep(0.35, 0.6, ft.t));
        const dv = sub(ankle, hip), dl = len(dv), maxD = (lt + ls) * (1 - 0.12 * kick);
        if (dl > maxD) ankle = add(hip, scale(dv, maxD / dl));
      }
      const legDir = norm(sub(ankle, hip));
      // (the knee's way: ahead of her; sitting, up and ahead)
      const kpole = norm(add(cross(legDir, scale(fside, -1)), scale(ffwd, 0.25)));
      let pole = dot(kpole, ffwd) > 0 ? kpole : ffwd;
      if (sw > 0.001) pole = norm(lerp3(pole, seat?.knees?.[i] ?? norm(add(ffwd, [0, 0.6, 0])), sw));
      let knee = ik2(hip, ankle, lt, ls, pole, 0.02 * (lt + ls));
      let sd = norm(sub(ankle, knee));
      let sideAx = scale(fside, -1);
      if (mk > 0.001) {
        // flying: the leg straight from the pose — thigh swung forward and in / out, knee bent, the foot pointed
        const L = A.leg[i];
        const thighD = rotateAxis(rotateAxis(scale(pel.y, -1), pel.z, side * L[2]), pel.x, -(L[0] + legTrail * 0.8));
        const shinD = rotateAxis(thighD, pel.x, Math.max(L[1] + Math.abs(legTrail) * 0.4, 0.02));
        // (pointed as far as this body's ankle goes easily: its foot's angle to its shin at rest, less the point)
        const footD = rotateAxis(shinD, pel.x, -(this.fit.foot - POINT * this.flex * clamp(L[3], 0, 1)));
        knee = lerp3(knee, add(hip, scale(thighD, lt)), mk);
        sd = norm(lerp3(sd, shinD, mk));
        fdir = scale(norm(lerp3(norm(fdir), footD, mk)), footLen);
        pole = norm(lerp3(pole, rotateAxis(pel.z, pel.x, -L[0]), mk));
        sideAx = norm(lerp3(sideAx, pel.x, mk));
      }
      const ankleA = add(knee, scale(sd, ls));
      // (a swinging foot follows its shin — kicked up behind, the toes hang down — its ankle eased from the push-off's
      // to a little above neutral; its own pitch back for the strike)
      let toeDir = G.toeDir;
      const tilt = Math.atan2(dot(sd, ffwd), -sd[1]) - this.shinTilt[i];
      // (the foot turned about its ankle by d, toes down never into the ground)
      const turnFoot = (d: number) => {
        for (let k = 0; k < 6 && d < 0; k++) {
          const p = add(add(ankleA, rotateAxis(fdir, fside, d)), scale(rotateAxis(toeDir, fside, d), this.len[this.bi['toe' + T]]));
          if (p[1] > I.ground(p[0], p[2]) + 0.012 * s) break;
          d *= 0.6;
        }
        fdir = rotateAxis(fdir, fside, d);
        toeDir = rotateAxis(toeDir, fside, d);
      };
      if (ft.planted || ft.air) this.ankA[i] = ft.pitch - tilt;
      else if (mk < 0.999) {
        const ws = smoothstep(0, 0.05, ft.t) * (1 - smoothstep(0.72, 0.97, ft.t)) * (1 - mk);
        const a = lerp(this.ankA[i], lerp(0.03, 0.08, runF), smoothstep(0, 0.35, ft.t));
        turnFoot(ws * (tilt + a - ft.pitch));
      }
      // (sitting with the feet drawn in under her — perched on the scooter's ball — a foot comes up onto its ball
      // rather than bending the ankle past ~13°)
      if (sw > 0.001 && seat && mk < 0.999) turnFoot(-Math.max(0, ft.pitch - tilt - 0.22) * sw * (1 - mk));
      const ball = add(ankleA, fdir);
      const fn = norm(fdir);
      const toeD = norm(lerp3(toeDir, fn, mk));
      const toe = add(ball, scale(toeD, this.len[this.bi['toe' + T]]));
      const [kUp, sUp] = legUps(norm(sub(knee, hip)), sd, sub(ankleA, hip), pole);
      this.setBone(this.bi['thigh' + T], hip, knee, kUp);
      this.setBone(this.bi['shin' + T], knee, ankleA, sUp);
      this.setBone(this.bi['foot' + T], ankleA, ball, norm(cross(fn, sideAx)));
      this.setBone(this.bi['toe' + T], ball, toe, norm(cross(toeD, sideAx)));
      if (side > 0) this.J.footL = ankleA; else this.J.footR = ankleA;
    }
    this.setBone(this.bi.root, I.pos, add(I.pos, fwd), [0, 1, 0]);

    // ---- flight's and swimming's lean (floated at the surface: her head just out of the water), the face, the chains
    if (I.waterLevel != null && this.surfW > 0.01) {
      const headY = pivot[1] + leanRot(sub(this.J.head, pivot))[1];
      const fw = clamp(I.waterLevel + 0.19 * s - headY, -0.6, 1.2) * this.surfW;
      this.floatY = this.first ? fw : damp(this.floatY, fw, 5, dt);
    } else this.floatY = damp(this.floatY, 0, 5, dt);
    lift = A.lift * mk + this.floatY;
    if (mk > 0.001) this.leanBody(pivot, fwd, left, leanP, leanR, lift);
    // ---- a whole body from goals over the rest (body/solve.ts), blended in and out by its weight
    const bw = I.body && I.body.w > 0.001 && HeroRig.bodyKit ? Math.min(1, I.body.w) : 0;
    if (bw > 0) this.bodyPass(I, I.body!.goal, bw, dt);
    else if (this.bodyWas > 0) this.bodyRelease(I);
    // (tumbling: the solved body turned whole about its waist and lifted — a somersault, a cartwheel)
    const tb = bw > 0.5 ? I.body!.goal.tumble : null;
    if (tb && (tb.pitch || tb.roll || tb.lift)) this.leanBody(scale(add(this.J.pelvis, this.J.chest), 0.5), fwd, left, tb.pitch, tb.roll, tb.lift);
    // (a triple jump's front flip: one whole turn forward about the tuck's middle, quickest through the top of it)
    const fl = I.flip ?? 0;
    if (fl > 0) this.leanBody(scale(add(this.J.pelvis, this.J.chest), 0.5), fwd, left, 2 * Math.PI * fl - Math.sin(2 * Math.PI * fl), 0, 0);
    this.bodyWas = bw;
    // ---- a posed body over hers (yoga): its bones blended in, the joints others read taken from the blend
    const pz = I.posed && I.posed.w > 0.001 ? I.posed : null;
    if (pz) this.blendPosed(pz.bones, Math.min(1, pz.w));
    let lookAt = bw > 0 && I.body!.goal.look ? lerp3(lookW, I.body!.goal.look, bw) : lookW;
    if (pz?.look) lookAt = lerp3(lookAt, pz.look, smoothstep(0, 1, pz.w));
    this.rigFace(dt, lookAt, bendK * (1 - bw) * (1 - Math.min(1, pz?.w ?? 0)), mode);
    this.graceSpeed = len(I.vel);
    this.graceT += dt;
    this.posedW = Math.max(bw, pz ? Math.min(1, pz.w) : 0);
    // (the hips' hanging frame, from the body as it ended up: the clothes under the hips and the chains hang from it)
    this.hangK = poseHang(this.asset, this.bones, dt);
    this.rigChains(dt, I, disp, mk);
    // (the props far under the ground, out of every view and shadow — unless one's placed: then where it was put)
    for (const i of this.props) {
      const at = this.propAt.get(i);
      if (at) { this.setProp(i, at); continue; }
      const b = this.B[i];
      this.setBone(i, sub(b.head, [0, 500, 0]), sub(b.tail, [0, 500, 0]), b.up);
    }
    this.first = false;
    for (let i = 0; i < this.nBones; i++) matToDQ(this.bones, i * 16, this.dq, i * 8);
  }


  // ---------------------------------------------------------------- the whole body from goals (body/solve.ts)
  /** the body solved for its goal and posed: the pelvis, the spine, the neck and the head, the legs; the arms through
   *  armIK (armFit's elbow, the wrist's limits, the fingers) to the goal's hands (or hanging); over the rest by w */
  private bodyPass(I: RigInput, G: BodyGoal, w: number, dt: number) {
    const K = HeroRig.bodyKit!;
    const M = this.bodyM ??= new K.BodyModel(this.asset, this.female);
    const S = this.bodyS ??= new K.BodyState();
    const normal = w < 0.999 ? (this.bodyNormal ??= new Float32Array(this.bones.length)) : null;
    if (normal) normal.set(this.bones);
    if (this.bodyWas <= 0 || this.first) S.reset();
    S.dt = dt;
    const P = this.bodyPose = K.solveBody(M, G, S, S.x ? 4 : 40);
    const bi = this.bi, sk = this.sk;
    this.setBone(bi.pelvis, P.pel.o, P.waist, P.pel.z);
    this.setBone(bi.spine, P.waist, P.chestBase, P.mid.z);
    this.setBone(bi.chest, P.chestBase, P.neckBase, P.ch.z);
    this.setBone(bi.neck, P.neckBase, P.headBase, P.nk.z);
    this.setBone(bi.head, P.headBase, P.headTop, P.hd.z);
    for (let i = 0; i < 2; i++) {
      const L = P.legs[i], T = i === 0 ? 'L' : 'R';
      const [kUp, sUp] = legUps(norm(sub(L.knee, L.hip)), norm(sub(L.ankle, L.knee)), sub(L.ankle, L.hip), L.pole);
      this.setBone(bi['thigh' + T], L.hip, L.knee, kUp);
      this.setBone(bi['shin' + T], L.knee, L.ankle, sUp);
      this.setBone(bi['foot' + T], L.ankle, L.ball, L.footUp);
      this.setBone(bi['toe' + T], L.ball, L.toe, L.toeUp);
    }
    // the arms, with their own state (the rest's kept for when the body lets go)
    this.swapArmState();
    const chF = { o: P.chestBase, x: P.ch.x, y: P.ch.y, z: P.ch.z };
    for (const side of [1, -1]) {
      const i = side > 0 ? 0 : 1, T = side > 0 ? 'L' : 'R';
      const shoulderBind = side > 0 ? sk.shoulderL : sk.shoulderR, clavBind = side > 0 ? sk.clavL : sk.clavR;
      const H = P.hands[i];
      if (H) {
        const g = { ...H.goal, bear: H.bear, shoulder: true };
        this.armIK(side, T, chF, P.ch, clavBind, shoulderBind, H.wrist, 0, g.curl ?? 0.55, 0, g.down, 1, g, 1, dt);
      } else {
        // (no goal: hanging easy from the shoulder, the elbow a little bent)
        const abd = 0.13, uDir = rotateAxis([side * Math.sin(abd), -Math.cos(abd), 0], [1, 0, 0], -0.05);
        const fDir = rotateAxis(uDir, [1, 0, 0], -0.32);
        const lu = this.len[bi['uarm' + T]], lf = this.len[bi['farm' + T]];
        const hand = frW(chF, sub(add(shoulderBind, add(scale(uDir, lu), scale(fDir, lf * 0.97))), sk.chestBase));
        this.armIK(side, T, chF, P.ch, clavBind, shoulderBind, hand, 0, 0.42, 0, null, 0, null, 0, dt);
      }
    }
    const stat = this.armStat.map((a) => ({ ...a }));
    this.swapArmState();
    if (w >= 0.5) this.armStat.forEach((a, i) => Object.assign(a, stat[i]));
    // over the rest by w (each bone's dual quaternion blended: rigid, no shrinking at the joints)
    if (normal) {
      const skip = this.chainBones();
      for (let i = 0; i < this.nBones; i++) {
        if (skip.has(i)) continue;
        const k = i * 16;
        matToDQ(normal, k, this.dqA, 0); matToDQ(this.bones, k, this.dqB, 0);
        dqMixToMat(this.dqA, this.dqB, w, this.bones, k);
      }
    }
    this.jointsFromBones();
    void I;
  }
  /** the body let go: the feet planted where they were last seen — the pose's over the gait's by its last weight (the
   *  rest's gait steps them back under her). Let go after a fade they're the gait's own, and a foot mid-step steps on:
   *  planted at a kneel's as she walked off, one was left behind her for a whole stride, her hips sinking to reach it */
  private bodyRelease(I: RigInput) {
    const P = this.bodyPose, w = clamp(this.bodyWas, 0, 1);
    if (P) for (let i = 0; i < 2; i++) {
      const f = this.feet[i], L = P.legs[i];
      if (!f || !L || (!f.planted && w < 0.5)) continue;
      const q = lerp3(f.p, lerp3(L.ankle, L.ball, 0.5), w);
      f.p = [q[0], I.ground(q[0], q[2]), q[2]]; f.planted = true; f.air = false; f.t = 1; f.pitch = lerp(f.pitch, 0, w);
    }
    this.bodyS?.reset();
  }
  private swapArmState() {
    const A = this.bodyArm ??= { tw: [0, 0], sw: [null, null], swv: [0, 0], psi: [0, 0], tips: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], fd: [[0, 0, 1], [0, 0, 1]] };
    [A.tw, this.twPrev] = [this.twPrev, A.tw];
    [A.sw, this.swPrev] = [this.swPrev, A.sw];
    [A.swv, this.swVel] = [this.swVel, A.swv];
    [A.psi, this.psi] = [this.psi, A.psi];
    [A.tips, this.tipsW] = [this.tipsW, A.tips];
    [A.fd, this.fdPrev] = [this.fdPrev, A.fd];
  }
  private chainSkip: Set<number> | null = null;
  /** the chains' bones and the props' (posed after from their parents: left out of a blend) */
  private chainBones() {
    return this.chainSkip ??= new Set([...this.chains.flatMap((c) => Array.from({ length: c.bind.length - 1 }, (_, i) => c.b0 + i)), ...this.props]);
  }
  /** how far her hips have tipped over (garment.ts poseHang: the hips' chains held to their rest shape by it) */
  private hangK = 0;
  /** how far a posed body (yoga's, or the body pass's) is over hers this frame (the cloth drapes by it) */
  private posedW = 0;
  private dqA = new Float32Array(8);
  private dqB = new Float32Array(8);
  /** another solver's bones over hers by w (each bone's dual quaternion blended: rigid, no shrinking at the joints);
   *  the chains' and the props' bones are left hers (the cloth and the hair hang from the blended body after) */
  private blendPosed(src: Float32Array, w: number) {
    const skip = this.chainBones();
    const o = this.bones;
    for (let i = 0; i < this.nBones; i++) {
      if (skip.has(i)) continue;
      const k = i * 16;
      if (w >= 0.999) { for (let c = 0; c < 16; c++) o[k + c] = src[k + c]; continue; }
      matToDQ(o, k, this.dqA, 0);
      matToDQ(src, k, this.dqB, 0);
      dqMixToMat(this.dqA, this.dqB, w, o, k);
    }
    this.jointsFromBones();
  }
  /** the joints others read (the hands for the water, the head for the camera, the lip for a cup), from the bones */
  private jointsFromBones() {
    const B = this.B, bi = this.bi, at = (n: string, f = 0.5) => { const b = B[bi[n]]; return this.skinPoint(bi[n], lerp3(b.head, b.tail, f)); };
    this.J.handL = at('handL'); this.J.handR = at('handR');
    this.J.chest = at('chest', 0); this.J.pelvis = at('pelvis', 0); this.J.footL = at('footL', 0); this.J.footR = at('footR', 0);
    this.J.head = this.skinPoint(bi.head, add(B[bi.head].head, [0, 0.09 * this.s, 0]));
    this.J.headFwd = norm(this.skinDir(bi.head, [0, 0, 1])); this.J.headUp = norm(this.skinDir(bi.head, [0, 1, 0]));
    const Fh = this.asset.header.face;
    this.J.lip = this.skinPoint(bi.head, [0, Fh.mouth_y - 0.007, (Fh.nose_tip?.[1] ?? this.asset.header.eye.z + 0.04) - 0.026]);
  }

  private liftFoot(f: Foot, dur: number, lift: number) {
    f.planted = false; f.from = [...f.p] as V3; f.to = [...f.p] as V3; f.t = 0; f.dur = Math.max(dur, 0.12); f.yaw0 = f.yaw; f.pitch0 = f.pitch; f.lift = lift; f.settle = false;
  }

  /** the flight / swimming pose for this frame: each mode's pose mixed by how far she's in it */
  private airPose(I: RigInput, fwd: V3, dt: number): AirPose {
    let P = newPose();
    const tot = this.flyW + this.surfW + this.subW;
    if (tot < 1e-4) return P;
    const t = I.time, u = I.swimPhase ?? 0, swim = I.swim ?? 0;
    const v = len(I.vel), fwdSp = dot(I.vel, fwd);
    this.moveW = damp(this.moveW, smoothstep(0.15, 0.9, swim === 1 ? I.speed : v), 4, dt);
    this.sprintW = damp(this.sprintW, I.running && this.moveW > 0.3 ? 1 : 0, 3, dt);
    if (this.flyW > 1e-4) mixPose(P, flightPose(t, fwdSp, v, I.vel[1], I.boost ?? 0, I.flyRoll ?? 0, I.flyPitch ?? 0, I.glider ?? 0, I.skydive ?? 0, I.diveDown ?? 0), this.flyW / tot);
    const mv = this.moveW, sp = this.sprintW;
    if (this.surfW > 1e-4) {
      const w = this.surfW / tot;
      mixPose(P, treadPose(t), w * (1 - mv));
      mixPose(P, breastPose(u), w * mv * (1 - sp));
      mixPose(P, crawlPose(u), w * mv * sp);
    }
    if (this.subW > 1e-4) {
      const w = this.subW / tot;
      // (a leap out of the water holds the streamline)
      const leap = swim === 3 ? 1 : 0;
      mixPose(P, floatPose(t), w * (1 - mv) * (1 - leap));
      mixPose(P, pullOutPose(u), w * mv * (1 - sp) * (1 - leap));
      mixPose(P, dolphinPose(u, 1), w * mv * sp * (1 - leap));
      mixPose(P, dolphinPose(u, 0), w * leap);
    }
    // (a triple jump's somersault: tucked in fast, held through the turn, opened out as it comes round)
    const f = I.flip ?? 0, tk = f > 0 ? smoothstep(0, 0.12, f) * (1 - smoothstep(0.72, 1, f)) : 0;
    if (tk > 0) { const Q = newPose(); mixPose(Q, P, 1 - tk); mixPose(Q, tuckPose(), tk); P = Q; }
    for (const i of [0, 1]) { const l = len(P.palm[i]); P.palm[i] = l > 1e-3 ? scale(P.palm[i], 1 / l) : [0, -1, 0]; }
    return P;
  }

  /** an air pose's hand no higher overhead than this body's shoulder lifts easily (as overArm's): past it, tipped
   *  forward — the triple boost's fist straight up took a stiff body's shoulder past its limit */
  private capArm(h: V3): V3 {
    const r = len(h), emax = Math.min(Math.PI, 2.993 * (1 + (this.flex - 1) * 0.8)), ymax = -r * Math.cos(emax);
    if (r < 1e-4 || h[1] <= ymax) return h;
    return [h[0], ymax, Math.max(h[2], Math.sqrt(Math.max(0, r * r - h[0] * h[0] - ymax * ymax)))];
  }

  /** an arm overhead in a streamline, fitted to this body (relative to its shoulder, the chest's axes: x her left, y up,
   *  z forward): the wrist over the head's middle, the arm straight at its own length (z: the pose's own depth), no
   *  higher than the body's shoulder lifts easily; the elbow out and back, the palm forward (the upper arms by the
   *  ears, the hands stacked palm to back) — turned together about the arm, where that's past the upper arm's turn for
   *  this body at this height, until it's within it (body/measure.ts' reading: from where raising the arm straight from
   *  hanging carries it, let go near straight up), the forearm's roll left as it was */
  private overArm(side: number, z: number): { t: V3; aim: V3; palm: V3 } {
    const sk = this.sk, s = this.s, T = side > 0 ? 'L' : 'R', r = this.fit.arm, D = Math.PI / 180;
    // (from the shoulder where the shrug puts it — armIK lifts the collarbone for a reach overhead: measured from the
    // shoulder at rest, the arm came out short and bent ~55° at the elbow)
    const cv = sub(sk['shoulder' + T], sk['clav' + T]), up = sub(rotateAxis(cv, [0, 0, 1], side * 0.45), cv);
    const vx = -side * this.fit.shW - up[0];
    let vz = z, vy = Math.sqrt(Math.max(0.01, r * r - vx * vx - vz * vz));
    // (no higher than 0.9 of the way to this body's limit: body/anatomy.ts' shoulder elevation at its flexibility —
    // a stiff body's arms up and forward)
    const emax = Math.min(Math.PI, 2.993 * (1 + (this.flex - 1) * 0.8)), ymax = -r * Math.cos(emax);
    if (vy > ymax) { vy = ymax; vz = Math.max(vz, Math.sqrt(Math.max(0, r * r - vx * vx - vy * vy))); }
    // (the turn read as the measure reads it: the right arm mirrored onto the left)
    const m = (v: V3): V3 => (side > 0 ? v : [-v[0], v[1], v[2]]);
    const hd = norm([up[0] + vx, up[1] + vy, vz]), hm = m(hd), elev = Math.acos(clamp(-hd[1], -1, 1));
    const ax = cross([0, -1, 0], hm), al = len(ax);
    const ref: V3 = al > 1e-4 ? rotateAxis([0, 0, 1], scale(ax, 1 / al), elev) : [0, 0, -1];
    let aim = norm(rej(m([side * 0.7, 0, -0.7]), hm)), palm = m([0, 0, 1]);
    const rot = -Math.atan2(dot(cross(ref, scale(aim, -1)), hm), dot(ref, scale(aim, -1)));
    const relief = 2 * clamp((elev - 150 * D) / (20 * D), 0, 1), kf = 1 + (this.flex - 1) * 0.7;
    const want = clamp(rot, (-80 * D - relief) * kf * 0.85, (95 * D + relief) * kf * 0.85);
    if (want !== rot) { aim = rotateAxis(aim, hm, rot - want); palm = rotateAxis(palm, hm, rot - want); }
    aim = m(aim); palm = m(palm);
    // (stacked: one hand a hand's depth along its palm from the other)
    const st = scale(palm, side * 0.012 * s);
    return { t: [up[0] + vx + st[0], up[1] + vy + st[1], vz + st[2]], aim, palm };
  }

  private resetFeet(B: Fr, yaw: number, ground: (x: number, z: number) => number) {
    this.feet = [0, 1].map((i) => {
      const side = i === 0 ? 1 : -1;
      const p = frW(B, [side * 0.095 * this.s, 0, 0]);
      p[1] = ground(p[0], p[2]);
      return { p, planted: true, from: [...p] as V3, to: [...p] as V3, t: 1, dur: 0.3, yaw: yaw + side * 0.12, yaw0: yaw, lift: 0, air: false, pitch: 0, pitch0: 0, slope: 0, settle: false };
    });
    this.moving = false;
    this.gaitW = 0;
  }

  private armIK(side: number, T: string, chF: Fr, ch: Fr, clavBind: V3, shoulderBind: V3, target: V3, pv: number, curl: number, grip: number,
    pd: V3 | null, pw: number, goal: HandGoal | null, goalW: number, dt: number) {
    target = [...target] as V3;
    const sk = this.sk, s = this.s;
    const clavIn = frW(chF, sub(clavBind, sk.chestBase));
    const shoulderMid: V3 = [0, shoulderBind[1], shoulderBind[2]];
    const CS: Fr = { o: frW(chF, sub(shoulderMid, sk.chestBase)), x: ch.x, y: ch.y, z: ch.z };
    // (held exactly: an instrument's hand goes where it's put, and the hand turns as it's told — faded in over the
    // last of the goal's weight, so taking hold and letting go never pop)
    const ex = goal?.exact ? smoothstep(0.85, 1, goalW) : 0;
    // where an arm can put a hand: behind the plane of her back only out to its own side, across her body only in
    // front of it — never twisted round behind her
    if (ex < 1) {
      const raw = target;
      const q = frL(CS, target);
      const sx = side * q[0];
      let zMin = -0.06 * s - 0.24 * s * smoothstep(0.12 * s, 0.5 * s, sx);
      if (sx < 0) zMin = Math.max(zMin, 0.1 * s - sx * 0.6);
      const k = 0.08 * s, dz = q[2] - zMin;
      q[2] = zMin + (dz + Math.sqrt(dz * dz + k * k)) * 0.5;
      target = lerp3(frW(CS, q), raw, ex);
    }
    const tl = frL(CS, target);
    const shrug = clamp((tl[1] + 0.05 * s) / (0.45 * s), 0, 1);
    const protract = clamp((tl[2] - 0.15 * s) / (0.35 * s), 0, 1);
    let cv = frD(chF, sub(shoulderBind, clavBind));
    // (and a seat's shrug: a laugh's shoulders)
    cv = rotateAxis(cv, ch.z, side * (shrug * 0.45 + this.seatShrug * 0.3 + this.breathShrug));
    cv = rotateAxis(cv, ch.y, -side * protract * 0.22);
    const shoulder = add(clavIn, cv);
    const ci = this.bi['clav' + T], ua = this.bi['uarm' + T], fa = this.bi['farm' + T], ha = this.bi['hand' + T];
    this.setBone(ci, clavIn, shoulder, ch.y);
    const lu = this.len[ua], lf = this.len[fa];
    // (the elbow's way: out, down and back; practising the form, sunk; at the keys, out and down)
    let pole = norm(lerp3(frD(ch, [side * 0.7, -0.5, -0.55]), frD(ch, [side * 0.3, -1, -0.12]), this.flowW));
    // (running, the elbow where the pump puts it: back and close to her sides, not out)
    const ea = this.elbAimW[side > 0 ? 0 : 1];
    if (ea > 0.001) pole = norm(lerp3(pole, this.elbAim[side > 0 ? 0 : 1], ea));
    if (goal) pole = norm(lerp3(pole, goal.elbow ?? frD(ch, [side * 0.55, -0.8, -0.1]), goalW));
    const soft = 0.015 * (lu + lf), ti = side > 0 ? 0 : 1;
    // a goal's hand (an instrument's, something held): the way it lies, its palm's, its thumb's side
    let G: HandFrame | null = null;
    if (goal && goalW > 0.001) {
      const h = norm(goal.fwd), p = rej(goal.down, h);
      if (len(p) > 0.2) { const pn = norm(p); G = { h, p: pn, t: norm(scale(cross(pn, h), side)), turn: goal.turn, bear: goal.bear, hum: goal.bear || goal.shoulder, k: this.flex, ew: goal.elbowW }; }
    }
    // (and the elbow for it: swung round the shoulder-wrist line to where the whole arm's most at ease)
    if (G) {
      const fit = this.armFit(side, ti, shoulder, target, lu, lf, soft, pole, G, CS, shoulderBind, dt);
      pole = norm(lerp3(pole, fit, goalW));
      if (G.turn) G = turnHand(G, this.psi[ti]);
    } else { this.swPrev[ti] = null; this.swVel[ti] = 0; this.psi[ti] = 0; }
    const elbow = ik2(shoulder, target, lu, lf, pole, soft);
    const fd = norm(sub(target, elbow));
    this.fdPrev[ti] = fd;
    const wrist = add(elbow, scale(fd, lf));
    const ud = norm(sub(elbow, shoulder));
    const inward = scale(ch.x, -side);
    let vv = pv < 0 ? lerp3(inward, [0, -1, 0], -pv) : lerp3(inward, [0, 1, 0], pv);
    if (pd) vv = lerp3(vv, pd, pw);
    let palm = rej(vv, fd);
    if (len(palm) < 1e-3) palm = rej(ch.z, fd);
    palm = norm(palm);
    let hdir = norm(add(fd, scale(palm, curl * 0.5 - 0.08)));
    // at the keys the hand lies along its goal's way, the wrist level with the knuckles
    if (goal) hdir = norm(lerp3(hdir, norm(rej(goal.fwd, palm)), goalW));
    // (held exactly: the hand along its goal, the palm to it, the wrist bent as that needs)
    if (ex > 0) { hdir = norm(lerp3(hdir, goal!.fwd, ex)); palm = norm(rej(lerp3(palm, goal!.down, ex), hdir)); }
    let thumb = norm(scale(cross(palm, hdir), side));
    const [elbowUp, faUp] = armUps(ud, fd, pole);
    if (G && ex < 1) {
      // the goal's hand, turned no further from the forearm than a wrist bends (wristLimit), then no further round it
      // than a forearm rolls (85° either way from its middle: what's past it the hand gives up, not the arm) — all of
      // it let go as a hand held exactly takes over
      const L = wristLimit(fd, G);
      let tw = rollTo(faUp, L.t, fd);
      this.armStat[ti].want = tw;
      const rmax = ROLL_MAX * rollK(G);
      if (Math.abs(tw) > rmax) {
        const back = Math.sign(tw) * rmax - tw;
        L.h = rotateAxis(L.h, fd, back); L.t = rotateAxis(L.t, fd, back);
      }
      const k = goalW * (1 - ex);
      hdir = norm(lerp3(hdir, L.h, k));
      thumb = norm(rej(lerp3(thumb, L.t, k), hdir));
    }
    const thumbP = norm(rej(thumb, fd));
    // (the hand's turn about the forearm, half in the forearm, half at the wrist; without a goal taken the way that
    // continues last frame's so it never flips a whole turn — with one, always the short way: armFit chose for it)
    let tw = Math.atan2(dot(cross(faUp, thumbP), fd), dot(faUp, thumbP));
    const tp = this.twPrev[ti];
    if (!this.first && !G) { while (tw - tp > Math.PI) tw -= Math.PI * 2; while (tw - tp < -Math.PI) tw += Math.PI * 2; }
    if (Math.abs(tw) > Math.PI * 1.25) tw -= Math.sign(tw) * Math.PI * 2;
    this.twPrev[ti] = tw;
    // (a forearm turns about a hundred degrees either way from its middle, no more: a hand asked round further — a
    // pose's palm up or out, the turn carried on from last frame's past half a turn — faces as far as it goes, rather
    // than the wrist wrung like a towel: solarium's rig, 053d1bd. A goal's hand is already within ROLL_MAX; one held
    // exactly is as it's told)
    const lim = Math.abs(tw) <= TW0 || ex > 0 ? tw : Math.sign(tw) * (TW0 + (TW1 - TW0) * Math.tanh((Math.abs(tw) - TW0) / (TW1 - TW0)));
    if (lim !== tw) thumb = norm(rotateAxis(thumb, hdir, lim - tw));
    this.setBone(ua, shoulder, elbow, elbowUp);
    this.setBone(fa, elbow, wrist, rotateAxis(faUp, fd, 0.5 * lim));
    this.setBone(ha, wrist, add(wrist, scale(hdir, this.len[ha])), thumb);
    {
      // (how the arm's held, for tools and tests: the forearm's roll, the wrist's flexion and deviation, the elbow's bend)
      const t = norm(rej(thumb, hdir)), [fl, dv] = wristBend(fd, { h: hdir, p: scale(cross(hdir, t), side), t });
      const A = this.armStat[ti];
      A.roll = tw; A.flex = fl; A.dev = dv; A.elbow = Math.acos(clamp(dot(ud, fd), -1, 1));
    }
    if (side > 0) this.J.handL = add(wrist, scale(hdir, this.len[ha] * 0.5)); else this.J.handR = add(wrist, scale(hdir, this.len[ha] * 0.5));
    this.rigFingers(side, curl, grip, goal, goalW, dt);
  }

  /** the wrist to the knuckles (the middle finger's), along the hand: the body's own (the hand bone runs on to the
   *  fingertips) */
  private knuckleLen(T: string): number {
    const hb = this.bi['hand' + T], mb = this.bi['middle1' + T];
    if (hb === undefined) return 0.09;
    if (mb === undefined) return this.len[hb] * 0.5;
    const H = this.B[hb], d = norm(sub(H.tail, H.head));
    return Math.max(0.02, dot(sub(this.B[mb].head, H.head), d));
  }

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
  private armFit(side: number, ti: number, shoulder: V3, wrist: V3, lu: number, lf: number, soft: number, pref: V3, G: HandFrame,
    CS: Fr, shoulderBind: V3, dt = 1 / 60): V3 {
    const ax = norm(sub(wrist, shoulder));
    let r0 = rej(pref, ax);
    if (len(r0) < 1e-4) r0 = rej(CS.y, ax);
    r0 = norm(r0);
    const r1 = cross(ax, r0);
    const prev = this.swPrev[ti], pv = prev ? rej(prev, ax) : null, pvl = pv ? len(pv) : 0;
    const sw = Math.abs(shoulderBind[0]) || 0.17;
    // (the hand as it's turned now about its own way, within what the goal allows: the elbow found for it, then the
    // turn eased toward the best for that elbow — one at a time, cheaper than both together and as good frame on frame)
    const turn = Math.max(0, G.turn ?? 0);
    const GT = turn > 0 && this.psi[ti] ? turnHand(G, this.psi[ti]) : G;
    const cost = (phi: number) => {
      const pole = add(scale(r0, Math.cos(phi)), scale(r1, Math.sin(phi)));
      const elbow = ik2(shoulder, wrist, lu, lf, pole, soft);
      const fd = norm(sub(wrist, elbow)), ud = norm(sub(elbow, shoulder));
      const [, faUp] = armUps(ud, fd, pole);
      let c = armEase(fd, faUp, GT) + 0.4 * this.psi[ti] * this.psi[ti];
      // (a hand bearing weight: its arm straight, the swivel turns the humerus: its turn within the shoulder's)
      if (G.hum) c += humerusEase(CS, ud, armUps(ud, fd, pole)[0], side);
      // the elbow: not into the torso (an ellipse round the chest: a little narrower than the shoulders, shallower in
      // front than behind — an elbow tucked in front of the chest is how a guitarist's fretting arm hangs), not up over
      // the shoulders
      const q = frL(CS, elbow);
      const [tw, tf, tb] = this.torso;
      const inside = (p: V3) => { const ex = p[0] / (tw * sw), ez = p[2] / ((p[2] > 0 ? tf : tb) * sw), r = Math.hypot(ex, ez); return r < 1 ? 8 * (1 - r) * (1 - r) : 0; };
      c += inside(q);
      // (nor the upper arm through it, below the shoulders: a hand reaching across the body keeps its elbow out in front)
      { const mid = frL(CS, lerp3(shoulder, elbow, 0.5)); if (mid[1] < 0) c += inside(mid); }
      { const e = Math.max(0, q[1] + 0.05 * sw) / sw; c += 2 * e * e; }
      // the goal's way, and last frame's (so it doesn't hop between two nearly as good)
      c += (G.ew ?? 0.35) * (1 - Math.cos(phi));
      if (pv && pvl > 1e-3) c += 1.5 * (1 - dot(pole, scale(pv, 1 / pvl)));
      return { c, pole, fd, faUp };
    };
    const N = 36;
    let bi = 0, bc = Infinity;
    for (let k = 0; k < N; k++) { const r = cost((k / N) * TAU); if (r.c < bc) { bc = r.c; bi = k; } }
    // (a golden-section search over [lo, hi])
    const golden = (lo: number, hi: number) => {
      const g = 0.381966;
      let x1 = lo + g * (hi - lo), x2 = hi - g * (hi - lo), f1 = cost(x1).c, f2 = cost(x2).c;
      for (let it = 0; it < 12; it++) {
        if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = lo + g * (hi - lo); f1 = cost(x1).c; }
        else { lo = x1; x1 = x2; f1 = f2; x2 = hi - g * (hi - lo); f2 = cost(x2).c; }
      }
      return cost((lo + hi) / 2);
    };
    // the best of all: either side of the best sample
    const global = golden(((bi - 1) / N) * TAU, ((bi + 1) / N) * TAU);
    let best = global;
    if (HeroRig.armContinuity && pv && pvl > 1e-3 && dt > 0 && dt < 0.25) {
      // where it was, and the best within an elbow's swing of there (ARM_SWING rad/s)
      const pn = scale(pv, 1 / pvl), phi0 = Math.atan2(dot(pn, r1), dot(pn, r0));
      // (where it is is much worse than the best: it swings there faster — up to three times its pace — but still
      // through the way between, never across it in a frame)
      const w0 = ARM_SWING * dt + 0.01;
      let local = golden(phi0 - w0, phi0 + w0);
      for (let k = 2; k <= 3 && local.c > global.c + ARM_FLIP * (1 + 0.05 * global.c); k++) {
        const w = Math.min(Math.PI, w0 * k);
        local = golden(phi0 - w, phi0 + w);
      }
      best = local;
      const wn = HeroRig.armSpring;
      if (wn > 0) {
        // (the spring: toward the best within reach, its speed carried frame to frame; semi-implicit, stable while
        // wn·dt < 1, which a frame's dt keeps)
        const phiB = Math.atan2(dot(best.pole, r1), dot(best.pole, r0));
        let d = phiB - phi0;
        d -= TAU * Math.round(d / TAU);
        const h = Math.min(dt, 0.9 / wn);
        let v = this.swVel[ti] + (wn * wn * d - 2 * wn * this.swVel[ti]) * h;
        // (never faster than the hurry the window would allow)
        const vmax = 3 * ARM_SWING;
        v = Math.max(-vmax, Math.min(vmax, v));
        this.swVel[ti] = v;
        best = cost(phi0 + v * dt);
      }
    } else this.swVel[ti] = 0;
    if (turn > 0) {
      let pc = Infinity, ps = 0;
      for (let k = 0; k <= 8; k++) {
        const a = -turn + (2 * turn * k) / 8, e = armEase(best.fd, best.faUp, turnHand(G, a)) + 0.4 * a * a;
        if (e < pc) { pc = e; ps = a; }
      }
      // (eased toward it, so it doesn't flick between the samples)
      this.psi[ti] += (ps - this.psi[ti]) * 0.35;
    }
    this.swPrev[ti] = best.pole;
    return best.pole;
  }

  private rigFingers(side: number, curl: number, grip: number, goal: HandGoal | null, goalW: number, dt: number) {
    const t = side > 0 ? 'L' : 'R';
    // (holding something: the goal's grip; else the keys' resting curve below)
    const holds = !!goal && goal.grip !== undefined && goalW > 0.001;
    if (holds) grip = lerp(grip, goal!.grip!, goalW);
    const hi = side > 0 ? 0 : 1;
    const hb = this.bi['hand' + t];
    const Bn = this.B, H = Bn[hb];
    const d = norm(sub(H.tail, H.head));
    const tdir = norm(rej([0, 0, 1], d));
    const palm = scale(cross(d, tdir), side);
    const c = clamp(curl, -0.3, 1.2);
    // whole-hand bones (older rigs)
    const fi = this.bi['fingers' + t], ti = this.bi['tips' + t], th = this.bi['thumb' + t];
    const rot = (v: V3, a: number): V3 => {
      const vd = dot(v, d), vp = dot(v, palm), rest = sub(v, add(scale(d, vd), scale(palm, vp)));
      const co = Math.cos(a), sn = Math.sin(a);
      return add(rest, add(scale(d, vd * co - vp * sn), scale(palm, vd * sn + vp * co)));
    };
    if (fi !== undefined && ti !== undefined) {
      const a1 = 0.12 + c * 0.75 + grip * 1.05, a2 = 0.18 + c * 0.7 + grip * 0.9;
      const F = Bn[fi], Tb = Bn[ti];
      const k = F.head, mid = add(k, rot(sub(F.tail, k), a1));
      const tip = add(mid, rot(sub(Tb.tail, Tb.head), a1 + a2));
      const up = this.skinDir(hb, tdir);
      this.setBone(fi, this.skinPoint(hb, k), this.skinPoint(hb, mid), up);
      this.setBone(ti, this.skinPoint(hb, mid), this.skinPoint(hb, tip), up);
    }
    if (th !== undefined) {
      const Th = Bn[th];
      const tv = sub(Th.tail, Th.head);
      const ta = grip * 0.7 + Math.max(0, c) * 0.25;
      const tv2 = add(scale(tv, Math.cos(ta)), scale(palm, len(tv) * Math.sin(ta) * 0.8));
      this.setBone(th, this.skinPoint(hb, Th.head), this.skinPoint(hb, add(Th.head, tv2)), this.skinDir(hb, rej(tdir, norm(tv2))));
    }
    if (this.bi['index1' + t] === undefined) return;
    // (fingertips with targets: the hand solved as a hand — fingers.ts)
    // (the hand's solve carries its numbers frame to frame: what comes in is held to a grid first, so no engine's own
    // last bits get in — the same pose in every browser and in Node; math.ts dsin)
    if (goal && goalW > 0.001 && this.handM[hi] && goal.tips.some((x) => x)) { this.chordFingers(hi, side, q30(c), q30(grip), holds, goal, q30(goalW), dt); return; }
    // (a built hand — its file's own hand, header.hand — with no fingertip to place: its fingers at their rests through
    // the hand model, each finger bending about its own knuckle's axis; the older path below turns every finger about
    // the hand's one axis, which a modelled hand's curved, fanned fingers don't survive)
    if ((this.asset.header.hand || (goal?.pose && goalW > 0.001)) && this.handM[hi]) { this.restFingers(hi, q30(c), q30(grip), holds, goal, q30(goalW), dt); return; }
    // per-joint fingers: a relaxed hand cascades (the index curls least, the pinky most), the end joints fairly
    // straight; at an instrument each finger with a target reaches it — its curl solved so the tip lands there (the
    // middle and end joints coupled as a hand's are), its spread turned toward it
    const FAN = [0.06, 0.02, -0.03, -0.08], CASCADE = [0, 0.04, 0.1, 0.16], REL = [-0.14, -0.02, 0.1, 0.2];
    const rc = Math.max(0, c) * (1 - grip);
    const names = ['index', 'middle', 'ring', 'pinky'];
    const fanAx = norm(cross(d, tdir));
    for (let f = 0; f < 4; f++) {
      const ids = [1, 2, 3].map((k) => this.bi[names[f] + k + t]);
      if (ids.some((x) => x === undefined)) continue;
      const q = [Bn[ids[0]].head, Bn[ids[0]].tail, Bn[ids[1]].tail, Bn[ids[2]].tail];
      let ab = FAN[f] * (1 - grip) * (c < 0 ? 2.5 : 1);
      let ang = [c * 0.45 + grip * (1.25 + CASCADE[f]) + REL[f] * rc * 1.1, -0.05 + c * 0.33 + grip * (1.22 + CASCADE[f]) + REL[f] * rc,
        -0.12 + c * 0.1 + grip * 0.87 + REL[f] * rc * 0.4];
      const tip = goal?.tips[f + 1] ?? null;
      const tw = this.tipsW[hi];
      tw[f + 1] = damp(tw[f + 1], tip ? 1 : 0, tip ? 30 : 14, dt);
      if (tip && goalW > 0.001) {
        const solved = this.fingerIK(hb, q, tip, fanAx, palm, d);
        const k = goalW * tw[f + 1];
        ab = lerp(ab, solved.ab, k);
        ang = ang.map((a, j) => lerp(a, solved.ang[j], k));
      } else if (goal && goalW > 0.001 && !holds && !goal.loose) {
        // (resting on the keys: a pianist's curve, the fingertips just over them)
        ang = ang.map((a, j) => lerp(a, [0.32, 0.55, 0.32][j], goalW));
      }
      const flexAx = norm(cross(rotateAxis(d, fanAx, ab), rotateAxis(palm, fanAx, ab)));
      let p = q[0], a = 0;
      for (let k = 0; k < 3; k++) {
        a += ang[k];
        const v = rotateAxis(rotateAxis(sub(q[k + 1], q[k]), fanAx, ab), flexAx, a);
        const n = add(p, v);
        const up = rotateAxis(rotateAxis(palm, fanAx, ab), flexAx, a);
        this.setBone(ids[k], this.skinPoint(hb, p), this.skinPoint(hb, n), this.skinDir(hb, up));
        p = n;
      }
    }
    // (a built hand's ring and little metacarpals: held as at the bind, on the hand)
    for (const n of ['ring0', 'pinky0']) {
      const mi = this.bi[n + t];
      if (mi !== undefined) { const MB = Bn[mi]; this.setBone(mi, this.skinPoint(hb, MB.head), this.skinPoint(hb, MB.tail), this.skinDir(hb, MB.up)); }
    }
    const tid = [1, 2, 3].map((k) => this.bi['thumb' + k + t]);
    if (tid.some((x) => x === undefined)) return;
    const tq = [Bn[tid[0]].head, Bn[tid[0]].tail, Bn[tid[1]].tail, Bn[tid[2]].tail];
    const t0 = norm(sub(tq[1], tq[0]));
    const oppAx = norm(cross(t0, palm));
    // the bind thumb sticks out half a right angle: relaxed it swings in alongside the index finger, a fist wraps it
    const inAx = norm(cross(t0, d));
    let tin = 0.52 * clamp((c + 0.1) / 0.5, 0, 1) * (1 - grip);
    let tang = [0.2 + grip * 0.63 + Math.max(0, c) * 0.25, 0.08 + grip * 0.49 + c * 0.2, 0.06 + grip * 0.44 + c * 0.16];
    const ttip = goal?.tips[0] ?? null;
    const tw = this.tipsW[hi];
    tw[0] = damp(tw[0], ttip ? 1 : 0, ttip ? 30 : 14, dt);
    if (goal && goalW > 0.001 && (!holds || ttip) && !(goal.loose && !ttip)) {
      // at the keys the thumb lies along the keyboard under the hand, pressing with its side (holding: to its tip)
      let tinG = holds ? tin : 0.3, tangG = holds ? tang : [0.25, 0.12, 0.1];
      if (ttip) {
        const sol = this.thumbIK(hb, tq, ttip, inAx, oppAx);
        tinG = lerp(tinG, sol.tin, tw[0]); tangG = tangG.map((a, j) => lerp(a, sol.ang[j], tw[0]));
      }
      tin = lerp(tin, tinG, goalW); tang = tang.map((a, j) => lerp(a, tangG[j], goalW));
    }
    let p = tq[0], a = 0;
    for (let k = 0; k < 3; k++) {
      a += tang[k];
      const v = rotateAxis(rotateAxis(sub(tq[k + 1], tq[k]), inAx, tin), oppAx, a);
      const n = add(p, v);
      this.setBone(tid[k], this.skinPoint(hb, p), this.skinPoint(hb, n), this.skinDir(hb, rotateAxis(rotateAxis(palm, inAx, tin), oppAx, a)));
      p = n;
    }
  }

  /** what's asked of hand i (fingers.ts HandAsk): each fingertip's target taken into hand space by `toC`, how much it
   *  counts (the goal's weight, the finger's own coming in and going), and every number's rest — a finger with no target
   *  rests as the rig's own fingers would (the keys' curve, a grip's, a loose hand's), one with a target drawn only
   *  lightly toward a relaxed curl */
  private askHand(hi: number, c: number, grip: number, holds: boolean, goal: HandGoal, goalW: number, dt: number, toC: (w: V3, o: Float64Array, i: number) => void) {
    const Q = this.handQ[hi], tw = this.tipsW[hi];
    const CASCADE = [0, 0.04, 0.1, 0.16], REL = [-0.14, -0.02, 0.1, 0.2];
    const rc = Math.max(0, c) * (1 - grip);
    const keys = !holds && !goal.loose, K = HeroRig.keysHand, built = !!this.asset.header.hand;
    const FAN = keys ? K.fan : [0.06, 0.02, -0.03, -0.08];
    for (let f = 0; f < 5; f++) {
      const tip = goal.tips[f] ?? null;
      tw[f] = ddamp(tw[f], tip ? 1 : 0, tip ? 30 : 14, dt);
      let k = tip ? goalW * tw[f] * (goal.tipW?.[f] ?? 1) : 0, rf = tip ? 1 : 0;
      if (tip) {
        toC(tip, Q.tgt, f * 3);
        // (a target the finger can't get to from where the hand is — a flute's hole while the flute is still coming up
        // — is let go: its pull fades from the finger's length to half again past it, and the finger keeps its own
        // shape instead of straightening toward it. The palm's solve, when free, still sees where it's going)
        const M = this.handM[hi];
        if (M && !goal.palmFree) {
          const b0 = Q.tgt[f * 3] - M.base[f * 3], b1 = Q.tgt[f * 3 + 1] - M.base[f * 3 + 1], b2 = Q.tgt[f * 3 + 2] - M.base[f * 3 + 2];
          const d = Math.sqrt(b0 * b0 + b1 * b1 + b2 * b2), L = M.lens[f];
          rf = 1 - smoothstep(1.05 * L, 1.5 * L, d);
          k *= rf;
        }
      }
      Q.w[f] = k;
      const o = hpOf(f), wr = 0.3 + 0.9 * (1 - Math.min(1, k));
      Q.resting[f] = tip ? 0 : 1;
      if (f === 0) {
        // (the thumb: along the keys under the hand; round what's held; else loosely by the curl)
        // (on a key standing over the surface — a black key — the thumb reaches in flatter, as a pianist's does)
        const F = goal.floor, up = tip && F ? (tip[0] - F.at[0]) * F.n[0] + (tip[1] - F.at[1]) * F.n[1] + (tip[2] - F.at[2]) * F.n[2] : 0;
        // (an idle thumb at the keys — the Pianist asks it lightly — rests as an idle thumb, not as a playing one)
        const idle = keys && (goal.tipW?.[0] ?? 1) < 0.5;
        const rt = keys ? (idle ? K.thumbIdle : up > 0.006 ? K.thumbHigh : K.thumbTip) : [0.25, 0.1, 0.35, 0.2];
        const r0 = keys ? K.thumbIdle : holds ? (built ? [0.3 - 0.28 * grip, -0.1 - 0.25 * grip, 0.2 + 0.35 * grip, 0.1 + 0.9 * grip] : [0.3 + 0.4 * grip, 0.2 * grip, 0.2 + 0.5 * grip, 0.1 + 0.45 * grip])
          : built ? [0.25 * clamp(c, 0, 1), -0.3, 0.15 + 0.2 * c, 0.1 + 0.16 * c] : [0.25 * clamp(c, 0, 1), 0, 0.1 + 0.2 * c, 0.06 + 0.16 * c];
        // (a target let go: its rests the hand's own again, as far as it's let go)
        for (let j = 0; j < 4; j++) { Q.rest[o + j] = lerp(r0[j], rt[j], rf); Q.wr[o + j] = lerp(wr, keys ? K.wThumb : 0.6, rf); }
        continue;
      }
      const g = f - 1;
      let ab = FAN[g] * (1 - grip) * (c < 0 ? 2.5 : 1);
      let ang = [c * 0.45 + grip * (1.25 + CASCADE[g]) + REL[g] * rc * 1.1, -0.05 + c * 0.33 + grip * (1.22 + CASCADE[g]) + REL[g] * rc,
        -0.12 + c * 0.1 + grip * 0.87 + REL[g] * rc * 0.4];
      const tipAng = keys ? K.tip[g] : [0.4, 0.6, 0.42];
      // (resting over the keys: curved as real pianists' are — our hand fitted by position to tracked overhead footage
      // (World tools/hands/fit.mjs): from above the fingers lie long: the knuckle bent most (~30-50° in chords), the middle
      // joint ~20-35°, the end ~10-20°; docs/hands.md in World)
      if (keys) ang = ang.map((a, j) => lerp(a, K.idle[g][j], goalW));
      // (a built hand at ease: a real relaxed hand's fingers curve — ~20-30° at the knuckle, 30-40° in the middle, more
      // toward the little finger — where the older hands' rests were nearly straight)
      else if (built) ang = ang.map((a, j) => a + [0.35, 0.5, 0.2][j] * (1 + 0.15 * g) * (1 - grip));
      if (rf > 0) { ab = lerp(ab, FAN[g], rf); ang = ang.map((a, j) => lerp(a, tipAng[j], rf)); }
      // (coming down square on its tip, as a guitarist's or a violinist's stopping finger does: the middle joint well
      // bent, the end joint with it, drawn there firmly; the tip still lands where it's asked)
      const sq = rf > 0 ? goal.square?.[f] ?? 0 : 0;
      if (sq > 0) ang = ang.map((a, j) => lerp(a, [0.75, 1.35, 0.75][j], sq));
      // (a spread held is an effort: drawn back harder than a bend)
      Q.rest[o] = ab; Q.wr[o] = lerp(wr * 1.5, 1.2, rf);
      for (let j = 0; j < 3; j++) { Q.rest[o + 1 + j] = ang[j]; Q.wr[o + 1 + j] = rf > 0 && keys ? Math.max(wr, K.wTip) : sq > 0 ? lerp(wr, 1.5, sq) : wr; }
      // (laid flat along what it presses: its middle and end joints straight)
      const lay = goal.lay?.[f] ?? 0;
      Q.lay[f] = lay;
      if (lay > 0) for (const j of [2, 3]) { Q.rest[o + j] = lerp(Q.rest[o + j], 0, lay); Q.wr[o + j] = lerp(Q.wr[o + j], 6, lay); }
    }
    Q.rest[HP_ARCH] = 0.15; Q.wr[HP_ARCH] = 1;
    // (real pianists' hands: a prior on the whole hand's numbers; the fingers' own rests loosened under it)
    const pr = keys && built && goal.prior ? clamp(goal.prior, 0, 1) * goalW : 0;
    Q.wp = pr * K.wPrior; Q.priorMu = KEYS_PRIOR.mu; Q.priorP = KEYS_PRIOR.P;
    if (pr > 0) for (let f = 0; f < 5; f++) {
      const idle = Q.resting[f] || (f === 0 && (goal.tipW?.[0] ?? 1) < 0.5), o = hpOf(f), kk = lerp(1, idle ? K.restIdle * (f === 0 ? K.restThumb : 1) : K.restPlay, pr);
      for (let j = 0; j < 4; j++) Q.wr[o + j] *= kk;
      if (f === 4) Q.wr[HP_ARCH] *= lerp(1, K.restIdle, pr);
    }
    Q.clear = 0;
    const F = goal.floor;
    if (F && F.clear > 0) {
      // (the surface into hand space: a point on it and one a metre out along its normal)
      const a = this.fl, b = this.fl2;
      toC(F.at, a, 0); toC(add(F.at, F.n), b, 0);
      const n0 = b[0] - a[0], n1 = b[1] - a[1], n2 = b[2] - a[2], l = Math.hypot(n0, n1, n2) || 1;
      Q.floor[0] = n0 / l; Q.floor[1] = n1 / l; Q.floor[2] = n2 / l; Q.floor[3] = (n0 * a[0] + n1 * a[1] + n2 * a[2]) / l;
      Q.clear = F.clear;
    }
  }
  private fl = new Float64Array(3); private fl2 = new Float64Array(3);

  /** the palm and fingers solved together for a goal whose palm is free (HandGoal.palmFree): the goal handed back with
   *  the palm moved and turned as solved, for the arm to take (the fingers are solved again on the hand as the arm put
   *  it: chordFingers) */
  private chordPalm(i: number, side: number, T: string, goal: HandGoal, goalW: number, dt: number): HandGoal {
    goalW = q30(goalW);
    const M = this.handM[i]!, S = this.handS[i], Q = this.handQ[i];
    // (the goal's own frame: its roll is the solve's to choose now, not the arm's turn — the hand is handed back held
    // exactly as solved)
    const h = norm(goal.fwd), p = norm(rej(goal.down, h)), t = norm(scale(cross(p, h), side));
    const hl = this.len[this.bi['hand' + T]], kl = this.knuckleLen(T);
    const wrist = goal.knuckles ? sub(goal.knuckles, scale(goal.fwd, kl)) : sub(goal.palm, scale(goal.fwd, hl * 0.55));
    this.askHand(i, clamp(goal.curl ?? 0.55, -0.3, 1.2), 0, goal.grip !== undefined, goal, goalW, 0, (w, o, j) => {
      const d0 = w[0] - wrist[0], d1 = w[1] - wrist[1], d2 = w[2] - wrist[2];
      o[j] = d0 * h[0] + d1 * h[1] + d2 * h[2]; o[j + 1] = d0 * t[0] + d1 * t[1] + d2 * t[2]; o[j + 2] = d0 * p[0] + d1 * p[1] + d2 * p[2];
    });
    // (the fingers' weights came in above at this frame's rate: chordFingers steps them)
    void dt;
    Q.free = clamp(goal.palmFree ?? 0, 0, 1) * goalW;
    S.x.set(this.palmX[i], 0);
    solveHand(M, S, Q, HeroRig.handIters[0]);
    this.palmX[i].set(S.x.subarray(0, 6));
    this.palmMiss[i].set(S.miss);
    const x = S.x, a = Math.hypot(x[3], x[4], x[5]);
    const W = (c0: number, c1: number, c2: number): V3 => [h[0] * c0 + t[0] * c1 + p[0] * c2, h[1] * c0 + t[1] * c1 + p[1] * c2, h[2] * c0 + t[2] * c1 + p[2] * c2];
    const turn = (v: V3): V3 => (a < 1e-9 ? v : drotateAxis(v, [x[3] / a, x[4] / a, x[5] / a], a));
    const h2 = W(...turn([1, 0, 0])), p2 = W(...turn([0, 0, 1]));
    const w2 = add(wrist, W(x[0], x[1], x[2]));
    // (where the hand is to be, so the fingers' second solve can be skipped when the arm put it there)
    const E = this.palmAt[i]; E.set(w2, 0); E.set(h2, 3); E.set(p2, 6); E[9] = 1;
    return { ...goal, palm: add(w2, scale(h2, hl * 0.55)), knuckles: goal.knuckles ? add(w2, scale(h2, kl)) : undefined, fwd: h2, down: p2, exact: true, turn: 0 };
  }

  /** the fingers solved on the hand as the arm has put it (the palm held), and posed */
  private chordFingers(hi: number, side: number, c: number, grip: number, holds: boolean, goal: HandGoal, goalW: number, dt: number) {
    const M = this.handM[hi]!, S = this.handS[hi], Q = this.handQ[hi], m = this.bones, k = M.hb * 16;
    const wb = M.wrist, X = M.X, Y = M.Y, Z = M.Z;
    void side;
    this.askHand(hi, c, grip, holds, goal, goalW, dt, (w, o, j) => {
      // (the world point into the hand bone's bind space, then hand space)
      const e0 = w[0] - m[k + 12], e1 = w[1] - m[k + 13], e2 = w[2] - m[k + 14];
      const b0 = m[k] * e0 + m[k + 1] * e1 + m[k + 2] * e2 - wb[0], b1 = m[k + 4] * e0 + m[k + 5] * e1 + m[k + 6] * e2 - wb[1], b2 = m[k + 8] * e0 + m[k + 9] * e1 + m[k + 10] * e2 - wb[2];
      o[j] = b0 * X[0] + b1 * X[1] + b2 * X[2]; o[j + 1] = b0 * Y[0] + b1 * Y[1] + b2 * Y[2]; o[j + 2] = b0 * Z[0] + b1 * Z[1] + b2 * Z[2];
    });
    Q.free = 0;
    for (let j = 0; j < 6; j++) S.x[j] = 0;
    // (the arm put the hand where the palm's solve asked, within a tenth of a millimetre and a few hundredths of a
    // degree: the fingers as solved there stand; else solved again on the hand as it is)
    const E = this.palmAt[hi], wb2 = this.skinPoint(M.hb, M.wrist), hx = this.skinDir(M.hb, X), pz = this.skinDir(M.hb, Z);
    const there = E[9] === 1 && Math.hypot(wb2[0] - E[0], wb2[1] - E[1], wb2[2] - E[2]) < 1e-4 && hx[0] * E[3] + hx[1] * E[4] + hx[2] * E[5] > 0.9999995 && pz[0] * E[6] + pz[1] * E[7] + pz[2] * E[8] > 0.9999995;
    E[9] = 0;
    if (!there) solveHand(M, S, Q, HeroRig.handIters[1]);
    const P = new Float64Array(12), U = new Float64Array(9), K = new Float64Array(3), Zf = new Float64Array(3);
    const hp: V3 = [0, 0, 0], tp: V3 = [0, 0, 0], up: V3 = [0, 0, 0];
    for (let f = 0; f < 5; f++) {
      M.fk(S.x, f, P, U, K, Zf);
      for (let j = 0; j < 3; j++) {
        M.bindOf(P, j * 3, hp); M.bindOf(P, j * 3 + 3, tp); M.bindOf(U, j * 3, up, true);
        this.setBone(M.bones[f][j], this.skinPoint(M.hb, hp), this.skinPoint(M.hb, tp), this.skinDir(M.hb, up));
      }
      // (the ring and little metacarpals, where the body has them, turned with the palm's arch)
      if (M.mc[f] >= 0) {
        const q = this.mcq;
        M.mcPose(S.x, f, q);
        M.bindOf(q, 0, hp); M.bindOf(q, 3, tp); M.bindOf(q, 6, up, true);
        this.setBone(M.mc[f], this.skinPoint(M.hb, hp), this.skinPoint(M.hb, tp), this.skinDir(M.hb, up));
      }
    }
  }
  private mcq = new Float64Array(9);
  private static NO_TIPS: HandGoal = { palm: [0, 0, 0], fwd: [0, 0, 1], down: [0, -1, 0], tips: [null, null, null, null, null], loose: true };
  /** a built hand's fingers with nothing to reach: every number at its rest (askHand's: the curl's cascade, a grip's
   *  wrap, the keys'), within its limits, no solve; the arch with the grip (a fist's palm cups) */
  private restFingers(hi: number, c: number, grip: number, holds: boolean, goal: HandGoal | null, goalW: number, dt: number) {
    const M = this.handM[hi]!, S = this.handS[hi], Q = this.handQ[hi], x = S.x;
    this.askHand(hi, c, grip, holds, goal ?? HeroRig.NO_TIPS, goal ? goalW : 0, dt, () => { /* no targets */ });
    for (let i = 0; i < 6; i++) x[i] = 0;
    for (let i = 6; i < x.length; i++) x[i] = Math.min(M.hi[i], Math.max(M.lo[i], Q.rest[i]));
    x[HP_ARCH] = Math.min(M.hi[HP_ARCH], 0.15 + 0.5 * clamp(grip, 0, 1) + 0.15 * clamp(c, 0, 1));
    if (goal?.pose && goalW > 0.001) { const g = goal.pose; for (let i = 6; i < x.length; i++) x[i] = Math.min(M.hi[i], Math.max(M.lo[i], x[i] + (g[i] - x[i]) * goalW)); }
    else if (holds && goal?.around && goalW > 0.001) this.closeAround(hi, c, goal, goalW, dt);
    S.ready = true;
    const P = this.fkP, U = this.fkU, K = this.fkK, Zf = this.fkZ, hp: V3 = [0, 0, 0], tp: V3 = [0, 0, 0], up: V3 = [0, 0, 0];
    for (let f = 0; f < 5; f++) {
      M.fk(x, f, P, U, K, Zf);
      for (let j = 0; j < 3; j++) {
        M.bindOf(P, j * 3, hp); M.bindOf(P, j * 3 + 3, tp); M.bindOf(U, j * 3, up, true);
        this.setBone(M.bones[f][j], this.skinPoint(M.hb, hp), this.skinPoint(M.hb, tp), this.skinDir(M.hb, up));
      }
      if (M.mc[f] >= 0) {
        const q = this.mcq;
        M.mcPose(x, f, q);
        M.bindOf(q, 0, hp); M.bindOf(q, 3, tp); M.bindOf(q, 6, up, true);
        this.setBone(M.mc[f], this.skinPoint(M.hb, hp), this.skinPoint(M.hb, tp), this.skinDir(M.hb, up));
      }
    }
  }
  /** a held thing's shape into hand space (Q.floor's way): [at (3), axis (3, unit or 0), r, half-length (or -1), pad] */
  private arnd = new Float64Array(9); private xOpen = new Float64Array(HAND_N); private xOpen2 = new Float64Array(HAND_N); private fkP2 = new Float64Array(12);
  /** the fingers (built hand, holding) closed from open toward their grip's rests until each meets the held shape:
   *  per finger the share of the way from open to the grip (0..1) where its skin first touches the surface, found
   *  by stepping then halving; a finger that never touches closes all the way (the shape's smaller than the grip) */
  private closeAround(hi: number, c: number, goal: HandGoal, goalW: number, dt: number) {
    const M = this.handM[hi]!, S = this.handS[hi], Q = this.handQ[hi], x = S.x, A = goal.around!, m = this.bones, k = M.hb * 16;
    const wb = M.wrist, X = M.X, Y = M.Y, Z = M.Z, o = this.arnd;
    const toC = (w: ArrayLike<number>, dir: boolean, j: number) => {
      const e0 = w[0] - (dir ? 0 : m[k + 12]), e1 = w[1] - (dir ? 0 : m[k + 13]), e2 = w[2] - (dir ? 0 : m[k + 14]);
      const b0 = m[k] * e0 + m[k + 1] * e1 + m[k + 2] * e2 - (dir ? 0 : wb[0]), b1 = m[k + 4] * e0 + m[k + 5] * e1 + m[k + 6] * e2 - (dir ? 0 : wb[1]), b2 = m[k + 8] * e0 + m[k + 9] * e1 + m[k + 10] * e2 - (dir ? 0 : wb[2]);
      o[j] = b0 * X[0] + b1 * X[1] + b2 * X[2]; o[j + 1] = b0 * Y[0] + b1 * Y[1] + b2 * Y[2]; o[j + 2] = b0 * Z[0] + b1 * Z[1] + b2 * Z[2];
    };
    toC(A.at, false, 0); toC(A.axis, true, 3);
    const al = Math.hypot(o[3], o[4], o[5]);
    if (al > 1e-9) { o[3] /= al; o[4] /= al; o[5] /= al; } else { o[3] = 0; o[4] = 0; o[5] = 0; }
    const sc = M.width / 0.048;
    o[6] = A.r; o[7] = A.len !== undefined ? A.len / 2 : -1; o[8] = (A.pad ?? 0.0085) * sc;
    // (the open hand: flat, no grip)
    const xg = this.xOpen;
    xg.set(x);
    this.askHand(hi, -0.1, 0, true, { ...goal, grip: 0 }, goalW, 0, () => { /* no targets */ });
    const open = this.xOpen2;
    for (let i = 6; i < HAND_N; i++) open[i] = Math.min(M.hi[i], Math.max(M.lo[i], Q.rest[i]));
    // (flat: every finger's joints straight, the thumb's MCP and IP too, its saddle out of the palm)
    for (let f = 1; f <= 4; f++) for (let j = 1; j <= 3; j++) open[hpOf(f) + j] = Math.max(M.lo[hpOf(f) + j], 0);
    open[23] = Math.max(M.lo[23], -0.3); open[24] = Math.min(M.hi[24], 0.3); open[25] = 0; open[26] = 0;
    // (put back the grip's rests and weights for anything that reads them after)
    this.askHand(hi, c, goal.grip ?? 0, true, goal, goalW, 0, () => { /* no targets */ });
    void dt;
    const P = this.fkP2, U = null, K = this.fkK, Zf = this.fkZ;
    const pad = (f: number) => o[8] * (f === 0 ? 1.15 : f === 4 ? 0.85 : 1);
    // (how far point j of finger f, as x stands, is from the shape's skin, the finger's pad included: < 0 inside;
    // a point past the shape's ends is clear of it)
    const gap = (f: number, j: number) => {
      M.fk(x, f, P, U, K, Zf);
      const p0 = P[j * 3] - o[0], p1 = P[j * 3 + 1] - o[1], p2 = P[j * 3 + 2] - o[2];
      const ax = p0 * o[3] + p1 * o[4] + p2 * o[5];
      if (o[7] >= 0 && Math.abs(ax) > o[7] + pad(f)) return 1;
      return Math.sqrt(Math.max(0, p0 * p0 + p1 * p1 + p2 * p2 - ax * ax)) - (o[6] + pad(f));
    };
    // (a finger wraps round a thing as a hand does: its knuckle closes until the end of its first bone lies on the
    // surface, then its middle joint until the second's does, then its end joint — each bone a chord round the shape,
    // its pad on the skin. A joint whose bone ends clear of the shape closes all the way to the grip's rest; one that
    // starts inside stays open. The thumb's saddle swings it round until its tip meets the thing, then it wraps)
    for (let f = 0; f < 5; f++) {
      const J = f === 0 ? [[23, 24], [25], [26]] : [[hpOf(f) + 1], [hpOf(f) + 2], [hpOf(f) + 3]];
      if (f > 0) x[hpOf(f)] = xg[hpOf(f)];
      for (const g of J) for (const i of g) x[i] = open[i];
      const from = this.from;
      for (let st = 0; st < 3; st++) {
        const ids = J[st], pt = f === 0 && st === 0 ? 3 : st + 1;
        // (the chord's middle on the skin: its end a little out, by the sagitta of a bone this long round this radius)
        const L = st === 0 && f === 0 ? 0 : Math.hypot(...[0, 1, 2].map((c) => M.seg[f * 9 + st * 3 + c])), R = o[6] + pad(f);
        const sag = L > 0 && L < 2 * R ? R - Math.sqrt(R * R - L * L / 4) : 0;
        for (const i of ids) from[i] = x[i];
        // (any point of the finger past this joint: the bone's end on the surface less its sagitta, the ones past it
        // as they are — the joint stops at whatever of the finger meets the thing first)
        const at = (t: number) => { for (const i of ids) x[i] = from[i] + (xg[i] - from[i]) * t; let g = gap(f, pt) - sag; for (let q = pt + 1; q <= 3; q++) g = Math.min(g, gap(f, q)); return g; };
        if (at(0) <= 0) { at(0); continue; }
        // (stepped along its closing: the first step that reaches the surface, then halved down to it; an arc that
        // never reaches it stops where it comes nearest, if that's near — a finger reaching round past the thing, not
        // curled into the air beside it)
        let n0 = -1, bt = 1, bg = Infinity;
        for (let n = 1; n <= 16; n++) { const g = at(n / 16); if (g <= 0) { n0 = n; break; } if (g < bg) { bg = g; bt = n / 16; } }
        if (n0 < 0) { at(bg < 0.03 * sc ? bt : 1); continue; }
        let lo = (n0 - 1) / 16, hi2 = n0 / 16;
        for (let it = 0; it < 10; it++) { const mid = (lo + hi2) / 2; if (at(mid) > 0) lo = mid; else hi2 = mid; }
        at(lo);
      }
    }
  }
  private pen = new Float64Array(3); private from = new Float64Array(HAND_N);
  private fkP = new Float64Array(12); private fkU = new Float64Array(9); private fkK = new Float64Array(3); private fkZ = new Float64Array(3);

  /** a finger's spread and joint angles (bind-space, about the hand's own axes) that put its tip on a world point: the
   *  spread turns it toward the point; the curl (end joints coupled to the middle one, 2/3) is solved for the reach by
   *  bisection, then the knuckle aims the tip at it */
  private fingerIK(hb: number, q: V3[], tipW: V3, fanAx: V3, palm: V3, d: V3): { ab: number; ang: number[] } {
    // the target in the hand's bind space: invert the hand bone's skin transform
    const m = this.bones, k = hb * 16;
    const w = sub(tipW, [m[k + 12], m[k + 13], m[k + 14]]);
    const tb: V3 = [m[k] * w[0] + m[k + 1] * w[1] + m[k + 2] * w[2], m[k + 4] * w[0] + m[k + 5] * w[1] + m[k + 6] * w[2], m[k + 8] * w[0] + m[k + 9] * w[1] + m[k + 10] * w[2]];
    const base = q[0];
    const to = sub(tb, base);
    // spread: the target's angle about the fan axis from the finger's own way
    const f0 = norm(sub(q[3], q[0]));
    const side = norm(cross(fanAx, f0));
    const ab = clamp(Math.atan2(dot(to, side), Math.max(dot(to, f0), 1e-3)) * 0.85, -0.35, 0.35);
    const flexAx = norm(cross(rotateAxis(d, fanAx, ab), rotateAxis(palm, fanAx, ab)));
    const segs = [sub(q[1], q[0]), sub(q[2], q[1]), sub(q[3], q[2])].map((v) => rotateAxis(v, fanAx, ab));
    const tipAt = (a1: number, a2: number): V3 => {
      const a = [a1, a1 + a2, a1 + a2 + a2 * 0.66];
      let p: V3 = [0, 0, 0];
      for (let j = 0; j < 3; j++) p = add(p, rotateAxis(segs[j], flexAx, a[j]));
      return p;
    };
    const dist = len(to);
    let lo = -0.1, hi = 1.6;
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) / 2;
      if (len(tipAt(0, mid)) > dist) lo = mid; else hi = mid;
    }
    const a2 = (lo + hi) / 2;
    // the knuckle: turn the chain about the flex axis so the tip points at the target
    const tp = tipAt(0, a2);
    const pr = (v: V3) => rej(v, flexAx);
    const ta = pr(tp), tt = pr(to);
    const a1 = Math.atan2(dot(cross(ta, tt), flexAx), dot(ta, tt));
    return { ab, ang: [clamp(a1, -0.4, 1.5), a2, a2 * 0.66] };
  }

  /** the thumb's swing in and its curl that put its tip on a world point */
  private thumbIK(hb: number, tq: V3[], tipW: V3, inAx: V3, oppAx: V3): { tin: number; ang: number[] } {
    const m = this.bones, k = hb * 16;
    const w = sub(tipW, [m[k + 12], m[k + 13], m[k + 14]]);
    const tb: V3 = [m[k] * w[0] + m[k + 1] * w[1] + m[k + 2] * w[2], m[k + 4] * w[0] + m[k + 5] * w[1] + m[k + 6] * w[2], m[k + 8] * w[0] + m[k + 9] * w[1] + m[k + 10] * w[2]];
    const to = sub(tb, tq[0]);
    const tipOf = (tin: number, c: number): V3 => {
      let p: V3 = [0, 0, 0], a = 0;
      for (let j = 0; j < 3; j++) { a += c * [1, 0.7, 0.6][j]; p = add(p, rotateAxis(rotateAxis(sub(tq[j + 1], tq[j]), inAx, tin), oppAx, a)); }
      return p;
    };
    // a small search: the swing in and the curl that bring the tip nearest
    let best = { tin: 0.3, c: 0.2, e: Infinity };
    for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) {
      const tin = -0.1 + a * 0.12, c = -0.1 + b * 0.09;
      const e = len(sub(tipOf(tin, c), to));
      if (e < best.e) best = { tin, c, e };
    }
    return { tin: best.tin, ang: [best.c, best.c * 0.7, best.c * 0.6] };
  }

  private rigFace(dt: number, look: V3, bendK: number, mode: string) {
    const E = this.asset.header.eye;
    const head = this.bi.head;
    const eL = this.bi.eyeL, eR = this.bi.eyeR;
    // a calm half-smile; focused (brows down, lips together) while bending; a breath out on a throw
    const effort = mode === 'push' || mode === 'throw' ? 1 - smoothstep(0.2, 0.6, this.armT) : 0;
    // (freezing: the brows hard down, a squint, a frown of effort)
    const freeze = mode === 'freeze' ? 1 : 0;
    const want: FaceExpr = {
      smile: clamp(0.28 - 0.3 * bendK + 0.15 * effort, 0, 1), jaw: clamp(0.25 * effort + 0.06 * bendK - 0.12 * (1 - effort), -0.12, 0.6), pucker: 0, frown: 0.1 * freeze,
      brows: 0.2 * effort, tender: 0, browDown: 0.5 * bendK + 0.3 * freeze, squint: 0.2 * freeze, wide: 0.3 * effort, closed: 0,
    };
    const X = this.expr;
    if (X && X.k > 0) for (const k of FACE_KEYS) want[k] += ((X.face[k] ?? 0) - want[k]) * X.k;
    // the face (cast/face.ts) over the body's own: its eyes' aim in the head's axes
    const hx = norm(this.skinDir(head, [1, 0, 0])), hu = norm(this.skinDir(head, [0, 1, 0])), hf = norm(this.skinDir(head, [0, 0, 1]));
    const mid = this.skinPoint(head, [0, E.y, E.z]);
    const to = norm(lerp3(hf, norm(sub(look, mid)), 0.9));
    this.face.attend = this.asset.header.faceRig?.attend ?? 0;
    const S = this.face.update(dt, fromLegacy(want, this.fxBase), [dot(to, hx), dot(to, hu), dot(to, hf)]);
    toLegacy(S, this.fx);
    this.gaze = S.gaze;
    this.blink = S.blink;
    if (eL === undefined || eR === undefined) return;
    const g = this.gaze;
    const gUp = norm(rej([0, 1, 0], g));
    for (const [bi, sx] of [[eL, 1], [eR, -1]] as [number, number][]) {
      const c: V3 = [sx * E.x, E.y, E.z];
      this.setBone(bi, this.skinPoint(head, c), this.skinPoint(head, add(c, scale(g, E.r))), this.skinDir(head, gUp));
    }
    const F = this.fx;
    const blink = this.blink;
    const gp = Math.asin(clamp(g[1], -1, 1));
    const heavy = Math.max(0, S.lidUp);
    const lo = this.asset.header.faceRig?.lidOpen ?? 0;
    const thU0 = -gp * 0.6 + F.squint * 0.12 - F.wide * 0.22 + heavy * 0.35 - lo * 0.2, thD0 = -gp * 0.25 - F.smile * 0.1 - F.squint * 0.22 + F.wide * 0.08 + lo * 0.07;
    const thU = clamp(thU0 + (0.6 - thU0) * blink, -0.2, 0.85);
    const thD = clamp(thD0 + (-0.23 - thD0) * blink, -0.45, 0.3);
    const rx = (v: V3, th: number): V3 => [v[0], v[1] * Math.cos(th) - v[2] * Math.sin(th), v[1] * Math.sin(th) + v[2] * Math.cos(th)];
    for (const [nm, sx] of [['L', 1], ['R', -1]] as [string, number][]) {
      const c: V3 = [sx * E.x, E.y, E.z];
      const hc = this.skinPoint(head, c);
      for (const [lid, th, dy] of [['lidU', thU, 0.004], ['lidD', thD, -0.004]] as [string, number, number][]) {
        const bi = this.bi[lid + nm];
        if (bi === undefined) continue;
        this.setBone(bi, hc, this.skinPoint(head, add(c, rx([0, dy, E.r], th))), this.skinDir(head, rx([0, 1, 0], th)));
      }
    }
    // the face's bones ride the head, offset by the expression
    const ji = this.bi.jaw;
    if (ji === undefined) return;
    const s = this.s;
    const hinge = this.B[ji].head;
    const modelled = this.asset.header.faceRig ?? null;
    const ang = (modelled ? modelled.jaw ?? JAW_OPEN_MODELLED : JAW_OPEN) * F.jaw;
    const turn = (p: V3, a: number): V3 => { const dy = p[1] - hinge[1], dz = p[2] - hinge[2], c = Math.cos(a), sn = Math.sin(a); return [p[0], hinge[1] + dy * c - dz * sn, hinge[2] + dy * sn + dz * c]; };
    const turnD = (dd: V3, a: number): V3 => [dd[0], dd[1] * Math.cos(a) - dd[2] * Math.sin(a), dd[1] * Math.sin(a) + dd[2] * Math.cos(a)];
    for (const name of FACE_RIG) {
      const bi = this.bi[name];
      if (bi === undefined) continue;
      const b = this.B[bi];
      if (name === 'jaw') { this.setBone(bi, this.skinPoint(head, b.head), this.skinPoint(head, turn(b.tail, ang)), this.skinDir(head, turnD(b.up, ang))); continue; }
      const side = name.endsWith('L') ? 1 : name.endsWith('R') ? -1 : 0;
      const kind = name.startsWith('lipU') ? (side ? 'lipUS' : 'lipU') : name.startsWith('lipD') ? (side ? 'lipDS' : 'lipD') : name.replace(/[LR]$/, '');
      const P = FACE_POSE[kind];
      const o: V3 = [0, 0, 0];
      const Mk = modelled ? MODELLED[kind] : undefined;
      if (Mk) {
        const g = modelled!.gain ?? 1;
        const want = { smile: S.smile, frown: S.frown, spread: S.spread, round: S.round, press: S.press, tuck: S.tuck, teeth: S.teeth, open: S.open, smirk: 0 };
        // (a smirk: one corner up)
        const sm = side ? Math.max(0, S.smirk * side) : 0;
        want.smile = Math.min(1.2, want.smile + sm);
        for (const key in Mk) {
          const vv = Mk[key as keyof typeof Mk]!;
          const w = want[key as keyof typeof want] * (modelled!.shapes?.[key] ?? 1);
          o[0] += (side || 1) * vv[0] * w * s * g; o[1] += vv[1] * w * s * g; o[2] += vv[2] * w * s * g;
        }
      } else if (kind === 'browIn' || kind === 'browOut') {
        // (each brow's end by its own side: up, down, drawn in)
        const v = kind === 'browIn' ? (side > 0 ? S.browInL : S.browInR) : side > 0 ? S.browOutL : S.browOutR;
        const bg = modelled ? 1.6 * (modelled.gain ?? 1) : 1;
        o[0] = side * -0.0015 * S.knit * (kind === 'browIn' ? 1 : 0.3) * s * bg; o[1] = (0.0035 * v - 0.0012 * S.knit) * s * bg; o[2] = 0.0004 * Math.abs(v) * s * bg;
      } else for (const key in P) {
        const vv = P[key as keyof FaceExpr]!;
        const w = F[key as keyof FaceExpr];
        o[0] += (side || 1) * vv[0] * w * s; o[1] += vv[1] * w * s; o[2] += vv[2] * w * s;
      }
      const a = name.startsWith('lipD') ? ang : name.startsWith('mouth') ? ang * 0.5 : 0;
      const hh = turn(add(b.head, o), a);
      this.setBone(bi, this.skinPoint(head, hh), this.skinPoint(head, add(hh, turnD(sub(b.tail, b.head), a))), this.skinDir(head, turnD(b.up, a)));
    }
  }

  private rigChains(dt: number, I: RigInput, disp: V3, mk: number) {
    if (!this.chains.length) return;
    const s = this.s;
    // flying / swimming, the chains ride along with her body and the air or water streaming past pushes them back
    // (fluttering at speed); under water they're buoyant and slow, at the surface the hair floats on it
    const air = this.flyW, wet = Math.min(1, this.surfW + this.subW);
    let wind: V3 = add(I.wind, scale(I.vel, -(1.7 * air + 0.9 * wet)));
    const wl = len(wind);
    if (wl > 45) wind = scale(wind, 45 / wl);
    const t = I.time;
    // (on the ground the breeze comes and goes in slow gusts, its way wandering a little)
    const gust = (1 - air) * (1 - wet) * (0.55 + 0.35 * Math.sin(t * 0.37) + 0.2 * Math.sin(t * 0.83 + 1.3));
    const wa = 0.35 * Math.sin(t * 0.21 + 0.4), cwa = Math.cos(wa), swa = Math.sin(wa), gk = 1 - air;
    const gwv: V3 = [(wind[0] * cwa - wind[2] * swa) * gust * 1.6, wind[1], (wind[2] * cwa + wind[0] * swa) * gust * 1.6];
    wind = lerp3(wind, gwv, gk);
    // (no fast flutter at speed: the cloth's own motion is slowed and its billow given below, in grace)
    wind = add(wind, [Math.sin(t * 0.7) * 0.3 * wet, Math.sin(t * 0.5) * 0.2 * wet, Math.cos(t * 0.6) * 0.3 * wet]);
    const shift = scale(disp, mk);
    const j = (i: number) => this.skinPoint(i, this.B[i].head);
    const headC = add(this.skinPoint(this.bi.head, this.B[this.bi.head].head), [0, 0.09 * s, 0]);
    const neck = j(this.bi.neck), chest = j(this.bi.chest), pel = j(this.bi.pelvis);
    const cz = norm(this.skinDir(this.bi.chest, [0, 0, 1])), cx = norm(this.skinDir(this.bi.chest, [1, 0, 0]));
    const caps: Capsule[] = [
      { a: headC, b: add(headC, [0, 0.05 * s, 0]), r: 0.1 * s },
      { a: add(neck, scale(cz, -0.01 * s)), b: add(chest, scale(cz, -0.01 * s)), r: 0.1 * s },
      { a: chest, b: pel, r: 0.12 * s },
      // (the legs: thick enough that the tunic's panels clear them whole — a knee coming forward pushes the cloth)
      { a: j(this.bi.thighL), b: j(this.bi.shinL), r: 0.125 * s }, { a: j(this.bi.thighR), b: j(this.bi.shinR), r: 0.125 * s },
      { a: j(this.bi.shinL), b: j(this.bi.footL), r: 0.1 * s }, { a: j(this.bi.shinR), b: j(this.bi.footR), r: 0.1 * s },
    ];
    // (a fixed rate — three steps a frame at 60 fps — drawn between the last two steps)
    const H = 1 / 180;
    this.chainAcc = Math.min(this.chainAcc + dt, 0.1);
    const n = Math.floor(this.chainAcc / H + 1e-6);
    this.chainAcc -= n * H;
    const f = this.chainAcc / H;
    // (the body's pose — where the cloth hangs from, the legs it clears — moved through the steps from the last frame's
    // to this one's, not jumped there at the first: a leg a frame carries 15 cm into the cloth threw it about)
    const fresh = this.first || !this.lastCaps;
    const last = fresh ? caps : this.lastCaps!.map((c) => ({ a: add(c.a, shift), b: add(c.b, shift), r: c.r }));
    const capsAt = (u: number) => caps.map((c, i) => ({ a: lerp3(last[i].a, c.a, u), b: lerp3(last[i].b, c.b, u), r: c.r }));
    const stepCaps = Array.from({ length: n }, (_, k) => capsAt((k + 1) / n));
    this.lastCaps = caps;
    for (const c of this.chains) {
      const tg = c.hips ? c.bind.map((p) => hang(this.asset, this.bones, p)) : c.bind.map((p) => this.skinPoint(c.parent, p));
      const reseat = this.first || !c.prev;
      if (this.first || !c.prev) { c.ch.reset(tg); c.prev = c.ch.p.map((q) => [...q] as V3); c.last = tg; }
      else if (mk > 0.001) { c.ch.shift(shift); for (let i = 0; i < c.prev.length; i++) c.prev[i] = add(c.prev[i], shift); }
      const from = fresh || !c.last ? tg : c.last.map((q) => add(q, shift));
      c.last = tg;
      // (posed upside down — a fold, down dog — the cloth and the hair hang as they fall, not as they hang standing: its
      // pull toward its rest shape let go, its swing let out past its usual cone)
      const up = this.skinDir(c.parent, [0, 1, 0]), ul = len(up) || 1;
      c.drape = this.posedW * smoothstep(0.55, 1.5, Math.acos(clamp(up[1] / ul, -1, 1)));
      const hold = c.hips ? HOLD * this.hangK : 0;
      const pull = c.pull.map((p, i) => 1 - Math.pow(1 - (i === 0 ? p : Math.max(p * (1 - 0.88 * c.drape!), hold)), H * 60));
      const hair = c.parent === this.bi.head, braid = /braid/i.test(c.name);
      const uw = hair ? this.subW : Math.min(1, this.subW + this.surfW);
      const surf = hair && I.waterLevel != null && this.surfW > 0.5 ? I.waterLevel - 0.02 : -Infinity;
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < c.prev.length; i++) c.prev[i] = [...c.ch.p[i]] as V3;
        const u = (k + 1) / n, tk = tg.map((q, i) => lerp3(from[i], q, u));
        c.ch.step(H, tk, pull, wind, hair ? stepCaps[k].slice(1) : stepCaps[k].slice(3), I.ground, lerp(c.grav, -0.8, uw), 1 + 3.5 * uw, surf);
        // (the braid kept behind her back, within her shoulders' width: swung round her side as she turns to sit, it
        // would come to rest in front of her and through her chest, the capsules being slimmer than her)
        if (braid) for (let i = 1; i < c.ch.p.length; i++) {
          const q = c.ch.p[i], d = sub(q, chest), fz = dot(d, cz) + 0.04 * s;
          if (fz > 0 && Math.abs(dot(d, cx)) < 0.2 * s && d[1] < 0.12 * s && d[1] > -0.5 * s) { q[0] -= cz[0] * fz; q[1] -= cz[1] * fz; q[2] -= cz[2] * fz; }
        }
      }
      let P = c.ch.p.map((q, i) => lerp3(c.prev![i], q, f));
      const r0 = sub(tg[0], P[0]);
      for (let i = 0; i < P.length; i++) P[i] = add(P[i], r0);
      if (!/loop/i.test(c.name)) P = this.grace(c, P, tg, dt, wind, caps, hair);
      const bz = this.skinDir(c.parent, [0, 0, 1]);
      for (let i = 0; i < P.length - 1; i++) {
        const r = norm(sub(tg[i + 1], tg[i])), z = norm(sub(P[i + 1], P[i]));
        let upv = norm(rej(bz, r));
        const ax = cross(r, z), sa = len(ax);
        if (sa > 1e-6) upv = rotateAxis(upv, scale(ax, 1 / sa), Math.atan2(sa, dot(r, z)));
        this.setBone(c.b0 + i, P[i], P[i + 1], carryUp(c.roll, i, z, upv, reseat, dt));
      }
    }
  }

  /** the cloth's look, one for every way she moves (walking, running, riding, flying, gliding, swimming, sitting, the
   *  bending): its chain as the physics left it, taken as each segment's swing from where it hangs at rest, and that
   *  swing followed slowly (a critically damped spring of about a second: no fast flapping, a leg's kick or a gust
   *  eased in and out), held within a cone (wide on foot, narrow at speed in the air: she keeps her form), with a slow
   *  billow over it (a few degrees, about 2.6 s round, rippling down the chain, more in wind or at speed). Each
   *  segment keeps its length (at most a tenth longer in the fastest flight), and what's left is kept out of her legs
   *  and body */
  private grace(c: PhysChain, P: V3[], tg: V3[], dt: number, wind: V3, caps: Capsule[], hair: boolean): V3[] {
    const n = P.length, air = this.flyW, speed = this.graceSpeed;
    const W = c.swing ??= Array.from({ length: n - 1 }, () => [0, 0, 0] as V3);
    const Wv = c.swingV ??= Array.from({ length: n - 1 }, () => [0, 0, 0] as V3);
    const reset = this.first;
    const maxA = lerp(lerp(hair ? 1.3 : 1.0, hair ? 0.6 : 0.42, air), 3.0, c.drape ?? 0);
    const wv = len(wind), wdir: V3 = wv > 1e-4 ? scale(wind, 1 / wv) : [0, 0, 0];
    const billow = Math.min(0.09, 0.025 + 0.0012 * wv + 0.00015 * speed);
    const stretch = 1 + 0.1 * air * Math.min(1, speed / 300);
    const tt = this.graceT;
    // (the swing followed in the parent bone's own axes: her turning carries the cloth round with her)
    const X = norm(this.skinDir(c.parent, [1, 0, 0])), Y = norm(this.skinDir(c.parent, [0, 1, 0])), Z = norm(this.skinDir(c.parent, [0, 0, 1]));
    const toL = (v: V3): V3 => [dot(v, X), dot(v, Y), dot(v, Z)];
    const toW = (v: V3): V3 => add(add(scale(X, v[0]), scale(Y, v[1])), scale(Z, v[2]));
    const Q: V3[] = [tg[0]];
    for (let i = 0; i < n - 1; i++) {
      const rd = norm(sub(tg[i + 1], tg[i])), pd = norm(sub(P[i + 1], P[i]));
      // the physics' swing as a rotation vector, held in its cone
      const ax = cross(rd, pd), sa = len(ax);
      let a = Math.atan2(sa, dot(rd, pd));
      a = Math.min(a, maxA);
      const w: V3 = sa > 1e-6 ? scale(ax, a / sa) : [0, 0, 0];
      // the billow: about the axis across the wind (or her side), slow, a little later down the chain
      const bax = norm(len(cross(rd, wdir)) > 0.2 ? cross(rd, wdir) : this.skinDir(c.parent, [1, 0, 0]));
      const b = billow * Math.sin(tt * (2 * Math.PI / 2.6) - i * 0.7 + c.b0);
      const goal = toL(add(w, scale(bax, b)));
      for (let k = 0; k < 3; k++) {
        if (reset) { W[i][k] = goal[k]; Wv[i][k] = 0; }
        else [W[i][k], Wv[i][k]] = cdSpring(W[i][k], Wv[i][k], goal[k], hair ? 4.2 : 3.4, dt);
      }
      const ww = toW(W[i]), wl = len(ww);
      const d = wl > 1e-6 ? rotateAxis(rd, scale(ww, 1 / wl), Math.min(wl, maxA + 0.1)) : rd;
      Q.push(add(Q[i], scale(d, len(sub(tg[i + 1], tg[i])) * stretch)));
    }
    // (out of her legs and body, then each segment its length again)
    const body = hair ? caps.slice(1) : caps.slice(2);
    for (let i = 1; i < n; i++) {
      for (const cp of body) capPush(Q[i], cp);
      const L = len(sub(tg[i], tg[i - 1])) * stretch, dd = sub(Q[i], Q[i - 1]), l = len(dd) || 1;
      Q[i] = add(Q[i - 1], scale(dd, L / l));
    }
    return Q;
  }
}
