// A pass's draws (passes.ts): where a late-declared draw lands in its pass's order (RenderPass.place), and a draw or
// compute run with no pipeline (counted, said in debug; kit.ready() names the failures). Without a GPU (fakekit.mjs).
// Run with `npm test` after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeKit, shader, encoder, TRI } from './fakekit.mjs';

const { RenderPass, Compute } = await import('../dist/src/passes.js');
const { StorageBuffer } = await import('../dist/src/resources.js');

const labels = (pass) => pass.draws.map((d) => d.label);

test('place: draws declared late go before or after an anchor, not at the end', () => {
  const kit = fakeKit(), sh = shader('test/tri.wgsl', TRI);
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }] });
  const ground = pass.draw(sh, { label: 'ground' });
  const birds = pass.draw(sh, { label: 'birds' });
  pass.draw(sh, { label: 'glass' });
  // (after a draw: two draws and a bundle, kept in the order declared)
  const placed = pass.place(birds, 'after', () => {
    pass.draw(sh, { label: 'hawk' });
    pass.bundle('nest').draw(sh, { label: 'twig' });
    // (while `add` runs, what it has declared is at the end of the pass's draws, as it always was)
    assert.equal(pass.draws[pass.draws.length - 1].label, 'nest');
    pass.draw(sh, { label: 'hawk.shadow' });
  });
  assert.deepEqual(labels(pass), ['ground', 'birds', 'hawk', 'nest', 'hawk.shadow', 'glass']);
  assert.deepEqual(placed.map((d) => d.label), ['hawk', 'nest', 'hawk.shadow']);
  // (before a draw)
  pass.place(ground, 'before', () => { pass.draw(sh, { label: 'sky' }); });
  assert.deepEqual(labels(pass), ['sky', 'ground', 'birds', 'hawk', 'nest', 'hawk.shadow', 'glass']);
  // (the anchor by its label: the first with it)
  pass.place('glass', 'before', () => { pass.draw(sh, { label: 'flock' }); });
  assert.deepEqual(labels(pass).slice(-2), ['flock', 'glass']);
});

test('place: no anchor, or one not in the pass, leaves them at the end; nothing declared places nothing', () => {
  const kit = fakeKit(), sh = shader('test/tri.wgsl', TRI);
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }] });
  const other = new RenderPass(kit, { label: 'other', color: [{ target: 'screen' }] });
  const elsewhere = other.draw(sh, { label: 'elsewhere' });
  pass.draw(sh, { label: 'a' });
  pass.place(null, 'before', () => { pass.draw(sh, { label: 'b' }); });
  pass.place(undefined, 'after', () => { pass.draw(sh, { label: 'c' }); });
  pass.place(elsewhere, 'before', () => { pass.draw(sh, { label: 'd' }); });
  pass.place('no such label', 'after', () => { pass.draw(sh, { label: 'e' }); });
  assert.deepEqual(labels(pass), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(pass.place('a', 'before', () => {}), []);
  assert.deepEqual(labels(pass), ['a', 'b', 'c', 'd', 'e']);
  // (draws declared into another pass meanwhile stay there)
  pass.place('a', 'before', () => { other.draw(sh, { label: 'theirs' }); pass.draw(sh, { label: 'mine' }); });
  assert.deepEqual(labels(pass), ['mine', 'a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(labels(other), ['elsewhere', 'theirs']);
});

test('place: what was declared before `add` threw is placed too', () => {
  const kit = fakeKit(), sh = shader('test/tri.wgsl', TRI);
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }] });
  const a = pass.draw(sh, { label: 'a' });
  pass.draw(sh, { label: 'z' });
  assert.throws(() => pass.place(a, 'after', () => { pass.draw(sh, { label: 'b' }); throw new Error('half made'); }), /half made/);
  assert.deepEqual(labels(pass), ['a', 'b', 'z']);
  // (and the next place is none the worse for it)
  pass.place(a, 'before', () => { pass.draw(sh, { label: 'first' }); });
  assert.deepEqual(labels(pass), ['first', 'a', 'b', 'z']);
});

