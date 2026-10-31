// Physically based atmosphere (after Hillaire 2020), from waterbending: transmittance + multiple-scattering LUTs
// (once), the sky-view LUT, aerial-perspective froxels and the scene's lighting block (every frame). Units: km.
#include "./globals"
#include "./lighting"

@group(2) @binding(0) var transTex: texture_2d<f32>;
@group(2) @binding(1) var msTex: texture_2d<f32>;
@group(2) @binding(2) var out2d: texture_storage_2d<rgba16float, write>;
@group(2) @binding(3) var out3d: texture_storage_3d<rgba16float, write>;
@group(2) @binding(4) var<storage, read_write> lightOut: Lighting;
@group(2) @binding(5) var skyIn: texture_2d<f32>;
@group(2) @binding(6) var heightIn: texture_2d<f32>;   // the terrain heights (mips): the mountains' shadow in the air
const PR: f32 = 6360.0;
const AR: f32 = 6460.0;
const RAY_S: vec3f = vec3f(5.802e-3, 13.558e-3, 33.1e-3);
const MIE_S: f32 = 3.996e-3;
const MIE_E: f32 = 4.44e-3;
const OZ_A: vec3f = vec3f(0.650e-3, 1.881e-3, 0.085e-3);
const SUN_I: f32 = 20.0;
const MOON_I: f32 = 0.16;
const TW: u32 = 256u; const TH: u32 = 64u;
const MSN: u32 = 32u;
const SKW: u32 = 256u; const SKH: u32 = 128u;
const APN: u32 = 32u;
const AP_FAR: f32 = 48.0; // km covered by the froxel grid

struct Med { scat: vec3f, mieS: f32, ext: vec3f };
fn medium(h: f32) -> Med {
  let hr = exp(-max(h, 0.0) / 8.0);
  // a little extra haze low down: mountain valleys are rarely perfectly clear
  let hm = exp(-max(h, 0.0) / 1.2) * world.haze;
  let ho = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  var m: Med;
  m.scat = RAY_S * hr;
  m.mieS = MIE_S * hm;
  m.ext = RAY_S * hr + vec3f(MIE_E * hm) + OZ_A * ho;
  return m;
}

fn raySphere(ro: vec3f, rd: vec3f, r: f32) -> vec2f {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - r * r;
  let d = b * b - c;
  if (d < 0.0) { return vec2f(-1.0); }
  let s = sqrt(d);
  return vec2f(-b - s, -b + s);
}

fn phaseRay(c: f32) -> f32 { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
fn phaseMie(c: f32) -> f32 {
  let g = 0.8;
  let k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + c * c) / pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5);
}

fn transUV(h: f32, mu: f32) -> vec2f { return vec2f(clamp(mu * 0.5 + 0.5, 0.0, 1.0), sqrt(clamp(h / (AR - PR), 0.0, 1.0))); }
fn getTrans(h: f32, mu: f32) -> vec3f { return textureSampleLevel(transTex, samp_linear, transUV(h, mu), 0.0).rgb; }
fn getMS(h: f32, mu: f32) -> vec3f {
  let uv = vec2f(clamp(mu * 0.5 + 0.5, 0.0, 1.0), clamp(h / (AR - PR), 0.0, 1.0));
  return textureSampleLevel(msTex, samp_linear, uv * (f32(MSN) - 1.0) / f32(MSN) + 0.5 / f32(MSN), 0.0).rgb;
}

fn camAlt() -> f32 { return max(world.altitudeKm + frame.camPos.y * 0.001, 0.01); }

fn moonI() -> f32 {
  // full moon is bright, a crescent much less; only once the sun has set
  return MOON_I * smoothstep(0.02, -0.12, world.sunDir.y) * (0.25 + 0.75 * world.moonPhase);
}

