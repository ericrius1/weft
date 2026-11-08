// Clustered point lights (clusters.wgsl, envx.wgsl): a grid of cells round the camera, small near it and growing with
// distance, each listing the lights that touch it; the surfaces loop their own cell's (env.wgsl plList) instead of
// every light. So a scene can light hundreds of lamps — a city's windows and streetlights at dusk, a festival's
// lanterns — for the cost of the handful around each pixel. The grid is binned on the GPU each frame (one thread a
// cell); the lights are sorted nearest the camera first, so a crowded cell keeps its nearest `cap`.
import type { Kit, RunEntry, StorageBuffer, UniformBuffer, Compute } from '@ericrius1/weft';
import clusterShader from '../shaders/clusters.wgsl';

export interface LightClusterOptions {
  /** cells along x, y (up), z (default 32, 16, 32) */
  cells?: [number, number, number];
  /** the most lights a cell holds (default 24) */
  cap?: number;
}

export class LightClusters {
  /** the grid's reach from the camera: across and up / down (m) */
  reach = { across: 400, up: 200 };
  readonly cells: [number, number, number];
  readonly cap: number;
  /** the cells' lists (env group: lightCells) */
  readonly buffer: StorageBuffer;
  readonly items: RunEntry[];
  private bin: Compute;
  private centre: number[] = [0, 0, 0];
  private count = 0;

  constructor(private kit: Kit, lights: StorageBuffer, envx: UniformBuffer<any>, opts: LightClusterOptions = {}) {
    this.cells = opts.cells ?? [32, 16, 32];
    this.cap = Math.max(1, Math.min(255, Math.round(opts.cap ?? 24)));
    const total = this.cells[0] * this.cells[1] * this.cells[2];
    this.buffer = kit.storage({ label: 'lightCells', size: total * (this.cap + 1) * 4 });
    this.bin = kit.compute(clusterShader, {
      label: 'lights.bin', entry: 'bin', threads: [total], enabled: () => this.count > 0,
      bind: { gx: envx, gridLights: lights, cellsOut: this.buffer },
    });
    // (no lights: every cell empty, without the dispatch)
    const clear = kit.raw((enc) => { if (this.count === 0) enc.clearBuffer(this.buffer.gpu); }, 'lights.clear');
    this.items = [clear, this.bin];
  }

  /** this frame's grid: round the camera, over the lights in plights (the count written there) */
  update(cam: ArrayLike<number>, count: number) {
    this.centre = [cam[0], cam[1], cam[2]];
    this.count = count;
  }

  /** the shaders' values for it (envx: grid, gridR, gridN) */
  envx(on: boolean) {
    return {
      grid: [...this.centre, on ? 1 : 0], gridR: [this.reach.across, this.reach.up, this.cap, this.count], gridN: [...this.cells, 0],
    };
  }

  dispose() { this.kit.release(this.bin, this.buffer); }
}
