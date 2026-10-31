import type { Shader, StructDef } from './shader';
import { Camera } from './camera';
import { UniformBuffer, StorageBuffer, Texture, PingPong, RunAction, type StorageOptions, type TextureDesc } from './resources';
import { Compute, RenderPass, RawItem, type AnyPipelineRecord, type Compiler, type ComputeOptions, type RenderPassOptions, type RunItem, type SharedPipeline, type Waitable } from './passes';
import { SharedGroup, type SamplerName } from './binder';
import { Profiler } from './profiler';
import { DebugOverlay } from './debug';
import type { Frame } from '../shaders/frame.wgsl';
export interface KitOptions {
    /** optional features requested when the adapter has them */
    features?: GPUFeatureName[];
    /** features the app can't run without */
    requiredFeatures?: GPUFeatureName[];
    /** limits to raise (capped to what the adapter offers) */
    limits?: Record<string, number>;
    powerPreference?: GPUPowerPreference;
    /** cap on devicePixelRatio (default 2) */
    maxPixelRatio?: number;
    /** internal resolution / canvas resolution (default 1) */
    renderScale?: number;
    alphaMode?: GPUCanvasAlphaMode;
    /** per-pass error scopes + overlay open (also `?debug` in the URL) */
    debug?: boolean;
    /** an HDR canvas when the display is HDR (dynamic-range: high) and the browser can tone-map one: rgba16float with
     *  extended tone mapping, in Display P3 where supported ('force': skip the display check). See kit.hdr for what the
     *  last pass must write then. Without it (or without the display) the canvas is SDR as always. */
    hdr?: boolean | 'force';
}
/** how the canvas is set up: SDR (the preferred 8-bit format, values 0..1) or HDR (rgba16float with extended tone
 *  mapping: values past 1 are brighter than SDR white, up to the display's headroom). Either way the last pass writes
 *  colour in the canvas colour space with its transfer function — sRGB's, which Display P3 shares; in Display P3 its
 *  primaries too. weft/output.wgsl has canvasEncode() for it. */
