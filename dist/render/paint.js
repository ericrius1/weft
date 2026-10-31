import paintShader from '../shaders/paint.wgsl';
const MAX_SPLATS = 48;
/** the stamp box, in voxels across: a splat's radius must fit in half of it */
const BOX = 16;
export class Paint {
    kit;
    origin;
    voxel;
    dims;
    /** the volume surfaces sample (rgba8: the three paints, the stamp's time) */
    tex;
    grid;
    u;
    splatBuf;
    pass;
    queue = [];
    batch = [];
    splatData = new Float32Array(MAX_SPLATS * 8);
    /** the three paints' colours (linear) */
    colors = [[1, 0.06, 0.45], [1, 0.62, 0.02], [0.02, 0.78, 0.86]];
    clock = 0;
    /** the CPU's copy, a byte a voxel: the paint that dominates (top 2 bits: 0 none, 1..3 that paint + 1), its cover (6) */
    cpu;
    skin = null;
    /** how many voxels a surface passes through; how many of them each paint holds (at least half covered) */
    skinCount = 0;
    painted = [0, 0, 0];
    constructor(kit, o) {
        this.kit = kit;
        this.voxel = o.voxel;
        this.origin = [o.lo[0], o.lo[1], o.lo[2]];
        this.dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil((o.hi[k] - o.lo[k]) / o.voxel)));
        const [nx, ny, nz] = this.dims;
        this.cpu = new Uint8Array(nx * ny * nz);
        this.grid = kit.texture({ label: 'paint.grid', format: 'r32uint', size: [nx, ny, nz], dimension: '3d', usage: ['storage'] });
        this.tex = kit.texture({ label: 'paint.tex', format: 'rgba8unorm', size: [nx, ny, nz], dimension: '3d', usage: ['storage', 'sample'] });
        this.u = kit.uniforms(paintShader.structs.PaintU, 'paint');
        this.splatBuf = kit.storage({ label: 'paint.splats', size: MAX_SPLATS * 32, usage: ['storage', 'copy-dst'] });
        this.pass = kit.compute(paintShader, { label: 'paint.splat', entry: 'splat', bind: { PU: this.u, splats: this.splatBuf, paintGrid: this.grid, paintOut: this.tex }, threads: () => [BOX, BOX, BOX * Math.max(1, this.batch.length)] });
    }
    /** what a surface shader binds to read the paint */
    get bindings() { return { PU: this.u, paintTex: this.tex, paintSamp: 'linear' }; }
    /** the voxels a scene's surfaces pass through: what the coverage counts */
    setScene(sdf) {
        const [nx, ny, nz] = this.dims, v = this.voxel, half = v * 0.87;
        const skin = new Uint8Array(nx * ny * nz);
        let n = 0;
        for (let z = 0; z < nz; z++)
            for (let y = 0; y < ny; y++)
                for (let x = 0; x < nx; x++) {
                    const d = sdf.dist(this.origin[0] + (x + 0.5) * v, this.origin[1] + (y + 0.5) * v, this.origin[2] + (z + 0.5) * v);
                    if (Math.abs(d) < half) {
                        skin[(z * ny + y) * nx + x] = 1;
                        n++;
                    }
                }
        this.skin = skin;
        this.skinCount = n;
    }
    /** splat paint (or bleach) on the world: the CPU's copy at once, the GPU's at the next frame */
    splat(s) {
        this.queue.push(s);
        this.applyCpu(s);
    }
    /** the paint at a point (the voxel holding it): which (-1 none) and how much */
    at(p) {
        const [nx, ny, nz] = this.dims;
        const x = Math.floor((p[0] - this.origin[0]) / this.voxel), y = Math.floor((p[1] - this.origin[1]) / this.voxel), z = Math.floor((p[2] - this.origin[2]) / this.voxel);
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz)
            return { paint: -1, cover: 0 };
        const b = this.cpu[(z * ny + y) * nx + x];
        return { paint: (b >> 6) - 1, cover: (b & 63) / 63 };
    }
    /** the paint under a surface point (normal n): a little inside it, as the shaders read it */
    surface(p, n) {
        const k = this.voxel * 0.3;
        return this.at([p[0] - n[0] * k, p[1] - n[1] * k, p[2] - n[2] * k]);
    }
    /** how much of the scene's surface is painted (any paint), 0..1 */
    get coverage() { return this.skinCount ? (this.painted[0] + this.painted[1] + this.painted[2]) / this.skinCount : 0; }
    applyCpu(s) {
        const [nx, ny, nz] = this.dims, v = this.voxel;
        const cx = (s.p[0] - this.origin[0]) / v, cy = (s.p[1] - this.origin[1]) / v, cz = (s.p[2] - this.origin[2]) / v;
        const rv = (s.r / v) * 0.86, rr = Math.ceil(rv);
        const strength = s.strength ?? 1;
        for (let z = Math.max(0, Math.floor(cz - rr)); z <= Math.min(nz - 1, Math.floor(cz + rr)); z++)
            for (let y = Math.max(0, Math.floor(cy - rr)); y <= Math.min(ny - 1, Math.floor(cy + rr)); y++)
                for (let x = Math.max(0, Math.floor(cx - rr)); x <= Math.min(nx - 1, Math.floor(cx + rr)); x++) {
                    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz);
                    if (d > rv)
                        continue;
                    const t = Math.min(1, Math.max(0, (d - rv * 0.72) / (rv * 0.28)));
                    const cov = (1 - t * t * (3 - 2 * t)) * strength;
                    if (cov <= 0)
                        continue;
                    const i = (z * ny + y) * nx + x;
                    const b = this.cpu[i], was = (b >> 6) - 1, wasC = (b & 63) / 63;
                    let now = was, nowC = wasC;
                    if (s.paint >= 3)
                        nowC = wasC * (1 - cov);
                    else if (was === s.paint || was < 0) {
                        now = s.paint;
                        nowC = Math.max(wasC, cov);
                    }
                    else {
                        const left = wasC * (1 - cov);
                        if (cov >= left) {
                            now = s.paint;
                            nowC = cov;
                        }
                        else
                            nowC = left;
                    }
                    if (nowC < 0.02) {
                        now = -1;
                        nowC = 0;
                    }
                    this.cpu[i] = ((now + 1) << 6) | Math.round(nowC * 63);
                    if (this.skin && this.skin[i]) {
                        if (was >= 0 && wasC >= 0.5)
                            this.painted[was]--;
                        if (now >= 0 && nowC >= 0.5)
                            this.painted[now]++;
                    }
                }
    }
    /** advance the clock; this frame's splats to the GPU */
    update(dt) {
        this.clock += dt;
        this.batch = this.queue.splice(0, MAX_SPLATS);
        this.batch.forEach((s, i) => this.splatData.set([s.p[0], s.p[1], s.p[2], Math.min(s.r, (BOX / 2 - 0.5) * this.voxel), s.paint, Math.random(), this.clock % 256, s.strength ?? 1], i * 8));
        if (this.batch.length)
            this.splatBuf.write(this.splatData.subarray(0, this.batch.length * 8));
        this.u.set({
            origin: [...this.origin, this.voxel], dims: [...this.dims, this.clock % 256],
            colors: this.colors.map((c) => [c[0], c[1], c[2], 1]), count: [this.batch.length, BOX, 0, 0],
        });
    }
    /** the stamping pass (none when there's nothing to stamp) */
    items() { return this.batch.length ? [this.pass] : []; }
}
//# sourceMappingURL=paint.js.map