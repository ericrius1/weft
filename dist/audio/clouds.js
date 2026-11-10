import { LayerSet } from './core';
import { clamp, sstep } from './synth/dsp';
export class CloudAir {
    core;
    layers;
    last = 0;
    rush = 0;
    muffled = 0;
    constructor(core) {
        this.core = core;
        this.layers = new LayerSet(core);
    }
    update(dt, s) {
        const L = this.layers, c = this.core;
        L.dt = Math.min(0.25, dt);
        const k = clamp(s.cloud ?? 0, 0, 1);
        const sp = Math.max(0, s.flySpeed ?? 0), v = sstep(2, 60, sp);
        // (the edge: how fast she goes in or out, at speed)
        const dk = Math.abs(k - this.last) / Math.max(dt, 1e-3);
        this.last = k;
        this.rush = Math.max(this.rush * Math.exp(-dt / 0.45), Math.min(1, dk * 0.5) * sstep(5, 35, sp));
        if (Math.abs(k - this.muffled) > 0.01 || (k === 0 && this.muffled !== 0)) {
            this.muffled = k;
            c.mixer.setCloud(k);
        }
        // inside: an airy hush — the air through the droplets, brighter and louder with speed — and a low softness
        L.layer('bed', 'noise.pink', { bus: 'amb', filter: 'bandpass', freq: 700, q: 0.5, filter2: 'lowpass', freq2: 2600, q2: 0.5, rev: 0.45, offset: 0.3 }, k * (0.11 + 0.17 * v), 0.4)?.freq(550 + 1000 * v, 0.3);
        L.layer('hush', 'noise.brown', { bus: 'amb', filter: 'lowpass', freq: 240, q: 0.6, offset: 0.6 }, k * 0.06 * (0.6 + 0.6 * v), 0.5);
        // through a cloud's edge at speed: a soft rush
        L.layer('rush', 'noise.pink', { bus: 'sfx', filter: 'bandpass', freq: 1200, q: 0.7, rev: 0.25, offset: 0.1 }, this.rush * 0.3, 0.05)
            ?.freq(800 + 2600 * this.rush, 0.06);
        // drawing water out of a cloud: the condensation's sparkle where it gathers (her hands)
        const d = clamp(s.cloudDraw ?? 0, 0, 1);
        const sh = L.layer('condense', 'loop.condense', { bus: 'sfx', positional: true, filter: 'highpass', freq: 900, q: 0.6, rev: 0.35 }, d * 0.6, d > 0 ? 0.08 : 0.5);
        if (sh && s.cloudDrawPos)
            sh.pos(s.cloudDrawPos, 0.08);
    }
    event(e) {
        const c = this.core, r = c.rng;
        if (e.type === 'cloudDraw')
            c.play(c.synth.get('cloud.shimmer', r), { bus: 'sfx', pos: e.pos, gain: 0.5 * e.amount, rate: r.range(0.94, 1.06), rev: 0.4, ref: 6, minGain: 0.25, group: 'draw' });
    }
    levels() { return this.layers.levels('cloud.'); }
}
//# sourceMappingURL=clouds.js.map