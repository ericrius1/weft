// TAAU with a motion target (taau.ts, TaauOptions.motion): taau.wgsl's resolve, with the motion that the draws moving
// by themselves write (weft/motion) read at the texel the history is taken from. A file of its own so an app without
// a motion target is given taau.wgsl's code exactly as before.
#include "./taau.wgsl"

// (the motion target, single-sample or the scene's sample count: its first sample is read, as the depth's is)
@group(3) @binding(9) var taauMotion: texture_2d<f32>;
@group(3) @binding(10) var taauMotionMS: texture_multisampled_2d<f32>;

/** the 3×3 texel (row by row from the top left) the resolve reprojects from: the nearest surface (reversed-Z) */
fn taauNearest(z: array<f32, 9>) -> i32 {
  var best = 0.0;
  var bi = 4;
  for (var k = 0; k < 9; k++) { if (z[k] > best) { best = z[k]; bi = k; } }
  return bi;
}
@compute @workgroup_size(8, 8) fn resolveObj(@builtin(global_invocation_id) id: vec3u) {
  let outDim = vec2i(textureDimensions(taauOut));
  let p = vec2i(id.xy);
  if (any(p >= outDim)) { return; }
  let inDim = vec2i(textureDimensions(taauSrc));
  let ic = taauCorner(p, outDim, inDim);
  var z: array<f32, 9>;
  for (var k = 0; k < 9; k++) { z[k] = textureLoad(taauDepth, clamp(ic + vec2i(k % 3 - 1, k / 3 - 1), vec2i(0), inDim - 1), 0); }
  let bi = taauNearest(z);
  let mt = clamp(ic + vec2i(bi % 3 - 1, bi / 3 - 1), vec2i(0), vec2i(textureDimensions(taauMotion)) - 1);
  resolveAtObj(p, outDim, inDim, z, textureLoad(taauMotion, mt, 0));
}
@compute @workgroup_size(8, 8) fn resolveObjMS(@builtin(global_invocation_id) id: vec3u) {
  let outDim = vec2i(textureDimensions(taauOut));
  let p = vec2i(id.xy);
  if (any(p >= outDim)) { return; }
  let inDim = vec2i(textureDimensions(taauSrc));
  let ic = taauCorner(p, outDim, inDim);
  var z: array<f32, 9>;
  for (var k = 0; k < 9; k++) { z[k] = textureLoad(taauDepthMS, clamp(ic + vec2i(k % 3 - 1, k / 3 - 1), vec2i(0), inDim - 1), 0); }
  let bi = taauNearest(z);
  let mt = clamp(ic + vec2i(bi % 3 - 1, bi / 3 - 1), vec2i(0), vec2i(textureDimensions(taauMotionMS)) - 1);
  resolveAtObj(p, outDim, inDim, z, textureLoad(taauMotionMS, mt, 0));
}
/** resolveAt, with the motion texel mv (weft/motion) read at the nearest texel round the pixel: where it's the visible
 *  surface's (its distance now the depth's), the history is taken from where that surface was and checked against the
 *  distance it had there, not the camera's guess. Keep in step with resolveAt */
fn resolveAtObj(p: vec2i, outDim: vec2i, inDim: vec2i, zIn: array<f32, 9>, mv: vec4f) {
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
  var dWas = select(select(min(pc.w, 6.0e4), pc.z / max(pc.w, 1e-9), ortho), 0.0, sky);
  var reset = T.jitter.z > 0.5;
  var huv = uv;
  // (a moving draw's own motion, where the surface that wrote it is the one in the depth buffer: a static draw in
  // front of it writes nothing and is reprojected by the camera. The depth test's measure is the camera path's: in
  // perspective a point's distance last frame over its distance now (dNow is 1 there: cc.w is the homogeneous 1 this
  // frame's ndc carries), its depth in orthographic; the motion texel's distances are metres)
  let dist = select(1.0 / max(dot(T.iw, ndc), 1e-9), dNow, ortho);
  let own = !sky && mv.w > 0.0 && abs(mv.w - dist) <= T.m.x * max(dist, 1e-4);
  if (own) {
    huv = uv - mv.xy;
    dWas = select(min(mv.z / mv.w, 6.0e4), mv.z, ortho);
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
    // (debug: red where the history was dropped, the motion's size in green, blue where a draw's own motion was used)
    o = select(vec3f(0.0, length((uv - huv) * vec2f(outDim)) * 0.5, select(0.0, 2.0, own)), vec3f(4.0, 0.0, select(0.0, 2.0, own)), reset);
  }
  textureStore(taauOut, p, vec4f(o, dNow));
}
