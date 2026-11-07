// FrameBudget (src/budget.ts) paced by the frames, as on an iPhone: a tenth of the frames late steps the scale down,
// five seconds on time steps it back up, but not to the scale that missed (for 45 s); and a frame the CPU made late
// doesn't count. A stand-in kit and clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
register('./wgsl-stub.mjs', import.meta.url);
let now = 0;
globalThis.performance = { now: () => now };
const { FrameBudget } = await import('../dist/src/budget.js');

function run(fb, kit, frames, gapMs, cpuMs = 2) {
  for (let i = 0; i < frames; i++) {
    now += gapMs;
    kit.lastNow = now - cpuMs;
    kit.dt = gapMs / 1000;
    fb.update(kit);
  }
}
const kitAt = (s) => ({ renderScale: s, maxFps: 60, dt: 1 / 60, lastNow: 0, profiler: { available: false, trusted: false } });

test('late frames step it down; on time it comes back, short of the scale that missed', () => {
  const fb = new FrameBudget(28, { min: 0.7, max: 1, byPace: true });
  const kit = kitAt(1);
  run(fb, kit, 1, 16.7);
  run(fb, kit, 45, 30);
  assert.ok(Math.abs(kit.renderScale - 0.92) < 1e-9, `down a step: ${kit.renderScale}`);
  run(fb, kit, 60 * 12, 16.7);
  assert.ok(kit.renderScale < 1 - 1e-9, `not back to the scale that missed: ${kit.renderScale}`);
  now += 50000;
  run(fb, kit, 60 * 12, 16.7);
  assert.ok(Math.abs(kit.renderScale - 1) < 1e-9, `back once the 45 s are up: ${kit.renderScale}`);
});

test("a frame the CPU made late isn't the resolution's", () => {
  const fb = new FrameBudget(28, { min: 0.7, max: 1, byPace: true });
  const kit = kitAt(1);
  run(fb, kit, 1, 16.7);
  run(fb, kit, 90, 30, 25);
  assert.equal(kit.renderScale, 1);
});

test('the least scale held and still late: starved', () => {
  let starved = 0;
  const fb = new FrameBudget(28, { min: 0.7, max: 1, byPace: true });
  fb.starved = () => starved++;
  const kit = kitAt(0.7);
  run(fb, kit, 1, 16.7);
  run(fb, kit, 1500, 33);
  assert.equal(kit.renderScale, 0.7);
  assert.ok(starved >= 1);
});
