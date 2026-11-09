import { type V3 } from './math.js';
import type { Groove, HandGoal, HeroRig } from './rig.js';
/** a note a player plays: its onset (s, on the music's clock), its length (s), its pitch (MIDI), its velocity (0..1) */
export interface NoteEv {
    t: number;
    dur: number;
    note: number;
    vel: number;
}
export interface NotesNow {
    /** sounding now as the hands see it: a finger's down `early` s before its onset and up a moment before its end (held
     *  at least 60 ms) */
    active: NoteEv[];
    /** the latest onset (up to 20 ms ahead: a hand arrives as its sound does) */
    last: NoteEv | null;
    /** the note struck last and the one coming next (a chord struck at once: its top note), for travel() */
    prev: NoteEv | null;
    next: NoteEv | null;
}
/** a player's notes at `now` (Aether's Performer.notes and HoloSynthesist's prev / next) */
export declare function notesAt(evs: readonly NoteEv[], now: number, early?: number): NotesNow;
/** how much a player is playing (a glow, a lean into it): rising with each note by its velocity, falling between */
export declare class Heat {
    v: number;
    /** `active` how many notes sound, `last` the latest onset */
    update(dt: number, active: number, last: NoteEv | null, now: number): number;
}
/** the beat's pulse: a kick on each beat dying away (0..1), weaker when the player isn't playing */
export declare function beatPulse(beat: number, playing?: boolean): number;
export interface BeatFeel {
    /** how much the body moves with it (1: Aether's band) and how much the head nods */
    amt?: number;
    nod?: number;
    /** playing (else the pulse is a third as strong) */
    playing?: boolean;
    /** a player's own phase for the slow sway (Aether: its id's length) */
    seed?: number;
}
/** the beat in a player's body as a HeroRig groove (RigInput.groove): the spine leaning with the beat and rocking into
 *  each, a slow sway of the chest to the side, a nod on the beat (Aether's Performer.groove, in the rig's terms) */
export declare function beatGroove(beat: number, time: number, f?: BeatFeel, out?: Groove): Groove;
/** now and then a glance at someone (the conductor, the audience), else at the instrument: how far the look goes from
 *  the instrument toward them (0..1; Aether's Performer.gaze). `seed` a player's own phase */
export declare function glance(time: number, seed?: number, toward?: number): number;
/** a keyboard's sounding notes shared between two hands (MIDI, any order): split at the widest gap when it's more than
 *  `gap` semitones (two hands), else all to one, the left if they're low (under `middle`) — [left, right], each low to
 *  high (Aether's keyboardist) */
export declare function splitHands(notes: readonly number[], gap?: number, middle?: number): [number[], number[]];
/** which of a hand's fingers takes each of its notes (low to high), thumb inward: `fingers` 4 (thumb .. ring: Aether's
 *  animals) or 5; `side` -1 the left hand (its thumb toward the high notes), 1 the right. More notes than fingers: the
 *  lowest two and the highest kept. Returns per finger (thumb first) the note it plays, or null */
export declare function fingersFor(notes: readonly number[], side: 1 | -1, fingers?: 4 | 5): (number | null)[];
/** a note on a bowed or fretted instrument: the string it's played on (the highest open string at or under it; the
 *  note brought into range by octaves, at most `top` semitones over the top string), and how far above that string
 *  it is (Aether's violinist; `open` low to high, MIDI: a violin's G3 D4 A4 E5 is [55, 62, 69, 76]) */
export declare function stringFor(note: number, open: readonly number[], top?: number): {
    str: number;
    semi: number;
    note: number;
};
/** where a stop is along its string from the nut (0) toward the bridge (1), `semi` semitones above the open string */
export declare const stopAt: (semi: number) => number;
/** high on the top string the hand shifts up the neck: the position's shift (semitones) for a stop */
export declare const shiftFor: (semi: number) => number;
/** which finger stops `semi` with the hand shifted by `shift` (0 the open string; then the first, second and third) */
export declare const fingerFor: (semi: number, shift?: number) => 0 | 1 | 2 | 3;
/** a singing stopped note's vibrato (m along the string, at scale 1): only after it's sounded `delay` s */
export declare const vibrato: (time: number, since: number, width?: number, hz?: number, delay?: number) => number;
/** a bow that travels at a speed, not by the note (Aether's violinist): a long note (or one with the bow nearly out of
 *  hair that way) starts a new stroke the other way, its speed set to spend a good length of hair over the note; quick
 *  notes are slurred on in the same stroke. The hair stays between `u0` (a little out from the frog: the hand never at
 *  the face) and `u1` (near the tip), easing through each change of way; it lifts off the string between phrases */
export declare class Bow {
    readonly u0: number;
    readonly u1: number;
    readonly long: number;
    /** how far along the hair it's touching the string (0 at the frog, 1 at the tip), which way it's going, its speed */
    u: number;
    dir: number;
    v: number;
    speed: number;
    /** off the string (0 on it .. 1 lifted) */
    lift: number;
    private lastOnset;
    constructor(u0?: number, u1?: number, long?: number);
    /** `last` the latest onset, `singing` whether a note sounds */
    update(dt: number, now: number, last: NoteEv | null, singing: boolean): this;
}
/** a strumming hand on the eighths (Aether's guitarist): its sweep across the strings (signed, × its amplitude) and how
 *  far down-stroke it is; `amp` eased by the caller (louder, wider) */
