// A forest on the GPU (shaders/forest.wgsl): every tree — hundreds of thousands, 16 bytes each — culled and sorted
// each frame into near, far, impostor and shadow lists, with caps, the impostors thinned by seed far off, and the four
// indirect draws' counts written; nothing touched on the CPU after load. San Francisco's trees' frame, with nothing of
// its trees in it: the world's shader says what the ground under a tree is, whether it stands there and how far each
// kind is drawn (forestGround, forestAccept, forestReach) and includes loom/forest; its own draws read the lists.
//
//   const f = new Forest(kit, shader, { label: 'trees', caps: [5000, 25000, 110000, 5000], bind: { arch } });
//   f.load(decodeForest(bytes, { origin: [-8192, -20, -8192], step: [0.25, 2] }), { rooms });
//   f.setDynamic(featureInstances); // writes only the tail slice, zero static copy/upload
//   f.update({ near: 110, far: 450, imp: 3500, band: 54, shadow: 140, verts: [nearV, farV, 6, farV], user: [wind] });
//   computes.push(...f.passes());
//   pass.draw(shader, { bind: { ...f.drawBind(), ... }, indirect: { buffer: f.args, offset: f.argsOffset(0) } });
import type { Kit, RunEntry, Shader, StorageBuffer, UniformBuffer } from '@ericrius1/weft';

export interface ForestOptions {
  /** the buffers' and passes' labels: `${label}.cull`, `${label}.args`, `${label}.lists`… ('forest') */
  label?: string;
  /** the lists' capacities: near, far, impostor, shadow */
  caps: [number, number, number, number];
  /** more bindings for the cull (the world's group 2 from binding 6, what its hooks read) */
  bind?: Record<string, unknown>;
  /** the impostors' thinning: the share kept is clamp((far * factor / d)^2, thin.least, 1), those going shrink over `band`
   *  of the seeds (1.4, 0.3, 0.06) */
  thin?: { factor?: number; least?: number; band?: number };
  /** how far past the farthest reach an instance's stored foot may be before the ground under it is sampled (60 m) */
  slack?: number;
}

export interface ForestFrame {
  /** the near list's end, the far's, the impostors' (m) */
  near: number; far: number; imp: number;
  /** the far/impostor crossfade band (m) */
  band: number;
  /** the shadows' casters' reach (m) */
  shadow: number;
  /** optional reference far reach (m) for impostor thinning so shrinking `far` during fast flight keeps mid-distance impostor density steady */
  thinFar?: number;
  /** the four draws' vertices an instance: near, far, impostor, shadow */
  verts: [number, number, number, number];
  /** the world's own vec4s for its draws (up to 4) */
  user?: ArrayLike<number>[];
}

/** the compact format's frame: x = u16 * step[0] + origin[0], z likewise, y = u8 * step[1] + origin[1] (its stored foot) */
export interface ForestFrameOfReference { origin: [number, number, number]; step: [number, number] }

/** 'TRE2' */
export const FOREST_MAGIC = 0x32455254;
/** archetype slot mask in the runtime packed u32 (bits 0..7, 0..255) */
export const FOREST_ARCH_MASK = 255;
/** pinned-y flag in the runtime packed u32 (bit 31: 1 = use stored y directly, 0 = drape via forestGround) */
export const FOREST_PINNED_BIT = 0x80000000;

/** an instance's packed u32 (forest.wgsl forestUnpack):
 *  - bits  0..7  (8b): archetype slot (0..255)
 *  - bits  8..16 (9b): piecewise height (0..383 -> 0..38.3 m at 0.1 m; 384..511 -> 38.4..140.0 m at 0.8 m)
 *  - bits 17..23 (7b): piecewise crown radius (0..95 -> 0..9.5 m at 0.1 m; 96..127 -> 9.6..25.1 m at 0.5 m)
 *  - bits 24..30 (7b): seed (0..127 -> 0..1)
 *  - bit  31     (1b): pinnedY (1 = use exact stored y, 0 = drape on terrain via forestGround) */
export function packForest(arch: number, h: number, r: number, seed: number, pinned = false): number {
  const dm = Math.round(h * 10);
  const hh = dm <= 383 ? Math.max(0, dm) : Math.min(511, 384 + Math.max(0, Math.round((h - 38.4) * 1.25)));
  const rm = Math.round(r * 10);
  const rr = rm <= 95 ? Math.max(0, rm) : Math.min(127, 96 + Math.max(0, Math.round((r - 9.6) * 2)));
  const ss = Math.min(127, Math.max(0, Math.round(seed * 127)));
  return ((arch & FOREST_ARCH_MASK) | (hh << 8) | (rr << 17) | (ss << 24) | (pinned ? FOREST_PINNED_BIT : 0)) >>> 0;
}

/** unpack a runtime packed u32 produced by `packForest` */
export function unpackForest(k: number): { arch: number; h: number; r: number; seed: number; pinned: boolean } {
  const arch = k & FOREST_ARCH_MASK;
  const hh = (k >>> 8) & 511;
  const h = hh < 384 ? hh * 0.1 : 38.4 + (hh - 384) * 0.8;
  const rr = (k >>> 17) & 127;
  const r = rr < 96 ? rr * 0.1 : 9.6 + (rr - 96) * 0.5;
  const seed = ((k >>> 24) & 127) / 127;
  const pinned = (k & FOREST_PINNED_BIT) !== 0;
  return { arch, h, r, seed, pinned };
}

