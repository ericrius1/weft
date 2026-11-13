// Grasps (grasp.ts), on the built package, with a built body's bind hands (test/fixtures/hands-built.json: the
// MakeHuman hand): every kind holds its shape — no fingertip inside it, the pads that should touch it touching, the thumb
// across from the fingers where a grasp opposes, every joint in its range; the left hand's grasp the right's; a grasp
// placed in the world puts its shape where it was asked; what a solve costs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HandModel, hpOf, HAND_N } from '../dist/fingers.js';
import { grasp, graspGoal, heldWorld, heldSd, GRASPS, BOWREST, bowReachScale, BOW_REACH_EASE } from '../dist/grasp.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/hands-built.json', import.meta.url), 'utf8'));
const asset = { bones: fx.bones, index: Object.fromEntries(fx.bones.map((b, i) => [b.name, i])) };
const R = HandModel.of(asset, 'R'), L = HandModel.of(asset, 'L');
const mm = (v) => +(v * 1000).toFixed(1);
const SIZES = { wrap: [{ r: 0.026 }, { r: 0.032 }, { r: 0.043 }], power: [{ r: 0.014 }, { r: 0.018 }], stick: [{}], bow: [{}], pinch: [{}], tripod: [{}], stem: [{}], flat: [{}], rim: [{}], clasp: [{}], cloth: [{}] };
/** the pads (fingers, then thumb) that may sit off what they should touch, mm: the little and ring fingers round a wide
 *  glass reach less far than they're asked (the solve keeps them in their comfortable range), a clasp's index rides on
 *  the other hand's knuckles */
const SLACK = { wrap: [1.5, 2, 2, 3, 4], clasp: [1.5, 5, 3, 2, 2], rim: [2, 2.5, 2.5, 3, 3],
  // (a drumstick on its fulcrum: held between the thumb's pad and the side of the index's middle joint, the index's pad
  // and the back fingers loose round it — a drummer's back fingers leave the stick room to rebound (Checkpoint I))
  stick: [1.5, 4.5, 4, 4.5, 5] };
const PAD_TIP = [0.0075, 0.0062, 0.0065, 0.0062, 0.0054];

function tips(M, x) {
  const P = new Float64Array(12), K = new Float64Array(3), Z = new Float64Array(3), out = [];
  for (let f = 0; f < 5; f++) { M.fk(x, f, P, null, K, Z); out.push([P[9], P[10], P[11]]); }
  return out;
}

test('every grasp holds its shape: no fingertip inside, the pads that should touch touching, joints in range', () => {
  const sc = R.width / 0.0538, bad = [];
  const ok = (c, m) => { if (!c) bad.push(m); };
  for (const kind of GRASPS) for (const size of SIZES[kind]) {
    const g = grasp(R, kind, size);
    const name = `${kind} ${JSON.stringify(size)}`;
    // (a fingertip's skin never inside the thing: its pad's thickness off the surface, less a millimetre)
    tips(R, g.x).forEach((t, f) => {
      const s = heldSd(g.held, t) - PAD_TIP[f] * 0.85 * sc;
      ok(s > -0.0015, `${name}: finger ${f}'s tip ${mm(-s)} mm inside`);
    });
    // (the whole hand's skin samples: within a few millimetres — a pad pressed is a pad squashed)
    ok(g.into < 0.008, `${name}: skin ${mm(g.into)} mm into the shape`);
    ok(g.palmInto < 0.001, `${name}: a finger ${mm(g.palmInto)} mm into the palm`);
    const slack = SLACK[kind] ?? [2, 2.5, 2.5, 2.5, 2.5];
    g.miss.forEach((m, f) => ok(m * 1000 <= slack[f], `${name}: finger ${f}'s pads ${mm(m)} mm off what they hold (allowed ${slack[f]})`));
    for (let i = 6; i < HAND_N; i++) ok(g.x[i] >= R.lo[i] - 1e-9 && g.x[i] <= R.hi[i] + 1e-9, `${name}: number ${i} ${g.x[i].toFixed(3)} outside [${R.lo[i]}, ${R.hi[i]}]`);
  }
  assert.deepEqual(bad, []);
});

