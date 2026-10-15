// The units of work. A Compute is one dispatch; a RenderPass is one set of attachments with an ordered list of
// Draws. Every pipeline is created (async) the moment its compute / draw is declared, so `await kit.ready()` behind a
// loading screen means nothing compiles mid-game. A hot shader edit rebuilds just the pipelines made from it.
import type { Kit, View } from './kit';
import type { Shader } from './shader';
import { Binder, BindError, type Bindable } from './binder';
import { Ref, deref, Texture, TexView, StorageBuffer, RunAction, isDepthFormat } from './resources';

type Num = number | (() => number);
type Nums = number[] | (() => number[]);
const val = (x: Num | undefined, d: number) => (x === undefined ? d : typeof x === 'function' ? x() : x);
const vals = (x: Nums) => (typeof x === 'function' ? x() : x);
const on = (e: boolean | (() => boolean) | undefined) => (e === undefined ? true : typeof e === 'function' ? e() : e);

export type BindOf<S> = S extends Shader<object, infer B> ? Partial<Record<B, Bindable>> : Record<string, Bindable>;

export interface RunItem {
  label: string;
  enabled?: boolean | (() => boolean);
  encode(enc: GPUCommandEncoder, ts?: GPUComputePassTimestampWrites | GPURenderPassTimestampWrites): void;
  /** true for passes that can carry timestamp writes */
  timed?: boolean;
}

/** a raw step: anything you'd do with the command encoder yourself (copies, clears, other libraries) */
export class RawItem implements RunItem {
  enabled = true;
  constructor(readonly fn: (enc: GPUCommandEncoder) => void, readonly label = 'raw') {}
  encode(enc: GPUCommandEncoder) { this.fn(enc); }
}

// ---------------------------------------------------------------- pipelines
export class PipelineRecord<P extends GPURenderPipeline | GPUComputePipeline> {
  pipeline: P | null = null;
  pending: Promise<void> | null = null;
  error: string | null = null;
  ms = 0;
  builds = 0;
  constructor(readonly kit: Kit, readonly label: string, readonly shader: Shader, readonly make: (module: GPUShaderModule) => Promise<P>) {
    kit.pipelines.push(this as PipelineRecord<GPURenderPipeline | GPUComputePipeline>);
  }
  build() {
    const t0 = performance.now();
    const p = (async () => {
      try {
        const module = await this.kit.module(this.shader);
        const pipe = await this.make(module);
        this.pipeline = pipe;
        this.error = null;
        this.ms = performance.now() - t0;
        this.builds++;
        this.kit.clearError(this.label);
      } catch (e) {
        this.error = (e as Error).message ?? String(e);
        this.kit.report('pipeline', this.label, this.error);
      }
    })();
    this.pending = p.finally(() => { if (this.pending === wrapped) this.pending = null; });
    const wrapped = this.pending;
    return this.pending;
  }
}

function pickEntry(shader: Shader, stage: 'vertex' | 'fragment' | 'compute', name: string | undefined, label: string) {
  const list = shader.reflect.entries.filter((e) => e.stage === stage);
  if (name) {
    if (!list.some((e) => e.name === name)) throw new BindError(`${label}: ${shader.id} has no ${stage} entry '${name}' (has: ${list.map((e) => e.name).join(', ') || 'none'})`);
    return name;
  }
  if (list.length === 1) return list[0].name;
  if (!list.length) throw new BindError(`${label}: ${shader.id} has no ${stage} entry point`);
  // several: the conventional name wins (vs / fs / main), anything else must be named
  const conventional = stage === 'vertex' ? 'vs' : stage === 'fragment' ? 'fs' : 'main';
  if (list.some((e) => e.name === conventional)) return conventional;
  throw new BindError(`${label}: ${shader.id} has several ${stage} entries (${list.map((e) => e.name).join(', ')}): pick one`);
}

