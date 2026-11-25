// A forest's worth of trees (or rocks, shrubs, anything stood on the ground in the hundreds of thousands) culled and
// sorted on the GPU each frame (world/forest.ts runs it): San Francisco's trees' frame, with nothing of its trees in
// it. `forestCull` takes each instance, stands it on the ground, tests it against the view and sorts it by distance
// into four lists: near (closer than lod.x), far (to lod.y, overlapping the next over the crossfade band lod.w),
// impostor (past lod.y - band, to lod.z: thinned by seed, below), and the shadows' casters (near enough, in view or
// not); `forestWriteArgs` writes the four indirect draws' counts, updates overflow-thinning ratios from pre-thin
// candidate counts (preventing spatial-tail strip truncation when a list overflows), and clears the counters. The
// draws are the world's: they read the lists through forestVisible (forestListBase(list) + instance_index).
//
// An instance is 16 bytes: x, z, y (f32 bits: y its stored foot, for the early reject before the ground's sampled)
// and a packed u32: bits 0-5 its archetype, 6-15 its height (dm), 16-23 its crown's radius (dm), 24-31 its seed
// (x 255). Far off the impostors are thinned: a share keep = clamp((lod.y * thin.x / d)^2, thin.y, 1) of the seeds
// stays, each kept one's crown widened by 1/sqrt(keep) to cover for those let go, and those going shrink away over a
// band thin.z of the seeds rather than at once — a wood's look kept and its count bounded.
//
// A library: the including shader defines
//   fn forestGround(xz: vec2f, stored: f32) -> f32       the ground's height under an instance (stored: its foot as baked)
//   fn forestAccept(xz: vec2f, ground: f32) -> bool      whether it stands there at all (above the sea, not indoors…)
//   fn forestReach(t: ForestTree) -> f32                 how far off it's drawn (m; 1e9 any: the lists' own reaches);
//                                                        its shadow casts to 0.35 of that
// then `#include "loom/forest"`. Its group 2: 0 the ForestU, 1 the instances, 2 the lists (the cull's), 3 the
// counters, 4 the indirect args, 5 the lists again (the draws'); 6 and up are the world's own.
#include "weft/frame"

struct ForestU {
  lod: vec4f,                // x near's end (m), y far's end, z the impostors' end, w the far/impostor crossfade band
  caps: vec4u,               // the lists' capacities: near, far, impostor, shadow
  verts: vec4u,              // the four draws' vertices an instance: near, far, impostor, shadow
  counts: vec4f,             // x the instances, y the shadows' reach (m), z the reject's slack (m)
  thin: vec4f,               // the impostors' thinning: x the distance factor, y the least share kept, z the seed band
  user: array<vec4f, 4>,     // the world's own, for its draws (the wind, say)
}
@group(2) @binding(0) var<uniform> forest: ForestU;
@group(2) @binding(1) var<storage, read> forestTrees: array<vec4u>;
@group(2) @binding(2) var<storage, read_write> forestLists: array<vec4f>;      // [near | far | impostor | shadow]
// [0..3] emitted counts, [4..7] pre-overflow candidate counts, [8..11] smoothed overflow keep ratio (fixed-point * 65536)
@group(2) @binding(3) var<storage, read_write> forestCounters: array<atomic<u32>, 12>;
@group(2) @binding(4) var<storage, read_write> forestArgsOut: array<u32, 16>;
@group(2) @binding(5) var<storage, read> forestVisible: array<vec4f>;          // x, y (the ground's), z, packed

struct ForestTree { p: vec3f, a: u32, h: f32, r: f32, seed: f32 }
fn forestUnpack(x: f32, y: f32, z: f32, k: u32) -> ForestTree {
  var t: ForestTree;
  t.p = vec3f(x, y, z);
  t.a = k & 63u;
  t.h = f32((k >> 6u) & 1023u) * 0.1;
  t.r = f32((k >> 16u) & 255u) * 0.1;
  t.seed = f32(k >> 24u) / 255.0;
  return t;
}
// a list's entry (from forestVisible)
fn forestEntryTree(e: vec4f) -> ForestTree { return forestUnpack(e.x, e.y, e.z, bitcast<u32>(e.w)); }

