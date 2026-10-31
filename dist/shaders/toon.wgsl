// Toon light (loom): light blocked in the way a painter does it, not graded — the lit side in the light's own warm
// colour, the shade a cool complementary one (never grey: a white wall's shadow is violet, a yellow one's orange, a
// magenta one's purple), a hot line where they meet, a rim of reflected sky on the edges turned away, a hard specular
// blob on wet or glossy things. Hard-edged cast shadows (the cascades, thresholded). For the stylized worlds (Fauve).
// Include after loom/env (it reads the key light, the shadows, the frame).

struct Toon {
  light: vec3f,    // the key light's colour on a lit surface (× albedo)
  shade: vec3f,    // the shade's colour (× albedo): the cool complement of the light
  sky: vec3f,      // a little fill from above
  ground: vec3f,   // and from below (the warm bounce)
  rim: vec3f,      // the rim on the edges turned from the eye
  edge: vec3f,     // the terminator's hot line
}

/** three tones and the line between the lit and the shade (x the lit amount: the wrapped n·l, shadowed) */
fn toonBands(x: f32) -> vec2f {
  let lit = smoothstep(0.5, 0.535, x);
  let deep = 1.0 - smoothstep(0.18, 0.22, x);
  let line = smoothstep(0.47, 0.5, x) * (1.0 - smoothstep(0.535, 0.58, x));
  return vec2f(lit - deep * 0.35, line);
}

/** a surface's toon light: albedo, normal, toward the eye, the key light's direction, its shadow (0..1), gloss (0..1:
 *  how hard and bright the specular blob) */
fn toonLight(albedo: vec3f, n: vec3f, v: vec3f, L: vec3f, sh: f32, gloss: f32, t: Toon) -> vec3f {
  let ndl = dot(n, L);
  let x = (ndl * 0.5 + 0.5) * mix(0.35, 1.0, step(0.5, sh));
  let b = toonBands(x);
  let k = clamp(b.x, -0.35, 1.0);
  var c = mix(albedo * t.shade, albedo * t.light, max(k, 0.0)) * (1.0 + min(k, 0.0));
  c += albedo * t.edge * b.y * 0.6;
  // fill: the sky from above, the bounce from below (a little: the bands carry the form)
  c += albedo * mix(t.ground, t.sky, n.y * 0.5 + 0.5) * 0.1;
  // rim: the edges turned from the eye catch the sky behind
  let fr = 1.0 - max(dot(n, v), 0.0);
  c += t.rim * smoothstep(0.8, 0.86, fr) * (0.12 + 0.2 * (1.0 - max(k, 0.0)));
  // the specular blob (hard)
  if (gloss > 0.0) {
    let h = normalize(L + v);
    let s = pow(max(dot(n, h), 0.0), mix(24.0, 160.0, gloss));
    c += t.light * smoothstep(0.55, 0.62, s) * gloss * 1.4 * step(0.5, sh);
  }
  return c;
}