function constantsFor(shader: Shader, entry: string, constants?: Record<string, number>) {
  if (!constants) return undefined;
  const e = shader.reflect.entries.find((x) => x.name === entry);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(constants)) {
    if (!(k in shader.reflect.overrides)) throw new BindError(`${shader.id}: no override named '${k}'`);
    if (e?.overrides.includes(k)) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- compute
export interface ComputeOptions<S extends Shader = Shader> {
  label?: string;
  entry?: string;
  bind?: BindOf<S>;
  constants?: Record<string, number>;
  /** workgroup counts, or `threads` (divided by the shader's @workgroup_size, rounded up) */
  workgroups?: Nums;
  threads?: Nums;
  indirect?: { buffer: StorageBuffer | GPUBuffer | Ref; offset?: number };
  view?: View;
  shared?: Record<number, Record<string, unknown>>;
  enabled?: boolean | (() => boolean);
}

export class Compute<S extends Shader = Shader> implements RunItem {
  readonly label: string;
  readonly timed = true;
  enabled: boolean | (() => boolean);
  binder: Binder;
  pipe: PipelineRecord<GPUComputePipeline>;
  private entry: string;
  private unsub: () => void;
  constructor(private kit: Kit, readonly shader: S, readonly opts: ComputeOptions<S>) {
    this.label = opts.label ?? shader.label;
    this.enabled = opts.enabled ?? true;
    this.entry = pickEntry(shader, 'compute', opts.entry, this.label);
    this.binder = new Binder(kit, shader, [this.entry], { ...(opts.bind ?? {}) } as Record<string, unknown>, this.label);
    this.pipe = new PipelineRecord(kit, this.label, shader, (module) => kit.device.createComputePipelineAsync({
      label: this.label, layout: this.binder.layout,
      compute: { module, entryPoint: this.entry, constants: constantsFor(shader, this.entry, opts.constants) },
    }));
    this.pipe.build();
    this.unsub = shader.onChange(() => this.rebuild());
  }
  /** recompute bindings + pipeline (hot reload) */
  rebuild() {
    try {
      this.entry = pickEntry(this.shader, 'compute', this.opts.entry, this.label);
      this.binder.entries = [this.entry];
      this.binder.build();
      this.pipe.build();
    } catch (e) { this.kit.report('bind', this.label, (e as Error).message); }
  }
  set(name: keyof NonNullable<ComputeOptions<S>['bind']> & string, value: Bindable) { this.binder.set(name, value); return this; }
  get workgroupSize() { return this.shader.reflect.entries.find((e) => e.name === this.entry)?.workgroupSize ?? [1, 1, 1]; }
  encode(enc: GPUCommandEncoder, ts?: GPUComputePassTimestampWrites) {
    const p = this.pipe.pipeline;
    if (!p) return;
    const pass = enc.beginComputePass({ label: this.label, timestampWrites: ts });
    pass.setPipeline(p);
    this.binder.apply(pass, this.opts.view ?? this.kit.mainView, this.opts.shared);
    const o = this.opts;
    if (o.indirect) {
      const b = deref(o.indirect.buffer);
      pass.dispatchWorkgroupsIndirect(b instanceof StorageBuffer ? b.gpu : (b as GPUBuffer), o.indirect.offset ?? 0);
    } else {
      let wg: number[];
      if (o.threads) {
        const t = vals(o.threads), s = this.workgroupSize;
        wg = [Math.ceil(t[0] / s[0]), Math.ceil((t[1] ?? 1) / s[1]), Math.ceil((t[2] ?? 1) / s[2])];
      } else wg = o.workgroups ? vals(o.workgroups) : [1];
      if (wg[0] > 0 && (wg[1] ?? 1) > 0 && (wg[2] ?? 1) > 0) pass.dispatchWorkgroups(wg[0], wg[1] ?? 1, wg[2] ?? 1);
    }
    pass.end();
  }
  dispose() { this.unsub(); }
}

// ---------------------------------------------------------------- render passes
export type Target = Texture | TexView | Ref | 'screen';
export interface ColorAttachment {
  target: Target;
  /** clear colour, or false to load what's there */
  clear?: GPUColor | false;
  /** multisample resolve target */
  resolve?: Target;
  store?: boolean;
}
export interface DepthAttachment { target: Texture | TexView | Ref; clear?: number | false; store?: boolean; readOnly?: boolean }
export interface RenderPassOptions {
  label?: string;
  color?: ColorAttachment[];
  depth?: DepthAttachment;
  view?: View;
  /** swap some shared-group values for this pass only: { 1: { shadowTex: dummy } } */
  shared?: Record<number, Record<string, unknown>>;
  viewport?: Nums;
  enabled?: boolean | (() => boolean);
}

export type BlendMode = 'opaque' | 'alpha' | 'premultiplied' | 'add' | 'add-alpha' | 'multiply' | 'max' | GPUBlendState;
const BLEND: Record<string, GPUBlendState | undefined> = {
  opaque: undefined,
  alpha: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
  premultiplied: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
  add: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } },
  'add-alpha': { color: { srcFactor: 'src-alpha', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } },
  multiply: { color: { srcFactor: 'dst', dstFactor: 'zero' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } },
  max: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' } },
};
const blendOf = (b: BlendMode | undefined) => (b === undefined ? undefined : typeof b === 'string' ? BLEND[b] : b);

