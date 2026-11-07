import type { Kit } from './kit';
import type { Texture } from './resources';
/** an image's bytes decoded as they are (no colour-space conversion, alpha not premultiplied) */
export declare function bitmapOf(blob: Blob): Promise<ImageBitmap>;
export declare function loadBitmap(url: string, init?: RequestInit): Promise<ImageBitmap>;
export interface ImageTextureOptions {
    /** sRGB-encoded colour (an albedo, a sky) rather than data */
    srgb?: boolean;
    /** a full mip chain, filled at once */
    mips?: boolean;
    label?: string;
    /** keep at most this many pixels a side: a mipmapped image bigger than it is kept from its first mip within it (a
     *  phone's memory: the mip it would sample anyway, the rest never on the GPU) */
    max?: number;
}
/** one texture of the bitmaps (more than one: a 2D array, one a layer; all the first one's size) */
export declare function textureFromBitmaps(kit: Kit, bitmaps: ImageBitmap[], o?: ImageTextureOptions): Texture;
/** an image as a texture (`label` defaults to its URL) */
export declare function loadImageTexture(kit: Kit, url: string, o?: ImageTextureOptions, init?: RequestInit): Promise<Texture>;
/** images as one 2D array texture, a layer each */
export declare function loadImageArray(kit: Kit, urls: string[], o?: ImageTextureOptions, init?: RequestInit): Promise<Texture>;
/** compile the mip pipelines of the common formats in the background (generateMips does it the first time) */
export declare function warmMips(kit: Kit): void;
/** fill every mip of every layer from the one above, box-filtered, now (render passes: the format must be renderable) */
export declare function generateMips(kit: Kit, t: Texture): void;
/** a small constant texture (layers > 1: a 2D array) */
export declare function solidTexture(kit: Kit, rgba: [number, number, number, number], layers?: number, label?: string): Texture;
//# sourceMappingURL=images.d.ts.map