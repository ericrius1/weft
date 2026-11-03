import type { AudioEvent, AudioState } from './types';
import { Core } from './core';
export declare class Flight {
    private core;
    private layers;
    private fly;
    private v;
    private push;
    private prevSpeed;
    private t;
    private ph;
    private skim;
    /** 0..1, read by the music (adventure layer) */
    intensity: number;
    /** the rendered wind of fast flight (loop.windRush) over the rest, rising with the speed past ~15 m/s, its rate with
     *  it: its level (0, the default: off — a dragon's flight wants about 1) */
    windRush: number;
    constructor(core: Core);
    private n;
    update(dt: number, s: AudioState): void;
    event(e: AudioEvent): void;
    levels(): Record<string, number>;
}
//# sourceMappingURL=flight.d.ts.map