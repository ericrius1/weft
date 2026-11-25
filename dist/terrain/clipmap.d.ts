import type { Kit, Pack, Texture } from '@ericrius1/weft';
export type LayerKind = 'height' | 'color' | 'mat';
/** the slots a level may have (8x8: the uniform's room) */
export declare const MAX_SLOTS = 64;
/** the levels the residency uniform has: heights 0-3, colour 4-7, surface classes 8 */
export declare const MAX_LEVELS = 9;
/** what the clipmap asks of the world's streamer (San Francisco's util/stream.ts Streamer is one) */
export interface ClipStream {
    /** the camera's motion (m/s): a fast camera's road ahead is fetched early */
    readonly view: {
        vx: number;
        vz: number;
    };
    /** optional hysteresis-gated fast-flight state */
    readonly fast?: boolean;
    /** optional estimated network latency (s) for velocity-aware prefetch horizons */
    readonly latencyS?: number;
    /** the queue's order for a square (`cx`, `cz` its middle, `half` its half side, `scale` how much detail it adds,
     *  optional `tGone` seconds until the tile leaves the window): lower is sooner, Infinity drops it */
    rank(cx: number, cz: number, half: number, scale: number, tGone?: number): number;
    /** a tile's bytes (null: there's no tile; undefined: dropped or failed), asked at `prio` (Infinity: let go) */
    get(pack: Pack, r: number, c: number, prio: () => number): Promise<ArrayBuffer | null | undefined>;
    /** whether `bytes` more may go up to the GPU this frame (the frame's allowance; taken if so) */
    upload(bytes: number): boolean;
    /** whether a tile's bytes are here already (a cache) */
    cached(pack: Pack, r: number, c: number): boolean;
    /** a tile fetched into the cache at `prio` (Infinity: moot) */
    prefetch(pack: Pack, r: number, c: number, prio: () => number): void;
    /** the most tiles of a pack fetched in one request (a level's window, or its whole grid) */
    width(pack: Pack, most: number): void;
}
/** the world's decoders (off the main thread, ideally): a height tile's u16 planes to metres (`q`: metres = q[0] +
 *  v * q[1]), a surface-class tile's deflated rgba8 */
