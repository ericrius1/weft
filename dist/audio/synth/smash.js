// Things breaking (Smithereens): masonry crumbling (a thump and a fall of grit — hundreds of small knocks thinning
// out), wood splitting (a crack, splinters, a hollow knock), steel struck (inharmonic partials ringing), a short knock
// per material for the many small impacts; and the loops: a collapse's rumble, a cutting laser's buzz, a black hole's
// drone; a falling whistle for meteors.
import { Biquad, Noise, finish, fsin, loopify, normPeak, softLimit } from './dsp';
const st = (sr, secs) => { const n = Math.max(16, Math.ceil(sr * secs)); return [new Float32Array(n), new Float32Array(n)]; };
/** a knock: a short resonant tock — kind 0 brick/stone, 1 wood, 2 metal, 3 concrete */
export function knock(p, rng, sr) {
    const D = p.kind === 2 ? 0.5 : 0.25;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const f0 = [520, 340, 1400, 380][p.kind] * (0.85 + rng.next() * 0.3);
    const bp = new Biquad(sr).bp(f0, p.kind === 1 ? 6 : 3), lp = new Biquad(sr).lp(p.kind === 2 ? 9000 : 3000, 0.7);
    const partials = p.kind === 2 ? [[1, 1, 9], [2.76, 0.5, 13], [5.4, 0.3, 18], [8.9, 0.15, 25]] : [[1, 1, p.kind === 1 ? 26 : 40]];
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        let v = bp.run(nz.white()) * Math.exp(-t * 60) * 1.5 + lp.run(nz.white()) * Math.exp(-t * 300) * 0.5;
        for (const [m, a, d] of partials)
            v += fsin(f0 * m * t) * a * Math.exp(-t * d) * (p.kind === 2 ? 0.6 : 0.35);
        ch[0][i] = v;
        ch[1][i] = v * (0.9 + 0.1 * rng.next());
    }
    normPeak(ch, 0.7);
    return { ch: finish(ch, sr), sr };
}
/** masonry giving way: a deep thump, then a fall of grit and chunks thinning out (size 0..1) */
export function crumble(p, rng, sr) {
    const s = p.size ?? 0.5;
    const D = 0.8 + s * 1.8;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const body = new Biquad(sr).lp(160 + 200 * (1 - s), 0.8);
    // the thump
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        const v = body.run(nz.white()) * Math.exp(-t * (9 - s * 5)) * 2.2 + fsin((55 - 15 * s) * t) * Math.exp(-t * 7) * 0.6;
        ch[0][i] += v;
        ch[1][i] += v;
    }
    // the grit: grains, dense at first
    const grains = Math.round(80 + 380 * s);
    for (let g = 0; g < grains; g++) {
        const t0 = Math.pow(rng.next(), 2.2) * D * 0.85;
        const f = 400 + rng.next() * (2600 - 1200 * s);
        const bp = new Biquad(sr).bp(f, 2 + rng.next() * 4);
        const len = Math.floor(sr * (0.01 + rng.next() * 0.05));
        const a = (0.25 + rng.next() * 0.6) * Math.exp(-t0 * 1.6) * (rng.next() < 0.08 ? 3 : 1);
        const at = Math.floor(t0 * sr), pan = rng.next();
        for (let i = 0; i < len && at + i < ch[0].length; i++) {
            const v = bp.run(nz.white()) * a * Math.exp((-i / len) * 5);
            ch[0][at + i] += v * (1 - pan * 0.6);
            ch[1][at + i] += v * (0.4 + pan * 0.6);
        }
    }
    softLimit(ch, 1.2);
    normPeak(ch, 0.85);
    return { ch: finish(ch, sr), sr };
}
/** wood splitting: a sharp crack, splinters, a hollow knock under it */
export function splinter(_p, rng, sr) {
    const D = 0.9;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const hp = new Biquad(sr).hp(1800, 0.7), body = new Biquad(sr).bp(260 + rng.next() * 120, 5);
    const crackLen = 0.004 + rng.next() * 0.004;
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        // a few cracks in quick succession, then the fibres tearing
        let v = 0;
        for (const t0 of [0, 0.018, 0.041])
            if (t >= t0 && t < t0 + crackLen * 3)
                v += hp.run(nz.white()) * Math.exp(-(t - t0) / crackLen) * 1.6;
        v += hp.run(nz.white()) * 0.3 * Math.exp(-t * 7) * (0.5 + 0.5 * Math.sin(t * 300 + Math.sin(t * 37) * 5));
        v += body.run(nz.white()) * Math.exp(-t * 14) * 1.4;
        ch[0][i] = v;
        ch[1][i] = v * (0.85 + 0.15 * rng.next());
    }
    normPeak(ch, 0.8);
    return { ch: finish(ch, sr), sr };
}
/** steel struck hard: a clang, partials beating as they ring away */
export function clang(p, rng, sr) {
    const D = 2.2;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const f0 = (180 + rng.next() * 80) * (p.pitch ?? 1);
    const parts = [1, 1.47, 2.09, 2.56, 3.18, 4.33, 5.7].map((m, k) => ({ f: f0 * m * (1 + (rng.next() - 0.5) * 0.02), a: 1 / (1 + k * 0.6), d: 1.2 + k * 1.4, b: (rng.next() - 0.5) * 2.5 }));
    const hp = new Biquad(sr).hp(2500, 0.7);
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        let l = 0, r = 0;
        for (const q of parts) {
            const e = q.a * Math.exp(-t * q.d);
            l += fsin(q.f * t) * e;
            r += fsin((q.f + q.b) * t) * e;
        }
        const hit = hp.run(nz.white()) * Math.exp(-t * 120) * 2;
        ch[0][i] = l * 0.5 + hit;
        ch[1][i] = r * 0.5 + hit;
    }
    normPeak(ch, 0.7);
    return { ch: finish(ch, sr), sr };
}
/** a collapse's rumble (loop) */
export function rumble(_p, rng, sr) {
    const D = 4;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const lpL = new Biquad(sr).lp(140, 0.9), lpR = new Biquad(sr).lp(140, 0.9), mid = new Biquad(sr).bp(700, 1.5);
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        const flutter = 0.6 + 0.4 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1);
        const grit = mid.run(nz.white()) * 0.25 * Math.max(0, Math.sin(t * 13 + Math.sin(t * 5) * 3));
        ch[0][i] = lpL.run(nz.white()) * 3 * flutter + grit;
        ch[1][i] = lpR.run(nz.white()) * 3 * flutter + grit * 0.8;
    }
    normPeak(ch, 0.8);
    return { ch: loopify(ch, sr, 0.5), sr };
}
/** a cutting laser (loop): a buzz with a hiss over it */
export function laserLoop(_p, rng, sr) {
    const D = 2;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const hp = new Biquad(sr).hp(3500, 0.7);
    const f = 110;
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        // (a saw, a little detuned against itself)
        const saw = ((t * f) % 1) * 2 - 1, saw2 = ((t * f * 2.005) % 1) * 2 - 1;
        const v = (saw * 0.35 + saw2 * 0.25) * (0.8 + 0.2 * Math.sin(t * 47)) + hp.run(nz.white()) * 0.3 + fsin(f * 8 * t) * 0.08;
        ch[0][i] = v;
        ch[1][i] = v;
    }
    normPeak(ch, 0.5);
    return { ch: loopify(ch, sr, 0.2), sr };
}
/** a black hole (loop): a sub drone and a dark rushing, beating slowly */
export function holeLoop(_p, rng, sr) {
    const D = 4;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const lp = new Biquad(sr).lp(400, 2), bp = new Biquad(sr).bp(180, 4);
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        const v = fsin(38 * t) * 0.7 + fsin(38.6 * t) * 0.5 + fsin(57 * t) * 0.25 + lp.run(nz.white()) * 0.6 * (0.6 + 0.4 * Math.sin(t * Math.PI)) + bp.run(nz.white()) * 0.4;
        ch[0][i] = v;
        ch[1][i] = v * 0.95 + fsin(39 * t) * 0.1;
    }
    normPeak(ch, 0.7);
    return { ch: loopify(ch, sr, 0.5), sr };
}
/** something falling from very high: a whistle dropping in pitch, the air roaring louder */
export function incoming(_p, rng, sr) {
    const D = 2.6;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const bp = new Biquad(sr).bp(900, 2);
    let ph = 0;
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr, k = t / D;
        ph += (1900 - 1300 * k) / sr;
        const v = fsin(ph) * 0.25 * (0.3 + k) + bp.run(nz.white()) * (0.2 + 1.2 * k * k);
        ch[0][i] = v;
        ch[1][i] = v;
    }
    normPeak(ch, 0.6);
    return { ch: finish(ch, sr, { fadeMs: 60 }), sr };
}
//# sourceMappingURL=smash.js.map