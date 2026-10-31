import type { Kit } from './kit';
import type { Texture } from './resources';
/** ranks 0..1 (n×n, row-major); deterministic for a seed. n = 64 takes ~50 ms. */
export declare function blueNoise(n?: number, seed?: number, sigma?: number): Float32Array;
/** the blue noise as an r8unorm texture (textureLoad it at pixel % n) */
export declare function blueNoiseTexture(kit: Kit, n?: number, seed?: number): Texture;
//# sourceMappingURL=bluenoise.d.ts.map