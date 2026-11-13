// Malformed asks never break a hand for good (cast 0.6.x): a rest or weight that isn't a number is left out of the
// solve, and a solver state that isn't finite (a bad frame got into it) is started again from the rests — on the built
// package with a built body's bind hands (test/fixtures/hands-built.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HandModel, HandSolve, handAsk, solveHand, hpOf } from '../dist/fingers.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/hands-built.json', import.meta.url), 'utf8'));
const asset = { bones: fx.bones, index: Object.fromEntries(fx.bones.map((b, i) => [b.name, i])), header: { hand: {} } };
const M = HandModel.of(asset, 'R');
function ask() {
  const Q = handAsk();
  for (let f = 0; f < 5; f++) Q.resting[f] = 1;
  for (let f = 1; f <= 4; f++) { const o = hpOf(f); Q.rest.set([0, 0.5, 0.8, 0.5], o); Q.wr.set([1.5, 1, 1, 1], o); }
  Q.rest.set([0.25, 0.1, 0.35, 0.2], 23); Q.wr.set([0.6, 0.6, 0.6, 0.6], 23);
  Q.rest[6] = 0.15; Q.wr[6] = 1;
  return Q;
}
const finite = (S) => Array.from(S.x).every(Number.isFinite);

test('a rest that is NaN or missing is left out; the rest of the hand solves as before', () => {
  const S0 = new HandSolve(), Q0 = ask();
  solveHand(M, S0, Q0, 8);
  const S = new HandSolve(), Q = ask();
  Q.rest[hpOf(2) + 2] = NaN; Q.wr[hpOf(3) + 1] = NaN;
  for (let i = 0; i < 5; i++) solveHand(M, S, Q, 8);
  assert.ok(finite(S), 'the hand stays finite');
  // (the index, untouched by the bad numbers, where the clean ask put it)
  for (let j = 0; j < 4; j++) assert.ok(Math.abs(S.x[hpOf(1) + j] - S0.x[hpOf(1) + j]) < 0.05);
});

test('a state that went NaN is started again from the rests, not kept', () => {
  const S = new HandSolve(), Q = ask();
  solveHand(M, S, Q, 8);
  S.x[hpOf(1) + 1] = NaN; S.lam = NaN;
  solveHand(M, S, Q, 8);
  assert.ok(finite(S) && Number.isFinite(S.lam));
  solveHand(M, S, Q, 8);
  assert.ok(finite(S));
});

test('the term readout is per hand solve, a copy, and empty once the watch is off (0.6.1 release check)', async () => {
  const { setTermWatch, termPulls } = await import('../dist/fingers.js');
  setTermWatch([8, 9, 10]);
  const A = new HandSolve(), B = new HandSolve(), QA = ask(), QB = ask();
  QB.rest[hpOf(1) + 1] = 1.2;
  solveHand(M, A, QA, 4); solveHand(M, B, QB, 4);
  const a = termPulls(A), b = termPulls(B);
  assert.ok(Object.keys(a).length > 0 && Object.keys(b).length > 0, 'both hands read');
  assert.notDeepEqual(a.rest, b.rest, "each hand's own reading");
  a.rest[0] = 999;
  assert.notEqual(termPulls(A).rest[0], 999, 'a copy');
  setTermWatch(null);
  assert.deepEqual(termPulls(), {}); assert.deepEqual(termPulls(A), {});
});

test('the term readout is not stale after the watch is turned off and on again (0.6.2 release check)', async () => {
  const { setTermWatch, termPulls } = await import('../dist/fingers.js');
  setTermWatch([8, 9, 10]);
  const A = new HandSolve(), Q = ask();
  solveHand(M, A, Q, 4);
  assert.ok(Object.keys(termPulls(A)).length > 0);
  setTermWatch(null); setTermWatch([8, 9, 10]);
  assert.deepEqual(termPulls(A), {}, 'nothing read since the watch came back on');
  assert.deepEqual(termPulls(), {});
  solveHand(M, A, Q, 4);
  assert.ok(Object.keys(termPulls(A)).length > 0, 'read again once solved');
  setTermWatch(null);
});

test('a Pianist for a hand of no length (forHand(0)) plans no NaN fingertip (0.6.3 release check)', async () => {
  const { Pianist, pianoPlayable } = await import('../dist/piano.js');
  const Wk = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];
  const xOf = (n) => (Math.floor(n / 12) - 5) * 7 * 0.0235 + Wk[n % 12] * 0.0235;
  const I = pianoPlayable({
    axes: { along: [1, 0, 0], toward: [0, 0, 1], up: [0, 1, 0] }, facing: [0, 0, -1],
    seat: [0, 0.49, 0.6], keyboard: [0, 0.74, 0], pedalTop: [0, 0.07, -0.1], look: [0, 0.98, -0.2],
    touch: (n) => (n >= 36 && n <= 96 ? [xOf(n), 0.74, -0.035] : null),
  }, { state: new Float32Array(88), pedalState: { sustain: false } });
  const P = new Pianist().forHand(0);
  P.sit(I, I.stand, I.seat.yaw);
  for (let i = 0; i < 60; i++) P.update(1 / 60, 0);
  const notes = [60, 62, 64, 65, 67, 69, 71, 72].map((note, i) => ({ note, t0: 0.5 + i * 0.25, t1: 0.7 + i * 0.25, vel: 0.7 }));
  let t = 0;
  P.playScore({ notes, pedal: [], duration: 3 }, { clock: () => t });
  let bad = 0;
  for (let i = 0; i < 180; i++) { t = i / 60; P.update(1 / 60, 0); for (const h of P.planned) for (const q of h) if (q && !q.every(Number.isFinite)) bad++; }
  assert.equal(bad, 0);
});
