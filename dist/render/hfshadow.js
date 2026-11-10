import hfShader from '../shaders/hfshadow.wgsl';
export class TerrainShadow {
    N;
    band;
    /** what the scene samples */
    shown;
    build;
    u;
    bake;
    copy;
    row = 0;
    rows = 0;
    done = false;
    ready = false;
    /** the window (world xz origin, size m, texels) */
    win;
    constructor(kit, heights, half, N = 2048, band = 128) {
        this.N = N;
        this.band = band;
        this.shown = kit.texture({ label: 'hfshadow', format: 'rgba8unorm', size: [N, N], usage: ['sample', 'copy-dst'] });
        this.build = kit.texture({ label: 'hfshadow.build', format: 'rgba8unorm', size: [N, N], usage: ['storage', 'copy-src'] });
        this.win = [-half, -half, 2 * half, N];
        this.u = kit.uniforms(hfShader.structs.HF, 'hfshadow').set({ win: this.win });
        this.bake = kit.compute(hfShader, { label: 'hfshadow.bake', bind: { hf: this.u, heights, hfOut: this.build }, threads: () => [N, this.rows] });
        this.copy = kit.copy(this.build, this.shown, 'hfshadow.swap');
        this.copy.enabled = false;
    }
    /** this frame's work toward the light direction `dir` */
    items(dir) {
        if (this.row === 0)
            this.u.set({ dir: [...dir, 0] });
        // (the first map in one go, behind the loading screen; then a band a frame)
        this.rows = this.ready ? Math.min(this.band, this.N - this.row) : this.N - this.row;
        this.u.set({ row: [this.row, 0, 0, 0] });
        this.row += this.rows;
        this.done = this.row >= this.N;
        if (this.done) {
            this.row = 0;
            this.ready = true;
        }
        this.copy.enabled = this.done;
        return [this.bake, this.copy];
    }
}
//# sourceMappingURL=hfshadow.js.map