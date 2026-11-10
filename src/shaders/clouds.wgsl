// Volumetric clouds, second generation (src/render/clouds.ts drives it; the design in docs/research/clouds.md).
//
// Shape (after Schneider's Nubis): a weather map that evolves and drifts — coverage, cloud type (stratus → cumulus →
// cumulonimbus), base height, storminess — over a pre-combined Perlin-Worley shape volume, cut by a per-type height
// profile, eroded by curl-distorted Worley detail (wispy underneath, billowy on top). Holes torn by things flying
// through (a wake map: tunnels that heal), lightning relighting a storm cell from inside.
// Light: a light volume (optical depth toward the key light and straight up, baked a slice band a frame) plus two short
// taps for the billows' own shading; the key light's colour at each altitude (gold tops over reddening bases at dusk);
// Wrenninge's multiple-scattering octaves over a dual-lobe phase, an HG + Draine droplet lobe on the first (the silver
// lining); the sky's ambient, occluded by the cloud above; Hillaire's energy-conserving integration.
// Stability: two layers. Near (out to a split that grows with flight speed): every march texel every frame, steps fixed
// along the ray in world space, short history. Far: a quarter of the half-res pixels a frame (a 4-frame cycle) on a
// deterministic step lattice, a long history. Both accumulate by sample count, reproject by their own depth (the
// confidence falls with the depth spread × the camera's motion), clip in tonemapped YCoCg; the noise is pre-filtered by
// how far a sample's point moves between updates. Lightning is added in the composite (no lag, no checker).
#include "./env"
#include "weft/fullscreen"

struct CloudU {
  shape: vec4f,    // x coverage bias, y extinction at density 1 (1/m), z erosion, w curl distortion
  layer: vec4f,    // x base (world y), y base range (m), z stratus thickness (m), w cumulus thickness (m)
  drift: vec4f,    // xy drift (m), z evolution clock, w time (s)
  wwin: vec4f,     // weather map window (drifted coordinates): origin xz, size (m), texels
  light: vec4f,    // x multiple scattering (octave attenuation), y ambient, z powder, w silver lining
  march: vec4f,    // x far steps, y light cone reach (m, past the light volume), z far near-step (m), w max distance (m)
  misc: vec4f,     // x frame, y reset (1: no history), z inside-cloud wisps, w march phase (0..3; 4: every pixel)
  smap: vec4f,     // the shadow map: origin xz, size (m), texels
  vel: vec4f,      // camera velocity (m/s), w storminess bias
  bake: vec4f,     // x the shadow map's first row this frame, y rows, z the weather's first row, w rows
  wake: vec4f,     // the wake map: size (m, toroidal), texels, heal rate (1/s), stamps this frame
  flash: vec4f,    // lightning: position, intensity
  front: vec4f,    // a weather front: xz direction, position along it (m), width (m)
  stamps: array<vec4f, 16>,   // wake stamps: pairs of (a.xyz, radius), (b.xyz, strength)
  lvol: vec4f,     // the light volume: x size across (m, toroidal round the camera), y texels across, z texels up, w first slice this frame
  lvol2: vec4f,    // x slices this frame, y the fine taps' reach (m), z ambient occlusion strength, w the octaves' energy
  layers: vec4f,   // x the near/far split (m), y near step (m), z near steps, w far α floor
  layers2: vec4f,  // x near α floor, y far sample-count cap, z near cap, w the camera's travel this frame (m)
  debug: vec4f,    // x: 1 no shadow map, 2 no taps, 3 no erosion, 4 no light volume; y: 1 the layer alone; z: 1 reference; w: 1 no light
  weather2: vec4f, // x cloud type bias (-1 sheets .. 1 heaps), y coverage over the sea (× land's), z front lead (m), w deep light (diffusion)
  cellInfo: vec4f, // storm cells: x count, y a full-strength tower's top (world y), zw the shear (downwind, unit)
  cells: array<vec4f, 8>,   // storm cells (cumulonimbus): centre xz (drifted coordinates), radius (m), strength 0..1
  boxes: array<vec4f, 8>,   // each cell's light box: centre xz (world), half its width (m), w 1 when it's in use
  towerBake: vec4f,         // the boxes' bake this frame: x first slice, y slices
  style: vec4f,             // the painted look (0: off): x on, y the brightness that's "lit", z band softness, w edge
  pal: array<vec4f, 3>,     // its palette: shade, middle, lit
}
@group(2) @binding(0) var<uniform> C: CloudU;
@group(2) @binding(1) var cBase: texture_3d<f32>;      // the shape, pre-combined (r32float)
@group(2) @binding(2) var cDetail: texture_3d<f32>;    // r erosion fbm, g wisp fbm, a blue noise (2D, every slice)
@group(2) @binding(3) var cWeather: texture_2d<f32>;
@group(2) @binding(4) var cGround: texture_2d<f32>;    // the ground under the clouds (bakeGround): x height, y smoothed
@group(2) @binding(5) var sceneDepth: texture_depth_2d;
// the march (quarter or half res): the far layer, its depth (z̄, σ_z, the scene's distance); the near layer, its depth
@group(2) @binding(6) var farOut: texture_storage_2d<rgba16float, write>;
@group(2) @binding(7) var farZOut: texture_storage_2d<rgba32float, write>;
@group(2) @binding(8) var nearOut: texture_storage_2d<rgba16float, write>;
@group(2) @binding(9) var nearZOut: texture_storage_2d<rg32float, write>;
// the resolves read a layer and its depth, the history and its meta (z̄, σ_z, scene distance, sample count)
@group(2) @binding(10) var inLT: texture_2d<f32>;
@group(2) @binding(11) var inZ: texture_2d<f32>;
@group(2) @binding(12) var histLT: texture_2d<f32>;
@group(2) @binding(13) var histM: texture_2d<f32>;
@group(2) @binding(14) var outLT: texture_storage_2d<rgba16float, write>;
@group(2) @binding(15) var outM: texture_storage_2d<rgba32float, write>;
// the composite reads both layers and their meta
@group(2) @binding(16) var farLT: texture_2d<f32>;
@group(2) @binding(17) var farM: texture_2d<f32>;
@group(2) @binding(18) var nearLT: texture_2d<f32>;
@group(2) @binding(19) var nearM: texture_2d<f32>;
// bakes
@group(2) @binding(20) var smapOut: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(21) var weatherOut: texture_storage_2d<rgba16float, write>;
@group(2) @binding(22) var groundOut: texture_storage_2d<rgba16float, write>;
@group(2) @binding(23) var heightIn: texture_2d<f32>;
@group(2) @binding(24) var cLight: texture_3d<f32>;     // the light volume: x optical depth toward the key light, y straight up
@group(2) @binding(25) var lightOut: texture_storage_3d<rgba16float, write>;
@group(2) @binding(26) var cWake: texture_2d<f32>;
@group(2) @binding(27) var wakeOut: texture_storage_2d<rgba32float, write>;
@group(2) @binding(28) var<storage, read_write> probeOut: array<vec4f>;
// the storm towers' light: a box a cell (TW_N × TW_NY × TW_N, one after another), x optical depth toward the key light,
// y straight up. (A buffer, not a texture: the march is at the GPU's 16 sampled textures a stage already — the shared
// environment's ten and its own six — so it's filtered by hand)
@group(2) @binding(29) var<storage, read> cTower: array<vec2f>;
@group(2) @binding(30) var<storage, read_write> towerOut: array<vec2f>;
fn twIdx(ci: u32, x: u32, y: u32, z: u32) -> u32 { return ((ci * u32(TW_N) + z) * u32(TW_NY) + y) * u32(TW_N) + x; }
/** a box texel's transmittances (toward the light, straight up) */
fn twT(ci: u32, x: u32, y: u32, z: u32) -> vec2f { return exp(-cTower[twIdx(ci, x, y, z)]); }
const TW_N: f32 = 48.0;
const TW_NY: f32 = 64.0;
/** the boxes span from a little under the ordinary layer's top up to the towers' */
const TW_Y0: f32 = 2000.0;

const CL_Y0: f32 = 180.0;      // the slab the clouds live in (world y; its top: CLOUD_TOP — the storm towers' tops)
const CL_Y1: f32 = CLOUD_TOP;
const CL_LAYER: f32 = 2600.0;  // the top of the ordinary layer (cumulus, sheets): the light volume covers up to here
const CL_EARTH: f32 = 6.371e6;
const CL_TILE: f32 = 2200.0;   // m per tile of the shape volume
const CL_DTILE: f32 = 190.0;   // the erosion volume
const CL_NTILE: f32 = 24.0;    // and again, much finer: the wisps streaming past inside a cloud
const CL_CURL: f32 = 900.0;    // the curl field's tile

// ---------------------------------------------------------------- helpers
fn clWeather(xz: vec2f) -> vec4f {
  return textureSampleLevel(cWeather, samp_linear, (xz - C.drift.xy - C.wwin.xy) / C.wwin.z, 0.0);
}
fn clGround(xz: vec2f) -> vec2f {
  let uv = xz / (2.0 * world.worldHalf) + 0.5;
  if (any(uv <= vec2f(0.0)) || any(uv >= vec2f(1.0))) { return vec2f(-1e4); }
  return textureSampleLevel(cGround, samp_linear, uv, 0.0).xy;
}
// (how wide a stretch of the field a sample stands for: the noise is read at that mip — the pixel's footprint, or how
// far the sample's point moves between its updates, whichever is wider: fast flight pre-filters the wisps)
var<private> clFoot: f32 = 0.0;
fn clLod(texel: f32) -> f32 { return log2(max(clFoot / texel, 1.0)); }

