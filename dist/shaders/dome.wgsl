// The fulldome stitch (src/dome.ts): six perspective tiles of one moment into a 180-degree equidistant fisheye, the
// zenith at the centre, the heading at the bottom rim and its right on the right (a planetarium's domemaster). Each
// output pixel is four sub-pixel taps; each tap is the direction through it, looked up in every tile that sees it,
// weighted by how far inside its own cube-face half it lies (feathered across the margin the tiles overlap by), so no
// seam shows where one view's screen-space effects (bloom, AO) stop and the next one's begin.
// (weft's own shaders keep their bindings in group 3)
#include "weft/frame"
#include "weft/fullscreen"

struct DomeU {
  // the heading's forward (xyz) and the output's size in pixels
  fwd: vec4f,
  // the heading's right, and the tiles' tangent half-width (x at their left and right edges)
  right: vec4f,
  // the tiles' tangent extents: y at the top edge, y at the bottom edge, the core's edge (1: a cube face's), unused
  ext: vec4f,
  // each tile's camera basis: right, up, forward (w unused)
  basis: array<vec4f, 18>,
}

@group(3) @binding(0) var<uniform> DU: DomeU;
@group(3) @binding(1) var tiles: texture_2d_array<f32>;

const HALF_PI = 1.5707963267948966;

// the colour the tiles see along d (rgb), and their summed weight (a)
fn domeLook(d: vec3f) -> vec4f {
  let ax = DU.right.w;
  let y1 = DU.ext.x;
  let y0 = DU.ext.y;
  let core = DU.ext.z;
  var acc = vec4f(0.0);
  for (var k = 0u; k < 6u; k++) {
    let r = DU.basis[k * 3u].xyz;
    let u = DU.basis[k * 3u + 1u].xyz;
    let f = DU.basis[k * 3u + 2u].xyz;
    let df = dot(d, f);
    if (df <= 1e-4) { continue; }
    let x = dot(d, r) / df;
    let y = dot(d, u) / df;
    if (abs(x) > ax || y > y1 || y < y0) { continue; }
    // (inside the cube face's half: full weight; out across the margin it overlaps the next tile by: down to none)
    let w = smoothstep(0.0, ax - core, ax - abs(x)) * smoothstep(0.0, y1 - core, y1 - y) * smoothstep(0.0, -2.0 * y0, y - y0);
    if (w <= 0.0) { continue; }
    let uv = vec2f(0.5 + 0.5 * x / ax, (y1 - y) / (y1 - y0));
    acc += vec4f(textureSampleLevel(tiles, samp_linear, uv, k, 0.0).rgb * w, w);
  }
  return acc;
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let n = DU.fwd.w;
  let px = i.uv * n;
  var sum = vec3f(0.0);
  // four taps on a rotated grid, a quarter-pixel each way
  let taps = array<vec2f, 4>(vec2f(-0.125, -0.375), vec2f(0.375, -0.125), vec2f(0.125, 0.375), vec2f(-0.375, 0.125));
  for (var t = 0u; t < 4u; t++) {
    let p = (px + taps[t]) / n - 0.5;
    let rho = length(p) * 2.0;
    if (rho > 1.0) { continue; }
    let theta = rho * HALF_PI;
    let phi = atan2(p.x, p.y);
    let d = normalize(vec3f(0.0, cos(theta), 0.0) + (DU.fwd.xyz * cos(phi) + DU.right.xyz * sin(phi)) * sin(theta));
    let c = domeLook(d);
    if (c.a > 0.0) { sum += c.rgb / c.a; }
  }
  return vec4f(sum * 0.25, 1.0);
}