test('the thumb opposes the fingers round a glass, a handle, a stick, a pen, another hand', () => {
  for (const [kind, size] of [['wrap', { r: 0.032 }], ['power', { r: 0.016 }], ['stick', {}], ['clasp', {}]]) {
    const g = grasp(R, kind, size);
    // (measured at the thumb's end bone since checkpoint G: a clasp's thumb lies over the other hand's back, its tip only
    // a little past a right angle round from the fingers)
    // (and a drumstick's thumb lies flat along the stick's side, pressing it into the index: past a right angle round
    // from the fingers, not across from them as round a hammer — Checkpoint I)
    assert.ok(g.opp < (kind === 'clasp' || kind === 'stick' ? -0.05 : -0.5), `${kind}: the thumb's pad only ${(Math.acos(Math.max(-1, Math.min(1, g.opp))) * 180 / Math.PI).toFixed(0)}° round from the fingers'`);
  }
  // (a pen: the thumb's pad and the index's on different sides of it, more than a right angle apart round it)
  {
    const g = grasp(R, 'tripod'), t = tips(R, g.x), A = g.held.a;
    const round = (p) => { const d = [p[0] - g.held.c[0], p[1] - g.held.c[1], p[2] - g.held.c[2]], k = d[0] * A[0] + d[1] * A[1] + d[2] * A[2]; const v = [d[0] - A[0] * k, d[1] - A[1] * k, d[2] - A[2] * k], l = Math.hypot(...v); return v.map((c) => c / l); };
    const u = round(t[0]), v = round(t[1]), c = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    assert.ok(c < 0, `tripod: thumb and index only ${(Math.acos(c) * 180 / Math.PI).toFixed(0)}° apart round the pen`);
  }
  // (a pick: the thumb's pad and the index's side press it from its two faces)
  const p = grasp(R, 'pinch');
  const t = tips(R, p.x), a = p.held.a;
  const side = (q) => (q[0] - p.held.c[0]) * a[0] + (q[1] - p.held.c[1]) * a[1] + (q[2] - p.held.c[2]) * a[2];
  assert.ok(side(t[0]) > 0, 'pinch: the thumb on the far face');
});

test('a wider glass opens the hand: the fingers bend less round a pint than round a slim glass', () => {
  const bend = (g) => [1, 2, 3, 4].reduce((s, f) => s + g.x[hpOf(f) + 1] + g.x[hpOf(f) + 2] + g.x[hpOf(f) + 3], 0);
  const slim = grasp(R, 'wrap', { r: 0.026 }), pint = grasp(R, 'wrap', { r: 0.043 }), handle = grasp(R, 'power', { r: 0.014 });
  assert.ok(bend(handle) > bend(slim) && bend(slim) > bend(pint), `bends: handle ${bend(handle).toFixed(2)}, slim ${bend(slim).toFixed(2)}, pint ${bend(pint).toFixed(2)}`);
});

test("the bow's hold reaches its rests from real holds, no skin in the stick (Checkpoint T)", () => {
  // (0.6.1's grasp stopped at knuckles 21/43/44/20 deg where 13/41/58/66 were asked: the stick, placed from the middle
  // finger alone at a fixed slant, ran out of the ring and little fingers' reach. Now placed where fitted photographs of
  // real holds put it, with the rests from the same fits: every joint within 13 deg of its rest)
  for (const size of [{}, { r: 0.0045, len: 0.75 }]) {
    const g = grasp(R, 'bow', size), deg = (v) => (v * 180) / Math.PI;
    for (let f = 1; f <= 4; f++) for (let j = 0; j < 3; j++) {
      const d = deg(g.x[hpOf(f) + 1 + j] - BOWREST[f - 1][j]);
      assert.ok(Math.abs(d) < 13, `finger ${f} joint ${j}: ${d.toFixed(0)} deg from its rest`);
    }
    assert.ok(g.into < 5e-5, `skin ${mm(g.into)} mm into the stick`);
    assert.ok(g.miss.every((m) => m < 0.0012), `touches ${g.miss.map(mm)}`);
  }
});

