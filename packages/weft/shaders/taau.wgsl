// TAAU: temporal anti-aliasing that upscales (taau.ts). The scene is drawn at the render size with the camera jittered
// by a sub-pixel offset each frame (a Halton sequence); this pass gathers this frame's samples into a history at the
// output size: each output pixel the render-size texels around it weighted by how near their (unjittered) centres
// fall, the history reprojected by the camera's motion (the nearest depth round the pixel taken back through this
// frame's projection and forward through the camera's step and last frame's — matrices made in doubles from the step
// alone, so far from the origin is as precise as near it), clipped to the colours this frame has around the pixel
// (variance clipping in YCoCg) and dropped where the depth it remembers isn't the depth that should be there (what
// moved by itself, what was uncovered), then blended — a share of this frame by how much of it landed on the pixel.
// Blended in a tonemapped space (after the app's exposure) so one bright texel doesn't flicker. The history's alpha
// keeps each pixel's depth. Binds in group 3 of its own, whatever an app shares there.
#include "weft/frame"

struct Taau {
  toCur: mat4x4f,     // this frame's jittered NDC (x, y, depth, 1) → its clip space without the jitter
  toPrev: mat4x4f,    // → last frame's clip space without its jitter (through the camera's step)
  jitter: vec4f,      // xy this frame's jitter (render pixels, Camera.jitter: +x right, +y up), z 1 drops the history, w sharpen 0..1
  k: vec4f,           // x the least share of this frame (1/16 typical), y the clip's width (sigmas), z anti-flicker, w debug view
  o: vec4f,           // x 1: motion from taauVel (screen uv now − then, at the render size) in place of the camera's alone;
                      // y exposure; z 1 orthographic; w the depth mismatch that drops the history (relative; 0 never)
  m: vec4f,           // (taaumotion.wgsl's entries) x how near a motion texel's distance must be the depth's to be the visible
                      // surface's (relative)
}
@group(3) @binding(0) var<uniform> T: Taau;
@group(3) @binding(1) var taauSrc: texture_2d<f32>;
@group(3) @binding(2) var taauDepth: texture_depth_2d;
@group(3) @binding(7) var taauDepthMS: texture_depth_multisampled_2d;   // (an MSAA scene's depth: entry resolveMS reads its first sample)
@group(3) @binding(3) var taauHist: texture_2d<f32>;
@group(3) @binding(4) var taauOut: texture_storage_2d<rgba16float, write>;
@group(3) @binding(8) var taauVel: texture_2d<f32>;   // (optional: an app's motion vectors; a 1×1 stand-in without)

