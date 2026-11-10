// Rainfall round the eye, drawn over the finished scene (after its fog), for any world: Boulder's precip and San
// Francisco's rain, with nothing of either in it.
//   veil      the fall's grey over the distance: extinction along the view up to the cloud base, and the light under
//             the clouds scattered back in
//   drops     three nested boxes of drops round the eye (a near dense one, a middle one, a far sparse one), each
//             wrapped round the eye as it moves, so the drops stay put in the world, falling and drifting with the
//             wind; every drop a quad along its fall as a shutter sees it, at least a pixel wide (a thinner one
//             fainter)
//   splashes  where the drops land near the eye: a ring and a little crown
// Premultiplied over the scene; the scene's distance (rainZ: r32float, metres along the view axis, large for the sky)
// hides what's behind things.
//
// A library: the world's light and ground come from three functions the including shader defines (WGSL doesn't mind
// the order), so a world lights its rain with its own sky, sun, shadows and lamps:
//   fn rainLight(p: vec3f, g: f32, side: f32) -> vec3f   the light on a drop at p seen from the eye (g: how forward
//                                                        the key light's phase, side: how much of it from the side;
//                                                        rainPhase(cosine, g) is here for it)
//   fn rainVeil() -> vec3f                               the veil's colour (the light under the clouds)
//   fn rainGround(xz: vec2f) -> f32                      the surface the rain falls on (ground or water), world y
// then `#include "loom/rainfall"`. loom/rainfall_lit is one that lights it from a uniform (weather/rainfall.ts's
// default). Group 2 is its own: binding 0 the RainU, binding 1 the scene's distance.
#include "weft/frame"
#include "weft/fullscreen"

struct RainU {
  rain: vec4f,               // x the share of the drops drawn (0..1), y the shutter (s), z a drop's width (m), w brightness
  vel: vec4f,                // xyz the drops' velocity (m/s), w the top of the fall (world y: the cloud base)
  fall: array<vec4f, 3>,     // per box: how far the drops have moved (m, wrapped to the box)
  box: array<vec4f, 3>,      // per box: its size (m), w the instances' share up to it (cumulative)
  veil: vec4f,               // x the fall's extinction (1/m), y -, z the splashes' share, w the time (s)
}
@group(2) @binding(0) var<uniform> rainP: RainU;
@group(2) @binding(1) var rainZ: texture_2d<f32>;

// the most instances (rainfall.ts's): the first `share` of them are drawn, so the count follows the rate
const RAIN_MAX = 22000.0;
const SPLASH_MAX = 2400.0;
const RAIN_PI = 3.14159265359;

struct RainOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,                         // x across (-1..1), y along (-1 tail .. 1 head)
  @location(1) @interpolate(flat) col: vec4f,     // its light (rgb) and opacity (a)
  @location(2) vz: f32,                           // its distance along the view axis
  @location(3) @interpolate(flat) edge: vec2f,    // the soft edge across and along (in uv)
}

fn rainHash(x0: u32) -> f32 {
  var x = x0;
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return f32(x) / 4294967296.0;
}

/** Henyey-Greenstein: the share of the light scattered at cosine `c` from its way, `g` how forward */
fn rainPhase(c: f32, g: f32) -> f32 { return (1.0 - g * g) / (4.0 * RAIN_PI * pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5)); }

// which box an instance is in
fn rainBoxOf(i: u32) -> u32 {
  let u = rainHash(i * 3u + 11u);
  return select(select(2u, 1u, u < rainP.box[1].w), 0u, u < rainP.box[0].w);
}

// the drop's place: its spot in the box, moved by the fall (`fall` is how far the drops have gone, the velocity's way:
// added, so they come down and drift downwind), wrapped round the eye (centred on it)
fn rainPlaced(i: u32, k: u32, fall: vec3f) -> vec4f {
  let B = rainP.box[k].xyz;
  let s = vec3f(rainHash(i * 7u + 1u), rainHash(i * 7u + 2u), rainHash(i * 7u + 3u));
  let c = frame.camPos;
  let rel = fract((s * B + fall - c) / B + 0.5);
  // (faded out near the box's faces, where it wraps round)
  let e = max(max(abs(rel.x - 0.5), abs(rel.y - 0.5)), abs(rel.z - 0.5)) * 2.0;
  return vec4f(c + (rel - 0.5) * B, 1.0 - smoothstep(0.78, 1.0, e));
}

// how much of it is drawn: `f` its place in the order (0..1), the first `share` shown (the last few fading), under the
// cloud base, above the ground
fn rainShown(f: f32, share: f32, p: vec3f) -> f32 {
  var a = saturate((share - f) / 0.06);
  a *= 1.0 - smoothstep(rainP.vel.w - 150.0, rainP.vel.w, p.y);
  if (p.y < rainGround(p.xz)) { a = 0.0; }
  return a;
}

