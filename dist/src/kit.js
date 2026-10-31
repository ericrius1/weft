// The kit: device + canvas, the resource factories, the frame loop and `run([...])`, which encodes an explicit,
// ordered list of passes. No scene graph, no hidden scheduling: what you list is what runs, in that order.
// Each run (and each RunAction in it) starts a bind epoch, the span in which a bind group once resolved is reused; the
// canvas is SDR (the preferred 8-bit format) unless an HDR one is asked for and the display has it (kit.hdr).
import frameShader from '../shaders/frame.wgsl';
import { sourceLine } from './shader';
import { Camera } from './camera';
import { UniformBuffer, StorageBuffer, Texture, PingPong, RunAction } from './resources';
import { Compute, RenderPass, RawItem, pipelinesOf, settle } from './passes';
import { SharedGroup } from './binder';
import { STAGE, TEX } from './gpuconst';
import { Profiler } from './profiler';
import { DebugOverlay } from './debug';
export class WebGPUUnavailable extends Error {
}
const COMPILE_INFO_WAIT = 4000;
const DEFAULT_FEATURES = ['timestamp-query', 'float32-filterable', 'rg11b10ufloat-renderable', 'indirect-first-instance', 'depth-clip-control'];
const LIMITS = ['maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeWorkgroupStorageSize', 'maxStorageBuffersPerShaderStage',
    'maxStorageTexturesPerShaderStage', 'maxSampledTexturesPerShaderStage', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX',
    'maxComputeWorkgroupSizeY', 'maxColorAttachmentBytesPerSample', 'maxTextureArrayLayers', 'maxTextureDimension2D'];
