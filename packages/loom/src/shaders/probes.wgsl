// The irradiance probes (probes.ts): each frame a few probes are captured — the source pass's draws (the scene, its
// sky) seen from the probe's point into the six faces of a small cube — and this projects each capture onto L1
// spherical harmonics, already convolved with the cosine (what a diffuse surface facing n gathers: irradiance / π =
// c0 + c1 n.y + c2 n.z + c3 n.x), blends it into what the probe held, and writes it with the probe's validity (how
// little of the cube was a surface right up against it: a probe inside a wall or a rock sees nothing else) into the
// volume's four slabs (envx.wgsl, env.wgsl giProbe).
struct ProbeSlot { at: vec4i, k: vec4f }   // at: the probe's cell (xyz), w 1 when the slot's in use; k: x the new capture's share
struct Probes {
  slots: array<ProbeSlot, 8>,
  fwd: array<vec4f, 6>,     // each cube face's camera basis (the capture's own: Camera.forward, right, up)
  right: array<vec4f, 6>,
  up: array<vec4f, 6>,
  n: vec4f,                 // xyz probes along each axis, w slots in use
  k: vec4f,                 // x the capture's near plane (m), y a surface nearer than this is "inside" (m), z the share past which a probe isn't trusted, w the faces' size
}
@group(2) @binding(0) var<uniform> PB: Probes;
@group(2) @binding(1) var capColor: texture_2d_array<f32>;
@group(2) @binding(2) var capDepth: texture_depth_2d_array;
struct Probe { r: vec4f, g: vec4f, b: vec4f, v: vec4f }   // (a point light's record: env.wgsl reads it as one)
@group(2) @binding(3) var<storage, read_write> probes: array<Probe>;

const WG: u32 = 64u;
var<workgroup> acc: array<array<f32, 14>, 64>;

@compute @workgroup_size(64) fn project(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3u) {
  let slot = wg.x;
  let S = PB.slots[slot];
  let F = u32(PB.k.w);
  let texels = F * F * 6u;
  // (r, g, b each four coefficients, the solid angle summed, the "inside" texels' share)
  var a: array<f32, 14>;
  for (var j = 0; j < 14; j++) { a[j] = 0.0; }
  if (S.at.w > 0) {
    for (var t = li; t < texels; t += WG) {
      let face = t / (F * F);
      let xy = t % (F * F);
      let x = xy % F;
      let y = xy / F;
      let u = (f32(x) + 0.5) / f32(F) * 2.0 - 1.0;
      let v = 1.0 - (f32(y) + 0.5) / f32(F) * 2.0;
      let layer = i32(slot * 6u + face);
      let d0 = PB.fwd[face].xyz + PB.right[face].xyz * u + PB.up[face].xyz * v;
      let r2 = dot(d0, d0);
      let dir = d0 * inverseSqrt(r2);
      let dw = 4.0 / (f32(F * F) * r2 * sqrt(r2));
      var c = textureLoad(capColor, vec2i(i32(x), i32(y)), layer, 0).rgb;
      if (!(all(c == c) && all(abs(c) < vec3f(6.0e4)))) { c = vec3f(0.0); }
      c = max(c, vec3f(0.0));
      // (L1: Y00 = 0.282095, Y1 = 0.488603 (y, z, x); convolved with the cosine: A0 = π, A1 = 2π/3; over π)
      let b0 = 0.282095 * 0.282095;
      let b1 = 0.488603 * 0.488603 * (2.0 / 3.0);
      let bs = vec4f(b0, b1 * dir.y, b1 * dir.z, b1 * dir.x) * dw;
      a[0] += c.r * bs.x; a[1] += c.r * bs.y; a[2] += c.r * bs.z; a[3] += c.r * bs.w;
      a[4] += c.g * bs.x; a[5] += c.g * bs.y; a[6] += c.g * bs.z; a[7] += c.g * bs.w;
      a[8] += c.b * bs.x; a[9] += c.b * bs.y; a[10] += c.b * bs.z; a[11] += c.b * bs.w;
      a[12] += dw;
      // (the distance to what's seen there: reversed-Z, the view axis's near / depth, along the ray)
      let z = textureLoad(capDepth, vec2i(i32(x), i32(y)), layer, 0);
      let dist = PB.k.x / max(z, 1e-9) * sqrt(r2);
      if (z > 0.0 && dist < PB.k.y) { a[13] += dw; }
    }
  }
  for (var j = 0; j < 14; j++) { acc[li][j] = a[j]; }
  workgroupBarrier();
  for (var s = WG / 2u; s > 0u; s >>= 1u) {
    if (li < s) { for (var j = 0; j < 14; j++) { acc[li][j] += acc[li + s][j]; } }
    workgroupBarrier();
  }
  if (li != 0u || S.at.w <= 0) { return; }
  // (the solid angle sums to 4π over the cube: normalised by it so a coarse cube's error cancels)
  let norm = 4.0 * 3.14159265 / max(acc[0][12], 1e-6);
  let inside = acc[0][13] / max(acc[0][12], 1e-6);
  let valid = 1.0 - smoothstep(PB.k.z * 0.5, PB.k.z, inside);
  let N = vec3i(PB.n.xyz);
  let p = S.at.xyz;
  let idx = (p.z * N.y + p.y) * N.x + p.x;
  // (what it held, un-premultiplied; the new capture blended in by the slot's share — all of it the first time)
  let old = probes[idx];
  let ov = old.v.x;
  let keep = select(0.0, 1.0 - S.k.x, ov > 1e-3);
  let inv = 1.0 / max(ov, 1e-3);
  var o: Probe;
  o.r = mix(vec4f(acc[0][0], acc[0][1], acc[0][2], acc[0][3]) * norm, old.r * inv, keep) * valid;
  o.g = mix(vec4f(acc[0][4], acc[0][5], acc[0][6], acc[0][7]) * norm, old.g * inv, keep) * valid;
  o.b = mix(vec4f(acc[0][8], acc[0][9], acc[0][10], acc[0][11]) * norm, old.b * inv, keep) * valid;
  o.v = vec4f(valid, 0.0, 0.0, 0.0);
  probes[idx] = o;
}
