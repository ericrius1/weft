// The sea: a radial grid that follows the camera out to the horizon, displaced by a sum of Gerstner waves (calmed
// over the shallows), plus the ripple sim near the player. Shaded with refraction of the scene behind it (absorbed
// per channel by the thickness of water the light crossed: turquoise over sand, deep blue over the drop-off), the
// sky's reflection, a sun glint, shore and crest foam.
#include "./env"

struct Wave { d: vec2f, k: f32, a: f32, w: f32, q: f32, phase: f32, pad: f32 }
struct Ocean {
  waves: array<Wave, 12>,
  count: u32,
  ringCount: u32,
  segments: u32,
  innerRadius: f32,
  growth: f32,
  snap: f32,
  absorb: vec3f,        // per-metre extinction (r, g, b)
  scatter: vec3f,       // @color
  deep: vec3f,          // @color
  foam: f32,            // @range(0, 2)
  refraction: f32,      // @range(0, 0.2)
  glint: f32,           // @range(0, 4)
}
@group(2) @binding(0) var<uniform> ocean: Ocean;
@group(2) @binding(1) var sceneColor: texture_2d<f32>;
@group(2) @binding(2) var sceneDepth: texture_depth_2d;
@group(2) @binding(3) var reflTex: texture_2d<f32>;   // the planar reflection (half res, a mirrored camera)

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) base: vec2f,
  @location(2) crest: f32,
}

struct Disp { p: vec3f, crest: f32 }
fn gerstner(xz: vec2f, t: f32, fade: f32) -> Disp {
  var p = vec3f(xz.x, 0.0, xz.y);
  var crest = 0.0;
  for (var i = 0u; i < ocean.count; i++) {
    let w = ocean.waves[i];
    let th = w.k * dot(w.d, xz) - w.w * t + w.phase;
    let c = cos(th);
    let s = sin(th);
    let a = w.a * fade;
    p.x += w.q * a * w.d.x * c;
    p.z += w.q * a * w.d.y * c;
    p.y += a * s;
    crest += w.q * w.k * a * s;
  }
  return Disp(p, crest);
}

fn gerstnerNormal(xz: vec2f, t: f32, fade: f32) -> vec3f {
  var n = vec3f(0.0, 1.0, 0.0);
  for (var i = 0u; i < ocean.count; i++) {
    let w = ocean.waves[i];
    let th = w.k * dot(w.d, xz) - w.w * t + w.phase;
    let c = cos(th);
    let s = sin(th);
    let wa = w.k * w.a * fade;
    n.x -= w.d.x * wa * c;
    n.z -= w.d.y * wa * c;
    n.y -= w.q * wa * s;
  }
  return normalize(n);
}

// how much the swell survives over this patch of sea (none on the beach, calm in the lagoon)
fn waveFade(xz: vec2f) -> f32 {
  let depth = world.seaLevel - terrainHeightLod(xz, 2);
  return smoothstep(0.2, 7.0, depth);
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let seg = ocean.segments + 1u;
  let ring = vi / seg;
  let a = f32(vi % seg) / f32(ocean.segments) * TAU;
  var r = 0.0;
  if (ring > 0u) { r = ocean.innerRadius * pow(ocean.growth, f32(ring - 1u)); }
  let centre = round(frame.camPos.xz / ocean.snap) * ocean.snap;
  let xz = centre + vec2f(cos(a), sin(a)) * r;
  // waves fade into the distance (no sub-pixel aliasing) and over the shallows
  let far = 1.0 - smoothstep(600.0, 3500.0, r);
  let fade = waveFade(xz) * far;
  let d = gerstner(xz, frame.time, fade);
  var p = d.p;
  p.y += world.seaLevel + rippleAt(xz).x;
  var o: VOut;
  o.world = p;
  o.base = xz;
  o.crest = d.crest;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  return o;
}

fn detailNormal(xz: vec2f, t: f32, k: f32) -> vec3f {
  let g1 = gnoised(xz * 0.35 + vec2f(t * 0.06, t * 0.035));
  let g2 = gnoised(xz * 1.3 - vec2f(t * 0.11, -t * 0.07) + 5.0);
  let g3 = gnoised(xz * 4.1 + vec2f(-t * 0.21, t * 0.17) + 9.0);
  let g = g1.yz * 0.5 + g2.yz * 0.3 + g3.yz * 0.15;
  return vec3f(-g.x * k, 0.0, -g.y * k);
}

