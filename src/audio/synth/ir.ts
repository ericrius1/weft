// Procedural impulse responses: frequency-dependent decaying noise (3 bands with their own T60), sparse early
// reflections, and discrete diffuse "cliff" echo blobs for the mountain valley.
import { Biquad, Chans, OnePole, Rendered, Rng, clamp, normPeak } from './dsp';

interface TailOpts { secs: number; t60: [number, number, number]; pre: number; early?: number; earlySpan?: number; density?: number; hp?: number; lp?: number; gain?: number }

function tail(rng: Rng, sr: number, o: TailOpts): Chans {
  const n = Math.ceil(o.secs * sr);
  const out: Chans = [new Float32Array(n), new Float32Array(n)];
  const pre = Math.floor(o.pre * sr);
  for (let c = 0; c < 2; c++) {
    const lo = new OnePole(sr, 450), hi = new OnePole(sr, 3800);
    const d = out[c];
    const dl = Math.exp(Math.log(0.001) / (o.t60[0] * sr)), dm = Math.exp(Math.log(0.001) / (o.t60[1] * sr)), dh = Math.exp(Math.log(0.001) / (o.t60[2] * sr));
    let el = 1, em = 1, eh = 1;
    const fadeIn = Math.floor(sr * 0.03);
    for (let i = pre; i < n; i++) {
      const w = rng.sym();
      const l = lo.lp(w); const hh = hi.hp(w); const m = w - l - hh;
      const k = i - pre;
      const fi = k < fadeIn ? k / fadeIn : 1;
      d[i] = (l * el * 0.9 + m * em + hh * eh * 0.8) * fi;
      el *= dl; em *= dm; eh *= dh;
    }
    // early reflections (ground, trees, nearby rocks)
    const ne = o.early ?? 0;
    for (let k = 0; k < ne; k++) {
      const t = 0.004 + Math.pow(rng.next(), 1.5) * (o.earlySpan ?? 0.08);
      const i = Math.floor(t * sr); if (i >= n) continue;
      d[i] += rng.sym() * 0.9 * Math.exp(-t / 0.08) * (o.density ?? 1);
    }
  }
  if (o.hp) for (const c of out) new Biquad(sr).hp(o.hp, 0.7).apply(c);
  if (o.lp) for (const c of out) new Biquad(sr).lp(o.lp, 0.7).apply(c);
  return out;
}

/** diffuse echo blob (a rough cliff face returns a smeared, darkened copy) */
function blob(out: Chans, sr: number, rng: Rng, t: number, gain: number, spread: number, lp: number, pan: number) {
  const n = Math.ceil(spread * sr);
  const s0 = Math.floor(t * sr);
  const gl = Math.cos((pan + 1) * 0.25 * Math.PI), gr = Math.sin((pan + 1) * 0.25 * Math.PI);
  for (let c = 0; c < 2; c++) {
    const f = new Biquad(sr).lp(lp, 0.7), h = new Biquad(sr).hp(260, 0.6);
    const g = (c === 0 ? gl : gr) * gain;
    for (let i = 0; i < n + 400; i++) {
      const u = i / n;
      const e = i < n ? Math.sin(Math.PI * Math.min(1, u * 3)) ** 2 * Math.exp(-u * 3) : 0;
      const j = s0 + i; if (j >= out[c].length) break;
      out[c][j] += h.run(f.run(rng.sym() * e)) * g;
    }
  }
}

export function ir(p: { kind: 'valley' | 'forest' | 'echoLake' | 'echoRiver' | 'hall' }, rng: Rng, sr: number): Rendered {
  let out: Chans;
  switch (p.kind) {
    case 'valley':
      // open alpine valley: sparse early field, long soft tail that darkens quickly
      out = tail(rng, sr, { secs: 4.8, t60: [3.3, 3.0, 1.4], pre: 0.03, early: 14, earlySpan: 0.12, hp: 150, lp: 7000 });
      break;
    case 'forest':
      // dense scattering from trunks; short, damped highs
      out = tail(rng, sr, { secs: 2.4, t60: [1.6, 1.4, 0.7], pre: 0.008, early: 60, earlySpan: 0.07, density: 0.6, hp: 150, lp: 8000 });
      break;
    case 'hall':
      out = tail(rng, sr, { secs: 4.0, t60: [3.0, 2.8, 1.8], pre: 0.025, early: 20, earlySpan: 0.06, hp: 90, lp: 9500 });
      break;
    case 'echoLake': {
      const n = Math.ceil(3.2 * sr); out = [new Float32Array(n), new Float32Array(n)];
      const taps: [number, number, number, number][] = [[0.42, 1, 4200, -0.65], [0.74, 0.7, 3200, 0.6], [1.18, 0.5, 2400, -0.2], [1.71, 0.33, 1800, 0.35], [2.35, 0.2, 1300, -0.5]];
      for (const [t, g, lp, pan] of taps) blob(out, sr, rng, t * rng.range(0.97, 1.03), g, 0.05 + 0.03 * t, lp, pan);
      break;
    }
    case 'echoRiver': {
      const n = Math.ceil(1.6 * sr); out = [new Float32Array(n), new Float32Array(n)];
      for (const [t, g, lp, pan] of [[0.19, 1, 3500, 0.5], [0.53, 0.45, 2200, -0.5], [0.9, 0.2, 1500, 0.2]] as [number, number, number, number][]) blob(out, sr, rng, t, g, 0.06, lp, pan);
      break;
    }
  }
  // energy-normalize so convolver output level is predictable (convolver normalize=false)
  let e = 0; for (const c of out) for (let i = 0; i < c.length; i++) e += c[i] * c[i];
  const g = clamp(1 / Math.sqrt(e / 2 + 1e-12), 0, 100) * 0.5;
  for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= g;
  void normPeak;
  return { ch: out, sr };
}