test('place: a place inside a place keeps both, wherever the inner one puts its draws', () => {
  const kit = fakeKit(), sh = shader('test/tri.wgsl', TRI);
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }] });
  const a = pass.draw(sh, { label: 'a' });
  const b = pass.draw(sh, { label: 'b' });
  pass.draw(sh, { label: 'z' });
  pass.place(b, 'after', () => {
    const c = pass.draw(sh, { label: 'c' });
    // (ahead of everything the outer one has declared: before an older draw, and right after the last older one)
    pass.place(a, 'before', () => { pass.draw(sh, { label: 'first' }); });
    pass.place('z', 'after', () => { pass.draw(sh, { label: 'last' }); });
    // (among the outer one's own draws; and with no anchor, where it was declared)
    pass.place(c, 'before', () => { pass.draw(sh, { label: 'c0' }); });
    pass.place(null, 'after', () => { pass.draw(sh, { label: 'd' }); });
    pass.draw(sh, { label: 'e' });
  });
  assert.deepEqual(labels(pass), ['first', 'a', 'b', 'c0', 'c', 'd', 'e', 'z', 'last']);
});

// ---- a draw or compute run with no pipeline (PipelineRecord.skipped), and what kit.ready() says of the failures
const FILL = `
@group(1) @binding(0) var<storage, read_write> data: array<f32>;
@compute @workgroup_size(64) fn fill(@builtin(global_invocation_id) id: vec3u) { data[id.x] = 1.0; }`;
/** a command encoder as far as a compute's encode goes: `into` gets each dispatch */
const commands = (into = []) => ({
  beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups: (...a) => into.push(a), end() {} }),
});

test('a draw run before its pipeline is ready does nothing, and is counted; in debug the first time is said', async () => {
  const kit = fakeKit(), sh = shader('test/tri.wgsl', TRI);
  kit.debug = true;
  const pass = new RenderPass(kit, { label: 'bake', color: [{ target: 'screen' }] });
  const d = pass.draw(sh, { label: 'fill' });
  const pe = encoder();
  d.encodeInto(pe);
  d.encodeInto(pe);
  assert.deepEqual(pe.calls, []);
  assert.equal(d.pipe.skipped, 2);
  assert.deepEqual(kit.warned, ['skip:fill']);
  assert.match(kit.warnings.get('skip:fill'), /before its pipeline was ready/);
  await d.ready();
  d.encodeInto(pe);
  assert.deepEqual(pe.calls, [['setPipeline', 'fill'], ['draw', 3, 1, 0, 0]]);
  assert.equal(d.pipe.skipped, 2, 'not counted once it draws');
  // (off, or held back by a scheduler's gate: not a skip)
  const off = pass.draw(sh, { label: 'off', enabled: false });
  off.encodeInto(pe);
  assert.equal(off.pipe.skipped, 0);
  d.pipe.gate = () => false;
  d.encodeInto(pe);
  assert.equal(d.pipe.skipped, 2);
});

test('skips are counted without debug, but nothing is said; a compute is the same', async () => {
  const kit = fakeKit(), sh = shader('test/fill.wgsl', FILL);
  const c = new Compute(kit, sh, { label: 'fill', bind: { data: new StorageBuffer(kit, { size: 256 }) }, threads: [128] });
  const ran = [];
  c.encode(commands(ran));
  assert.deepEqual(ran, []);
  assert.equal(c.pipe.skipped, 1);
  assert.deepEqual(kit.warned, []);
  await c.ready();
  c.encode(commands(ran));
  assert.deepEqual(ran, [[2, 1, 1]]);
  assert.equal(c.pipe.skipped, 1);
});

