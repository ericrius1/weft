// Fire and a dragon (rendered in the synth worker with the rest of the bank): a dragon's breath of fire (a turbulent
// jet's roar, looped: a broad 150 Hz – 1.5 kHz body fluttering at the jet's own rate, a combustion rumble under it, the
// jet's hiss over it), a blaze (looped: a lower, softer roar puffing at about a second and a half, as a big fire does),
// its crackle (looped: wood's clicks, pops and the sizzle of sap — events folded round the loop, so it has no seam),
// the ignition (a hiss of gas, then a whump, the roar opening up and settling), a fire drowned (the crash, a great hiss
// of steam billowing, the sputter after); the dragon's roar (a source and its tract: a rattling growl at 48 Hz, its
// pulses alternating in strength — period doubling, the rasp — rising into a bellow at 120 Hz as the jaw opens and the
// formants rise, then falling away into breath), its wingbeat (the downstroke's whoosh and thump of pushed air, the
// membrane's snap, a softer upstroke), and the wind of fast flight (looped: buffeting, a gusting rush, a hiss).
import { Biquad, Noise, OnePole, addNoiseGrain, addTick, clamp, ctrlNoise, envBell, finish, fsin, lerp, loopify, normPeak, normRms, panGains, polyBlep, softLimit, spow, sstep } from './dsp';
const M = (sr, secs) => new Float32Array(Math.max(16, Math.ceil(sr * secs)));
const st = (sr, secs) => [M(sr, secs), M(sr, secs)];
/** (heard where it is — a PannerNode places it — so one channel: half the memory) */
const mo = (sr, secs) => [M(sr, secs)];
/** fold what was rendered past `n` samples back onto the start: event-based content loops with no seam */
const fold = (ch, n) => ch.map((c) => { const o = c.slice(0, n); for (let i = n; i < c.length; i++)
    o[i % n] += c[i]; return o; });
/** a dragon's breath of fire, looped (6 s): the roar of a turbulent jet of burning gas */
export function fireBreath(_p, rng, sr) {
    const L = 6, XF = 0.6, T = L + XF;
    const ch = mo(sr, T), n = ch[0].length;
    // (the jet's flutter: turbulence at 10–30 Hz, irregular; a slower surge as the dragon pushes)
    const surge = ctrlNoise(rng, n, sr, 0.8);
    const rumble = M(sr, T);
    {
        const nz = new Noise(rng), lp = new Biquad(sr).lp(120, 0.8), lp2 = new Biquad(sr).lp(120, 0.8), hp = new Biquad(sr).hp(32, 0.7);
        const throb = ctrlNoise(rng, n, sr, 6);
        for (let i = 0; i < n; i++)
            rumble[i] = hp.run(lp2.run(lp.run(nz.brown()))) * (0.75 + 0.35 * throb[i]) * (0.85 + 0.15 * surge[i]);
    }
    for (let c = 0; c < ch.length; c++) {
        const nz = new Noise(rng);
        const fl = ctrlNoise(rng, n, sr, 13), fl2 = ctrlNoise(rng, n, sr, 29);
        const bodyHp = new Biquad(sr).hp(140, 0.6), bodyLp = new Biquad(sr).lp(1500, 0.6), bodyPk = new Biquad(sr).peak(380 * (c ? 1.06 : 0.95), 0.9, 5);
        const midPk = new Biquad(sr).peak(1100, 1.2, 2);
        const hissHp = new Biquad(sr).hp(2400, 0.6), hissLp = new Biquad(sr).lp(7500, 0.6);
        for (let i = 0; i < n; i++) {
            const f = fl[i] + 0.45 * fl2[i];
            const am = clamp(1 + 0.42 * f, 0.25, 1.9) * (0.85 + 0.15 * surge[i]);
            const body = midPk.run(bodyPk.run(bodyLp.run(bodyHp.run(nz.pink())))) * am;
            const hiss = hissLp.run(hissHp.run(nz.white())) * (0.65 + 0.35 * clamp(1 + 0.6 * f, 0, 2)) * 0.09;
            ch[c][i] = body * 1.1 + hiss + rumble[i] * 0.55;
        }
    }
    const lo = loopify(ch, sr, XF);
    normRms(lo, 0.13);
    softLimit(lo, 0.9);
    return { ch: lo, sr };
}
/** a blaze, looped (8 s): a big fire's low roar, puffing as the flames lift off in turn */
export function fireRoar(_p, rng, sr) {
    const L = 8, XF = 1, T = L + XF;
    const ch = mo(sr, T), n = ch[0].length;
    const puff = ctrlNoise(rng, n, sr, 1.5), slow = ctrlNoise(rng, n, sr, 0.25);
    const low = M(sr, T);
    {
        const nz = new Noise(rng), lp = new Biquad(sr).lp(170, 0.7), hp = new Biquad(sr).hp(35, 0.7);
        for (let i = 0; i < n; i++)
            low[i] = hp.run(lp.run(nz.brown())) * (0.78 + 0.25 * puff[i]) * (0.9 + 0.1 * slow[i]);
    }
    for (let c = 0; c < ch.length; c++) {
        const nz = new Noise(rng);
        const lick = ctrlNoise(rng, n, sr, 7);
        const bp = new Biquad(sr).bp(420 * (c ? 1.05 : 0.96), 0.7), lp = new Biquad(sr).lp(1800, 0.6);
        const flap = new Biquad(sr).bp(850, 1.1);
        for (let i = 0; i < n; i++) {
            const p = clamp(0.7 + 0.28 * puff[i] + 0.1 * slow[i], 0.3, 1.2);
            const body = lp.run(bp.run(nz.pink())) * p;
            // (the flames' flapping: a brighter band, in bursts)
            const fl = flap.run(nz.white()) * 0.16 * spow(0.5 + 0.5 * lick[i], 2) * p;
            ch[c][i] = body * 1.2 + fl + low[i] * 0.7;
        }
    }
    const lo = loopify(ch, sr, XF);
    normRms(lo, 0.1);
    softLimit(lo, 0.9);
    return { ch: lo, sr };
}
/** a fire's crackle, looped (7 s): wood's sharp clicks, the odd loud pop (a little cluster), sap sizzling, over a
 *  faint hiss */
