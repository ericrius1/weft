// Clustered point lights (clusters.ts): one thread a cell of the camera-centred light grid (envx.wgsl) tests every
// light's sphere against the cell's box and keeps the indices of those that touch it — the lights come sorted nearest
// the camera first, so a cell past its cap drops the farthest. The surfaces then loop their cell's lights alone
// (env.wgsl pointLightsAt …), so a scene can carry hundreds of lamps for the cost of the few around each pixel.
#include "./envx"

struct GridLight { pos: vec3f, radius: f32, color: vec3f, size: f32, dir: vec3f, cosOuter: f32, cosInner: f32, p0: f32, p1: f32, p2: f32 }
@group(2) @binding(0) var<uniform> gx: EnvX;
@group(2) @binding(1) var<storage, read> gridLights: array<GridLight>;
@group(2) @binding(2) var<storage, read_write> cellsOut: array<u32>;

@compute @workgroup_size(64) fn bin(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3u(gx.gridN.xyz);
  let total = n.x * n.y * n.z;
  let i = id.x;
  if (i >= total) { return; }
  let cx = i % n.x;
  let cy = (i / n.x) % n.y;
  let cz = i / (n.x * n.y);
  let nf = vec3f(n);
  let lo = gx.grid.xyz + vec3f(cellEdge(f32(cx), nf.x, gx.gridR.x), cellEdge(f32(cy), nf.y, gx.gridR.y), cellEdge(f32(cz), nf.z, gx.gridR.x));
  let hi = gx.grid.xyz + vec3f(cellEdge(f32(cx + 1u), nf.x, gx.gridR.x), cellEdge(f32(cy + 1u), nf.y, gx.gridR.y), cellEdge(f32(cz + 1u), nf.z, gx.gridR.x));
  let cap = u32(gx.gridR.z);
  let base = i * (cap + 1u);
  let cnt = u32(gx.gridR.w);
  var k = 0u;
  for (var li = 0u; li < cnt; li++) {
    let l = gridLights[li];
    let q = clamp(l.pos, lo, hi);
    let d = q - l.pos;
    if (dot(d, d) > l.radius * l.radius) { continue; }
    // (a spot: the cell has to be within its cone's reach — tested against the cone's bounding angle by the box's
    // centre, widened by the box's own size as seen from the light)
    if (l.cosOuter > -1.0) {
      let c = 0.5 * (lo + hi);
      let v = c - l.pos;
      let dist = length(v);
      let rad = length(hi - lo) * 0.5;
      if (dist > rad) {
        // (a squashed spot spreads wider than its cone: leave it be)
        let ang = acos(clamp(dot(v / dist, l.dir), -1.0, 1.0));
        if (l.p1 <= 1.0 && ang > acos(clamp(l.cosOuter, -1.0, 1.0)) + asin(clamp(rad / dist, 0.0, 1.0))) { continue; }
      }
    }
    cellsOut[base + 1u + k] = li;
    k++;
    if (k >= cap) { break; }
  }
  cellsOut[base] = k;
}
