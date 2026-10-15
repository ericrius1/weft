// shared constants and pure functions (no bindings) — from waterbending (src/shaders/common.wgsl)
const PI: f32 = 3.14159265;
const TAU: f32 = 6.28318531;

fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn sat3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.0), vec3f(1.0)); }
fn sq(x: f32) -> f32 { return x * x; }
fn luminance(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn remap(x: f32, a: f32, b: f32, c: f32, d: f32) -> f32 { return c + (x - a) / (b - a) * (d - c); }
fn remap01(x: f32, a: f32, b: f32) -> f32 { return sat((x - a) / (b - a)); }

fn hashu(x: u32) -> u32 {
  var h = x;
  h = h ^ (h >> 16u); h = h * 0x7feb352du;
  h = h ^ (h >> 15u); h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h;
}
fn hash1u(x: u32) -> f32 { return f32(hashu(x) & 0xffffffu) / 16777215.0; }
fn hash2i(p: vec2i) -> f32 { return hash1u((bitcast<u32>(p.x) * 0x8da6b343u) ^ (bitcast<u32>(p.y) * 0xd8163841u)); }
fn hash22i(p: vec2i) -> vec2f {
  let h = hashu((bitcast<u32>(p.x) * 0x8da6b343u) ^ (bitcast<u32>(p.y) * 0xd8163841u));
  return vec2f(f32(h & 0xffffu), f32(h >> 16u)) / 65535.0;
}
fn hash3i(p: vec3i) -> f32 { return hash1u((bitcast<u32>(p.x) * 73856093u) ^ (bitcast<u32>(p.y) * 19349663u) ^ (bitcast<u32>(p.z) * 83492791u)); }
fn hash12(p: vec2f) -> f32 { return hash2i(vec2i(floor(p))); }
fn hash13(p: vec3f) -> f32 { return hash3i(vec3i(floor(p))); }
// interleaved gradient noise (screen-space dither)
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

fn vnoise(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2i(i);
  let b = hash2i(i + vec2i(1, 0));
  let c = hash2i(i + vec2i(0, 1));
  let d = hash2i(i + vec2i(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn vnoise3(p: vec3f) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3i(i), hash3i(i + vec3i(1, 0, 0)), u.x), mix(hash3i(i + vec3i(0, 1, 0)), hash3i(i + vec3i(1, 1, 0)), u.x), u.y),
             mix(mix(hash3i(i + vec3i(0, 0, 1)), hash3i(i + vec3i(1, 0, 1)), u.x), mix(hash3i(i + vec3i(0, 1, 1)), hash3i(i + vec3i(1, 1, 1)), u.x), u.y), u.z);
}

// gradient noise with analytic derivatives: (value in ~[-1,1], d/dx, d/dy)
fn gnoised(p: vec2f) -> vec3f {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ga = hash22i(i) * 2.0 - 1.0;
  let gb = hash22i(i + vec2i(1, 0)) * 2.0 - 1.0;
  let gc = hash22i(i + vec2i(0, 1)) * 2.0 - 1.0;
  let gd = hash22i(i + vec2i(1, 1)) * 2.0 - 1.0;
  let va = dot(ga, f);
  let vb = dot(gb, f - vec2f(1.0, 0.0));
  let vc = dot(gc, f - vec2f(0.0, 1.0));
  let vd = dot(gd, f - vec2f(1.0, 1.0));
  let v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd);
  let d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
        + du * (u.yx * (va - vb - vc + vd) + vec2f(vb, vc) - va);
  return vec3f(v * 1.4, d * 1.4);
}

fn fbm(p0: vec2f, oct: i32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  for (var i = 0; i < oct; i++) {
    s += a * vnoise(p);
    p = mat2x2f(1.6, 1.2, -1.2, 1.6) * p + vec2f(3.1, 7.7);
    a *= 0.5;
  }
  return s;
}

fn fbm3(p0: vec3f, oct: i32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  for (var i = 0; i < oct; i++) {
    s += a * vnoise3(p);
    p = p * 2.03 + vec3f(1.7, 9.2, 3.3);
    a *= 0.5;
  }
  return s;
}

// cellular noise: x = distance to nearest feature, y = second nearest, z = cell id hash
fn voronoi(p: vec2f) -> vec3f {
  let i = vec2i(floor(p));
  let f = fract(p);
  var d1 = 8.0;
  var d2 = 8.0;
  var id = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2i(x, y);
      let c = i + o;
      let r = vec2f(o) + hash22i(c) - f;
      let d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = hash2i(c + vec2i(17, 3)); }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec3f(sqrt(d1), sqrt(d2), id);
}

fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
fn smax(a: f32, b: f32, k: f32) -> f32 { return -smin(-a, -b, k); }

// octahedral direction encoding
fn octEncode(n: vec3f) -> vec2f {
  var p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.y < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); }
  return p * 0.5 + 0.5;
}

fn fresnelSchlick(cosT: f32, f0: f32) -> f32 { return f0 + (1.0 - f0) * pow(1.0 - sat(cosT), 5.0); }

// GGX specular (normalised, returns BRDF * NdotL factor-free; caller multiplies by NdotL * radiance)
fn ggxSpec(n: vec3f, v: vec3f, l: vec3f, rough: f32, f0: f32) -> f32 {
  let h = normalize(v + l);
  let nh = sat(dot(n, h));
  let nv = max(dot(n, v), 1e-4);
  let nl = max(dot(n, l), 1e-4);
  let a = max(rough * rough, 0.002);
  let a2 = a * a;
  let dd = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * dd * dd);
  let k = a * 0.5;
  let G = (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k));
  let F = fresnelSchlick(sat(dot(v, h)), f0);
  return D * G * F / (4.0 * nv * nl);
}

fn henyeyGreenstein(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// soft highlight compression before tonemapping (keeps the sun / speculars from clipping to flat white too early)
fn softClip(c: vec3f, knee: f32) -> vec3f {
  let m = max(c.r, max(c.g, c.b));
  if (m <= knee) { return c; }
  let t = knee + (m - knee) / (1.0 + (m - knee) / knee);
  return c * (t / m);
}
