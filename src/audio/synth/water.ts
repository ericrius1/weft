// Water sound renderers. Almost every liquid sound here is built from populations of Minnaert bubbles
// (van den Doel's model) plus shaped, granular noise — the way real water sounds are made — never plain hiss.
import {
  Biquad, Chans, Noise, OnePole, Rendered, Rng, addBubble, addModal, dcBlock, addNoiseGrain, addTick, clamp, ctrlNoise, finish, fsin,
  loopify, normPeak, normRms, panGains, softLimit, Pan, spow,
} from './dsp';

const M = (sr: number, secs: number) => new Float32Array(Math.max(16, Math.ceil(sr * secs)));
const pk = (a: Float32Array, p = 1) => { normPeak([a], p); return a; };
export function addArr(dst: Float32Array, src: Float32Array, g = 1, off = 0) {
  for (let i = 0; i < src.length; i++) { const j = i + off; if (j >= 0 && j < dst.length) dst[j] += src[i] * g; }
}

/** granular amplitude texture: a sum of raised-cosine grains (gives noise a splattery, liquid grain) */
export function grainTexture(rng: Rng, n: number, sr: number, rate: (t: number) => number, dMin: number, dMax: number, ampPow = 1.5) {
  const g = new Float32Array(n);
  const T = n / sr;
  let t = 0;
  for (;;) {
    t += rng.exp(Math.max(0.5, rate(t)));
    if (t >= T) break;
    const m = Math.max(4, Math.floor(rng.range(dMin, dMax) * sr));
    const a = Math.pow(rng.next(), ampPow);
    const s0 = Math.floor(t * sr);
    for (let i = 0; i < m && s0 + i < n; i++) g[s0 + i] += a * 0.5 * (1 - Math.cos((2 * Math.PI * i) / m));
  }
  return g;
}

export interface SwarmOpts {
  t0: number; n: number; rMin: number; rMax: number; amp: number;
  /** exponential time constant of the onsets (s); otherwise uniform over `dur` */
  decay?: number; dur?: number; rise?: [number, number]; damp?: number; panSpread?: number; panCenter?: number; rPow?: number;
}
/** a population of bubbles, radii log-uniform, louder for bigger bubbles */
export function swarm(ch: Chans, sr: number, rng: Rng, o: SwarmOpts) {
  const rise = o.rise ?? [0.1, 0.4];
  for (let k = 0; k < o.n; k++) {
    const t = o.t0 + (o.decay !== undefined ? rng.exp(1 / o.decay) : rng.range(0, o.dur ?? 1));
    const r = rng.log(o.rMin, o.rMax);
    const a = o.amp * Math.pow(r / o.rMax, o.rPow ?? 0.4) * rng.log(0.25, 1);
    const pan = ch.length > 1 ? panGains((o.panCenter ?? 0) + rng.sym() * (o.panSpread ?? 0.7)) : undefined;
    addBubble(ch, sr, t, r, a, rng.range(rise[0], rise[1]), o.damp ?? 1, pan);
  }
}

/** shaped noise into a mono buffer: bandpass chain × envelope × optional grain texture */
function noiseLayer(sr: number, rng: Rng, secs: number, o: { hp?: number; lp?: number; bp?: [number, number]; env: (t: number) => number; grain?: Float32Array; grainMix?: number; color?: 'white' | 'pink' | 'brown' }) {
  const a = M(sr, secs);
  const nz = new Noise(rng);
  const hp = o.hp ? new Biquad(sr).hp(o.hp, 0.7) : null;
  const lp = o.lp ? new Biquad(sr).lp(o.lp, 0.7) : null;
  const bp = o.bp ? new Biquad(sr).bp(o.bp[0], o.bp[1]) : null;
  const gm = o.grainMix ?? 0.7;
  for (let i = 0; i < a.length; i++) {
    let x = o.color === 'pink' ? nz.pink() * 2.5 : o.color === 'brown' ? nz.brown() : nz.white();
    if (hp) x = hp.run(x); if (bp) x = bp.run(x); if (lp) x = lp.run(x);
    const g = o.grain ? (1 - gm) + gm * o.grain[i] : 1;
    a[i] = x * g * o.env(i / sr);
  }
  return a;
}

// ------------------------------------------------------------------ one-shots

/** a water drop: impact tick + "plink" (strongly rising bubble) + a tiny secondary drop (Worthington jet) */
export function drop(p: { big?: number }, rng: Rng, sr: number): Rendered {
  const big = clamp(p.big ?? 0, 0, 1);
  const out = [M(sr, 0.35)];
  addTick(out, sr, rng, 0.001, 0.25, 2500, 0.6);
  const r = rng.log(0.9, 1.8) * (1 + big * 1.5);
  addBubble(out, sr, 0.0015, r, 1, rng.range(0.6, 1.4), rng.range(0.5, 0.8));
  if (rng.chance(0.7)) { const t2 = rng.range(0.05, 0.11); addTick(out, sr, rng, t2, 0.08, 3000, 0.5); addBubble(out, sr, t2 + 0.001, r * rng.range(0.5, 0.8), 0.3, rng.range(0.5, 1.2), 0.7); }
  normPeak(out, 0.9);
  return { ch: finish(out, sr), sr };
}

