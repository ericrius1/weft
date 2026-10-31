// The shared environment (kit.shareGroup(1, …)): lighting, the sky, aerial perspective, the terrain maps, the shadow
// cascades and the ripple sim. Every surface shader includes this and gets these bindings without passing them.
#include "./globals"
#include "./lighting"

@group(1) @binding(0) var<storage, read> lighting: Lighting;
@group(1) @binding(1) var skyTex: texture_2d<f32>;       // sky-view LUT
@group(1) @binding(2) var aerialTex: texture_3d<f32>;    // aerial perspective froxels
@group(1) @binding(3) var heightTex: texture_2d<f32>;    // terrain heights (r32float, mips; load only)
@group(1) @binding(4) var normalTex: texture_2d<f32>;    // dh/dx, dh/dz, ao, cavity
@group(1) @binding(5) var splatTex: texture_2d<f32>;     // sand, grass, rock, snow
@group(1) @binding(6) var maskTex: texture_2d<f32>;      // road, forest, flowers, village
@group(1) @binding(7) var shadowTex: texture_depth_2d_array;
@group(1) @binding(8) var rippleTex: texture_2d<f32>;    // ripple sim: height, velocity, foam
@group(1) @binding(9) var hfShadowTex: texture_2d<f32>;  // the terrain's own shadow toward the key light (hfshadow.wgsl)
@group(1) @binding(10) var cloudShadowTex: texture_2d<f32>;  // the clouds' shadow map (clouds.wgsl bakeShadow)
// (a spot when cosOuter > -1: lit within its cone round dir, fading from cosInner to cosOuter — headlights, lamps)
struct PointLight { pos: vec3f, radius: f32, color: vec3f, size: f32, dir: vec3f, cosOuter: f32, cosInner: f32, p0: f32, p1: f32, p2: f32 }
@group(1) @binding(11) var<storage, read> plights: array<PointLight, 32>;

// ---------------------------------------------------------------- terrain maps
fn worldUV(xz: vec2f) -> vec2f { return xz / (2.0 * world.worldHalf) + 0.5; }
fn heightLoad(ij: vec2i, lod: i32) -> f32 {
  let dim = vec2i(textureDimensions(heightTex, lod));
  return textureLoad(heightTex, clamp(ij, vec2i(0), dim - 1), lod).r;
}
/** terrain height, bilinear from the r32float map (outside the map: deep sea floor) */
fn terrainHeightLod(xz: vec2f, lod: i32) -> f32 {
  let uv = worldUV(xz);
  let dim = vec2f(textureDimensions(heightTex, lod));
  let t = uv * dim - 0.5;
  let i = vec2i(floor(t));
  let f = t - floor(t);
  let h00 = heightLoad(i, lod);
  let h10 = heightLoad(i + vec2i(1, 0), lod);
  let h01 = heightLoad(i + vec2i(0, 1), lod);
  let h11 = heightLoad(i + vec2i(1, 1), lod);
  let h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  let out = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
  return mix(h, -70.0, smoothstep(0.495, 0.5, out));
}
fn terrainHeight(xz: vec2f) -> f32 { return terrainHeightLod(xz, 0); }
struct TerrainSurf { n: vec3f, ao: f32, cavity: f32, splat: vec4f, mask: vec4f }
fn terrainSurf(xz: vec2f) -> TerrainSurf {
  let uv = worldUV(xz);
  let nt = textureSampleLevel(normalTex, samp_linear, uv, 0.0);
  var s: TerrainSurf;
  s.n = normalize(vec3f(-nt.x, 1.0, -nt.y));
  s.ao = nt.z;
  s.cavity = nt.w;
  s.splat = textureSampleLevel(splatTex, samp_linear, uv, 0.0);
  s.mask = textureSampleLevel(maskTex, samp_linear, uv, 0.0);
  return s;
}
/** water depth under a point of the sea (positive below sea level) */
fn seaDepth(xz: vec2f) -> f32 { return world.seaLevel - terrainHeight(xz); }

