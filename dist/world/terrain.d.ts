import type { Kit, Texture, StorageBuffer } from '@ericrius1/weft';
export declare const PATCH = 32;
export declare const LODS = 8;
export interface Node {
    x: number;
    z: number;
    size: number;
    lod: number;
}
export interface TerrainOptions {
    /** the world spans ±half metres */
    half: number;
    /** height map texels per side */
    size?: number;
    /** splat / mask texels per side */
    splatSize?: number;
    /** the smallest patch (m) */
    leaf?: number;
    /** the generator shader and the values for its Gen uniform (besides size, splatSize, half) */
    gen: any;
    params?: Record<string, unknown>;
    /** more resources for the generator's entries (by name: a road's field, a list of features…) */
    bind?: Record<string, unknown>;
    /** between the raw land and finalize: the raw heights (row-major, size²) — e.g. to lay a road out over them and hand
     *  its field to finalize through `bind` */
    beforeFinalize?: (raw: Float32Array, size: number) => void | Promise<void>;
}
export declare class HeightTerrain {
    private kit;
    private o;
    heightTex: Texture;
    normalTex: Texture;
    splatTex: Texture;
    maskTex: Texture;
    heights: Float32Array<ArrayBuffer>;
    splat: Uint8Array<ArrayBuffer>;
    mask: Uint8Array<ArrayBuffer>;
    readonly half: number;
    readonly size: number;
    readonly splatSize: number;
    readonly leaf: number;
    readonly cell: number;
    private minmax;
    readonly ranges: number[];
    nodes: Node[];
    nodeData: Float32Array<ArrayBuffer>;
    nodeBuf: StorageBuffer;
    gridIndex: StorageBuffer;
    gridCount: number;
    /** below the world's edge (and outside it): the sea floor */
    outside: number;
    constructor(kit: Kit, o: TerrainOptions);
    generate(progress?: (f: number, msg: string) => void): Promise<void>;
    height(x: number, z: number): number;
    normal(x: number, z: number): [number, number, number];
    private sample8;
    splatAt(x: number, z: number): [number, number, number, number];
    maskAt(x: number, z: number): [number, number, number, number];
    private buildMinMax;
    private buildGrid;
    /** pick this frame's patches for a camera (position + frustum planes) */
    select(cam: ArrayLike<number>, planes: Float32Array | null, maxLod?: number): number;
    uploadNodes(buf?: StorageBuffer, count?: number): void;
}
//# sourceMappingURL=terrain.d.ts.map