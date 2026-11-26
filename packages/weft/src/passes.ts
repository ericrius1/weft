// The units of work. A Compute is one dispatch; a RenderPass is one set of attachments with an ordered list of
// Draws (and DrawBundles: static draws baked once, bundle.ts). Every pipeline is created (async) the moment its
// compute / draw is declared, so `await kit.ready()` behind a loading screen means nothing compiles mid-game — unless
// an app sets a compile scheduler (kit.compiler), which then says when each compiles. A hot shader edit rebuilds just
// the pipelines made from it.
//
// Draws and computes whose pipelines would be the same (the same shader version, entry points, constants, layout,
// targets, blend, depth, primitive and vertex layouts; labels aside) share one compile and one GPU pipeline
// (kit.pipelineCache): a character's near and far meshes, each in classic and drawn styles, a fill run once per level,
// compile once. Each draw keeps its own record (kit.pipelines), label and errors.
import type { Kit, View } from './kit';
import type { Shader } from './shader';
import { Binder, BindError, forgetBindings, type Bindable } from './binder';
import { Ref, deref, Texture, TexView, StorageBuffer, RunAction, isDepthFormat, rawUid } from './resources';
import { DrawBundle, type DrawBundleOptions } from './bundle';

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
type AnyPipeline = GPURenderPipeline | GPUComputePipeline;

/** An app's compile scheduler (kit.compiler), for browsers that compile pipelines one at a time (WebKit): weft asks it
 *  when each record may compile. While it `holding`, a record built is `deferred` (kit.ready() doesn't wait for it);
 *  one needed before it compiled — its draw encoded, or its pipeline read — is made on the spot by `now`. Records
 *  sharing a compile are each asked for while it hasn't landed, and the first ask it lets through starts the one
 *  compile (asked only for the first, a compile it held back for that one — a mirror's view, not in the first frame —
 *  kept a twin the first frame waits on waiting too, and the load never finished); one made on the spot is made for
 *  all of them. */
export interface Compiler {
  readonly holding: boolean;
  /** when `rec` may compile: call start() (which asks the GPU) when it may, and settle with its result. `asked`
   *  says whether the GPU has nothing more to be asked for it — its compile made on the spot meanwhile, or already
   *  started by a record sharing it: start() then only hands that one's result on, so a scheduler needn't spend a turn
   *  on it */
  compile(rec: AnyPipelineRecord, start: () => Promise<unknown>, asked?: () => boolean): Promise<unknown>;
  /** `rec` is needed now: make it on the spot (rec.makeNow with kit.moduleNow) */
  now(rec: AnyPipelineRecord): void;
}

type PipelineDesc = GPURenderPipelineDescriptor | GPUComputePipelineDescriptor;
/** (a descriptor's module, filled in once the module is made) */
const NO_MODULE = null as unknown as GPUShaderModule;

/** a value as text, every object's keys sorted and undefined left out (as JSON does): the same descriptor gives the same
 *  text however its objects were spelled. Anything but plain data (a GPU object) is written as its identity. */
export function stableKey(v: unknown): string {
  if (v === undefined || v === null) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : `"${v}"`;
  if (typeof v !== 'object') return JSON.stringify(typeof v === 'string' || typeof v === 'boolean' ? v : String(v));
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return `"#${rawUid(v)}"`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableKey(o[k])}`).join(',')}}`;
}

/** what tells one pipeline from another: its descriptor with the label left out, the layout as the description of its
 *  bind group layouts (Binder.layoutKey: equal descriptions are the same layouts, kit.bindGroupLayout) and each stage's
 *  module as the shader and version it's made from */
export function pipelineKey(desc: PipelineDesc, layout: string, module: string) {
  const d: Record<string, unknown> = { ...desc, label: undefined, layout };
  for (const s of ['vertex', 'fragment', 'compute']) if (d[s]) d[s] = { ...(d[s] as object), module };
  return stableKey(d);
}
const shaderTag = (s: Shader) => `${s.id}@${s.version}#${rawUid(s)}`;

/** a pipeline from a descriptor and its module: asynchronously, or on the spot */
function makePipeline(kit: Kit, desc: PipelineDesc, module: GPUShaderModule, async: boolean): AnyPipeline | Promise<AnyPipeline> {
  const d: Record<string, unknown> = { ...desc }, dev = kit.device;
  for (const s of ['vertex', 'fragment', 'compute']) if (d[s]) d[s] = { ...(d[s] as object), module };
  if ('compute' in desc) return async ? dev.createComputePipelineAsync(d as unknown as GPUComputePipelineDescriptor) : dev.createComputePipeline(d as unknown as GPUComputePipelineDescriptor);
  return async ? dev.createRenderPipelineAsync(d as unknown as GPURenderPipelineDescriptor) : dev.createRenderPipeline(d as unknown as GPURenderPipelineDescriptor);
}

export type DrawTags = Record<string, string | number | boolean>;

/** One GPU pipeline and its compile, shared by every record whose descriptor is the same (kit.pipelineCache, by
 *  pipelineKey). When its last record lets it go, a compiled current-version pipeline moves into `kit.warmPipelines`
 *  (bounded LRU) so revisiting a place reuses it with 0 ms compile; stale or failed ones leave at once. */
export class SharedPipeline {
  pipeline: AnyPipeline | null = null;
  error: string | null = null;
  /** its compile's ms, from its module made to the pipeline made */
  ms = 0;
  /** shader version this compile was built from, and lean code length as a weight proxy */
  readonly shaderVersion: number;
  readonly weight: number;
  /** the records using it */
  readonly users = new Set<AnyPipelineRecord>();
  /** settles once its pipeline is made (compiled, or made on the spot by a compile scheduler) or its compile fails */
  readonly done: Promise<AnyPipeline>;
  /** its compile, started by the first of its records' asks let through (nothing once it's landed) */
  start: () => Promise<AnyPipeline> = () => Promise.reject(new Error('no compile'));
  /** start() has been called: the GPU has been asked for it (calling it again asks nothing more) */
  asked = false;
  private settle!: { ok: (p: AnyPipeline) => void; fail: (e: unknown) => void };
  constructor(readonly key: string, readonly shader: Shader) {
    this.shaderVersion = shader.version;
    this.weight = shader.code.length;
    this.done = new Promise<AnyPipeline>((ok, fail) => { this.settle = { ok, fail }; });
    this.done.catch(() => {});
  }
  /** its pipeline is made: every record using it has it (a later one, a compile finishing after one was made on the
   *  spot, is let go) */
  land(p: AnyPipeline) {
    if (this.pipeline) return;
    this.pipeline = p;
    this.settle.ok(p);
    for (const u of this.users) u.pipeline = p;
  }
  failed(e: unknown) {
    if (this.pipeline) return;
    this.error = (e as Error)?.message ?? String(e);
    this.settle.fail(e);
  }
}