export interface DrawOptions<S extends Shader = Shader> {
  label?: string;
  vertex?: string;
  /** fragment entry; null for a depth-only draw */
  fragment?: string | null;
  bind?: BindOf<S>;
  constants?: Record<string, number>;
  topology?: GPUPrimitiveTopology;
  cull?: GPUCullMode;
  frontFace?: GPUFrontFace;
  blend?: BlendMode | BlendMode[];
  writeMask?: number | number[];
  depthWrite?: boolean;
  depthCompare?: GPUCompareFunction;
  /** reversed-Z: positive bias pulls toward the camera */
  depthBias?: number;
  depthBiasSlopeScale?: number;
  depthBiasClamp?: number;
  unclippedDepth?: boolean;
  alphaToCoverage?: boolean;
  count?: Num;
  instances?: Num;
  first?: Num;
  firstInstance?: Num;
  baseVertex?: Num;
  indices?: { buffer: StorageBuffer | GPUBuffer | Ref; format?: GPUIndexFormat; offset?: number };
  indirect?: { buffer: StorageBuffer | GPUBuffer | Ref; offset?: Num };
  vertexBuffers?: { layout: GPUVertexBufferLayout; buffer: StorageBuffer | GPUBuffer | Ref; offset?: number }[];
  enabled?: boolean | (() => boolean);
  /** issue the draw calls yourself (after the pipeline and bind groups are set) */
  encode?: (pass: GPURenderPassEncoder, draw: Draw<S>) => void;
}

const gpuBuf = (b: unknown) => { const v = deref(b); return v instanceof StorageBuffer ? v.gpu : (v as GPUBuffer); };

export class Draw<S extends Shader = Shader> {
  readonly label: string;
  enabled: boolean | (() => boolean);
  binder: Binder;
  pipe: PipelineRecord<GPURenderPipeline>;
  private vs!: string;
  private fs!: string | null;
  private unsub: () => void;
  constructor(private kit: Kit, readonly pass: RenderPass, readonly shader: S, readonly opts: DrawOptions<S>) {
    this.label = opts.label ?? shader.label;
    this.enabled = opts.enabled ?? true;
    this.pickEntries();
    this.binder = new Binder(kit, shader, this.fs ? [this.vs, this.fs] : [this.vs], { ...(opts.bind ?? {}) } as Record<string, unknown>, this.label);
    this.pipe = new PipelineRecord(kit, this.label, shader, (module) => kit.device.createRenderPipelineAsync(this.descriptor(module)));
    this.pipe.build();
    this.unsub = shader.onChange(() => this.rebuild());
  }
  private pickEntries() {
    this.vs = pickEntry(this.shader, 'vertex', this.opts.vertex, this.label);
    this.fs = this.opts.fragment === null ? null : pickEntry(this.shader, 'fragment', this.opts.fragment, this.label);
  }
  rebuild() {
    try {
      this.pickEntries();
      this.binder.entries = this.fs ? [this.vs, this.fs] : [this.vs];
      this.binder.build();
      this.pipe.build();
    } catch (e) { this.kit.report('bind', this.label, (e as Error).message); }
  }
  set(name: keyof NonNullable<DrawOptions<S>['bind']> & string, value: Bindable) { this.binder.set(name, value); return this; }

