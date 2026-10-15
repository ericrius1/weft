// box3d (Erin Catto's 3D rigid-body engine, as box3d.js's WebAssembly build) for loom's games: the module loaded once
// (the .wasm served as an asset, streamed and compiled), a world stepped every frame in equal steps of at most 1/hz
// (slow motion makes the steps smaller, never rarer), and each step's events pumped to the game — bodies that moved (their transforms, in bulk),
// impacts (contact hits: where, how fast) and joints that broke.
import Box3D from 'box3d.js';
import type { Box3DModule, b3BodyId, b3JointId, b3ShapeId, b3Vec3, b3Quat, b3WorldId, ContactHitEvent, EventsBuffer, BodyMoveEvent, JointEvent } from 'box3d.js';

export type B3 = Box3DModule;
export type { b3BodyId, b3ShapeId, b3JointId, b3Vec3, b3Quat, ContactHitEvent };

let mod: Promise<{ b3: B3; workers: number }> | null = null;
/** the module (once per page). On a cross-origin-isolated page (COOP/COEP headers) the multithreaded build, served
 *  as-is from `mtUrl` (default /box3d/box3d.mt.mjs: copy box3d.js's dist/box3d.mt.* into the app's public/box3d/ — its
 *  pthreads load the same file; a bundler would break that), with the solver spread over the cores; anywhere else the
 *  single-threaded one, its wasm found beside its module (or at `wasmUrl`). */
export function loadBox3D(o: { threads?: boolean; mtUrl?: string; wasmUrl?: string } = {}): Promise<{ b3: B3; workers: number }> {
  mod ??= (async () => {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
    if (o.threads !== false && (globalThis as any).crossOriginIsolated && cores > 2) {
      try {
        // (imported past the bundler — it would rewrite the URL — so the file loads exactly as served)
        const load = new Function('u', 'return import(u)') as (u: string) => Promise<{ default: (o?: unknown) => Promise<B3> }>;
        const f = (await load(o.mtUrl ?? '/box3d/box3d.mt.mjs')).default;
        return { b3: await f(), workers: Math.max(2, Math.min(8, cores - 2)) };
      } catch (e) { console.warn('box3d: threads unavailable, single-threaded', e); }
    }
    const wasmUrl = o.wasmUrl;
    return { b3: await (Box3D as (o?: unknown) => Promise<B3>)(wasmUrl ? { locateFile: (p: string) => (p.endsWith('.wasm') ? wasmUrl : p) } : {}), workers: 0 };
  })();
  return mod;
}

/** a body's key in maps (its slot; the generation tells a reused slot from the one before) */
export const bodyKey = (id: { index1: number }) => id.index1;
export const sameId = (a: { index1: number; generation: number }, b: { index1: number; generation: number }) => a.index1 === b.index1 && a.generation === b.generation;

export interface PhysicsOptions { gravity?: b3Vec3; hz?: number; substeps?: number; hitThreshold?: number; maxSpeed?: number; workers?: number; capacity?: { bodies: number; shapes: number; contacts: number } }

export class Physics {
  readonly world: b3WorldId;
  hz: number;
  readonly workers: number;
  substeps: number;
  /** slow motion: the share of real time simulated */
  timeScale = 1;
  /** steps taken last update, and the time into the next (0..1, for interpolation) */
  steps = 0;
  alpha = 0;
  stepMs = 0;
  private eb: EventsBuffer;
  private mv: BodyMoveEvent;
  private hit: ContactHitEvent;
  private jev: JointEvent;
  /** each step's events (set by the game) */
  onMove: ((ev: BodyMoveEvent) => void) | null = null;
  onHit: ((ev: ContactHitEvent) => void) | null = null;
  onJointBreak: ((joint: b3JointId) => void) | null = null;
  /** before each fixed step (forces, kinematic targets): the step's dt */
  onStep: ((dt: number) => void) | null = null;