/** a camera + its own Frame uniform and group-0 bind group (the main view, a reflection, a shadow cascade…) */
export class View {
    kit;
    camera;
    size;
    label;
    frame;
    group = null;
    // (what the frame group holds: the Frame buffer's version, the globals and their version)
    groupFrame = -1;
    groupGlobals = null;
    groupGlobalsVersion = -1;
    updatedFrame = -1;
    /** per-view values for the shaders (Frame.user): a reflection's clip plane, a flag… */
    user = [0, 0, 0, 0];
    /** pixels: fixed, or a fraction of the render size (a half-res reflection: 0.5), or the render size (null) */
    constructor(kit, camera, size = null, label = 'view') {
        this.kit = kit;
        this.camera = camera;
        this.size = size;
        this.label = label;
        this.frame = kit.uniforms(frameShader.structs.Frame, `${label}.frame`);
    }
    get width() { const s = this.size; return Array.isArray(s) ? s[0] : Math.max(1, Math.round(this.kit.size.render[0] * (s ?? 1))); }
    get height() { const s = this.size; return Array.isArray(s) ? s[1] : Math.max(1, Math.round(this.kit.size.render[1] * (s ?? 1))); }
    /** recompute the camera and fill the Frame uniform (once per frame unless forced) */
    update(force = false) {
        const k = this.kit;
        if (!force && this.updatedFrame === k.frameIndex)
            return;
        this.updatedFrame = k.frameIndex;
        const c = this.camera, w = this.width, h = this.height;
        c.update(w, h);
        this.frame.set({
            viewProj: c.viewProj, view: c.view, proj: c.proj, invViewProj: c.invViewProj, invProj: c.invProj, invView: c.invView,
            prevViewProj: c.prevViewProj, camPos: c.position, time: k.time, camFwd: c.forward, dt: k.dt, camRight: c.right,
            near: c.near, camUp: c.up, frame: k.frameIndex, res: [w, h], invRes: [1 / w, 1 / h], jitter: c.jitter, fovY: c.fovY,
            aspect: w / h, mouse: k.mouse, user: this.user,
        });
    }
    /** its group-0 bind group (made again only when the Frame buffer or the globals change) */
    group0() {
        const g = this.kit.globals, gv = g ? g.version : 0;
        if (!this.group || this.groupFrame !== this.frame.version || this.groupGlobals !== g || this.groupGlobalsVersion !== gv) {
            const s = this.kit.samplers;
            this.group = this.kit.device.createBindGroup({
                label: `${this.label}.group0`, layout: this.kit.frameLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.frame.gpu } },
                    { binding: 1, resource: { buffer: g ? g.gpu : this.kit.dummyGlobals } },
                    { binding: 2, resource: s.linear }, { binding: 3, resource: s.repeat }, { binding: 4, resource: s.nearest }, { binding: 5, resource: s.shadow },
                ],
            });
            this.groupFrame = this.frame.version;
            this.groupGlobals = g;
            this.groupGlobalsVersion = gv;
        }
        return this.group;
    }
    /** stop updating it for good (a reflection or cascade no longer drawn): it leaves kit.views, its Frame is freed */
    dispose() {
        const list = this.kit.views, i = list.indexOf(this);
        if (i >= 0)
            list.splice(i, 1);
        this.frame.destroy();
    }
}
export class Kit {
    adapter;
    device;
    canvas;
    parent;
    features;
    queue;
    format;
    context;
    frameLayout;
    emptyGroup;
    dummyGlobals;
    samplers;
    nonFiltering = new WeakSet();
    rawViews = new WeakMap();
    /** a record per compute and draw (its label, errors and wait), whether or not its pipeline is shared */
    pipelines = [];
    /** the GPU pipelines the records share, one per distinct descriptor (passes.ts pipelineKey) */
    pipelineCache = new Map();
    uniformBuffers = new Set();
    textures = new Set();
    /** the storage buffers made by kit.storage (for the memory tally) */
    buffers = new Set();
    /** the canvas: SDR or HDR, its format and colour space (see HdrState) */
    hdr;
    mainView;
    profiler;
    overlay;
    errors = new Map();
    sharedGroups = new Map();
    globals = null;
    /** css size, canvas backing size, internal render size */
    size = { css: [1, 1], canvas: [1, 1], render: [1, 1], dpr: 1 };
    renderScale;
    maxPixelRatio;
    time = 0;
    dt = 1 / 60;
    frameIndex = 0;
    timeScale = 1;
    paused = false;
    /** pixel x, y and buttons of the pointer over the canvas */
    mouse = [0, 0, 0, 0];
    debug;
    /** stop the rAF loop (headless capture drives frames with tick()) */
    manual = false;
    /** cap the loop's rate (0: every animation frame). 30 on a 60 Hz display renders every other refresh */
    maxFps = 0;
    /** holds a GPU frame-time budget by moving renderScale (null: off) — see AutoResolution */
    autoRes = null;
    /** an app's compile scheduler (null: every pipeline compiles the moment it's declared) — see Compiler */
    compiler = null;
    /** the run epoch: bumped by each run, each RunAction in it, and the frame's end. A bind group resolved once in an
     *  epoch is reused for the rest of it, so a Ref's target may only change between epochs (in an action, or between
     *  runs), as a ping-pong's swap does */
    bindEpoch = 0;
    /** bumped whenever a resource is reallocated (a resize, a buffer grown, a struct relaid out) or the globals change:
     *  bind groups of direct resources are checked again then, and only then */
    resourceGen = 0;
    bgls = new Map();
    modules = new Map();
    warned = new Set();
    canvasConfig;
    screen = null;
    resizeObs;
    frameCb = null;
    lastNow = 0;
    lastTick = 0;
    ran = [];
    /** `parent`: the kit whose device this one shares (see sibling) */
    constructor(adapter, device, canvas, opts, parent = null) {
        this.adapter = adapter;
        this.device = device;
        this.canvas = canvas;
        this.parent = parent;
        this.queue = device.queue;
        this.features = new Set([...device.features]);
        this.debug = opts.debug ?? new URLSearchParams(location.search).has('debug');
        this.renderScale = opts.renderScale ?? 1;
        this.maxPixelRatio = opts.maxPixelRatio ?? 2;
        const ctx = canvas.getContext('webgpu');
        if (!ctx)
            throw new WebGPUUnavailable('Could not create a WebGPU canvas context.');
        this.context = ctx;
        const sdr = { device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: opts.alphaMode ?? 'opaque' };
        this.canvasConfig = sdr;
        this.hdr = { enabled: false, format: sdr.format, colorSpace: 'srgb', toneMapping: 'standard' };
        if (opts.hdr === 'force' || (opts.hdr && matchMedia('(dynamic-range: high)').matches)) {
            // (a browser that can't tone-map a canvas leaves toneMapping out of getConfiguration: then it stays SDR)
            for (const colorSpace of ['display-p3', 'srgb']) {
                const want = { ...sdr, format: 'rgba16float', colorSpace, toneMapping: { mode: 'extended' } };
                try {
                    ctx.configure(want);
                    const got = ctx.getConfiguration?.();
                    if (got?.toneMapping?.mode !== 'extended')
                        break;
                    this.canvasConfig = want;
                    this.hdr = { enabled: true, format: want.format, colorSpace: got.colorSpace, toneMapping: 'extended' };
                    break;
                }
                catch (e) {
                    console.warn(`[weft] no ${colorSpace} HDR canvas:`, e.message);
                }
            }
        }
        this.format = this.hdr.format;
        this.configureCanvas();
        const all = STAGE.VERTEX | STAGE.FRAGMENT | STAGE.COMPUTE;
        this.frameLayout = device.createBindGroupLayout({
            label: 'weft.frame',
            entries: [
                { binding: 0, visibility: all, buffer: { type: 'uniform' } },
                { binding: 1, visibility: all, buffer: { type: 'uniform' } },
                { binding: 2, visibility: all, sampler: { type: 'filtering' } },
                { binding: 3, visibility: all, sampler: { type: 'filtering' } },
                { binding: 4, visibility: all, sampler: { type: 'non-filtering' } },
                { binding: 5, visibility: all, sampler: { type: 'comparison' } },
            ],
        });
        this.emptyGroup = device.createBindGroup({ label: 'weft.empty', layout: device.createBindGroupLayout({ entries: [] }), entries: [] });
        this.dummyGlobals = device.createBuffer({ label: 'weft.noGlobals', size: 4096, usage: 0x40 /* UNIFORM */ });
        const lin = { magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' };
        this.samplers = {
            linear: device.createSampler({ label: 'linear', ...lin }),
            repeat: device.createSampler({ label: 'repeat', ...lin, addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat', maxAnisotropy: 8 }),
            nearest: device.createSampler({ label: 'nearest' }),
            'nearest-repeat': device.createSampler({ label: 'nearest-repeat', addressModeU: 'repeat', addressModeV: 'repeat' }),
            mirror: device.createSampler({ label: 'mirror', ...lin, addressModeU: 'mirror-repeat', addressModeV: 'mirror-repeat' }),
            shadow: device.createSampler({ label: 'shadow', compare: 'greater-equal', magFilter: 'linear', minFilter: 'linear' }),
        };
        this.nonFiltering.add(this.samplers.nearest);
        this.nonFiltering.add(this.samplers['nearest-repeat']);
        this.mainView = new View(this, new Camera(), null, 'main');
        this.profiler = new Profiler(this);
        // (a sibling has no overlay of its own, and leaves the device's errors and its loss to the kit that made it)
        this.overlay = new DebugOverlay(this, !parent);
        if (!parent) {
            device.lost.then((info) => {
                if (info.reason !== 'destroyed')
                    this.report('device', 'device lost', `${info.message || 'the GPU device was lost'} — reload the page`);
            });
            device.addEventListener('uncapturederror', (e) => {
                const msg = e.error.message;
                this.report('gpu', 'uncaptured', msg);
            });
        }
        this.resizeObs = new ResizeObserver((entries) => {
            for (const e of entries) {
                const box = e.contentBoxSize?.[0];
                this.size.css = box ? [box.inlineSize, box.blockSize] : [canvas.clientWidth, canvas.clientHeight];
            }
        });
        this.resizeObs.observe(canvas);
        this.size.css = [canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight];
        canvas.addEventListener('pointermove', (e) => {
            const r = canvas.getBoundingClientRect();
            this.mouse[0] = ((e.clientX - r.left) / r.width) * this.size.render[0];
            this.mouse[1] = ((e.clientY - r.top) / r.height) * this.size.render[1];
            this.mouse[2] = e.buttons;
        });
        this.applySize();
    }
    get camera() { return this.mainView.camera; }
    /** a kit for another canvas, drawn with this kit's device: an overlay over this one (crisp type at the display's
     *  full resolution over a world drawn at less), a second view. It has its own size, frame, passes and resources
     *  (each kit's resources are its own); drive its frames by hand (beginFrame, run, endFrame) or with its own loop.
     *  No debug overlay; the device's errors and its loss are reported by this kit. The device's features and limits
     *  are this kit's. */
    sibling(canvas, opts = {}) {
        return new Kit(this.adapter, this.device, canvas, opts, this);
    }
    // ------------------------------------------------------------ factories
    uniforms(def, label = def.name) {
        const u = new UniformBuffer(this, def, label);
        this.uniformBuffers.add(u);
        return u;
    }
    storage(o) {
        const b = new StorageBuffer(this, o);
        this.buffers.add(b);
        return b;
    }
    texture(desc) {
        const t = new Texture(this, desc);
        this.textures.add(t);
        return t;
    }
    pingpong(make, label = 'pingpong') { return new PingPong(make(0), make(1), label); }
    sampler(desc) {
        const s = this.device.createSampler(desc);
        if ((desc.magFilter ?? 'nearest') === 'nearest' && (desc.minFilter ?? 'nearest') === 'nearest' && (desc.mipmapFilter ?? 'nearest') === 'nearest' && !desc.compare)
            this.nonFiltering.add(s);
        return s;
    }
    namedSampler(n) { return this.samplers[n]; }
    compute(shader, opts = {}) { return new Compute(this, shader, opts); }
    pass(opts) { return new RenderPass(this, opts); }
    raw(fn, label = 'raw') { return new RawItem(fn, label); }
    /** a run item copying one texture into another: all of src's mip 0, or `size` of it (from / to the given origins) */
    copy(src, dst, label = 'copy', o = {}) {
        return new RawItem((enc) => {
            const s = typeof src === 'function' ? src() : src, d = typeof dst === 'function' ? dst() : dst;
            const size = o.size?.() ?? [Math.min(s.width, d.width), Math.min(s.height, d.height), 1];
            if (size[0] <= 0 || size[1] <= 0)
                return;
            enc.copyTextureToTexture({ texture: s.gpu, origin: o.from?.() ?? [0, 0, 0] }, { texture: d.gpu, origin: o.to?.() ?? [0, 0, 0] }, size);
        }, label);
    }
    action(fn, label = 'action') { return new RunAction(fn, label); }
    view(camera = new Camera(), size = null, label = 'view') {
        const v = new View(this, camera, size, label);
        this.views.push(v);
        return v;
    }
    /** every view made by kit.view (each is brought up to date once a frame, at the first run) */
    views = [];
    /** the app's globals struct (group 0, binding 1) */
    setGlobals(u) {
        this.globals = u;
        this.resourceGen++;
    }
    /** share a bind group (index ≥ 1) between every pipeline whose shader declares it: `shader` is the include that
     *  declares the group, `values` its resources by name. Declare shared groups before the passes that use them. */
    shareGroup(index, shader, values, label = `shared${index}`) {
        if (index < 1)
            throw new Error('group 0 is the frame group');
        const g = new SharedGroup(this, index, shader, { ...values }, label);
        this.sharedGroups.set(index, g);
        return g;
    }
    /** free things for good: textures and buffers are destroyed (and leave the kit's sets, so a resize doesn't bring them
     *  back), draws, bundles, passes, computes and views disposed (their pipelines leave kit.pipelines) */
    release(...things) {
        for (const t of things) {
            if (!t)
                continue;
            if ('dispose' in t)
                t.dispose();
            else
                t.destroy();
        }
    }
    /** bytes the kit's textures and buffers hold on the GPU (the canvas's own textures aside) */
    memory() {
        let textures = 0, buffers = 0;
        for (const t of this.textures)
            textures += t.bytes;
        for (const b of this.buffers)
            buffers += b.size;
        for (const u of this.uniformBuffers)
            buffers += u.gpu.size;
        return { textures, buffers, total: textures + buffers };
    }
    /** (re)configure the canvas as the kit set it up (SDR or HDR), with extra usage (Capture adds copy-src) */
    configureCanvas(usage = 0) {
        this.context.configure({ ...this.canvasConfig, usage: TEX.RENDER_ATTACHMENT | usage });
    }
    /** a console warning, once per key */
    warnOnce(key, message) {
        if (this.warned.has(key))
            return;
        this.warned.add(key);
        console.warn(`[weft] ${message}`);
    }
    bindGroupLayout(entries, label, key = JSON.stringify(entries)) {
        let l = this.bgls.get(key);
        if (!l)
            this.bgls.set(key, (l = this.device.createBindGroupLayout({ label, entries })));
        return l;
    }
    /** a compiled shader module (once per shader version); compile errors are mapped back to file:line */
    module(shader) {
        const c = this.modules.get(shader);
        if (c && c.version === shader.version)
            return c.module;
        const entry = { version: shader.version, module: null, raw: null };
        const p = (async () => {
            if (shader.error)
                throw new Error(shader.error);
            // (scoped, so a bad shader is reported once — mapped to file:line below — not again as an uncaptured error)
            this.device.pushErrorScope('validation');
            const m = this.device.createShaderModule({ label: shader.id, code: shader.code });
            entry.raw = m;
            void this.device.popErrorScope();
            // (WebKit now and then never answers getCompilationInfo: after a few seconds the module is used as it is — a bad
            // one then fails its pipelines instead — so a shader can't hold kit.ready() for ever)
            let timer;
            const late = new Promise((r) => { timer = setTimeout(() => r(null), COMPILE_INFO_WAIT); });
            const info = await Promise.race([m.getCompilationInfo(), late]).finally(() => clearTimeout(timer));
            if (!info) {
                this.warnOnce(`info:${shader.id}`, `${shader.id}: no compile info after ${COMPILE_INFO_WAIT / 1000} s, using the module as it is`);
                return m;
            }
            const errs = info.messages.filter((x) => x.type === 'error');
            for (const msg of info.messages) {
                if (msg.type === 'info')
                    continue;
                const at = sourceLine(shader, msg.lineNum);
                const text = `${at.file}:${at.line}:${msg.linePos} ${msg.message}\n    ${(shader.code.split('\n')[msg.lineNum - 1] ?? '').trim()}`;
                if (msg.type === 'warning')
                    console.warn('[weft]', text);
            }
            if (errs.length) {
                const text = errs.map((msg) => {
                    const at = sourceLine(shader, msg.lineNum);
                    return `${at.file}:${at.line}:${msg.linePos} ${msg.message}\n    ${(shader.code.split('\n')[msg.lineNum - 1] ?? '').trim()}`;
                }).join('\n');
                this.report('shader', shader.id, text);
                throw new Error(`shader ${shader.id} failed to compile`);
            }
            this.clearError(shader.id);
            return m;
        })();
        entry.module = p;
        this.modules.set(shader, entry);
        return p;
    }
    /** the shader's module now, made if it isn't yet (null if the shader has an error): a compile scheduler making a
     *  pipeline on the spot doesn't wait for the module's compile info */
    moduleNow(shader) {
        const c = this.modules.get(shader);
        if (c && c.version === shader.version && c.raw)
            return c.raw;
        void this.module(shader).catch(() => { });
        return this.modules.get(shader)?.raw ?? null;
    }
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
    async ready(...items) {
        return settle(items.length ? () => pipelinesOf(items) : () => this.pipelines);
    }
    // ------------------------------------------------------------ errors
    report(kind, label, message) {
        const key = `${kind}:${label}`;
        if (this.errors.get(key)?.message === message)
            return;
        this.errors.set(key, { kind, label, message });
        console.error(`[weft ${kind}] ${label}: ${message}`);
        this.overlay.errorsChanged();
    }
    clearError(label) {
        let changed = false;
        for (const [k, e] of this.errors)
            if (e.label === label) {
                this.errors.delete(k);
                changed = true;
            }
        if (changed)
            this.overlay.errorsChanged();
    }
    // ------------------------------------------------------------ frame
    applySize() {
        const dpr = Math.min(devicePixelRatio || 1, this.maxPixelRatio);
        const cw = Math.max(1, Math.round(this.size.css[0] * dpr)), ch = Math.max(1, Math.round(this.size.css[1] * dpr));
        const rw = Math.max(1, Math.round(cw * this.renderScale)), rh = Math.max(1, Math.round(ch * this.renderScale));
        const changed = cw !== this.size.canvas[0] || ch !== this.size.canvas[1] || rw !== this.size.render[0] || rh !== this.size.render[1];
        this.size.dpr = dpr;
        if (!changed)
            return false;
        this.size.canvas = [cw, ch];
        this.size.render = [rw, rh];
        this.canvas.width = cw;
        this.canvas.height = ch;
        for (const t of this.textures)
            if (t.relative)
                t.alloc();
        return true;
    }
    /** start a frame by hand (the loop does this for you) */
    beginFrame(dt) {
        this.dt = Math.min(dt, 1 / 15) * this.timeScale;
        if (this.paused)
            this.dt = 0;
        this.time += this.dt;
        this.frameIndex++;
        // (the frame's own state first: a resize that throws mustn't leave last frame's swapchain view to be drawn into)
        this.screen = null;
        this.ran = [];
        this.profiler.beginFrame();
        this.applySize();
    }
    endFrame() {
        this.bindEpoch++;
        // the texture viewer draws over whatever reached the screen this frame
        if (this.screen && this.overlay.viewerActive) {
            this.guard('viewer', () => {
                const enc = this.device.createCommandEncoder({ label: 'weft.viewer' });
                this.overlay.encodeViewer(enc);
                this.queue.submit([enc.finish()]);
            });
        }
        this.guard('profiler', () => this.profiler.endFrame());
        this.guard('overlay', () => this.overlay.frame(this.ran));
        if (this.autoRes)
            this.guard('autoRes', () => this.autoRes.update(this));
    }
    // (a frame's own parts report what goes wrong and carry on: one bad frame never stops the loop)
    guard(label, fn) {
        try {
            fn();
        }
        catch (e) {
            this.report('frame', label, e.stack ?? String(e));
        }
    }
    /** the swapchain view for this frame (acquired on first use) */
    screenView() {
        if (!this.screen)
            this.screen = this.context.getCurrentTexture().createView();
        return this.screen;
    }
    /** encode + submit an ordered list of passes */
    run(items) {
        this.bindEpoch++;
        this.mainView.update();
        for (const v of this.views)
            v.update();
        for (const u of this.uniformBuffers)
            u.upload();
        const list = items.filter(Boolean);
        const scoped = this.debug;
        const cbs = [];
        let enc = this.device.createCommandEncoder({ label: 'weft.run' });
        for (const it of list) {
            if (!this.overlay.isEnabled(it.label))
                continue;
            const en = it.enabled;
            if (en === false || (typeof en === 'function' && !en()))
                continue;
            if (it instanceof RunAction) {
                it.fn();
                this.bindEpoch++;
                continue;
            }
            const ts = it.timed ? this.profiler.writes(it.label) : undefined;
            if (scoped) {
                this.device.pushErrorScope('validation');
                const e1 = this.device.createCommandEncoder({ label: it.label });
                try {
                    it.encode(e1, ts);
                }
                catch (e) {
                    this.report('encode', it.label, e.message);
                }
                cbs.push(e1.finish());
                const label = it.label;
                this.device.popErrorScope().then((err) => { if (err)
                    this.report('validation', label, err.message); });
            }
            else {
                try {
                    it.encode(enc, ts);
                }
                catch (e) {
                    this.report('encode', it.label, e.message);
                }
            }
            this.ran.push(it.label);
        }
        if (!scoped)
            cbs.push(enc.finish());
        this.profiler.resolve(cbs);
        this.queue.submit(cbs);
    }
    /** run `cb` every animation frame (resize, time and the overlay are handled; whatever throws, the loop goes on) */
    loop(cb) {
        this.frameCb = cb;
        const tick = (now) => {
            if (this.manual)
                return;
            // (capped: skip refreshes until a frame's worth of time has gone; a few ms of slack absorbs rAF jitter)
            if (this.maxFps > 0 && this.lastTick && now - this.lastTick < 1000 / this.maxFps - 4) {
                requestAnimationFrame(tick);
                return;
            }
            this.lastTick = now;
            const dt = this.lastNow ? (now - this.lastNow) / 1000 : 1 / 60;
            this.lastNow = now;
            try {
                this.step(dt);
            }
            finally {
                requestAnimationFrame(tick);
            }
        };
        requestAnimationFrame(tick);
    }
    /** advance one frame by hand (headless capture / fixed-step films) */
    step(dt) {
        if (!this.frameCb)
            return;
        this.guard('beginFrame', () => this.beginFrame(dt));
        this.guard('loop', () => this.frameCb({ time: this.time, dt: this.dt, frame: this.frameIndex }));
        this.guard('endFrame', () => this.endFrame());
    }
}
/** dynamic resolution: watches the GPU frame time (timestamp queries) and steps renderScale between min and max to
 *  keep it under `budgetMs` — down quickly when over, up slowly when there's room. Steps are coarse (each one reallocates
 *  the screen-sized targets) and at most one every `interval` seconds. */
export class AutoResolution {
    budgetMs;
    min = 0.5;
    max = 1;
    step = 0.08;
    interval = 1.2;
    /** fraction of the budget to aim for when growing (headroom against spikes) */
    headroom = 0.82;
    t = 0;
    warm = 0;
    onChange = null;
    constructor(budgetMs, opts = {}) {
        this.budgetMs = budgetMs;
        Object.assign(this, opts);
    }
    update(kit) {
        const p = kit.profiler;
        p.force = true;
        this.t += kit.dt || 1 / 60;
        this.warm++;
        if (!p.available || p.frameMs <= 0 || this.warm < 30 || this.t < this.interval)
            return;
        const ms = p.frameMs, s = kit.renderScale;
        // GPU time ~ pixels: the scale that would just fit the budget
        const fit = s * Math.sqrt(this.budgetMs / ms);
        let next = s;
        if (ms > this.budgetMs)
            next = Math.max(this.min, Math.min(s - this.step, fit));
        else if (ms < this.budgetMs * this.headroom * 0.85)
            next = Math.min(this.max, s + this.step, fit * Math.sqrt(this.headroom));
        next = Math.round(next / 0.02) * 0.02;
        if (Math.abs(next - s) >= 0.02) {
            kit.renderScale = next;
            this.t = 0;
            this.warm = 0;
            this.onChange?.(next);
        }
    }
}
export async function createKit(canvas, opts = {}) {
    if (!('gpu' in navigator) || !navigator.gpu)
        throw new WebGPUUnavailable('This browser does not support WebGPU.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: opts.powerPreference ?? 'high-performance' });
    if (!adapter)
        throw new WebGPUUnavailable('No WebGPU adapter is available.');
    const want = [...DEFAULT_FEATURES, ...(opts.features ?? [])];
    for (const f of opts.requiredFeatures ?? [])
        if (!adapter.features.has(f))
            throw new WebGPUUnavailable(`This GPU lacks the '${f}' feature.`);
    const requiredFeatures = [...new Set([...want.filter((f) => adapter.features.has(f)), ...(opts.requiredFeatures ?? [])])];
    const requiredLimits = {};
    const al = adapter.limits;
    for (const k of LIMITS)
        if (k in al)
            requiredLimits[k] = al[k];
    for (const [k, v] of Object.entries(opts.limits ?? {}))
        if (k in al)
            requiredLimits[k] = Math.min(v, al[k]);
    const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
    return new Kit(adapter, device, canvas, opts);
}
//# sourceMappingURL=kit.js.map