export interface ClipDecode {
    height(bytes: ArrayBuffer, tile: number, q: [number, number]): Promise<Float32Array>;
    mat(bytes: ArrayBuffer): Promise<Uint8Array>;
}
export interface ClipOptions {
    /** the height levels' packs, finest first (up to 4), the colour levels' (up to 4), the surface classes' */
    heights: string[];
    colors: string[];
    mat?: string;
    /** a pack by name (weft: `(n) => Pack.load(assets, n)`) */
    load: (name: string) => Promise<Pack>;
    decode: ClipDecode;
    /** the heights where a pack has no fill of its own and there's no tile (m): 0 */
    fill?: number;
    /** a fast camera's road ahead: above `speed` (m/s), every `every` ms, `seconds` ahead (at most `reach` m / speed), on
     *  the levels of `texel` m or finer (25, 400, 4, 1500, 4) */
    ahead?: {
        speed?: number;
        every?: number;
        seconds?: number;
        reach?: number;
        texel?: number;
    };
}
/** one level's window */
export declare class ClipLevel {
    readonly set: ClipSet;
    readonly kind: LayerKind;
    readonly layer: number;
    readonly index: number;
    readonly pack: Pack;
    readonly window: number;
    readonly shrink: number;
    readonly n: number;
    readonly grid: number;
    readonly texel: number;
    readonly half: number;
    readonly tile: number;
    /** the window's first tile (column, row) */
    c0: number;
    r0: number;
    /** what's in (x0, z0, x1, z1, m), and the rect drawn: eased toward it */
    rect: [number, number, number, number];
    shown: [number, number, number, number];
    readonly blend: number;
    /** a whole level (its window is its grid): never moves */
    readonly whole: boolean;
    /** how much detail a tile adds, for the queue (ClipStream rank) */
    readonly scale: number;
    /** the coarsest of the heights' or the colours' levels: asked a little ahead of the rest */
    readonly coarsest: boolean;
    private slots;
    placed: boolean;
    /** smoothed velocity window bias (tiles) so fast flight places more runway ahead without oscillating */
    private bx;
    private bz;
    private lastX;
    private lastZ;
    /** true when camera forward is roughly aligned with horizontal velocity (or forward wasn't supplied) */
    private aligned;
    /** persistent forward prefetch capsule tile ids (r * grid + c) kept alive without round-ID churn */
    private capsule;
    /** when true (high-speed LOD), this level pauses new fetches and gently fades its rect out */
    paused: boolean;
    constructor(set: ClipSet, kind: LayerKind, layer: number, index: number, pack: Pack, window: number, shrink: number, levels?: number);
    /** the uniform: texel (m), window (px), half extent (m), blend (m) */
    get uniform(): [number, number, number, number];
    /** the residency uniform's per-level part: a tile's size (m), the window's tiles a side, the grid's */
    get tileInfo(): [number, number, number, number];
    /** a world point's tile coordinates (fractional) */
    private tileOf;
    /** centered window's first tile for an arbitrary target point (x, z) (used for prefetch) */
    private windowCentered;
    /** the window's first tile for a camera at (x, z), shifted ahead along smoothed velocity when flying fast */
    windowAt(x: number, z: number): [number, number];
    private updateBias;
    /** a tile's middle and half its side (m) */
    middle(r: number, c: number): [number, number, number];
    /** seconds until tile (r, c) exits the trailing edge of this shifted window along current velocity */
    private tGoneOf;
    /** the queue's order for a tile of this level (Infinity once the window's let it go) */
    prio(r: number, c: number): number;
    /** follow the camera: slide the window when the velocity-biased centre leaves the middle tile */
    follow(x: number, z: number, dt?: number, fx?: number, fz?: number, rawDt?: number): void;
    /** snap only trailing edges of `shown` that shrank behind velocity while looking forward and keeping eye inside `shown` */
    private snapTrailing;
    /** whether (r, c) is still this window's, in its slot */
    wants(r: number, c: number): boolean;
    /** whether a tile's data may be written over its slot's now: the slot's old tile is out of the drawn rect */
    canPut(r: number, c: number): boolean;
    /** a tile's data is in its slot now: it starts fading in */
    put(r: number, c: number, data?: Float32Array): void;
    /** a tile that couldn't be had: asked again on the next follow */
    failed(r: number, c: number): void;
    /** the fades and the rect's easing, a frame on; whether anything's still moving */
    tick(dt: number, eyeX?: number, eyeZ?: number): boolean;
    /** the slots' residency for the shader: (tile + 1) << 8 | fade, row by row of the window's slots */
    residency(out: Uint32Array, at: number): void;
    /** the rect that's in: tight bounding box of loaded tiles inside the active window (per-tile tileFade + neighbor
     *  guard in clipmap.wgsl blends individual unloaded tiles cleanly without collapsing a whole row on one corner tile) */
    private measure;
    /** exact shader levelWeight (rectWeight * tileFade with neighbor guard) at world point (x, z), for telemetry */
    fadeAt(x: number, z: number): number;
    /** the share of the window's tiles in */
    get progress(): number;
    /** a height from the CPU's copy (NaN where it's not in, or faded out while paused) */
    heightAt(x: number, z: number): number;
    /** maintain a persistent forward prefetch capsule along velocity with hysteresis (no 200 ms round-ID churn) */
    updateCapsule(x: number, z: number, reach: number, seconds: number): void;
    /** the window round (x, z)'s tiles that aren't here or in the cache, fetched into it (a flight's destination, the
     *  road ahead); `live` says when it's moot; `fromTarget` ranks center-out around `(x, z)` for destinations */
    prefetch(x: number, z: number, live: () => boolean, fromTarget?: boolean): void;
}
/** the uniform fields `fill` writes (a world's own struct may hold more) */
export interface ClipUniform {
    hLevel: number[][];
    hRect: number[][];
    cLevel: number[][];
    cRect: number[][];
    mLevel: number[];
    mRect: number[];
    tileInfo?: number[][];
    tileSlots?: Uint32Array;
}
/** every level of every layer, and what they stream through */
export declare class ClipSet {
    readonly kit: Kit;
    readonly stream: ClipStream;
    readonly heightWindow: number;
    readonly colorWindow: number;
    readonly heights: Texture;
    readonly colors: Texture;
    readonly mats: Texture;
    readonly h: ClipLevel[];
    readonly c: ClipLevel[];
    m: ClipLevel | null;
    /** decoded tiles waiting for their upload (the frame's allowance, their slot let go of) */
    private ready;
    private inflight;
    /** tiles written in all (a terrain's bounds are measured again where they changed: `changed`) */
    version: number;
    /** the squares (x0, z0, x1, z1) of the height tiles written since the terrain last looked */
    changed: [number, number, number, number][];
    /** the residency of every level's slots (clipmap.wgsl clipTileSlot) */
    readonly slots: Uint32Array<ArrayBuffer>;
    /** whether a level is still fading or easing (the uniform's rewritten while so) */
    fades: boolean;
    /** new tiles in at once, no fade (the first view, behind a splash) */
    instant: boolean;
    decode: ClipDecode;
    fill0: number;
    ahead0: {
        speed: number;
        every: number;
        seconds: number;
        reach: number;
        texel: number;
    };
    private lastTick;
    private aheadAt;
    private dest;
    /** freed for good (dispose) */
    disposed: boolean;
    constructor(kit: Kit, stream: ClipStream, heightWindow: number, colorWindow: number);
    /** the textures and every level, once the packs' indexes are in (a pack that isn't there: its level left out) */
    static create(kit: Kit, stream: ClipStream, heightWindow: number, colorWindow: number, o: ClipOptions): Promise<ClipSet>;
    get levels(): ClipLevel[];
    /** free it for good (a world leaving this land): its three textures destroyed, the tiles waiting for their upload
     *  let go, and with its levels the heights it kept on the CPU. Tiles still being fetched or decoded are dropped as
     *  they land (no level wants them any more: the streamer is given Infinity for their priority). After it follow()
     *  does nothing, heightAt() answers as where no level is in, and fill() writes empty levels. What binds its
     *  textures (a shared group, a terrain's draws) is the world's to rebind or dispose, before this */
    dispose(): void;
    /** each frame: the windows follow the camera, the decoded tiles go up (within the frame's allowance), the fades
     *  move on; and the road ahead of a fast camera prefetched */
    follow(x: number, z: number, fx?: number, fz?: number): void;
    /** the land round a place fetched ahead of arriving there (a flight's destination): until the next, or 30 s */
    prefetch(x: number, z: number): void;
    /** a tile asked of the streamer, decoded, and queued for its upload */
    request(L: ClipLevel, r: number, c: number): void;
    private queue;
    /** the decoded tiles up, nearest the view first, as many as the frame's allowance takes; a slot whose old tile's
     *  still drawn waits for the rect to ease off it (a second and a half at most) */
    private upload;
    /** the ground's height at (x, z): the finest height level that's in there */
    heightAt(x: number, z: number): number;
    /** the uniforms clipmap.wgsl and a terrain read: per level its uniform and its drawn rect, the residency */
    fill(u: ClipUniform): void;
    /** the share of every window that's in */
    get progress(): number;
    /** the share of the coarse land in: each kind's coarsest level (whole, over everything, but on a phone's small
     *  windows; the rest's wanted by what's in view: ClipStream rank) */
    get coarse(): number;
    /** tiles fetched and waiting to be decoded or uploaded */
    get waiting(): number;
    /** tiles still to come: asked, decoding, or waiting for their upload */
    get pending(): number;
}
//# sourceMappingURL=clipmap.d.ts.map