test("a compute's dispatch: threads over the entry's workgroup size (rounded up), or workgroups as given; none for a count of 0", async () => {
  const kit = fakeKit();
  const sh = shader('test/grid.wgsl', `
@group(1) @binding(0) var<storage, read_write> data: array<f32>;
@compute @workgroup_size(8, 4) fn grid(@builtin(global_invocation_id) id: vec3u) { data[id.x] = 1.0; }
@compute @workgroup_size(64) fn row(@builtin(global_invocation_id) id: vec3u) { data[id.x] = 2.0; }`);
  const data = new StorageBuffer(kit, { size: 256 });
  let n = [20, 9];
  const made = [
    new Compute(kit, sh, { label: 'a', entry: 'grid', bind: { data }, threads: () => n }),
    new Compute(kit, sh, { label: 'b', entry: 'grid', bind: { data }, threads: [16, 8, 3] }),
    new Compute(kit, sh, { label: 'c', entry: 'row', bind: { data }, threads: [65] }),
    new Compute(kit, sh, { label: 'd', entry: 'row', bind: { data }, workgroups: [3, 2] }),
    new Compute(kit, sh, { label: 'e', entry: 'row', bind: { data }, workgroups: () => [5, 1, 7] }),
    new Compute(kit, sh, { label: 'f', entry: 'row', bind: { data } }),
    new Compute(kit, sh, { label: 'g', entry: 'row', bind: { data }, workgroups: [0, 4] }),
    new Compute(kit, sh, { label: 'h', entry: 'row', bind: { data }, threads: [0] }),
  ];
  await kit.ready();
  assert.deepEqual(made[0].workgroupSize, [8, 4, 1]);
  assert.deepEqual(made[2].workgroupSize, [64, 1, 1]);
  const ran = [];
  for (const c of made) c.encode(commands(ran));
  assert.deepEqual(ran, [[3, 3, 1], [2, 2, 3], [2, 1, 1], [3, 2, 1], [5, 1, 7], [1, 1, 1]]);
  // (asked each frame)
  n = [8, 4];
  ran.length = 0;
  made[0].encode(commands(ran));
  assert.deepEqual(ran, [[1, 1, 1]]);
});

test('kit.ready() names what failed: errors, each with its label and message; a failed draw says so when skipped', async () => {
  const kit = fakeKit(), sh = shader('test/tri.wgsl', TRI);
  kit.debug = true;
  kit.fail.add('broken');
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }] });
  const fine = pass.draw(sh, { label: 'fine' });
  // (a different descriptor, so it doesn't share the first one's compile)
  const bad = pass.draw(sh, { label: 'broken', cull: 'none' });
  const r = await kit.ready();
  assert.equal(r.pipelines, 2);
  assert.equal(r.failed, 1);
  assert.deepEqual(r.errors, [{ label: 'broken', message: 'broken failed to compile' }]);
  assert.deepEqual((await fine.ready()).errors, []);
  bad.encodeInto(encoder());
  assert.equal(bad.pipe.skipped, 1);
  assert.match(kit.warnings.get('skip:broken'), /its pipeline failed: broken failed to compile/);
});

test("a disposed draw's failure leaves kit.errors with it, unless another of its label failed too", async () => {
  const kit = fakeKit(), sh = shader('test/tri.wgsl', TRI);
  kit.fail.add('broken').add('twin');
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }] });
  const bad = pass.draw(sh, { label: 'broken', cull: 'none' });
  const fine = pass.draw(sh, { label: 'fine' });
  const twins = [pass.draw(sh, { label: 'twin', cull: 'front' }), pass.draw(sh, { label: 'twin', topology: 'line-list' })];
  await kit.ready();
  assert.deepEqual([...kit.errors.keys()].sort(), ['pipeline:broken', 'pipeline:twin']);
  fine.dispose();
  assert.equal(kit.errors.size, 2);
  bad.dispose();
  assert.deepEqual([...kit.errors.keys()], ['pipeline:twin']);
  assert.equal((await kit.ready()).failed, 2);
  twins[0].dispose();
  assert.deepEqual([...kit.errors.keys()], ['pipeline:twin'], 'the other twin has failed too');
  twins[1].dispose();
  assert.equal(kit.errors.size, 0);
  assert.deepEqual(await kit.ready(), { pipelines: 0, distinct: 0, failed: 0, errors: [] });
});

// ---- a fallback (DrawOptions.fallback): drawn in a draw's place while that draw's pipeline has failed
test('a fallback is drawn in place of a draw whose pipeline failed, when that draw would be, and never by itself', async () => {
  const kit = fakeKit(), sh = shader('test/tri.wgsl', TRI);
  kit.fail.add('terrain');
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }] });
  const plain = pass.draw(sh, { label: 'terrain.plain', count: 6, enabled: false });
  let shown = true;
  const terrain = pass.draw(sh, { label: 'terrain', cull: 'none', count: 600, enabled: () => shown, fallback: plain });
  const sound = pass.draw(sh, { label: 'sea', cull: 'front', count: 9, fallback: plain });
  // (while it's still compiling: nothing, not the fallback)
  const early = encoder();
  terrain.encodeInto(early);
  assert.deepEqual(early.calls, []);
  await pass.ready();
  const pe = encoder();
  for (const d of pass.draws) d.encode(pe);
  // (the fallback by itself: nothing; for the failed draw: its own calls; a draw that compiled: itself)
  assert.deepEqual(pe.calls, [['setPipeline', 'terrain.plain'], ['draw', 6, 1, 0, 0], ['setPipeline', 'sea'], ['draw', 9, 1, 0, 0]]);
  assert.equal(terrain.pipe.skipped, 1, 'only the early one: drawing its fallback is not a skip');
  shown = false;
  const hidden = encoder();
  terrain.encodeInto(hidden);
  assert.deepEqual(hidden.calls, [], 'off with the draw it stands in for');
  void sound;
});

