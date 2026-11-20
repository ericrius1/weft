import { type Kit, type RunEntry, type StorageBuffer, type Texture, type UniformBuffer, type PingPong } from '@ericrius1/weft';
export interface LavaVent {
    /** its mouth (world x, z), radius (m), and how much it gives (m3/s) */
    x: number;
    z: number;
    radius: number;
    rate: number;
}
export interface LavaLake {
    x: number;
    z: number;
    level: number;
    radius: number;
}
export interface LavaOptions {
    /** cells a side (a multiple of 32) and a cell's size (m) */
    n: number;
    cell: number;
    /** the grid's corner (world x, z: its least x and z) */
    corner: [number, number];
    vents?: LavaVent[];
    lake?: LavaLake | null;
    /** substeps a frame, and how much faster than the wall's clock the lava goes (it's slow: a film's speed-up) */
    substeps?: number;
    speed?: number;
    /** the tiles' detail by distance: full within `near` m, half within `mid` m, a quarter beyond */
    near?: number;
    mid?: number;
}
/** the solver's knobs (shaders/lava.wgsl LavaU): the defaults are a basaltic flow's, hurried */
export interface LavaTune {
    /** the hot lava's mobility, and how many e-folds it falls by as it cools to nothing */
    mobility: number;
    stiffen: number;
    /** freezing: the heat it turns to rock below, and how fast (1/s) */
    freeze: number;
    freezeRate: number;
    /** the rock's cooling (1/s) and its wearing away once cold (m/s: the land's own coming back, so the flows don't pile
     *  up for ever) */
    rockCool: number;
    wear: number;
    /** heat lost a second, and more the thinner the sheet */
    cool: number;
    coolThin: number;
    /** the yield's thickness on a gentle slope, and its rise as the lava cools */
    yield: number;
    yieldCool: number;
}
export declare const LAVA_TUNE: LavaTune;
export declare const TILE = 32;
export declare class LavaFlow {
    readonly kit: Kit;
    readonly n: number;
    readonly cell: number;
    readonly corner: [number, number];
    readonly U: UniformBuffer<any>;
    readonly bed: StorageBuffer;
    readonly st: PingPong<StorageBuffer>;
    readonly fl: StorageBuffer;
    readonly probeBuf: StorageBuffer;
    readonly glow: Texture;
    readonly args: StorageBuffer;
    readonly lists: StorageBuffer;
    readonly tiles: number;
    vents: LavaVent[];
    lake: LavaLake | null;
    tune: LavaTune;
    substeps: number;
    speed: number;
    near: number;
    mid: number;
    /** off: nothing steps (the state stays as it is) */
    on: boolean;
    /** what's at the eye's cell (read back a few frames late): the lava's thickness, heat, the rock under it, the bed,
     *  the lava's top there (world y) and the highest top in the 3x3 round it (-1e9: none) */
    readonly at: {
        h: number;
        T: number;
        s: number;
        w: number;
        bed: number;
        top: number;
        near: number;
    };
    private items;
    private stepItems;
    private finish;
    private t;
    private reading;
    private frameN;
    private bedData;
    private bufs;
    constructor(kit: Kit, o: LavaOptions);
    /** the land's heights at the cells (world x, z -> y): at load, and again when the land under the lava comes finer */
    setBed(height: (x: number, z: number) => number): void;
    /** the land's height the solver has at a cell's (x, z) */
    bedAt(x: number, z: number): number;
    /** all of it cleared: no lava, no rock (a film's start) */
    clear(): void;
    /** the grid's middle and half its size (m) */
    get middle(): [number, number];
    get half(): number;
    /** whether (x, z) is on the grid */
    covers(x: number, z: number): boolean;
    update(dt: number, eye: ArrayLike<number>): void;
    /** the items to run before the host's scene: the substeps, then what the draws and the host read */
    compute(): RunEntry[];
    /** every pipeline it declared (await kit.ready(lava.pipelines) before a bake) */
    get pipelines(): RunEntry[];
}
//# sourceMappingURL=lava.d.ts.map