/** a compact forest ('TRE2': magic, n, then byte planes x lo, x hi, z lo, z hi, y, and the legacy packed u32's four
 *  bytes) back into 16 bytes an instance (x z y as f32, then the runtime packed u32) — and shuffled, so when a list
 *  fills, the ones it can't take are spread evenly rather than a neighbourhood. Anything else is taken as the 16-byte
 *  runtime records already. */
export function decodeForest(raw: Uint8Array, ref: ForestFrameOfReference, shuffle = true): Uint32Array {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.byteLength < 8 || dv.getUint32(0, true) !== FOREST_MAGIC) return new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2);
  const n = dv.getUint32(4, true);
  const b = raw.subarray(8);
  const P = (k: number) => b.subarray(k * n, (k + 1) * n);
  const [xl, xh, zl, zh, y, p0, p1, p2, p3] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(P);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  if (shuffle) {
    let s = 0x2545f491;
    for (let i = n - 1; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); const t = order[i]; order[i] = order[j]; order[j] = t; }
  }
  const [ox, oy, oz] = ref.origin, [sxz, sy] = ref.step;
  const u32 = new Uint32Array(n * 4);
  const f = new Float32Array(u32.buffer);
  for (let k = 0; k < n; k++) {
    const i = order[k], o = k * 4;
    f[o] = (xl[i] | (xh[i] << 8)) * sxz + ox;
    f[o + 1] = (zl[i] | (zh[i] << 8)) * sxz + oz;
    f[o + 2] = y[i] * sy + oy;
    // Repack legacy TRE2 (6b arch, 10b h dm, 8b r dm, 8b seed) into the runtime 32-bit layout.
    const leg = (p0[i] | (p1[i] << 8) | (p2[i] << 16) | (p3[i] << 24)) >>> 0;
    u32[o + 3] = packForest(leg & 63, ((leg >>> 6) & 1023) * 0.1, ((leg >>> 16) & 255) * 0.1, (leg >>> 24) / 255, false);
  }
  return u32;
}

const MAX_INSTANCES = 65535 * 64;
const DYNAMIC_HEADROOM = 4096;

export class Forest {
  readonly u: UniformBuffer<any>;
  readonly label: string;
  readonly caps: [number, number, number, number];
  /** the four lists end to end (16 bytes an entry: x, the ground's y, z, the packed u32) */
  readonly lists: StorageBuffer;
  readonly counters: StorageBuffer;
  /** the four indirect draws' args (16 bytes each: near, far, impostor, shadow) */
  readonly args: StorageBuffer;
  instances: StorageBuffer | null = null;
  /** total active instances (`staticCount + dynamicCount`) */
  count = 0;
  /** static instances loaded via `load()` at `[0 .. staticCount)` */
  staticCount = 0;
  /** dynamic tail instances written via `setDynamic()` at `[staticCount .. staticCount + dynamicCount)` */
  dynamicCount = 0;
  private instancesCap = 0;
  private staticSrc: Uint32Array | null = null;
  private dynamicSrc: Uint32Array | null = null;
  private cullPass: any = null;
  private lastBind: Record<string, unknown> | null = null;
  private computes: RunEntry[] = [];
  private thin: [number, number, number];
  private slack: number;
  private bind: Record<string, unknown>;

  constructor(readonly kit: Kit, readonly shader: Shader<any, any>, opts: ForestOptions) {
    const L = (this.label = opts.label ?? 'forest');
    this.caps = opts.caps;
    this.thin = [opts.thin?.factor ?? 1.4, opts.thin?.least ?? 0.3, opts.thin?.band ?? 0.06];
    this.slack = opts.slack ?? 60;
    this.bind = opts.bind ?? {};
    this.u = kit.uniforms(shader.structs.ForestU, L);
    const c = this.caps;
    this.lists = kit.storage({ label: `${L}.lists`, size: (c[0] + c[1] + c[2] + c[3]) * 16, usage: ['storage'] });
    this.counters = kit.storage({ label: `${L}.counters`, size: 48, usage: ['storage'] });
    this.args = kit.storage({ label: `${L}.args`, size: 64, usage: ['storage', 'indirect'] });
  }

  private sameBind(bind: Record<string, unknown>): boolean {
    if (!this.lastBind) return false;
    const ak = Object.keys(this.lastBind), bk = Object.keys(bind);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (this.lastBind[k] !== bind[k]) return false;
    return true;
  }

