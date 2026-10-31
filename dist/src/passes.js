import { Binder, BindError, forgetBindings } from './binder';
import { Ref, deref, Texture, TexView, StorageBuffer, RunAction, isDepthFormat } from './resources';
import { DrawBundle } from './bundle';
const val = (x, d) => (x === undefined ? d : typeof x === 'function' ? x() : x);
const vals = (x) => (typeof x === 'function' ? x() : x);
const on = (e) => (e === undefined ? true : typeof e === 'function' ? e() : e);
/** a raw step: anything you'd do with the command encoder yourself (copies, clears, other libraries) */
export class RawItem {
    fn;
    label;
    enabled = true;
    constructor(fn, label = 'raw') {
        this.fn = fn;
        this.label = label;
    }
    encode(enc) { this.fn(enc); }
}
export class PipelineRecord {
    kit;
    label;
    shader;
    make;
    makeNow;
    /** the pipeline as it is (read `pipeline`, which a compile scheduler may make on the spot) */
    _pipe = null;
    pending = null;
    error = null;
    ms = 0;
    builds = 0;
    /** waiting for kit.compiler to say when (kit.ready() doesn't wait for it) */
    deferred = false;
    /** drawn only while this says so (a scheduler holding a feature back until all of it has compiled) */
    gate = null;
    /** called when its pipeline changes (a compile landing, a hot reload) */
    changed = null;
    constructor(kit, label, shader, make, makeNow = null) {
        this.kit = kit;
        this.label = label;
        this.shader = shader;
        this.make = make;
        this.makeNow = makeNow;
        kit.pipelines.push(this);
    }
    get pipeline() {
        if (!this._pipe && this.deferred && this.kit.compiler)
            this.kit.compiler.now(this);
        return this._pipe;
    }
    set pipeline(p) {
        if (p === this._pipe)
            return;
        this._pipe = p;
        this.changed?.();
    }
    build() {
        const t0 = performance.now();
        // (one built while the scheduler holds is deferred at once: its module's compile info comes first, and can wait
        // behind the GPU's compiles, and kit.ready() mustn't wait for it meanwhile)
        if (this.kit.compiler?.holding)
            this.deferred = true;
        const p = (async () => {
            try {
                const module = await this.kit.module(this.shader);
                const c = this.kit.compiler;
                const pipe = (await (c ? c.compile(this, () => this.make(module)) : this.make(module)));
                this.pipeline = pipe;
                this.error = null;
                this.ms = performance.now() - t0;
                this.builds++;
                this.kit.clearError(this.label);
            }
            catch (e) {
                this.error = e.message ?? String(e);
                this.kit.report('pipeline', this.label, this.error);
            }
        })();
        this.pending = p.finally(() => { if (this.pending === wrapped)
            this.pending = null; });
        const wrapped = this.pending;
        return this.pending;
    }
    /** forget it: it leaves kit.pipelines (kit.ready() and the overlay stop counting it) */
    dispose() {
        const list = this.kit.pipelines, i = list.indexOf(this);
        if (i >= 0)
            list.splice(i, 1);
        this.changed = null;
    }
}
function pickEntry(shader, stage, name, label) {
    const list = shader.reflect.entries.filter((e) => e.stage === stage);
    if (name) {
        if (!list.some((e) => e.name === name))
            throw new BindError(`${label}: ${shader.id} has no ${stage} entry '${name}' (has: ${list.map((e) => e.name).join(', ') || 'none'})`);
        return name;
    }
    if (list.length === 1)
        return list[0].name;
    if (!list.length)
        throw new BindError(`${label}: ${shader.id} has no ${stage} entry point`);
    // several: the conventional name wins (vs / fs / main), anything else must be named
    const conventional = stage === 'vertex' ? 'vs' : stage === 'fragment' ? 'fs' : 'main';
    if (list.some((e) => e.name === conventional))
        return conventional;
    throw new BindError(`${label}: ${shader.id} has several ${stage} entries (${list.map((e) => e.name).join(', ')}): pick one`);
}
function constantsFor(shader, entry, constants) {
    if (!constants)
        return undefined;
    const e = shader.reflect.entries.find((x) => x.name === entry);
    const out = {};
    for (const [k, v] of Object.entries(constants)) {
        if (!(k in shader.reflect.overrides))
            throw new BindError(`${shader.id}: no override named '${k}'`);
        if (e?.overrides.includes(k))
            out[k] = v;
    }
    return out;
}
export class Compute {
    kit;
    shader;
    opts;
    label;
    timed = true;
    enabled;
    binder;
    pipe;
    entry;
    unsub;
    constructor(kit, shader, opts) {
        this.kit = kit;
        this.shader = shader;
        this.opts = opts;
        this.label = opts.label ?? shader.label;
        this.enabled = opts.enabled ?? true;
        this.entry = pickEntry(shader, 'compute', opts.entry, this.label);
        this.binder = new Binder(kit, shader, [this.entry], { ...(opts.bind ?? {}) }, this.label);
        const desc = (module) => ({
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
        }
        catch (e) {
            this.kit.report('bind', this.label, e.message);
        }
    }
    set(name, value) { this.binder.set(name, value); return this; }
    get workgroupSize() { return this.shader.reflect.entries.find((e) => e.name === this.entry)?.workgroupSize ?? [1, 1, 1]; }
    encode(enc, ts) {
        const p = this.pipe.pipeline;
        if (!p || (this.pipe.gate && !this.pipe.gate()))
            return;
        const pass = enc.beginComputePass({ label: this.label, timestampWrites: ts });
        pass.setPipeline(p);
        this.binder.apply(pass, this.opts.view ?? this.kit.mainView, this.opts.shared);
        const o = this.opts;
        if (o.indirect) {
            const b = deref(o.indirect.buffer);
            pass.dispatchWorkgroupsIndirect(b instanceof StorageBuffer ? b.gpu : b, o.indirect.offset ?? 0);
        }
        else {
            let wg;
            if (o.threads) {
                const t = vals(o.threads), s = this.workgroupSize;
                wg = [Math.ceil(t[0] / s[0]), Math.ceil((t[1] ?? 1) / s[1]), Math.ceil((t[2] ?? 1) / s[2])];
            }
            else
                wg = o.workgroups ? vals(o.workgroups) : [1];
            if (wg[0] > 0 && (wg[1] ?? 1) > 0 && (wg[2] ?? 1) > 0)
                pass.dispatchWorkgroups(wg[0], wg[1] ?? 1, wg[2] ?? 1);
        }
        pass.end();
    }
    /** stop it for good: no more hot rebuilds, and its pipeline leaves the kit */
    dispose() { this.unsub(); this.pipe.dispose(); }
}
/** forget the pipeline and groups a pass has set (after a bundle or code outside weft changed them) */
export function forgetPassState(enc) {
    enc.__weftPipeline = null;
    forgetBindings(enc);
}
const BLEND = {
    opaque: undefined,
    alpha: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
    premultiplied: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
    add: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } },
    'add-alpha': { color: { srcFactor: 'src-alpha', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } },
    multiply: { color: { srcFactor: 'dst', dstFactor: 'zero' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } },
    max: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' } },
};
const blendOf = (b) => (b === undefined ? undefined : typeof b === 'string' ? BLEND[b] : b);
const gpuBuf = (b) => { const v = deref(b); return v instanceof StorageBuffer ? v.gpu : v; };
export class Draw {
    kit;
    pass;
    shader;
    opts;
    bundle;
    /** (a compile scheduler checks this: weft's records support deferral) */
    static scheduled = true;
    label;
    binder;
    pipe;
    vs;
    fs;
    unsub;
    on_;
    /** `bundle`: the DrawBundle it's baked into (pass.bundle().draw makes these) */
    constructor(kit, pass, shader, opts, bundle = null) {
        this.kit = kit;
        this.pass = pass;
        this.shader = shader;
        this.opts = opts;
        this.bundle = bundle;
        this.label = opts.label ?? shader.label;
        if (bundle && opts.encode)
            throw new BindError(`${this.label}: a bundled draw can't issue its own calls (encode)`);
        this.on_ = opts.enabled ?? true;
        this.pickEntries();
        this.binder = new Binder(kit, shader, this.fs ? [this.vs, this.fs] : [this.vs], { ...(opts.bind ?? {}) }, this.label);
        this.pipe = new PipelineRecord(kit, this.label, shader, (m) => kit.device.createRenderPipelineAsync(this.descriptor(m)), (m) => kit.device.createRenderPipeline(this.descriptor(m)));
        this.pipe.changed = () => this.bundle?.invalidate();
        this.pipe.build();
        this.unsub = shader.onChange(() => this.rebuild());
    }
    /** drawn or not (a function is asked each frame) */
    get enabled() { return this.on_; }
    set enabled(v) {
        if (v === this.on_)
            return;
        this.on_ = v;
        this.bundle?.invalidate();
    }
    pickEntries() {
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
        }
        catch (e) {
            this.kit.report('bind', this.label, e.message);
        }
    }
    set(name, value) {
        this.binder.set(name, value);
        this.bundle?.invalidate();
        return this;
    }
    descriptor(module) {
        const o = this.opts;
        const f = this.pass.formats();
        const outs = this.fs ? (this.shader.reflect.entries.find((e) => e.name === this.fs)?.targets ?? 1) : 0;
        const blends = Array.isArray(o.blend) ? o.blend : f.colors.map(() => o.blend);
        const masks = Array.isArray(o.writeMask) ? o.writeMask : f.colors.map(() => o.writeMask ?? 0xf);
        const targets = f.colors.map((format, i) => ({ format, blend: blendOf(blends[i]), writeMask: i < outs ? masks[i] : 0 }));
        const desc = {
            label: this.label,
            layout: this.binder.layout,
            vertex: { module, entryPoint: this.vs, constants: constantsFor(this.shader, this.vs, o.constants), buffers: o.vertexBuffers?.map((v) => v.layout) },
            primitive: { topology: o.topology ?? 'triangle-list', cullMode: o.cull ?? 'back', frontFace: o.frontFace ?? 'ccw', unclippedDepth: o.unclippedDepth && this.kit.features.has('depth-clip-control') ? true : undefined },
            // (WebGPU refuses alpha to coverage without multisampling: such a pipeline would fail and never draw)
            multisample: { count: f.samples, alphaToCoverageEnabled: !!o.alphaToCoverage && f.samples > 1 },
        };
        if (o.alphaToCoverage && f.samples <= 1)
            this.kit.warnOnce(`a2c:${this.label}`, `${this.label}: alphaToCoverage needs a multisampled pass (${this.pass.label} has 1 sample): drawn without it`);
        if (o.topology === 'triangle-strip' || o.topology === 'line-strip')
            desc.primitive.stripIndexFormat = o.indices ? (o.indices.format ?? 'uint32') : undefined;
        if (this.fs)
            desc.fragment = { module, entryPoint: this.fs, constants: constantsFor(this.shader, this.fs, o.constants), targets };
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
    encode(pe) { this.encodeInto(pe); }
    /** its calls, into a pass or a bundle (nothing while it's off or its pipeline isn't ready) */
    encodeInto(enc) {
        // (enabled first: a compile scheduler makes a deferred pipeline on the spot when it's read)
        if (!on(this.on_))
            return;
        const p = this.pipe.pipeline;
        if (!p || (this.pipe.gate && !this.pipe.gate()))
            return;
        const o = this.opts;
        // (consecutive draws with one pipeline set it once)
        const tracked = enc;
        if (tracked.__weftPipeline !== p) {
            tracked.__weftPipeline = p;
            enc.setPipeline(p);
        }
        this.binder.apply(enc, this.pass.opts.view ?? this.kit.mainView, this.pass.opts.shared);
        const vb = o.vertexBuffers;
        if (vb)
            for (let i = 0; i < vb.length; i++)
                enc.setVertexBuffer(i, gpuBuf(vb[i].buffer), vb[i].offset ?? 0);
        if (o.indices)
            enc.setIndexBuffer(gpuBuf(o.indices.buffer), o.indices.format ?? 'uint32', o.indices.offset ?? 0);
        if (o.encode) {
            o.encode(enc, this);
            // (the callback may have set its own pipeline or groups)
            forgetPassState(enc);
            return;
        }
        if (o.indirect) {
            if (o.indices)
                enc.drawIndexedIndirect(gpuBuf(o.indirect.buffer), val(o.indirect.offset, 0));
            else
                enc.drawIndirect(gpuBuf(o.indirect.buffer), val(o.indirect.offset, 0));
            return;
        }
        const count = val(o.count, 3), inst = val(o.instances, 1);
        if (count <= 0 || inst <= 0)
            return;
        if (o.indices)
            enc.drawIndexed(count, inst, val(o.first, 0), val(o.baseVertex, 0), val(o.firstInstance, 0));
        else
            enc.draw(count, inst, val(o.first, 0), val(o.firstInstance, 0));
    }
    /** (bundles) whether an option is asked each frame: enabled, the counts, the indirect offset, a scheduler's gate */
    get watched() {
        const o = this.opts, fn = (x) => typeof x === 'function';
        return fn(this.on_) || fn(o.count) || fn(o.instances) || fn(o.first) || fn(o.firstInstance) || fn(o.baseVertex) || fn(o.indirect?.offset) || !!this.pipe.gate;
    }
    /** (bundles) those options' values now, into out */
    state(out) {
        const o = this.opts;
        out[0] = on(this.on_) ? 1 : 0;
        out[1] = val(o.count, 3);
        out[2] = val(o.instances, 1);
        out[3] = val(o.first, 0);
        out[4] = val(o.firstInstance, 0);
        out[5] = val(o.baseVertex, 0);
        out[6] = val(o.indirect?.offset, 0);
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
        const list = this.bundle ? this.bundle.draws : this.pass.draws;
        const i = list.indexOf(this);
        if (i >= 0)
            list.splice(i, 1);
        this.bundle?.invalidate();
        this.pipe.dispose();
    }
}
export class RenderPass {
    kit;
    opts;
    label;
    timed = true;
    enabled;
    draws = [];
    constructor(kit, opts) {
        this.kit = kit;
        this.opts = opts;
        this.label = opts.label ?? 'pass';
        this.enabled = opts.enabled ?? true;
    }
    draw(shader, opts = {}) {
        const d = new Draw(this.kit, this, shader, opts);
        this.draws.push(d);
        return d;
    }
    /** a bundle of static draws at this point of the pass's order: its draws are recorded once into a GPURenderBundle
     *  and replayed with one call a frame (see bundle.ts for what re-records it) */
    bundle(label = `${this.label}.bundle`) {
        const b = new DrawBundle(this.kit, this, label);
        this.draws.push(b);
        return b;
    }
    /** stop it for good: every draw and bundle in it is disposed */
    dispose() {
        for (const d of [...this.draws])
            if (d instanceof Draw || d instanceof DrawBundle)
                d.dispose();
    }
    /** a fullscreen triangle (the shader includes weft/fullscreen and has a fragment entry) */
    fullscreen(shader, opts = {}) {
        return this.draw(shader, { vertex: 'vs_fullscreen', cull: 'none', count: 3, depthWrite: false, depthCompare: 'always', ...opts });
    }
    targetFormat(t) {
        if (t === 'screen')
            return { format: this.kit.format, samples: 1 };
        const v = deref(t);
        if (v instanceof Texture)
            return { format: v.format, samples: v.samples };
        if (v instanceof TexView)
            return { format: v.texture.format, samples: v.texture.samples };
        throw new BindError(`${this.label}: attachment must be a Texture, a TexView or 'screen' (got ${String(v)})`);
    }
    formats() {
        const colors = (this.opts.color ?? []).map((c) => this.targetFormat(c.target));
        const d = this.opts.depth ? this.targetFormat(this.opts.depth.target) : null;
        return { colors: colors.map((c) => c.format), depth: d?.format, depthReadOnly: !!this.opts.depth?.readOnly, samples: colors[0]?.samples ?? d?.samples ?? 1 };
    }
    attachView(t) {
        if (t === 'screen')
            return this.kit.screenView();
        const v = deref(t);
        if (v instanceof Texture)
            return v.view({ dimension: '2d', baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1 });
        if (v instanceof TexView)
            return v.texture.view({ ...v.desc, dimension: '2d' });
        throw new BindError(`${this.label}: bad attachment`);
    }
    encode(enc, ts) {
        const o = this.opts;
        const colorAttachments = (o.color ?? []).map((c) => ({
            view: this.attachView(c.target),
            resolveTarget: c.resolve ? this.attachView(c.resolve) : undefined,
            loadOp: c.clear === false ? 'load' : 'clear',
            clearValue: c.clear === false ? undefined : (c.clear ?? [0, 0, 0, 0]),
            storeOp: c.store === false ? 'discard' : 'store',
        }));
        let depthStencilAttachment;
        if (o.depth) {
            const d = o.depth;
            const tex = deref(d.target);
            const fmt = tex instanceof Texture ? tex.format : tex instanceof TexView ? tex.texture.format : 'depth32float';
            const hasStencil = fmt.includes('stencil');
            depthStencilAttachment = d.readOnly
                ? { view: this.attachView(d.target), depthReadOnly: true, ...(hasStencil ? { stencilReadOnly: true } : {}) }
                : {
                    view: this.attachView(d.target),
                    depthLoadOp: d.clear === false ? 'load' : 'clear', depthClearValue: d.clear === false ? undefined : (d.clear ?? 0),
                    depthStoreOp: d.store === false ? 'discard' : 'store',
                    ...(hasStencil ? { stencilLoadOp: 'clear', stencilStoreOp: 'discard' } : {}),
                };
        }
        const pe = enc.beginRenderPass({ label: this.label, colorAttachments, depthStencilAttachment, timestampWrites: ts });
        if (o.viewport) {
            const v = vals(o.viewport);
            pe.setViewport(v[0], v[1], v[2], v[3], 0, 1);
            pe.setScissorRect(Math.max(0, Math.floor(v[0])), Math.max(0, Math.floor(v[1])), Math.max(1, Math.floor(v[2])), Math.max(1, Math.floor(v[3])));
        }
        for (const d of this.draws)
            d.encode(pe);
        pe.end();
    }
}
export { RunAction, isDepthFormat };
//# sourceMappingURL=passes.js.map