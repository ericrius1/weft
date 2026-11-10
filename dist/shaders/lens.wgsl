// The lens (after the tone map, ported from waterbending's looks.wgsl film stages): a film stock's red-orange halation
// round the highlights, the glass's chromatic fringes and a touch of barrel toward the corners, a little sharpening
// (the grain and the scaled-up render want it), and scope bars for a letterboxed picture. One pass; the composite's
// grade, vignette and grain have already run. Off unless the renderer's `lens.on`.
#include "./globals"
#include "weft/fullscreen"

struct Lens {
  a: vec4f,   // x halation strength, y its radius (px at 1080), z its threshold (display luma), w chromatic aberration
  b: vec4f,   // x barrel, y letterbox aspect (0: none), z sharpen, w time
  c: vec4f,   // xy the source's size, zw 1 / that
  d: vec4f,   // x halation warmth (0 white … 1 red-orange), y lift of the bars (0 black), zw spare
}
@group(2) @binding(0) var<uniform> LN: Lens;
@group(2) @binding(1) var lensSrc: texture_2d<f32>;

fn lumaL(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn tapL(uv: vec2f) -> vec3f { return textureSampleLevel(lensSrc, samp_linear, uv, 0.0).rgb; }

@fragment fn fs_lens(i: FullscreenOut) -> @location(0) vec4f {
  let uv = i.uv;
  let px = LN.c.zw;
  let k1080 = LN.c.y / 1080.0;
  // the glass: barrel toward the corners, the colours parting a little more the further out
  let q = uv - 0.5;
  let r2 = dot(q, q);
  let qd = q * (1.0 + LN.b.x * r2);
  let ab = LN.a.w * 0.012 * r2;
  var c = vec3f(tapL(0.5 + qd * (1.0 + ab)).r, tapL(0.5 + qd).g, tapL(0.5 + qd * (1.0 - ab)).b);
  // sharpening against the four neighbours
  if (LN.b.z > 0.0) {
    let u0 = 0.5 + qd;
    let nb = (tapL(u0 + vec2f(px.x, 0.0)) + tapL(u0 - vec2f(px.x, 0.0)) + tapL(u0 + vec2f(0.0, px.y)) + tapL(u0 - vec2f(0.0, px.y))) * 0.25;
    c = c + (c - nb) * LN.b.z;
  }
  // halation: the highlights' light scattered back through the film's base — red-orange, soft, screened on
  if (LN.a.x > 0.0) {
    var acc = vec3f(0.0); var ws = 0.0;
    let R = LN.a.y * k1080;
    for (var s = 0; s < 20; s++) {
      let f = (f32(s) + 0.5) / 20.0;
      let a = f32(s) * 2.39996;
      let o = vec2f(cos(a), sin(a)) * R * sqrt(f) * px;
      let t = tapL(uv + o);
      let k = smoothstep(LN.a.z, 1.0, lumaL(t));
      let w = 1.0 - f * 0.7;
      acc += t * k * w; ws += w;
    }
    let tint = mix(vec3f(1.0), vec3f(1.0, 0.42, 0.16), LN.d.x);
    let glow = acc / ws * tint * LN.a.x;
    c = 1.0 - (1.0 - clamp(c, vec3f(0.0), vec3f(1.0))) * (1.0 - glow);
  }
  // scope bars
  if (LN.b.y > 0.0) {
    let asp = LN.c.x / LN.c.y;
    let bar = max(0.0, (1.0 - asp / LN.b.y) * 0.5);
    let e = px.y;
    let m = smoothstep(bar - e, bar + e, uv.y) * smoothstep(bar - e, bar + e, 1.0 - uv.y);
    c = mix(vec3f(LN.d.y), c, m);
  }
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}
