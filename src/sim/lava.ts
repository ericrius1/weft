// Lava on a heightfield (shaders/lava.wgsl says how it moves): one grid of cells laid over a host's land, its vents, its lake,
// stepped on the GPU. Engine-neutral, weft only. The host gives it the land's
// heights (a function of x, z, sampled at its cells: again when the land comes in finer), and each frame the eye and a
// dt; it gives back the compute items to run before the host's scene, the state its draws read (st, fl, bed, lists,
// args: a host's own shader draws the lava, lit as its world is), a glow texture (each texel 8x8 cells: its light's
// strength, its heat, the surface's height) for the light the lava throws, and what's at the eye (`at`), read back.
//
//   import { LavaFlow } from '@ericrius1/loom/sim/lava';   // a host's draw: #include "loom/lava_common"
//   const lava = new LavaFlow(kit, { n: 1024, cell: 4, corner: [-2648, -1448], vents, lake });
//   lava.setBed((x, z) => ground(x, z));
//   each frame: lava.update(dt, eye); kit.run([...lava.compute(), scene, …])
//
// What it costs: the step is two dispatches over the grid a substep (N^2 cells), the tiles one thread a 32x32 tile,
// the glow one a 8x8; at 1024^2 and two substeps a frame it's a few tenths of a millisecond on a desktop GPU.
import { type Kit, type RunEntry, type StorageBuffer, type Texture, type UniformBuffer, type PingPong } from '@ericrius1/weft';
import shader from '../shaders/lava.wgsl';

export interface LavaVent {
  /** its mouth (world x, z), radius (m), and how much it gives (m3/s) */
  x: number; z: number; radius: number; rate: number;
}
export interface LavaLake { x: number; z: number; level: number; radius: number }

export interface LavaOptions {
  /** cells a side (a multiple of 32) and a cell's size (m) */
  n: number;
  cell: number;
  /** the grid's corner (world x, z: its least x and z) */
  corner: [number, number];
  vents?: LavaVent[];
  lake?: LavaLake | null;
  /** substeps a frame, and how much faster than the wall's clock the lava goes (it's slow: a film's speed-up) */
  substeps?: number;
  speed?: number;
  /** the tiles' detail by distance: full within `near` m, half within `mid` m, a quarter beyond */
  near?: number;
  mid?: number;
}

/** the solver's knobs (shaders/lava.wgsl LavaU): the defaults are a basaltic flow's, hurried */
export interface LavaTune {
  /** the hot lava's mobility, and how many e-folds it falls by as it cools to nothing */
  mobility: number; stiffen: number;
  /** freezing: the heat it turns to rock below, and how fast (1/s) */
  freeze: number; freezeRate: number;
  /** the rock's cooling (1/s) and its wearing away once cold (m/s: the land's own coming back, so the flows don't pile
   *  up for ever) */
  rockCool: number; wear: number;
  /** heat lost a second, and more the thinner the sheet */
  cool: number; coolThin: number;
  /** the yield's thickness on a gentle slope, and its rise as the lava cools */
  yield: number; yieldCool: number;
}

export const LAVA_TUNE: LavaTune = {
  mobility: 2.5, stiffen: 6,
  freeze: 0.42, freezeRate: 0.25,
  rockCool: 0.004, wear: 0.0006,
  cool: 0.0012, coolThin: 0.0035,
  yield: 0.01, yieldCool: 25,
};

export const TILE = 32;

