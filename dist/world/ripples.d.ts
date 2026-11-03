import { Ref, type Kit, type RunEntry, type Texture, type V3 } from '@ericrius1/weft';
/** the default window: cells across, metres a cell */
export declare const RIPPLE_N = 256;
export declare const RIPPLE_CELL = 0.22;
export interface RippleOptions {
    /** cells across (a multiple of 16) */
    n?: number;
    /** metres a cell */
    cell?: number;
}
export declare class Ripples {
    private kit;
    private heights;
    private half;
    /** the published texture (the env group's rippleTex: it follows a `configure`) */
    readonly out: Ref<Texture>;
    private f;
    private impulses;
    private u0;
    private u1;
    private pending;
    private buf;
    private acc;
    private origin;
    private clear;
    private list;
    private quiet;
    /** cells across, metres a cell (configure changes them) */
    n: number;
    cell: number;
    /** running this frame */
    active: boolean;
    /** the player this far above the water (m) or nearer keeps it running; with nothing pushed for `settle` s further
     *  off it rests */
    reach: number;
    settle: number;
    /** damping (1/s), how long foam lasts (s to fade to a third), the viscosity that takes the shortest waves, how long a
     *  crest's whitecap lasts (s), the largest height (m) */
    damping: number;
    foamLife: number;
    viscosity: number;
    crestLife: number;
    maxHeight: number;
    private seaLevel;
    constructor(kit: Kit, heights: Texture, half: number, o?: RippleOptions);
    private build;
    /** a new window: cells across (a multiple of 16), metres a cell; the water starts still */
    configure(o: RippleOptions): void;
    /** the window's extent [x0, z0, size] (m) */
    get window(): [number, number, number];
    /** a round impulse: m of height at its middle (negative a dent, positive a heap) over a radius (m); the foam it
     *  leaves (by default none: a drop, a step; churned water makes its own) */
    splash(x: number, z: number, amount: number, radius: number, foam?: number): void;
    /** the same along a line from (x, z) to (x2, z2): a crest or a trough the length of it; how much of its foam is a
     *  breaking crest's whitecap, there only a moment (0..1) */
    line(x: number, z: number, x2: number, z2: number, amount: number, radius: number, foam?: number, crest?: number): void;
    /** (the old API) push the water at x, z: radius (m), strength (m; negative pushes it down) */
    push(x: number, z: number, radius: number, strength: number): void;
    /** follow `centre` on the water at `seaLevel`, take this frame's impulses; returns world.ripple (the window's centre,
     *  size and texels; far off when resting, so rippleAt reads flat) */
    update(centre: V3, dt: number, seaLevel?: number): [number, number, number, number];
    items(): RunEntry[];
}
//# sourceMappingURL=ripples.d.ts.map