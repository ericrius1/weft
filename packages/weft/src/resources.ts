// GPU resources with identities and versions. A bind group remembers the (uid, version) of everything it holds, so a
// resize, a buffer that grew, or a ping-pong swap just produces a different identity and a fresh (or cached) bind
// group: nothing ever binds a destroyed texture. Every reallocation also bumps kit.resourceGen, which tells the binder
// when bind groups of direct resources need checking at all. destroy() frees a resource for good: it leaves the kit's
// sets, so a resize doesn't bring it back and the memory tally (kit.memory) drops it.
import type { Kit } from './kit';
import type { StructDef } from './shader';
import { StructView, type DeepPartial } from './struct';
import { BUF, TEX, MAP } from './gpuconst';

let UID = 1;
export const nextUid = () => UID++;
const rawIds = new WeakMap<object, number>();
/** a stable id for raw GPU objects handed to the kit */
export const rawUid = (o: object) => { let id = rawIds.get(o); if (!id) rawIds.set(o, (id = UID++)); return id; };

export interface Resource { readonly uid: number; version: number; label: string }

/** a value resolved at bind / encode time (ping-pong sides, views of a mip, …) */
export class Ref<T = unknown> {
  constructor(readonly get: () => T, readonly label = 'ref') {}
}
export const deref = (v: unknown): unknown => { while (v instanceof Ref) v = v.get(); return v; };

// ---------------------------------------------------------------- buffers
export type BufferUse = 'storage' | 'uniform' | 'vertex' | 'index' | 'indirect' | 'copy-src' | 'copy-dst' | 'map-read' | 'query';
const BU: Record<BufferUse, number> = {
  storage: BUF.STORAGE, uniform: BUF.UNIFORM, vertex: BUF.VERTEX, index: BUF.INDEX,
  indirect: BUF.INDIRECT, 'copy-src': BUF.COPY_SRC, 'copy-dst': BUF.COPY_DST,
  'map-read': BUF.MAP_READ, query: BUF.QUERY_RESOLVE,
};
export const bufferUsage = (u: BufferUse[]) => u.reduce((a, x) => a | BU[x], 0);

/** a uniform buffer laid out from a WGSL struct; dirty values upload once at the start of the next kit.run() */
export class UniformBuffer<T = Record<string, unknown>> implements Resource {
  readonly uid = nextUid();
  private v = 1;
  gpu: GPUBuffer;
  view: StructView<T>;
  dirty = true;
  destroyed = false;
  private layoutVersion: number;
  constructor(private kit: Kit, readonly def: StructDef<T>, public label: string) {
    this.view = new StructView(def);
    this.layoutVersion = def.version;
    this.gpu = kit.device.createBuffer({ label, size: this.view.data.byteLength, usage: BUF.UNIFORM | BUF.COPY_DST });
  }
  /** bumped when its GPU buffer is replaced (and kit.resourceGen with it, so bind groups are checked again) */
  get version() { return this.v; }
  set version(n: number) { this.v = n; this.kit.resourceGen++; }
  set(values: DeepPartial<T>) { this.view.set(values); this.dirty = true; return this; }
  get(field: keyof T & string) { return this.view.get(field); }
  /** upload now if dirty (kit.run does this for every uniform buffer) */
  upload() {
    if (this.destroyed) return;
    if (this.def.version !== this.layoutVersion) this.relayout();
    if (!this.dirty) return;
    this.kit.queue.writeBuffer(this.gpu, 0, this.view.data);
    this.dirty = false;
  }
  // a hot edit changed the struct: re-lay out, carrying every field that still exists over by name
  private relayout() {
    const old = this.view.toObject();
    this.view = new StructView(this.def);
    const keep: Record<string, unknown> = {};
    for (const f of this.def.fields) if (f.name in old) keep[f.name] = old[f.name];
    try { this.view.set(keep as DeepPartial<T>); } catch { /* a field changed type: leave it zero */ }
    this.layoutVersion = this.def.version;
    if (this.gpu.size < this.view.data.byteLength) {
      this.gpu.destroy();
      this.gpu = this.kit.device.createBuffer({ label: this.label, size: this.view.data.byteLength, usage: BUF.UNIFORM | BUF.COPY_DST });
      this.version++;
    }
    this.dirty = true;
  }
  /** free it for good (it's no longer uploaded) */
  destroy() {
    this.gpu.destroy();
    this.destroyed = true;
    this.kit.uniformBuffers.delete(this as UniformBuffer<any>);
  }
}

