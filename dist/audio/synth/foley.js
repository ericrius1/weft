// Foley renderers: footsteps per surface (heel + toe contacts), wading, jump/land, wing flurries, UI.
import { Biquad, Noise, addBubble, addModal, addNoiseGrain, addTick, clamp, finish, fsin, loopify, normPeak, normRms, softLimit, spow } from './dsp';
import { grainTexture, swarm } from './water';
const M = (sr, secs) => new Float32Array(Math.max(16, Math.ceil(sr * secs)));
const pk = (a, p = 1) => { normPeak([a], p); return a; };
/** low body thump of a foot/body on ground */
function thump(c, sr, rng, t0, f, dur, amp) {
    const nz = new Noise(rng);
    const lp = new Biquad(sr).lp(f * 2.2, 0.8);
    const s0 = Math.floor(t0 * sr);
    let ph = 0;
    for (let i = 0; i < dur * sr; i++) {
        const t = i / sr;
        const e = (1 - Math.exp(-t / 0.002)) * Math.exp(-t / (dur * 0.3));
        ph += (f * (1 + 0.5 * Math.exp(-t / 0.01))) / sr;
        const v = (lp.run(nz.white()) * 0.6 + fsin(ph) * 0.5) * e * amp;
        for (const ch of c)
            if (s0 + i < ch.length)
                ch[s0 + i] += v;
    }
}
/** a cluster of tiny resonant clicks (pebbles, crystals, grit) */
function clicks(c, sr, rng, t0, span, n, fLo, fHi, amp, decLo = 0.002, decHi = 0.01, early = 0.35) {
    for (let k = 0; k < n; k++) {
        const t = t0 + (rng.chance(0.5) ? rng.exp(1 / (span * early)) : rng.range(0, span));
        const f = rng.log(fLo, fHi);
        addModal(c, sr, t, [[f, 1, rng.range(decLo, decHi)], [f * rng.range(1.5, 2.7), 0.35, rng.range(decLo, decHi) * 0.6]], amp * rng.log(0.15, 1), undefined, 0.25);
    }
}
function contact(surface, c, sr, rng, t0, w) {
    switch (surface) {
        case 'grass': {
            // blades brushing + soft soil thump
            for (let k = 0; k < Math.round(18 * w + 8); k++)
                addNoiseGrain(c, sr, rng, t0 + rng.exp(1 / 0.025), { dur: rng.range(0.003, 0.012), amp: 0.25 * w * rng.log(0.2, 1), attack: 0.001, f: rng.log(1800, 6500), q: rng.range(0.8, 2.2) });
            addNoiseGrain(c, sr, rng, t0, { dur: 0.09, amp: 0.2 * w, f: 3200, q: 0.6, shape: 'sine' });
            thump(c, sr, rng, t0, 110, 0.05, 0.12 * w);
            break;
        }
        case 'rock': {
            addTick(c, sr, rng, t0, 0.55 * w, 1200, 1.2);
            const f = rng.range(700, 1700);
            addModal(c, sr, t0, [[f, 1, rng.range(0.012, 0.03)], [f * rng.range(2.1, 2.6), 0.5, 0.012], [f * rng.range(3.4, 4.2), 0.25, 0.008]], 0.45 * w);
            clicks(c, sr, rng, t0, 0.02, Math.round(4 + 8 * w), 2500, 7000, 0.2 * w);
            thump(c, sr, rng, t0, 130, 0.035, 0.14 * w);
            addNoiseGrain(c, sr, rng, t0 + 0.004, { dur: rng.range(0.03, 0.07), amp: 0.08 * w, f: rng.range(2000, 3500), q: 0.8, shape: 'tri', attack: 0.004 });
            break;
        }
        case 'gravel': {
            clicks(c, sr, rng, t0, 0.07 + 0.03 * w, Math.round(18 + 30 * w), 1400, 7500, 0.45 * w, 0.002, 0.012);
            addNoiseGrain(c, sr, rng, t0, { dur: 0.08, amp: 0.1 * w, f: 2500, q: 0.6, shape: 'tri', attack: 0.005 });
            thump(c, sr, rng, t0, 120, 0.04, 0.12 * w);
            break;
        }
        case 'snow': {
            // dry snow: a dense crunch of crystal bonds breaking, sometimes a squeak, over a soft whump
            const span = rng.range(0.05, 0.1);
            for (let k = 0; k < Math.round(30 * w + 10); k++) {
                const t = t0 + rng.range(0, span) * Math.pow(rng.next(), 0.7);
                addModal(c, sr, t, [[rng.log(900, 4200), 1, rng.range(0.002, 0.008)]], 0.3 * w * rng.log(0.2, 1), undefined, 0.25);
            }
            addNoiseGrain(c, sr, rng, t0, { dur: span + 0.04, amp: 0.16 * w, f: 2200, q: 0.7, shape: 'tri', attack: 0.01 });
            if (rng.chance(0.45)) {
                // squeak: tonal stick-slip in cold snow
                const f0 = rng.range(900, 1700), d = rng.range(0.03, 0.07);
                const s0 = Math.floor((t0 + span * 0.4) * sr);
                let ph = 0;
                for (let i = 0; i < d * sr; i++) {
                    const u = i / (d * sr);
                    ph += (f0 * (1 + 0.08 * Math.sin(u * 9))) / sr;
                    const v = (fsin(ph) + 0.4 * fsin(ph * 2) + 0.2 * fsin(ph * 3)) * Math.sin(Math.PI * u) * 0.12 * w;
                    for (const ch of c)
                        if (s0 + i < ch.length)
                            ch[s0 + i] += v;
                }
            }
            thump(c, sr, rng, t0, 110, 0.06, 0.12 * w);
            break;
        }
        case 'ice': {
            addTick(c, sr, rng, t0, 0.6 * w, 1500, 0.8);
            const f = rng.range(1200, 2900);
            addModal(c, sr, t0, [[f, 1, rng.range(0.04, 0.09)], [f * 2.41, 0.4, 0.05], [f * 4.1, 0.2, 0.03]], 0.35 * w);
            // hollow tunk of the sheet over water
            addNoiseGrain(c, sr, rng, t0, { dur: 0.06, amp: 0.3 * w, f: rng.range(320, 460), q: 4, attack: 0.001, tau: 0.012 });
            if (rng.chance(0.35))
                addNoiseGrain(c, sr, rng, t0 + 0.01, { dur: 0.05, amp: 0.06 * w, type: 'hp', f: 3500, shape: 'tri', attack: 0.004 });
            break;
        }
        case 'wood': {
            addTick(c, sr, rng, t0, 0.35 * w, 900, 1);
            const f = rng.range(150, 260);
            addModal(c, sr, t0, [[f, 1, rng.range(0.06, 0.12)], [f * rng.range(2.6, 2.9), 0.55, 0.05], [rng.range(850, 1400), 0.35, 0.025]], 0.5 * w);
            if (rng.chance(0.25)) {
                const imp = [new Float32Array(c[0].length)];
                let t = t0 + 0.03;
                const rate = rng.range(60, 120);
                for (let k = 0; k < 10; k++) {
                    const i = Math.floor(t * sr);
                    if (i < imp[0].length)
                        imp[0][i] = rng.range(0.5, 1);
                    t += 1 / rate;
                }
                const r = new Biquad(sr).bp(rng.range(500, 800), 8);
                r.apply(imp[0]);
                for (const ch of c)
                    for (let i = 0; i < ch.length; i++)
                        ch[i] += imp[0][i] * 0.12 * w;
            }
            break;
        }
        case 'sand': {
            const n = Math.ceil(sr * 0.11);
            const gr = grainTexture(rng, n, sr, () => 2500, 0.0005, 0.002, 1);
            const nz = new Noise(rng);
            const hp = new Biquad(sr).hp(2500, 0.7), lp = new Biquad(sr).lp(8000, 0.7);
            const s0 = Math.floor(t0 * sr);
            for (let i = 0; i < n; i++) {
                const t = i / sr;
                const v = lp.run(hp.run(nz.white())) * gr[i] * Math.min(1, t / 0.01) * Math.exp(-t / 0.035) * 0.35 * w;
                for (const ch of c)
                    if (s0 + i < ch.length)
                        ch[s0 + i] += v;
            }
            thump(c, sr, rng, t0, 100, 0.05, 0.12 * w);
            break;
        }
        case 'water': {
            // shallow: a slosh + small slap + bubbles + a few droplets
            addNoiseGrain(c, sr, rng, t0, { dur: 0.16, amp: 0.3 * w, f: rng.range(600, 1100), q: 0.8, shape: 'tri', attack: 0.012 });
            addNoiseGrain(c, sr, rng, t0, { dur: 0.012, amp: 0.25 * w, type: 'hp', f: 1500, attack: 0.0005, tau: 0.003 });
            swarm(c, sr, rng, { t0: t0 + 0.004, n: Math.round(20 + 25 * w), decay: 0.05, rMin: 0.8, rMax: 6, amp: 0.25 * w, rise: [0.2, 0.9] });
            for (let k = 0; k < 6; k++) {
                const t = t0 + 0.08 + rng.exp(6);
                addTick(c, sr, rng, t, 0.04 * w, 2500);
                if (rng.chance(0.5))
                    addBubble(c, sr, t, rng.log(0.5, 1.5), 0.06 * w, 0.8);
            }
            break;
        }
        case 'wade': {
            // deeper: heavy low slosh, big glugs, the leg pushing water
            addNoiseGrain(c, sr, rng, t0, { dur: 0.42, amp: 0.4 * w, f: rng.range(260, 480), q: 1.0, shape: 'sine' });
            addNoiseGrain(c, sr, rng, t0 + 0.05, { dur: 0.3, amp: 0.15 * w, f: rng.range(900, 1400), q: 0.7, shape: 'sine' });
            for (let k = 0; k < rng.int(3, 7); k++)
                addBubble(c, sr, t0 + 0.1 + rng.range(0, 0.25), rng.log(5, 14), 0.3 * w * rng.range(0.4, 1), rng.range(0.5, 1.2), 0.5);
            swarm(c, sr, rng, { t0: t0 + 0.05, n: 40, decay: 0.12, rMin: 0.8, rMax: 5, amp: 0.12 * w, rise: [0.2, 0.8] });
            break;
        }
    }
}
/** one footstep (heel then toe) on a surface */
export function step(p, rng, sr) {
    const s = p.surface;
    const out = [M(sr, s === 'wade' ? 0.8 : 0.45)];
    const gap = rng.range(0.045, 0.085);
    contact(s, out, sr, rng, 0.002, 1);
    if (s !== 'wade')
        contact(s, out, sr, rng, 0.002 + gap, rng.range(0.35, 0.6));
    normPeak(out, 0.9);
    return { ch: finish(out, sr, { fadeMs: 10 }), sr };
}
/** jump push-off whoosh (body/cloth through air) */
export function jumpWhoosh(_p, rng, sr) {
    const D = 0.4;
    const n = Math.ceil(sr * D);
    const a = new Float32Array(n);
    const nz = new Noise(rng);
    const bp = new Biquad(sr), hp = new Biquad(sr).hp(2500, 0.7);
    const gr = grainTexture(rng, n, sr, () => 300, 0.002, 0.008, 1.5);
    for (let i = 0; i < n; i++) {
        const u = i / n;
        if ((i & 31) === 0)
            bp.bp(380 + 900 * Math.sin(Math.PI * u), 1.1);
        const e = Math.sin(Math.PI * Math.min(1, u * 1.3)) ** 2;
        a[i] = (bp.run(nz.white()) + 0.25 * hp.run(nz.white()) * gr[i]) * e;
    }
    pk(a, 0.9);
    return { ch: finish([a], sr), sr };
}
/** landing body thump */
export function bodyThump(p, rng, sr) {
    const h = clamp(p.heavy ?? 0.5, 0, 1);
    const out = [M(sr, 0.4)];
    thump(out, sr, rng, 0.001, 85 + 35 * (1 - h), 0.14 + 0.08 * h, 0.7);
    addNoiseGrain(out, sr, rng, 0.001, { dur: 0.05, amp: 0.25, f: 300, q: 1.2, attack: 0.001, tau: 0.012 });
    addNoiseGrain(out, sr, rng, 0.004, { dur: 0.08, amp: 0.08, f: 2500, q: 0.7, shape: 'tri', attack: 0.004 });
    normPeak(out, 0.9);
    return { ch: finish(out, sr), sr };
}
/** a startled flock taking off: overlapping wingbeat trains moving away, a few alarm chips */
export function flurry(p, rng, sr) {
    const count = clamp(Math.round(p.count ?? 4), 1, 30);
    const D = 2.2;
    const n = Math.ceil(sr * D);
    const out = [new Float32Array(n)];
    const nz = new Noise(rng);
    for (let b = 0; b < count; b++) {
        const start = rng.exp(1 / 0.12) * (b === 0 ? 0.2 : 1);
        const big = rng.next();
        const rate = 9 + 7 * (1 - big) + rng.sym();
        const dur = rng.range(0.6, 1.4);
        const fc = 450 + 700 * (1 - big);
        let t = start;
        while (t < start + dur && t < D - 0.1) {
            const age = (t - start) / dur;
            const amp = Math.exp(-age * 2.2) * rng.range(0.6, 1) * (0.6 + 0.4 * big);
            const fl = Math.floor(rng.range(0.025, 0.045) * sr);
            const s0 = Math.floor(t * sr);
            const bp = new Biquad(sr), hp = new Biquad(sr).hp(2800, 0.7);
            for (let i = 0; i < fl && s0 + i < n; i++) {
                const u = i / fl;
                if ((i & 15) === 0)
                    bp.bp(fc * (1.3 - 0.6 * u), 1.2);
                const e = u < 0.25 ? u / 0.25 : spow(1 - (u - 0.25) / 0.75, 2);
                out[0][s0 + i] += (bp.run(nz.white()) + 0.3 * hp.run(nz.white())) * e * amp;
            }
            t += (1 / rate) * rng.range(0.9, 1.1);
        }
        if (rng.chance(0.3)) {
            const f0 = rng.range(3800, 6200);
            const tt = start + rng.range(0, 0.4);
            for (let k = 0; k < rng.int(1, 3); k++)
                addModal(out, sr, tt + k * 0.09, [[f0, 1, 0.04], [f0 * 2, 0.2, 0.03]], 0.15);
        }
    }
    normPeak(out, 0.9);
    return { ch: finish(out, sr, { fadeMs: 40 }), sr };
}
/** UI: open = a rising water drop with two soft pentatonic bell tones; close = falling drop + wooden tock; click = tock */
export function ui(p, rng, sr) {
    const out = [M(sr, p.kind === 'click' ? 0.25 : 0.9)];
    const tock = (t, f, amp) => {
        addModal(out, sr, t, [[f, 1, 0.05], [f * 2.57, 0.35, 0.025], [f * 4.1, 0.12, 0.015]], amp, undefined, 0.15);
        addTick(out, sr, rng, t, amp * 0.2, 2000, 0.4);
    };
    if (p.kind === 'click') {
        tock(0.001, rng.range(980, 1150), 0.7);
        addBubble(out, sr, 0.004, rng.range(1.4, 1.8), 0.18, 0.9, 0.7);
    }
    else if (p.kind === 'open') {
        addBubble(out, sr, 0.002, 4.5, 0.7, 1.4, 0.35);
        const notes = [76, 83]; // E5, B5 — open fifth
        notes.forEach((m, i) => {
            const f = 440 * Math.pow(2, (m - 69) / 12);
            addModal(out, sr, 0.05 + i * 0.07, [[f, 1, 0.7], [f * 2, 0.2, 0.35], [f * 3.01, 0.06, 0.2]], 0.28, undefined, 2);
        });
    }
    else {
        // falling drop: bubble with a downward glide
        const s0 = Math.floor(0.002 * sr);
        let ph = 0;
        for (let i = 0; i < sr * 0.12; i++) {
            const t = i / sr;
            ph += (900 * Math.exp(-t * 5)) / sr;
            out[0][s0 + i] += fsin(ph) * Math.exp(-t / 0.035) * 0.5 * Math.min(1, t / 0.001);
        }
        tock(0.06, rng.range(700, 820), 0.55);
    }
    normPeak(out, 0.85);
    return { ch: finish(out, sr), sr };
}
/** paper spirit lantern knocked out: soft papery thump + crinkle, a little spray, the flame doused (sizzle + steam) */
export function lanternHit(_p, rng, sr) {
    const D = 1.3;
    const n = Math.ceil(sr * D);
    const out = [new Float32Array(n)];
    // papery thump: the water slapping a taut paper shell
    addNoiseGrain(out, sr, rng, 0.002, { dur: 0.09, amp: 0.55, f: rng.range(380, 560), q: 1.1, attack: 0.002, tau: 0.022 });
    addNoiseGrain(out, sr, rng, 0.002, { dur: 0.03, amp: 0.25, type: 'hp', f: 1800, attack: 0.0006, tau: 0.006 });
    // paper crinkle
    for (let k = 0; k < rng.int(16, 30); k++)
        addNoiseGrain(out, sr, rng, 0.004 + rng.exp(1 / 0.04), { dur: rng.range(0.002, 0.008), amp: 0.16 * rng.log(0.2, 1), attack: 0.0006, f: rng.log(2200, 6500), q: rng.range(1, 3) });
    // spray of the thrown water
    swarm(out, sr, rng, { t0: 0.004, n: 30, decay: 0.05, rMin: 0.5, rMax: 2.5, amp: 0.12, rise: [0.2, 0.8] });
    // doused flame: a burst of tiny pops thinning out + hiss
    const sz = [new Float32Array(n)];
    let t = 0.015;
    while (t < 0.9) {
        const u = (t - 0.015) / 0.9;
        t += rng.exp(450 * Math.exp(-u * 4) + 15);
        addTick(sz, sr, rng, t, 0.5 * Math.exp(-u * 2.5) * rng.log(0.2, 1), 4500, 0.25);
    }
    normPeak(sz, 1);
    const gr = grainTexture(rng, n, sr, () => 900, 0.0008, 0.003, 1.3);
    const nz = new Noise(rng);
    const hp = new Biquad(sr).hp(3500, 0.7), bp = new Biquad(sr).bp(6500, 0.8), st = new Biquad(sr).bp(2400, 0.7);
    const hiss = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const tt = i / sr;
        const w = nz.white();
        const e = Math.min(1, tt / 0.012) * Math.exp(-tt / 0.28);
        const steam = Math.min(1, tt / 0.06) * Math.exp(-tt / 0.22);
        hiss[i] = bp.run(hp.run(w)) * (0.35 + 0.65 * gr[i]) * e + st.run(w) * steam * 0.35;
    }
    normPeak([hiss], 1);
    for (let i = 0; i < n; i++)
        out[0][i] = out[0][i] * 1.0 + sz[0][i] * 0.18 + hiss[i] * 0.22;
    normPeak(out, 0.85);
    return { ch: finish(out, sr, { fadeMs: 60 }), sr };
}
/** lantern re-lighting and floating up: soft relight puff, flame flutter, an airy rising shimmer */
export function lanternRise(_p, rng, sr) {
    const D = 3.0;
    const n = Math.ceil(sr * D);
    const out = new Float32Array(n);
    const nz = new Noise(rng);
    // relight "fwup"
    const pb = new Biquad(sr).bp(rng.range(320, 460), 1.3);
    for (let i = 0; i < sr * 0.25; i++) {
        const u = i / (sr * 0.25);
        out[i] += pb.run(nz.white()) * Math.sin(Math.PI * u) ** 2 * 0.5;
    }
    // flame flutter: low air buffeting at a flickery rate
    const fl = new Biquad(sr).bp(420, 0.8);
    const fm = grainTexture(rng, n, sr, () => 14, 0.03, 0.08, 1);
    for (let i = 0; i < n; i++) {
        const tt = i / sr;
        out[i] += fl.run(nz.white()) * (0.3 + 0.7 * fm[i]) * 0.12 * Math.min(1, tt / 0.1) * Math.exp(-tt / 0.9);
    }
    // airy shimmer swell rising in pitch
    const b1 = new Biquad(sr), b2 = new Biquad(sr);
    for (let i = 0; i < n; i++) {
        const u = i / n;
        if ((i & 63) === 0) {
            b1.bp(1200 * Math.pow(3.4, u), 2.4);
            b2.bp(2400 * Math.pow(3.4, u), 3);
        }
        const w = nz.white();
        const e = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 1.6 * (0.85 + 0.15 * Math.sin(u * 40));
        out[i] += (b1.run(w) + 0.6 * b2.run(w)) * e * 0.35;
    }
    normPeak([out], 0.8);
    return { ch: finish([out], sr, { fadeMs: 200 }), sr };
}
/** cloth / hair flutter in a strong airflow (mono loop): irregular flapping pulses through fabric resonances */
export function flutter(_p, rng, sr) {
    const L = 5, XF = 0.5, T = L + XF;
    const n = Math.ceil(sr * T);
    const a = new Float32Array(n);
    const nz = new Noise(rng);
    const b1 = new Biquad(sr).bp(320, 1.2), b2 = new Biquad(sr).bp(780, 1.6), hp = new Biquad(sr).hp(2500, 0.7);
    // flap envelope: quasi-periodic pulses whose rate wanders 11-24 Hz
    const env = new Float32Array(n);
    let t = 0;
    while (t < T) {
        const rate = 11 + 13 * (0.5 + 0.5 * Math.sin(t * 1.7 + rng.range(0, 0.3)));
        const len = (0.6 / rate) * rng.range(0.7, 1.2);
        const s0 = Math.floor(t * sr), m = Math.floor(len * sr);
        const amp = rng.log(0.3, 1);
        for (let i = 0; i < m && s0 + i < n; i++) {
            const u = i / m;
            env[s0 + i] += amp * (u < 0.15 ? u / 0.15 : Math.pow(1 - (u - 0.15) / 0.85, 2));
        }
        t += (1 / rate) * rng.range(0.8, 1.25);
    }
    for (let i = 0; i < n; i++) {
        const w = nz.white();
        a[i] = (b1.run(w) * 1.0 + b2.run(w) * 0.6) * env[i] + hp.run(w) * 0.08 * env[i];
    }
    const lo = loopify([a], sr, XF);
    normRms(lo, 0.1);
    softLimit(lo, 0.9);
    return { ch: lo, sr };
}
/** take-off / landing whoosh: a broad air sweep with a burst of cloth flaps (dir 'up' rises, 'down' settles) */
export function flyWhoosh(p, rng, sr) {
    const up = p.dir !== 'down';
    const D = up ? 1.5 : 1.2;
    const n = Math.ceil(sr * D);
    const out = new Float32Array(n);
    const nz = new Noise(rng);
    const bp = new Biquad(sr), bp2 = new Biquad(sr), lp = new Biquad(sr).lp(160, 0.8);
    for (let i = 0; i < n; i++) {
        const u = i / n;
        if ((i & 31) === 0) {
            const f = up ? 260 * Math.pow(7, Math.pow(u, 0.7)) : 1700 * Math.pow(0.18, u);
            bp.bp(f, 0.9);
            bp2.bp(f * 2.3, 1.4);
        }
        const e = up ? Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.25)), 1.4) : Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + u)), 1.2) * (1 - u);
        const w = nz.white();
        out[i] = (bp.run(w) + 0.35 * bp2.run(w)) * e + lp.run(nz.brown()) * e * (up ? 0.8 : 0.5);
    }
    // cloth flaps
    const fl = flutter({}, rng, sr).ch[0];
    const s0 = Math.floor((up ? 0.05 : 0.35) * sr), m = Math.floor(0.6 * sr);
    for (let i = 0; i < m && s0 + i < n; i++)
        out[s0 + i] += fl[i] * Math.sin((Math.PI * i) / m) * 0.9;
    normPeak([out], 0.85);
    return { ch: finish([out], sr, { fadeMs: 80 }), sr };
}
//# sourceMappingURL=foley.js.map