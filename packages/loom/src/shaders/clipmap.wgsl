// Reading a land's clipmaps (terrain/clipmap.ts) in a shader. A level's texel k (from its square's west / north edge)
// lives at k mod window in its toroidal layer, so a point's place in it is (x + half) / (texel * window), wrapped by
// the repeating sampler (clipUv). A level's weight at a point is the part that's in (its rect), faded out over `blend`
// metres inside its edge, times how far the tile under the point has faded in (tileFade): 0 where its slot doesn't
// hold that tile — one not in yet, or the tile that left still there until it's written over — and guarded near any
// unloaded neighbour tile so bilinear, mip, normal-finite-difference, and 7x7 surface-class taps never bleed stale
// texels from a neighbour's toroidal slot.
//
// A library: the including shader says where ClipSet.fill's residency is (its own uniform, say) by defining
//   fn clipTileInfo(lv: u32) -> vec4f   level lv's tile size (m), the window's tiles a side, the grid's (fill: tileInfo)
//   fn clipTileSlot(k: u32) -> u32      slot k's residency, (tile + 1) << 8 | fade (fill: tileSlots, 64 a level)
// then `#include "loom/clipmap"`. A level's uniform L (ClipLevel.uniform): texel (m), window (px), half extent (m),
// blend (m); its rect r (ClipLevel.shown): x0, z0, x1, z1 (m).

const CLIP_SLOTS = 64u;
// Guard band (tile fraction): exact 0 within 0.035 tile (~9 texels on a 256px tile, covering bilinear, 3-mip colour,
// normal finite differences, and 7x7 road-fit footprints), fading smoothly to 1 by 0.10 tile from an unloaded neighbour.
const CLIP_GUARD_IN = 0.035;
const CLIP_GUARD_OUT = 0.10;

fn rectWeight(r: vec4f, blend: f32, xz: vec2f) -> f32 {
  let e = min(min(xz.x - r.x, r.z - xz.x), min(xz.y - r.y, r.w - xz.y));
  return smoothstep(0.0, blend, e);
}
fn clipUv(L: vec4f, xz: vec2f) -> vec2f { return (xz + L.z) / (L.x * L.y); }

fn clipSlotFade(lv: u32, t: vec2i, n: i32, g: i32) -> f32 {
  let k = lv * CLIP_SLOTS + u32((t.y % n) * n + (t.x % n));
  let v = clipTileSlot(k);
  return select(0.0, f32(v & 255u) / 255.0, (v >> 8u) == u32(t.y * g + t.x) + 1u);
}

fn clipEdgeFade(nf: f32, d: f32) -> f32 {
  if (nf <= 0.0) { return smoothstep(CLIP_GUARD_IN, CLIP_GUARD_OUT, d); }
  return mix(nf, 1.0, smoothstep(0.0, CLIP_GUARD_OUT, d));
}

// how far the tile under a point has faded in at a level (`half`: the level's half extent), guarded against unloaded
// adjacent slots along tile borders so partial-row loading never bleeds stale neighbour texels
fn tileFade(lv: u32, half: f32, xz: vec2f) -> f32 {
  let ti = clipTileInfo(lv);
  let p = (xz + half) / ti.x;
  let t = vec2i(floor(p));
  let n = i32(ti.y);
  let g = i32(ti.z);
  if (any(t < vec2i(0)) || any(t >= vec2i(g))) { return 0.0; }
  var w = clipSlotFade(lv, t, n, g);
  if (w <= 0.0) { return 0.0; }
  let f = p - vec2f(t);
  var ox = 0;
  var dx = CLIP_GUARD_OUT;
  if (f.x < CLIP_GUARD_OUT && t.x > 0) { ox = -1; dx = f.x; }
  else if (f.x > 1.0 - CLIP_GUARD_OUT && t.x + 1 < g) { ox = 1; dx = 1.0 - f.x; }
  var oy = 0;
  var dy = CLIP_GUARD_OUT;
  if (f.y < CLIP_GUARD_OUT && t.y > 0) { oy = -1; dy = f.y; }
  else if (f.y > 1.0 - CLIP_GUARD_OUT && t.y + 1 < g) { oy = 1; dy = 1.0 - f.y; }
  if (ox != 0) { w *= clipEdgeFade(clipSlotFade(lv, t + vec2i(ox, 0), n, g), dx); }
  if (oy != 0) { w *= clipEdgeFade(clipSlotFade(lv, t + vec2i(0, oy), n, g), dy); }
  if (ox != 0 && oy != 0) { w *= clipEdgeFade(clipSlotFade(lv, t + vec2i(ox, oy), n, g), max(dx, dy)); }
  return w;
}
// a level's weight at a point: its rect's, faded over its edge, times the tile's own fade
fn levelWeight(lv: u32, r: vec4f, L: vec4f, xz: vec2f) -> f32 {
  let w = rectWeight(r, L.w, xz);
  if (w <= 0.0) { return 0.0; }
  return w * tileFade(lv, L.z, xz);
}