export interface StorageOptions {
  label?: string;
  /** size in bytes; or count × (struct size | stride | 4) */
  size?: number;
  count?: number;
  struct?: StructDef<unknown>;
  stride?: number;
  usage?: BufferUse[];
  data?: ArrayBufferView | ArrayBuffer;
}

export class StorageBuffer implements Resource {
  readonly uid = nextUid();
  private v = 1;
  gpu!: GPUBuffer;
  size = 0;
  count: number;
  stride: number;
  label: string;
  readonly usage: number;
  constructor(private kit: Kit, o: StorageOptions) {
    this.label = o.label ?? 'storage';
    this.stride = o.stride ?? (o.struct ? Math.ceil(o.struct.size / o.struct.align) * o.struct.align : 4);
    const dataBytes = o.data ? o.data.byteLength : 0;
    this.count = o.count ?? (o.size ? Math.floor(o.size / this.stride) : Math.floor(dataBytes / this.stride));
    const size = o.size ?? Math.max(this.count * this.stride, dataBytes);
    this.usage = bufferUsage(o.usage ?? ['storage', 'copy-dst', 'copy-src']) | BUF.COPY_DST;
    this.alloc(size);
    if (o.data) this.write(o.data);
  }
  /** bumped when its GPU buffer is replaced (and kit.resourceGen with it, so bind groups are checked again) */
  get version() { return this.v; }
  set version(n: number) { this.v = n; this.kit.resourceGen++; }
  private alloc(size: number) {
    this.size = Math.max(16, Math.ceil(size / 16) * 16);
    this.gpu = this.kit.device.createBuffer({ label: this.label, size: this.size, usage: this.usage });
  }
  write(data: ArrayBufferView | ArrayBuffer, byteOffset = 0) {
    const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const n = Math.min(view.byteLength, this.size - byteOffset) & ~3;
    if (n > 0) this.kit.queue.writeBuffer(this.gpu, byteOffset, view.buffer, view.byteOffset, n);
    return this;
  }
  /** grow (contents are not kept); bind groups follow automatically */
  ensure(bytes: number) {
    if (bytes <= this.size) return false;
    this.gpu.destroy();
    this.alloc(Math.max(bytes, this.size * 2));
    this.count = Math.floor(this.size / this.stride);
    this.version++;
    return true;
  }
  /** copy the contents back to the CPU */
  async read(byteOffset = 0, byteLength = this.size - byteOffset): Promise<ArrayBuffer> {
    const d = this.kit.device;
    const staging = d.createBuffer({ size: Math.ceil(byteLength / 4) * 4, usage: BUF.MAP_READ | BUF.COPY_DST });
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(this.gpu, byteOffset, staging, 0, Math.ceil(byteLength / 4) * 4);
    this.kit.queue.submit([enc.finish()]);
    await staging.mapAsync(MAP.READ);
    const out = staging.getMappedRange().slice(0, byteLength);
    staging.destroy();
    return out;
  }
  /** free it for good */
  destroy() {
    this.gpu.destroy();
    this.kit.buffers.delete(this);
  }
}

// ---------------------------------------------------------------- textures
export type TexUse = 'sample' | 'storage' | 'render' | 'copy-src' | 'copy-dst';
const TU: Record<TexUse, number> = {
  sample: TEX.TEXTURE_BINDING, storage: TEX.STORAGE_BINDING, render: TEX.RENDER_ATTACHMENT,
  'copy-src': TEX.COPY_SRC, 'copy-dst': TEX.COPY_DST,
};
export const isDepthFormat = (f: string) => f.startsWith('depth') || f.startsWith('stencil');
const notRenderable = (f: string) => /snorm|rgb9e5|^bc|^etc2|^eac|^astc/.test(f);
const FLOAT32 = /^(r32float|rg32float|rgba32float)$/;

export interface TextureDesc {
  label?: string;
  format: GPUTextureFormat;
  /** pixels, or relative to the kit's render size ('render') / the canvas ('canvas') times `scale` */
  size: [number, number] | [number, number, number] | 'render' | 'canvas';
  scale?: number;
  dimension?: GPUTextureDimension;
  /** mip levels; 'full' = down to 1×1 */
  mips?: number | 'full';
  samples?: number;
  usage?: TexUse[];
  /** view dimension for the default view ('cube' for a 6-layer cubemap) */
  view?: GPUTextureViewDimension;
}

