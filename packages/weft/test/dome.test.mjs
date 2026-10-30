// The fulldome's tiles (src/domelayout.ts): every direction of the upper hemisphere is seen by at least one tile with
// real weight (no hole in the stitch), the weights fall smoothly to nothing at each tile's edge (no seam), and the dome's
// mapping puts the zenith at its centre, the heading at its bottom and its right on its right. Run with `npm test`
// after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domeLayout, domeDirection, tileWeights, viewBasis } from '../dist/src/domelayout.js';

test('every direction of the upper hemisphere is covered', () => {
  for (const size of [1024, 4096]) for (const heading of [0, 0.7, -2.1]) {
    const L = domeLayout(size);
    let least = Infinity;
    for (let i = 0; i <= 120; i++) for (let j = 0; j <= 120; j++) {
      const d = domeDirection(i / 120, j / 120, heading);
      if (!d) continue;
      least = Math.min(least, tileWeights(L, d, heading).reduce((a, b) => a + b, 0));
    }
    assert.ok(least > 0.2, `${size} at heading ${heading}: a direction with total weight ${least}`);
  }
});

test('the dome is oriented as a domemaster', () => {
  const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
  assert.ok(near(domeDirection(0.5, 0.5, 0), [0, 1, 0]), 'zenith at the centre');
  // (heading 0 looks down -z; its right is +x)
  assert.ok(near(domeDirection(0.5, 1, 0), [0, 0, -1]), 'the heading at the bottom rim');
  assert.ok(near(domeDirection(1, 0.5, 0), [1, 0, 0]), 'its right on the right');
  assert.equal(domeDirection(0.02, 0.02, 0), null, 'nothing outside the circle');
});

test('the tiles match the camera and the dome\'s detail', () => {
  const L = domeLayout(4096);
  const [r, u, f] = viewBasis(0, Math.PI / 2);
  assert.ok(Math.abs(f[1] - 1) < 1e-12 && Math.abs(r[0] - 1) < 1e-12 && Math.abs(u[2] - 1) < 1e-12, 'straight up: right +x, up +z');
  // (pixels per radian at a tile's centre: half its height over the tangent of half its field of view)
  assert.ok(Math.abs(L.tile[1] / 2 / Math.tan(L.fovY / 2) - 4096 / Math.PI) < 0.5);
  const S = domeLayout(4096, { oversample: 1.5 });
  assert.ok(Math.abs(S.tile[0] / L.tile[0] - 1.5) < 0.01);
});
