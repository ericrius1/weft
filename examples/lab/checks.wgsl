// the checks' shaders: a flat colour through the canvas encoding, as a fullscreen triangle or a rectangle, and one that
// reads the app's shared groups
#include "weft/frame"
#include "weft/fullscreen"
#include "weft/output"
#include "./checkshared"

struct Fill {
  color: vec4f,   // linear rgb, a
  rect: vec4f,    // clip-space x0 y0 x1 y1 (vs_rect)
}
@group(2) @binding(0) var<uniform> fill: Fill;
@group(2) @binding(1) var probe: texture_2d<f32>;

override P3: bool = false;

@vertex fn vs_rect(@builtin(vertex_index) vi: u32) -> FullscreenOut {
  let c = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[vi];
  var o: FullscreenOut;
  o.pos = vec4f(mix(fill.rect.xy, fill.rect.zw, c), 0.0, 1.0);
  o.uv = c;
  return o;
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f { return vec4f(canvasEncode(fill.color.rgb, P3), fill.color.a); }

// (the colour times a texel of a texture sized to the render: a bundled draw whose binding a resize reallocates)
@fragment fn fs_probe(i: FullscreenOut) -> @location(0) vec4f {
  return vec4f(canvasEncode(fill.color.rgb * textureLoad(probe, vec2i(0, 0), 0).r, P3), 1.0);
}

@fragment fn fs_shared(i: FullscreenOut) -> @location(0) vec4f {
  return vec4f(tint.color.rgb * envTint.color.a, 1.0) * textureSampleLevel(tintTex, samp_linear, i.uv, 0.0);
}
