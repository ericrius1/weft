// A volume in the air (shaders/volume.wgsl): marched at a fraction of the resolution, blended with the last frames'
// where the same place was seen, and laid over the scene at full resolution by depth — for a world with its own
// renderer; San Francisco's fog's frame. The world's shader defines volumeMarch (its density and light) and includes
// loom/volume; this runs it: the targets, the march, the two histories in turn, the blend.
//
//   const vol = new LowResVolume(kit, fogShader, { label: 'fog', scale: 0.5 });
//   vol.attach(hdr, sceneZ);             // after the scene's distance is made
//   vol.update(steps, 0.85, user);       // each frame (user: the world's own vec4s for its march)
//   list.push(...vol.passes());          // after the scene: march, history, blend
import type { Kit, RenderPass, RunEntry, Shader, Texture, UniformBuffer } from '@ericrius1/weft';

export interface VolumeOptions {
  /** the passes' labels: `${label}.march`, `${label}.acc0|1`, `${label}.blend` ('volume') */
  label?: string;
  /** the march's share of the render's size (0.5) */
  scale?: number;
  /** the farthest the march reaches (m): the sky's taken as there (40 km) */
  far?: number;
  /** more bindings for the world's shader (its group 2 from binding 6) */
  bind?: Record<string, unknown>;
}

export class LowResVolume {
  readonly u: UniformBuffer<any>;
  /** whether it's drawn this frame (the world says: none of its passes run while not) */
  on: () => boolean = () => true;
  readonly scale: number;
  readonly far: number;
  readonly label: string;
  private list: RunEntry[] = [];
  private hist: Texture[] = [];
  private accPasses: RenderPass[] = [];
  private frame = 0;
  private flip = 0;
  private size: () => [number, number] = () => [1, 1];

  constructor(readonly kit: Kit, readonly shader: Shader<any, any>, private opts: VolumeOptions = {}) {
    this.scale = opts.scale ?? 0.5;
    this.far = opts.far ?? 40000;
    this.label = opts.label ?? 'volume';
    this.u = kit.uniforms(shader.structs.VolumeU, this.label);
  }

  /** the targets and the passes after the scene: the march, the histories, the blend into `hdr` (`sceneZ`: the
   *  scene's distance along the view, r32float metres, large for the sky) */
  attach(hdr: Texture, sceneZ: Texture) {
    const kit = this.kit, s = this.scale, L = this.label, shader = this.shader, extra = this.opts.bind ?? {};
    const volNew = kit.texture({ label: `${L}.new`, format: 'rgba16float', size: 'render', scale: s });
    const volNewZ = kit.texture({ label: `${L}.z`, format: 'r32float', size: 'render', scale: s, usage: ['render', 'sample'] });
    this.hist = [0, 1].map((i) => kit.texture({ label: `${L}.acc${i}`, format: 'rgba16float', size: 'render', scale: s }));
    const march = kit.pass({ label: `${L}.march`, color: [{ target: volNew, clear: [0, 0, 0, 1] }, { target: volNewZ, clear: [1e9, 0, 0, 0] }] });
    march.fullscreen(shader, { label: `${L}.march`, fragment: 'march', bind: { ...extra, V: this.u, volSceneZ: sceneZ } as never });
    this.accPasses = [0, 1].map((i) => {
      const p = kit.pass({ label: `${L}.acc${i}`, color: [{ target: this.hist[i], clear: [0, 0, 0, 1] }] });
      p.fullscreen(shader, { label: `${L}.acc${i}`, fragment: 'accumulate', bind: { ...extra, V: this.u, volNew, volNewZ, volPrev: this.hist[1 - i] } as never });
      return p;
    });
    const blend = kit.pass({ label: `${L}.blend`, color: [{ target: hdr, clear: false }] });
    const state: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
    for (const i of [0, 1]) blend.fullscreen(shader, { label: `${L}.blend${i}`, fragment: 'blend', blend: state, bind: { ...extra, V: this.u, volAcc: this.hist[i], volNewZ, volSceneZ: sceneZ } as never, enabled: () => this.flip === i && this.on() });
    this.list = [march, ...this.accPasses, blend];
    this.size = () => [volNew.width, volNew.height];
  }

  /** a frame on: `steps` along each ray, the history's weight (0: none), the world's own vec4s (up to 4) */
  update(steps: number, history: number, user: ArrayLike<number>[] = []) {
    this.frame++;
    this.flip = this.frame & 1;
    const [sx, sy] = this.size();
    const u = [0, 1, 2, 3].map((k) => (user[k] ? [user[k][0] ?? 0, user[k][1] ?? 0, user[k][2] ?? 0, user[k][3] ?? 0] : [0, 0, 0, 0]));
    this.u.set({ march: [steps, this.scale, history, this.frame % 64], res: [sx, sy, 1 / sx, 1 / sy], far: [this.far, 0, 0, 0], user: u as never });
  }

  /** this frame's accumulated volume (light, its transmittance in alpha) while it's drawn, else null */
  current(): Texture | null { return this.on() && this.hist.length ? this.hist[this.flip] : null; }

  /** the passes after the scene (none while it's off): the march, this frame's history, the blend */
  passes(): RunEntry[] {
    if (!this.on()) return [];
    const on = this.flip;
    return this.list.map((p) => (p === this.accPasses[0] || p === this.accPasses[1] ? (p === this.accPasses[on] ? p : null) : p));
  }
}
