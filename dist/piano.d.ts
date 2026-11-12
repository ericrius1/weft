import { type V3 } from './math.js';
import type { SeatPose } from './rig.js';
/** a piece's notes on its own clock (s): each struck at t0, let go at t1 (Boulder's audio/score.ts) */
export interface ScoreNote {
    note: number;
    t0: number;
    t1: number;
    vel: number;
    voice?: string;
}
export interface Score {
    notes: ScoreNote[];
    pedal: {
        t: number;
        down: boolean;
    }[];
    duration: number;
}
/** what pianoPlayable reads of a piano's model (Boulder's interior/piano.ts PianoModel): its axes, the way it faces,
 *  the bench's top, the keyboard's middle, the sustain pedal's top, the point a note's key is touched at, where the
 *  player looks */
export interface PianoGeometry {
    axes: {
        along: V3;
        toward: V3;
        up: V3;
    };
    facing: V3;
    seat: V3;
    keyboard: V3;
    pedalTop: V3;
    look: V3;
    touch(note: number): V3 | null;
}
/** what it reads of the piano's sound (Boulder's audio/piano.ts GrandPiano): each key's state from A0, the pedal */
export interface PianoSound {
    state: ArrayLike<number>;
    pedalState: {
        sustain: boolean;
    };
}
export interface Playable {
    readonly name: string;
    /** where she sits: the pelvis on the seat, the way she faces (yaw), where her feet rest (left, right) */
    seat: {
        pelvis: V3;
        yaw: number;
        feet: [V3, V3];
    };
    /** where she stands before sitting down (on the floor beside the seat) */
    stand: V3;
    /** where she may step to on getting up (on the floor, clear of the seat and the instrument), the likelier first */
    leave: V3[];
    /** the point a fingertip presses for a note (at rest), the way a press goes, how deep */
    notePoint(note: number): V3 | null;
    pressDir: V3;
    pressDepth: number;
    /** what's sounding: per note from `low` (0..1) */
    state: ArrayLike<number>;
    low: number;
    high: number;
    /** the instrument's axes: along its keys (low to high), toward the player, up */
    axes: {
        along: V3;
        toward: V3;
        up: V3;
    };
    /** where she looks */
    look: V3;
    /** the sustain pedal under her right foot: how far it's down */
    pedal?: () => number;
}
/** the grand piano as a Playable: the bench, the keys' tops, the sounding notes, the sustain pedal */
export declare function pianoPlayable(m: PianoGeometry, piano: PianoSound): Playable;
/** a scored note as a clocked pianist plays it: its hand (0 left) and finger (0 thumb .. 4 pinky), its key's place
 *  along the keyboard, its stroke's landing (t0, the note's second), and when the finger lets it go (`up`: its hold,
 *  cut short to lift before that finger's next stroke) */
