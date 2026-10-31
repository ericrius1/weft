// The terrain's own shadow toward the key light, for the whole map (after waterbending's heightfield shadow): each
// texel marches the height map toward the light with growing steps (coarser mips further out) and keeps how far below
// the ray the ground stays — a soft penumbra the width of the sun. Rebuilt a band of rows a frame into one map while
// the other is sampled (src/render/hfshadow.ts swaps them when a pass completes).
#include "./globals"

struct HF { win: vec4f, dir: vec4f, row: vec4f }
@group(2) @binding(0) var<uniform> hf: HF;
@group(2) @binding(1) var heights: texture_2d<f32>;
@group(2) @binding(2) var hfOut: texture_storage_2d<rgba8unorm, write>;

fn hLoad(uv: vec2f, lod: i32) -> f32 {
  let dim = vec2i(textureDimensions(heights, lod));
  let p = uv * vec2f(dim) - 0.5;
  let i = vec2i(floor(p));
  let f = p - floor(p);
  let mx = dim - vec2i(1);
  let a = textureLoad(heights, clamp(i, vec2i(0), mx), lod).x;
  let b = textureLoad(heights, clamp(i + vec2i(1, 0), vec2i(0), mx), lod).x;
  let c = textureLoad(heights, clamp(i + vec2i(0, 1), vec2i(0), mx), lod).x;
  let d = textureLoad(heights, clamp(i + vec2i(1, 1), vec2i(0), mx), lod).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
fn hAt(xz: vec2f, lod: i32) -> f32 {
  let uv = xz / (2.0 * world.worldHalf) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return -60.0; }
  return hLoad(uv, lod);
}

@compute @workgroup_size(8, 8)
fn bake(@builtin(global_invocation_id) id: vec3u) {
  let N = u32(hf.win.w);
  let y = id.y + u32(hf.row.x);
  if (id.x >= N || y >= N) { return; }
  let uv = (vec2f(f32(id.x), f32(y)) + 0.5) / f32(N);
  let p = hf.win.xy + uv * hf.win.z;
  let texel = hf.win.z / hf.win.w;
  let l = normalize(hf.dir.xyz);
  if (l.y < -0.05) { textureStore(hfOut, vec2u(id.x, y), vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  // (the height map's texel is 1.5 m: its mip per metre of stride)
  let mtex = 2.0 * world.worldHalf / f32(textureDimensions(heights, 0).x);
  let lod0 = i32(clamp(log2(texel / mtex), 0.0, 8.0));
  // a grazing sun: small bumps would speckle the ground with hard shadows — start further out, soften more
  let graze = 1.0 - smoothstep(0.05, 0.3, l.y);
  let h0 = max(hAt(p, lod0 + 1), 0.0) + texel * (0.4 + graze) + 0.5 + graze * 1.5;
  let horiz = normalize(l.xz + vec2f(1e-5));
  let tanL = l.y / max(length(l.xz), 1e-4);
  var vis = 1.0;
  var t = texel * (1.5 + graze * 6.0);
  for (var i = 0; i < 72; i++) {
    let q = p + horiz * t;
    let lod = i32(clamp(log2(t / (mtex * 8.0)), f32(lod0), 7.0));
    let hq = hAt(q, lod);
    let rayH = h0 + t * tanL;
    // penumbra: how far below the ray the terrain stays, relative to distance (the sun is ~0.5 deg wide)
    vis = min(vis, sat((rayH - hq) / (t * (0.03 + graze * 0.05) + texel * (0.5 + graze)) + 0.5));
    if (vis <= 0.0) { break; }
    t *= 1.09;
    if (t > 9000.0 || rayH > 1600.0) { break; }
  }
  textureStore(hfOut, vec2u(id.x, y), vec4f(vis, 0.0, 0.0, 1.0));
}
