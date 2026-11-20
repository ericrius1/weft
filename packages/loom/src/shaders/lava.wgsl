// Lava on a heightfield (sim/lava.ts): a viscous, cooling, freezing sheet flowing over the land. Engine-neutral: weft only,
// nothing of a project's. A square grid of cells over the land, each with
//   h  the molten lava's thickness (m)          T  its heat (0 cold .. 1 eruptive, about 1130 C)
//   s  the rock it has left frozen there (m)    w  that rock's heat (0..1: the glow left in its cracks)
// and between neighbours the flux out of each cell (m3/s, to -x, +x, -z, +z). Lava is so viscous that its momentum
// is nothing beside its friction: a cell's flow down to each neighbour is the creeping (lubrication) law for a sheet,
// q = M(T) h_e^2 h dH, where dH is the drop of the lava's surface and h_e what's left of the thickness once the yield
// strength holds the rest (a Bingham fluid: a cool flow stops while still a metre or more thick, so it makes the steep
// fronts and levees lava has). M falls by orders as it cools. Heat moves with the lava, is lost faster the thinner the
// sheet, and below the freezing heat the lava turns to rock in place (s), which the next flow runs over. A lake (the
// crater's) is held at its level and its heat; vents add lava at their rates.
//
//   flux      each cell's outflow to its four neighbours, from stA          (one dispatch)
//   advance   each cell's lava and heat from stA, the fluxes, the vents -> stB   (then the pair swaps)
//   probe     what's at one cell (the eye's), for the host's CPU (is the eye in the lava?)
//   glow      the light the lava gives off, an 8x8-cell average a texel: rgb its colour times its strength, a the
//             lava surface's height (for the light it throws on what's near it)
//   tiles     which 32x32-cell tiles have lava or rock to draw, sorted by distance into three detail lists (the host's
//             draws take their counts from `args` by indirect draw)

#include "./lava_common"

@group(1) @binding(0) var<uniform> L: LavaU;
@group(1) @binding(1) var<storage, read> bed: array<f32>;
@group(1) @binding(2) var<storage, read> stA: array<vec4f>;
@group(1) @binding(3) var<storage, read_write> stB: array<vec4f>;
@group(1) @binding(4) var<storage, read_write> fl: array<vec4f>;
@group(1) @binding(5) var<storage, read_write> probeOut: array<vec4f>;
@group(1) @binding(6) var glowOut: texture_storage_2d<rgba16float, write>;
@group(1) @binding(7) var<storage, read_write> args: array<atomic<u32>>;
@group(1) @binding(8) var<storage, read_write> lists: array<u32>;
@group(1) @binding(9) var<storage, read> flR: array<vec4f>;


fn nCells() -> u32 { return u32(L.grid.x); }
fn idx(i: u32, j: u32) -> u32 { return j * nCells() + i; }
fn cellXZ(i: u32, j: u32) -> vec2f { return L.grid.zw + (vec2f(f32(i), f32(j)) + 0.5) * L.grid.y; }

fn surfaceA(k: u32) -> f32 { let c = stA[k]; return bed[k] + c.z + c.x; }

/** how freely lava at heat T moves (the hot lava's mobility, down by orders as it cools) */
fn mobility(T: f32) -> f32 { return L.step.z * exp(-L.step.w * (1.0 - clamp(T, 0.0, 1.0))); }

@compute @workgroup_size(8, 8)
fn flux(@builtin(global_invocation_id) id: vec3u) {
  let N = nCells();
  if (id.x >= N || id.y >= N) { return; }
  let i = id.x; let j = id.y; let k = idx(i, j);
  let c = stA[k];
  let h = c.x;
  if (h < 0.004) { fl[k] = vec4f(0.0); return; }
  let H = bed[k] + c.z + h;
  let cell = L.grid.y;
  let T = c.y;
  let M = mobility(T);
  // (the yield: what the thickness has to be over before a sheet on a slope moves at all — thicker the cooler)
  let yieldK = L.cool.z * (1.0 + L.cool.w * (1.0 - T) * (1.0 - T));
  var nb = array<u32, 4>(select(k, k - 1u, i > 0u), select(k, k + 1u, i + 1u < N), select(k, k - N, j > 0u), select(k, k + N, j + 1u < N));
  var q = vec4f(0.0);
  for (var n = 0u; n < 4u; n++) {
    let o = nb[n];
    if (o == k) { continue; }
    let dH = H - surfaceA(o);
    if (dH <= 0.0) { continue; }
    let slope = dH / cell;
    let he = max(0.0, h - yieldK / max(slope, 0.02));
    q[n] = M * he * he * h * dH;
  }
  // (never more out in a step than the cell holds: scaled down to a fraction of it)
  let out = q.x + q.y + q.z + q.w;
  let most = 0.22 * h * cell * cell / max(L.step.x, 1e-4);
  if (out > most) { q *= most / out; }
  // (the grid's edge drains: what reaches it is gone)
  fl[k] = q;
}