  constructor(readonly b3: B3, o: PhysicsOptions = {}) {
    const wd = b3.b3DefaultWorldDef();
    wd.gravity = o.gravity ?? [0, -9.81, 0];
    wd.hitEventThreshold = o.hitThreshold ?? 1.5;
    wd.maximumLinearSpeed = o.maxSpeed ?? 400;
    // (threads join once the world is built — call threads() — so the heap grows while only one thread runs)
    wd.workerCount = 0;
    this.workers = o.workers ?? 0;
    if (o.capacity) wd.capacity = { staticShapeCount: o.capacity.shapes, dynamicShapeCount: o.capacity.shapes, staticBodyCount: o.capacity.bodies, dynamicBodyCount: o.capacity.bodies, contactCount: o.capacity.contacts };
    this.world = b3.b3CreateWorld(wd);
    this.hz = o.hz ?? 60;
    this.substeps = o.substeps ?? 4;
    this.eb = b3.createEventsBuffer();
    this.mv = b3.createBodyMoveEvent();
    this.hit = b3.createContactHitEvent();
    this.jev = b3.createJointEvent();
  }

  /** advance by real time dt: semi-fixed — the frame's time split into equal steps no longer than 1/hz, each advancing
   *  the world by its share of real time × timeScale. Every frame moves the world (no beat between the display and a
   *  fixed rate, so nothing stutters), and slow motion is more, smaller steps of the world rather than the same steps
   *  taken less often. A slow frame (over `maxDt`) slows the world rather than spiralling; timeScale 0 freezes it. */
  update(dt: number, maxDt = 1 / 20) {
    const b3 = this.b3;
    const real = Math.min(Math.max(dt, 0), maxDt);
    this.steps = 0;
    const t0 = performance.now();
    const n = Math.max(1, Math.ceil(real * this.hz - 0.05));
    const h = (real / n) * this.timeScale;
    if (h > 1e-6) {
      // (a small step needs fewer substeps for the same stiffness: the solver's rate is per simulated second)
      const sub = Math.max(1, Math.min(this.substeps, Math.ceil(this.substeps * h * this.hz - 0.01)));
      for (let i = 0; i < n; i++) {
        this.onStep?.(h);
        b3.b3World_Step(this.world, h, sub);
        this.steps++;
        this.pump();
      }
    }
    this.lastStep = h;
    this.alpha = 0;
    this.stepMs = this.stepMs * 0.9 + (performance.now() - t0) * 0.1;
  }
  /** the world time the last update's steps each covered (0 when frozen) */
  lastStep = 0;

  private pump() {
    const b3 = this.b3, eb = this.eb;
    b3.getEvents(eb, this.world);
    if (this.onMove) for (let i = 0, n = b3.getNumBodyMoveEvents(eb); i < n; i++) this.onMove(b3.getBodyMoveEventAt(this.mv, eb, i));
    if (this.onHit) for (let i = 0, n = b3.getNumContactHitEvents(eb); i < n; i++) this.onHit(b3.getContactHitEventAt(this.hit, eb, i));
    if (this.onJointBreak) for (let i = 0, n = b3.getNumJointEvents(eb); i < n; i++) this.onJointBreak(b3.getJointEventAt(this.jev, eb, i).jointId);
  }

  /** start the solver's threads (after the world is built) */
  threads() { if (this.workers > 0) this.b3.b3World_SetWorkerCount(this.world, this.workers); }

  set gravity(g: b3Vec3) { this.b3.b3World_SetGravity(this.world, g); }
  get awake() { return this.b3.b3World_GetAwakeBodyCount(this.world); }
  get counters() { return this.b3.b3World_GetCounters(this.world); }

  /** the closest shape along a ray (origin, direction, length) */
  ray(o: b3Vec3, d: b3Vec3, len: number, mask: bigint = 0xffffffffffffffffn) {
    const f = this.b3.b3DefaultQueryFilter();
    f.maskBits = mask;
    const r = this.b3.b3World_CastRayClosest(this.world, o, [d[0] * len, d[1] * len, d[2] * len], f);
    return r.hit ? { shape: r.shapeId, point: r.point as b3Vec3, normal: r.normal as b3Vec3, t: r.fraction * len } : null;
  }

  /** every shape whose bounds meet a box */
  overlapAABB(lo: b3Vec3, hi: b3Vec3, fn: (s: b3ShapeId) => boolean | void) {
    const f = this.b3.b3DefaultQueryFilter();
    this.b3.b3World_OverlapAABB(this.world, [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]], f, (s: b3ShapeId) => fn(s) !== false);
  }

  explode(p: b3Vec3, radius: number, impulsePerArea: number, falloff = radius * 0.5, mask: bigint = 0xffffffffffffffffn) {
    this.b3.b3World_Explode(this.world, { maskBits: mask, position: p, radius, falloff, impulsePerArea });
  }

  dispose() { this.b3.destroyEventsBuffer(this.eb); this.b3.b3DestroyWorld(this.world); }
}
