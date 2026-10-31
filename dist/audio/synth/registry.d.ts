import type { Rendered, Rng } from './dsp';
type Renderer = (p: any, rng: Rng, sr: number) => Rendered;
export declare const RENDERERS: Record<string, Renderer>;
export interface BankItem {
    key: string;
    kind: string;
    params: object;
    variants: number;
    /** max sample rate for this item (rendered at min(ctx rate, sr)) */
    sr?: number;
}
/** the score's pitch collection (D major with the raised fourth: D lydian / B minor), and the notes each voice has */
export declare const SCALE_PCS: number[];
export declare const HARP_NOTES: number[];
export declare const CELESTA_NOTES: number[];
export declare const CHOIR_NOTES: number[];
export declare const PAD_NOTES: number[];
export declare const SUB_NOTES: number[];
export declare const GLASS_NOTES: number[];
/** startup bank, in priority order */
export declare const BANK: BankItem[];
/** sample-rate ceilings for on-demand renders */
export declare const LIVE_SR: Record<string, number>;
export {};
//# sourceMappingURL=registry.d.ts.map