  private ensureInstances(need: number): boolean {
    if (!this.instances) {
      const cap = Math.min(MAX_INSTANCES, Math.max(DYNAMIC_HEADROOM, Math.ceil(Math.max(1, need) * 1.25) + DYNAMIC_HEADROOM));
      this.instances = this.kit.storage({ label: `${this.label}.instances`, size: cap * 16, usage: ['storage', 'copy-dst', 'copy-src'] });
      this.instancesCap = Math.floor(this.instances.size / 16);
      return true;
    }
    if (need <= this.instancesCap) return false;
    const cap = Math.min(MAX_INSTANCES, Math.max(need + DYNAMIC_HEADROOM, Math.ceil(need * 1.5)));
    this.instances.ensure(cap * 16);
    this.instancesCap = Math.floor(this.instances.size / 16);
    return true;
  }

  /** the static instances (16 bytes each: decodeForest's), and the two computes over them (`bind`: more of the world's
   *  bindings for its hooks, over the options'). Reuses the GPU buffer and compute passes whenever capacity fits, and
   *  preserves any active dynamic tail set via `setDynamic()`. */
  load(instances: Uint32Array, bind: Record<string, unknown> = {}) {
    const kit = this.kit, L = this.label;
    const maxStatic = Math.max(0, MAX_INSTANCES - this.dynamicCount);
    const n = Math.min(maxStatic, Math.floor(instances.length / 4));
    this.staticCount = n;
    this.count = this.staticCount + this.dynamicCount;
    const src = n * 4 < instances.length ? instances.subarray(0, n * 4) : instances;
    this.staticSrc = src;
    this.ensureInstances(this.count);
    if (src.byteLength) this.instances!.write(src, 0);
    if (this.dynamicCount > 0 && this.dynamicSrc) this.instances!.write(this.dynamicSrc, this.staticCount * 16);

    const bindSame = this.computes.length > 0 && this.sameBind(bind);
    if (bindSame) return;
    if (this.computes.length) kit.release(...(this.computes as unknown as { dispose(): void }[]));
    this.lastBind = { ...bind };
    const own = { forest: this.u, forestTrees: this.instances, forestLists: this.lists, forestCounters: this.counters, forestArgsOut: this.args };
    this.cullPass = kit.compute(this.shader, { label: `${L}.cull`, entry: 'forestCull', threads: () => [Math.max(1, this.count)], bind: { ...this.bind, ...bind, ...own } as never });
    this.computes = [
      this.cullPass,
      kit.compute(this.shader, { label: `${L}.args`, entry: 'forestWriteArgs', workgroups: [1], bind: { forest: this.u, forestCounters: this.counters, forestArgsOut: this.args } as never }),
    ];
  }

  /** write only the dynamic tail slice `[staticCount .. staticCount + dynamicCount)` without copying or re-uploading
   *  the static instances. Safe to call before or after `load()`. */
  setDynamic(instances: Uint32Array) {
    const maxDyn = Math.max(0, MAX_INSTANCES - this.staticCount);
    const n = Math.min(maxDyn, Math.floor(instances.length / 4));
    const src = n * 4 < instances.length ? instances.subarray(0, n * 4) : instances;
    this.dynamicSrc = src.length ? src.slice() : null;
    this.dynamicCount = n;
    this.count = this.staticCount + this.dynamicCount;
    if (!this.instances) return;
    const grew = this.ensureInstances(this.count);
    if (grew && this.staticCount > 0 && this.staticSrc) this.instances.write(this.staticSrc, 0);
    if (n > 0 && this.dynamicSrc) this.instances.write(this.dynamicSrc, this.staticCount * 16);
  }

  /** release all GPU buffers and compute passes owned by this forest */
  dispose() {
    if (this.computes.length) this.kit.release(...(this.computes as unknown as { dispose(): void }[]));
    this.computes = [];
    this.cullPass = null;
    this.lastBind = null;
    this.kit.release(this.instances, this.lists, this.counters, this.args, this.u);
    this.instances = null;
    this.instancesCap = 0;
    this.staticSrc = null;
    this.dynamicSrc = null;
    this.staticCount = 0;
    this.dynamicCount = 0;
    this.count = 0;
  }

  /** a frame's reaches, the draws' vertices, the world's own vec4s */
  update(f: ForestFrame) {
    const u = [0, 1, 2, 3].map((k) => (f.user?.[k] ? [f.user[k][0] ?? 0, f.user[k][1] ?? 0, f.user[k][2] ?? 0, f.user[k][3] ?? 0] : [0, 0, 0, 0]));
    const thinFactor = f.thinFar ? this.thin[0] * (f.thinFar / Math.max(1, f.far)) : this.thin[0];
    this.u.set({
      lod: [f.near, f.far, f.imp, f.band],
      caps: this.caps,
      verts: f.verts,
      counts: [this.count, f.shadow, this.slack, this.staticCount],
      thin: [thinFactor, this.thin[1], this.thin[2], 0],
      user: u as never,
    });
  }

  /** what a draw binds to read the lists: the uniform and forestVisible */
  drawBind(): { forest: UniformBuffer<any>; forestVisible: StorageBuffer } { return { forest: this.u, forestVisible: this.lists }; }

  /** list's (0 near, 1 far, 2 impostor, 3 shadow) indirect args' offset in `args` */
  argsOffset(list: number) { return list * 16; }

  /** the computes for this frame (the cull, then the args): none before load */
  passes(): RunEntry[] { return this.computes; }
}