  private descriptor(module: GPUShaderModule): GPURenderPipelineDescriptor {
    const o = this.opts;
    const f = this.pass.formats();
    const outs = this.fs ? (this.shader.reflect.entries.find((e) => e.name === this.fs)?.targets ?? 1) : 0;
    const blends: (BlendMode | undefined)[] = Array.isArray(o.blend) ? o.blend : f.colors.map(() => o.blend as BlendMode | undefined);
    const masks: number[] = Array.isArray(o.writeMask) ? o.writeMask : f.colors.map(() => (o.writeMask as number | undefined) ?? 0xf);
    const targets: GPUColorTargetState[] = f.colors.map((format, i) => ({ format, blend: blendOf(blends[i]), writeMask: i < outs ? masks[i] : 0 }));
    const desc: GPURenderPipelineDescriptor = {
      label: this.label,
      layout: this.binder.layout,
      vertex: { module, entryPoint: this.vs, constants: constantsFor(this.shader, this.vs, o.constants), buffers: o.vertexBuffers?.map((v) => v.layout) },
      primitive: { topology: o.topology ?? 'triangle-list', cullMode: o.cull ?? 'back', frontFace: o.frontFace ?? 'ccw', unclippedDepth: o.unclippedDepth && this.kit.features.has('depth-clip-control') ? true : undefined },
      multisample: { count: f.samples, alphaToCoverageEnabled: o.alphaToCoverage ?? false },
    };
    if (o.topology === 'triangle-strip' || o.topology === 'line-strip') desc.primitive!.stripIndexFormat = o.indices ? (o.indices.format ?? 'uint32') : undefined;
    if (this.fs) desc.fragment = { module, entryPoint: this.fs, constants: constantsFor(this.shader, this.fs, o.constants), targets };
    if (f.depth) {
      desc.depthStencil = {
        format: f.depth,
        depthWriteEnabled: f.depthReadOnly ? false : (o.depthWrite ?? true),
        depthCompare: o.depthCompare ?? 'greater-equal',
        depthBias: o.depthBias, depthBiasSlopeScale: o.depthBiasSlopeScale, depthBiasClamp: o.depthBiasClamp,
      };
    }
    return desc;
  }

  encode(pe: GPURenderPassEncoder) {
    const p = this.pipe.pipeline;
    if (!p || !on(this.enabled)) return;
    const o = this.opts;
    pe.setPipeline(p);
    this.binder.apply(pe, this.pass.opts.view ?? this.kit.mainView, this.pass.opts.shared);
    o.vertexBuffers?.forEach((v, i) => pe.setVertexBuffer(i, gpuBuf(v.buffer), v.offset ?? 0));
    if (o.indices) pe.setIndexBuffer(gpuBuf(o.indices.buffer), o.indices.format ?? 'uint32', o.indices.offset ?? 0);
    if (o.encode) { o.encode(pe, this); return; }
    if (o.indirect) {
      if (o.indices) pe.drawIndexedIndirect(gpuBuf(o.indirect.buffer), val(o.indirect.offset, 0));
      else pe.drawIndirect(gpuBuf(o.indirect.buffer), val(o.indirect.offset, 0));
      return;
    }
    const count = val(o.count, 3), inst = val(o.instances, 1);
    if (count <= 0 || inst <= 0) return;
    if (o.indices) pe.drawIndexed(count, inst, val(o.first, 0), val(o.baseVertex, 0), val(o.firstInstance, 0));
    else pe.draw(count, inst, val(o.first, 0), val(o.firstInstance, 0));
  }
  dispose() { this.unsub(); this.pass.draws.splice(this.pass.draws.indexOf(this as unknown as Draw), 1); }
}

