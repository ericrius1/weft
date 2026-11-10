// Reading a land's clipmaps (terrain/clipmap.ts) in a shader. A level's texel k (from its square's west / north edge)
// lives at k mod window in its toroidal layer, so a point's place in it is (x + half) / (texel * window), wrapped by
// the repeating sampler (clipUv). A level's weight at a point is the part that's in (its rect), faded out over `blend`
// metres inside its edge, times how far the tile under the point has faded in (tileFade): 0 where its slot doesn't
// hold that tile — one not in yet, or the tile that left still there until it's written over — so a level's never
// read in the wrong place, and a tile arriving blends over the coarser level rather than appearing.
//
// A library: the including shader says where ClipSet.fill's residency is (its own uniform, say) by defining
//   fn clipTileInfo(lv: u32) -> vec4f   level lv's tile size (m), the window's tiles a side, the grid's (fill: tileInfo)
//   fn clipTileSlot(k: u32) -> u32      slot k's residency, (tile + 1) << 8 | fade (fill: tileSlots, 64 a level)
// then `#include "loom/clipmap"`. A level's uniform L (ClipLevel.uniform): texel (m), window (px), half extent (m),
// blend (m); its rect r (ClipLevel.shown): x0, z0, x1, z1 (m).

const CLIP_SLOTS = 64u;

fn rectWeight(r: vec4f, blend: f32, xz: vec2f) -> f32 {
  let e = min(min(xz.x - r.x, r.z - xz.x), min(xz.y - r.y, r.w - xz.y));
  return smoothstep(0.0, blend, e);
}
fn clipUv(L: vec4f, xz: vec2f) -> vec2f { return (xz + L.z) / (L.x * L.y); }

// how far the tile under a point has faded in at a level (`half`: the level's half extent)
fn tileFade(lv: u32, half: f32, xz: vec2f) -> f32 {
  let ti = clipTileInfo(lv);
  let t = vec2i(floor((xz + half) / ti.x));
  let n = i32(ti.y);
  let g = i32(ti.z);
  if (any(t < vec2i(0)) || any(t >= vec2i(g))) { return 0.0; }
  let k = lv * CLIP_SLOTS + u32((t.y % n) * n + (t.x % n));
  let v = clipTileSlot(k);
  return select(0.0, f32(v & 255u) / 255.0, (v >> 8u) == u32(t.y * g + t.x) + 1u);
}
// a level's weight at a point: its rect's, faded over its edge, times the tile's own fade
fn levelWeight(lv: u32, r: vec4f, L: vec4f, xz: vec2f) -> f32 {
  let w = rectWeight(r, L.w, xz);
  if (w <= 0.0) { return 0.0; }
  return w * tileFade(lv, L.z, xz);
}