/** a tileable 2D curl (of a potential made of sines at integer frequencies: it tiles, and it's cheap), ~-1..1 */
fn clCurl(p: vec2f) -> vec2f {
  let a = TAU * (p.x * 2.0 + 0.31); let b = TAU * (p.y * 3.0 + 0.17);
  let c = TAU * (p.x * 5.0 + p.y * 3.0 + 0.6);
  let d = TAU * (p.x * 4.0 - p.y * 7.0 + 0.2);
  let e = TAU * (p.y * 9.0 + p.x * 6.0 + 0.9);
  let gx = TAU * (2.0 * cos(a) * cos(b) * 0.5 + 5.0 * cos(c) * 0.25 - 4.0 * sin(d) * 0.18 + 6.0 * cos(e) * 0.1);
  let gy = TAU * (-3.0 * sin(a) * sin(b) * 0.5 + 3.0 * cos(c) * 0.25 + 7.0 * sin(d) * 0.18 + 9.0 * cos(e) * 0.1);
  return clamp(vec2f(gy, -gx) / 40.0, vec2f(-1.0), vec2f(1.0));
}

/** the wake map at p: how much of the cloud has been torn away there (tunnels left by things flying through) */
fn clWake(p: vec3f) -> f32 {
  if (C.wake.y < 1.0) { return 0.0; }
  let n = i32(C.wake.y);
  let uv = fract(p.xz / C.wake.x);
  let q = vec2i(uv * C.wake.y) % vec2i(n);
  let w = textureLoad(cWake, q, 0);
  // (x strength, y the tunnel's height, z its radius; w the stamp's world x / 64 to reject the toroidal wrap)
  if (w.x <= 0.002 || abs(w.w * 64.0 - p.x) > C.wake.x * 0.25) { return 0.0; }
  let dy = abs(p.y - w.y) / max(w.z, 1.0);
  return w.x * (1.0 - smoothstep(0.55, 1.0, dy));
}

/** a point in a storm cell's light box (its tower and anvil, baked by bakeTowers): its optical depth toward the key
 *  light (x) and straight up (y); z 1 when there's a box there */
fn clTowerBox(q: vec3f) -> vec3f {
  let n = i32(C.cellInfo.x);
  if (n == 0 || q.y < TW_Y0 || q.y > CL_Y1) { return vec3f(0.0); }
  let v = (q.y - TW_Y0) / (CL_Y1 - TW_Y0);
  for (var i = 0; i < n; i++) {
    let b = C.boxes[i];
    if (b.w < 0.5) { continue; }
    let rel = (q.xz - b.xy) / (2.0 * b.z) + 0.5;
    if (any(rel < vec2f(0.0)) || any(rel > vec2f(1.0))) { continue; }
    // (trilinear, by hand — on the transmittance, not the optical depth: a texel is ~300 m, so at a sunlit face it
    // straddles the open air (τ ≈ 0) and the tower's depths (τ in the hundreds); blending τ would black every sunlit face
    // out, blending e^-τ gives the light the texel's stretch of face actually gets)
    let f = clamp(vec3f(rel.x * TW_N, v * TW_NY, rel.y * TW_N) - 0.5, vec3f(0.0), vec3f(TW_N - 1.0, TW_NY - 1.0, TW_N - 1.0));
    let a = vec3u(floor(f));
    let o = vec3u(min(a + 1u, vec3u(u32(TW_N) - 1u, u32(TW_NY) - 1u, u32(TW_N) - 1u)));
    let w = fract(f);
    let ci = u32(i);
    let c00 = mix(twT(ci, a.x, a.y, a.z), twT(ci, o.x, a.y, a.z), w.x);
    let c10 = mix(twT(ci, a.x, o.y, a.z), twT(ci, o.x, o.y, a.z), w.x);
    let c01 = mix(twT(ci, a.x, a.y, o.z), twT(ci, o.x, a.y, o.z), w.x);
    let c11 = mix(twT(ci, a.x, o.y, o.z), twT(ci, o.x, o.y, o.z), w.x);
    let t = mix(mix(c00, c10, w.y), mix(c01, c11, w.y), w.z);
    return vec3f(-log(max(t, vec2f(1e-9))), 1.0);
  }
  return vec3f(0.0);
}

// ---------------------------------------------------------------- the density field
/** the height profile of a cloud type at h (0 base .. 1 top): stratus a thin flat sheet, stratocumulus a lumpy layer,
 *  cumulus rounded underneath and tapering, cumulonimbus spreading into an anvil */
fn clProfile(h: f32, kind: f32, storm: f32) -> f32 {
  // (sheets fill most of their thickness, flat-topped; cumulus sit on one condensation level — a crisp base — and taper)
  let strat = smoothstep(0.0, 0.06, h) * (1.0 - smoothstep(0.6, 0.9, h));
  let sc = smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(0.5, 0.95, h));
  let cu = smoothstep(0.0, 0.03, h) * (1.0 - smoothstep(0.25, 1.0, h));
  return mix(mix(strat, sc, sat(kind * 2.0)), cu, sat(kind * 2.0 - 1.0));
}

/** the storm cells at p: cumulonimbus — a broad column from the layer's base up to the tower's top, flattening and
 *  spreading downwind into an anvil. x the coverage they give, y their storminess, z h within the tower (0..1) */
fn clCells(p: vec3f, base: f32) -> vec4f {
  var o = vec4f(0.0);
  let n = i32(C.cellInfo.x);
  if (n == 0 || p.y <= base) { return o; }
  let u = p.xz - C.drift.xy;
  for (var i = 0; i < n; i++) {
    let c = C.cells[i];
    if (c.w <= 0.01) { continue; }
    let top = mix(CL_LAYER, C.cellInfo.y, c.w);
    let h = (p.y - base) / max(top - base, 1.0);
    if (h <= 0.0 || h >= 1.0) { continue; }
    // (most samples are nowhere near a tower: a bounding circle first — the column's below the anvil, which spreads
    // and drifts downwind only up top)
    let du = u - c.xy;
    let mature = smoothstep(0.4, 0.8, c.w);
    let br = c.z * select(0.9, 3.8, h > 0.55 && mature > 0.0);
    if (dot(du, du) > br * br) { continue; }
    // the anvil's spread and drift downwind above two-thirds of the way up (a mature tower's)
    let ak = smoothstep(0.66, 0.86, h) * mature;
    let ctr = c.xy + C.cellInfo.zw * c.z * 1.3 * smoothstep(0.55, 1.0, h);
    let d = distance(u, ctr);
    let rCol = c.z * mix(0.9, 0.72, smoothstep(0.08, 0.5, h));
    let r = mix(rCol, c.z * 2.4, ak);
    if (d > r) { continue; }
    // (the coverage falls off over most of the radius — the shape noise carves the billows there; the anvil's top is
    // flat, its underside thinning out toward the edge)
    let edge = smoothstep(r, r * mix(0.55, 0.7, ak), d);
    let vert = smoothstep(0.0, 0.02, h) * (1.0 - smoothstep(0.93, 1.0, h)) * mix(1.0, smoothstep(0.62, 0.8, h + (1.0 - edge) * 0.2), ak * step(c.z * 1.05, d));
    // (cover over 1 in the core: solid, no holes — the turrets only on the rim; w: how much of this is anvil)
    let k = c.w * 1.3 * edge * vert;
    if (k > o.x) { o = vec4f(k, c.w, h, ak); }
  }
  return o;
}

struct ClSample { d: f32, h: f32, wisp: f32, storm: f32 }
// (the cost bench: density evaluations and shaded steps along this pixel's rays)
var<private> clEvals: f32 = 0.0;
var<private> clShaded: f32 = 0.0;
/** the density at p. detail 1: eroded by the detail noise (and, near > 0, the wisps that stream past inside a cloud);
 *  -1: the erosion's mean, without the fetch (the light's estimates); 0: the shape alone (the empty-space test) */
