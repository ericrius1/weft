// the scene's lighting block, written each frame by atmosphere.wgsl (lightingMain)
struct Lighting {
  sunRad: vec4f,       // sun radiance / PI at the scene (rgb), w = above-horizon visibility
  moonRad: vec4f,
  keyRad: vec4f,       // the dominant light (sun by day, moon by night)
  skyUp: vec4f,
  skyHorizon: vec4f,
  skyZenith: vec4f,
  groundBounce: vec4f,
  fogColor: vec4f,     // average horizon in-scatter for height fog
  sh: array<vec4f, 9>, // sky irradiance, L2 spherical harmonics (already convolved, / PI)
  keyAlt: array<vec4f, 8>, // the key light's radiance / PI up in the air: at 8.5 km·(k/7)^2.5 (the clouds, the cirrus)
}
