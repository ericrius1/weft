// The keys path's pianist-only rules (cast 0.6.2's release check: they had leaked to every built hand). A built hand
// WITHOUT HandGoal.prior — World's pointing gesture, plain tips goals, palmFree tips goals, a Pianist without forHand on
// a floor — keeps 0.6.1's numbers exactly: its playing rests, their weight, and the thumb's rests switched at 6 mm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeroRig, keysTipRest, keysTipW, thumbRaised } from '../dist/rig.js';

const K = HeroRig.keysHand;
const V061 = { tipBuilt: [[0.15, 0.55, 0.25], [0.15, 0.55, 0.25], [0.15, 0.55, 0.25], [0.2, 0.55, 0.25]], wTip: 3 };

test('a built hand without the prior keeps 0.6.1 playing rests and weight', () => {
  for (let g = 0; g < 4; g++) assert.deepEqual(keysTipRest(K, true, false, g), V061.tipBuilt[g]);
  assert.equal(keysTipW(K, true, false), V061.wTip);
  assert.equal(keysTipW(K, false, true), V061.wTip, 'a body without a built hand: never the built weight');
});

test('the pianist (built, with the prior) keeps its own', () => {
  assert.notDeepEqual(keysTipRest(K, true, true, 3), V061.tipBuilt[3]);
  assert.equal(keysTipW(K, true, true), K.wTipBuilt);
});

test('the thumb without the prior switches at 6 mm exactly as 0.6.1 (no ease, keyTop ignored)', () => {
  for (const up of [-0.01, 0, 0.003, 0.005, 0.006, 0.0061, 0.009, 0.02]) assert.equal(thumbRaised(false, up, 0.02), up > 0.006 ? 1 : 0);
  // (and the pianist's eased across 3..9 mm by its key's top)
  assert.ok(Math.abs(thumbRaised(true, 0, 0.006) - 0.5) < 1e-9);
  assert.equal(thumbRaised(true, 0.02, 0), 0);
});
