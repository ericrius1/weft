// A run item that builds a conservative min/max hierarchical linear-depth (Hi-Z) pyramid (`rg16float`) from a
// linear view-z texture (`r32float`, e.g. `sceneZ`). Level 0 is half the source's resolution (2x2 conservative min/max),
// stepping down to 1x1 (or `maxMips`). Rebuilds automatically when the render size changes.
import type { Kit } from './kit';
import { type RunItem, type RenderPass, pipelinesOf, settle } from './passes';
import type { Texture } from './resources';
import hizShader from '../shaders/hiz.wgsl';

export interface HiZOptions {
  label?: string;
  /** cap on mip levels (default 'full' down to 1x1) */
  maxMips?: number | 'full';
}

export class HiZ implements RunItem {
  readonly label: string;
  readonly texture: Texture;
  enabled = true;
  passes: RenderPass[] = [];
  private builtFor = -1;
  private builtMips = -1;

  constructor(private kit: Kit, readonly source: Texture, opts: HiZOptions = {}) {
    this.label = opts.label ?? `${source.label}.hiz`;
    const baseScale = source.desc.scale ?? 1;
    const size = typeof source.desc.size === 'string'
      ? source.desc.size
      : [Math.max(1, Math.floor(source.width * 0.5)), Math.max(1, Math.floor(source.height * 0.5))] as [number, number];
    this.texture = kit.texture({
      label: this.label,
      format: 'rg16float',
      size,
      scale: typeof source.desc.size === 'string' ? baseScale * 0.5 : undefined,
      mips: opts.maxMips ?? 'full',
      usage: ['render', 'sample'],
    });
    this.build();
  }

  private build() {
    const t = this.texture;
    for (const p of this.passes) p.dispose();
    this.passes = [];
    const p0 = this.kit.pass({ label: `${this.label}0`, color: [{ target: t.mip(0), clear: false }] });
    p0.fullscreen(hizShader, { label: `${this.label}0`, fragment: 'first', bind: { src: this.source } });
    this.passes.push(p0);
    for (let m = 1; m < t.mips; m++) {
      const p = this.kit.pass({ label: `${this.label}${m}`, color: [{ target: t.mip(m), clear: false }] });
      p.fullscreen(hizShader, { label: `${this.label}${m}`, fragment: 'down', bind: { src: t.mip(m - 1) } });
      this.passes.push(p);
    }
    this.builtFor = t.version;
    this.builtMips = t.mips;
  }

  encode(enc: GPUCommandEncoder) {
    if (this.builtMips !== this.texture.mips) this.build();
    for (const p of this.passes) p.encode(enc);
  }

  ready() { return settle(() => pipelinesOf(this.passes)); }

  dispose() {
    for (const p of this.passes) p.dispose();
    this.passes = [];
    this.texture.destroy();
  }
}