export class PipelineRecord<P extends GPURenderPipeline | GPUComputePipeline> {
  /** the pipeline as it is (read `pipeline`, which a compile scheduler may make on the spot) */
  _pipe: P | null = null;
  pending: Promise<void> | null = null;
  error: string | null = null;
  /** ms from declared (or rebuilt) to its pipeline made: its own compile, or its wait for the one it shares */
  ms = 0;
  builds = 0;
  /** times its draw or compute came up in a run with no pipeline to run with (still compiling, or failed) and so did
   *  nothing; with kit.debug the first is warned of */
  skipped = 0;
  /** waiting for kit.compiler to say when (kit.ready() doesn't wait for it) */
  deferred = false;
  /** drawn only while this says so (a scheduler holding a feature back until all of it has compiled) */
  gate: (() => boolean) | null = null;
  /** called when its pipeline changes (a compile landing, a hot reload), or fails with none to go on with */
  changed: (() => void) | null = null;
  /** the compile it uses, shared with every record of the same descriptor */
  entry: SharedPipeline | null = null;
  /** optional structured tags, owner and phase metadata (for schedulers and draw filtering without label regexes) */
  readonly tags?: DrawTags;
  readonly owner?: string;
  readonly phase?: string;
  // (its builds counted: a build overtaken by a newer one, or by dispose, lets go; `joined`, the build that joined entry;
  // `started`, the compile it started last)
  private serial = 0;
  private joined = 0;
  private started: SharedPipeline | null = null;
  /** `describe`: its descriptor now (modules left out); `layoutKey`: its layout's description (Binder.layoutKey) */
  constructor(readonly kit: Kit, readonly label: string, readonly shader: Shader, readonly describe: () => PipelineDesc,
    readonly layoutKey: () => string, meta?: { tags?: DrawTags; owner?: string; phase?: string }) {
    this.tags = meta?.tags;
    this.owner = meta?.owner;
    this.phase = meta?.phase;
    kit.pipelines.push(this.self);
  }
  private get self() { return this as unknown as AnyPipelineRecord; }
  get pipeline(): P | null {
    if (!this._pipe && this.deferred && this.kit.compiler) this.kit.compiler.now(this.self);
    return this._pipe;
  }
  set pipeline(p: P | null) {
    if (p === this._pipe) return;
    this._pipe = p;
    this.changed?.();
    // (made on the spot by a compile scheduler: the records sharing its compile have it too)
    if (p && this.entry && !this.entry.pipeline && this.joined === this.serial) this.entry.land(p);
  }
  /** whether its pipeline is one another record compiled (it shares that one's compile) */
  get shared() { return !!this.entry && this.entry !== this.started; }
  /** its pipeline from `module`, compiled asynchronously */
  make(module: GPUShaderModule) { return makePipeline(this.kit, this.describe(), module, true) as Promise<P>; }
  /** its pipeline from `module`, on the spot (a compile scheduler's `now`) */
  makeNow(module: GPUShaderModule) { return makePipeline(this.kit, this.describe(), module, false) as P; }
  /** wait for its pipeline (see kit.ready) */
  ready() { return this.kit.ready(this.self); }
  /** its draw or compute had no pipeline to run with: counted, and with kit.debug the first time is said */
  skip() {
    if (this.skipped++ || !this.kit.debug) return;
    this.kit.warnOnce(`skip:${this.label}`, this.error
      ? `${this.label}: skipped, its pipeline failed: ${this.error.split('\n')[0]}`
      : `${this.label}: run before its pipeline was ready, so it did nothing that time (a one-off pass: await kit.ready(items) first)`);
  }

