import type { Kit, View } from './kit';
import type { Shader } from './shader';
import { Binder, type Bindable } from './binder';
import { Ref, Texture, TexView, StorageBuffer, RunAction, isDepthFormat } from './resources';
import { DrawBundle } from './bundle';
type Num = number | (() => number);
type Nums = number[] | (() => number[]);
export type BindOf<S> = S extends Shader<object, infer B> ? Partial<Record<B, Bindable>> : Record<string, Bindable>;
export interface RunItem {
    label: string;
    enabled?: boolean | (() => boolean);
    encode(enc: GPUCommandEncoder, ts?: GPUComputePassTimestampWrites | GPURenderPassTimestampWrites): void;
    /** true for passes that can carry timestamp writes */
    timed?: boolean;
}
/** a raw step: anything you'd do with the command encoder yourself (copies, clears, other libraries) */
export declare class RawItem implements RunItem {
    readonly fn: (enc: GPUCommandEncoder) => void;
    readonly label: string;
    enabled: boolean;
    constructor(fn: (enc: GPUCommandEncoder) => void, label?: string);
    encode(enc: GPUCommandEncoder): void;
}
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
    /** when `rec` may compile: call start() (which asks the GPU) when it may, and settle with its result */
    compile(rec: AnyPipelineRecord, start: () => Promise<unknown>): Promise<unknown>;
    /** `rec` is needed now: make it on the spot (rec.makeNow with kit.moduleNow) */
    now(rec: AnyPipelineRecord): void;
}
type PipelineDesc = GPURenderPipelineDescriptor | GPUComputePipelineDescriptor;
/** a value as text, every object's keys sorted and undefined left out (as JSON does): the same descriptor gives the same
 *  text however its objects were spelled. Anything but plain data (a GPU object) is written as its identity. */
export declare function stableKey(v: unknown): string;
/** what tells one pipeline from another: its descriptor with the label left out, the layout as the description of its
 *  bind group layouts (Binder.layoutKey: equal descriptions are the same layouts, kit.bindGroupLayout) and each stage's
 *  module as the shader and version it's made from */
export declare function pipelineKey(desc: PipelineDesc, layout: string, module: string): string;
/** One GPU pipeline and its compile, shared by every record whose descriptor is the same (kit.pipelineCache, by
 *  pipelineKey). It leaves the cache when its last record lets it go (disposed, or rebuilt into another: a hot shader
 *  edit makes new keys), or when its compile fails (so the next record asking tries again). */
export declare class SharedPipeline {
    readonly key: string;
    pipeline: AnyPipeline | null;
    error: string | null;
    /** its compile's ms, from its module made to the pipeline made */
    ms: number;
    /** the records using it */
    readonly users: Set<AnyPipelineRecord>;
    /** settles once its pipeline is made (compiled, or made on the spot by a compile scheduler) or its compile fails */
    readonly done: Promise<AnyPipeline>;
    /** its compile, started by the first of its records' asks let through (nothing once it's landed) */
    start: () => Promise<AnyPipeline>;
    private settle;
    constructor(key: string);
    /** its pipeline is made: every record using it has it (a later one, a compile finishing after one was made on the
     *  spot, is let go) */
    land(p: AnyPipeline): void;
    failed(e: unknown): void;
}
export declare class PipelineRecord<P extends GPURenderPipeline | GPUComputePipeline> {
    readonly kit: Kit;
    readonly label: string;
    readonly shader: Shader;
    readonly describe: () => PipelineDesc;
    readonly layoutKey: () => string;
    /** the pipeline as it is (read `pipeline`, which a compile scheduler may make on the spot) */
    _pipe: P | null;
    pending: Promise<void> | null;
    error: string | null;
    /** ms from declared (or rebuilt) to its pipeline made: its own compile, or its wait for the one it shares */
    ms: number;
    builds: number;
    /** waiting for kit.compiler to say when (kit.ready() doesn't wait for it) */
    deferred: boolean;
    /** drawn only while this says so (a scheduler holding a feature back until all of it has compiled) */
    gate: (() => boolean) | null;
    /** called when its pipeline changes (a compile landing, a hot reload) */
    changed: (() => void) | null;
    /** the compile it uses, shared with every record of the same descriptor */
    entry: SharedPipeline | null;
    private serial;
    private joined;
    private started;
    /** `describe`: its descriptor now (modules left out); `layoutKey`: its layout's description (Binder.layoutKey) */
    constructor(kit: Kit, label: string, shader: Shader, describe: () => PipelineDesc, layoutKey: () => string);
    private get self();
    get pipeline(): P | null;
    set pipeline(p: P | null);
    /** whether its pipeline is one another record compiled (it shares that one's compile) */
    get shared(): boolean;
    /** its pipeline from `module`, compiled asynchronously */
    make(module: GPUShaderModule): Promise<P>;
    /** its pipeline from `module`, on the spot (a compile scheduler's `now`) */
    makeNow(module: GPUShaderModule): P;
    /** wait for its pipeline (see kit.ready) */
    ready(): Promise<{
        pipelines: number;
        distinct: number;
        failed: number;
    }>;
    build(): Promise<void>;
    /** the compile of its descriptor as it is now: the one made or under way for the same key, or a new one */
    private join;
    /** ask for its compile (through the compile scheduler, if there's one): whichever ask is let through first starts it */
    private ask;
    /** let go of its compile (the last record using it takes it out of the cache) */
    private leave;
    /** forget it: it leaves kit.pipelines (kit.ready() and the overlay stop counting it) and lets go of its compile */
    dispose(): void;
}
/** what kit.ready() waits for: passes, computes, draws, bundles, pipeline records and lists of them (a run list:
 *  what has no pipeline in it is passed over) */
