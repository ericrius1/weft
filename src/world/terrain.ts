// A heightfield world for any game (loom): generated on the GPU at load by the game's own generator shader, read back
// for the CPU (collisions, placement), drawn as CDLOD — a quadtree of 32×32 patches picked by distance each frame,
// morphing into their parents' grid near the edge of their range so neighbours never crack.
//
// The generator (WGSL) provides four compute entries with these bindings:
//   rawHeight  (gen, heightOut)                      the land
//   finalize   (gen, heightIn, heightOut)            any carving after (roads, plateaus…) — may just copy
//   surface    (gen, heightIn, normalOut, splatOut, maskOut)   normals (dh/dx, dh/dz, ao, cavity), splat, masks
//   downsample (mipSrc, mipDst)                      the height mips
// and a uniform struct `Gen` whose fields the game fills (size, splatSize, half are set here).
import type { Kit, Texture, StorageBuffer } from '@ericrius1/weft';
import { clamp } from '@ericrius1/weft';

export const PATCH = 32;
export const LODS = 8;
export interface Node { x: number; z: number; size: number; lod: number }

export interface TerrainOptions {
  /** the world spans ±half metres */
  half: number;
  /** height map texels per side */
  size?: number;
  /** splat / mask texels per side */
  splatSize?: number;
  /** the smallest patch (m) */
  leaf?: number;
  /** the generator shader and the values for its Gen uniform (besides size, splatSize, half) */
  gen: any;
  params?: Record<string, unknown>;
  /** more resources for the generator's entries (by name: a road's field, a list of features…) */
  bind?: Record<string, unknown>;
  /** between the raw land and finalize: the raw heights (row-major, size²) — e.g. to lay a road out over them and hand
   *  its field to finalize through `bind` */
  beforeFinalize?: (raw: Float32Array, size: number) => void | Promise<void>;
}

export class HeightTerrain {
  heightTex!: Texture;
  normalTex!: Texture;
  splatTex!: Texture;
  maskTex!: Texture;
  heights = new Float32Array(0);
  splat = new Uint8Array(0);
  mask = new Uint8Array(0);
  readonly half: number;
  readonly size: number;
  readonly splatSize: number;
  readonly leaf: number;
  readonly cell: number;
  private minmax: Float32Array[] = [];
  readonly ranges: number[] = [];
  nodes: Node[] = [];
  nodeData = new Float32Array(4 * 2048);
  nodeBuf!: StorageBuffer;
  gridIndex!: StorageBuffer;
  gridCount = 0;
  /** below the world's edge (and outside it): the sea floor */
  outside = -80;

  constructor(private kit: Kit, private o: TerrainOptions) {
    this.half = o.half;
    this.size = o.size ?? 4096;
    this.splatSize = o.splatSize ?? 2048;
    this.leaf = o.leaf ?? 48;
    this.cell = (2 * this.half) / this.size;
    for (let l = 0; l < LODS; l++) this.ranges.push(this.leaf * Math.pow(2, l) * 2.4);
  }