test('a fallback that failed too draws nothing; one in a bundle is recorded once the failure is known', async () => {
  const kit = fakeKit(), sh = shader('test/tri.wgsl', TRI);
  kit.fail.add('a').add('b');
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }] });
  const b = pass.draw(sh, { label: 'b', cull: 'front', enabled: false });
  const a = pass.draw(sh, { label: 'a', cull: 'none', fallback: b });
  await pass.ready();
  const pe = encoder();
  a.encodeInto(pe);
  assert.deepEqual(pe.calls, []);
  assert.equal(b.pipe.skipped, 1);

  // (bundled: recorded before the compile failed, then again with the fallback's calls)
  const recorded = [];
  kit.device.createRenderBundleEncoder = () => encoder(recorded);
  kit.fail.add('city');
  const bundle = pass.bundle('static');
  const low = bundle.draw(sh, { label: 'city.low', count: 12, enabled: false });
  bundle.draw(sh, { label: 'city', cull: 'none', count: 1200, fallback: low });
  bundle.encode(encoder());
  assert.deepEqual(recorded, []);
  await bundle.ready();
  bundle.encode(encoder());
  assert.deepEqual(recorded, [['setPipeline', 'city.low'], ['draw', 12, 1, 0, 0]]);
  const n = bundle.records;
  bundle.encode(encoder());
  assert.equal(bundle.records, n, 'replayed after that');
});

test('consecutive draws sharing vertex/index buffers deduplicate setVertexBuffer/setIndexBuffer until forgetPassState', async () => {
  const { forgetPassState } = await import('../dist/src/passes.js');
  const kit = fakeKit(), sh = shader('test/vbib.wgsl', TRI);
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }] });
  const vb1 = new StorageBuffer(kit, { size: 64 }), vb2 = new StorageBuffer(kit, { size: 64 });
  const ib1 = new StorageBuffer(kit, { size: 64 });
  const layout = { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] };
  const d1 = pass.draw(sh, { label: 'd1', count: 3, vertexBuffers: [{ layout, buffer: vb1 }], indices: { buffer: ib1, format: 'uint16' } });
  const d2 = pass.draw(sh, { label: 'd2', count: 3, vertexBuffers: [{ layout, buffer: vb1 }], indices: { buffer: ib1, format: 'uint16' } });
  const d3 = pass.draw(sh, { label: 'd3', count: 3, vertexBuffers: [{ layout, buffer: vb2, offset: 16 }], indices: { buffer: ib1, format: 'uint16', offset: 4 } });
  await pass.ready();
  const log = [];
  const pe = {
    setPipeline: (p) => log.push(['pipe', p.label]),
    setBindGroup() {},
    setVertexBuffer: (slot, buf, off) => log.push(['vb', slot, buf === vb1.gpu ? 'vb1' : 'vb2', off]),
    setIndexBuffer: (buf, fmt, off) => log.push(['ib', fmt, off]),
    draw() {}, drawIndexed: () => log.push(['drawIndexed']), drawIndirect() {}, drawIndexedIndirect() {},
  };
  d1.encodeInto(pe);
  d2.encodeInto(pe);
  d3.encodeInto(pe);
  forgetPassState(pe);
  d3.encodeInto(pe);
  assert.deepEqual(log, [
    ['pipe', 'd1'], ['vb', 0, 'vb1', 0], ['ib', 'uint16', 0], ['drawIndexed'],
    ['drawIndexed'],
    ['vb', 0, 'vb2', 16], ['ib', 'uint16', 4], ['drawIndexed'],
    ['pipe', 'd1'], ['vb', 0, 'vb2', 16], ['ib', 'uint16', 4], ['drawIndexed'],
  ]);
});