export class LavaFlow {
  readonly n: number;
  readonly cell: number;
  readonly corner: [number, number];
  readonly U: UniformBuffer<any>;
  readonly bed: StorageBuffer;
  readonly st: PingPong<StorageBuffer>;
  readonly fl: StorageBuffer;
  readonly probeBuf: StorageBuffer;
  readonly glow: Texture;
  readonly args: StorageBuffer;
  readonly lists: StorageBuffer;
  readonly tiles: number;
  vents: LavaVent[];
  lake: LavaLake | null;
  tune: LavaTune = { ...LAVA_TUNE };
  substeps: number;
  speed: number;
  near: number;
  mid: number;
  /** off: nothing steps (the state stays as it is) */
  on = true;
  /** what's at the eye's cell (read back a few frames late): the lava's thickness, heat, the rock under it, the bed,
   *  the lava's top there (world y) and the highest top in the 3x3 round it (-1e9: none) */
  readonly at = { h: 0, T: 0, s: 0, w: 0, bed: 0, top: -1e9, near: -1e9 };
  private items: RunEntry[] = [];
  private stepItems: RunEntry[] = [];
  private finish: RunEntry[] = [];
  private t = 0;
  private reading = false;
  private frameN = 0;
  private bedData: Float32Array;
  private bufs: StorageBuffer[] = [];

  constructor(readonly kit: Kit, o: LavaOptions) {
    if (o.n % TILE) throw new Error(`lava: n (${o.n}) is not a multiple of ${TILE}`);
    this.n = o.n; this.cell = o.cell; this.corner = o.corner;
    this.vents = o.vents ?? [];
    this.lake = o.lake ?? null;
    this.substeps = o.substeps ?? 2;
    this.speed = o.speed ?? 3;
    this.near = o.near ?? 300;
    this.mid = o.mid ?? 1100;
    const N2 = this.n * this.n;
    this.tiles = (this.n / TILE) ** 2;
    this.U = kit.uniforms(shader.structs.LavaU, 'lava');
    this.bedData = new Float32Array(N2);
    this.bed = kit.storage({ label: 'lava.bed', size: N2 * 4, usage: ['storage', 'copy-dst'] });
    this.st = kit.pingpong((i) => (this.bufs[i] = kit.storage({ label: `lava.st${i}`, size: N2 * 16, usage: ['storage', 'copy-dst', 'copy-src'] })), 'lava.st');
    this.fl = kit.storage({ label: 'lava.flux', size: N2 * 16, usage: ['storage', 'copy-dst'] });
    this.probeBuf = kit.storage({ label: 'lava.probe', size: 32, usage: ['storage', 'copy-src'] });
    this.glow = kit.texture({ label: 'lava.glow', format: 'rgba16float', size: [this.n / 8, this.n / 8], usage: ['storage', 'sample'] });
    this.args = kit.storage({ label: 'lava.args', size: 3 * 16, usage: ['storage', 'indirect'] });
    this.lists = kit.storage({ label: 'lava.lists', size: 3 * this.tiles * 4, usage: ['storage'] });
    const both = { L: this.U, bed: this.bed };
    const flux = kit.compute(shader, { entry: 'flux', label: 'lava.flux', bind: { ...both, stA: this.st.read, fl: this.fl } as never, threads: [this.n, this.n] });
    const advance = kit.compute(shader, { entry: 'advance', label: 'lava.advance', bind: { ...both, stA: this.st.read, stB: this.st.write, fl: this.fl } as never, threads: [this.n, this.n] });
    this.stepItems = [flux, advance, this.st.swap];
    const probe = kit.compute(shader, { entry: 'probe', label: 'lava.probe', bind: { ...both, stA: this.st.read, probeOut: this.probeBuf } as never, workgroups: [1, 1, 1] });
    const glow = kit.compute(shader, { entry: 'glow', label: 'lava.glow', bind: { ...both, stA: this.st.read, glowOut: this.glow } as never, threads: [this.n / 8, this.n / 8] });
    const clear = kit.compute(shader, { entry: 'clearArgs', label: 'lava.clear', bind: { L: this.U, args: this.args } as never, workgroups: [1, 1, 1] });
    const tiles = kit.compute(shader, { entry: 'tiles', label: 'lava.tiles', bind: { ...both, stA: this.st.read, args: this.args, lists: this.lists } as never, threads: [this.tiles] });
    this.finish = [probe, glow, clear, tiles];
    this.items = [flux, advance, probe, glow, clear, tiles];
  }

