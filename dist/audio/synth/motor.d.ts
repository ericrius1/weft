import { Rendered, Rng } from './dsp';
/** the engine at ~3000 rpm (a four-stroke four fires twice a turn: 100 Hz); `load` 1 for the snarl under throttle */
export declare function engineLoop(p: {
    load?: number;
}, rng: Rng, sr: number): Rendered;
/** tyres at the limit: a howl of a few close tones over a band of noise (looped) */
export declare function squealLoop(_p: object, rng: Rng, sr: number): Rendered;
/** tyres through standing water: a broad hiss with a low rush (looped) */
export declare function sprayLoop(_p: object, rng: Rng, sr: number): Rendered;
/** rain on a car's roof and screen: a dense patter of little ticks over a hiss (looped) */
export declare function roofRain(_p: object, rng: Rng, sr: number): Rendered;
/** a gearshift: a mechanical clunk and the revs' breath */
export declare function gearShift(_p: object, rng: Rng, sr: number): Rendered;
/** a backfire: a pop from the exhaust, a little crackle after */
export declare function backfire(_p: object, rng: Rng, sr: number): Rendered;
//# sourceMappingURL=motor.d.ts.map