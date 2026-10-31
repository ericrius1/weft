// Depth of field (loom/render/renderer.ts `dof`): a lens's blur by distance from the focus, and a tilt-shift's band
// (sharp across a stripe of the frame, blurring above and below it — the miniature look). One gather pass over the
// HDR scene: taps on a Vogel disk out to the largest blur, each taken in proportion to how far its own blur reaches
// (Gustafsson's single-pass bokeh), so a blurred foreground spills over what's behind it but a blurred background
// never bleeds over something sharp in front.
#include "weft/frame"

struct Dof {
  a: vec4f,   // focus distance (m), aperture (blur px per unit of |1 − focus/z|), max blur (px), taps
  t: vec4f,   // tilt-shift: band centre (0..1 down the frame), half width, ramp, amount (0..1)
}
@group(2) @binding(0) var<uniform> dof: Dof;
@group(2) @binding(1) var dofSrc: texture_2d<f32>;
@group(2) @binding(2) var dofDepth: texture_depth_2d;
@group(2) @binding(3) var dofOut: texture_storage_2d<rgba16float, write>;

fn dofCoc(d: f32, y: f32) -> f32 {
  let z = frame.near / max(d, 1e-7);
  let lens = dof.a.y * abs(1.0 - dof.a.x / z);
  let band = smoothstep(dof.t.y, dof.t.y + dof.t.z, abs(y - dof.t.x)) * dof.a.z;
  return min(dof.a.z, mix(lens, max(lens, band), dof.t.w));
}

@compute @workgroup_size(8, 8) fn gather(@builtin(global_invocation_id) id: vec3u) {
  let dim = vec2i(textureDimensions(dofSrc));
  let c = vec2i(id.xy);
  if (any(c >= dim)) { return; }
  let fdim = vec2f(dim);
  let center = textureLoad(dofSrc, c, 0);
  let dc = textureLoad(dofDepth, c, 0);
  let cc = dofCoc(dc, (f32(c.y) + 0.5) / fdim.y);
  let R = dof.a.z;
  let n = i32(dof.a.w);
  var acc = center.rgb;
  var tot = 1.0;
  for (var i = 0; i < n; i++) {
    let r = sqrt((f32(i) + 0.5) / f32(n)) * R;
    let ang = f32(i) * 2.39996323;
    let q = clamp(c + vec2i(round(vec2f(cos(ang), sin(ang)) * r)), vec2i(0), dim - 1);
    let ds = textureLoad(dofDepth, q, 0);
    var sc = dofCoc(ds, (f32(q.y) + 0.5) / fdim.y);
    // (behind the centre: it may blur only as much as the centre does — no bleeding over the sharp)
    if (ds < dc) { sc = min(sc, cc * 2.0); }
    let m = smoothstep(r - 0.5, r + 0.5, sc);
    acc += mix(acc / tot, textureLoad(dofSrc, q, 0).rgb, m);
    tot += 1.0;
  }
  textureStore(dofOut, c, vec4f(acc / tot, center.a));
}