export function fireCrackle(_p, rng, sr) {
    const L = 7, TAIL = 0.6;
    const ch = mo(sr, L + TAIL), n = Math.ceil(L * sr);
    // the faint hiss under it (looped by itself: crossfaded, the rest folded)
    {
        const bed = mo(sr, L + 0.5);
        for (let c = 0; c < bed.length; c++) {
            const nz = new Noise(rng), hp = new Biquad(sr).hp(1800, 0.6), lp = new Biquad(sr).lp(7000, 0.6);
            const m = ctrlNoise(rng, bed[c].length, sr, 2);
            for (let i = 0; i < bed[c].length; i++)
                bed[c][i] = lp.run(hp.run(nz.white())) * 0.012 * (0.7 + 0.3 * m[i]);
        }
        const b = loopify(bed, sr, 0.5);
        for (let c = 0; c < ch.length; c++)
            for (let i = 0; i < n; i++)
                ch[c][i] += b[c][i];
    }
    // clicks: a Poisson stream, their sizes heavy-tailed (most small, a few big)
    for (let t = rng.exp(26); t < L; t += rng.exp(26)) {
        const a = 0.06 * rng.log(0.12, 1) ** 1.3;
        addTick(ch, sr, rng, t, a, rng.range(1200, 4200), rng.range(0.4, 1.8), panGains(rng.sym() * 0.8));
    }
    // pops: a crack and two or three after it, lower and fuller
    for (let t = rng.exp(1.8); t < L; t += rng.exp(1.8)) {
        const pan = panGains(rng.sym() * 0.7), a = rng.range(0.12, 0.32);
        addNoiseGrain(ch, sr, rng, t, { dur: 0.03, amp: a, f: rng.range(700, 1800), q: 1.3, tau: rng.range(0.004, 0.009), attack: 0.0004, pan });
        addTick(ch, sr, rng, t, a * 0.8, 900, 1.5, pan);
        const k = rng.int(1, 3);
        for (let j = 0, tj = t; j < k; j++) {
            tj += rng.range(0.006, 0.03);
            addTick(ch, sr, rng, tj, a * rng.range(0.25, 0.6), rng.range(1500, 3500), rng.range(0.5, 1.2), pan);
        }
    }
    // sap sizzling: a short hiss now and then
    for (let t = rng.exp(0.7); t < L; t += rng.exp(0.7)) {
        addNoiseGrain(ch, sr, rng, t, { dur: rng.range(0.12, 0.45), amp: rng.range(0.02, 0.05), type: 'hp', f: rng.range(3000, 5000), shape: 'sine', pan: panGains(rng.sym() * 0.6) });
    }
    const lo = fold(ch, n);
    normPeak(lo, 0.85);
    softLimit(lo, 0.9);
    return { ch: lo, sr };
}
/** the fire lit (1.6 s): a hiss of gas, a whump, the roar flaring open and settling */
export function fireIgnite(_p, rng, sr) {
    const D = 1.6, T0 = 0.05;
    const ch = mo(sr, D), n = ch[0].length;
    const fl = ctrlNoise(rng, n, sr, 16);
    let ph = 0;
    const lows = ch.map(() => new Biquad(sr).lp(130, 0.8));
    for (let c = 0; c < ch.length; c++) {
        const nz = new Noise(rng), lp = new Biquad(sr), lp2 = new Biquad(sr), hp = new Biquad(sr).hp(90, 0.6), gas = new Biquad(sr).hp(3200, 0.7);
        const lowNz = new Noise(rng);
        for (let i = 0; i < n; i++) {
            const t = i / sr, u = t - T0;
            if ((i & 31) === 0) {
                // (the band flares open in a tenth of a second, then closes back toward a roar's)
                const fc = 450 + 4300 * sstep(0, 0.1, u) * Math.exp(-Math.max(0, u - 0.1) * 2.4) + 400 * sstep(0, 0.2, u);
                lp.lp(fc, 0.7);
                lp2.lp(fc * 1.4, 0.6);
            }
            // the gas's hiss before it catches
            const pre = gas.run(nz.white()) * 0.12 * sstep(0, T0, t) * (1 - sstep(T0, T0 + 0.05, t));
            const env = u <= 0 ? 0 : (u < 0.08 ? spow(u / 0.08, 1.6) : 0.78 * Math.exp(-(u - 0.08) / 0.3) + 0.22 * Math.exp(-(u - 0.08) / 0.85));
            const roar = lp2.run(lp.run(hp.run(nz.pink() + 0.25 * nz.white()))) * env * clamp(1 + 0.35 * fl[i], 0.3, 1.8) * 2.2;
            // the whump: the air pushed out as it catches
            const we = u <= 0 ? 0 : Math.min(1, u / 0.008) * Math.exp(-u / 0.11);
            if (c === 0)
                ph += (38 + 46 * Math.exp(-Math.max(0, u) * 9)) / sr;
            const whump = (fsin(ph) * 0.75 + lows[c].run(lowNz.brown()) * 0.9) * we;
            ch[c][i] = pre + roar + whump;
        }
    }
    // a few sparks crackling in the tail
    for (let k = 0; k < 9; k++)
        addTick(ch, sr, rng, T0 + rng.range(0.25, 1.35), 0.05 * rng.log(0.3, 1), rng.range(1500, 4000), 1, panGains(rng.sym() * 0.7));
    normPeak(ch, 0.85);
    return { ch: finish(ch, sr, { fadeMs: 140 }), sr };
}
/** a fire drowned by a mass of water (4.2 s): the crash, a great hiss of steam billowing up, the sputter after */
export function fireDouse(_p, rng, sr) {
    const D = 4.2;
    const ch = mo(sr, D), n = ch[0].length;
    const flick = ctrlNoise(rng, n, sr, 24), slow = ctrlNoise(rng, n, sr, 2.5);
    for (let c = 0; c < ch.length; c++) {
        const nz = new Noise(rng);
        const crashLp = new Biquad(sr), thumpLp = new Biquad(sr).lp(150, 0.8);
        const hissHp = new Biquad(sr).hp(2200, 0.6), hissLp = new Biquad(sr).lp(11000, 0.6), hissPk = new Biquad(sr).peak(5200, 1, 4);
        const billow = new Biquad(sr).bp(650 * (c ? 1.08 : 0.94), 0.8);
        for (let i = 0; i < n; i++) {
            const t = i / sr;
            if ((i & 31) === 0)
                crashLp.lp(1500 + 6000 * Math.exp(-t / 0.12), 0.6);
            const ce = Math.min(1, t / 0.003) * Math.exp(-t / 0.13);
            const crash = crashLp.run(nz.white() * 0.8 + nz.pink()) * ce * 1.1 + thumpLp.run(nz.brown()) * Math.min(1, t / 0.006) * Math.exp(-t / 0.16) * 1.4;
            // the steam's hiss: in a quarter second, dying over a couple, flickering as it boils
            const he = sstep(0.02, 0.25, t) * (0.75 * Math.exp(-Math.max(0, t - 0.25) / 0.9) + 0.25 * Math.exp(-Math.max(0, t - 0.25) / 2.2));
            const hiss = hissPk.run(hissLp.run(hissHp.run(nz.white()))) * he * clamp(0.65 + 0.45 * Math.abs(flick[i]) + 0.15 * slow[i], 0.2, 1.4) * 0.6;
            // the cloud of it rolling up
            const be = sstep(0.05, 0.45, t) * Math.exp(-Math.max(0, t - 0.45) / 1.1);
            const bil = billow.run(nz.pink()) * be * 0.55;
            ch[c][i] = crash + hiss + bil;
        }
    }
    // sizzling: a rain of tiny ticks, thinning
    for (let t = 0.05; t < D - 0.3; t += rng.exp(150 * Math.exp(-t / 0.8) + 5)) {
        addTick(ch, sr, rng, t, 0.09 * rng.log(0.1, 1) * Math.exp(-t / 1.6), rng.range(2500, 6000), rng.range(0.3, 0.9), panGains(rng.sym() * 0.8));
    }
    // the sputter: embers spitting, little hisses, further and further apart
    for (let t = 0.9 + rng.exp(4); t < D - 0.3; t += rng.exp(4.5 * Math.exp(-(t - 0.9) / 1.8) + 0.8)) {
        const pan = panGains(rng.sym() * 0.7), a = rng.range(0.08, 0.2) * Math.exp(-(t - 0.9) / 2);
        addNoiseGrain(ch, sr, rng, t, { dur: 0.03, amp: a, f: rng.range(800, 2200), q: 1.4, tau: 0.007, attack: 0.0005, pan });
        if (rng.chance(0.6))
            addNoiseGrain(ch, sr, rng, t + 0.01, { dur: rng.range(0.08, 0.3), amp: a * 0.35, type: 'hp', f: 3500, shape: 'sine', pan });
    }
    normPeak(ch, 0.9);
    return { ch: finish(ch, sr, { fadeMs: 300 }), sr };
}
/** a huge creature's roar (3.4 s): a rattling growl rising into a bellow, falling away into breath */
export function dragonRoar(_p, rng, sr) {
    const D = 3.4;
    const n = Math.ceil(D * sr);
    const m = new Float32Array(n);
    const jit = ctrlNoise(rng, n, sr, 30), drift = ctrlNoise(rng, n, sr, 3);
    const nz = new Noise(rng), chest = new Noise(rng);
    const tilt = new OnePole(sr, 1300), tilt2 = new OnePole(sr, 3600);
    const F = [new Biquad(sr), new Biquad(sr), new Biquad(sr), new Biquad(sr)];
    const chestLp = new Biquad(sr).lp(90, 0.8), lowLp = new Biquad(sr).lp(200, 0.7), outHp = new Biquad(sr).hp(28, 0.7);
    const FA = [1, 0.72, 0.48, 0.26];
    let ph = 0, subPh = 0, odd = false;
    for (let i = 0; i < n; i++) {
        const t = i / sr;
        // how open (the jaw: the bellow), how rough (the growl's rattle)
        const open = sstep(0.8, 1.3, t) * (1 - 0.65 * sstep(2.4, 3.3, t));
        const rough = clamp(1 - 0.7 * sstep(0.85, 1.3, t) + 0.45 * sstep(2.5, 3.2, t), 0, 1);
        // the pitch: a 48 Hz growl, up to a 120 Hz bellow arcing a little higher, down to 64 Hz
        let f0 = 47 + 5 * sstep(0, 0.85, t);
        f0 = lerp(f0, 118, sstep(0.82, 1.32, t));
        f0 += 10 * Math.sin(Math.PI * clamp((t - 1.3) / 1.1, 0, 1));
        f0 = lerp(f0, 64, sstep(2.3, 3.25, t));
        f0 *= 1 + 0.022 * Math.sin(2 * Math.PI * 5.3 * t) * sstep(1.25, 1.6, t) * (1 - sstep(2.3, 2.8, t));
        f0 *= 1 + (0.07 * rough + 0.012) * jit[i] + 0.02 * drift[i];
        // the loudness: the growl low, swelling into the bellow, dying away
        const A = sstep(0, 0.12, t) * lerp(0.38 + 0.17 * sstep(0, 0.85, t), 1, sstep(0.8, 1.3, t)) * (1 - 0.15 * sstep(1.3, 2.35, t)) * spow(1 - sstep(2.35, 3.38, t), 1.3);
        if ((i & 15) === 0) {
            const k = 0.5 + 0.5 * open;
            F[0].bp(lerp(250, 470, open), lerp(3, 4.5, k));
            F[1].bp(lerp(600, 880, open), lerp(5, 6.5, k));
            F[2].bp(lerp(1300, 1560, open), 7.5);
            F[3].bp(lerp(2250, 2450, open), 9);
        }
        // the source: a band-limited saw (the glottal pulse's buzz), softened; every other pulse weaker while it's rough
        const dt = f0 / sr;
        ph += dt;
        if (ph >= 1) {
            ph -= 1;
            odd = !odd;
        }
        let saw = 2 * ph - 1 - polyBlep(ph, dt);
        saw *= odd ? 1 - 0.62 * rough : 1;
        const pulse = tilt2.lp(tilt.lp(saw)) * 2.2;
        // breath through it, pulsed with the glottis (louder in the growl and the dying breath)
        const asp = nz.white() * (ph < 0.45 ? 1 : 0.35) * (0.18 + 0.4 * rough + 0.3 * (1 - A));
        const e = Math.tanh(1.7 * (pulse + asp)) * A;
        let v = 0;
        for (let k = 0; k < 4; k++)
            v += F[k].run(e) * FA[k];
        // weight: the fundamental itself (an octave under it in the rattle), the chest's rumble
        subPh += f0 / sr;
        const sub = (fsin(subPh) * (1 - 0.5 * rough) + fsin(subPh * 0.5) * 0.5 * rough) * 0.3 * A + lowLp.run(e) * 0.35;
        const rum = chestLp.run(chest.brown()) * 0.5 * A * (0.6 + 0.6 * rough);
        m[i] = outHp.run(v * 1.25 + sub + rum);
    }
    const ch = [m];
    normPeak(ch, 0.9);
    softLimit(ch, 0.95);
    return { ch: finish(ch, sr, { fadeMs: 200 }), sr };
}
/** one heavy wingbeat (1.1 s): the downstroke's whoosh and the thump of the air it pushes, the membrane's snap at its
 *  end, then a softer upstroke */