export class RenderPass implements RunItem {
  readonly label: string;
  readonly timed = true;
  enabled: boolean | (() => boolean);
  draws: Draw[] = [];
  constructor(private kit: Kit, readonly opts: RenderPassOptions) {
    this.label = opts.label ?? 'pass';
    this.enabled = opts.enabled ?? true;
  }
  draw<S extends Shader>(shader: S, opts: DrawOptions<S> = {}): Draw<S> {
    const d = new Draw(this.kit, this, shader, opts);
    this.draws.push(d as unknown as Draw);
    return d;
  }
  /** a fullscreen triangle (the shader includes weft/fullscreen and has a fragment entry) */
  fullscreen<S extends Shader>(shader: S, opts: DrawOptions<S> = {}): Draw<S> {
    return this.draw(shader, { vertex: 'vs_fullscreen', cull: 'none', count: 3, depthWrite: false, depthCompare: 'always', ...opts });
  }

  private targetFormat(t: Target): { format: GPUTextureFormat; samples: number } {
    if (t === 'screen') return { format: this.kit.format, samples: 1 };
    const v = deref(t);
    if (v instanceof Texture) return { format: v.format, samples: v.samples };
    if (v instanceof TexView) return { format: v.texture.format, samples: v.texture.samples };
    throw new BindError(`${this.label}: attachment must be a Texture, a TexView or 'screen' (got ${String(v)})`);
  }
  formats() {
    const colors = (this.opts.color ?? []).map((c) => this.targetFormat(c.target));
    const d = this.opts.depth ? this.targetFormat(this.opts.depth.target) : null;
    return { colors: colors.map((c) => c.format), depth: d?.format, depthReadOnly: !!this.opts.depth?.readOnly, samples: colors[0]?.samples ?? d?.samples ?? 1 };
  }
  private attachView(t: Target): GPUTextureView {
    if (t === 'screen') return this.kit.screenView();
    const v = deref(t);
    if (v instanceof Texture) return v.view({ dimension: '2d', baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1 });
    if (v instanceof TexView) return v.texture.view({ ...v.desc, dimension: '2d' });
    throw new BindError(`${this.label}: bad attachment`);
  }
  encode(enc: GPUCommandEncoder, ts?: GPURenderPassTimestampWrites) {
    const o = this.opts;
    const colorAttachments: GPURenderPassColorAttachment[] = (o.color ?? []).map((c) => ({
      view: this.attachView(c.target),
      resolveTarget: c.resolve ? this.attachView(c.resolve) : undefined,
      loadOp: c.clear === false ? 'load' : 'clear',
      clearValue: c.clear === false ? undefined : (c.clear ?? [0, 0, 0, 0]),
      storeOp: c.store === false ? 'discard' : 'store',
    }));
    let depthStencilAttachment: GPURenderPassDepthStencilAttachment | undefined;
    if (o.depth) {
      const d = o.depth;
      const tex = deref(d.target);
      const fmt = tex instanceof Texture ? tex.format : tex instanceof TexView ? tex.texture.format : 'depth32float';
      const hasStencil = fmt.includes('stencil');
      depthStencilAttachment = d.readOnly
        ? { view: this.attachView(d.target as Target), depthReadOnly: true, ...(hasStencil ? { stencilReadOnly: true } : {}) }
        : {
          view: this.attachView(d.target as Target),
          depthLoadOp: d.clear === false ? 'load' : 'clear', depthClearValue: d.clear === false ? undefined : (d.clear ?? 0),
          depthStoreOp: d.store === false ? 'discard' : 'store',
          ...(hasStencil ? { stencilLoadOp: 'clear' as const, stencilStoreOp: 'discard' as const } : {}),
        };
    }
    const pe = enc.beginRenderPass({ label: this.label, colorAttachments, depthStencilAttachment, timestampWrites: ts });
    if (o.viewport) {
      const v = vals(o.viewport);
      pe.setViewport(v[0], v[1], v[2], v[3], 0, 1);
      pe.setScissorRect(Math.max(0, Math.floor(v[0])), Math.max(0, Math.floor(v[1])), Math.max(1, Math.floor(v[2])), Math.max(1, Math.floor(v[3])));
    }
    for (const d of this.draws) d.encode(pe);
    pe.end();
  }
}

export { RunAction, isDepthFormat };
