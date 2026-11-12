// One bone over a stretch of an act in both builds, against its fingertip target if it has one:
//   COPIES=<dir> ACT=flute-foot WHO=drake BONE=middle3L T0=1.3 T1=2 STEP=2 node tools/release-ab/probe.mjs
import { pathToFileURL } from 'node:url';
const C = process.env.COPIES; if (!C) throw new Error('COPIES=<dir> (prepare.mjs, build.mjs)');
const OLD = await import(pathToFileURL(C + '/acts-old.mjs').href), NEW = await import(pathToFileURL(C + '/acts-new.mjs').href);
const act = process.env.ACT ?? 'flute-foot', T0 = +(process.env.T0 ?? 1.3), T1 = +(process.env.T1 ?? 2.0), BONE = process.env.BONE ?? 'middle3L', WHO = process.env.WHO ?? 'drake', STEP = +(process.env.STEP ?? 2);
const a = OLD.act(WHO, 'hi', act), b = NEW.act(WHO, 'hi', act);
let k = 0;
for (;;) {
  const [x, y] = await Promise.all([a.next(), b.next()]);
  if (x.done) break;
  const A = x.value, B = y.value;
  if (A.t < T0 || A.t > T1 || k++ % STEP) continue;
  const I = A.rig.asset.index, bi = I[BONE], AB = A.rig.asset.bones, hand = BONE.endsWith('L') ? 'handL' : 'handR';
  const tip = (F) => F.rig.skinPoint(bi, AB[bi].tail), kn = (F) => F.rig.skinPoint(I[BONE.replace('3', '1')], AB[I[BONE.replace('3', '1')]].head);
  const f3 = (v) => v.map((c) => (c * 100).toFixed(1)).join(',');
  const tg = A.tips.find((q) => q.hand === (BONE.endsWith('L') ? 0 : 1) && ['thumb', 'index', 'middle', 'ring', 'pinky'][q.f] === BONE.slice(0, -2));
  const d = (p, q) => (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 1000).toFixed(1);
  console.log(A.t.toFixed(3), A.seg, 'knuckle', f3(kn(A)), 'tip old', f3(tip(A)), 'new', f3(tip(B)), 'apart', d(tip(A), tip(B)), 'mm', tg ? `target ${f3(tg.target)} miss old ${d(tip(A), tg.target)} new ${d(tip(B), tg.target)}` : 'no target');
}
