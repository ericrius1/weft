import { Draw, forgetPassState } from './passes';
const on = (e) => (typeof e === 'function' ? e() : e);
/** a draw's calls as a list of values, optionally passed on to a render bundle; or checked against an earlier list */
class Recorder {
    into;
    expect;
    calls = [];
    at = 0;
    same = true;
    constructor(into, expect = null) {
        this.into = into;
        this.expect = expect;
    }
    /** the calls matched the expected list exactly */
    get matched() { return this.same && this.at === this.expect?.length; }
    put(v) {
        if (this.expect) {
            if (this.expect[this.at] !== v)
                this.same = false;
        }
        else
            this.calls.push(v);
        this.at++;
    }
    setPipeline(p) { this.put(1); this.put(p); this.into?.setPipeline(p); }
    setBindGroup(i, g) { this.put(2); this.put(i); this.put(g); this.into?.setBindGroup(i, g); }
    setVertexBuffer(slot, b, offset = 0) { this.put(3); this.put(slot); this.put(b); this.put(offset); this.into?.setVertexBuffer(slot, b, offset); }
    setIndexBuffer(b, format, offset = 0) { this.put(4); this.put(b); this.put(format); this.put(offset); this.into?.setIndexBuffer(b, format, offset); }
    draw(count, instances = 1, first = 0, firstInstance = 0) {
        this.put(5);
        this.put(count);
        this.put(instances);
        this.put(first);
        this.put(firstInstance);
        this.into?.draw(count, instances, first, firstInstance);
    }
    drawIndexed(count, instances = 1, first = 0, baseVertex = 0, firstInstance = 0) {
        this.put(6);
        this.put(count);
        this.put(instances);
        this.put(first);
        this.put(baseVertex);
        this.put(firstInstance);
        this.into?.drawIndexed(count, instances, first, baseVertex, firstInstance);
    }
    drawIndirect(b, offset) { this.put(7); this.put(b); this.put(offset); this.into?.drawIndirect(b, offset); }
    drawIndexedIndirect(b, offset) { this.put(8); this.put(b); this.put(offset); this.into?.drawIndexedIndirect(b, offset); }
}
const sameFormats = (a, b) => a.depth === b.depth && a.samples === b.samples && a.depthReadOnly === b.depthReadOnly && a.colors.length === b.colors.length && a.colors.every((c, i) => c === b.colors[i]);
export class DrawBundle {
    kit;
    pass;
    label;
    /** drawn or not (a function is asked each frame) */
    enabled = true;
    draws = [];
    /** how many times it has been recorded */
    records = 0;
    bundle = null;
    list = [];
    dirty = true;
    // what the recording was made with
    formats = null;
    view = null;
    group0 = null;
    shared = [];
    watched = [];
    calls = [];
    gen = -1;
    epoch = -1;
    moves = false;
    now = [];
    constructor(kit, pass, label) {
        this.kit = kit;
        this.pass = pass;
        this.label = label;
    }
    draw(shader, opts = {}) {
        const d = new Draw(this.kit, this.pass, shader, opts, this);
        this.draws.push(d);
        this.dirty = true;
        return d;
    }
    /** a fullscreen triangle (the shader includes weft/fullscreen and has a fragment entry) */
    fullscreen(shader, opts = {}) {
        return this.draw(shader, { vertex: 'vs_fullscreen', cull: 'none', count: 3, depthWrite: false, depthCompare: 'always', ...opts });
    }
    /** record it again at its next use (after changing a draw's plain options in place) */
    invalidate() { this.dirty = true; }
    encode(pe) {
        if (!on(this.enabled))
            return;
        if (this.stale())
            this.record();
        if (!this.bundle)
            return;
        pe.executeBundles(this.list);
        // (a pass has no pipeline or groups set after executing bundles)
        forgetPassState(pe);
    }
    /** stop it for good: its draws are disposed and it leaves its pass */
    dispose() {
        for (const d of [...this.draws])
            d.dispose();
        const i = this.pass.draws.indexOf(this);
        if (i >= 0)
            this.pass.draws.splice(i, 1);
        this.bundle = null;
    }
    stale() {
        if (this.dirty || !this.bundle)
            return true;
        const k = this.kit, view = this.pass.opts.view ?? k.mainView;
        if (view !== this.view || view.group0() !== this.group0 || !sameFormats(this.pass.formats(), this.formats))
            return true;
        for (const s of this.shared)
            if (s.group.bindGroup(this.pass.opts.shared?.[s.group.index]) !== s.bg)
                return true;
        for (const w of this.watched) {
            const now = w.draw.state(this.now);
            for (let i = 0; i < now.length; i++)
                if (now[i] !== w.was[i])
                    return true;
        }
        if (k.resourceGen !== this.gen || (this.moves && k.bindEpoch !== this.epoch)) {
            // (something was reallocated, or a Ref may have moved: what would the draws encode now?)
            const check = new Recorder(null, this.calls);
            for (const d of this.draws)
                d.encodeInto(check);
            if (!check.matched)
                return true;
            this.gen = k.resourceGen;
            this.epoch = k.bindEpoch;
        }
        return false;
    }
    record() {
        const k = this.kit, f = this.pass.formats(), view = this.pass.opts.view ?? k.mainView;
        const enc = k.device.createRenderBundleEncoder({
            label: this.label, colorFormats: f.colors, depthStencilFormat: f.depth, sampleCount: f.samples,
            depthReadOnly: f.depthReadOnly, stencilReadOnly: f.depthReadOnly && !!f.depth?.includes('stencil'),
        });
        const rec = new Recorder(enc);
        for (const d of this.draws)
            d.encodeInto(rec);
        this.bundle = enc.finish({ label: this.label });
        this.list = [this.bundle];
        this.calls = rec.calls;
        this.formats = f;
        this.view = view;
        this.group0 = view.group0();
        const shared = new Set();
        for (const d of this.draws)
            for (const g of d.binder.groups)
                if (g.shared)
                    shared.add(g.shared);
        this.shared = [...shared].map((group) => ({ group, bg: group.bindGroup(this.pass.opts.shared?.[group.index]) }));
        this.watched = this.draws.filter((d) => d.watched).map((draw) => ({ draw, was: draw.state([]) }));
        const moving = this.draws.find((d) => d.binder.moves || d.refBuffers);
        this.moves = !!moving;
        if (moving)
            k.warnOnce(`bundle-ref:${this.label}`, `${this.label}: '${moving.label}' binds through a Ref, so the bundle is checked every run and re-recorded whenever it moves`);
        this.gen = k.resourceGen;
        this.epoch = k.bindEpoch;
        this.records++;
        // (a pipeline made on the spot while recording is in this recording)
        this.dirty = false;
    }
}
//# sourceMappingURL=bundle.js.map