// ---------------------------------------------------------------- transmittance (once)
@compute @workgroup_size(8, 8)
fn transmittanceMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= TW || id.y >= TH) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(f32(TW), f32(TH));
  let mu = uv.x * 2.0 - 1.0;
  let h = uv.y * uv.y * (AR - PR);
  let ro = vec3f(0.0, PR + h, 0.0);
  let rd = vec3f(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
  var T = vec3f(0.0);
  let g = raySphere(ro, rd, PR);
  if (!(g.x > 0.0)) {
    let tMax = raySphere(ro, rd, AR).y;
    var od = vec3f(0.0);
    let N = 64;
    let dt = tMax / f32(N);
    for (var i = 0; i < N; i++) {
      let t = (f32(i) + 0.5) * dt;
      od += medium(length(ro + rd * t) - PR).ext * dt;
    }
    T = exp(-od);
  }
  textureStore(out2d, id.xy, vec4f(T, 1.0));
}

// ---------------------------------------------------------------- multiple scattering (once)
@compute @workgroup_size(8, 8)
fn multiScatMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= MSN || id.y >= MSN) { return; }
  let uv = (vec2f(id.xy) + 0.5) / f32(MSN);
  let muS = uv.x * 2.0 - 1.0;
  let h = uv.y * (AR - PR);
  let ro = vec3f(0.0, PR + max(h, 0.002), 0.0);
  let sunD = vec3f(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  var L2 = vec3f(0.0);
  var fms = vec3f(0.0);
  let ND = 8;
  for (var a = 0; a < ND; a++) {
    for (var b = 0; b < ND; b++) {
      let th = acos(1.0 - 2.0 * (f32(a) + 0.5) / f32(ND));
      let ph = TAU * (f32(b) + 0.5) / f32(ND);
      let rd = vec3f(sin(th) * cos(ph), cos(th), sin(th) * sin(ph));
      let atm = raySphere(ro, rd, AR);
      let gnd = raySphere(ro, rd, PR);
      var tMax = atm.y;
      if (gnd.x > 0.0) { tMax = gnd.x; }
      let NS = 20;
      let dt = tMax / f32(NS);
      var T = vec3f(1.0);
      var Lf = vec3f(0.0);
      var Ff = vec3f(0.0);
      for (var i = 0; i < NS; i++) {
        let t = (f32(i) + 0.5) * dt;
        let p = ro + rd * t;
        let r = length(p);
        let up = p / r;
        let m = medium(r - PR);
        let sc = m.scat + vec3f(m.mieS);
        let Ts = getTrans(r - PR, dot(up, sunD));
        let S = Ts * sc / (4.0 * PI);
        let st = exp(-m.ext * dt);
        let ext = max(m.ext, vec3f(1e-7));
        Lf += T * (S - S * st) / ext;
        Ff += T * (sc - sc * st) / ext;
        T *= st;
      }
      if (gnd.x > 0.0) {
        let p = ro + rd * gnd.x;
        let up = normalize(p);
        Lf += T * getTrans(0.0, dot(up, sunD)) * max(dot(up, sunD), 0.0) * 0.3 / PI;
      }
      let w = 1.0 / f32(ND * ND);
      L2 += Lf * w;
      fms += Ff * w;
    }
  }
  let psi = L2 / max(vec3f(1.0) - fms, vec3f(1e-3));
  textureStore(out2d, id.xy, vec4f(psi, 1.0));
}

