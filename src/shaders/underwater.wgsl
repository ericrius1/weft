// Under the sea (src/render/underwater.ts drives it; after waterbending's underwater.wgsl): a caustic tile (baked each
// frame, with mips), the key light's shafts marched through the water at half res (the net projected down along the
// refracted light, the cascades' / the island's / the clouds' shadows cutting it), and the full-res lens pass: the
// medium (per-channel extinction + in-scatter, env.wgsl), the shafts, a slow refraction wobble, chromatic softness
// toward the edges, the waterline when the lens straddles the surface, drops running off it after surfacing.
#include "./env"
#include "weft/fullscreen"

struct UW {
  a: vec4f,   // x time (s), y seconds since surfacing (drops; < 0 none), z shafts strength, w wobble (uv)
  b: vec4f,   // x chromatic softness, y drops seed, z lens distance (m), w -
};
@group(2) @binding(0) var<uniform> U: UW;
@group(2) @binding(1) var depthTex: texture_depth_2d;   // resolved depth (the sea's surface isn't in it)
@group(2) @binding(2) var srcTex: texture_2d<f32>;      // lens: a copy of the scene
@group(2) @binding(3) var raysTex: texture_2d<f32>;     // half-res shafts: rgb in-scatter, a view distance
@group(2) @binding(4) var cauTex: texture_2d<f32>;      // the caustic tile (r)

const CAU_N: f32 = 256.0;     // the tile's texels (src/render/underwater.ts)
const CAU_TILE: f32 = 9.0;    // m per tile
const CAU_MEAN: f32 = 0.37;
const SKY_D: f32 = 1e5;

/** the view ray through a screen uv (unnormalised: its forward component is 1) */
fn uwViewRay(uv: vec2f) -> vec3f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return frame.camFwd + frame.camRight * (ndc.x / frame.proj[0][0]) + frame.camUp * (ndc.y / frame.proj[1][1]);
}
/** distance along the (unnormalised) view ray from a reversed-Z infinite depth */
fn rayDist(d: f32, rv: vec3f) -> f32 { return select(frame.near / max(d, 1e-12) * length(rv), SKY_D, d <= 0.0); }
/** the stretch of the view ray in the water: to the scene or up to the surface (the camera is under it) */
fn waterRun(rd: vec3f, dist: f32) -> f32 {
  let y0 = world.seaLevel - frame.camPos.y;
  var t = dist;
  if (rd.y > 1e-4) { t = min(t, y0 / rd.y); }
  return min(t, 3000.0);
}
/** the lens point's height over the water along rd (< 0 under) */
fn lensAbove(rd: vec3f) -> f32 {
  let p = frame.camPos + rd * (U.b.z / max(dot(rd, frame.camFwd), 0.1));
  return p.y - world.seaLevel - rippleAt(p.xz).x;
}

