import type { Kit } from './kit';
import type { Shader } from './shader';
import { Draw, type DrawOptions, type RenderPass } from './passes';
export declare class DrawBundle {
    private kit;
    readonly pass: RenderPass;
    readonly label: string;
    /** drawn or not (a function is asked each frame) */
    enabled: boolean | (() => boolean);
    readonly draws: Draw[];
    /** how many times it has been recorded */
    records: number;
    private bundle;
    private list;
    private dirty;
    private formats;
    private view;
    private group0;
    private shared;
    private watched;
    private calls;
    private gen;
    private epoch;
    private moves;
    private now;
    constructor(kit: Kit, pass: RenderPass, label: string);
    draw<S extends Shader>(shader: S, opts?: DrawOptions<S>): Draw<S>;
    /** a fullscreen triangle (the shader includes weft/fullscreen and has a fragment entry) */
    fullscreen<S extends Shader>(shader: S, opts?: DrawOptions<S>): Draw<S>;
    /** record it again at its next use (after changing a draw's plain options in place) */
    invalidate(): void;
    /** wait for its draws' pipelines alone (see kit.ready) */
    ready(): Promise<{
        pipelines: number;
        distinct: number;
        failed: number;
    }>;
    encode(pe: GPURenderPassEncoder): void;
    /** stop it for good: its draws are disposed and it leaves its pass */
    dispose(): void;
    private stale;
    private record;
}
//# sourceMappingURL=bundle.d.ts.map