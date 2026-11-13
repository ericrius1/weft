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
    /** camera-relative matrices: the same view with the eye at the origin, for positions given as `p − position` (the
     *  difference taken in doubles on the CPU, or as `(p − camPos) − camLo` on the GPU: shaders/frame.wgsl `fromEye`). Only
     *  differences reach the GPU, so a draw is as sharp a thousand kilometres from the world's origin as beside it. */
    readonly viewRel: Float32Array<ArrayBuffer>;
    readonly viewProjRel: Float32Array<ArrayBuffer>;
    readonly invViewProjRel: Float32Array<ArrayBuffer>;
    /** last frame's viewProj taken about this frame's eye (motion vectors for camera-relative positions) */
    readonly prevViewProjRel: Float32Array<ArrayBuffer>;
    /** what float32 loses of `position`: position − fround(position), per axis (Frame.camPos + Frame.camLo is the eye to
     *  a float's precision of the lost part: under a nanometre at 1,000 km). With `viewOverride` the eye is read back from
     *  that matrix's inverse, a Float32Array: camLo is then what float32 loses of a position already rounded to float32,
     *  0, and the eye is only as good as the matrix (a shadow camera 1,000 km out: 6 cm). Give such a camera a `position`
     *  in doubles and a rotation-only override instead when it must be exact far from the origin */
    readonly camLo: V3;
    /** the jitter as the projection carries it, in NDC (x right, y up: what `jitter` adds to a point's ndc): this frame's
     *  in xy, last frame's in zw (motion vectors: a point's ndc now minus xy, last frame's minus zw, is where it is without
     *  either frame's jitter; shaders/motion.wgsl). The same as xy after a cut or on the first frame */
    readonly jitterNdc: [number, number, number, number];
    private prevRot;
    private prevPos;
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
    /** forget motion history (after a cut, so motion vectors don't smear; a Taau drops its history too) */
    cut(): void;
    /** how many times it's been cut (temporal filters watch this) */
    cuts: number;
    /** sphere-in-frustum test using the last update's planes */
    sees(c: ArrayLike<number>, r: number): boolean;
    /** world-space ray through a pixel (for picking) */
    ray(px: number, py: number, width: number, height: number): {
        origin: V3;
        dir: V3;
    };
}
//# sourceMappingURL=camera.d.ts.map