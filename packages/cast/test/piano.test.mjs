// The pianist on a score's clock, on the built package (npm test -w @ericrius1/cast): every note a hand and a finger,
// a repeated key let up and struck again, each finger landing on its note's second, the pose the clock's alone; and
// the old way (on the frames' dt) no longer hanging without a pedal callback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pianist, pianoPlayable } from '../dist/piano.js';

// a keyboard along x, the player toward +z, keys' tops at y 0.74: white keys 23.5 mm apart from middle C at x 0
const W = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];
const xOf = (n) => (Math.floor(n / 12) - 5) * 7 * 0.0235 + W[n % 12] * 0.0235;
const piano = () => pianoPlayable({
  axes: { along: [1, 0, 0], toward: [0, 0, 1], up: [0, 1, 0] }, facing: [0, 0, -1],
  seat: [0, 0.49, 0.6], keyboard: [0, 0.74, 0], pedalTop: [0, 0.07, -0.1], look: [0, 0.98, -0.2],
  touch: (n) => (n >= 36 && n <= 96 ? [xOf(n), 0.74, -0.035] : null),
}, { state: new Float32Array(88), pedalState: { sustain: false } });

const beat = 60 / 124;
/** two bars of a left hand's dyads struck again on each beat and a right hand's line with a repeated note */
function score() {
  const notes = [];
  for (let b = 0; b < 8; b++) for (const n of b < 4 ? [54, 57] : [50, 54]) notes.push({ note: n, t0: 1 + b * beat, t1: 1 + b * beat + beat * 0.9, vel: 0.7 });
  const line = [69, 71, 74, 74, 73, 71, 69, 69];
  line.forEach((n, i) => notes.push({ note: n, t0: 1 + i * beat + 0.002, t1: 1 + (i + 1) * beat, vel: 0.8 }));
  notes.sort((a, b) => a.t0 - b.t0);
  return { notes, pedal: [{ t: 1, down: true }, { t: 3, down: false }], duration: 6 };
}
function seated(clock) {
  const P = new Pianist(), I = piano();
  P.sit(I, I.stand, I.seat.yaw);
  for (let i = 0; i < 120; i++) P.update(1 / 60, 0);
  P.playScore(score(), { clock });
  return { P, I };
}
/** a finger's tip goal's height over its key's top, at second s */
function tipOver(P, I, st, s, setS) {
  setS(s);
  P.update(1 / 60, 0);
  const t = P.planned[st.hand][st.finger];
  return t[1] - I.notePoint(st.note)[1];
}

test('on a clock: every scored note a hand and a finger, none simplified, no finger given two at once', () => {
  let s = 0;
  const { P } = seated(() => s);
  assert.equal(P.struck.length, score().notes.length);
  assert.deepEqual(P.simplified, []);
  for (const a of P.struck) for (const b of P.struck) if (a !== b && a.hand === b.hand && a.finger === b.finger) assert.ok(!(b.t0 >= a.t0 && b.t0 < a.up), `${a.note}@${a.t0} / ${b.note}@${b.t0}`);
  assert.ok(P.struck.filter((x) => x.note < 60).every((x) => x.hand === 0) && P.struck.filter((x) => x.note >= 60).every((x) => x.hand === 1));
});

test('each finger lands on its note\'s second: over the key a frame before, on it at the second', () => {
  let s = 0;
  const { P, I } = seated(() => s);
  for (const st of P.struck) {
    const before = tipOver(P, I, st, st.t0 - 1 / 60, (x) => { s = x; });
    const at = tipOver(P, I, st, st.t0, (x) => { s = x; });
    // (the tip's joint is the pad's 4 mm over where it touches)
    assert.ok(before > 0.0055, `${st.note}@${st.t0.toFixed(3)} already down a frame early (${before})`);
    // (on it at its second, its pad on the key and into its travel: a stroke lands a few ms ahead of the second, as a
    // rig's fingertip follows its goal about a frame behind)
    assert.ok(at <= 0.004 + 1e-9 && at > 0.004 - I.pressDepth - 1e-9, `${st.note}@${st.t0.toFixed(3)} not on its key at its second (${at})`);
  }
});

