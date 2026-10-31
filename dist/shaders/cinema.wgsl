// Screen-space light: ambient occlusion (GTAO, half res, applied to the ambient share of the opaque scene before the
// water), low valley mist (a short half-res march through a noisy layer over the water, lit by the sky and the
// sun / moon through the mountains', clouds' and trees' shadows) and sun / moon shafts (radial blur of the sky's
// visibility toward the light). Ported from waterbending (src/shaders/cinematic.wgsl); src/render/cinema.ts drives it.
#include "./env"
#include "weft/fullscreen"
struct FX {
  ao: vec4f,      // x radius (m), y strength, z max radius (full-res px), w share applied to sunlit light
  aoK: vec4f,     // x multi-bounce, y fade start (m), z fade end (m), w radius growth per metre of depth
  shaft: vec4f,   // xy light position (uv), z strength (0 = off), w march length (uv)
  shaftK: vec4f,  // x decay, y air scale (m), z phase g, w the low clouds' transmittance is in texA (shaft pass 0)
  mist: vec4f,    // x density at the water (1/m), y height scale (m), z top above the water (m), w max distance (m)
  mistK: vec4f,   // x drift time (s), y water level, z noise contrast, w phase g
  dbg: vec4f,     // x debug view (1 AO factor, 2 raw AO), y AO contrast (power)
};
@group(2) @binding(0) var<uniform> X: FX;
@group(2) @binding(1) var depthFull: texture_depth_2d;   // resolved scene depth (reversed-Z, infinite far)
@group(2) @binding(2) var zHalf: texture_2d<f32>;        // half-res view distance (prep pass) + 2 min mips
@group(2) @binding(3) var texA: texture_2d<f32>;
@group(2) @binding(4) var texB: texture_2d<f32>;

const SKY_Z: f32 = 6e4;
/** view distance along the camera axis from a reversed-Z infinite depth (sky: SKY_Z) */
fn viewZ(d: f32) -> f32 { return select(frame.near / max(d, 1e-12), SKY_Z, d <= 0.0); }
/** view space (x right, y up, z forward distance) of a full-res pixel position */
fn viewPosAt(px: vec2f, z: f32) -> vec3f {
  let ndc = vec2f(px.x * frame.invRes.x * 2.0 - 1.0, 1.0 - px.y * frame.invRes.y * 2.0);
  return vec3f(ndc.x * z / frame.proj[0][0], ndc.y * z / frame.proj[1][1], z);
}
fn viewToWorld(v: vec3f) -> vec3f { return frame.camRight * v.x + frame.camUp * v.y + frame.camFwd * v.z; }
fn fullDepth(p: vec2i) -> f32 {
  let dim = vec2i(textureDimensions(depthFull));
  return textureLoad(depthFull, clamp(p, vec2i(0), dim - 1), 0);
}
fn bayer4(p: vec2i) -> f32 {
  var m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return m[(p.y & 3) * 4 + (p.x & 3)];
}
fn fastAcos(x: f32) -> f32 {
  let a = abs(x);
  var r = (-0.156583 * a + PI * 0.5) * sqrt(max(1.0 - a, 0.0));
  return select(r, PI - r, x < 0.0);
}

