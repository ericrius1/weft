// The sprite clouds' noise (skyclouds.ts; Boulder's cloudnoise.wgsl), baked once into a tiling 512x512 texture so the
// sprites, the decks and their shadows sample it instead of summing octaves per pixel:
//   r  billows: gradient-noise fbm (6 octaves), contrast-stretched so its values spread over 0..1
//   g  cells: inverted Worley fbm (3 octaves): heaps with gaps between (stratocumulus, altocumulus)
//   b  detail: a finer fbm for eroding edges
//   a  fibres: fbm stretched 8:1 along u (cirrus streaks along the wind, virga, the lenses' laminar faces)
// Every lattice wraps at the texture's edge, so the tiles meet without seams.
@group(2) @binding(0) var noiseOut: texture_storage_2d<rgba8unorm, write>;

const SIZE = 512u;

fn h2(p: vec2u) -> f32 {
  var x = p.x * 1664525u + p.y * 1013904223u + 374761393u;
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return f32(x) / 4294967296.0;
}
fn wrapCell(i: vec2i, period: vec2i) -> vec2u { return vec2u(((i % period) + period) % period); }

// gradient noise on a lattice of `period` cells over the tile (uv 0..1)
fn gnoise(uv: vec2f, period: vec2i, salt: u32) -> f32 {
  let p = uv * vec2f(period);
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var s = array<f32, 4>();
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1u);
    let c = wrapCell(i + o, period);
    let a = h2(c + vec2u(salt * 131u, salt * 71u)) * 6.2831853;
    s[k] = dot(vec2f(cos(a), sin(a)), f - vec2f(o));
  }
  return mix(mix(s[0], s[1], u.x), mix(s[2], s[3], u.x), u.y) * 0.7071 + 0.5;
}

fn fbm(uv: vec2f, period: vec2i, octaves: i32, salt: u32) -> f32 {
  var a = 0.5; var s = 0.0; var w = 0.0; var per = period;
  for (var o = 0; o < octaves; o++) {
    s += a * gnoise(uv, per, salt + u32(o));
    w += a; a *= 0.5; per *= 2;
  }
  return s / w;
}

// 1 - the distance to the nearest feature point (one per cell)
fn worley(uv: vec2f, period: i32, salt: u32) -> f32 {
  let p = uv * f32(period);
  let i = vec2i(floor(p));
  let f = fract(p);
  var d = 1e9;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2i(x, y);
      let c = wrapCell(i + o, vec2i(period));
      let fp = vec2f(h2(c + vec2u(salt * 31u, 7u)), h2(c + vec2u(11u, salt * 17u)));
      d = min(d, length(vec2f(o) + fp - f));
    }
  }
  return 1.0 - saturate(d);
}

@compute @workgroup_size(8, 8) fn bake(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(SIZE))) { return; }
  let uv = (vec2f(id.xy) + 0.5) / f32(SIZE);
  let billow = fbm(uv, vec2i(4), 6, 1u);
  let cells = worley(uv, 6, 3u) * 0.6 + worley(uv, 12, 5u) * 0.28 + worley(uv, 24, 9u) * 0.12;
  let detail = fbm(uv, vec2i(16), 4, 21u);
  // (the fibres: a stretched lattice, warped a little by the billows so they bend)
  let warp = vec2f(0.0, (billow - 0.5) * 0.06);
  let fibre = fbm(uv + warp, vec2i(2, 16), 5, 41u);
  let stretch = vec4f(
    smoothstep(0.28, 0.72, billow),
    smoothstep(0.3, 0.85, cells),
    smoothstep(0.25, 0.75, detail),
    smoothstep(0.3, 0.7, fibre));
  textureStore(noiseOut, id.xy, stretch);
}
