// The sprite clouds' decks (skyclouds.ts fills SC.L; Boulder's cloudlayer.wgsl): up to eight slabs — a sky's low, mid,
// high and wave decks, and while one sky eases into another the old sky's four fading out — each between two shells
// round the earth, its density a few taps of the baked noise (skyclouds_noise.wgsl: g its cells, r the billows, b the
// detail, a the fibres) in its own wind's frame, drifting with it. Shared by the puffs (skyclouds.wgsl: a heap under a
// deck gets the light through it), the decks' composite (fsLayers) and the shadow (fsLayersShadow). Two looks:
//   Boulder's   an even partial cover breaking into cells, fibres bent into mares' tails, a chinook arch's clean edge
//   patches     the Highland's: stretches of cloud with open sky between, each texel's corners eased (seen overhead from
//               the glen a texel of the noise is a couple of pixels, and plain bilinear stairsteps a cell's edge)

const EARTH_M = 6371000.0;
const MAX_LAYERS = 8;

fn layerOn(k: i32) -> bool { let l = SC.L[k]; return l.e.w > 0.5 && l.a.z > 0.001 && l.a.w > 0.0; }

// u along the layer's wind, v across it
fn layerFrame(k: i32, xz: vec2f) -> vec2f {
  let w = SC.L[k].e.xy;
  return vec2f(dot(xz, w), w.x * xz.y - w.y * xz.x);
}

// a tap of the noise with its texels' corners smoothed (the uv eased within each texel of the mip the footprint picks)
fn deckTap(q: vec2f, dx: vec2f, dy: vec2f) -> vec4f {
  let lod = max(log2(max(length(dx), length(dy)) * 512.0), 0.0);
  let n = 512.0 / exp2(floor(lod));
  let p = q * n + 0.5;
  let i = floor(p);
  let f = p - i;
  return textureSampleGrad(cloudNoise, samp_repeat, (i + f * f * (3.0 - 2.0 * f) - 0.5) / n, dx, dy);
}

