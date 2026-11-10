// Wildlife & nature renderers. Calls are rendered on demand (a fresh variation every time) from frequency /
// amplitude contours with harmonics, roughness and breath noise; species-specific spectral shaping after.
import { Biquad, Contour, Noise, addModal, addTick, clamp, ctrlNoise, envAD, envBell, envFlat, finish, fsin, loopify, normPeak, normRms, panGains, renderVoice, softLimit, lerp, spow, } from './dsp';
import { addArr } from './water';
const CR = 2000; // contour control rate
const M = (sr, secs) => new Float32Array(Math.max(16, Math.ceil(sr * secs)));
const bump = (u, c, w) => Math.max(0, 1 - Math.abs(u - c) / w);
function voiceOut(sr, c, harm, extraSecs = 0.2) {
    c.fillGaps();
    const out = M(sr, c.dur + extraSecs);
    renderVoice(sr, c.f, c.a, CR, harm, out);
    return out;
}
function done(a, sr, peak = 0.85, hp = 0) {
    if (hp > 0) {
        const f = new Biquad(sr).hp(hp, 0.7);
        f.apply(a);
    }
    normPeak([a], peak);
    return { ch: finish([a], sr, { fadeMs: 20 }), sr };
}
/** multiply by (1 - d + d*|band noise|) for hoarse/rough voices */
function roughen(a, sr, rng, depth, rate) {
    const m = ctrlNoise(rng, a.length, sr, rate);
    for (let i = 0; i < a.length; i++)
        a[i] *= 1 - depth + depth * Math.abs(m[i]) * 1.4;
}
/** breath / turbulence noise following the voice's amplitude, band-passed at its pitch */
function breath(a, c, sr, rng, amt, q = 4) {
    const nz = new Noise(rng);
    const bp = new Biquad(sr);
    const step = CR / sr;
    for (let i = 0; i < a.length; i++) {
        const k = Math.min(c.a.length - 1, Math.floor(i * step));
        if ((i & 31) === 0)
            bp.bp(c.f[k], q);
        a[i] += bp.run(nz.white()) * c.a[k] * amt;
    }
}
// ------------------------------------------------------------------ songbirds
/** hermit thrush: a pure intro whistle, then an ethereal, rapid flute-like flourish sung with two voices */
export function thrush(p, rng, sr) {
    const base = lerp(2050, 3500, p.level ?? rng.next());
    const D = 2.0;
    const c = new Contour(CR, D, base), c2 = new Contour(CR, D, base);
    const d0 = rng.range(0.26, 0.4);
    c.note(0.02, d0, base * 0.985, base * 1.012, 0.85, envAD(0.3));
    let t = 0.02 + d0 + rng.range(0.03, 0.06);
    // flourish: 2-3 rapid cascades of short notes, all above the intro, each starting high and tumbling down,
    // with the second voice sounding a different interval at the same time (thrushes sing two notes at once)
    const ratios = [1.19, 1.33, 1.5, 1.68, 1.78, 2.0, 2.24, 2.5, 2.67, 3.0];
    const cascades = rng.int(2, 3);
    for (let k = 0; k < cascades; k++) {
        let idx = rng.int(4, ratios.length - 1) - k;
        const notes = rng.int(3, 6);
        for (let j = 0; j < notes; j++) {
            const d = rng.range(0.022, 0.042);
            const nxt = Math.max(0, idx - rng.int(0, 2));
            const fA = base * ratios[idx] * rng.range(0.99, 1.01), fB = base * ratios[nxt] * rng.range(0.98, 1.0);
            const amp = 0.75 * (1 - 0.35 * (k / cascades)) * (1 - 0.15 * j / notes) * rng.range(0.75, 1);
            c.note(t, d, fA, fB, amp, envBell, 1, (u) => u + 0.04 * Math.sin(u * 12));
            if (rng.chance(0.7)) {
                const r2 = ratios[Math.max(0, idx - rng.int(2, 4))];
                c2.note(t, d, base * r2, base * r2 * 0.97, amp * 0.4, envBell);
            }
            t += d + rng.range(0.004, 0.012);
            idx = nxt;
        }
        t += rng.range(0.015, 0.04);
    }
    // fading high trill
    const tf = base * ratios[rng.int(5, 8)];
    for (let k = 0; k < rng.int(3, 6); k++) {
        c.note(t, 0.02, tf, tf * 0.95, 0.32 * (1 - k / 7), envBell);
        t += 0.027;
    }
    const a = voiceOut(sr, c, [1, 0.07, 0.025]);
    renderVoice(sr, c2.fillGaps().f, c2.a, CR, [1, 0.05], a);
    return done(a, sr, 0.85, 1200);
}
/** chickadee "fee-bee" */
export function chickadee(_p, rng, sr) {
    const k = rng.range(0.95, 1.05);
    const c = new Contour(CR, 1.0, 4000 * k);
    const d1 = rng.range(0.28, 0.38), d2 = rng.range(0.3, 0.4), g = rng.range(0.06, 0.1);
    c.note(0.02, d1, 4080 * k, 3940 * k, 0.9, envFlat(0.12, 0.25));
    c.note(0.02 + d1 + g, d2, 3480 * k, 3400 * k, 0.75, (u) => envFlat(0.08, 0.22)(u) * (1 - 0.45 * bump(u, 0.42, 0.14)));
    return done(voiceOut(sr, c, [1, 0.04]), sr, 0.8, 1500);
}
/** chickadee "chick-a-dee-dee-dee" */
export function chickadeeCall(_p, rng, sr) {
    const D = 1.3;
    const out = M(sr, D);
    const c = new Contour(CR, D, 6000);
    c.note(0.02, 0.028, 7600, 4300, 0.8, envBell);
    c.note(0.07, 0.03, 7200, 4200, 0.7, envBell);
    c.note(0.12, 0.045, 4100, 3700, 0.5, envBell);
    addArr(out, voiceOut(sr, c, [1, 0.15]));
    // dee notes: buzzy harmonic stacks (low fundamental, energy around 3-4 kHz)
    const nd = rng.int(3, 6);
    let t = 0.2;
    for (let k = 0; k < nd; k++) {
        const f0 = rng.range(390, 450);
        const d = rng.range(0.1, 0.14);
        const harm = [];
        for (let h = 1; h <= 18; h++)
            harm.push(Math.exp(-Math.pow((h * f0 - 3300) / 1000, 2)) * 0.6);
        const cc = new Contour(CR, d + 0.02, f0);
        cc.note(0.0, d, f0, f0 * 0.97, 0.7, envFlat(0.15, 0.3));
        const v = voiceOut(sr, cc, harm, 0.02);
        roughen(v, sr, rng, 0.35, 120);
        addArr(out, v, 1, Math.floor(t * sr));
        t += d + rng.range(0.05, 0.08);
    }
    return done(out, sr, 0.8, 1500);
}
/** woodpecker: drumming (rapid knocks with a trunk resonance) or slow foraging taps */
export function woodpecker(p, rng, sr) {
    const out = [M(sr, 3.2)];
    const f1 = rng.range(650, 1100), fl = rng.range(260, 380);
    const knock = (t, a) => {
        addTick(out, sr, rng, t, a * 0.5, 900, 0.8);
        addModal(out, sr, t, [[f1 * rng.range(0.97, 1.03), 1, 0.03], [f1 * 2.15, 0.45, 0.018], [fl, 0.7, 0.05]], a * 0.6);
    };
    if (p.taps) {
        let t = 0.02;
        for (let k = 0; k < rng.int(5, 12); k++) {
            knock(t, rng.range(0.4, 1));
            t += rng.range(0.15, 0.45);
        }
    }
    else {
        const rate = rng.range(14, 22), dur = rng.range(0.7, 1.5);
        const accel = rng.chance(0.5);
        let t = 0.02;
        const n = Math.round(rate * dur);
        for (let k = 0; k < n; k++) {
            const u = k / n;
            knock(t, Math.min(1, (k + 1) / 3) * (u > 0.8 ? 1 - (u - 0.8) * 2.5 : 1));
            t += (1 / rate) * (accel ? 1.15 - 0.3 * u : 1 + 0.25 * u * u);
        }
    }
    return done(out[0], sr, 0.85, 150);
}
/** raven: deep, rough, resonant croaks; optional fly-over wingbeats */
export function raven(p, rng, sr) {
    const n = rng.int(1, 4);
    const D = 0.6 + n * 0.75 + (p.flyby ? 1.5 : 0);
    const out = M(sr, D);
    let t = 0.05;
    const f0b = rng.range(290, 470);
    for (let k = 0; k < n; k++) {
        const d = rng.range(0.22, 0.42);
        const f0 = f0b * rng.range(0.93, 1.08);
        const c = new Contour(CR, d + 0.05, f0);
        c.note(0, d, f0, f0, 0.9, envAD(0.15), 1, (u) => 0); // amplitude only
        c.freq(0, d, (u) => f0 * (1 + 0.12 * Math.sin(Math.PI * Math.min(1, u * 1.6)) - 0.2 * Math.max(0, u - 0.6)));
        const harm = [1, 0.85, 0.7, 0.55, 0.45, 0.35, 0.25, 0.18, 0.12, 0.08, 0.05, 0.03];
        const v = voiceOut(sr, c, harm, 0.05);
        roughen(v, sr, rng, 0.55, rng.range(35, 70));
        breath(v, c, sr, rng, 0.25, 1.5);
        const f1 = new Biquad(sr).peak(rng.range(650, 850), 3, 8), f2 = new Biquad(sr).peak(rng.range(1350, 1700), 3, 6), f3 = new Biquad(sr).peak(2600, 4, 4), lp = new Biquad(sr).lp(4500, 0.7);
        for (let i = 0; i < v.length; i++)
            v[i] = lp.run(f3.run(f2.run(f1.run(v[i]))));
        addArr(out, v, rng.range(0.7, 1), Math.floor(t * sr));
        t += d + rng.range(0.3, 0.7);
    }
    if (p.flyby) {
        // ravens' wings are audible: slow soft whooshes
        const nz = new Noise(rng);
        let wt = 0.1;
        while (wt < D - 0.3) {
            const s0 = Math.floor(wt * sr), m = Math.floor(0.14 * sr);
            const bp = new Biquad(sr).bp(rng.range(280, 450), 1.2);
            for (let i = 0; i < m; i++)
                out[s0 + i] += bp.run(nz.white()) * Math.sin((Math.PI * i) / m) ** 2 * 0.25;
            wt += rng.range(0.28, 0.36);
        }
    }
    return done(out, sr, 0.85, 120);
}
/** red-tailed-hawk-like scream: hoarse, descending "kee-eeeer" */
export function hawk(_p, rng, sr) {
    const d = rng.range(1.6, 2.4);
    const c = new Contour(CR, d + 0.1, 2400);
    const f0 = rng.range(2200, 2600), fp = f0 * rng.range(1.15, 1.25), fe = f0 * rng.range(0.72, 0.82);
    c.note(0.02, d, f0, fp, 0.9, (u) => Math.min(1, u / 0.05) * (u > 0.75 ? spow(1 - (u - 0.75) / 0.25, 1.4) : 1) * (1 - 0.25 * u), 1, (u) => 0);
    c.freq(0.02, d, (u) => (u < 0.08 ? f0 * Math.pow(fp / f0, u / 0.08) : fp * Math.pow(fe / fp, Math.pow((u - 0.08) / 0.92, 0.8))) * (1 + 0.01 * Math.sin(u * 40)));
    const v = voiceOut(sr, c, [1, 0.45, 0.22, 0.1]);
    roughen(v, sr, rng, 0.75, 220);
    breath(v, c, sr, rng, 0.35, 2);
    return done(v, sr, 0.85, 1000);
}
/** eagle: thin, high chittering "kleek-kik-ik-ik" */
export function eagle(_p, rng, sr) {
    const n = rng.int(5, 9);
    const D = 0.25 + n * 0.16;
    const c = new Contour(CR, D, 3000);
    let t = 0.02;
    const f0 = rng.range(2700, 3300);
    for (let k = 0; k < n; k++) {
        const d = k === 0 ? 0.13 : rng.range(0.05, 0.09);
        const f = f0 * (k === 0 ? 1.05 : 1 - 0.02 * k);
        c.note(t, d, f * 1.03, f * 0.92, k === 0 ? 0.9 : 0.7 * (1 - 0.05 * k), envBell);
        t += d + (k === 0 ? 0.08 : rng.range(0.035, 0.07));
    }
    const v = voiceOut(sr, c, [1, 0.35, 0.12]);
    roughen(v, sr, rng, 0.3, 160);
    return done(v, sr, 0.85, 1200);
}
// ------------------------------------------------------------------ loons
const LOON_HARM = [1, 0.32, 0.13, 0.05, 0.02];
/** common-loon wail: soft onset, a held note, a slide up to a higher held note (and sometimes a third) */
export function loonWail(_p, rng, sr) {
    const f1 = rng.range(600, 760), f2 = f1 * rng.pick([1.33, 1.42, 1.5, 1.6]), f3 = f1 * rng.range(1.12, 1.3);
    const h1 = rng.range(0.8, 1.4), h2 = rng.range(1.2, 2.0), three = rng.chance(0.55), h3 = rng.range(0.7, 1.2);
    const g = 0.2; // glide time
    const D = 0.25 + h1 + g + h2 + (three ? g + h3 : 0) + 0.45;
    const c = new Contour(CR, D, f1);
    const vibR = rng.range(4, 6);
    const wav = ctrlNoise(rng, Math.ceil(D * CR) + 4, CR, 2);
    const tA = 0.25, tB = tA + h1, tC = tB + g + h2, tD = tC + (three ? g + h3 : 0);
    c.freq(0, D, (u) => {
        const t = u * D;
        let f;
        if (t < tA)
            f = f1 * (0.82 + 0.18 * Math.sin((0.5 * Math.PI * t) / tA));
        else if (t < tB)
            f = f1;
        else if (t < tB + g)
            f = f1 * Math.pow(f2 / f1, sm((t - tB) / g));
        else if (t < tC)
            f = f2;
        else if (three && t < tC + g)
            f = f2 * Math.pow(f3 / f2, sm((t - tC) / g));
        else if (three && t < tD)
            f = f3;
        else
            f = (three ? f3 : f2) * (1 - 0.12 * Math.min(1, (t - tD) / 0.45));
        const vib = 1 + 0.008 * Math.sin(2 * Math.PI * vibR * t) * Math.min(1, t / 0.6) + 0.006 * wav[Math.floor(u * (wav.length - 1))];
        return f * vib;
    });
    c.amp(0, D, (u) => {
        const t = u * D;
        const on = Math.min(1, t / 0.3) ** 1.5;
        const off = t > tD ? Math.max(0, 1 - (t - tD) / 0.45) ** 1.3 : 1;
        const lvl = t < tB ? 0.72 : t < tC ? 0.72 + 0.28 * Math.min(1, (t - tB) / 0.4) : 1 - 0.15 * Math.min(1, (t - tC) / 0.4);
        return on * off * lvl;
    });
    const v = voiceOut(sr, c, LOON_HARM);
    breath(v, c, sr, rng, 0.05, 6);
    return done(v, sr, 0.85, 250);
}
const sm = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
/** loon tremolo ("laughing"): rapid frequency/amplitude warble */
export function loonTremolo(_p, rng, sr) {
    const d = rng.range(1.2, 2.4);
    const D = d + 0.3;
    const f0 = rng.range(760, 980), rate = rng.range(7.5, 10), swing = rng.range(0.1, 0.16);
    const c = new Contour(CR, D, f0);
    c.freq(0, D, (u) => {
        const t = u * D;
        const ph = (t * rate) % 1;
        const tri = ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
        const contour = 1 + 0.08 * Math.sin(Math.PI * Math.min(1, t / d)) - 0.05 * Math.max(0, t / d - 0.7);
        return f0 * contour * (1 + swing * 0.5 * tri);
    });
    c.amp(0, D, (u) => {
        const t = u * D;
        const ph = (t * rate) % 1;
        const am = 0.4 + 0.6 * (0.5 - 0.5 * Math.cos(2 * Math.PI * ph));
        return am * Math.min(1, t / 0.12) * (t > d ? Math.max(0, 1 - (t - d) / 0.25) : 1);
    });
    const v = voiceOut(sr, c, [1, 0.5, 0.22, 0.1, 0.04]);
    breath(v, c, sr, rng, 0.04, 6);
    return done(v, sr, 0.85, 250);
}
/** loon yodel: a rising intro then repeated two-syllable phrases */
export function loonYodel(_p, rng, sr) {
    const reps = rng.int(3, 5);
    const f0 = rng.range(620, 720), fh = f0 * rng.range(1.55, 1.7), fl = f0 * rng.range(1.3, 1.4);
    const intro = 0.9, ph = rng.range(0.45, 0.55);
    const D = intro + reps * ph + 0.5;
    const c = new Contour(CR, D, f0);
    c.freq(0, D, (u) => {
        const t = u * D;
        if (t < intro)
            return f0 * Math.pow(fl / f0, sm(t / intro));
        const k = Math.min(reps - 1, Math.floor((t - intro) / ph));
        const v = (t - intro - k * ph) / ph;
        const f = v < 0.35 ? fl * Math.pow(fh / fl, sm(v / 0.35)) : fh * Math.pow(fl / fh, sm((v - 0.35) / 0.65));
        return t > intro + reps * ph ? fl * (1 - 0.15 * Math.min(1, (t - intro - reps * ph) / 0.5)) : f;
    });
    c.amp(0, D, (u) => {
        const t = u * D;
        const v = ((t - intro) / ph) % 1;
        if (t < intro)
            return 0.9 * Math.min(1, t / 0.25) * (1 - 0.55 * Math.exp(-(((intro - t) / 0.05) ** 2)));
        const w = Math.min(v, 1 - v); // distance to the syllable boundary (periodic, continuous)
        const dip = 1 - 0.55 * Math.exp(-((w / 0.05) ** 2));
        return 0.9 * dip * (t > intro + reps * ph ? Math.max(0, 1 - (t - intro - reps * ph) / 0.5) : 1);
    });
    const v = voiceOut(sr, c, [1, 0.4, 0.16, 0.06]);
    breath(v, c, sr, rng, 0.05, 6);
    return done(v, sr, 0.85, 250);
}
// ------------------------------------------------------------------ night
/** great horned owl: "hoo, h'hoo — hoo — hoo" */
export function owl(_p, rng, sr) {
    const f0 = rng.range(250, 330);
    const pat = rng.chance(0.6)
        ? [[0, 0.36, 1], [0.6, 0.12, 0.7], [0.76, 0.42, 1], [1.55, 0.45, 0.9], [2.3, 0.5, 0.85]]
        : [[0, 0.4, 1], [0.75, 0.13, 0.65], [0.92, 0.5, 1], [1.8, 0.55, 0.85]];
    const D = pat[pat.length - 1][0] + 0.8;
    const c = new Contour(CR, D, f0);
    for (const [t, d, a] of pat)
        c.note(t + 0.05, d, f0 * 0.93, f0 * 0.97, a * 0.85, envAD(0.2), 1, (u) => (u < 0.3 ? u / 0.3 * 0.7 : 0.7 + 0.3 * (1 - (u - 0.3) / 0.7)));
    const v = voiceOut(sr, c, [1, 0.1, 0.035]);
    breath(v, c, sr, rng, 0.12, 2);
    const lp = new Biquad(sr).lp(1400, 0.7);
    lp.apply(v);
    return done(v, sr, 0.85, 120);
}
/** wolf howl: long glide up, sustained waver, falling end; optional second wolf */
export function wolf(p, rng, sr) {
    const wolves = clamp(p.n ?? 1, 1, 3);
    const D = 8.5;
    const out = M(sr, D);
    for (let w = 0; w < wolves; w++) {
        const d = rng.range(3.8, 6), off = w === 0 ? 0.05 : rng.range(1.0, 2.5);
        const fs = rng.range(300, 380), fp = rng.range(520, 700) * (w ? rng.range(1.08, 1.25) : 1);
        const c = new Contour(CR, d + 0.2, fs);
        const drift = ctrlNoise(rng, Math.ceil((d + 0.2) * CR) + 4, CR, 0.8);
        c.freq(0, d, (u) => {
            const t = u * d;
            let f = t < 0.8 ? fs * Math.pow(fp / fs, sm(t / 0.8)) : t > d - 0.9 ? fp * Math.pow(0.68, sm((t - (d - 0.9)) / 0.9)) : fp;
            f *= 1 + 0.03 * drift[Math.floor(u * (drift.length - 1))] + 0.012 * Math.sin(2 * Math.PI * 5 * t) * sm((t - 1) / 0.8);
            return f;
        });
        c.amp(0, d, (u) => Math.min(1, u * d / 0.5) * (u * d > d - 0.9 ? spow(1 - (u * d - (d - 0.9)) / 0.9, 1.2) : 1) * 0.85);
        const v = voiceOut(sr, c, [1, 0.35, 0.15, 0.07]);
        breath(v, c, sr, rng, 0.08, 4);
        addArr(out, v, w ? 0.7 : 1, Math.floor(off * sr));
    }
    return done(out, sr, 0.85, 150);
}
// ------------------------------------------------------------------ river birds
/** American dipper: loud, varied, repeated whistles, trills and buzzes */
export function dipper(_p, rng, sr) {
    const units = rng.int(4, 7);
    const D = 0.2 + units * 0.6;
    const c = new Contour(CR, D, 4000);
    const out = M(sr, D + 0.2);
    let t = 0.03;
    for (let u = 0; u < units; u++) {
        const type = rng.pick(['whistle', 'whistle', 'trill', 'chip', 'buzz']);
        const reps = type === 'trill' ? 1 : rng.int(2, 4);
        const f = rng.range(3000, 5500);
        for (let r = 0; r < reps; r++) {
            if (type === 'whistle') {
                const d = rng.range(0.07, 0.11);
                const up = rng.chance(0.5);
                c.note(t, d, f * (up ? 0.85 : 1.15), f * (up ? 1.15 : 0.85), 0.8, envBell);
                t += d + 0.04;
            }
            else if (type === 'chip') {
                const d = 0.03;
                c.note(t, d, f * 1.3, f * 0.8, 0.7, envBell);
                t += d + 0.05;
            }
            else if (type === 'trill') {
                const d = rng.range(0.25, 0.4), rate = rng.range(20, 30);
                c.note(t, d, f, f, 0.75, envFlat(0.1, 0.2));
                c.freq(t, d, (v) => f * (1 + 0.12 * Math.sin(2 * Math.PI * rate * v * d)));
                t += d + 0.05;
            }
            else {
                const d = 0.12;
                const cc = new Contour(CR, d + 0.02, f);
                cc.note(0, d, f, f * 0.95, 0.6, envFlat(0.1, 0.3));
                const v = voiceOut(sr, cc, [1, 0.3, 0.1], 0.02);
                roughen(v, sr, rng, 0.8, 300);
                addArr(out, v, 1, Math.floor(t * sr));
                t += d + 0.04;
            }
        }
        t += rng.range(0.04, 0.12);
        if (t > D - 0.5)
            break;
    }
    addArr(out, voiceOut(sr, c, [1, 0.12, 0.04]));
    return done(out, sr, 0.85, 1500);
}
/** belted kingfisher: a dry, mechanical rattle */
export function kingfisher(_p, rng, sr) {
    const d = rng.range(0.9, 1.9);
    const out = M(sr, d + 0.3);
    const nz = new Noise(rng);
    let t = 0.02;
    const r0 = rng.range(16, 20), r1 = rng.range(11, 14);
    while (t < d) {
        const u = t / d;
        const amp = Math.min(1, u * 6) * (u > 0.8 ? (1 - u) * 5 : 1) * rng.range(0.7, 1);
        const pl = rng.range(0.022, 0.034);
        const s0 = Math.floor(t * sr), m = Math.floor(pl * sr);
        const f0 = rng.range(1900, 2300);
        let ph = 0;
        const bp = new Biquad(sr).bp(rng.range(2800, 3600), 1.8);
        for (let i = 0; i < m; i++) {
            const e = Math.sin((Math.PI * i) / m) ** 0.6;
            ph += f0 / sr;
            out[s0 + i] += (bp.run(nz.white()) * 0.9 + (fsin(ph) * 0.4 + fsin(ph * 2) * 0.3 + fsin(ph * 3) * 0.2)) * e * amp;
        }
        t += 1 / lerp(r0, r1, u);
    }
    return done(out, sr, 0.85, 1200);
}
/** robin-like caroling: slurred whistled phrases */
export function robin(_p, rng, sr) {
    const phrases = rng.int(3, 6);
    const D = 0.2 + phrases * 0.75;
    const c = new Contour(CR, D, 2500);
    let t = 0.03;
    for (let p = 0; p < phrases; p++) {
        const notes = rng.int(2, 4);
        for (let k = 0; k < notes; k++) {
            const d = rng.range(0.08, 0.17);
            const f0 = rng.range(1900, 3100), f1 = f0 * rng.range(0.8, 1.3);
            c.note(t, d, f0, f1, rng.range(0.6, 0.9), envBell, 1, (u) => sm(u) + 0.2 * Math.sin(Math.PI * u));
            t += d + rng.range(0.02, 0.05);
        }
        if (rng.chance(0.25)) {
            c.note(t, 0.06, 5200, 6000, 0.25, envBell);
            t += 0.08;
        }
        t += rng.range(0.22, 0.4);
        if (t > D - 0.4)
            break;
    }
    return done(voiceOut(sr, c, [1, 0.12, 0.04]), sr, 0.85, 1200);
}
/** warbler/sparrow trill: rapid down-chirps, often accelerating */
export function warbler(_p, rng, sr) {
    const n = rng.int(10, 22);
    const rate = rng.range(11, 17);
    const D = n / rate + 0.4;
    const c = new Contour(CR, D, 5000);
    const f0 = rng.range(4200, 6200);
    let t = 0.02;
    for (let k = 0; k < n; k++) {
        const u = k / n;
        const d = 0.6 / rate;
        c.note(t, d, f0 * (1.25 - 0.1 * u), f0 * (0.78 + 0.05 * u), 0.5 + 0.4 * Math.sin(Math.PI * u), envBell);
        t += (1 / rate) * (1 - 0.2 * u);
    }
    return done(voiceOut(sr, c, [1, 0.08]), sr, 0.85, 2000);
}
// ------------------------------------------------------------------ frogs & insects
/** chorus frog "krek-ek": pulsed nasal ratchet, rising */
export function chorusFrog(_p, rng, sr) {
    const out = M(sr, 0.5);
    const nz = new Noise(rng);
    const fm = rng.range(1600, 2200);
    const notes = [[0.01, rng.int(8, 12), 1], [0.01 + rng.range(0.16, 0.2), rng.int(4, 7), 0.8]];
    for (const [t0, pulses, a] of notes) {
        const pr = rng.range(85, 110);
        for (let k = 0; k < pulses; k++) {
            const u = k / pulses;
            const s0 = Math.floor((t0 + k / pr) * sr);
            const m = Math.floor(0.006 * sr);
            const f = fm * (1 + 0.15 * u) * (a < 1 ? 1.1 : 1);
            const bp = new Biquad(sr).bp(f, 4), bp2 = new Biquad(sr).bp(f * 1.75, 5);
            for (let i = 0; i < m + 200; i++) {
                const x = i < m ? nz.white() * Math.exp(-i / (m * 0.3)) : 0;
                out[s0 + i] += (bp.run(x) + 0.5 * bp2.run(x)) * a * Math.sin(Math.PI * Math.min(1, (u + 0.1) / 1.1));
            }
        }
    }
    return done(out, sr, 0.85, 600);
}
/** toad trill: a long, sweet musical trill */
export function toad(_p, rng, sr) {
    const d = rng.range(3, 7);
    const out = M(sr, d + 0.3);
    const f0 = rng.range(1550, 1900), pr = rng.range(34, 44);
    let t = 0.02;
    while (t < d) {
        const u = t / d;
        const s0 = Math.floor(t * sr);
        const m = Math.floor(0.6 / pr * sr);
        const f = f0 * (1 - 0.04 * u);
        let ph = 0;
        const a = Math.min(1, u * 5) * (u > 0.9 ? (1 - u) * 10 : 1);
        for (let i = 0; i < m; i++) {
            ph += f / sr;
            out[s0 + i] += (fsin(ph) + 0.15 * fsin(ph * 2)) * Math.sin((Math.PI * i) / m) * a;
        }
        t += 1 / pr;
    }
    return done(out, sr, 0.85, 500);
}
/** green frog "gunk": a loose banjo-string twang, sometimes repeated */
export function greenFrog(_p, rng, sr) {
    const reps = rng.int(1, 3);
    const out = M(sr, reps * 0.35 + 0.5);
    for (let r = 0; r < reps; r++) {
        const f0 = rng.range(170, 240);
        const s0 = Math.floor((0.02 + r * rng.range(0.25, 0.35)) * sr);
        let ph = 0;
        const m = Math.floor(0.32 * sr);
        const pkf = new Biquad(sr).peak(rng.range(600, 800), 2, 10);
        for (let i = 0; i < m; i++) {
            const t = i / sr;
            ph += (f0 * (1 - 0.15 * Math.min(1, t / 0.1))) / sr;
            let v = 0;
            for (let h = 1; h <= 10; h++)
                v += fsin(ph * h) / h;
            out[s0 + i] += pkf.run(v * Math.min(1, t / 0.004) * Math.exp(-t / 0.045)) * (r ? 0.8 : 1);
        }
    }
    return done(out, sr, 0.85, 100);
}
/** one cricket chirp: a few carrier pulses; kind 'field' (~4.6 kHz, 3-5 pulses) or 'tree' (~2.8 kHz, more pulses) */
export function cricketChirp(p, rng, sr) {
    const tree = p.kind === 'tree';
    const pulses = tree ? rng.int(5, 8) : rng.int(3, 5);
    const per = tree ? rng.range(0.018, 0.024) : rng.range(0.03, 0.04);
    const fc = tree ? rng.range(2600, 3000) : rng.range(4300, 5000);
    const out = M(sr, pulses * per + 0.08);
    for (let k = 0; k < pulses; k++) {
        const s0 = Math.floor((0.005 + k * per) * sr);
        const m = Math.floor(per * 0.62 * sr);
        let ph = 0;
        const a = k === 0 ? 0.7 : 1;
        for (let i = 0; i < m; i++) {
            const u = i / m;
            ph += (fc * (1 - 0.025 * u)) / sr;
            out[s0 + i] += (fsin(ph) + 0.08 * fsin(ph * 2)) * Math.sin(Math.PI * u) ** 0.7 * a;
        }
    }
    return done(out, sr, 0.8, 0);
}
/** distant cricket chorus bed (stereo loop) */
export function cricketBed(_p, rng, sr) {
    const L = 10, XF = 1, T = L + XF;
    const out = [M(sr, T), M(sr, T)];
    const n = 26;
    for (let c = 0; c < n; c++) {
        const tree = rng.chance(0.35);
        const chirp = cricketChirp({ kind: tree ? 'tree' : 'field' }, rng, sr).ch[0];
        const rate = rng.range(0.7, 2.2);
        const amp = rng.log(0.08, 0.5);
        const pan = panGains(rng.sym());
        let t = rng.range(0, 1);
        while (t < T - 0.3) {
            const s0 = Math.floor(t * sr);
            for (let i = 0; i < chirp.length && s0 + i < out[0].length; i++) {
                out[0][s0 + i] += chirp[i] * amp * pan.l;
                out[1][s0 + i] += chirp[i] * amp * pan.r;
            }
            t += (1 / rate) * rng.range(0.95, 1.05);
        }
    }
    for (const c of out) {
        const lp = new Biquad(sr).lp(5500, 0.7);
        lp.apply(c);
    }
    const lo = loopify(out, sr, XF);
    normRms(lo, 0.08);
    softLimit(lo, 0.9);
    return { ch: lo, sr };
}
/** leaf rustle loop: papery resonant grains in gust flurries (after the autumnvibes soundscape) */
export function rustle(p, rng, sr) {
    const L = 10, XF = 1, T = L + XF;
    const n = Math.ceil(sr * T);
    const Lc = new Float32Array(n), Rc = new Float32Array(n);
    const grain = (start, durS, f, q, amp, pan) => {
        const len = Math.floor(sr * durS);
        const att = Math.max(1, Math.floor(sr * rng.range(0.001, 0.004)));
        const bq = new Biquad(sr).bp(Math.min(f, sr * 0.45), q);
        const g = panGains(pan * 2 - 1);
        for (let i = 0; i < len; i++) {
            const y = bq.run(rng.sym());
            const env = i < att ? i / att : Math.exp((-(i - att) / len) * 4.5);
            const j = start + i;
            if (j >= n)
                break;
            Lc[j] += y * env * amp * g.l;
            Rc[j] += y * env * amp * g.r;
        }
    };
    const needles = !!p.needles;
    for (let t = 0; t < T; t += rng.range(0.25, 1.4)) {
        const dur = rng.range(0.2, 1.1), peak = rng.range(0.3, 1), rate = rng.range(120, 420) * (needles ? 2 : 1);
        const pan = rng.range(0.15, 0.85);
        const fc = needles ? rng.log(3500, 7000) : rng.log(1600, 3800);
        for (let gt = 0; gt < dur; gt += rng.exp(rate)) {
            const u = gt / dur;
            const env = Math.pow(Math.sin(Math.PI * u), 1.5);
            const crisp = rng.chance(0.12);
            grain(Math.floor((t + gt) * sr), crisp ? rng.range(0.003, 0.008) : rng.range(0.015, 0.06) * (needles ? 0.5 : 1), crisp ? fc * rng.range(1.4, 2.2) : fc * rng.range(0.6, 1.5), crisp ? rng.range(0.8, 1.5) : rng.range(1.2, 3.5), peak * env * (0.3 + 0.7 * Math.pow(rng.next(), 1.6)) * (crisp ? 0.5 : 1), clamp(pan + rng.range(-0.2, 0.2), 0, 1));
        }
    }
    for (let k = 0, cnt = Math.floor(T * 35); k < cnt; k++)
        grain(Math.floor(rng.next() * n), rng.range(0.02, 0.05), rng.log(1200, 4000), rng.range(1, 2.5), rng.range(0.05, 0.15), rng.next());
    const lo = loopify([Lc, Rc], sr, XF);
    normRms(lo, 0.12);
    softLimit(lo, 0.5);
    normRms(lo, 0.12);
    return { ch: lo, sr };
}
// ------------------------------------------------------------------ species added for the game's wildlife 'call' events
/** osprey: a series of clear, high, up-slurred whistles "kyew-kyew-kyew", rising in urgency */
export function osprey(_p, rng, sr) {
    const n = rng.int(4, 9);
    const D = 0.2 + n * 0.22;
    const c = new Contour(CR, D, 2500);
    let t = 0.03;
    const f0 = rng.range(2100, 2500);
    for (let k = 0; k < n; k++) {
        const u = k / n;
        const d = rng.range(0.08, 0.13);
        const fb = f0 * (1 + 0.08 * u);
        c.note(t, d, fb * 0.85, fb * 1.05, 0.7 + 0.3 * Math.sin(Math.PI * u), envBell, 1, (v) => (v < 0.4 ? sm(v / 0.4) : 1 - 0.6 * sm((v - 0.4) / 0.6)));
        t += d + rng.range(0.07, 0.12) * (1 - 0.3 * u);
    }
    return done(voiceOut(sr, c, [1, 0.18, 0.05]), sr, 0.85, 1200);
}
/** common merganser: low, harsh frog-like croaks */
export function merganser(_p, rng, sr) {
    const n = rng.int(1, 3);
    const out = M(sr, 0.4 + n * 0.55);
    let t = 0.03;
    for (let k = 0; k < n; k++) {
        const d = rng.range(0.22, 0.38);
        const f0 = rng.range(170, 250);
        const c = new Contour(CR, d + 0.04, f0);
        c.note(0, d, f0 * 1.05, f0 * 0.9, 0.9, envAD(0.2));
        const v = voiceOut(sr, c, [1, 0.9, 0.8, 0.7, 0.55, 0.45, 0.35, 0.25, 0.18, 0.12], 0.04);
        roughen(v, sr, rng, 0.7, rng.range(40, 60));
        breath(v, c, sr, rng, 0.3, 1.2);
        const pk1 = new Biquad(sr).peak(rng.range(600, 900), 2.5, 8), lp = new Biquad(sr).lp(3500, 0.7);
        for (let i = 0; i < v.length; i++)
            v[i] = lp.run(pk1.run(v[i]));
        addArr(out, v, 1, Math.floor(t * sr));
        t += d + rng.range(0.2, 0.35);
    }
    return done(out, sr, 0.85, 100);
}
/** Canada goose: nasal two-part honks "ha-RONK", sometimes two birds */
export function goose(p, rng, sr) {
    const birds = clamp(p.birds ?? rng.int(1, 2), 1, 3);
    const D = 3.2;
    const out = M(sr, D);
    for (let b = 0; b < birds; b++) {
        const lo = rng.range(270, 330) * (b ? 1.08 : 1), hi = lo * rng.range(1.75, 2.05);
        let t = 0.03 + (b ? rng.range(0.15, 0.4) : 0);
        for (let k = 0; k < rng.int(2, 5) && t < D - 0.5; k++) {
            const d1 = rng.range(0.06, 0.09), d2 = rng.range(0.16, 0.24);
            const c = new Contour(CR, d1 + d2 + 0.05, lo);
            c.note(0, d1, lo, lo * 1.05, 0.6, envFlat(0.2, 0.1));
            c.note(d1, d2, hi * 1.03, hi * 0.9, 0.95, envAD(0.12));
            const v = voiceOut(sr, c, [1, 0.8, 0.75, 0.6, 0.5, 0.4, 0.3, 0.2, 0.12], 0.05);
            roughen(v, sr, rng, 0.25, 90);
            const f1 = new Biquad(sr).peak(1250, 2.5, 7), f2 = new Biquad(sr).peak(2600, 3, 5), lp = new Biquad(sr).lp(5000, 0.7);
            for (let i = 0; i < v.length; i++)
                v[i] = lp.run(f2.run(f1.run(v[i])));
            addArr(out, v, b ? 0.75 : 1, Math.floor(t * sr));
            t += d1 + d2 + rng.range(0.25, 0.55);
        }
    }
    return done(out, sr, 0.85, 150);
}
/** bull elk bugle: low growl climbing to a long, high, pure whistle over a rough low voice, falling into grunts */
export function elk(_p, rng, sr) {
    const g = rng.range(140, 190), wh = rng.range(950, 1350);
    const rise = 0.45, hold = rng.range(1.2, 2.0), fall = 0.5;
    const D = 0.15 + rise + hold + fall + 1.6;
    const out = M(sr, D);
    const t0 = 0.15, tr = t0 + rise, th = tr + hold, tf = th + fall;
    // high whistle
    const c = new Contour(CR, tf + 0.1, g * 2);
    const vib = ctrlNoise(rng, Math.ceil((tf + 0.1) * CR) + 4, CR, 4);
    c.freq(0, tf, (u) => {
        const t = u * tf;
        const f = t < t0 ? g * 2 : t < tr ? g * 2 * Math.pow(wh / (g * 2), sm((t - t0) / rise)) : t < th ? wh * (1 + 0.03 * (t - tr) / hold) : wh * 1.03 * Math.pow(0.45, sm((t - th) / fall));
        return f * (1 + 0.012 * vib[Math.floor(u * (vib.length - 1))]);
    });
    c.amp(0, tf, (u) => { const t = u * tf; return Math.min(1, Math.max(0, (t - t0 * 0.5) / 0.3)) * (t > th ? spow(1 - (t - th) / fall, 1.3) : 1) * 0.85; });
    const v = voiceOut(sr, c, [1, 0.12, 0.04]);
    breath(v, c, sr, rng, 0.08, 5);
    addArr(out, v);
    // low rough voice underneath (biphonation)
    const lc = new Contour(CR, tf + 0.1, g);
    lc.note(0, tf, g * 0.95, g * 1.05, 0.35, envFlat(0.08, 0.1));
    const lv = voiceOut(sr, lc, [1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2]);
    roughen(lv, sr, rng, 0.8, 35);
    addArr(out, lv, 0.35);
    // grunts / chuckles
    let t = tf + 0.15;
    for (let k = 0; k < rng.int(2, 4); k++) {
        const gc = new Contour(CR, 0.2, g * 0.8);
        gc.note(0, 0.12, g * 0.9, g * 0.7, 0.8, envAD(0.15));
        const gv = voiceOut(sr, gc, [1, 0.8, 0.6, 0.4, 0.3], 0.05);
        roughen(gv, sr, rng, 0.8, 40);
        addArr(out, gv, 0.5, Math.floor(t * sr));
        t += rng.range(0.22, 0.35);
    }
    return done(out, sr, 0.85, 90);
}
/** elk alarm bark: a short, harsh, noisy "aagh" */
export function elkAlarm(_p, rng, sr) {
    const n = rng.chance(0.4) ? 2 : 1;
    const out = M(sr, 0.3 + n * 0.5);
    let t = 0.02;
    for (let k = 0; k < n; k++) {
        const d = rng.range(0.14, 0.24);
        const f0 = rng.range(380, 560);
        const c = new Contour(CR, d + 0.03, f0);
        c.note(0, d, f0 * 1.1, f0 * 0.85, 1, envAD(0.06));
        const v = voiceOut(sr, c, [1, 0.8, 0.7, 0.55, 0.45, 0.35, 0.25, 0.15], 0.03);
        roughen(v, sr, rng, 0.85, 120);
        breath(v, c, sr, rng, 0.9, 0.8);
        const pk1 = new Biquad(sr).peak(1400, 1.5, 6);
        for (let i = 0; i < v.length; i++)
            v[i] = pk1.run(v[i]);
        addArr(out, v, 1, Math.floor(t * sr));
        t += d + rng.range(0.25, 0.4);
    }
    return done(out, sr, 0.85, 150);
}
/** hoary marmot: a loud, piercing whistle (sometimes a few) */
export function marmot(_p, rng, sr) {
    const n = rng.int(1, 3);
    const D = 0.2 + n * 1.1;
    const c = new Contour(CR, D, 2800);
    let t = 0.03;
    for (let k = 0; k < n; k++) {
        const d = rng.range(0.25, 0.5);
        const f = rng.range(2500, 3200);
        c.note(t, d, f * 1.02, f * 0.9, 0.9, envAD(0.06), 1, (u) => Math.pow(u, 3));
        t += d + rng.range(0.6, 1.0);
    }
    return done(voiceOut(sr, c, [1, 0.1, 0.03]), sr, 0.85, 1200);
}
/** dipper call: a buzzy "zeet", 1-3 times */
export function dipperCall(_p, rng, sr) {
    const n = rng.int(1, 3);
    const out = M(sr, 0.2 + n * 0.3);
    let t = 0.02;
    for (let k = 0; k < n; k++) {
        const d = rng.range(0.11, 0.18);
        const f = rng.range(4500, 5800);
        const c = new Contour(CR, d + 0.02, f);
        c.note(0, d, f * 0.95, f * 1.04, 0.9, envFlat(0.1, 0.25));
        const v = voiceOut(sr, c, [1, 0.25, 0.08], 0.02);
        roughen(v, sr, rng, 0.85, rng.range(160, 240));
        addArr(out, v, 1, Math.floor(t * sr));
        t += d + rng.range(0.08, 0.16);
    }
    return done(out, sr, 0.85, 2500);
}
/** golden-crowned kinglet: very high thin "tsee-tsee-tsee", sometimes tumbling into a chatter */
export function kinglet(_p, rng, sr) {
    const n = rng.int(3, 6);
    const chatter = rng.chance(0.5);
    const D = 0.2 + n * 0.14 + (chatter ? 0.6 : 0);
    const c = new Contour(CR, D, 7500);
    let t = 0.02;
    const f0 = rng.range(7000, 8200);
    for (let k = 0; k < n; k++) {
        const d = rng.range(0.05, 0.08);
        c.note(t, d, f0 * (1 + 0.01 * k), f0 * (1.04 + 0.01 * k), 0.7, envBell);
        t += d + rng.range(0.04, 0.07);
    }
    if (chatter)
        for (let k = 0; k < 8; k++) {
            const f = 6200 - 380 * k;
            c.note(t, 0.04, f * 1.1, f * 0.85, 0.6, envBell);
            t += 0.055;
        }
    return done(voiceOut(sr, c, [1, 0.05]), sr, 0.85, 3000);
}
/** chipping-sparrow-like dry trill of rapid chips on one pitch */
export function sparrow(_p, rng, sr) {
    const dur = rng.range(1.2, 2.6);
    const rate = rng.range(13, 19);
    const c = new Contour(CR, dur + 0.2, 5000);
    const f0 = rng.range(4200, 5600);
    let t = 0.02;
    const n = Math.floor(dur * rate);
    for (let k = 0; k < n; k++) {
        const u = k / n;
        c.note(t, 0.45 / rate, f0 * 1.25, f0 * 0.8, 0.55 + 0.35 * Math.sin(Math.PI * Math.min(1, u * 1.3)), envBell);
        t += 1 / rate;
    }
    return done(voiceOut(sr, c, [1, 0.1]), sr, 0.85, 2500);
}
/** dark-eyed junco: a sweet, musical trill of slurred notes on one pitch */
export function junco(_p, rng, sr) {
    const dur = rng.range(1.0, 2.0);
    const rate = rng.range(11, 16);
    const c = new Contour(CR, dur + 0.2, 4000);
    const f0 = rng.range(3400, 4800);
    let t = 0.02;
    const n = Math.floor(dur * rate);
    for (let k = 0; k < n; k++) {
        const u = k / n;
        const d = 0.75 / rate;
        c.note(t, d, f0 * 1.12, f0 * 1.08, 0.5 + 0.4 * Math.sin(Math.PI * Math.min(1, u * 1.2)), envBell, 1, (v) => 0.5 - 0.5 * Math.cos(2 * Math.PI * v));
        t += 1 / rate;
    }
    return done(voiceOut(sr, c, [1, 0.12, 0.03]), sr, 0.85, 1800);
}
/** American pika: short, nasal, high "eeep" squeaks, 1-4 in a row */
export function pika(_p, rng, sr) {
    const n = rng.int(1, 4);
    const out = M(sr, 0.25 + n * 0.32);
    let t = 0.02;
    for (let k = 0; k < n; k++) {
        const d = rng.range(0.09, 0.16);
        const f0 = rng.range(1700, 2300);
        const c = new Contour(CR, d + 0.03, f0);
        c.note(0, d, f0 * 1.06, f0 * 0.94, 0.9, envAD(0.12));
        const v = voiceOut(sr, c, [1, 0.55, 0.3, 0.15, 0.07], 0.03);
        roughen(v, sr, rng, 0.25, 140);
        breath(v, c, sr, rng, 0.25, 1.5);
        const pk1 = new Biquad(sr).peak(rng.range(3800, 4600), 2, 6);
        for (let i = 0; i < v.length; i++)
            v[i] = pk1.run(v[i]);
        addArr(out, v, 1 - 0.1 * k, Math.floor(t * sr));
        t += d + rng.range(0.12, 0.22);
    }
    return done(out, sr, 0.85, 1200);
}
//# sourceMappingURL=nature.js.map