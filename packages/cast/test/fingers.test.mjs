// The hand as a hand (fingers.ts), on the built package (npm test -w @ericrius1/cast), with a cast body's own bind
// hands (test/fixtures/hands.json): spans a hand reaches and one it refuses, a triad placed, a finger struck again
// while its neighbours hold their keys, a fingertip onto a black key in a fall's time, joints never past their limits,
// the left hand the right's mirror, and what a solve costs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HandModel, HandSolve, handAsk, solveHand, hpOf, HAND_N } from '../dist/fingers.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/hands.json', import.meta.url), 'utf8'));
const asset = { bones: fx.bones, index: Object.fromEntries(fx.bones.map((b, i) => [b.name, i])) };
const R = HandModel.of(asset, 'R'), L = HandModel.of(asset, 'L');
const W = 0.0235; // a white key's width

/** the keys' tops under the hand (hand space: x along the hand, y toward the thumb, z out of the palm): a line across
 *  the hand ~2.5 cm past the knuckles and ~4.5 cm below them */
const kx = () => R.base[3] + 0.025, kz = 0.045;
const key = (along, up = 0, deep = 0) => [kx() + deep, along, kz - up];
/** an ask: tips (thumb first, null for none), the palm free or not, the rest a relaxed curl */
function ask(tips, free = 1) {
  const Q = handAsk();
  tips.forEach((t, f) => { if (t) { Q.tgt.set(t, f * 3); Q.w[f] = 1; } else Q.resting[f] = 1; });
  for (let f = 1; f <= 4; f++) { const o = hpOf(f); Q.rest.set([0, 0.4, 0.6, 0.42], o); Q.wr.set(tips[f] ? [1.2, 0.3, 0.3, 0.3] : [1.5, 1, 1, 1], o); }
  Q.rest.set([0.25, 0.1, 0.35, 0.2], 23); Q.wr.set([0.6, 0.6, 0.6, 0.6], 23);
  Q.rest[6] = 0.15; Q.wr[6] = 1;
  Q.free = free;
  return Q;
}
/** solved as a rig would, frame on frame (warm), `frames` frames */
function settle(M, Q, frames = 30, S = new HandSolve()) { for (let i = 0; i < frames; i++) solveHand(M, S, Q, 8); return S; }
const mm = (v) => +(v * 1000).toFixed(1);

test('spans: a fifth and an octave reached (thumb to little finger), a tenth refused', () => {
  for (const [name, span, ok] of [['fifth', 4 * W, true], ['octave', 7 * W, true], ['tenth', 9 * W, false]]) {
    const S = settle(R, ask([key(span / 2), null, null, null, key(-span / 2)]));
    const miss = Math.max(S.miss[0], S.miss[4]);
    if (ok) assert.ok(miss < 0.002, `${name} (${(span * 100).toFixed(1)} cm): missed by ${mm(miss)} mm`);
    else assert.ok(miss > 0.005, `${name} (${(span * 100).toFixed(1)} cm) should be out of reach, missed by only ${mm(miss)} mm`);
  }
});

test('a triad (C E G: thumb, middle, little) placed with all three tips within 2 mm', () => {
  const S = settle(R, ask([key(2 * W), null, key(0), null, key(-2 * W)]));
  for (const f of [0, 2, 4]) assert.ok(S.miss[f] < 0.002, `finger ${f} missed by ${mm(S.miss[f])} mm`);
  // (and the D major one, its middle on the black key between: higher and further in)
  const B = settle(R, ask([key(2 * W), null, key(0.5 * W, 0.012, 0.045), null, key(-2 * W)]));
  for (const f of [0, 2, 4]) assert.ok(B.miss[f] < 0.002, `D major: finger ${f} missed by ${mm(B.miss[f])} mm`);
});

