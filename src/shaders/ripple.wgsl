// The ripple sim round the player (world/ripples.ts): a dispersive heightfield (iWave, after boulder's lakes and the
// waterbending game: h'' = -g |k| h, the |k| a 13x13 convolution staged per 16x16 block in workgroup memory) over a
// square window of cells that follows the player across the water. Real water's waves are dispersive — long ones outrun
// short ones — which is what makes a splash spread as a widening train of rings and a body moving over the water leave
// a feathered Kelvin wake (a plain wave equation, every length at one speed, gives single hard rings and a narrow
// rubbery cone). Slowed in the shallows (tanh(k d): waves bunch up and steepen toward a shore), damped where they break
// on a beach, dry land a wall. The window is toroidal — a cell's slot is its world index modulo the size — so moving
// it only clears the cells that come into it, and a sponge along its edges soaks up what reaches them. Impulses (a
// stone, a splash, a wading step, a skimmer's trough and bow wave, the air pushed down under a wing) displace the
// surface where they fall — a point or a line (a trough ploughed this step, a wake's arm) — leaving foam that lingers
// and fades (a wake's white trail), and a crest's whitecap that's there only a moment. Each step publishes the texture
// env.wgsl's rippleAt samples with a repeating sampler (world position maps straight onto its slot): height (m), its
// rate (m/s), foam, the whitecaps' share of it.

struct RippleU {
  win: vec4f,     // xy the window's first cell (a world cell index) now, zw the same last step
  grid: vec4f,    // x cells across, y cell size (m), z the sea level, w impulses this step
  sim: vec4f,     // x the step (s), y damping (1/s), z foam kept per step, w clear everything (1)
  look: vec4f,    // x viscosity, y a crest's foam kept per step, z the world's half size (m: the terrain map), w the largest height (m)
  shore: vec4f,   // x the shallows' slowing (tanh(depth * x)), y, z the beach's damping depths (m), w -
}
// x, z (m), how far it displaces the surface at its middle (m), radius (m); the foam it leaves; and where it runs to
// (x2, z2: a line — a crest, a trough — or the same point: round); how much of its foam is a crest's whitecap (0..1)
struct Impulse { x: f32, z: f32, amount: f32, radius: f32, foam: f32, x2: f32, z2: f32, crest: f32 }

@group(2) @binding(0) var<uniform> R: RippleU;
@group(2) @binding(1) var<storage, read> rin: array<vec4f>;          // per slot: height, last step's, foam, depth (m)
@group(2) @binding(2) var<storage, read_write> rout: array<vec4f>;
@group(2) @binding(3) var<storage, read> impulses: array<Impulse>;
@group(2) @binding(4) var rippleOut: texture_storage_2d<rgba16float, write>;
@group(2) @binding(5) var heights: texture_2d<f32>;                  // the terrain's (r32float, the world's ±half)
@group(2) @binding(6) var<storage, read> cin: array<f32>;            // per slot: the whitecaps' foam
@group(2) @binding(7) var<storage, read_write> cout: array<f32>;

const RAD: i32 = 6;
const TS: i32 = 16;
const TW: i32 = 28;   // TS + 2 RAD
const MAXNEAR: u32 = 512u;
var<workgroup> tile: array<f32, 784>;
var<workgroup> near: array<u32, 512>;
var<workgroup> nNear: atomic<u32>;

fn impDist(p: vec2f, m: Impulse) -> f32 {
  let a = vec2f(m.x, m.z);
  let ab = vec2f(m.x2, m.z2) - a;
  let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return distance(p, a + ab * t);
}
// the slot a world cell lives in
fn slotOf(c: vec2i, n: i32) -> u32 { return u32((((c.y % n) + n) % n) * n + (((c.x % n) + n) % n)); }
fn inWin(c: vec2i, o: vec2f, n: i32) -> bool { let d = c - vec2i(o); return all(d >= vec2i(0)) && all(d < vec2i(n)); }
fn hLoad(ij: vec2i) -> f32 {
  let dim = vec2i(textureDimensions(heights, 0));
  return textureLoad(heights, clamp(ij, vec2i(0), dim - 1), 0).r;
}
/** the ground under xz (bilinear; off the map the deep) */
fn groundAt(xz: vec2f) -> f32 {
  let uv = xz / (2.0 * R.look.z) + 0.5;
  let dim = vec2f(textureDimensions(heights, 0));
  let t = uv * dim - 0.5;
  let i = vec2i(floor(t));
  let f = t - floor(t);
  let h = mix(mix(hLoad(i), hLoad(i + vec2i(1, 0)), f.x), mix(hLoad(i + vec2i(0, 1)), hLoad(i + vec2i(1, 1)), f.x), f.y);
  let out = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
  return mix(h, -70.0, smoothstep(0.495, 0.5, out));
}

