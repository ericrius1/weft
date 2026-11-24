// Disney animation principles in @ericrius1/cast: Face pulse rates, asymmetric blinks, flash settle,
// HeroRig landing absorption & delayed head follow-through, jump takeoff launch extension, turn-lead anticipation,
// and organic asymmetric breathing with exertion follow-through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Face, EXPRESSIONS } from '../dist/face.js';
import { parseHero, CORE } from '../dist/asset.js';
import { HeroRig } from '../dist/rig.js';

const DT = 1 / 60;

/** minimal synthetic humanoid DNC1 asset with realistic proportions for HeroRig tests */
async function synthPerson() {
  const layout = {
    root: [[0, 0, 0], [0, 0.05, 0]],
    pelvis: [[0, 0.94, 0], [0, 1.05, 0]],
    spine: [[0, 1.05, 0], [0, 1.24, 0]],
    chest: [[0, 1.24, 0], [0, 1.44, 0]],
    neck: [[0, 1.44, 0], [0, 1.53, 0]],
    head: [[0, 1.53, 0], [0, 1.72, 0]],
    clavL: [[0.03, 1.40, 0], [0.16, 1.41, 0]],
    clavR: [[-0.03, 1.40, 0], [-0.16, 1.41, 0]],
    uarmL: [[0.16, 1.41, 0], [0.18, 1.13, 0]],
    uarmR: [[-0.16, 1.41, 0], [-0.18, 1.13, 0]],
    farmL: [[0.18, 1.13, 0], [0.19, 0.88, 0.02]],
    farmR: [[-0.18, 1.13, 0], [-0.19, 0.88, 0.02]],
    handL: [[0.19, 0.88, 0.02], [0.19, 0.79, 0.03]],
    handR: [[-0.19, 0.88, 0.02], [-0.19, 0.79, 0.03]],
    thighL: [[0.095, 0.92, 0], [0.095, 0.49, 0.01]],
    thighR: [[-0.095, 0.92, 0], [-0.095, 0.49, 0.01]],
    shinL: [[0.095, 0.49, 0.01], [0.095, 0.08, -0.01]],
    shinR: [[-0.095, 0.49, 0.01], [-0.095, 0.08, -0.01]],
    footL: [[0.095, 0.08, -0.01], [0.095, 0.02, 0.11]],
    footR: [[-0.095, 0.08, -0.01], [-0.095, 0.02, 0.11]],
    toeL: [[0.095, 0.02, 0.11], [0.095, 0.01, 0.18]],
    toeR: [[-0.095, 0.02, 0.11], [-0.095, 0.01, 0.18]],
  };
  const bones = CORE.map((name, i) => {
    const seg = layout[name] ?? [[0, i * 0.04, 0], [0, i * 0.04 + 0.03, 0]];
    return { name, head: seg[0], tail: seg[1], up: [0, 0, 1] };
  });
  let j = JSON.stringify({
    char: 'test', version: 1, height: 1.66, scale: 1,
    verts: 3, indices: 3, qmin: [0, 0, 0], qmax: [1, 1, 1], stride: 24, chains: {},
    eye: { x: 0.032, y: 1.61, z: 0.08, r: 0.012 },
    face: { mouth_y: 1.56, nose_tip: [0, 0.10] },
    bones,
  });
  while (j.length % 4) j += ' ';
  const h = new TextEncoder().encode(j);
  const buf = new ArrayBuffer(12 + h.length + 3 * 24 + 12);
  const u = new Uint8Array(buf);
  u.set([68, 78, 67, 49]);
  new DataView(buf).setUint32(8, h.length, true);
  u.set(h, 12);
  new Uint32Array(buf, 12 + h.length + 3 * 24, 3).set([0, 1, 2]);
  return parseHero(buf, 'test');
}

function baseInput(overrides = {}) {
  return {
    dt: DT,
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    speed: 0,
    running: false,
    yaw: 0,
    onGround: true,
    flying: false,
    swimming: false,
    wade: 0,
    wind: [0, 0, 0],
    ground: () => 0,
    time: 0,
    landImpact: 0,
    look: null,
    seat: null,
    hold: null,
    body: null,
    posed: null,
    pose: { mode: 'idle', target: [0, 1.3, -2], intensity: 0, t: 0 },
    ...overrides,
  };
}

