// The articulation helpers and the maths under them, on the built package (npm test -w @ericrius1/cast)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notesAt, splitHands, fingersFor, stringFor, stopAt, Bow, SprungFingers, FLUTE_FINGERS, reachFinger3, travel, beatGroove } from '../dist/perform.js';
import { hermite5 } from '../dist/track.js';
import { rotateAxis, cdSpring } from '../dist/math.js';

const DT = 1 / 60;
const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

test('notesAt: sounding, latest, the note before and the next (a chord: its top)', () => {
  const evs = [{ t: 0, dur: 0.5, note: 60, vel: 0.8 }, { t: 0.5, dur: 0.2, note: 64, vel: 0.6 }, { t: 0.5, dur: 0.2, note: 67, vel: 0.6 }, { t: 1, dur: 1, note: 72, vel: 1 }];
  const N = notesAt(evs, 0.6);
  assert.deepEqual(N.active.map((e) => e.note), [64, 67]);
  assert.equal(N.prev.note, 67);
  assert.equal(N.next.note, 72);
});

test('splitHands and fingersFor', () => {
  assert.deepEqual(splitHands([76, 48, 52, 55, 72]), [[48, 52, 55], [72, 76]]);
  assert.deepEqual(splitHands([60, 62, 64]), [[60, 62, 64], []]);
  assert.deepEqual(fingersFor([72, 76], 1), [72, null, 76, null]);
  assert.deepEqual(fingersFor([48, 52, 55], -1), [55, 52, null, 48]);
});

test('strings: the string, the stop', () => {
  assert.deepEqual(stringFor(81, [55, 62, 69, 76]), { str: 3, semi: 5, note: 81 });
  assert.deepEqual(stringFor(40, [55, 62, 69, 76]), { str: 1, semi: 2, note: 64 });
  close(stopAt(12), 0.5);
});

test('the bow stays on its hair', () => {
  const b = new Bow();
  const evs = [{ t: 0, dur: 0.6, note: 69, vel: 1 }, { t: 0.6, dur: 0.6, note: 71, vel: 1 }, { t: 1.2, dur: 0.6, note: 72, vel: 1 }];
  for (let k = 0; k < 120; k++) { const now = k * DT; b.update(DT, now, notesAt(evs, now).last, true); assert.ok(b.u >= b.u0 - 0.02 && b.u <= b.u1 + 0.02); }
});

test('sprung fingers: a press lands, a lift hovers, both settle', () => {
  const f = new SprungFingers(FLUTE_FINGERS);
  for (let k = 0; k < 90; k++) f.update([1, 1, 1, 0, 0, 0], DT);
  assert.ok(f.lift[0] < 0 && f.lift[0] >= -0.0018);
  assert.ok(f.lift[4] > 0.008);
  assert.ok(f.vel.every((v) => Math.abs(v) < 0.05));
});

test('reachFinger3 lands a three-joint finger on a point it can reach', () => {
  const tip = (x) => {
    const l = [0.045, 0.028, 0.022], ang = [x[0], x[1], x[1] * 0.8];
    let a = 0, p = [0, 0, 0];
    for (let i = 0; i < 3; i++) { a += ang[i]; p = [p[0] + Math.cos(a) * l[i] * Math.cos(x[2]), p[1] - Math.sin(a) * l[i], p[2] + Math.cos(a) * l[i] * Math.sin(x[2])]; }
    return p;
  };
  const x = [0.3, 0.4, 0];
  assert.ok(reachFinger3(tip, [0.06, -0.04, 0.005], x) < 0.002);
});

test('travel arcs back between notes and lands on time', () => {
  const mid = travel([0, 0, 0], [0.1, 0, 0], 0, 0.5, 0.25, [0, 0, 1]);
  close(mid.at[0], 0.05, 1e-12);
  assert.ok(mid.at[2] > 0.1);
  const end = travel([0, 0, 0], [0.1, 0, 0], 0, 0.5, 0.5, [0, 0, 1]);
  close(end.at[0], 0.1, 1e-12); close(end.at[2], 0, 1e-12);
});

test('beatGroove is the rig\'s Groove', () => {
  const g = beatGroove(2, 1);
  for (const k of ['bounce', 'sway', 'twist', 'rock', 'roll', 'nod', 'tilt']) assert.ok(Number.isFinite(g[k]));
  assert.ok(g.nod > 0);
});

test('maths: hermite5 ends, rotateAxis, cdSpring', () => {
  close(hermite5(0, 0, 0, 1, 0, 0, 1, 0)[0], 0); close(hermite5(0, 0, 0, 1, 0, 0, 1, 1)[0], 1);
  const r = rotateAxis([1, 0, 0], [0, 1, 0], Math.PI / 2);
  close(r[0], 0, 1e-12); close(r[2], -1, 1e-12);
  let x = 0, v = 0;
  for (let k = 0; k < 600; k++) [x, v] = cdSpring(x, v, 1, 10, DT);
  close(x, 1, 1e-6);
});
