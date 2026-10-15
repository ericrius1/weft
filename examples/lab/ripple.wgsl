// a wave-equation ripple tank: state.x = height now, state.y = height a step ago
struct Sim {
  size: u32,
  damping: f32,     // @range(0.95, 1.0, 0.0005)
  speed: f32,       // @range(0.02, 0.5)
  dropRadius: f32,  // @range(1, 24)
  drop: vec4f,      // xy cell, z strength, w on/off
}
@group(1) @binding(0) var<uniform> sim: Sim;
@group(1) @binding(1) var<storage, read> prev: array<vec2f>;
@group(1) @binding(2) var<storage, read_write> next: array<vec2f>;

fn at(x: i32, y: i32) -> f32 {
  let n = i32(sim.size);
  return prev[u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1))].x;
}

@compute @workgroup_size(8, 8)
fn step(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= sim.size || id.y >= sim.size) { return; }
  let x = i32(id.x);
  let y = i32(id.y);
  let c = prev[id.y * sim.size + id.x];
  let lap = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4.0 * c.x;
  var h = (2.0 * c.x - c.y + sim.speed * lap) * sim.damping;
  let d = vec2f(id.xy) - sim.drop.xy;
  h += sim.drop.w * sim.drop.z * exp(-dot(d, d) / (sim.dropRadius * sim.dropRadius));
  next[id.y * sim.size + id.x] = vec2f(h, c.x);
}
