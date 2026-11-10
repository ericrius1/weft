// Ink lines (loom/render/outline.ts): drawn over the frame where the depth says there's an edge — a silhouette
// against what's behind, or a crease where two faces meet. Reversed-Z depth is 1/z: linear across any plane on
// screen, so its second difference is zero on every face whatever the angle and spikes on creases and silhouettes —
// one test for both. The line wobbles a little and is redrawn a few times a second, like a hand's (line boil); far off
// the lines thin away.
#include "weft/frame"
#include "weft/fullscreen"

struct OutlineU {
  ink: vec4f,    // rgb the ink, a its strength
  p: vec4f,      // x width (px), y crease threshold, z silhouette threshold, w boil (redraws a second)
  fade: vec4f,   // x lines start fading (m), y gone by (m), z wobble (px)
}
@group(2) @binding(0) var<uniform> O: OutlineU;
@group(2) @binding(1) var sceneDepth: texture_depth_2d;

fn oh(p: vec2f) -> f32 { var q = fract(vec3f(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn od(p: vec2i) -> f32 {
  let dim = vec2i(textureDimensions(sceneDepth));
  return textureLoad(sceneDepth, clamp(p, vec2i(0), dim - 1), 0);
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let px = i.pos.xy;
  let dc = od(vec2i(px));
  // the hand's wobble: a little offset per few pixels, redrawn at the boil rate
  let boil = floor(frame.time * O.p.w);
  let cellp = floor(px / 6.0);
  let jit = (vec2f(oh(cellp + boil * 7.1), oh(cellp + 13.7 + boil * 3.3)) - 0.5) * O.fade.z;
  let w = O.p.x * (0.85 + 0.3 * oh(cellp * 1.7 + boil));
  let q = px + jit;
  let l = od(vec2i(q + vec2f(-w, 0.0))); let r = od(vec2i(q + vec2f(w, 0.0)));
  let u = od(vec2i(q + vec2f(0.0, -w))); let b = od(vec2i(q + vec2f(0.0, w)));
  let mx = max(max(max(l, r), max(u, b)), dc);
  if (mx <= 0.0) { return vec4f(0.0); }
  // silhouettes: a step in 1/z (relative to the nearer side); creases: its second difference
  let step1 = max(max(abs(l - dc), abs(r - dc)), max(abs(u - dc), abs(b - dc))) / mx;
  let lap = (abs(l + r - 2.0 * dc) + abs(u + b - 2.0 * dc)) / mx;
  let sil = smoothstep(O.p.z, O.p.z * 1.6, step1);
  let crease = smoothstep(O.p.y, O.p.y * 1.8, lap) * 0.75;
  var e = max(sil, crease);
  // (far off, thinner: the nearer side's distance)
  let z = frame.near / mx;
  e *= 1.0 - smoothstep(O.fade.x, O.fade.y, z);
  if (e <= 0.003) { return vec4f(0.0); }
  return vec4f(O.ink.rgb * e * O.ink.a, e * O.ink.a);
}
