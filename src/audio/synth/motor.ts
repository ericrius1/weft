// Engines and tyres (rendered in the synth worker with the rest of the bank): a four-cylinder rally engine at a base
// revs (a loop — the game plays it faster for higher revs: its firing pitch, harmonics, intake rasp, the exhaust's
// burble), a load layer (the snarl under throttle), tyre squeal, the hiss of tyres through standing water, rain
// drumming on a car's roof, a gearshift's clunk, a backfire's pop.
import { Biquad, Chans, Noise, Rendered, Rng, finish, fsin, loopify, normPeak } from './dsp';

const M = (sr: number, secs: number) => new Float32Array(Math.max(16, Math.ceil(sr * secs)));
const st = (sr: number, secs: number): Chans => [M(sr, secs), M(sr, secs)];

/** the engine at ~3000 rpm (a four-stroke four fires twice a turn: 100 Hz); `load` 1 for the snarl under throttle */
export function engineLoop(p: { load?: number }, rng: Rng, sr: number): Rendered {
  const load = p.load ?? 0;
  const D = 2, XF = 0.2;
  const ch = st(sr, D + XF);
  const nz = new Noise(rng);
  const f0 = 100;
  const intake = new Biquad(sr).bp(1600, 1.4), body = new Biquad(sr).lp(1400, 0.8), rasp = new Biquad(sr).bp(3200, 2);
  let ph = 0;
  // (each cylinder's firing a little uneven: the burble)
  const jit = Array.from({ length: 4 }, () => 0.85 + rng.next() * 0.3);
  for (let i = 0; i < ch[0].length; i++) {
    const t = i / sr;
    ph += f0 / sr;
    const cyc = ph % 1, k = Math.floor(ph) % 4;
    // a pulse per firing (sharp rise, quick decay), then the harmonics it rings through
    const pulse = Math.exp(-cyc * 9) * jit[k];
    let tone = 0;
    for (let h = 1; h <= 8; h++) tone += fsin(ph * h + h * 0.13) / (h * (1 + load * 0.2 * (8 - h)));
    let v = body.run(pulse * 1.4 + tone * 0.35) + intake.run(nz.white()) * (0.05 + load * 0.12) * (0.6 + 0.4 * pulse);
    if (load > 0) v += rasp.run(nz.white() * pulse) * 0.25 * load + Math.tanh(tone * 1.8) * 0.18 * load;
    v *= 0.9 + 0.1 * Math.sin(t * 7.1);
    ch[0][i] = v; ch[1][i] = v * 0.97;
  }
  normPeak(ch, 0.7);
  return { ch: loopify(ch, sr, XF), sr };
}

/** tyres at the limit: a howl of a few close tones over a band of noise (looped) */
export function squealLoop(_p: object, rng: Rng, sr: number): Rendered {
  const D = 2, XF = 0.2;
  const ch = st(sr, D + XF);
  const nz = new Noise(rng);
  const bp = new Biquad(sr).bp(1100, 3), bp2 = new Biquad(sr).bp(1800, 4);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < ch[0].length; i++) {
    const t = i / sr;
    const wob = 1 + 0.02 * Math.sin(t * 13) + 0.015 * Math.sin(t * 29);
    a += (980 * wob) / sr; b += (1310 * wob) / sr; c += (1720 * wob) / sr;
    const v = (fsin(a) * 0.3 + fsin(b) * 0.22 + fsin(c) * 0.12) * (0.7 + 0.3 * Math.sin(t * 41)) + bp.run(nz.white()) * 0.25 + bp2.run(nz.white()) * 0.12;
    ch[0][i] = v; ch[1][i] = v;
  }
  normPeak(ch, 0.6);
  return { ch: loopify(ch, sr, XF), sr };
}

/** tyres through standing water: a broad hiss with a low rush (looped) */
export function sprayLoop(_p: object, rng: Rng, sr: number): Rendered {
  const D = 3, XF = 0.3;
  const ch = st(sr, D + XF);
  const nz = new Noise(rng);
  const hpL = new Biquad(sr).hp(900, 0.6), hpR = new Biquad(sr).hp(900, 0.6), lo = new Biquad(sr).lp(300, 0.7);
  for (let i = 0; i < ch[0].length; i++) {
    const t = i / sr;
    const sw = 0.75 + 0.25 * Math.sin(t * 3.1) * Math.sin(t * 1.7);
    const low = lo.run(nz.pink()) * 0.5;
    ch[0][i] = hpL.run(nz.white()) * 0.5 * sw + low; ch[1][i] = hpR.run(nz.white()) * 0.5 * sw + low;
  }
  normPeak(ch, 0.55);
  return { ch: loopify(ch, sr, XF), sr };
}

/** rain on a car's roof and screen: a dense patter of little ticks over a hiss (looped) */
export function roofRain(_p: object, rng: Rng, sr: number): Rendered {
  const D = 3, XF = 0.3;
  const ch = st(sr, D + XF);
  const nz = new Noise(rng);
  const hs = new Biquad(sr).bp(5000, 0.8);
  for (let i = 0; i < ch[0].length; i++) { const h = hs.run(nz.white()) * 0.08; ch[0][i] = h; ch[1][i] = h; }
  const n = Math.floor(D * 900);
  for (let k = 0; k < n; k++) {
    const t0 = rng.next() * D, f = 1800 + rng.next() * 3500, amp = 0.05 + rng.next() * 0.12, pan = rng.next();
    const s0 = Math.floor(t0 * sr), len = Math.floor(sr * 0.008);
    for (let j = 0; j < len && s0 + j < ch[0].length; j++) {
      const v = Math.sin((j / sr) * f * Math.PI * 2) * Math.exp(-j / (len * 0.25)) * amp;
      ch[0][s0 + j] += v * (1 - pan); ch[1][s0 + j] += v * pan;
    }
  }
  normPeak(ch, 0.5);
  return { ch: loopify(ch, sr, XF), sr };
}

/** a gearshift: a mechanical clunk and the revs' breath */
export function gearShift(_p: object, rng: Rng, sr: number): Rendered {
  const D = 0.25;
  const ch = st(sr, D);
  const nz = new Noise(rng);
  const bp = new Biquad(sr).bp(900, 2);
  for (let i = 0; i < ch[0].length; i++) {
    const t = i / sr;
    const v = bp.run(nz.white()) * Math.exp(-t * 60) * 0.8 + fsin(t * 140) * Math.exp(-t * 40) * 0.5;
    ch[0][i] = v; ch[1][i] = v;
  }
  normPeak(ch, 0.6);
  return { ch: finish(ch, sr), sr };
}

/** a backfire: a pop from the exhaust, a little crackle after */
export function backfire(_p: object, rng: Rng, sr: number): Rendered {
  const D = 0.4;
  const ch = st(sr, D);
  const nz = new Noise(rng);
  const lp = new Biquad(sr).lp(2500, 0.7);
  let ph = 0;
  for (let i = 0; i < ch[0].length; i++) {
    const t = i / sr;
    ph += (90 * Math.exp(-t * 20) + 40) / sr;
    const pop = fsin(ph) * Math.exp(-t * 35) * 0.9 + lp.run(nz.white()) * Math.exp(-t * 50) * 0.8;
    const crackle = (rng.next() < 0.004 ? 1 : 0) * Math.exp(-t * 8) * (rng.next() - 0.5) * 2;
    const v = pop + crackle * 0.5;
    ch[0][i] = v; ch[1][i] = v * 0.9;
  }
  normPeak(ch, 0.8);
  return { ch: finish(ch, sr), sr };
}
