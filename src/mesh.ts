// Procedural meshes on the CPU, drawn by vertex pulling: build with boxes, cylinders, spheres, lathes and quads
// under a transform stack, then upload once. One vertex = 40 bytes (weft/mesh.wgsl's MeshVertex): position,
// normal, uv, an sRGB colour (rgba8) and a material id the shader can switch on.
import type { Kit } from './kit';
import type { StorageBuffer } from './resources';
import { type V3, type M4, mat4, mat4Mul, mat4Invert, compose, quatAxisAngle, norm, cross, sub } from './math';

export const VERTEX_BYTES = 40;

const toSrgb8 = (c: number) => {
  const x = Math.max(0, Math.min(1, c));
  return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255);
};
export const packColor = (c: ArrayLike<number>) => (toSrgb8(c[0]) | (toSrgb8(c[1]) << 8) | (toSrgb8(c[2]) << 16) | (Math.round(Math.max(0, Math.min(1, c[3] ?? 1)) * 255) << 24)) >>> 0;

export interface GpuMesh { vertices: StorageBuffer; indices: StorageBuffer; count: number; vertexCount: number }

export class MeshBuilder {
  private f: number[] = [];
  private u: number[] = [];
  private idx: number[] = [];
  private stack: M4[] = [];
  m: M4 = mat4();
  private nm: M4 = mat4();
  /** linear rgba for the next primitives */
  color: number[] = [0.8, 0.8, 0.8, 1];
  mat = 0;
  /** uv scale: uvs are in metres × this (so tiling textures stay square) */
  uvScale = 1;

  get vertexCount() { return this.f.length / 8; }
  get indexCount() { return this.idx.length; }

  push() { this.stack.push(this.m.slice() as M4); return this; }
  pop() { this.m = this.stack.pop() ?? mat4(); this.updateNormal(); return this; }
  private updateNormal() {
    const inv = mat4Invert(this.m);
    // normal matrix = transpose(inverse(m)) (upper 3×3)
    const n = this.nm;
    n[0] = inv[0]; n[1] = inv[4]; n[2] = inv[8];
    n[4] = inv[1]; n[5] = inv[5]; n[6] = inv[9];
    n[8] = inv[2]; n[9] = inv[6]; n[10] = inv[10];
  }
  apply(t: ArrayLike<number>) { mat4Mul(this.m, t, this.m); this.updateNormal(); return this; }
  translate(x: number, y: number, z: number) { return this.apply(compose([0, 0, 0, 1], [x, y, z], 1)); }
  rotate(axis: V3, a: number) { return this.apply(compose(quatAxisAngle(axis, a), [0, 0, 0], 1)); }
  rotateY(a: number) { return this.rotate([0, 1, 0], a); }
  rotateX(a: number) { return this.rotate([1, 0, 0], a); }
  rotateZ(a: number) { return this.rotate([0, 0, 1], a); }
  scale(x: number, y = x, z = x) { return this.apply(compose([0, 0, 0, 1], [0, 0, 0], [x, y, z])); }
  setColor(c: ArrayLike<number>, mat = this.mat) { this.color = [c[0], c[1], c[2], c[3] ?? 1]; this.mat = mat; return this; }

