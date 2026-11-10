import clusterShader from '../shaders/clusters.wgsl';
export class LightClusters {
    kit;
    /** the grid's reach from the camera: across and up / down (m) */
    reach = { across: 400, up: 200 };
    cells;
    cap;
    /** 64-byte records a cell (its count and up to `cap` indices, as floats) */
    perCell;
    /** records in all (the Renderer copies `buffer` into the point lights' buffer, after the lights) */
    records;
    /** the cells' lists, binned each frame */
    buffer;
    items;
    bin;
    centre = [0, 0, 0];
    count = 0;
    constructor(kit, lights, envx, opts = {}) {
        this.kit = kit;
        // (lights: the point lights' buffer, read for the lights alone — its first records)
        this.cells = opts.cells ?? [32, 16, 32];
        this.cap = Math.max(1, Math.min(255, Math.round(opts.cap ?? 24)));
        const total = this.cells[0] * this.cells[1] * this.cells[2];
        this.perCell = Math.ceil((this.cap + 1) / 16);
        this.records = total * this.perCell;
        this.buffer = kit.storage({ label: 'lightCells', size: this.records * 64 });
        this.bin = kit.compute(clusterShader, {
            label: 'lights.bin', entry: 'bin', threads: [total], enabled: () => this.count > 0,
            bind: { gx: envx, gridLights: lights, cellsOut: this.buffer },
        });
        // (no lights: every cell empty, without the dispatch)
        const clear = kit.raw((enc) => { if (this.count === 0)
            enc.clearBuffer(this.buffer.gpu); }, 'lights.clear');
        this.items = [clear, this.bin];
    }
    /** this frame's grid: round the camera, over the lights in plights (the count written there) */
    update(cam, count) {
        this.centre = [cam[0], cam[1], cam[2]];
        this.count = count;
    }
    /** the shaders' values for it (envx: grid, gridR, gridN) */
    envx(on) {
        return {
            grid: [...this.centre, on ? 1 : 0], gridR: [this.reach.across, this.reach.up, this.cap, this.count], gridN: [...this.cells, 0],
        };
    }
    dispose() { this.kit.release(this.bin, this.buffer); }
}
//# sourceMappingURL=clusters.js.map