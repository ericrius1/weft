// Coplanar triangle overlap detection and separation for triangle meshes.
//
// Two triangles lying in the same plane that overlap in area fight for the same pixels regardless of depth-buffer
// precision: subpixel vertex snapping gives them slightly different depth plane equations (2–200 ULPs depending on
// viewing angle), and TAAU's Halton jitter flips the winner every frame.
//
// This module finds every overlapping coplanar pair in O(T) average time (centroid-relative plane bucketing + normal
// neighbor check + 2D sweep-and-prune, zero-alloc 2D triangle clipping) and moves connected planar patches apart by a
// sub-millimetre epsilon:
//   - back-to-back touching solids: each face is recessed `-eps` into its own solid (never raised -> no edge slits)
//   - exact twins (two-sided sheet): each face is pushed `+eps` along its own normal
//   - same-facing overlaps: manifold opposite-half-edge patches never merge overlapping triangles; existing non-zero
//     separations keep their front/back order and widen to >= eps (never collapsing across zero); true coplanar pairs
//     use area-first (1.5x) then build-order tie-breaking.

export interface CoplanarOptions {
  /** normal-direction separation in world units (default 0.001 m = 1 mm) */
  eps?: number;
  /** plane-offset tolerance in world units for treating two faces as coplanar (default min(0.0005, eps * 0.5) m) */
  tol?: number;
  /** minimum shared overlap area to count as a coplanar pair (default 1e-5 m²) */
  minArea?: number;
  /** floats per vertex in `positions` (default 3 for tightly packed xyz) */
  stride?: number;
  /** float offset of x within each vertex stride (default 0) */
  offset?: number;
  /** number of vertices when `indices` is omitted (defaults to floor(positions.length / stride)) */
  vertexCount?: number;
}

export interface CoplanarPair {
  t1: number;
  t2: number;
  area: number;
  sameFacing: boolean;
}

export interface CoplanarStats {
  pairs: number;
  backToBack: number;
  twins: number;
  sameFacing: number;
  facesMoved: number;
  verticesMoved: number;
}

type IndexArray = Uint32Array | Uint16Array | readonly number[];
type FloatArray = Float32Array | Float64Array | number[];

// Scratch polygons for zero-alloc 2D Sutherland-Hodgman clipping (max 9 vertices for tri-vs-tri)
const polyA = new Float64Array(24);
const polyB = new Float64Array(24);

function triOverlap2D(
  ax0: number, ay0: number, ax1: number, ay1: number, ax2: number, ay2: number,
  bx0: number, by0: number, bx1: number, by1: number, bx2: number, by2: number,
): number {
  polyA[0] = ax0; polyA[1] = ay0;
  polyA[2] = ax1; polyA[3] = ay1;
  polyA[4] = ax2; polyA[5] = ay2;
  let n = 3;
  // Ensure clip triangle B is counter-clockwise
  let cx0 = bx0, cy0 = by0, cx1 = bx1, cy1 = by1, cx2 = bx2, cy2 = by2;
  if ((cx1 - cx0) * (cy2 - cy0) - (cy1 - cy0) * (cx2 - cx0) < 0) {
    cx1 = bx2; cy1 = by2; cx2 = bx1; cy2 = by1;
  }
  let src = polyA, dst = polyB;
  for (let e = 0; e < 3; e++) {
    const ex0 = e === 0 ? cx0 : e === 1 ? cx1 : cx2;
    const ey0 = e === 0 ? cy0 : e === 1 ? cy1 : cy2;
    const ex1 = e === 0 ? cx1 : e === 1 ? cx2 : cx0;
    const ey1 = e === 0 ? cy1 : e === 1 ? cy2 : cy0;
    const edx = ex1 - ex0, edy = ey1 - ey0;
    let out = 0;
    let px = src[(n - 1) * 2], py = src[(n - 1) * 2 + 1];
    let sp = edx * (py - ey0) - edy * (px - ex0);
    for (let k = 0; k < n; k++) {
      const qx = src[k * 2], qy = src[k * 2 + 1];
      const sq = edx * (qy - ey0) - edy * (qx - ex0);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        dst[out * 2] = px + (qx - px) * t;
        dst[out * 2 + 1] = py + (qy - py) * t;
        out++;
      }
      if (sq >= 0) {
        dst[out * 2] = qx;
        dst[out * 2 + 1] = qy;
        out++;
      }
      px = qx; py = qy; sp = sq;
    }
    if (out < 3) return 0;
    n = out;
    const tmp = src; src = dst; dst = tmp;
  }
  let area2 = 0;
  for (let k = 0; k < n; k++) {
    const kn = k + 1 < n ? k + 1 : 0;
    area2 += src[k * 2] * src[kn * 2 + 1] - src[kn * 2] * src[k * 2 + 1];
  }
  return 0.5 * Math.abs(area2);
}