// ---------------------------------------------------------------- prep: half-res view distance (+ its mips: nearest)
@fragment fn fsPrep(fin: FullscreenOut) -> @location(0) vec4f {
  return vec4f(viewZ(fullDepth(vec2i(fin.pos.xy) * 2)), 0.0, 0.0, 1.0);
}
@fragment fn fsZDown(fin: FullscreenOut) -> @location(0) vec4f {
  let p = vec2i(fin.pos.xy) * 2;
  let m = vec2i(textureDimensions(zHalf)) - 1;
  let a = textureLoad(zHalf, min(p, m), 0).r;
  let b = textureLoad(zHalf, min(p + vec2i(1, 0), m), 0).r;
  let c = textureLoad(zHalf, min(p + vec2i(0, 1), m), 0).r;
  let d = textureLoad(zHalf, min(p + vec2i(1, 1), m), 0).r;
  return vec4f(min(min(a, b), min(c, d)), 0.0, 0.0, 1.0);
}
// ---------------------------------------------------------------- GTAO (Jimenez et al. 2016, after XeGTAO)
// out: x visibility, y how much of the pixel's light it applies to (the ambient share, faded with distance / haze),
// z the irradiance (luminance) the pixel is lit by (for the multi-bounce albedo guess)
const AO_SLICES: i32 = 2;
const AO_STEPS: i32 = 3;
@fragment fn fsAO(fin: FullscreenOut) -> @location(0) vec4f {
  let hp = vec2i(fin.pos.xy);
  let fp = hp * 2;
  let dc = fullDepth(fp);
  if (dc <= 0.0) { return vec4f(1.0, 0.0, 1.0, 1.0); }
  let pxc = vec2f(fp) + 0.5;
  let P = viewPosAt(pxc, viewZ(dc));
  // normal from the full-res neighbours (on each axis the side with the smaller depth step: no smearing over edges)
  let Pl = viewPosAt(pxc - vec2f(1.0, 0.0), viewZ(fullDepth(fp - vec2i(1, 0))));
  let Pr = viewPosAt(pxc + vec2f(1.0, 0.0), viewZ(fullDepth(fp + vec2i(1, 0))));
  let Pu = viewPosAt(pxc - vec2f(0.0, 1.0), viewZ(fullDepth(fp - vec2i(0, 1))));
  let Pd = viewPosAt(pxc + vec2f(0.0, 1.0), viewZ(fullDepth(fp + vec2i(0, 1))));
  let dxv = select(P - Pl, Pr - P, abs(Pr.z - P.z) < abs(Pl.z - P.z));
  let dyv = select(P - Pu, Pd - P, abs(Pd.z - P.z) < abs(Pu.z - P.z));
  var N = normalize(cross(dyv, dxv));
  if (dot(N, P) > 0.0) { N = -N; }
  let V = normalize(-P);
  let z = P.z;
  // world radius (a little larger further out: tree bases and boulders in the middle distance), in full-res px
  let R = X.ao.x * (1.0 + z * X.aoK.w);
  let pxPerM = frame.proj[1][1] * 0.5 * frame.res.y / z;
  let rWant = R * pxPerM;
  let rPx = min(rWant, X.ao.z);
  let Reff = R * rPx / max(rWant, 1e-4);
  var vis = 1.0;
  if (rPx > 3.0) {
    let falloffRange = 0.6 * Reff;
    let falloffMul = -1.0 / falloffRange;
    let falloffAdd = (Reff - falloffRange) / falloffRange + 1.0;
    let sliceNoise = (bayer4(hp) + 0.5) / 16.0;
    let stepNoise = fract(ign(vec2f(hp)) + sliceNoise * 0.618);
    // taps on the half-res distance map (further ones on its coarser, nearest-of mips), each positioned at the
    // full-res pixel it stands for: view xy = (px * pk + pb) * z
    let pk = vec2f(2.0 * frame.invRes.x / frame.proj[0][0], -2.0 * frame.invRes.y / frame.proj[1][1]);
    let pb = vec2f(-1.0 / frame.proj[0][0], 1.0 / frame.proj[1][1]);
    let dim0 = vec2i(textureDimensions(zHalf));
    var acc = 0.0;
    for (var s = 0; s < AO_SLICES; s++) {
      let phi = (f32(s) + sliceNoise) * PI / f32(AO_SLICES);
      let cp = cos(phi); let sp = sin(phi);
      let omega = vec2f(cp, -sp);            // screen direction (pixels, y down)
      let dirV = vec3f(cp, sp, 0.0);         // the same direction in view space (y up)
      let orthoDir = dirV - dot(dirV, V) * V;
      let axis = normalize(cross(orthoDir, V));
      let projN = N - axis * dot(N, axis);
      let projLen = length(projN);
      let signN = sign(dot(orthoDir, projN));
      let cosN = sat(dot(projN, V) / max(projLen, 1e-4));
      let n = signN * fastAcos(cosN);
      let low0 = cos(n + PI * 0.5);
      let low1 = cos(n - PI * 0.5);
      var hc0 = low0; var hc1 = low1;
      for (var j = 0; j < AO_STEPS; j++) {
        var t = (f32(j) + stepNoise) / f32(AO_STEPS);
        t = t * t;
        let ol = 2.5 + t * (rPx - 2.5);
        let off = omega * ol;
        let mip = u32(clamp(log2(ol) - 3.3, 0.0, 2.0));
        let sz = f32(1u << mip);
        let qm = max((dim0 >> vec2u(mip)) - 1, vec2i(0));
        let q0 = clamp(vec2i(floor((pxc + off) * (0.5 / sz))), vec2i(0), qm);
        let q1 = clamp(vec2i(floor((pxc - off) * (0.5 / sz))), vec2i(0), qm);
        let z0 = textureLoad(zHalf, q0, mip).r;
        let z1 = textureLoad(zHalf, q1, mip).r;
        let d0 = vec3f((vec2f(q0) * (2.0 * sz) + (sz - 0.5)) * pk * z0 + pb * z0, z0) - P;
        let d1 = vec3f((vec2f(q1) * (2.0 * sz) + (sz - 0.5)) * pk * z1 + pb * z1, z1) - P;
        let il0 = inverseSqrt(dot(d0, d0)); let il1 = inverseSqrt(dot(d1, d1));
        let w0 = sat(falloffMul / il0 + falloffAdd);
        let w1 = sat(falloffMul / il1 + falloffAdd);
        hc0 = max(hc0, mix(low0, dot(d0, V) * il0, w0));
        hc1 = max(hc1, mix(low1, dot(d1, V) * il1, w1));
      }
      let pl = mix(projLen, 1.0, 0.05);
      var h0 = -fastAcos(hc1);
      var h1 = fastAcos(hc0);
      h0 = n + clamp(h0 - n, -PI * 0.5, PI * 0.5);
      h1 = n + clamp(h1 - n, -PI * 0.5, PI * 0.5);
      let sn = sin(n);
      acc += pl * ((cosN + 2.0 * h0 * sn - cos(2.0 * h0 - n)) + (cosN + 2.0 * h1 * sn - cos(2.0 * h1 - n))) * 0.25;
    }
    vis = pow(sat(acc / f32(AO_SLICES)), X.dbg.y);
  }
  // how much of this pixel's light is ambient (what AO should dim): its sky light against the key light reaching it
  let Nw = viewToWorld(N);
  let wp = frame.camPos + viewToWorld(P);
  let nl = max(dot(Nw, world.lightDir), 0.0);
  var sun = 0.0;
  if (nl > 0.0) { sun = keyVisAt(wp + Nw * 0.05 + world.lightDir * 0.05, false); }
  let direct = luminance(lighting.keyRad.rgb) * nl * sun;
  let amb = luminance(shIrradiance(Nw) + lighting.groundBounce.rgb * 0.25 * sat(0.5 - Nw.y)) + 1e-6;
  let ambShare = amb / (amb + direct);
  // fades out with distance (and the haze in front isn't occluded; under water the medium's own glow isn't either)
  var fade = 1.0 - smoothstep(X.aoK.y, X.aoK.z, z);
  let w = (ambShare + X.ao.w * (1.0 - ambShare)) * fade * X.ao.y;
  return vec4f(vis, w, amb + direct, 1.0);
}

