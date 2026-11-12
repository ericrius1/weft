// Both builds through the same acts in lockstep: every bone's matrix every frame, compared. Per act and character: the
// largest translation difference (m) and the largest rotation-part difference, split into the hands' finger bones and
// everything else, the frames where it happened; and the fingertips against their targets, before and after.
import { pathToFileURL } from 'node:url';
const C = process.env.COPIES; if (!C) throw new Error('COPIES=<dir> (prepare.mjs, build.mjs)');
const OLD = await import(pathToFileURL(C + '/acts-old.mjs').href), NEW = await import(pathToFileURL(C + '/acts-new.mjs').href);

const WHO = (process.env.WHO ?? 'drake,marley,katara,aang,iroh,kvothe,andrew,yashua,lyra').split(',');
const LODS = (process.env.LODS ?? 'hi,lo').split(',');
const ACTS = (process.env.ACTS ?? OLD.ACTS.join(',')).split(',');
const FINGER = /^(thumb|index|middle|ring|pinky)[123][LR]$/;
const rows = [];
for (const act of ACTS) for (const who of WHO) for (const lod of LODS) {
  if (who === 'lyra' && lod === 'lo') continue;
  const a = OLD.act(who, lod, act), b = NEW.act(who, lod, act);
  const st = { body: { t: 0, r: 0, at: null, bone: '' }, fing: { t: 0, r: 0, at: null, bone: '' }, frames: 0, tips: { old: [], new: [] }, segs: {} };
  let names = null;
  for (;;) {
    const [x, y] = await Promise.all([a.next(), b.next()]);
    if (x.done || y.done) { if (x.done !== y.done) throw new Error('acts out of step'); break; }
    const A = x.value, B = y.value;
    if (A.seg !== B.seg) st.segs[A.t.toFixed(2)] = `${A.seg}/${B.seg}`;
    names ??= A.rig.asset.bones.map((q) => q.name);
    st.frames++;
    const segK = A.seg;
    st.bySeg ??= {};
    const sg = (st.bySeg[segK] ??= { t: 0, r: 0, ft: 0 });
    // (each bone's head and tail as posed, m; and the matrices' rotation part)
    const AB = A.rig.asset.bones;
    for (let i = 0; i < A.n; i++) {
      let dt = 0, dr = 0;
      for (const end of ['head', 'tail']) {
        const p = A.rig.skinPoint(i, AB[i][end]), q = B.rig.skinPoint(i, AB[i][end]);
        dt = Math.max(dt, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
      }
      for (let k = 0; k < 11; k++) if (k % 4 !== 3) dr = Math.max(dr, Math.abs(A.bones[i * 16 + k] - B.bones[i * 16 + k]));
      const isF = FINGER.test(names[i]);
      const S = isF ? st.fing : st.body;
      if (dt > S.t) { S.t = dt; S.at = A.t; S.bone = names[i]; }
      if (dr > S.r) S.r = dr;
      if (isF) sg.ft = Math.max(sg.ft, dt); else { sg.t = Math.max(sg.t, dt); sg.r = Math.max(sg.r, dr); }
    }
    // (fingertips with targets, both builds' targets the same within float rounding?)
    if (A.tips.length || B.tips.length) {
      const miss = (T) => T.map((q) => Math.hypot(q.at[0] - q.target[0], q.at[1] - q.target[1], q.at[2] - q.target[2]));
      st.tips.old.push(...miss(A.tips).map((m, i) => ({ m, seg: A.seg, f: A.tips[i].f, h: A.tips[i].hand })));
      st.tips.new.push(...miss(B.tips).map((m, i) => ({ m, seg: B.seg, f: B.tips[i].f, h: B.tips[i].hand })));
    }
  }
  const pct = (v, p) => { if (!v.length) return NaN; const s = [...v].sort((p, q) => p - q); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const playing = (T) => T.filter((q) => /playing/.test(q.seg)).map((q) => q.m);
  const row = { act, who, lod, frames: st.frames, body: st.body, fing: st.fing, bySeg: st.bySeg,
    tipsN: st.tips.old.length,
    oldMed: pct(playing(st.tips.old), 0.5), oldP95: pct(playing(st.tips.old), 0.95), newMed: pct(playing(st.tips.new), 0.5), newP95: pct(playing(st.tips.new), 0.95),
    segMismatch: Object.keys(st.segs).length };
  rows.push(row);
  const f = (v) => (v === 0 ? '0' : v.toExponential(1));
  console.log(`${act.padEnd(10)} ${who.padEnd(7)} ${lod} frames ${st.frames}  body dT ${f(st.body.t)} m (${st.body.bone} @${st.body.at?.toFixed(2)}s) dR ${f(st.body.r)}  fingers dT ${f(st.fing.t)} m (${st.fing.bone} @${st.fing.at?.toFixed(2)}s)` +
    (row.tipsN ? `  tips playing: old med ${(row.oldMed * 1000).toFixed(1)} p95 ${(row.oldP95 * 1000).toFixed(1)} mm, new med ${(row.newMed * 1000).toFixed(1)} p95 ${(row.newP95 * 1000).toFixed(1)} mm` : '') + (row.segMismatch ? ` SEG-MISMATCH ${row.segMismatch}` : ''));
  console.log('    by segment (body dT / dR, fingers dT): ' + Object.entries(st.bySeg).map(([k, v]) => `${k} ${f(v.t)}/${f(v.r)}/${f(v.ft)}`).join('  '));
}
import { writeFileSync } from 'node:fs';
writeFileSync(C + '/ab-result.json', JSON.stringify(rows, null, 1));
