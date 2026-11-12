// A neck held in the hand (HandAsk.neck, HandGoal.neck: Checkpoint K), on the built package with a built body's bind
// hands (test/fixtures/hands-built.json): the palm's skin pushed off the wood to its air, the index's base drawn onto the
// board's edge when asked, the fingertips still on their stops; an ask without a neck as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HandModel, HandSolve, handAsk, solveHand, hpOf } from '../dist/fingers.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/hands-built.json', import.meta.url), 'utf8'));
const asset = { bones: fx.bones, index: Object.fromEntries(fx.bones.map((b, i) => [b.name, i])), header: { hand: {} } };
const R = HandModel.of(asset, 'R');

// (a neck lying across the hand just out from the palm: its axis toward the thumb, its board facing away from the palm,
// its back 2 mm from the palm's skin — inside the 12 mm of air a player keeps)
const X0 = 0.05, half = 0.021, depth = 0.021, air = 0.012;
const zBoard = 0.013 * R.width / 0.0538 + 0.002 + depth;
function ask(neck, rest = 0) {
  const Q = handAsk();
  for (let f = 0; f < 5; f++) Q.resting[f] = 1;
  for (let f = 1; f <= 4; f++) { const o = hpOf(f); Q.rest.set([0, 0.5, 0.8, 0.5], o); Q.wr.set([1.5, 1, 1, 1], o); }
  Q.rest.set([0.25, 0.1, 0.35, 0.2], 23); Q.wr.set([0.6, 0.6, 0.6, 0.6], 23);
  Q.rest[6] = 0.15; Q.wr[6] = 1; Q.free = 1;
  if (neck) Q.neck = Float64Array.from([X0, 0, zBoard, 0, 1, 0, 0, 0, 1, 1, 0, 0, half, depth, air, 0.009 * R.width / 0.048, 1, rest]);
  return Q;
}
/** the palm's skin points' nearest approach to the neck (m), the hand as solved */
function palmAir(S) {
  const x = S.x, a = Math.hypot(x[3], x[4], x[5]);
  let best = Infinity;
  for (let i = 0; i < R.palmPts.length; i += 3) {
    let p = [R.palmPts[i], R.palmPts[i + 1], R.palmPts[i + 2]];
    if (a > 1e-12) { const k = [x[3] / a, x[4] / a, x[5] / a], c = Math.cos(a), s = Math.sin(a), d = k[0] * p[0] + k[1] * p[1] + k[2] * p[2]; p = [p[0] * c + (k[1] * p[2] - k[2] * p[1]) * s + k[0] * d * (1 - c), p[1] * c + (k[2] * p[0] - k[0] * p[2]) * s + k[1] * d * (1 - c), p[2] * c + (k[0] * p[1] - k[1] * p[0]) * s + k[2] * d * (1 - c)]; }
    p = [p[0] + x[0], p[1] + x[1], p[2] + x[2]];
    // (out of the board along -z here: the back's ellipse, depth under the board)
    const u = p[0] - X0, v = zBoard - p[2];
    if (v < 0) { best = Math.min(best, Math.hypot(Math.max(0, Math.abs(u) - half), v) || -v); continue; }
    const k = Math.hypot(u / half, (p[2] - zBoard) / depth);
    best = Math.min(best, (k - 1) * Math.min(half, depth));
  }
  return best;
}
const settle = (Q, n = 40) => { const S = new HandSolve(); for (let i = 0; i < n; i++) solveHand(R, S, Q, 8); return S; };

test('the palm is pushed off a neck to its air (and stays where it was asked without one)', () => {
  const S0 = settle(ask(false)), S1 = settle(ask(true));
  assert.ok(Math.hypot(S0.x[0], S0.x[1], S0.x[2]) < 1e-6, 'no neck: the palm moved');
  assert.ok(palmAir(S0) < 0.004, `the neck was placed inside the air (${(palmAir(S0) * 1000).toFixed(1)} mm)`);
  const a = palmAir(S1);
  assert.ok(a > air - 0.0025, `the palm only ${(a * 1000).toFixed(1)} mm off the neck`);
});

test('the index\'s base is drawn onto the neck\'s edge when asked', () => {
  const far = ask(true, 0), near = ask(true, 1);
  // (the neck moved off a little first, so the index's knuckle has somewhere to go)
  for (const Q of [far, near]) Q.neck[2] += 0.02;
  const kn = (S) => { const Q = near, P = new Float64Array(12), K = new Float64Array(3), Z = new Float64Array(3); R.fk(S.x, 1, P, null, K, Z); return [P[0] + S.x[0], P[1] + S.x[1], P[2] + S.x[2]]; };
  const d = (S) => { const p = kn(S), u = p[0] - X0, v = p[2] - near.neck[2]; if (v >= 0) return Math.hypot(Math.max(0, Math.abs(u) - half), v); const k = Math.hypot(u / half, v / depth); return Math.max(v, (k - 1) * Math.min(half, depth)); };
  const a = d(settle(far)), b = d(settle(near));
  assert.ok(b < a - 0.002, `the index's knuckle ${(a * 1000).toFixed(1)} -> ${(b * 1000).toFixed(1)} mm from the neck`);
});
