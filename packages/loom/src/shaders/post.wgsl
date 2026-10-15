// The frame's end (the film look ported from waterbending's src/shaders/post.wgsl): the MSAA depth resolve, camera
// motion blur, a wide energy-conserving bloom (13-tap down / tent up), histogram eye adaptation with highlight
// protection and an exposure compensation curve, AgX with a firmer film base, a hue-selective grade with split toning,
// scotopic night vision, vignette, grain and dither.
#include "./globals"
#include "weft/fullscreen"

struct Post {
  exposure: f32, bloom: f32, bloomThreshold: f32, saturation: f32,
  contrast: f32, warmth: f32, vignette: f32, grain: f32,
  time: f32, autoExposure: f32, first: f32, pad: f32,
  lift: vec4f,     // rgb lift, w nightness
  gain: vec4f,
  look: vec4f,     // x the film look, y bloom: weight of each wider level, z 1 / sum of level weights, w split tone
  uw: vec4f,       // under water: x the glow's spread, y the vignette, z exposure lift (stops), w how far under
}
@group(2) @binding(0) var<uniform> P: Post;
@group(2) @binding(1) var src: texture_2d<f32>;
@group(2) @binding(2) var bloomTex: texture_2d<f32>;
@group(2) @binding(3) var<storage, read> expo: array<f32, 4>;
@group(2) @binding(4) var<storage, read_write> expoOut: array<f32, 4>;
@group(2) @binding(5) var depthMS: texture_depth_multisampled_2d;
@group(2) @binding(6) var lumSrc: texture_2d<f32>;

// ---------------------------------------------------------------- depth resolve: the farthest sample (reversed-Z: min)
// so edges don't eat the water behind them
@fragment fn fs_depth(i: FullscreenOut) -> @builtin(frag_depth) f32 {
  let c = vec2i(i.pos.xy);
  var d = textureLoad(depthMS, c, 0);
  for (var k = 1; k < 4; k++) { d = min(d, textureLoad(depthMS, c, k)); }
  return d;
}

// ---------------------------------------------------------------- bloom: 13-tap downsample (CoD: AW), soft threshold
fn karis(c: vec3f) -> f32 { return 1.0 / (1.0 + luminance(c) * 0.25); }
@fragment fn fs_down(i: FullscreenOut) -> @location(0) vec4f {
  let t = 1.0 / vec2f(textureDimensions(src, 0));
  let uv = i.uv;
  let a = textureSampleLevel(src, samp_linear, uv + t * vec2f(-2.0, -2.0), 0.0).rgb;
  let b = textureSampleLevel(src, samp_linear, uv + t * vec2f(0.0, -2.0), 0.0).rgb;
  let c = textureSampleLevel(src, samp_linear, uv + t * vec2f(2.0, -2.0), 0.0).rgb;
  let d = textureSampleLevel(src, samp_linear, uv + t * vec2f(-2.0, 0.0), 0.0).rgb;
  let e = textureSampleLevel(src, samp_linear, uv, 0.0).rgb;
  let f = textureSampleLevel(src, samp_linear, uv + t * vec2f(2.0, 0.0), 0.0).rgb;
  let g = textureSampleLevel(src, samp_linear, uv + t * vec2f(-2.0, 2.0), 0.0).rgb;
  let h = textureSampleLevel(src, samp_linear, uv + t * vec2f(0.0, 2.0), 0.0).rgb;
  let k = textureSampleLevel(src, samp_linear, uv + t * vec2f(2.0, 2.0), 0.0).rgb;
  let j = textureSampleLevel(src, samp_linear, uv + t * vec2f(-1.0, -1.0), 0.0).rgb;
  let l = textureSampleLevel(src, samp_linear, uv + t * vec2f(1.0, -1.0), 0.0).rgb;
  let m = textureSampleLevel(src, samp_linear, uv + t * vec2f(-1.0, 1.0), 0.0).rgb;
  let n = textureSampleLevel(src, samp_linear, uv + t * vec2f(1.0, 1.0), 0.0).rgb;
  var o = e * 0.125 + (a + c + g + k) * 0.03125 + (b + d + f + h) * 0.0625 + (j + l + m + n) * 0.125;
  if (P.first > 0.5) {
    // first level: firefly suppression (+ an optional soft knee threshold in exposed units)
    let ex = P.exposure * mix(1.0, expo[0], P.autoExposure);
    o = o * karis(o * ex);
    if (P.bloomThreshold > 0.0) {
      let lum = luminance(o) * ex;
      o *= sat((lum - P.bloomThreshold) / max(lum, 1e-4) + 0.25 * smoothstep(0.0, P.bloomThreshold * 2.0, lum));
    }
  }
  return vec4f(max(o, vec3f(0.0)), 1.0);
}
@fragment fn fs_up(i: FullscreenOut) -> @location(0) vec4f {
  let t = 1.0 / vec2f(textureDimensions(src, 0));
  let uv = i.uv;
  var s = textureSampleLevel(src, samp_linear, uv + t * vec2f(-1.0, -1.0), 0.0).rgb;
  s += textureSampleLevel(src, samp_linear, uv + t * vec2f(0.0, -1.0), 0.0).rgb * 2.0;
  s += textureSampleLevel(src, samp_linear, uv + t * vec2f(1.0, -1.0), 0.0).rgb;
  s += textureSampleLevel(src, samp_linear, uv + t * vec2f(-1.0, 0.0), 0.0).rgb * 2.0;
  s += textureSampleLevel(src, samp_linear, uv, 0.0).rgb * 4.0;
  s += textureSampleLevel(src, samp_linear, uv + t * vec2f(1.0, 0.0), 0.0).rgb * 2.0;
  s += textureSampleLevel(src, samp_linear, uv + t * vec2f(-1.0, 1.0), 0.0).rgb;
  s += textureSampleLevel(src, samp_linear, uv + t * vec2f(0.0, 1.0), 0.0).rgb * 2.0;
  s += textureSampleLevel(src, samp_linear, uv + t * vec2f(1.0, 1.0), 0.0).rgb;
  // (wider levels weigh more: a soft, wide glow rather than a tight halo; normalised in fs_composite)
  return vec4f(s / 16.0 * P.look.y, 1.0);
}