test("the left hand's grasp is the right's", () => {
  for (const kind of ['wrap', 'bow', 'pinch']) {
    const gr = grasp(R, kind), gl = grasp(L, kind);
    let d = 0;
    for (let i = 6; i < HAND_N; i++) d = Math.max(d, Math.abs(gr.x[i] - gl.x[i]));
    assert.ok(d < 0.02, `${kind}: left and right differ by ${d.toFixed(4)} rad`);
  }
});

test('placed in the world: the shape where it was asked, the wrist nearest the point asked, both hands', () => {
  const at = [0.2, 1.1, -0.3], axis = [0, 1, 0], near = [0.25, 0.95, -0.1];
  for (const [M, side] of [[R, 'R'], [L, 'L']]) {
    const g = grasp(M, 'wrap', { r: 0.032 });
    const goal = graspGoal(M, g, side, 0.178, { at, axis, near });
    const H = heldWorld(g, goal, side, 0.178);
    const d = Math.hypot(H.c[0] - at[0], H.c[1] - at[1], H.c[2] - at[2]), dot = H.a[0] * axis[0] + H.a[1] * axis[1] + H.a[2] * axis[2];
    assert.ok(d < 1e-9 && dot > 1 - 1e-9, `${side}: shape ${mm(d)} mm off, axis ${dot}`);
    assert.ok(goal.exact && goal.pose === g.x, `${side}: held exactly, its fingers posed`);
    // (the palm faces the glass)
    const toC = [at[0] - goal.palm[0], at[1] - goal.palm[1], at[2] - goal.palm[2]];
    assert.ok(toC[0] * goal.down[0] + toC[1] * goal.down[1] + toC[2] * goal.down[2] > 0, `${side}: the palm faces away from the glass`);
  }
});

test('what a grasp costs: solved once per thing held (not per frame)', () => {
  const t0 = performance.now();
  let n = 0;
  for (const kind of GRASPS) { grasp(R, kind); n++; }
  const ms = (performance.now() - t0) / n;
  console.log(`  a grasp's solve: ${ms.toFixed(1)} ms on average over ${n} kinds`);
  assert.ok(ms < 100, `${ms.toFixed(1)} ms a grasp`);
});

test("the bow's stick eased in for a short hand only, with no step (0.6.3 release check)", () => {
  // (0.6.3's first try moved any hand 3 % off either way: a long-fingered hand's hold went further from its rests, and a
  // 0.1 % change in proportion at 0.97 jumped the index 20 deg)
  for (const rr of [1, 1.01, 1.03, 1.052, 1.2, BOW_REACH_EASE[0], 0.99]) assert.equal(bowReachScale(rr), 1, `rr ${rr}`);
  let prev = bowReachScale(1);
  for (let rr = 1.0; rr >= 0.84; rr -= 0.0005) {
    const s = bowReachScale(rr);
    assert.ok(s <= prev + 1e-12, `never larger for a shorter hand (rr ${rr.toFixed(4)})`);
    assert.ok(prev - s < 0.0012, `no step: ${rr.toFixed(4)} moves ${(prev - s).toFixed(5)}`);
    prev = s;
  }
  assert.ok(Math.abs(bowReachScale(0.969) - bowReachScale(0.971)) < 0.002);
  assert.ok(Math.abs(bowReachScale(0.93) - (1 + (0.93 - 1) * 0.6)) < 1e-12, 'all of it past the band (Iroh 0.93)');
  assert.ok(!Number.isNaN(bowReachScale(NaN)) && bowReachScale(NaN) === 1);
});