// ---------------------------------------------------------------- sky, aerial perspective, ambient
fn skyUV(d: vec3f) -> vec2f {
  let az = atan2(d.x, -d.z);
  let el = asin(clamp(d.y, -1.0, 1.0));
  let v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (PI * 0.5));
  return vec2f(az / TAU + 0.5, 1.0 - v);
}
fn skyRadiance(d: vec3f) -> vec3f { return textureSampleLevel(skyTex, samp_repeat, skyUV(d), 0.0).rgb; }

fn shIrradiance(n: vec3f) -> vec3f {
  let d = n;
  var r = lighting.sh[0].rgb * 0.282095;
  r += lighting.sh[1].rgb * 0.488603 * d.y + lighting.sh[2].rgb * 0.488603 * d.z + lighting.sh[3].rgb * 0.488603 * d.x;
  r += lighting.sh[4].rgb * 1.092548 * d.x * d.y + lighting.sh[5].rgb * 1.092548 * d.y * d.z + lighting.sh[6].rgb * 0.315392 * (3.0 * d.z * d.z - 1.0);
  r += lighting.sh[7].rgb * 1.092548 * d.x * d.z + lighting.sh[8].rgb * 0.546274 * (d.x * d.x - d.y * d.y);
  return max(r, vec3f(0.0)) / PI;
}

const AP_N: f32 = 32.0;
const AP_FAR_M: f32 = 48000.0;
/** in-scatter (rgb) and transmittance (a) between the camera and world point wp */
fn aerial(wp: vec3f) -> vec4f {
  let clip = frame.viewProj * vec4f(wp, 1.0);
  let uv = clip.xy / max(clip.w, 1e-4) * vec2f(0.5, -0.5) + 0.5;
  let d = distance(wp, frame.camPos) * world.fogParams.z;
  let z = sqrt(clamp(d / AP_FAR_M, 0.0, 1.0)) * AP_N;
  let w = clamp(z, 0.0, 1.0);
  let s = textureSampleLevel(aerialTex, samp_linear, vec3f(clamp(uv, vec2f(0.0), vec2f(1.0)), max(z - 0.5, 0.5) / AP_N), 0.0);
  return vec4f(s.rgb * w, mix(1.0, s.a, w));
}

// low sea mist on top of the aerial perspective
fn heightFog(wp: vec3f) -> f32 {
  let v = wp - frame.camPos;
  let d = length(v);
  let k = max(world.fogParams.y, 1e-4);
  let y0 = frame.camPos.y - world.seaLevel;
  var hf = exp(-k * y0);
  if (abs(v.y) > 0.01) { hf = (exp(-k * y0) - exp(-k * (y0 + v.y))) / (k * v.y); }
  return 1.0 - exp(-world.fogParams.x * d * min(hf, 4.0));
}

fn applyAtmosphere(col: vec3f, wp: vec3f) -> vec3f {
  // (with the camera under the sea the water is the medium: underwater.wgsl's lens pass fogs the whole picture)
  if (frame.camPos.y < world.seaLevel && frame.user.x < 0.5) { return col; }
  let ap = aerial(wp);
  var c = col * ap.a + ap.rgb;
  let f = heightFog(wp);
  if (f > 0.0005) {
    let dir = normalize(wp - frame.camPos);
    let mu = dot(dir, world.sunDir);
    var fc = lighting.fogColor.rgb * 0.9 + lighting.sunRad.rgb * (0.05 * henyeyGreenstein(mu, 0.6) + 0.01) * PI;
    fc += lighting.moonRad.rgb * 0.2;
    c = mix(c, fc, f);
  }
  return c;
}