export type Waitable = RunItem | RunAction | PassItem | AnyPipelineRecord | null | undefined | false | readonly Waitable[];
/** the pipeline records of passes (their draws and bundles), computes, draws, bundles and lists of them, once each */
export declare function pipelinesOf(items: readonly Waitable[], out?: Set<AnyPipelineRecord>): AnyPipelineRecord[];
/** wait till none of `records()` is compiling, asking again after each wait (up to 20 times) for those declared or
 *  rebuilt meanwhile; those a compile scheduler holds back (deferred) aren't waited for */
export declare function settle(records: () => AnyPipelineRecord[]): Promise<{
    pipelines: number;
    distinct: number;
    failed: number;
}>;
export interface ComputeOptions<S extends Shader = Shader> {
    label?: string;
    entry?: string;
    bind?: BindOf<S>;
    constants?: Record<string, number>;
    /** workgroup counts, or `threads` (divided by the shader's @workgroup_size, rounded up) */
    workgroups?: Nums;
    threads?: Nums;
    indirect?: {
        buffer: StorageBuffer | GPUBuffer | Ref;
        offset?: number;
    };
    view?: View;
    shared?: Record<number, Record<string, unknown>>;
    enabled?: boolean | (() => boolean);
}
export declare class Compute<S extends Shader = Shader> implements RunItem {
    private kit;
    readonly shader: S;
    readonly opts: ComputeOptions<S>;
    readonly label: string;
    readonly timed = true;
    enabled: boolean | (() => boolean);
    binder: Binder;
    pipe: PipelineRecord<GPUComputePipeline>;
    private entry;
    private unsub;
    constructor(kit: Kit, shader: S, opts: ComputeOptions<S>);
    /** wait for its pipeline alone (see kit.ready) */
    ready(): Promise<{
        pipelines: number;
        distinct: number;
        failed: number;
    }>;
    /** recompute bindings + pipeline (hot reload) */
    rebuild(): void;
    set(name: keyof NonNullable<ComputeOptions<S>['bind']> & string, value: Bindable): this;
    get workgroupSize(): number[];
    encode(enc: GPUCommandEncoder, ts?: GPUComputePassTimestampWrites): void;
    /** stop it for good: no more hot rebuilds, and its pipeline leaves the kit */
    dispose(): void;
}
export type Target = Texture | TexView | Ref | 'screen';
export interface ColorAttachment {
    target: Target;
    /** clear colour, or false to load what's there */
    clear?: GPUColor | false;
    /** multisample resolve target */
    resolve?: Target;
    store?: boolean;
}
export interface DepthAttachment {
    target: Texture | TexView | Ref;
    clear?: number | false;
    store?: boolean;
    readOnly?: boolean;
}
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
/** forget the pipeline and groups a pass has set (after a bundle or code outside weft changed them) */
export declare function forgetPassState(enc: DrawEncoder): void;
export type BlendMode = 'opaque' | 'alpha' | 'premultiplied' | 'add' | 'add-alpha' | 'multiply' | 'max' | GPUBlendState;
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
    indices?: {
        buffer: StorageBuffer | GPUBuffer | Ref;
        format?: GPUIndexFormat;
        offset?: number;
    };
    indirect?: {
        buffer: StorageBuffer | GPUBuffer | Ref;
        offset?: Num;
    };
    vertexBuffers?: {
        layout: GPUVertexBufferLayout;
        buffer: StorageBuffer | GPUBuffer | Ref;
        offset?: number;
    }[];
    enabled?: boolean | (() => boolean);
    /** issue the draw calls yourself (after the pipeline and bind groups are set) */
    encode?: (pass: GPURenderPassEncoder, draw: Draw<S>) => void;
}
export declare class Draw<S extends Shader = Shader> {
    private kit;
    readonly pass: RenderPass;
    readonly shader: S;
    readonly opts: DrawOptions<S>;
    readonly bundle: DrawBundle | null;
    /** (a compile scheduler checks this: weft's records support deferral) */
    static scheduled: boolean;
    readonly label: string;
    binder: Binder;
    pipe: PipelineRecord<GPURenderPipeline>;
    private vs;
    private fs;
    private unsub;
    private on_;
    /** `bundle`: the DrawBundle it's baked into (pass.bundle().draw makes these) */
    constructor(kit: Kit, pass: RenderPass, shader: S, opts: DrawOptions<S>, bundle?: DrawBundle | null);
    /** wait for its pipeline alone (see kit.ready) */
    ready(): Promise<{
        pipelines: number;
        distinct: number;
        failed: number;
    }>;
    /** drawn or not (a function is asked each frame) */
    get enabled(): boolean | (() => boolean);
    set enabled(v: boolean | (() => boolean));
    private pickEntries;
    rebuild(): void;
    set(name: keyof NonNullable<DrawOptions<S>['bind']> & string, value: Bindable): this;
    private descriptor;
    encode(pe: GPURenderPassEncoder): void;
    /** its calls, into a pass or a bundle (nothing while it's off or its pipeline isn't ready) */
    encodeInto(enc: DrawEncoder): void;
    /** (bundles) whether an option is asked each frame: enabled, the counts, the indirect offset, a scheduler's gate */
    get watched(): boolean;
    /** (bundles) those options' values now, into out */
    state(out: number[]): number[];
    /** (bundles) whether a vertex, index or indirect buffer is given through a Ref */
    get refBuffers(): boolean;
    /** stop drawing it for good: it leaves its pass (or bundle), and its pipeline leaves the kit */
    dispose(): void;
}
/** what a pass draws, in order: draws, and bundles of static draws */
export type PassItem = Draw | DrawBundle;
export declare class RenderPass implements RunItem {
    private kit;
    readonly opts: RenderPassOptions;
    readonly label: string;
    readonly timed = true;
    enabled: boolean | (() => boolean);
    draws: PassItem[];
    constructor(kit: Kit, opts: RenderPassOptions);
    draw<S extends Shader>(shader: S, opts?: DrawOptions<S>): Draw<S>;
    /** a bundle of static draws at this point of the pass's order: its draws are recorded once into a GPURenderBundle
     *  and replayed with one call a frame (see bundle.ts for what re-records it) */
    bundle(label?: string): DrawBundle;
    /** stop it for good: every draw and bundle in it is disposed */
    dispose(): void;
    /** wait for the pipelines of its draws (and bundles') alone (see kit.ready) */
    ready(): Promise<{
        pipelines: number;
        distinct: number;
        failed: number;
    }>;
    /** a fullscreen triangle (the shader includes weft/fullscreen and has a fragment entry) */
    fullscreen<S extends Shader>(shader: S, opts?: DrawOptions<S>): Draw<S>;
    private targetFormat;
    formats(): {
        colors: GPUTextureFormat[];
        depth: GPUTextureFormat | undefined;
        depthReadOnly: boolean;
        samples: number;
    };
    private attachView;
    encode(enc: GPUCommandEncoder, ts?: GPURenderPassTimestampWrites): void;
}
export { RunAction, isDepthFormat };
//# sourceMappingURL=passes.d.ts.map