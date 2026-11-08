// Dual-quaternion skinning (Kavan's), for a mesh skinned to a skeleton posed on the CPU: each bone's skin transform as a
// unit dual quaternion, two vec4s a bone (real, dual), in a storage array the including file declares as
//   @group(n) @binding(m) var<storage, read> DQ: array<vec4f>;
// A vertex's (or anything laid on one's) four bones and weights blend into one dual quaternion; a point and a
// direction go through it. Where the blended bones are nearly half a turn apart (a thigh swung through against the
// other in a lunge, cloth between them on both) the blend's sign can flip from one frame to the next: skinPoint fades
// to linear blending of the bones' own transforms there instead (a little pinch, no jump).
struct SkinDQ { r: vec4f, d: vec4f, lin: f32 };

/** the blended dual quaternion of four bones by their weights (antipodal ones taken the short way round) */
fn skinBlend(bones: vec4u, weights: vec4f) -> SkinDQ {
  let b = bones * 2u;
  let r0 = DQ[b.x]; let r1 = DQ[b.y]; let r2 = DQ[b.z]; let r3 = DQ[b.w];
  let w = weights * vec4f(1.0, select(1.0, -1.0, dot(r1, r0) < 0.0), select(1.0, -1.0, dot(r2, r0) < 0.0), select(1.0, -1.0, dot(r3, r0) < 0.0));
  let r = r0 * w.x + r1 * w.y + r2 * w.z + r3 * w.w;
  let d = DQ[b.x + 1u] * w.x + DQ[b.y + 1u] * w.y + DQ[b.z + 1u] * w.z + DQ[b.w + 1u] * w.w;
  let n = 1.0 / max(length(r), 1e-6);
  let c = abs(vec3f(dot(r1, r0), dot(r2, r0), dot(r3, r0)));
  let near = select(vec3f(1.0), c, weights.yzw > vec3f(0.04));
  return SkinDQ(r * n, d * n, 1.0 - smoothstep(0.08, 0.3, min(near.x, min(near.y, near.z))));
}
/** a direction (a normal, a tangent) turned by a dual quaternion */
fn dqDir(q: SkinDQ, p: vec3f) -> vec3f { return p + 2.0 * cross(q.r.xyz, cross(q.r.xyz, p) + q.r.w * p); }
/** a point carried by a dual quaternion */
fn dqPoint(q: SkinDQ, p: vec3f) -> vec3f {
  let t = 2.0 * (q.r.w * q.d.xyz - q.d.w * q.r.xyz + cross(q.r.xyz, q.d.xyz));
  return dqDir(q, p) + t;
}
/** a point through each bone's own transform, blended linearly */
fn skinLinear(bones: vec4u, weights: vec4f, p: vec3f) -> vec3f {
  let b = bones * 2u;
  let s = dqPoint(SkinDQ(DQ[b.x], DQ[b.x + 1u], 0.0), p) * weights.x + dqPoint(SkinDQ(DQ[b.y], DQ[b.y + 1u], 0.0), p) * weights.y
    + dqPoint(SkinDQ(DQ[b.z], DQ[b.z + 1u], 0.0), p) * weights.z + dqPoint(SkinDQ(DQ[b.w], DQ[b.w + 1u], 0.0), p) * weights.w;
  return s / max(dot(weights, vec4f(1.0)), 1e-4);
}
/** a bind-space point skinned: the dual quaternion's, faded to linear where its bones are nearly opposite */
fn skinPoint(q: SkinDQ, bones: vec4u, weights: vec4f, p: vec3f) -> vec3f {
  if (q.lin <= 0.0) { return dqPoint(q, p); }
  return mix(dqPoint(q, p), skinLinear(bones, weights, p), q.lin);
}
/** a bind-space direction skinned as skinPoint skins the point */
fn skinDir(q: SkinDQ, bones: vec4u, weights: vec4f, d: vec3f) -> vec3f {
  if (q.lin <= 0.0) { return dqDir(q, d); }
  let b = bones * 2u;
  let l = dqDir(SkinDQ(DQ[b.x], DQ[b.x + 1u], 0.0), d) * weights.x + dqDir(SkinDQ(DQ[b.y], DQ[b.y + 1u], 0.0), d) * weights.y
    + dqDir(SkinDQ(DQ[b.z], DQ[b.z + 1u], 0.0), d) * weights.z + dqDir(SkinDQ(DQ[b.w], DQ[b.w + 1u], 0.0), d) * weights.w;
  return mix(dqDir(q, d), l, q.lin);
}
/** four bone indices packed a byte each in a u32 */
fn unpackBones(b: u32) -> vec4u { return vec4u(b & 255u, (b >> 8u) & 255u, (b >> 16u) & 255u, b >> 24u); }