// ---------------------------------------------------------------- AO denoise (4x4 depth-aware) + multi-bounce colour
// texA: the raw AO, texB: the lit scene (for an albedo guess) -> the per-channel factor the scene is multiplied by
@fragment fn fsAOBlur(fin: FullscreenOut) -> @location(0) vec4f {
  let hp = vec2i(fin.pos.xy);
  let zc = textureLoad(zHalf, hp, 0).r;
  if (zc >= SKY_Z * 0.5) { return vec4f(1.0); }
  let dim = vec2i(textureDimensions(zHalf)) - 1;
  var s = vec3f(0.0); var ws = 0.0;
  let tol = 1.0 / (zc * 0.04 + 0.03);
  for (var j = -2; j < 2; j++) {
    for (var i = -2; i < 2; i++) {
      let q = clamp(hp + vec2i(i, j), vec2i(0), dim);
      let z = textureLoad(zHalf, q, 0).r;
      let a = textureLoad(texA, q, 0).xyz;
      let w = max(0.0, 1.0 - abs(z - zc) * tol) + 1e-4 * f32(i == 0 && j == 0);
      s += a * w; ws += w;
    }
  }
  let a = s / ws;
  let vis = a.x;
  // multi-bounce (Jimenez 2016): bright, saturated surfaces lose less light in their creases, and what they keep
  // takes their colour. Albedo guessed from the lit colour over the irradiance it was lit with.
  let c = textureSampleLevel(texB, samp_linear, fin.uv, 0.0).rgb;
  let alb = clamp(c / max(a.z, 1e-5), vec3f(0.0), vec3f(0.9)) * X.aoK.x;
  let ka = 2.0404 * alb - 0.3324;
  let kb = -4.7951 * alb + 0.6417;
  let kc = 2.7552 * alb + 0.6903;
  let mb = max(vec3f(vis), ((vis * ka + kb) * vis + kc) * vis);
  if (X.dbg.x == 2.0) { return vec4f(vec3f(vis), 1.0); }
  return vec4f(vec3f(1.0) - (vec3f(1.0) - mb) * a.y, 1.0);
}

