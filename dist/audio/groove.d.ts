import type { Core } from './core';
import type { BankItem } from './synth/registry';
export declare const MARIMBA_NOTES: number[];
export declare const BASS_NOTES: number[];
/** what the groove needs in the bank */
export declare const GROOVE_BANK: BankItem[];
export declare class Groove {
    private core;
    private rng;
    readonly bpm = 112;
    private step;
    private next;
    private idx;
    private bar;
    private prog;
    private bass;
    private motif;
    private winBars;
    /** 0..1 eased */
    energy: number;
    private target;
    constructor(core: Core, seed: number);
    get state(): {
        bar: number;
        prog: string;
        energy: number;
    };
    private chord;
    private nextChord;
    private newPhrase;
    /** a chord tone in [lo, hi] (for a game's blips to land in key) */
    noteFor(lo: number, hi: number): number;
    /** a marimba note now (a blip, a stinger's note) */
    blip(midi: number, gain?: number, pan?: number, delay?: number): void;
    cue(kind: 'gem' | 'unlock' | 'pop' | 'win'): void;
    update(dt: number, energy: number): void;
    private playStep;
    private play;
    private note;
}
//# sourceMappingURL=groove.d.ts.map