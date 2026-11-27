export interface CoplanarOptions {
    /** normal-direction separation in world units (default 0.001 m = 1 mm) */
    eps?: number;
    /** plane-offset tolerance in world units for treating two faces as coplanar (default min(0.0005, eps * 0.5) m) */
    tol?: number;
    /** minimum shared overlap area to count as a coplanar pair (default 1e-5 m²) */
    minArea?: number;
    /** floats per vertex in `positions` (default 3 for tightly packed xyz) */
    stride?: number;
    /** float offset of x within each vertex stride (default 0) */
    offset?: number;
    /** number of vertices when `indices` is omitted (defaults to floor(positions.length / stride)) */
    vertexCount?: number;
}
export interface CoplanarPair {
    t1: number;
    t2: number;
    area: number;
    sameFacing: boolean;
}
export interface CoplanarStats {
    pairs: number;
    backToBack: number;
    twins: number;
    sameFacing: number;
    facesMoved: number;
    verticesMoved: number;
}
type IndexArray = Uint32Array | Uint16Array | readonly number[];
type FloatArray = Float32Array | Float64Array | number[];
/** Find all overlapping coplanar triangle pairs in a triangle mesh. */
export declare function findCoplanar(positions: FloatArray, indices?: IndexArray, opts?: CoplanarOptions): CoplanarPair[];
/**
 * Separate all overlapping coplanar triangle pairs in-place in `positions` by `eps` (default 1 mm) along face normals.
 * Works on tightly-packed or strided Float32/Float64 buffers, indexed or non-indexed. Returns counts of pairs resolved.
 */
export declare function separateCoplanar(positions: FloatArray, indices?: IndexArray, opts?: CoplanarOptions): CoplanarStats;
export {};
//# sourceMappingURL=coplanar.d.ts.map