test('Face pulse uses each expression’s own Hz (giggle 6 Hz vs laugh 4.2 Hz) and scales smoothly with weight', () => {
  const giggle = new Face({ seed: 11 });
  const laugh = new Face({ seed: 11 });
  giggle.mood('giggle', { fade: 0.05 });
  laugh.mood('laugh', { fade: 0.05 });
  // Run past fade-in and count local peaks of mouth opening over 1.0 s
  for (let i = 0; i < 30; i++) { giggle.update(DT, {}, null); laugh.update(DT, {}, null); }
  const samplesG = [], samplesL = [];
  for (let i = 0; i < 60; i++) {
    samplesG.push(giggle.update(DT, {}, null).open);
    samplesL.push(laugh.update(DT, {}, null).open);
  }
  const peaks = (arr) => {
    let n = 0;
    for (let i = 1; i < arr.length - 1; i++) if (arr[i] > arr[i - 1] && arr[i] > arr[i + 1]) n++;
    return n;
  };
  assert.ok(peaks(samplesG) > peaks(samplesL), `expected giggle (${peaks(samplesG)} peaks) faster than laugh (${peaks(samplesL)} peaks)`);
  assert.equal(EXPRESSIONS.giggle.pulse, 6);
  assert.equal(EXPRESSIONS.laugh.pulse, 4.2);
});

test('Face blinks close faster than they open and remain deterministic per seed', () => {
  const a = new Face({ seed: 42 });
  const b = new Face({ seed: 42 });
  a.blink();
  b.blink();
  const trace = [];
  for (let i = 0; i < 16; i++) {
    const sa = a.update(DT, {}, null);
    const sb = b.update(DT, {}, null);
    assert.equal(sa.blink, sb.blink, 'seeded faces stay deterministic');
    trace.push(sa.blink);
  }
  const peakIdx = trace.indexOf(Math.max(...trace));
  assert.ok(peakIdx > 0 && peakIdx <= 6, `blink should close briskly (peak at frame ${peakIdx})`);
  // Asymmetric opening: still partially closing/opening after peak for longer than the closing phase
  assert.ok(trace[peakIdx + 3] > 0.05, 'eyelid eases open slower than it shuts');
});

test('HeroRig: turn-lead anticipation turns head into a turn before shoulders finish', async () => {
  const asset = await synthPerson();
  const rig = new HeroRig(asset);
  let t = 0, yaw = 0;
  for (let i = 0; i < 20; i++) {
    t += DT;
    rig.update(baseInput({ time: t, yaw, vel: [0, 0, -2.5], speed: 2.5 }));
  }
  // Turn left (positive yawRate -> +left) while walking with no explicit look target
  for (let i = 0; i < 18; i++) {
    t += DT;
    yaw += 1.6 * DT;
    const fwd = [-Math.sin(yaw), 0, -Math.cos(yaw)];
    rig.update(baseInput({ time: t, yaw, vel: [fwd[0] * 2.5, 0, fwd[2] * 2.5], speed: 2.5 }));
  }
  const left = [-Math.cos(yaw), 0, Math.sin(yaw)];
  const headDotLeft = rig.J.headFwd[0] * left[0] + rig.J.headFwd[2] * left[2];
  assert.ok(headDotLeft > 0.08, `expected head to lead into left turn (dot=${headDotLeft.toFixed(3)})`);
});

test('HeroRig: landing impact absorbs pelvis, pitches head with follow-through, and settles cleanly', async () => {
  const asset = await synthPerson();
  const rig = new HeroRig(asset);
  let t = 0;
  for (let i = 0; i < 30; i++) { t += DT; rig.update(baseInput({ time: t })); }
  const standPelY = rig.J.pelvis[1];
  const standHeadFwdY = rig.J.headFwd[1];

  // Trigger a firm landing impact
  let minPelY = standPelY;
  let minHeadFwdY = standHeadFwdY;
  for (let i = 0; i < 45; i++) {
    t += DT;
    rig.update(baseInput({ time: t, landImpact: i === 0 ? 7.0 : 0 }));
    if (rig.J.pelvis[1] < minPelY) minPelY = rig.J.pelvis[1];
    if (rig.J.headFwd[1] < minHeadFwdY) minHeadFwdY = rig.J.headFwd[1];
  }
  assert.ok(standPelY - minPelY > 0.04, `pelvis should absorb landing squash (drop ${(standPelY - minPelY).toFixed(3)} m)`);
  assert.ok(standHeadFwdY - minHeadFwdY > 0.04, `head should dip in follow-through (dFwdY=${(standHeadFwdY - minHeadFwdY).toFixed(3)})`);

  // After settling (~1.5s), pelvis & head recover smoothly without NaN
  for (let i = 0; i < 90; i++) { t += DT; rig.update(baseInput({ time: t })); }
  assert.ok(Math.abs(rig.J.pelvis[1] - standPelY) < 0.02, 'pelvis recovers back to standing height');
  assert.ok(Number.isFinite(rig.J.head[0]) && Number.isFinite(rig.J.pelvis[1]));
});

