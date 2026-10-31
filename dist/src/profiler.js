import { BUF, MAP } from './gpuconst';
const PAIRS = 128;
export class Profiler {
    kit;
    available;
    /** keep timing even with the overlay closed (e.g. for dynamic resolution) */
    force = false;
    /** ms per pass label, smoothed */
    ms = new Map();
    /** whole-frame GPU time (first pass start → last pass end), smoothed */
    frameMs = 0;
    /** the newest completed frame's GPU time, raw */
    lastFrameMs = 0;
    /** the newest completed frame's ms per pass label, raw */
    lastMs = new Map();
    /** bumped with each completed frame's raw numbers (a frame read back is counted once) */
    serial = 0;
    qs = null;
    resolveBuf = null;
    readBuf = null;
    next = 0;
    resolved = 0;
    labels = [];
    pending = false;
    on = false;
    constructor(kit) {
        this.kit = kit;
        this.available = kit.features.has('timestamp-query');
    }
    get active() { return this.available && (this.force || this.kit.overlay.open); }
    beginFrame() {
        this.on = this.active;
        this.next = 0;
        this.resolved = 0;
        this.labels = [];
        if (this.on && !this.qs) {
            const d = this.kit.device;
            this.qs = d.createQuerySet({ type: 'timestamp', count: PAIRS * 2 });
            this.resolveBuf = d.createBuffer({ label: 'weft.ts.resolve', size: PAIRS * 16, usage: BUF.QUERY_RESOLVE | BUF.COPY_SRC });
            this.readBuf = d.createBuffer({ label: 'weft.ts.read', size: PAIRS * 16, usage: BUF.MAP_READ | BUF.COPY_DST });
        }
    }
    writes(label) {
        if (!this.on || !this.qs || this.next + 2 > PAIRS * 2)
            return undefined;
        const i = this.next;
        this.next += 2;
        this.labels.push(label);
        return { querySet: this.qs, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 };
    }
    /** resolve what this run wrote (appended to the run's command buffers) */
    resolve(cbs) {
        if (!this.on || !this.qs || this.next === this.resolved)
            return;
        const enc = this.kit.device.createCommandEncoder({ label: 'weft.ts' });
        // (a resolve's destination offset must be a multiple of 256 bytes, i.e. 32 queries: a second kit.run in a frame
        // starts mid-block, so resolve from the block's start — re-resolving a few written queries is harmless)
        const start = Math.floor(this.resolved / 32) * 32;
        enc.resolveQuerySet(this.qs, start, this.next - start, this.resolveBuf, start * 8);
        this.resolved = this.next;
        cbs.push(enc.finish());
    }
    endFrame() {
        if (!this.on || !this.qs || this.pending || this.resolved === 0)
            return;
        const n = this.resolved;
        const labels = this.labels.slice();
        const enc = this.kit.device.createCommandEncoder({ label: 'weft.ts.copy' });
        enc.copyBufferToBuffer(this.resolveBuf, 0, this.readBuf, 0, n * 8);
        this.kit.queue.submit([enc.finish()]);
        this.pending = true;
        const rb = this.readBuf;
        rb.mapAsync(MAP.READ, 0, n * 8).then(() => {
            const t = new BigUint64Array(rb.getMappedRange(0, n * 8).slice(0));
            rb.unmap();
            this.pending = false;
            let first = Infinity, last = 0;
            const frame = new Map();
            for (let p = 0; p < labels.length; p++) {
                const a = Number(t[p * 2]), b = Number(t[p * 2 + 1]);
                if (!a || !b || b < a)
                    continue;
                const ms = (b - a) / 1e6;
                if (ms > 1000)
                    continue;
                frame.set(labels[p], (frame.get(labels[p]) ?? 0) + ms);
                first = Math.min(first, a);
                last = Math.max(last, b);
            }
            this.lastMs = frame;
            for (const [k, v] of frame)
                this.ms.set(k, (this.ms.get(k) ?? v) * 0.9 + v * 0.1);
            if (last > first) {
                const total = (last - first) / 1e6;
                this.lastFrameMs = total;
                this.serial++;
                this.frameMs = this.frameMs ? this.frameMs * 0.9 + total * 0.1 : total;
            }
        }).catch(() => { this.pending = false; });
    }
}
//# sourceMappingURL=profiler.js.map