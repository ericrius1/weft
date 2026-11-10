export class LowResVolume {
    kit;
    shader;
    opts;
    u;
    /** whether it's drawn this frame (the world says: none of its passes run while not) */
    on = () => true;
    scale;
    far;
    label;
    list = [];
    hist = [];
    accPasses = [];
    frame = 0;
    flip = 0;
    size = () => [1, 1];
    constructor(kit, shader, opts = {}) {
        this.kit = kit;
        this.shader = shader;
        this.opts = opts;
        this.scale = opts.scale ?? 0.5;
        this.far = opts.far ?? 40000;
        this.label = opts.label ?? 'volume';
        this.u = kit.uniforms(shader.structs.VolumeU, this.label);
    }
    /** the targets and the passes after the scene: the march, the histories, the blend into `hdr` (`sceneZ`: the
     *  scene's distance along the view, r32float metres, large for the sky) */
    attach(hdr, sceneZ) {
        const kit = this.kit, s = this.scale, L = this.label, shader = this.shader, extra = this.opts.bind ?? {};
        const volNew = kit.texture({ label: `${L}.new`, format: 'rgba16float', size: 'render', scale: s });
        const volNewZ = kit.texture({ label: `${L}.z`, format: 'r32float', size: 'render', scale: s, usage: ['render', 'sample'] });
        this.hist = [0, 1].map((i) => kit.texture({ label: `${L}.acc${i}`, format: 'rgba16float', size: 'render', scale: s }));
        const march = kit.pass({ label: `${L}.march`, color: [{ target: volNew, clear: [0, 0, 0, 1] }, { target: volNewZ, clear: [1e9, 0, 0, 0] }] });
        march.fullscreen(shader, { label: `${L}.march`, fragment: 'march', bind: { ...extra, V: this.u, volSceneZ: sceneZ } });
        this.accPasses = [0, 1].map((i) => {
            const p = kit.pass({ label: `${L}.acc${i}`, color: [{ target: this.hist[i], clear: [0, 0, 0, 1] }] });
            p.fullscreen(shader, { label: `${L}.acc${i}`, fragment: 'accumulate', bind: { ...extra, V: this.u, volNew, volNewZ, volPrev: this.hist[1 - i] } });
            return p;
        });
        const blend = kit.pass({ label: `${L}.blend`, color: [{ target: hdr, clear: false }] });
        const state = { color: { srcFactor: 'one', dstFactor: 'src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
        for (const i of [0, 1])
            blend.fullscreen(shader, { label: `${L}.blend${i}`, fragment: 'blend', blend: state, bind: { ...extra, V: this.u, volAcc: this.hist[i], volNewZ, volSceneZ: sceneZ }, enabled: () => this.flip === i && this.on() });
        this.list = [march, ...this.accPasses, blend];
        this.size = () => [volNew.width, volNew.height];
    }
    /** a frame on: `steps` along each ray, the history's weight (0: none), the world's own vec4s (up to 4) */
    update(steps, history, user = []) {
        this.frame++;
        this.flip = this.frame & 1;
        const [sx, sy] = this.size();
        const u = [0, 1, 2, 3].map((k) => (user[k] ? [user[k][0] ?? 0, user[k][1] ?? 0, user[k][2] ?? 0, user[k][3] ?? 0] : [0, 0, 0, 0]));
        this.u.set({ march: [steps, this.scale, history, this.frame % 64], res: [sx, sy, 1 / sx, 1 / sy], far: [this.far, 0, 0, 0], user: u });
    }
    /** this frame's accumulated volume (light, its transmittance in alpha) while it's drawn, else null */
    current() { return this.on() && this.hist.length ? this.hist[this.flip] : null; }
    /** the passes after the scene (none while it's off): the march, this frame's history, the blend */
    passes() {
        if (!this.on())
            return [];
        const on = this.flip;
        return this.list.map((p) => (p === this.accPasses[0] || p === this.accPasses[1] ? (p === this.accPasses[on] ? p : null) : p));
    }
}
//# sourceMappingURL=volume.js.map