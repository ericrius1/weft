import { LayerSet } from './core';
import { clamp, sstep } from './synth/dsp';
export class Flight {
    core;
    layers;
    fly = 0; // smoothed 0..1 "in flight"
    v = 0; // smoothed normalized speed
    push = 0; // acceleration push (doppler-ish brightening)
    prevSpeed = 0;
    t = 0;
    ph;
    skim = { level: 0, target: 0, last: -10, pos: [0, 0, 0], speed: 0 };
    /** 0..1, read by the music (adventure layer) */
    intensity = 0;
    constructor(core) {
        this.core = core;
        this.layers = new LayerSet(core);
        this.ph = [0, 1, 2, 3].map(() => core.rng.range(0, 50));
    }
    n(i, speed) {
        const t = this.t, p = this.ph[i];
        return clamp(0.5 + (Math.sin(0.9 * speed * t + p) + 0.6 * Math.sin(2.3 * speed * t + 1.7 * p) + 0.35 * Math.sin(5.1 * speed * t + 0.3 * p)) / 3.9, 0, 1);
    }
    update(dt, s) {
        const c = this.core;
        const L = this.layers;
        this.t += dt;
        L.dt = Math.min(0.25, dt);
        const k = (tau) => 1 - Math.exp(-dt / Math.max(1e-3, tau));
        const flying = !!s.flying && s.underwater < 0.5;
        this.fly += ((flying ? 1 : 0) - this.fly) * k(flying ? 0.25 : 0.7);
        const sp = Math.max(0, s.flySpeed ?? 0);
        const acc = dt > 0 ? (sp - this.prevSpeed) / dt : 0;
        this.prevSpeed = sp;
        this.v += (clamp(sp / 40, 0, 1.5) - this.v) * k(0.15);
        this.push += (clamp(acc / 20, -1, 1) - this.push) * k(acc > 0 ? 0.08 : 0.4);
        const alt = Math.max(0, s.altitude ?? 0);
        const high = sstep(25, 90, alt);
        const f = this.fly, v = this.v;
        this.intensity = f * clamp(0.45 + 0.6 * v, 0, 1);
        const gL = this.n(0, 1.3), gR = this.n(1, 1.1), buffet = this.n(2, 4.5);
        const thin = 1 - 0.4 * high; // quieter, airier up high
        // stereo rush: a band that climbs with speed (and jumps a little on acceleration)
        const fc = 320 + 1700 * Math.pow(Math.min(v, 1.3), 0.8) * (1 + 0.25 * Math.max(0, this.push));
        for (const [key, g, pan, off] of [['rushL', gL, -0.55, 0.15], ['rushR', gR, 0.55, 0.65]]) {
            const l = L.layer(key, 'noise.pink', { bus: 'sfx', filter: 'bandpass', freq: 600, q: 0.6, filter2: 'highpass', freq2: 220, q2: 0.6, pan, offset: off, rev: 0.1 }, f * 0.3 * Math.pow(v, 1.2) * (0.7 + 0.6 * g) * thin, 0.12);
            l?.freq(fc * (0.85 + 0.3 * g), 0.1);
            l?.rev(0.1 + 0.45 * high, 0.5);
        }
        // low buffeting
        L.layer('buffet', 'noise.brown', { bus: 'sfx', filter: 'lowpass', freq: 200, q: 0.7, offset: 0.35 }, f * 0.13 * Math.pow(v, 1.5) * (0.5 + 0.8 * buffet) * (1 - 0.6 * high), 0.06)
            ?.freq(110 + 320 * v, 0.1);
        // wind whistling past the ears at speed
        L.layer('whistle', 'noise.white', { bus: 'sfx', filter: 'bandpass', freq: 2500, q: 7, offset: 0.2 }, f * 0.025 * Math.pow(Math.max(0, v - 0.3), 2) * (0.6 + 0.8 * gR), 0.15)
            ?.freq(1700 + 2400 * Math.min(v, 1.3), 0.15);
        // cloth / hair flutter
        const fl = L.layer('flutter', 'loop.flutter', { bus: 'sfx', filter: 'highpass', freq: 140, q: 0.6, offset: 0.1 }, f * 0.16 * Math.pow(v, 1.3) * (0.6 + 0.6 * buffet) * (1 - 0.3 * high), 0.08);
        fl?.rate(0.8 + 0.6 * Math.min(v, 1.2), 0.2);
        // the triple boost, past what wind alone does: a deep roar and a high tearing hiss building with speed to 260 m/s
        const tb = sstep(45, 230, sp);
        L.layer('tbRoar', 'noise.brown', { bus: 'sfx', filter: 'lowpass', freq: 120, q: 0.9, offset: 0.45 }, f * 0.32 * tb * (0.75 + 0.5 * buffet), 0.25)
            ?.freq(90 + 260 * tb, 0.3);
        L.layer('tbTear', 'noise.white', { bus: 'sfx', filter: 'highpass', freq: 3500, q: 0.5, offset: 0.55 }, f * 0.07 * tb * tb * (0.7 + 0.6 * gL), 0.25);
        // spacious air when high
        L.layer('airy', 'noise.pink', { bus: 'sfx', filter: 'bandpass', freq: 3200, q: 0.4, rev: 0.7, offset: 0.8 }, f * 0.03 * high * (0.5 + 0.5 * v), 0.6);
        // skimming spray: follows the latest skim event, fades ~0.3 s after they stop
        const sk = this.skim;
        sk.target = c.now - sk.last < 0.35 ? clamp(0.35 + sk.speed / 30, 0.35, 1) : 0;
        sk.level += (sk.target - sk.level) * k(sk.target > sk.level ? 0.05 : 0.25);
        const spray = L.layer('skimSpray', 'loop.riverDetail', { bus: 'sfx', positional: true, filter: 'highpass', freq: 600, q: 0.6, rev: 0.12, offset: 0.2 }, 0.55 * sk.level, 0.05);
        const rush = L.layer('skimRush', 'loop.stream', { bus: 'sfx', positional: true, rev: 0.1, offset: 0.6 }, 0.5 * sk.level, 0.05);
        if (sk.level > 1e-3) {
            spray?.pos(sk.pos, 0.05);
            rush?.pos(sk.pos, 0.05);
            rush?.rate(0.9 + 0.4 * clamp(sk.speed / 30, 0, 1), 0.1);
        }
    }
    event(e) {
        const c = this.core;
        const r = c.rng;
        switch (e.type) {
            case 'flyStart':
                c.play(c.synth.get('fly.up', r), { bus: 'sfx', gain: 0.32, rate: r.range(0.95, 1.05), rev: 0.25, group: 'misc' });
                break;
            case 'flyStop':
                c.play(c.synth.get('fly.down', r), { bus: 'sfx', gain: 0.28, rate: r.range(0.95, 1.05), rev: 0.2, group: 'misc' });
                break;
            case 'skim': {
                const sk = this.skim;
                if (c.now - sk.last > 0.6)
                    c.play(c.synth.get('splash.s', r), { bus: 'sfx', pos: e.pos, gain: 0.3, rate: r.range(1.0, 1.2), rev: 0.15, ref: 4, group: 'splash' });
                sk.last = c.now;
                sk.pos = e.pos;
                sk.speed = Math.max(0, e.speed);
                break;
            }
        }
    }
    levels() { return this.layers.levels('fly.'); }
}
//# sourceMappingURL=flight.js.map