export class Texture implements Resource {
  readonly uid = nextUid();
  private v = 0;
  gpu!: GPUTexture;
  width = 0; height = 0; layers = 1; mips = 1; samples = 1;
  label: string;
  readonly format: GPUTextureFormat;
  readonly usage: number;
  /** freed for good (destroy): a resize no longer reallocates it */
  destroyed = false;
  private views = new Map<string, GPUTextureView>();
  constructor(private kit: Kit, readonly desc: TextureDesc) {
    this.label = desc.label ?? 'texture';
    this.format = desc.format;
    const depth = isDepthFormat(desc.format);
    const def: TexUse[] = depth ? ['sample', 'render'] : notRenderable(desc.format) ? ['sample', 'copy-dst', 'copy-src'] : ['sample', 'render', 'copy-dst', 'copy-src'];
    this.usage = (desc.usage ?? def).reduce((a, x) => a | TU[x], 0);
    this.samples = desc.samples ?? 1;
    if (this.samples > 1) this.usage &= ~(TEX.STORAGE_BINDING | TEX.COPY_DST | TEX.COPY_SRC);
    this.alloc();
  }
  /** bumped whenever its GPU texture is replaced (and kit.resourceGen with it, so bind groups are checked again) */
  get version() { return this.v; }
  set version(n: number) { this.v = n; this.kit.resourceGen++; }
  get relative() { return typeof this.desc.size === 'string'; }
  /** size this texture wants right now */
  wanted(): [number, number, number] {
    const s = this.desc.size;
    if (typeof s === 'string') {
      const base = s === 'render' ? this.kit.size.render : this.kit.size.canvas;
      const k = this.desc.scale ?? 1;
      return [Math.max(1, Math.round(base[0] * k)), Math.max(1, Math.round(base[1] * k)), 1];
    }
    return [s[0], s[1], s[2] ?? 1];
  }
  /** (re)allocate if the wanted size changed; returns true when it did */
  alloc(): boolean {
    if (this.destroyed) return false;
    const [w, h, l] = this.wanted();
    if (this.gpu && w === this.width && h === this.height && l === this.layers) return false;
    const first = !this.gpu;
    this.gpu?.destroy();
    this.width = w; this.height = h; this.layers = l;
    const m = this.desc.mips;
    const dim = this.desc.dimension ?? '2d';
    this.mips = m === 'full' ? Math.floor(Math.log2(Math.max(w, h, dim === '3d' ? l : 1))) + 1 : (m ?? 1);
    this.gpu = this.kit.device.createTexture({
      label: this.label, format: this.format, size: [w, h, l], dimension: dim, mipLevelCount: this.mips,
      sampleCount: this.samples, usage: this.usage,
    });
    this.views.clear();
    // (a new texture is in no bind group yet: only a reallocation needs them checked)
    if (first) this.v++; else this.version++;
    return true;
  }
  /** a view, cached per descriptor until the texture is reallocated */
  view(d: GPUTextureViewDescriptor = {}): GPUTextureView {
    const key = `${d.dimension ?? ''}|${d.baseMipLevel ?? 0}|${d.mipLevelCount ?? ''}|${d.baseArrayLayer ?? 0}|${d.arrayLayerCount ?? ''}|${d.aspect ?? ''}|${d.format ?? ''}`;
    let v = this.views.get(key);
    if (!v) {
      const dd = { ...d };
      if (!dd.dimension && this.desc.view) dd.dimension = this.desc.view;
      if (!dd.dimension && this.layers > 1 && (this.desc.dimension ?? '2d') === '2d') dd.dimension = '2d-array';
      v = this.gpu.createView({ label: `${this.label}:${key}`, ...dd });
      this.views.set(key, v);
    }
    return v;
  }
  /** a bindable/attachable view of one mip level (and optionally one layer) */
  mip(level: number, layer?: number) { return new TexView(this, { baseMipLevel: level, mipLevelCount: 1, ...(layer !== undefined ? { baseArrayLayer: layer, arrayLayerCount: 1, dimension: '2d' as const } : {}) }); }
  layer(i: number) { return new TexView(this, { baseArrayLayer: i, arrayLayerCount: 1, dimension: '2d', baseMipLevel: 0, mipLevelCount: 1 }); }
  get unfilterable() { return FLOAT32.test(this.format) && !this.kit.features.has('float32-filterable'); }
  /** upload pixels (rows tightly packed unless bytesPerRow is given) */
  write(data: ArrayBufferView, o: { mip?: number; layer?: number; width?: number; height?: number; bytesPerRow?: number; origin?: [number, number] } = {}) {
    const w = o.width ?? Math.max(1, this.width >> (o.mip ?? 0)), h = o.height ?? Math.max(1, this.height >> (o.mip ?? 0));
    const bpp = bytesPerPixel(this.format);
    this.kit.queue.writeTexture(
      { texture: this.gpu, mipLevel: o.mip ?? 0, origin: [o.origin?.[0] ?? 0, o.origin?.[1] ?? 0, o.layer ?? 0] },
      data as GPUAllowSharedBufferSource, { bytesPerRow: o.bytesPerRow ?? w * bpp, rowsPerImage: h }, [w, h, 1]);
    return this;
  }
  /** copy one mip level back to the CPU (rows tightly packed) */
  async read(mip = 0, layer = 0): Promise<ArrayBuffer> {
    const w = Math.max(1, this.width >> mip), h = Math.max(1, this.height >> mip);
    const bpp = bytesPerPixel(this.format);
    const bpr = Math.ceil((w * bpp) / 256) * 256;
    const d = this.kit.device;
    const staging = d.createBuffer({ label: `${this.label}.read`, size: bpr * h, usage: BUF.MAP_READ | BUF.COPY_DST });
    const enc = d.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.gpu, mipLevel: mip, origin: [0, 0, layer] }, { buffer: staging, bytesPerRow: bpr, rowsPerImage: h }, [w, h, 1]);
    this.kit.queue.submit([enc.finish()]);
    await staging.mapAsync(MAP.READ);
    const src = new Uint8Array(staging.getMappedRange());
    const out = new Uint8Array(w * h * bpp);
    for (let y = 0; y < h; y++) out.set(src.subarray(y * bpr, y * bpr + w * bpp), y * w * bpp);
    staging.destroy();
    return out.buffer;
  }
  private probes: GPUBuffer[] = [];
  /** one texel back to the CPU without stalling the frame: what the GPU last drew there, a frame or two later (null
   *  outside the texture). Its staging buffers are pooled, so picking or a cursor's depth can ask every frame. The
   *  texture needs 'copy-src' in its usage (a depth texture is read depth-only). */
  async readTexel(x: number, y: number, o: { mip?: number; layer?: number } = {}): Promise<ArrayBuffer | null> {
    const mip = o.mip ?? 0, w = Math.max(1, this.width >> mip), h = Math.max(1, this.height >> mip);
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    const d = this.kit.device, bpp = bytesPerPixel(this.format);
    const buf = this.probes.pop() ?? d.createBuffer({ label: `${this.label}.probe`, size: 256, usage: BUF.MAP_READ | BUF.COPY_DST });
    const enc = d.createCommandEncoder({ label: `${this.label}.probe` });
    if (isDepthFormat(this.format)) {
      // (a depth texture can only be copied whole: a one-thread compute reads the texel instead)
      depthProbe(this.kit).encode(enc, this, x, y, mip, buf);
    } else {
      enc.copyTextureToBuffer({ texture: this.gpu, mipLevel: mip, origin: [x, y, o.layer ?? 0] }, { buffer: buf, bytesPerRow: 256 }, [1, 1, 1]);
    }
    this.kit.queue.submit([enc.finish()]);
    try {
      await buf.mapAsync(MAP.READ);
      const out = buf.getMappedRange(0, Math.max(4, bpp)).slice(0);
      buf.unmap();
      if (this.probes.length < 8) this.probes.push(buf); else buf.destroy();
      return out;
    } catch {
      buf.destroy();
      return null;
    }
  }
  /** bytes it holds on the GPU: every mip of every layer, times its samples (block-compressed formats are estimated) */
  get bytes() {
    if (this.destroyed) return 0;
    const bpp = bytesPerPixel(this.format), deep = (this.desc.dimension ?? '2d') === '3d';
    let n = 0;
    for (let m = 0; m < this.mips; m++) n += Math.max(1, this.width >> m) * Math.max(1, this.height >> m) * (deep ? Math.max(1, this.layers >> m) : this.layers);
    return n * bpp * this.samples;
  }
  /** free it for good: it leaves kit.textures, so a resize doesn't reallocate it */
  destroy() {
    this.gpu.destroy();
    for (const b of this.probes) b.destroy();
    this.probes = [];
    this.views.clear();
    this.destroyed = true;
    this.kit.textures.delete(this);
  }
}

