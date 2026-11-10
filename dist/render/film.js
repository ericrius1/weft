// The film's settings (shaders/film.wgsl, `#include "loom/film"`) by name, as numbers so two can be mixed (mixFilm: one
// place's look toward another's as a view goes from one to the other), and packed into its uniform (filmFields). A bloom
// chain feeding it takes its levels' weights and its first level's settings from here too (bloomWeight, bloomEven, the
// knee).
/** a's settings toward b's by t (0..1) (any b lacks, a's) */
export function mixFilm(a, b, t) {
    const o = { ...a };
    for (const k of Object.keys(a))
        o[k] = a[k] + ((b[k] ?? a[k]) - a[k]) * t;
    // (the bloom's knee by how much bloom each adds: the one bloom, kneed so, is the two mixed — it's linear in the knee —
    // where a plain mix would let the one adding more glow on everything)
    const wa = (1 - t) * (a.bloomAdd + a.bloomShare), wb = t * ((b.bloomAdd ?? a.bloomAdd) + (b.bloomShare ?? a.bloomShare));
    if (wa + wb > 0)
        o.knee = (wa * a.knee + wb * (b.knee ?? a.knee)) / (wa + wb);
    return o;
}
/** the film uniform's fields (film.wgsl FilmU) for these settings, `alpha` and the target's kind (`levels`: the bloom
 *  chain's, for its gain over an even field) */
export function filmFields(f, alpha, encode, disc, levels = 6) {
    let sum = 0;
    for (let i = 0, w = 1; i < levels; i++, w *= f.bloomWeight)
        sum += w;
    return {
        a: [f.exposure, f.bloomShare, f.bloomAdd, f.bloomNorm], glow: [f.glow, f.glowFrom, f.halation, f.bloomNorm * sum],
        look: [f.warmth, f.punch, f.saturation, f.saturationAfter], tone: [f.contrast, f.toe, f.power, f.grain],
        vig: [f.vignette, f.vignetteQ, f.dither, f.grainMids], grade: [f.grade, f.split, f.rich, f.night],
        sun: [f.golden, f.dusk, f.noon, f.cover], out: [alpha, encode ? 1 : 0, disc ? 1 : 0, 0],
    };
}
//# sourceMappingURL=film.js.map