export interface Struck {
    note: number;
    t0: number;
    t1: number;
    hand: 0 | 1;
    finger: number;
    x: number;
    up: number;
}
export declare class Pianist {
    inst: Playable | null;
    /** how far she's sat down (0..1), and whether she's on her way to the seat or getting up */
    w: number;
    state: 'idle' | 'approach' | 'seated' | 'leaving';
    /** a piece she plays by herself: the score, its clock, what's been struck */
    private score;
    private scoreT;
    private scoreNext;
    /** the score's notes struck and not yet let go: when (on the score's clock) */
    private offs;
    private pedalNext;
    private hands;
    private tipDown;
    private approachFrom;
    private approachYaw;
    private t;
    /** how freely she could walk off from a spot (the more ways open round it, the higher; 0 inside something): set by
     *  whoever knows the walls and the furniture */
    freedom: ((p: V3) => number) | null;
    /** the way with the longest clear walk from a spot, near a preferred yaw (katara.ts asks the house's collider) */
    openHeading: ((p: V3, prefer: number) => number) | null;
    /** getting up: from where she was to where she steps, the way she faces, and how far she's gone (0..1) */
    private leaveFrom;
    private leaveTo;
    private leaveYaw;
    /** getting up: the way she turns to as she steps out (the clearest from where she lands) */
    private leaveOut;
    private out;
    /** where the palm sits from the press line: toward her, and up (m) */
    reach: [number, number];
    /** the palm's place for a hand of this length (wrist to the middle fingertip, m): the knuckles a curved finger's
     *  reach in front of where the fingertips press and a little over the keys, as real players' hands sit (fits of our
     *  hand to tracked footage of pianists, World's tools/hands/fit.mjs: from above the fingers lie long, the knuckles
     *  well back from the black keys) — for a built hand (HeroHeader.hand); bodies without one keep the default */
    forHand(len: number): this;
    /** how far over the white keys' tops a finger with nothing to play is held clear (m: the hand's solve's floor). A built
     *  hand's (forHand) 18 mm: its idle fingers lie long as levers now, and at 6 mm their tips sank into the black keys'
     *  fronts, so from above they read as stubs; side clips of pianists: idle tips 23 mm over the hand's lowest (median),
     *  World tools/hands/idlejoints.mjs, Checkpoint J */
    idleClear: number;
    /** how high a finger with nothing to play rides over the white keys' tops (m; real players' idle fingers stay low,
     *  within about a centimetre of the keys, and move with their neighbours) */
    idleHover: number;
    /** a finger let go eases to an idle finger's weight as it comes up (a built hand's: forHand); else it's held to its
     *  idle place at a playing finger's weight until its next stroke (the older bodies' behaviour) */
    idleRelease: boolean;
    /** how much real pianists' hands shape the hand's posture (HandGoal.prior: a built hand's, 1; else 0) */
    prior: number;
    /** each idle finger's place over its neighbours' (m, thumb first, added to idleHover): real players' idle thumbs and
     *  little fingers ride highest, the ring lowest (side views of pianists: idle tips over the hand's lowest, medians
     *  thumb 38, index 27, middle 20, ring 13, little 27 mm) */
    idleLift: number[];
    /** how high a finger waits over its next key before it falls (m) */
    hover: number;
    /** how much further in (toward the fallboard) each finger plays a white key than the press line (m, thumb first):
     *  the long fingers reach further in than the thumb, so they needn't curl under to land on its line (real players'
     *  fingers lie long across the keys: World tools/hands/planstats.mjs) */
    fingerIn: number[];
    /** how much further along a black key a built hand's long fingers land than its short ones, at most (m; forHand) */
    blackIn: number;
    /** how much an idle finger's place over the keys counts against its own relaxed shape (a share of a playing
     *  finger's): low, and an idle finger rests as the hand holds it rather than being dragged into a hook */
    idleW: number;
    /** the hand's way from the wrist to the knuckles, up from level (as a slope: -0.18, a little down, the default; a
     *  built hand's rises, the knuckles over the wrist as a pianist's arched hand is) */
    pitch: number;
    /** the widest a hand holds at once, thumb to pinky along the keys (m: about a seventh; past it the older notes ring on
     *  under the pedal: the fingers' stretch, not the hand's size, is the limit — scored) */
    span: number;
    /** how far each hand may tilt about its own way to ease the arm (rad; hero/rig.ts HandGoal.turn) */
    turn: number;
    /** when each note's key went down (or it first came up in the score's look-ahead): the newest are the hand's */
    private onAt;
    /** each hand's correction (closed loop: what its pressing fingertips missed by, fed back into where the hand sits) */
    private fix;
    /** the fingertip targets planned this frame, per hand (thumb .. pinky), and the palms */
    planned: (V3 | null)[][];
    palms: V3[];
    /** play a note (the score's), and release it */
    noteOn: ((note: number, vel: number) => void) | null;
    noteOff: ((note: number) => void) | null;
    pedalSet: ((down: boolean) => void) | null;
    /** on a clock (playScore's `clock`): the piece as planned — every note's stroke; any note that had to be simplified
     *  (said, never dropped); which fingers have a key to play this frame (only these steer the palm) */
    struck: Struck[];
    simplified: string[];
    active: boolean[][];
    private clock;
    private byFinger;
    private path;
    sit(inst: Playable, from: V3, yaw: number): void;
    stand(): void;
    /** where to step on getting up: the first of the instrument's spots with room enough round it, else the most open
     *  of them, or back where she came from (through the seat) only if that's more open still by a way */
    private away;
    /** let her play a piece by herself: by default its times from now, on the frames' dt; with `clock` (the score's second
     *  now: an audio transport's, a film's), planned whole and posed from the clock (sit() first: it needs the keys) */
    playScore(score: Score, o?: {
        clock?: () => number;
    }): void;
    stopScore(): void;
    get playingScore(): boolean;
    /** the keyboard's middle, as a coordinate along it */
    private centre;
    /** getting up, the way she'll face once out (null otherwise) */
    get rising(): number | null;
    /** her root while sitting down or getting up (null: she's free), her facing */
    body(): {
        pos: V3;
        yaw: number;
    } | null;
    /** this frame: the score's notes, the sit's weight, and the pose (null when she's not at an instrument) */
    update(dt: number, audioNow: number): SeatPose | null;
    private stepScore;
    /** the fingertips as the rig put them (per hand, thumb .. pinky): what the pressing ones missed by moves the hand */
    feedback(actual: (V3 | null)[][], dt: number): void;
    /** the notes the hands are to play now: what's sounding, and with a score what's coming within a beat; each with when
     *  it came (`at`: the coming ones count as newest) */
    private targets;
    /** what one hand holds: the newest of its notes that fit its span (older ones held longer than a hand can stretch
     *  — the bass note under the chord, a melody note left ringing — sound on under the pedal, the fingers gone on) */
    private holdable;
    /** the hands' goals: each hand's place over the keys and each finger's tip */
    private plan;
    private along;
    /** a key that stands over the others (a black key: its touch point higher than middle C's) */
    private black;
    /** the whole piece planned: hands, fingers, strokes, each hand's places */
    private planScore;
    /** a hand's centre at second s: eased from one place to the next, arriving TRAVEL_END before the note it's for */
    private handAt;
    /** a finger's stroke at second s: its note (null: resting) and its tip's height over the key's top (m) */
    private stroke;
    /** the hands' goals at the clock's second s */
    private planAt;
}
/** (Boulder's name for it) */
export { Pianist as Performer };
//# sourceMappingURL=piano.d.ts.map