interface TriCache {
  triCount: number;
  nx: Float64Array;
  ny: Float64Array;
  nz: Float64Array;
  area: Float64Array;
  cx: Float64Array;
  cy: Float64Array;
  cz: Float64Array;
  valid: Uint8Array;
  ax: Uint8Array;
  ox: number;
  oy: number;
  oz: number;
}

function buildTriCache(positions: FloatArray, indices: IndexArray | undefined, stride: number, offset: number, triCount: number): TriCache {
  const nx = new Float64Array(triCount);
  const ny = new Float64Array(triCount);
  const nz = new Float64Array(triCount);
  const area = new Float64Array(triCount);
  const cx = new Float64Array(triCount);
  const cy = new Float64Array(triCount);
  const cz = new Float64Array(triCount);
  const valid = new Uint8Array(triCount);
  const ax = new Uint8Array(triCount);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices ? indices[t * 3] : t * 3;
    const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2;
    const o0 = i0 * stride + offset, o1 = i1 * stride + offset, o2 = i2 * stride + offset;
    const ax0 = positions[o0], ay0 = positions[o0 + 1], az0 = positions[o0 + 2];
    const bx0 = positions[o1], by0 = positions[o1 + 1], bz0 = positions[o1 + 2];
    const cx0 = positions[o2], cy0 = positions[o2 + 1], cz0 = positions[o2 + 2];
    const ux = bx0 - ax0, uy = by0 - ay0, uz = bz0 - az0;
    const vx = cx0 - ax0, vy = cy0 - ay0, vz = cz0 - az0;
    const ex = uy * vz - uz * vy, ey = uz * vx - ux * vz, ez = ux * vy - uy * vx;
    const ln = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (ln <= 1e-9) continue;
    const inv = 1 / ln;
    const nxx = ex * inv, nyy = ey * inv, nzz = ez * inv;
    nx[t] = nxx; ny[t] = nyy; nz[t] = nzz;
    area[t] = 0.5 * ln;
    const mx = (ax0 + bx0 + cx0) / 3;
    const my = (ay0 + by0 + cy0) / 3;
    const mz = (az0 + bz0 + cz0) / 3;
    cx[t] = mx; cy[t] = my; cz[t] = mz;
    if (mx < minX) minX = mx; if (mx > maxX) maxX = mx;
    if (my < minY) minY = my; if (my > maxY) maxY = my;
    if (mz < minZ) minZ = mz; if (mz > maxZ) maxZ = mz;
    valid[t] = 1;
    const anx = Math.abs(nxx), any = Math.abs(nyy), anz = Math.abs(nzz);
    ax[t] = anx >= any && anx >= anz ? 0 : any >= anz ? 1 : 2;
  }
  const ox = Number.isFinite(minX) ? 0.5 * (minX + maxX) : 0;
  const oy = Number.isFinite(minY) ? 0.5 * (minY + maxY) : 0;
  const oz = Number.isFinite(minZ) ? 0.5 * (minZ + maxZ) : 0;
  return { triCount, nx, ny, nz, area, cx, cy, cz, valid, ax, ox, oy, oz };
}

// Half-space of 26-connected integer grid offsets in lexicographic forward order (plus (0,0,0) handled inline)
const NORM_NEIGHBORS: readonly [number, number, number][] = [
  [0, 0, 1],
  [0, 1, -1], [0, 1, 0], [0, 1, 1],
  [1, -1, -1], [1, -1, 0], [1, -1, 1],
  [1, 0, -1], [1, 0, 0], [1, 0, 1],
  [1, 1, -1], [1, 1, 0], [1, 1, 1],
];