export function wingbeat(_p, rng, sr) {
    const D = 1.1, TP = 0.13;
    const ch = mo(sr, D), n = ch[0].length;
    let ph = 0;
    const thumpNz = new Noise(rng), thumpLp = new Biquad(sr).lp(140, 0.8);
    const thump = M(sr, D);
    for (let i = 0; i < n; i++) {
        const t = i / sr, u = t - TP;
        if (u < 0)
            continue;
        const e = Math.min(1, u / 0.012) * Math.exp(-u / 0.09);
        ph += (42 + 44 * Math.exp(-u * 18)) / sr;
        thump[i] = (fsin(ph) * 0.7 + thumpLp.run(thumpNz.brown()) * 0.6) * e;
    }
    for (let c = 0; c < ch.length; c++) {
        const nz = new Noise(rng), bp = new Biquad(sr), lp = new Biquad(sr).lp(240, 0.7), bpU = new Biquad(sr);
        const rus = new Biquad(sr).bp(1300, 1.2);
        for (let i = 0; i < n; i++) {
            const t = i / sr;
            // the downstroke: the air's rush swells to the push and falls away, its band brightening with it
            const w = sstep(0, TP, t) * Math.exp(-Math.max(0, t - TP) / 0.15);
            // the upstroke: half a second later, a third as loud
            const uu = (t - 0.45) / 0.5, up = uu > 0 && uu < 1 ? spow(envBell(uu), 1.5) * 0.45 : 0;
            if ((i & 31) === 0) {
                bp.bp((160 + 560 * w) * (c ? 1.06 : 0.95), 0.8);
                bpU.bp(300 + 450 * up / 0.45, 0.9);
            }
            const x = nz.pink();
            const down = (bp.run(x) * 2.1 + lp.run(nz.brown()) * 0.45) * w;
            const upW = bpU.run(nz.pink()) * up * 1.3 + rus.run(nz.white()) * up * 0.12 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 31 * t));
            ch[c][i] = down + upW + thump[i];
        }
    }
    // the membrane snapping taut at the stroke's end: a whap, a little flutter after it
    const pan = panGains(rng.sym() * 0.2);
    addNoiseGrain(ch, sr, rng, TP + 0.06, { dur: 0.06, amp: 0.5, type: 'lp', f: 320, tau: 0.018, attack: 0.002, pan });
    addNoiseGrain(ch, sr, rng, TP + 0.065, { dur: 0.05, amp: 0.3, f: 720, q: 1.4, tau: 0.012, attack: 0.001, pan });
    for (let k = 0; k < 3; k++)
        addNoiseGrain(ch, sr, rng, TP + 0.1 + k * rng.range(0.025, 0.04), { dur: 0.03, amp: 0.12 / (k + 1), f: rng.range(500, 900), q: 1.2, tau: 0.008, pan });
    normPeak(ch, 0.85);
    return { ch: finish(ch, sr, { fadeMs: 60 }), sr };
}
/** the wind of fast flight, looped (8 s): buffeting low, a gusting rush, a hiss over it (play its rate with the speed) */
export function windRush(_p, rng, sr) {
    const L = 8, XF = 1, T = L + XF;
    const ch = st(sr, T), n = ch[0].length;
    const low = M(sr, T);
    {
        const nz = new Noise(rng), lp = new Biquad(sr).lp(140, 0.8), hp = new Biquad(sr).hp(30, 0.7);
        const buf = ctrlNoise(rng, n, sr, 6), buf2 = ctrlNoise(rng, n, sr, 13);
        for (let i = 0; i < n; i++)
            low[i] = hp.run(lp.run(nz.brown())) * clamp(0.65 + 0.4 * buf[i] + 0.2 * buf2[i], 0.1, 1.5);
    }
    for (let c = 0; c < 2; c++) {
        const nz = new Noise(rng);
        const gust = ctrlNoise(rng, n, sr, 0.35), quick = ctrlNoise(rng, n, sr, 2.2);
        const bp = new Biquad(sr), hp = new Biquad(sr).hp(2600, 0.6), lp = new Biquad(sr).lp(9000, 0.6);
        for (let i = 0; i < n; i++) {
            const g = clamp(0.5 + 0.5 * gust[i] + 0.12 * quick[i], 0, 1.2);
            if ((i & 63) === 0)
                bp.bp((520 + 520 * g) * (c ? 1.07 : 0.94), 0.55);
            const rush = bp.run(nz.pink()) * (0.6 + 0.55 * g);
            const hiss = lp.run(hp.run(nz.white())) * 0.07 * spow(0.3 + 0.7 * g, 1.5);
            ch[c][i] = rush * 1.3 + hiss + low[i] * 0.6;
        }
    }
    const lo = loopify(ch, sr, XF);
    normRms(lo, 0.12);
    softLimit(lo, 0.9);
    return { ch: lo, sr };
}
//# sourceMappingURL=dragon.js.map