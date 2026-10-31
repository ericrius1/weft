import type { Kit } from './kit';
import type { RunItem } from './passes';
import type { Texture } from './resources';
export declare class MipChain implements RunItem {
    private kit;
    readonly texture: Texture;
    readonly label: string;
    enabled: boolean;
    private passes;
    private builtFor;
    constructor(kit: Kit, texture: Texture);
    private build;
    encode(enc: GPUCommandEncoder): void;
    /** stop it for good (its passes' pipelines leave the kit) */
    dispose(): void;
}
//# sourceMappingURL=mipgen.d.ts.map