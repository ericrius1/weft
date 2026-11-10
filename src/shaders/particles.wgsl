// GPU particles (loom/particles.ts): a ring of particles living on the GPU — emitted from a small per-frame list of
// bursts, simulated in compute (gravity, drag, buoyancy, curl turbulence, growth), drawn as camera-facing sprites in
// two blend classes (additive: sparks, fire, tracers, flashes; alpha: smoke, debris, spray, vapour), streaks stretched
// along their motion, soft where they meet the scene. Shading is procedural (no textures): a hot colour ramp for fire,
// lit puffs for smoke, a sun term and an ambient for everything that isn't glowing.
#include "./env"

struct Particle {
  pos: vec3f, life: f32,      // life: seconds left (<= 0: dead)
  vel: vec3f, maxLife: f32,
  size: f32, kind: u32, seed: f32, tint: u32,   // tint: packed rgba8 (multiplies the kind's colour)
}
struct Emit {
  pos: vec3f, count: u32,
  vel: vec3f, spread: f32,    // spread: speed of the random velocity added (m/s)
  dir: vec3f, cone: f32,      // dir/cone: if cone > 0, the random part is limited to a cone around dir (radians)
  kind: u32, size: f32, life: f32, first: u32,  // first: this burst's first thread
  tint: u32, sizeJit: f32, lifeJit: f32, posJit: f32,
}
// per kind (8): a = gravity scale, drag (1/s), growth (×size per second), buoyancy (m/s² up); b = streak (s), blend (0 add, 1 alpha), emissive, turbulence (m/s)
struct Kinds { a: array<vec4f, 9>, b: array<vec4f, 9> }
struct PU {
  sun: vec4f,      // xyz direction toward the sun, w -
  sunCol: vec4f,   // radiance (rgb), w -
  amb: vec4f,      // ambient (rgb), w exposure-ish multiplier for emissive kinds
  sim: vec4f,      // x dt, y time, z ring head, w emitted this frame
  wind: vec4f,     // xyz wind (m/s), w -
  misc: vec4f,     // x capacity, y bursts, z soft-fade distance (m), w how strongly the lamps light the spray
}
@group(2) @binding(0) var<uniform> P: PU;
@group(2) @binding(1) var<uniform> K: Kinds;
@group(2) @binding(2) var<storage, read_write> parts: array<Particle>;
@group(2) @binding(3) var<storage, read> emits: array<Emit>;
@group(2) @binding(4) var<storage, read> partsR: array<Particle>;
@group(2) @binding(5) var sceneDepth: texture_depth_2d;
// glints: points of light rebuilt every frame (enemy eyes, plasma, motors, exhausts): never smaller than a few pixels,
// streaked along their motion if they have one
struct Glint { pos: vec3f, size: f32, color: vec3f, minPx: f32, vel: vec3f, streak: f32 }
@group(2) @binding(6) var<storage, read> glints: array<Glint>;

fn phash(x: u32) -> u32 { var v = x * 747796405u + 2891336453u; v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return (v >> 22u) ^ v; }
fn pr(x: u32) -> f32 { return f32(phash(x) & 0xffffffu) / 16777215.0; }
fn unpackTint(t: u32) -> vec4f { return unpack4x8unorm(t); }

// ---------------------------------------------------------------- emit (one thread per new particle)
@compute @workgroup_size(64)
fn emit(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(P.sim.w)) { return; }
  // which burst this thread belongs to (bursts are few: a linear search)
  let nb = u32(P.misc.y);
  var b = 0u;
  for (var k = 1u; k < nb; k++) { if (emits[k].first <= i) { b = k; } }
  let e = emits[b];
  let s = i * 7919u + u32(P.sim.y * 1000.0) * 31u;
  // a random direction (in a cone round dir if given)
  let u1 = pr(s); let u2 = pr(s + 1u); let u3 = pr(s + 2u);
  var d: vec3f;
  if (e.cone > 0.0) {
    let ct = mix(1.0, cos(e.cone), u1);
    let st = sqrt(max(0.0, 1.0 - ct * ct));
    let ph = u2 * 6.2831853;
    let w = normalize(e.dir + vec3f(1e-5));
    let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(w.y) > 0.95);
    let tx = normalize(cross(up, w)); let ty = cross(w, tx);
    d = tx * (st * cos(ph)) + ty * (st * sin(ph)) + w * ct;
  } else {
    let z = u1 * 2.0 - 1.0; let ph = u2 * 6.2831853; let r = sqrt(max(0.0, 1.0 - z * z));
    d = vec3f(r * cos(ph), z, r * sin(ph));
  }
  var p: Particle;
  let sp = e.spread * (0.35 + 0.65 * sqrt(u3));
  p.pos = e.pos + d * e.posJit * pr(s + 3u);
  p.vel = e.vel + d * sp;
  p.maxLife = e.life * (1.0 + e.lifeJit * (pr(s + 4u) * 2.0 - 1.0));
  p.life = p.maxLife;
  p.size = e.size * (1.0 + e.sizeJit * (pr(s + 5u) * 2.0 - 1.0));
  p.kind = e.kind;
  p.seed = pr(s + 6u);
  p.tint = e.tint;
  let slot = (u32(P.sim.z) + i) % u32(P.misc.x);
  parts[slot] = p;
}

