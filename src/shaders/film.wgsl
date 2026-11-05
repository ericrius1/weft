// The film (loom/film): bloom's share and the glow on what's bright, film's red halation round highlights, the exposure,
// a warm/cool white balance, AgX (Sobotka's view, Benjamin Wrensch's polynomial fit) and its look (the punch: a power
// and more saturation), the saturation after it, the contrast round mid-grey with a soft toe (what's pushed below black
// fades out, never ends at an edge), a grade by the time of day (the warm-cool split, the dusk's violet, the reds' and
// golds' richness), a vignette, grain, and the screen's curve. No bindings of its own: include it, bind a FilmU, and
// call filmCurve then filmFinish in a final pass; render/film.ts packs the settings (Film) into the uniform and mixes
// two films. filmLock runs it backwards: the scene colour that comes out as a colour designed for the screen (for
// characters drawn as colour models). Universe's whole dive goes through it, Seven Havens' frames with it.
//   film units: what the scene targets hold — light already exposed for the screen, 1 about white

struct FilmU {
  a: vec4f,      // x exposure, y bloom's share (mixed in), z bloom added, w bloom's normaliser (1 / its levels' weights)
  glow: vec4f,   // x the glow on what's bright, y its knee (film units), z halation (less of it by night), w the bloom's
                 // gain over an even field (its normaliser times its levels' summed weights)
  look: vec4f,   // x warmth (white balance), y punch (0 AgX's base look, 1 punchy), z saturation in the look, w after it
  tone: vec4f,   // x contrast, y its toe (0 a straight line, 1 soft), z the screen's power (1/2.2, or 1: AgX's own curve), w grain
  vig: vec4f,    // x vignette (round, aspect-true), y vignette (quadratic), z dither (in 255ths), w the grain kept to the mids
  grade: vec4f,  // x the time-of-day grade's strength, y the warm-cool split, z the reds' and golds' richness, w night (0..1)
  sun: vec4f,    // x golden hour, y dusk, z noon, w cloud cover (0..1)
  out: vec4f,    // x alpha (over the cell's frame while the two hand over), y 1: the screen's curve written (0: an sRGB
                 // target applies it), z 1: a dome's fisheye (black outside its circle), w -
}

const FILM_LUMA = vec3f(0.2126, 0.7152, 0.0722);
// AgX's inset and outset (Sobotka), their log range
const FILM_INSET = mat3x3f(vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051), vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
  vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
const FILM_OUTSET = mat3x3f(vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438), vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
  vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
const FILM_MIN_EV = -12.47393;
const FILM_MAX_EV = 4.026069;

