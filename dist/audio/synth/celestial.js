// Starthread's own voices (rendered in the synth worker like the rest of the bank): the score's instruments — a
// concert harp, a celesta, glass (a bowed-glass / harmonica tone), a soft choir "oo", a warm pad, a round sub — and
// the glove's magic: the thread's cast (a bright rising zing), its catch (a low plucked thrum), the zip, the fling,
// a seed's pop, a bloom's bounce, a star's shimmer and its flight home, and the skyrays' long low calls.
import { Biquad, Noise, addModal, addNoiseGrain, clamp, finish, fsin, ksString, mtof, normPeak } from './dsp';
const M = (sr, secs) => new Float32Array(Math.max(16, Math.ceil(sr * secs)));
const st = (sr, secs) => [M(sr, secs), M(sr, secs)];
// ------------------------------------------------------------------ instruments
export function harp(p, rng, sr) {
    const m = p.midi;
    const f = mtof(m);
    const secs = clamp(6.5 - (m - 36) * 0.06, 2.5, 6.5);
    const t60 = clamp(7 - (m - 36) * 0.08, 2.2, 7);
    const a = ksString(sr, f, secs, rng, { t60, t60hi: t60 * 0.4, pos: rng.range(0.1, 0.14), excLp: 4200, stiff: 0.02, pickNoise: 0.02 });
    // soundboard: a warm low body, a little air
    for (const b of [new Biquad(sr).hp(55, 0.7), new Biquad(sr).peak(220, 1.2, 4), new Biquad(sr).peak(800, 1.0, 1.5), new Biquad(sr).highShelf(5000, -4)])
        b.apply(a);
    normPeak([a], 0.8);
    return { ch: finish([a], sr, { fadeMs: 200, dc: false }), sr };
}
/** a celesta: struck steel bars over wooden resonators — a soft bell with a quick bright onset */
export function celesta(p, rng, sr) {
    const f = mtof(p.midi);
    const secs = clamp(3.6 - (p.midi - 60) * 0.04, 1.4, 3.6);
    const ch = [M(sr, secs)];
    const d = secs;
    addModal(ch, sr, 0, [
        [f, 1, d], [f * 2.0, 0.18, d * 0.6], [f * 3.98, 0.12, d * 0.22], [f * 9.1, 0.04, 0.06], [f * 1.003, 0.4, d * 0.9],
    ], 0.5, undefined, 0.8);
    addNoiseGrain(ch, sr, rng, 0, { dur: 0.012, amp: 0.05, f: 5000, q: 0.8, tau: 0.003 });
    normPeak(ch, 0.75);
    return { ch: finish(ch, sr, { fadeMs: 120 }), sr };
}
/** glass: a sustained bowed-glass tone, slowly swelling, a gentle beating between two near partials */
export function glass(p, rng, sr) {
    const f = mtof(p.midi);
    const D = p.dur ?? 6;
    const ch = st(sr, D);
    const det = 0.6 + rng.next() * 0.5;
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 1.6) * Math.min(1, (D - t) / 1.8);
        a += f / sr;
        b += (f + det) / sr;
        c += (f * 2.0 + det * 0.5) / sr;
        const v = (fsin(a) * 0.5 + fsin(b) * 0.45 + fsin(c) * 0.12) * env;
        ch[0][i] = v * (0.8 + 0.2 * Math.sin(t * 1.1));
        ch[1][i] = v * (0.8 + 0.2 * Math.cos(t * 1.3));
    }
    normPeak(ch, 0.6);
    return { ch: finish(ch, sr, { fadeMs: 300 }), sr };
}
/** a choir "oo" (a saw through vowel formants, a slow vibrato that grows in, a breathy edge), unison of 3 voices */
export function choir(p, rng, sr) {
    const f0 = mtof(p.midi);
    const D = p.dur ?? 7;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    // "oo" → a touch of "ah" (formants)
    const F = p.midi < 60 ? [[350, 6, 1], [700, 7, 0.4], [2600, 9, 0.12]] : [[400, 6, 1], [800, 7, 0.45], [2700, 9, 0.12]];
    for (let v = 0; v < 3; v++) {
        const fs = F.map(([fr, q]) => new Biquad(sr).bp(fr * (1 + (v - 1) * 0.02), q));
        const det = 1 + (v - 1) * 0.006;
        const vr = 4.6 + v * 0.4, vd = rng.range(0.3, 1.2);
        let ph = rng.next();
        const pan = (v - 1) * 0.6;
        const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
        for (let i = 0; i < ch[0].length; i++) {
            const t = i / sr;
            const vib = 1 + 0.004 * Math.sin(TAU * vr * t + vd) * Math.min(1, t / 2);
            const f = f0 * det * vib;
            ph += f / sr;
            ph -= Math.floor(ph);
            const saw = 2 * ph - 1 + nz.pink() * 0.15;
            let y = 0;
            for (let k = 0; k < fs.length; k++)
                y += fs[k].run(saw) * F[k][2];
            const env = Math.min(1, t / 1.4) * Math.min(1, (D - t) / 2.0);
            ch[0][i] += y * env * gl;
            ch[1][i] += y * env * gr;
        }
    }
    normPeak(ch, 0.55);
    return { ch: finish(ch, sr, { fadeMs: 300 }), sr };
}
const TAU = Math.PI * 2;
/** a warm pad: detuned saws through a slowly opening low-pass */
export function pad(p, rng, sr) {
    const f0 = mtof(p.midi);
    const D = p.dur ?? 8;
    const ch = st(sr, D);
    const voices = [-0.09, 0.0, 0.08];
    for (let v = 0; v < voices.length; v++) {
        const lp = new Biquad(sr), lp2 = new Biquad(sr);
        let ph = rng.next();
        const f = f0 * Math.pow(2, voices[v] / 12);
        const gl = v === 0 ? 0.9 : v === 1 ? 0.65 : 0.35, gr = v === 0 ? 0.35 : v === 1 ? 0.65 : 0.9;
        for (let i = 0; i < ch[0].length; i++) {
            const t = i / sr;
            if ((i & 63) === 0) {
                const fc = 500 + 1300 * Math.min(1, t / 3) + 300 * Math.sin(t * 0.7 + v);
                lp.lp(fc, 0.6);
                lp2.lp(fc * 1.3, 0.6);
            }
            ph += f / sr;
            ph -= Math.floor(ph);
            const y = lp2.run(lp.run(2 * ph - 1));
            const env = Math.min(1, t / 2.2) * Math.min(1, (D - t) / 2.6);
            ch[0][i] += y * env * gl;
            ch[1][i] += y * env * gr;
        }
    }
    normPeak(ch, 0.5);
    return { ch: finish(ch, sr, { fadeMs: 300 }), sr };
}
export function sub(p, _rng, sr) {
    const f = mtof(p.midi);
    const D = p.dur ?? 7;
    const a = M(sr, D);
    let ph = 0;
    for (let i = 0; i < a.length; i++) {
        const t = i / sr;
        ph += f / sr;
        a[i] = (fsin(ph) + 0.15 * fsin(ph * 2)) * Math.min(1, t / 1.5) * Math.min(1, (D - t) / 2);
    }
    normPeak([a], 0.6);
    return { ch: finish([a], sr, { fadeMs: 300 }), sr };
}
// ------------------------------------------------------------------ the glove's magic
/** the thread flying out: a bright rising zing over a breathy rush */
export function zing(_p, rng, sr) {
    const D = 0.55;
    const ch = st(sr, D);
    let ph = 0;
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr, u = t / D;
        const f = 900 + 2600 * Math.pow(u, 0.6);
        ph += f / sr;
        const env = Math.min(1, t / 0.01) * Math.pow(1 - u, 1.6);
        const y = (fsin(ph) * 0.6 + fsin(ph * 2.01) * 0.25 + fsin(ph * 3.0) * 0.1) * env;
        ch[0][i] = y * (0.7 + 0.3 * u);
        ch[1][i] = y * (1 - 0.3 * u);
    }
    addNoiseGrain(ch, sr, rng, 0, { dur: 0.4, amp: 0.25, type: 'bp', f: 3000, q: 0.7, attack: 0.01, tau: 0.12 });
    normPeak(ch, 0.6);
    return { ch: finish(ch, sr), sr };
}
/** the thread catching: a deep plucked thrum (a long string pulled taut) with a glassy ping on top */
export function thrum(p, rng, sr) {
    const m = p.midi ?? 38;
    const a = ksString(sr, mtof(m), 2.2, rng, { t60: 2.0, t60hi: 0.5, pos: 0.3, excLp: 2500, stiff: 0.1, pickNoise: 0.1 });
    const ch = [a, a.slice()];
    addModal(ch, sr, 0.004, [[mtof(m + 31), 0.25, 0.9], [mtof(m + 38), 0.12, 0.5]], 1);
    for (const c of ch)
        new Biquad(sr).hp(45, 0.7).apply(c);
    normPeak(ch, 0.7);
    return { ch: finish(ch, sr, { fadeMs: 100 }), sr };
}
/** air rushing past (zip / fling): band-passed noise sweeping up, then away */
export function rush(p, rng, sr) {
    const D = p.dur ?? 0.9;
    const up = p.up ?? 1;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const bl = new Biquad(sr), br = new Biquad(sr);
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr, u = t / D;
        if ((i & 31) === 0) {
            const fc = 300 + 2600 * (up > 0 ? Math.sin(Math.PI * Math.min(1, u * 1.2)) : 1 - u);
            bl.bp(fc, 1.1);
            br.bp(fc * 1.08, 1.1);
        }
        const env = Math.sin(Math.PI * Math.pow(u, 0.7)) ** 1.5;
        const x = nz.pink();
        ch[0][i] = bl.run(x) * env;
        ch[1][i] = br.run(x) * env;
    }
    normPeak(ch, 0.6);
    return { ch: finish(ch, sr), sr };
}
/** a lumen seed: a soft round pop and a little sparkle */
export function pop(_p, rng, sr) {
    const ch = [M(sr, 0.9)];
    let ph = 0;
    for (let i = 0; i < sr * 0.18; i++) {
        const t = i / sr;
        ph += (700 - 2200 * t) / sr;
        ch[0][i] += fsin(ph) * Math.exp(-t * 28) * 0.8;
    }
    addModal(ch, sr, 0.03, [[2093, 0.15, 0.6], [3136, 0.1, 0.4], [4186, 0.06, 0.3]], 1);
    addNoiseGrain(ch, sr, rng, 0, { dur: 0.05, amp: 0.2, f: 1800, q: 0.9, tau: 0.01 });
    normPeak(ch, 0.7);
    return { ch: finish(ch, sr), sr };
}
/** a bloom's bounce: a springy rising "whoomp" with a bell on top */
export function boing(_p, rng, sr) {
    const D = 1.1;
    const ch = st(sr, D);
    let ph = 0;
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        const f = 110 + 380 * (1 - Math.exp(-t * 6)) + 18 * Math.sin(t * 40) * Math.exp(-t * 5);
        ph += f / sr;
        const y = (fsin(ph) + 0.3 * fsin(ph * 2)) * Math.min(1, t / 0.005) * Math.exp(-t * 4.5);
        ch[0][i] += y * 0.8;
        ch[1][i] += y * 0.8;
    }
    addModal(ch, sr, 0.06, [[1318.5, 0.25, 1.0], [1975.5, 0.18, 0.8], [2637, 0.1, 0.5]], 1);
    addNoiseGrain(ch, sr, rng, 0, { dur: 0.3, amp: 0.25, type: 'lp', f: 900, tau: 0.08 });
    normPeak(ch, 0.75);
    return { ch: finish(ch, sr), sr };
}
/** a star: a shimmer of high bell partials, scattered in time and across the stereo field */
export function shimmer(p, rng, sr) {
    const D = p.dur ?? 2.2;
    const root = p.root ?? 74;
    const ch = st(sr, D + 2);
    const steps = [0, 2, 4, 7, 9, 11, 12, 14, 16, 19];
    const n = 18;
    for (let k = 0; k < n; k++) {
        const t = (k / n) * D * (0.6 + 0.4 * rng.next());
        const m = root + steps[rng.int(0, steps.length - 1)] + (rng.chance(0.3) ? 12 : 0);
        const f = mtof(m);
        const pan = rng.sym();
        addModal(ch, sr, t, [[f, 0.2, 1.4], [f * 2.76, 0.05, 0.4], [f * 1.002, 0.1, 1.6]], 0.6 + 0.4 * rng.next(), { l: Math.cos((pan + 1) * Math.PI / 4), r: Math.sin((pan + 1) * Math.PI / 4) }, 2);
    }
    normPeak(ch, 0.6);
    return { ch: finish(ch, sr, { fadeMs: 200 }), sr };
}
/** a skyray's call: a long low moan rising and falling, a hollow formant, a breathy edge (heard from far off) */
export function rayCall(p, rng, sr) {
    const D = 3.4;
    const base = 95 * (p.pitch ?? 1);
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const f1 = new Biquad(sr).bp(420, 3), f2 = new Biquad(sr).bp(900, 4), f3 = new Biquad(sr).bp(260, 2);
    let ph = 0;
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr, u = t / D;
        const glide = Math.sin(Math.PI * u) * 0.55 + 0.25 * Math.sin(u * 9.0) * u;
        const f = base * Math.pow(2, glide);
        ph += f / sr;
        ph -= Math.floor(ph);
        const src = (2 * ph - 1) * 0.7 + nz.pink() * 0.25;
        const y = f1.run(src) * 0.9 + f2.run(src) * 0.35 + f3.run(src) * 0.6;
        const env = Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 1.3;
        ch[0][i] = y * env;
        ch[1][i] = y * env * 0.92;
    }
    normPeak(ch, 0.6);
    return { ch: finish(ch, sr, { fadeMs: 200 }), sr };
}
/** the rover's motor: a soft electric whine over a low hum (looped; playback rate follows the speed) */
export function motor(_p, rng, sr) {
    const D = 2;
    const a = M(sr, D);
    const nz = new Noise(rng);
    const bp = new Biquad(sr).bp(900, 2);
    let p1 = 0, p2 = 0;
    for (let i = 0; i < a.length; i++) {
        p1 += 55 / sr;
        p2 += 440 / sr;
        a[i] = fsin(p1) * 0.5 + fsin(p1 * 2) * 0.2 + fsin(p2) * 0.08 + bp.run(nz.white()) * 0.08;
    }
    normPeak([a], 0.5);
    return { ch: [a], sr };
}
//# sourceMappingURL=celestial.js.map