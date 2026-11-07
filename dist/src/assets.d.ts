export interface AssetsOptions {
    /** the folder the files are under (default: `assets` beside the page, whatever path it's served at; '/assets' in a
     *  worker) */
    root?: string;
    /** the manifest under root mapping a path to where it really is (default 'remote.json'; null: none, everything's
     *  beside the app) */
    manifest?: string | null;
    /** a Cache Storage name to keep the content-addressed objects in (null, the default: the HTTP cache only). Name it
     *  for the app: several apps can share an origin (ericlevin.dev), and forgetExcept clears what this one doesn't use */
    keep?: string | null;
    /** what the page already asked for before the bundle ran (a build's index.html: plugin/vite.ts earlyFetch), path →
     *  its fetch; each taken once, by init (the manifest) or a plain fetch(rel) — e.g. `globalThis.__early` */
    early?: Record<string, Promise<Response | null>> | null;
}
/** a content-addressed object's URL: objects/<sha256>/<name> (it never changes, so it can be kept) */
export declare const isLasting: (url: string) => boolean;
/** fetch, through Cache Storage `cache` for a content-addressed object (any other URL, or no Cache Storage: as usual) */
export declare function fetchKept(url: string, init: RequestInit | undefined, cache: string | null): Promise<Response>;
export declare class Assets {
    readonly root: string;
    readonly keep: string | null;
    /** path under root → its URL (the manifest; empty until init, or with none) */
    remote: Record<string, string>;
    private manifest;
    private early;
    constructor(opts?: AssetsOptions);
    /** the page's early fetch of `rel`, once (null: none, or already taken) */
    takeEarly(rel: string): Promise<Response | null> | null;
    /** read the manifest (revalidated every load: a map cached from the last deploy would send moved files to this one's
     *  404s). None, or not JSON (a dev server's index.html fallback): everything's beside the app */
    init(): Promise<this>;
    /** the URL of a file under root */
    url(rel: string): string;
    /** a file (a range's 206 counts as there); throws with its path and status when it isn't */
    fetch(rel: string, init?: RequestInit): Promise<Response>;
    json<T>(rel: string): Promise<T>;
    bytes(rel: string): Promise<ArrayBuffer>;
    /** let go of the kept objects this deploy doesn't use (default: everything the manifest names is kept) */
    forgetExcept(keep?: Iterable<string>): Promise<void>;
}
/** zlib-deflated bytes inflated by the browser's own decompressor (`format` 'gzip' or 'deflate-raw' for those) */
export declare function inflate(b: ArrayBuffer | Uint8Array, format?: 'deflate' | 'gzip' | 'deflate-raw'): Promise<Uint8Array>;
/** a pack's index: its tiles' grid and each tile's byte range in the pack (row-major over the grid; length 0: no tile
 *  there), and the pack's file name beside the index */
export interface PackIndex {
    name: string;
    file: string;
    grid: number;
    offsets: number[];
    lengths: number[];
    /** what the tiles are (an app's own names: San Francisco's 'h16', 'rgba8', 'webp') */
    codec?: string;
}
/** a terrain layer's pack (San Francisco's pipeline/tiles.py): a level of a clipmap, its tiles `tile` texels a side at
 *  `texel` metres, the grid centred on the origin out to `half` metres */
export interface TileIndex extends PackIndex {
    /** 'h16' (heights: u16 planes, deflated: decodeH16), 'rgba8' (deflated bytes), 'webp' (an image) */
    codec: 'h16' | 'rgba8' | 'webp';
    half: number;
    texel: number;
    tile: number;
    /** heights: metres = q[0] + v * q[1] */
    q?: [number, number];
    /** the value where there's no tile (heights: the open sea's floor) */
    fill?: number;
}
export declare class Pack<I extends PackIndex = TileIndex> {
    readonly index: I;
    readonly url: string;
    /** tries after the first before a tile's fetch gives up, and the first wait between them (ms, doubling) */
    retries: number;
    backoff: number;
    constructor(index: I, url: string);
    /** a pack by its index's name: <dir>/<name>.json, the pack beside it */
    static load<I extends PackIndex = TileIndex>(assets: Assets, name: string, dir?: string): Promise<Pack<I>>;
    /** whether there's a tile at (row, col) */
    has(r: number, c: number): boolean;
    /** a tile's bytes (null where there's none); aborted with `signal`, retried on a network error or a bad status */
    bytes(r: number, c: number, signal?: AbortSignal): Promise<ArrayBuffer | null>;
    /** a run of the pack's bytes, `n` from `a` (a block of neighbouring tiles in one request: San Francisco's streamer
     *  fetches a row's run of tiles at once), retried like a tile */
    range(a: number, n: number, signal?: AbortSignal): Promise<ArrayBuffer>;
}
/** an h16 height tile's metres (n×n): deflated; two planes, the high bytes' then the low's, of u16s each predicted from
 *  the one before it in its row (a row's first from the one above it), the difference zig-zagged */
export declare function decodeH16(b: ArrayBuffer | Uint8Array, n: number, q: [number, number]): Promise<Float32Array>;
/** decodeH16's second half, on bytes already inflated */
export declare function unpackH16(raw: Uint8Array, n: number, q: [number, number]): Float32Array;
/** the inverse of unpackH16 (before deflating): u16 values (0..65535) to the two planes — for tests and tools */
export declare function packH16(v: ArrayLike<number>, n: number): Uint8Array;
//# sourceMappingURL=assets.d.ts.map