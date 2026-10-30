// the bench's shared environment: one group of everything a world's shaders read (look-up tables, the shadow cascades,
// height and cloud maps, light lists), shared by every draw as a game shares its sky, shadows and terrain
struct Env {
  sun: vec4f,     // xyz direction, w strength
  wind: vec4f,    // xy direction, z sway, w time
}
@group(1) @binding(0) var<uniform> env: Env;
@group(1) @binding(1) var lutA: texture_2d<f32>;
@group(1) @binding(2) var lutB: texture_2d<f32>;
@group(1) @binding(3) var lutC: texture_2d<f32>;
@group(1) @binding(4) var lut3d: texture_3d<f32>;
@group(1) @binding(5) var shadowMap: texture_depth_2d_array;
@group(1) @binding(6) var heights: texture_2d<f32>;
@group(1) @binding(7) var cloudShadow: texture_2d<f32>;
@group(1) @binding(8) var<storage, read> irradiance: array<vec4f>;
@group(1) @binding(9) var noiseTex: texture_3d<f32>;
@group(1) @binding(10) var aurora: texture_2d<f32>;
@group(1) @binding(11) var windTex: texture_2d<f32>;
@group(1) @binding(12) var<storage, read> lights: array<vec4f>;
@group(1) @binding(13) var<storage, read> grid: array<u32>;
@group(1) @binding(14) var envSamp: sampler;
@group(1) @binding(15) var cmpSamp: sampler_comparison;
