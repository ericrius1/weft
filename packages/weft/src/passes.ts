// The units of work. A Compute is one dispatch; a RenderPass is one set of attachments with an ordered list of
// Draws (and DrawBundles: static draws baked once, bundle.ts). Every pipeline is created (async) the moment its
// compute / draw is declared, so `await kit.ready()` behind a loading screen means nothing compiles mid-game — unless
// an app sets a compile scheduler (kit.compiler), which then says when each compiles. A hot shader edit rebuilds just
// the pipelines made from it.
import type { Kit, View } from './kit';
import type { Shader } from './shader';
import { Binder, BindError, forgetBindings, type Bindable } from './binder';
import { Ref, deref, Texture, TexView, StorageBuffer, RunAction, isDepthFormat } from './resources';
import { DrawBundle } from './bundle';

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
export type AnyPipelineRecord = PipelineRecord<GPURenderPipeline | GPUComputePipeline>;

/** An app's compile scheduler (kit.compiler), for browsers that compile pipelines one at a time (WebKit): weft asks it
 *  when each record may compile. While it `holding`, a record built is `deferred` (kit.ready() doesn't wait for it);
 *  one needed before it compiled — its draw encoded, or its pipeline read — is made on the spot by `now`. */
export interface Compiler {
  readonly holding: boolean;
  /** when `rec` may compile: call start() (which asks the GPU) when it may, and settle with its result */
  compile(rec: AnyPipelineRecord, start: () => Promise<unknown>): Promise<unknown>;
  /** `rec` is needed now: make it on the spot (rec.makeNow with kit.moduleNow) */
  now(rec: AnyPipelineRecord): void;
}