fn tLuma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
// (a reversible tonemap for blending: weights a sample by 1/(1+luma))
fn tm(c0: vec3f) -> vec3f { let c = c0 * T.o.y; return c / (1.0 + tLuma(c)); }
fn itm(c: vec3f) -> vec3f { return c / max(1.0 - tLuma(c), 1e-3) / T.o.y; }
fn toYCoCg(c: vec3f) -> vec3f { return vec3f(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
fn fromYCoCg(c: vec3f) -> vec3f { return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
fn finite3(c: vec3f) -> bool { return all(c == c) && all(abs(c) < vec3f(6.0e4)); }

/** the history at uv, Catmull-Rom (five bilinear taps, the corners dropped): sharp where a bilinear read would soften
 *  the image a little more every frame it's carried */
fn histCR(uv: vec2f) -> vec3f {
  let size = vec2f(textureDimensions(taauHist));
  let p = uv * size;
  let c = floor(p - 0.5) + 0.5;
  let f = p - c;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let o12 = w2 / w12;
  let t0 = (c - 1.0) / size;
  let t3 = (c + 2.0) / size;
  let t12 = (c + o12) / size;
  var r = vec3f(0.0);
  r += textureSampleLevel(taauHist, samp_linear, vec2f(t12.x, t0.y), 0.0).rgb * (w12.x * w0.y);
  r += textureSampleLevel(taauHist, samp_linear, vec2f(t0.x, t12.y), 0.0).rgb * (w0.x * w12.y);
  r += textureSampleLevel(taauHist, samp_linear, vec2f(t12.x, t12.y), 0.0).rgb * (w12.x * w12.y);
  r += textureSampleLevel(taauHist, samp_linear, vec2f(t3.x, t12.y), 0.0).rgb * (w3.x * w12.y);
  r += textureSampleLevel(taauHist, samp_linear, vec2f(t12.x, t3.y), 0.0).rgb * (w12.x * w3.y);
  let wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / wsum, vec3f(0.0));
}

/** clip a colour toward the box's centre until it's inside (all YCoCg) */
fn clipBox(h: vec3f, lo: vec3f, hi: vec3f, toward: vec3f) -> vec3f {
  let c = 0.5 * (hi + lo);
  let e = 0.5 * (hi - lo) + 1e-5;
  let v = h - c;
  let a = abs(v / e);
  let m = max(a.x, max(a.y, a.z));
  if (m > 1.0) { return c + v / m; }
  return h;
}

/** the 3×3 render texels round an output pixel's (jittered) position: their corner, clamped by the caller */
fn taauCorner(p: vec2i, outDim: vec2i, inDim: vec2i) -> vec2i {
  let uv = (vec2f(p) + 0.5) / vec2f(outDim);
  return vec2i(floor(uv * vec2f(inDim) + vec2f(T.jitter.x, -T.jitter.y)));
}
@compute @workgroup_size(8, 8) fn resolve(@builtin(global_invocation_id) id: vec3u) {
  let outDim = vec2i(textureDimensions(taauOut));
  let p = vec2i(id.xy);
  if (any(p >= outDim)) { return; }
  let inDim = vec2i(textureDimensions(taauSrc));
  let ic = taauCorner(p, outDim, inDim);
  var z: array<f32, 9>;
  for (var k = 0; k < 9; k++) { z[k] = textureLoad(taauDepth, clamp(ic + vec2i(k % 3 - 1, k / 3 - 1), vec2i(0), inDim - 1), 0); }
  resolveAt(p, outDim, inDim, z);
}
@compute @workgroup_size(8, 8) fn resolveMS(@builtin(global_invocation_id) id: vec3u) {
  let outDim = vec2i(textureDimensions(taauOut));
  let p = vec2i(id.xy);
  if (any(p >= outDim)) { return; }
  let inDim = vec2i(textureDimensions(taauSrc));
  let ic = taauCorner(p, outDim, inDim);
  var z: array<f32, 9>;
  for (var k = 0; k < 9; k++) { z[k] = textureLoad(taauDepthMS, clamp(ic + vec2i(k % 3 - 1, k / 3 - 1), vec2i(0), inDim - 1), 0); }
  resolveAt(p, outDim, inDim, z);
}
/** the resolve for output pixel p, given the depths of the 3×3 texels round it (row by row from the top left) */
fn resolveAt(p: vec2i, outDim: vec2i, inDim: vec2i, zIn: array<f32, 9>) {
  var z = zIn;
  let inF = vec2f(inDim);
  let uv = (vec2f(p) + 0.5) / vec2f(outDim);
  // (this output pixel in render pixels; a texel centred at c holds what, unjittered, is at c - J)
  let pos = uv * inF;
  let J = vec2f(T.jitter.x, -T.jitter.y);
  let ic = vec2i(floor(pos + J));
  // (each sample weighted by its distance in output pixels: when upscaling a sample lands near only some output pixels
  // a frame — those catch it, the rest keep their history until the jitter brings one near: sharp, not smeared)
  let scale = vec2f(outDim) / inF;
  let fw = max(1.0, 0.5 * (scale.x + scale.y));
  var sum = vec3f(0.0);
  var wsum = 0.0;
  // (and a wide one, by input pixels: a smooth upsample of this frame, for where the history can't be used — alone, the
  // narrow one's samples show the render's own grid)
  var sumW = vec3f(0.0);
  var wsumW = 0.0;
  var m1 = vec3f(0.0);
  var m2 = vec3f(0.0);
  var lo = vec3f(1e9);
  var hi = vec3f(-1e9);
  var best = 0.0;
  var bestC = ic;
  var anySky = false;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let t = clamp(ic + vec2i(dx, dy), vec2i(0), inDim - 1);
      var c = textureLoad(taauSrc, t, 0).rgb;
      if (!finite3(c)) { c = vec3f(0.0); }
      let ct = tm(max(c, vec3f(0.0)));
      let y = toYCoCg(ct);
      m1 += y; m2 += y * y;
      lo = min(lo, y); hi = max(hi, y);
      let d = (vec2f(t) + 0.5 - J - pos) * fw;
      // (Blackman-Harris, approximated by a Gaussian)
      let w = exp(-2.29 * dot(d, d));
      sum += ct * w; wsum += w;
      let dw = vec2f(t) + 0.5 - J - pos;
      let ww = exp(-2.29 * dot(dw, dw));
      sumW += ct * ww; wsumW += ww;
      // (the nearest surface around the pixel: reversed-Z, the greatest depth — edges move with what's in front)
      let zk = z[(dy + 1) * 3 + dx + 1];
      if (zk > best) { best = zk; bestC = t; }
      anySky = anySky || zk <= 0.0;
    }
  }
  // (sharp where a sample landed near this output pixel, the smooth upsample where none did)
  let conf = clamp(wsum, 0.0, 1.0);
  let curW = sumW / max(wsumW, 1e-4);
  let curN = sum / max(wsum, 1e-4);
  let cur = mix(curW, curN, conf);
  let mean = m1 / 9.0;
  let sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3f(0.0)));
  let g = T.k.y;
  let blo = max(lo, mean - sigma * g);
  let bhi = min(hi, mean + sigma * g);

  // ---- where this pixel was last frame
  let tuv = (vec2f(bestC) + 0.5) / inF;
  let ndc = vec4f(tuv.x * 2.0 - 1.0, 1.0 - tuv.y * 2.0, best, 1.0);
  let cc = T.toCur * ndc;
  let pc = T.toPrev * ndc;
  // (the depth to remember here, and the one last frame should have had: the view distance (clip w) in perspective, the
  // depth itself in orthographic; 0 the sky)
  let ortho = T.o.z > 0.5;
  let sky = best <= 0.0;
  let dNow = select(select(min(cc.w, 6.0e4), cc.z / max(cc.w, 1e-9), ortho), 0.0, sky);
  let dWas = select(select(min(pc.w, 6.0e4), pc.z / max(pc.w, 1e-9), ortho), 0.0, sky);
  var reset = T.jitter.z > 0.5;
  var huv = uv;
  if (T.o.x > 0.5) {
    // (the app's own motion: what moves by itself reprojects too)
    huv = uv - textureLoad(taauVel, clamp(bestC, vec2i(0), vec2i(textureDimensions(taauVel)) - 1), 0).xy;
  } else if (pc.w <= 1e-6 || cc.w <= 1e-6) { reset = true; }
  else {
    let cu = vec2f(cc.x / cc.w * 0.5 + 0.5, 0.5 - cc.y / cc.w * 0.5);
    let pu = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
    huv = uv - (cu - pu);
  }
  if (any(huv < vec2f(0.0)) || any(huv > vec2f(1.0))) { reset = true; }
  // (the depth the history remembers round there: kept if any of the four texels under it agrees — an edge's own
  // neighbours do — dropped if none does: what moved by itself, what was uncovered, what came in front. Not on a
  // silhouette against the sky nor in it: there the jitter flips a pixel between the two, and the colours' clip has it)
  let hdim = vec2i(textureDimensions(taauHist));
  if (!reset && T.o.w > 0.0 && !anySky) {
    let h0 = vec2i(floor(huv * vec2f(hdim) - 0.5));
    var agree = false;
    for (var k = 0; k < 4; k++) {
      let hd = textureLoad(taauHist, clamp(h0 + vec2i(k & 1, k >> 1), vec2i(0), hdim - 1), 0).a;
      let same = select(abs(hd - dWas) <= T.o.w * max(dWas, 1e-4), hd <= 0.0, sky);
      agree = agree || same;
    }
    if (!agree) { reset = true; }
  }
  var outT = curW;
  if (!reset) {
    var h = histCR(huv);
    if (!finite3(h)) { h = itm(cur); }
    let hy = toYCoCg(tm(h));
    let cy = toYCoCg(cur);
    let clipped = clipBox(hy, blo, bhi, cy);
    // (how far the history lay beyond the neighbourhood, in its spread: detail that changed in place — a window that
    // streamed in, a light switched on — can pass a box that spans both it and its surround; past a little, let it go)
    let beyond = max(max(blo - hy, hy - bhi), vec3f(0.0)) / max(sigma, vec3f(1e-3));
    let fadeK = smoothstep(0.1, 0.6, max(beyond.x, max(beyond.y, beyond.z)));
    // (this frame's share: the least where a sample fell right on the pixel; more where history was clipped hard —
    // something changed there — and less of it where the samples fell far from the pixel, when upscaling)
    let moved = length(clipped - hy) / max(clipped.x + 0.02, 0.02);
    // (where the history's being replaced — what's there changed — this frame's smooth upsample takes over, not its
    // sharp samples: those help only piled up over frames)
    let reject = max(clamp(moved * T.k.z, 0.0, 0.6), fadeK * 0.6);
    var a = T.k.x * max(conf, 0.02);
    a = mix(a, 0.5, reject);
    // (and less history the faster it moves: every reprojection resamples it — a little softer each time)
    let mpx = length((uv - huv) * vec2f(outDim));
    a = 1.0 - (1.0 - a) * exp(-mpx * 0.025);
    let curB = mix(curW, curN, conf * (1.0 - reject / 0.6));
    outT = mix(fromYCoCg(clipped), curB, a);
  }
  var o = itm(max(outT, vec3f(0.0)));
  if (!finite3(o)) { o = vec3f(0.0); }
  if (T.k.w > 0.5) {
    // (debug: red where the history was dropped, the motion's size in green)
    o = select(vec3f(0.0, length((uv - huv) * vec2f(outDim)) * 0.5, 0.0), vec3f(4.0, 0.0, 0.0), reset);
  }
  textureStore(taauOut, p, vec4f(o, dNow));
}