// ---------------------------------------------------------------- the cirrus (the sky shaders draw it; shadows here)
// ice cloud high above everything (8.5 km): thin, fibrous — the noise stretched along the wind — lit by the sun up
// there (it stays lit for minutes after the ground's sunset: the pink afterglow). world.cloudCover is its cover.
const CIRRUS_H: f32 = 8500.0;
/** fibK: how much of the fibres to draw (1 where they span pixels; toward 0 where they'd alias into dashes) */
fn cirrusField(pw: vec2f, fibK: f32) -> vec2f {
  let cover = world.cloudCover;
  let wd = normalize(world.wind.xz + vec2f(1e-3, 0.0));
  let p = pw + wd * world.cloudTime * 18.0;
  let a = vec2f(dot(p, wd), dot(p, vec2f(-wd.y, wd.x)));
  let q = vec2f(a.x * 0.2, a.y) * 0.0012;
  let warp = vec2f(fbm(q * 0.5, 3), fbm(q * 0.5 + 3.7, 3)) * 1.1;
  let n = fbm(q + warp, 5);
  // (fibres: fine ridges across the wind, the strands of falling ice drawn out by the shear)
  // (~10 km patches set where it is; fine fibres within them; thin — cirrus is optical depth 0.03–0.3)
  let patchN = fbm(q * 0.3 + warp * 0.5, 3);
  let cov = smoothstep(1.0 - cover, 1.0 - cover + 0.5, patchN);
  // (fibres a few km long and wavering, not ruled lines across the sky; at most 60 % contrast)
  let fq = vec2f(q.x * 2.2, q.y * 14.0) + warp * 2.0 + vec2f(0.0, fbm(q * 3.0, 2) * 3.0);
  let fib = mix(0.45, pow(1.0 - abs(vnoise(fq) * 2.0 - 1.0), 3.0), fibK * 0.6);
  // (and where the cover is high, a thin veil between the patches: the cirrostratus that runs ahead of a front)
  let dens = max(cov * mix(0.2, 1.0, fib) * 0.28, 0.12 * smoothstep(0.3, 0.6, cover) * patchN);
  return vec2f(n, dens);
}
/** the cirrus along a view direction: rgb its light, a its cover (base: the sky behind, for the haze at the horizon) */
fn cirrus(d: vec3f, base: vec3f) -> vec4f {
  if (world.cloudCover < 0.01 || d.y < 0.0) { return vec4f(0.0); }
  let t = max(CIRRUS_H - frame.camPos.y, 300.0) / max(d.y + 0.03, 0.02);
  // (the fibres are ~60 m apart: drawn only while that spans a few pixels at the deck's distance)
  let fpx = t / (0.5 * frame.proj[1][1] * frame.res.y);
  let cf = cirrusField(frame.camPos.xz + d.xz * t, 1.0 - smoothstep(12.0, 30.0, fpx));
  if (cf.y <= 0.001) { return vec4f(0.0); }
  let mu = dot(d, world.sunDir);
  // (ice: a strong forward lobe, a little back; thin enough to be lit right through)
  let phase = 0.7 * henyeyGreenstein(mu, 0.75) + 0.3 * henyeyGreenstein(mu, -0.15);
  let amb = lighting.skyZenith.rgb * 0.5 + lighting.skyHorizon.rgb * 0.4;
  var col = keyAltAt(CIRRUS_H) * PI * (phase * 0.9 + 0.06) + amb + lighting.moonRad.rgb * PI * 0.3;
  let haze = smoothstep(0.2, 0.0, d.y);
  col = mix(col, base, haze * 0.7);
  return vec4f(col, cf.y * (1.0 - haze * 0.6));
}
/** the key light up in the air at height y (lighting.keyAlt: 8 heights, 8.5 km·(k/7)^2.5 — dense low down) */
fn keyAltAt(y: f32) -> vec3f {
  let f = clamp(7.0 * pow(max(y, 0.0) / 8500.0, 0.4), 0.0, 6.999);
  let i = u32(floor(f));
  let c = mix(lighting.keyAlt[i], lighting.keyAlt[i + 1u], fract(f));
  // (the sun's disc, ±0.27° and lifted ~0.57° by refraction, setting at this very height: the horizon dips with it)
  let dip = sqrt(2.0 * max(y + world.altitudeKm * 1000.0, 0.0) / 6.371e6);
  let sun = smoothstep(-dip - 0.0147, -dip - 0.0052, world.sunDir.y);
  return c.rgb * mix(sun, 1.0, c.w);
}
// ---------------------------------------------------------------- shadows (3 cascades)
fn shadowCascadeCoord(wp: vec3f, i: i32) -> vec3f {
  var m = world.shadow0;
  if (i == 1) { m = world.shadow1; } else if (i == 2) { m = world.shadow2; }
  let lp = m * vec4f(wp, 1.0);
  return vec3f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5, lp.z);
}
const SHADOW_RES: f32 = 2048.0;
fn cascadeReach(wp: vec3f) -> f32 {
  let d = dot(wp - frame.camPos, frame.camFwd);
  return 1.0 - smoothstep(world.cascades.z * 0.6, world.cascades.z * 0.98, d);
}
fn cascadeShadow(wp: vec3f, n: vec3f, px: vec2f) -> f32 {
  let d = dot(wp - frame.camPos, frame.camFwd);
  var ci = 0;
  if (d > world.cascades.x) { ci = 1; }
  if (d > world.cascades.y) { ci = 2; }
  if (d > world.cascades.z) { return 1.0; }
  let texelW = select(select(world.cascades.z, world.cascades.y, ci == 1), world.cascades.x, ci == 0) * 2.2 / SHADOW_RES;
  let off = n * texelW * 1.5 + world.lightDir * texelW * 1.0;
  let sc = shadowCascadeCoord(wp + off, ci);
  if (any(sc.xy < vec2f(0.0)) || any(sc.xy > vec2f(1.0)) || sc.z > 1.0 || sc.z < 0.0) { return 1.0; }
  let rot = rot2(ign(px) * TAU);
  let r = world.cascades.w / SHADOW_RES * select(1.0, 0.6, ci > 0);
  var POISSON = array<vec2f, 8>(
    vec2f(-0.326, -0.406), vec2f(-0.840, -0.074), vec2f(-0.696, 0.457), vec2f(-0.203, 0.621),
    vec2f(0.962, -0.195), vec2f(0.473, -0.480), vec2f(0.519, 0.767), vec2f(0.185, -0.893));
  var s = 0.0;
  for (var i = 0; i < 8; i++) {
    s += textureSampleCompareLevel(shadowTex, samp_shadow, sc.xy + rot * POISSON[i] * r, ci, sc.z);
  }
  return mix(1.0, s / 8.0, cascadeReach(wp));
}
// ---------------------------------------------------------------- the terrain's shadow over long distances
// (a mountain between a point and a low sun: hfshadow.wgsl marches the height map toward the light, a band of rows a
// frame, double-buffered; the cascades only reach a few hundred metres)
fn hfShadowAt(wp: vec3f) -> f32 {
  if (world.misc.x < 0.5) { return 1.0; }
  let uv = (wp.xz - world.hfWin.xy) / world.hfWin.z;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  return textureSampleLevel(hfShadowTex, samp_linear, uv, 0.0).r;
}

