import type { Kit, RunEntry, Shader, Texture, UniformBuffer } from '@ericrius1/weft';
export interface VolumeOptions {
    /** the passes' labels: `${label}.march`, `${label}.acc0|1`, `${label}.blend` ('volume') */
    label?: string;
    /** the march's share of the render's size (0.5) */
    scale?: number;
    /** the farthest the march reaches (m): the sky's taken as there (40 km) */
    far?: number;
    /** more bindings for the world's shader (its group 2 from binding 6) */
    bind?: Record<string, unknown>;
}
export declare class LowResVolume {
    readonly kit: Kit;
    readonly shader: Shader<any, any>;
    private opts;
    readonly u: UniformBuffer<any>;
    /** whether it's drawn this frame (the world says: none of its passes run while not) */
    on: () => boolean;
    readonly scale: number;
    readonly far: number;
    readonly label: string;
    private list;
    private hist;
    private accPasses;
    private frame;
    private flip;
    private size;
    constructor(kit: Kit, shader: Shader<any, any>, opts?: VolumeOptions);
    /** the targets and the passes after the scene: the march, the histories, the blend into `hdr` (`sceneZ`: the
     *  scene's distance along the view, r32float metres, large for the sky) */
    attach(hdr: Texture, sceneZ: Texture): void;
    /** a frame on: `steps` along each ray, the history's weight (0: none), the world's own vec4s (up to 4) */
    update(steps: number, history: number, user?: ArrayLike<number>[]): void;
    /** this frame's accumulated volume (light, its transmittance in alpha) while it's drawn, else null */
    current(): Texture | null;
    /** the passes after the scene (none while it's off): the march, this frame's history, the blend */
    passes(): RunEntry[];
}
//# sourceMappingURL=volume.d.ts.map