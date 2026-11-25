import type { Kit } from './kit';
import { type Texture } from './resources';
import { type ImageTextureOptions } from './images';
/** KTX2 v2.0 12-byte magic identifier */
export declare const KTX2_MAGIC: Uint8Array<ArrayBuffer>;
export type CompressedFamily = 'bc7' | 'astc' | 'etc2';
export interface Ktx2Level {
    width: number;
    height: number;
    depth: number;
    bytesPerRow: number;
    rowsPerImage: number;
    copyWidth: number;
    copyHeight: number;
    data: Uint8Array;
}
export interface Ktx2Image {
    format: GPUTextureFormat;
    vkFormat: number;
    width: number;
    height: number;
    depth: number;
    layers: number;
    faces: number;
    supercompression: number;
    levels: Ktx2Level[];
}
export interface Ktx2TextureOptions {
    label?: string;
    /** keep at most this many pixels a side: skips top mips larger than `max` before GPU allocation/upload */
    max?: number;
}
/** Check whether a GPU device supports sampling a given WebGPU texture format. */
export declare function supportsTextureFormat(kit: Pick<Kit, 'features'>, format: GPUTextureFormat): boolean;
/** Pick the highest-quality native compressed texture family supported by this GPU (null if uncompressed only). */
export declare function bestCompressedFormat(kit: Pick<Kit, 'features'>): CompressedFamily | null;
/** Parse a KTX2 v2.0 binary container into ready-to-upload mip levels (supports raw scheme 0 and zlib scheme 3). */
export declare function parseKtx2(bytes: ArrayBuffer | Uint8Array): Promise<Ktx2Image>;
/** Encode raw mip level buffers into a minimal KTX2 v2.0 container (no Khronos DFD; for internal build tools, packers, and tests). */
export declare function encodeKtx2(opts: {
    format: GPUTextureFormat;
    width: number;
    height: number;
    depth?: number;
    layers?: number;
    faces?: number;
    levels: Uint8Array[];
    supercompression?: 0 | 3;
    uncompressedByteLengths?: number[];
}): Uint8Array;
/** Upload a KTX2 binary container straight into a GPU Texture (respecting `max` mip trim for mobile VRAM). */
export declare function textureFromKtx2(kit: Kit, bytes: ArrayBuffer | Uint8Array, o?: Ktx2TextureOptions): Promise<Texture>;
/** Fetch and upload a KTX2 texture from `url`. */
export declare function loadKtx2Texture(kit: Kit, url: string, o?: Ktx2TextureOptions, init?: RequestInit): Promise<Texture>;
/** Load a native compressed KTX2 variant matching this GPU (`bc7`/`astc`/`etc2`) when provided in `variants`,
 *  falling back seamlessly to `loadImageTexture(kit, fallbackUrl, opts)` if unavailable or unsupported. */
export declare function loadCompressedOrImageTexture(kit: Kit, fallbackUrl: string, variants: Partial<Record<CompressedFamily, string>> | null | undefined, o?: ImageTextureOptions, init?: RequestInit): Promise<Texture>;
//# sourceMappingURL=ktx2.d.ts.map