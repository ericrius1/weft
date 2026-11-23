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
