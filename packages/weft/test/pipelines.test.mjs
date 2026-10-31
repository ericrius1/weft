// Pipelines shared by descriptor (passes.ts): computes and draws whose pipelines would be the same — labels and the
// resources they bind aside — compile once and share one GPU pipeline; anything that tells two apart (an entry point,
// a constant, the blend, the cull, a filtering or non-filtering sampler in the layout, a hot edit) compiles its own.
// And waiting for some pipelines alone (kit.ready(...items): pipelinesOf + settle). Without a GPU: a stand-in device
// counts the compiles. Run with `npm test` after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
const { Compute, RenderPass, RawItem, stableKey, pipelineKey, pipelinesOf, settle } = await import('../dist/src/passes.js');
const { defineShader } = await import('../dist/src/shader.js');
const { StorageBuffer } = await import('../dist/src/resources.js');
const { reflectWgsl } = await import('../dist/plugin/wgsl.js');

globalThis.GPUTextureView ??= class GPUTextureView {};
const tick = () => new Promise((r) => setImmediate(r));
const shader = (id, code) => defineShader({ id, label: id, code, files: [id], runs: [], reflect: reflectWgsl(code) });

const FILL = `
override GAIN: f32 = 1.0;
override BIAS: f32 = 0.0;
@group(1) @binding(0) var<storage, read_write> data: array<f32>;
@compute @workgroup_size(64) fn fill(@builtin(global_invocation_id) id: vec3u) { data[id.x] = f32(id.x) * GAIN + BIAS; }
@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) id: vec3u) { data[id.x] = 0.0; }`;
const SPRITE = `
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i), 0.0, 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return textureSample(tex, samp, vec2f(0.5)); }`;

/** a kit as far as declaring passes needs one, its device counting compiles (`hold`: labels whose compiles wait for
 *  release(); `fail`: labels whose compiles fail) */
function fakeKit() {
  const compiled = [];
  const hold = new Set(), fail = new Set();
  let release;
  const held = new Promise((r) => { release = r; });
  const compile = (d) => {
    compiled.push(d);
    const p = { label: d.label };
    if (fail.has(d.label)) return Promise.reject(new Error(`${d.label} failed to compile`));
    return hold.has(d.label) ? held.then(() => p) : tick().then(() => p);
  };
  const device = {
    createBuffer: (d) => ({ ...d, destroy() {} }),
    createBindGroupLayout: (d) => ({ bgl: d.label }),
    createPipelineLayout: (d) => ({ layout: d.label }),
    createComputePipelineAsync: compile,
    createRenderPipelineAsync: compile,
    createComputePipeline: (d) => { compiled.push(d); return { label: d.label, now: true }; },
    createRenderPipeline: (d) => { compiled.push(d); return { label: d.label, now: true }; },
  };
  const samplers = { linear: { s: 'linear' }, nearest: { s: 'nearest' } };
  const bgls = new Map();
  const kit = {
    device, compiled, hold, fail, release, pipelines: [], pipelineCache: new Map(), compiler: null, sharedGroups: new Map(),
    frameLayout: { bgl: 'frame' }, nonFiltering: new WeakSet([samplers.nearest]), features: new Set(), format: 'bgra8unorm',
    resourceGen: 0, bindEpoch: 0, errors: [],
    bindGroupLayout(entries, label, key = JSON.stringify(entries)) {
      let l = bgls.get(key);
      if (!l) bgls.set(key, (l = device.createBindGroupLayout({ label, entries })));
      return l;
    },
    module: async (s) => ({ module: `${s.id}@${s.version}` }),
    moduleNow: (s) => ({ module: `${s.id}@${s.version}` }),
    report(kind, label) { this.errors.push(`${kind} ${label}`); },
    clearError() {},
    warnOnce() {},
    namedSampler: (n) => samplers[n],
    // (kit.ts's ready, which can't load here: its frame shader is a .wgsl import)
    ready: (...items) => settle(items.length ? () => pipelinesOf(items) : () => kit.pipelines),
  };
  return kit;
}
const buffer = (kit) => new StorageBuffer(kit, { size: 256 });