  async generate(progress: (f: number, msg: string) => void = () => {}) {
    const k = this.kit, N = this.size, S = this.splatSize, gen = this.o.gen;
    this.heightTex = k.texture({ label: 'terrain.height', format: 'r32float', size: [N, N], mips: 'full', usage: ['sample', 'storage', 'copy-src'] });
    const raw = k.texture({ label: 'terrain.raw', format: 'r32float', size: [N, N], usage: ['sample', 'storage', 'copy-src'] });
    this.normalTex = k.texture({ label: 'terrain.normal', format: 'rgba16float', size: [N, N], usage: ['sample', 'storage', 'copy-src'] });
    this.splatTex = k.texture({ label: 'terrain.splat', format: 'rgba8unorm', size: [S, S], usage: ['sample', 'storage', 'copy-src'] });
    this.maskTex = k.texture({ label: 'terrain.mask', format: 'rgba8unorm', size: [S, S], usage: ['sample', 'storage', 'copy-src'] });
    const u = k.uniforms(gen.structs.Gen, 'terrain.gen').set({ size: N, splatSize: S, half: this.half, ...(this.o.params ?? {}) });
    const run = async (items: Parameters<Kit['run']>[0]) => { await k.ready(); k.run(items); await k.queue.onSubmittedWorkDone(); };
    progress(0.15, 'raising the land…');
    const extra = this.o.bind ?? {};
    const rawPass = k.compute(gen, { label: 'gen.raw', entry: 'rawHeight', bind: { gen: u, heightOut: raw, ...extra }, threads: [N, N] });
    const fin = k.compute(gen, { label: 'gen.finalize', entry: 'finalize', bind: { gen: u, heightIn: raw, heightOut: this.heightTex.mip(0), ...extra }, threads: [N, N] });
    const surf = k.compute(gen, { label: 'gen.surface', entry: 'surface', bind: { gen: u, heightIn: this.heightTex.mip(0), normalOut: this.normalTex, splatOut: this.splatTex, maskOut: this.maskTex, ...extra }, threads: [N, N] });
    const mips = [];
    for (let m = 1; m < this.heightTex.mips; m++) {
      const dim = Math.max(1, N >> m);
      mips.push(k.compute(gen, { label: `gen.mip${m}`, entry: 'downsample', bind: { mipSrc: this.heightTex.mip(m - 1), mipDst: this.heightTex.mip(m) }, threads: [dim, dim] }));
    }
    if (this.o.beforeFinalize) {
      await run([rawPass]);
      await this.o.beforeFinalize(new Float32Array(await raw.read(0)), N);
      await run([fin, surf, ...mips]);
    } else await run([rawPass, fin, surf, ...mips]);
    progress(0.4, 'reading the land…');
    const [h, s, m] = await Promise.all([this.heightTex.read(0), this.splatTex.read(0), this.maskTex.read(0)]);
    this.heights = new Float32Array(h);
    this.splat = new Uint8Array(s);
    this.mask = new Uint8Array(m);
    raw.destroy();
    this.buildMinMax();
    this.buildGrid();
  }

  // ---------------------------------------------------------------- CPU queries
  height(x: number, z: number) {
    const n = this.size, half = this.half, cell = this.cell;
    const fx = (x + half) / cell - 0.5, fz = (z + half) / cell - 0.5;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return this.outside;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const H = this.heights;
    const a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  normal(x: number, z: number): [number, number, number] {
    const e = this.cell;
    const hx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const hz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    const l = Math.hypot(hx, 1, hz);
    return [-hx / l, 1 / l, -hz / l];
  }
  private sample8(arr: Uint8Array, x: number, z: number): [number, number, number, number] {
    const n = this.splatSize, half = this.half;
    const i = clamp(Math.floor(((x + half) / (2 * half)) * n), 0, n - 1), j = clamp(Math.floor(((z + half) / (2 * half)) * n), 0, n - 1);
    const o = (j * n + i) * 4;
    return [arr[o] / 255, arr[o + 1] / 255, arr[o + 2] / 255, arr[o + 3] / 255];
  }
  splatAt(x: number, z: number) { return this.sample8(this.splat, x, z); }
  maskAt(x: number, z: number) { return this.sample8(this.mask, x, z); }

  // ---------------------------------------------------------------- CDLOD
  private buildMinMax() {
    const n0 = (2 * this.half) / this.leaf;
    const per = this.leaf / this.cell;
    let lv = new Float32Array(n0 * n0 * 2);
    for (let j = 0; j < n0; j++) for (let i = 0; i < n0; i++) {
      let lo = Infinity, hi = -Infinity;
      for (let y = 0; y <= per; y += 4) for (let x = 0; x <= per; x += 4) {
        const hx = Math.min(this.size - 1, Math.floor(i * per + x)), hy = Math.min(this.size - 1, Math.floor(j * per + y));
        const h = this.heights[hy * this.size + hx];
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      lv[(j * n0 + i) * 2] = lo - 2;
      lv[(j * n0 + i) * 2 + 1] = hi + 2;
    }
    this.minmax = [lv];
    let n = n0;
    while (n > 1) {
      const m = n >> 1;
      const next = new Float32Array(m * m * 2);
      for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
        let lo = Infinity, hi = -Infinity;
        for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const o = ((j * 2 + dj) * n + i * 2 + di) * 2;
          lo = Math.min(lo, lv[o]); hi = Math.max(hi, lv[o + 1]);
        }
        next[(j * m + i) * 2] = lo; next[(j * m + i) * 2 + 1] = hi;
      }
      this.minmax.push(next);
      lv = next;
      n = m;
    }
  }
  private buildGrid() {
    const n = PATCH + 1;
    const idx = new Uint32Array(PATCH * PATCH * 6);
    let o = 0;
    for (let y = 0; y < PATCH; y++) for (let x = 0; x < PATCH; x++) {
      const a = y * n + x, b = a + 1, c = a + n, d = c + 1;
      if ((x + y) & 1) idx.set([a, c, b, b, c, d], o); else idx.set([a, c, d, a, d, b], o);
      o += 6;
    }
    this.gridIndex = this.kit.storage({ label: 'terrain.grid', data: idx, usage: ['index', 'storage', 'copy-dst'] });
    this.gridCount = idx.length;
    this.nodeBuf = this.kit.storage({ label: 'terrain.nodes', size: this.nodeData.byteLength });
  }

