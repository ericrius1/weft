import type { AudioEvent, AudioState } from './types';
import { Core } from './core';
export declare class Sfx {
    private core;
    private flow;
    private swirl;
    private sm;
    private s;
    private lastSurface;
    private avoid;
    private wasUnder;
    private underSince;
    private lastPlunge;
    /** in-key note source (provided by the engine from the music state) */
    keyNotes: ((lo: number, hi: number) => {
        notes: number[];
        tonic: number;
    }) | null;
    private lantern;
    /** a fire's loops (its roar and crackle, a dragon's breath) */
    private fireL;
    constructor(core: Core);
    /** a small soft bell (sine partials), non-positional but panned toward `pan` */
    private chime;
    /** stereo pan of a world position relative to the listener */
    private panOf;
    private buf;
    /** cliff-echo amount (open valley 1 .. dense forest ~0.45), set by the engine from the environment */
    echoScale: number;
    private ensureFlow;
    private ensureSwirl;
    update(dt: number, s: AudioState): void;
    private updateSwirl;
    event(e: AudioEvent): void;
    private splash;
    private footstep;
}
//# sourceMappingURL=sfx.d.ts.map