// ---------------------------------------------------------------- sky-view (every frame)
fn skyDirFromUV(uv: vec2f) -> vec3f {
  let az = (uv.x - 0.5) * TAU;
  let v = (1.0 - uv.y) * 2.0 - 1.0;
  let el = sign(v) * v * v * PI * 0.5;
  return vec3f(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
}

struct Scat { L: vec3f, T: vec3f };
fn integrate(ro: vec3f, rd: vec3f, tLimit: f32, N: i32) -> Scat {
  let atm = raySphere(ro, rd, AR);
  let gnd = raySphere(ro, rd, PR);
  var tMax = atm.y;
  if (gnd.x > 0.0) { tMax = gnd.x; }
  tMax = min(tMax, tLimit);
  let cs = dot(rd, world.sunDir);
  let cm = dot(rd, world.moonDir);
  let prS = phaseRay(cs); let pmS = phaseMie(cs);
  let prM = phaseRay(cm); let pmM = phaseMie(cm);
  let mI = moonI();
  var L = vec3f(0.0);
  var T = vec3f(1.0);
  var tPrev = 0.0;
  for (var i = 0; i < N; i++) {
    let f = (f32(i) + 0.3) / f32(N);
    let t = tMax * f * f;
    let dt = t - tPrev;
    tPrev = t;
    let p = ro + rd * t;
    let r = length(p);
    let h = r - PR;
    let up = p / r;
    let m = medium(h);
    let muS = dot(up, world.sunDir);
    let muM = dot(up, world.moonDir);
    let Ts = getTrans(h, muS);
    let Tm = getTrans(h, muM);
    var S = Ts * (m.scat * prS + m.mieS * pmS) * SUN_I + Tm * (m.scat * prM + m.mieS * pmM) * mI;
    S += (getMS(h, muS) * SUN_I + getMS(h, muM) * mI) * (m.scat + vec3f(m.mieS));
    let st = exp(-m.ext * dt);
    L += T * (S - S * st) / max(m.ext, vec3f(1e-7));
    T *= st;
  }
  return Scat(L, T);
}

@compute @workgroup_size(8, 8)
fn skyViewMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= SKW || id.y >= SKH) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(f32(SKW), f32(SKH));
  let rd = skyDirFromUV(uv);
  let ro = vec3f(0.0, PR + camAlt(), 0.0);
  var L = integrate(ro, rd, 1e6, 32).L;
  // faint airglow so the night sky isn't pure black
  L += vec3f(0.0003, 0.0004, 0.0007) * (1.0 + 2.0 * max(rd.y, 0.0));
  textureStore(out2d, id.xy, vec4f(L, 1.0));
}

// ---------------------------------------------------------------- terrain shadow on the air
// is a point in the air (world metres) in the mountains' shadow? A short march toward the sun over the far height
// map (coarser mips further out); soft. Valleys at dawn and dusk keep clear, dark air under lit peaks, and the
// shadows of ridges fall through the haze.
fn terrainHeightAt(xz: vec2f, lod: u32) -> f32 {
  let uv = xz / (2.0 * world.worldHalf) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return -1e5; }
  let dim = vec2i(textureDimensions(heightIn, lod));
  let ij = clamp(vec2i(uv * vec2f(dim)), vec2i(0), dim - 1);
  return textureLoad(heightIn, ij, lod).r;
}
fn airSunVis(p: vec3f, l: vec3f) -> f32 {
  if (l.y < -0.1) { return 1.0; }
  var vis = 1.0;
  var s = 24.0;
  let nl = textureNumLevels(heightIn);
  for (var i = 0; i < 13; i++) {
    let q = p + l * s;
    let lod = min(u32(max(log2(s / 24.0), 0.0)), nl - 1u);
    let h = terrainHeightAt(q.xz, lod);
    vis = min(vis, clamp((q.y - h) / (s * 0.04 + 4.0) + 0.5, 0.0, 1.0));
    s *= 1.6;
  }
  return vis;
}

