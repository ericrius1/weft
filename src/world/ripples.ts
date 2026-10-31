// The ripple sim around the player (ripple.wgsl): a ping-pong pair of height fields, stepped once a frame. Anything
// can push the water: her legs wading, her strokes, the buggy's wheels, a splash. The env group binds the side that
// was written last (`pp.read`), so every surface that samples ripples sees this frame's water.
import type { Kit, Texture, PingPong, Compute, UniformBuffer, RunEntry, V3 } from '@ericrius1/weft';
import rippleShader from '../shaders/ripple.wgsl';

export const RIPPLE_N = 256;
export const RIPPLE_CELL = 0.22;
const MAX = 16;

export class Ripples {
  pp: PingPong<Texture>;
  u: UniformBuffer<any>;
  step: Compute;
  private origin: [number, number] = [0, 0];
  private imp = new Float32Array(MAX * 4);
  private n = 0;
  constructor(kit: Kit) {
    this.pp = kit.pingpong((i) => kit.texture({ label: `ripple${i}`, format: 'rgba16float', size: [RIPPLE_N, RIPPLE_N], usage: ['sample', 'storage', 'copy-dst'] }), 'ripple');
    this.u = kit.uniforms(rippleShader.structs.Ripple, 'ripple').set({ size: RIPPLE_N, cell: RIPPLE_CELL, damping: 0.988, speed: 0.12 });
    this.step = kit.compute(rippleShader, { label: 'ripple.step', bind: { ripple: this.u, src: this.pp.read, dst: this.pp.write }, threads: [RIPPLE_N, RIPPLE_N] });
  }

  /** push the water at x, z: radius (m), strength (m per step; negative pushes it down) */
  push(x: number, z: number, radius: number, strength: number) {
    if (this.n >= MAX) return;
    this.imp.set([x, z, radius, strength], this.n * 4);
    this.n++;
  }

  /** slide the window to follow `centre`, hand the sim this frame's pushes; returns world.ripple */
  update(centre: V3, dt: number): [number, number, number, number] {
    const half = RIPPLE_N / 2;
    const prev = this.origin;
    this.origin = [Math.floor(centre[0] / RIPPLE_CELL) - half, Math.floor(centre[2] / RIPPLE_CELL) - half];
    // the step is per frame: scale the wave speed (cells per step) and the damping with the frame time
    const k = Math.min(dt * 60, 1.8);
    this.u.set({
      origin: this.origin, prevOrigin: prev, speed: Math.min(0.12 * k * k, 0.45), damping: 0.988 ** k,
      impulses: this.imp, count: this.n,
    });
    this.imp.fill(0);
    this.n = 0;
    return [(this.origin[0] + half) * RIPPLE_CELL, (this.origin[1] + half) * RIPPLE_CELL, RIPPLE_N * RIPPLE_CELL, RIPPLE_N];
  }

  items(): RunEntry[] { return [this.step, this.pp.swap]; }
}
