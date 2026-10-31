// Per-pass GPU timestamps (when the adapter has 'timestamp-query'). Active while the overlay is open or when an app
// forces it (dynamic resolution). On Apple's tile-based GPUs per-pass numbers describe the pass structure more than
// its cost — the frame total is trustworthy; compare passes by switching them off (the overlay's checkboxes).
// The overlay reads the smoothed numbers; a performance test reads each completed frame's raw ones (lastFrameMs,
// lastMs), counting them by `serial`.
import type { Kit } from './kit';
import { BUF, MAP } from './gpuconst';

const PAIRS = 128;

export class Profiler {
  readonly available: boolean;
  /** keep timing even with the overlay closed (e.g. for dynamic resolution) */
  force = false;
  /** ms per pass label, smoothed: only passes seen in the last `stale` frames read back (one run while loading, or
   *  switched off, isn't shown as a current cost) */
  readonly ms = new Map<string, number>();
  /** frames read back a pass may go unseen before it leaves `ms` */
  stale = 60;
  /** whole-frame GPU time (first pass start → last pass end), smoothed */
  frameMs = 0;
  /** the newest completed frame's GPU time, raw */
  lastFrameMs = 0;
  /** the newest completed frame's ms per pass label, raw */
  lastMs = new Map<string, number>();
  /** bumped with each completed frame's raw numbers (a frame read back is counted once) */
  serial = 0;
  private qs: GPUQuerySet | null = null;
  private resolveBuf: GPUBuffer | null = null;
  private readBuf: GPUBuffer | null = null;
  private next = 0;
  private resolved = 0;
  private labels: string[] = [];
  private pending = false;
  private on = false;
  // (frames read back, and the last one each pass was in)
  private reads = 0;
  private seen = new Map<string, number>();

  constructor(private kit: Kit) {
    this.available = kit.features.has('timestamp-query');
  }
  get active() { return this.available && (this.force || this.kit.overlay.open); }

  beginFrame() {
    // (timing again after a while off: what it had is old)
    if (this.active && !this.on) { this.ms.clear(); this.seen.clear(); }
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

  writes(label: string): GPURenderPassTimestampWrites | undefined {
    if (!this.on || !this.qs || this.next + 2 > PAIRS * 2) return undefined;
    const i = this.next;
    this.next += 2;
    this.labels.push(label);
    return { querySet: this.qs, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 };
  }

  /** resolve what this run wrote (appended to the run's command buffers) */
  resolve(cbs: GPUCommandBuffer[]) {
    if (!this.on || !this.qs || this.next === this.resolved) return;
    const enc = this.kit.device.createCommandEncoder({ label: 'weft.ts' });
    // (a resolve's destination offset must be a multiple of 256 bytes, i.e. 32 queries: a second kit.run in a frame
    // starts mid-block, so resolve from the block's start — re-resolving a few written queries is harmless)
    const start = Math.floor(this.resolved / 32) * 32;
    enc.resolveQuerySet(this.qs, start, this.next - start, this.resolveBuf!, start * 8);
    this.resolved = this.next;
    cbs.push(enc.finish());
  }

  endFrame() {
    if (!this.on || !this.qs || this.pending || this.resolved === 0) return;
    const n = this.resolved;
    const labels = this.labels.slice();
    const enc = this.kit.device.createCommandEncoder({ label: 'weft.ts.copy' });
    enc.copyBufferToBuffer(this.resolveBuf!, 0, this.readBuf!, 0, n * 8);
    this.kit.queue.submit([enc.finish()]);
    this.pending = true;
    const rb = this.readBuf!;
    rb.mapAsync(MAP.READ, 0, n * 8).then(() => {
      const t = new BigUint64Array(rb.getMappedRange(0, n * 8).slice(0));
      rb.unmap();
      this.pending = false;
      let first = Infinity, last = 0;
      const frame = new Map<string, number>();
      for (let p = 0; p < labels.length; p++) {
        const a = Number(t[p * 2]), b = Number(t[p * 2 + 1]);
        if (!a || !b || b < a) continue;
        const ms = (b - a) / 1e6;
        if (ms > 1000) continue;
        frame.set(labels[p], (frame.get(labels[p]) ?? 0) + ms);
        first = Math.min(first, a);
        last = Math.max(last, b);
      }
      this.lastMs = frame;
      const r = ++this.reads;
      for (const [k, v] of frame) { this.ms.set(k, (this.ms.get(k) ?? v) * 0.9 + v * 0.1); this.seen.set(k, r); }
      for (const k of this.ms.keys()) if (r - (this.seen.get(k) ?? 0) > this.stale) { this.ms.delete(k); this.seen.delete(k); }
      if (last > first) {
        const total = (last - first) / 1e6;
        this.lastFrameMs = total;
        this.serial++;
        this.frameMs = this.frameMs ? this.frameMs * 0.9 + total * 0.1 : total;
      }
    }).catch(() => { this.pending = false; });
  }
}