/** the impact transient alone (layered on splashes by impact speed) */
export function slap(p: { size: number }, rng: Rng, sr: number): Rendered {
  const s = clamp(p.size, 0, 1);
  const a = M(sr, 0.25);
  const nz = new Noise(rng);
  // the crack of the surface being struck: broadband, peaking in the presence region
  const hp = new Biquad(sr).hp(350 + 500 * (1 - s), 0.6), lp = new Biquad(sr).lp(10000 - 2500 * s, 0.7);
  const pk1 = new Biquad(sr).peak(2200 - 700 * s, 0.9, 7);
  const m = Math.floor(sr * (0.012 + 0.02 * s)), tau = sr * (0.0025 + 0.005 * s), att = Math.floor(sr * 0.0004);
  for (let i = 0; i < m; i++) a[i] = pk1.run(lp.run(hp.run(nz.white()))) * (i < att ? i / att : Math.exp(-(i - att) / tau));
  pk(a, 1);
  // a short low "thwack" of the water mass (kept modest — splashes are not kicks)
  const f0 = 190 - 110 * s; let ph = 0;
  const m2 = Math.floor(sr * (0.05 + 0.08 * s));
  for (let i = 0; i < m2; i++) {
    const t = i / sr; const f = f0 * (1 + 0.6 * Math.exp(-t / 0.006)); ph += f / sr;
    a[i] += 0.28 * (0.3 + 0.7 * s) * fsin(ph) * (1 - Math.exp(-t / 0.0015)) * Math.exp(-t / (0.01 + 0.025 * s));
  }
  pk(a, 0.9);
  return { ch: finish([a], sr), sr };
}

/**
 * Splash: slap transient + granular crown body + bubble swarm + cavity "bloop" + droplet patter tail
 * (+ a fall-back wash for the big ones). size 0..1.
 */
export function splash(p: { size: number }, rng: Rng, sr: number): Rendered {
  const s = clamp(p.size, 0, 1);
  const D = 0.45 + 1.8 * s;
  const n = Math.ceil(sr * (D + 0.25));
  const out = new Float32Array(n);
  // slap
  const sl = slap({ size: s }, rng, sr).ch[0];
  // crown body: band-shaped noise modulated by a dense grain texture (splatter), fast attack, decays with size
  const bodyLen = 0.18 + 0.9 * s;
  const gr = grainTexture(rng, Math.ceil(sr * bodyLen), sr, () => 350 + 900 * s, 0.002, 0.009 + 0.012 * s, 1.6);
  const body = noiseLayer(sr, rng, bodyLen, {
    hp: 250, bp: [1900 - 800 * s, 0.5], lp: 8000 - 2000 * s, grain: gr, grainMix: 0.8,
    env: (t) => (t < 0.004 ? t / 0.004 : Math.exp(-(t - 0.004) / (0.035 + 0.2 * s))),
  });
  pk(body);
  // fine spray riding on the crown
  const grS = grainTexture(rng, Math.ceil(sr * bodyLen), sr, () => 1500, 0.0006, 0.0025, 1.2);
  const spray = noiseLayer(sr, rng, bodyLen, { hp: 3500, lp: 12000, grain: grS, grainMix: 0.9, env: (t) => (t < 0.006 ? t / 0.006 : Math.exp(-(t - 0.006) / (0.03 + 0.15 * s))) });
  pk(spray);
  // bubbles entrained by the impact
  const bub = [new Float32Array(n)];
  swarm(bub, sr, rng, { t0: 0.002, n: Math.round(30 + 520 * s), decay: 0.025 + 0.14 * s, rMin: 0.45, rMax: 2.2 + 9 * s, amp: 1, rise: [0.1, 0.7] });
  pk(bub[0]);
  // cavity collapse: the characteristic "bloop" — a large bubble with a big upward chirp
  const bl = [new Float32Array(n)];
  const nb = s > 0.6 ? 2 : 1;
  for (let k = 0; k < nb; k++) if (rng.chance(0.92)) addBubble(bl, sr, 0.012 + 0.06 * s + rng.range(0, 0.03) + k * rng.range(0.05, 0.12), (3 + 8 * s) * rng.range(0.75, 1.25) * (k ? 0.6 : 1), k ? 0.6 : 1, rng.range(0.6, 1.2), 1.3);
  pk(bl[0]);
  // droplets raining back onto the surface
  const tail = [new Float32Array(n)];
  const t0 = 0.05 + 0.18 * s;
  const tc = 6 + Math.round(170 * s);
  for (let k = 0; k < tc; k++) {
    const t = t0 + rng.exp(1 / (0.1 + 0.42 * s));
    if (t > D) continue;
    const a = Math.exp(-(t - t0) / (0.2 + 0.55 * s)) * rng.log(0.15, 1);
    addTick(tail, sr, rng, t, a * 0.5, 2200 + rng.range(0, 2500), rng.range(0.4, 1.0));
    if (rng.chance(0.55)) addBubble(tail, sr, t + 0.0006, rng.log(0.35, 1.7 + s), a * 0.45, rng.range(0.3, 1.3), rng.range(0.6, 1));
  }
  pk(tail[0]);
  // fall-back wash for big splashes (the lifted water mass coming down)
  let wash: Float32Array | null = null;
  if (s > 0.45) {
    const wl = 1.4 * s;
    const g2 = grainTexture(rng, Math.ceil(sr * wl), sr, () => 700, 0.003, 0.015, 1.3);
    wash = noiseLayer(sr, rng, wl, {
      hp: 120, bp: [900, 0.5], lp: 3500, grain: g2, grainMix: 0.75,
      env: (t) => Math.sin(Math.PI * Math.min(1, t / (0.35 * wl))) ** 1.5 * (t < 0.35 * wl ? 1 : Math.exp(-(t - 0.35 * wl) / (0.3 * wl))),
    });
    pk(wash);
    swarm([wash], sr, rng, { t0: 0.15 * wl, n: Math.round(200 * s), decay: 0.3 * wl, rMin: 0.6, rMax: 6, amp: 0.25 });
  }
  addArr(out, sl, 0.75);
  addArr(out, body, 0.62 + 0.1 * s);
  addArr(out, spray, 0.2);
  addArr(out, bub[0], 0.36);
  addArr(out, bl[0], 0.32);
  addArr(out, tail[0], 0.2 + 0.08 * s);
  if (wash) addArr(out, wash, 0.35 * (s - 0.3), Math.floor(sr * (0.12 + 0.1 * s)));
  pk(out, 0.9);
  return { ch: finish([out], sr), sr };
}

