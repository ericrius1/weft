// The load guard (src/device.ts): a load that never settled steps the next one down the ladder, kept as the most auto
// may choose; a GPU lost does the same; a phone's step (off the ladder) is never stepped down. localStorage stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { LoadGuard } = await import('../dist/src/device.js');

const keys = { guard: 'g.guard', safe: 'g.safe' };
const ladder = ['rtx', 'm5', 'm1pro', 'm1air'];

test('a clean history: auto runs what it detected', () => {
  store.clear();
  const g = new LoadGuard(keys, ladder);
  assert.equal(g.crashed, null);
  assert.equal(g.choose('rtx'), 'rtx');
  g.begin('rtx');
  assert.equal(store.get('g.guard'), 'rtx');
});

test('a load that never settled: the next is a step lighter, and stays so', () => {
  store.clear();
  new LoadGuard(keys, ladder).begin('rtx');
  const g = new LoadGuard(keys, ladder);
  assert.equal(g.crashed, 'rtx');
  assert.equal(g.cap, 'm5');
  assert.equal(g.choose('rtx'), 'm5');
  assert.equal(g.choose('m1air'), 'm1air');
  g.begin('m5');
  // (it crashed again: one lighter still)
  const h = new LoadGuard(keys, ladder);
  assert.equal(h.choose('rtx'), 'm1pro');
});

test('a GPU lost while shown, the governor lowering, and a choice by hand', () => {
  store.clear();
  const g = new LoadGuard(keys, ladder);
  g.begin('m5');
  g.failed();
  assert.equal(store.has('g.guard'), false);
  assert.equal(new LoadGuard(keys, ladder).choose('rtx'), 'm1pro');
  assert.equal(g.lower('m1air'), true);
  assert.equal(g.lower('m5'), false);
  g.reset();
  assert.equal(new LoadGuard(keys, ladder).choose('rtx'), 'rtx');
});

test('a step off the ladder (a phone) is never stepped down', () => {
  store.clear();
  new LoadGuard(keys, ladder).begin('iphone');
  const g = new LoadGuard(keys, ladder);
  assert.equal(g.crashed, null);
  assert.equal(g.choose('iphone'), 'iphone');
});