  build() {
    const t0 = performance.now(), b = ++this.serial;
    // (one built while the scheduler holds is deferred at once: kit.ready() mustn't wait for it, and its shader
    // module isn't even created until its compile actually starts — skipping unused Tint parses for parked sites)
    const holding = !!this.kit.compiler?.holding;
    if (holding) this.deferred = true;
    const p = (async () => {
      try {
        const module = holding ? (await Promise.resolve(), null) : await this.kit.module(this.shader);
        if (b !== this.serial) return;
        const e = this.join(module);
        const pipe = (e.pipeline ?? await e.done) as P;
        if (b !== this.serial) return;
        this.pipeline = pipe;
        this.error = null;
        this.ms = performance.now() - t0;
        this.builds++;
        this.kit.clearError(this.label);
      } catch (e) {
        if (b !== this.serial) return;
        this.error = (e as Error).message ?? String(e);
        this.kit.report('pipeline', this.label, this.error);
        void (this.kit as { diagnoseShader?: (s: Shader) => Promise<void> }).diagnoseShader?.(this.shader);
      }
      // (failed with no pipeline to go on with: what it's baked into records again, a fallback's calls in its place)
      if (this.error && !this._pipe && b === this.serial) this.changed?.();
    })();
    this.pending = p.finally(() => { if (this.pending === wrapped) this.pending = null; });
    const wrapped = this.pending;
    return this.pending;
  }
  /** the compile of its descriptor as it is now: the one made or under way for the same key, a warm cached one, or a new one */
  private join(module: GPUShaderModule | null): SharedPipeline {
    const kit = this.kit, desc = this.describe();
    const key = pipelineKey(desc, this.layoutKey(), shaderTag(this.shader));
    let e = kit.pipelineCache.get(key);
    if (!e) {
      const warm = kit.takeWarmPipeline?.(key);
      if (warm) {
        kit.pipelineCache.set(key, warm);
        e = warm;
      }
    }
    if (!e || e !== this.entry) {
      this.leave();
      if (!e) {
        const made = this.started = e = new SharedPipeline(key, this.shader);
        kit.pipelineCache.set(key, made);
        let p: Promise<AnyPipeline> | null = null;
        const compileWith = (m: GPUShaderModule): Promise<AnyPipeline> => {
          if (made.pipeline) return Promise.resolve(made.pipeline);
          return (makePipeline(kit, desc, m, true) as Promise<AnyPipeline>).catch((err) => {
            // Retry once on transient compiler-service failures (e.g. Metal XPC_ERROR_CONNECTION_INTERRUPTED). A
            // GPUPipelineError says which with its `reason`: 'internal' may pass on a second try, 'validation' never
            // will. The message is matched only for the compiler service's own words, so an invalid shader whose
            // message merely contains "internal" (a name, say) fails at once.
            const msg = String((err as Error)?.message ?? err);
            if ((err as { reason?: string })?.reason !== 'internal' && !/XPC|CONNECTION_INTERRUPTED|compiler service/i.test(msg)) throw err;
            return new Promise<AnyPipeline>((ok, fail) => {
              setTimeout(() => {
                (makePipeline(kit, desc, m, true) as Promise<AnyPipeline>).then(ok, fail);
              }, 250);
            });
          });
        };
        made.start = () => (made.asked = true) && (p ??= made.pipeline
          ? Promise.resolve(made.pipeline)
          : module
            ? compileWith(module)
            : this.shader.version !== made.shaderVersion
              ? Promise.reject(new Error(`shader ${this.shader.id} changed before compile started`))
              : kit.module(this.shader).then(compileWith));
        this.ask(made);
      } else if (!e.pipeline && kit.compiler) this.ask(e);
      e.users.add(this.self);
      this.entry = e;
    }
    this.joined = this.serial;
    return e;
  }
  /** ask for its compile (through the compile scheduler, if there's one): whichever ask is let through first starts it */
  private ask(e: SharedPipeline) {
    const kit = this.kit, c = kit.compiler, t0 = performance.now();
    new Promise((r) => r(c ? c.compile(this.self, e.start, () => e.asked || !!e.pipeline) : e.start())).then(
      (pipe) => { if (!e.pipeline) e.ms = performance.now() - t0; e.land(pipe as AnyPipeline); },
      (err) => {
        e.failed(err);
        if (kit.pipelineCache.get(e.key) === e) kit.pipelineCache.delete(e.key);
        kit.releaseModuleIfUnused?.(e.shader);
      });
  }
  /** let go of its compile (the last record using it retires it to the warm LRU cache, or drops it if uncompiled/stale) */
  private leave() {
    const e = this.entry;
    if (!e) return;
    e.users.delete(this.self);
    if (!e.users.size && this.kit.pipelineCache.get(e.key) === e) {
      this.kit.pipelineCache.delete(e.key);
      this.kit.retirePipeline?.(e);
    }
    this.entry = null;
  }
  /** forget it: it leaves kit.pipelines (kit.ready() and the overlay stop counting it) and lets go of its compile */
  dispose() {
    const list = this.kit.pipelines, i = list.indexOf(this.self);
    if (i >= 0) list.splice(i, 1);
    this.serial++;
    this.leave();
    this.changed = null;
    // (its failure goes with it: kit.errors and the overlay showed a draw that's no longer there — unless another
    // record of the same label has failed too, and the error is as much that one's)
    if (this.error) {
      const label = this.label;
      this.error = null;
      if (!list.some((p) => p.label === label && p.error)) this.kit.clearError(label);
    }
  }
}

/** what kit.ready() waits for: passes, computes, draws, bundles, pipeline records and lists of them (a run list:
 *  what has no pipeline in it is passed over) */
export type Waitable = RunItem | RunAction | PassItem | AnyPipelineRecord | null | undefined | false | readonly Waitable[];

/** the pipeline records of passes (their draws and bundles), computes, draws, bundles, run items made of passes (a
 *  MipChain) and lists of them, once each */
export function pipelinesOf(items: readonly Waitable[], out = new Set<AnyPipelineRecord>()): AnyPipelineRecord[] {
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    if (Array.isArray(it)) pipelinesOf(it, out);
    else if (it instanceof PipelineRecord) out.add(it as AnyPipelineRecord);
    else if ('pipe' in it && it.pipe instanceof PipelineRecord) out.add(it.pipe as AnyPipelineRecord);
    else if ('draws' in it && Array.isArray(it.draws)) pipelinesOf(it.draws as PassItem[], out);
    // (a run item made of passes of its own: a MipChain's)
    else if ('passes' in it && Array.isArray((it as { passes: unknown }).passes)) pipelinesOf((it as { passes: Waitable[] }).passes, out);
  }
  return [...out];
}

/** wait till none of `records()` is compiling, asking again after each wait (up to 20 times) for those declared or
 *  rebuilt meanwhile; those a compile scheduler holds back (deferred) aren't waited for */
export async function settle(records: () => AnyPipelineRecord[]) {
  for (let i = 0; i < 20; i++) {
    const pend = records().filter((p) => !p.deferred).map((p) => p.pending).filter(Boolean);
    if (!pend.length) break;
    await Promise.allSettled(pend);
  }
  const all = records();
  const errors: { label: string; message: string }[] = [];
  for (const p of all) if (p.error) errors.push({ label: p.label, message: p.error });
  return { pipelines: all.length, distinct: new Set(all.map((p) => p.entry ?? p)).size, failed: errors.length, errors };
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

/** the override a fragment shader may declare to learn whether its draw's alpha to coverage is on (1) or not (0) */
const A2C = 'ALPHA_TO_COVERAGE';
function constantsFor(shader: Shader, entry: string, constants?: Record<string, number>) {
  if (!constants) return undefined;
  const e = shader.reflect.entries.find((x) => x.name === entry);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(constants)) {
    if (!(k in shader.reflect.overrides)) throw new BindError(`${shader.id}: no override named '${k}'`);
    if (e?.overrides.includes(k)) out[k] = v;
  }
  // (none this entry reads: as if none were given, so it's the same pipeline as one given none)
  return Object.keys(out).length ? out : undefined;
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
  /** structured metadata for compile schedulers and frame routing (replaces label regexes) */
  tags?: DrawTags;
  owner?: string;
  phase?: string;
}