/** cavity plop: a stone/fish entering water — small slap, deep bloop, a few drops */
export function plop(p: { size?: number }, rng: Rng, sr: number): Rendered {
  const s = clamp(p.size ?? 0.3, 0, 1);
  const out = [M(sr, 0.9)];
  addTick(out, sr, rng, 0.0005, 0.35, 1200, 2 + 3 * s);
  addBubble(out, sr, 0.008 + rng.range(0, 0.01), (5 + 9 * s) * rng.range(0.8, 1.2), 1.0, rng.range(0.6, 1.2), 0.45);
  swarm(out, sr, rng, { t0: 0.003, n: 30 + Math.round(60 * s), decay: 0.04, rMin: 0.6, rMax: 3, amp: 0.25 });
  for (let k = 0; k < 4 + 8 * s; k++) { const t = 0.08 + rng.exp(5); addTick(out, sr, rng, t, 0.08, 2500); if (rng.chance(0.5)) addBubble(out, sr, t, rng.log(0.4, 1.5), 0.12, 0.8); }
  normPeak(out, 0.9);
  return { ch: finish(out, sr), sr };
}

/** rising bubbles (underwater breath / plunge) */
export function bubbleRise(p: { n?: number; dur?: number }, rng: Rng, sr: number): Rendered {
  const dur = p.dur ?? 1.2;
  const out = [M(sr, dur + 0.4)];
  swarm(out, sr, rng, { t0: 0.01, n: p.n ?? 60, decay: dur * 0.4, rMin: 1.5, rMax: 9, amp: 1, rise: [0.4, 1.2], damp: 0.7 });
  const lp = new Biquad(sr).lp(2400, 0.7);
  lp.apply(out[0]);
  normPeak(out, 0.85);
  return { ch: finish(out, sr), sr };
}

/** draw: water lifted out of the surface — suction "schlorp", rising pour, droplets falling back */
export function draw(p: { amount?: number }, rng: Rng, sr: number): Rendered {
  const D = 1.9;
  const n = Math.ceil(sr * D);
  const out = new Float32Array(n);
  const nz = new Noise(rng);
  // suction: resonant noise sweeping up + big glugging bubbles
  {
    const bp = new Biquad(sr), bp2 = new Biquad(sr);
    const m = Math.floor(sr * 0.55);
    const a = new Float32Array(m);
    const mod = ctrlNoise(rng, m, sr, 22);
    for (let i = 0; i < m; i++) {
      const u = i / m;
      if ((i & 31) === 0) { bp.bp(160 * Math.pow(5, u), 3.5); bp2.bp(330 * Math.pow(4, u), 2.5); }
      const x = nz.white();
      const e = Math.sin(Math.PI * Math.min(1, u * 1.6)) ** 1.2 * (0.7 + 0.3 * mod[i]);
      a[i] = (bp.run(x) * 1.0 + bp2.run(x) * 0.6) * e;
    }
    pk(a, 1); addArr(out, a, 0.45);
    const g = [new Float32Array(n)];
    for (let k = 0; k < 9; k++) addBubble(g, sr, 0.03 + k * rng.range(0.03, 0.06), rng.range(6, 14) * (1 - k * 0.05), rng.range(0.5, 1), rng.range(0.8, 1.6), 0.55);
    pk(g[0], 1); addArr(out, g[0], 0.4);
  }
  // rising pour: a streaming column whose resonance climbs (like a bottle filling, reversed), with a bubbly stream
  {
    const st = 0.25, len = 1.15;
    const m = Math.floor(sr * len);
    const a = new Float32Array(m);
    const bp = new Biquad(sr), hp = new Biquad(sr).hp(250, 0.7);
    const gr = grainTexture(rng, m, sr, () => 900, 0.002, 0.008, 1.4);
    for (let i = 0; i < m; i++) {
      const u = i / m;
      if ((i & 31) === 0) bp.bp(420 * Math.pow(3.6, u), 2.2);
      const e = Math.min(1, u / 0.15) * (1 - sstepLocal(0.75, 1, u));
      a[i] = bp.run(hp.run(nz.white())) * (0.35 + 0.65 * gr[i]) * e;
    }
    const b = [a];
    for (let k = 0; k < 160; k++) { const u = rng.next(); addBubble(b, sr, u * len * 0.95, rng.log(0.8, 6 - 4 * u), 0.15 * rng.log(0.3, 1), rng.range(0.2, 0.8)); }
    pk(a, 1); addArr(out, a, 0.5, Math.floor(st * sr));
  }
  // drips falling back
  {
    const d = [new Float32Array(n)];
    for (let k = 0; k < 9; k++) { const t = 0.7 + rng.range(0, 1.0); addTick(d, sr, rng, t, 0.2, 2500, 0.7); addBubble(d, sr, t + 0.001, rng.log(0.7, 1.8), rng.range(0.3, 1), rng.range(0.6, 1.3), 0.7); }
    pk(d[0], 1); addArr(out, d[0], 0.22);
  }
  pk(out, 0.9);
  return { ch: finish([out], sr), sr };
}
function sstepLocal(a: number, b: number, x: number) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

