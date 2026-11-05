// The film's settings (shaders/film.wgsl, `#include "loom/film"`) by name, as numbers so two can be mixed (mixFilm: one
// place's look toward another's as a view goes from one to the other), and packed into its uniform (filmFields). A bloom
// chain feeding it takes its levels' weights and its first level's settings from here too (bloomWeight, bloomEven, the
// knee).

export interface Film {
  /** exposure; bloom's share mixed in, bloom added, bloom's normaliser (on its summed levels); each wider level's
   *  weight going up the chain (1 even, more a wider glow) */
  exposure: number; bloomShare: number; bloomAdd: number; bloomNorm: number; bloomWeight: number;
  /** the bloom's first level against fireflies: its taps' groups averaged weighted by their brightness (1: an even field
   *  kept as it is), or their average compressed (0); and how much it keeps only what's bright (its soft knee, from
   *  kneeLo to kneeHi at the brightest channel) */
  bloomEven: number; knee: number; kneeLo: number; kneeHi: number;
  /** the glow on what's brighter than its knee (film units), film's red halation round highlights */
  glow: number; glowFrom: number; halation: number;
  /** white balance (+ warm), AgX's punch (0 base .. 1 punchy), saturation in the look and after it */
  warmth: number; punch: number; saturation: number; saturationAfter: number;
  /** contrast round mid-grey and its toe (0 straight, 1 soft); the screen's power (1/2.2, or 1: AgX's own curve) */
  contrast: number; toe: number; power: number;
  /** vignettes (round, quadratic), the fixed dither (255ths), grain, and how much it keeps to the mids (0 even, 1 film's:
   *  little in the shadows and the highlights) */
  vignette: number; vignetteQ: number; dither: number; grain: number; grainMids: number;
  /** the time-of-day grade: strength, the warm-cool split, the reds' richness; where the sun is (0..1 each: golden hour,
   *  dusk, noon, night) and the cloud cover */
  grade: number; split: number; rich: number; golden: number; dusk: number; noon: number; night: number; cover: number;
}

/** a's settings toward b's by t (0..1) (any b lacks, a's) */
export function mixFilm(a: Film, b: Film, t: number): Film {
  const o = { ...a };
  for (const k of Object.keys(a) as (keyof Film)[]) o[k] = a[k] + ((b[k] ?? a[k]) - a[k]) * t;
  // (the bloom's knee by how much bloom each adds: the one bloom, kneed so, is the two mixed — it's linear in the knee —
  // where a plain mix would let the one adding more glow on everything)
  const wa = (1 - t) * (a.bloomAdd + a.bloomShare), wb = t * ((b.bloomAdd ?? a.bloomAdd) + (b.bloomShare ?? a.bloomShare));
  if (wa + wb > 0) o.knee = (wa * a.knee + wb * (b.knee ?? a.knee)) / (wa + wb);
  return o;
}

/** the film uniform's fields (film.wgsl FilmU) for these settings, `alpha` and the target's kind (`levels`: the bloom
 *  chain's, for its gain over an even field) */
export function filmFields(f: Film, alpha: number, encode: boolean, disc: boolean, levels = 6) {
  let sum = 0;
  for (let i = 0, w = 1; i < levels; i++, w *= f.bloomWeight) sum += w;
  return {
    a: [f.exposure, f.bloomShare, f.bloomAdd, f.bloomNorm], glow: [f.glow, f.glowFrom, f.halation, f.bloomNorm * sum],
    look: [f.warmth, f.punch, f.saturation, f.saturationAfter], tone: [f.contrast, f.toe, f.power, f.grain],
    vig: [f.vignette, f.vignetteQ, f.dither, f.grainMids], grade: [f.grade, f.split, f.rich, f.night],
    sun: [f.golden, f.dusk, f.noon, f.cover], out: [alpha, encode ? 1 : 0, disc ? 1 : 0, 0],
  };
}
