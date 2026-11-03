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