/** whip: a fast bandpass whoosh (with doppler-ish fall) tearing a stream of spray, then patter */
export function whip(p: { heavy?: number }, rng: Rng, sr: number): Rendered {
  const heavy = clamp(p.heavy ?? 0, 0, 1);
  const D = 1.1 + 0.4 * heavy;
  const n = Math.ceil(sr * D);
  const out = new Float32Array(n);
  const nz = new Noise(rng);
  const wl = 0.32 + 0.25 * heavy;
  const m = Math.floor(sr * wl);
  const peakU = rng.range(0.38, 0.5);
  const fLo = 260 + 120 * (1 - heavy), fHi = (2600 - 1300 * heavy) * rng.range(0.85, 1.15);
  const bp = new Biquad(sr), bp2 = new Biquad(sr);
  const gr = grainTexture(rng, m, sr, () => 1200, 0.0015, 0.006, 1.2);
  const a = new Float32Array(m), sp = new Float32Array(m);
  const hp = new Biquad(sr).hp(3000, 0.7);
  for (let i = 0; i < m; i++) {
    const u = i / m;
    const bell = u < peakU ? Math.pow(u / peakU, 2.2) : spow(1 - (u - peakU) / (1 - peakU), 1.6);
    const fc = u < peakU ? fLo * Math.pow(fHi / fLo, Math.pow(u / peakU, 1.5)) : fHi * Math.pow(0.45, (u - peakU) / (1 - peakU));
    if ((i & 15) === 0) { bp.bp(fc, 1.6); bp2.bp(fc * 2.1, 2.5); }
    const x = nz.white();
    a[i] = (bp.run(x) + 0.35 * bp2.run(x)) * bell;
    // wet spray riding on the whoosh
    sp[i] = hp.run(nz.white()) * gr[i] * Math.pow(bell, 0.7);
  }
  pk(a, 1); pk(sp, 1);
  addArr(out, a, 0.75); addArr(out, sp, 0.22);
  // bubbly tearing during the peak
  const b = [new Float32Array(n)];
  swarm(b, sr, rng, { t0: wl * peakU * 0.8, n: 70 + Math.round(80 * heavy), decay: 0.08, rMin: 0.6, rMax: 4 + 6 * heavy, amp: 1, rise: [0.2, 0.9] });
  pk(b[0], 1); addArr(out, b[0], 0.22);
  // spray patter tail
  const t = [new Float32Array(n)];
  for (let k = 0; k < 40 + 40 * heavy; k++) {
    const tt = wl * 0.7 + rng.exp(1 / 0.25);
    if (tt > D - 0.05) continue;
    const amp = Math.exp(-(tt - wl * 0.7) / 0.3) * rng.log(0.15, 1);
    addTick(t, sr, rng, tt, amp * 0.5, 2500 + rng.range(0, 3000), 0.6);
    if (rng.chance(0.4)) addBubble(t, sr, tt, rng.log(0.35, 1.4), amp * 0.4, rng.range(0.4, 1.2));
  }
  pk(t[0], 1); addArr(out, t[0], 0.16);
  pk(out, 0.9);
  return { ch: finish([out], sr), sr };
}

/** wave: building surge -> crash -> foaming wash that recedes */
export function wave(p: { size?: number }, rng: Rng, sr: number): Rendered {
  const s = clamp(p.size ?? 1, 0, 1);
  const D = 3.2 + 1.8 * s;
  const n = Math.ceil(sr * D);
  const out = new Float32Array(n);
  const tc = 0.55 + 0.35 * s; // crash time
  // surge: low rolling swell whose brightness rises into the crash
  {
    const nz = new Noise(rng);
    const lp = new Biquad(sr), lp2 = new Biquad(sr).hp(40, 0.7);
    const m = Math.floor(sr * (tc + 0.4));
    const a = new Float32Array(m);
    const mod = ctrlNoise(rng, m, sr, 6);
    for (let i = 0; i < m; i++) {
      const t = i / sr;
      if ((i & 63) === 0) lp.lp(180 + 1400 * Math.pow(Math.min(1, t / tc), 2), 0.9);
      const e = Math.pow(Math.min(1, t / tc), 2.2) * (t > tc ? Math.exp(-(t - tc) / 0.12) : 1) * (0.8 + 0.2 * mod[i]);
      a[i] = lp.run(lp2.run(nz.pink() * 3)) * e;
    }
    pk(a, 1); addArr(out, a, 0.5);
  }
  // crash: big granular noise burst + slap + massive bubble swarm
  {
    const sl = slap({ size: 0.9 }, rng, sr).ch[0];
    addArr(out, sl, 0.55, Math.floor(tc * sr));
    const cl = 1.4 + s;
    const gr = grainTexture(rng, Math.ceil(sr * cl), sr, (t) => 1400 * Math.exp(-t / 1.2) + 200, 0.002, 0.014, 1.3);
    const body = noiseLayer(sr, rng, cl, { hp: 90, bp: [850, 0.45], lp: 6500, grain: gr, grainMix: 0.7, env: (t) => (t < 0.01 ? t / 0.01 : Math.exp(-(t - 0.01) / (0.35 + 0.3 * s))) });
    pk(body, 1); addArr(out, body, 0.62, Math.floor(tc * sr));
    const b = [new Float32Array(n)];
    swarm(b, sr, rng, { t0: tc, n: Math.round(500 + 500 * s), decay: 0.35 + 0.3 * s, rMin: 0.5, rMax: 14, amp: 1, rise: [0.1, 0.8] });
    pk(b[0], 1); addArr(out, b[0], 0.4);
  }
  // wash: foam fizz (tiny bubbles popping) + hiss receding
  {
    const wl = D - tc - 0.2;
    const gr = grainTexture(rng, Math.ceil(sr * wl), sr, () => 2500, 0.0008, 0.003, 1.2);
    const hiss = noiseLayer(sr, rng, wl, { hp: 2200, lp: 9000, grain: gr, grainMix: 0.85, env: (t) => Math.min(1, t / 0.3) * Math.exp(-t / (0.45 * wl)) });
    pk(hiss, 1); addArr(out, hiss, 0.2, Math.floor((tc + 0.15) * sr));
    const f = [new Float32Array(n)];
    swarm(f, sr, rng, { t0: tc + 0.2, n: 900, decay: wl * 0.45, rMin: 0.15, rMax: 0.7, amp: 1, rise: [0.1, 0.4] });
    pk(f[0], 1); addArr(out, f[0], 0.14);
  }
  pk(out, 0.9);
  return { ch: finish([out], sr, { fadeMs: 60 }), sr };
}

// ------------------------------------------------------------------ loops

