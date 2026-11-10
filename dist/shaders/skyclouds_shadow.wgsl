// The sprite clouds' shadow, handed to loom (skyclouds.ts): their shadow target (skyclouds.wgsl fsShadow and
// fsLayersShadow: the key light's transmittance through the puffs and the decks on each ray, the lowest cloud on it)
// written into loom's cloud shadow map in its own format (env.wgsl cloudMapT): x the transmittance, y where along the
// ray the cloud is (its base, / 2000 m), z how spread out that is (/ 1000 m), w the mountains' occlusion (none: loom's
// march, which read it, is off). Upsampled, bilinear for the light, the nearest cloud's base over the four taps (a clear
// texel's "no cloud" never averaged in).
@group(2) @binding(0) var shadowIn: texture_2d<f32>;
@group(2) @binding(1) var smapOut: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8) fn bake(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(smapOut);
  if (any(id.xy >= n)) { return; }
  let m = vec2i(textureDimensions(shadowIn));
  let f = (vec2f(id.xy) + 0.5) / vec2f(n) * vec2f(m) - 0.5;
  let i = vec2i(floor(f));
  let w = f - floor(f);
  let a = textureLoad(shadowIn, clamp(i, vec2i(0), m - 1), 0);
  let b = textureLoad(shadowIn, clamp(i + vec2i(1, 0), vec2i(0), m - 1), 0);
  let c = textureLoad(shadowIn, clamp(i + vec2i(0, 1), vec2i(0), m - 1), 0);
  let d = textureLoad(shadowIn, clamp(i + vec2i(1, 1), vec2i(0), m - 1), 0);
  let t = mix(mix(a.r, b.r, w.x), mix(c.r, d.r, w.x), w.y);
  let low = min(min(a.a, b.a), min(c.a, d.a));
  // (the shade begins a little above the lowest puff's core: a peak poking up into a cloud's base is half in it)
  textureStore(smapOut, id.xy, vec4f(t, clamp((low + 60.0) / 2000.0, 0.0, 1.0), 0.07, 0.0));
}
