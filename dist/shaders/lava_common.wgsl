// Lava on a heightfield: what the solver (lava.wgsl, sim/lava.ts) and a host's draws share (#include "loom/lava_common") — the uniform's layout, the grid's
// cells, a cell's glow. No bindings here: each includer declares its own in its own group.
struct LavaU {
  grid: vec4f,   // x cells a side (N), y a cell (m), z, w the grid's corner (world x, z)
  step: vec4f,   // x dt (s), y time (s), z mobility (hot), w how fast mobility falls as it cools
  tune: vec4f,   // x freezing heat, y freezing rate (1/s), z the rock's cooling (1/s), w the rock's wearing away (m/s)
  cool: vec4f,   // x heat lost a second regardless, y more the thinner (heat m/s), z yield (m), w yield's rise as it cools
  lake: vec4f,   // x, z its middle (world), y its level (world y), w its radius (m; 0 none)
  eye: vec4f,    // xyz the eye (world), w the probe's cell index
  lod: vec4f,    // x near (m), y middle (m): the tiles' detail by distance
  ventN: vec4u,  // x vents
  vents: array<vec4f, 8>,   // x, z (world), radius (m), rate (m3/s)
}

const LAVA_TILE = 32u;

/** the glow of a cell's lava (a strength 0.. of a hot sheet's whole-surface glow), its crust taken into account */
fn lavaGlowOf(c: vec4f) -> f32 {
  let molten = smoothstep(0.02, 0.4, c.x) * smoothstep(0.35, 0.95, c.y);
  let rock = smoothstep(0.1, 0.9, c.w) * 0.12;
  return molten + rock;
}