/** lake shore lapping: irregular wavelets that slosh against stones, glug into gaps and fizz as they recede */
export function lap(p: { choppy: number }, rng: Rng, sr: number): Rendered {
  const ch = clamp(p.choppy, 0, 1);
  const L = 12, XF = 1.0, T = L + XF;
  const out: Chans = [M(sr, T), M(sr, T)];
  const nz = new Noise(rng), nz2 = new Noise(rng);
  // low body of the lake against the shore
  {
    const lpL = new Biquad(sr).lp(260, 0.7), lpR = new Biquad(sr).lp(260, 0.7);
    const m = ctrlNoise(rng, out[0].length, sr, 0.7);
    for (let i = 0; i < out[0].length; i++) { const e = 0.03 * (0.75 + 0.25 * m[i]); out[0][i] += lpL.run(nz.brown()) * e; out[1][i] += lpR.run(nz2.brown()) * e; }
  }
  let t = rng.range(0, 0.4);
  const rate = 0.75 + 1.5 * ch;
  while (t < T - 1.2) {
    const a = rng.log(0.25, 1) * (0.55 + 0.45 * ch);
    const pc = rng.range(-0.85, 0.85);
    const pan = panGains(pc);
    const rise = rng.range(0.08, 0.22), fall = rng.range(0.25, 0.7) * (1 + 0.5 * ch);
    // slosh
    const slosh = noiseLayer(sr, rng, rise + fall + 0.1, {
      bp: [rng.range(230, 650), rng.range(0.9, 1.6)], lp: 2500, color: 'pink',
      env: (tt) => (tt < rise ? Math.sin((0.5 * Math.PI * tt) / rise) ** 2 : Math.exp(-(tt - rise) / (fall * 0.45))),
    });
    pk(slosh, a * 0.55);
    mixPan(out, slosh, Math.floor(t * sr), pan);
    // clap against a stone at the crest
    if (rng.chance(0.55)) addNoiseGrain(out, sr, rng, t + rise * rng.range(0.7, 1.1), { dur: 0.03, amp: a * 0.2, attack: 0.0006, tau: rng.range(0.003, 0.009), f: rng.range(1100, 2800), q: 1.3, pan });
    // glugs: water forced into gaps
    const ng = Math.round(rng.range(1, 3 + 9 * a));
    for (let k = 0; k < ng; k++) addBubble(out, sr, t + rise + rng.range(0, 0.35), rng.log(2, 9), a * rng.range(0.05, 0.16), rng.range(0.2, 0.8), rng.range(0.5, 1), panGains(pc + rng.sym() * 0.15));
    // recede: foam fizz + hiss
    const rl = fall * 1.3;
    const gr = grainTexture(rng, Math.ceil(sr * rl), sr, () => 900, 0.001, 0.004, 1.3);
    const fizz = noiseLayer(sr, rng, rl, { hp: rng.range(2200, 4200), lp: 9000, grain: gr, grainMix: 0.9, env: (tt) => Math.min(1, tt / 0.06) * Math.exp(-tt / (rl * 0.4)) });
    pk(fizz, a * 0.07);
    mixPan(out, fizz, Math.floor((t + rise + 0.04) * sr), pan);
    const nf = Math.round(10 + 50 * a);
    for (let k = 0; k < nf; k++) addBubble(out, sr, t + rise + rng.exp(1 / (rl * 0.35)), rng.log(0.3, 0.9), a * rng.range(0.004, 0.02), rng.range(0.1, 0.5), 1, panGains(pc + rng.sym() * 0.2));
    t += rng.exp(rate) + 0.12;
  }
  const lo = loopify(out, sr, XF);
  normRms(lo, 0.08);
  softLimit(lo, 0.9);
  return { ch: lo, sr };
}

function mixPan(out: Chans, src: Float32Array, off: number, pan: Pan) {
  for (let i = 0; i < src.length; i++) { const j = off + i; if (j < 0 || j >= out[0].length) continue; out[0][j] += src[i] * pan.l; out[1][j] += src[i] * pan.r; }
}

/** river: the babbling body of a stream (mid distance) — turbulent noise + dense mid-size bubbles, stereo */
export function riverBody(_p: unknown, rng: Rng, sr: number): Rendered {
  const L = 10, XF = 1, T = L + XF;
  const out: Chans = [M(sr, T), M(sr, T)];
  for (let c = 0; c < 2; c++) {
    const nz = new Noise(rng);
    const bp1 = new Biquad(sr).bp(420, 0.6), bp2 = new Biquad(sr).bp(1300, 0.9), lp = new Biquad(sr).lp(3500, 0.7);
    const m1 = ctrlNoise(rng, out[c].length, sr, 3), m2 = ctrlNoise(rng, out[c].length, sr, 7);
    for (let i = 0; i < out[c].length; i++) {
      const x = nz.pink() * 3;
      out[c][i] = lp.run(bp1.run(x) * (0.8 + 0.3 * m1[i]) + bp2.run(x) * 0.5 * (0.7 + 0.4 * m2[i])) * 0.5;
    }
  }
  normRms(out, 0.05);
  swarm(out, sr, rng, { t0: 0, dur: T, n: Math.round(T * 170), rMin: 1.5, rMax: 14, amp: 0.11, rise: [0.05, 0.5], panSpread: 1, rPow: 0.3 });
  const lo = loopify(out, sr, XF);
  normRms(lo, 0.1); softLimit(lo, 0.9);
  return { ch: lo, sr };
}

