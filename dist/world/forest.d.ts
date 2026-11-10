import type { Kit, RunEntry, Shader, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
export interface ForestOptions {
    /** the buffers' and passes' labels: `${label}.cull`, `${label}.args`, `${label}.lists`… ('forest') */
    label?: string;
    /** the lists' capacities: near, far, impostor, shadow */
    caps: [number, number, number, number];
    /** more bindings for the cull (the world's group 2 from binding 6, what its hooks read) */
    bind?: Record<string, unknown>;
    /** the impostors' thinning: the share kept is clamp((far * factor / d)^2, least, 1), those going shrink over `band`
     *  of the seeds (1.4, 0.3, 0.06) */
    thin?: {
        factor?: number;
        least?: number;
        band?: number;
    };
    /** how far past the farthest reach an instance's stored foot may be before the ground under it is sampled (60 m) */
    slack?: number;
}
export interface ForestFrame {
    /** the near list's end, the far's, the impostors' (m) */
    near: number;
    far: number;
    imp: number;
    /** the far/impostor crossfade band (m) */
    band: number;
    /** the shadows' casters' reach (m) */
    shadow: number;
    /** the four draws' vertices an instance: near, far, impostor, shadow */
    verts: [number, number, number, number];
    /** the world's own vec4s for its draws (up to 4) */
    user?: ArrayLike<number>[];
}
/** the compact format's frame: x = u16 * step[0] + origin[0], z likewise, y = u8 * step[1] + origin[1] (its stored foot) */
export interface ForestFrameOfReference {
    origin: [number, number, number];
    step: [number, number];
}
/** 'TRE2' */
export declare const FOREST_MAGIC = 843403860;
/** a compact forest ('TRE2': magic, n, then byte planes x lo, x hi, z lo, z hi, y, and the packed u32's four bytes)
 *  back into 16 bytes an instance (x z y as f32, then the packed u32) — and shuffled, so when a list fills, the ones it
 *  can't take are spread evenly rather than a neighbourhood. Anything else is taken as the 16-byte records already. */
export declare function decodeForest(raw: Uint8Array, ref: ForestFrameOfReference, shuffle?: boolean): Uint32Array;
/** an instance's packed u32 (forest.wgsl forestUnpack): archetype (0..63), height and crown radius (m, to 0.1), seed (0..1) */
export declare function packForest(arch: number, h: number, r: number, seed: number): number;
export declare class Forest {
    readonly kit: Kit;
    readonly shader: Shader<any, any>;
    readonly u: UniformBuffer<any>;
    readonly label: string;
    readonly caps: [number, number, number, number];
    /** the four lists end to end (16 bytes an entry: x, the ground's y, z, the packed u32) */
    readonly lists: StorageBuffer;
    readonly counters: StorageBuffer;
    /** the four indirect draws' args (16 bytes each: near, far, impostor, shadow) */
    readonly args: StorageBuffer;
    instances: StorageBuffer | null;
    count: number;
    private computes;
    private thin;
    private slack;
    private bind;
    constructor(kit: Kit, shader: Shader<any, any>, opts: ForestOptions);
    /** the instances (16 bytes each: decodeForest's), and the two computes over them (`bind`: more of the world's
     *  bindings for its hooks, over the options') */
    load(instances: Uint32Array, bind?: Record<string, unknown>): void;
    /** a frame's reaches, the draws' vertices, the world's own vec4s */
    update(f: ForestFrame): void;
    /** what a draw binds to read the lists: the uniform and forestVisible */
    drawBind(): {
        forest: UniformBuffer<any>;
        forestVisible: StorageBuffer;
    };
    /** list's (0 near, 1 far, 2 impostor, 3 shadow) indirect args' offset in `args` */
    argsOffset(list: number): number;
    /** the computes for this frame (the cull, then the args): none before load */
    passes(): RunEntry[];
}
//# sourceMappingURL=forest.d.ts.map