// ---------------------------------------------------------------- AgX (Sobotka; Wrensch's fit), the film base
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agxFilm(c0: vec3f) -> vec3f {
  let inset = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let outset = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var c = inset * max(c0, vec3f(1e-10));
  c = clamp(log2(c), vec3f(minEv), vec3f(maxEv));
  c = (c - minEv) / (maxEv - minEv);
  c = agxContrast(c);
  // (at night the darks stay deep: moonlight, not a grey veil)
  c = pow(max(c, vec3f(0.0)), vec3f(1.15 + 0.2 * P.lift.w));
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = l + (c - l) * 1.06;
  return outset * c;
}
fn hue01(c: vec3f) -> f32 {
  let mx = max(c.r, max(c.g, c.b));
  let ch = mx - min(c.r, min(c.g, c.b));
  if (ch < 1e-5) { return 0.0; }
  var h = 4.0 + (c.r - c.g) / ch;
  if (mx == c.r) { h = (c.g - c.b) / ch; } else if (mx == c.g) { h = 2.0 + (c.b - c.r) / ch; }
  return fract(h / 6.0);
}
/** display-space grade: hue-selective saturation (acid yellow-greens and electric blues and cyans calmed, skin and
 *  glowing things kept), cool shadows / warm highlights, soft moonlight */
fn filmGrade(d0: vec3f, amt: f32) -> vec3f {
  var d = d0;
  let l = luminance(d);
  let h = hue01(d);
  let yg = (1.0 - smoothstep(0.0, 0.09, abs(h - 0.215))) * (1.0 - smoothstep(0.55, 0.85, l)) * (1.0 - P.lift.w);
  let bl = 1.0 - smoothstep(0.0, 0.07, abs(h - 0.64));
  let cy = 1.0 - smoothstep(0.0, 0.06, abs(h - 0.49));
  let sat0 = 1.0 - 0.3 * yg - 0.1 * bl - 0.16 * cy * (1.0 - P.uw.w);
  d = mix(vec3f(l), d, sat0);
  d *= 1.0 - 0.06 * yg;
  let shK = 1.0 - smoothstep(0.0, 0.42, l);
  let hiK = smoothstep(0.45, 0.95, l);
  d += (vec3f(-0.012, 0.002, 0.02) * shK * (0.4 + 0.6 * l * 4.0) + vec3f(0.028, 0.004, -0.06) * hiK) * amt;
  let n = P.lift.w;
  if (n > 0.0) {
    let ln = luminance(d);
    d = mix(d, d / (1.0 + ln * 0.7) * vec3f(0.98, 1.02, 1.1), n);
  }
  return d;
}
/** the vivid look (a stylized world): the brightest channel through a soft shoulder and the others kept in proportion —
 *  a saturated colour stays saturated as it brightens (AgX bleaches it toward white, as film does); far past the
 *  shoulder a little white comes in, so lights still glow. To display (sRGB-ish) */
