// The terrain's shadow over the whole map toward the key light (hfshadow.wgsl): rebuilt continuously, a band of rows a
// frame into one texture; when a pass completes it's copied to the one the scene samples (env.wgsl hfShadowAt). The
// light direction is captured at the start of each pass, so one map is always consistent.
import type { Kit, Texture, Compute, UniformBuffer, RunEntry, V3 } from '@ericrius1/weft';
import hfShader from '../shaders/hfshadow.wgsl';

export class TerrainShadow {
  /** what the scene samples */
  shown: Texture;
  private build: Texture;
  private u: UniformBuffer<any>;
  private bake: Compute;
  private copy;
  private row = 0;
  private rows = 0;
  private done = false;
  ready = false;
  /** the window (world xz origin, size m, texels) */
  win: [number, number, number, number];
  constructor(kit: Kit, heights: Texture, half: number, readonly N = 2048, readonly band = 128) {
    this.shown = kit.texture({ label: 'hfshadow', format: 'rgba8unorm', size: [N, N], usage: ['sample', 'copy-dst'] });
    this.build = kit.texture({ label: 'hfshadow.build', format: 'rgba8unorm', size: [N, N], usage: ['storage', 'copy-src'] });
    this.win = [-half, -half, 2 * half, N];
    this.u = kit.uniforms(hfShader.structs.HF, 'hfshadow').set({ win: this.win });
    this.bake = kit.compute(hfShader, { label: 'hfshadow.bake', bind: { hf: this.u, heights, hfOut: this.build }, threads: () => [N, this.rows] });
    this.copy = kit.copy(this.build, this.shown, 'hfshadow.swap');
    this.copy.enabled = false;
  }
  /** this frame's work toward the light direction `dir` */
  items(dir: V3): RunEntry[] {
    if (this.row === 0) this.u.set({ dir: [...dir, 0] });
    // (the first map in one go, behind the loading screen; then a band a frame)
    this.rows = this.ready ? Math.min(this.band, this.N - this.row) : this.N - this.row;
    this.u.set({ row: [this.row, 0, 0, 0] });
    this.row += this.rows;
    this.done = this.row >= this.N;
    if (this.done) { this.row = 0; this.ready = true; }
    this.copy.enabled = this.done;
    return [this.bake, this.copy];
  }
}
