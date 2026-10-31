// Stormbreak's sounds (rendered in the synth worker with the rest of the bank): the cannon (a punchy crack, a thump, a
// metallic ring), explosions (a sub-bass boom, a crackle tail, debris), the missile (a launch whoosh, its rocket's hiss),
// the Kestrel's engines (turbine whine over a roar, looped; rate and filter follow the throttle), the lock tone, plasma
// bolts (a falling zap), hits on armour, and thunder (a crack, then a long rolling rumble).
import { Biquad, Noise, addNoiseGrain, clamp, finish, fsin, loopify, normPeak } from './dsp';
const M = (sr, secs) => new Float32Array(Math.max(16, Math.ceil(sr * secs)));
const st = (sr, secs) => [M(sr, secs), M(sr, secs)];
export function cannon(_p, rng, sr) {
    const D = 0.35;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const hp = new Biquad(sr).hp(500, 0.7), bp = new Biquad(sr).bp(2200, 1.2);
    let ph = 0;
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        const crack = (hp.run(nz.white()) * 0.9 + bp.run(nz.white()) * 0.6) * Math.exp(-t * 55);
        ph += (140 * Math.exp(-t * 12) + 60) / sr;
        const thump = fsin(ph) * Math.exp(-t * 22) * 0.9;
        const ring = fsin(t * 1870) * Math.exp(-t * 30) * 0.08;
        const v = crack + thump + ring;
        ch[0][i] = v;
        ch[1][i] = v * 0.95;
    }
    normPeak(ch, 0.85);
    return { ch: finish(ch, sr), sr };
}
export function explosion(p, rng, sr) {
    const size = p.size ?? 1;
    const D = 2.2 + size * 1.5;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const lpL = new Biquad(sr), lpR = new Biquad(sr);
    let ph = 0;
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        if ((i & 31) === 0) {
            const fc = 120 + 3800 * Math.exp(-t * (6 / size));
            lpL.lp(fc, 0.7);
            lpR.lp(fc * 1.06, 0.7);
        }
        const env = Math.min(1, t / 0.004) * Math.exp(-t * (1.6 / size));
        const b = nz.brown() * 1.6 + nz.white() * 0.35 * Math.exp(-t * 8);
        ph += (55 * Math.exp(-t * 3) + 28) / sr;
        const sub = fsin(ph) * Math.exp(-t * (2.2 / size)) * 0.9;
        ch[0][i] = lpL.run(b) * env + sub;
        ch[1][i] = lpR.run(b) * env + sub;
    }
    // the crackle: debris and burning bits
    for (let k = 0; k < 40 * size; k++) {
        const t0 = 0.05 + Math.pow(rng.next(), 1.6) * D * 0.7;
        addNoiseGrain(ch, sr, rng, t0, { dur: 0.02 + rng.next() * 0.04, amp: 0.25 * Math.exp(-t0 * 1.2), f: 1500 + rng.next() * 3000, q: 1.5, tau: 0.01, pan: { l: rng.next(), r: rng.next() } });
    }
    normPeak(ch, 0.9);
    return { ch: finish(ch, sr, { fadeMs: 300 }), sr };
}
export function missileLaunch(_p, rng, sr) {
    const D = 1.6;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const bp = new Biquad(sr), bp2 = new Biquad(sr);
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr, u = t / D;
        if ((i & 31) === 0) {
            bp.bp(600 + 2800 * u, 0.8);
            bp2.bp(300 + 900 * u, 1.2);
        }
        const env = Math.min(1, t / 0.03) * (1 - u) ** 1.5;
        const x = nz.pink();
        const v = (bp.run(x) * 0.8 + bp2.run(nz.white()) * 0.4) * env;
        ch[0][i] = v * (1 - 0.4 * u);
        ch[1][i] = v * (0.6 + 0.4 * u);
    }
    addNoiseGrain(ch, sr, rng, 0, { dur: 0.08, amp: 0.6, type: 'lp', f: 400, tau: 0.03 });
    normPeak(ch, 0.8);
    return { ch: finish(ch, sr), sr };
}
/** the Kestrel's engines, looped: a turbine whine (two partials, beating) over a broadband roar */
export function jetLoop(_p, rng, sr) {
    const D = 3, XF = 0.25;
    const ch = st(sr, D + XF);
    const nz = new Noise(rng);
    const lp = new Biquad(sr).lp(900, 0.6), lp2 = new Biquad(sr).lp(950, 0.6);
    const bw = new Biquad(sr).bp(2400, 3);
    let a = 0, b = 0;
    for (let i = 0; i < ch[0].length; i++) {
        a += 1840 / sr;
        b += 1852 / sr;
        const whine = (fsin(a) + fsin(b) * 0.8) * 0.06 + bw.run(nz.white()) * 0.08;
        const roarL = lp.run(nz.pink()) * 0.9, roarR = lp2.run(nz.pink()) * 0.9;
        ch[0][i] = roarL + whine;
        ch[1][i] = roarR + whine;
    }
    normPeak(ch, 0.6);
    return { ch: loopify(ch, sr, XF), sr };
}
export function lockTone(p, _rng, sr) {
    const D = p.solid ? 0.5 : 0.09;
    const a = M(sr, D);
    let ph = 0;
    for (let i = 0; i < a.length; i++) {
        const t = i / sr;
        ph += (p.solid ? 1500 : 1100) / sr;
        a[i] = Math.sign(fsin(ph)) * 0.25 * Math.min(1, t / 0.003) * Math.min(1, (D - t) / 0.01);
    }
    const lp = new Biquad(sr).lp(5000, 0.7);
    lp.apply(a);
    normPeak([a], 0.5);
    return { ch: [a], sr };
}
export function boltZap(_p, rng, sr) {
    const D = 0.45;
    const ch = st(sr, D);
    let ph = 0;
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        ph += (1400 * Math.exp(-t * 7) + 180) / sr;
        const v = (fsin(ph) * 0.6 + fsin(ph * 1.51) * 0.3 + (rng.next() * 2 - 1) * 0.15 * Math.exp(-t * 20)) * Math.exp(-t * 7);
        ch[0][i] = v;
        ch[1][i] = v * 0.9;
    }
    normPeak(ch, 0.6);
    return { ch: finish(ch, sr), sr };
}
export function armourHit(_p, rng, sr) {
    const D = 0.3;
    const ch = st(sr, D);
    for (const [f, a, d] of [[2300, 0.4, 25], [3700, 0.25, 35], [5200, 0.15, 45]]) {
        const ff = f * (0.9 + rng.next() * 0.2);
        for (let i = 0; i < ch[0].length; i++) {
            const t = i / sr;
            const v = Math.sin(6.2831853 * ff * t) * a * Math.exp(-t * d);
            ch[0][i] += v;
            ch[1][i] += v;
        }
    }
    addNoiseGrain(ch, sr, rng, 0, { dur: 0.03, amp: 0.5, type: 'hp', f: 1800, tau: 0.008 });
    normPeak(ch, 0.6);
    return { ch: finish(ch, sr), sr };
}
/** thunder: the crack (close) or not (far), then a long rumble rolling in bursts */
export function thunder(p, rng, sr) {
    const near = clamp(p.near ?? 0.5, 0, 1);
    const D = 6;
    const ch = st(sr, D);
    const nz = new Noise(rng);
    const lpL = new Biquad(sr).lp(160 + 500 * near, 0.6), lpR = new Biquad(sr).lp(170 + 520 * near, 0.6);
    // the rumble's bursts
    const bursts = [];
    for (let k = 0; k < 7; k++)
        bursts.push(0.1 + k * 0.45 + rng.next() * 0.4);
    for (let i = 0; i < ch[0].length; i++) {
        const t = i / sr;
        let env = 0;
        for (const b of bursts) {
            const d = t - b;
            if (d > 0)
                env += Math.exp(-d * 1.3) * Math.min(1, d / 0.08);
        }
        env *= Math.exp(-t * 0.35) * 0.35;
        const x = nz.brown();
        ch[0][i] = lpL.run(x) * env;
        ch[1][i] = lpR.run(nz.brown()) * env;
    }
    if (near > 0.3)
        addNoiseGrain(ch, sr, rng, 0, { dur: 0.25, amp: 1.2 * near, type: 'hp', f: 900, tau: 0.05 });
    normPeak(ch, 0.85);
    return { ch: finish(ch, sr, { fadeMs: 400 }), sr };
}
//# sourceMappingURL=combat.js.map