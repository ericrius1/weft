import { pipelinesOf, settle } from './passes';
import hizShader from '../shaders/hiz.wgsl';
export class HiZ {
    kit;
    source;
    label;
    texture;
    enabled = true;
    passes = [];
    builtFor = -1;
    builtMips = -1;
    constructor(kit, source, opts = {}) {
        this.kit = kit;
        this.source = source;
        this.label = opts.label ?? `${source.label}.hiz`;
        const baseScale = source.desc.scale ?? 1;
        const size = typeof source.desc.size === 'string'
            ? source.desc.size
            : [Math.max(1, Math.floor(source.width * 0.5)), Math.max(1, Math.floor(source.height * 0.5))];
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
    build() {
        const t = this.texture;
        for (const p of this.passes)
            p.dispose();
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
    encode(enc) {
        if (this.builtMips !== this.texture.mips)
            this.build();
        for (const p of this.passes)
            p.encode(enc);
    }
    ready() { return settle(() => pipelinesOf(this.passes)); }
    dispose() {
        for (const p of this.passes)
            p.dispose();
        this.passes = [];
        this.texture.destroy();
    }
}
//# sourceMappingURL=hiz.js.map