// ---------------------------------------------------------------- simulate
fn curl(p: vec3f, t: f32) -> vec3f {
  // (a cheap divergence-ish-free swirl: sines on rotated axes)
  let q = p * 0.11 + vec3f(t * 0.3, t * 0.2, -t * 0.25);
  return vec3f(sin(q.y * 1.7 + cos(q.z * 1.3)), sin(q.z * 1.9 + cos(q.x * 1.1)), sin(q.x * 1.5 + cos(q.y * 1.4)));
}
@compute @workgroup_size(64)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(P.misc.x)) { return; }
  var p = parts[i];
  if (p.life <= 0.0) { return; }
  let dt = P.sim.x;
  let ka = K.a[p.kind]; let kb = K.b[p.kind];
  let rel = p.vel - P.wind.xyz;
  var acc = vec3f(0.0, -9.81 * ka.x + ka.w, 0.0) - rel * ka.y;
  if (kb.w > 0.0) { acc += curl(p.pos + p.seed * 50.0, P.sim.y) * kb.w; }
  p.vel += acc * dt;
  p.pos += p.vel * dt;
  p.size *= 1.0 + ka.z * dt;
  p.life -= dt;
  parts[i] = p;
}

// ---------------------------------------------------------------- draw
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) kind: u32,
  @location(2) age: f32,         // 0 born .. 1 dying
  @location(3) wp: vec3f,
  @location(4) tint: vec4f,
  @location(5) seed: f32,
  @location(6) vz: f32,          // view depth (for the soft fade)
  @location(7) gain: f32,        // a sprite widened to its minimum pixel size: its light spread thinner
}
/** a metre's size on screen at a view distance (in pixels) */
fn pxPerMetre(dist: f32) -> f32 { return frame.proj[1][1] * frame.res.y * 0.5 / max(dist, 1e-3); }
override BLEND_CLASS: u32 = 0u;   // 0 additive, 1 alpha
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let p = partsR[ii];
  let kb = K.b[p.kind];
  let cls = u32(kb.y);
  o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
  if (p.life <= 0.0 || cls != BLEND_CLASS) { return o; }
  var q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let c = q[vi];
  let toCam = frame.camPos - p.pos;
  let dist = length(toCam);
  var right = frame.camRight; var up = frame.camUp;
  var sx = p.size; var sy = p.size;
  o.gain = 1.0;
  // streaks: stretched along their motion (as the eye sees it), thin across — but never thinner than a pixel and a
  // half (their light spread over the width: far tracers stay lines, not shimmer)
  if (kb.x > 0.0) {
    let v = p.vel - dot(p.vel, toCam / max(dist, 1e-3)) * toCam / max(dist, 1e-3);
    let vl = length(v);
    if (vl > 0.01) {
      up = v / vl;
      right = normalize(cross(up, toCam));
      sy = max(p.size, vl * kb.x * 0.5);
    }
    let minW = 1.5 / pxPerMetre(dist);
    if (sx < minW) { o.gain = sx / minW; sx = minW; }
  } else {
    // a slow spin, so puffs don't look stamped
    let a = p.seed * 6.2831853 + (p.maxLife - p.life) * (p.seed - 0.5) * 0.8;
    let ca = cos(a); let sa = sin(a);
    let r2 = right * ca + up * sa; let u2 = -right * sa + up * ca;
    right = r2; up = u2;
  }
  o.wp = p.pos + right * c.x * sx + up * c.y * sy;
  o.pos = frame.viewProj * vec4f(o.wp, 1.0);
  o.uv = c;
  o.kind = p.kind;
  o.age = 1.0 - p.life / max(p.maxLife, 1e-3);
  o.tint = unpackTint(p.tint);
  o.seed = p.seed;
  o.vz = dot(o.wp - frame.camPos, frame.camFwd);
  return o;
}

