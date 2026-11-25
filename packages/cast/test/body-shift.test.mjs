// Moving-frame continuity for the whole-body solver (`body/solve.ts`) and `HeroRig.shift(d)`:
// a body riding a moving frame (bike, car, board, dragon) carries `S.x[0..2]` with `G.at - S.at` so the world-space
// continuity residual never drags the trunk behind the seat, and `HeroRig.shift(d)` moves `bodyS.x` alongside `bodyS.at`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHero, CORE } from '../dist/asset.js';
import * as bodySolve from '../dist/body/solve.js';
import { HeroRig } from '../dist/rig.js';

const { BodyModel, BodyState, solveBody } = bodySolve;
HeroRig.bodyKit = bodySolve;

const DT = 1 / 60;

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
    char: 'rider', version: 1, height: 1.66, scale: 1,
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
  return parseHero(buf, 'rider');
}

function seatedGoal(at, ease = 0) {
  return {
    at,
    yaw: 0,
    seat: [at[0], at[1] + 0.52, at[2]],
    feet: [
      { kind: 'flat', at: [at[0] - 0.16, at[1] + 0.08, at[2] - 0.32], yaw: 0 },
      { kind: 'flat', at: [at[0] + 0.16, at[1] + 0.08, at[2] - 0.32], yaw: 0 },
    ],
    hands: [null, null],
    pelvis: { at: [at[0], at[1] + 0.62, at[2]], w: 4 },
    spine: { flex: 0.2, side: 0, turn: 0, w: 1 },
    ease,
  };
}

test('solveBody moving at 18 m/s matches stationary relative pose (with and without ease)', async () => {
  const asset = await synthPerson();
  const M = new BodyModel(asset);

  for (const ease of [0, 0.15]) {
    const sStill = new BodyState();
    const sMove = new BodyState();
    sStill.dt = DT;
    sMove.dt = DT;

    let poseStill, poseMove;
    let atMove = [0, 0, 0];
    for (let f = 0; f < 40; f++) {
      atMove = [f * 18 * DT, 0.2 * Math.sin(f * 0.1), -f * 6 * DT];
      poseStill = solveBody(M, seatedGoal([0, 0, 0], ease), sStill);
      poseMove = solveBody(M, seatedGoal(atMove, ease), sMove);
    }

    const relStill = poseStill.pel.o;
    const relMove = [poseMove.pel.o[0] - atMove[0], poseMove.pel.o[1] - atMove[1], poseMove.pel.o[2] - atMove[2]];
    const err = Math.hypot(relMove[0] - relStill[0], relMove[1] - relStill[1], relMove[2] - relStill[2]);
    assert.ok(err < 1e-4, `ease=${ease}: moving pose drifted ${(err * 1000).toFixed(3)} mm from stationary`);
  }
});

test('HeroRig.shift(d) carries bodyS.x alongside bodyS.at without lag after origin rebase', async () => {
  const asset = await synthPerson();
  const rigA = new HeroRig(asset);
  const rigB = new HeroRig(asset);

  const step = (rig, at, t) => rig.update({
    dt: DT,
    time: t,
    pos: at,
    vel: [0, 0, 0],
    speed: 0,
    running: false,
    yaw: 0,
    onGround: true,
    flying: false,
    swimming: false,
    wade: 0,
    wind: [0, 0, 0],
    ground: () => at[1],
    landImpact: 0,
    look: null,
    seat: null,
    hold: null,
    body: { goal: seatedGoal(at, 0.12), w: 1 },
    posed: null,
    pose: { mode: 'idle', target: [at[0], at[1] + 1.3, at[2] - 2], intensity: 0, t },
  });

  // Settle both rigs at the origin
  for (let i = 0; i < 20; i++) {
    step(rigA, [0, 0, 0], i * DT);
    step(rigB, [0, 0, 0], i * DT);
  }

  // Rebase rigB's world by a large shift; keep rigA unshifted
  const d = [512, -14, -384];
  const xBefore = rigB.bodyS.x.slice();
  rigB.shift(d);
  assert.ok(
    Math.abs(rigB.bodyS.x[0] - (xBefore[0] + d[0])) < 1e-6 &&
    Math.abs(rigB.bodyS.x[1] - (xBefore[1] + d[1])) < 1e-6 &&
    Math.abs(rigB.bodyS.x[2] - (xBefore[2] + d[2])) < 1e-6,
    'HeroRig.shift(d) immediately carries bodyS.x by d',
  );
  step(rigA, [0, 0, 0], 20 * DT);
  step(rigB, d, 20 * DT);

  const pA = rigA.bodyPose.pel.o;
  const pB = rigB.bodyPose.pel.o;
  const err = Math.hypot((pB[0] - d[0]) - pA[0], (pB[1] - d[1]) - pA[1], (pB[2] - d[2]) - pA[2]);
  assert.ok(err < 1e-4, `pelvis drifted ${(err * 1000).toFixed(3)} mm after HeroRig.shift(d)`);
});
