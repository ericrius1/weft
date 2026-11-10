// Paint on the world (loom/render/paint.ts): a voxel volume over the play space, each voxel how much of each of three
// paints covers the surface passing through it (rgb) and when it was last painted (a: the clock mod 256 s — fresh paint
// is wet and glossy). Splats are stamped in by a compute pass (`splat`): a ragged, lobed blob of one paint that covers
// whatever was there, or bleach that takes it all away. Surfaces read it with `paintAt` (filtered) and threshold it
// with a little noise for a crisp, organic edge (`paintLayer`).
//
// (Bindings 40+: the include sits beside a shader's own group-2 resources.)
struct PaintU {
  origin: vec4f,             // xyz the volume's corner (world), w a voxel's size (m)
  dims: vec4f,               // voxels across x, y, z; w the clock (s)
  colors: array<vec4f, 3>,   // the three paints (linear rgb)
  count: vec4f,              // x splats this frame, y the stamp box (voxels across)
}
struct Splat {
  p: vec4f,   // xyz centre, w radius (m)
  q: vec4f,   // x paint (0..2; 3 bleach), y seed, z the clock when stamped, w strength
}
@group(2) @binding(40) var<uniform> PU: PaintU;
@group(2) @binding(41) var<storage, read> splats: array<Splat>;
@group(2) @binding(42) var paintGrid: texture_storage_3d<r32uint, read_write>;
@group(2) @binding(43) var paintOut: texture_storage_3d<rgba8unorm, write>;
@group(2) @binding(44) var paintTex: texture_3d<f32>;
@group(2) @binding(45) var paintSamp: sampler;

/** the paint where a surface passes through p (normal n): coverage of each paint (rgb), how wet (a: 1 fresh) */
fn paintAt(p: vec3f, n: vec3f) -> vec4f {
  // (a little inside the surface: the splat's stamp straddles it, and a thin wall's far side stays its own)
  let q = (p - n * PU.origin.w * 0.3 - PU.origin.xyz) / PU.origin.w;
  let uvw = q / PU.dims.xyz;
  if (any(uvw < vec3f(0.0)) || any(uvw > vec3f(1.0))) { return vec4f(0.0); }
  let s = textureSampleLevel(paintTex, paintSamp, uvw, 0.0);
  // wetness: how long ago it was stamped (8 bits of a 256 s clock)
  let age = fract((PU.dims.w / 256.0) - s.a + 1.0) * 256.0;
  return vec4f(s.rgb, select(exp(-age / 2.5), 0.0, max(s.r, max(s.g, s.b)) < 0.05));
}

/** a surface's paint, resolved: which paint (0..2, or -1), how much of it shows (0..1, a crisp ragged edge), the rim
 *  line round the blob (for an ink edge), how wet. `wob` a noise value (0..1) at the point for the raggedness */
struct PaintLayer { which: i32, cover: f32, rim: f32, wet: f32, color: vec3f }
fn paintLayer(p: vec3f, n: vec3f, wob: f32) -> PaintLayer {
  var o: PaintLayer;
  o.which = -1; o.cover = 0.0; o.rim = 0.0; o.wet = 0.0; o.color = vec3f(0.0);
  let c = paintAt(p, n);
  var k = 0;
  if (c.g > c[k]) { k = 1; }
  if (c.b > c[k]) { k = 2; }
  let m = c[k];
  if (m < 0.02) { return o; }
  let x = m + (wob - 0.5) * 0.42;
  o.which = k;
  o.cover = smoothstep(0.44, 0.52, x);
  o.rim = smoothstep(0.38, 0.44, x) * (1.0 - smoothstep(0.47, 0.53, x));
  o.wet = c.a;
  o.color = PU.colors[k].rgb;
  return o;
}

/** stamp this frame's splats: each a box of voxels round its centre, one invocation a voxel */
@compute @workgroup_size(4, 4, 4)
fn splat(@builtin(global_invocation_id) gid: vec3u) {
  let B = u32(PU.count.y);
  let si = gid.z / B;
  if (f32(si) >= PU.count.x || gid.x >= B || gid.y >= B) { return; }
  let s = splats[si];
  let vox = PU.origin.w;
  let c = (s.p.xyz - PU.origin.xyz) / vox;
  let v = vec3i(floor(c)) - vec3i(i32(B / 2u)) + vec3i(i32(gid.x), i32(gid.y), i32(gid.z % B));
  if (any(v < vec3i(0)) || any(v >= vec3i(PU.dims.xyz))) { return; }
  let d = (vec3f(v) + 0.5 - c) * vox;
  let dist = length(d);
  let r = s.p.w;
  // a splash, not a ball: lobes round it by direction (the seed turns them), the rim ragged
  let dn = d / max(dist, 1e-4);
  let lob = 0.8 + 0.2 * sin(dot(dn, vec3f(5.1, 3.7, 4.3)) * 2.6 + s.q.y * 6.283) * sin(dot(dn, vec3f(-2.3, 6.1, 1.7)) * 1.9 + s.q.y * 3.7);
  let cov = (1.0 - smoothstep(r * lob * 0.72, r * lob, dist)) * s.q.w;
  if (cov <= 0.0) { return; }
  let o = unpack4x8unorm(textureLoad(paintGrid, v).x);
  var nv = vec4f(o.rgb * (1.0 - cov), o.a);
  let ch = i32(s.q.x);
  if (ch < 3) {
    // (this paint over the others: as it covers them they go; its own coverage only grows)
    nv[ch] = max(o[ch], cov);
    nv.a = fract(s.q.z / 256.0);
  }
  textureStore(paintGrid, v, vec4u(pack4x8unorm(nv), 0u, 0u, 0u));
  textureStore(paintOut, v, nv);
}