  /** the land's heights at the cells (world x, z -> y): at load, and again when the land under the lava comes finer */
  setBed(height: (x: number, z: number) => number) {
    const N = this.n, c = this.cell, [x0, z0] = this.corner, b = this.bedData;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) b[j * N + i] = height(x0 + (i + 0.5) * c, z0 + (j + 0.5) * c);
    this.bed.write(b);
  }
  /** the land's height the solver has at a cell's (x, z) */
  bedAt(x: number, z: number) {
    const N = this.n, i = Math.max(0, Math.min(N - 1, Math.floor((x - this.corner[0]) / this.cell))), j = Math.max(0, Math.min(N - 1, Math.floor((z - this.corner[1]) / this.cell)));
    return this.bedData[j * N + i];
  }
  /** all of it cleared: no lava, no rock (a film's start) */
  clear() {
    const z = new Float32Array(this.n * this.n * 4);
    for (const b of this.bufs) b.write(z);
  }
  /** the grid's middle and half its size (m) */
  get middle(): [number, number] { return [this.corner[0] + this.n * this.cell / 2, this.corner[1] + this.n * this.cell / 2]; }
  get half() { return this.n * this.cell / 2; }

  /** whether (x, z) is on the grid */
  covers(x: number, z: number) { return x > this.corner[0] && z > this.corner[1] && x < this.corner[0] + this.n * this.cell && z < this.corner[1] + this.n * this.cell; }

  update(dt: number, eye: ArrayLike<number>) {
    this.t += dt;
    const sub = Math.max(1, this.substeps);
    // (each substep's dt: the frame's, sped up, split; never past what the solver stays steady at)
    const h = Math.min((Math.min(dt, 0.05) * this.speed) / sub, 0.06);
    const T = this.tune;
    const ci = Math.floor((eye[0] - this.corner[0]) / this.cell), cj = Math.floor((eye[2] - this.corner[1]) / this.cell);
    const vents = new Float32Array(32);
    this.vents.slice(0, 8).forEach((v, k) => vents.set([v.x, v.z, v.radius, v.rate], k * 4));
    this.U.set({
      grid: [this.n, this.cell, this.corner[0], this.corner[1]],
      step: [this.on ? h : 0, this.t, T.mobility, T.stiffen],
      tune: [T.freeze, T.freezeRate, T.rockCool, T.wear],
      cool: [T.cool, T.coolThin, T.yield, T.yieldCool],
      lake: this.lake ? [this.lake.x, this.lake.level, this.lake.z, this.lake.radius] : [0, 0, 0, 0],
      eye: [eye[0], eye[1], eye[2], Math.max(0, cj) * this.n + Math.max(0, ci)],
      lod: [this.near, this.mid, 0, 0],
      ventN: [Math.min(8, this.vents.length), 0, 0, 0],
      vents: vents as never,
    });
    // (what's at the eye, read back now and then: the host's question whether the eye is in the lava)
    if (!this.reading && ++this.frameN % 4 === 0) {
      this.reading = true;
      void this.probeBuf.read(0, 32).then((b) => {
        const f = new Float32Array(b);
        Object.assign(this.at, { h: f[0], T: f[1], s: f[2], w: f[3], bed: f[4], top: f[5], near: f[6] });
      }).catch(() => {}).finally(() => { this.reading = false; });
    }
  }

  /** the items to run before the host's scene: the substeps, then what the draws and the host read */
  compute(): RunEntry[] {
    if (!this.on) return this.finish;
    const out: RunEntry[] = [];
    for (let i = 0; i < Math.max(1, this.substeps); i++) out.push(...this.stepItems);
    out.push(...this.finish);
    return out;
  }

  /** every pipeline it declared (await kit.ready(lava.pipelines) before a bake) */
  get pipelines() { return this.items; }
}