/** river close-up: rapids detail — small splashes, gurgles, spray hiss, standing-wave surges, stereo */
export function riverDetail(_p: unknown, rng: Rng, sr: number): Rendered {
  const L = 10, XF = 1, T = L + XF;
  const out: Chans = [M(sr, T), M(sr, T)];
  // spray hiss with granular AM, decorrelated L/R
  for (let c = 0; c < 2; c++) {
    const gr = grainTexture(rng, out[c].length, sr, () => 1800, 0.0008, 0.004, 1.2);
    const hiss = noiseLayer(sr, rng, T, { hp: 2500, lp: 11000, grain: gr, grainMix: 0.8, env: () => 1 });
    normRms([hiss], 0.03);
    for (let i = 0; i < hiss.length && i < out[c].length; i++) out[c][i] += hiss[i];
  }
  // splashes: lots of small crowns
  let t = 0;
  while (t < T - 0.4) {
    const s = Math.pow(rng.next(), 2.5) * 0.45;
    const sp = splash({ size: s }, rng, sr).ch[0];
    mixPan(out, sp, Math.floor(t * sr), panGains(rng.range(-0.9, 0.9)));
    // scale: splash() is peak-normalized; distribute amplitude
    t += rng.exp(4);
  }
  normRms(out, 0.06);
  // dense small bubbles + gurgling clusters
  swarm(out, sr, rng, { t0: 0, dur: T, n: Math.round(T * 550), rMin: 0.5, rMax: 5, amp: 0.06, rise: [0.1, 0.9], panSpread: 1 });
  for (let k = 0; k < T * 4; k++) {
    const tc = rng.range(0, T - 0.3); const pc = rng.range(-0.9, 0.9);
    for (let j = 0; j < 8; j++) addBubble(out, sr, tc + rng.range(0, 0.08), rng.log(3, 10), 0.06 * rng.log(0.3, 1), rng.range(0.4, 1.2), 0.7, panGains(pc));
  }
  const lo = loopify(out, sr, XF);
  normRms(lo, 0.1); softLimit(lo, 0.9);
  return { ch: lo, sr };
}

/** waterfall roar (mono, positional): pounding low thunder + broadband impact splatter + huge bubble swarm */
export function fallsRoar(_p: unknown, rng: Rng, sr: number): Rendered {
  const L = 9, XF = 1, T = L + XF;
  const a = M(sr, T);
  const nz = new Noise(rng);
  // broadband impact roar (fairly flat 150 Hz - 6 kHz) with fast splattery grain, plus a modest pounding low end
  const lp = new Biquad(sr).lp(150, 0.8), hpl = new Biquad(sr).hp(30, 0.7);
  const hpB = new Biquad(sr).hp(160, 0.6), lpB = new Biquad(sr).lp(7500, 0.6), pkB = new Biquad(sr).peak(900, 0.7, 3);
  const pound = ctrlNoise(rng, a.length, sr, 5), slow = ctrlNoise(rng, a.length, sr, 0.6);
  const gr = grainTexture(rng, a.length, sr, () => 3000, 0.001, 0.006, 1.1);
  for (let i = 0; i < a.length; i++) {
    const thunder = hpl.run(lp.run(nz.brown())) * (0.75 + 0.35 * pound[i]);
    const body = pkB.run(lpB.run(hpB.run(nz.white()))) * (0.45 + 0.55 * gr[i]) * (0.9 + 0.1 * slow[i]);
    a[i] = thunder * 0.12 + body * 1.0;
  }
  normRms([a], 0.08);
  swarm([a], sr, rng, { t0: 0, dur: T, n: Math.round(T * 450), rMin: 0.8, rMax: 12, amp: 0.08, rise: [0.05, 0.6], rPow: 0.25 });
  {
    const g2 = grainTexture(rng, a.length, sr, () => 2500, 0.0006, 0.003, 1.2);
    const hiss = noiseLayer(sr, rng, T, { hp: 2800, lp: 12000, grain: g2, grainMix: 0.7, env: () => 1 });
    normRms([hiss], 0.045);
    for (let i = 0; i < a.length; i++) a[i] += hiss[i];
  }
  const lo = loopify([a], sr, XF);
  normRms(lo, 0.12); softLimit(lo, 0.9);
  return { ch: lo, sr };
}

/** waterfall mist: fine spray hiss and droplet rain (stereo, diffuse) */
export function fallsMist(_p: unknown, rng: Rng, sr: number): Rendered {
  const L = 8, XF = 1, T = L + XF;
  const out: Chans = [M(sr, T), M(sr, T)];
  for (let c = 0; c < 2; c++) {
    const gr = grainTexture(rng, out[c].length, sr, () => 2500, 0.0006, 0.003, 1.2);
    const h = noiseLayer(sr, rng, T, { hp: 3500, lp: 14000, grain: gr, grainMix: 0.7, env: () => 1 });
    for (let i = 0; i < h.length && i < out[c].length; i++) out[c][i] += h[i];
  }
  normRms(out, 0.05);
  for (let k = 0; k < T * 180; k++) {
    const t = rng.range(0, T - 0.05); const pan = panGains(rng.sym());
    addTick(out, sr, rng, t, 0.06 * rng.log(0.2, 1), 3500, 0.5, pan);
  }
  const lo = loopify(out, sr, XF);
  normRms(lo, 0.08); softLimit(lo, 0.9);
  return { ch: lo, sr };
}

/** underwater bed: low pressure rumble, distant muffled bubbling (rendered at low sample rate) */
export function underwaterBed(_p: unknown, rng: Rng, sr: number): Rendered {
  const L = 9, XF = 1, T = L + XF;
  const out: Chans = [M(sr, T), M(sr, T)];
  for (let c = 0; c < 2; c++) {
    const nz = new Noise(rng);
    const lp = new Biquad(sr).lp(220, 0.9), lp2 = new Biquad(sr).lp(900, 0.7);
    const m = ctrlNoise(rng, out[c].length, sr, 0.4);
    for (let i = 0; i < out[c].length; i++) out[c][i] = lp.run(nz.brown()) * (0.8 + 0.2 * m[i]) + lp2.run(nz.white()) * 0.01;
    dcBlock(out[c], 15, sr);
  }
  normRms(out, 0.07);
  for (let k = 0; k < 7; k++) {
    const tc = rng.range(0, T - 1); const pc = rng.sym() * 0.8;
    const b: Chans = [M(sr, T), M(sr, T)];
    swarm(b, sr, rng, { t0: tc, n: rng.int(6, 20), decay: 0.3, rMin: 2, rMax: 10, amp: 0.25, rise: [0.5, 1.3], damp: 0.6, panCenter: pc, panSpread: 0.2 });
    for (let c = 0; c < 2; c++) { const lp = new Biquad(sr).lp(1200, 0.7); lp.apply(b[c]); for (let i = 0; i < b[c].length; i++) out[c][i] += b[c][i]; }
  }
  const lo = loopify(out, sr, XF);
  normRms(lo, 0.1); softLimit(lo, 0.9);
  return { ch: lo, sr };
}