test('a finger struck again while its neighbours hold their keys: it lifts clear, they stay', () => {
  const tips = [key(2.2 * W), key(W), key(0), key(-W), key(-2 * W)];
  const S = settle(R, ask(tips));
  for (let f = 0; f < 5; f++) assert.ok(S.miss[f] < 0.002, `all five down: finger ${f} missed by ${mm(S.miss[f])} mm`);
  // the middle finger up 1.5 cm (a key's travel and a hover), the rest held down
  const up = [...tips]; up[2] = key(0, 0.015);
  const U = settle(R, ask(up), 20, S);
  for (let f = 0; f < 5; f++) assert.ok(U.miss[f] < 0.002, `middle lifted: finger ${f} missed by ${mm(U.miss[f])} mm`);
  // (the ring finger, the least independent, too)
  const ur = [...tips]; ur[3] = key(-W, 0.012);
  const V = settle(R, ask(ur), 20, S);
  for (let f = 0; f < 5; f++) assert.ok(V.miss[f] < 0.0025, `ring lifted: finger ${f} missed by ${mm(V.miss[f])} mm`);
});

test('a fingertip from a white key onto a black one in a fall\'s time (0.1 s at 60 fps): on it as it lands', () => {
  const S = settle(R, ask([key(2.2 * W), key(W), key(0), key(-W), key(-2 * W)]));
  const from = key(W), to = key(1.5 * W, 0.012, 0.045);
  let worst = 0;
  for (let i = 1; i <= 6; i++) {
    const u = i / 6, e = u * u * (3 - 2 * u);
    const t = from.map((v, k) => v + (to[k] - v) * e);
    t[2] -= Math.sin(Math.PI * u) * 0.012;
    const tips = [key(2.2 * W), t, key(0), key(-W), key(-2 * W)];
    solveHand(R, S, ask(tips), 8);
    worst = Math.max(worst, S.miss[1]);
  }
  assert.ok(S.miss[1] < 0.002, `landed ${mm(S.miss[1])} mm off the black key`);
  assert.ok(worst < 0.004, `on its way it fell ${mm(worst)} mm behind`);
});

test('joints never past their limits, whatever is asked (reachable or not)', () => {
  let seed = 9;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const S = new HandSolve();
  for (let i = 0; i < 200; i++) {
    const tips = [0, 1, 2, 3, 4].map((f) => (rnd() > -0.3 ? [kx() + rnd() * 0.12, (2 - f) * W + rnd() * 0.12, kz + rnd() * 0.12] : null));
    solveHand(R, S, ask(tips, rnd() > 0 ? 1 : 0), 8);
    for (let k = 0; k < HAND_N; k++) assert.ok(S.x[k] >= R.lo[k] - 1e-9 && S.x[k] <= R.hi[k] + 1e-9, `number ${k} = ${S.x[k]} outside [${R.lo[k]}, ${R.hi[k]}]`);
  }
});

test('the left hand is the right\'s mirror: the same ask, the same answer in its own hand space', () => {
  const Q = ask([key(2 * W), null, key(0), null, key(-2 * W)]);
  const a = settle(R, Q), b = settle(L, Q);
  for (let k = 0; k < HAND_N; k++) assert.ok(Math.abs(a.x[k] - b.x[k]) < 0.02, `number ${k}: ${a.x[k]} / ${b.x[k]}`);
});

test('cost: a warm solve of a moving chord', () => {
  const S = settle(R, ask([key(2 * W), key(W), key(0), key(-W), key(-2 * W)]));
  const n = 2000, t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const d = Math.sin(i * 0.05) * 0.004;
    solveHand(R, S, ask([key(2 * W + d), key(W + d, 0.01), key(d), key(-W + d, 0.01), key(-2 * W + d)]), 8);
  }
  const us = ((performance.now() - t0) / n) * 1000;
  console.log(`# a hand's solve: ${us.toFixed(1)} µs (warm, a chord moving 4 mm, palm free)`);
  assert.ok(us < 400, `${us} µs a solve`);
});
