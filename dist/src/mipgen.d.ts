import type { Kit } from './kit';
import { type RunItem, type RenderPass } from './passes';
import type { Texture } from './resources';
export declare class MipChain implements RunItem {
    private kit;
    readonly texture: Texture;
    readonly label: string;
    enabled: boolean;
    /** its passes, a level each (kit.ready(chain) waits for their pipelines: a chain run before they're compiled
     *  draws nothing, and the mips stay black) */
    passes: RenderPass[];
    private builtFor;
    constructor(kit: Kit, texture: Texture);
    private build;
    encode(enc: GPUCommandEncoder): void;
    /** its pipelines compiled (the same as kit.ready(chain)) */
    ready(): Promise<{
        pipelines: number;
        distinct: number;
        failed: number;
    }>;
    /** stop it for good (its passes' pipelines leave the kit) */
    dispose(): void;
}
//# sourceMappingURL=mipgen.d.ts.map