// ---------------------------------------------------------------- AO apply (full res, multiplied into the scene)
fn aoFactor(fin: FullscreenOut) -> vec4f {
  let p = vec2i(fin.pos.xy);
  let d = fullDepth(p);
  if (d <= 0.0) { return vec4f(1.0); }
  let z = viewZ(d);
  // the 4 nearest half-res texels (each taken from full-res pixel 2i), bilinear x depth similarity
  let t = vec2f(p) * 0.5;
  let b = vec2i(floor(t));
  let f = t - vec2f(b);
  let dim = vec2i(textureDimensions(zHalf)) - 1;
  var s = vec3f(0.0); var ws = 0.0;
  let tol = 1.0 / (z * 0.03 + 0.02);
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let q = clamp(b + o, vec2i(0), dim);
    let bw = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let w = (bw + 1e-3) * max(1e-3, 1.0 - abs(textureLoad(zHalf, q, 0).r - z) * tol);
    s += textureLoad(texA, q, 0).rgb * w; ws += w;
  }
  return vec4f(s / ws, 1.0);
}
@fragment fn fsAOApply(fin: FullscreenOut) -> @location(0) vec4f { return aoFactor(fin); }
@fragment fn fsAODebug(fin: FullscreenOut) -> @location(0) vec4f { return vec4f(aoFactor(fin).rgb * 0.25, 1.0); }

