import { Rendered, Rng } from './dsp';
export declare function freeze(p: {
    amount?: number;
}, rng: Rng, sr: number): Rendered;
/** lake-ice crack: snap + dispersive descending "pew" chirps + low boom + fracture rattle */
export declare function iceCrack(_p: unknown, rng: Rng, sr: number): Rendered;
/** ice shatter: crunch + many modal chunks that fall and bounce, low thumps, sparkle */
export declare function shatter(p: {
    size?: number;
}, rng: Rng, sr: number): Rendered;
/** melt: soft fizzing hiss with tiny air-pocket pops, a trickle that builds, drips, a soft slump */
export declare function melt(_p: unknown, rng: Rng, sr: number): Rendered;
//# sourceMappingURL=ice.d.ts.map