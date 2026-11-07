// The scene's depth as metres along the view axis (r32float), for what's done after the scene (a volume's march and
// blend, rain, AO, shafts): the depth read as it is (no MSAA); 1e9 where nothing was drawn (the sky). render/scenez.ts.
#include "weft/frame"
#include "weft/fullscreen"
@group(2) @binding(0) var depth: texture_depth_2d;
@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let d = textureLoad(depth, vec2i(i.pos.xy), 0);
  return vec4f(select(1e9, linearDepth(d), d > 0.0), 0.0, 0.0, 0.0);
}
