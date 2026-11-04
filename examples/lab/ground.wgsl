// The sky lab's ground (sky.ts): plains to the east, a range rising to the west (a Front Range in miniature: peaks for
// the caps to stand over, ridges for the heaps to ride up over), drawn as rings round the camera — fine underfoot,
// coarse far off — lit by loom's sun, sky and the clouds' shadows, in loom's air. groundAt matches sky.ts ground().
#include "loom/env"

const RINGS = 160u;
const SEGS = 256u;

fn groundAt(p: vec2f) -> f32 {
  let range = 1.0 - smoothstep(-9000.0, -2000.0, p.x);
  let ridge = 0.55 + 0.45 * sin(p.y / 2300.0 + sin(p.x / 3100.0) * 1.7) * cos(p.x / 1900.0 + 0.7);
  return 60.0 + 25.0 * sin(p.x / 900.0) * cos(p.y / 1300.0) + range * 1900.0 * ridge;
}

struct GOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> GOut {
  let quad = vi / 6u;
  let corner = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(0u, 1u), vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 1u))[vi % 6u];
  let ring = quad / SEGS + corner.y;
  let seg = quad % SEGS + corner.x;
  // (rings 4 m apart at the eye, growing out to ~60 km)
  let r = select(4.0 * (exp(f32(ring) * 0.04) - 1.0) / 0.04, 0.0, ring == 0u);
  let a = f32(seg) / f32(SEGS) * TAU;
  let xz = frame.camPos.xz + vec2f(cos(a), sin(a)) * r;
  let e = max(r * 0.01, 2.0);
  let h = groundAt(xz);
  let n = normalize(vec3f(groundAt(xz - vec2f(e, 0.0)) - groundAt(xz + vec2f(e, 0.0)), 2.0 * e, groundAt(xz - vec2f(0.0, e)) - groundAt(xz + vec2f(0.0, e))));
  var o: GOut;
  // (the earth's curve: far ground sinks below the horizon)
  let d = r;
  o.wp = vec3f(xz.x, h - d * d / (2.0 * 6.371e6), xz.y);
  o.pos = frame.viewProj * vec4f(o.wp, 1.0);
  o.n = n;
  return o;
}

@fragment fn fs(i: GOut) -> @location(0) vec4f {
  let n = normalize(i.n);
  // (grass on the plains and the gentle slopes, rock on the steep, a little snow high up)
  let slope = 1.0 - n.y;
  var albedo = mix(vec3f(0.16, 0.2, 0.08), vec3f(0.22, 0.2, 0.17), smoothstep(0.15, 0.4, slope));
  albedo = mix(albedo, vec3f(0.12, 0.15, 0.08), smoothstep(400.0, 900.0, i.wp.y) * (1.0 - smoothstep(0.2, 0.4, slope)));
  albedo = mix(albedo, vec3f(0.8, 0.82, 0.85), smoothstep(1700.0, 1900.0, i.wp.y) * (1.0 - smoothstep(0.3, 0.5, slope)));
  let col = lightDiffuse(albedo, n, i.wp, i.pos.xy, 1.0, 0.0);
  return vec4f(applyAtmosphere(col, i.wp), 1.0);
}
