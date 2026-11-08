// The environment's extras (env.wgsl binds this as envx; clusters.wgsl and probes.wgsl their own copy): the light grid
// (clustered point lights: clusters.ts) and the irradiance probe volume (diffuse GI: probes.ts).
//
// The light grid is centred on the camera and warped (a cell's index along each axis from sqrt of the distance), so
// cells are small near the eye and grow with distance: GX × GY × GZ cells over ±reach. Each cell holds the count of
// the lights touching it and then their indices into plights (at most `cap`, the nearest the camera first).
struct EnvX {
  grid: vec4f,     // xyz the grid's centre (the camera), w 1 when the lights are clustered
  gridR: vec4f,    // x reach across (m), y reach up and down (m), z cap (lights a cell), w lights in plights
  gridN: vec4f,    // cells x, y, z
  giMin: vec4f,    // the probe volume's least corner, w the probes' spacing (m)
  giN: vec4f,      // probes x, y, z, w 1 when GI is on
  giK: vec4f,      // x strength, y normal bias (spacings), z view bias (spacings), w the edge's fade (spacings)
}

/** the grid's cell containing a world point, or -1 outside it */
fn lightCell(e: EnvX, wp: vec3f) -> i32 {
  let r = vec3f(e.gridR.x, e.gridR.y, e.gridR.x);
  let d = (wp - e.grid.xyz) / r;
  let u = sign(d) * sqrt(abs(d));
  if (any(abs(u) >= vec3f(1.0))) { return -1; }
  let n = vec3i(e.gridN.xyz);
  let c = clamp(vec3i(floor((u * 0.5 + 0.5) * vec3f(n))), vec3i(0), n - 1);
  return (c.z * n.y + c.y) * n.x + c.x;
}
/** a cell's bounds along one axis, relative to the centre (inverse of the warp) */
fn cellEdge(i: f32, n: f32, reach: f32) -> f32 {
  let u = i / n * 2.0 - 1.0;
  return sign(u) * u * u * reach;
}
