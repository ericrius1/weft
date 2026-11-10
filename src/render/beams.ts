// Light in the air (shaders/beams.wgsl): headlights, lamps, the lightning made visible by rain and mist. A half-res
// pass (after the scene's depth is complete: add `items` to the renderer's beforeFx) — per lamp a few samples along the
// stretch of each view ray inside its reach and cone, spaced equi-angularly — and a full-res composite into an hdr
// pass. `air.scatter` is how thick the air is with rain; `air.maxDist` how far along a ray to look.
import type { Kit, Compute, RenderPass, Texture, UniformBuffer } from '@ericrius1/weft';
import type { PointLight } from './renderer';
import beamsShader from '../shaders/beams.wgsl';

export class Beams {
  air = { scatter: 0.0016, extinction: 0.0025, maxDist: 3000 };
  /** the phase's two lobes: the drops' narrow forward one (g), the mist's broad one (g), the narrow one's share */
  phase = { drops: 0.92, mist: 0.35, share: 0.55 };
  /** samples per lamp along its stretch of each ray */
  params = { samples: 8, strength: 1 };
  private lights: number[][] = [];
  on = true;
  private u: UniformBuffer<any>;
  private tex: Texture;
  private pass: Compute;
  private frame = 0;

  constructor(kit: Kit, depth: Texture) {
    this.u = kit.uniforms(beamsShader.structs.BeamsU, 'beams');
    this.tex = kit.texture({ label: 'beams', format: 'rgba16float', size: 'render', scale: 0.5, usage: ['storage', 'sample', 'copy-src'] });
    this.pass = kit.compute(beamsShader, { label: 'beams.march', entry: 'march', bind: { B: this.u, sceneDepth: depth, outTex: this.tex }, threads: () => [this.tex.width, this.tex.height], enabled: () => this.on });
    this.depth = depth;
  }
  private depth: Texture;
  /** the march (run after the scene's depth is done) */
  get items() { return [this.pass]; }
  /** the composite into an hdr pass */
  addTo(pass: RenderPass) {
    pass.fullscreen(beamsShader, { label: 'beams.composite', fragment: 'composite', bind: { B: this.u, sceneDepth: this.depth, inTex: this.tex }, blend: 'add', depthCompare: 'always', enabled: () => this.on } as never);
  }
  /** the lamps that show in the air this frame: the hazy ones (haze > 0.05), the nearest eight to the camera */
  setLights(list: PointLight[], cam: ArrayLike<number>) {
    const d2 = (l: PointLight) => (l.pos[0] - cam[0]) ** 2 + (l.pos[1] - cam[1]) ** 2 + (l.pos[2] - cam[2]) ** 2;
    const hazy = list.filter((l) => (l.haze ?? 1) > 0.05 && (l.radius > 1000 || Math.sqrt(d2(l)) - l.radius < this.air.maxDist)).sort((a, b) => d2(a) - d2(b)).slice(0, 8);
    this.lights = hazy.map((l) => { const h = l.haze ?? 1; return [...l.pos, l.radius, l.color[0] * h, l.color[1] * h, l.color[2] * h, l.size ?? 0.3, ...(l.dir ?? [0, -1, 0]), l.dir ? Math.cos(l.outer ?? 0.6) : -2, l.dir ? Math.cos(l.inner ?? 0.35) : -2, l.owner ?? 0, l.squash ?? 1, 1]; });
  }
  update() {
    this.frame++;
    const A = this.air, P = this.params;
    const lights = Array.from({ length: 8 }, (_, i) => {
      const a = this.lights[i] ?? Array(16).fill(0);
      return { pos: a.slice(0, 3), radius: a[3], color: a.slice(4, 7), size: a[7], dir: a.slice(8, 11), cosOuter: a[11], cosInner: a[12], p0: a[13], p1: a[14], p2: a[15] };
    });
    const F = this.phase;
    this.u.set({ air: [A.scatter, A.extinction, 0, A.maxDist], march: [P.samples, this.frame % 64, P.strength, this.lights.length], phase: [F.drops, F.mist, F.share, 0], lights });
  }
}
