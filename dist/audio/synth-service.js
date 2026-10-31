// Bridges the renderers to Web Audio: renders in a Web Worker (or synchronously, for offline tests),
// keeps the startup bank of AudioBuffers, and serves on-demand renders (wildlife calls, music phrases).
import { Rng, hashSeed } from './synth/dsp';
import { BANK, LIVE_SR, RENDERERS } from './synth/registry';
/** bank renders are deterministic; synchronous (offline/test) engines on one page share them */
const SYNC_CACHE = new Map();
export class SynthService {
    ctx;
    seed;
    worker = null;
    pending = new Map();
    nextId = 1;
    bank = new Map();
    listeners = [];
    ready;
    resolveReady;
    disposed = false;
    /** milliseconds spent rendering the bank (diagnostics) */
    bankMs = 0;
    bankBytes = 0;
    constructor(ctx, seed, mode) {
        this.ctx = ctx;
        this.seed = seed;
        this.ready = new Promise((r) => (this.resolveReady = r));
        if (mode === 'worker' && typeof Worker !== 'undefined') {
            try {
                this.worker = new Worker(new URL('./synth/worker.js', import.meta.url), { type: 'module' });
                this.worker.onmessage = (e) => {
                    const p = this.pending.get(e.data.id);
                    if (!p)
                        return;
                    this.pending.delete(e.data.id);
                    if (e.data.error || !e.data.ch)
                        p.reject(new Error(e.data.error));
                    else
                        p.resolve({ ch: e.data.ch, sr: e.data.sr });
                };
                this.worker.onerror = (e) => { console.warn('[audio] synth worker failed, rendering on main thread', e.message); this.fallback(); };
            }
            catch (err) {
                console.warn('[audio] no module worker, rendering on main thread', err);
                this.worker = null;
            }
        }
    }
    fallback() {
        const w = this.worker;
        this.worker = null;
        w?.terminate();
        // re-run pending jobs synchronously
        for (const [id, p] of this.pending) {
            void id;
            p.reject(new Error('worker lost'));
        }
        this.pending.clear();
    }
    srFor(kind, cap) {
        if (kind === 'ir')
            return this.ctx.sampleRate; // ConvolverNode buffers must match the context rate
        return Math.min(this.ctx.sampleRate, cap ?? LIVE_SR[kind] ?? 48000);
    }
    /** render something now (worker if available) */
    render(kind, params, seed, srCap) {
        const sr = this.srFor(kind, srCap);
        if (this.worker) {
            const id = this.nextId++;
            return new Promise((resolve, reject) => {
                this.pending.set(id, { resolve, reject });
                this.worker.postMessage({ id, kind, params, seed, sr });
            }).catch(() => this.renderSync(kind, params, seed, sr));
        }
        return Promise.resolve(this.renderSync(kind, params, seed, sr));
    }
    renderSync(kind, params, seed, sr) {
        return RENDERERS[kind](params, new Rng(seed), sr);
    }
    toBuffer(r) {
        // a single NaN would poison the reverbs for good: sanitize everything that enters the graph
        for (const c of r.ch)
            for (let i = 0; i < c.length; i++) {
                const v = c[i];
                if (!(v > -4 && v < 4))
                    c[i] = v > 0 ? 1 : v < 0 ? -1 : 0;
            }
        const b = this.ctx.createBuffer(r.ch.length, r.ch[0].length, r.sr);
        r.ch.forEach((c, i) => b.copyToChannel(c, i));
        return b;
    }
    /** render the startup bank; sync mode yields between items so a main-thread fallback never blocks long */
    async loadBank(sync, bank = BANK) {
        const t0 = performance.now();
        for (const item of bank) {
            if (this.disposed)
                return;
            for (let v = 0; v < item.variants; v++) {
                const seed = hashSeed(this.seed, item.key, v);
                let r;
                if (sync) {
                    const sr = this.srFor(item.kind, item.sr);
                    const ck = `${seed}:${sr}`;
                    r = SYNC_CACHE.get(ck) ?? this.renderSync(item.kind, item.params, seed, sr);
                    SYNC_CACHE.set(ck, r);
                }
                else {
                    r = await this.render(item.kind, item.params, seed, item.sr);
                    if (!this.worker)
                        await new Promise((res) => setTimeout(res, 0)); // main-thread fallback: breathe
                }
                const buf = this.toBuffer(r);
                this.bankBytes += buf.length * buf.numberOfChannels * 4;
                const list = this.bank.get(item.key) ?? [];
                list.push(buf);
                this.bank.set(item.key, list);
            }
            for (const l of this.listeners)
                l(item.key);
        }
        this.bankMs = performance.now() - t0;
        this.resolveReady();
    }
    onLoaded(fn) { this.listeners.push(fn); }
    has(key) { return (this.bank.get(key)?.length ?? 0) > 0; }
    get(key, rng, avoid) {
        const l = this.bank.get(key);
        if (!l || l.length === 0)
            return null;
        if (l.length === 1 || !rng)
            return l[0];
        let b = l[Math.floor(rng.next() * l.length)];
        if (avoid && avoid.last === b)
            b = l[(l.indexOf(b) + 1) % l.length];
        if (avoid)
            avoid.last = b;
        return b;
    }
    all(key) { return this.bank.get(key) ?? []; }
    dispose() { this.disposed = true; this.worker?.terminate(); this.worker = null; this.pending.clear(); }
}
//# sourceMappingURL=synth-service.js.map