// ---------------------------------------------------------------- the clouds' shadows (clouds.wgsl bakeShadow)
// for each texel of a plane at world.cloudMap.w, the key light's ray through it: x its transmittance through the
// clouds, y z the mean height (/ 2000 m) and spread (/ 1000 m) of where along it the extinction lies, w the height below
// which the mountains block it (/ 2000 m). The light's elevation is held at >= 4 deg for the projection.
const CLOUD_TOP: f32 = 7200.0;
fn cloudLightDir() -> vec3f { let l = world.lightDir; return normalize(vec3f(l.x, max(l.y, 0.07), l.z)); }
fn cloudMapT(t4: vec4f, y: f32, mountains: bool) -> f32 {
  let z = (y - t4.y * 2000.0) / max(t4.z * 1000.0, 20.0);
  var t = exp(log(max(t4.x, 0.003)) / (1.0 + exp(1.7 * z)));
  if (mountains) { let occ = t4.w * 2000.0; t *= smoothstep(occ - 15.0, occ + 70.0, y); }
  return t;
}
fn cloudTransmittance(wp: vec3f, mountains: bool) -> f32 {
  let L = cloudLightDir();
  let hit = wp.xz + L.xz / L.y * (world.cloudMap.w - wp.y);
  let uv = (hit - world.cloudMap.xy) / world.cloudMap.z;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  // (fading out toward the map's edge: an anvil reaching past it would otherwise cast a shadow cut off in straight lines)
  let e = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
  return mix(cloudMapT(textureSampleLevel(cloudShadowTex, samp_linear, uv, 0.0), wp.y, mountains), 1.0, smoothstep(0.44, 0.5, e));
}
/** the clouds' shadow on a point (a low sun's light comes as much scattered round them as straight past: their shadows
 *  fade toward sunset) */