// ---------------------------------------------------------------- the caustic tile (wrapping noise)
fn wrapCell(c: vec2i, p: i32) -> vec2i { return ((c % vec2i(p)) + vec2i(p)) % vec2i(p); }
fn vnoiseP(x: vec2f, p: i32) -> f32 {
  let i = vec2i(floor(x));
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2i(wrapCell(i, p));
  let b = hash2i(wrapCell(i + vec2i(1, 0), p));
  let c = hash2i(wrapCell(i + vec2i(0, 1), p));
  let d = hash2i(wrapCell(i + vec2i(1, 1), p));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn voronoiEdgeP(x: vec2f, p: i32) -> f32 {
  let i = vec2i(floor(x));
  let f = fract(x);
  var d1 = 8.0; var d2 = 8.0;
  for (var y = -1; y <= 1; y++) {
    for (var xx = -1; xx <= 1; xx++) {
      let o = vec2i(xx, y);
      let r = vec2f(o) + hash22i(wrapCell(i + o, p)) - f;
      let d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(d2) - sqrt(d1);
}
fn causticNet(xz: vec2f, t: f32) -> f32 {
  let q = xz * (6.0 / CAU_TILE);
  let w1 = vec2f(vnoiseP(q * 0.5 + t * 0.21, 3), vnoiseP(q * 0.5 - t * 0.19 + 5.2, 3)) * 1.6;
  var c = pow(1.0 - smoothstep(0.0, 0.32, voronoiEdgeP(q + w1 + vec2f(t * 0.08, -t * 0.05), 6)), 3.0);
  let q2 = q * 2.0 + vec2f(3.0, 7.0);
  let w2 = vec2f(vnoiseP(q2 * 0.5 - t * 0.17, 6), vnoiseP(q2 * 0.5 + t * 0.23 + 2.9, 6)) * 1.6;
  c += pow(1.0 - smoothstep(0.0, 0.32, voronoiEdgeP(q2 + w2 + vec2f(-t * 0.1, t * 0.07), 12)), 3.0) * 0.6;
  return c;
}
@fragment fn fsCaustic(fin: FullscreenOut) -> @location(0) vec4f {
  let uv = fin.pos.xy / CAU_N;
  return vec4f(causticNet(uv * CAU_TILE, U.a.x), 0.0, 0.0, 1.0);
}

// ---------------------------------------------------------------- shafts (half res)
/** the key light at a point in the water: one filtered tap of the near cascades (the ruin's ribs, the hero, the
 *  pier cast beams), the island's and the clouds' shadows */
fn keyVis(p: vec3f) -> f32 {
  var s = 1.0;
  let d = dot(p - frame.camPos, frame.camFwd);
  if (d < world.cascades.y) {
    let ci = select(1, 0, d < world.cascades.x);
    let sc = shadowCascadeCoord(p, ci);
    if (all(sc.xy > vec2f(0.0)) && all(sc.xy < vec2f(1.0)) && sc.z < 1.0 && sc.z > 0.0) { s = textureSampleCompareLevel(shadowTex, samp_shadow, sc.xy, ci, sc.z); }
  }
  return s * hfShadowAt(p) * cloudShadowAt(p);
}
fn bayer4(p: vec2i) -> f32 {
  var m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return m[(p.y & 3) * 4 + (p.x & 3)];
}
const RAY_N: i32 = 14;
@fragment fn fsRays(fin: FullscreenOut) -> @location(0) vec4f {
  let hp = vec2i(fin.pos.xy);
  let fp = min(hp * 2, vec2i(textureDimensions(depthTex)) - 1);
  let uv = (vec2f(fp) + 0.5) * frame.invRes;
  let rv = uwViewRay(uv);
  let dist = rayDist(textureLoad(depthTex, fp, 0), rv);
  let rd = normalize(rv);
  if (lensAbove(rd) > 0.0 || U.a.z <= 0.0) { return vec4f(0.0, 0.0, 0.0, dist); }
  let lvl = world.seaLevel;
  let t1 = min(waterRun(rd, dist), 60.0);
  if (t1 <= 0.0) { return vec4f(0.0, 0.0, 0.0, dist); }
  let Lw = uwLightDir();
  let sigS = uwSigS(); let sigT = uwSigT();
  let kdS = uwKd() * 0.85 / Lw.y;
  // forward scattering: a bright lobe toward the light, a faint isotropic share
  let mu = dot(rd, Lw);
  let phase = 0.55 * henyeyGreenstein(mu, 0.86) + 0.45 * henyeyGreenstein(mu, 0.25);
  let beam = lighting.keyRad.rgb * PI * 0.92 * smoothstep(0.0, 0.06, world.lightDir.y);
  let jit = (bayer4(hp) + 0.5) / 16.0;
  var S = vec3f(0.0);
  var tp = 0.0;
  for (var i = 0; i < RAY_N; i++) {
    let f = (f32(i) + 1.0) / f32(RAY_N);
    let tn = t1 * pow(f, 1.4);
    let tm = mix(tp, tn, jit);
    let dt = tn - tp;
    tp = tn;
    let p = frame.camPos + rd * tm;
    let dp = max(lvl - p.y, 0.0);
    // the net, projected up along the light to the surface: sharp beams near the top, blurring and fading deeper
    let q = p.xz + Lw.xz / Lw.y * dp;
    let c = textureSampleLevel(cauTex, samp_repeat, q / CAU_TILE, clamp(log2(1.0 + dp * 0.6), 0.0, 4.0)).r;
    let contrast = exp(-dp * 0.05);
    let shaft = mix(1.0, sq(c / CAU_MEAN) * 0.47, contrast);
    let li = beam * exp(-kdS * dp) * keyVis(p) * shaft;
    S += exp(-sigT * tm) * li * dt;
  }
  return vec4f(S * sigS * phase * U.a.z, dist);
}
// the march's dither averaged away: a 4x4 blur (texels at about the same distance only)
@fragment fn fsRaysBlur(fin: FullscreenOut) -> @location(0) vec4f {
  let hp = vec2i(fin.pos.xy);
  let dim = vec2i(textureDimensions(raysTex)) - 1;
  let c = textureLoad(raysTex, hp, 0);
  let tol = 1.0 / (min(c.a, 60.0) * 0.1 + 0.1);
  var s = vec3f(0.0); var ws = 0.0;
  for (var j = -2; j < 2; j++) {
    for (var i = -2; i < 2; i++) {
      let r = textureLoad(raysTex, clamp(hp + vec2i(i, j), vec2i(0), dim), 0);
      let w = max(1e-3, 1.0 - abs(min(r.a, 60.0) - min(c.a, 60.0)) * tol);
      s += r.rgb * w; ws += w;
    }
  }
  return vec4f(s / ws, c.a);
}

// ---------------------------------------------------------------- lens (full res)
fn shaftsAt(p: vec2i, z: f32) -> vec3f {
  let t = vec2f(p) * 0.5;
  let b = vec2i(floor(t));
  let f = t - vec2f(b);
  let dim = vec2i(textureDimensions(raysTex)) - 1;
  var s = vec3f(0.0); var ws = 0.0;
  let tol = 1.0 / (min(z, 60.0) * 0.08 + 0.05);
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let q = clamp(b + o, vec2i(0), dim);
    let r = textureLoad(raysTex, q, 0);
    let bw = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let w = (bw + 1e-3) * max(1e-3, 1.0 - abs(min(r.a, 60.0) - min(z, 60.0)) * tol);
    s += r.rgb * w; ws += w;
  }
  return s / ws;
}
fn scene(uv: vec2f) -> vec3f { return textureSampleLevel(srcTex, samp_linear, uv, 0.0).rgb; }

/** water left on the lens after surfacing: a sheet running off, then a few drops (some sliding down, leaving a wet
 *  trail) that dry up within a couple of seconds. (uv offset of the refraction, darkening, glint) */
fn droplets(uv: vec2f, age: f32) -> vec4f {
  let aspect = frame.res.x / frame.res.y;
  let edge = age * 3.2 - 0.15 + 0.04 * sin(uv.x * 23.0 + U.b.y) + 0.03 * sin(uv.x * 9.0 - U.b.y * 3.0);
  let sheet = smoothstep(0.12, 0.0, edge - uv.y) * step(uv.y, edge) * (1.0 - smoothstep(0.2, 0.45, age));
  var acc = vec4f(vec2f(sin(uv.y * 40.0 + uv.x * 7.0), cos(uv.x * 31.0)) * 0.004 * sheet, 1.0 - 0.12 * sheet, 0.0);
  for (var layer = 0; layer < 2; layer++) {
    let sc = select(6.0, 14.0, layer == 1);
    let seed = i32(U.b.y) * 13 + layer * 101;
    let g0 = vec2f(uv.x * aspect, uv.y) * sc;
    let col = i32(floor(g0.x));
    let hc = hash2i(vec2i(col, seed + 31));
    let run = select(0.0, sq(max(age - 0.3 * hc, 0.0)) * (0.6 + 1.6 * hc), hc > 0.6 && layer == 0);
    let g = g0 - vec2f(0.0, run);
    let cell = vec2i(floor(g));
    let h = hash22i(cell + vec2i(seed, 17));
    let h2 = hash2i(cell + vec2i(7, seed));
    let life = 0.8 + 2.4 * fract(h2 * 13.7);
    if (h2 > select(0.32, 0.22, layer == 1) || age > life) { continue; }
    let c = vec2f(cell) + 0.3 + h * 0.4;
    let r = (0.07 + 0.16 * fract(h2 * 7.31)) * (1.0 - smoothstep(life * 0.5, life, age)) * select(1.0, 0.7, layer == 1);
    let d = (g - c) / max(r, 1e-4);
    let d2 = dot(d, d);
    if (d2 < 1.0) {
      let z = sqrt(1.0 - d2);
      let e = smoothstep(1.0, 0.75, d2);
      acc = vec4f(-d * r / sc * vec2f(1.0 / aspect, 1.0) * 1.8 * z * e, 1.0 - 0.1 * smoothstep(0.55, 0.95, d2) * e, smoothstep(0.25, 0.0, length(d + vec2f(0.3, 0.35))) * 0.35 * e);
    } else if (run > 0.0) {
      let tr = smoothstep(0.6, 0.0, abs(g.x - c.x) / max(r, 1e-4)) * step(g.y, c.y) * smoothstep(-2.5, 0.0, g.y - c.y) * (1.0 - smoothstep(life * 0.5, life, age));
      acc = vec4f(acc.xy + vec2f(0.0015 * tr, 0.0), acc.z * (1.0 - 0.05 * tr), acc.w);
    }
  }
  return acc;
}

@fragment fn fsLens(fin: FullscreenOut) -> @location(0) vec4f {
  let uv = fin.uv;
  let p = vec2i(fin.pos.xy);
  let rv = uwViewRay(uv);
  let rd = normalize(rv);
  // the waterline across the lens (antialiased over about a pixel: the lens point moves this far per pixel)
  let above = lensAbove(rd);
  let perPx = U.b.z * 2.0 / (frame.proj[1][1] * frame.res.y) * max(abs(frame.camUp.y), 0.15);
  let px = above / max(perPx, 1e-6);
  let underK = 1.0 - smoothstep(-0.7, 0.7, px);
  let t = U.a.x;
  var q = uv;
  // under water: a slow refraction wobble (the water in front of the lens is never still)
  if (underK > 0.0) {
    let w = vec2f(vnoise(uv * vec2f(4.0, 2.6) + vec2f(t * 0.31, t * 0.17)), vnoise(uv * vec2f(3.1, 4.4) - vec2f(t * 0.23, t * 0.29) + 7.3)) - 0.5;
    q += w * U.a.w * underK;
  }
  // the meniscus: water clinging along the waterline bends the picture just above it toward the line
  var men = 0.0;
  if (abs(px) < 40.0) {
    let film = smoothstep(26.0, 0.0, px) * step(0.0, px);
    q += vec2f(0.0, film * film * 7.0) * frame.invRes;
    men = exp(-sq(px / 1.8));
  }
  // drops running off the lens after surfacing
  var drop = vec4f(0.0, 0.0, 1.0, 0.0);
  if (U.a.y >= 0.0 && U.a.y < 3.5 && underK < 1.0) {
    drop = droplets(uv, U.a.y);
    q += drop.xy * (1.0 - underK);
  }
  // the scene, a little chromatic softness toward the edges under water
  let r = uv - 0.5;
  let ca = r * dot(r, r) * U.b.x * underK;
  var col = vec3f(scene(q + ca).r, scene(q).g, scene(q - ca).b);
  col *= mix(1.0, drop.z, 1.0 - underK);
  col += drop.w * (1.0 - underK) * (luminance(scene(uv)) * 0.6 + 0.02);
  // the water between the lens and what it sees, and the light it lets through in shafts
  if (underK > 0.0) {
    let dist = rayDist(textureLoad(depthTex, p, 0), rv);
    let run = waterRun(rd, dist);
    let end = frame.camPos + rd * run;
    let d0 = max(world.seaLevel - frame.camPos.y, 0.0);
    var wet = uwApply(col, rd, run, d0, max(world.seaLevel - end.y, 0.0));
    if (U.a.z > 0.0) { wet += shaftsAt(p, dist); }
    col = mix(col, wet, underK);
  }
  if (men > 0.0) {
    let lip = exp(-sq((px - 2.6) / 1.3));
    col = col * (1.0 - 0.6 * men) + luminance(col) * lip * 0.35;
  }
  return vec4f(col, 1.0);
}
