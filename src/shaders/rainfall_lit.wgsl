// loom/rainfall lit from a uniform (weather/rainfall.ts's default, for a world with no lighting functions of its own on
// the GPU): the sky's light, the key light (sun or moon) and its way, a warm glow from lamps near the ground, and the
// ground a flat plane at the eye's (Rainfall.light, set each frame).
#include "weft/frame"

struct RainLight {
  sky: vec4f,     // rgb the sky's light on an upward face
  key: vec4f,     // rgb the key light's colour (sun or moon, through the cloud), w -
  dir: vec4f,     // xyz toward the key light, w the ground's height (world y)
  lamps: vec4f,   // rgb lamps' glow on the drops near the ground (night), w how high it reaches (m)
}
@group(2) @binding(2) var<uniform> rainL: RainLight;

fn rainGround(xz: vec2f) -> f32 { return rainL.dir.w; }

fn rainLight(p: vec3f, g: f32, side: f32) -> vec3f {
  let toCam = normalize(frame.camPos - p);
  let L = rainL.dir.xyz;
  let fwd = rainPhase(dot(-toCam, L), g);
  let key = rainL.key.rgb * smoothstep(-0.05, 0.02, L.y);
  let lamps = rainL.lamps.rgb * (1.0 - smoothstep(rainL.lamps.w * 0.17, rainL.lamps.w, p.y - rainL.dir.w));
  return rainL.sky.rgb * 0.9 + key * (side * 0.12 + min(fwd, 0.8)) + lamps;
}

fn rainVeil() -> vec3f { return rainL.sky.rgb * 1.05; }

#include "./rainfall"
