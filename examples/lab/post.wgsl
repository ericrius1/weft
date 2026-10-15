// HDR → screen: exposure, filmic curve, vignette
#include "weft/frame"
#include "weft/fullscreen"

struct Post {
  exposure: f32,  // @range(0, 4)
  vignette: f32,  // @range(0, 1)
}
@group(1) @binding(0) var<uniform> post: Post;
@group(1) @binding(1) var hdr: texture_2d<f32>;

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let c = textureSampleLevel(hdr, samp_linear, i.uv, 0.0).rgb * post.exposure;
  var m = aces(c);
  let d = distance(i.uv, vec2f(0.5));
  m *= 1.0 - post.vignette * smoothstep(0.3, 0.9, d);
  return vec4f(pow(m, vec3f(1.0 / 2.2)), 1.0);
}