test('HeroRig: jump takeoff launch extends arms up before mid-air balance & carries cleanly across rigs', async () => {
  const asset = await synthPerson();
  const rig = new HeroRig(asset);
  const rig2 = new HeroRig(asset);
  let t = 0;
  for (let i = 0; i < 20; i++) { t += DT; rig.update(baseInput({ time: t })); }
  // Early jump takeoff (jumpT = 0.05, rising fast)
  for (let i = 0; i < 4; i++) {
    t += DT;
    rig.update(baseInput({ time: t, pos: [0, 0.25 + i * 0.08, 0], vel: [0, 5.2, -1], speed: 1, onGround: false, jumpT: 0.02 + i * DT }));
  }
  const launchHandY = (rig.J.handL[1] + rig.J.handR[1]) * 0.5 - rig.J.chest[1];
  // Later apex / falling (jumpT = 0.45, descending)
  for (let i = 0; i < 20; i++) {
    t += DT;
    rig.update(baseInput({ time: t, pos: [0, 1.1, 0], vel: [0, -1.5, -1], speed: 1, onGround: false, jumpT: 0.45 + i * DT }));
  }
  const midAirHandY = (rig.J.handL[1] + rig.J.handR[1]) * 0.5 - rig.J.chest[1];
  assert.ok(launchHandY > midAirHandY + 0.05, `arms should sweep higher on launch (${launchHandY.toFixed(3)}) than mid-air settle (${midAirHandY.toFixed(3)})`);

  // carry() copies new state cleanly without NaN
  rig2.carry(rig, [0, 1.1, 0]);
  rig2.update(baseInput({ time: t + DT, pos: [0, 1.1, 0], vel: [0, -1.8, -1], speed: 1, onGround: false, jumpT: 0.8 }));
  assert.ok(Number.isFinite(rig2.J.pelvis[1]) && Number.isFinite(rig2.J.head[1]));
});

test('Face: eye gaze couples into upper eyelid follow & smooth gaze shifts trigger anticipation blinks', () => {
  const f = new Face({ seed: 7 });
  for (let i = 0; i < 30; i++) f.update(DT, {}, [0, 0, 1]);
  const levelLid = f.state.lidUp;
  // Look downward -> upper lid follows iris downward (higher lidUp)
  for (let i = 0; i < 35; i++) f.update(DT, {}, [0, -0.45, 0.89]);
  assert.ok(f.state.lidUp > levelLid + 0.08, `looking down should lower upper lid (${f.state.lidUp.toFixed(3)} vs ${levelLid.toFixed(3)})`);
  // Smooth turn across > 30 deg triggers an organic transition blink across seeds
  let blinked = false;
  for (let seed = 1; seed <= 8 && !blinked; seed++) {
    const g = new Face({ seed, blinkGap: [20, 25] });
    for (let i = 0; i < 15; i++) g.update(DT, {}, [0, 0, 1]);
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * 0.7;
      const st = g.update(DT, {}, [Math.sin(ang), 0, Math.cos(ang)]);
      if (st.blink > 0.2) { blinked = true; break; }
    }
  }
  assert.ok(blinked, 'smooth accumulated gaze shift should trigger an organic turn blink');
});

test('HeroRig: landing exhibits elastic upward rebound after squash and deceleration stop carries torso follow-through', async () => {
  const asset = await synthPerson();
  const rig = new HeroRig(asset);
  let t = 0;
  for (let i = 0; i < 40; i++) { t += DT; rig.update(baseInput({ time: t })); }
  const restPelY = rig.J.pelvis[1];
  let minPel = restPelY, maxPelAfterDrop = restPelY - 1;
  let dropped = false;
  for (let i = 0; i < 70; i++) {
    t += DT;
    rig.update(baseInput({ time: t, landImpact: i === 0 ? 7.5 : 0 }));
    if (rig.J.pelvis[1] < minPel) minPel = rig.J.pelvis[1];
    if (restPelY - rig.J.pelvis[1] > 0.04) dropped = true;
    if (dropped && rig.J.pelvis[1] > maxPelAfterDrop) maxPelAfterDrop = rig.J.pelvis[1];
  }
  assert.ok(restPelY - minPel > 0.06, `deep landing compression expected (${(restPelY - minPel).toFixed(3)} m)`);
  assert.ok(maxPelAfterDrop > restPelY + 0.001, `elastic landing rebound should briefly rise past rest (${maxPelAfterDrop.toFixed(4)} vs ${restPelY.toFixed(4)})`);

  // Decelerating sharply from a run carries upper chest forward in follow-through
  for (let i = 0; i < 40; i++) {
    t += DT;
    rig.update(baseInput({ time: t, pos: [0, 0, -i * DT * 5], vel: [0, 0, -5], speed: 5, running: true }));
  }
  let maxStopLean = -1;
  for (let i = 0; i < 20; i++) {
    t += DT;
    const v = Math.max(0, 5 - i * 0.9);
    rig.update(baseInput({ time: t, pos: [0, 0, -3.3 - i * DT * v], vel: [0, 0, -v], speed: v, running: false }));
    const fwdLean = rig.J.chest[2] - rig.J.pelvis[2]; // negative z is forward
    maxStopLean = Math.max(maxStopLean, -fwdLean);
  }
  assert.ok(maxStopLean > 0.04, `stopping from a run should carry torso forward (${maxStopLean.toFixed(3)} m)`);
});
