import { pathToFileURL } from 'node:url';
const C = process.env.COPIES; if (!C) throw new Error('COPIES=<dir> (prepare.mjs, build.mjs)');
const OLD = await import(pathToFileURL(C + '/acts-old.mjs').href), NEW = await import(pathToFileURL(C + '/acts-new.mjs').href);
const FN = ['thumb', 'index', 'middle', 'ring', 'pinky'];
for (const act of ['flute-foot', 'flute-ride']) for (const [name, M] of [['old', OLD], ['new', NEW]]) {
  const acc = {};
  for await (const F of M.act(process.env.WHO ?? 'drake', 'hi', act)) {
    if (!/playing/.test(F.seg) || F.t < 3) continue;
    for (const q of F.tips) (acc[`${'LR'[q.hand]}-${FN[q.f]}`] ??= []).push(Math.hypot(...q.at.map((v, i) => v - q.target[i])) * 1000);
  }
  const s = (v) => { v.sort((a, b) => a - b); return `${v[v.length >> 1].toFixed(1)}/${v[Math.floor(v.length * 0.95)].toFixed(1)}/${v[v.length - 1].toFixed(1)}`; };
  console.log(act, name, 'med/p95/max mm:', Object.entries(acc).map(([k, v]) => `${k} ${s(v)}`).join('  '));
}
