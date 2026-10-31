import { Rng } from './synth/dsp';
import type { Rendered } from './synth/dsp';
import { type BankItem } from './synth/registry';
export declare class SynthService {
    private ctx;
    private seed;
    private worker;
    private pending;
    private nextId;
    private bank;
    private listeners;
    readonly ready: Promise<void>;
    private resolveReady;
    private disposed;
    /** milliseconds spent rendering the bank (diagnostics) */
    bankMs: number;
    bankBytes: number;
    constructor(ctx: BaseAudioContext, seed: number, mode: 'worker' | 'sync');
    private fallback;
    private srFor;
    /** render something now (worker if available) */
    render(kind: string, params: object, seed: number, srCap?: number): Promise<Rendered>;
    renderSync(kind: string, params: object, seed: number, sr: number): Rendered;
    toBuffer(r: Rendered): AudioBuffer;
    /** render the startup bank; sync mode yields between items so a main-thread fallback never blocks long */
    loadBank(sync: boolean, bank?: BankItem[]): Promise<void>;
    onLoaded(fn: (key: string) => void): void;
    has(key: string): boolean;
    get(key: string, rng?: Rng, avoid?: {
        last?: AudioBuffer;
    }): AudioBuffer | null;
    all(key: string): AudioBuffer[];
    dispose(): void;
}
//# sourceMappingURL=synth-service.d.ts.map