export declare const strum: (beat: number, amp: number) => number;
/** the chord a fretting hand goes to: the next one a little before the bar's end (`lead`, a share of a bar of `beats`) */
export declare const chordAt: (beat: number, chord: number, next: number, beats?: number, lead?: number) => number;
/** a finger (or a mallet's head) going from where the last note was played (`A`, at `tA`) to where the next is (`B`,
 *  at `tB`): it leaves, swings back off the surface (`back`, a unit way out of it) by up to `arc`, and lands on time;
 *  then strikes through (`press`, 0..1: quickly in, a little after, and out). Nothing coming within `horizon` s, it
 *  hovers `hover` off A (Aether's holo-synthesist) */
export declare function travel(A: V3, B: V3 | null, tA: number | null, tB: number | null, now: number, back: V3, o?: {
    arc?: number;
    hover?: number;
    horizon?: number;
    strike?: number;
}): {
    at: V3;
    press: number;
};
export interface SprungFingersOpts {
    /** how high each finger hovers lifted (m, at scale 1): its count is the fingers' */
    hover: readonly number[];
    /** each finger's own lateness behind a change (s: fingers never move as one, a roll of 10-30 ms) */
    late?: readonly number[];
    /** how far a down finger's pad presses on past the surface (m: the flesh flattening), and how far it can go */
    seal?: number;
    floor?: number;
    /** a press: quick and a little under-damped (it lands, the pad squashes and settles); a lift: slower, eased */
    press?: {
        hz: number;
        zeta: number;
    };
    lift?: {
        hz: number;
        zeta: number;
    };
    /** how early a finger starts down for the next note when it's known (s: its pad lands as the note sounds), and how
     *  early one that will lift lets go */
    pressLead?: number;
    liftLead?: number;
}
/** Drake's flute's six (holes 1-6: the top hand's index, middle, ring, then the bottom's) */
export declare const FLUTE_FINGERS: SprungFingersOpts;
/** each finger's lift over its hole or key (m; below 0, its pad pressed into it): sprung, not eased — each finger its
 *  own little delay, a press landing quickly with a little squash, a lift a touch slower; the next fingering, when it's
 *  known (a melody playing by itself), anticipated so the fingers arrive as it sounds; lifted fingers hovering a natural
 *  height with a little life of their own; in a breath the down ones ease their weight (Drake's flute, src/flute/hold.ts
 *  Fingers, for any count of fingers) */
export declare class SprungFingers {
    readonly n: number;
    readonly lift: number[];
    /** each finger's velocity (m/s) */
    readonly vel: number[];
    /** how much each finger is pressing now (0..1.5: its pad's weight) — for the hand's own small give */
    readonly press: number[];
    private want;
    private seen;
    private seenAt;
    private t;
    private o;
    constructor(o: SprungFingersOpts);
    /** `down` the fingering sounding now (1 / true a finger down); `next` the one coming (if known) in `tNext` s;
     *  `breath` 0..1 between phrases (the down fingers ease off); `up` how far they're lifted at most (0..1) */
    update(down: ArrayLike<number | boolean>, dt: number, next?: ArrayLike<number | boolean> | null, tNext?: number, breath?: number, up?: number): void;
}
export interface Finger3Opts {
    /** each number's range (the knuckle's bend, the two outer joints', the spread: rad) */
    lo: readonly [number, number, number];
    hi: readonly [number, number, number];
    /** the relaxed curl it's drawn toward (knuckle, outer) */
    relax?: readonly [number, number];
    /** the body's scale (the tolerances and damping are a hand's at 1) */
    scale?: number;
}
/** a finger's ranges (Aether's): the thumb's, and the others' */
export declare const THUMB3: Finger3Opts;
export declare const FINGER3: Finger3Opts;
/** a fingertip onto `target`: its three numbers (x: the knuckle's bend, the outer joints', the spread) solved by damped
 *  least squares from last frame's answer, held to what a finger can do and drawn a little toward a relaxed curl; if
 *  that's stuck at its limits, tried again from the relaxed curl and the better kept (Aether's Performer.reachFinger,
 *  after Boulder's fiddler). `tip(x)` poses the finger at x and says where its tip is then. `x` is updated in place;
 *  returns the miss (m) */
export declare function reachFinger3(tip: (x: readonly [number, number, number]) => V3, target: V3, x: [number, number, number], o?: Finger3Opts): number;
/** A x = b for a 3x3 (Cramer's rule; [0, 0, 0] when it's singular) */
export declare function solve3(A: number[][], b: number[]): number[];
/** between two hand goals (k 0..1): the palm, its ways, the curl and grip; the fingertips' targets from the nearer
 *  (Drake's flute: from the belt to the lips and back) */
export declare function mixGoal(a: HandGoal | null, b: HandGoal, k: number): HandGoal;
/** a body's hand measures (bind space; the lengths hold posed): the hand bone's length, and from the wrist to the
 *  knuckles (the middle finger's first bone) */
export interface HandSize {
    hl: number;
    kl: number;
}
export declare function handSize(rig: HeroRig, T: 'L' | 'R'): HandSize;
//# sourceMappingURL=perform.d.ts.map