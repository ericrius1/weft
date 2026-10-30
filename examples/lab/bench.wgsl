// the bench's cube: a unit cube pulled from the vertex index, placed by its own uniform, swaying in the shared wind and
// lit by the shared environment (its sun, a shadow cascade, its look-up tables)
#include "weft/frame"
#include "./benchenv"

struct Inst {
  model: mat4x4f,
  color: vec4f,
}
@group(2) @binding(0) var<uniform> inst: Inst;
@group(2) @binding(1) var albedo: texture_2d<f32>;
// (refs=1: a ping-pong side, bound through a Ref, that nudges each cube)
@group(2) @binding(2) var<storage, read> wobble: array<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) uv: vec2f, @location(2) world: vec3f }

const NORMALS = array<vec3f, 6>(vec3f(1, 0, 0), vec3f(-1, 0, 0), vec3f(0, 1, 0), vec3f(0, -1, 0), vec3f(0, 0, 1), vec3f(0, 0, -1));
const CORNERS = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1));

fn cube(vi: u32, lift: f32) -> VOut {
  let n = NORMALS[vi / 6u];
  let c = CORNERS[vi % 6u];
  // (two axes across the face, ordered so every face winds counter-clockwise seen from outside)
  var a = vec3f(0.0, 1.0, 0.0);
  if (abs(n.y) > 0.5) { a = vec3f(0.0, 0.0, 1.0); }
  let b = cross(a, n);
  let local = (n + a * c.y + b * c.x) * 0.5;
  let sway = vec3f(env.wind.x, 0.0, env.wind.y) * env.wind.z * sin(env.wind.w + inst.color.w * 6.28) * (local.y + 0.5);
  let world = (inst.model * vec4f(local + sway + vec3f(0.0, lift, 0.0), 1.0)).xyz;
  var o: VOut;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.n = normalize((inst.model * vec4f(n, 0.0)).xyz);
  o.uv = c * 0.5 + 0.5;
  o.world = world;
  return o;
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut { return cube(vi, 0.0); }
@vertex fn vs_wobble(@builtin(vertex_index) vi: u32) -> VOut { return cube(vi, wobble[vi % 4u]); }

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let l = normalize(env.sun.xyz);
  let lit = max(dot(normalize(i.n), l), 0.0) * env.sun.w;
  let shade = textureSampleCompareLevel(shadowMap, cmpSamp, i.uv, 0, 0.5);
  let tint = textureSampleLevel(lutA, envSamp, i.uv, 0.0).rgb * 0.1 + irradiance[0].rgb;
  let tex = textureSample(albedo, samp_repeat, i.uv * 2.0).rgb;
  return vec4f(inst.color.rgb * tex * (tint + lit * mix(0.6, 1.0, shade)), 1.0);
}

// the frame to the screen: exposure, a filmic curve, gamma
#include "weft/fullscreen"
@group(2) @binding(3) var scene: texture_2d<f32>;
@fragment fn fs_out(i: FullscreenOut) -> @location(0) vec4f {
  let c = textureSampleLevel(scene, samp_linear, i.uv, 0.0).rgb * 1.2;
  let m = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  return vec4f(pow(m, vec3f(1.0 / 2.2)), 1.0);
}
