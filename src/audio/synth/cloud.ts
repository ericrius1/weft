// Clouds: water drawn out of a cloud — mist condensing into drops, heard as a glassy shimmer (src/audio/clouds.ts).
import type { Rendered, Rng } from './dsp';
import { Biquad, Noise, addModal, addTick, ctrlNoise, finish, loopify, normPeak, normRms, softLimit } from './dsp';

const M = (sr: number, secs: number) => new Float32Array(Math.max(16, Math.ceil(sr * secs)));
/** a tiny glassy "tink": a droplet forming — two inharmonic partials, a few tens of ms */
function tink(a: Float32Array[], sr: number, rng: Rng, t: number, amp: number) {
  const f = rng.log(2600, 8200);
  addModal(a, sr, t, [[f, 1, rng.range(0.03, 0.11)], [f * rng.range(2.4, 2.9), 0.35, rng.range(0.02, 0.05)]], amp, undefined, 0.6);
}

/** condensation (mono loop): a dense, soft sparkle of droplets forming over a breathy hiss, gently swelling */
export function condense(_p: unknown, rng: Rng, sr: number): Rendered {
  const L = 5, XF = 0.5, T = L + XF;
  const a = M(sr, T);
  const ch = [a];
  // the sparkle: droplets forming at a wandering rate (~25..70 a second), soft and hard ones
  const rate = ctrlNoise(rng, a.length, sr, 0.6);
  let t = 0;
  while (t < T) {
    const r = 45 + 25 * rate[Math.min(a.length - 1, Math.floor(t * sr))];
    t += rng.exp(r);
    tink(ch, sr, rng, t, rng.log(0.04, 0.35));
    if (rng.chance(0.12)) addTick(ch, sr, rng, t, rng.log(0.02, 0.08), 5200, 0.8);
  }
  // the breath of the mist: band-passed air, slowly moving
  const nz = new Noise(rng), bp = new Biquad(sr), hp = new Biquad(sr).hp(1800, 0.6);
  const m = ctrlNoise(rng, a.length, sr, 0.4);
  for (let i = 0; i < a.length; i++) {
    if ((i & 63) === 0) bp.bp(3600 + 1400 * m[i], 0.7);
    a[i] += bp.run(hp.run(nz.white())) * 0.05 * (0.75 + 0.25 * m[i]);
  }
  const lo = loopify(ch, sr, XF);
  normRms(lo, 0.09); softLimit(lo, 0.9);
  return { ch: lo, sr };
}

/** a cloud giving up its water (one-shot): a soft rising breath and a cascade of drops quickening into a glassy swell */
export function cloudShimmer(_p: unknown, rng: Rng, sr: number): Rendered {
  const D = 2.2;
  const a = M(sr, D);
  const ch = [a];
  // the cascade: drops quickening, then thinning out
  let t = 0.02;
  while (t < D - 0.3) {
    const u = t / D;
    t += rng.exp(18 + 120 * Math.sin(Math.PI * Math.min(1, u * 1.4)) ** 2);
    tink(ch, sr, rng, t, rng.log(0.05, 0.4) * (1 - 0.6 * u));
  }
  // a faint high chord that rings out of it (open fifths, an octave apart)
  const f0 = rng.pick([1568, 1760, 2093]);
  for (const [r, g] of [[1, 0.06], [1.5, 0.045], [2, 0.03], [3, 0.015]] as [number, number][]) {
    addModal(ch, sr, 0.35 + rng.range(0, 0.15), [[f0 * r * rng.range(0.998, 1.002), g, 1.6]], 1, undefined, 60);
  }
  // the breath: air drawn in, rising in pitch
  const nz = new Noise(rng), bp = new Biquad(sr);
  for (let i = 0; i < a.length; i++) {
    const u = i / a.length;
    if ((i & 31) === 0) bp.bp(900 * Math.pow(4.5, u), 0.9);
    a[i] += bp.run(nz.white()) * 0.16 * Math.sin(Math.PI * Math.min(1, u * 1.6)) ** 1.5;
  }
  normPeak(ch, 0.8);
  return { ch: finish(ch, sr, { fadeMs: 120 }), sr };
}
