// A forest on the GPU (shaders/forest.wgsl): every tree — hundreds of thousands, 16 bytes each — culled and sorted
// each frame into near, far, impostor and shadow lists, with caps, the impostors thinned by seed far off, and the four
// indirect draws' counts written; nothing touched on the CPU after load. San Francisco's trees' frame, with nothing of
// its trees in it: the world's shader says what the ground under a tree is, whether it stands there and how far each
// kind is drawn (forestGround, forestAccept, forestReach) and includes loom/forest; its own draws read the lists.
//
//   const f = new Forest(kit, shader, { label: 'trees', caps: [5000, 25000, 110000, 5000], bind: { arch } });
//   f.load(decodeForest(bytes, { origin: [-8192, -20, -8192], step: [0.25, 2] }), { rooms });
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
  /** the impostors' thinning: the share kept is clamp((far * factor / d)^2, least, 1), those going shrink over `band`
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
  /** the four draws' vertices an instance: near, far, impostor, shadow */
  verts: [number, number, number, number];
  /** the world's own vec4s for its draws (up to 4) */
  user?: ArrayLike<number>[];
}

/** the compact format's frame: x = u16 * step[0] + origin[0], z likewise, y = u8 * step[1] + origin[1] (its stored foot) */
export interface ForestFrameOfReference { origin: [number, number, number]; step: [number, number] }

/** 'TRE2' */
export const FOREST_MAGIC = 0x32455254;

/** a compact forest ('TRE2': magic, n, then byte planes x lo, x hi, z lo, z hi, y, and the packed u32's four bytes)
 *  back into 16 bytes an instance (x z y as f32, then the packed u32) — and shuffled, so when a list fills, the ones it
 *  can't take are spread evenly rather than a neighbourhood. Anything else is taken as the 16-byte records already. */
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
    u32[o + 3] = (p0[i] | (p1[i] << 8) | (p2[i] << 16) | (p3[i] << 24)) >>> 0;
  }
  return u32;
}

/** an instance's packed u32 (forest.wgsl forestUnpack): archetype (0..63), height and crown radius (m, to 0.1), seed (0..1) */
export function packForest(arch: number, h: number, r: number, seed: number): number {
  const hh = Math.min(1023, Math.max(0, Math.round(h * 10)));
  const rr = Math.min(255, Math.max(0, Math.round(r * 10)));
  const ss = Math.min(255, Math.max(0, Math.round(seed * 255)));
  return ((arch & 63) | (hh << 6) | (rr << 16) | (ss << 24)) >>> 0;
}

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
  count = 0;
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
    this.counters = kit.storage({ label: `${L}.counters`, size: 16, usage: ['storage'] });
    this.args = kit.storage({ label: `${L}.args`, size: 64, usage: ['storage', 'indirect'] });
  }

  /** the instances (16 bytes each: decodeForest's), and the two computes over them (`bind`: more of the world's
   *  bindings for its hooks, over the options') */
  load(instances: Uint32Array, bind: Record<string, unknown> = {}) {
    const kit = this.kit, L = this.label;
    this.count = instances.length / 4;
    this.instances = kit.storage({ label: `${L}.instances`, data: instances });
    const own = { forest: this.u, forestTrees: this.instances, forestLists: this.lists, forestCounters: this.counters, forestArgsOut: this.args };
    this.computes = [
      kit.compute(this.shader, { label: `${L}.cull`, entry: 'forestCull', threads: [this.count], bind: { ...this.bind, ...bind, ...own } as never }),
      kit.compute(this.shader, { label: `${L}.args`, entry: 'forestWriteArgs', workgroups: [1], bind: { forest: this.u, forestCounters: this.counters, forestArgsOut: this.args } as never }),
    ];
  }

  /** a frame's reaches, the draws' vertices, the world's own vec4s */
  update(f: ForestFrame) {
    const u = [0, 1, 2, 3].map((k) => (f.user?.[k] ? [f.user[k][0] ?? 0, f.user[k][1] ?? 0, f.user[k][2] ?? 0, f.user[k][3] ?? 0] : [0, 0, 0, 0]));
    this.u.set({
      lod: [f.near, f.far, f.imp, f.band],
      caps: this.caps,
      verts: f.verts,
      counts: [this.count, f.shadow, this.slack, 0],
      thin: [...this.thin, 0],
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
