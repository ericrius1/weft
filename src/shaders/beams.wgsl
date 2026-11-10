// Light in the air (loom/render/beams.ts): the lamps' beams made visible by what's in the air — rain, mist — along each
// view ray (half res) up to the scene: per lamp, the stretch of the ray inside its reach and its cone, sampled
// equi-angularly (Kulla & Fajardo 2012: the samples bunch where the ray passes nearest the lamp, so the inverse square
// cancels out of the estimate — a handful per lamp is smooth), its cone, a forward-throwing phase (headlights glare
// coming at you), the air's own extinction on the way. The lightning lights the whole downpour for an instant.
#include "./env"
#include "weft/fullscreen"

struct BeamsU {
  air: vec4f,      // x scattering (1/m), y extinction (1/m), z -, w max distance (m)
  march: vec4f,    // x samples per lamp, y frame, z strength, w lamps
  phase: vec4f,    // two lobes: x the drops' narrow forward one (g), y the mist's broad one (g), z the narrow one's share
  lights: array<PointLight, 8>,   // the lamps that show in the air (their haze already in their colour)
}
@group(2) @binding(0) var<uniform> B: BeamsU;
@group(2) @binding(1) var sceneDepth: texture_depth_2d;
@group(2) @binding(2) var outTex: texture_storage_2d<rgba16float, write>;
@group(2) @binding(3) var inTex: texture_2d<f32>;

fn bRay(px: vec2f, res: vec2f) -> vec3f {
  let ndc = vec2f(px.x / res.x * 2.0 - 1.0, 1.0 - px.y / res.y * 2.0);
  return normalize(frame.camFwd + frame.camRight * (ndc.x / frame.proj[0][0]) + frame.camUp * (ndc.y / frame.proj[1][1]));
}
fn bSceneT(d: f32, rd: vec3f) -> f32 {
  if (d <= 0.0) { return 1e9; }
  return frame.near / d / max(dot(rd, frame.camFwd), 1e-3);
}

/** the rain's phase: raindrops (millimetres) throw light almost straight on — a tight glare round a lamp coming at you;
 *  the mist between them spreads it wider — the beams seen from the side */
fn bPhase(c: f32) -> f32 {
  return mix(henyeyGreenstein(c, B.phase.y), henyeyGreenstein(c, B.phase.x), B.phase.z);
}

/** the ray's stretch (within seg) inside a spot lamp's cone — the round outer cone, a bound for a squashed fan too —
 *  the forward nappe only; seg itself for a lamp all round (or too wide a cone to bother) */
fn coneClip(o: vec3f, rd: vec3f, l: PointLight, seg: vec2f) -> vec2f {
  if (l.cosOuter < 0.2) { return seg; }
  let c2 = l.cosOuter * l.cosOuter;
  let co = o - l.pos;
  let dv = dot(rd, l.dir);
  let cv = dot(co, l.dir);
  // (inside the double cone where (P - apex)·axis)² ≥ cos² |P - apex|²: a t² + 2 hb t + c ≥ 0)
  let a = dv * dv - c2;
  let hb = dv * cv - c2 * dot(rd, co);
  let c = cv * cv - c2 * dot(co, co);
  if (abs(a) < 1e-5) { return seg; }
  let disc = hb * hb - a * c;
  if (disc < 0.0) { return select(seg, vec2f(1.0, 0.0), a < 0.0); }
  let q = sqrt(disc);
  let r1 = min((-hb - q) / a, (-hb + q) / a);
  let r2 = max((-hb - q) / a, (-hb + q) / a);
  var lo = seg.x;
  var hi = seg.y;
  if (a < 0.0) { lo = max(lo, r1); hi = min(hi, r2); }   // (the ray crosses the cone: inside between the roots)
  else if (dv > 0.0) { lo = max(lo, r2); }              // (it runs along the cone: in for good past the far root…)
  else { hi = min(hi, r1); }                            // (…or until the near one)
  // (the forward nappe: past the plane through the lamp, across its axis)
  if (abs(dv) > 1e-5) {
    let tA = -cv / dv;
    if (dv > 0.0) { lo = max(lo, tA); } else { hi = min(hi, tA); }
  } else if (cv < 0.0) { hi = lo - 1.0; }
  return vec2f(lo, hi);
}