fn clDensity(p: vec3f, detail: f32, near: f32) -> ClSample {
  var s: ClSample;
  s.d = 0.0; s.h = 0.0; s.wisp = 1.0; s.storm = 0.0;
  if (p.y < CL_Y0 - 40.0 || p.y > CL_Y1) { return s; }
  clEvals += 1.0;
  let w = clWeather(p.xz);
  let cell = clCells(p, w.z);
  let cover = w.x;
  if (cover < 0.01 && cell.x <= 0.0) { return s; }
  var storm = w.w;
  let kind = w.y;
  let base = w.z;
  // the ordinary layer: its type's thickness and profile
  let thick = mix(C.layer.z, C.layer.w, kind * kind) * mix(1.0, 2.2, storm);
  // (each column its own top: where the weather holds more cloud it stands taller — a dense deck domes up toward its
  // middle and slopes down to its edges; with one top everywhere it would end flat, walled like a mesa)
  let top = min(base + thick * mix(0.4, 1.05, smoothstep(0.2, 0.9, cover)), CL_LAYER);
  var h = (p.y - base) / max(top - base, 1.0);
  var cp = 0.0;
  if (h > 0.0 && h < 1.0) { cp = cover * clProfile(h, kind, storm); }
  // a storm cell's tower where it stands taller
  if (cell.x > cp) { cp = cell.x; h = cell.z; storm = max(storm, cell.y); }
  if (cp < 0.01 || h <= 0.0 || h >= 1.0) { return s; }
  s.h = h; s.storm = storm;
  // the shape (pre-combined: one fetch) cut by coverage × the profile — crisp at any coverage (cp over 1: no holes);
  // squashed vertically — heaps, not columns; denser higher up (liquid water grows with height above the base)
  let q = p + vec3f(C.drift.z * 0.25, C.drift.z * 0.6, -C.drift.z * 0.15);
  // (stormier: bigger elements — congestus and towers are kilometres across, fair-weather cumulus hundreds of metres)
  let tile = CL_TILE * mix(1.0, 1.4, smoothstep(0.3, 0.9, storm));
  let shape0 = textureSampleLevel(cBase, samp_repeat, q * vec3f(1.0, 1.7, 1.0) / tile, clLod(tile / 128.0)).r;
  // (the anvil: ice, smooth — its noise only ruffles it)
  let shape = mix(shape0, 0.6 + 0.4 * shape0, cell.w);
  var d = sat(remap(shape, 1.0 - cp, 1.0, 0.0, 1.0));
  // (thin cover makes thin, small cloud: the shape noise's top is a plateau, and without this fade those voxels would
  // stay full-density right up to where the cover runs out — a sheet with a cut face, curtains, mesas)
  d *= smoothstep(0.0, 0.12, cp);
  d *= mix(0.45, 1.0, smoothstep(0.0, 0.5, h)) * mix(0.6, 1.0, sat(cover + cell.x));
  if (d <= 0.0) { return s; }
  // (no puffs floating free: higher up, a column needs cloud at its base — the footprint, as Nubis has it)
  if (detail > 0.0 && h > 0.2 && cell.x <= 0.0) {
    let qb = vec3f(q.x, q.y - (p.y - base) + 0.1 * (top - base), q.z);
    let fb = textureSampleLevel(cBase, samp_repeat, qb * vec3f(1.0, 1.7, 1.0) / tile, clLod(tile / 128.0) + 1.0).r;
    d *= smoothstep(1.0 - cover - 0.05, 1.0 - cover + 0.1, fb);
    if (d <= 0.0) { return s; }
  }
  if (detail < 0.0) {
    d = sat(remap(d, 0.5 * C.shape.z * (1.0 - 0.4 * storm), 1.0, 0.0, 1.0));
  } else if (detail > 0.0 && C.debug.x != 3.0) {
    // erosion by curl-distorted Worley detail: wispy at the very base (the noise as is), billowy above (inverted)
    let cv = clCurl(p.xz / CL_CURL);
    let qd = q + vec3f(cv.x, 0.0, cv.y) * C.shape.w * (1.0 - h) * 120.0;
    let hf = textureSampleLevel(cDetail, samp_repeat, qd / CL_DTILE + vec3f(0.0, C.drift.w * 0.0015, 0.0), clLod(CL_DTILE / 64.0)).r;
    // (sheets' undersides roll — billows, not a wispy fog)
    let er = mix(hf, 1.0 - hf, select(sat(h * 12.0), 1.0, kind < 0.5));
    d = sat(remap(d, er * C.shape.z * detail * (1.0 - 0.8 * cell.w), 1.0, 0.0, 1.0));
    if (near > 0.0 && d > 0.0) {
      // close to the eye inside a cloud: finer wisps and gaps (what streams past flying through)
      let nn = textureSampleLevel(cDetail, samp_repeat, qd / CL_NTILE, clLod(CL_NTILE / 64.0)).g;
      let k = smoothstep(0.25, 0.8, nn);
      d *= mix(1.0, 0.55 + 0.9 * k, near);
      s.wisp = mix(1.0, 0.7 + 0.6 * k, near);
    }
  }
  d *= 1.0 - clWake(p);
  // (a concave curve: density rises fast off zero — crisp edges rather than a cotton fringe; storm cells thicker)
  s.d = pow(max(d, 0.0), 0.7) * mix(1.0, 2.0, storm);
  return s;
}

// ---------------------------------------------------------------- light
/** the light volume's texture coordinates at p (toroidal across, the slab up), and whether p is inside it */
fn clVolUV(p: vec3f) -> vec4f {
  let half = C.lvol.x * 0.5 - C.lvol.x / C.lvol.y * 2.0;
  let inside = all(abs(p.xz - frame.camPos.xz) < vec2f(half)) && p.y < CL_LAYER;
  let v = (p.y - (CL_Y0 - 40.0)) / (CL_LAYER - CL_Y0 + 40.0);
  let nz = C.lvol.z;
  return vec4f(fract(p.x / C.lvol.x), clamp(v, 0.5 / nz, 1.0 - 0.5 / nz), fract(p.z / C.lvol.x), select(0.0, 1.0, inside));
}
/** toward the key light: x the optical depth (two short taps close by — the billows' own shading — then the light
 *  volume, or out past it a short cone of taps), y the mountains' visibility, z the optical depth straight up (the sky's
 *  light occluded by the cloud above) */
fn clLight(p: vec3f, L: vec3f, taps: i32, viewT: f32, t: f32) -> vec3f {
  let fine = C.lvol2.y;
  var tau = 0.0;
  if (C.debug.x != 2.0 && viewT > 0.3) {
    // the billows' own shading, where the eye can still see the surface (deeper in, what the volume holds is plenty).
    // The surface the eye sees is the eroded one: near enough to see it, the taps erode for real — otherwise a sunlit
    // face is shadowed by an uneroded shell that isn't there; further off, the erosion's mean
    let dl = select(-1.0, 1.0, t < 3000.0);
    let a = clDensity(p + L * fine * 0.18, select(-1.0, 1.0, t < 9000.0), 0.0).d;
    let b = clDensity(p + L * fine * 0.62, dl, 0.0).d;
    tau = (a * 0.4 + b * 0.6) * fine * C.shape.y;
  } else if (C.debug.x != 2.0) {
    // (deep in: the volume's τ starts a tap's length further on, so add that stretch's mean)
    tau = clDensity(p + L * fine * 0.5, -1.0, 0.0).d * fine * C.shape.y;
  }
  var up = 0.0;
  let q = p + L * fine;
  let uv = clVolUV(q);
  // (read at a jittered depth along the light, ±½ texel: the history averages the box's texel steps away)
  let tb = clTowerBox(q + L * (clJit - 0.5) * 310.0);
  if (tb.z > 0.5 && C.debug.x != 4.0) {
    // (a storm cell's own light box: its tower and anvil, from the same density the march sees — the anvil's underside
    // shaded by what's over it)
    tau += tb.x;
    up = tb.y;
  } else if (uv.w > 0.5 && C.debug.x != 4.0) {
    let v = textureSampleLevel(cLight, samp_repeat, uv.xyz, 0.0);
    tau += v.x;
    up = textureSampleLevel(cLight, samp_repeat, clVolUV(p).xyz, 0.0).y;
  } else {
    var prev = 0.0;
    var t2 = 0.0;
    for (var k = 0; k < taps; k++) {
      let f = (f32(k) + 0.5) / f32(taps);
      let dist = C.march.y * f * f;
      t2 += clDensity(q + L * dist, -1.0, 0.0).d * (dist - prev);
      prev = dist;
    }
    tau += t2 * C.shape.y;
  }
  var vis = 1.0;
  let Lc = cloudLightDir();
  let suv = (p.xz + Lc.xz / Lc.y * (world.cloudMap.w - p.y) - world.cloudMap.xy) / world.cloudMap.z;
  if (all(suv > vec2f(0.0)) && all(suv < vec2f(1.0)) && C.debug.x != 1.0) {
    let occ = textureSampleLevel(cloudShadowTex, samp_linear, suv, 0.0).w * 2000.0;
    vis = smoothstep(occ - 15.0, occ + 70.0, p.y);
  }
  return vec3f(tau, vis, up);
}
/** the key light at altitude y (env.wgsl keyAltAt) */
fn clKeyAt(y: f32) -> vec3f { return keyAltAt(y); }
/** water droplets' phase (Jendersie & d'Eon 2023: HG + Draine, droplets ~20 µm): the bright, narrow forward lobe that
 *  makes the silver lining and a hint of the fogbow */
