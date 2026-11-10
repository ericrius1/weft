import { Rendered, Rng } from './dsp';
/** a marimba bar at a MIDI pitch */
export declare function marimba(p: {
    midi: number;
}, rng: Rng, sr: number): Rendered;
/** a plucked bass string (Karplus–Strong, a soft pluck) */
export declare function pluckBass(p: {
    midi: number;
}, rng: Rng, sr: number): Rendered;
/** a kick: a sine dropping in pitch, a click */
export declare function kick(_p: object, rng: Rng, sr: number): Rendered;
/** a finger snap: a bright crack and a little ring */
export declare function snap(_p: object, rng: Rng, sr: number): Rendered;
/** a shaker: a short hiss with a soft attack */
export declare function shaker(p: {
    long?: boolean;
}, rng: Rng, sr: number): Rendered;
/** a splat of paint: a wet slap with a squelch dropping after it */
export declare function squish(p: {
    size?: number;
}, rng: Rng, sr: number): Rendered;
//# sourceMappingURL=toy.d.ts.map