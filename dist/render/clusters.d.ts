import type { Kit, RunEntry, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
export interface LightClusterOptions {
    /** cells along x, y (up), z (default 32, 16, 32) */
    cells?: [number, number, number];
    /** the most lights a cell holds (default 24) */
    cap?: number;
}
export declare class LightClusters {
    private kit;
    /** the grid's reach from the camera: across and up / down (m) */
    reach: {
        across: number;
        up: number;
    };
    readonly cells: [number, number, number];
    readonly cap: number;
    /** 64-byte records a cell (its count and up to `cap` indices, as floats) */
    readonly perCell: number;
    /** records in all (the Renderer copies `buffer` into the point lights' buffer, after the lights) */
    readonly records: number;
    /** the cells' lists, binned each frame */
    readonly buffer: StorageBuffer;
    readonly items: RunEntry[];
    private bin;
    private centre;
    private count;
    constructor(kit: Kit, lights: StorageBuffer, envx: UniformBuffer<any>, opts?: LightClusterOptions);
    /** this frame's grid: round the camera, over the lights in plights (the count written there) */
    update(cam: ArrayLike<number>, count: number): void;
    /** the shaders' values for it (envx: grid, gridR, gridN) */
    envx(on: boolean): {
        grid: number[];
        gridR: number[];
        gridN: number[];
    };
    dispose(): void;
}
//# sourceMappingURL=clusters.d.ts.map