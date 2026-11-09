import type { V3 } from './math.js';
import { type Timeline } from './speech.js';
import type { SipShape } from './sip.js';
/** the drawn face's controls: 0..1 unless noted (L / R the character's own left and right) */
export interface FaceParams {
    /** the upper lids: -1 wide open (surprise, fear) .. 0 .. 1 heavy (sleepy, sad, content) */
    lidUp: number;
    /** the lower lids raised: a squint, a smile's cheeks */
    lidLow: number;
    /** the eyes shut in an arch (laughing, delight) */
    happy: number;
    /** the eyes shut (asleep, a slow blink of contentment) */
    shut: number;
    /** each brow's inner and outer end: -1 down .. 1 up */
    browInL: number;
    browInR: number;
    browOutL: number;
    browOutR: number;
    /** the brows drawn together and down (anger, focus) */
    knit: number;
    smile: number;
    frown: number;
    /** the jaw */
    open: number;
    /** the lips spread wide (ee, s) */
    spread: number;
    /** the lips rounded forward (oo, o, w; a pucker) */
    round: number;
    /** the lips pressed together (m b p; holding something back) */
    press: number;
    /** the upper teeth showing */
    teeth: number;
    /** the tongue's tip up behind the teeth (l, th, n), or out (a laugh) */
    tongue: number;
    /** the lower lip under the upper teeth (f, v) */
    tuck: number;
    /** one corner up: -1 the right .. 1 the left */
    smirk: number;
    blush: number;
}
export declare const FACE_KEYS: readonly ["lidUp", "lidLow", "happy", "shut", "browInL", "browInR", "browOutL", "browOutR", "knit", "smile", "frown", "open", "spread", "round", "press", "teeth", "tongue", "tuck", "smirk", "blush"];
/** what the rig and the shader take: the controls, the eyes' closure this frame (a blink or shut), where they look
 *  (head axes: x the face's left, y up, z forward), speech's weight and the stress of the syllable being said */