fn inLake(xz: vec2f) -> bool { return L.lake.w > 0.0 && distance(xz, L.lake.xz) < L.lake.w; }

@compute @workgroup_size(8, 8)
fn advance(@builtin(global_invocation_id) id: vec3u) {
  let N = nCells();
  if (id.x >= N || id.y >= N) { return; }
  let i = id.x; let j = id.y; let k = idx(i, j);
  let dt = L.step.x;
  let cell = L.grid.y;
  let A = cell * cell;
  let c = stA[k];
  var h = c.x; var T = c.y; var s = c.z; var w = c.w;
  let qo = fl[k];
  let out = (qo.x + qo.y + qo.z + qo.w) * dt / A;
  // what comes in from each neighbour (its flux toward here), with its heat
  var inV = 0.0; var inE = 0.0;
  if (i > 0u) { let o = k - 1u; let v = fl[o].y * dt / A; inV += v; inE += v * stA[o].y; }
  if (i + 1u < N) { let o = k + 1u; let v = fl[o].x * dt / A; inV += v; inE += v * stA[o].y; }
  if (j > 0u) { let o = k - N; let v = fl[o].w * dt / A; inV += v; inE += v * stA[o].y; }
  if (j + 1u < N) { let o = k + N; let v = fl[o].z * dt / A; inV += v; inE += v * stA[o].y; }
  // the vents
  let xz = cellXZ(i, j);
  var src = 0.0;
  for (var v = 0u; v < min(L.ventN.x, 8u); v++) {
    let vt = L.vents[v];
    let d = distance(xz, vt.xy);
    if (d < vt.z) {
      // (a vent's rate over its mouth, most in its middle)
      let wgt = 1.0 - (d / vt.z) * (d / vt.z);
      src += vt.w / (1.5708 * vt.z * vt.z) * wgt * dt;
    }
  }
  let kept = max(h - out, 0.0);
  let h2 = kept + inV + src;
  var T2 = 0.0;
  if (h2 > 1e-5) { T2 = (kept * T + inE + src) / h2; }
  // cooling: radiated off the top, faster the thinner the sheet (a thick flow's core stays hot under its crust)
  T2 = max(0.0, T2 - dt * (L.cool.x + L.cool.y / (h2 + 0.4)));
  h = h2; T = T2;
  // freezing: below the freezing heat the lava turns to rock in place, a share of it a second; a film too thin to
  // flow freezes at once
  if (h > 0.0 && (T < L.tune.x || h < 0.003)) {
    let f = select(min(1.0, dt * L.tune.y), 1.0, h < 0.003);
    let ds = h * f;
    s += ds; h -= ds;
    w = max(w, T * 1.2);
  }
  // the rock: warm while lava is on it, cooling after; cold and bare, it wears away (the land is the host's to keep)
  if (h > 0.05) { w = max(w, min(T, 1.0)); }
  else {
    w = max(0.0, w - dt * L.tune.z * (0.3 + w));
    if (w < 0.04) { s = max(0.0, s - dt * L.tune.w); }
  }
  // the lake: held at its level and its heat (its own churning is the drawing's)
  if (inLake(xz)) {
    let top = L.lake.y - bed[k] - s;
    if (top > 0.0) { h = top; T = 1.0; w = 1.0; }
  }
  // (the grid's rim: a sink)
  if (i == 0u || j == 0u || i + 1u == N || j + 1u == N) { h = 0.0; }
  stB[k] = vec4f(h, T, s, w);
}