fn cloudShadowAt(wp: vec3f) -> f32 {
  if (world.lightDir.y < 0.03 || world.misc.y <= 0.0) { return 1.0; }
  return mix(1.0, cloudTransmittance(wp, false), world.misc.y * smoothstep(0.03, 0.3, world.lightDir.y));
}

fn shadowAt(wp: vec3f, n: vec3f, px: vec2f) -> f32 {
  return min(cascadeShadow(wp, n, px), hfShadowAt(wp)) * cloudShadowAt(wp);
}

// ---------------------------------------------------------------- point lights (fallen stars, lamps, blooms)
/** (a surface that carries its own lamps sets this to their owner — its id + 1 — so they don't light itself) */
var<private> plSkip: f32 = 0.0;
/** what a mirror sees of the sky in direction r: the clear sky, or under cloud the deck's grey (no stars through it) */
fn skyReflect(r: vec3f) -> vec3f {
  let d = vec3f(r.x, max(r.y, 0.02), r.z);
  return mix(skyRadiance(d), shIrradiance(d), sat(world.sky.x * 1.2));
}
/** a spot's cone at a direction away from the light (1 for plain point lights). A squash (p1 > 1) flattens it into a
 *  fan — wide across, shallow up and down, as a headlamp's beam is */
fn spotK(l: PointLight, away: vec3f) -> f32 {
  if (l.cosOuter < -1.0) { return 1.0; }
  var a = away;
  var cut = 1.0;
  if (l.p1 > 1.0) {
    let upP = normalize(vec3f(0.0, 1.0, 0.0) - l.dir * l.dir.y + vec3f(1e-4, 0.0, 0.0));
    let v = dot(a, upP);
    a = normalize(a + upP * v * (l.p1 - 1.0));
    // (a dipped beam's cut-off: hardly anything above a degree over its aim — it lights the road, not the car ahead)
    if (l.p1 > 2.5) { cut = mix(0.035, 1.0, smoothstep(0.035, 0.012, v)); }
    // (and a road lamp's pattern: brightest just under its aim, dimmer steeply down — the road a few metres ahead is
    // nearer and faces the lamp more squarely; this evens out the inverse-cube fall of light on the flat road ahead)
    cut /= 1.0 + sq(max(-v, 0.0) / 0.03);
  }
  return smoothstep(l.cosOuter, l.cosInner, dot(a, l.dir)) * cut;
}
/** the light of the point lights reaching a surface (radiance x cosine; a light's own size softens it up close) */
fn pointLightsAt(wp: vec3f, n: vec3f, wrap: f32) -> vec3f {
  var s = vec3f(0.0);
  let cnt = u32(world.lights.x);
  for (var i = 0u; i < cnt; i++) {
    let l = plights[i];
    if (plSkip > 0.0 && l.p0 == plSkip) { continue; }
    let d = l.pos - wp;
    let r2 = dot(d, d);
    if (r2 > l.radius * l.radius) { continue; }
    let r = sqrt(r2);
    let ndl = (dot(n, d / max(r, 1e-4)) + wrap) / (1.0 + wrap);
    let fall = sq(sat(1.0 - sq(r2 / (l.radius * l.radius))));
    s += l.color * max(ndl, 0.0) * fall / (r2 + sq(max(l.size, 0.3))) * spotK(l, -d / max(r, 1e-4));
  }
  return s;
}