@fragment fn fs(i: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let wp = i.world;
  let t = frame.time;
  let dist = distance(wp, frame.camPos);
  let fade = waveFade(i.base) * (1.0 - smoothstep(600.0, 3500.0, dist));
  var n = gerstnerNormal(i.base, t, fade);
  // ripples (wakes, splashes) from the sim
  let rp = rippleAt(i.base);
  let cell = world.ripple.z / max(world.ripple.w, 1.0);
  let rx = rippleAt(i.base + vec2f(cell, 0.0)).x - rippleAt(i.base - vec2f(cell, 0.0)).x;
  let rz = rippleAt(i.base + vec2f(0.0, cell)).x - rippleAt(i.base - vec2f(0.0, cell)).x;
  n = normalize(n + vec3f(-rx, 0.0, -rz) / (2.0 * cell) * 0.8);
  let near = 1.0 - smoothstep(30.0, 900.0, dist);
  n = normalize(n + detailNormal(wp.xz, t, 0.22 * near + 0.04));
  if (!front) { n = -n; }
  let v = normalize(frame.camPos - wp);
  let ndv = max(dot(n, v), 0.0);
  let fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  // the scene behind: refracted, absorbed by the thickness of water in front of it
  let px = vec2i(i.pos.xy);
  let res = frame.res;
  let behindD = textureLoad(sceneDepth, clamp(px, vec2i(0), vec2i(res) - 1), 0);
  let waterView = linearDepth(i.pos.z);
  let behindView = select(linearDepth(behindD), 1e5, behindD <= 0.0);
  let thick0 = max(behindView - waterView, 0.0);
  let off = n.xz * ocean.refraction * clamp(thick0 * 0.5, 0.0, 1.0);
  var uv = i.pos.xy / res + off;
  // don't refract things in front of the water
  let d2 = textureLoad(sceneDepth, clamp(vec2i(uv * res), vec2i(0), vec2i(res) - 1), 0);
  if (linearDepth(d2) < waterView || (d2 <= 0.0 && behindD > 0.0)) { uv = i.pos.xy / res; }
  let behind = textureSampleLevel(sceneColor, samp_linear, uv, 0.0).rgb;
  // the light crossing the water: down to the floor and back up toward us, roughly
  let floorDepth = max(world.seaLevel - terrainHeight(i.base), 0.0);
  let thick = min(thick0, 200.0) + floorDepth * 0.6;
  let T = exp(-ocean.absorb * thick);
  // light scattered in the water body (lit by sun and sky; the clouds' shadows fall on it)
  let sh = shadowAt(wp, vec3f(0.0, 1.0, 0.0), i.pos.xy);
  let sunL = lighting.sunRad.rgb * PI * max(world.lightDir.y, 0.0) * sh + shIrradiance(vec3f(0.0, 1.0, 0.0)) * PI;
  let scatterC = mix(ocean.scatter, ocean.deep, smoothstep(2.0, 30.0, floorDepth));
  var col = behind * T + scatterC * sunL * (1.0 - T) * 0.12;
  // subsurface glow through the wave crests
  let sss = pow(max(dot(v, -world.lightDir), 0.0), 4.0) * max(i.crest, 0.0) * 2.0;
  col += ocean.scatter * lighting.sunRad.rgb * PI * sss * 0.3 * sh;

  // reflection: the mirror image (land, trees, the village, the sky) bent by the waves; the sky itself where the mirror
  // has nothing (its edges), and the sun's glint
  let r = reflect(-v, n);
  var refl = skyRadiance(vec3f(r.x, max(r.y, 0.01), r.z));
  // the clouds in the mirror (the reflection pass has no clouds): where the reflected ray meets the cloud layer, the
  // clouds' shadow map says whether there's cloud there; their undersides, lit by the sky and a little sun
  if (r.y > 0.02 && world.misc.y > 0.0 && frame.camPos.y > world.seaLevel) {
    let H = 900.0;
    let P = wp + r * ((H - wp.y) / r.y);
    let L = cloudLightDir();
    let suv = (P.xz + L.xz / L.y * (world.cloudMap.w - H) - world.cloudMap.xy) / world.cloudMap.z;
    if (all(suv > vec2f(0.0)) && all(suv < vec2f(1.0))) {
      let Tc = textureSampleLevel(cloudShadowTex, samp_linear, suv, 0.0).x;
      let cov = smoothstep(0.92, 0.3, Tc) * smoothstep(0.02, 0.12, r.y) * (1.0 - smoothstep(12000.0, 30000.0, distance(P.xz, frame.camPos.xz)));
      let cc = lighting.keyRad.rgb * PI * 0.16 + shIrradiance(vec3f(0.0, 1.0, 0.0)) * 0.85;
      refl = mix(refl, cc, cov);
    }
  }
  if (frame.camPos.y > world.seaLevel) {
    // (the waves' slope moves the image sideways in screen space, more for nearby water: a few % of the screen)
    let nd = n - vec3f(0.0, 1.0, 0.0);
    let ofs = vec2f(dot(nd, frame.camRight), -dot(nd, frame.camUp)) * 0.35 * (1.0 - smoothstep(30.0, 600.0, dist)) + vec2f(dot(nd, frame.camRight), -dot(nd, frame.camUp)) * 0.08;
    let ruv = clamp(i.pos.xy / res + ofs, vec2f(0.002), vec2f(0.998));
    let m = textureSampleLevel(reflTex, samp_linear, ruv, 0.0);
    refl = mix(refl, m.rgb, m.a);
  }
  let spec = ggxSpec(n, v, world.lightDir, 0.07, 1.0) * max(dot(n, world.lightDir), 0.0);
  refl += lighting.keyRad.rgb * PI * spec * ocean.glint * sh;
  // (and the lamps': a lighthouse's beam, a harbour's lights, glittering paths across the swell)
  refl += pointLightsSpec(wp, n, v, 0.12, 1.0);
  col = mix(col, refl, fres);

  // foam: the shore break, wave crests, the ripple sim's churn (worked out only where there can be any)
  let shore = smoothstep(1.2, 0.0, floorDepth) * smoothstep(-0.2, 0.05, floorDepth);
  let crestF = smoothstep(0.55, 0.95, i.crest) * fade;
  let churn = clamp(rp.z, 0.0, 1.0);
  if (shore + crestF + churn > 0.001) {
    let foamNoise = fbm(wp.xz * 0.7 + vec2f(t * 0.3, 0.0), 4);
    var foam = shore * smoothstep(0.35, 0.7, foamNoise + 0.25 * sin(floorDepth * 6.0 - t * 2.4));
    foam = max(foam, crestF * smoothstep(0.4, 0.75, foamNoise));
    foam = max(foam, churn * smoothstep(0.3, 0.6, foamNoise));
    if (foam * ocean.foam > 0.002) {
      let foamLight = lightDiffuse(vec3f(0.85), vec3f(0.0, 1.0, 0.0), wp, i.pos.xy, 1.0, 0.3);
      col = mix(col, foamLight, clamp(foam * ocean.foam, 0.0, 1.0));
    }
  }

  // seen from below: the surface is a bright window up to the sky, a mirror outside it
  // (inside Snell's window the sky and whatever stands over the water, bent; outside it the surface mirrors the deep:
  // the water's own glow from below. underwater.wgsl fogs it by the distance to the surface.)
  if (!front) {
    let cosI = abs(dot(v, n));
    let window = smoothstep(0.62, 0.7, cosI);
    let rr = refract(-v, n, 1.33);
    let rdir = select(vec3f(0.0, 1.0, 0.0), normalize(rr), dot(rr, rr) > 1e-6);
    let up = mix(skyRadiance(vec3f(rdir.x, max(rdir.y, 0.02), rdir.z)) * 0.9, behind, select(0.0, 0.7, behindD > 0.0));
    let tr = (1.0 - pow(1.0 - clamp(cosI, 0.0, 1.0), 5.0)) * 0.92;
    let mirrorDir = reflect(-v, n);
    let deep = uwInscatter(normalize(vec3f(mirrorDir.x, -abs(mirrorDir.y), mirrorDir.z)), 300.0, 0.0);
    col = mix(deep, up * tr + deep * (1.0 - tr), window);
    // the sun's disc, bent into the window, a dazzle on the moving surface
    let sunUw = uwLightDir();
    col += lighting.keyRad.rgb * PI * 6.0 * pow(max(dot(-v, sunUw) , 0.0), 900.0) * window;
    return vec4f(col, 1.0);
  }
  col = applyAtmosphere(col, wp);
  return vec4f(col, 1.0);
}
