// A dithered crossfade between two levels of detail (San Francisco's buildings and trees): over a band of distance the
// near level's pixels give way to the far level's, a pixel at a time, each pixel drawn by exactly one of the two — so
// no blending, no sorting, and depth stays exact. The pattern is interleaved gradient noise: no lattice for the eye to
// find, where a 4x4 ordered dither's grid of dots showed on big flat surfaces mid-crossover. With TAA or MSAA the dots
// resolve to a smooth fade.
//
//   #include "weft/lodfade"
//   let t = lodFadeT(distance(frame.camPos.xz, p.xz), C.lod.x, C.lod.y);   // 0 near .. 1 far over the band
//   if (lodFadeDrop(LOD == 0u, t, i.pos.xy)) { discard; }

// 0..1 by the pixel: interleaved gradient noise (Jimenez 2014)
fn ign(px: vec2f) -> f32 {
  let q = floor(px);
  return fract(52.9829189 * fract(dot(q, vec2f(0.06711056, 0.00583715))));
}
// where a distance is in a crossover band centred on `mid`, `width` wide: 0 at its near edge, 1 at its far
fn lodFadeT(dist: f32, mid: f32, width: f32) -> f32 {
  return (dist - (mid - width * 0.5)) / max(width, 1e-6);
}
// whether this pixel of the near level (near: true) or the far one (false) is dropped at crossover `t`: the two never
// both draw a pixel, and between them always one does
fn lodFadeDrop(near: bool, t: f32, px: vec2f) -> bool {
  let d = ign(px);
  return select(t <= d, t > d, near);
}