function sweepCandidates(
  positions: FloatArray,
  indices: IndexArray | undefined,
  stride: number,
  offset: number,
  tol: number,
  minArea: number,
  cache: TriCache,
  listA: number[],
  listB: number[] | undefined,
  pairs: CoplanarPair[],
  seen: Set<number>,
) {
  const { triCount, nx, ny, nz, cx, cy, cz, ax } = cache;
  const nFirst = listA.length;
  const nTotal = nFirst + (listB ? listB.length : 0);
  if (nTotal < 2) return;
  const cand = listB ? listA.concat(listB) : listA;
  const a = ax[listA[0]];
  const u = a === 0 ? 1 : 0;
  const v = a === 2 ? 1 : 2;

  const coords = new Float64Array(nTotal * 6);
  const minU = new Float64Array(nTotal);
  const maxU = new Float64Array(nTotal);
  const minV = new Float64Array(nTotal);
  const maxV = new Float64Array(nTotal);
  const isFirst = new Uint8Array(nTotal);
  const order = new Int32Array(nTotal);
  for (let k = 0; k < nTotal; k++) {
    const t = cand[k];
    order[k] = k;
    isFirst[k] = k < nFirst ? 1 : 0;
    const i0 = indices ? indices[t * 3] : t * 3;
    const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2;
    const o0 = i0 * stride + offset, o1 = i1 * stride + offset, o2 = i2 * stride + offset;
    const u0 = positions[o0 + u], v0 = positions[o0 + v];
    const u1 = positions[o1 + u], v1 = positions[o1 + v];
    const u2 = positions[o2 + u], v2 = positions[o2 + v];
    coords[k * 6] = u0; coords[k * 6 + 1] = v0;
    coords[k * 6 + 2] = u1; coords[k * 6 + 3] = v1;
    coords[k * 6 + 4] = u2; coords[k * 6 + 5] = v2;
    minU[k] = u0 < u1 ? (u0 < u2 ? u0 : u2) : (u1 < u2 ? u1 : u2);
    maxU[k] = u0 > u1 ? (u0 > u2 ? u0 : u2) : (u1 > u2 ? u1 : u2);
    minV[k] = v0 < v1 ? (v0 < v2 ? v0 : v2) : (v1 < v2 ? v1 : v2);
    maxV[k] = v0 > v1 ? (v0 > v2 ? v0 : v2) : (v1 > v2 ? v1 : v2);
  }
  order.sort((p, q) => minU[p] - minU[q]);

  const onlyCross = !!listB && listA !== listB;
  for (let ii = 0; ii < nTotal; ii++) {
    const ka = order[ii];
    const ta = cand[ka];
    const aMaxU = maxU[ka], aMinV = minV[ka], aMaxV = maxV[ka];
    const aFirst = isFirst[ka];
    const anx = nx[ta], any = ny[ta], anz = nz[ta];
    const acx = cx[ta], acy = cy[ta], acz = cz[ta];
    const baseA = ka * 6;
    for (let jj = ii + 1; jj < nTotal; jj++) {
      const kb = order[jj];
      if (minU[kb] > aMaxU) break;
      if (onlyCross ? aFirst === isFirst[kb] : (!aFirst && !isFirst[kb])) continue;
      if (maxV[kb] < aMinV || minV[kb] > aMaxV) continue;
      const tb = cand[kb];
      const dotN = anx * nx[tb] + any * ny[tb] + anz * nz[tb];
      if (Math.abs(dotN) < 0.9999) continue;
      // Exact signed gap of tb's centroid off ta's plane (immune to far-from-origin offset amplification)
      const gap = Math.abs(anx * (cx[tb] - acx) + any * (cy[tb] - acy) + anz * (cz[tb] - acz));
      if (gap > tol) continue;
      const lo = ta < tb ? ta : tb, hi = ta < tb ? tb : ta;
      const pairKey = lo * triCount + hi;
      if (seen.has(pairKey)) continue;
      const baseB = kb * 6;
      const overlap = triOverlap2D(
        coords[baseA], coords[baseA + 1], coords[baseA + 2], coords[baseA + 3], coords[baseA + 4], coords[baseA + 5],
        coords[baseB], coords[baseB + 1], coords[baseB + 2], coords[baseB + 3], coords[baseB + 4], coords[baseB + 5],
      );
      seen.add(pairKey);
      if (overlap > minArea) pairs.push({ t1: lo, t2: hi, area: overlap, sameFacing: dotN > 0 });
    }
  }
}

