// the vertex layout of weft's MeshBuilder (40 bytes, pulled from a storage buffer by vertex index)
struct MeshVertex {
  px: f32, py: f32, pz: f32,
  nx: f32, ny: f32, nz: f32,
  u: f32, v: f32,
  color: u32,   // sRGB rgba8
  mat: u32,     // material id
}
fn meshPos(v: MeshVertex) -> vec3f { return vec3f(v.px, v.py, v.pz); }
fn meshNormal(v: MeshVertex) -> vec3f { return vec3f(v.nx, v.ny, v.nz); }
fn meshUV(v: MeshVertex) -> vec2f { return vec2f(v.u, v.v); }
fn srgbToLinear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}
fn meshColor(v: MeshVertex) -> vec4f {
  let c = unpack4x8unorm(v.color);
  return vec4f(srgbToLinear(c.rgb), c.a);
}
