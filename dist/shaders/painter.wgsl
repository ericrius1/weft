// weft 2D: every shape is one instance of a quad, coloured by its signed distance function. Rects (rounded),
// circles, rings, capsule lines, sprites and glyphs from one atlas, with optional glow halos; additive or normal
// blending per primitive in one draw (premultiplied alpha: an additive primitive just writes alpha 0).

struct Prim {
  pos: vec2f,     // centre (virtual pixels, y down)
  half: vec2f,    // half extents
  color: vec4f,   // linear rgb (may exceed 1 for glow), a = opacity
  uv: vec4f,      // atlas rect (u0 v0 u1 v1) for sprites / glyphs
  rot: f32,       // radians
  param: f32,     // corner radius · ring thickness · line radius
  soft: f32,      // glow halo radius (0 = crisp)
  kind: u32,      // low byte: 0 rect 1 circle 2 ring 3 line 4 sprite 5 glyph; bit 8: additive
}

struct PainterView {
  size: vec2f,    // virtual resolution
  offset: vec2f,  // camera offset (virtual px)
  zoom: f32,
  pixel: f32,     // 1 = snap glyph/sprite edges to virtual pixels
  pad: vec2f,
}

@group(3) @binding(0) var<uniform> pv: PainterView;
@group(3) @binding(1) var<storage, read> prims: array<Prim>;
@group(3) @binding(2) var atlas: texture_2d<f32>;
@group(3) @binding(3) var atlasSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) id: u32,
  @location(2) uv: vec2f,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let p = prims[ii];
  let c = corners[vi];
  let kind = p.kind & 255u;
  // room for anti-aliasing and the glow halo outside the shape itself
  let margin = select(1.5 + p.soft, 0.0, kind >= 4u);
  let ext = p.half + vec2f(margin);
  let local = c * ext;
  let cs = cos(p.rot);
  let sn = sin(p.rot);
  let world = p.pos + vec2f(local.x * cs - local.y * sn, local.x * sn + local.y * cs);
  let v = (world - pv.offset) * pv.zoom;
  var o: VOut;
  o.pos = vec4f(v.x / pv.size.x * 2.0 - 1.0, 1.0 - v.y / pv.size.y * 2.0, 0.0, 1.0);
  o.local = local;
  o.id = ii;
  o.uv = mix(p.uv.xy, p.uv.zw, c * 0.5 + 0.5);
  return o;
}

fn sdRoundRect(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let p = prims[i.id];
  let kind = p.kind & 255u;
  let additive = (p.kind & 256u) != 0u;
  // every distance is computed and selected (no branches), so fwidth runs in uniform control flow
  let dRect = sdRoundRect(i.local, p.half, min(p.param, min(p.half.x, p.half.y)));
  let dCircle = length(i.local) - p.half.x;
  let dRing = abs(length(i.local) - p.half.x + p.param * 0.5) - p.param * 0.5;
  let q = vec2f(max(abs(i.local.x) - (p.half.x - p.param), 0.0), i.local.y);
  let dLine = length(q) - p.param;
  var d = dRect;
  d = select(d, dCircle, kind == 1u);
  d = select(d, dRing, kind == 2u);
  d = select(d, dLine, kind == 3u);
  let w = max(fwidth(d), 1e-4);
  let t = textureSampleLevel(atlas, atlasSamp, i.uv, 0.0);
  var a = clamp(0.5 - d / w, 0.0, 1.0);
  let halo = select(0.0, exp(-max(d, 0.0) * 2.5 / max(p.soft, 1e-3)) * 0.55, p.soft > 0.0);
  a = max(a, halo);
  var rgb = p.color.rgb;
  if (kind == 4u) { rgb = rgb * t.rgb; a = t.a; }
  if (kind == 5u) { a = t.a; }
  a *= p.color.a;
  if (a <= 0.001) { discard; }
  return vec4f(rgb * a, select(a, 0.0, additive));
}