// ---------------------------------------------------------------- aerial perspective froxels (every frame)
// x,y: screen uv, z: slice; distance = (z/N)^2 * AP_FAR. rgb in-scatter, a transmittance (grey).
@compute @workgroup_size(8, 8)
fn aerialMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= APN || id.y >= APN) { return; }
  let uv = (vec2f(id.xy) + 0.5) / f32(APN);
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let w = frame.invViewProj * vec4f(ndc, 0.5, 1.0);
  let rd = normalize(w.xyz / w.w - frame.camPos);
  let ro = vec3f(0.0, PR + camAlt(), 0.0);
  let cs = dot(rd, world.sunDir);
  let cm = dot(rd, world.moonDir);
  let prS = phaseRay(cs); let pmS = phaseMie(cs);
  let prM = phaseRay(cm); let pmM = phaseMie(cm);
  let mI = moonI();
  var L = vec3f(0.0);
  var T = vec3f(1.0);
  var tPrev = 0.0;
  for (var z = 0u; z < APN; z++) {
    let tEnd = sq((f32(z) + 1.0) / f32(APN)) * AP_FAR;
    let SUB = 2;
    for (var s = 0; s < SUB; s++) {
      let t = mix(tPrev, tEnd, (f32(s) + 0.5) / f32(SUB));
      let dt = (tEnd - tPrev) / f32(SUB);
      let p = ro + rd * t;
      let r = length(p);
      let h = r - PR;
      let up = p / r;
      let m = medium(h);
      let muS = dot(up, world.sunDir);
      let muM = dot(up, world.moonDir);
      let vis = airSunVis(frame.camPos + rd * (t * 1000.0), world.sunDir);
      var S = getTrans(h, muS) * (m.scat * prS + m.mieS * pmS) * SUN_I * vis + getTrans(h, muM) * (m.scat * prM + m.mieS * pmM) * mI;
      S += (getMS(h, muS) * SUN_I + getMS(h, muM) * mI) * (m.scat + vec3f(m.mieS));
      let st = exp(-m.ext * dt);
      L += T * (S - S * st) / max(m.ext, vec3f(1e-7));
      T *= st;
    }
    tPrev = tEnd;
    textureStore(out3d, vec3u(id.xy, z), vec4f(L, dot(T, vec3f(0.3333))));
  }
}

// ---------------------------------------------------------------- lighting block (every frame, 1 thread)
fn skySample(d: vec3f) -> vec3f {
  let az = atan2(d.x, -d.z);
  let el = asin(clamp(d.y, -1.0, 1.0));
  let v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (PI * 0.5));
  return textureSampleLevel(skyIn, samp_repeat, vec2f(az / TAU + 0.5, 1.0 - v), 0.0).rgb;
}

