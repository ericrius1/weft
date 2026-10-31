import type { Box3DModule, b3BodyId, b3JointId, b3ShapeId, b3Vec3, b3Quat, b3WorldId, ContactHitEvent, BodyMoveEvent } from 'box3d.js';
export type B3 = Box3DModule;
export type { b3BodyId, b3ShapeId, b3JointId, b3Vec3, b3Quat, ContactHitEvent };
/** the module (once per page). On a cross-origin-isolated page (COOP/COEP headers) the multithreaded build, served
 *  as-is from `mtUrl` (default /box3d/box3d.mt.mjs: copy box3d.js's dist/box3d.mt.* into the app's public/box3d/ — its
 *  pthreads load the same file; a bundler would break that), with the solver spread over the cores; anywhere else the
 *  single-threaded one, its wasm found beside its module (or at `wasmUrl`). */
export declare function loadBox3D(o?: {
    threads?: boolean;
    mtUrl?: string;
    wasmUrl?: string;
}): Promise<{
    b3: B3;
    workers: number;
}>;
/** a body's key in maps (its slot; the generation tells a reused slot from the one before) */
export declare const bodyKey: (id: {
    index1: number;
}) => number;
export declare const sameId: (a: {
    index1: number;
    generation: number;
}, b: {
    index1: number;
    generation: number;
}) => boolean;
export interface PhysicsOptions {
    gravity?: b3Vec3;
    hz?: number;
    substeps?: number;
    hitThreshold?: number;
    maxSpeed?: number;
    workers?: number;
    capacity?: {
        bodies: number;
        shapes: number;
        contacts: number;
    };
}
export declare class Physics {
    readonly b3: B3;
    readonly world: b3WorldId;
    hz: number;
    readonly workers: number;
    substeps: number;
    /** slow motion: the share of real time simulated */
    timeScale: number;
    /** steps taken last update, and the time into the next (0..1, for interpolation) */
    steps: number;
    alpha: number;
    stepMs: number;
    private eb;
    private mv;
    private hit;
    private jev;
    /** each step's events (set by the game) */
    onMove: ((ev: BodyMoveEvent) => void) | null;
    onHit: ((ev: ContactHitEvent) => void) | null;
    onJointBreak: ((joint: b3JointId) => void) | null;
    /** before each fixed step (forces, kinematic targets): the step's dt */
    onStep: ((dt: number) => void) | null;
    constructor(b3: B3, o?: PhysicsOptions);
    /** advance by real time dt: semi-fixed — the frame's time split into equal steps no longer than 1/hz, each advancing
     *  the world by its share of real time × timeScale. Every frame moves the world (no beat between the display and a
     *  fixed rate, so nothing stutters), and slow motion is more, smaller steps of the world rather than the same steps
     *  taken less often. A slow frame (over `maxDt`) slows the world rather than spiralling; timeScale 0 freezes it. */
    update(dt: number, maxDt?: number): void;
    /** the world time the last update's steps each covered (0 when frozen) */
    lastStep: number;
    private pump;
    /** start the solver's threads (after the world is built) */
    threads(): void;
    set gravity(g: b3Vec3);
    get awake(): number;
    get counters(): import("box3d.js").b3Counters;
    /** the closest shape along a ray (origin, direction, length) */
    ray(o: b3Vec3, d: b3Vec3, len: number, mask?: bigint): {
        shape: b3ShapeId;
        point: b3Vec3;
        normal: b3Vec3;
        t: number;
    } | null;
    /** every shape whose bounds meet a box */
    overlapAABB(lo: b3Vec3, hi: b3Vec3, fn: (s: b3ShapeId) => boolean | void): void;
    explode(p: b3Vec3, radius: number, impulsePerArea: number, falloff?: number, mask?: bigint): void;
    dispose(): void;
}
//# sourceMappingURL=box3d.d.ts.map