function findPairsInternal(
  positions: FloatArray,
  indices: IndexArray | undefined,
  stride: number,
  offset: number,
  tol: number,
  minArea: number,
  cache: TriCache,
): CoplanarPair[] {
  const { triCount, nx, ny, nz, cx, cy, cz, valid, ax, ox, oy, oz } = cache;
  if (triCount < 2) return [];
  // Bucket triangles by quantized canonical normal (~0.9 deg cells; 26-neighbor checked) -> plane offset (mesh-centered)
  const N_SCALE = 64;
  const invTol = 1 / Math.max(tol, 1e-6);
  const normGroups = new Map<string, { knx: number; kny: number; knz: number; planes: Map<number, number[]> }>();
  for (let t = 0; t < triCount; t++) {
    if (!valid[t]) continue;
    const a = ax[t];
    const dom = a === 0 ? nx[t] : a === 1 ? ny[t] : nz[t];
    const sgn = dom < 0 ? -1 : 1;
    const cnx = nx[t] * sgn, cny = ny[t] * sgn, cnz = nz[t] * sgn;
    // Mesh-centered plane offset prevents float32 normal jitter from blowing up `d` on far-from-origin meshes
    const d = cnx * (cx[t] - ox) + cny * (cy[t] - oy) + cnz * (cz[t] - oz);
    const knx = Math.floor(cnx * N_SCALE), kny = Math.floor(cny * N_SCALE), knz = Math.floor(cnz * N_SCALE);
    const nKey = `${knx},${kny},${knz}`;
    let ng = normGroups.get(nKey);
    if (!ng) normGroups.set(nKey, (ng = { knx, kny, knz, planes: new Map() }));
    const kd = Math.floor(d * invTol);
    let list = ng.planes.get(kd);
    if (!list) ng.planes.set(kd, (list = []));
    list.push(t);
  }

  const pairs: CoplanarPair[] = [];
  const seen = new Set<number>();

  for (const ng of normGroups.values()) {
    // 1. Same normal bucket: check (kd) against (kd) and (kd + 1)
    for (const [kd, list] of ng.planes) {
      sweepCandidates(positions, indices, stride, offset, tol, minArea, cache, list, undefined, pairs, seen);
      const next = ng.planes.get(kd + 1);
      if (next) sweepCandidates(positions, indices, stride, offset, tol, minArea, cache, list, next, pairs, seen);
    }
    // 2. Neighbor normal buckets (covers quantization boundary seams for tilted/rotated planes)
    for (let ni = 0; ni < NORM_NEIGHBORS.length; ni++) {
      const [dx, dy, dz] = NORM_NEIGHBORS[ni];
      const other = normGroups.get(`${ng.knx + dx},${ng.kny + dy},${ng.knz + dz}`);
      if (!other) continue;
      for (const [kd, list] of ng.planes) {
        for (let dd = -1; dd <= 1; dd++) {
          const oList = other.planes.get(kd + dd);
          if (oList) sweepCandidates(positions, indices, stride, offset, tol, minArea, cache, list, oList, pairs, seen);
        }
      }
    }
  }
  return pairs;
}

/** Find all overlapping coplanar triangle pairs in a triangle mesh. */
export function findCoplanar(positions: FloatArray, indices?: IndexArray, opts: CoplanarOptions = {}): CoplanarPair[] {
  const stride = opts.stride ?? 3;
  const offset = opts.offset ?? 0;
  const eps = opts.eps ?? 0.001;
  const tol = opts.tol ?? Math.min(0.0005, eps * 0.5);
  const minArea = opts.minArea ?? 1e-5;
  const vCount = opts.vertexCount ?? Math.floor(positions.length / stride);
  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(vCount / 3);
  if (triCount < 2) return [];
  const cache = buildTriCache(positions, indices, stride, offset, triCount);
  return findPairsInternal(positions, indices, stride, offset, tol, minArea, cache);
}

