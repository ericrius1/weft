// Ice renderers: freeze (crystal crackle that grows and rises + creak + glassy lock), crack (snap + the
// dispersive descending "pew" of flexural waves in lake ice + boom), shatter (modal clinks with bounces), melt.
import { Biquad, Noise, addBubble, addModal, addTick, clamp, ctrlNoise, finish, fsin, normPeak } from './dsp';
import { addArr, grainTexture } from './water';
const M = (sr, secs) => new Float32Array(Math.max(16, Math.ceil(sr * secs)));
const pk = (a, p = 1) => { normPeak([a], p); return a; };
/** inharmonic partial set of a small irregular ice chunk */
function chunkPartials(rng, f1, decay) {
    return [
        [f1, 1, decay],
        [f1 * rng.range(1.48, 1.85), rng.range(0.4, 0.8), decay * 0.7],
        [f1 * rng.range(2.3, 2.95), rng.range(0.25, 0.55), decay * 0.5],
        [f1 * rng.range(3.5, 4.5), rng.range(0.1, 0.3), decay * 0.35],
    ];
}
export function freeze(p, rng, sr) {
    const TL = 1.05 + 0.25 * clamp(p.amount ?? 0.6, 0, 1); // lock time
    const D = TL + 1.4;
    const n = Math.ceil(sr * D);
    const out = new Float32Array(n);
    // crystal crackle: resonant micro-clicks, accelerating and rising in pitch toward the lock
    {
        const c = [new Float32Array(n)];
        let t = 0.03;
        while (t < TL) {
            const u = t / TL;
            t += rng.exp(25 + 650 * Math.pow(u, 1.7));
            const f = rng.log(1600, 4200) * (1 + 1.4 * u);
            const a = (0.12 + 0.88 * Math.pow(u, 1.3)) * rng.log(0.12, 1);
            addModal(c, sr, t, [[f, 1, rng.range(0.004, 0.02)], [f * rng.range(1.4, 2.6), 0.45, rng.range(0.003, 0.012)]], a * 0.6, undefined, 0.05);
            if (rng.chance(0.45))
                addTick(c, sr, rng, t, a * 0.35, 3500, 0.25);
        }
        pk(c[0]);
        addArr(out, c[0], 0.7);
    }
    // frost hiss: cold granular air rising underneath
    {
        const len = TL + 0.1;
        const m = Math.ceil(sr * len);
        const gr = grainTexture(rng, m, sr, (t) => 300 + 2500 * (t / len), 0.0008, 0.003, 1.2);
        const nz = new Noise(rng);
        const hp = new Biquad(sr).hp(3000, 0.7), bp = new Biquad(sr);
        const a = new Float32Array(m);
        for (let i = 0; i < m; i++) {
            const u = i / m;
            if ((i & 63) === 0)
                bp.bp(4000 + 4000 * u, 0.8);
            a[i] = bp.run(hp.run(nz.white())) * (0.3 + 0.7 * gr[i]) * Math.pow(u, 1.6) * (u > 0.95 ? (1 - u) / 0.05 : 1);
        }
        pk(a);
        addArr(out, a, 0.22);
    }
    // creak: stick-slip impulse train through low resonators (the mass stiffening)
    {
        const cs = 0.15 * TL, ce = TL + 0.04;
        const imp = new Float32Array(n);
        let t = cs;
        const wob = ctrlNoise(rng, 400, 100, 3);
        while (t < ce) {
            const u = (t - cs) / (ce - cs);
            const rate = 38 + 70 * u + 18 * wob[Math.floor(u * 399)];
            const amp = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.6) * rng.range(0.6, 1);
            const i = Math.floor(t * sr);
            if (i < n)
                imp[i] += amp;
            t += (1 / rate) * rng.range(0.92, 1.08);
        }
        const r1 = new Biquad(sr).bp(rng.range(150, 210), 9), r2 = new Biquad(sr).bp(rng.range(380, 460), 7), r3 = new Biquad(sr).bp(rng.range(1000, 1300), 5);
        const lp = new Biquad(sr).lp(2600, 0.7);
        const a = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = imp[i];
            a[i] = lp.run(r1.run(x) * 1.0 + r2.run(x) * 0.7 + r3.run(x) * 0.35);
        }
        pk(a);
        addArr(out, a, 0.17);
    }
    // the lock: glassy modal ping + body thunk + sparkle
    {
        const c = [new Float32Array(n)];
        const f1 = rng.range(1650, 2400);
        addModal(c, sr, TL, [[f1, 1, 1.25], [f1 * 1.004, 0.45, 1.1], [f1 * 2.32, 0.55, 0.75], [f1 * 4.25, 0.3, 0.45], [f1 * 6.63, 0.16, 0.28]], 1, undefined, 0.2);
        addTick(c, sr, rng, TL, 1.2, 1800, 1.5);
        let ph = 0;
        const s0 = Math.floor(TL * sr);
        for (let i = 0; i < sr * 0.12; i++) {
            const t = i / sr;
            ph += (110 * (1 + 0.6 * Math.exp(-t / 0.01))) / sr;
            c[0][s0 + i] += 0.9 * fsin(ph) * (1 - Math.exp(-t / 0.001)) * Math.exp(-t / 0.03);
        }
        for (let k = 0; k < 14; k++)
            addModal(c, sr, TL + rng.exp(1 / 0.12), [[rng.range(6000, 11000), 1, rng.range(0.05, 0.2)]], 0.12 * rng.log(0.3, 1));
        pk(c[0]);
        addArr(out, c[0], 0.75);
    }
    normPeak([out], 0.9);
    return { ch: finish([out], sr, { fadeMs: 30 }), sr };
}
/** lake-ice crack: snap + dispersive descending "pew" chirps + low boom + fracture rattle */
export function iceCrack(_p, rng, sr) {
    const D = 2.8;
    const n = Math.ceil(sr * D);
    const out = new Float32Array(n);
    const nz = new Noise(rng);
    // snap(s)
    {
        const c = [new Float32Array(n)];
        addTick(c, sr, rng, 0.001, 1, 900, 3.5);
        addModal(c, sr, 0.001, [[rng.range(2600, 3800), 0.6, 0.03], [rng.range(5000, 7000), 0.4, 0.02]], 0.8);
        for (let k = 0; k < 3; k++)
            addTick(c, sr, rng, rng.range(0.006, 0.03), rng.range(0.2, 0.6), 1500, 2);
        pk(c[0]);
        addArr(out, c[0], 0.85);
    }
    // dispersive chirps: f(t) = fmax / (1 + t/tau)^2 (flexural waves: high frequencies arrive first)
    {
        const c = new Float32Array(n);
        const paths = rng.int(2, 3);
        for (let k = 0; k < paths; k++) {
            const off = k === 0 ? 0.002 : rng.range(0.01, 0.06);
            const fmax = rng.range(5500, 8000), fmin = rng.range(120, 220), td = rng.range(0.35, 0.9) * (1 + 0.3 * k);
            const tau = td / (Math.sqrt(fmax / fmin) - 1);
            const amp = k === 0 ? 1 : rng.range(0.35, 0.6);
            const s0 = Math.floor(off * sr);
            const jit = ctrlNoise(rng, Math.ceil(td * sr * 1.3), sr, 60);
            let ph = 0;
            for (let i = 0; i < td * sr * 1.3 && s0 + i < n; i++) {
                const t = i / sr;
                const f = fmax / Math.pow(1 + t / tau, 2);
                if (f < fmin * 0.7)
                    break;
                ph += f / sr;
                const e = (1 - Math.exp(-t / 0.0015)) * Math.exp(-t / (0.45 * td)) * (0.75 + 0.25 * jit[i]);
                c[s0 + i] += (fsin(ph) + 0.25 * fsin(ph * 2)) * e * amp;
            }
        }
        pk(c);
        addArr(out, c, 0.5);
    }
    // boom: low thump of the ice sheet
    {
        const lp = new Biquad(sr).lp(110, 0.8), hp = new Biquad(sr).hp(25, 0.7);
        const m = Math.floor(sr * 1.6);
        const a = new Float32Array(m);
        let ph = 0;
        for (let i = 0; i < m; i++) {
            const t = i / sr;
            const e = (1 - Math.exp(-t / 0.006)) * Math.exp(-t / 0.35);
            ph += (52 * (1 + 0.3 * Math.exp(-t / 0.05))) / sr;
            a[i] = hp.run(lp.run(nz.brown())) * e * 2 + fsin(ph) * e * 0.6;
        }
        pk(a);
        addArr(out, a, 0.3);
    }
    // fracture rattle
    {
        const c = [new Float32Array(n)];
        for (let k = 0; k < 45; k++) {
            const t = 0.004 + rng.exp(1 / 0.07);
            addModal(c, sr, t, [[rng.log(1500, 6000), 1, rng.range(0.004, 0.02)]], rng.log(0.1, 1) * Math.exp(-t / 0.1));
        }
        pk(c[0]);
        addArr(out, c[0], 0.25);
    }
    normPeak([out], 0.9);
    return { ch: finish([out], sr, { fadeMs: 40 }), sr };
}
/** ice shatter: crunch + many modal chunks that fall and bounce, low thumps, sparkle */
export function shatter(p, rng, sr) {
    const s = clamp(p.size ?? 0.7, 0, 1);
    const D = 1.8 + 0.6 * s;
    const n = Math.ceil(sr * D);
    const out = new Float32Array(n);
    // crunch
    {
        const len = 0.06 + 0.05 * s;
        const m = Math.ceil(sr * len);
        const gr = grainTexture(rng, m, sr, () => 2500, 0.0005, 0.002, 1);
        const nz = new Noise(rng);
        const hp = new Biquad(sr).hp(1200, 0.7), pk1 = new Biquad(sr).peak(4000, 1, 5);
        const a = new Float32Array(m);
        for (let i = 0; i < m; i++) {
            const t = i / sr;
            a[i] = pk1.run(hp.run(nz.white())) * (0.3 + 0.7 * gr[i]) * Math.exp(-t / (len * 0.35));
        }
        pk(a);
        addArr(out, a, 0.6);
        const c = [new Float32Array(n)];
        addTick(c, sr, rng, 0.0005, 1, 700, 4);
        pk(c[0]);
        addArr(out, c[0], 0.55);
    }
    // chunks
    {
        const c = [new Float32Array(n)];
        const N = Math.round(45 + 50 * s);
        for (let k = 0; k < N; k++) {
            const early = k < N * 0.4;
            let t = early ? rng.exp(1 / 0.025) : 0.04 + rng.exp(1 / (0.35 + 0.25 * s));
            if (t > D - 0.3)
                continue;
            const z = Math.pow(rng.next(), 1.8); // chunk size, mostly small
            const f1 = (1700 + 7500 * (1 - z)) * rng.range(0.85, 1.15);
            const dec = rng.range(0.03, 0.12) * (0.6 + 1.6 * z);
            const parts = chunkPartials(rng, f1, dec);
            let amp = rng.log(0.2, 1) * (early ? 1 : Math.exp(-(t - 0.04) / 0.6)) * (0.5 + 0.5 * z);
            addModal(c, sr, t, parts, amp, undefined, 0.08);
            if (!early || rng.chance(0.3)) {
                // bounces: shorter gaps, quieter each time
                let gap = rng.range(0.04, 0.14);
                for (let b = 0; b < rng.int(0, 3); b++) {
                    t += gap;
                    amp *= rng.range(0.3, 0.55);
                    gap *= 0.6;
                    if (t < D - 0.2)
                        addModal(c, sr, t, parts, amp, undefined, 0.08);
                }
            }
        }
        pk(c[0]);
        addArr(out, c[0], 0.8);
    }
    // big chunks thudding down
    {
        const c = [new Float32Array(n)];
        const nz = new Noise(rng);
        for (let k = 0; k < 2 + Math.round(4 * s); k++) {
            const t = rng.range(0.08, 0.6);
            const s0 = Math.floor(t * sr);
            const lp = new Biquad(sr).lp(rng.range(200, 420), 1.2);
            for (let i = 0; i < sr * 0.08; i++) {
                const tt = i / sr;
                c[0][s0 + i] += lp.run(nz.white()) * Math.exp(-tt / 0.012) * rng.range(0.5, 1);
            }
        }
        pk(c[0]);
        addArr(out, c[0], 0.25);
    }
    // sparkle
    {
        const c = [new Float32Array(n)];
        for (let k = 0; k < 30; k++)
            addModal(c, sr, rng.exp(1 / 0.25), [[rng.range(8000, 13500), 1, rng.range(0.03, 0.12)]], rng.log(0.1, 1));
        pk(c[0]);
        addArr(out, c[0], 0.12);
    }
    normPeak([out], 0.9);
    return { ch: finish([out], sr, { fadeMs: 40 }), sr };
}
/** melt: soft fizzing hiss with tiny air-pocket pops, a trickle that builds, drips, a soft slump */
export function melt(_p, rng, sr) {
    const D = 3.4;
    const n = Math.ceil(sr * D);
    const out = new Float32Array(n);
    const env = (t) => Math.min(1, t / 0.45) * (t > D - 1.3 ? Math.max(0, (D - t) / 1.3) : 1);
    // hiss + pops
    {
        const gr = grainTexture(rng, n, sr, () => 600, 0.001, 0.004, 1.4);
        const nz = new Noise(rng);
        const bp = new Biquad(sr).bp(5200, 0.6), hp = new Biquad(sr).hp(2500, 0.7);
        const sw = ctrlNoise(rng, n, sr, 1.5);
        const a = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const t = i / sr;
            a[i] = bp.run(hp.run(nz.white())) * (0.35 + 0.65 * gr[i]) * env(t) * (0.8 + 0.2 * sw[i]);
        }
        const c = [a];
        for (let k = 0; k < 70; k++) {
            const t = rng.range(0.1, D - 0.5);
            addTick(c, sr, rng, t, 0.6 * env(t) * rng.log(0.2, 1), 3000, 0.3);
        }
        pk(a);
        addArr(out, a, 0.28);
    }
    // trickle: a bubbly thin stream
    {
        const c = [new Float32Array(n)];
        let t = 0.5;
        while (t < D - 0.4) {
            const u = (t - 0.5) / (D - 0.9);
            t += rng.exp(25 + 60 * Math.sin(Math.PI * u));
            addBubble(c, sr, t, rng.log(0.9, 3.2), rng.log(0.3, 1) * Math.sin(Math.PI * Math.min(1, u)), rng.range(0.2, 0.9), 0.8);
        }
        pk(c[0]);
        addArr(out, c[0], 0.3);
    }
    // drips
    {
        const c = [new Float32Array(n)];
        for (let k = 0; k < rng.int(9, 15); k++) {
            const t = 0.4 + Math.pow(rng.next(), 0.8) * (D - 0.7);
            addTick(c, sr, rng, t, 0.25, 2500, 0.6);
            addBubble(c, sr, t + 0.0008, rng.log(0.8, 1.9), rng.range(0.5, 1), rng.range(0.6, 1.4), 0.65);
        }
        pk(c[0]);
        addArr(out, c[0], 0.3);
    }
    // slump: the softening mass sagging
    {
        const nz = new Noise(rng);
        const bp = new Biquad(sr).bp(320, 1.4);
        const t0 = rng.range(0.7, 1.1), len = 0.6;
        const s0 = Math.floor(t0 * sr);
        for (let i = 0; i < len * sr && s0 + i < n; i++) {
            const u = i / (len * sr);
            out[s0 + i] += bp.run(nz.pink() * 3) * Math.sin(Math.PI * u) ** 2 * 0.25;
        }
    }
    normPeak([out], 0.85);
    return { ch: finish([out], sr, { fadeMs: 80 }), sr };
}
//# sourceMappingURL=ice.js.map