// reads one depth texel into a buffer (Texture.readTexel on a depth format)
class DepthProbe {
  private pipe: GPUComputePipeline;
  private at: GPUBuffer;
  private out: GPUBuffer;
  constructor(private kit: Kit) {
    const d = kit.device;
    const module = d.createShaderModule({
      label: 'weft.depthProbe',
      code: `@group(0) @binding(0) var t: texture_depth_2d;
@group(0) @binding(1) var<storage, read_write> o: array<f32, 4>;
@group(0) @binding(2) var<uniform> at: vec4u;
@compute @workgroup_size(1) fn main() { o[0] = textureLoad(t, at.xy, i32(at.z)); }`,
    });
    this.pipe = d.createComputePipeline({ label: 'weft.depthProbe', layout: 'auto', compute: { module, entryPoint: 'main' } });
    this.at = d.createBuffer({ label: 'weft.depthProbe.at', size: 16, usage: BUF.UNIFORM | BUF.COPY_DST });
    this.out = d.createBuffer({ label: 'weft.depthProbe.out', size: 16, usage: BUF.STORAGE | BUF.COPY_SRC });
  }
  encode(enc: GPUCommandEncoder, tex: Texture, x: number, y: number, mip: number, dst: GPUBuffer) {
    const d = this.kit.device;
    // (the queue write lands before this encoder's commands: one probe per submit, as readTexel does)
    this.kit.queue.writeBuffer(this.at, 0, new Uint32Array([x, y, mip, 0]));
    const bg = d.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: tex.view({ aspect: 'depth-only', dimension: '2d', baseMipLevel: 0, mipLevelCount: tex.mips }) },
        { binding: 1, resource: { buffer: this.out } },
        { binding: 2, resource: { buffer: this.at } },
      ],
    });
    const p = enc.beginComputePass({ label: 'weft.depthProbe' });
    p.setPipeline(this.pipe);
    p.setBindGroup(0, bg);
    p.dispatchWorkgroups(1);
    p.end();
    enc.copyBufferToBuffer(this.out, 0, dst, 0, 16);
  }
}
const depthProbes = new WeakMap<Kit, DepthProbe>();
function depthProbe(kit: Kit) {
  let p = depthProbes.get(kit);
  if (!p) depthProbes.set(kit, (p = new DepthProbe(kit)));
  return p;
}