/** held water: gurgling (clusters of mid bubbles) — mono loop */
export function gurgle(_p: unknown, rng: Rng, sr: number): Rendered {
  const L = 7, XF = 0.6, T = L + XF;
  const a = [M(sr, T)];
  let t = 0;
  while (t < T - 0.2) {
    const n = rng.int(3, 12); const rc = rng.log(2.2, 9);
    for (let k = 0; k < n; k++) addBubble(a, sr, t + rng.range(0, 0.07), rc * rng.range(0.6, 1.5), rng.log(0.25, 1), rng.range(0.3, 1.2), rng.range(0.5, 0.9));
    t += rng.exp(9);
  }
  swarm(a, sr, rng, { t0: 0, dur: T, n: Math.round(T * 160), rMin: 0.8, rMax: 4, amp: 0.35, rise: [0.1, 0.6] });
  // low churn
  const nz = new Noise(rng); const lp = new Biquad(sr).lp(380, 0.9); const m = ctrlNoise(rng, a[0].length, sr, 4);
  const churn = new Float32Array(a[0].length);
  for (let i = 0; i < churn.length; i++) churn[i] = lp.run(nz.brown()) * (0.6 + 0.4 * m[i]);
  normRms([churn], 0.05);
  normRms(a, 0.07);
  addArr(a[0], churn, 1);
  const lo = loopify(a, sr, XF);
  normRms(lo, 0.1); softLimit(lo, 0.9);
  return { ch: lo, sr };
}

/** held water: sloshing mass (slow heavy swells with big glugs) — mono loop */
export function slosh(_p: unknown, rng: Rng, sr: number): Rendered {
  const L = 8, XF = 0.8, T = L + XF;
  const a = M(sr, T);
  let t = 0;
  while (t < T - 0.5) {
    const len = rng.range(0.3, 0.8); const rise = len * rng.range(0.25, 0.5);
    const amp = rng.log(0.35, 1);
    const sl = noiseLayer(sr, rng, len, {
      bp: [rng.range(200, 560), rng.range(1, 2)], lp: 2200, color: 'pink',
      env: (tt) => (tt < rise ? Math.sin((0.5 * Math.PI * tt) / rise) ** 2 : Math.exp(-(tt - rise) / ((len - rise) * 0.4))),
    });
    pk(sl, amp);
    addArr(a, sl, 1, Math.floor(t * sr));
    const b = [a];
    for (let k = 0; k < rng.int(1, 5); k++) addBubble(b, sr, t + rise + rng.range(0, 0.2), rng.log(5, 16), amp * 0.35, rng.range(0.4, 1.1), 0.5);
    t += rng.exp(2.2) + 0.12;
  }
  const lo = loopify([a], sr, XF);
  normRms(lo, 0.1); softLimit(lo, 0.9);
  return { ch: lo, sr };
}

/** swirl / stream: a continuous rushing ribbon of water (granular band noise + quick bubbles) — mono loop */
export function stream(_p: unknown, rng: Rng, sr: number): Rendered {
  const L = 6, XF = 0.6, T = L + XF;
  const gr = grainTexture(rng, Math.ceil(sr * T), sr, () => 1500, 0.0015, 0.007, 1.2);
  const m = ctrlNoise(rng, gr.length, sr, 2.5);
  const a = noiseLayer(sr, rng, T, { hp: 300, bp: [1100, 0.45], lp: 7000, grain: gr, grainMix: 0.75, env: (t) => 0.8 + 0.2 * m[Math.min(m.length - 1, Math.floor(t * sr))] });
  normRms([a], 0.07);
  swarm([a], sr, rng, { t0: 0, dur: T, n: Math.round(T * 420), rMin: 0.6, rMax: 5, amp: 0.12, rise: [0.1, 0.8] });
  const lo = loopify([a], sr, XF);
  normRms(lo, 0.1); softLimit(lo, 0.9);
  return { ch: lo, sr };
}

/** noise loops for realtime filtering */
export function noiseLoop(p: { color: 'white' | 'pink' | 'brown'; secs?: number }, rng: Rng, sr: number): Rendered {
  const L = p.secs ?? 6, XF = 0.3;
  const a = M(sr, L + XF);
  const nz = new Noise(rng);
  for (let i = 0; i < a.length; i++) a[i] = p.color === 'white' ? nz.white() * 0.5 : p.color === 'pink' ? nz.pink() * 1.6 : nz.brown();
  if (p.color === 'brown') { dcBlock(a, 18, sr); dcBlock(a, 18, sr); }
  const lo = loopify([a], sr, XF);
  normRms(lo, 0.25);
  return { ch: lo, sr };
}

// ------------------------------------------------------------------ under water

/** going under: the dull thump of the body hitting the water, a whoosh sinking in pitch, the rush of air dragged down
 *  with it — a swarm of bubbles, a few big glugs — all heard from inside the water (no air-borne crack) */
