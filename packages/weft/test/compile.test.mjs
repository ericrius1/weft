// The serial compile scheduler (compile.ts): the compiles it's asked for start one at a time, in the order asked, a
// frame apart (here, with no animation frames, a moment apart), each only after the one before has landed; one needed
// before its turn is made on the spot. Without a GPU. Run with `npm test` after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
const { SerialCompiler } = await import('../dist/src/compile.js');

test('one compile at a time, in order', async () => {
  const c = new SerialCompiler({ moduleNow: () => null });
  const log = [];
  let running = 0, most = 0;
  const start = (name) => async () => {
    running++; most = Math.max(most, running); log.push(`start ${name}`);
    await new Promise((r) => setTimeout(r, 5));
    running--; log.push(`done ${name}`);
    return name;
  };
  const got = await Promise.all(['a', 'b', 'c'].map((n) => c.compile({}, start(n))));
  assert.deepEqual(got, ['a', 'b', 'c']);
  assert.equal(most, 1);
  assert.deepEqual(log, ['start a', 'done a', 'start b', 'done b', 'start c', 'done c']);
  assert.equal(c.stats.compiled, 3);
});

test('a compile that fails lets the next go on', async () => {
  const c = new SerialCompiler({ moduleNow: () => null });
  const bad = c.compile({}, async () => { throw new Error('nope'); });
  const good = c.compile({}, async () => 'ok');
  await assert.rejects(bad, /nope/);
  assert.equal(await good, 'ok');
});

test('one needed now is made on the spot', () => {
  const module = {};
  const c = new SerialCompiler({ moduleNow: () => module });
  const rec = { _pipe: null, shader: {}, pipeline: null, makeNow: (m) => (m === module ? 'made' : null) };
  c.now(rec);
  assert.equal(rec.pipeline, 'made');
  assert.equal(c.stats.now, 1);
});

test('urge() promotes a queued pipeline ahead of background compiles', async () => {
  const c = new SerialCompiler({ moduleNow: () => null }, 1);
  const order = [];
  const recs = ['a', 'b', 'c', 'd'].map((n) => ({ label: n }));
  const start = (name) => async () => {
    order.push(name);
    await new Promise((r) => setTimeout(r, 4));
    return name;
  };
  const ps = recs.map((r) => c.compile(r, start(r.label)));
  // 'a' has already started waiting for its frame; promote 'd' ahead of 'b' and 'c'
  c.urge(recs[3]);
  const got = await Promise.all(ps);
  assert.deepEqual(got, ['a', 'b', 'c', 'd']);
  assert.deepEqual(order, ['a', 'd', 'b', 'c']);
  assert.equal(c.stats.urged, 1);
});

/** count the frames waited for while `fn` runs (animation frames stood in for by immediates) */
async function framesDuring(fn) {
  let frames = 0;
  const was = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => { frames++; setImmediate(cb); };
  try { await fn(); } finally { globalThis.requestAnimationFrame = was; }
  return frames;
}

test('an ask whose compile is already made or started is settled without waiting a frame', async () => {
  const c = new SerialCompiler({ moduleNow: () => null });
  const made = new Set();
  const start = (name) => async () => { made.add(name); return name; };
  const frames = await framesDuring(async () => {
    const ps = [];
    for (let i = 0; i < 50; i++) ps.push(c.compile({}, start(`p${i}`), () => made.has(`p${i}`)));
    // (as when they're needed before their turn: every one but the first and the last made on the spot)
    for (let i = 1; i < 49; i++) made.add(`p${i}`);
    assert.deepEqual(await Promise.all(ps), Array.from({ length: 50 }, (_, i) => `p${i}`));
  });
  assert.equal(frames, 2, 'a frame each for the two the GPU was asked for, none for the 48 already made');
  assert.deepEqual([c.stats.compiled, c.stats.spared], [2, 48]);
});

test("records sharing one compile cost one turn, and one made on the spot none: the scheduler's queue with real records", async () => {
  const { fakeKit, shader, TRI } = await import('./fakekit.mjs');
  const { RenderPass } = await import('../dist/src/passes.js');
  const kit = fakeKit(), sh = shader('test/compile-tri.wgsl', TRI);
  const c = kit.compiler = new SerialCompiler(kit);
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }] });
  const frames = await framesDuring(async () => {
    // (twelve draws of one descriptor, labels aside: one compile between them; and four of their own)
    for (let i = 0; i < 12; i++) pass.draw(sh, { label: `twin${i}` });
    const own = ['none', 'front'].flatMap((cull) => [pass.draw(sh, { label: `own.${cull}`, cull }), pass.draw(sh, { label: `strip.${cull}`, cull, topology: 'triangle-strip' })]);
    // (their modules made, their asks queued: then two of the four are needed at once)
    await new Promise((r) => setImmediate(r));
    c.now(own[2].pipe);
    c.now(own[3].pipe);
    const r = await kit.ready();
    assert.deepEqual([r.pipelines, r.distinct, r.failed], [16, 5, 0]);
  });
  assert.equal(c.stats.now, 2);
  assert.equal(c.stats.compiled, 3, 'the twins once, and the two not made on the spot');
  assert.equal(c.stats.compiled + c.stats.spared, 16);
  assert.equal(frames, 3, 'a frame for each compile asked of the GPU, none for the rest');
  assert.equal(kit.compiled.length, 5);
});
