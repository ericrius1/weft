import shader from '../shaders/lava.wgsl';
export const LAVA_TUNE = {
    mobility: 2.5, stiffen: 6,
    freeze: 0.42, freezeRate: 0.25,
    rockCool: 0.004, wear: 0.0006,
    cool: 0.0012, coolThin: 0.0035,
    yield: 0.01, yieldCool: 25,
};
export const TILE = 32;
export class LavaFlow {
    kit;
    n;
    cell;
    corner;
    U;
    bed;
    st;
    fl;
    probeBuf;
    glow;
    args;
    lists;
    tiles;
    vents;
    lake;
    tune = { ...LAVA_TUNE };
    substeps;
    speed;
    near;
    mid;
    /** off: nothing steps (the state stays as it is) */
    on = true;
    /** what's at the eye's cell (read back a few frames late): the lava's thickness, heat, the rock under it, the bed,
     *  the lava's top there (world y) and the highest top in the 3x3 round it (-1e9: none) */
    at = { h: 0, T: 0, s: 0, w: 0, bed: 0, top: -1e9, near: -1e9 };
    items = [];
    stepItems = [];
    finish = [];
    t = 0;
    reading = false;
    frameN = 0;
    bedData;
    bufs = [];
    constructor(kit, o) {
        this.kit = kit;
        if (o.n % TILE)
            throw new Error(`lava: n (${o.n}) is not a multiple of ${TILE}`);
        this.n = o.n;
        this.cell = o.cell;
        this.corner = o.corner;
        this.vents = o.vents ?? [];
        this.lake = o.lake ?? null;
        this.substeps = o.substeps ?? 2;
        this.speed = o.speed ?? 3;
        this.near = o.near ?? 300;
        this.mid = o.mid ?? 1100;
        const N2 = this.n * this.n;
        this.tiles = (this.n / TILE) ** 2;
        this.U = kit.uniforms(shader.structs.LavaU, 'lava');
        this.bedData = new Float32Array(N2);
        this.bed = kit.storage({ label: 'lava.bed', size: N2 * 4, usage: ['storage', 'copy-dst'] });
        this.st = kit.pingpong((i) => (this.bufs[i] = kit.storage({ label: `lava.st${i}`, size: N2 * 16, usage: ['storage', 'copy-dst', 'copy-src'] })), 'lava.st');
        this.fl = kit.storage({ label: 'lava.flux', size: N2 * 16, usage: ['storage', 'copy-dst'] });
        this.probeBuf = kit.storage({ label: 'lava.probe', size: 32, usage: ['storage', 'copy-src'] });
        this.glow = kit.texture({ label: 'lava.glow', format: 'rgba16float', size: [this.n / 8, this.n / 8], usage: ['storage', 'sample'] });
        this.args = kit.storage({ label: 'lava.args', size: 3 * 16, usage: ['storage', 'indirect'] });
        this.lists = kit.storage({ label: 'lava.lists', size: 3 * this.tiles * 4, usage: ['storage'] });
        const both = { L: this.U, bed: this.bed };
        const flux = kit.compute(shader, { entry: 'flux', label: 'lava.flux', bind: { ...both, stA: this.st.read, fl: this.fl }, threads: [this.n, this.n] });
        const advance = kit.compute(shader, { entry: 'advance', label: 'lava.advance', bind: { ...both, stA: this.st.read, stB: this.st.write, fl: this.fl }, threads: [this.n, this.n] });
        this.stepItems = [flux, advance, this.st.swap];
        const probe = kit.compute(shader, { entry: 'probe', label: 'lava.probe', bind: { ...both, stA: this.st.read, probeOut: this.probeBuf }, workgroups: [1, 1, 1] });
        const glow = kit.compute(shader, { entry: 'glow', label: 'lava.glow', bind: { ...both, stA: this.st.read, glowOut: this.glow }, threads: [this.n / 8, this.n / 8] });
        const clear = kit.compute(shader, { entry: 'clearArgs', label: 'lava.clear', bind: { L: this.U, args: this.args }, workgroups: [1, 1, 1] });
        const tiles = kit.compute(shader, { entry: 'tiles', label: 'lava.tiles', bind: { ...both, stA: this.st.read, args: this.args, lists: this.lists }, threads: [this.tiles] });
        this.finish = [probe, glow, clear, tiles];
        this.items = [flux, advance, probe, glow, clear, tiles];
    }
    /** the land's heights at the cells (world x, z -> y): at load, and again when the land under the lava comes finer */
    setBed(height) {
        const N = this.n, c = this.cell, [x0, z0] = this.corner, b = this.bedData;
        for (let j = 0; j < N; j++)
            for (let i = 0; i < N; i++)
                b[j * N + i] = height(x0 + (i + 0.5) * c, z0 + (j + 0.5) * c);
        this.bed.write(b);
    }
    /** the land's height the solver has at a cell's (x, z) */
    bedAt(x, z) {
        const N = this.n, i = Math.max(0, Math.min(N - 1, Math.floor((x - this.corner[0]) / this.cell))), j = Math.max(0, Math.min(N - 1, Math.floor((z - this.corner[1]) / this.cell)));
        return this.bedData[j * N + i];
    }
    /** all of it cleared: no lava, no rock (a film's start) */
    clear() {
        const z = new Float32Array(this.n * this.n * 4);
        for (const b of this.bufs)
            b.write(z);
    }
    /** the grid's middle and half its size (m) */
    get middle() { return [this.corner[0] + this.n * this.cell / 2, this.corner[1] + this.n * this.cell / 2]; }
    get half() { return this.n * this.cell / 2; }
    /** whether (x, z) is on the grid */
    covers(x, z) { return x > this.corner[0] && z > this.corner[1] && x < this.corner[0] + this.n * this.cell && z < this.corner[1] + this.n * this.cell; }
    update(dt, eye) {
        this.t += dt;
        const sub = Math.max(1, this.substeps);
        // (each substep's dt: the frame's, sped up, split; never past what the solver stays steady at)
        const h = Math.min((Math.min(dt, 0.05) * this.speed) / sub, 0.06);
        const T = this.tune;
        const ci = Math.floor((eye[0] - this.corner[0]) / this.cell), cj = Math.floor((eye[2] - this.corner[1]) / this.cell);
        const vents = new Float32Array(32);
        this.vents.slice(0, 8).forEach((v, k) => vents.set([v.x, v.z, v.radius, v.rate], k * 4));
        this.U.set({
            grid: [this.n, this.cell, this.corner[0], this.corner[1]],
            step: [this.on ? h : 0, this.t, T.mobility, T.stiffen],
            tune: [T.freeze, T.freezeRate, T.rockCool, T.wear],
            cool: [T.cool, T.coolThin, T.yield, T.yieldCool],
            lake: this.lake ? [this.lake.x, this.lake.level, this.lake.z, this.lake.radius] : [0, 0, 0, 0],
            eye: [eye[0], eye[1], eye[2], Math.max(0, cj) * this.n + Math.max(0, ci)],
            lod: [this.near, this.mid, 0, 0],
            ventN: [Math.min(8, this.vents.length), 0, 0, 0],
            vents: vents,
        });
        // (what's at the eye, read back now and then: the host's question whether the eye is in the lava)
        if (!this.reading && ++this.frameN % 4 === 0) {
            this.reading = true;
            void this.probeBuf.read(0, 32).then((b) => {
                const f = new Float32Array(b);
                Object.assign(this.at, { h: f[0], T: f[1], s: f[2], w: f[3], bed: f[4], top: f[5], near: f[6] });
            }).catch(() => { }).finally(() => { this.reading = false; });
        }
    }
    /** the items to run before the host's scene: the substeps, then what the draws and the host read */
    compute() {
        if (!this.on)
            return this.finish;
        const out = [];
        for (let i = 0; i < Math.max(1, this.substeps); i++)
            out.push(...this.stepItems);
        out.push(...this.finish);
        return out;
    }
    /** every pipeline it declared (await kit.ready(lava.pipelines) before a bake) */
    get pipelines() { return this.items; }
}
//# sourceMappingURL=lava.js.map