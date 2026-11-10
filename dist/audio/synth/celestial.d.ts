import { Rendered, Rng } from './dsp';
export declare function harp(p: {
    midi: number;
}, rng: Rng, sr: number): Rendered;
/** a celesta: struck steel bars over wooden resonators — a soft bell with a quick bright onset */
export declare function celesta(p: {
    midi: number;
}, rng: Rng, sr: number): Rendered;
/** glass: a sustained bowed-glass tone, slowly swelling, a gentle beating between two near partials */
export declare function glass(p: {
    midi: number;
    dur?: number;
}, rng: Rng, sr: number): Rendered;
/** a choir "oo" (a saw through vowel formants, a slow vibrato that grows in, a breathy edge), unison of 3 voices */
export declare function choir(p: {
    midi: number;
    dur?: number;
}, rng: Rng, sr: number): Rendered;
/** a warm pad: detuned saws through a slowly opening low-pass */
export declare function pad(p: {
    midi: number;
    dur?: number;
}, rng: Rng, sr: number): Rendered;
export declare function sub(p: {
    midi: number;
    dur?: number;
}, _rng: Rng, sr: number): Rendered;
/** the thread flying out: a bright rising zing over a breathy rush */
export declare function zing(_p: object, rng: Rng, sr: number): Rendered;
/** the thread catching: a deep plucked thrum (a long string pulled taut) with a glassy ping on top */
export declare function thrum(p: {
    midi?: number;
}, rng: Rng, sr: number): Rendered;
/** air rushing past (zip / fling): band-passed noise sweeping up, then away */
export declare function rush(p: {
    up?: number;
    dur?: number;
}, rng: Rng, sr: number): Rendered;
/** a lumen seed: a soft round pop and a little sparkle */
export declare function pop(_p: object, rng: Rng, sr: number): Rendered;
/** a bloom's bounce: a springy rising "whoomp" with a bell on top */
export declare function boing(_p: object, rng: Rng, sr: number): Rendered;
/** a star: a shimmer of high bell partials, scattered in time and across the stereo field */
export declare function shimmer(p: {
    dur?: number;
    root?: number;
}, rng: Rng, sr: number): Rendered;
/** a skyray's call: a long low moan rising and falling, a hollow formant, a breathy edge (heard from far off) */
export declare function rayCall(p: {
    pitch?: number;
}, rng: Rng, sr: number): Rendered;
/** the rover's motor: a soft electric whine over a low hum (looped; playback rate follows the speed) */
export declare function motor(_p: object, rng: Rng, sr: number): Rendered;
//# sourceMappingURL=celestial.d.ts.map