fn vnoiseP(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  let h = vec4f(dot(i, vec2f(127.1, 311.7)), dot(i + vec2f(1.0, 0.0), vec2f(127.1, 311.7)), dot(i + vec2f(0.0, 1.0), vec2f(127.1, 311.7)), dot(i + vec2f(1.0, 1.0), vec2f(127.1, 311.7)));
  let r = fract(sin(h) * 43758.5453);
  return mix(mix(r.x, r.y, u.x), mix(r.z, r.w, u.x), u.y);
}
fn fireRamp(t: f32) -> vec3f {
  // white-hot → yellow → orange → red → smoke-dark
  let c0 = vec3f(1.0, 0.95, 0.85); let c1 = vec3f(1.0, 0.7, 0.25); let c2 = vec3f(0.95, 0.32, 0.06); let c3 = vec3f(0.35, 0.06, 0.02);
  if (t < 0.15) { return mix(c0, c1, t / 0.15); }
  if (t < 0.45) { return mix(c1, c2, (t - 0.15) / 0.3); }
  return mix(c2, c3, sat1((t - 0.45) / 0.55));
}
fn sat1(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let r = length(i.uv);
  if (r > 1.0) { discard; }
  let kb = K.b[i.kind];
  // soft where the sprite meets the scene
  let px = vec2i(i.pos.xy);
  let d = textureLoad(sceneDepth, clamp(px, vec2i(0), vec2i(textureDimensions(sceneDepth)) - 1), 0);
  let sceneZ = select(linearDepth(d), 1e9, d <= 0.0);
  let soft = sat1((sceneZ - i.vz) / max(P.misc.z, 0.01));
  let near = sat1((i.vz - 0.3) / 1.5);
  var col = vec3f(0.0);
  var a = 0.0;
  let n = vnoiseP(i.uv * 2.5 + vec2f(i.seed * 17.0, i.age * 1.5)) * 0.6 + vnoiseP(i.uv * 6.0 + i.seed * 9.0) * 0.4;
  switch (i.kind) {
    case 0u: { // spark: a hot core, cooling as it flies
      let k = exp(-r * r * 4.0);
      col = mix(vec3f(1.0, 0.85, 0.5), vec3f(1.0, 0.35, 0.08), i.age) * k * 6.0 * (1.0 - i.age);
    }
    case 1u: { // fire: a noisy, occluding ball glowing through the ramp over its life
      let m = smoothstep(1.0, 0.3, r + (n - 0.5) * 0.75);
      col = fireRamp(i.age + (n - 0.5) * 0.25) * mix(5.5, 0.5, sqrt(i.age));
      a = m * 0.85 * (1.0 - smoothstep(0.55, 1.0, i.age));
    }
    case 3u: { // tracer: a hot line, whiter at its core
      let k = exp(-i.uv.x * i.uv.x * 6.0) * smoothstep(1.0, 0.55, abs(i.uv.y));
      col = mix(vec3f(1.0, 0.45, 0.12), vec3f(1.0, 0.82, 0.55), exp(-i.uv.x * i.uv.x * 20.0)) * k * 6.0;
    }
    case 6u: { // flash: a big brief bloom (falling to nothing at the sprite's edge)
      let e = exp(-r * r * 4.5);
      let k = (e - exp(-4.5)) / (1.0 - exp(-4.5)) + 0.25 * max(exp(-r * 4.0) - exp(-4.0), 0.0);
      col = vec3f(1.0, 0.85, 0.65) * k * 16.0 * (1.0 - i.age) * (1.0 - i.age);
    }
    case 2u: { // smoke: a lit puff, thinning as it spreads
      let m = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.7);
      let nrm = normalize(frame.camRight * i.uv.x + frame.camUp * i.uv.y - normalize(frame.camPos - i.wp) * sqrt(max(0.0, 1.0 - r * r)));
      let lit = 0.35 + 0.65 * sat1(dot(nrm, P.sun.xyz) * 0.5 + 0.5);
      let base = vec3f(0.22, 0.21, 0.2);
      col = base * (P.sunCol.rgb * lit + P.amb.rgb + pointLightsIn(i.wp, normalize(frame.camPos - i.wp), 0.4));
      a = m * 0.55 * (1.0 - smoothstep(0.4, 1.0, i.age)) * smoothstep(0.0, 0.08, i.age);
    }
    case 4u: { // debris: dark chips
      let m = smoothstep(1.0, 0.6, r);
      col = vec3f(0.06, 0.055, 0.05) * (P.sunCol.rgb * 0.6 + P.amb.rgb);
      a = m * (1.0 - smoothstep(0.85, 1.0, i.age));
    }
    case 5u: { // spray: bright white water (lit by the lamps through it — a car's spray glows in the headlights)
      // (a fine mist: soft all the way out, broken up — no edge to read as a ball)
      let m = exp(-r * r * 3.0) * smoothstep(0.15, 0.75, n + 0.35 * (1.0 - r));
      col = vec3f(0.9, 0.95, 1.0) * (P.sunCol.rgb * 0.8 + P.amb.rgb * 1.2 + pointLightsIn(i.wp, normalize(frame.camPos - i.wp), 0.55) * 0.06 * P.misc.w);
      a = m * 0.6 * (1.0 - i.age);
    }
    case 8u: { // paint: a crisp droplet (a stylized world's), lit on the sun's side, a highlight, an ink rim round it
      let m = 1.0 - smoothstep(0.88, 0.97, r);
      let nrm = normalize(frame.camRight * i.uv.x + frame.camUp * i.uv.y - normalize(frame.camPos - i.wp) * sqrt(max(0.0, 1.0 - r * r)));
      let lit = select(0.62, 1.1, dot(nrm, P.sun.xyz) > -0.1);
      let hi = smoothstep(0.18, 0.08, length(i.uv - vec2f(-0.3, 0.32)));
      col = vec3f(lit) + hi * 0.9;
      col *= mix(1.0, 0.08, smoothstep(0.7, 0.82, r));
      a = m * (1.0 - smoothstep(0.75, 1.0, i.age));
    }
    default: { // vapour: soft white puffs left in the air (wingtips, contrails), fading as they spread
      let m = exp(-r * r * 3.5) * (0.7 + 0.3 * n);
      col = vec3f(0.95) * (P.sunCol.rgb * 0.7 + P.amb.rgb * 1.3 + pointLightsIn(i.wp, normalize(frame.camPos - i.wp), 0.5) * 0.5);
      a = m * 0.45 * (1.0 - i.age) * smoothstep(0.0, 0.1, i.age);
    }
  }
  let t = i.tint;
  if (BLEND_CLASS == 0u) {
    return vec4f(col * t.rgb * t.a * soft * near * P.amb.w * i.gain, 0.0);
  }
  // (the mists fade out right in front of the lens: a chase camera shouldn't be blinded by its own car's spray)
  let al = a * t.a * soft * near * select(1.0, sat1((i.vz - 1.0) / 4.0), i.kind == 5u || i.kind == 7u);
  // (fire glows: its light scales with the glow multiplier, like the additive kinds)
  let em = select(1.0, P.amb.w, i.kind == 1u);
  return vec4f(col * t.rgb * al * em, al);
}

