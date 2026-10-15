// Tidewind's world globals (group 0, binding 1): the sky clock, wind, sea, fog, the player, shadow cascades.
#include "weft/frame"
#include "./common"

struct World {
  sunDir: vec3f, nightness: f32,
  moonDir: vec3f, moonPhase: f32,
  lightDir: vec3f, dayLight: f32,      // the key light: the sun, handing over to the moon after dusk
  pole: vec3f, starRot: f32,
  wind: vec3f, gust: f32,
  seaLevel: f32,
  worldHalf: f32,                      // the terrain map covers ±worldHalf metres
  cloudCover: f32,                     // @range(0, 1)
  cloudTime: f32,
  haze: f32,                           // @range(0, 3)
  altitudeKm: f32,                     // the camera's altitude base for the atmosphere (km)
  exposure: f32,                       // @range(0.05, 4)
  underwater: f32,                     // 0..1, the camera below the surface
  player: vec4f,                       // xyz, w: push radius (grass, ripples)
  grade: vec4f,                        // x saturation, y contrast, z warmth, w vignette
  shadow0: mat4x4f,
  shadow1: mat4x4f,
  shadow2: mat4x4f,
  cascades: vec4f,                     // far edges of the three cascades (m), w softness
  ripple: vec4f,                       // the ripple sim window: origin x, z, size (m), texels
  wave: vec4f,                         // x swell height, y swell length, z chop, w foam
  fogParams: vec4f,                    // x height fog density, y falloff, z aerial scale, w sea mist
  sky: vec4f,                          // x how overcast it is overhead (0..1: the sky's light from the deck's grey underside)
  cloudMap: vec4f,                     // the clouds' shadow map: origin x, z, size (m), its reference plane (world y)
  hfWin: vec4f,                        // the terrain's shadow map window: origin x, z, size (m), texels
  misc: vec4f,                         // x terrain shadow ready, y cloud shadow strength, z low-cloud cover, w aerial layering
  under: vec4f,                        // x how far under the water the camera is (0..1, eased), y camera depth (m), z surface y, w murk
  lights: vec4f,                       // x point lights in use
}
@group(0) @binding(1) var<uniform> world: World;
