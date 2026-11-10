// The sea's geometry (a radial grid around the camera) and its waves: a dozen Gerstner waves spread around the wind.
import type { Kit, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import { rng } from '@ericrius1/weft';
import oceanShader from '../shaders/ocean.wgsl';

export const RINGS = 150;
export const SEGMENTS = 192;

export class Ocean {
  index: StorageBuffer;
  count: number;
  vertexCount: number;
  uniforms: UniformBuffer<any>;
  waves: { d: [number, number]; k: number; a: number; w: number; q: number; phase: number }[] = [];
  constructor(kit: Kit) {
    const seg = SEGMENTS + 1;
    const idx: number[] = [];
    // the centre fan: ring 0 is a single point repeated
    for (let r = 0; r < RINGS - 1; r++) {
      for (let s = 0; s < SEGMENTS; s++) {
        const a = r * seg + s, b = a + 1, c = a + seg, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    this.index = kit.storage({ label: 'ocean.index', data: new Uint32Array(idx), usage: ['index', 'storage', 'copy-dst'] });
    this.count = idx.length;
    this.vertexCount = RINGS * seg;
    this.uniforms = kit.uniforms(oceanShader.structs.Ocean, 'ocean');
    this.setSea(1.0, [0.8, 0.45]);
    this.uniforms.set({
      ringCount: RINGS, segments: SEGMENTS, innerRadius: 1.6, growth: 1.072, snap: 2.0,
      absorb: [0.46, 0.085, 0.055], scatter: [0.02, 0.24, 0.26], deep: [0.004, 0.035, 0.085], foam: 1, refraction: 0.04, glint: 1.4,
    });
  }
  /** swell height (m, roughly the biggest wave's) and the wind's direction */
  setSea(height: number, wind: [number, number]) {
    const r = rng(42);
    const base = Math.atan2(wind[1], wind[0]);
    this.waves = [];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const L = 70 * Math.pow(0.72, i) + 2; // wavelength
      const k = (2 * Math.PI) / L;
      const w = Math.sqrt(9.81 * k);
      const ang = base + (r() - 0.5) * (i < 3 ? 0.7 : 1.9);
      const a = (height * 0.5 * Math.pow(0.66, i)) / (1 + i * 0.15);
      const steep = 0.75;
      this.waves.push({ d: [Math.cos(ang), Math.sin(ang)], k, a, w, q: Math.min(1, steep / (k * a * n + 1e-6)) * 0.9, phase: r() * Math.PI * 2 });
    }
    this.uniforms.set({ count: n, waves: this.waves.map((x) => ({ d: x.d, k: x.k, a: x.a, w: x.w, q: x.q, phase: x.phase })) });
  }
  /** sea surface height (Gerstner sum, no horizontal correction) at a point — swimming, buoyancy */
  heightAt(x: number, z: number, t: number, fade = 1) {
    let h = 0;
    for (const w of this.waves) h += w.a * fade * Math.sin(w.k * (w.d[0] * x + w.d[1] * z) - w.w * t + w.phase);
    return h;
  }
}
