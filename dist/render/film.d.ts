export interface Film {
    /** exposure; bloom's share mixed in, bloom added, bloom's normaliser (on its summed levels); each wider level's
     *  weight going up the chain (1 even, more a wider glow) */
    exposure: number;
    bloomShare: number;
    bloomAdd: number;
    bloomNorm: number;
    bloomWeight: number;
    /** the bloom's first level against fireflies: its taps' groups averaged weighted by their brightness (1: an even field
     *  kept as it is), or their average compressed (0); and how much it keeps only what's bright (its soft knee, from
     *  kneeLo to kneeHi at the brightest channel) */
    bloomEven: number;
    knee: number;
    kneeLo: number;
    kneeHi: number;
    /** the glow on what's brighter than its knee (film units), film's red halation round highlights */
    glow: number;
    glowFrom: number;
    halation: number;
    /** white balance (+ warm), AgX's punch (0 base .. 1 punchy), saturation in the look and after it */
    warmth: number;
    punch: number;
    saturation: number;
    saturationAfter: number;
    /** contrast round mid-grey and its toe (0 straight, 1 soft); the screen's power (1/2.2, or 1: AgX's own curve) */
    contrast: number;
    toe: number;
    power: number;
    /** vignettes (round, quadratic), the fixed dither (255ths), grain, and how much it keeps to the mids (0 even, 1 film's:
     *  little in the shadows and the highlights) */
    vignette: number;
    vignetteQ: number;
    dither: number;
    grain: number;
    grainMids: number;
    /** the time-of-day grade: strength, the warm-cool split, the reds' richness; where the sun is (0..1 each: golden hour,
     *  dusk, noon, night) and the cloud cover */
    grade: number;
    split: number;
    rich: number;
    golden: number;
    dusk: number;
    noon: number;
    night: number;
    cover: number;
}
/** a's settings toward b's by t (0..1) (any b lacks, a's) */
export declare function mixFilm(a: Film, b: Film, t: number): Film;
/** the film uniform's fields (film.wgsl FilmU) for these settings, `alpha` and the target's kind (`levels`: the bloom
 *  chain's, for its gain over an even field) */
export declare function filmFields(f: Film, alpha: number, encode: boolean, disc: boolean, levels?: number): {
    a: number[];
    glow: number[];
    look: number[];
    tone: number[];
    vig: number[];
    grade: number[];
    sun: number[];
    out: number[];
};
//# sourceMappingURL=film.d.ts.map