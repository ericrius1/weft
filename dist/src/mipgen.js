import mipShader from '../shaders/mipgen.wgsl';
export class MipChain {
    kit;
    texture;
    label;
    enabled = true;
    passes = [];
    builtFor = -1;
    constructor(kit, texture) {
        this.kit = kit;
        this.texture = texture;
        this.label = `${texture.label}.mips`;
        this.build();
    }
    build() {
        const t = this.texture;
        for (const p of this.passes)
            p.dispose();
        this.passes = [];
        for (let m = 1; m < t.mips; m++) {
            const p = this.kit.pass({ label: `${this.label}${m}`, color: [{ target: t.mip(m), clear: false }] });
            p.fullscreen(mipShader, { label: `${this.label}${m}`, bind: { src: t.mip(m - 1) } });
            this.passes.push(p);
        }
        this.builtFor = t.version;
    }
    encode(enc) {
        if (this.builtFor !== this.texture.version && this.passes.length !== this.texture.mips - 1)
            this.build();
        for (const p of this.passes)
            p.encode(enc);
    }
    /** stop it for good (its passes' pipelines leave the kit) */
    dispose() {
        for (const p of this.passes)
            p.dispose();
        this.passes = [];
    }
}
//# sourceMappingURL=mipgen.js.map