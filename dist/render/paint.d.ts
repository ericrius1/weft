import type { Kit, Texture, UniformBuffer, RunEntry, SamplerName } from '@ericrius1/weft';
import type { SdfScene } from '../world/sdf';
export type V3 = [number, number, number];
/** paint 0..2 (the paints), 3 bleach */
export interface Splat {
    p: V3;
    r: number;
    paint: number;
    strength?: number;
}
export declare class Paint {
    private kit;
    readonly origin: V3;
    readonly voxel: number;
    readonly dims: [number, number, number];
    /** the volume surfaces sample (rgba8: the three paints, the stamp's time) */
    readonly tex: Texture;
    private grid;
    readonly u: UniformBuffer<any>;
    private splatBuf;
    private pass;
    private queue;
    private batch;
    private splatData;
    /** the three paints' colours (linear) */
    colors: V3[];
    clock: number;
    /** the CPU's copy, a byte a voxel: the paint that dominates (top 2 bits: 0 none, 1..3 that paint + 1), its cover (6) */
    readonly cpu: Uint8Array;
    private skin;
    /** how many voxels a surface passes through; how many of them each paint holds (at least half covered) */
    skinCount: number;
    painted: number[];
    constructor(kit: Kit, o: {
        lo: V3;
        hi: V3;
        voxel: number;
    });
    /** what a surface shader binds to read the paint */
    get bindings(): {
        PU: UniformBuffer<any>;
        paintTex: Texture;
        paintSamp: SamplerName;
    };
    /** the voxels a scene's surfaces pass through: what the coverage counts */
    setScene(sdf: SdfScene): void;
    /** splat paint (or bleach) on the world: the CPU's copy at once, the GPU's at the next frame */
    splat(s: Splat): void;
    /** the paint at a point (the voxel holding it): which (-1 none) and how much */
    at(p: ArrayLike<number>): {
        paint: number;
        cover: number;
    };
    /** the paint under a surface point (normal n): a little inside it, as the shaders read it */
    surface(p: ArrayLike<number>, n: ArrayLike<number>): {
        paint: number;
        cover: number;
    };
    /** how much of the scene's surface is painted (any paint), 0..1 */
    get coverage(): number;
    private applyCpu;
    /** advance the clock; this frame's splats to the GPU */
    update(dt: number): void;
    /** the stamping pass (none when there's nothing to stamp) */
    items(): RunEntry[];
}
//# sourceMappingURL=paint.d.ts.map