export function plunge(_p: unknown, rng: Rng, sr: number): Rendered {
  const D = 2.0;
  const out: Chans = [M(sr, D), M(sr, D)];
  // thump
  const th = M(sr, 0.6);
  let ph = 0;
  for (let i = 0; i < th.length; i++) { const t = i / sr; ph += (38 + 30 * Math.exp(-t / 0.08)) / sr; th[i] = fsin(ph) * Math.min(1, t / 0.006) * Math.exp(-t / 0.18); }
  // whoosh: noise through a band sliding down
  const wh = M(sr, 0.9);
  const nz = new Noise(rng);
  const bp = new Biquad(sr), lp = new Biquad(sr);
  for (let i = 0; i < wh.length; i++) {
    const t = i / sr;
    if ((i & 31) === 0) { const f = 260 + 1100 * Math.exp(-t / 0.22); bp.bp(f, 0.9); lp.lp(f * 2.2, 0.7); }
    wh[i] = lp.run(bp.run(nz.pink() * 2.5)) * (t < 0.04 ? t / 0.04 : Math.exp(-(t - 0.04) / 0.28));
  }
  pk(wh);
  // the rush of bubbles, then a few big glugs rising past
  const bub: Chans = [M(sr, D), M(sr, D)];
  swarm(bub, sr, rng, { t0: 0.02, n: 220, decay: 0.32, rMin: 1.0, rMax: 9, amp: 1, rise: [0.2, 0.9], damp: 0.6, panSpread: 0.9 });
  for (let k = 0; k < 5; k++) addBubble(bub, sr, 0.12 + rng.range(0, 0.6), rng.log(9, 20), 0.7 * rng.range(0.5, 1), rng.range(0.8, 1.4), 0.5, panGains(rng.sym() * 0.6));
  for (const c of bub) new Biquad(sr).lp(3200, 0.7).apply(c);
  normPeak(bub, 1);
  for (let c = 0; c < 2; c++) {
    addArr(out[c], th, 0.55);
    addArr(out[c], wh, 0.42, Math.floor(sr * 0.01));
    addArr(out[c], bub[c], 0.5);
  }
  normPeak(out, 0.9);
  return { ch: finish(out, sr), sr };
}

/** coming up for air: a calm, open-mouthed breath in — breathy noise shaped by a mouth formant that opens as it goes */
export function breath(_p: unknown, rng: Rng, sr: number): Rendered {
  const D = rng.range(0.7, 0.95);
  const out = M(sr, D + 0.1);
  const nz = new Noise(rng);
  const f1 = new Biquad(sr), f2 = new Biquad(sr), hp = new Biquad(sr).hp(280, 0.7), air = new Biquad(sr).hp(3800, 0.7);
  const a0 = rng.range(0.16, 0.24), hold = rng.range(0.08, 0.16);
  const fA = rng.range(800, 1000), fB = rng.range(1150, 1400);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const u = Math.min(1, t / (a0 + hold + 0.2));
    if ((i & 31) === 0) { f1.bp(fA + (fB - fA) * u, 1.6); f2.bp(2300 + 500 * u, 2.2); }
    const x = nz.pink() * 2.5;
    const v = f1.run(x) * 0.9 + f2.run(x) * 0.45 + air.run(x) * 0.12;
    const env = t < a0 ? Math.sin((0.5 * Math.PI * t) / a0) ** 2 : t < a0 + hold ? 1 : Math.exp(-(t - a0 - hold) / 0.16);
    out[i] = hp.run(v) * env;
  }
  pk(out, 0.6);
  return { ch: finish([out], sr), sr };
}

/** a soft knock from somewhere in the lake: a stone settling, a pebble tumbling down a slope — a few low inharmonic
 *  partials behind a muffled tap */
export function uwKnock(_p: unknown, rng: Rng, sr: number): Rendered {
  const out = [M(sr, 1.6)];
  const f = rng.log(140, 320);
  const n = rng.int(1, 3);
  for (let k = 0; k < n; k++) {
    const t = k * rng.range(0.07, 0.18);
    addModal(out, sr, t, [[f, 1, 0.45], [f * 2.31, 0.45, 0.25], [f * 3.9, 0.2, 0.12], [f * 0.53, 0.3, 0.6]], (k ? 0.5 : 1) * rng.range(0.7, 1), undefined, 1.5);
    addNoiseGrain(out, sr, rng, t, { dur: 0.03, amp: 0.25, attack: 0.002, tau: 0.008, f: f * 3, q: 0.8, type: 'bp' });
  }
  new Biquad(sr).lp(1400, 0.7).apply(out[0]);
  normPeak(out, 0.8);
  return { ch: finish(out, sr), sr };
}

/** the lake's slow breathing heard from inside it: soft surges of distant water moving (wavelets on the surface, the
 *  far shore), and the faint fizz of tiny bubbles far off — a stereo loop */
export function uwSwell(_p: unknown, rng: Rng, sr: number): Rendered {
  const L = 14, XF = 1.5, T = L + XF;
  const out: Chans = [M(sr, T), M(sr, T)];
  for (let c = 0; c < 2; c++) {
    const nz = new Noise(rng);
    const bp = new Biquad(sr).bp(rng.range(260, 340), 0.7), lp = new Biquad(sr).lp(700, 0.7);
    const sw = ctrlNoise(rng, out[c].length, sr, 0.22);
    const sw2 = ctrlNoise(rng, out[c].length, sr, 0.6);
    for (let i = 0; i < out[c].length; i++) {
      const g = spow(0.5 + 0.5 * sw[i], 1.6) * (0.75 + 0.25 * sw2[i]);
      out[c][i] = lp.run(bp.run(nz.pink() * 2.5)) * g;
    }
  }
  normRms(out, 0.06);
  const fz: Chans = [M(sr, T), M(sr, T)];
  swarm(fz, sr, rng, { t0: 0, dur: T, n: Math.round(T * 25), rMin: 0.9, rMax: 2.5, amp: 0.12, rise: [0.1, 0.5], panSpread: 1 });
  for (const c of fz) new Biquad(sr).lp(3000, 0.7).apply(c);
  for (let c = 0; c < 2; c++) addArr(out[c], fz[c], 1);
  const lo = loopify(out, sr, XF);
  normRms(lo, 0.08); softLimit(lo, 0.9);
  return { ch: lo, sr };
}