  /** pick this frame's patches for a camera (position + frustum planes) */
  select(cam: ArrayLike<number>, planes: Float32Array | null, maxLod = LODS - 1) {
    this.nodes = [];
    const half = this.half;
    const visit = (lod: number, i: number, j: number) => {
      const size = this.leaf * Math.pow(2, lod);
      const x0 = -half + i * size, z0 = -half + j * size;
      const mm = this.minmax[lod];
      const nPer = (2 * half) / size;
      const lo = mm[(j * nPer + i) * 2], hi = Math.max(mm[(j * nPer + i) * 2 + 1], 1.5);
      if (planes) {
        for (let p = 0; p < 6; p++) {
          const a = planes[p * 4], b = planes[p * 4 + 1], c = planes[p * 4 + 2], d = planes[p * 4 + 3];
          const px = a > 0 ? x0 + size : x0, py = b > 0 ? hi : lo, pz = c > 0 ? z0 + size : z0;
          if (a * px + b * py + c * pz + d < 0) return;
        }
      }
      const dx = Math.max(x0 - cam[0], 0, cam[0] - (x0 + size)), dz = Math.max(z0 - cam[2], 0, cam[2] - (z0 + size));
      const dy = Math.max(lo - cam[1], 0, cam[1] - hi);
      const dist = Math.hypot(dx, dy, dz);
      if (lod === 0 || dist > this.ranges[lod - 1]) {
        if (this.nodes.length < 2048) this.nodes.push({ x: x0, z: z0, size, lod });
        return;
      }
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) visit(lod - 1, i * 2 + di, j * 2 + dj);
    };
    const top = Math.min(LODS - 1, maxLod, Math.round(Math.log2((2 * half) / this.leaf)));
    const nTop = (2 * half) / (this.leaf * Math.pow(2, top));
    for (let j = 0; j < nTop; j++) for (let i = 0; i < nTop; i++) visit(top, i, j);
    const d = this.nodeData;
    this.nodes.forEach((nd, i) => { d[i * 4] = nd.x; d[i * 4 + 1] = nd.z; d[i * 4 + 2] = nd.size; d[i * 4 + 3] = nd.lod; });
    return this.nodes.length;
  }
  uploadNodes(buf = this.nodeBuf, count = this.nodes.length) {
    if (count) buf.write(this.nodeData.subarray(0, count * 4));
  }
}
