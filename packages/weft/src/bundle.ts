// Static draws baked into a GPURenderBundle: the city, the temple, the canyon walls — draws that never change, replayed
// with one call a frame instead of being encoded one by one. A bundle belongs to one pass (its attachments' formats,
// its view, its shared-group overrides) and sits in the pass's order where it was made.
//
// It re-records itself when something it baked moves: a draw added, disposed, set, switched on or off or rebuilt, or
// its pipeline landing or changing; the pass's formats or view, a shared group's bind group. When a resource is
// reallocated anywhere (kit.resourceGen: a resize, a buffer grown) it replays its draws' logic without the GPU and
// re-records only if the calls came out different. Options given as functions (enabled, count, instances, first…) are
// asked each frame and re-record it when their answers change; plain options are read when it records (change one in
// place and call invalidate()). A draw bound through a Ref (a ping-pong side) is checked every run, and re-records the
// bundle whenever the Ref moves: keep those out of bundles.
//
//   const city = scene.bundle('city');
//   for (const m of meshes) city.draw(shader, { bind: { mesh: m.buffer, tex: m.texture }, count: m.count });
import type { Kit, View } from './kit';
import type { Shader } from './shader';
import type { SharedGroup } from './binder';
import { Draw, forgetPassState, type DrawEncoder, type DrawOptions, type RenderPass } from './passes';

const on = (e: boolean | (() => boolean)) => (typeof e === 'function' ? e() : e);

/** a draw's calls as a list of values, optionally passed on to a render bundle; or checked against an earlier list */
class Recorder implements DrawEncoder {
  readonly calls: unknown[] = [];
  private at = 0;
  private same = true;
  constructor(private into: GPURenderBundleEncoder | null, private expect: unknown[] | null = null) {}
  /** the calls matched the expected list exactly */
  get matched() { return this.same && this.at === this.expect?.length; }
  private put(v: unknown) {
    if (this.expect) { if (this.expect[this.at] !== v) this.same = false; }
    else this.calls.push(v);
    this.at++;
  }
  setPipeline(p: GPURenderPipeline) { this.put(1); this.put(p); this.into?.setPipeline(p); }
  setBindGroup(i: number, g: GPUBindGroup) { this.put(2); this.put(i); this.put(g); this.into?.setBindGroup(i, g); }
  setVertexBuffer(slot: number, b: GPUBuffer, offset = 0) { this.put(3); this.put(slot); this.put(b); this.put(offset); this.into?.setVertexBuffer(slot, b, offset); }
  setIndexBuffer(b: GPUBuffer, format: GPUIndexFormat, offset = 0) { this.put(4); this.put(b); this.put(format); this.put(offset); this.into?.setIndexBuffer(b, format, offset); }
  draw(count: number, instances = 1, first = 0, firstInstance = 0) {
    this.put(5); this.put(count); this.put(instances); this.put(first); this.put(firstInstance);
    this.into?.draw(count, instances, first, firstInstance);
  }
  drawIndexed(count: number, instances = 1, first = 0, baseVertex = 0, firstInstance = 0) {
    this.put(6); this.put(count); this.put(instances); this.put(first); this.put(baseVertex); this.put(firstInstance);
    this.into?.drawIndexed(count, instances, first, baseVertex, firstInstance);
  }
  drawIndirect(b: GPUBuffer, offset: number) { this.put(7); this.put(b); this.put(offset); this.into?.drawIndirect(b, offset); }
  drawIndexedIndirect(b: GPUBuffer, offset: number) { this.put(8); this.put(b); this.put(offset); this.into?.drawIndexedIndirect(b, offset); }
}

type Formats = ReturnType<RenderPass['formats']>;
const sameFormats = (a: Formats, b: Formats) =>
  a.depth === b.depth && a.samples === b.samples && a.depthReadOnly === b.depthReadOnly && a.colors.length === b.colors.length && a.colors.every((c, i) => c === b.colors[i]);

export class DrawBundle {
  /** drawn or not (a function is asked each frame) */
  enabled: boolean | (() => boolean) = true;
  readonly draws: Draw[] = [];
  /** how many times it has been recorded */
  records = 0;
  private bundle: GPURenderBundle | null = null;
  private list: GPURenderBundle[] = [];
  private dirty = true;
  // what the recording was made with
  private formats: Formats | null = null;
  private view: View | null = null;
  private group0: GPUBindGroup | null = null;
  private shared: { group: SharedGroup; bg: GPUBindGroup }[] = [];
  private watched: { draw: Draw; was: number[] }[] = [];
  private calls: unknown[] = [];
  private gen = -1;
  private epoch = -1;
  private moves = false;
  private now: number[] = [];

