// the debug overlay's texture viewer: draws any texture into a corner of the screen
#include "weft/fullscreen"

struct Viewer {
  lo: f32, hi: f32,
  channel: u32,   // 0 rgb · 1 r · 2 g · 3 b · 4 a
  mip: u32,
}
@group(3) @binding(0) var<uniform> viewer: Viewer;
@group(3) @binding(1) var tex: texture_2d<f32>;
@group(3) @binding(2) var dtex: texture_depth_2d;
@group(3) @binding(3) var utex: texture_2d<u32>;

fn show(c: vec4f) -> vec4f {
  var v = (c - viewer.lo) / max(viewer.hi - viewer.lo, 1e-6);
  switch viewer.channel {
    case 1u: { v = vec4f(v.rrr, 1.0); }
    case 2u: { v = vec4f(v.ggg, 1.0); }
    case 3u: { v = vec4f(v.bbb, 1.0); }
    case 4u: { v = vec4f(v.aaa, 1.0); }
    default: {}
  }
  return vec4f(pow(clamp(v.rgb, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), 1.0);
}

@fragment fn fs_float(i: FullscreenOut) -> @location(0) vec4f {
  let d = vec2f(textureDimensions(tex, viewer.mip));
  return show(textureLoad(tex, vec2i(i.uv * d), i32(viewer.mip)));
}
@fragment fn fs_depth(i: FullscreenOut) -> @location(0) vec4f {
  let d = vec2f(textureDimensions(dtex, 0));
  let z = textureLoad(dtex, vec2i(i.uv * d), 0);
  return show(vec4f(z, z, z, 1.0));
}
@fragment fn fs_uint(i: FullscreenOut) -> @location(0) vec4f {
  let d = vec2f(textureDimensions(utex, 0));
  return show(vec4f(textureLoad(utex, vec2i(i.uv * d), 0)));
}
