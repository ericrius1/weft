import type { AudioState, DebugCall, V3 } from './types';
import { Core } from './core';
export declare class Ambience {
    private core;
    private layers;
    private scene;
    private wind;
    private uw;
    private gustPh;
    private crickets;
    private sessions;
    private s;
    private frogBout;
    wildlife: boolean;
    /** last time (ctx seconds) the game voiced a species channel; spontaneous ambience of that channel is suppressed for 60 s */
    private gameVoiced;
    private time;
    private dt;
    constructor(core: Core);
    /** slow pseudo-random 0..1 signals for gusts */
    private n;
    /** environment descriptors shared with the engine (reverb space, echo amount) */
    env: {
        forest: number;
        open: number;
        high: number;
        alt: number;
        lake: number;
        river: number;
    };
    update(dt: number, s: AudioState): void;
    /** air temperature model: alpine lake is cold at night, the forest river a little milder */
    private temperature;
    private updateCrickets;
    private placeCricket;
    private around;
    /** request a fresh render of a call and play it at pos */
    call(name: DebugCall, pos?: V3, gainMul?: number, params?: object): void;
    /** per-frame hazard of a Poisson process (adapts instantly to rate changes); muted while the game voices that channel */
    private poisson;
    /** a call emitted by the game's wildlife simulation at a real position */
    gameCall(species: string, pos: V3): void;
    private updateWildlife;
    /** trigger a call now; `dist` places it straight ahead of the listener at that distance (calibration) */
    debugCall(name: DebugCall, dist?: number): void;
    /** typical distance of a species (geometric mean of its range) */
    static typicalDist(name: DebugCall): number;
    /** a call placed at a given world position (e.g. birds bursting from a tree) */
    callAt(name: DebugCall, pos: V3, gain?: number): void;
    layerLevels(): Record<string, number>;
}
//# sourceMappingURL=ambience.d.ts.map