/** the point lights' glints on a glossy surface (wet asphalt, puddles, paint): GGX per light — at a low roughness and
 *  a grazing view these stretch into the long streaks of headlights and lamps on a wet road */
fn pointLightsSpec(wp: vec3f, n: vec3f, v: vec3f, rough: f32, f0: f32) -> vec3f {
  var s = vec3f(0.0);
  let cnt = u32(world.lights.x);
  for (var i = 0u; i < cnt; i++) {
    let l = plights[i];
    if (plSkip > 0.0 && l.p0 == plSkip) { continue; }
    let d = l.pos - wp;
    let r2 = dot(d, d);
    if (r2 > l.radius * l.radius) { continue; }
    let r = sqrt(r2);
    let ld = d / max(r, 1e-4);
    let ndl = max(dot(n, ld), 0.0);
    if (ndl <= 0.0) { continue; }
    let fall = sq(sat(1.0 - sq(r2 / (l.radius * l.radius))));
    // (a light's own size widens its glint up close)
    let rr = sat(rough + max(l.size, 0.05) / max(r, 0.5) * 0.5);
    s += l.color * ggxSpec(n, v, ld, rr, f0) * ndl * fall / (r2 + sq(max(l.size, 0.3))) * spotK(l, -ld) * PI;
  }
  return s;
}

/** the lamps' light scattered toward the eye by something translucent at p (rain, spray, mist): a phase that throws
 *  it forward (g) — a lamp behind the mist lights it up */
fn pointLightsIn(p: vec3f, toEye: vec3f, g: f32) -> vec3f {
  var s = vec3f(0.0);
  let cnt = u32(world.lights.x);
  for (var i = 0u; i < cnt; i++) {
    let l = plights[i];
    let d = l.pos - p;
    let r2 = dot(d, d);
    if (r2 > l.radius * l.radius) { continue; }
    let r = sqrt(r2);
    let ld = d / max(r, 1e-4);
    let fall = sq(sat(1.0 - sq(r2 / (l.radius * l.radius))));
    s += l.color * fall / (r2 + sq(max(l.size, 0.3))) * spotK(l, -ld) * henyeyGreenstein(dot(-ld, toEye), g) * 4.0 * PI;
  }
  return s;
}

// ---------------------------------------------------------------- the ripple sim (wakes, splashes)
// stored toroidally (ripple.wgsl): world.ripple = window centre x, z, size (m), texels
fn rippleAt(xz: vec2f) -> vec4f {
  let size = world.ripple.z;
  let d = abs(xz - world.ripple.xy) / (size * 0.5);
  let k = 1.0 - smoothstep(0.72, 0.95, max(d.x, d.y));
  if (k <= 0.0) { return vec4f(0.0); }
  return textureSampleLevel(rippleTex, samp_repeat, xz / size, 0.0) * k;
}

// ---------------------------------------------------------------- shading
/** sun / moon + sky light on a diffuse surface with a soft wrap */
fn lightDiffuse(albedo: vec3f, n: vec3f, wp: vec3f, px: vec2f, ao: f32, wrap: f32) -> vec3f {
  let l = world.lightDir;
  let ndl = (dot(n, l) + wrap) / (1.0 + wrap);
  let sh = shadowAt(wp, n, px);
  let direct = lighting.keyRad.rgb * PI * max(ndl, 0.0) * sh;
  let amb = shIrradiance(n) * PI * ao;
  return albedo * ((direct + amb) / PI + pointLightsAt(wp, n, wrap));
}

