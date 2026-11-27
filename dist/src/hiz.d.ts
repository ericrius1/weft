import type { Kit } from './kit';
import { type RunItem, type RenderPass } from './passes';
import type { Texture } from './resources';
export interface HiZOptions {
    label?: string;
    /** cap on mip levels (default 'full' down to 1x1) */
    maxMips?: number | 'full';
}
export declare class HiZ implements RunItem {
    private kit;
    readonly source: Texture;
    readonly label: string;
    readonly texture: Texture;
    enabled: boolean;
    passes: RenderPass[];
    private builtFor;
    private builtMips;
    constructor(kit: Kit, source: Texture, opts?: HiZOptions);
    private build;
    encode(enc: GPUCommandEncoder): void;
    ready(): Promise<{
        pipelines: number;
        distinct: number;
        failed: number;
        errors: {
            label: string;
            message: string;
        }[];
    }>;
    dispose(): void;
}
//# sourceMappingURL=hiz.d.ts.map