/** a specific view of a texture (one mip, one layer…) usable as a binding or an attachment */
export class TexView {
  private id = 0;
  constructor(readonly texture: Texture, readonly desc: GPUTextureViewDescriptor) {}
  get view() { return this.texture.view(this.desc); }
  get key() { return `${this.texture.uid}.${this.texture.version}:${JSON.stringify(this.desc)}`; }
  /** a number per distinct description: views of equal descriptions share it (so they bind alike) */
  get descId() {
    if (!this.id) {
      const k = JSON.stringify(this.desc);
      let id = descIds.get(k);
      if (!id) descIds.set(k, (id = descIds.size + 1));
      this.id = id;
    }
    return this.id;
  }
}
const descIds = new Map<string, number>();

export function bytesPerPixel(f: GPUTextureFormat): number {
  if (/^(r8|r8unorm|r8snorm|r8uint|r8sint|stencil8)$/.test(f)) return 1;
  if (/^(rg8|r16)/.test(f) || f === 'depth16unorm') return 2;
  if (/^(rgba8|bgra8|rg16|r32|rgb10a2|rg11b10|rgb9e5)/.test(f) || f === 'depth32float' || f === 'depth24plus' || f === 'depth24plus-stencil8') return 4;
  if (/^(rgba16|rg32)/.test(f)) return 8;
  if (/^rgba32/.test(f)) return 16;
  return 4;
}

// ---------------------------------------------------------------- ping-pong
/** two resources that trade places: `read` / `write` are refs resolved when bound; `swap` is a run item */
export class PingPong<T> {
  private parity = 0;
  readonly read: Ref<T>;
  readonly write: Ref<T>;
  readonly swap: RunAction;
  constructor(readonly a: T, readonly b: T, label = 'pingpong') {
    this.read = new Ref(() => (this.parity ? this.b : this.a), label + '.read');
    this.write = new Ref(() => (this.parity ? this.a : this.b), label + '.write');
    this.swap = new RunAction(() => { this.parity ^= 1; }, label + '.swap');
  }
  get current(): T { return this.parity ? this.b : this.a; }
  get next(): T { return this.parity ? this.a : this.b; }
  flip() { this.parity ^= 1; }
}

/** a CPU step inside a run list (it runs at that point of the encoding order) */
export class RunAction {
  enabled = true;
  constructor(readonly fn: () => void, readonly label = 'action') {}
}
