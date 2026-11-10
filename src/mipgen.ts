// A run item that fills a texture's mip chain from level 0 (render passes, so the format must be renderable).
// The passes are rebuilt when the texture is reallocated (a resize changes the number of levels). Its shader binds
// in group 3 of its own, whatever an app shares there.
import type { Kit } from './kit';
import { type RunItem, type RenderPass, pipelinesOf, settle } from './passes';
import type { Texture } from './resources';
import mipShader from '../shaders/mipgen.wgsl';

export class MipChain implements RunItem {
  readonly label: string;
  enabled = true;
  /** its passes, a level each (kit.ready(chain) waits for their pipelines: a chain run before they're compiled
   *  draws nothing, and the mips stay black) */
  passes: RenderPass[] = [];
  private builtFor = -1;
  constructor(private kit: Kit, readonly texture: Texture) {
    this.label = `${texture.label}.mips`;
    this.build();
  }
  private build() {
    const t = this.texture;
    for (const p of this.passes) p.dispose();
    this.passes = [];
    for (let m = 1; m < t.mips; m++) {
      const p = this.kit.pass({ label: `${this.label}${m}`, color: [{ target: t.mip(m), clear: false }] });
      p.fullscreen(mipShader, { label: `${this.label}${m}`, bind: { src: t.mip(m - 1) } });
      this.passes.push(p);
    }
    this.builtFor = t.version;
  }
  encode(enc: GPUCommandEncoder) {
    if (this.builtFor !== this.texture.version && this.passes.length !== this.texture.mips - 1) this.build();
    for (const p of this.passes) p.encode(enc);
  }
  /** its pipelines compiled (the same as kit.ready(chain)) */
  ready() { return settle(() => pipelinesOf(this.passes)); }
  /** stop it for good (its passes' pipelines leave the kit) */
  dispose() {
    for (const p of this.passes) p.dispose();
    this.passes = [];
  }
}
