// CPU per body per frame, old against new: N bodies stepped together through an act (Drake's Rider and Flute and the
// rig: everything a frame of a body costs Drake on the CPU), each frame's time split by what the bodies are doing.
// Rounds alternate the builds so drift in the machine's load falls on both; the spread of the rounds is the noise.
import { pathToFileURL } from 'node:url';
const C = process.env.COPIES; if (!C) throw new Error('COPIES=<dir> (prepare.mjs, build.mjs)');
const OLD = await import(pathToFileURL(C + '/acts-old.mjs').href), NEW = await import(pathToFileURL(C + '/acts-new.mjs').href);
const B = { old: OLD, new: NEW };
const NS = (process.env.NS ?? '1,4,12').split(',').map(Number), ROUNDS = +(process.env.ROUNDS ?? 3), WHO = process.env.WHO ?? 'drake';
const WANT = { foot: ['walk', 'run', 'stand'], ride: ['calm'], 'flute-ride': ['playing', 'carried'] };
const res = {};
async function round(which, act, n) {
  const gens = [];
  for (let i = 0; i < n; i++) gens.push(B[which].act(WHO, 'hi', act));
  const acc = {};
  let fr = 0;
  for (;;) {
    const t0 = process.hrtime.bigint();
    let seg = null, done = false;
    for (const g of gens) { const x = await g.next(); if (x.done) { done = true; break; } seg = x.value.seg; }
    const us = Number(process.hrtime.bigint() - t0) / 1000;
    if (done) break;
    // (the first second of every act is load and settle: not counted)
    if (fr++ < 60 || !WANT[act].includes(seg)) continue;
    (acc[seg] ??= []).push(us / n);
  }
  return acc;
}
const med = (v) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
for (const n of NS) for (const act of Object.keys(WANT)) for (let r = 0; r < ROUNDS; r++) for (const which of r % 2 ? ['new', 'old'] : ['old', 'new']) {
  const acc = await round(which, act, n);
  for (const [seg, v] of Object.entries(acc)) ((res[`${n}|${seg}`] ??= { old: [], new: [] })[which]).push(med(v));
}
console.log('bodies | doing   | old us/body/frame (median of rounds, min-max)  | new                     | new/old');
for (const [k, v] of Object.entries(res)) {
  const [n, seg] = k.split('|');
  const f = (a) => `${med(a).toFixed(0)} (${Math.min(...a).toFixed(0)}-${Math.max(...a).toFixed(0)})`;
  console.log(`${n.padStart(6)} | ${seg.padEnd(7)} | ${f(v.old).padEnd(46)} | ${f(v.new).padEnd(23)} | ${(med(v.new) / med(v.old)).toFixed(3)}`);
}