// ---------------------------------------------------------------- under the sea: the medium
// The lagoon is clear and the sand under it white: the water drinks the red within metres, scatters a little (bluer);
// turquoise, ~35 m visibility (world.under.w thickens it). Beer–Lambert extinction per channel + single scattering of
// the light let in through the surface, which itself fades with depth. (From waterbending's glacial lakes, retuned.)
const UW_ABS: vec3f = vec3f(0.15, 0.03, 0.013);   // absorption (1/m)
const UW_SCAT: vec3f = vec3f(0.009, 0.016, 0.022);  // scattering (1/m)
const UW_ETA: f32 = 1.333;
fn uwMurk() -> f32 { return max(world.under.w, 0.2); }
fn uwSigS() -> vec3f { return UW_SCAT * uwMurk(); }
fn uwSigT() -> vec3f { return UW_ABS + UW_SCAT * uwMurk(); }
/** how fast the light coming down fades with depth (1/m) */
fn uwKd() -> vec3f { return (UW_ABS + 0.2 * UW_SCAT * uwMurk()) * 1.15; }
/** toward the key light, seen from under the surface (refracted: never more than ~49 degrees from the zenith) */
fn uwLightDir() -> vec3f {
  let l = world.lightDir;
  let h = l.xz / max(length(l.xz), 1e-5);
  let s = sqrt(max(1.0 - sq(max(l.y, 0.0)), 0.0)) / UW_ETA;
  return vec3f(h.x * s, sqrt(1.0 - s * s), h.y * s);
}
/** the light let in through the surface and scattered toward -rd per metre of water, just under the surface: looking
 *  up into the downwelling light it glows, sideways less, looking down only the faint backscatter */
fn uwAmbientSrc(rd: vec3f) -> vec3f {
  let sky = shIrradiance(vec3f(0.0, 1.0, 0.0));
  let key = lighting.keyRad.rgb * max(world.lightDir.y, 0.0) * 0.55;
  return uwSigS() * (sky + key) * (0.08 + 0.85 * pow(sat(rd.y * 0.5 + 0.5), 3.0)) * 0.92;
}
/** in-scatter along a ray (direction rd, length t) starting d0 m below the surface (the light grows or fades along it
 *  as it climbs or sinks) */
fn uwInscatter(rd: vec3f, t: f32, d0: f32) -> vec3f {
  let kd = uwKd();
  let k = uwSigT() - kd * rd.y;
  let ex = select((1.0 - exp(-k * t)) / k, vec3f(t), abs(k) < vec3f(1e-4));
  return uwAmbientSrc(rd) * exp(-kd * max(d0, 0.0)) * ex;
}
/** a colour seen through dist m of water along rd from d0 m deep, the point itself depthP m deep (it was lit as if in
 *  air: its light came down through the water too) */
fn uwApply(col: vec3f, rd: vec3f, dist: f32, d0: f32, depthP: f32) -> vec3f {
  let T = exp(-uwSigT() * dist - uwKd() * depthP);
  return col * T + uwInscatter(rd, dist, d0);
}
/** the caustic net's extra light on a point under the sea (0 above it): two drifting cellular layers, the bright web
 *  where sunlight focuses through the waves, projected down along the light and fading with depth */
fn seaCaustic(wp: vec3f) -> f32 {
  let depth = world.seaLevel - wp.y;
  if (depth < 0.02 || frame.user.x > 0.5) { return 0.0; }
  let p = wp.xz + world.lightDir.xz * depth * 0.3;
  let t = frame.time;
  let a = voronoi(p * 0.55 + vec2f(t * 0.21, t * 0.13));
  let b = voronoi(p * 0.75 - vec2f(t * 0.17, -t * 0.19) + 3.7);
  let ca = pow(clamp(1.0 - (a.y - a.x) * 2.2, 0.0, 1.0), 6.0);
  let cb = pow(clamp(1.0 - (b.y - b.x) * 2.2, 0.0, 1.0), 6.0);
  return (ca * 0.6 + cb * 0.6 + ca * cb * 1.5) * exp(-depth * 0.12) * smoothstep(0.0, 0.6, depth) * max(world.lightDir.y, 0.0);
}