// ---------------------------------------------------------------- glints
struct GOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) color: vec3f, @location(2) vz: f32 }
@vertex fn vs_glint(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  var o: GOut;
  let g = glints[ii];
  var q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let c = q[vi];
  let toCam = frame.camPos - g.pos;
  let dist = length(toCam);
  // never smaller than its minimum on screen; widened, its light spreads thinner (but not all the way: far off it
  // should still catch the eye)
  let minS = g.minPx / pxPerMetre(dist);
  let s = max(g.size, minS);
  var gain = pow(g.size / s, 1.2);
  var right = frame.camRight * s; var up = frame.camUp * s;
  if (g.streak > 0.0) {
    let tc = toCam / max(dist, 1e-3);
    let v = g.vel - dot(g.vel, tc) * tc;
    let vl = length(v);
    if (vl > 0.01) {
      let u = v / vl;
      up = u * max(s, vl * g.streak * 0.5);
      right = normalize(cross(u, toCam)) * s;
    }
  }
  let wp = g.pos + right * c.x + up * c.y;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  o.color = g.color * gain;
  o.vz = dot(wp - frame.camPos, frame.camFwd);
  return o;
}
@fragment fn fs_glint(i: GOut) -> @location(0) vec4f {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let px = vec2i(i.pos.xy);
  let d = textureLoad(sceneDepth, clamp(px, vec2i(0), vec2i(textureDimensions(sceneDepth)) - 1), 0);
  let sceneZ = select(linearDepth(d), 1e9, d <= 0.0);
  if (sceneZ < i.vz - 1.0) { discard; }
  let k = (exp(-r2 * 7.0) - exp(-7.0)) / (1.0 - exp(-7.0)) + 0.3 * (exp(-r2 * 2.5) - exp(-2.5));
  return vec4f(i.color * k * P.amb.w, 0.0);
}
