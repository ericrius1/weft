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
    sit(inst: Playable, from: V3, yaw: number): void;
    stand(): void;
    /** where to step on getting up: the first of the instrument's spots with room enough round it, else the most open
     *  of them, or back where she came from (through the seat) only if that's more open still by a way */
    private away;
    /** let her play a piece by herself (the score's times from now) */
    playScore(score: Score): void;
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
}
/** (Boulder's name for it) */
export { Pianist as Performer };
//# sourceMappingURL=piano.d.ts.map