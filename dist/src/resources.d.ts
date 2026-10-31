import type { Kit } from './kit';
import type { StructDef } from './shader';
import { StructView, type DeepPartial } from './struct';
export declare const nextUid: () => number;
/** a stable id for raw GPU objects handed to the kit */
export declare const rawUid: (o: object) => number;
export interface Resource {
    readonly uid: number;
    version: number;
    label: string;
}
/** a value resolved at bind / encode time (ping-pong sides, views of a mip, …) */
export declare class Ref<T = unknown> {
    readonly get: () => T;
    readonly label: string;
    constructor(get: () => T, label?: string);
}
export declare const deref: (v: unknown) => unknown;
export type BufferUse = 'storage' | 'uniform' | 'vertex' | 'index' | 'indirect' | 'copy-src' | 'copy-dst' | 'map-read' | 'query';
export declare const bufferUsage: (u: BufferUse[]) => number;
/** a uniform buffer laid out from a WGSL struct; dirty values upload once at the start of the next kit.run() */
export declare class UniformBuffer<T = Record<string, unknown>> implements Resource {
    private kit;
    readonly def: StructDef<T>;
    label: string;
    readonly uid: number;
    private v;
    gpu: GPUBuffer;
    view: StructView<T>;
    dirty: boolean;
    destroyed: boolean;
    private layoutVersion;
    constructor(kit: Kit, def: StructDef<T>, label: string);
    /** bumped when its GPU buffer is replaced (and kit.resourceGen with it, so bind groups are checked again) */
    get version(): number;
    set version(n: number);
    set(values: DeepPartial<T>): this;
    get(field: keyof T & string): unknown;
    /** upload now if dirty (kit.run does this for every uniform buffer) */
    upload(): void;
    private relayout;
    /** free it for good (it's no longer uploaded) */
    destroy(): void;
}
export interface StorageOptions {
    label?: string;
    /** size in bytes; or count × (struct size | stride | 4) */
    size?: number;
    count?: number;
    struct?: StructDef<unknown>;
    stride?: number;
    usage?: BufferUse[];
    data?: ArrayBufferView | ArrayBuffer;
}
export declare class StorageBuffer implements Resource {
    private kit;
    readonly uid: number;
    private v;
    gpu: GPUBuffer;
    size: number;
    count: number;
    stride: number;
    label: string;
    readonly usage: number;
    constructor(kit: Kit, o: StorageOptions);
    /** bumped when its GPU buffer is replaced (and kit.resourceGen with it, so bind groups are checked again) */
    get version(): number;
    set version(n: number);
    private alloc;
    write(data: ArrayBufferView | ArrayBuffer, byteOffset?: number): this;
    /** grow (contents are not kept); bind groups follow automatically */
    ensure(bytes: number): boolean;
    /** copy the contents back to the CPU */
    read(byteOffset?: number, byteLength?: number): Promise<ArrayBuffer>;
    /** free it for good */
    destroy(): void;
}
export type TexUse = 'sample' | 'storage' | 'render' | 'copy-src' | 'copy-dst';
export declare const isDepthFormat: (f: string) => boolean;
export interface TextureDesc {
    label?: string;
    format: GPUTextureFormat;
    /** pixels, or relative to the kit's render size ('render') / the canvas ('canvas') times `scale` */
    size: [number, number] | [number, number, number] | 'render' | 'canvas';
    scale?: number;
    dimension?: GPUTextureDimension;
    /** mip levels; 'full' = down to 1×1 */
    mips?: number | 'full';
    samples?: number;
    usage?: TexUse[];
    /** view dimension for the default view ('cube' for a 6-layer cubemap) */
    view?: GPUTextureViewDimension;
}
export declare class Texture implements Resource {
    private kit;
    readonly desc: TextureDesc;
    readonly uid: number;
    private v;
    gpu: GPUTexture;
    width: number;
    height: number;
    layers: number;
    mips: number;
    samples: number;
    label: string;
    readonly format: GPUTextureFormat;
    readonly usage: number;
    /** freed for good (destroy): a resize no longer reallocates it */
    destroyed: boolean;
    private views;
    constructor(kit: Kit, desc: TextureDesc);
    /** bumped whenever its GPU texture is replaced (and kit.resourceGen with it, so bind groups are checked again) */
    get version(): number;
    set version(n: number);
    get relative(): boolean;
    /** size this texture wants right now */
    wanted(): [number, number, number];
    /** (re)allocate if the wanted size changed; returns true when it did */
    alloc(): boolean;
    /** a view, cached per descriptor until the texture is reallocated */
    view(d?: GPUTextureViewDescriptor): GPUTextureView;
    /** a bindable/attachable view of one mip level (and optionally one layer) */
    mip(level: number, layer?: number): TexView;
    layer(i: number): TexView;
    get unfilterable(): boolean;
    /** upload pixels (rows tightly packed unless bytesPerRow is given) */
    write(data: ArrayBufferView, o?: {
        mip?: number;
        layer?: number;
        width?: number;
        height?: number;
        bytesPerRow?: number;
        origin?: [number, number];
    }): this;
    /** copy an image in (a canvas, an ImageBitmap, a video frame…): all of it at the origin, or a part of it
     *  (`from`: its x, y; `size`: how much) at `origin`. `premultiply`: alpha multiplied in, as filtering and mips want
     *  for anything with transparent edges (text, sprites); `flipY` turns it upside down. The texture needs 'copy-dst'
     *  and 'render' in its usage (the browser renders the copy). */
    writeImage(source: GPUCopyExternalImageSource, o?: {
        from?: [number, number];
        size?: [number, number];
        origin?: [number, number];
        mip?: number;
        layer?: number;
        premultiply?: boolean;
        flipY?: boolean;
    }): this;
    /** copy one mip level back to the CPU (rows tightly packed) */
    read(mip?: number, layer?: number): Promise<ArrayBuffer>;
    private stagings;
    private probes;
    /** one texel back to the CPU without stalling the frame: what the GPU last drew there, a frame or two later (null
     *  outside the texture). Its staging buffers are pooled, so picking or a cursor's depth can ask every frame. The
     *  texture needs 'copy-src' in its usage (a depth texture is read depth-only). */
    readTexel(x: number, y: number, o?: {
        mip?: number;
        layer?: number;
    }): Promise<ArrayBuffer | null>;
    /** bytes it holds on the GPU: every mip of every layer, times its samples (block-compressed formats are estimated) */
    get bytes(): number;
    /** free it for good: it leaves kit.textures, so a resize doesn't reallocate it */
    destroy(): void;
}
/** a specific view of a texture (one mip, one layer…) usable as a binding or an attachment */
export declare class TexView {
    readonly texture: Texture;
    readonly desc: GPUTextureViewDescriptor;
    private id;
    constructor(texture: Texture, desc: GPUTextureViewDescriptor);
    get view(): GPUTextureView;
    get key(): string;
    /** a number per distinct description: views of equal descriptions share it (so they bind alike) */
    get descId(): number;
}
export declare function bytesPerPixel(f: GPUTextureFormat): number;
/** two resources that trade places: `read` / `write` are refs resolved when bound; `swap` is a run item */
export declare class PingPong<T> {
    readonly a: T;
    readonly b: T;
    private parity;
    readonly read: Ref<T>;
    readonly write: Ref<T>;
    readonly swap: RunAction;
    constructor(a: T, b: T, label?: string);
    get current(): T;
    get next(): T;
    flip(): void;
}
/** a CPU step inside a run list (it runs at that point of the encoding order) */
export declare class RunAction {
    readonly fn: () => void;
    readonly label: string;
    enabled: boolean;
    constructor(fn: () => void, label?: string);
}
//# sourceMappingURL=resources.d.ts.map