import type { Kit, RenderPass, Texture } from '@ericrius1/weft';
/** the shader that resolves `depth` (one sample, or the nearest of 4) */
export declare function sceneZShader(samples?: number): import("@ericrius1/weft").Shader<{
    Frame: import("../shaders/scenez_ms.wgsl").Frame;
    FullscreenOut: import("../shaders/scenez_ms.wgsl").FullscreenOut;
}, "frame" | "samp_linear" | "samp_repeat" | "samp_nearest" | "samp_shadow" | "depth">;
/** the target and its pass: run `pass` after the scene, read `tex` */
export declare function sceneZ(kit: Kit, depth: Texture, label?: string): {
    tex: Texture;
    pass: RenderPass;
};
//# sourceMappingURL=scenez.d.ts.map