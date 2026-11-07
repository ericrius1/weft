// The scene's depth as metres along the view axis (r32float) from a 4x multisampled depth: its nearest sample; 1e9
// where nothing was drawn (the sky). render/scenez.ts.
#include "weft/frame"
#include "weft/fullscreen"
@group(2) @binding(0) var depth: texture_depth_multisampled_2d;
@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let p = vec2i(i.pos.xy);
  let d = max(max(textureLoad(depth, p, 0), textureLoad(depth, p, 1)), max(textureLoad(depth, p, 2), textureLoad(depth, p, 3)));
  return vec4f(select(1e9, linearDepth(d), d > 0.0), 0.0, 0.0, 0.0);
}