function posKey(x: number, y: number, z: number): string {
  return `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
}

function sameTriVerts(
  positions: FloatArray, indices: IndexArray | undefined, stride: number, offset: number,
  t1: number, t2: number,
): boolean {
  const k1: string[] = [];
  const k2: string[] = [];
  for (let j = 0; j < 3; j++) {
    const i1 = indices ? indices[t1 * 3 + j] : t1 * 3 + j;
    const i2 = indices ? indices[t2 * 3 + j] : t2 * 3 + j;
    const o1 = i1 * stride + offset, o2 = i2 * stride + offset;
    k1.push(posKey(positions[o1], positions[o1 + 1], positions[o1 + 2]));
    k2.push(posKey(positions[o2], positions[o2 + 1], positions[o2 + 2]));
  }
  k1.sort(); k2.sort();
  return k1[0] === k2[0] && k1[1] === k2[1] && k1[2] === k2[2];
}

/**
 * Separate all overlapping coplanar triangle pairs in-place in `positions` by `eps` (default 1 mm) along face normals.
 * Works on tightly-packed or strided Float32/Float64 buffers, indexed or non-indexed. Returns counts of pairs resolved.
 */
export function separateCoplanar(positions: FloatArray, indices?: IndexArray, opts: CoplanarOptions = {}): CoplanarStats {
  const stride = opts.stride ?? 3;
  const offset = opts.offset ?? 0;
  const eps = opts.eps ?? 0.001;
  const tol = opts.tol ?? Math.min(0.0005, eps * 0.5);
  const minArea = opts.minArea ?? 1e-5;
  const vCount = opts.vertexCount ?? Math.floor(positions.length / stride);
  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(vCount / 3);
  const zero: CoplanarStats = { pairs: 0, backToBack: 0, twins: 0, sameFacing: 0, facesMoved: 0, verticesMoved: 0 };
  if (triCount < 2 || eps <= 0) return zero;

  const cache = buildTriCache(positions, indices, stride, offset, triCount);
  const pairs = findPairsInternal(positions, indices, stride, offset, tol, minArea, cache);
  if (!pairs.length) return zero;

  const { nx, ny, nz, area, cx, cy, cz, valid } = cache;

  // Build same-facing overlap conflict map so grow() NEVER merges two overlapping triangles into the same patch
  const sameOverlap = new Map<number, Set<number>>();
  const addConflict = (a: number, b: number) => {
    let sa = sameOverlap.get(a);
    if (!sa) sameOverlap.set(a, (sa = new Set()));
    sa.add(b);
  };
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.sameFacing) {
      addConflict(p.t1, p.t2);
      addConflict(p.t2, p.t1);
    }
  }

  // Directed half-edge adjacency (posKey(a) -> posKey(b)): two triangles of a quad or abutting tiles share an edge
  // with OPPOSITE direction (a->b vs b->a). Overlapping stacked boxes sharing a corner or same-directed outer edge
  // never have opposite half-edges and therefore stay separate patches instead of collapsing into p1 === p2.
  const halfEdges = new Map<string, number[]>();
  const triKeys: string[] = new Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    if (!valid[t]) continue;
    for (let j = 0; j < 3; j++) {
      const vi = indices ? indices[t * 3 + j] : t * 3 + j;
      const o = vi * stride + offset;
      triKeys[t * 3 + j] = posKey(positions[o], positions[o + 1], positions[o + 2]);
    }
    const k0 = triKeys[t * 3], k1 = triKeys[t * 3 + 1], k2 = triKeys[t * 3 + 2];
    const e0 = `${k0}|${k1}`, e1 = `${k1}|${k2}`, e2 = `${k2}|${k0}`;
    let l0 = halfEdges.get(e0); if (!l0) halfEdges.set(e0, (l0 = [])); l0.push(t);
    let l1 = halfEdges.get(e1); if (!l1) halfEdges.set(e1, (l1 = [])); l1.push(t);
    let l2 = halfEdges.get(e2); if (!l2) halfEdges.set(e2, (l2 = [])); l2.push(t);
  }

  // Grow manifold non-overlapping coplanar patches for every triangle involved in a pair
  const patchOf = new Int32Array(triCount).fill(-1);
  const patchTris: number[][] = [];
  const patchOrder: number[] = [];
  const patchArea: number[] = [];
  const patchNormal: [number, number, number][] = [];
  const patchPlaneD: number[] = [];

  const grow = (t0: number): number => {
    if (patchOf[t0] >= 0) return patchOf[t0];
    const pid = patchTris.length;
    const members: number[] = [];
    const memberSet = new Set<number>([t0]);
    const stack = [t0];
    patchOf[t0] = pid;
    const n0x = nx[t0], n0y = ny[t0], n0z = nz[t0];
    const c0x = cx[t0], c0y = cy[t0], c0z = cz[t0];
    let minT = t0, totalArea = 0;
    let sumD = 0;
    while (stack.length) {
      const t = stack.pop()!;
      members.push(t);
      if (t < minT) minT = t;
      totalArea += area[t];
      sumD += (n0x * cx[t] + n0y * cy[t] + n0z * cz[t]) * area[t];
      const base = t * 3;
      for (let j = 0; j < 3; j++) {
        const ka = triKeys[base + j];
        const kb = triKeys[base + (j === 2 ? 0 : j + 1)];
        // Opposite half-edge (kb -> ka) finds true manifold coplanar neighbors (e.g. a quad's second triangle)
        const neigh = halfEdges.get(`${kb}|${ka}`);
        if (!neigh) continue;
        for (let k = 0; k < neigh.length; k++) {
          const nb = neigh[k];
          if (patchOf[nb] >= 0) continue;
          if (n0x * nx[nb] + n0y * ny[nb] + n0z * nz[nb] < 0.99995) continue;
          if (Math.abs(n0x * (cx[nb] - c0x) + n0y * (cy[nb] - c0y) + n0z * (cz[nb] - c0z)) > Math.min(tol, 1e-4)) continue;
          // Refuse to merge if nb overlaps any triangle already in this patch
          const conf = sameOverlap.get(nb);
          let conflicts = false;
          if (conf) {
            for (const m of memberSet) if (conf.has(m)) { conflicts = true; break; }
          }
          if (conflicts) continue;
          patchOf[nb] = pid;
          memberSet.add(nb);
          stack.push(nb);
        }
      }
    }
    patchTris.push(members);
    patchOrder.push(minT);
    patchArea.push(totalArea);
    patchNormal.push([n0x, n0y, n0z]);
    patchPlaneD.push(totalArea > 0 ? sumD / totalArea : (n0x * c0x + n0y * c0y + n0z * c0z));
    return pid;
  };

  for (let i = 0; i < pairs.length; i++) {
    grow(pairs[i].t1);
    grow(pairs[i].t2);
  }

  const nPatches = patchTris.length;
  const move = new Float64Array(nPatches);
  // over[lo] = set of patches that must sit visually IN FRONT of lo (with signed plane separation >= eps)
  const over: Set<number>[] = Array.from({ length: nPatches }, () => new Set<number>());
  let nB2B = 0, nTwin = 0, nSame = 0;

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const p1 = patchOf[p.t1], p2 = patchOf[p.t2];
    if (p1 === p2) continue;
    if (p.sameFacing) {
      // Respect pre-existing plane order (> 0.1 mm) so we widen gaps instead of inverting them across zero;
      // for truly coplanar pairs, keep strictly smaller detail patches (1.5x) in front, else later-built wins.
      const [n1x, n1y, n1z] = patchNormal[p1];
      const signedGap = n1x * (cx[p.t2] - cx[p.t1]) + n1y * (cy[p.t2] - cy[p.t1]) + n1z * (cz[p.t2] - cz[p.t1]);
      let lo: number, hi: number;
      if (signedGap > 1e-4) { lo = p1; hi = p2; }
      else if (signedGap < -1e-4) { lo = p2; hi = p1; }
      else {
        const a1 = patchArea[p1], a2 = patchArea[p2];
        if (a1 * 1.5 < a2) { hi = p1; lo = p2; }
        else if (a2 * 1.5 < a1) { hi = p2; lo = p1; }
        else if (patchOrder[p1] < patchOrder[p2]) { lo = p1; hi = p2; }
        else { lo = p2; hi = p1; }
      }
      over[lo].add(hi);
      nSame++;
      continue;
    }
    if (sameTriVerts(positions, indices, stride, offset, p.t1, p.t2)) {
      if (eps > move[p1]) move[p1] = eps;
      if (eps > move[p2]) move[p2] = eps;
      nTwin++;
    } else {
      if (-eps < move[p1]) move[p1] = -eps;
      if (-eps < move[p2]) move[p2] = -eps;
      nB2B++;
    }
  }

  // Compute signed-gap-preserving recess for same-facing stacks (cycle-safe DFS with memoization):
  // guarantees (d_hi + move[hi]) - (d_lo + move[lo]) >= eps for every edge lo -> hi.
  const solved = new Uint8Array(nPatches);
  const visiting = new Uint8Array(nPatches);
  const solveMove = (pid: number): number => {
    if (solved[pid]) return move[pid];
    if (visiting[pid]) return move[pid];
    visiting[pid] = 1;
    let m = move[pid];
    if (over[pid].size > 0) {
      const [pnx, pny, pnz] = patchNormal[pid];
      const dLo = patchPlaneD[pid];
      for (const hi of over[pid]) {
        const mHi = solveMove(hi);
        const [hnx, hny, hnz] = patchNormal[hi];
        const sgn = pnx * hnx + pny * hny + pnz * hnz >= 0 ? 1 : -1;
        const dHi = patchPlaneD[hi] * sgn + mHi;
        const need = dHi - dLo - eps;
        if (need < m) m = need;
      }
    }
    visiting[pid] = 0;
    solved[pid] = 1;
    move[pid] = m;
    return m;
  };
  for (let pid = 0; pid < nPatches; pid++) solveMove(pid);

  // Accumulate per-vertex displacement along distinct face normals (orthogonal moves sum so a shared corner
  // lets each face take its full epsilon; parallel/opposite moves on a shared vertex keep the largest magnitude)
  const dispX = new Float64Array(vCount);
  const dispY = new Float64Array(vCount);
  const dispZ = new Float64Array(vCount);
  const touched = new Uint8Array(vCount);
  let facesMoved = 0;

  for (let pid = 0; pid < nPatches; pid++) {
    const m = move[pid];
    if (m === 0) continue;
    facesMoved++;
    const [pnx, pny, pnz] = patchNormal[pid];
    const dx = pnx * m, dy = pny * m, dz = pnz * m;
    const verts = new Set<number>();
    const tris = patchTris[pid];
    for (let k = 0; k < tris.length; k++) {
      const t = tris[k];
      verts.add(indices ? indices[t * 3] : t * 3);
      verts.add(indices ? indices[t * 3 + 1] : t * 3 + 1);
      verts.add(indices ? indices[t * 3 + 2] : t * 3 + 2);
    }
    for (const vi of verts) {
      // Project existing displacement onto this face's normal to avoid double-counting or canceling
      const along = dispX[vi] * pnx + dispY[vi] * pny + dispZ[vi] * pnz;
      if (Math.abs(along) < 1e-12) {
        dispX[vi] += dx; dispY[vi] += dy; dispZ[vi] += dz;
      } else if (Math.abs(m) > Math.abs(along)) {
        const delta = m - along;
        dispX[vi] += pnx * delta; dispY[vi] += pny * delta; dispZ[vi] += pnz * delta;
      }
      touched[vi] = 1;
    }
  }

  let verticesMoved = 0;
  for (let vi = 0; vi < vCount; vi++) {
    if (!touched[vi]) continue;
    const o = vi * stride + offset;
    positions[o] += dispX[vi];
    positions[o + 1] += dispY[vi];
    positions[o + 2] += dispZ[vi];
    verticesMoved++;
  }

  return { pairs: pairs.length, backToBack: nB2B, twins: nTwin, sameFacing: nSame, facesMoved, verticesMoved };
}