  /** add a vertex (local space); returns its index */
  vertex(p: ArrayLike<number>, n: ArrayLike<number>, uv: ArrayLike<number> = [0, 0], color = this.color, mat = this.mat) {
    const m = this.m, q = this.nm;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    let nx = q[0] * n[0] + q[4] * n[1] + q[8] * n[2], ny = q[1] * n[0] + q[5] * n[1] + q[9] * n[2], nz = q[2] * n[0] + q[6] * n[1] + q[10] * n[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.f.push(x, y, z, nx, ny, nz, uv[0] * this.uvScale, uv[1] * this.uvScale);
    this.u.push(packColor(color), mat);
    return this.f.length / 8 - 1;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); return this; }
  /** a quad from four corners (counter-clockwise seen from the front) */
  quad(p0: V3, p1: V3, p2: V3, p3: V3, uvw = 1, uvh = 1) {
    const n = norm(cross(sub(p1, p0), sub(p3, p0)));
    const a = this.vertex(p0, n, [0, 0]), b = this.vertex(p1, n, [uvw, 0]), c = this.vertex(p2, n, [uvw, uvh]), d = this.vertex(p3, n, [0, uvh]);
    this.idx.push(a, b, c, a, c, d);
    return this;
  }
  /** axis-aligned box centred on the origin (current transform applies) */
  box(w: number, h: number, d: number) {
    const x = w / 2, y = h / 2, z = d / 2;
    this.quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], w, h); // +z
    this.quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], w, h); // -z
    this.quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], d, h); // +x
    this.quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], d, h); // -x
    this.quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], w, d); // +y
    this.quad([-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], w, d); // -y
    return this;
  }
  /** box from min corner to max corner */
  boxMinMax(a: V3, b: V3) {
    this.push().translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2).box(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]));
    return this.pop();
  }
  /** cylinder along y, centred, with optional caps */
  cylinder(r: number, h: number, seg = 16, caps = true, r2 = r) {
    const base = this.vertexCount;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const slope = (r - r2) / h;
      const n = norm([c, slope, s]);
      this.vertex([c * r, -h / 2, s * r], n, [(i / seg) * Math.PI * 2 * r, 0]);
      this.vertex([c * r2, h / 2, s * r2], n, [(i / seg) * Math.PI * 2 * r, h]);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    if (caps) {
      for (const [y, rr, ny] of [[h / 2, r2, 1], [-h / 2, r, -1]] as const) {
        const ctr = this.vertex([0, y, 0], [0, ny, 0], [0, 0]);
        const first = this.vertexCount;
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          this.vertex([Math.cos(a) * rr, y, Math.sin(a) * rr], [0, ny, 0], [Math.cos(a) * rr, Math.sin(a) * rr]);
        }
        for (let i = 0; i < seg; i++) {
          if (ny > 0) this.idx.push(ctr, first + i + 1, first + i);
          else this.idx.push(ctr, first + i, first + i + 1);
        }
      }
    }
    return this;
  }
  sphere(r: number, seg = 16, rings = 10) {
    const base = this.vertexCount;
    for (let j = 0; j <= rings; j++) {
      const v = j / rings, phi = v * Math.PI;
      for (let i = 0; i <= seg; i++) {
        const u = i / seg, th = u * Math.PI * 2;
        const n: V3 = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
        this.vertex([n[0] * r, n[1] * r, n[2] * r], n, [u * Math.PI * 2 * r, v * Math.PI * r]);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = base + j * (seg + 1) + i, b = a + seg + 1;
        this.idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    return this;
  }
  /** surface of revolution around y from a profile of [radius, y] points (bottom to top) */
  lathe(profile: [number, number][], seg = 24) {
    const base = this.vertexCount;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      for (let k = 0; k < profile.length; k++) {
        const [r, y] = profile[k];
        const [r0, y0] = profile[Math.max(0, k - 1)], [r1, y1] = profile[Math.min(profile.length - 1, k + 1)];
        const dr = r1 - r0, dy = y1 - y0;
        const n = norm([c * dy, -dr, s * dy]);
        this.vertex([c * r, y, s * r], n, [i / seg, k / (profile.length - 1)]);
      }
    }
    const P = profile.length;
    for (let i = 0; i < seg; i++) {
      for (let k = 0; k < P - 1; k++) {
        const a = base + i * P + k, b = a + P;
        this.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    return this;
  }
  /** a flat polygon (convex, counter-clockwise from the front) */
  polygon(pts: V3[]) {
    const n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    const ids = pts.map((p) => this.vertex(p, n, [p[0], p[2]]));
    for (let i = 1; i < ids.length - 1; i++) this.idx.push(ids[0], ids[i], ids[i + 1]);
    return this;
  }
  /** a tube along a path (neon signs, pipes, trunks); r may taper: a function of the path parameter 0..1 */
  tube(path: V3[], r: number | ((t: number) => number), seg = 8, closed = false) {
    const rad = typeof r === 'number' ? () => r : r;
    const base = this.vertexCount;
    const N = path.length;
    for (let k = 0; k < N; k++) {
      const p = path[k];
      const a = path[Math.max(0, k - 1)], b = path[Math.min(N - 1, k + 1)];
      const t = norm(sub(b, a));
      let up: V3 = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const nx = norm(cross(up, t));
      up = cross(t, nx);
      const rk = rad(N > 1 ? k / (N - 1) : 0);
      for (let i = 0; i <= seg; i++) {
        const ang = (i / seg) * Math.PI * 2;
        const n: V3 = [nx[0] * Math.cos(ang) + up[0] * Math.sin(ang), nx[1] * Math.cos(ang) + up[1] * Math.sin(ang), nx[2] * Math.cos(ang) + up[2] * Math.sin(ang)];
        this.vertex([p[0] + n[0] * rk, p[1] + n[1] * rk, p[2] + n[2] * rk], n, [i / seg, k]);
      }
    }
    for (let k = 0; k < (closed ? N : N - 1); k++) {
      const k2 = (k + 1) % N;
      for (let i = 0; i < seg; i++) {
        const a = base + k * (seg + 1) + i, b = base + k2 * (seg + 1) + i;
        this.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    return this;
  }
  /** extrude a profile drawn in the (z, y) plane (counter-clockwise, simple polygon) along x from x0 to x1.
   *  `edge(i)` may restyle the side face of edge i → i+1 (return a colour / material); caps use the current style. */
  extrudeX(profile: [number, number][], x0: number, x1: number, o: { caps?: boolean; edge?: (i: number) => { color?: ArrayLike<number>; mat?: number; skip?: boolean } | void } = {}) {
    const n = profile.length;
    const keep = { color: this.color.slice(), mat: this.mat };
    if (o.caps !== false) {
      const tris = triangulate(profile);
      for (const [x, nx] of [[x1, 1], [x0, -1]] as const) {
        const ids = profile.map(([z, y]) => this.vertex([x, y, z], [nx, 0, 0], [z, y]));
        for (let t = 0; t < tris.length; t += 3) {
          // looking from +x the (z, y) polygon is clockwise, so flip there
          if (nx > 0) this.idx.push(ids[tris[t]], ids[tris[t + 2]], ids[tris[t + 1]]);
          else this.idx.push(ids[tris[t]], ids[tris[t + 1]], ids[tris[t + 2]]);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const style = o.edge?.(i);
      if (style && style.skip) continue;
      if (style?.color) this.color = [style.color[0], style.color[1], style.color[2], style.color[3] ?? 1];
      if (style?.mat !== undefined) this.mat = style.mat;
      const [za, ya] = profile[i], [zb, yb] = profile[(i + 1) % n];
      // outward normal of a counter-clockwise (z, y) edge
      this.quad([x1, ya, za], [x1, yb, zb], [x0, yb, zb], [x0, ya, za], Math.hypot(zb - za, yb - ya), x1 - x0);
      this.color = keep.color.slice(); this.mat = keep.mat;
    }
    return this;
  }

  /** append another builder's geometry (already in world space) */
  merge(o: MeshBuilder) {
    const off = this.vertexCount;
    for (const x of o.f) this.f.push(x);
    for (const x of o.u) this.u.push(x);
    for (const i of o.idx) this.idx.push(i + off);
    return this;
  }
  /** interleaved vertex data (40 bytes per vertex) */
  data() {
    const n = this.vertexCount;
    const buf = new ArrayBuffer(n * VERTEX_BYTES);
    const fv = new Float32Array(buf), uv = new Uint32Array(buf);
    const f = this.f, u = this.u;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 8; k++) fv[i * 10 + k] = f[i * 8 + k];
      uv[i * 10 + 8] = u[i * 2];
      uv[i * 10 + 9] = u[i * 2 + 1];
    }
    return { vertices: buf, indices: new Uint32Array(this.idx) };
  }
  upload(kit: Kit, label = 'mesh'): GpuMesh {
    const { vertices, indices } = this.data();
    return {
      vertices: kit.storage({ label: `${label}.v`, data: vertices, stride: VERTEX_BYTES }),
      indices: kit.storage({ label: `${label}.i`, data: indices, usage: ['index', 'storage', 'copy-dst'] }),
      count: indices.length,
      vertexCount: this.vertexCount,
    };
  }
}

/** ear-clipping triangulation of a simple polygon (counter-clockwise); returns index triples */
export function triangulate(poly: ArrayLike<number>[]): number[] {
  const idx = poly.map((_, i) => i);
  const out: number[] = [];
  const area = (a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  const inside = (p: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>) => area(a, b, p) >= 0 && area(b, c, p) >= 0 && area(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      if (area(a, b, c) <= 1e-12) continue;
      let ear = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inside(poly[j], a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}
