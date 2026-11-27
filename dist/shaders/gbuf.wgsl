// Compact thin G-buffer packing helpers for forward+MRT relighting passes (`rgba16float`, 8 B/px):
//   xy: octahedral unit shading normal in [-1, 1]^2 (Cigolle et al. 2014)
//   z:  perceptual roughness in [0.02, 0.99], plus +1.0 when flagged as a mirror-class surface (glass, metal, wet, stone)
//   w:  ambient share of pre-aerial surface radiance in [0.001, 1.0]; 0 marks an unwritten / sky / opt-out pixel
// Pure WGSL math — zero bindings, safe for WebGPU and native wgpu/Naga.

fn octSignNotZero(v: vec2f) -> vec2f {
  return vec2f(select(-1.0, 1.0, v.x >= 0.0), select(-1.0, 1.0, v.y >= 0.0));
}

fn octEncode(n0: vec3f) -> vec2f {
  let l2 = dot(n0, n0);
  if (l2 < 1e-10) { return vec2f(0.0, 0.0); }
  let n = n0 * inverseSqrt(l2);
  let inv = 1.0 / (abs(n.x) + abs(n.y) + abs(n.z));
  var p = n.xz * inv;
  if (n.y < 0.0) {
    p = (1.0 - abs(p.yx)) * octSignNotZero(p);
  }
  return p;
}

fn octDecode(e: vec2f) -> vec3f {
  var v = vec3f(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
  if (v.y < 0.0) {
    let w = (1.0 - abs(v.zx)) * octSignNotZero(v.xz);
    v.x = w.x;
    v.z = w.y;
  }
  let l2 = dot(v, v);
  return select(vec3f(0.0, 1.0, 0.0), v * inverseSqrt(l2), l2 > 1e-10);
}

fn packGbuf(n: vec3f, rough: f32, mirror: bool, ambShare: f32) -> vec4f {
  let r = clamp(rough, 0.02, 0.99) + select(0.0, 1.0, mirror);
  let s = clamp(ambShare, 0.001, 1.0);
  return vec4f(octEncode(n), r, s);
}

fn gbufValid(g: vec4f) -> bool {
  return g.w > 0.0005 && g.z > 0.005;
}

fn gbufNormal(g: vec4f) -> vec3f {
  return octDecode(g.xy);
}

fn gbufMirror(g: vec4f) -> bool {
  return g.z >= 1.0;
}

fn gbufRough(g: vec4f) -> f32 {
  return clamp(select(g.z, g.z - 1.0, g.z >= 1.0), 0.02, 0.99);
}

fn gbufAmbShare(g: vec4f) -> f32 {
  return clamp(g.w, 0.0, 1.0);
}
