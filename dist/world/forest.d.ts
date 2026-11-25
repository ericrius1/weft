import type { Kit, RunEntry, Shader, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
export interface ForestOptions {
    /** the buffers' and passes' labels: `${label}.cull`, `${label}.args`, `${label}.lists`… ('forest') */
    label?: string;
    /** the lists' capacities: near, far, impostor, shadow */
    caps: [number, number, number, number];
    /** more bindings for the cull (the world's group 2 from binding 6, what its hooks read) */
    bind?: Record<string, unknown>;
    /** the impostors' thinning: the share kept is clamp((far * factor / d)^2, thin.least, 1), those going shrink over `band`
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
    /** optional reference far reach (m) for impostor thinning so shrinking `far` during fast flight keeps mid-distance impostor density steady */
    thinFar?: number;
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
/** archetype slot mask in the runtime packed u32 (bits 0..7, 0..255) */
export declare const FOREST_ARCH_MASK = 255;
/** pinned-y flag in the runtime packed u32 (bit 31: 1 = use stored y directly, 0 = drape via forestGround) */
export declare const FOREST_PINNED_BIT = 2147483648;
/** an instance's packed u32 (forest.wgsl forestUnpack):
 *  - bits  0..7  (8b): archetype slot (0..255)
 *  - bits  8..16 (9b): piecewise height (0..383 -> 0..38.3 m at 0.1 m; 384..511 -> 38.4..140.0 m at 0.8 m)
 *  - bits 17..23 (7b): piecewise crown radius (0..95 -> 0..9.5 m at 0.1 m; 96..127 -> 9.6..25.1 m at 0.5 m)
 *  - bits 24..30 (7b): seed (0..127 -> 0..1)
 *  - bit  31     (1b): pinnedY (1 = use exact stored y, 0 = drape on terrain via forestGround) */
export declare function packForest(arch: number, h: number, r: number, seed: number, pinned?: boolean): number;
/** unpack a runtime packed u32 produced by `packForest` */
export declare function unpackForest(k: number): {
    arch: number;
    h: number;
    r: number;
    seed: number;
    pinned: boolean;
};
/** a compact forest ('TRE2': magic, n, then byte planes x lo, x hi, z lo, z hi, y, and the legacy packed u32's four
 *  bytes) back into 16 bytes an instance (x z y as f32, then the runtime packed u32) — and shuffled, so when a list
 *  fills, the ones it can't take are spread evenly rather than a neighbourhood. Anything else is taken as the 16-byte
 *  runtime records already. */
export declare function decodeForest(raw: Uint8Array, ref: ForestFrameOfReference, shuffle?: boolean): Uint32Array;
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
    /** total active instances (`staticCount + dynamicCount`) */
    count: number;
    /** static instances loaded via `load()` at `[0 .. staticCount)` */
    staticCount: number;
    /** dynamic tail instances written via `setDynamic()` at `[staticCount .. staticCount + dynamicCount)` */
    dynamicCount: number;
    private instancesCap;
    private staticSrc;
    private dynamicSrc;
    private cullPass;
    private lastBind;
    private computes;
    private thin;
    private slack;
    private bind;
    constructor(kit: Kit, shader: Shader<any, any>, opts: ForestOptions);
    private sameBind;
    private ensureInstances;
    /** the static instances (16 bytes each: decodeForest's), and the two computes over them (`bind`: more of the world's
     *  bindings for its hooks, over the options'). Reuses the GPU buffer and compute passes whenever capacity fits, and
     *  preserves any active dynamic tail set via `setDynamic()`. */
    load(instances: Uint32Array, bind?: Record<string, unknown>): void;
    /** write only the dynamic tail slice `[staticCount .. staticCount + dynamicCount)` without copying or re-uploading
     *  the static instances. Safe to call before or after `load()`. */
    setDynamic(instances: Uint32Array): void;
    /** release all GPU buffers and compute passes owned by this forest */
    dispose(): void;
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