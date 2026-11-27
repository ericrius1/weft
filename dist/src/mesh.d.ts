import type { Kit } from './kit';
import type { StorageBuffer } from './resources';
import { type V3, type M4 } from './math';
import { type CoplanarOptions, type CoplanarStats } from './coplanar';
export { findCoplanar, separateCoplanar, type CoplanarOptions, type CoplanarPair, type CoplanarStats } from './coplanar';
export interface MeshDataOptions {
    /** automatically detect and separate coplanar overlapping faces by 1 mm so meshes never z-fight (default true).
     *  Pass `false` to skip, or `CoplanarOptions` to customize `eps`/`tol`/`minArea`. */
    separateCoplanar?: boolean | CoplanarOptions;
}
export declare const VERTEX_BYTES = 40;
export declare const packColor: (c: ArrayLike<number>) => number;
export interface GpuMesh {
    vertices: StorageBuffer;
    indices: StorageBuffer;
    count: number;
    vertexCount: number;
}
export declare class MeshBuilder {
    private f;
    private u;
    private idx;
    private stack;
    m: M4;
    private nm;
    /** linear rgba for the next primitives */
    color: number[];
    mat: number;
    /** uv scale: uvs are in metres × this (so tiling textures stay square) */
    uvScale: number;
    get vertexCount(): number;
    get indexCount(): number;
    push(): this;
    pop(): this;
    private updateNormal;
    apply(t: ArrayLike<number>): this;
    translate(x: number, y: number, z: number): this;
    rotate(axis: V3, a: number): this;
    rotateY(a: number): this;
    rotateX(a: number): this;
    rotateZ(a: number): this;
    scale(x: number, y?: number, z?: number): this;
    setColor(c: ArrayLike<number>, mat?: number): this;
    /** add a vertex (local space); returns its index */
    vertex(p: ArrayLike<number>, n: ArrayLike<number>, uv?: ArrayLike<number>, color?: number[], mat?: number): number;
    tri(a: number, b: number, c: number): this;
    /** a quad from four corners (counter-clockwise seen from the front) */
    quad(p0: V3, p1: V3, p2: V3, p3: V3, uvw?: number, uvh?: number): this;
    /** axis-aligned box centred on the origin (current transform applies) */
    box(w: number, h: number, d: number): this;
    /** box from min corner to max corner */
    boxMinMax(a: V3, b: V3): this;
    /** cylinder along y, centred, with optional caps */
    cylinder(r: number, h: number, seg?: number, caps?: boolean, r2?: number): this;
    sphere(r: number, seg?: number, rings?: number): this;
    /** surface of revolution around y from a profile of [radius, y] points (bottom to top) */
    lathe(profile: [number, number][], seg?: number): this;
    /** a flat polygon (convex, counter-clockwise from the front) */
    polygon(pts: V3[]): this;
    /** a tube along a path (neon signs, pipes, trunks); r may taper: a function of the path parameter 0..1 */
    tube(path: V3[], r: number | ((t: number) => number), seg?: number, closed?: boolean): this;
    /** extrude a profile drawn in the (z, y) plane (counter-clockwise, simple polygon) along x from x0 to x1.
     *  `edge(i)` may restyle the side face of edge i → i+1 (return a colour / material); caps use the current style. */
    extrudeX(profile: [number, number][], x0: number, x1: number, o?: {
        caps?: boolean;
        edge?: (i: number) => {
            color?: ArrayLike<number>;
            mat?: number;
            skip?: boolean;
        } | void;
    }): this;
    /** append another builder's geometry (already in world space) */
    merge(o: MeshBuilder): this;
    /** interleaved vertex data (40 bytes per vertex). Automatically separates coplanar overlapping faces unless
     *  `opts.separateCoplanar === false`. */
    data(opts?: MeshDataOptions): {
        vertices: ArrayBuffer;
        indices: Uint32Array<ArrayBuffer>;
    };
    /** separate coplanar overlapping faces in this builder in-place and return resolution stats */
    separateCoplanar(opts?: CoplanarOptions): CoplanarStats;
    upload(kit: Kit, label?: string, opts?: MeshDataOptions): GpuMesh;
}
/** Pack up to four byte/6-bit material/sub-material/part/extra fields into a single f32 bit-pattern (read via `bitcast<u32>` in WGSL). */
export declare function packTag(mat: number, sub?: number, part?: number, extra?: number): number;
/**
 * Lightweight 9-float/vertex non-indexed triangle soup builder (`px, py, pz, nx, ny, nz, u, v, f32(tag)`) for
 * architectural and procedural features with custom WGSL shaders. Automatically runs `separateCoplanar()` in `data()`
 * so overlapping quads/boxes never z-fight internally.
 */
export declare class TriangleSoup {
    private buf;
    get count(): number;
    vert(p: V3, n: V3, u: number, v: number, tag?: number): this;
    tri(a: V3, b: V3, c: V3, ua: [number, number], ub: [number, number], uc: [number, number], tag?: number, n?: V3): this;
    /** Quad with corners (p00 -> p10 -> p11 -> p01) in CCW order from outside. */
    quad(p00: V3, p10: V3, p11: V3, p01: V3, tag?: number, uvScale?: number, uvRect?: [number, number, number, number]): this;
    /** Axis-aligned box from (x0,y0,z0) to (x1,y1,z1), outward CCW normals. Mask bits: 1:+Y, 2:-Y, 4:+Z, 8:-Z, 16:+X, 32:-X. */
    box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tag?: number, uvScale?: number, mask?: number): this;
    /** Upright tapered cylinder around (cx, cz) from y0..y1. */
    cyl(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, segs: number, tag?: number, capTop?: boolean, capBot?: boolean): this;
    /** Flat Float32Array (9 floats/vertex). Automatically runs `separateCoplanar()` unless `opts.separateCoplanar === false`. */
    data(opts?: MeshDataOptions): Float32Array;
}
/** ear-clipping triangulation of a simple polygon (counter-clockwise); returns index triples */
export declare function triangulate(poly: ArrayLike<number>[]): number[];
//# sourceMappingURL=mesh.d.ts.map