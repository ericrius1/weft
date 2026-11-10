/** a small seeded generator (mulberry32) */
export declare function rng(seed: number): () => number;
export declare const hash3: (a: number, b: number, c: number) => number;
export declare function smooth(a: number, b: number, x: number): number;
/** a deck: cover 0..1, base and thickness (m), optical depth at full density, the noise's tile (m), lumpy (0 a smooth
 *  sheet .. 1 separate cells), streak (0 .. 1 fibres along the wind), halo (a 22-degree ring: cirrostratus);
 *  `band`: the deck only downwind of [edge (m along the wind from the origin), feather (m)] — the chinook arch, the
 *  clear slot over the mountains upwind of it; `patches`: broken into stretches of cloud with open sky between (the
 *  Highland's altocumulus) rather than Boulder's even partial cover; `bright` its diffuse light's scale; `offset` its
 *  own place in the noise */
export interface LayerSpec {
    cover: number;
    base: number;
    thick: number;
    tau: number;
    scale: number;
    lumpy: number;
    streak: number;
    halo: number;
    band?: [number, number];
    patches?: boolean;
    bright?: number;
    offset?: number;
}
export type DeckSlot = 'low' | 'mid' | 'high' | 'wave';
export declare const DECK_SLOTS: readonly DeckSlot[];
export interface SkyRecipe {
    /** the wind aloft (m/s, x east, z south): what the clouds drift on */
    wind: [number, number];
    /** the heaps' grid (m) and how far they reach round the camera (m; default SkyClouds' range) */
    cell?: number;
    range?: number;
    /** cumulus: candidates a cell, base (m), width range (m), height over width, darkness; the share that trail virga;
     *  how much they favour high ground (0 not at all .. 1 only there) and what counts as high (m: none .. fully); the
     *  slow field that gathers them into patches (its floor and swing); a cloud's life (s: the shortest .. longest) */
    cumulus: {
        cover: number;
        base: number;
        size: [number, number];
        tall: [number, number];
        dark: number;
        virga?: number;
        hills?: number;
        high?: [number, number];
        patch?: [number, number];
        life?: [number, number];
        /** Boulder's heaps: more puffs to a heap at the least */
        full?: boolean;
    } | null;
    /** low wisps: candidates a cell, base range (m), width range (m), opacity */
    fractus: {
        cover: number;
        base: [number, number];
        size: [number, number];
        alpha: number;
    } | null;
    /** towering cumulus on a coarser grid: the chance a cell has one, base, width range, height over width, the chance one
     *  trails rain; the chance it's grown into a storm (cumulonimbus), its top and width; never within `clear` m of the
     *  origin in its prime (a valley kept out from under them); the grid (m) and its reach (m) */
    towers: {
        chance: number;
        base: number;
        size: [number, number];
        tall: [number, number];
        rain: number;
        storm: number;
        stormTop: number;
        stormSize?: [number, number];
        clear?: number;
        cell?: number;
        range?: number;
        full?: boolean;
    } | null;
    /** lenticular caps: how many; over the highest peaks (`peaks`: the ground's, `above` m over the summit, peaks over
     *  `peak` m) or a wave train `upwind` of the origin (`base` m, Boulder's Front Range stacks, kilometres long); seen
     *  out to `reach` m */
    lenses: {
        count: number;
        at: 'peaks';
        above: [number, number];
        peak?: number;
        reach?: number;
    } | {
        count: number;
        at: 'upwind';
        base: number;
        reach?: number;
    } | null;
    /** the decks */
    layers: Partial<Record<DeckSlot, LayerSpec | null>>;
    /** loom's cirrus (its sky shader's high ice cloud): cover 0..1 */
    cirrus: number;
    /** how firmly painted (0 Boulder's soft photographic heaps .. 1 a gouache cumulus's firm edge and two tones) */
    paint?: number;
}
export declare const SKY_KINDS: readonly ["highland", "clear", "fair cumulus", "towering cumulus", "thunderstorm", "stratocumulus", "altocumulus", "cirrus", "chinook", "overcast", "altostratus"];
export type SkyKind = typeof SKY_KINDS[number];
/** Drake's Highland: a late-summer afternoon over an 8 km glen in a ring of 700–1400 m mountains — fair cumulus building
 *  over the hills, wisps in the glens, towers far off, caps over the peaks, a patch of altocumulus high over it all */
