export interface DomeLayout {
    /** the dome's size (pixels across) */
    size: number;
    /** every tile's size (pixels): the canvas to render them at */
    tile: [number, number];
    /** the tiles' vertical field of view (radians) and lens shift (normalised device y: Camera.shift[1]) */
    fovY: number;
    shift: number;
    /** a tile's extent on its tangent plane: x in [-ax, ax], y in [y0, y1] (1 is a cube face's edge, 45 degrees) */
    ax: number;
    y0: number;
    y1: number;
    /** the six views' yaw and pitch for a heading (radians: weft's Camera, yaw 0 looking down -z) */
    views(heading: number): {
        yaw: number;
        pitch: number;
    }[];
}
export interface DomeOptions {
    /** how far each tile reaches past its cube face's half, on every side (radians; default 6 degrees): the width the
     *  seams are feathered over, and the room a view's screen-space effects have to fall off in before it */
    margin?: number;
    /** the tiles' detail over the dome's (default 1; 1.5 renders each tile at 1.5x the pixels per degree, a sharper
     *  dome for the cost of 2.25x the pixels) */
    oversample?: number;
}
export declare function domeLayout(size: number, o?: DomeOptions): DomeLayout;
/** a tile camera's basis (right, up, forward), as weft's Camera builds it from yaw and pitch */
export declare function viewBasis(yaw: number, pitch: number): [number, number, number][];
/** the direction (world, unit) through a point of the dome (u, v in 0..1 across it, v down), for a heading; null
 *  outside its circle */
export declare function domeDirection(u: number, v: number, heading: number): [number, number, number] | null;
/** each tile's weight for a direction (dome.wgsl's, on the CPU): what a stitch would mix it from */
export declare function tileWeights(L: DomeLayout, d: [number, number, number], heading: number): number[];
//# sourceMappingURL=domelayout.d.ts.map