fn vividTone(c: vec3f) -> vec3f {
  let m = max(max(c.r, c.g), max(c.b, 1e-6));
  let mt = m * (1.0 + m / 9.0) / (1.0 + m);
  var d = c * (mt / m);
  d = mix(d, vec3f(min(mt, 1.0)), smoothstep(1.2, 5.0, m) * 0.45);
  return pow(clamp(d, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
}
fn h21(p: vec2f) -> f32 { var q = fract(vec3f(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

@fragment fn fs_composite(i: FullscreenOut) -> @location(0) vec4f {
  var c = textureSampleLevel(src, samp_linear, i.uv, 0.0).rgb;
  let bl = textureSampleLevel(bloomTex, samp_linear, i.uv, 0.0).rgb * P.look.z;
  // (energy-conserving: the glow is the scene's own light spread wider, not added on top; under water the murk
  // spreads every light's glow further)
  c = mix(c, bl, P.bloom + (0.5 - P.bloom) * 0.55 * sat(P.uw.x));
  let ex = P.exposure * mix(1.0, expo[0], P.autoExposure);
  c *= ex;
  // scotopic (night) vision: dim light loses its colour and shifts blue (Purkinje)
  let lum0 = luminance(c);
  let scot = (1.0 - smoothstep(0.02, 0.25, lum0)) * P.lift.w;
  c = mix(c, vec3f(lum0) * vec3f(0.62, 0.78, 1.15), scot * 0.75);
  c *= vec3f(1.0 + P.warmth * 0.1, 1.0, 1.0 - P.warmth * 0.1);
  var d = select(filmGrade(agxFilm(c), P.look.w), vividTone(c), P.look.x < 0.5);
  let l = luminance(d);
  d = mix(vec3f(l), d, P.saturation);
  d = (d - 0.5) * P.contrast + 0.5;
  d = d * P.gain.rgb + P.lift.rgb * (1.0 - d);
  let q = i.uv - 0.5;
  d *= 1.0 - P.vignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
  d *= 1.0 - 0.22 * P.uw.y * smoothstep(0.1, 0.65, dot(q, q) * 2.2);
  let n = h21(i.uv * vec2f(1931.7, 1213.3) + fract(P.time * 7.13) * 91.0) - 0.5;
  d += n * P.grain * (0.25 + l * (1.0 - l));
  d += (h21(i.pos.xy + fract(P.time) * 17.0) - 0.5) / 255.0;
  return vec4f(sat3(d), 1.0);
}

// ---------------------------------------------------------------- eye adaptation (one thread, a small bloom level)
@compute @workgroup_size(1) fn adapt() {
  let dim = textureDimensions(lumSrc);
  // a centre-weighted histogram of log luminance (64 bins over 2^-14 .. 2^10)
  var hist: array<f32, 64>;
  var wsum = 0.0;
  for (var y = 0u; y < dim.y; y++) {
    for (var x = 0u; x < dim.x; x++) {
      let uv = (vec2f(f32(x), f32(y)) + 0.5) / vec2f(dim);
      let w = 1.0 - 0.6 * length(uv - 0.5);
      let c = textureLoad(lumSrc, vec2u(x, y), 0).rgb;
      let b = u32(clamp((log2(max(luminance(c), 1e-7)) + 14.0) / 24.0 * 64.0, 0.0, 63.0));
      hist[b] += w;
      wsum += w;
    }
  }
  // the 15th..90th percentile's mean (no darkest shadows, no sky glare), and the 98th percentile highlight
  var acc = 0.0; var s = 0.0; var sw = 0.0; var hi = -14.0;
  for (var b = 0u; b < 64u; b++) {
    let lo = acc / wsum;
    acc += hist[b];
    let up = acc / wsum;
    let inRange = max(0.0, min(up, 0.9) - max(lo, 0.15)) * wsum;
    let lb = (f32(b) + 0.5) / 64.0 * 24.0 - 14.0;
    s += lb * inRange; sw += inRange;
    if (lo < 0.98) { hi = lb; }
  }
  let avg = exp2(s / max(sw, 1e-6));
  // exposure compensation: a scene much darker than noon (dawn, dusk, shade) is shown darker than mid grey, up to
  // ~1.8 stops; night keeps a lower key
  let ev = log2(max(avg, 1e-7) / 0.6);
  let comp = clamp(ev * 0.35, -1.8, 0.0) * (1.0 - 0.7 * P.lift.w);
  let key = mix(0.16, 0.08, P.lift.w) * exp2(comp + P.uw.z);
  var tgt = clamp(key / max(avg, 1e-6), 0.04, mix(40.0, 600.0, P.lift.w));
  // protect the highlights (by up to ~1.5 stops)
  tgt = max(min(tgt, 4.5 / exp2(hi)), tgt * 0.35);
  let cur = expoOut[0];
  let dt = P.time - expoOut[1];
  let early = 1.0 - smoothstep(20.0, 90.0, expoOut[3]);
  expoOut[3] = expoOut[3] + 1.0;
  var k = 1.0 - exp(-clamp(dt, 0.0, 0.25) * mix(select(1.4, 2.2, tgt < cur), 12.0, early));
  if (cur <= 0.0 || dt < 0.0) { k = 1.0; }
  expoOut[0] = mix(cur, tgt, k);
  expoOut[1] = P.time;
  expoOut[2] = avg;
}

// ---------------------------------------------------------------- camera motion blur (compute, full res)
// each pixel reprojected into the last frame (the world taken as still) and blurred along that screen motion — what's
// within a few metres of the lens (her, chasing the camera) kept sharp, and never smeared over by what's behind it
struct MB { a: vec4f, her: vec4f, herV: vec4f }   // a: shutter, max px, near mask (m) start, end; her: screen xy, radius px, distance; herV: her motion px, taps
@group(2) @binding(7) var<uniform> mb: MB;
@group(2) @binding(8) var mbSrc: texture_2d<f32>;
@group(2) @binding(9) var mbDepth: texture_depth_2d;
@group(2) @binding(10) var mbOut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn blur(@builtin(global_invocation_id) id: vec3u) {
  let dim = vec2i(textureDimensions(mbSrc));
  let c = vec2i(id.xy);
  if (any(c >= dim)) { return; }
  let d = max(textureLoad(mbDepth, c, 0), 1e-7);
  let uv = (vec2f(c) + 0.5) / vec2f(dim);
  let wp = frame.invViewProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
  let pc = frame.prevViewProj * wp;
  let srcC = textureLoad(mbSrc, c, 0);
  if (pc.w <= 1e-6) { textureStore(mbOut, c, srcC); return; }
  let puv = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
  let M = mb.a;
  let ld = frame.near / d;
  let onHer = mb.her.z > 0.0 && distance(vec2f(c), mb.her.xy) < mb.her.z && abs(ld - mb.her.w) < 1.5;
  var vel = select((uv - puv) * vec2f(dim), mb.herV.xy, onHer) * M.x * smoothstep(M.z, M.w, ld);
  let L = length(vel);
  if (L < 0.75) { textureStore(mbOut, c, srcC); return; }
  vel *= min(1.0, M.y / L);
  let j = fract(52.9829189 * fract(dot(vec2f(c), vec2f(0.06711056, 0.00583715))));
  let n = i32(clamp(mb.herV.z, 4.0, 32.0));
  var acc = vec3f(0.0); var ws = 0.0;
  for (var k = 0; k < n; k++) {
    let q = clamp(vec2i(vec2f(c) + vel * ((f32(k) + j) / f32(n) - 0.5)), vec2i(0), dim - 1);
    let lq = frame.near / max(textureLoad(mbDepth, q, 0), 1e-7);
    let qHer = mb.her.z > 0.0 && distance(vec2f(q), mb.her.xy) < mb.her.z && abs(lq - mb.her.w) < 1.5;
    let w = select(1.0, 0.0, (lq < ld * 0.6 && lq < M.w) || (qHer && !onHer));
    acc += textureLoad(mbSrc, q, 0).rgb * w; ws += w;
  }
  textureStore(mbOut, c, vec4f(select(srcC.rgb, acc / ws, ws > 0.5), srcC.a));
}
