// the ripple tank drawn as a grid mesh pulled straight from the sim's storage buffer
#include "weft/frame"

struct Water {
  size: u32,
  extent: f32,
  heightScale: f32,   // @range(0, 2)
  sunPower: f32,      // @range(0, 40)
  deep: vec3f,        // @color
  shallow: vec3f,     // @color
  sunDir: vec3f,
}
@group(1) @binding(0) var<uniform> water: Water;
@group(1) @binding(1) var<storage, read> state: array<vec2f>;

struct VOut { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) h: f32 }

fn hAt(c: vec2i) -> f32 {
  let n = i32(water.size);
  return state[u32(clamp(c.y, 0, n - 1) * n + clamp(c.x, 0, n - 1))].x * water.heightScale;
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let n = water.size;
  let quad = vi / 6u;
  let corner = vi % 6u;
  var off = array<vec2u, 6>(vec2u(0u, 0u), vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 0u), vec2u(0u, 1u), vec2u(1u, 1u));
  let c = vec2i(vec2u(quad % (n - 1u), quad / (n - 1u)) + off[corner]);
  let cell = water.extent / f32(n - 1u);
  let h = hAt(c);
  let p = vec3f((f32(c.x) / f32(n - 1u) - 0.5) * water.extent, h, (f32(c.y) / f32(n - 1u) - 0.5) * water.extent);
  let dx = hAt(c + vec2i(1, 0)) - hAt(c - vec2i(1, 0));
  let dz = hAt(c + vec2i(0, 1)) - hAt(c - vec2i(0, 1));
  var o: VOut;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.n = normalize(vec3f(-dx, 2.0 * cell, -dz));
  o.h = h;
  return o;
}

fn sky(d: vec3f) -> vec3f {
  let t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  return mix(vec3f(0.55, 0.62, 0.7), vec3f(0.12, 0.25, 0.55), t) * 1.4;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let n = normalize(i.n);
  let v = normalize(frame.camPos - i.world);
  let r = reflect(-v, n);
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  let l = normalize(water.sunDir);
  let spec = pow(max(dot(r, l), 0.0), 400.0) * water.sunPower;
  let body = mix(water.deep, water.shallow, clamp(0.5 + i.h * 2.0, 0.0, 1.0)) * (0.35 + 0.65 * max(dot(n, l), 0.0));
  let col = mix(body, sky(r), fres) + spec * vec3f(1.0, 0.92, 0.8);
  return vec4f(col, 1.0);
}

// the sky behind the tank (a fullscreen draw at the far plane)
#include "weft/fullscreen"
@fragment fn fs_sky(i: FullscreenOut) -> @location(0) vec4f {
  return vec4f(sky(viewRay(i.uv)), 1.0);
}
