import type { AudioState } from './types';
import type { Core } from './core';
export declare class Score {
    private core;
    private rng;
    private bpm;
    private beat;
    private nextBeat;
    private beatIdx;
    private bar;
    private prog;
    private barsLeft;
    private mode;
    private restUntil;
    private night;
    private motif;
    private finaleBars;
    enabled: boolean;
    log: ((line: string) => void) | null;
    /** 0..1: flight / swinging (more harp, shorter rests) */
    advTarget: number;
    private adv;
    private I;
    constructor(core: Core, seed: number);
    get state(): {
        mode: "rest" | "piece";
        bar: number;
        prog: string;
        adv: number;
    };
    /** midi notes of the pitch collection in [lo, hi] (for in-key stings) */
    keyNotes(lo: number, hi: number): {
        notes: number[];
        tonic: number;
    };
    startNow(): void;
    restNow(secs: number): void;
    private chord;
    private begin;
    private note;
    /** the game's moments: a star taken, a star home, a constellation whole, the finale */
    cue(kind: 'take' | 'home' | 'whole' | 'finale'): void;
    update(dt: number, s: AudioState): void;
    private playBeat;
}
//# sourceMappingURL=score.d.ts.map