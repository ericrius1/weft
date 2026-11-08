// The town lab's boxes (town.ts): a ground slab, houses round a courtyard (one wall red, one green, to see the light
// they bounce), lanterns that glow. Lit by loom's sun, its sky or the probes' light (ambientAt, through lightDiffuse),
// and the point lights (clustered or not), in loom's air.
#include "loom/env"

struct Box { c: vec4f, h: vec4f, col: vec4f }   // centre xyz; half size xyz; colour rgb, w its glow (0: lit)
@group(2) @binding(0) var<storage, read> boxes: array<Box>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) @interpolate(flat) id: u32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let face = vi / 6u;
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0))[vi % 6u];
  let ax = face / 2u;
  let s = select(1.0, -1.0, (face & 1u) == 1u);
  var n = vec3f(0.0); var t = vec3f(0.0); var b = vec3f(0.0);
  if (ax == 0u) { n = vec3f(s, 0.0, 0.0); t = vec3f(0.0, 0.0, -s); b = vec3f(0.0, 1.0, 0.0); }
  else if (ax == 1u) { n = vec3f(0.0, s, 0.0); t = vec3f(1.0, 0.0, 0.0); b = vec3f(0.0, 0.0, -s); }
  else { n = vec3f(0.0, 0.0, s); t = vec3f(s, 0.0, 0.0); b = vec3f(0.0, 1.0, 0.0); }
  let bx = boxes[ii];
  let p = bx.c.xyz + (n + t * c.x + b * c.y) * bx.h.xyz;
  var o: VOut;
  o.wp = p;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.n = n;
  o.id = ii;
  return o;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let bx = boxes[i.id];
  let n = normalize(i.n);
  var alb = bx.col.rgb;
  if (i.id == 0u) {
    // (the ground: paving, a fine checker — what aliases without anti-aliasing)
    let q = floor(i.wp.xz * 1.0);
    let k = (i32(q.x) + i32(q.y)) & 1;
    alb = select(vec3f(0.55, 0.53, 0.5), vec3f(0.42, 0.4, 0.38), k == 1);
  }
  var col = vec3f(0.0);
  if (bx.col.w > 0.0) { col = bx.col.rgb * bx.col.w; }
  else { col = lightDiffuse(alb, n, i.wp, i.pos.xy, 1.0, 0.0); }
  col = applyAtmosphere(col, i.wp);
  return vec4f(col, 1.0);
}
