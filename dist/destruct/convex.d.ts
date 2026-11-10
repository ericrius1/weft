type V3 = [number, number, number];
export interface Face {
    pts: V3[];
    n: V3;
    cut: boolean;
}
export interface Poly {
    faces: Face[];
}
/** a box of half extents h, centred */
export declare function boxPoly(hx: number, hy: number, hz: number): Poly;
/** an upright prism (a cylinder of `sides`), radius r, half height hh */
export declare function prismPoly(r: number, hh: number, sides: number): Poly;
/** a polyhedron from a point cloud's convex hull faces (indices into pts, any winding: fixed here) */
export declare function polyFromHull(pts: V3[], tris: number[]): Poly;
/** keep the part where dot(n, x) <= d (null if nothing is left); `cut` marks the new cap face */
export declare function clip(poly: Poly, n: V3, d: number, cut?: boolean): Poly | null;
/** distinct vertices (a polyhedron has a few dozen: compared directly — no keys to build — which is what a break's
 *  hot path wants) */
export declare function vertices(poly: Poly, eps?: number): V3[];
/** volume and centre of mass (tetrahedra from a point inside) */
export declare function massProps(poly: Poly): {
    volume: number;
    centroid: V3;
};
export declare function bounds(poly: Poly): {
    lo: V3;
    hi: V3;
};
export declare function translate(poly: Poly, t: V3): Poly;
/** is p inside (every face's plane in front of it)? */
export declare function contains(poly: Poly, p: V3, margin?: number): boolean;
/** the Voronoi cells of `sites` inside the polyhedron (each a polyhedron; empty and sliver cells dropped) */
export declare function voronoi(poly: Poly, sites: V3[], minVolume?: number): Poly[];
/** n points inside the polyhedron, gathered round `focus` (if given: `spread` its reach, as a share of the size) */
export declare function scatter(poly: Poly, n: number, rand: () => number, focus?: V3, spread?: number, stretch?: V3): V3[];
/** flat-shaded triangles: positions, normals, and per vertex 1 on a cut face */
export declare function triangulate(poly: Poly): {
    pos: number[];
    nrm: number[];
    cut: number[];
};
export {};
//# sourceMappingURL=convex.d.ts.map