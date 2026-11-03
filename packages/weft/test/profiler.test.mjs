// The profiler's smoothed times (profiler.ts ms) hold only passes still running: one that ran while loading, or was
// switched off, leaves after `stale` frames read back unseen, and comes back fresh; and timestamps whose frames last far
// longer than the time between frames (an iPhone's) aren't trusted. Without a GPU: a stand-in device
// hands back a millisecond a pass. Run with `npm test` after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
const { Profiler } = await import('../dist/src/profiler.js');

const tick = () => new Promise((r) => setImmediate(r));

function fakeKit(gap = 2) {
  // (pass p began at p * gap ms and ended 1 ms later)
  const stamps = new BigUint64Array(256).map((_, i) => BigInt((Math.floor(i / 2) * gap + (i % 2)) * 1e6 + 1e6));
  const encoder = () => ({ resolveQuerySet() {}, copyBufferToBuffer() {}, finish: () => ({}) });
  const buffer = () => ({ mapAsync: async () => {}, getMappedRange: () => stamps.buffer.slice(0), unmap() {} });
  return {
    features: new Set(['timestamp-query']),
    overlay: { open: true },
    device: { createQuerySet: () => ({}), createBuffer: buffer, createCommandEncoder: encoder },
    queue: { submit() {} },
  };
}

async function frame(p, labels) {
  p.beginFrame();
  for (const l of labels) p.writes(l);
  p.resolve([]);
  p.endFrame();
  await tick();
}

test('a pass unseen for `stale` frames leaves the smoothed times', async () => {
  const p = new Profiler(fakeKit());
  p.stale = 5;
  await frame(p, ['load.bake', 'scene']);
  assert.deepEqual([...p.ms.keys()].sort(), ['load.bake', 'scene']);
  assert.ok(Math.abs(p.ms.get('scene') - 1) < 1e-9);
  for (let i = 0; i < 5; i++) await frame(p, ['scene']);
  assert.ok(p.ms.has('load.bake'), 'kept through `stale` frames');
  await frame(p, ['scene']);
  assert.deepEqual([...p.ms.keys()], ['scene']);
  // (back again: smoothed from its new times, not the old)
  await frame(p, ['scene', 'load.bake']);
  assert.ok(p.ms.has('load.bake'));
});

test('timing again after a while off starts afresh', async () => {
  const kit = fakeKit(), p = new Profiler(kit);
  await frame(p, ['a', 'b']);
  kit.overlay.open = false;
  await frame(p, []);
  assert.ok(p.ms.has('a'));
  kit.overlay.open = true;
  await frame(p, ['a']);
  assert.deepEqual([...p.ms.keys()], ['a']);
});

test('timestamps that add up stay trusted', async () => {
  const p = new Profiler(fakeKit());
  for (let i = 0; i < 40; i++) await frame(p, ['shadow', 'scene', 'post']);
  assert.equal(p.trusted, true);
  assert.ok(Math.abs(p.lastFrameMs - 5) < 1e-9, `a frame of 5 ms (${p.lastFrameMs})`);
});

test('frames far longer than the time between them: the timestamps not trusted', async () => {
  // (each pass a plausible millisecond, but seconds apart: frames of 10 s, read back a moment apart)
  const p = new Profiler(fakeKit(5000));
  for (let i = 0; i < 19; i++) await frame(p, ['shadow', 'scene', 'post']);
  assert.equal(p.trusted, true, 'not judged on a few frames');
  for (let i = 0; i < 5; i++) await frame(p, ['shadow', 'scene', 'post']);
  assert.equal(p.trusted, false);
});