export class Compute<S extends Shader = Shader> implements RunItem {
  readonly label: string;
  readonly timed = true;
  readonly tags?: DrawTags;
  readonly owner?: string;
  readonly phase?: string;
  enabled: boolean | (() => boolean);
  binder: Binder;
  pipe: PipelineRecord<GPUComputePipeline>;
  private entry: string;
  private unsub: () => void;
  constructor(private kit: Kit, readonly shader: S, readonly opts: ComputeOptions<S>) {
    this.label = opts.label ?? shader.label;
    this.tags = opts.tags;
    this.owner = opts.owner;
    this.phase = opts.phase;
    this.enabled = opts.enabled ?? true;
    this.entry = pickEntry(shader, 'compute', opts.entry, this.label);
    this.binder = new Binder(kit, shader, [this.entry], { ...(opts.bind ?? {}) } as Record<string, unknown>, this.label);
    const desc = (): GPUComputePipelineDescriptor => ({
      label: this.label, layout: this.binder.layout,
      compute: { module: NO_MODULE, entryPoint: this.entry, constants: constantsFor(shader, this.entry, opts.constants) },
    });
    this.pipe = new PipelineRecord(kit, this.label, shader, desc, () => this.binder.layoutKey, { tags: opts.tags, owner: opts.owner, phase: opts.phase });
    this.pipe.build();
    this.unsub = shader.onChange(() => this.rebuild());
  }
  /** wait for its pipeline alone (see kit.ready) */
  ready() { return this.kit.ready(this); }
  /** recompute bindings + pipeline (hot reload) */
  rebuild() {
    try {
      this.wgSize = null;
      this.entry = pickEntry(this.shader, 'compute', this.opts.entry, this.label);
      this.binder.entries = [this.entry];
      this.binder.build();
      this.pipe.build();
    } catch (e) { this.kit.report('bind', this.label, (e as Error).message); }
  }
  set(name: keyof NonNullable<ComputeOptions<S>['bind']> & string, value: Bindable) { this.binder.set(name, value); return this; }
  /** its entry's @workgroup_size (looked up when it's declared and when its shader changes, not every frame) */
  get workgroupSize() { return (this.wgSize ??= this.shader.reflect.entries.find((e) => e.name === this.entry)?.workgroupSize ?? [1, 1, 1]); }
  private wgSize: number[] | null = null;
  encode(enc: GPUCommandEncoder, ts?: GPUComputePassTimestampWrites) {
    const p = this.pipe.pipeline;
    if (!p) { this.pipe.skip(); return; }
    if (this.pipe.gate && !this.pipe.gate()) return;
    const pass = enc.beginComputePass({ label: this.label, timestampWrites: ts });
    pass.setPipeline(p);
    this.binder.apply(pass, this.opts.view ?? this.kit.mainView, this.opts.shared);
    const o = this.opts;
    if (o.indirect) {
      const b = deref(o.indirect.buffer);
      pass.dispatchWorkgroupsIndirect(b instanceof StorageBuffer ? b.gpu : (b as GPUBuffer), o.indirect.offset ?? 0);
    } else {
      let x = 1, y = 1, z = 1;
      if (o.threads) {
        const t = vals(o.threads), s = this.workgroupSize;
        x = Math.ceil(t[0] / s[0]); y = Math.ceil((t[1] ?? 1) / s[1]); z = Math.ceil((t[2] ?? 1) / s[2]);
      } else if (o.workgroups) {
        const w = vals(o.workgroups);
        x = w[0]; y = w[1] ?? 1; z = w[2] ?? 1;
      }
      if (x > 0 && y > 0 && z > 0) pass.dispatchWorkgroups(x, y, z);
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
  /** draw another pass's draws (and its bundles' draws, one by one) from this pass's view, into its own targets — a
   *  probe's cube faces, a second camera — instead of draws of its own. The two passes' targets must have the same
   *  formats and samples (the draws' pipelines are made for the source's). */
  replay?: RenderPass;
  /** (with replay) which of the source's draws to draw: what moves (a dragon, creatures) left out of a probe's capture */
  replayFilter?: (d: Draw) => boolean;
  /** optional ordered draw phases (e.g. ['opaque', 'alpha', 'water', 'translucent', 'skim']). When set, draws and
   *  bundles insert into their declared phase in registration order instead of appending to the end of `draws`. */
  phases?: readonly string[];
  /** automatic subtle per-shader hardware depth bias for opaque triangle draws in this pass, preventing inter-draw
   *  coplanar z-fighting with zero extra pipelines and zero GPU cost. Default true for passes with both colour and
   *  writable depth attachments; ignored for depth-only (shadow) and read-only depth passes. */
  autoDepthBias?: boolean;
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
type TrackedEncoder = DrawEncoder & {
  __weftPipeline?: GPURenderPipeline | null;
  __weftVbBuf?: (GPUBuffer | undefined)[];
  __weftVbOff?: number[];
  __weftIbBuf?: GPUBuffer | null;
  __weftIbFmt?: GPUIndexFormat;
  __weftIbOff?: number;
};
/** forget the pipeline, vertex/index buffers and groups a pass has set (after a bundle or code outside weft changed them) */
export function forgetPassState(enc: DrawEncoder) {
  const t = enc as TrackedEncoder;
  t.__weftPipeline = null;
  t.__weftIbBuf = null;
  const vb = t.__weftVbBuf;
  if (vb) for (let i = 0; i < vb.length; i++) vb[i] = undefined;
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

export type DepthLayer = number | 'terrain' | 'base' | 'detail' | 'decal' | 'overlay';
const DEPTH_LAYERS: Record<string, number> = { terrain: -1, base: 0, detail: 1, decal: 2, overlay: 3 };
const biasSlots = new WeakMap<object, { map: Map<string, number>; next: number }>();
function shaderBiasSlot(kit: Kit, shaderId: string): number {
  let state = biasSlots.get(kit);
  if (!state) biasSlots.set(kit, (state = { map: new Map(), next: 0 }));
  let slot = state.map.get(shaderId);
  if (slot === undefined) {
    slot = 1 + (state.next++ & 15);
    state.map.set(shaderId, slot);
  }
  return slot;
}
function isOpaqueBlend(b: BlendMode | BlendMode[] | undefined): boolean {
  if (b === undefined || b === 'opaque') return true;
  if (Array.isArray(b)) return b.every((x) => x === undefined || x === 'opaque');
  return false;
}

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
  /** semantic depth layer for reversed-Z coplanar tie-breaking ('terrain' < 'base' < 'detail' < 'decal' < 'overlay',
   *  or an integer: < 0 = unbiased reference, 0 = base, > 0 = higher layers). Ignored when `depthBias` is set explicitly. */
  depthLayer?: DepthLayer;
  unclippedDepth?: boolean;
  /** alpha to coverage (a multisampled pass only: on a one-sample pass it's drawn without). A fragment shader that
   *  declares `override ALPHA_TO_COVERAGE: bool` is told whether it's on, so it can cut out by alpha (discard) where
   *  it isn't */
  alphaToCoverage?: boolean;
  count?: Num;
  instances?: Num;
  first?: Num;
  firstInstance?: Num;
  baseVertex?: Num;
  indices?: { buffer: StorageBuffer | GPUBuffer | Ref; format?: GPUIndexFormat; offset?: number };
  /** the draw's arguments read from a buffer (the GPU's: a cull's) at `offset`; `count` such draws (default 1),
   *  `stride` bytes apart (default 20 indexed, 16 not): a multi-draw, each draw's arguments its own — a cull's one draw
   *  per piece, those it culled with no instances. With `count` it's still one Draw (one pipeline, one bind, one
   *  record in a bundle), however many pieces */
  indirect?: { buffer: StorageBuffer | GPUBuffer | Ref; offset?: Num; count?: Num; stride?: number };
  vertexBuffers?: { layout: GPUVertexBufferLayout; buffer: StorageBuffer | GPUBuffer | Ref; offset?: number }[];
  enabled?: boolean | (() => boolean);
  /** issue the draw calls yourself (after the pipeline and bind groups are set) */
  encode?: (pass: GPURenderPassEncoder, draw: Draw<S>) => void;
  /** a draw to draw in this one's place while this one's pipeline has failed to compile (a plainer shader of the same
   *  thing, in place of a hole). Declare it in the same pass (the same bundle, for a bundled draw) with `enabled:
   *  false`, so it never draws by itself: it's drawn when this one would be (this one's `enabled`, with its own counts
   *  and bindings), and only then. Its pipeline compiles when it's declared, like any draw's. */
  fallback?: Draw<any>;
  /** structured metadata for compile schedulers, draw filtering and phased RenderPasses */
  tags?: DrawTags;
  owner?: string;
  phase?: string;
  /** tie-breaker within a RenderPass phase (lower draws first; default 0) */
  order?: number;
}

const gpuBuf = (b: unknown) => { const v = deref(b); return v instanceof StorageBuffer ? v.gpu : (v as GPUBuffer); };

export class Draw<S extends Shader = Shader> {
  /** (a compile scheduler checks this: weft's records support deferral) */
  static scheduled = true;
  readonly label: string;
  readonly tags?: DrawTags;
  readonly owner?: string;
  readonly phase?: string;
  readonly order: number;
  binder: Binder;
  pipe: PipelineRecord<GPURenderPipeline>;
  private vs!: string;
  private fs!: string | null;
  private unsub: () => void;
  private on_: boolean | (() => boolean);
  /** `bundle`: the DrawBundle it's baked into (pass.bundle().draw makes these) */
  constructor(private kit: Kit, readonly pass: RenderPass, readonly shader: S, readonly opts: DrawOptions<S>, readonly bundle: DrawBundle | null = null) {
    this.label = opts.label ?? shader.label;
    this.tags = opts.tags;
    this.owner = opts.owner;
    this.phase = opts.phase;
    this.order = opts.order ?? 0;
    if (bundle && opts.encode) throw new BindError(`${this.label}: a bundled draw can't issue its own calls (encode)`);
    this.on_ = opts.enabled ?? true;
    this.pickEntries();
    this.binder = new Binder(kit, shader, this.fs ? [this.vs, this.fs] : [this.vs], { ...(opts.bind ?? {}) } as Record<string, unknown>, this.label);
    this.pipe = new PipelineRecord(kit, this.label, shader, () => this.descriptor(), () => this.binder.layoutKey, { tags: opts.tags, owner: opts.owner, phase: opts.phase });
    this.pipe.changed = () => this.bundle?.invalidate();
    this.pipe.build();
    this.unsub = shader.onChange(() => this.rebuild());
  }
  /** wait for its pipeline alone (see kit.ready) */
  ready() { return this.pipe.ready(); }
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

  private descriptor(): GPURenderPipelineDescriptor {
    const o = this.opts, module = NO_MODULE;
    const f = this.pass.formats();
    const outs = this.fs ? (this.shader.reflect.entries.find((e) => e.name === this.fs)?.targets ?? 1) : 0;
    const blends: (BlendMode | undefined)[] = Array.isArray(o.blend) ? o.blend : f.colors.map(() => o.blend as BlendMode | undefined);
    const masks: number[] = Array.isArray(o.writeMask) ? o.writeMask : f.colors.map(() => (o.writeMask as number | undefined) ?? 0xf);
    const targets: GPUColorTargetState[] = f.colors.map((format, i) => ({ format, blend: blendOf(blends[i]), writeMask: i < outs ? masks[i] : 0 }));
    const a2c = !!o.alphaToCoverage && f.samples > 1;
    const tells = !!this.fs && !!this.shader.reflect.entries.find((e) => e.name === this.fs)?.overrides.includes(A2C) && !(o.constants && A2C in o.constants);
    const fsConstants = tells ? { ...o.constants, [A2C]: a2c ? 1 : 0 } : o.constants;
    const desc: GPURenderPipelineDescriptor = {
      label: this.label,
      layout: this.binder.layout,
      vertex: { module, entryPoint: this.vs, constants: constantsFor(this.shader, this.vs, o.constants), buffers: o.vertexBuffers?.map((v) => v.layout) },
      primitive: { topology: o.topology ?? 'triangle-list', cullMode: o.cull ?? 'back', frontFace: o.frontFace ?? 'ccw', unclippedDepth: o.unclippedDepth && this.kit.features.has('depth-clip-control') ? true : undefined },
      // (WebGPU refuses alpha to coverage without multisampling: such a pipeline would fail and never draw)
      multisample: { count: f.samples, alphaToCoverageEnabled: a2c },
    };
    // (a fragment shader declaring `override ALPHA_TO_COVERAGE` is told whether it's on — to cut out by alpha itself
    // when its pass has one sample, a phone's — unless the draw sets it; one that doesn't is warned once)
    if (o.alphaToCoverage && f.samples <= 1 && !tells) this.kit.warnOnce(`a2c:${this.label}`, `${this.label}: alphaToCoverage needs a multisampled pass (${this.pass.label} has 1 sample): drawn without it`);
    if (o.topology === 'triangle-strip' || o.topology === 'line-strip') desc.primitive!.stripIndexFormat = o.indices ? (o.indices.format ?? 'uint32') : undefined;
    if (this.fs) desc.fragment = { module, entryPoint: this.fs, constants: constantsFor(this.shader, this.fs, fsConstants), targets };
    if (f.depth) {
      const topo = o.topology ?? 'triangle-list';
      const isTri = topo === 'triangle-list' || topo === 'triangle-strip';
      const cmp = o.depthCompare ?? 'greater-equal';
      const depthWrite = f.depthReadOnly ? false : (o.depthWrite ?? true);
      let depthBias = o.depthBias;
      let depthBiasSlopeScale = o.depthBiasSlopeScale;
      let depthBiasClamp = o.depthBiasClamp;
      const hasExplicitBias = depthBias !== undefined || depthBiasSlopeScale !== undefined || depthBiasClamp !== undefined;
      if (isTri && !hasExplicitBias) {
        if (o.depthLayer !== undefined) {
          const layer = typeof o.depthLayer === 'number' ? o.depthLayer : (DEPTH_LAYERS[o.depthLayer] ?? 0);
          if (layer < 0) {
            depthBias = 0; depthBiasSlopeScale = 0; depthBiasClamp = 0;
          } else {
            const s = shaderBiasSlot(this.kit, this.shader.id);
            depthBias = Math.round(layer * 64) + s * 3;
            depthBiasSlopeScale = layer * 0.4 + s * 0.02;
            depthBiasClamp = Math.min(5e-3, layer >= 2 ? 5e-4 * layer : 5e-4);
          }
        } else if (
          this.pass.opts.autoDepthBias !== false
          && f.colors.length > 0 && !f.depthReadOnly
          && this.fs !== null && depthWrite && isOpaqueBlend(o.blend)
          && (cmp === 'greater-equal' || cmp === 'greater')
        ) {
          const s = shaderBiasSlot(this.kit, this.shader.id);
          depthBias = s * 3;
          depthBiasSlopeScale = s * 0.02;
          depthBiasClamp = 5e-4;
        }
      }
      desc.depthStencil = {
        format: f.depth,
        depthWriteEnabled: depthWrite,
        depthCompare: cmp,
        depthBias, depthBiasSlopeScale, depthBiasClamp,
      };
    }
    return desc;
  }

  encode(pe: GPURenderPassEncoder) { this.encodeInto(pe); }
  /** its calls, into a pass or a bundle (nothing while it's off or its pipeline isn't ready); `view` and `shared` in
   *  place of its pass's (a pass replaying it: RenderPassOptions.replay) */
  encodeInto(enc: DrawEncoder, view?: View, shared?: Record<number, Record<string, unknown>>) {
    // (enabled first: a compile scheduler makes a deferred pipeline on the spot when it's read)
    if (!on(this.on_)) return;
    this.emit(enc, view, shared);
  }
  private falling = false;
  // (its calls whatever its `enabled` says: a fallback is drawn when the draw it stands in for would be)
  private emit(enc: DrawEncoder, view?: View, shared?: Record<number, Record<string, unknown>>) {
    const p = this.pipe.pipeline;
    if (!p) {
      const fb = this.pipe.error ? this.opts.fallback : undefined;
      // (none, or one that came back round to this draw: nothing to draw)
      if (!fb || this.falling) { this.pipe.skip(); return; }
      if (this.pipe.gate && !this.pipe.gate()) return;
      if (this.kit.debug) this.kit.warnOnce(`fallback:${this.label}`, `${this.label}: its pipeline failed, drawing its fallback '${fb.label}'`);
      this.falling = true;
      try { fb.emit(enc, view, shared); } finally { this.falling = false; }
      return;
    }
    if (this.pipe.gate && !this.pipe.gate()) return;
    const o = this.opts;
    // (consecutive draws with one pipeline set it once)
    const tracked = enc as TrackedEncoder;
    if (tracked.__weftPipeline !== p) { tracked.__weftPipeline = p; enc.setPipeline(p); }
    this.binder.apply(enc, view ?? this.pass.opts.view ?? this.kit.mainView, shared ?? this.pass.opts.shared);
    const vb = o.vertexBuffers;
    if (vb) {
      let vbBuf = tracked.__weftVbBuf, vbOff = tracked.__weftVbOff;
      if (!vbBuf) { vbBuf = tracked.__weftVbBuf = []; vbOff = tracked.__weftVbOff = []; }
      for (let i = 0; i < vb.length; i++) {
        const buf = gpuBuf(vb[i].buffer), off = vb[i].offset ?? 0;
        if (vbBuf[i] !== buf || vbOff![i] !== off) {
          vbBuf[i] = buf; vbOff![i] = off;
          enc.setVertexBuffer(i, buf, off);
        }
      }
    }
    if (o.indices) {
      const ib = gpuBuf(o.indices.buffer), fmt = o.indices.format ?? 'uint32', off = o.indices.offset ?? 0;
      if (tracked.__weftIbBuf !== ib || tracked.__weftIbFmt !== fmt || tracked.__weftIbOff !== off) {
        tracked.__weftIbBuf = ib; tracked.__weftIbFmt = fmt; tracked.__weftIbOff = off;
        enc.setIndexBuffer(ib, fmt, off);
      }
    }
    if (o.encode) {
      o.encode(enc as GPURenderPassEncoder, this);
      // (the callback may have set its own pipeline or groups)
      forgetPassState(enc);
      return;
    }
    if (o.indirect) {
      const b = gpuBuf(o.indirect.buffer), at = val(o.indirect.offset, 0), n = val(o.indirect.count, 1);
      const stride = o.indirect.stride ?? (o.indices ? 20 : 16);
      for (let k = 0; k < n; k++) {
        if (o.indices) enc.drawIndexedIndirect(b, at + k * stride);
        else enc.drawIndirect(b, at + k * stride);
      }
      return;
    }
    const count = val(o.count, 3), inst = val(o.instances, 1);
    if (count <= 0 || inst <= 0) return;
    if (o.indices) enc.drawIndexed(count, inst, val(o.first, 0), val(o.baseVertex, 0), val(o.firstInstance, 0));
    else enc.draw(count, inst, val(o.first, 0), val(o.firstInstance, 0));
  }
  /** (bundles) whether an option is asked each frame: enabled, the counts, the indirect offset and count, a
   *  scheduler's gate */
  get watched() {
    const o = this.opts, fn = (x: unknown) => typeof x === 'function';
    return fn(this.on_) || fn(o.count) || fn(o.instances) || fn(o.first) || fn(o.firstInstance) || fn(o.baseVertex) || fn(o.indirect?.offset)
      || fn(o.indirect?.count) || !!this.pipe.gate;
  }
  /** (bundles) those options' values now, into out */
  state(out: number[]) {
    const o = this.opts;
    out[0] = on(this.on_) ? 1 : 0; out[1] = val(o.count, 3); out[2] = val(o.instances, 1); out[3] = val(o.first, 0);
    out[4] = val(o.firstInstance, 0); out[5] = val(o.baseVertex, 0); out[6] = val(o.indirect?.offset, 0);
    out[7] = this.pipe.gate && !this.pipe.gate() ? 0 : 1; out[8] = val(o.indirect?.count, 1);
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
  private phaseIdx: Map<string, number> | null = null;
  private itemKey = new WeakMap<PassItem, [number, number]>();
  constructor(private kit: Kit, readonly opts: RenderPassOptions) {
    this.label = opts.label ?? 'pass';
    this.enabled = opts.enabled ?? true;
    if (opts.phases?.length) {
      this.phaseIdx = new Map();
      for (let i = 0; i < opts.phases.length; i++) this.phaseIdx.set(opts.phases[i], i);
    }
  }
  private resolvePhase(phase: string | undefined, blend: BlendMode | BlendMode[] | undefined, depthWrite: boolean | undefined): number {
    if (!this.phaseIdx) return 0;
    if (phase !== undefined) {
      const idx = this.phaseIdx.get(phase);
      if (idx !== undefined) return idx;
      this.kit.warnOnce(`phase:${this.label}:${phase}`, `${this.label}: unknown phase '${phase}' (has: ${this.opts.phases!.join(', ')})`);
    }
    // (sensible default when a legacy caller omits `phase` on a phased pass)
    const isTranslucent = (blend !== undefined && blend !== 'opaque' && (!Array.isArray(blend) || blend.some((b) => b && b !== 'opaque'))) || depthWrite === false;
    if (isTranslucent) {
      const t = this.phaseIdx.get('translucent');
      if (t !== undefined) return t;
    } else {
      const o = this.phaseIdx.get('opaque');
      if (o !== undefined) return o;
    }
    return this.phaseIdx.size;
  }
  private insertPhased(item: PassItem, phaseIdx: number, order: number) {
    this.itemKey.set(item, [phaseIdx, order]);
    if (!this.phaseIdx || this.placing.length) {
      this.draws.push(item);
      return;
    }
    const draws = this.draws, n = draws.length;
    if (!n) { draws.push(item); return; }
    const last = this.itemKey.get(draws[n - 1]);
    if (!last || phaseIdx > last[0] || (phaseIdx === last[0] && order >= last[1])) {
      draws.push(item);
      return;
    }
    // Binary search upper bound for (phaseIdx, order) — O(log N) comparisons
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const k = this.itemKey.get(draws[mid]);
      if (!k || k[0] < phaseIdx || (k[0] === phaseIdx && k[1] <= order)) lo = mid + 1;
      else hi = mid;
    }
    draws.splice(lo, 0, item);
  }
  draw<S extends Shader>(shader: S, opts: DrawOptions<S> = {}): Draw<S> {
    const d = new Draw(this.kit, this, shader, opts);
    if (this.phaseIdx) {
      const p = this.resolvePhase(opts.phase, opts.blend, opts.depthWrite);
      this.insertPhased(d as unknown as Draw, p, opts.order ?? 0);
    } else {
      this.draws.push(d as unknown as Draw);
    }
    return d;
  }
  /** a bundle of static draws at this point of the pass's order: its draws are recorded once into a GPURenderBundle
   *  and replayed with one call a frame (see bundle.ts for what re-records it) */
  bundle(label = `${this.label}.bundle`, opts?: DrawBundleOptions): DrawBundle {
    const b = new DrawBundle(this.kit, this, label, opts);
    if (this.phaseIdx) {
      const p = this.resolvePhase(opts?.phase, undefined, undefined);
      this.insertPhased(b, p, opts?.order ?? 0);
    } else {
      this.draws.push(b);
    }
    return b;
  }
  // (place: where each call under way began in `draws`, the outermost first)
  private placing: number[] = [];
  /** the draws and bundles `add` declares in this pass, put right before or after `anchor` in its order instead of at
   *  its end: a system declared late (a site streamed in, a chunk loaded on demand) drawn where it belongs, beside the
   *  opaque draws and before the translucent ones. `anchor` is a draw or bundle of this pass, or a label (the first
   *  item of this pass with it); null, or one not in the pass, leaves them at the end, where they were declared.
   *  `add` declares at once (what it declares after an await isn't placed); while it runs its draws are at the end of
   *  `draws`, as ever. A place inside `add` is fine. Returns what was placed, in order. */
  place(anchor: PassItem | string | null | undefined, where: 'before' | 'after', add: () => void): PassItem[] {
    const stack = this.placing, depth = stack.length;
    stack.push(this.draws.length);
    let placed: PassItem[] = [];
    try { add(); } finally {
      // (what `add` declared before it threw is placed too: the pass's order doesn't depend on how it ended)
      placed = this.draws.splice(stack.pop()!);
      const at = typeof anchor === 'string' ? this.draws.findIndex((d) => d.label === anchor) : anchor ? this.draws.indexOf(anchor) : -1;
      if (placed.length) {
        this.draws.splice(at < 0 ? this.draws.length : where === 'before' ? at : at + 1, 0, ...placed);
        // (put ahead of what a place around this one has declared so far: that one's draws begin further on)
        if (at >= 0) for (let i = 0; i < depth; i++) if (at < stack[i]) stack[i] += placed.length;
      }
    }
    return placed;
  }
  /** stop it for good: every draw and bundle in it is disposed */
  dispose() {
    for (const d of [...this.draws]) if (d instanceof Draw || d instanceof DrawBundle) d.dispose();
  }
  /** wait for the pipelines of its draws (and bundles') alone (see kit.ready) */
  ready() { return this.kit.ready(this); }
  /** a fullscreen triangle (the shader includes weft/fullscreen and has a fragment entry) */
  fullscreen<S extends Shader>(shader: S, opts: DrawOptions<S> = {}): Draw<S> {
    return this.draw(shader, { vertex: 'vs_fullscreen', cull: 'none', count: 3, depthWrite: false, depthCompare: 'always', ...opts });
  }

  private replayChecked: RenderPass | null = null;
  // (another pass's draws, bundles opened up, bound with this pass's view and shared values)
  private encodeReplay(pe: GPURenderPassEncoder, src: RenderPass) {
    if (this.replayChecked !== src) {
      const a = this.formats(), b = src.formats();
      if (a.samples !== b.samples || a.depth !== b.depth || a.colors.join() !== b.colors.join()) {
        this.kit.warnOnce(`replay:${this.label}`, `${this.label}: replays ${src.label}, whose targets differ (${b.colors.join()}/${b.depth ?? '-'}×${b.samples} vs ${a.colors.join()}/${a.depth ?? '-'}×${a.samples}): nothing drawn`);
        return;
      }
      this.replayChecked = src;
    }
    const view = this.opts.view ?? this.kit.mainView, shared = this.opts.shared, keep = this.opts.replayFilter;
    for (const d of src.draws) {
      if (d instanceof Draw) { if (!keep || keep(d)) d.encodeInto(pe, view, shared); }
      else if (on(d.enabled)) for (const x of d.draws) if (!keep || keep(x)) x.encodeInto(pe, view, shared);
    }
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
  /** zero-alloc format equality check for DrawBundle.stale() */
  formatsMatch(f: { colors: GPUTextureFormat[]; depth: GPUTextureFormat | undefined; depthReadOnly: boolean; samples: number }): boolean {
    const o = this.opts, cols = o.color, n = cols ? cols.length : 0;
    if (n !== f.colors.length) return false;
    let samples = -1;
    for (let i = 0; i < n; i++) {
      const t = cols![i].target;
      let fmt: GPUTextureFormat, smp: number;
      if (t === 'screen') { fmt = this.kit.format; smp = 1; }
      else {
        const v = deref(t);
        if (v instanceof Texture) { fmt = v.format; smp = v.samples; }
        else if (v instanceof TexView) { fmt = v.texture.format; smp = v.texture.samples; }
        else return false;
      }
      if (fmt !== f.colors[i]) return false;
      if (i === 0) samples = smp;
    }
    const d = o.depth;
    if (!!d?.readOnly !== f.depthReadOnly) return false;
    if (d) {
      const v = deref(d.target);
      let fmt: GPUTextureFormat, smp: number;
      if (v instanceof Texture) { fmt = v.format; smp = v.samples; }
      else if (v instanceof TexView) { fmt = v.texture.format; smp = v.texture.samples; }
      else return false;
      if (fmt !== f.depth) return false;
      if (samples < 0) samples = smp;
    } else if (f.depth !== undefined) {
      return false;
    }
    return (samples < 0 ? 1 : samples) === f.samples;
  }
  private attachView(t: Target): GPUTextureView {
    if (t === 'screen') return this.kit.screenView();
    const v = deref(t);
    if (v instanceof Texture || v instanceof TexView) return v.attachment;
    throw new BindError(`${this.label}: bad attachment`);
  }
  private _colorAtts: GPURenderPassColorAttachment[] = [];
  private _depthAtt: GPURenderPassDepthStencilAttachment | null = null;
  private _depthReadOnly = false;
  private _depthHasStencil = false;
  private _depthFmt: GPUTextureFormat | '' = '';
  private _passDesc: GPURenderPassDescriptor | null = null;
  private static readonly DEFAULT_CLEAR: GPUColor = [0, 0, 0, 0];
  encode(enc: GPUCommandEncoder, ts?: GPURenderPassTimestampWrites) {
    const o = this.opts, cols = o.color, n = cols ? cols.length : 0;
    const colorAttachments = this._colorAtts;
    if (colorAttachments.length !== n) colorAttachments.length = n;
    for (let i = 0; i < n; i++) {
      const c = cols![i];
      let a = colorAttachments[i];
      if (!a) {
        a = colorAttachments[i] = {
          view: this.attachView(c.target),
          resolveTarget: c.resolve ? this.attachView(c.resolve) : undefined,
          loadOp: c.clear === false ? 'load' : 'clear',
          clearValue: c.clear === false ? undefined : (c.clear ?? RenderPass.DEFAULT_CLEAR),
          storeOp: c.store === false ? 'discard' : 'store',
        };
      } else {
        a.view = this.attachView(c.target);
        a.resolveTarget = c.resolve ? this.attachView(c.resolve) : undefined;
        a.loadOp = c.clear === false ? 'load' : 'clear';
        a.clearValue = c.clear === false ? undefined : (c.clear ?? RenderPass.DEFAULT_CLEAR);
        a.storeOp = c.store === false ? 'discard' : 'store';
      }
    }
    let depthStencilAttachment: GPURenderPassDepthStencilAttachment | undefined;
    if (o.depth) {
      const d = o.depth;
      const tex = deref(d.target);
      let fmt: GPUTextureFormat, view: GPUTextureView;
      if (tex instanceof Texture) { fmt = tex.format; view = tex.attachment; }
      else if (tex instanceof TexView) { fmt = tex.texture.format; view = tex.attachment; }
      else throw new BindError(`${this.label}: bad attachment`);
      if (fmt !== this._depthFmt) {
        this._depthFmt = fmt;
        this._depthHasStencil = fmt.includes('stencil');
        this._depthAtt = null;
      }
      const ro = !!d.readOnly;
      if (!this._depthAtt || this._depthReadOnly !== ro) {
        this._depthReadOnly = ro;
        this._depthAtt = ro
          ? { view, depthReadOnly: true, ...(this._depthHasStencil ? { stencilReadOnly: true } : {}) }
          : {
            view,
            depthLoadOp: d.clear === false ? 'load' : 'clear',
            depthClearValue: d.clear === false ? undefined : (d.clear ?? 0),
            depthStoreOp: d.store === false ? 'discard' : 'store',
            ...(this._depthHasStencil ? { stencilLoadOp: 'clear' as const, stencilStoreOp: 'discard' as const } : {}),
          };
      } else {
        this._depthAtt.view = view;
        if (!ro) {
          this._depthAtt.depthLoadOp = d.clear === false ? 'load' : 'clear';
          this._depthAtt.depthClearValue = d.clear === false ? undefined : (d.clear ?? 0);
          this._depthAtt.depthStoreOp = d.store === false ? 'discard' : 'store';
        }
      }
      depthStencilAttachment = this._depthAtt;
    }
    let desc = this._passDesc;
    if (!desc) {
      desc = this._passDesc = { label: this.label, colorAttachments, depthStencilAttachment, timestampWrites: ts };
    } else {
      desc.depthStencilAttachment = depthStencilAttachment;
      desc.timestampWrites = ts;
    }
    const pe = enc.beginRenderPass(desc);
    if (o.viewport) {
      const v = vals(o.viewport);
      pe.setViewport(v[0], v[1], v[2], v[3], 0, 1);
      pe.setScissorRect(Math.max(0, Math.floor(v[0])), Math.max(0, Math.floor(v[1])), Math.max(1, Math.floor(v[2])), Math.max(1, Math.floor(v[3])));
    }
    if (o.replay) this.encodeReplay(pe, o.replay);
    else {
      const draws = this.draws;
      for (let i = 0, dn = draws.length; i < dn; i++) draws[i].encode(pe);
    }
    pe.end();
  }
}

export { RunAction, isDepthFormat };