export interface HdrState {
    enabled: boolean;
    format: GPUTextureFormat;
    colorSpace: PredefinedColorSpace;
    toneMapping: GPUCanvasToneMappingMode;
}
export declare class WebGPUUnavailable extends Error {
}
export type RunEntry = RunItem | RunAction | null | undefined | false;
/** a camera + its own Frame uniform and group-0 bind group (the main view, a reflection, a shadow cascade…) */
export declare class View {
    private kit;
    camera: Camera;
    size: [number, number] | number | null;
    readonly label: string;
    frame: UniformBuffer<Frame>;
    private group;
    private groupFrame;
    private groupGlobals;
    private groupGlobalsVersion;
    updatedFrame: number;
    /** per-view values for the shaders (Frame.user): a reflection's clip plane, a flag… */
    user: [number, number, number, number];
    /** pixels: fixed, or a fraction of the render size (a half-res reflection: 0.5), or the render size (null) */
    constructor(kit: Kit, camera: Camera, size?: [number, number] | number | null, label?: string);
    get width(): number;
    get height(): number;
    /** recompute the camera and fill the Frame uniform (once per frame unless forced) */
    update(force?: boolean): void;
    /** its group-0 bind group (made again only when the Frame buffer or the globals change) */
    group0(): GPUBindGroup;
    /** stop updating it for good (a reflection or cascade no longer drawn): it leaves kit.views, its Frame is freed */
    dispose(): void;
}
export interface FrameTime {
    time: number;
    dt: number;
    frame: number;
}
export declare class Kit {
    readonly adapter: GPUAdapter;
    readonly device: GPUDevice;
    readonly canvas: HTMLCanvasElement;
    readonly parent: Kit | null;
    readonly features: Set<string>;
    readonly queue: GPUQueue;
    readonly format: GPUTextureFormat;
    readonly context: GPUCanvasContext;
    readonly frameLayout: GPUBindGroupLayout;
    readonly emptyGroup: GPUBindGroup;
    readonly dummyGlobals: GPUBuffer;
    readonly samplers: Record<'linear' | 'repeat' | 'nearest' | 'shadow' | 'nearest-repeat' | 'mirror', GPUSampler>;
    readonly nonFiltering: WeakSet<GPUSampler>;
    readonly rawViews: WeakMap<GPUTexture, GPUTextureView>;
    /** a record per compute and draw (its label, errors and wait), whether or not its pipeline is shared */
    readonly pipelines: AnyPipelineRecord[];
    /** the GPU pipelines the records share, one per distinct descriptor (passes.ts pipelineKey) */
    readonly pipelineCache: Map<string, SharedPipeline>;
    readonly uniformBuffers: Set<UniformBuffer<any>>;
    readonly textures: Set<Texture>;
    /** the storage buffers made by kit.storage (for the memory tally) */
    readonly buffers: Set<StorageBuffer>;
    /** the canvas: SDR or HDR, its format and colour space (see HdrState) */
    readonly hdr: HdrState;
    readonly mainView: View;
    readonly profiler: Profiler;
    readonly overlay: DebugOverlay;
    readonly errors: Map<string, {
        kind: string;
        label: string;
        message: string;
    }>;
    readonly sharedGroups: Map<number, SharedGroup>;
    globals: UniformBuffer<any> | null;
    /** css size, canvas backing size, internal render size */
    size: {
        css: [number, number];
        canvas: [number, number];
        render: [number, number];
        dpr: number;
    };
    renderScale: number;
    maxPixelRatio: number;
    time: number;
    dt: number;
    frameIndex: number;
    timeScale: number;
    paused: boolean;
    /** pixel x, y and buttons of the pointer over the canvas */
    mouse: [number, number, number, number];
    debug: boolean;
    /** stop the rAF loop (headless capture drives frames with tick()) */
    manual: boolean;
    /** cap the loop's rate (0: every animation frame). 30 on a 60 Hz display renders every other refresh */
    maxFps: number;
    /** holds a GPU frame-time budget by moving renderScale (null: off) — see AutoResolution */
    autoRes: AutoResolution | null;
    /** an app's compile scheduler (null: every pipeline compiles the moment it's declared) — see Compiler */
    compiler: Compiler | null;
    /** the run epoch: bumped by each run, each RunAction in it, and the frame's end. A bind group resolved once in an
     *  epoch is reused for the rest of it, so a Ref's target may only change between epochs (in an action, or between
     *  runs), as a ping-pong's swap does */
    bindEpoch: number;
    /** bumped whenever a resource is reallocated (a resize, a buffer grown, a struct relaid out) or the globals change:
     *  bind groups of direct resources are checked again then, and only then */
    resourceGen: number;
    private bgls;
    private modules;
    private warned;
    private canvasConfig;
    private screen;
    private resizeObs;
    private frameCb;
    private lastNow;
    private lastTick;
    private ran;
    /** `parent`: the kit whose device this one shares (see sibling) */
    constructor(adapter: GPUAdapter, device: GPUDevice, canvas: HTMLCanvasElement, opts: KitOptions, parent?: Kit | null);
    get camera(): Camera;
    /** a kit for another canvas, drawn with this kit's device: an overlay over this one (crisp type at the display's
     *  full resolution over a world drawn at less), a second view. It has its own size, frame, passes and resources
     *  (each kit's resources are its own); drive its frames by hand (beginFrame, run, endFrame) or with its own loop.
     *  No debug overlay; the device's errors and its loss are reported by this kit. The device's features and limits
     *  are this kit's. */
    sibling(canvas: HTMLCanvasElement, opts?: Omit<KitOptions, 'features' | 'requiredFeatures' | 'limits' | 'powerPreference' | 'debug'>): Kit;
    uniforms<T>(def: StructDef<T>, label?: string): UniformBuffer<T>;
    storage(o: StorageOptions): StorageBuffer;
    texture(desc: TextureDesc): Texture;
    pingpong<T>(make: (i: number) => T, label?: string): PingPong<T>;
    sampler(desc: GPUSamplerDescriptor): GPUSampler;
    namedSampler(n: SamplerName): GPUSampler | undefined;
    compute<S extends Shader>(shader: S, opts?: ComputeOptions<S>): Compute<S>;
    pass(opts: RenderPassOptions): RenderPass;
    raw(fn: (enc: GPUCommandEncoder) => void, label?: string): RawItem;
    /** a run item copying one texture into another: all of src's mip 0, or `size` of it (from / to the given origins) */
    copy(src: Texture | (() => Texture), dst: Texture | (() => Texture), label?: string, o?: {
        from?: () => [number, number, number];
        to?: () => [number, number, number];
        size?: () => [number, number, number];
    }): RawItem;
    action(fn: () => void, label?: string): RunAction;
    view(camera?: Camera, size?: [number, number] | number | null, label?: string): View;
    /** every view made by kit.view (each is brought up to date once a frame, at the first run) */
    readonly views: View[];
    /** the app's globals struct (group 0, binding 1) */
    setGlobals(u: UniformBuffer<any>): void;
    /** share a bind group (index ≥ 1) between every pipeline whose shader declares it: `shader` is the include that
     *  declares the group, `values` its resources by name. Declare shared groups before the passes that use them. */
    shareGroup(index: number, shader: Shader, values: Record<string, unknown>, label?: string): SharedGroup;
    /** free things for good: textures and buffers are destroyed (and leave the kit's sets, so a resize doesn't bring them
     *  back), draws, bundles, passes, computes and views disposed (their pipelines leave kit.pipelines) */
    release(...things: ({
        destroy(): void;
    } | {
        dispose(): void;
    } | null | undefined)[]): void;
    /** bytes the kit's textures and buffers hold on the GPU (the canvas's own textures aside) */
    memory(): {
        textures: number;
        buffers: number;
        total: number;
    };
    /** (re)configure the canvas as the kit set it up (SDR or HDR), with extra usage (Capture adds copy-src) */
    configureCanvas(usage?: number): void;
    /** a console warning, once per key */
    warnOnce(key: string, message: string): void;
    bindGroupLayout(entries: GPUBindGroupLayoutEntry[], label: string, key?: string): GPUBindGroupLayout;
    /** a compiled shader module (once per shader version); compile errors are mapped back to file:line */
    module(shader: Shader): Promise<GPUShaderModule>;
    /** the shader's module now, made if it isn't yet (null if the shader has an error): a compile scheduler making a
     *  pipeline on the spot doesn't wait for the module's compile info */
    moduleNow(shader: Shader): GPUShaderModule | null;
    /** wait for pipelines to finish compiling.
     *
     *  `kit.ready()`, with nothing given, waits for the whole app: every pipeline declared so far, and any declared while
     *  it waits (it looks again after each wait, up to 20 times). Call it once, behind the loading screen, so nothing
     *  compiles mid-game. It is not the way to wait for one pass: a canyon fill awaiting it waits for every shader the
     *  page has declared by then.
     *
     *  `kit.ready(fill, scene, items)` waits only for what it's given: computes, passes (their draws and bundles), draws,
     *  bundles, and lists of them, so a run list can be given as it is (`await kit.ready(items); kit.run(items)`; what has
     *  no pipeline is passed over, and an empty list waits for nothing). `pass.ready()`, `compute.ready()`,
     *  `draw.ready()` and `bundle.ready()` are the same for one.
     *
     *  Either way pipelines a compile scheduler holds back (deferred) aren't waited for: they're made on the spot when
     *  first used. Resolves with the records waited for, the distinct GPU pipelines among them (records with the same
     *  descriptor share one) and the failures. */
    ready(...items: Waitable[]): Promise<{
        pipelines: number;
        distinct: number;
        failed: number;
    }>;
    report(kind: string, label: string, message: string): void;
    clearError(label: string): void;
    private applySize;
    /** start a frame by hand (the loop does this for you) */
    beginFrame(dt: number): void;
    endFrame(): void;
    private guard;
    /** the swapchain view for this frame (acquired on first use) */
    screenView(): GPUTextureView;
    /** encode + submit an ordered list of passes */
    run(items: RunEntry[]): void;
    /** run `cb` every animation frame (resize, time and the overlay are handled; whatever throws, the loop goes on) */
    loop(cb: (t: FrameTime) => void): void;
    /** advance one frame by hand (headless capture / fixed-step films) */
    step(dt: number): void;
}
/** dynamic resolution: watches the GPU frame time (timestamp queries) and steps renderScale between min and max to
 *  keep it under `budgetMs` — down quickly when over, up slowly when there's room. Steps are coarse (each one reallocates
 *  the screen-sized targets) and at most one every `interval` seconds. */
export declare class AutoResolution {
    budgetMs: number;
    min: number;
    max: number;
    step: number;
    interval: number;
    /** fraction of the budget to aim for when growing (headroom against spikes) */
    headroom: number;
    private t;
    private warm;
    onChange: ((scale: number) => void) | null;
    constructor(budgetMs: number, opts?: Partial<Pick<AutoResolution, 'min' | 'max' | 'step' | 'interval'>>);
    update(kit: Kit): void;
}
export declare function createKit(canvas: HTMLCanvasElement, opts?: KitOptions): Promise<Kit>;
//# sourceMappingURL=kit.d.ts.map