  constructor(private kit: Kit, readonly pass: RenderPass, readonly label: string) {}

  draw<S extends Shader>(shader: S, opts: DrawOptions<S> = {}): Draw<S> {
    const d = new Draw(this.kit, this.pass, shader, opts, this);
    this.draws.push(d as unknown as Draw);
    this.dirty = true;
    return d;
  }
  /** a fullscreen triangle (the shader includes weft/fullscreen and has a fragment entry) */
  fullscreen<S extends Shader>(shader: S, opts: DrawOptions<S> = {}): Draw<S> {
    return this.draw(shader, { vertex: 'vs_fullscreen', cull: 'none', count: 3, depthWrite: false, depthCompare: 'always', ...opts });
  }
  /** record it again at its next use (after changing a draw's plain options in place) */
  invalidate() { this.dirty = true; }
  /** wait for its draws' pipelines alone (see kit.ready) */
  ready() { return this.kit.ready(this); }

  encode(pe: GPURenderPassEncoder) {
    if (!on(this.enabled)) return;
    if (this.stale()) this.record();
    if (!this.bundle) return;
    pe.executeBundles(this.list);
    // (a pass has no pipeline or groups set after executing bundles)
    forgetPassState(pe);
  }

  /** stop it for good: its draws are disposed and it leaves its pass */
  dispose() {
    for (const d of [...this.draws]) d.dispose();
    const i = this.pass.draws.indexOf(this);
    if (i >= 0) this.pass.draws.splice(i, 1);
    this.bundle = null;
  }

  private stale(): boolean {
    if (this.dirty || !this.bundle) return true;
    const k = this.kit, view = this.pass.opts.view ?? k.mainView;
    if (view !== this.view || view.group0() !== this.group0 || !sameFormats(this.pass.formats(), this.formats!)) return true;
    for (const s of this.shared) if (s.group.bindGroup(this.pass.opts.shared?.[s.group.index]) !== s.bg) return true;
    for (const w of this.watched) {
      const now = w.draw.state(this.now);
      for (let i = 0; i < now.length; i++) if (now[i] !== w.was[i]) return true;
    }
    if (k.resourceGen !== this.gen || (this.moves && k.bindEpoch !== this.epoch)) {
      // (something was reallocated, or a Ref may have moved: what would the draws encode now?)
      const check = new Recorder(null, this.calls);
      for (const d of this.draws) d.encodeInto(check);
      if (!check.matched) return true;
      this.gen = k.resourceGen;
      this.epoch = k.bindEpoch;
    }
    return false;
  }

  private record() {
    const k = this.kit, f = this.pass.formats(), view = this.pass.opts.view ?? k.mainView;
    const enc = k.device.createRenderBundleEncoder({
      label: this.label, colorFormats: f.colors, depthStencilFormat: f.depth, sampleCount: f.samples,
      depthReadOnly: f.depthReadOnly, stencilReadOnly: f.depthReadOnly && !!f.depth?.includes('stencil'),
    });
    const rec = new Recorder(enc);
    for (const d of this.draws) d.encodeInto(rec);
    this.bundle = enc.finish({ label: this.label });
    this.list = [this.bundle];
    this.calls = rec.calls;
    this.formats = f;
    this.view = view;
    this.group0 = view.group0();
    const shared = new Set<SharedGroup>();
    for (const d of this.draws) for (const g of d.binder.groups) if (g.shared) shared.add(g.shared);
    this.shared = [...shared].map((group) => ({ group, bg: group.bindGroup(this.pass.opts.shared?.[group.index]) }));
    this.watched = this.draws.filter((d) => d.watched).map((draw) => ({ draw, was: draw.state([]) }));
    const moving = this.draws.find((d) => d.binder.moves || d.refBuffers);
    this.moves = !!moving;
    if (moving) k.warnOnce(`bundle-ref:${this.label}`, `${this.label}: '${moving.label}' binds through a Ref, so the bundle is checked every run and re-recorded whenever it moves`);
    this.gen = k.resourceGen;
    this.epoch = k.bindEpoch;
    this.records++;
    // (a pipeline made on the spot while recording is in this recording)
    this.dirty = false;
  }
}