// where list (0 near, 1 far, 2 impostor, 3 shadow) starts in the lists
fn forestListBase(list: u32) -> u32 {
  if (list == 1u) { return forest.caps.x; }
  if (list == 2u) { return forest.caps.x + forest.caps.y; }
  if (list == 3u) { return forest.caps.x + forest.caps.y + forest.caps.z; }
  return 0u;
}

// position-stable, index-independent uniform integer hash in [0, 1) (exact at any world coordinate, avoiding sin(1e6)
// precision loss) so overflow thinning drops evenly across space and stays stable when Earth units arrive or depart
fn forestKeepHash(xz: vec2f, packed: u32) -> f32 {
  var h = (bitcast<u32>(i32(round(xz.x * 4.0))) * 0x9e3779b1u) ^ (bitcast<u32>(i32(round(xz.y * 4.0))) * 0x85ebca77u) ^ packed;
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return f32(h & 0xffffffu) / 16777216.0;
}

fn forestOvKeep(list: u32) -> f32 {
  let raw = atomicLoad(&forestCounters[8u + list]);
  return select(f32(raw) / 65536.0, 1.0, raw == 0u);
}

// ------------------------------------------------------------------ the cull
@compute @workgroup_size(64) fn forestCull(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= u32(forest.counts.x)) { return; }
  let raw = forestTrees[i];
  let xz = vec2f(bitcast<f32>(raw.x), bitcast<f32>(raw.y));
  // (most are far beyond every reach: let go on their stored foot's height before the ground's sampled)
  let reach = max(forest.lod.z, forest.counts.y) + forest.counts.z;
  let dq = vec3f(xz.x, bitcast<f32>(raw.z), xz.y) - frame.camPos;
  if (dot(dq, dq) > reach * reach) { return; }
  let ground = forestGround(xz, bitcast<f32>(raw.z));
  var t = forestUnpack(xz.x, ground, xz.y, raw.w);
  if (!forestAccept(xz, ground)) { return; }
  let c = vec3f(xz.x, ground + t.h * 0.55, xz.y);
  let d = distance(c, frame.camPos);
  let rad = max(t.h * 0.6, t.r);
  let entry = vec4f(xz.x, ground, xz.y, bitcast<f32>(raw.w));
  let lim = forestReach(t);
  let kh = forestKeepHash(xz, raw.w);
  // (the shadows' casters: near enough, in view or not)
  if (d < min(forest.counts.y, lim * 0.35) && d > 0.0) {
    atomicAdd(&forestCounters[7], 1u);
    if (kh <= forestOvKeep(3u)) {
      let k = atomicAdd(&forestCounters[3], 1u);
      if (k < forest.caps.w) { forestLists[forest.caps.x + forest.caps.y + forest.caps.z + k] = entry; }
    }
  }
  if (d > min(forest.lod.z, lim)) { return; }
  // in view: the frustum's side planes (the view-projection's rows), and in front
  let clip = frame.viewProj * vec4f(c, 1.0);
  let m = frame.viewProj;
  var rows = array<vec4f, 4>(vec4f(m[0].x, m[1].x, m[2].x, m[3].x), vec4f(m[0].y, m[1].y, m[2].y, m[3].y), vec4f(m[0].z, m[1].z, m[2].z, m[3].z), vec4f(m[0].w, m[1].w, m[2].w, m[3].w));
  let pc = vec4f(c, 1.0);
  for (var k = 0; k < 4; k++) {
    let pl = select(rows[3] + rows[k / 2], rows[3] - rows[k / 2], (k & 1) == 1);
    if (dot(pl, pc) < -rad * length(pl.xyz)) { return; }
  }
  if (clip.w < -rad) { return; }
  let band = forest.lod.w;
  if (d < forest.lod.x) {
    atomicAdd(&forestCounters[4], 1u);
    if (kh <= forestOvKeep(0u)) {
      let k = atomicAdd(&forestCounters[0], 1u);
      if (k < forest.caps.x) { forestLists[k] = entry; }
    }
  } else if (d < forest.lod.y + band) {
    atomicAdd(&forestCounters[5], 1u);
    if (kh <= forestOvKeep(1u)) {
      let k = atomicAdd(&forestCounters[1], 1u);
      if (k < forest.caps.y) { forestLists[forest.caps.x + k] = entry; }
    }
  }
  if (d > forest.lod.y - band) {
    // (far off, thinned: a share kept that falls with the distance, each one kept widened to cover for those let go)
    let keep = clamp(pow(forest.lod.y * forest.thin.x / max(d, 1.0), 2.0), forest.thin.y, 1.0);
    // (those let go shrink away over a band of the seeds as the share falls, rather than going at once)
    let thin = forest.thin.z;
    if (t.seed <= keep + thin) {
      atomicAdd(&forestCounters[6], 1u);
      let ov = forestOvKeep(2u);
      if (kh <= ov) {
        var e = entry;
        let ovS = select(1.0, saturate((ov - kh) / thin), ov < 0.999);
        let s = saturate((keep + thin - t.seed) / thin) * ovS;
        let effKeep = max(keep * ov, 0.05);
        if (effKeep < 1.0 || s < 1.0) {
          let r = min(255u, u32(t.r * 10.0 / sqrt(effKeep) * s));
          let hh = min(1023u, u32(t.h * 10.0 * s));
          e.w = bitcast<f32>((raw.w & 0xff00003fu) | (r << 16u) | (hh << 6u));
        }
        let k = atomicAdd(&forestCounters[2], 1u);
        if (k < forest.caps.z) { forestLists[forest.caps.x + forest.caps.y + k] = e; }
      }
    }
  }
}