const RAIN_OFF = vec4f(0.0, 0.0, 2.0, 1.0);

// a quad from `a` to `b` (world), `w` metres wide, at least `minPx` pixels; c the corner (x -1..1 across, y -1..1)
fn rainSegment(a: vec3f, b: vec3f, w: f32, minPx: f32, c: vec2f, o: ptr<function, RainOut>) -> f32 {
  let ca = frame.viewProj * vec4f(a, 1.0);
  let cb = frame.viewProj * vec4f(b, 1.0);
  if (ca.w < frame.near * 2.0 || cb.w < frame.near * 2.0) { (*o).pos = RAIN_OFF; return 0.0; }
  let sa = ca.xy / ca.w;
  let sb = cb.xy / cb.w;
  let px = (sb - sa) * 0.5 * frame.res;
  let len = length(px);
  let dir = select(vec2f(0.0, 1.0), px / max(len, 1e-4), len > 1e-3);
  let perp = vec2f(-dir.y, dir.x);
  let vz = dot(mix(a, b, 0.5) - frame.camPos, frame.camFwd);
  // (its width on screen; a thinner line is drawn a pixel wide and fainter)
  let wpx = w * frame.res.y / (2.0 * tan(frame.fovY * 0.5) * max(vz, 0.05));
  let half = max(wpx, minPx) * 0.5 + 0.75;
  let along = c.y * 0.5 + 0.5;
  let clip = mix(ca, cb, along);
  let offPx = perp * c.x * half + dir * c.y * half;
  (*o).pos = vec4f(clip.xy + offPx * 2.0 / frame.res * clip.w, clip.zw);
  (*o).uv = vec2f(c.x, c.y * (len * 0.5 + half) / max(len * 0.5, 1e-3));
  (*o).vz = vz;
  (*o).edge = vec2f(0.75 / half, (len * 0.5 + half) / max(len * 0.5, 1e-3));
  return mix(0.45, 1.0, min(wpx / minPx, 1.0));
}

fn rainCorner(vi: u32) -> vec2f { return vec2f(select(-1.0, 1.0, (vi & 1u) == 1u), select(-1.0, 1.0, vi >= 2u)); }

// the scene's distance along the view axis at a pixel (m)
fn rainDepthAt(px: vec2f) -> f32 { return textureLoad(rainZ, vec2i(px * vec2f(textureDimensions(rainZ)) * frame.invRes), 0).r; }

// ------------------------------------------------------------------ drops
@vertex fn vsRain(@builtin(vertex_index) vi: u32, @builtin(instance_index) i: u32) -> RainOut {
  var o: RainOut;
  let k = rainBoxOf(i);
  let pl = rainPlaced(i, k, rainP.fall[k].xyz);
  let p = pl.xyz;
  var a = pl.w * rainShown(f32(i) / RAIN_MAX, rainP.rain.x, p);
  if (a <= 0.001) { o.pos = RAIN_OFF; return o; }
  // (each drop its own size: the big ones longer and brighter)
  let sz = 0.6 + 0.8 * rainHash(i * 5u + 3u);
  let v = rainP.vel.xyz;
  let dist = length(p - frame.camPos);
  // (the far ones drawn longer, as a streak the eye reads as rain rather than a speck)
  let tail = p - v * rainP.rain.y * (0.7 + 0.3 * sz) * (1.0 + dist / 14.0);
  a *= rainSegment(tail, p, rainP.rain.z * sz, 1.0, rainCorner(vi), &o);
  // (the nearest a blur too close to see, the near ones strongest, the far ones fainter)
  a *= smoothstep(0.5, 1.5, dist) * mix(1.0, 0.4, smoothstep(2.0, 30.0, dist)) * rainP.rain.w;
  o.col = vec4f(rainLight(p, 0.75, 0.6) * (0.75 + 0.5 * sz), a);
  return o;
}

// how far a pixel is from the segment, in half-widths (a capsule round it)
fn rainCapsule(i: RainOut) -> f32 {
  return length(vec2f(i.uv.x, max(abs(i.uv.y) - 1.0, 0.0) / max(i.edge.y - 1.0, 1e-3)));
}

@fragment fn fsDrop(i: RainOut) -> @location(0) vec4f {
  let soft = saturate((rainDepthAt(i.pos.xy) - i.vz) / 0.25);
  // a soft line, a little fuller toward its head
  let a = i.col.a * (1.0 - smoothstep(1.0 - i.edge.x * 2.0, 1.0, rainCapsule(i))) * soft * (0.8 + 0.2 * clamp(i.uv.y, -1.0, 1.0));
  if (a < 0.002) { discard; }
  return vec4f(i.col.rgb * a, a);
}

