// A subject's own sun shadow (render/subjectshadow.ts): one small light-space map fitted to one subject's bounds — a
// bird, a person's head and hands — finer than any cascade (a 1.4 m bird in 256 texels: 5 mm, against a cascade's
// 4-10 cm), read by the subject's own shader (a wing's shadow on the body, one feather's on the next) and by the
// ground under it (its shadow crisp, not a cascade's blur). With `layers`, a second map counts the surfaces behind the
// first one the light meets, in four slices (a deep opacity map): how many layers lie between a point and the sun —
// light through feathers or hair is exp(-k * layers), not all or nothing.
//
// The including file binds a `Subject` uniform, the depth map (texture_depth_2d) and, with layers, the layers map
// (texture_2d<f32>), and passes them in: the group and bindings are the app's. Sampled with weft's samp_shadow.
// Phones: `subjectShapes` — the subject as a few ellipsoids (a body, two wings), no map at all.
#include "weft/frame"

struct Subject {
  m: mat4x4f,     // world → the light's clip space (orthographic, reversed-Z: nearer the light is greater)
  k: vec4f,       // x 1 when fitted (0: everything lit), y a texel (m), z metres per unit of depth, w bias (m)
  s: vec4f,       // the four slices' far ends behind the first surface (m), for the layers
}

/** a world position in the map: uv (0..1, y down) and its depth */
fn subjectAt(S: Subject, p: vec3f) -> vec3f {
  let c = S.m * vec4f(p, 1.0);
  return vec3f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5, c.z);
}

/** whether p is inside the map's square and depth range (outside: the cascades' business) */
fn subjectCovers(S: Subject, p: vec3f) -> bool {
  let a = subjectAt(S, p);
  return S.k.x > 0.5 && all(a.xy > vec2f(0.0)) && all(a.xy < vec2f(1.0)) && a.z > 0.0 && a.z < 1.0;
}

/** the sun's visibility at p past the subject (1 lit, 0 in its shadow; 1 outside the map): 3x3 taps, hardware-
 *  filtered; n pushes the tap off the surface by a texel and a half (its own surface never shades itself) */
fn subjectVis(S: Subject, map: texture_depth_2d, p: vec3f, n: vec3f) -> f32 {
  if (S.k.x < 0.5) { return 1.0; }
  let a = subjectAt(S, p + n * S.k.y * 1.5);
  if (any(a.xy <= vec2f(0.0)) || any(a.xy >= vec2f(1.0)) || a.z <= 0.0 || a.z >= 1.0) { return 1.0; }
  let dim = vec2f(textureDimensions(map));
  let z = a.z + S.k.w / S.k.z;
  var s = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      s += textureSampleCompareLevel(map, samp_shadow, a.xy + vec2f(f32(x), f32(y)) / dim, z);
    }
  }
  return s / 9.0;
}

/** how far behind the first surface the light meets p lies (m; 0 at or in front of it, -1 outside the map) */
fn subjectBehind(S: Subject, map: texture_depth_2d, p: vec3f) -> f32 {
  if (S.k.x < 0.5) { return -1.0; }
  let a = subjectAt(S, p);
  if (any(a.xy <= vec2f(0.0)) || any(a.xy >= vec2f(1.0)) || a.z <= 0.0 || a.z >= 1.0) { return -1.0; }
  let dim = vec2i(textureDimensions(map));
  let z0 = textureLoad(map, clamp(vec2i(a.xy * vec2f(dim)), vec2i(0), dim - 1), 0);
  return max(0.0, (z0 - a.z) * S.k.z);
}

/** how many layers of the subject lie between p and the sun (the deep opacity map: the slices before p's, and the
 *  share of its own that's in front of it). 0 outside the map */
fn subjectLayers(S: Subject, map: texture_depth_2d, layers: texture_2d<f32>, p: vec3f) -> f32 {
  let b = subjectBehind(S, map, p);
  if (b < 0.0) { return 0.0; }
  let a = subjectAt(S, p);
  let L = textureSampleLevel(layers, samp_linear, a.xy, 0.0);
  let e = S.s;
  // (the slices' starts: 0, then each one's end)
  let st = vec4f(0.0, e.x, e.y, e.z);
  let share = clamp((vec4f(b) - st) / max(e - st, vec4f(1e-4)), vec4f(0.0), vec4f(1.0));
  // (the first layer is the surface the light meets: p on it has none in front of it)
  return max(0.0, dot(L, share) - 0.5);
}

/** the layers pass's fragment output for a fragment at light depth z (its @builtin(position).z) at map texel px: 1 in
 *  the slice it falls in behind the first surface there (added up by the pass's blend) */
fn subjectLayerOut(S: Subject, map: texture_depth_2d, px: vec2f, z: f32) -> vec4f {
  let dim = vec2i(textureDimensions(map));
  let z0 = textureLoad(map, clamp(vec2i(px), vec2i(0), dim - 1), 0);
  let b = max(0.0, (z0 - z) * S.k.z);
  let e = S.s;
  if (b < e.x) { return vec4f(1.0, 0.0, 0.0, 0.0); }
  if (b < e.y) { return vec4f(0.0, 1.0, 0.0, 0.0); }
  if (b < e.z) { return vec4f(0.0, 0.0, 1.0, 0.0); }
  return vec4f(0.0, 0.0, 0.0, select(0.0, 1.0, b < e.w));
}

// ---- without a map (phones): the subject as up to four ellipsoids
struct SubjectShapes {
  e: array<mat4x4f, 4>,   // world → each ellipsoid's unit sphere (its inverse placement)
  k: vec4f,               // x how many, y the soft edge (in unit-sphere radii), z the sun's direction's w unused
}
/** the sun's visibility at p past the shapes: each one's shadow by how near the sun's ray from p passes its centre */
fn subjectShapes(Sh: SubjectShapes, p: vec3f, sun: vec3f) -> f32 {
  var vis = 1.0;
  let n = u32(Sh.k.x);
  for (var i = 0u; i < 4u; i++) {
    if (i >= n) { break; }
    let M = Sh.e[i];
    let o = (M * vec4f(p, 1.0)).xyz;
    let d = (M * vec4f(sun, 0.0)).xyz;
    let dd = dot(d, d);
    let t = -dot(o, d) / max(dd, 1e-8);
    // (only what lies toward the sun, and not the shape p is on)
    if (t <= 0.0 || dot(o, o) < 1.0) { continue; }
    let q = o + d * t;
    let r = length(q);
    vis *= smoothstep(1.0 - Sh.k.y, 1.0 + Sh.k.y, r);
  }
  return vis;
}
