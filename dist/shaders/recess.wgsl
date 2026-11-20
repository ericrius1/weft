// Architectural opening recess parallax (`#include "loom/recess"`): traces a view ray into a rectangular opening
// of depth `depth` behind a flat facade wall, returning whether it hits the back pane or one of the four reveal faces
// (left/right jamb, sill, head), plus analytic sunlight visibility through the opening and the reveal face's normal.
//
// Coordinates are in the wall face's local frame (metres): x along the wall tangent `t3`, y up, z into the wall for
// the view ray `d` (and z out of the wall for the sun direction `ls`).

/** result of tracing into a recessed opening:
 *  hit: 0 back face, 1 left jamb (-x), 2 right jamb (+x), 3 sill (-y), 4 head (+y);
 *  b: 2D hit point in the wall plane; t: depth into the wall (0..depth) */
struct Rec { hit: u32, b: vec2f, t: f32 }

fn recess(q: vec2f, lo: vec2f, hi: vec2f, depth: f32, d: vec3f) -> Rec {
  var r: Rec;
  let s = clamp(d.xy / max(d.z, 0.05), vec2f(-12.0), vec2f(12.0));
  var tx = 1e9;
  var ty = 1e9;
  if (s.x > 1e-5) { tx = (hi.x - q.x) / s.x; } else if (s.x < -1e-5) { tx = (lo.x - q.x) / s.x; }
  if (s.y > 1e-5) { ty = (hi.y - q.y) / s.y; } else if (s.y < -1e-5) { ty = (lo.y - q.y) / s.y; }
  let t = max(min(min(tx, ty), depth), 0.0);
  r.t = t;
  r.b = q + s * t;
  r.hit = 0u;
  if (t < depth) {
    if (tx < ty) { r.hit = select(1u, 2u, s.x > 0.0); } else { r.hit = select(3u, 4u, s.y > 0.0); }
  }
  return r;
}

/** sun visibility into a recess: whether point `b` at depth `t` sees the sun through opening `lo..hi`
 *  (`ls`: sun direction in the face's frame, z out of the wall), softened over a few centimetres */
fn recessLit(b: vec2f, t: f32, lo: vec2f, hi: vec2f, ls: vec3f) -> f32 {
  if (ls.z <= 0.01) { return 0.0; }
  let f = b + ls.xy / ls.z * t;
  let e = min(min(f.x - lo.x, hi.x - f.x), min(f.y - lo.y, hi.y - f.y));
  return smoothstep(-0.015, 0.015, e);
}

/** world-space normal of a recess reveal face: jambs face inward along `t3`, sill faces up, head faces down */
fn recessNormal(hit: u32, n: vec3f, t3: vec3f) -> vec3f {
  switch (hit) {
    case 1u: { return t3; }
    case 2u: { return -t3; }
    case 3u: { return vec3f(0.0, 1.0, 0.0); }
    case 4u: { return vec3f(0.0, -1.0, 0.0); }
    default: { return n; }
  }
}
