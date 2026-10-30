// one mip level from the one above it (a bilinear tap at the 2×2 block centre = a box filter).
// (weft's own shaders keep their bindings in group 3: an app's shared groups reach only the shaders that include their
// declaration, so they never land here)
#include "weft/frame"
#include "weft/fullscreen"
@group(3) @binding(0) var src: texture_2d<f32>;
@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  return textureSampleLevel(src, samp_linear, i.uv, 0.0);
}