export declare const HIGHLAND: SkyRecipe;
/** a sky of a kind: Boulder's recipe for it (its weather.ts), varied by the seed as its days are — the same seed, the
 *  same sky. Boulder's heights were over its site; here they're world y over ground near sea level. */
export declare function skyRecipe(kind: SkyKind, seed?: number): SkyRecipe;
export declare function copyRecipe(r: SkyRecipe): SkyRecipe;
/** a puff on its cloud: its offset from the centre of the cloud's base, radius, its own seed, how far up it sits (the
 *  order the puffs come in as the cloud grows), its kind (0 puff, 2 rain), a rain sheet's length, an anvil's flat top */
export interface PuffDef {
    dx: number;
    dy: number;
    dz: number;
    r: number;
    seed: number;
    rel: number;
    kind: number;
    len: number;
    ceil?: number;
}
/** a cloud in the drifted sky: where in it, its base and size, its darkness, its puffs, an anvil (1) or not, how fast it
 *  moves with the wind, how opaque (a wisp is thin) */
export interface CloudDef {
    x: number;
    z: number;
    base: number;
    w: number;
    h: number;
    dark: number;
    puffs: PuffDef[];
    anvil: number;
    drift: number;
    alpha: number;
}
/** a lenticular plate: centre, semi-axes (a along its length, b up, c across), yaw, optical depth, seed; smooth (Boulder's
 *  long wave clouds) or frayed (a cap over a peak) */
export interface Lens {
    x: number;
    z: number;
    y: number;
    a: number;
    b: number;
    c: number;
    yaw: number;
    tau: number;
    seed: number;
    smooth: boolean;
}
/** a cumulus heap: broad puffs across the base, their bottoms cut flat by the condensation level, then a lumpy crown
 *  piled toward the middle; `rel` is how far up each sits (the order they come in as it grows). `full`: Boulder's
 *  counts (a puff more at the least) */
export declare function heap(c: CloudDef, r: () => number, full?: boolean): void;
/** a ragged wisp (fractus): a few small puffs strung out along the wind, no crown, a thin flat-ish body */
export declare function wisp(c: CloudDef, r: () => number, wind: [number, number]): void;
/** a cumulonimbus: a broad dark base, a column of billows to the top, an anvil spread flat downwind (`full`: Boulder's
 *  counts, for its bigger storms) */
export declare function tower(c: CloudDef, r: () => number, wind: [number, number], full?: boolean): void;
/** rain or virga: sheets hanging from under the base */
export declare function virga(c: CloudDef, r: () => number, count: number, len: number, width: number): void;
/** the land under the sky, coarsely: each point's highest ground within a few hundred metres (a cloud drifting over a
 *  ridge is lifted clear of it, smoothly), and the peaks over `peak` m (where the caps stand), highest first */
export declare class Ceiling {
    private ground;
    readonly half: number;
    private n;
    private step;
    private g;
    private raw;
    constructor(ground: ((x: number, z: number) => number) | null, half: number, n?: number);
    /** the peaks: local maxima over ~600 m round, over `min` m, high ones first, kept 1800 m apart (the ring's summits
     *  stand near the map's edge: neighbours past it don't count) */
    peaks(min?: number): [number, number, number][];
    /** the highest ground near (x, z) (beyond the map: the edge's; no ground: far below everything) */
    at(x: number, z: number): number;
    /** the highest ground under a cloud's footprint (its middle and four points round it) */
    under(x: number, z: number, rad: number): number;
}
//# sourceMappingURL=skies.d.ts.map