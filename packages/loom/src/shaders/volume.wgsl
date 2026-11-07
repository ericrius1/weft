// A volume in the air marched at a fraction of the resolution and laid over the scene at full resolution — a marine
// layer, a valley's mist, smoke, dust — for a world with its own renderer (render/volume.ts runs it). San Francisco's
// fog's frame, with nothing of the fog in it. Each frame:
//   march       at a fraction of the resolution: each pixel's depth picked from the scene pixels under it, then the
//               world's own march along its ray (volumeMarch, below) to that depth: light and transmittance
//   accumulate  that blended with the last frames' wherever the same place was seen (reprojected by the depth),
//               clamped to what's round it now so no ghost lingers where the scene moved
//   blend       onto the scene at full resolution, each pixel taking the low-res samples nearest it in depth
//               (premultiplied: rgb added, the scene times alpha)
//
// A library: the including shader defines
//   fn volumeMarch(px: vec2f, uv: vec2f, z: f32) -> vec4f   the light scattered toward the eye along the ray through
//                                                          low-res pixel px (uv 0..1 on the screen) up to view-axis
//                                                          depth z (m; > 1e8 the sky), and the transmittance (alpha)
// then `#include "loom/volume"`. Its group 2: 0 the VolumeU, 1 the scene's distance (r32float, metres along the view
// axis, large for the sky), 2..5 the march's targets and the history; 6 and up are the world's own.
#include "weft/frame"
#include "weft/fullscreen"

struct VolumeU {
  march: vec4f,              // x steps, y the target's share of the render, z history weight (0: none), w frame (0..63)
  res: vec4f,                // xy the target's size, zw 1 / that
  far: vec4f,                // x the farthest the march reaches (m): the sky's and anything past it are taken as there
  user: array<vec4f, 4>,     // the world's own, for its march (an interior's box, its own knobs)
}
@group(2) @binding(0) var<uniform> V: VolumeU;
@group(2) @binding(1) var volSceneZ: texture_2d<f32>;
@group(2) @binding(2) var volNew: texture_2d<f32>;
@group(2) @binding(3) var volNewZ: texture_2d<f32>;
@group(2) @binding(4) var volPrev: texture_2d<f32>;
@group(2) @binding(5) var volAcc: texture_2d<f32>;

// ------------------------------------------------------------------ the march
struct VolumeMarchOut { @location(0) c: vec4f, @location(1) z: vec4f }

@fragment fn march(i: FullscreenOut) -> VolumeMarchOut {
  var o: VolumeMarchOut;
  let dims = vec2f(textureDimensions(volSceneZ));
  // (this pixel's depth, from every scene pixel under it: the nearest where near things fill at least half of it — a
  // near edge keeps its volume sharp — and the farthest where they don't, so a wire a pixel wide takes the volume of
  // what's behind it, evenly, rather than lending its own to the sky round it in blocks)
  let lo = min(vec2i(floor((i.pos.xy - 0.5) * V.res.zw * dims)), vec2i(dims) - 1);
  let hi = min(vec2i(ceil((i.pos.xy + 0.5) * V.res.zw * dims)) - 1, min(lo + 3, vec2i(dims) - 1));
  var zn = 1e30;
  var zf = 0.0;
  for (var y = lo.y; y <= hi.y; y++) {
    for (var x = lo.x; x <= hi.x; x++) { let s = textureLoad(volSceneZ, vec2i(x, y), 0).r; zn = min(zn, s); zf = max(zf, s); }
  }
  var nearN = 0;
  var cells = 0;
  for (var y = lo.y; y <= hi.y; y++) {
    for (var x = lo.x; x <= hi.x; x++) { nearN += select(0, 1, textureLoad(volSceneZ, vec2i(x, y), 0).r < zn * 1.15 + 1.0); cells += 1; }
  }
  let z = select(zf, zn, nearN * 2 >= cells);
  o.z = vec4f(z, 0.0, 0.0, 0.0);
  o.c = volumeMarch(i.pos.xy, i.uv, z);
  return o;
}

// ------------------------------------------------------------------ the history
@fragment fn accumulate(i: FullscreenOut) -> @location(0) vec4f {
  let cur = textureSampleLevel(volNew, samp_linear, i.uv, 0.0);
  if (V.march.z <= 0.0) { return cur; }
  let far = V.far.x;
  let z = textureLoad(volNewZ, vec2i(i.uv * vec2f(textureDimensions(volNewZ))), 0).r;
  let rd = viewRay(i.uv);
  let dist = select(min(z / max(dot(rd, frame.camFwd), 1e-4), far), far, z > 1e8);
  let p = frame.camPos + rd * dist;
  let prev = frame.prevViewProj * vec4f(p, 1.0);
  let uv = vec2f(prev.x / prev.w * 0.5 + 0.5, 0.5 - prev.y / prev.w * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || prev.w <= 0.0) { return cur; }
  let h = textureSampleLevel(volPrev, samp_linear, uv, 0.0);
  // (clamped to what's round it now: no ghost lingers where the scene moved)
  let d = V.res.zw;
  var lo = cur;
  var hi = cur;
  for (var k = 0; k < 4; k++) {
    let o = vec2f(f32(k & 1) * 2.0 - 1.0, f32(k >> 1) * 2.0 - 1.0) * d;
    let s = textureSampleLevel(volNew, samp_linear, i.uv + o, 0.0);
    lo = min(lo, s);
    hi = max(hi, s);
  }
  return mix(cur, clamp(h, lo, hi), V.march.z);
}

// ------------------------------------------------------------------ onto the scene
@fragment fn blend(i: FullscreenOut) -> @location(0) vec4f {
  let far = V.far.x;
  let z = textureLoad(volSceneZ, vec2i(i.pos.xy), 0).r;
  let dims = vec2f(textureDimensions(volAcc));
  let g = i.uv * dims - 0.5;
  let b = floor(g);
  let f = g - b;
  var acc = vec4f(0.0);
  var wsum = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2f(f32(k & 1), f32(k >> 1));
    let q = vec2i(clamp(b + o, vec2f(0.0), dims - 1.0));
    let zq = textureLoad(volNewZ, q, 0).r;
    let bil = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
    let dz = abs(min(zq, far) - min(z, far)) / max(min(z, far), 1.0);
    let w = bil * (1.0 / (dz * 40.0 + 0.02)) + 1e-5;
    acc += textureLoad(volAcc, q, 0) * w;
    wsum += w;
  }
  return acc / wsum;
}