@compute @workgroup_size(1)
fn lightingMain() {
  let h = camAlt();
  let sunT = getTrans(h, world.sunDir.y);
  let sunFade = smoothstep(-0.02, 0.02, world.sunDir.y);
  let sunRad = SUN_I * sunT * sunFade / PI;
  let moonT = getTrans(h, world.moonDir.y);
  let moonRad = moonI() * moonT * smoothstep(-0.02, 0.05, world.moonDir.y) / PI * vec3f(0.78, 0.86, 1.1) * 1.8;
  // (the key hands over from the sun to the moon after sunset — the sun gone by then, the moon fading in as the key's
  // direction swings across to it: src/world/sky.ts celestial)
  let kw = smoothstep(-0.02, -0.1, world.sunDir.y);
  let key = mix(sunRad, moonRad * kw, kw);

  // sky irradiance SH (L2), from the sky-view LUT over the upper hemisphere + a ground bounce below
  var sh: array<vec3f, 9>;
  for (var k = 0; k < 9; k++) { sh[k] = vec3f(0.0); }
  // (under an overcast the light comes down from the deck's grey underside: a quarter of what reaches its top, brighter
  // overhead than toward the horizon)
  let oc = clamp(world.sky.x, 0.0, 1.0);
  let deck = vec3f(0.25 * (luminance(key) * max(world.lightDir.y, 0.05) + luminance(skySample(vec3f(0.0, 1.0, 0.0))))) * vec3f(0.95, 0.98, 1.04);
  let NA = 24; let NE = 12;
  let gAlb = vec3f(0.12, 0.11, 0.09);
  var wsum = 0.0;
  var up = vec3f(0.0); var wup = 0.0;
  var hor = vec3f(0.0);
  for (var i = 0; i < NE * 2; i++) {
    let ct = 1.0 - (f32(i) + 0.5) / f32(NE);   // cos theta from +1 to -1
    let st = sqrt(max(0.0, 1.0 - ct * ct));
    for (var j = 0; j < NA; j++) {
      let ph = (f32(j) + 0.5) / f32(NA) * TAU;
      let d = vec3f(st * sin(ph), ct, -st * cos(ph));
      var L: vec3f;
      if (ct > 0.0) { L = mix(skySample(d), deck * (0.55 + 0.45 * ct), oc); } else { L = gAlb * (key * max(world.lightDir.y, 0.0) * (1.0 - 0.8 * oc) + vec3f(0.0)); }
      var b = array<f32, 9>(0.282095, 0.488603 * d.y, 0.488603 * d.z, 0.488603 * d.x, 1.092548 * d.x * d.y, 1.092548 * d.y * d.z,
                            0.315392 * (3.0 * d.z * d.z - 1.0), 1.092548 * d.x * d.z, 0.546274 * (d.x * d.x - d.y * d.y));
      for (var k = 0; k < 9; k++) { sh[k] += L * b[k]; }
      wsum += 1.0;
      if (ct > 0.0) { up += L * ct; wup += ct; }
      if (abs(ct - 0.06) < 0.09) { hor += L; }
    }
  }
  let norm = 4.0 * PI / wsum;
  // convolve with the clamped cosine lobe (A0 = pi, A1 = 2pi/3, A2 = pi/4), then / PI for radiance-equivalent
  var A = array<f32, 9>(1.0, 0.6667, 0.6667, 0.6667, 0.25, 0.25, 0.25, 0.25, 0.25);
  for (var k = 0; k < 9; k++) { lightOut.sh[k] = vec4f(sh[k] * norm * A[k], 0.0); }
  up /= max(wup, 1e-4);
  hor /= f32(NA * 2);
  lightOut.sunRad = vec4f(sunRad, sunFade);
  lightOut.moonRad = vec4f(moonRad, 0.0);
  lightOut.keyRad = vec4f(key, 0.0);
  lightOut.skyUp = vec4f(up, 0.0);
  lightOut.skyHorizon = vec4f(hor, 0.0);
  lightOut.skyZenith = vec4f(skySample(vec3f(0.0, 1.0, 0.0)), 0.0);
  lightOut.groundBounce = vec4f(gAlb * (key * max(world.lightDir.y, 0.0) + up), 0.0);
  lightOut.fogColor = vec4f(hor, 0.0);
  // the key light up in the air (the clouds' sun): its own path through the atmosphere, and the horizon's dip — up
  // there the sun sets later, so towers keep their gold while the ground is in shadow. (The sun's colour only: where its
  // disc sets is a matter of each sample's own height — keyAltAt — or the heights between these eight would share a
  // little of the sunlight above them after it has gone, red caps on clouds already in the earth's shadow. w: the
  // moon's share)
  for (var k = 0; k < 8; k++) {
    let hk = max(world.altitudeKm, 0.0) + 8.5 * pow(f32(k) / 7.0, 2.5) + 0.01;
    let dip = sqrt(2.0 * hk / 6360.0);
    let sT = getTrans(hk, clamp(world.sunDir.y + dip * 0.9, -1.0, 1.0));
    let sR = SUN_I * sT / PI;
    let mT = getTrans(hk, clamp(world.moonDir.y + dip * 0.9, -1.0, 1.0));
    let mR = moonI() * mT * smoothstep(-0.02 - dip, 0.05 - dip, world.moonDir.y) / PI * vec3f(0.78, 0.86, 1.1) * 1.8;
    let kwk = smoothstep(-0.02 - dip, -0.1 - dip, world.sunDir.y);
    lightOut.keyAlt[k] = vec4f(mix(sR, mR * kwk, kwk), kwk);
  }
}