// ---------------------------------------------------------------- sharpening (contrast adaptive, after the resolve)
// The history read by Catmull-Rom stays sharp, but an upscale from a much smaller render softens; this restores the
// edges by each pixel's local contrast (AMD's CAS in spirit: less where the neighbourhood already has contrast).
@group(3) @binding(5) var sharpSrc: texture_2d<f32>;
@group(3) @binding(6) var sharpOut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn sharpen(@builtin(global_invocation_id) id: vec3u) {
  let dim = vec2i(textureDimensions(sharpOut));
  let p = vec2i(id.xy);
  if (any(p >= dim)) { return; }
  let ld = dim - 1;
  let e = textureLoad(sharpSrc, p, 0).rgb;
  let b = textureLoad(sharpSrc, clamp(p + vec2i(0, -1), vec2i(0), ld), 0).rgb;
  let d = textureLoad(sharpSrc, clamp(p + vec2i(-1, 0), vec2i(0), ld), 0).rgb;
  let f = textureLoad(sharpSrc, clamp(p + vec2i(1, 0), vec2i(0), ld), 0).rgb;
  let h = textureLoad(sharpSrc, clamp(p + vec2i(0, 1), vec2i(0), ld), 0).rgb;
  let te = tm(e); let tb = tm(b); let td = tm(d); let tf = tm(f); let th = tm(h);
  let mn = min(te, min(min(tb, td), min(tf, th)));
  let mx = max(te, max(max(tb, td), max(tf, th)));
  let amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3f(1e-4)), vec3f(0.0), vec3f(1.0)));
  let peak = -1.0 / mix(8.0, 5.0, T.jitter.w);
  let w = amp * peak;
  let r = (tb * w + td * w + tf * w + th * w + te) / (1.0 + 4.0 * w);
  textureStore(sharpOut, p, vec4f(itm(clamp(r, vec3f(0.0), vec3f(0.999))), 1.0));
}