export class PipelineRecord<P extends GPURenderPipeline | GPUComputePipeline> {
  /** the pipeline as it is (read `pipeline`, which a compile scheduler may make on the spot) */
  _pipe: P | null = null;
  pending: Promise<void> | null = null;
  error: string | null = null;
  ms = 0;
  builds = 0;
  /** waiting for kit.compiler to say when (kit.ready() doesn't wait for it) */
  deferred = false;
  /** drawn only while this says so (a scheduler holding a feature back until all of it has compiled) */
  gate: (() => boolean) | null = null;
  /** called when its pipeline changes (a compile landing, a hot reload) */
  changed: (() => void) | null = null;
  constructor(readonly kit: Kit, readonly label: string, readonly shader: Shader, readonly make: (module: GPUShaderModule) => Promise<P>,
    readonly makeNow: ((module: GPUShaderModule) => P) | null = null) {
    kit.pipelines.push(this as AnyPipelineRecord);
  }
  get pipeline(): P | null {
    if (!this._pipe && this.deferred && this.kit.compiler) this.kit.compiler.now(this as AnyPipelineRecord);
    return this._pipe;
  }
  set pipeline(p: P | null) {
    if (p === this._pipe) return;
    this._pipe = p;
    this.changed?.();
  }
  build() {
    const t0 = performance.now();
    // (one built while the scheduler holds is deferred at once: its module's compile info comes first, and can wait
    // behind the GPU's compiles, and kit.ready() mustn't wait for it meanwhile)
    if (this.kit.compiler?.holding) this.deferred = true;
    const p = (async () => {
      try {
        const module = await this.kit.module(this.shader);
        const c = this.kit.compiler;
        const pipe = (await (c ? c.compile(this as AnyPipelineRecord, () => this.make(module)) : this.make(module))) as P;
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
  /** forget it: it leaves kit.pipelines (kit.ready() and the overlay stop counting it) */
  dispose() {
    const list = this.kit.pipelines, i = list.indexOf(this as AnyPipelineRecord);
    if (i >= 0) list.splice(i, 1);
    this.changed = null;
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
    const desc = (module: GPUShaderModule): GPUComputePipelineDescriptor => ({
      label: this.label, layout: this.binder.layout,
      compute: { module, entryPoint: this.entry, constants: constantsFor(shader, this.entry, opts.constants) },
    });
    this.pipe = new PipelineRecord(kit, this.label, shader, (m) => kit.device.createComputePipelineAsync(desc(m)), (m) => kit.device.createComputePipeline(desc(m)));
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
    if (!p || (this.pipe.gate && !this.pipe.gate())) return;
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
  /** stop it for good: no more hot rebuilds, and its pipeline leaves the kit */
  dispose() { this.unsub(); this.pipe.dispose(); }
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

/** what a draw's calls go into: a render pass, a render bundle (bundle.ts), or a recorder of the calls */
export interface DrawEncoder {
  setPipeline(pipeline: GPURenderPipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  setVertexBuffer(slot: number, buffer: GPUBuffer, offset?: number): void;
  setIndexBuffer(buffer: GPUBuffer, format: GPUIndexFormat, offset?: number): void;
  draw(count: number, instances?: number, first?: number, firstInstance?: number): void;
  drawIndexed(count: number, instances?: number, first?: number, baseVertex?: number, firstInstance?: number): void;
  drawIndirect(buffer: GPUBuffer, offset: number): void;
  drawIndexedIndirect(buffer: GPUBuffer, offset: number): void;
}
type TrackedEncoder = DrawEncoder & { __weftPipeline?: GPURenderPipeline | null };
/** forget the pipeline and groups a pass has set (after a bundle or code outside weft changed them) */
export function forgetPassState(enc: DrawEncoder) {
  (enc as TrackedEncoder).__weftPipeline = null;
  forgetBindings(enc);
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
  /** (a compile scheduler checks this: weft's records support deferral) */
  static scheduled = true;
  readonly label: string;
  binder: Binder;
  pipe: PipelineRecord<GPURenderPipeline>;
  private vs!: string;
  private fs!: string | null;
  private unsub: () => void;
  private on_: boolean | (() => boolean);
  /** `bundle`: the DrawBundle it's baked into (pass.bundle().draw makes these) */
  constructor(private kit: Kit, readonly pass: RenderPass, readonly shader: S, readonly opts: DrawOptions<S>, readonly bundle: DrawBundle | null = null) {
    this.label = opts.label ?? shader.label;
    if (bundle && opts.encode) throw new BindError(`${this.label}: a bundled draw can't issue its own calls (encode)`);
    this.on_ = opts.enabled ?? true;
    this.pickEntries();
    this.binder = new Binder(kit, shader, this.fs ? [this.vs, this.fs] : [this.vs], { ...(opts.bind ?? {}) } as Record<string, unknown>, this.label);
    this.pipe = new PipelineRecord(kit, this.label, shader, (m) => kit.device.createRenderPipelineAsync(this.descriptor(m)), (m) => kit.device.createRenderPipeline(this.descriptor(m)));
    this.pipe.changed = () => this.bundle?.invalidate();
    this.pipe.build();
    this.unsub = shader.onChange(() => this.rebuild());
  }
  /** drawn or not (a function is asked each frame) */
  get enabled() { return this.on_; }
  set enabled(v: boolean | (() => boolean)) {
    if (v === this.on_) return;
    this.on_ = v;
    this.bundle?.invalidate();
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
      this.bundle?.invalidate();
      this.pipe.build();
    } catch (e) { this.kit.report('bind', this.label, (e as Error).message); }
  }
  set(name: keyof NonNullable<DrawOptions<S>['bind']> & string, value: Bindable) {
    this.binder.set(name, value);
    this.bundle?.invalidate();
    return this;
  }

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
      // (WebGPU refuses alpha to coverage without multisampling: such a pipeline would fail and never draw)
      multisample: { count: f.samples, alphaToCoverageEnabled: !!o.alphaToCoverage && f.samples > 1 },
    };
    if (o.alphaToCoverage && f.samples <= 1) this.kit.warnOnce(`a2c:${this.label}`, `${this.label}: alphaToCoverage needs a multisampled pass (${this.pass.label} has 1 sample): drawn without it`);
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

  encode(pe: GPURenderPassEncoder) { this.encodeInto(pe); }
  /** its calls, into a pass or a bundle (nothing while it's off or its pipeline isn't ready) */
  encodeInto(enc: DrawEncoder) {
    // (enabled first: a compile scheduler makes a deferred pipeline on the spot when it's read)
    if (!on(this.on_)) return;
    const p = this.pipe.pipeline;
    if (!p || (this.pipe.gate && !this.pipe.gate())) return;
    const o = this.opts;
    // (consecutive draws with one pipeline set it once)
    const tracked = enc as TrackedEncoder;
    if (tracked.__weftPipeline !== p) { tracked.__weftPipeline = p; enc.setPipeline(p); }
    this.binder.apply(enc, this.pass.opts.view ?? this.kit.mainView, this.pass.opts.shared);
    const vb = o.vertexBuffers;
    if (vb) for (let i = 0; i < vb.length; i++) enc.setVertexBuffer(i, gpuBuf(vb[i].buffer), vb[i].offset ?? 0);
    if (o.indices) enc.setIndexBuffer(gpuBuf(o.indices.buffer), o.indices.format ?? 'uint32', o.indices.offset ?? 0);
    if (o.encode) {
      o.encode(enc as GPURenderPassEncoder, this);
      // (the callback may have set its own pipeline or groups)
      forgetPassState(enc);
      return;
    }
    if (o.indirect) {
      if (o.indices) enc.drawIndexedIndirect(gpuBuf(o.indirect.buffer), val(o.indirect.offset, 0));
      else enc.drawIndirect(gpuBuf(o.indirect.buffer), val(o.indirect.offset, 0));
      return;
    }
    const count = val(o.count, 3), inst = val(o.instances, 1);
    if (count <= 0 || inst <= 0) return;
    if (o.indices) enc.drawIndexed(count, inst, val(o.first, 0), val(o.baseVertex, 0), val(o.firstInstance, 0));
    else enc.draw(count, inst, val(o.first, 0), val(o.firstInstance, 0));
  }
  /** (bundles) whether an option is asked each frame: enabled, the counts, the indirect offset, a scheduler's gate */
  get watched() {
    const o = this.opts, fn = (x: unknown) => typeof x === 'function';
    return fn(this.on_) || fn(o.count) || fn(o.instances) || fn(o.first) || fn(o.firstInstance) || fn(o.baseVertex) || fn(o.indirect?.offset) || !!this.pipe.gate;
  }
  /** (bundles) those options' values now, into out */
  state(out: number[]) {
    const o = this.opts;
    out[0] = on(this.on_) ? 1 : 0; out[1] = val(o.count, 3); out[2] = val(o.instances, 1); out[3] = val(o.first, 0);
    out[4] = val(o.firstInstance, 0); out[5] = val(o.baseVertex, 0); out[6] = val(o.indirect?.offset, 0);
    out[7] = this.pipe.gate && !this.pipe.gate() ? 0 : 1;
    return out;
  }
  /** (bundles) whether a vertex, index or indirect buffer is given through a Ref */
  get refBuffers() {
    const o = this.opts;
    return !!(o.vertexBuffers?.some((v) => v.buffer instanceof Ref) || o.indices?.buffer instanceof Ref || o.indirect?.buffer instanceof Ref);
  }
  /** stop drawing it for good: it leaves its pass (or bundle), and its pipeline leaves the kit */
  dispose() {
    this.unsub();
    const list: unknown[] = this.bundle ? this.bundle.draws : this.pass.draws;
    const i = list.indexOf(this);
    if (i >= 0) list.splice(i, 1);
    this.bundle?.invalidate();
    this.pipe.dispose();
  }
}

/** what a pass draws, in order: draws, and bundles of static draws */
export type PassItem = Draw | DrawBundle;

export class RenderPass implements RunItem {
  readonly label: string;
  readonly timed = true;
  enabled: boolean | (() => boolean);
  draws: PassItem[] = [];
  constructor(private kit: Kit, readonly opts: RenderPassOptions) {
    this.label = opts.label ?? 'pass';
    this.enabled = opts.enabled ?? true;
  }
  draw<S extends Shader>(shader: S, opts: DrawOptions<S> = {}): Draw<S> {
    const d = new Draw(this.kit, this, shader, opts);
    this.draws.push(d as unknown as Draw);
    return d;
  }
  /** a bundle of static draws at this point of the pass's order: its draws are recorded once into a GPURenderBundle
   *  and replayed with one call a frame (see bundle.ts for what re-records it) */
  bundle(label = `${this.label}.bundle`): DrawBundle {
    const b = new DrawBundle(this.kit, this, label);
    this.draws.push(b);
    return b;
  }
  /** stop it for good: every draw and bundle in it is disposed */
  dispose() {
    for (const d of [...this.draws]) if (d instanceof Draw || d instanceof DrawBundle) d.dispose();
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