export interface FaceState extends FaceParams {
    blink: number;
    gaze: V3;
    talk: number;
    emph: number;
}
/** an expression: some of the controls, and where it looks off to (yaw, pitch, rad) or a laugh's rhythm (Hz) */
export type Expr = Partial<FaceParams> & {
    look?: [number, number];
    pulse?: number;
};
export declare const EXPRESSIONS: {
    neutral: {};
    calm: {
        smile: number;
    };
    smile: {
        smile: number;
        lidLow: number;
        browInL: number;
        browInR: number;
    };
    grin: {
        happy: number;
        shut: number;
        smile: number;
        open: number;
        teeth: number;
        spread: number;
        lidLow: number;
        browInL: number;
        browInR: number;
        browOutL: number;
        browOutR: number;
    };
    laugh: {
        smile: number;
        open: number;
        teeth: number;
        tongue: number;
        happy: number;
        browInL: number;
        browInR: number;
        browOutL: number;
        browOutR: number;
        pulse: number;
    };
    giggle: {
        smile: number;
        open: number;
        teeth: number;
        spread: number;
        happy: number;
        browInL: number;
        browInR: number;
        pulse: number;
    };
    surprise: {
        happy: number;
        shut: number;
        open: number;
        round: number;
        lidUp: number;
        browInL: number;
        browInR: number;
        browOutL: number;
        browOutR: number;
        smile: number;
    };
    awe: {
        happy: number;
        shut: number;
        open: number;
        round: number;
        lidUp: number;
        browInL: number;
        browInR: number;
        browOutL: number;
        browOutR: number;
        smile: number;
    };
    worry: {
        happy: number;
        shut: number;
        browInL: number;
        browInR: number;
        browOutL: number;
        browOutR: number;
        frown: number;
        smile: number;
        open: number;
        lidUp: number;
    };
    sad: {
        happy: number;
        browInL: number;
        browInR: number;
        browOutL: number;
        browOutR: number;
        frown: number;
        smile: number;
        lidUp: number;
        look: [number, number];
    };
    thinking: {
        happy: number;
        shut: number;
        smirk: number;
        press: number;
        browInL: number;
        browOutL: number;
        browInR: number;
        knit: number;
        smile: number;
        look: [number, number];
    };
    angry: {
        happy: number;
        shut: number;
        knit: number;
        browInL: number;
        browInR: number;
        browOutL: number;
        browOutR: number;
        frown: number;
        press: number;
        lidLow: number;
        smile: number;
    };
    determined: {
        happy: number;
        shut: number;
        knit: number;
        press: number;
        browInL: number;
        browInR: number;
        lidLow: number;
        smile: number;
    };
    sleepy: {
        lidUp: number;
        smile: number;
        browInL: number;
        browInR: number;
    };
    content: {
        happy: number;
        smile: number;
        browInL: number;
        browInR: number;
    };
    shy: {
        happy: number;
        shut: number;
        blush: number;
        smile: number;
        lidUp: number;
        browInL: number;
        browInR: number;
        look: [number, number];
    };
    fond: {
        shut: number;
        smile: number;
        lidUp: number;
        lidLow: number;
        browInL: number;
        browInR: number;
        browOutL: number;
        browOutR: number;
    };
    mischief: {
        happy: number;
        shut: number;
        smirk: number;
        smile: number;
        browOutL: number;
        browInR: number;
        lidLow: number;
    };
    scared: {
        happy: number;
        shut: number;
        lidUp: number;
        browInL: number;
        browInR: number;
        browOutL: number;
        browOutR: number;
        open: number;
        spread: number;
        teeth: number;
        frown: number;
        smile: number;
    };
    disgust: {
        happy: number;
        frown: number;
        smirk: number;
        knit: number;
        lidLow: number;
        browInL: number;
        browInR: number;
        smile: number;
    };
    wince: {
        knit: number;
        lidLow: number;
        lidUp: number;
        spread: number;
        teeth: number;
        open: number;
        frown: number;
        smile: number;
    };
    proud: {
        shut: number;
        smile: number;
        lidUp: number;
        browOutL: number;
        browOutR: number;
        look: [number, number];
    };
};
export type ExprName = keyof typeof EXPRESSIONS;
/** the rigs' older face (hero/rig.ts FaceExpr): the controls they're set by */
export interface LegacyExpr {
    smile?: number;
    jaw?: number;
    pucker?: number;
    frown?: number;
    brows?: number;
    tender?: number;
    browDown?: number;
    squint?: number;
    wide?: number;
    closed?: number;
}
/** the older face's keys as the drawn face's controls (into out, every key set) */
export declare function fromLegacy(e: LegacyExpr, out?: FaceParams): FaceParams;
/** the drawn face's state as the older face (for what still reads it) */
export declare function toLegacy(s: FaceState, out: Required<LegacyExpr>): Required<LegacyExpr>;
export declare function blank(): FaceParams;
export interface FaceOpts {
    /** the random's seed (blinks, saccades): each face its own */
    seed?: number;
    /** the gap between blinks (s, a range) */
    blinkGap?: [number, number];
    /** how wide the mouth opens when talking (1; more for a beard to show it through) */
    talkOpen?: number;
}
export declare class Face {
    readonly state: FaceState;
    /** the line being said and the time on it, and how much it holds the mouth (talk.ts sets it each frame) */
    speech: {
        tl: Timeline;
        t: number;
        w: number;
    } | null;
    /** a cup at the lips (0..1), set as the cup comes up */
    sip: number;
    /** while drinking: the eyes closed (0..1); after it, the content breath out (0..1) (drink() sets them) */
    sipEyes: number;
    sipAhh: number;
    /** eating (hero/table.ts sets them each frame): the mouth open for a bite (0..1), the jaw chewing after it (0..1) */
    bite: number;
    chew: number;
    /** how wide the mouth opens talking */
    talkOpen: number;
    /** this face's own look at rest, added under any mood (a lopsided half-smile, say) */
    rest: Partial<FaceParams> | null;
    private moodE;
    private moodK;
    private moodW;
    private moodFade;
    private flashes;
    private T;
    private rnd;
    private blinkT;
    private nextBlink;
    private blinkGap;
    private saccT;
    private sacc;
    private time;
    private lastAim;
    private lastBlinkAt;
    private lastPhrase;
    private mouthTmp;
    constructor(o?: FaceOpts);
    /** the mood: an expression (by name or its controls) held until it's changed, faded in over `fade` s; null: none */
    mood(e: ExprName | Expr | null, o?: {
        k?: number;
        fade?: number;
    }): this;
    /** a passing expression over the mood, held `hold` s (then gone over `fade` s) */
    flash(e: ExprName | Expr, o?: {
        hold?: number;
        k?: number;
        fade?: number;
    }): this;
    /** a passing expression let go now (over its fade): an act that set it, cut short */
    unflash(e: ExprName | Expr): this;
    /** a sip's moment (sip.ts sipAt), or null when there's none: the lips, the eyes, the breath out after */
    drink(s: SipShape | null): void;
    /** a blink now */
    blink(): void;
    get speaking(): boolean;
    private gap;
    /** each frame, from the rig: the body's own face (its activity's controls), the eyes' aim in the head's axes (x the
     *  face's left, y up, z forward; null: ahead) */
    update(dt: number, base: Partial<FaceParams>, aim: V3 | null): FaceState;
}
//# sourceMappingURL=face.d.ts.map