fn clDraine(mu: f32, g: f32, a: f32) -> f32 {
  return (1.0 - g * g) * (1.0 + a * mu * mu) / (4.0 * PI * (1.0 + a * (1.0 + 2.0 * g * g) / 3.0) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
}
fn clMie(mu: f32) -> f32 { return mix(henyeyGreenstein(mu, 0.993), clDraine(mu, 0.594, 27.1), 0.498); }
fn clPhase(mu: f32, c: f32) -> f32 { return mix(henyeyGreenstein(mu, 0.8 * c), henyeyGreenstein(mu, -0.5 * c), 0.5); }
/** the key light scattered toward the eye: Wrenninge's octaves (each scatters again with less extinction, a softer
 *  phase); the first octave's phase partly the droplets' (the silver lining). x the first octave, y the rest, z what
 *  the in-cloud diffusion floor adds over them */
fn clScatter(tau: f32, mu: f32, storm: f32) -> vec3f {
  var s = vec2f(0.0);
  s.x = exp(-tau) * mix(clPhase(mu, 1.0), clMie(mu), 0.35 * C.light.w);
  // (four octaves, a = b = c ≈ ½: enough to light thin cloud through; deeper ones would only carry the sun's colour
  // into the shade — the form, the bluish shadow under a gold rim, would wash out)
  // (storm cloud's octaves start deeper — b ⅛, not ½: a dense column's sunlit face is bright by many scatterings,
  // which four octaves from ½ can't carry; the towers went grey. Only near a lit face, though: kilometres into an anvil
  // the light is gone whatever the scattering, and its underside is a dark lid)
  let deep = smoothstep(0.4, 0.9, storm) * (1.0 - smoothstep(25.0, 90.0, tau));
  var a = C.light.x; var b = mix(0.5, 0.125, deep); var c = 0.5;
  for (var k = 1; k < 4; k++) {
    s.y += a * exp(-tau * b) * clPhase(mu, c);
    a *= C.light.x; b *= 0.5; c *= 0.5;
  }
  // (the octaves return about half of what a thick, conservatively scattering cloud reflects: the rest)
  s.y *= C.lvol2.w;
  // inside a cloud, light diffuses rather than dies: a thick cloud passes on 1 / (1 + ¾(1−g)τ) of it (two-stream,
  // g ≈ 0.8) — the fog round the eye stays luminous grey, not dark. (Only there: seen from outside the same floor
  // would carry sunlight into every shadow — weather2.w is scaled by how far in the eye is)
  // (returned apart: only the floor is desaturated — the octaves keep the low sun's gold on the rims. And the diffuse
  // light's first moment: the fog brighter toward the light it flows from, not the same grey every way)
  let fl = max(C.weather2.w / (PI * (1.0 + 0.15 * tau)) * (1.0 + 0.6 * mu) - s.y, 0.0);
  return vec3f(s.x, s.y, fl);
}

// ---------------------------------------------------------------- shading one step
struct ClRay { L: vec3f, T: f32, zA: f32, zA2: f32, zW: f32 }
var<private> clL: vec3f = vec3f(0.0);
/** this pixel's march jitter (0..1; ½ where nothing marches) */
var<private> clJit: f32 = 0.5;
var<private> clMu: f32 = 0.0;
var<private> clAmbTop: vec3f = vec3f(0.0);
var<private> clAmbBot: vec3f = vec3f(0.0);
var<private> clAmbSide: vec3f = vec3f(0.0);
var<private> clAmbBack: vec3f = vec3f(0.0);
fn clShadeStep(r: ptr<function, ClRay>, p: vec3f, tm: f32, dt: f32, s: ClSample, taps: i32) {
  clShaded += 1.0;
  let sig = s.d * C.shape.y;
  var lt = vec3f(0.0, 1.0, 0.0);
  if (C.debug.w != 1.0) { lt = clLight(p, clL, taps, (*r).T, tm); }
  let E = select(clKeyAt(p.y), lighting.keyRad.rgb, C.debug.x == 5.0) * PI;
  // (droplets scatter neutrally: the octaves carry the sun's own colour — gold at golden hour)
  // (light that has scattered many times in the cloud has mixed with the sky's: less of the low sun's saturation than
  // the rims lit straight on — golden edges over neutral grey depths, not a cloud dyed through, or a tan fog inside)
  let Ew = mix(E, vec3f(dot(E, vec3f(0.2126, 0.7152, 0.0722))) * vec3f(0.96, 1.0, 1.06), 0.35);
  // (the deep octaves on a storm's column, not its anvil: from below, an anvil is a dark lid)
  let sc = clScatter(lt.x, clMu, s.storm * (1.0 - smoothstep(0.55, 0.7, s.h)));
  // powder: the edges facing away from the sun lose the light that would have been scattered into them
  let pw = mix(1.0, 1.0 - exp(-sig * 160.0), C.light.z * sat(0.6 - 0.6 * clMu));
  // the sky's light, occluded by the cloud above (dark storm bases), graded by height in the cloud
  // (low down the light off the ground and the sea; on the flanks the sky the face the eye sees is turned to — the
  // afterglow lights the clouds facing it; on top the sky overhead)
  // (only the overhead share of the sky's light sits behind the cloud above; the flanks see the sky they face, and the
  // bright sky beyond the cloud diffusing through it — ~¼, a thick cloud's two-stream transmission. Storm bases still
  // go dark: their flanks are occluded too — down in the layer; a tower's column above it looks out at the open sky
  // all round, whatever its anvil hides overhead)
  let aoUp = mix(0.08, 1.0, exp(-lt.z * C.lvol2.z));
  let flank = (clAmbSide + 0.25 * clAmbBack) * mix(1.0, aoUp, s.storm * (1.0 - smoothstep(CL_LAYER - 600.0, CL_LAYER, p.y)));
  // (high in a cloud with more cloud over it — an anvil's underside — the sky overhead is gone, but not the sky round
  // about: some of it reaches in from the sides)
  let over = clAmbTop * aoUp + flank * (1.0 - aoUp) * 0.35;
  var amb = mix(mix(clAmbBot, flank, smoothstep(0.0, 0.35, s.h)), over, smoothstep(0.35, 1.0, s.h)) * C.light.y;
  // (high up with cloud over it — an anvil's underside — what's below is the deck's sunlit tops, not the sea: it's lit
  // from below by them)
  let hiK = smoothstep(CL_LAYER - 800.0, CL_LAYER, p.y) * (1.0 - aoUp);
  if (hiK > 0.0) {
    let cov = sat(clWeather(p.xz).x);
    let deck = (clKeyAt(CL_LAYER) * max(clL.y, 0.0) + clAmbTop * 0.5) * 0.7 * cov + clAmbBot * (1.0 - cov);
    amb = mix(amb, deck * C.light.y, hiK * 0.1);
  }
  let S = sig * ((E * (sc.x + sc.y) + Ew * sc.z) * pw * lt.y + amb) * s.wisp;
  let ts = exp(-sig * dt);
  let a = (*r).T * (1.0 - ts);
  (*r).L += (*r).T * S * (1.0 - ts) / max(sig, 1e-6);
  (*r).zA += a * tm; (*r).zA2 += a * tm * tm; (*r).zW += a;
  (*r).T *= ts;
}

/** the slab's span along a ray: (t0, t1), empty when t1 <= t0 */
/** how high the slab reaches along a ray: the ordinary layer's top, or a storm tower's where the ray passes near one
 *  (a cylinder round each tower and its anvil) — rays that pass no tower don't march the empty sky above the layer */
fn clSlabTop(ro: vec3f, rd: vec3f) -> f32 {
  var top = CL_LAYER;
  let n = i32(C.cellInfo.x);
  for (var i = 0; i < n; i++) {
    let c = C.cells[i];
    if (c.w <= 0.01) { continue; }
    let ctop = mix(CL_LAYER, C.cellInfo.y, c.w);
    if (ctop <= top) { continue; }
    let o = ro.xz - (c.xy + C.drift.xy + C.cellInfo.zw * c.z * 0.65);
    let a = dot(rd.xz, rd.xz);
    var dmin = length(o);
    if (a > 1e-8) { dmin = length(o + rd.xz * max(-dot(o, rd.xz) / a, 0.0)); }
    if (dmin < c.z * 3.1) { top = ctop; }
  }
  return top;
}
fn clSlab(ro: vec3f, rd: vec3f, tMax: f32) -> vec2f {
  var t0 = 0.0;
  var t1 = min(tMax, C.march.w);
  if (abs(rd.y) > 1e-5) {
    let ta = (CL_Y0 - 120.0 - ro.y) / rd.y;
    let tb = (clSlabTop(ro, rd) + 20.0 - ro.y) / rd.y;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (ro.y < CL_Y0 - 120.0 || ro.y > CL_Y1) { t1 = -1.0; }
  return vec2f(t0, t1);
}
/** how far a ray's points move between updates (m per update, perpendicular to the ray), the camera's travel */
fn clMotion(rd: vec3f, frames: f32) -> f32 {
  let v = C.vel.xyz;
  return length(v - dot(v, rd) * rd) * frame.dt * frames;
}

// ---------------------------------------------------------------- the near layer: fixed steps anchored in the world
fn clMarchNear(ro: vec3f, rd: vec3f, sp: vec2f, jit: f32) -> ClRay {
  var r: ClRay;
  r.L = vec3f(0.0); r.T = 1.0; r.zA = 0.0; r.zA2 = 0.0; r.zW = 0.0;
  let t0 = sp.x; let t1 = min(sp.y, C.layers.x);
  if (t1 <= t0) { return r; }
  // (the whole stretch below the lowest base any cloud can have, or above the layer with no tower near: nothing)
  let yLo = min(ro.y + rd.y * t0, ro.y + rd.y * t1);
  let yHi = max(ro.y + rd.y * t0, ro.y + rd.y * t1);
  if (yHi < C.layer.x - 160.0 || (yLo > CL_LAYER + 20.0 && C.cellInfo.x < 0.5)) { return r; }
  let D = C.layers.y;
  // (anchored: the lattice lives at fixed world positions along the ray, so flying along it the samples don't crawl)
  let a = dot(ro, rd);
  var t = D * (ceil((a + t0) / D) + jit) - a;
  if (t < t0) { t += D; }
  let inK = smoothstep(-60.0, 120.0, min(ro.y - CL_Y0, CL_Y1 - ro.y));
  let mot = clMotion(rd, 1.0);
  let speedK = 1.0 - 0.7 * smoothstep(30.0, 160.0, length(C.vel.xyz));
  let pxK = 2.0 / frame.proj[1][1] * frame.invRes.y * 2.0 * f32(clStride());
  let nMax = i32(C.layers.z);
  for (var i = 0; i < nMax; i++) {
    if (t >= t1 || r.T < 0.03) { break; }
    // (no longer strides here: the near layer's samples sit on world-anchored shells — doubling them where the view
    // goes opaque aliases thin wisps into rings)
    let p = ro + rd * t;
    clFoot = max(t * pxK, mot);
    let near = C.misc.z * inK * (1.0 - smoothstep(25.0, 90.0, t)) * speedK * select(0.0, 1.0, r.T > 0.3);
    let s = clDensity(p, 1.0, near);
    if (s.d > 0.0) { clShadeStep(&r, p, t, min(D, t1 - t), s, 3); }
    t += D;
  }
  return r;
}

// ---------------------------------------------------------------- the far layer: a deterministic lattice, empty skips
// the lattice: steps of Δa near the camera, growing g·t, capped at Δb — t(u) and its inverse, piecewise closed-form
const LAT_A: f32 = 12.0;
const LAT_G: f32 = 0.012;
const LAT_B: f32 = 120.0;
fn latT(u: f32) -> f32 {
  let tA = LAT_A / LAT_G; let uA = tA / LAT_A;
  let tB = LAT_B / LAT_G; let uB = uA + log(tB / tA) / LAT_G;
  if (u < uA) { return u * LAT_A; }
  if (u < uB) { return tA * exp(LAT_G * (u - uA)); }
  return tB + (u - uB) * LAT_B;
}
fn latU(t: f32) -> f32 {
  let tA = LAT_A / LAT_G; let uA = tA / LAT_A;
  let tB = LAT_B / LAT_G; let uB = uA + log(tB / tA) / LAT_G;
  if (t < tA) { return t / LAT_A; }
  if (t < tB) { return uA + log(t / tA) / LAT_G; }
  return uB + (t - tB) / LAT_B;
}
/** a point along a ray, dropped by the Earth's curve (the layer sinks toward the horizon rather than ending above it) */
fn clCurved(ro: vec3f, rd: vec3f, t: f32) -> vec3f {
  var p = ro + rd * t;
  let hd = t * length(rd.xz);
  p.y += hd * hd / (2.0 * CL_EARTH);
  return p;
}
fn clMarchFar(ro: vec3f, rd: vec3f, sp: vec2f, jit: f32, tNear: f32) -> ClRay {
  var r: ClRay;
  r.L = vec3f(0.0); r.T = 1.0; r.zA = 0.0; r.zA2 = 0.0; r.zW = 0.0;
  let t0 = max(sp.x, C.layers.x); let t1 = sp.y;
  // (nothing to do past an opaque near layer: the far layer only shows through it)
  if (t1 <= t0 || tNear < 0.03) { return r; }
  var u = floor(latU(t0)) + jit;
  if (latT(u) < t0) { u += 1.0; }
  let mot = clMotion(rd, select(4.0, 1.0, C.misc.w > 3.5));
  let pxK = 2.0 / frame.proj[1][1] * frame.invRes.y * 2.0 * f32(clStride());
  let nMax = i32(C.march.x);
  var empty = 0;
  var skipK = 0.0;
  // (the furthest point a coarse test found cloud at: never skip again before marching past it in single steps)
  var uHit = -1.0;
  for (var i = 0; i < nMax; i++) {
    let t = latT(u);
    if (t >= t1 || r.T * tNear < 0.03) { break; }
    let dt = latT(u + 0.5) - latT(u - 0.5);
    let p = clCurved(ro, rd, t);
    clFoot = max(t * pxK, mot);
    // empty-space skipping on the lattice itself: out in the open the shape alone, the stride doubling (2, 4, 8 lattice
    // steps); on a hit, back to just past the last empty point (deterministic for the ray)
    if ((empty >= 2 && u > uHit) || i == 0) {
      let c = clDensity(p, 0.0, 0.0).d;
      if (c <= 0.0) {
        empty += 1;
        skipK = select(1.0, min(max(skipK, 1.0) * 2.0, 8.0), empty >= 2);
        u += skipK;
        continue;
      }
      if (skipK > 1.0) { uHit = u; u = max(u - skipK + 1.0, latU(t0)); skipK = 0.0; empty = 0; continue; }
      skipK = 0.0;
    }
    let detail = 1.0 - smoothstep(9000.0, 18000.0, t);
    var s = clDensity(p, detail, 0.0);
    // (fading out before the march's end: no ruler-straight edge under the horizon)
    s.d *= 1.0 - smoothstep(0.6 * C.march.w, C.march.w, t);
    // (once most of the view is hidden, longer strides)
    let vis = r.T * tNear;
    var K = select(select(1.0, 2.0, vis < 0.3), 4.0, vis < 0.1);
    // (and the budget: a ray kept low through a cloudy layer must still reach its end — past a third of the steps, the
    // strides spread what's left of them over what's left of the ray; else the clouds stop where the steps run out, a
    // ruler-straight shelf across the distance)
    if (i > nMax / 3) { K = max(K, floor((latU(t1) - u) / f32(max(nMax - i, 1)) + 0.5)); }
    if (s.d > 0.0) {
      empty = 0;
      clShadeStep(&r, p, t, latT(u + K - 0.5) - latT(u - 0.5), s, select(3, 5, t < 3000.0));
    } else { empty += 1; }
    u += K;
  }
  return r;
}

/** the air between the eye and a cloud at distance z (as applyAtmosphere does for opaque surfaces) */
fn clAtmo(L: vec3f, T: f32, rd: vec3f, z: f32) -> vec3f {
  let wp = frame.camPos + rd * z;
  let ap = aerial(wp);
  let o = 1.0 - T;
  var c = L * ap.a + ap.rgb * o;
  let f = heightFog(wp);
  if (f > 0.0005) {
    let fc = lighting.fogColor.rgb * 0.9 + lighting.sunRad.rgb * (0.05 * henyeyGreenstein(dot(rd, world.sunDir), 0.6) + 0.01) * PI + lighting.moonRad.rgb * 0.2;
    c = mix(c, fc * o, f);
  }
  return c;
}
/** a finished layer: renormalised once nearly opaque, the night's blue, the air in front; its depth mean and spread */
fn clFinish(r: ClRay, rd: vec3f) -> vec4f {
  var o = r;
  if (o.T < 0.03) { o.L /= 1.0 - o.T; o.T = 0.0; }
  o.L *= mix(vec3f(1.0), vec3f(0.62, 0.76, 1.0), world.nightness);
  if (o.T >= 0.999) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let z = o.zA / max(o.zW, 1e-6);
  return vec4f(clAtmo(o.L, o.T, rd, z), o.T);
}
fn clDepth(r: ClRay) -> vec2f {
  if (r.zW < 1e-6) { return vec2f(-1.0, 0.0); }
  let z = r.zA / r.zW;
  return vec2f(z, sqrt(max(r.zA2 / r.zW - z * z, 0.0)));
}

// ---------------------------------------------------------------- the march (quarter res interleaved, or half)
fn clRayDir(px: vec2f) -> vec3f {
  let ndc = vec2f(px.x * frame.invRes.x * 2.0 - 1.0, 1.0 - px.y * frame.invRes.y * 2.0);
  // (in the camera's own basis: a near-plane point unprojected and a km-scale position subtracted cancel badly in
  // f32 — a ~0.002 rad error, bands of bricks once the history reprojects through it)
  return normalize(frame.camFwd + frame.camRight * (ndc.x / frame.proj[0][0]) + frame.camUp * (ndc.y / frame.proj[1][1]));
}
fn clSceneT(d: f32, rd: vec3f) -> f32 {
  if (d <= 0.0) { return 1e9; }
  return frame.near / d / max(dot(rd, frame.camFwd), 1e-3);
}
/** this frame's 2×2 phase: which half-res pixel of its block each quarter-res texel marches (a Bayer order) */
fn clPhaseOffset() -> vec2i {
  if (C.misc.w > 3.5) { return vec2i(0); }
  let k = u32(C.misc.w) & 3u;
  var o = array<vec2i, 4>(vec2i(0, 0), vec2i(1, 1), vec2i(1, 0), vec2i(0, 1));
  return o[k];
}
/** the march's stride in half-res pixels: 2 (quarter res, interleaved) or 1 (every half-res pixel every frame) */
fn clStride() -> i32 { return select(2, 1, C.misc.w > 3.5); }
/** a half-res pixel's ray: through its full-res 2×2 block's middle; the scene's depth the nearest of the block */
fn clHalfRay(hp: vec2i) -> vec4f {
  let full = vec2i(textureDimensions(sceneDepth)) - 1;
  let b = hp * 2;
  var dp = 0.0;
  for (var k = 0; k < 4; k++) { dp = max(dp, textureLoad(sceneDepth, min(b + vec2i(k & 1, k >> 1), full), 0)); }
  let rd = clRayDir(vec2f(b) + 1.0);
  return vec4f(rd, clSceneT(dp, rd));
}
@compute @workgroup_size(8, 8)
fn march(@builtin(global_invocation_id) gid: vec3u) {
  let dimQ = textureDimensions(farOut);
  let id = gid.xy;
  if (any(id >= dimQ)) { return; }
  let hp = vec2i(id) * clStride() + clPhaseOffset();
  let pk = clHalfRay(hp);
  let rd = pk.xyz;
  // blue noise by the traced texel; through the frames, the golden ratio once per 4-frame cycle and a quarter per phase
  // (each frame's image blue, each pixel's own sequence low-discrepancy)
  let bn = textureLoad(cDetail, vec3i(vec2i(id) % vec2i(64), 0), 0).a;
  let cyc = select(floor(C.misc.x / 4.0), C.misc.x, C.misc.w > 3.5);
  let ph = select(f32(u32(C.misc.w) & 3u) * 0.25, 0.0, C.misc.w > 3.5);
  let jit = fract(bn + cyc * 0.61803398875 + ph);
  clJit = jit;
  let sp = clSlab(frame.camPos, rd, pk.w);
  clL = world.lightDir;
  clMu = dot(rd, clL);
  // (the sky's radiance averaged over the upper hemisphere, and what comes up off the ground and the sea)
  clAmbTop = shIrradiance(vec3f(0.0, 1.0, 0.0));
  clAmbBot = clAmbTop * 0.3 + lighting.groundBounce.rgb * 0.45;
  clAmbSide = shIrradiance(normalize(vec3f(-rd.x, 0.25, -rd.z)));
  clAmbBack = shIrradiance(normalize(vec3f(rd.x, 0.25, rd.z)));
  let rn = clMarchNear(frame.camPos, rd, sp, jit);
  let rf = clMarchFar(frame.camPos, rd, sp, jit, rn.T);
  textureStore(nearOut, id, clFinish(rn, rd));
  textureStore(nearZOut, id, vec4f(clDepth(rn), 0.0, 0.0));
  textureStore(farOut, id, clFinish(rf, rd));
  textureStore(farZOut, id, vec4f(clDepth(rf), pk.w, 0.0));
  // (debug y = 2: the cost — density evaluations in red (/ 400), shaded steps in green (/ 100))
  if (C.debug.y == 2.0) {
    textureStore(nearOut, id, vec4f(0.0, 0.0, 0.0, 1.0));
    textureStore(farOut, id, vec4f(clEvals / 400.0, clShaded / 100.0, 0.0, 0.0));
  }
}

// ---------------------------------------------------------------- temporal resolve (each layer into its half-res history)
fn toYCoCg(c: vec3f) -> vec3f { return vec3f(dot(c, vec3f(0.25, 0.5, 0.25)), dot(c, vec3f(0.5, 0.0, -0.5)), dot(c, vec3f(-0.25, 0.5, -0.25))); }
fn fromYCoCg(c: vec3f) -> vec3f { return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
// (luminance compressed before blending: a bright rim shouldn't ring)
fn tmap(c: vec4f) -> vec4f { return vec4f(c.rgb / (1.0 + luminance(c.rgb)), c.a); }
fn itmap(c: vec4f) -> vec4f { return vec4f(c.rgb / max(1.0 - luminance(c.rgb), 1e-3), c.a); }

/** the history at a uv: Catmull-Rom (5 taps), so it stays sharp under reprojection */
fn clHistory(uv: vec2f) -> vec4f {
  let dim = vec2f(textureDimensions(histLT));
  let sp = uv * dim;
  let tc = floor(sp - 0.5) + 0.5;
  let f = sp - tc;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let t0 = (tc - 1.0) / dim; let t3 = (tc + 2.0) / dim; let t12 = (tc + w2 / w12) / dim;
  var s = vec4f(0.0);
  s += tmap(textureSampleLevel(histLT, samp_linear, vec2f(t12.x, t0.y), 0.0)) * w12.x * w0.y;
  s += tmap(textureSampleLevel(histLT, samp_linear, vec2f(t0.x, t12.y), 0.0)) * w0.x * w12.y;
  s += tmap(textureSampleLevel(histLT, samp_linear, vec2f(t12.x, t12.y), 0.0)) * w12.x * w12.y;
  s += tmap(textureSampleLevel(histLT, samp_linear, vec2f(t3.x, t12.y), 0.0)) * w3.x * w12.y;
  s += tmap(textureSampleLevel(histLT, samp_linear, vec2f(t12.x, t3.y), 0.0)) * w12.x * w3.y;
  let ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(s / ws, vec4f(0.0));
}

/** one layer's resolve. near: every march texel was traced this frame (no interleave), short memory */
fn clResolve(hp: vec2i, isNear: bool) {
  let dimH = vec2i(textureDimensions(outLT));
  let dimQ = vec2i(textureDimensions(inLT));
  let S = clStride();
  let ph = clPhaseOffset();
  let q0 = clamp(hp / S, vec2i(0), dimQ - 1);
  // (the near layer is traced at every march texel every frame, but at this frame's phase pixel: treat its texel as fresh
  // for the pixel it traced, and the others as interpolated — like the far layer, though with a short memory)
  let fresh = all((hp - q0 * S) == ph);
  let me = clHalfRay(hp);
  let zMe = min(me.w, 1e6);
  // the neighbourhood: the 3×3 march samples around — the spatial estimate (bilateral on the scene's depth) and the box
  var m1 = vec4f(0.0); var m2 = vec4f(0.0); var nw = 0.0;
  var est = vec4f(0.0); var ew = 0.0;
  var zc = 0.0; var sc = 0.0; var zcw = 0.0;
  let sub = vec2f(hp) - (vec2f(q0 * S + ph));
  let zc0 = textureLoad(inZ, q0, 0).x;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = clamp(q0 + vec2i(i, j), vec2i(0), dimQ - 1);
      let zq = textureLoad(inZ, q, 0);
      let sceneQ = select(zq.z, zMe, isNear);
      // (a neighbour across a silhouette — an island, a stack, the jet standing in or before the cloud — is left out;
      // but where the scene lies well beyond the cloud for both, its depth doesn't matter: the sea at a grazing angle
      // behind a cloud changes depth fast from texel to texel, and testing it there would quantise the cloud to blocks)
      let zcl = max(zq.x, zc0);
      let occl = zcl <= 0.0 || min(min(sceneQ, 1e6), zMe) < zcl * 1.3;
      if (!isNear && occl && abs(min(sceneQ, 1e6) - zMe) > zMe * 0.08 + 2.0) { continue; }
      let v = tmap(textureLoad(inLT, q, 0));
      let y = vec4f(toYCoCg(v.rgb), v.a);
      let dp = vec2f(f32(i * S), f32(j * S)) - sub;
      // (the neighbourhood's spread weighted round this pixel — a tent that reaches nothing at the 3×3's edge — so the
      // clipping box glides from pixel to pixel: an even box per block would step the history at every block's edge)
      let wm = max(0.0, 1.0 - abs(dp.x) / (1.5 * f32(S))) * max(0.0, 1.0 - abs(dp.y) / (1.5 * f32(S)));
      m1 += y * wm; m2 += y * y * wm; nw += wm;
      let w = max(0.0, 1.0 - length(dp) / (1.3 * f32(S)));
      est += v * w; ew += w;
      if (zq.x > 0.0) { zc += zq.x * w; sc += zq.y * w; zcw += w; }
    }
  }
  var cur: vec4f;
  var cz = select(-1.0, zc / max(zcw, 1e-5), zcw > 1e-4);
  var cs = select(0.0, sc / max(zcw, 1e-5), zcw > 1e-4);
  // (a traced pixel's own sample, and the spatial estimate every pixel of the block shares: until a pixel's history
  // has built up, it uses the shared estimate too — or the traced ones stand out of their block as a grid of dots)
  let raw = tmap(textureLoad(inLT, q0, 0));
  if (ew > 1e-4) { cur = est / ew; } else { cur = raw; }
  if (fresh) {
    let zf = textureLoad(inZ, q0, 0);
    if (zf.x > 0.0) { cz = zf.x; cs = zf.y; }
  }
  var o = cur;
  // (the samples the estimate holds: one when starting over from a fresh trace, a fraction from an interpolated one)
  var n = select(0.25, 1.0, fresh);
  let cap = select(C.layers2.y, C.layers2.z, isNear);
  let aMin = select(C.layers.w, C.layers2.x, isNear);
  if (C.misc.y < 0.5 && nw > 1e-4) {
    let mean = m1 / nw;
    let sd = sqrt(max(m2 / nw - mean * mean, vec4f(0.0)));
    // reproject by the layer's own depth (where it's thin, toward what's behind it)
    let rd = me.xyz;
    let zb = min(me.w, 2e5);
    let rz = select(zb, 1.0 / mix(1.0 / cz, 1.0 / zb, sat(cur.a)), cz > 0.0);
    let pc = frame.prevViewProj * vec4f(frame.camPos + rd * rz, 1.0);
    if (pc.w > 1e-4) {
      let puv = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
      if (all(puv > vec2f(0.0)) && all(puv < vec2f(1.0))) {
        let hdim = vec2i(textureDimensions(histM));
        let hm = textureLoad(histM, clamp(vec2i(puv * vec2f(hdim)), vec2i(0), hdim - 1), 0);
        if (C.debug.z == 1.0) {
          // (the bench's reference: a plain running average)
          n = min(hm.w + 1.0, 4096.0);
          o = mix(tmap(textureLoad(histLT, hp, 0)), cur, 1.0 / n);
        } else {
          // what was behind changed (something moved in front), or the cloud's own depth jumped: start over there
          let dis = (abs(hm.z - me.w) > max(me.w, hm.z) * 0.06 && min(hm.z, me.w) < 1e8)
                 || (hm.x > 0.0 && cz > 0.0 && abs(hm.x - cz) > cz * 0.25);
          if (!dis) {
            // how far off the reprojection may be: the depth's spread × the camera's sideways travel, in pixels
            let fpx = frame.proj[1][1] * f32(dimH.y) * 0.5;
            let zz = max(cz, 1.0);
            let epx = C.layers2.w * fpx * max(cs, hm.y) / (zz * zz);
            let conf = exp(-sq(epx / 1.5));
            n = hm.w * conf;
            // clip the history toward the neighbourhood's spread (wider for a pixel only interpolated this frame)
            let g = select(1.6, 1.1, fresh);
            let h = clHistory(puv);
            let hy = vec4f(toYCoCg(h.rgb), h.a);
            let lo = mean - sd * g; let hi = mean + sd * g;
            let c = (lo + hi) * 0.5; let e = max((hi - lo) * 0.5, vec4f(1e-4));
            let dv = hy - c;
            let u = max(max(abs(dv.x / e.x), abs(dv.y / e.y)), max(abs(dv.z / e.z), abs(dv.w / e.w)));
            let hc = select(hy, c + dv / u, u > 1.0);
            var hcl = vec4f(fromYCoCg(hc.rgb), hc.a);
            // (a pixel not traced this frame: its own history holds detail finer than this frame's sparse samples can
            // describe — clipping to them would quantise it back to the march's resolution. Where the reprojection is
            // sound (sub-pixel motion, confident depth) keep it unclipped)
            // (…but only while it stays near what the samples round it say now: a history far outside their spread is
            // stale — a cloud's edge has moved off it — and held unclipped it would leave the block a checker of four
            // frames' worth of samples)
            if (!fresh) {
              let uvNow = (vec2f(hp) + 0.5) / vec2f(dimH);
              let motion = length((puv - uvNow) * vec2f(dimH));
              let keep = conf * (1.0 - smoothstep(0.35, 1.5, motion)) * (1.0 - smoothstep(0.5, 1.25, u));
              hcl = mix(hcl, h, keep);
            }
            if (fresh) {
              n = min(n + 1.0, cap);
              o = mix(hcl, mix(cur, raw, smoothstep(3.0, 10.0, n)), max(1.0 / n, aMin));
            } else {
              // (only interpolated this frame: lean on the history, nudge toward the estimate)
              o = mix(hcl, cur, max(aMin * 0.25, 1.0 / (n * 4.0 + 1.0)));
            }
          }
        }
      }
    }
  }
  textureStore(outLT, hp, itmap(o));
  textureStore(outM, hp, vec4f(cz, cs, me.w, n));
}
@compute @workgroup_size(8, 8)
fn resolveFar(@builtin(global_invocation_id) id: vec3u) {
  if (any(vec2i(id.xy) >= vec2i(textureDimensions(outLT)))) { return; }
  clResolve(vec2i(id.xy), false);
}
@compute @workgroup_size(8, 8)
fn resolveNear(@builtin(global_invocation_id) id: vec3u) {
  if (any(vec2i(id.xy) >= vec2i(textureDimensions(outLT)))) { return; }
  clResolve(vec2i(id.xy), true);
}

// ---------------------------------------------------------------- full-res composite (blend: one, src-alpha)
/** a layer at a full-res pixel: a depth-aware tent over the 3×3 half-res texels round it (a little wider than bilinear:
 *  a dense tower's edge, resolved in a half-res texel, would show as a staircase — the tent rounds it off; the nearest
 *  depth when every tap disagrees) */
fn clUpsample(tex: texture_2d<f32>, mt: texture_2d<f32>, p: vec2i, zf: f32) -> vec4f {
  let t = vec2f(p) * 0.5 - 0.25;
  let c = vec2i(round(t));
  let dim = vec2i(textureDimensions(tex)) - 1;
  var s = vec4f(0.0); var ws = 0.0;
  let tol = 1.0 / (min(zf, 1e6) * 0.05 + 0.5);
  var best = 1e9;
  var bv = vec4f(0.0, 0.0, 0.0, 1.0);
  for (var k = 0; k < 9; k++) {
    let o = vec2i(k % 3 - 1, k / 3 - 1);
    let q = clamp(c + o, vec2i(0), dim);
    let d = abs(vec2f(c + o) - t);
    let bw = max(0.0, 1.0 - d.x / 1.4) * max(0.0, 1.0 - d.y / 1.4);
    if (bw <= 0.0) { continue; }
    let mq = textureLoad(mt, q, 0);
    var dz = abs(min(mq.z, 1e6) - min(zf, 1e6)) * tol;
    // (an edge in the scene well behind the cloud — a sea stack, an island's rim — doesn't cut the cloud in front of it)
    if (mq.x > 0.0 && mq.x * 1.3 < min(min(mq.z, 1e6), min(zf, 1e6))) { dz = 0.0; }
    let v = textureLoad(tex, q, 0);
    if (dz < best) { best = dz; bv = v; }
    let w = (bw + 1e-3) * max(1e-3, 1.0 - dz);
    s += v * w; ws += w;
  }
  if (best > 1.0) { return bv; }
  return s / ws;
}
@fragment
fn composite(i: FullscreenOut) -> @location(0) vec4f {
  let p = vec2i(i.pos.xy);
  let rd = clRayDir(i.pos.xy);
  let zf = clSceneT(textureLoad(sceneDepth, p, 0), rd);
  let nr = clUpsample(nearLT, nearM, p, zf);
  let fr = clUpsample(farLT, farM, p, zf);
  // near over far
  var L = nr.rgb + nr.a * fr.rgb;
  let T = nr.a * fr.a;
  // lightning, relit here (this frame's flash: no lag through the history): the cloud around the mean depth glows
  if (C.flash.w > 0.0) {
    let hp = clamp(p / 2, vec2i(0), vec2i(textureDimensions(farM)) - 1);
    let zfar = textureLoad(farM, hp, 0).x;
    let znear = textureLoad(nearM, hp, 0).x;
    let K = vec3f(0.75, 0.82, 1.0) * C.flash.w / (4.0 * PI);
    if (zfar > 0.0) {
      let r = distance(frame.camPos + rd * zfar, C.flash.xyz);
      L += nr.a * (1.0 - fr.a) * K * exp(-r / 220.0) / (1.0 + sq(r / 120.0));
    }
    if (znear > 0.0) {
      let r = distance(frame.camPos + rd * znear, C.flash.xyz);
      L += (1.0 - nr.a) * K * exp(-r / 220.0) / (1.0 + sq(r / 120.0));
    }
  }
  if (C.style.x > 0.5) { clStyleZ = textureLoad(farM, clamp(p / 2, vec2i(0), vec2i(textureDimensions(farM)) - 1), 0).x; }
  return clDebugLayer(clStyle(vec4f(L, T)));
}
/** the far layer's mean depth at this pixel (the painted look's bands soften with it) */
var<private> clStyleZ: f32 = 0.0;
/** the painted look (style.x): the cloud's light read as a brightness and mapped onto three flat tones of a palette
 *  (shade, middle, lit), soft-edged bands; the silhouette crisped. A stylized world's clouds */
fn clStyle(c: vec4f) -> vec4f {
  if (C.style.x < 0.5) { return c; }
  let a = 1.0 - c.a;
  if (a < 1e-3) { return c; }
  let col = c.rgb / a;
  let b = luminance(col) / max(C.style.y, 1e-4);
  // (the bands soften with distance: far off, sub-pixel noise through a steep three-tone map flickers like camouflage)
  let w = mix(C.style.z, 0.7, smoothstep(2500.0, 12000.0, clStyleZ));
  let k1 = smoothstep(0.42 - w, 0.42 + w, b);
  let k2 = smoothstep(0.78 - w, 0.78 + w, b);
  let tone = mix(mix(C.pal[0].rgb, C.pal[1].rgb, k1), C.pal[2].rgb, k2);
  let a2 = smoothstep(C.style.w * 0.4, C.style.w, a);
  return vec4f(tone * a2, 1.0 - a2);
}
/** (debug y = 1: the cloud layer alone over a flat backdrop — what the flicker bench measures) */
fn clDebugLayer(c: vec4f) -> vec4f {
  if (C.debug.y == 1.0) { return vec4f(c.rgb + c.a * vec3f(0.02, 0.03, 0.05), 0.0); }
  if (C.debug.y == 2.0) { return vec4f(c.rgb, 0.0); }
  return c;
}

// ---------------------------------------------------------------- bakes
@compute @workgroup_size(8, 8)
fn bakeGround(@builtin(global_invocation_id) id: vec3u) {
  let N = textureDimensions(groundOut).x;
  if (any(id.xy >= vec2u(N))) { return; }
  let uv = (vec2f(id.xy) + 0.5) / f32(N);
  let d1 = vec2f(textureDimensions(heightIn, 3));
  let d2 = vec2f(textureDimensions(heightIn, 6));
  let a = textureLoad(heightIn, vec2i(uv * d1), 3).r;
  let b = textureLoad(heightIn, vec2i(uv * d2), 6).r;
  textureStore(groundOut, id.xy, vec4f(a, max(a, b), 0.0, 1.0));
}

/** the light volume (a band of slices a frame): for each texel's point, the optical depth toward the key light out
 *  through the top of the slab (x) and straight up (y) — geometric steps, shape only */
@compute @workgroup_size(4, 4, 4)
fn bakeLight(@builtin(global_invocation_id) gid: vec3u) {
  let n = u32(C.lvol.y); let nz = u32(C.lvol.z);
  let id = vec3u(gid.x, gid.y, gid.z + u32(C.lvol.w));
  if (id.x >= n || id.y >= nz || id.z >= n) { return; }
  // the texel's world point nearest the camera (toroidal across)
  let cell = C.lvol.x / f32(n);
  let tp = (vec2f(f32(id.x), f32(id.z)) + 0.5) * cell;
  let off = tp - fract(frame.camPos.xz / C.lvol.x) * C.lvol.x;
  let xz = frame.camPos.xz + off - round(off / C.lvol.x) * C.lvol.x;
  let y = (CL_Y0 - 40.0) + (f32(id.y) + 0.5) / f32(nz) * (CL_LAYER - CL_Y0 + 40.0);
  let p = vec3f(xz.x, y, xz.y);
  // (the real sun, as the near taps and the cone see it — from below once it has set for the ground; while it is low its
  // path capped at 3 km: a 16 km path at cloud height crosses every other top and darkens them all)
  let L = normalize(vec3f(world.lightDir.x, clamp(world.lightDir.y, -0.06, 1.0), world.lightDir.z));
  let full = select((CL_Y1 + 20.0 - y) / max(L.y, 0.015), y / max(-L.y, 0.015), L.y < 0.0);
  let low = smoothstep(0.05, 0.12, L.y);
  let span = min(full, mix(3000.0, 4000.0, low));
  clFoot = cell;
  var tau = 0.0;
  var prev = 0.0;
  let S = 20;
  for (var k = 0; k < S; k++) {
    let f = (f32(k) + 0.5) / f32(S);
    let dist = span * f * f;
    tau += clDensity(p + L * dist, -1.0, 0.0).d * (dist - prev);
    prev = dist;
  }
  // (past 4 km, a coarse tail: a low sun's long path through the rest of the slab)
  if (full > span) {
    let rest = min(full, mix(3000.0, 16000.0, low)) - span;
    for (var k = 0; k < 3; k++) {
      let dist = span + (f32(k) + 0.5) / 3.0 * rest;
      clFoot = 400.0;
      tau += clDensity(p + L * dist, -1.0, 0.0).d * rest / 3.0;
    }
  }
  // straight up (the sky's light reaching in from above)
  var up = 0.0;
  let spanUp = min(CL_Y1 + 20.0 - y, 4000.0);
  prev = 0.0;
  clFoot = cell;
  for (var k = 0; k < 10; k++) {
    let f = (f32(k) + 0.5) / 10.0;
    let dist = spanUp * f * f;
    up += clDensity(p + vec3f(0.0, dist, 0.0), -1.0, 0.0).d * (dist - prev);
    prev = dist;
  }
  textureStore(lightOut, id, vec4f(tau * C.shape.y, up * C.shape.y, 0.0, 0.0));
}

/** the storm towers' light boxes (a few slices of each a frame; all of them when the cells change): per texel the
 *  optical depth toward the key light (x) and straight up (y), through the same density the march sees */
@compute @workgroup_size(4, 4, 4)
fn bakeTowers(@builtin(global_invocation_id) gid: vec3u) {
  let sl = max(u32(C.towerBake.y), 1u);
  let ci = gid.z / sl;
  if (f32(gid.x) >= TW_N || f32(gid.y) >= TW_NY || i32(ci) >= i32(C.cellInfo.x)) { return; }
  let b = C.boxes[ci];
  if (b.w < 0.5) { return; }
  let slice = (u32(C.towerBake.x) + gid.z % sl) % u32(TW_N);
  let rel = (vec2f(f32(gid.x), f32(slice)) + 0.5) / TW_N;
  let xz = b.xy + (rel - 0.5) * 2.0 * b.z;
  let y = TW_Y0 + (f32(gid.y) + 0.5) / TW_NY * (CL_Y1 - TW_Y0);
  let p = vec3f(xz.x, y, xz.y);
  let L = normalize(vec3f(world.lightDir.x, clamp(world.lightDir.y, -0.06, 1.0), world.lightDir.z));
  clFoot = 2.0 * b.z / TW_N;
  let full = select((CL_Y1 + 20.0 - y) / max(L.y, 0.015), y / max(-L.y, 0.015), L.y < 0.0);
  let span = min(full, mix(3000.0, 6000.0, smoothstep(0.05, 0.12, L.y)));
  var tau = 0.0;
  var prev = 0.0;
  for (var k = 0; k < 24; k++) {
    let f = (f32(k) + 0.5) / 24.0;
    let dist = span * f * f;
    tau += clDensity(p + L * dist, -1.0, 0.0).d * (dist - prev);
    prev = dist;
  }
  var up = 0.0;
  prev = 0.0;
  let spanUp = min(CL_Y1 + 20.0 - y, 5000.0);
  for (var k = 0; k < 12; k++) {
    let f = (f32(k) + 0.5) / 12.0;
    let dist = spanUp * f * f;
    up += clDensity(p + vec3f(0.0, dist, 0.0), -1.0, 0.0).d * (dist - prev);
    prev = dist;
  }
  towerOut[twIdx(ci, gid.x, gid.y, slice)] = vec2f(tau * C.shape.y, up * C.shape.y);
}

/** the weather (a band of rows a frame): x coverage, y cloud type (0 stratus .. 1 cumulus), z base height, w storm.
 *  Evolving: a 3D noise whose third axis is the clock, so cells grow, merge and dissolve as they drift */
fn clN3(p: vec3f, oct: i32) -> f32 {
  var s = 0.0; var a = 0.5; var q = p;
  for (var k = 0; k < oct; k++) { s += a * vnoise3(q); q = q * 2.03 + vec3f(1.7, 9.2, 3.1); a *= 0.5; }
  return s / (1.0 - pow(0.5, f32(oct)));
}
@compute @workgroup_size(8, 8)
fn bakeWeather(@builtin(global_invocation_id) gid: vec3u) {
  let N = u32(C.wwin.w);
  let id = vec2u(gid.x, gid.y + u32(C.bake.z));
  if (any(id >= vec2u(N))) { return; }
  let x = C.wwin.xy + (vec2f(id) + 0.5) / f32(N) * C.wwin.z;
  let tt = C.drift.z / 900.0;
  // (domain-warped: cells stretch and curl rather than sit on a grid)
  let warp = vec2f(clN3(vec3f(x / 6000.0, tt * 0.5), 2), clN3(vec3f(x / 6000.0 + 7.3, tt * 0.5), 2)) - 0.5;
  let xw = x + warp * 2600.0;
  let n = (clN3(vec3f(xw / 3200.0, tt), 4) - 0.5) + (clN3(vec3f(xw / 900.0 + 3.1, tt * 1.7), 3) - 0.5) * 0.55;
  // the front: a cold-front line sweeping across — heaped and stormy in the band, lower bases; clearing behind it
  let fp = dot(x + C.drift.xy, C.front.xy) - C.front.z;
  let fw = max(C.front.w, 1.0);
  let front = select(0.0, exp(-fp * fp / (fw * fw)), C.front.w > 1.0);
  let behind = select(0.0, smoothstep(0.0, -2.5 * fw, fp), C.front.w > 1.0);
  // (n is ~normal, σ ≈ 0.14: the coverage bias slides the threshold through it)
  let bias = C.shape.x + front * 0.8 - behind * 0.4;
  let th = 0.5 - bias * 1.5;
  let cover = smoothstep(th - 0.35, th + 0.55, n / 0.14) + max(bias - 1.0, 0.0) * 0.5;
  let kind = sat(smoothstep(0.32, 0.68, clN3(vec3f(x / 7000.0 + 11.3, tt * 0.4), 3)) + C.weather2.x + front * 0.6);
  // (the high ground makes its own weather: cumulus builds over the peaks — where the ground is now, under the drift;
  // over the open sea, less — by how much, the weather's own. A cap cloud sits on a ridge, not through it)
  let G = clGround(x + C.drift.xy);
  let base = max(C.layer.x + C.layer.y * smoothstep(0.25, 0.75, clN3(vec3f(x / 5000.0 + 5.5, tt * 0.3), 2)) - front * 150.0, G.y + 120.0);
  var cov = clamp(cover * mix(C.weather2.y, 1.3, smoothstep(60.0, 500.0, G.y)), 0.0, 1.5);
  // (a sheet breaks into cells — stratocumulus, with thin seams of lighter cloud between them: a deck with a texture
  // from below, not a featureless lid; the heaped kinds keep their own shapes)
  let vc = voronoi(xw / 1300.0 + vec2f(tt * 0.2, 0.0));
  let seam = 1.0 - smoothstep(0.0, 0.12, vc.y - vc.x);
  cov *= 1.0 - seam * 0.5 * (1.0 - kind);
  let storm = sat((smoothstep(0.62, 0.8, clN3(vec3f(x / 4000.0 + 21.7, tt * 0.8), 3)) * C.vel.w * 0.6 + front * C.vel.w * 1.2) * kind * sat(cov));
  textureStore(weatherOut, id, vec4f(cov, kind, base - storm * 60.0, storm));
}

/** the camera's own cloud (read back for the eye's adaptation, the sound, the game): x the mean density round it and
 *  just ahead, y at the eye itself */
@compute @workgroup_size(1)
fn probe() {
  clFoot = 1.0;
  var d = 0.0;
  for (var k = 0; k < 6; k++) { d += clDensity(frame.camPos + frame.camFwd * f32(k) * 8.0, 1.0, 0.0).d; }
  probeOut[0] = vec4f(d / 6.0, clDensity(frame.camPos, 1.0, 0.0).d, 0.0, 0.0);
}

/** the wake map: everything heals; this frame's stamps (segments flown through) tear tunnels */
@compute @workgroup_size(8, 8)
fn bakeWake(@builtin(global_invocation_id) id: vec3u) {
  let n = u32(C.wake.y);
  if (any(id.xy >= vec2u(n))) { return; }
  var w = textureLoad(cWake, vec2i(id.xy), 0);
  w.x *= exp(-C.wake.z * frame.dt);
  // the texel's world position nearest the camera (the map is toroidal)
  let cell = C.wake.x / f32(n);
  let tp = (vec2f(id.xy) + 0.5) * cell;
  let off = tp - fract(frame.camPos.xz / C.wake.x) * C.wake.x;
  let xz = frame.camPos.xz + off - round(off / C.wake.x) * C.wake.x;
  let ns = i32(C.wake.w);
  for (var k = 0; k < ns; k++) {
    let a = C.stamps[k * 2]; let b = C.stamps[k * 2 + 1];
    let ab = b.xz - a.xz;
    let t = sat(dot(xz - a.xz, ab) / max(dot(ab, ab), 1e-4));
    let d = distance(xz, a.xz + ab * t);
    let r = a.w;
    let k2 = (1.0 - smoothstep(r * 0.6, r, d)) * b.w;
    if (k2 > w.x) { w = vec4f(k2, mix(a.y, b.y, t), r, xz.x / 64.0); }
  }
  textureStore(wakeOut, id.xy, w);
}

// ---------------------------------------------------------------- the shadow map (a band of rows a frame)
// for each texel of the plane at world.cloudMap.w: the key light's ray through it — its transmittance, the mean height
// and spread of where its extinction lies, the height below which the mountains block it (see env.wgsl cloudMapT)
@compute @workgroup_size(8, 8)
fn bakeShadow(@builtin(global_invocation_id) gid: vec3u) {
  let N = u32(C.smap.w);
  let id = vec2u(gid.x, gid.y + u32(C.bake.x));
  if (any(id >= vec2u(N))) { return; }
  let xz = C.smap.xy + (vec2f(id) + 0.5) / f32(N) * C.smap.z;
  let L = cloudLightDir();
  // (32 steps through the layer, where the mountains and the cumulus are; 8 more up through the storm towers)
  let S = 32;
  let y0 = 20.0;
  let dy = (CL_LAYER - y0) / f32(S);
  let ds = dy / L.y;
  clFoot = ds * 0.5;
  var tau = 0.0; var m1 = 0.0; var m2 = 0.0;
  var occ = 0.0;
  var eLast = -1e4;
  for (var i = 0; i < S; i++) {
    let y = y0 + (f32(i) + 0.5) * dy;
    let q = xz + L.xz / L.y * (y - world.cloudMap.w);
    let e = clGround(q).y + 20.0 - y;
    if (e >= 0.0) { occ = y; } else if (eLast >= 0.0) { occ = y - dy + dy * eLast / (eLast - e); }
    eLast = e;
    if (e > 30.0) { continue; }
    let st = clDensity(vec3f(q.x, y, q.y), -1.0, 0.0).d * C.shape.y * ds;
    tau += st; m1 += st * y; m2 += st * y * y;
  }
  if (C.cellInfo.x > 0.0) {
    let dy2 = (CL_Y1 - CL_LAYER) / 8.0;
    let ds2 = dy2 / L.y;
    clFoot = ds2 * 0.5;
    for (var i = 0; i < 8; i++) {
      let y = CL_LAYER + (f32(i) + 0.5) * dy2;
      let q = xz + L.xz / L.y * (y - world.cloudMap.w);
      let st = clDensity(vec3f(q.x, y, q.y), -1.0, 0.0).d * C.shape.y * ds2;
      tau += st; m1 += st * min(y, 2000.0); m2 += st * min(y, 2000.0) * min(y, 2000.0);
    }
  }
  // (the high deck's shadow too: sky.wgsl draws it)
  if (world.cloudCover > 0.01) {
    let hd = cirrusField(xz + L.xz / L.y * (CIRRUS_H - world.cloudMap.w), 0.0).y * 0.06;
    tau += hd; m1 += hd * 1950.0; m2 += hd * 1950.0 * 1950.0;
  }
  let mu = select(1000.0, m1 / tau, tau > 1e-5);
  let sd = select(400.0, sqrt(max(m2 / tau - mu * mu, 0.0)), tau > 1e-5) + dy * mix(1.6, 0.6, smoothstep(0.08, 0.4, L.y));
  textureStore(smapOut, id, vec4f(exp(-tau), sat(mu / 2000.0), sat(sd / 1000.0), sat(occ / 2000.0)));
}
