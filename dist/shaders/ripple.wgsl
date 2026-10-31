// The ripple sim: a wave-equation height field over a window that follows the player, stored toroidally (a world
// cell always lands in the same texel, so the window can slide without moving data; cells that just came into the
// window start flat). x = height now, y = height a step ago, z = foam.
struct Ripple {
  origin: vec2i,       // the window's first cell (world cells)
  prevOrigin: vec2i,
  size: u32,           // texels per side
  cell: f32,           // metres per texel
  damping: f32,        // @range(0.95, 1.0, 0.001)
  speed: f32,          // @range(0.05, 0.5)
  impulses: array<vec4f, 16>,   // x, z, radius (m), strength (m; negative pushes down)
  count: u32,
  pad: vec3u,
}
@group(2) @binding(0) var<uniform> ripple: Ripple;
@group(2) @binding(1) var src: texture_2d<f32>;
@group(2) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

fn wrapT(c: vec2i) -> vec2i { let n = i32(ripple.size); return ((c % n) + n) % n; }
// the world cell a texel holds for a given window origin
fn cellOf(t: vec2i, origin: vec2i) -> vec2i {
  let n = i32(ripple.size);
  let o = wrapT(origin);
  return origin + wrapT(t - o);
}
fn at(t: vec2i) -> vec4f { return textureLoad(src, wrapT(t), 0); }

@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ripple.size || id.y >= ripple.size) { return; }
  let t = vec2i(id.xy);
  let cell = cellOf(t, ripple.origin);
  // a cell that wasn't in last frame's window starts still
  if (any(cell != cellOf(t, ripple.prevOrigin))) { textureStore(dst, t, vec4f(0.0)); return; }
  let c = at(t);
  let lap = at(t + vec2i(1, 0)).x + at(t - vec2i(1, 0)).x + at(t + vec2i(0, 1)).x + at(t - vec2i(0, 1)).x - 4.0 * c.x;
  var h = (2.0 * c.x - c.y + ripple.speed * lap) * ripple.damping;
  var foam = c.z * 0.985;
  let wp = (vec2f(cell) + 0.5) * ripple.cell;
  for (var k = 0u; k < ripple.count; k++) {
    let im = ripple.impulses[k];
    let d = length(wp - im.xy);
    let f = exp(-d * d / max(im.z * im.z, 1e-3));
    h += im.w * f;
    foam = min(1.0, foam + abs(im.w) * f * 6.0);
  }
  // the edge of the window fades so nothing reflects off it
  let n = f32(ripple.size);
  let e = vec2f(cell - ripple.origin) / n;
  let edge = smoothstep(0.0, 0.08, min(min(e.x, 1.0 - e.x), min(e.y, 1.0 - e.y)));
  h *= mix(0.9, 1.0, edge);
  foam += clamp(abs(lap) * 3.0 - 0.02, 0.0, 0.05);
  textureStore(dst, t, vec4f(clamp(h, -2.0, 2.0), c.x, clamp(foam, 0.0, 1.0), 0.0));
}