// ------------------------------------------------------------------ splashes
@vertex fn vsSplash(@builtin(vertex_index) vi: u32, @builtin(instance_index) i: u32) -> RainOut {
  var o: RainOut;
  let t = rainP.veil.w;
  let h0 = rainHash(i * 9u + 1u);
  let period = 0.38 + 0.3 * h0;
  let ph = t / period + rainHash(i * 9u + 2u);
  let cyc = u32(floor(ph));
  let life = 0.17;
  let age = fract(ph) * period;
  if (age > life || f32(i) / SPLASH_MAX > rainP.veil.z) { o.pos = RAIN_OFF; return o; }
  // a fresh spot each time, in a disc round the eye
  let r = 11.0 * sqrt(rainHash(i * 131u + cyc * 7919u));
  let ang = 6.2831 * rainHash(i * 173u + cyc * 6007u + 1u);
  let xz = frame.camPos.xz + vec2f(cos(ang), sin(ang)) * (r + 0.6);
  let y = rainGround(xz);
  if (y > rainP.vel.w || frame.camPos.y - y > 40.0) { o.pos = RAIN_OFF; return o; }
  let u = age / life;
  let size = 0.025 + 0.05 * u;
  let c = rainCorner(vi);
  let up = vec3f(0.0, 1.0, 0.0);
  let side = normalize(vec3f(frame.camRight.x, 0.0, frame.camRight.z));
  let base = vec3f(xz.x, y + 0.005, xz.y);
  let wp = base + side * c.x * size + up * c.y * size;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  o.vz = dot(base - frame.camPos, frame.camFwd);
  // (how flat the ring looks from here, and the moment of its life)
  let toCam = normalize(frame.camPos - base);
  o.edge = vec2f(u, max(toCam.y, 0.08));
  o.col = vec4f(rainLight(base + up * 0.05, 0.6, 0.8), 0.4 * (1.0 - smoothstep(12.0, 30.0, o.vz)) * rainP.rain.w);
  return o;
}

@fragment fn fsSplash(i: RainOut) -> @location(0) vec4f {
  let soft = saturate((rainDepthAt(i.pos.xy) - i.vz + 0.15) / 0.2);
  let u = i.edge.x;
  // the ring on the ground (flattened as it's seen from here), and the crown's droplets thrown up and falling back
  let ry = i.uv.y / max(i.edge.y, 0.08);
  let ring = exp(-pow((length(vec2f(i.uv.x, ry)) - 0.8 * u - 0.15) / 0.13, 2.0)) * 0.7;
  let hgt = 4.0 * u * (1.0 - u);
  var crown = 0.0;
  for (var k = 0; k < 5; k++) {
    let x = (f32(k) - 2.0) * 0.32 * (0.4 + 0.6 * u);
    let yk = hgt * (0.55 + 0.3 * fract(f32(k) * 0.618));
    let d = vec2f(i.uv.x - x, i.uv.y - yk);
    crown += exp(-dot(d, d) / 0.012);
  }
  let a = i.col.a * (ring * (1.0 - u) + crown * 0.8 * (1.0 - u * u)) * soft;
  if (a < 0.003) { discard; }
  return vec4f(i.col.rgb * a, a);
}

// ------------------------------------------------------------------ the veil
const VEIL_REACH = 30000.0;
@fragment fn fsVeil(i: FullscreenOut) -> @location(0) vec4f {
  let rd = viewRay(i.uv);
  // the stretch of the ray in the fall, which reaches up to the cloud base: from the eye (or where a ray from above
  // the base comes down into it) to the scene, or to where a climbing ray leaves it
  let top = rainP.vel.w - frame.camPos.y;
  let tTop = top / select(-1e-6, rd.y, abs(rd.y) > 1e-6);
  let t0 = select(0.0, max(0.0, tTop), top < 0.0);
  let t1 = select(1e9, tTop, top >= 0.0 && rd.y > 1e-6);
  if (top < 0.0 && rd.y >= -1e-6) { discard; }
  let z = max(min(rainDepthAt(i.pos.xy) / max(dot(rd, frame.camFwd), 1e-4), t1), t0);
  // (the fall thins with height above the eye: density e^(-h / 400 m) along a climbing ray)
  let kh = max(rd.y, 0.0) / 400.0;
  let d = min(select(z - t0, (exp(-kh * t0) - exp(-kh * z)) / max(kh, 1e-9), kh > 1e-6), VEIL_REACH);
  let T = exp(-rainP.veil.x * d);
  if (T > 0.998) { discard; }
  return vec4f(rainVeil() * (1.0 - T), 1.0 - T);
}
