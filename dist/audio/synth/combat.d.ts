import { Rendered, Rng } from './dsp';
export declare function cannon(_p: object, rng: Rng, sr: number): Rendered;
export declare function explosion(p: {
    size?: number;
}, rng: Rng, sr: number): Rendered;
export declare function missileLaunch(_p: object, rng: Rng, sr: number): Rendered;
/** the Kestrel's engines, looped: a turbine whine (two partials, beating) over a broadband roar */
export declare function jetLoop(_p: object, rng: Rng, sr: number): Rendered;
export declare function lockTone(p: {
    solid?: boolean;
}, _rng: Rng, sr: number): Rendered;
export declare function boltZap(_p: object, rng: Rng, sr: number): Rendered;
export declare function armourHit(_p: object, rng: Rng, sr: number): Rendered;
/** thunder: the crack (close) or not (far), then a long rumble rolling in bursts */
export declare function thunder(p: {
    near?: number;
}, rng: Rng, sr: number): Rendered;
//# sourceMappingURL=combat.d.ts.map