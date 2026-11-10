import { type Quat } from 'math';
import type { Physics, b3BodyId, b3ShapeId } from '../physics/box3d';
import type { Pieces, Piece } from '../render/pieces';
import { type Poly } from './convex';
type V3 = [number, number, number];
export interface Material {
    name: string;
    /** shader material id (0..127) */
    id: number;
    density: number;
    friction: number;
    restitution: number;
    /** a bond's strength: joules per m² of contact */
    bond: number;
    /** a cell's toughness: joules per m³ before it shatters (plus a floor) */
    tough: number;
    /** fragments per break */
    shards: [number, number];
    /** fragment shape bias in the cell's own axes (wood splinters along its length) */
    stretch?: V3;
    /** below this size (m) a piece is debris: it won't break again, and fades away */
    minSize: number;
    color: V3;
    /** cells one anchored cell can hold up */
    load: number;
    /** blows up when it breaks (joules) */
    explosive?: number;
}
export interface CellSpec {
    /** a box (half extents) or any convex polyhedron, in the cell's own frame round its centre */
    half?: V3;
    poly?: Poly;
    mat: Material;
    p: V3;
    q?: V3 | Quat;
    tint?: V3;
    /** where its texture comes from (material space: default its position) */
    m0?: V3;
    /** held to the ground whatever its height (a bridge's pier standing in the sea) */
    anchor?: boolean;
}
export interface Bond {
    a: Cell;
    b: Cell;
    hp: number;
    hp0: number;
    area: number;
    mark: number;
}
export interface Cell {
    id: number;
    poly: Poly;
    half: V3 | null;
    mat: Material;
    vol: number;
    size: number;
    radius: number;
    body: RBody | null;
    shape: b3ShapeId | null;
    /** in its body's frame */
    lp: V3;
    lq: Quat;
    /** in the world, now */
    wp: V3;
    wq: Quat;
    piece: Piece | null;
    m0: V3;
    tint: V3;
    bonds: Bond[];
    /** hold on the ground (0: none) */
    ground: number;
    hp: number;
    hp0: number;
    debris: boolean;
    /** small enough not to collide with other small things (shards pass through each other; they still land) */
    small: boolean;
    /** when it goes (debris), its fade */
    die: number;
    fade: number;
    heat: number;
    dmgShown: number;
    mark: number;
    born: number;
    /** cells this anchor held up as built (the load rule's yardstick) */
    load0: number;
    /** made by a break (not built) */
    frag?: boolean;
    /** its corners (its own frame), found once */
    verts: V3[];
}
export interface RBody {
    id: b3BodyId;
    key: number;
    cells: Set<Cell>;
    dynamic: boolean;
    p: V3;
    q: Quat;
    wet: boolean;
    born: number;
}
export interface RubbleEvent {
    kind: 'crack' | 'shatter' | 'detach' | 'dust' | 'splash' | 'boom' | 'impact';
    p: V3;
    mat: Material;
    /** size (m) or count, energy (J) */
    size: number;
    energy: number;
    /** fragments (shatter) */
    n?: number;
}
export declare class Rubble {
    readonly phys: Physics;
    readonly pieces: Pieces;
    cells: Set<Cell>;
    bodies: Map<number, RBody>;
    private byShape;
    events: RubbleEvent[];
    /** the ground's height (cells standing on it are anchored) and the sea's (below it things splash and sink) */
    groundY: number;
    seaY: number;
    /** cells that won't shatter (one being carried) */
    protect: Set<Cell>;
    /** cells allowed before debris is hurried away */
    budget: number;
    /** pieces smaller than this (m) don't collide with each other, sleep sooner and fade in seconds */
    smallSize: number;
    /** how hard impacts break things (energy multiplier), and the least energy that does anything */
    impactK: number;
    minImpact: number;
    /** the least approach speed (m/s) that breaks anything: a heavy thing settling is a bump, not a crash */
    minSpeed: number;
    /** the reach of a hit's damage (m, at most), and a blast's (least, most) and its push (impulse per m², at most) */
    maxRadius: number;
    blastMin: number;
    blastMax: number;
    blastPush: number;
    /** cells in moving bodies (the debris budget counts these: what stands costs nothing per frame) */
    dynCells: number;
    /** what a break may make: fragments a frame (past it, the small ones go to dust), most fragments a cell, fragments
     *  added per metre of the cell's size; moving bodies fall asleep below this speed (m/s; 0: box3d's own); past the
     *  budget, fragments under this size are hurried away too, not just the debris */
    fragsPerFrame: number;
    maxShards: number;
    sizeShards: number;
    sleepSpeed: number;
    crowdSize: number;
    /** a part that came loose (its new body, its cells) — the game may push it over */
    onDetach: ((rb: RBody, comp: Cell[], from: RBody) => void) | null;
    time: number;
    /** what's been broken: the game's score */
    stats: {
        bonds: number;
        shattered: number;
        detached: number;
        fragments: number;
        value: number;
    };
    /** value per m³ of material broken off (the score) */
    valueOf: (m: Material, vol: number) => number;
    private nextId;
    private markId;
    private rng;
    private boxHulls;
    private hits;
    private dirty;
    private booms;
    private loadT;
    /** standing bodies hit since the load rule last found them sound */
    private loadBodies;
    /** cells whose heat or damage the pieces haven't caught up with */
    private hot;
    /** fragments that may become bodies this frame (the rest: dust) */
    private fragBudget;
    private scratchV;
    constructor(phys: Physics, pieces: Pieces);
    private rand;
    /** a structure: cells bonded where they touch and anchored where they stand on the ground (bonded=false: loose,
     *  each cell its own body — a stack of crates). Anchored parts become one static body; the rest fall. */
    build(specs: CellSpec[], o?: {
        bonded?: boolean;
        anchored?: boolean;
        bondK?: number;
        links?: [number, number, number][];
    }): Cell[];
    /** a loose thing (a crate, a ball, a barrel): one dynamic body */
    loose(spec: CellSpec, vel?: V3, angVel?: V3): Cell;
    private makeCell;
    private euler;
    /** bonds between cells whose bounds touch face to face (area: their overlap) */
    private bondAll;
    private aabb;
    private lowestY;
    private footprint;
    private centroid;
    /** connected groups (by bonds between cells that `keep`) */
    private components;
    private shapeDefs;
    private shapeDef;
    private hullFor;
    private makeBody;
    private attach;
    private detachShape;
    private dropBody;
    /** where a cell is: its body's transform and its place in it */
    private place;
    /** the cell a shape belongs to */
    cellOf(s: b3ShapeId): Cell | null;
    private massOfShape;
    private velAt;
    /** remove a cell for good */
    remove(c: Cell): void;
    private unbond;
    /** spend `energy` (J) at p. It spreads as from a point — the intensity (J/m²) falls as 1/(4πd²) — and each bond takes
     *  the intensity over its area (it snaps past its strength), the ground's hold likewise, each cell over its cross
     *  section (it shatters past its toughness). `fresh`: impacts spare what has only just broken off (no chain reaction). */
    damage(p: V3, energy: number, o?: {
        shatterK?: number;
        dir?: V3;
        heat?: number;
        fresh?: boolean;
        radius?: number;
    }): void;
    /** break a cell into fragments round `at` (world) */
    shatter(c: Cell, at: V3, energy: number, dir?: V3): void;
    /** a blast: everything pushed away (box3d's explosion), and its energy spent on what's near */
    explode(p: V3, energy: number, heat?: number): void;
    /** after the physics: impacts, splits, blasts, debris, the sea, the load rule; the pieces' attributes */
    update(dt: number): void;
    private resplit;
    /** a group leaves its body: a dynamic body of its own, moving as that part of the old one was */
    private detach;
    private loadRule;
    /** pull a cell out of whatever holds it (a grab): its bonds and its hold on the ground let go — a body of its own */
    free(c: Cell, ghost?: number): RBody | null;
    private ghosts;
    /** the bodies that move */
    dynamicBodies(): Iterable<RBody>;
    /** everything gone (a reset) */
    clear(): void;
}
export {};
//# sourceMappingURL=rubble.d.ts.map