test('a repeated key is let up and struck again', () => {
  let s = 0;
  const { P, I } = seated(() => s);
  const rep = P.struck.filter((a) => P.struck.some((b) => b !== a && b.note === a.note && b.hand === a.hand && b.t0 > a.t0 && b.t0 - a.t1 < 0.1));
  assert.ok(rep.length >= 6);
  for (const a of rep) {
    const b = P.struck.filter((x) => x.note === a.note && x.t0 > a.t0).sort((x, y) => x.t0 - y.t0)[0];
    // (between them, up off the key by more than its travel)
    let high = -1;
    for (let t = a.t0; t < b.t0; t += 0.005) high = Math.max(high, tipOver(P, I, b.finger === a.finger ? a : b, t, (x) => { s = x; }));
    assert.ok(high > 0.01, `${a.note}@${a.t0.toFixed(3)} never let up before ${b.t0.toFixed(3)} (${high})`);
  }
});

test('the pose is the clock\'s second alone, whatever frames came before', () => {
  const pose = (path) => { let s = 0; const { P } = seated(() => s); let g; for (const x of path) { s = x; g = P.update(1 / 60, 0); } return JSON.stringify(g.hands.map((h) => h.tips)); };
  assert.equal(pose([2, 2.5, 3.1]), pose([0.5, 1.7, 3.1]));
});

test('on the frames\' dt with no pedal callback, a score with pedalling plays to its end', () => {
  const P = new Pianist(), I = piano();
  P.sit(I, I.stand, I.seat.yaw);
  P.playScore(score());
  for (let i = 0; i < 60 * 8; i++) P.update(1 / 60, 0);
  assert.equal(P.playingScore, false);
});

test('on a clock, stopScore() takes the hands off it: the clock no longer read, nothing left to strike', () => {
  let s = 1.5, reads = 0;
  const { P } = seated(() => { reads++; return s; });
  P.update(1 / 60, 0);
  assert.ok(reads > 0);
  P.stopScore();
  reads = 0;
  for (let i = 0; i < 30; i++) { s += 1 / 60; P.update(1 / 60, 0); }
  assert.equal(reads, 0);
  assert.equal(P.struck.length, 0);
  assert.equal(P.playingScore, false);
});

test('a clocked piece\'s resting hands: let go by live notes, a new seat or getting up (0.6.2 release check)', () => {
  let s = 0;
  const { P, I } = seated(() => s);
  s = 7; P.update(1 / 60, 0);
  P.stopScore();
  assert.ok(P.after !== null, 'resting after the piece');
  // (a live key: the live plan takes the hands and keeps them once it is let go)
  const k = 69 - I.low;
  I.state[k] = 1; P.update(1 / 60, 0);
  assert.equal(P.after, null, 'live notes let the piece go');
  I.state[k] = 0; P.update(1 / 60, 0);
  assert.equal(P.after, null, 'and it does not come back when they end');
  // (a new seat starts from the live plan)
  const b = seated(() => s);
  b.P.update(1 / 60, 0); s = 7; b.P.update(1 / 60, 0); b.P.stopScore();
  assert.ok(b.P.after !== null);
  b.P.sit(b.I, b.I.stand, b.I.seat.yaw);
  assert.equal(b.P.after, null);
});

test('stopScore on a long piece: no spread of every note into one call (0.6.2 release check)', () => {
  let s = 0;
  const { P } = seated(() => s);
  s = 2; P.update(1 / 60, 0);
  const last = Math.max(...P.struck.map((x) => x.up));
  for (let i = 0; i < 300000; i++) P.struck.push({ ...P.struck[0], up: 1 + (i % 1000) * 1e-4 });
  assert.doesNotThrow(() => P.stopScore());
  assert.ok(P.after > last, `rests after the last let-go (${P.after})`);
});