test('the key: labels aside, the same descriptor however its objects were spelled', () => {
  assert.equal(stableKey({ b: 1, a: [1, { d: 2, c: undefined }] }), stableKey({ a: [1, { d: 2 }], b: 1 }));
  assert.equal(stableKey([1, undefined, -0]), '[1,null,0]');
  assert.notEqual(stableKey({ a: [1, 2] }), stableKey({ a: [2, 1] }));
  // (anything but plain data by identity)
  class Thing {}
  const t = new Thing();
  assert.equal(stableKey({ x: t }), stableKey({ x: t }));
  assert.notEqual(stableKey({ x: t }), stableKey({ x: new Thing() }));
  const desc = (label, layout, module) => ({ label, layout, vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  assert.equal(pipelineKey(desc('a', {}, {}), 'L', 'S@1'), pipelineKey(desc('b', {}, {}), 'L', 'S@1'));
  assert.notEqual(pipelineKey(desc('a', {}, {}), 'L', 'S@1'), pipelineKey(desc('a', {}, {}), 'L', 'S@2'));
  assert.notEqual(pipelineKey(desc('a', {}, {}), 'L', 'S@1'), pipelineKey(desc('a', {}, {}), 'L2', 'S@1'));
});

test('computes of one shader, entry, constants and layout share one compile', async () => {
  const kit = fakeKit(), sh = shader('test/share.wgsl', FILL);
  const c = (opts) => new Compute(kit, sh, { entry: 'fill', bind: { data: buffer(kit) }, ...opts });
  const a = c({ label: 'level0' }), b = c({ label: 'level1' });
  const gain = c({ label: 'gain', constants: { GAIN: 2, BIAS: 1 } }), gain2 = c({ label: 'gain2', constants: { BIAS: 1, GAIN: 2 } });
  const clear = c({ label: 'clear', entry: 'clear' });
  // (constants the entry doesn't read are as none)
  const clear2 = c({ label: 'clear2', entry: 'clear', constants: { GAIN: 3 } });
  await tick();
  assert.equal(kit.compiled.length, 3, 'one compile each for fill, fill with constants, clear — declared together');
  const r = await kit.ready();
  assert.deepEqual(r, { pipelines: 6, distinct: 3, failed: 0 });
  assert.equal(kit.compiled.length, 3);
  assert.equal(kit.pipelineCache.size, 3);
  assert.ok(a.pipe.pipeline && a.pipe.pipeline === b.pipe.pipeline);
  assert.ok(gain.pipe.pipeline === gain2.pipe.pipeline && gain.pipe.pipeline !== a.pipe.pipeline);
  assert.ok(clear.pipe.pipeline === clear2.pipe.pipeline && clear.pipe.pipeline !== a.pipe.pipeline);
  assert.equal(a.pipe.shared, false);
  assert.equal(b.pipe.shared, true);
  assert.equal(a.pipe.entry.users.size, 2);
  // (labels stay each record's; the shared pipeline carries the first's)
  assert.deepEqual(kit.pipelines.map((p) => p.label), ['level0', 'level1', 'gain', 'gain2', 'clear', 'clear2']);
  assert.equal(b.pipe.pipeline.label, 'level0');
  // (one declared once it's compiled has it at once)
  const late = c({ label: 'late' });
  await late.ready();
  assert.equal(kit.compiled.length, 3);
  assert.equal(late.pipe.pipeline, a.pipe.pipeline);
});

test('draws: the blend, the cull, a filtering or non-filtering sampler tell pipelines apart; labels and resources don\'t', async () => {
  const kit = fakeKit(), sh = shader('test/sprite.wgsl', SPRITE);
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }] });
  const d = (opts) => pass.draw(sh, { bind: { tex: new GPUTextureView(), samp: 'linear' }, ...opts });
  const hero = d({ label: 'scene.hero' }), lo = d({ label: 'scene.hero.lo' });
  const nearest = d({ label: 'nearest', bind: { tex: new GPUTextureView(), samp: 'nearest' } });
  const alpha = d({ label: 'alpha', blend: 'alpha' });
  // (the same blend as 'alpha', written out in another order)
  const alpha2 = d({ label: 'alpha2', blend: { alpha: { dstFactor: 'one-minus-src-alpha', srcFactor: 'one' }, color: { dstFactor: 'one-minus-src-alpha', srcFactor: 'src-alpha' } } });
  const noCull = d({ label: 'noCull', cull: 'none' });
  const r = await pass.ready();
  assert.deepEqual(r, { pipelines: 6, distinct: 4, failed: 0 });
  assert.equal(kit.compiled.length, 4);
  assert.equal(hero.pipe.pipeline, lo.pipe.pipeline);
  assert.equal(alpha.pipe.pipeline, alpha2.pipe.pipeline);
  for (const x of [nearest, alpha, noCull]) assert.notEqual(x.pipe.pipeline, hero.pipe.pipeline, x.label);
  assert.notEqual(nearest.binder.layoutKey, hero.binder.layoutKey);
  assert.equal(lo.binder.layoutKey, hero.binder.layoutKey);
});

test('a hot edit compiles anew, and the old compile leaves the cache', async () => {
  const kit = fakeKit(), id = 'test/hot.wgsl', sh = shader(id, FILL);
  const a = new Compute(kit, sh, { label: 'a', entry: 'fill', bind: { data: buffer(kit) } });
  const b = new Compute(kit, sh, { label: 'b', entry: 'fill', bind: { data: buffer(kit) } });
  await kit.ready();
  const before = a.pipe.pipeline;
  assert.equal(kit.compiled.length, 1);
  shader(id, FILL.replace('* GAIN + BIAS', '* GAIN - BIAS'));
  await kit.ready();
  assert.equal(kit.compiled.length, 2);
  assert.ok(a.pipe.pipeline !== before && a.pipe.pipeline === b.pipe.pipeline);
  assert.equal(kit.pipelineCache.size, 1);
  assert.equal(a.pipe.builds, 2);
});

