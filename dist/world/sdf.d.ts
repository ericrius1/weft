export type V3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Solid = {
    kind: 'box';
    c: V3;
    h: V3;
    round?: number;
    q?: Quat;
    mat?: number;
} | {
    kind: 'cyl';
    c: V3;
    r: number;
    hh: number;
    round?: number;
    q?: Quat;
    mat?: number;
} | {
    kind: 'sphere';
    c: V3;
    r: number;
    q?: Quat;
    mat?: number;
} | {
    kind: 'torus';
    c: V3;
    R: number;
    r: number;
    q?: Quat;
    mat?: number;
} | {
    kind: 'cone';
    c: V3;
    r1: number;
    r2: number;
    hh: number;
    q?: Quat;
    mat?: number;
} | {
    kind: 'capsule';
    c: V3;
    r: number;
    hh: number;
    q?: Quat;
    mat?: number;
};
export interface Hit {
    t: number;
    p: V3;
    n: V3;
    solid: number;
}
/** one solid's distance (its own frame) */
export declare function solidDist(s: Solid, px: number, py: number, pz: number): number;
/** how far a solid reaches from its centre */
export declare function solidReach(s: Solid): number;
export declare class SdfScene {
    readonly solids: Solid[];
    /** distances are exact up to this far from the surface */
    readonly margin: number;
    private cell;
    private lo;
    private dims;
    private cells;
    constructor(solids: Solid[], o?: {
        cell?: number;
        margin?: number;
    });
    /** the bounds the grid covers */
    get bounds(): {
        lo: V3;
        hi: V3;
    };
    private list;
    /** the distance to the nearest surface (negative inside); at least `margin` where none is near */
    dist(x: number, y: number, z: number): number;
    /** the nearest solid's index (-1: none within margin) */
    nearest(x: number, y: number, z: number): number;
    /** the surface's normal at (near) p: the distance's gradient (a tetrahedron of samples) */
    normal(x: number, y: number, z: number, e?: number): V3;
    /** march a ray (unit dir) against the scene; null if nothing within maxT */
    raycast(o: V3, d: V3, maxT: number, pad?: number): Hit | null;
    /** a sphere's push out of the scene: the corrected centre and the contact's normal (null: no contact) */
    pushOut(p: V3, r: number): {
        p: V3;
        n: V3;
        depth: number;
    } | null;
}
//# sourceMappingURL=sdf.d.ts.map