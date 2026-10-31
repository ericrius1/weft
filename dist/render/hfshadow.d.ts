import type { Kit, Texture, RunEntry, V3 } from '@ericrius1/weft';
export declare class TerrainShadow {
    readonly N: number;
    readonly band: number;
    /** what the scene samples */
    shown: Texture;
    private build;
    private u;
    private bake;
    private copy;
    private row;
    private rows;
    private done;
    ready: boolean;
    /** the window (world xz origin, size m, texels) */
    win: [number, number, number, number];
    constructor(kit: Kit, heights: Texture, half: number, N?: number, band?: number);
    /** this frame's work toward the light direction `dir` */
    items(dir: V3): RunEntry[];
}
//# sourceMappingURL=hfshadow.d.ts.map