// a layer's density (0 clear .. ~1.8 its thickest) over a world point's xz, with the pixel's footprint on it as two axes
// (m, world xz: seen toward the horizon it's many times longer along the view than across, and the sampler's anisotropic
// filtering keeps the cells there from aliasing into streaks without blurring them across)
fn layerDensityG(k: i32, xz: vec2f, gx: vec2f, gy: vec2f, fine: bool) -> f32 {
  let l = SC.L[k];
  let tile = l.b.x;
  let q = (layerFrame(k, xz) - l.c.xy) / tile + vec2f(l.d.y, l.d.y * 0.61);
  // (the wind's frame is a rotation: the footprint turns with it)
  let dx = layerFrame(k, gx) / tile;
  let dy = layerFrame(k, gy) / tile;
  let patches = l.d.w > 0.5;
  var n: vec4f;
  if (patches) { n = deckTap(q, dx, dy); } else { n = textureSampleGrad(cloudNoise, samp_repeat, q, dx, dy); }
  // (patches: a slow field breaks a partial cover into stretches of cloud and open sky)
  let big = textureSampleGrad(cloudNoise, samp_repeat, q * 0.23 + vec2f(0.5, 0.17), dx * 0.23, dy * 0.23).r;
  var s = mix(n.r, n.g, l.b.y);
  if (l.b.z > 0.0) {
    let fs = vec2f(0.55, 3.4);
    if (patches) {
      // (a little streaking along the wind: the rows of a mackerel sky)
      let qf = vec2f(q.x * 0.55, q.y * 3.4 + (n.r - 0.5) * 0.16);
      let f1 = textureSampleGrad(cloudNoise, samp_repeat, qf + vec2f(0.21, 0.6), dx * fs, dy * fs).a;
      s = mix(s, smoothstep(0.3, 0.8, n.r) * (0.5 + big) * f1 * 1.2, l.b.z);
    } else {
      // fibres: long fine streaks along the wind, bent by the billows (the hooks of mares' tails), gathered into the
      // billows' patches
      let qf = vec2f(q.x * 0.55, q.y * 3.4 + (n.r - 0.5) * 0.16 + (n.b - 0.5) * 0.05);
      let f1 = textureSampleGrad(cloudNoise, samp_repeat, qf + vec2f(0.21, 0.6), dx * fs, dy * fs).a;
      let fs2 = fs * vec2f(1.7, 2.3);
      let f2 = textureSampleGrad(cloudNoise, samp_repeat, qf * vec2f(1.7, 2.3) + vec2f(0.63, 0.12), dx * fs2, dy * fs2).a;
      let clump = smoothstep(0.3, 0.8, n.r) * (0.5 + big);
      s = mix(s, clump * (f1 * 0.85 + f2 * 0.35) * 1.1, l.b.z);
    }
  }
  if (fine) {
    let dn = textureSampleGrad(cloudNoise, samp_repeat, q * 5.3 + vec2f(0.31, 0.77), dx * 5.3, dy * 5.3).b;
    s += (dn - 0.5) * select(mix(0.32, 0.12, l.b.z), 0.3, patches);
  }
  // (a full cover leaves no holes; a partial one comes and goes with the patches — the Highland's wider apart)
  var cov = mix(l.a.z * select(0.4 + 1.2 * big, 0.1 + 2.2 * big * big, patches), l.a.z, smoothstep(0.85, 1.0, l.a.z));
  // the chinook arch: the deck only downwind of its edge (fixed over the ground, across the wind), the clear slot upwind
  if (l.c.w > 0.0) { cov *= smoothstep(l.c.z - l.c.w, l.c.z + l.c.w, dot(xz, l.e.xy) + (big - 0.5) * l.c.w * 2.0); }
  let th = 1.0 - cov * 1.1;
  // (a soft edge to each cell: a hard threshold stairsteps the noise's texels)
  let d = smoothstep(th, th + mix(select(0.3, 0.42, patches), 0.6, l.b.z), s);
  // (cells thick in the middle, thin at their edges)
  return d * mix(0.55 + 0.9 * saturate(s), 0.12 + 1.7 * saturate(s) * saturate(s), l.b.y * 0.85);
}
fn layerDensity(k: i32, xz: vec2f, lod: f32, fine: bool) -> f32 {
  let f = SC.L[k].b.x * exp2(lod) / 512.0;
  return layerDensityG(k, xz, vec2f(f, 0.0), vec2f(0.0, f), fine);
}

// a ray from the camera through the shell at height h (m): the distance to the first crossing and the second (-1: none).
// The earth curved round the camera (its centre straight below it), so a deck sinks to the horizon.
fn shellHits(ro: vec3f, rd: vec3f, h: f32) -> vec2f {
  let r0 = EARTH_M + ro.y;
  let r = EARTH_M + h;
  let b = r0 * rd.y;
  // (c factored: no cancellation between two numbers the size of the earth)
  let c = (ro.y - h) * (r0 + r);
  let disc = b * b - c;
  if (disc < 0.0) { return vec2f(-1.0); }
  let s = sqrt(disc);
  let q = -(b + select(-s, s, b >= 0.0));
  var t0 = q;
  var t1 = c / q;
  if (t0 > t1) { let t = t0; t0 = t1; t1 = t; }
  return vec2f(t0, t1);
}

// the key light through every deck above a point but `skip`: x what comes straight through, y all that comes through,
// scattered or not (two-stream) — the light a heap's top, or a lower deck's, gets under a veil
fn decksOver(p: vec3f, skip: i32) -> vec2f {
  let L = world.lightDir;
  if (L.y <= 0.02) { return vec2f(1.0); }
  let mu = max(L.y, 0.05);
  var t = vec2f(1.0);
  for (var k = 0; k < MAX_LAYERS; k++) {
    if (k == skip || !layerOn(k)) { continue; }
    let l = SC.L[k];
    let mid = l.a.x + l.a.y * 0.5;
    if (p.y >= mid) { continue; }
    let q = p + L * ((mid - p.y) / L.y);
    let tau = layerDensity(k, q.xz, 5.0, false) * l.a.w;
    t *= vec2f(exp(-0.28 * tau / mu), 1.0 / (1.0 + 0.113 * tau));
  }
  return t;
}
