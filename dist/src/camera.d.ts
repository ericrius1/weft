import { type V3, type M4 } from './math';
export declare class Camera {
    position: V3;
    /** radians: yaw 0 looks down -z, positive yaw turns left (counter-clockwise seen from above); pitch up is positive */
    yaw: number;
    pitch: number;
    roll: number;
    fovY: number;
    near: number;
    /** Infinity = infinite reversed-Z perspective */
    far: number;
    /** orthographic half extents (shadow maps, 2D); when set the camera is orthographic */
    ortho: {
        halfWidth: number;
        halfHeight: number;
    } | null;
    /** sub-pixel projection offset in pixels (TAA) */
    jitter: [number, number];
    /** lens shift in normalised device units (x right, y up; 1 = half the frame): an off-axis frustum, the view's axis
     *  kept where it points while the frame slides across the image plane (tiles of a larger frame, a fulldome's cube-face
     *  halves, a rising front). Unlike `jitter` it's the camera's own and nothing per-frame resets it. */
    shift: [number, number];
    /** set to a matrix to bypass yaw/pitch/roll (e.g. light views) */
    viewOverride: M4 | null;
    readonly view: Float32Array<ArrayBuffer>;
    readonly proj: Float32Array<ArrayBuffer>;
    readonly viewProj: Float32Array<ArrayBuffer>;
    readonly invViewProj: Float32Array<ArrayBuffer>;
    readonly invProj: Float32Array<ArrayBuffer>;
    readonly invView: Float32Array<ArrayBuffer>;
    readonly prevViewProj: Float32Array<ArrayBuffer>;
    readonly planes: Float32Array<ArrayBuffer>;
    forward: V3;
    right: V3;
    up: V3;
    aspect: number;
    private first;
    /** point the camera from `eye` at `target` (sets position, yaw, pitch; keeps roll) */
    lookAt(eye: ArrayLike<number>, target: ArrayLike<number>): this;
    /** recompute matrices for a viewport (width, height in pixels) */
    update(width: number, height: number): void;
    /** forget motion history (after a cut, so motion vectors don't smear) */
    cut(): void;
    /** sphere-in-frustum test using the last update's planes */
    sees(c: ArrayLike<number>, r: number): boolean;
    /** world-space ray through a pixel (for picking) */
    ray(px: number, py: number, width: number, height: number): {
        origin: V3;
        dir: V3;
    };
}
//# sourceMappingURL=camera.d.ts.map