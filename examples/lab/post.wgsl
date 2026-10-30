// HDR → screen: exposure, filmic curve, vignette, then the canvas's own encoding (weft/output). On an HDR canvas
// (the lab's ?hdr) highlights keep rising past white towards PEAK instead of flattening there.
#include "weft/frame"
#include "weft/fullscreen"
#include "weft/output"

struct Post {
  exposure: f32,  // @range(0, 4)
  vignette: f32,  // @range(0, 1)
}
@group(1) @binding(0) var<uniform> post: Post;
@group(1) @binding(1) var hdr: texture_2d<f32>;

// kit.hdr: an HDR canvas, and a Display P3 one
override HDR: bool = false;
override P3: bool = false;
const PEAK = 4.0;

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let c = textureSampleLevel(hdr, samp_linear, i.uv, 0.0).rgb * post.exposure;
  var m = aces(c);
  if (HDR) {
    let over = max(c - vec3f(1.0), vec3f(0.0));
    m += (PEAK - 1.0) * over / (over + vec3f(PEAK - 1.0));
  }
  let d = distance(i.uv, vec2f(0.5));
  m *= 1.0 - post.vignette * smoothstep(0.3, 0.9, d);
  return vec4f(canvasEncode(m, P3), 1.0);
}