@compute @workgroup_size(1) fn forestWriteArgs() {
  let n0 = min(atomicLoad(&forestCounters[0]), forest.caps.x);
  let n1 = min(atomicLoad(&forestCounters[1]), forest.caps.y);
  let n2 = min(atomicLoad(&forestCounters[2]), forest.caps.z);
  let n3 = min(atomicLoad(&forestCounters[3]), forest.caps.w);
  forestArgsOut[0] = forest.verts.x; forestArgsOut[1] = n0; forestArgsOut[2] = 0u; forestArgsOut[3] = 0u;
  forestArgsOut[4] = forest.verts.y; forestArgsOut[5] = n1; forestArgsOut[6] = 0u; forestArgsOut[7] = 0u;
  forestArgsOut[8] = forest.verts.z; forestArgsOut[9] = n2; forestArgsOut[10] = 0u; forestArgsOut[11] = 0u;
  forestArgsOut[12] = forest.verts.w; forestArgsOut[13] = n3; forestArgsOut[14] = 0u; forestArgsOut[15] = 0u;
  var caps = array<u32, 4>(forest.caps.x, forest.caps.y, forest.caps.z, forest.caps.w);
  for (var k = 0u; k < 4u; k++) {
    let cand = atomicLoad(&forestCounters[4u + k]);
    let cap = caps[k];
    let goal = select(1.0, clamp(f32(cap) * 0.96 / f32(cand), 0.05, 1.0), cand > cap && cap > 0u);
    let prevRaw = atomicLoad(&forestCounters[8u + k]);
    let prev = select(f32(prevRaw) / 65536.0, 1.0, prevRaw == 0u);
    // Drop quickly on overflow so no strip forms, recover gently to avoid flicker
    let next = select(min(1.0, prev + (goal - prev) * 0.12), min(prev, goal), goal < prev);
    atomicStore(&forestCounters[8u + k], max(1u, u32(round(next * 65536.0))));
    atomicStore(&forestCounters[k], 0u);
    atomicStore(&forestCounters[4u + k], 0u);
  }
}