// K * h in grid units: a radially symmetric kernel whose response is |k| (deep-water dispersion) from ~10-cell waves down
// to the grid scale, tapered near Nyquist and never negative (no wavelength can grow); the waterbending game's fit
// (the inverse transform of |k| exp(-(k/2.6)^6), truncated to 6.5 cells, zero-sum, plus 0.03 of the 5-point Laplacian)
fn kconv(i: i32) -> f32 {
  var a = 0.0;
  a += 0.797836 * (tile[i]);
  a += 0.166435 * (tile[i - 28] + tile[i - 1] + tile[i + 1] + tile[i + 28]);
  a += -0.072015 * (tile[i - 29] + tile[i - 27] + tile[i + 27] + tile[i + 29]);
  a += -0.146127 * (tile[i - 56] + tile[i - 2] + tile[i + 2] + tile[i + 56]);
  a += -0.099985 * (tile[i - 57] + tile[i - 55] + tile[i - 30] + tile[i - 26] + tile[i + 26] + tile[i + 30] + tile[i + 55] + tile[i + 57]);
  a += 0.012230 * (tile[i - 58] + tile[i - 54] + tile[i + 54] + tile[i + 58]);
  a += 0.027883 * (tile[i - 84] + tile[i - 3] + tile[i + 3] + tile[i + 84]);
  a += 0.031178 * (tile[i - 85] + tile[i - 83] + tile[i - 31] + tile[i - 25] + tile[i + 25] + tile[i + 31] + tile[i + 83] + tile[i + 85]);
  a += 0.011202 * (tile[i - 86] + tile[i - 82] + tile[i - 59] + tile[i - 53] + tile[i + 53] + tile[i + 59] + tile[i + 82] + tile[i + 86]);
  a += -0.012023 * (tile[i - 87] + tile[i - 81] + tile[i + 81] + tile[i + 87]);
  a += -0.009900 * (tile[i - 112] + tile[i - 4] + tile[i + 4] + tile[i + 112]);
  a += -0.012418 * (tile[i - 113] + tile[i - 111] + tile[i - 32] + tile[i - 24] + tile[i + 24] + tile[i + 32] + tile[i + 111] + tile[i + 113]);
  a += -0.011513 * (tile[i - 114] + tile[i - 110] + tile[i - 60] + tile[i - 52] + tile[i + 52] + tile[i + 60] + tile[i + 110] + tile[i + 114]);
  a += -0.000965 * (tile[i - 115] + tile[i - 109] + tile[i - 88] + tile[i - 80] + tile[i + 80] + tile[i + 88] + tile[i + 109] + tile[i + 115]);
  a += 0.001461 * (tile[i - 116] + tile[i - 108] + tile[i + 108] + tile[i + 116]);
  a += 0.000459 * (tile[i - 140] + tile[i - 5] + tile[i + 5] + tile[i + 140]);
  a += 0.001559 * (tile[i - 141] + tile[i - 139] + tile[i - 33] + tile[i - 23] + tile[i + 23] + tile[i + 33] + tile[i + 139] + tile[i + 141]);
  a += 0.002798 * (tile[i - 142] + tile[i - 138] + tile[i - 61] + tile[i - 51] + tile[i + 51] + tile[i + 61] + tile[i + 138] + tile[i + 142]);
  a += 0.000606 * (tile[i - 143] + tile[i - 137] + tile[i - 89] + tile[i - 79] + tile[i + 79] + tile[i + 89] + tile[i + 137] + tile[i + 143]);
  a += -0.001641 * (tile[i - 144] + tile[i - 136] + tile[i - 117] + tile[i - 107] + tile[i + 107] + tile[i + 117] + tile[i + 136] + tile[i + 144]);
  a += -0.001659 * (tile[i - 168] + tile[i - 6] + tile[i + 6] + tile[i + 168]);
  a += -0.001847 * (tile[i - 169] + tile[i - 167] + tile[i - 34] + tile[i - 22] + tile[i + 22] + tile[i + 34] + tile[i + 167] + tile[i + 169]);
  a += -0.002074 * (tile[i - 170] + tile[i - 166] + tile[i - 62] + tile[i - 50] + tile[i + 50] + tile[i + 62] + tile[i + 166] + tile[i + 170]);
  return a;
}