// ---------------------------------------------------------------- valley mist (half res, after the water)
// a layer pooled over the water / valley floor: density falls off with height, broken into drifting banks by noise;
// lit by the sky and by the key light through the mountains', clouds' and trees' shadows (forward scattering).
// out: rgb in-scatter, a transmittance
fn mistDensity(p: vec3f) -> f32 {
  let h = p.y - X.mistK.y;
  let t = X.mistK.x;
  // banks (~300 m) of thicker and thinner mist, wisps (~50 m and ~14 m) drifting through them
  let big = vnoise(p.xz * 0.0033 + vec2f(t * 0.0021, -t * 0.0013));
  let q = p.xz * 0.018 + vec2f(t * 0.011, t * 0.004);
  let q2 = p.xz * 0.071 + vec2f(-t * 0.02, t * 0.013) + vec2f(h * 0.05);
  let n = vnoise(q) * 0.62 + vnoise(q2) * 0.38;
  let banks = mix(1.0, smoothstep(0.28, 0.72, n) * 1.8, X.mistK.z) * (0.35 + 1.3 * big * big);
  // (it thins out right around the viewer: you stand in a clearing of the mist, the banks are out over the water;
  // and far away, where the aerial perspective takes over: no thin glowing line along the far waterline)
  let dc = distance(p.xz, frame.camPos.xz);
  let near = smoothstep(6.0, 45.0, dc) * (1.0 - smoothstep(1200.0, 2600.0, dc));
  return X.mist.x * exp(-max(h, -1.0) / X.mist.y) * banks * (0.15 + 0.85 * near);
}
fn keyVisAt(p: vec3f, clouds: bool) -> f32 {
  // one hardware-filtered tap of the near cascades (trees cut shafts into the mist) + the mountains' + clouds' shadow
  var s = 1.0;
  let d = dot(p - frame.camPos, frame.camFwd);
  if (d < world.cascades.y) {
    let ci = select(1, 0, d < world.cascades.x);
    let sc = shadowCascadeCoord(p, ci);
    if (all(sc.xy > vec2f(0.0)) && all(sc.xy < vec2f(1.0)) && sc.z < 1.0) {
      s = textureSampleCompareLevel(shadowTex, samp_shadow, sc.xy, ci, sc.z);
    }
  }
  s *= hfShadowAt(p);
  if (clouds) { s *= cloudShadowAt(p); }
  return s;
}
// (half res: each texel stands for full-res pixel 2i; its view distance goes out too, for the upsample. No per-pixel
// jitter: without a temporal filter it would show as grain; the steps are spaced to stay smooth instead)
const MIST_STEPS: i32 = 8;
struct MistOut { @location(0) m: vec4f, @location(1) z: vec4f };
@fragment fn fsMist(fin: FullscreenOut) -> MistOut {
  let qp = vec2i(fin.pos.xy) * 2;
  let pxc = vec2f(qp) + 0.5;
  let zv = viewZ(fullDepth(qp));
  var o: MistOut;
  o.z = vec4f(zv, 0.0, 0.0, 1.0);
  o.m = mistAlong(pxc, zv);
  return o;
}
fn mistAlong(pxc: vec2f, zv: f32) -> vec4f {
  let P = viewToWorld(viewPosAt(pxc, min(zv, 1e6)));
  let dist = length(P);
  let rd = P / dist;
  var tEnd = min(dist, X.mist.w);
  // clip the ray to the slab the mist lives in
  let wl = X.mistK.y;
  let y0 = frame.camPos.y;
  let top = wl + X.mist.z;
  let bot = wl - 2.0;
  var t0 = 0.0; var t1 = tEnd;
  if (abs(rd.y) > 1e-4) {
    let ta = (top - y0) / rd.y;
    let tb = (bot - y0) / rd.y;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (y0 > top || y0 < bot) { t1 = -1.0; }
  if (t1 <= t0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  // light: the sky's ambient (a little of the horizon's colour) + the key light, forward scattered
  let L = world.lightDir;
  let mu = dot(rd, L);
  let g = X.mistK.w;
  let phase = mix(henyeyGreenstein(mu, g), henyeyGreenstein(mu, -0.2), 0.3) * 4.0 * PI;
  // (the horizon's and the sky's light, as the height fog has it — a dim veil at night, not a glowing band)
  let amb = (lighting.fogColor.rgb * 0.45 + shIrradiance(vec3f(0.0, 1.0, 0.0)) * 0.35) * (1.0 - 0.5 * world.nightness);
  // (a light right at the horizon doesn't reach the valley floor's mist: the ridges are in the way)
  let key = lighting.keyRad.rgb * PI * 0.5 * smoothstep(0.0, 0.1, L.y);
  // steps spread over the slab, denser near the camera (each sampled at its middle)
  var T = 1.0;
  var S = vec3f(0.0);
  var tp = t0;
  for (var i = 0; i < MIST_STEPS; i++) {
    let f1 = (f32(i) + 1.0) / f32(MIST_STEPS);
    let tn = mix(t0, t1, f1 * f1);
    let tm = (tp + tn) * 0.5;
    let p = frame.camPos + rd * tm;
    let rho = mistDensity(p);
    let dt = tn - tp;
    tp = tn;
    if (rho * dt < 1e-5) { continue; }
    let tr = exp(-rho * dt);
    let li = amb + key * phase * keyVisAt(p, true);
    S += T * (1.0 - tr) * li;
    T *= tr;
  }
  // (never a solid wall: along the long, grazing rays over the water the far shore still shows through)
  // (and only a light veil over the horizon's sky, which already holds the distance's haze)
  let tMin = select(0.3, 0.75, zv >= SKY_Z * 0.5);
  if (T < tMin) { S *= (1.0 - tMin) / (1.0 - T); T = tMin; }
  return vec4f(S, T);
}
// full res, after the water: the half-res mist (bilateral upsample; texA, its distances in zHalf) over the scene and
// the shafts (texB) added (blend: one, src-alpha)
@fragment fn fsAirApply(fin: FullscreenOut) -> @location(0) vec4f {
  let p = vec2i(fin.pos.xy);
  let z = min(viewZ(fullDepth(p)), SKY_Z);
  var m = vec4f(0.0, 0.0, 0.0, 1.0);
  if (X.mist.x > 0.0) {
    let t = vec2f(p) * 0.5;
    let b = vec2i(floor(t));
    let f = t - vec2f(b);
    let dim = vec2i(textureDimensions(texA)) - 1;
    var s = vec4f(0.0); var ws = 0.0;
    let tol = 1.0 / (z * 0.06 + 0.05);
    for (var k = 0; k < 4; k++) {
      let o = vec2i(k & 1, k >> 1);
      let q = clamp(b + o, vec2i(0), dim);
      let bw = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
      let w = (bw + 1e-3) * max(1e-3, 1.0 - abs(textureLoad(zHalf, q, 0).r - z) * tol);
      s += textureLoad(texA, q, 0) * w; ws += w;
    }
    m = s / ws;
  }
  if (X.shaft.z > 0.0) { m = vec4f(m.rgb + shaftLight(fin, z), m.a); }
  return m;
}

// ---------------------------------------------------------------- sun / moon shafts
// two nested radial blurs toward the light (16 coarse x 16 fine samples) of the sky's visibility
override SHAFT_PASS: u32 = 0u;
const SHAFT_N: i32 = 16;
@fragment fn fsShaft(fin: FullscreenOut) -> @location(0) vec4f {
  let uv = fin.uv;
  var dir = X.shaft.xy - uv;
  let len = length(dir);
  dir *= min(1.0, X.shaft.w / max(len, 1e-5));
  let jit = ign(fin.pos.xy);
  var s = 0.0; var ws = 0.0; var w = 1.0;
  if (SHAFT_PASS == 0u) {
    let dim = vec2f(textureDimensions(zHalf));
    let step = dir / f32(SHAFT_N);
    let decay = X.shaftK.x;
    for (var i = 0; i < SHAFT_N; i++) {
      let q = uv + step * (f32(i) + jit);
      let inside = all(q >= vec2f(0.0)) && all(q <= vec2f(1.0));
      let z = textureLoad(zHalf, vec2i(clamp(q, vec2f(0.0), vec2f(0.9999)) * dim), 0).r;
      // (through the gaps in the low clouds only: src/render/clouds.ts)
      let cT = select(1.0, textureSampleLevel(texA, samp_linear, clamp(q, vec2f(0.0), vec2f(1.0)), 0.0).a, X.shaftK.w > 0.5);
      // (off screen toward the light: assume open sky, faded a little)
      s += select(0.6, select(0.0, cT, z >= SKY_Z * 0.5), inside) * w;
      ws += w; w *= decay;
    }
  } else {
    let step = dir / f32(SHAFT_N * SHAFT_N);
    let decay = pow(X.shaftK.x, 1.0 / f32(SHAFT_N));
    for (var i = 0; i < SHAFT_N; i++) {
      s += textureSampleLevel(texA, samp_linear, uv + step * (f32(i) + jit), 0.0).r * w;
      ws += w; w *= decay;
    }
  }
  return vec4f(s / ws, 0.0, 0.0, 1.0);
}
/** light scattered toward the eye along the lit stretches of the view ray (the shafts, texB) */
fn shaftLight(fin: FullscreenOut, z: f32) -> vec3f {
  let s = textureSampleLevel(texB, samp_linear, fin.uv, 0.0).r;
  let ndc = vec2f(fin.uv.x * 2.0 - 1.0, 1.0 - fin.uv.y * 2.0);
  let rd = normalize(viewToWorld(vec3f(ndc.x / frame.proj[0][0], ndc.y / frame.proj[1][1], 1.0)));
  // (over the sky only a little: the sky already holds the sun's glow; the rays show against the land)
  let air = select(1.0 - exp(-z / X.shaftK.y), 0.3, z >= SKY_Z * 0.5);
  let mu = dot(rd, world.lightDir);
  let phase = henyeyGreenstein(mu, X.shaftK.z) * 4.0 * PI;
  return lighting.keyRad.rgb * PI * s * s * air * phase * X.shaft.z;
}
