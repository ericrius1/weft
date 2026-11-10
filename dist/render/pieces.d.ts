import type { Kit, RenderPass, StorageBuffer } from '@ericrius1/weft';
type V3 = [number, number, number];
export interface PieceMesh {
    pos: ArrayLike<number>;
    nrm: ArrayLike<number>;
    cut?: ArrayLike<number>;
}
export interface Piece {
    slot: number;
    at: number;
    n: number;
}
export declare class Pieces {
    private kit;
    readonly maxVerts: number;
    readonly maxSlots: number;
    readonly verts: StorageBuffer;
    readonly xf: StorageBuffer;
    /** vertices drawn (the arena's high-water mark) */
    top: number;
    private freeRanges;
    private freeSlots;
    private slotTop;
    private xfData;
    private xfU32;
    private lo;
    private hi;
    live: number;
    constructor(kit: Kit, maxVerts?: number, maxSlots?: number);
    /** register the draws: the game's shader (it includes loom/pieces), into the scene and the shadow cascades */
    draw(shader: any, scene: RenderPass, shadows: RenderPass[], bind?: Record<string, unknown>, extra?: RenderPass[]): void;
    /** a new piece: its triangles (local), material id (0..127), material-space offset, tint (linear rgb 0..1) */
    add(mesh: PieceMesh, mat: number, m0: V3, tint?: V3, seed?: number, half?: V3 | null): Piece | null;
    remove(p: Piece): void;
    /** where a piece is this frame (scale 0 hides it) */
    set(p: Piece, pos: ArrayLike<number>, q: ArrayLike<number>, scale?: number): void;
    /** the game's own per-piece value (b.w) */
    setUser(p: Piece, v: number): void;
    /** heat (a glow, 0..1+) and damage (cracks, 0..1) */
    setAttr(p: Piece, heat: number, damage: number): void;
    /** send the slots that changed */
    upload(): void;
    get stats(): {
        verts: number;
        live: number;
        slots: number;
        freeRanges: number;
    };
    private touch;
    private allocVerts;
    private freeVerts;
}
export {};
//# sourceMappingURL=pieces.d.ts.map