@compute @workgroup_size(16, 16)
fn sim(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) lid: vec3u, @builtin(local_invocation_index) li: u32) {
  let n = i32(R.grid.x);
  let o = R.win.xy;
  let cell = R.grid.y;
  let fresh = R.sim.w > 0.5;
  // this block's first world cell
  let b0 = vec2i(o) + vec2i(wg.xy) * TS;
  if (li == 0u) { atomicStore(&nNear, 0u); }
  // stage the heights (+ the apron): only cells inside the window that were in last step's window too hold state
  for (var k = 0; k < 4; k++) {
    let idx = i32(li) + k * 256;
    if (idx < TW * TW) {
      let c = b0 + vec2i(idx % TW, idx / TW) - vec2i(RAD);
      var hv = 0.0;
      if (!fresh && inWin(c, o, n) && inWin(c, R.win.zw, n)) {
        let s = rin[slotOf(c, n)];
        hv = s.x * step(0.02, s.w);
      }
      tile[idx] = hv;
    }
  }
  workgroupBarrier();
  // the impulses that reach this block (each thread tests some)
  let lo = (vec2f(b0) - 0.5) * cell;
  let hi = (vec2f(b0 + vec2i(TS)) + 0.5) * cell;
  let nImp = u32(R.grid.w);
  for (var k = li; k < nImp; k += 256u) {
    let m = impulses[k];
    let bl = min(vec2f(m.x, m.z), vec2f(m.x2, m.z2)) - m.radius;
    let bh = max(vec2f(m.x, m.z), vec2f(m.x2, m.z2)) + m.radius;
    if (all(bh >= lo) && all(bl <= hi)) { let j = atomicAdd(&nNear, 1u); if (j < MAXNEAR) { near[j] = k; } }
  }
  workgroupBarrier();
  let nn = min(atomicLoad(&nNear), MAXNEAR);

  let c = b0 + vec2i(lid.xy);
  let slot = slotOf(c, n);
  let tx = vec2i(i32(slot % u32(n)), i32(slot / u32(n)));
  let ti = (i32(lid.y) + RAD) * TW + i32(lid.x) + RAD;
  let xz = (vec2f(c) + 0.5) * cell;
  var s = rin[slot];
  // a cell just come into the window (or all of them, cleared): still water, its depth from the ground under it
  let enter = fresh || !inWin(c, R.win.zw, n);
  if (enter) { s = vec4f(0.0, 0.0, 0.0, R.grid.z - groundAt(xz)); }
  let depth = s.w;
  if (depth < 0.02) {
    rout[slot] = vec4f(0.0, 0.0, 0.0, depth);
    cout[slot] = 0.0;
    textureStore(rippleOut, tx, vec4f(0.0));
    return;
  }
  let crest0 = select(cin[slot], 0.0, enter);
  // the impulses: each displaces the surface (added to both steps: a shape, no velocity of its own), leaving foam
  var src = 0.0;
  var df = 0.0;
  var dcrest = 0.0;
  for (var k = 0u; k < nn; k++) {
    let m = impulses[near[k]];
    let q = impDist(xz, m) / max(m.radius, 1e-3);
    if (q < 1.0) {
      let w = 1.0 - q * q;
      src += m.amount * w * w;
      df += m.foam * w * w * (1.0 - m.crest);
      dcrest += m.foam * w * w * m.crest;
    }
  }
  let h = s.x + src;
  let hp = s.y + src;
  let dt = R.sim.x;
  // the vertical derivative: deep-water |k|, slowed in the shallows
  let kh = kconv(ti) / cell;
  let shallow = clamp(tanh(depth * R.shore.x), 0.12, 1.0);
  // damping: a little everywhere, a lot where waves break on a beach
  let alpha = R.sim.y + 6.0 * (1.0 - smoothstep(R.shore.y, R.shore.z, depth));
  var hn = (h * (2.0 - alpha * dt) - hp - 9.81 * dt * dt * shallow * kh) / (1.0 + alpha * dt);
  // viscosity: the shortest waves (a few cells) die out within a fraction of a second, long swells travel on
  let lap = tile[ti + 1] + tile[ti - 1] + tile[ti + TW] + tile[ti - TW] - 4.0 * tile[ti];
  hn += R.look.x * dt * lap;
  // the sponge: the last few cells of the window soak waves up
  let e = vec2f(c - vec2i(o)) / f32(n);
  let edge = min(min(e.x, 1.0 - e.x), min(e.y, 1.0 - e.y));
  let fade = mix(0.94, 1.0, smoothstep(0.0, 0.05, edge));
  hn = clamp(hn * fade, -R.look.w, R.look.w);
  let hk = h * fade;
  let v = (hn - hk) / dt;
  // foam: from impacts and what's thrown in, from water moving fast (churned) and from crests too steep to hold
  // (breaking), lingering and fading — a wake leaves a white trail
  let grad = vec2f(tile[ti + 1] - tile[ti - 1], tile[ti + TW] - tile[ti - TW]) / (2.0 * cell);
  let steep = length(grad);
  let own = max(abs(v) - 1.6, 0.0) * 0.008 + max(steep - 0.7, 0.0) * 0.04;
  let foam = min(s.z * R.sim.z + df + own, 2.0);
  rout[slot] = vec4f(hn, hk, foam, depth);
  let crest = min(crest0 * R.look.y + dcrest, 2.0);
  cout[slot] = crest;
  let tot = min(foam + crest, 2.0);
  // published: height (m), its rate (m/s), foam, the whitecaps' share of it
  textureStore(rippleOut, tx, vec4f(hn, v, tot, crest / max(tot, 1e-4)));
}