test('dispose lets the compile go with its last record', async () => {
  const kit = fakeKit(), sh = shader('test/dispose.wgsl', FILL);
  const c = (label) => new Compute(kit, sh, { label, entry: 'fill', bind: { data: buffer(kit) } });
  const a = c('a'), b = c('b');
  await kit.ready();
  a.dispose();
  assert.equal(kit.pipelineCache.size, 1);
  assert.ok(b.pipe.pipeline);
  b.dispose();
  assert.equal(kit.pipelineCache.size, 0);
  assert.equal(kit.pipelines.length, 0);
  await c('c').ready();
  assert.equal(kit.compiled.length, 2);
  // (one disposed before its module came doesn't join a compile)
  const gone = c('gone');
  gone.dispose();
  await tick();
  assert.equal(kit.pipelineCache.size, 1);
  assert.equal([...kit.pipelineCache.values()][0].users.size, 1);
});

test('a failed compile fails every record sharing it, and the next one asking tries again', async () => {
  const kit = fakeKit(), sh = shader('test/fail.wgsl', FILL);
  const c = (label) => new Compute(kit, sh, { label, entry: 'fill', bind: { data: buffer(kit) } });
  kit.fail.add('bad');
  const a = c('bad'), b = c('bad.too');
  const r = await kit.ready();
  assert.deepEqual(r, { pipelines: 2, distinct: 1, failed: 2 });
  assert.deepEqual(kit.errors, ['pipeline bad', 'pipeline bad.too']);
  assert.ok(a.pipe.error && b.pipe.error && !a.pipe.pipeline);
  assert.equal(kit.pipelineCache.size, 0);
  kit.fail.clear();
  const ok = c('ok');
  await ok.ready();
  assert.equal(kit.compiled.length, 2);
  assert.ok(ok.pipe.pipeline && !ok.pipe.error);
});

test('kit.ready(...items) waits for those alone; kit.ready() for everything', async () => {
  const kit = fakeKit(), sh = shader('test/ready.wgsl', FILL);
  const slow = new Compute(kit, sh, { label: 'slow', entry: 'clear', bind: { data: buffer(kit) } });
  const fast = new Compute(kit, sh, { label: 'fast', entry: 'fill', bind: { data: buffer(kit) } });
  kit.hold.add('slow');
  const pass = new RenderPass(kit, { color: [{ target: 'screen' }] });
  const draw = pass.draw(shader('test/ready-sprite.wgsl', SPRITE), { bind: { tex: new GPUTextureView(), samp: 'linear' } });
  // (a run list as it is: what has no pipeline is passed over, a record listed twice counted once)
  assert.deepEqual(pipelinesOf([fast, null, false, new RawItem(() => {}), [pass, [fast]]]), [fast.pipe, draw.pipe]);
  assert.deepEqual(pipelinesOf([]), []);
  const r = await kit.ready([fast, pass]);
  assert.deepEqual(r, { pipelines: 2, distinct: 2, failed: 0 });
  assert.ok(fast.pipe.pipeline && draw.pipe.pipeline && !slow.pipe.pipeline && slow.pipe.pending);
  // (an empty list waits for nothing)
  assert.deepEqual(await kit.ready([]), { pipelines: 0, distinct: 0, failed: 0 });
  let all = false;
  const everything = kit.ready().then(() => { all = true; });
  await tick(); await tick();
  assert.equal(all, false, 'kit.ready() waits for the held compile');
  kit.release();
  await everything;
  assert.ok(slow.pipe.pipeline);
});

test('a compile scheduler: asked once per distinct pipeline; one made on the spot is made for all sharing it', async () => {
  const kit = fakeKit(), sh = shader('test/sched.wgsl', FILL);
  const parked = new Map();
  kit.compiler = {
    holding: true,
    compile: (rec) => new Promise((res) => parked.set(rec, res)),
    now(rec) {
      const m = kit.moduleNow(rec.shader);
      if (!m || rec._pipe) return;
      const p = rec.makeNow(m);
      rec.deferred = false;
      rec.pipeline = p;
      parked.get(rec)?.(p);
    },
  };
  const c = (label) => new Compute(kit, sh, { label, entry: 'fill', bind: { data: buffer(kit) } });
  const a = c('a'), b = c('b');
  const r = await kit.ready();
  assert.equal(parked.size, 1, 'asked once');
  assert.ok(a.pipe.deferred && b.pipe.deferred && !a.pipe._pipe && r.pipelines === 2);
  // (the second read first: made on the spot for both)
  const p = b.pipe.pipeline;
  assert.ok(p?.now && a.pipe._pipe === p);
  await Promise.all([a.pipe.pending, b.pipe.pending]);
  assert.equal(kit.compiled.length, 1);
  assert.ok(!a.pipe.error && !b.pipe.error);
});
