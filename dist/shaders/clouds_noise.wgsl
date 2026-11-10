// The clouds' noise volumes, baked once at load (src/render/clouds.ts), after Schneider's Nubis clouds: tileable 3D Perlin
// and Worley noise — a 128³ shape volume (r: Perlin-Worley, g b a: Worley fbm at 4 / 8 / 16 cells a tile) and a 32³
// erosion volume (r g b: Worley fbm at 2 / 4 / 8 cells). Ported from waterbending (src/shaders/clouds_noise.wgsl).
#include "./common"
// the shape volume, pre-combined (one fetch a sample, no 8-bit steps under the coverage remap's steep slope); its mips
@group(2) @binding(0) var baseOut: texture_storage_3d<r32float, write>;
@group(2) @binding(1) var detailOut: texture_storage_3d<rgba8unorm, write>;
// a mip of either volume: each texel the mean of the 8 below it (the volumes tile, and so do their means)
@group(2) @binding(2) var mipSrc: texture_3d<f32>;
@group(2) @binding(3) var mipDst: texture_storage_3d<rgba8unorm, write>;
// blue noise (64², weft's bluenoise): the march's per-pixel jitter rides along in the erosion volume's alpha
@group(2) @binding(4) var blueIn: texture_2d<f32>;
@group(2) @binding(5) var mipDstR: texture_storage_3d<r32float, write>;
@compute @workgroup_size(4, 4, 4)
fn down(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= textureDimensions(mipDst))) { return; }
  var s = vec4f(0.0);
  for (var k = 0u; k < 8u; k++) { s += textureLoad(mipSrc, vec3i(id * 2u + vec3u(k & 1u, (k >> 1u) & 1u, k >> 2u)), 0); }
  textureStore(mipDst, id, s / 8.0);
}
@compute @workgroup_size(4, 4, 4)
fn downR(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= textureDimensions(mipDstR))) { return; }
  var s = 0.0;
  for (var k = 0u; k < 8u; k++) { s += textureLoad(mipSrc, vec3i(id * 2u + vec3u(k & 1u, (k >> 1u) & 1u, k >> 2u)), 0).r; }
  textureStore(mipDstR, id, vec4f(s / 8.0, 0.0, 0.0, 0.0));
}

fn h3(c: vec3i) -> vec3f {
  let a = hashu((bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u) ^ (bitcast<u32>(c.z) * 83492791u));
  let b = hashu(a + 0x9e3779b9u);
  let d = hashu(b + 0x7f4a7c15u);
  return vec3f(f32(a & 0xffffffu), f32(b & 0xffffffu), f32(d & 0xffffffu)) / 16777215.0;
}
fn wrap3(c: vec3i, n: i32) -> vec3i { return ((c % vec3i(n)) + vec3i(n)) % vec3i(n); }

/** inverted Worley: 1 on the feature points, falling to 0 a cell away (cells wrapping every n) */
fn worley3(p: vec3f, n: i32) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  var d = 1e9;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec3i(x, y, z);
    let r = vec3f(o) + h3(wrap3(i + o, n)) - f;
    d = min(d, dot(r, r));
  }}}
  return 1.0 - sat(sqrt(d));
}
/** three octaves of Worley, stretched to ~0..1 (summed, they huddle around the middle) */
fn worleyFbm(p: vec3f, f: i32) -> f32 {
  let w = worley3(p * f32(f), f) * 0.625 + worley3(p * f32(f * 2), f * 2) * 0.25 + worley3(p * f32(f * 4), f * 4) * 0.125;
  return sat((w - 0.27) / 0.44);
}
fn grad3(c: vec3i, n: i32) -> vec3f { return normalize(h3(wrap3(c, n) + vec3i(17, 31, 47)) * 2.0 - 1.0 + vec3f(1e-4)); }
fn perlin3(p: vec3f, n: i32) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(grad3(i, n), f);
  let b = dot(grad3(i + vec3i(1, 0, 0), n), f - vec3f(1.0, 0.0, 0.0));
  let c = dot(grad3(i + vec3i(0, 1, 0), n), f - vec3f(0.0, 1.0, 0.0));
  let d = dot(grad3(i + vec3i(1, 1, 0), n), f - vec3f(1.0, 1.0, 0.0));
  let e = dot(grad3(i + vec3i(0, 0, 1), n), f - vec3f(0.0, 0.0, 1.0));
  let g = dot(grad3(i + vec3i(1, 0, 1), n), f - vec3f(1.0, 0.0, 1.0));
  let h = dot(grad3(i + vec3i(0, 1, 1), n), f - vec3f(0.0, 1.0, 1.0));
  let k = dot(grad3(i + vec3i(1, 1, 1), n), f - vec3f(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
fn perlinFbm(p: vec3f, n: i32, oct: i32) -> f32 {
  var s = 0.0; var a = 1.0; var w = 0.0; var f = 1;
  for (var k = 0; k < oct; k++) { s += a * perlin3(p * f32(n * f), n * f); w += a; a *= 0.5; f *= 2; }
  return s / w;
}

@compute @workgroup_size(4, 4, 4)
fn bakeBase(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(128u))) { return; }
  let p = (vec3f(id) + 0.5) / 128.0;
  // Perlin fbm (billowy) remapped onto a low Worley fbm: round puffs with Perlin's connective structure
  let pf = sat(perlinFbm(p, 4, 6) * 1.5 + 0.5);
  let w4 = worleyFbm(p, 4);
  let pw = sat((remap(pf, 0.0, 1.0, w4, 1.0) - 0.3) / 0.7);
  // eroded by the low Worley fbm, then spread over 0..1 (the coverage cuts into it evenly)
  let lo = w4 * 0.625 + worleyFbm(p, 8) * 0.25 + worleyFbm(p, 16) * 0.125;
  let shape = sat((remap(pw, lo - 1.0, 1.0, 0.0, 1.0) - 0.42) / 0.56);
  textureStore(baseOut, id, vec4f(shape, 0.0, 0.0, 0.0));
}

@compute @workgroup_size(4, 4, 4)
fn bakeDetail(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(64u))) { return; }
  let p = (vec3f(id) + 0.5) / 64.0;
  let bn = textureLoad(blueIn, vec2i(id.xy) % vec2i(textureDimensions(blueIn)), 0).r;
  // pre-combined: r the erosion fbm (2, 4, 8 cells), g the wisps' (4, 8, 16), a the blue noise
  let w2 = worleyFbm(p, 2); let w4 = worleyFbm(p, 4); let w8 = worleyFbm(p, 8);
  textureStore(detailOut, id, vec4f(w2 * 0.625 + w4 * 0.25 + w8 * 0.125, w4 * 0.5 + w8 * 0.35 + worleyFbm(p, 16) * 0.15, 0.0, bn));
}