fn filmPoly(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn filmPolyD(x: f32) -> f32 {
  let x2 = x * x; let x4 = x2 * x2;
  return 93.0 * x4 * x - 200.7 * x4 + 127.84 * x2 * x - 20.604 * x2 + 0.8596 * x + 0.1191;
}
fn filmPolyInv(y: f32) -> f32 {
  var x = clamp(y * 0.6 + 0.2, 0.0, 1.0);
  for (var i = 0; i < 6; i++) { x = clamp(x - (filmPoly(vec3f(x)).x - y) / max(filmPolyD(x), 0.05), 0.0, 1.0); }
  return x;
}
fn filmToe(x: vec3f) -> vec3f {
  let k = 0.012;
  return select(k * log(1.0 + exp(x / k)), x, x > vec3f(8.0 * k));
}
fn filmWarmth(F: FilmU) -> vec3f { return vec3f(1.0 + F.look.x * 0.08, 1.0, 1.0 - F.look.x * 0.08); }
fn filmPower(F: FilmU) -> f32 { return mix(1.0, 1.35, F.look.y); }
fn filmSat(F: FilmU) -> f32 { return mix(1.0, 1.4, F.look.y) * F.look.z; }

/** the reds', oranges' and golds' chroma raised by s about their luminance, no channel pushed past 0 or 1 (Seven Havens'
 *  fxRicher) */
fn filmRicher(d: vec3f, s: f32) -> vec3f {
  let mx = max(d.r, max(d.g, d.b));
  let ch = mx - min(d.r, min(d.g, d.b));
  if (s <= 0.0 || ch < 1e-4) { return d; }
  var h = ((d.r - d.g) / ch + 4.0) / 6.0;
  if (mx == d.r) { h = fract((d.g - d.b) / ch / 6.0); } else if (mx == d.g) { h = ((d.b - d.r) / ch + 2.0) / 6.0; }
  let w = select(smoothstep(0.965, 0.995, h), 1.0 - smoothstep(0.12, 0.18, h), h < 0.5);
  let l = dot(d, FILM_LUMA);
  let up = (vec3f(1.0) - l) / max(d - l, vec3f(1e-5));
  let dn = l / max(l - d, vec3f(1e-5));
  let edge = min(min(select(dn.x, up.x, d.x > l), select(dn.y, up.y, d.y > l)), select(dn.z, up.z, d.z > l));
  return l + (d - l) * min(1.0 + s * w, max(edge, 1.0));
}

/** the grade by the time of day (Seven Havens' fxGrade): shadows toward lavender (indigo by night), highlights toward
 *  warm gold, the dusk's magenta-violet, a little more contrast at noon and under cloud, the reds' richness */
fn filmGrade(F: FilmU, d0: vec3f) -> vec3f {
  let k = F.grade.x;
  if (k <= 0.0) { return d0; }
  let golden = F.sun.x; let dusk = F.sun.y; let noon = F.sun.z; let cover = F.sun.w; let night = F.grade.w;
  var d = d0;
  let l = dot(d, FILM_LUMA);
  let shK = 1.0 - smoothstep(0.02, 0.5, l);
  let hiK = smoothstep(0.4, 0.95, l);
  let cool = mix(vec3f(0.002, -0.004, 0.028), vec3f(0.0, -0.004, 0.034), night);
  let warm = vec3f(0.024, 0.008, -0.026);
  d += (cool * shK * (1.0 + 0.6 * golden + 0.5 * dusk) + warm * hiK * (1.0 + 1.6 * golden) * (1.0 - 0.6 * night)) * F.grade.y * k;
  d += vec3f(0.006, -0.008, 0.018) * dusk * k;
  d = (d - 0.45) * (1.0 + (0.04 * noon + 0.06 * cover) * k) + 0.45;
  d = filmRicher(d, F.grade.z * k * (1.0 + 0.5 * golden));
  return d * vec3f(1.0 - 0.015 * cover * k, 1.0, 1.0 + 0.02 * cover * k);
}

/** the scene's light (film units) and its bloom (as the bloom chain leaves it) to the screen's colour, before the
 *  vignette and the grain: uv and the pixel for those (filmFinish) */
fn filmCurve(F: FilmU, scene: vec3f, bloom: vec3f) -> vec3f {
  let b = bloom * F.a.w;
  var c = mix(scene, b, F.a.y) + bloom * F.a.z;
  // the glow on what's brighter than the knee (its own colour: gold glows gold), film's red halation round highlights
  c += max(b - vec3f(F.glow.y), vec3f(0.0)) * F.glow.x;
  c += b * vec3f(1.0, 0.32, 0.1) * F.glow.z * F.a.y * (1.0 - 0.75 * F.grade.w);
  c *= F.a.x * filmWarmth(F);
  var v = clamp(log2(max(FILM_INSET * c, vec3f(1e-10))), vec3f(FILM_MIN_EV), vec3f(FILM_MAX_EV));
  var d = filmPoly((v - FILM_MIN_EV) / (FILM_MAX_EV - FILM_MIN_EV));
  // the look (AgX's punch: a power, and saturation in it)
  d = pow(max(d, vec3f(0.0)), vec3f(filmPower(F)));
  let lo = dot(d, FILM_LUMA);
  d = lo + filmSat(F) * (d - lo);
  d = clamp(FILM_OUTSET * d, vec3f(0.0), vec3f(1.0));
  // the saturation after, the contrast round mid-grey (its toe soft or straight), the grade
  let la = dot(d, FILM_LUMA);
  d = mix(vec3f(la), d, F.look.w);
  let b0 = (-0.00232 - 0.5) * F.tone.x + 0.5;
  let straight = (d - 0.5) * F.tone.x + 0.5;
  d = mix(straight, filmToe(straight) - filmToe(vec3f(b0)), F.tone.y);
  return filmGrade(F, clamp(d, vec3f(0.0), vec3f(1.0)));
}

/** the vignette, the dither and the grain, the screen's power: the colour written */
fn filmFinish(F: FilmU, d0: vec3f, uv: vec2f, px: vec2f, aspect: f32, n0: f32, n1: f32) -> vec3f {
  var d = d0;
  let dc = uv - 0.5;
  d *= 1.0 - F.vig.x * smoothstep(0.25, 0.95, length(dc * vec2f(aspect, 1.0)) / max(aspect, 1.0) * 1.5);
  d *= 1.0 - F.vig.y * dot(dc, dc) * 1.6;
  // (a fixed dither against banding in the sky, then the grain: n0 fixed per pixel, n1 new each frame; film's grain
  // mostly in the mids, as strong as Seven Havens' triangular noise)
  let l = dot(clamp(d, vec3f(0.0), vec3f(1.0)), FILM_LUMA);
  d += (n0 - 0.5) * F.vig.z / 255.0 + (n1 - 0.5) * F.tone.w * mix(1.0, 1.41 * (0.15 + 3.0 * l * (1.0 - l)), F.vig.w);
  d = pow(max(d, vec3f(0.0)), vec3f(F.tone.z));
  return select(pow(d, vec3f(2.2)), d, F.out.y > 0.5);
}

/** the film run backwards (ignoring the toe, the grade, the vignette and the grain; the bloom, its glow and halation
 *  as over an even field of the colour): the scene colour, in film units, that shows as `D0` designed for the screen.
 *  A colour model's characters are drawn so */
fn filmLock(F: FilmU, D0: vec3f) -> vec3f {
  var g = pow(max(D0, vec3f(0.0)), vec3f(1.0 / max(F.tone.z, 1e-3)));
  g = (g - 0.5) / max(F.tone.x, 0.01) + 0.5;
  let la = dot(g, FILM_LUMA);
  g = la + (g - la) / max(F.look.w, 0.01);
  var d = FILM_INSET * clamp(g, vec3f(0.0), vec3f(1.0));
  let lo = dot(d, FILM_LUMA);
  d = lo + (d - lo) / max(filmSat(F), 0.01);
  d = pow(max(d, vec3f(1e-5)), vec3f(1.0 / filmPower(F)));
  d = vec3f(filmPolyInv(d.x), filmPolyInv(d.y), filmPolyInv(d.z));
  let c = FILM_OUTSET * exp2(d * (FILM_MAX_EV - FILM_MIN_EV) + FILM_MIN_EV);
  let x = max(c, vec3f(0.0)) / (filmWarmth(F) * max(F.a.x, 1e-9));
  // (an even field's bloom is the field times the gain: mixed in by its share, added, its halation; and the glow past
  // the knee — linear on each side of it)
  let G = F.glow.w; let s = F.a.y;
  let A = vec3f(1.0 - s + s * G + F.a.z * G / max(F.a.w, 1e-9)) + vec3f(1.0, 0.32, 0.1) * G * F.glow.z * s * (1.0 - 0.75 * F.grade.w);
  return select((x + F.glow.x * F.glow.y) / (A + F.glow.x * G), x / A, x <= A * F.glow.y / max(G, 1e-9));
}