@compute @workgroup_size(1)
fn probe() {
  let N = nCells();
  let q = (L.eye.xz - L.grid.zw) / L.grid.y - 0.5;
  let i = u32(clamp(round(q.x), 0.0, f32(N - 1u)));
  let j = u32(clamp(round(q.y), 0.0, f32(N - 1u)));
  let k = idx(i, j);
  let c = stA[k];
  // (the highest lava surface in the 3x3 round it: the eye's in the lava under its own cell's or near it)
  var top = -1e9;
  for (var dj = -1; dj <= 1; dj++) {
    for (var di = -1; di <= 1; di++) {
      let ii = u32(clamp(i32(i) + di, 0, i32(N) - 1));
      let jj = u32(clamp(i32(j) + dj, 0, i32(N) - 1));
      let o = idx(ii, jj);
      if (stA[o].x > 0.05) { top = max(top, bed[o] + stA[o].z + stA[o].x); }
    }
  }
  probeOut[0] = c;
  probeOut[1] = vec4f(bed[k], bed[k] + c.z + c.x, top, f32(k));
}


@compute @workgroup_size(8, 8)
fn glow(@builtin(global_invocation_id) id: vec3u) {
  let G = nCells() / 8u;
  if (id.x >= G || id.y >= G) { return; }
  var e = 0.0; var hot = 0.0; var top = 0.0; var wt = 0.0;
  for (var dj = 0u; dj < 8u; dj++) {
    for (var di = 0u; di < 8u; di++) {
      let k = idx(id.x * 8u + di, id.y * 8u + dj);
      let c = stA[k];
      let g = lavaGlowOf(c);
      e += g; hot += g * max(c.y, c.w);
      if (c.x + c.z > 0.02) { top += bed[k] + c.z + c.x; wt += 1.0; }
    }
  }
  let K = 600.0 + 800.0 * hot / max(e, 1e-4);
  textureStore(glowOut, vec2u(id.xy), vec4f(e / 64.0, K, select(-1e4, top / max(wt, 1.0), wt > 0.0), wt / 64.0));
}

@compute @workgroup_size(1)
fn clearArgs() {
  // three indirect draws: (vertexCount, instanceCount, firstVertex, firstInstance) each; detail 0 32x32 quads, 1
  // 16x16, 2 8x8
  for (var d = 0u; d < 3u; d++) {
    let q = LAVA_TILE >> d;
    atomicStore(&args[d * 4u], q * q * 6u);
    atomicStore(&args[d * 4u + 1u], 0u);
    atomicStore(&args[d * 4u + 2u], 0u);
    atomicStore(&args[d * 4u + 3u], 0u);
  }
}

@compute @workgroup_size(64)
fn tiles(@builtin(global_invocation_id) id: vec3u) {
  let T = nCells() / LAVA_TILE;
  if (id.x >= T * T) { return; }
  let ti = id.x % T; let tj = id.x / T;
  var any = false;
  var lo = 1e9; var hi = -1e9;
  for (var dj = 0u; dj <= LAVA_TILE && !any; dj += 4u) {
    for (var di = 0u; di <= LAVA_TILE; di += 4u) {
      let i = min(ti * LAVA_TILE + di, nCells() - 1u);
      let j = min(tj * LAVA_TILE + dj, nCells() - 1u);
      let k = idx(i, j);
      let c = stA[k];
      if (c.x + c.z > 0.01) { any = true; break; }
    }
  }
  // (a thin flow can slip between the samples: a closer look at the tiles next to one that has some)
  if (!any) {
    for (var dj = 2u; dj < LAVA_TILE && !any; dj += 4u) {
      for (var di = 2u; di < LAVA_TILE; di += 4u) {
        let k = idx(ti * LAVA_TILE + di, tj * LAVA_TILE + dj);
        let c = stA[k];
        if (c.x + c.z > 0.01) { any = true; break; }
      }
    }
  }
  if (!any) { return; }
  let mid = L.grid.zw + (vec2f(f32(ti), f32(tj)) + 0.5) * f32(LAVA_TILE) * L.grid.y;
  let d = distance(mid, L.eye.xz) - f32(LAVA_TILE) * L.grid.y * 0.7;
  var lod = 2u;
  if (d < L.lod.x) { lod = 0u; } else if (d < L.lod.y) { lod = 1u; }
  let n = atomicAdd(&args[lod * 4u + 1u], 1u);
  lists[lod * T * T + n] = id.x;
}