@compute @workgroup_size(8, 8)
fn march(@builtin(global_invocation_id) gid: vec3u) {
  let dim = textureDimensions(outTex);
  if (any(gid.xy >= dim)) { return; }
  let full = vec2i(textureDimensions(sceneDepth));
  let b = vec2i(gid.xy) * 2;
  // (the ray through the 2×2 block's middle; the scene's nearest depth in it)
  var dp = 0.0;
  for (var k = 0; k < 4; k++) { dp = max(dp, textureLoad(sceneDepth, min(b + vec2i(k & 1, k >> 1), full - 1), 0)); }
  let rd = bRay(vec2f(b) + 1.0, vec2f(full));
  let tMax = min(bSceneT(dp, rd), B.air.w);
  let n = max(i32(B.march.x), 1);
  // (a jittered start: interleaved gradient noise, turning each frame)
  let jit = fract(52.9829189 * fract(dot(vec2f(gid.xy) + B.march.y * 5.588238, vec2f(0.06711056, 0.00583715))));
  var acc = vec3f(0.0);
  let cnt = u32(B.march.w);
  for (var i = 0u; i < cnt; i++) {
    let l = B.lights[i];
    // the ray's stretch inside the lamp's reach (a sphere), then its cone
    let oc = l.pos - frame.camPos;
    let tc = dot(oc, rd);
    let R2 = l.radius * l.radius;
    let h2 = max(dot(oc, oc) - tc * tc, 0.0);
    if (h2 >= R2) { continue; }
    let w = sqrt(R2 - h2);
    let seg = coneClip(frame.camPos, rd, l, vec2f(max(tc - w, 0.0), min(tc + w, tMax)));
    if (seg.y <= seg.x) { continue; }
    // equi-angular: t = tc + hs tan θ, θ even between the ends' angles (hs: the ray's distance from the lamp, softened
    // as before — its light leaves a lens and a reflector, not a point: the air right by it doesn't blaze)
    let hs = sqrt(h2 + sq(max(l.size, 0.5)) + 25.0);
    let a0 = atan((seg.x - tc) / hs);
    let a1 = atan((seg.y - tc) / hs);
    var sum = vec3f(0.0);
    for (var k = 0; k < n; k++) {
      let t = tc + hs * tan(mix(a0, a1, (f32(k) + jit) / f32(n)));
      let d = oc - rd * t;
      let r2 = dot(d, d);
      let ld = d * inverseSqrt(max(r2, 1e-8));
      let fall = sq(sat(1.0 - sq(r2 / R2)));
      sum += vec3f(fall * spotK(l, -ld) * bPhase(dot(ld, rd)) * exp(-B.air.y * t));
    }
    // (the estimate: the inverse square lives in the samples' spacing; what's left, the angle swept over the distance)
    acc += l.color * sum * (a1 - a0) / (hs * f32(n));
  }
  textureStore(outTex, gid.xy, vec4f(acc * B.air.x * B.march.z, 1.0));
}

/** into the hdr: the half-res beams brought up to full, by depth (no glow bleeding across a silhouette) — a 4×4 tent
 *  (two half-res texels each way): the glow is soft anyway, and it melts the few samples' grain */
@fragment fn composite(i: FullscreenOut) -> @location(0) vec4f {
  let p = vec2i(i.pos.xy);
  let half = vec2i(textureDimensions(inTex));
  let full = vec2i(textureDimensions(sceneDepth));
  let zMe = min(bSceneT(textureLoad(sceneDepth, min(p, full - 1), 0), bRay(i.pos.xy, vec2f(full))), 1e4);
  let hp = vec2f(i.pos.xy) * 0.5 - 0.5;
  let h0 = vec2i(floor(hp)) - 1;
  var s = vec3f(0.0); var w = 0.0;
  for (var k = 0; k < 16; k++) {
    let o = vec2i(k & 3, k >> 2);
    let q = clamp(h0 + o, vec2i(0), half - 1);
    let dd = abs(vec2f(h0 + o) - hp);
    let bw = max(0.0, 1.0 - dd.x * 0.5) * max(0.0, 1.0 - dd.y * 0.5);
    let zq = min(bSceneT(textureLoad(sceneDepth, min(q * 2, full - 1), 0), bRay(vec2f(q * 2) + 1.0, vec2f(full))), 1e4);
    let dw = 1.0 / (1.0 + abs(zq - zMe) / max(zMe * 0.05, 0.5));
    let ww = bw * dw + 1e-5;
    s += textureLoad(inTex, q, 0).rgb * ww;
    w += ww;
  }
  return vec4f(s / w, 0.0);
}
