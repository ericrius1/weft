// Conservative min/max hierarchical linear-depth (Hi-Z) pyramid builder (`hiz.ts`).
// Reads integer texels via textureLoad (no float32-filterable dependency) and includes the extra trailing
// row/column when the source dimension is odd so min/max bounds remain strictly conservative at screen edges.
// Output format: rg16float (r = minZ nearest, g = maxZ farthest; sky clamped to HIZ_MAX_Z to stay finite in f16).
#include "weft/frame"
#include "weft/fullscreen"

@group(3) @binding(0) var src: texture_2d<f32>;

const HIZ_MAX_Z = 65000.0;

fn clampZ(z: f32) -> f32 {
  return clamp(z, 0.0, HIZ_MAX_Z);
}

@fragment fn first(i: FullscreenOut) -> @location(0) vec4f {
  let sDim = vec2i(textureDimensions(src));
  let p = vec2i(i.pos.xy) * 2;
  let m = sDim - 1;
  let z00 = clampZ(textureLoad(src, clamp(p, vec2i(0), m), 0).x);
  let z10 = clampZ(textureLoad(src, clamp(p + vec2i(1, 0), vec2i(0), m), 0).x);
  let z01 = clampZ(textureLoad(src, clamp(p + vec2i(0, 1), vec2i(0), m), 0).x);
  let z11 = clampZ(textureLoad(src, clamp(p + vec2i(1, 1), vec2i(0), m), 0).x);
  var lo = min(min(z00, z10), min(z01, z11));
  var hi = max(max(z00, z10), max(z01, z11));
  let oddX = (sDim.x & 1) != 0 && (p.x + 2 == m.x);
  let oddY = (sDim.y & 1) != 0 && (p.y + 2 == m.y);
  if (oddX) {
    let a = clampZ(textureLoad(src, clamp(p + vec2i(2, 0), vec2i(0), m), 0).x);
    let b = clampZ(textureLoad(src, clamp(p + vec2i(2, 1), vec2i(0), m), 0).x);
    lo = min(lo, min(a, b));
    hi = max(hi, max(a, b));
  }
  if (oddY) {
    let a = clampZ(textureLoad(src, clamp(p + vec2i(0, 2), vec2i(0), m), 0).x);
    let b = clampZ(textureLoad(src, clamp(p + vec2i(1, 2), vec2i(0), m), 0).x);
    lo = min(lo, min(a, b));
    hi = max(hi, max(a, b));
  }
  if (oddX && oddY) {
    let c = clampZ(textureLoad(src, clamp(p + vec2i(2, 2), vec2i(0), m), 0).x);
    lo = min(lo, c);
    hi = max(hi, c);
  }
  return vec4f(lo, hi, 0.0, 1.0);
}

@fragment fn down(i: FullscreenOut) -> @location(0) vec4f {
  let sDim = vec2i(textureDimensions(src));
  let p = vec2i(i.pos.xy) * 2;
  let m = sDim - 1;
  let a00 = textureLoad(src, clamp(p, vec2i(0), m), 0).rg;
  let a10 = textureLoad(src, clamp(p + vec2i(1, 0), vec2i(0), m), 0).rg;
  let a01 = textureLoad(src, clamp(p + vec2i(0, 1), vec2i(0), m), 0).rg;
  let a11 = textureLoad(src, clamp(p + vec2i(1, 1), vec2i(0), m), 0).rg;
  var lo = min(min(a00.x, a10.x), min(a01.x, a11.x));
  var hi = max(max(a00.y, a10.y), max(a01.y, a11.y));
  let oddX = (sDim.x & 1) != 0 && (p.x + 2 == m.x);
  let oddY = (sDim.y & 1) != 0 && (p.y + 2 == m.y);
  if (oddX) {
    let e0 = textureLoad(src, clamp(p + vec2i(2, 0), vec2i(0), m), 0).rg;
    let e1 = textureLoad(src, clamp(p + vec2i(2, 1), vec2i(0), m), 0).rg;
    lo = min(lo, min(e0.x, e1.x));
    hi = max(hi, max(e0.y, e1.y));
  }
  if (oddY) {
    let e0 = textureLoad(src, clamp(p + vec2i(0, 2), vec2i(0), m), 0).rg;
    let e1 = textureLoad(src, clamp(p + vec2i(1, 2), vec2i(0), m), 0).rg;
    lo = min(lo, min(e0.x, e1.x));
    hi = max(hi, max(e0.y, e1.y));
  }
  if (oddX && oddY) {
    let c = textureLoad(src, clamp(p + vec2i(2, 2), vec2i(0), m), 0).rg;
    lo = min(lo, c.x);
    hi = max(hi, c.y);
  }
  return vec4f(lo, hi, 0.0, 1.0);
}
