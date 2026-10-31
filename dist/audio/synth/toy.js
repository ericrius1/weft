// A toybox band and its noises (rendered in the synth worker with the rest of the bank): a marimba (a struck bar: a
// fundamental and its 4th and 10th partials, the wood's knock), a plucked bass (a soft Karplus–Strong string), a kick
// drum, a finger snap, a shaker; and a wet squish of paint. For the bright, bouncy games (Fauve's groove).
import { Biquad, Noise, finish, fsin, mtof, normPeak } from './dsp';
const M = (sr, secs) => new Float32Array(Math.max(16, Math.ceil(sr * secs)));
const st = (sr, secs) => [M(sr, secs), M(sr, secs)];
/** a marimba bar at a MIDI pitch */
export function marimba(p, rng, sr) {
    const f = mtof(p.midi);
    const D = Math.min(1.4, 0.5 + 60 / f);
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const knock = new Biquad(sr).bp(Math.min(f * 3, 5000), 1.2);
    // (a tuned bar: partials at 1, ~4 and ~10 the fundamental, the high ones gone fast)
    const parts = [[1, 1, 3.2], [3.93, 0.32, 9], [9.98, 0.09, 22]];
    let ph = [0, 0, 0];
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        let v = 0;
        parts.forEach(([m, a, dk], k) => { ph[k] += (f * m) / sr; v += fsin(ph[k]) * a * Math.exp(-t * dk * (0.6 + f / 900)); });
        v *= Math.min(1, t * sr / 24);
        v += knock.run(nz.white()) * Math.exp(-t * 90) * 0.35;
        ch[0][i] = v;
        ch[1][i] = v;
    }
    normPeak(ch, 0.7);
    return { ch: finish(ch, sr), sr };
}
/** a plucked bass string (Karplus–Strong, a soft pluck) */
export function pluckBass(p, rng, sr) {
    const f = mtof(p.midi);
    const D = 1.3;
    const ch = st(sr, D);
    const n = Math.max(2, Math.round(sr / f));
    const buf = new Float32Array(n);
    // (the pluck: noise smoothed, so the string starts round rather than bright)
    let prev = 0;
    for (let i = 0; i < n; i++) {
        prev = prev * 0.6 + (rng.next() * 2 - 1) * 0.4;
        buf[i] = prev;
    }
    let idx = 0;
    const body = new Biquad(sr).lp(900, 0.7);
    for (let i = 0; i < ch[0].length; i++) {
        const a = buf[idx], b = buf[(idx + 1) % n];
        buf[idx] = (a + b) * 0.5 * 0.996;
        idx = (idx + 1) % n;
        const t = i / sr;
        const v = body.run(a) + fsin((f * t)) * 0.25 * Math.exp(-t * 3);
        ch[0][i] = v;
        ch[1][i] = v;
    }
    normPeak(ch, 0.75);
    return { ch: finish(ch, sr), sr };
}
/** a kick: a sine dropping in pitch, a click */
export function kick(_p, rng, sr) {
    const D = 0.45;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    let ph = 0;
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        ph += (48 + 110 * Math.exp(-t * 28)) / sr;
        const v = fsin(ph) * Math.exp(-t * 7.5) + nz.white() * Math.exp(-t * 400) * 0.25;
        ch[0][i] = v;
        ch[1][i] = v;
    }
    normPeak(ch, 0.85);
    return { ch: finish(ch, sr), sr };
}
/** a finger snap: a bright crack and a little ring */
export function snap(_p, rng, sr) {
    const D = 0.22;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const bp = new Biquad(sr).bp(2300, 2.5), bp2 = new Biquad(sr).bp(1200, 6);
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        const n = nz.white();
        const v = bp.run(n) * Math.exp(-t * 60) + bp2.run(n) * Math.exp(-t * 22) * 0.4;
        ch[0][i] = v;
        ch[1][i] = v * 0.92;
    }
    normPeak(ch, 0.6);
    return { ch: finish(ch, sr), sr };
}
/** a shaker: a short hiss with a soft attack */
export function shaker(p, rng, sr) {
    const D = p.long ? 0.22 : 0.12;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const hp = new Biquad(sr).hp(5200, 0.7);
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.012) * Math.exp(-t * (p.long ? 18 : 34));
        const v = hp.run(nz.white()) * env;
        ch[0][i] = v;
        ch[1][i] = v;
    }
    normPeak(ch, 0.45);
    return { ch: finish(ch, sr), sr };
}
/** a splat of paint: a wet slap with a squelch dropping after it */
export function squish(p, rng, sr) {
    const s = p.size ?? 1;
    const D = 0.35;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const lp = new Biquad(sr).lp(1800 / s, 0.9), bp = new Biquad(sr).bp(500 / s, 3);
    let ph = 0;
    const f0 = (380 + rng.next() * 160) / s;
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        ph += (f0 * (1 - 0.55 * Math.min(1, t * 9))) / sr;
        const slap = lp.run(nz.white()) * Math.exp(-t * 55);
        const squelch = bp.run(nz.white() * 0.6 + fsin(ph) * 0.5) * Math.exp(-t * 16) * Math.min(1, t * 120);
        const v = slap * 0.9 + squelch * 0.8;
        ch[0][i] = v;
        ch[1][i] = v * (0.9 + rng.next() * 0.1);
    }
    normPeak(ch, 0.7);
    return { ch: finish(ch, sr), sr };
}
//# sourceMappingURL=toy.js.map