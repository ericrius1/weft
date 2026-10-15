// Rain (loom/render/rain.ts): drops falling through a box round the camera — fixed in the world as the camera moves
// (each wraps round the box), streaked by their motion relative to the camera (driving into the rain draws them out
// into lines), lit only by what they fall through: the lamps and headlights (brightest back-lit: a drop throws light
// forward), the lightning, a little of the sky. And splashes: each placed on whatever surface the eye sees at a random
// spot of the screen (the scene's own depth says where) — road, roofs, bonnets — a quick crown of spray.
#include "./env"

struct RainU {
  box: vec4f,     // xyz the box's size (m), w drops
  fall: vec4f,    // xyz the drops' velocity (m/s: wind and fall), w how hard it's raining (0..1)
  cam: vec4f,     // xyz the camera's velocity (m/s), w the streaks' exposure (s)
  misc: vec4f,    // x time, y splashes, z a drop's width (m), w splash lifetime (s)
}
@group(2) @binding(0) var<uniform> R: RainU;
@group(2) @binding(1) var sceneDepth: texture_depth_2d;

fn rh(i: u32) -> f32 { var v = i * 747796405u + 2891336453u; v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return f32((v >> 22u) ^ v) / 4294967295.0; }

/** the light a drop at p throws toward the eye: the lamps (a forward lobe — back-lit drops glint), the sky's dim grey */
fn dropLight(p: vec3f, toEye: vec3f) -> vec3f {
  return pointLightsIn(p, toEye, 0.65) * 0.75 + pointLightsIn(p, toEye, 0.0) * 0.25 + shIrradiance(vec3f(0.0, 1.0, 0.0)) * 0.6;
}

struct DOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f }
@vertex fn vs_drop(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DOut {
  var o: DOut;
  o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
  let B = R.box.xyz;
  let base = vec3f(rh(ii * 3u), rh(ii * 3u + 1u), rh(ii * 3u + 2u));
  // (each drop its own speed; the column it falls in, wrapped round the box that rides with the camera)
  let sp = 0.85 + 0.3 * rh(ii * 7u + 5u);
  let q = base * B + R.fall.xyz * sp * R.misc.x;
  let p = frame.camPos + (fract((q - frame.camPos) / B + 0.5) - 0.5) * B;
  // the streak: along the motion relative to the camera, as long as the exposure draws it
  let rel = R.fall.xyz * sp - R.cam.xyz;
  let toCam = frame.camPos - p;
  let dist = length(toCam);
  let tc = toCam / max(dist, 1e-3);
  let v = rel - dot(rel, tc) * tc;
  let vl = length(v);
  let up = select(vec3f(0.0, 1.0, 0.0), v / max(vl, 1e-4), vl > 0.01);
  let right = normalize(cross(up, toCam));
  let len = max(vl * R.cam.w, 0.05);
  // (never thinner than a pixel; widened, its light spread thinner)
  let px = dist / (frame.proj[1][1] * frame.res.y * 0.5);
  let w = max(R.misc.z, px * 0.8);
  var q4 = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let c = q4[vi];
  let wp = p + right * c.x * w + up * c.y * len * 0.5;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  // (thinned out by how hard it's raining; faded at the box's edges and right at the eye)
  let keep = step(rh(ii * 11u + 3u), R.fall.w);
  let edge = 1.0 - smoothstep(0.3, 0.5, max(max(abs(p.x - frame.camPos.x) / B.x, abs(p.y - frame.camPos.y) / B.y), abs(p.z - frame.camPos.z) / B.z));
  let k = keep * edge * smoothstep(0.4, 1.5, dist) * (R.misc.z / w) * (0.05 / max(len, 0.05)) * 2.0;
  o.col = dropLight(p, tc) * k * 0.012;
  return o;
}
@fragment fn fs_drop(i: DOut) -> @location(0) vec4f {
  let a = exp(-i.uv.x * i.uv.x * 3.0) * smoothstep(1.0, 0.6, abs(i.uv.y));
  return vec4f(i.col * a, 0.0);
}

// ---------------------------------------------------------------- splashes
struct SOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f, @location(2) age: f32 }
@vertex fn vs_splash(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  var o: SOut;
  o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
  // which life this splash is in, and where on the screen it lands (lower down more: that's where the ground is)
  let life = R.misc.w;
  let t = R.misc.x / life + rh(ii * 5u + 1u);
  let gen = u32(floor(t));
  let age = fract(t);
  let sd = ii * 7919u + gen * 104729u;
  let uv = vec2f(rh(sd), 0.15 + 0.85 * sqrt(rh(sd + 1u)));
  if (rh(sd + 2u) > R.fall.w) { return o; }
  let res = vec2f(textureDimensions(sceneDepth));
  let d = textureLoad(sceneDepth, vec2i(uv * res), 0);
  if (d <= 0.0) { return o; }
  // (the surface there: back through the depth)
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
  let w4 = frame.invViewProj * ndc;
  let p = w4.xyz / w4.w;
  let dist = distance(p, frame.camPos);
  if (dist > 30.0) { return o; }
  let size = 0.015 + 0.035 * age;
  var q4 = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let c = q4[vi];
  let wp = p + frame.camRight * c.x * size + vec3f(0.0, 1.0, 0.0) * (c.y * 0.5 + 0.5) * size * 1.2 + (frame.camPos - p) / max(dist, 1e-3) * 0.05;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  o.age = age;
  o.col = dropLight(p + vec3f(0.0, 0.05, 0.0), (frame.camPos - p) / max(dist, 1e-3)) * 0.012 * (1.0 - smoothstep(12.0, 25.0, dist));
  return o;
}
@fragment fn fs_splash(i: SOut) -> @location(0) vec4f {
  // a crown: droplets thrown up and out, a bright little core where it hit
  let r = length(vec2f(i.uv.x, i.uv.y * 0.7 + 0.3));
  let crown = exp(-sq((r - 0.2 - i.age * 0.6) / 0.15)) * step(-0.75, i.uv.y) * (1.0 - i.age) + exp(-r * r * 30.0) * (1.0 - i.age) * 2.0;
  return vec4f(i.col * crown, 0.0);
}
