// Rigid pieces (loom/render/pieces.ts): every piece's triangles in one vertex arena, each vertex naming its piece's
// slot; each slot a transform (position, uniform scale, rotation) and a few attributes. One draw for all of them —
// the shader of the game that owns them includes this and lights them as it likes.
//   vertex: p local position, cell its slot, m its material-space position (for procedural textures that run on across
//   a break), nm the normal (snorm8 ×3) and in the top byte the material (low 7 bits) and a cut flag (bit 7: a face
//   made by breaking).
struct PieceVertex { p: vec3f, cell: u32, m: vec3f, nm: u32 }
//   slot: p xyz position, w scale (0 hides it); q rotation; a: x tint (rgba8 bits), y seed, z heat, w damage;
//   b: the half extents of a box piece (0 for any other shape), w free for the game
struct PieceXf { p: vec4f, q: vec4f, a: vec4f, b: vec4f }
@group(2) @binding(0) var<storage, read> pieceVerts: array<PieceVertex>;
@group(2) @binding(1) var<storage, read> pieceXf: array<PieceXf>;

fn pqrot(q: vec4f, v: vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }

struct PieceV {
  wp: vec3f,
  n: vec3f,
  lp: vec3f,
  ln: vec3f,
  m: vec3f,
  mat: u32,
  cut: f32,
  slot: u32,
}
fn pieceNormal(nm: u32) -> vec3f {
  let x = f32(i32(nm << 24u) >> 24u) / 127.0;
  let y = f32(i32(nm << 16u) >> 24u) / 127.0;
  let z = f32(i32(nm << 8u) >> 24u) / 127.0;
  return normalize(vec3f(x, y, z) + vec3f(1e-6));
}
fn pieceVertex(vi: u32) -> PieceV {
  let v = pieceVerts[vi];
  let x = pieceXf[v.cell];
  var o: PieceV;
  o.wp = x.p.xyz + pqrot(x.q, v.p * x.p.w);
  o.lp = v.p;
  o.ln = pieceNormal(v.nm);
  o.n = pqrot(x.q, o.ln);
  o.m = v.m;
  o.mat = (v.nm >> 24u) & 127u;
  o.cut = f32(v.nm >> 31u);
  o.slot = v.cell;
  return o;
}
fn piecePos(vi: u32) -> vec3f {
  let v = pieceVerts[vi];
  let x = pieceXf[v.cell];
  return x.p.xyz + pqrot(x.q, v.p * x.p.w);
}
fn pieceTint(slot: u32) -> vec4f { return unpack4x8unorm(bitcast<u32>(pieceXf[slot].a.x)); }
