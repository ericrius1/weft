export type Phone = 'AA' | 'AE' | 'AH' | 'AO' | 'AW' | 'AX' | 'AY' | 'EH' | 'ER' | 'EY' | 'IH' | 'IY' | 'OW' | 'OY' | 'UH' | 'UW' | 'B' | 'CH' | 'D' | 'DH' | 'F' | 'G' | 'HH' | 'JH' | 'K' | 'L' | 'M' | 'N' | 'NG' | 'P' | 'R' | 'S' | 'SH' | 'T' | 'TH' | 'V' | 'W' | 'Y' | 'Z' | 'ZH' | '_';
export declare const VOWELS: Set<Phone>;
/** a timed phoneme: its start and end (s, from the line's start), its stress (0 none, 1 secondary, 2 primary), its
 *  word (index), and the pitch's shape over its phrase (0 at the phrase's start .. 1 at its end) */
export interface TimedPhone {
    p: Phone;
    t0: number;
    t1: number;
    stress: number;
    word: number;
    phrase: number;
    end: '.' | '?' | '!' | ',' | '';
}
export interface TimedWord {
    text: string;
    t0: number;
    t1: number; /** where it is in the line's text */
    i0: number;
    i1: number;
}
export interface Timeline {
    text: string;
    phones: TimedPhone[];
    words: TimedWord[];
    dur: number;
    question: boolean;
    exclaim: boolean;
    /** a recorded line's loudness (cast/voicepack.ts): `rate` frames a second, each 0..255 over -50..-10 dBFS; the jaw
     *  opens with it, and a sound with no word (a laugh, a breath) still parts the lips */
    env?: {
        rate: number;
        v: Uint8Array;
    };
}
/** a word's phonemes with stress marks (a 1 or 2 after a stressed vowel: 2 the word's main one) */
export declare function wordPhones(word: string): {
    p: Phone;
    stress: number;
}[];
export interface LineOpts {
    /** speech rate (1 normal; Iroh's easy 0.86, Aang's quick 1.12) */
    rate?: number;
    /** a little silence before the first word (s) */
    lead?: number;
}
/** a line of text said: its phonemes on a clock, its words and where they are in the text */
export declare function lineOf(text: string, o?: LineOpts): Timeline;
/** the mouth's shape (each 0..1): the jaw open, the lips spread (ee) or rounded (oo), pressed (m b p), the upper teeth
 *  showing, the tongue's tip up (l th n), the lower lip tucked under the teeth (f v) */
export interface Mouth {
    open: number;
    spread: number;
    round: number;
    press: number;
    teeth: number;
    tongue: number;
    tuck: number;
}
export type Viseme = 'sil' | 'PP' | 'FF' | 'TH' | 'DD' | 'kk' | 'CH' | 'SS' | 'nn' | 'RR' | 'aa' | 'E' | 'ih' | 'oh' | 'ou';
export declare const VISEMES: Record<Viseme, Mouth>;
/** a phoneme's viseme (diphthongs: the first half's, then the second's) */
export declare function visemeOf(p: Phone, second?: boolean): Viseme;
/** the mouth at time t on the line, and how much the syllable then is stressed (0..1: the brows lift with it) */
export declare function mouthAt(tl: Timeline, t: number, out?: Mouth): {
    mouth: Mouth;
    emph: number;
};
/** the word being said at time t (-1 before the first, the last after it) */
export declare function wordAt(tl: Timeline, t: number): number;
/** which phrase of the line time t is in (the pauses before it), -1 before the first word */
export declare function phraseAt(tl: Timeline, t: number): number;
//# sourceMappingURL=speech.d.ts.map