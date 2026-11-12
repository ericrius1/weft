// Drake's own Rider and Flute (read-only, bundled from the project's own src) driven through scripted
// acts, the GPU parts stubbed; yields every frame's bones.
import { readFileSync } from 'node:fs';
import { Rider } from 'DRAKE/src/cast/rider';
import { Flute } from 'DRAKE/src/flute/flute';
import { __seed } from './rand';

declare const __DRAKE__: string;
const ASSETS = __DRAKE__ + '/public';
(globalThis as any).fetch = async (u: string) => {
  const b = readFileSync(ASSETS + u);
  return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const kit: any = { dt: 1 / 60 };
const input: any = { down: () => false, hit: () => false, pad: null, padDown: () => false };

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sc = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const nrm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rot = (v: V3, k: V3, a: number): V3 => { const c = Math.cos(a), s = Math.sin(a), d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c), x = crs(k, v); return [v[0] * c + x[0] * s + k[0] * d, v[1] * c + x[1] * s + k[1] * d, v[2] * c + x[2] * s + k[2] * d]; };
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const ramp = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);

/** the saddle as main.ts / footplay.ts build it (footplay saddleOf), from a pelvis, forward, up */
function saddle(seat: V3, fwd: V3, up: V3, vel: V3, accel: V3, horn = false): any {
  const right = nrm(crs(fwd, up));
  const at = (f: number, u: number, s: number) => add(add(add(seat, sc(fwd, f)), sc(up, u)), sc(right, s));
  const S: any = { pelvis: seat, fwd, up, right, grips: [at(0.45, 0.28, -0.16), at(0.45, 0.28, 0.16)], stirrups: [at(0.08, -0.62, -0.5), at(0.08, -0.62, 0.5)], vel, accel };
  if (horn) { const g = nrm(add(up, sc(fwd, 0.35))); S.gripUp = [rot(g, fwd, 0.25), rot(g, fwd, -0.25)]; S.grips = [at(0.5, 0.36, -0.09), at(0.5, 0.36, 0.09)]; }
  return S;
}
/** a flight: the pelvis along a banking curve (world), its saddle at t */
function flightAt(t: number, horn = false) {
  const P = (u: number): V3 => [200 * Math.sin(u * 0.1), 100 + 5 * Math.sin(0.3 * u), -25 * u];
  const h = 1 / 240, p = P(t), v = sc(sub(P(t + h), P(t - h)), 0.5 / h), a = sc(add(sub(P(t + h), sc(p, 2)), P(t - h)), 1 / (h * h));
  const fwd = nrm(v), bank = 0.5 * Math.sin(0.4 * t), up = nrm(rot([0, 1, 0], fwd, bank));
  const upO = nrm(sub(up, sc(fwd, up[0] * fwd[0] + up[1] * fwd[1] + up[2] * fwd[2])));
  return { S: saddle(p, fwd, upO, v, a, horn), lean: clamp(bank / 0.9, -1, 1) };
}
const moodAt = (t: number) => (t < 3 ? 'calm' : t < 5 ? 'brace' : t < 6.5 ? 'fire' : t < 9 ? 'whoop' : 'calm');
const watchAt = (t: number) => (t < 10 || t > 13.5 ? undefined : { k: ramp(t, 10, 10.5) * (1 - ramp(t, 13, 13.5)), press: ramp(t, 10.5, 11) * (1 - ramp(t, 11.5, 12)), raise: ramp(t, 11.5, 12.5), sky: [0, 400, -1000] as V3 });

export const ACTS = ['ride', 'ride-horn', 'foot', 'flute-foot', 'flute-ride'] as const;
export interface Frame { t: number; seg: string; bones: Float32Array; n: number; rig: any; tips: { hand: number; f: number; target: V3; at: V3 }[] }
const FN = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export async function load(id: string, lod: 'hi' | 'lo') {
  __seed(0x1111);
  const r: any = await Rider.load(kit, id as any, { lod });
  const fl: any = new Flute(kit, { scene: {} } as any, input, {});
  fl.attach(r);
  return { r, fl };
}

export async function* act(id: string, lod: 'hi' | 'lo', name: string, o: { flute?: boolean } = {}): AsyncGenerator<Frame> {
  const { r, fl } = await load(id, lod);
  __seed(0x2222);
  if (o.flute === false) fl.attach(null);
  // (the goals the hook handed the rig, to measure the fingertips against)
  const hook = r.poseHook;
  let ov: any = null;
  if (hook) r.poseHook = { pose: (rr: any, c: any) => (ov = hook.pose(rr, c)), posed: (rr: any) => hook.posed?.(rr) };
  const R = r.rig, A = R.asset;
  const dt = 1 / 60;
  const tipsNow = () => {
    const out: Frame['tips'] = [];
    if (!ov) return out;
    const An = R.anchor;
    for (let i = 0; i < 2; i++) {
      const g = ov.hands[i];
      if (!g?.tips) continue;
      let d: V3 = [0, 0, 0];
      if (An && An.k[i] > 1e-3) { const q = sub(R.skinPoint(An.bone, An.local), An.was); if (Math.hypot(...q) < 0.25 * R.s) d = sc(q, An.k[i]); }
      for (let f = 0; f < 5; f++) {
        const tg = g.tips[f];
        const bi = A.index[FN[f] + '3' + (i === 0 ? 'L' : 'R')];
        if (!tg || bi === undefined) continue;
        out.push({ hand: i, f, target: add(tg, d), at: R.skinPoint(bi, A.bones[bi].tail) });
      }
    }
    return out;
  };
  const frame = (t: number, seg: string): Frame => ({ t, seg, bones: R.bones, n: R.nBones, rig: R, tips: tipsNow() });

  if (name === 'ride' || name === 'ride-horn' || name === 'flute-ride') {
    const horn = name === 'ride-horn', T = name === 'ride' ? 14 : name === 'flute-ride' ? 16 : 9;
    for (let k = 0, t = 0; t < T; k++, t = k * dt) {
      const { S, lean } = flightAt(t, horn);
      if (name !== 'ride') {
        if (k === 60) fl.scripted = { auto: true };
        if (k === (T - 3) * 60) { fl.scripted = { auto: false }; fl.setUp(false); }
      }
      fl.update(dt, { mode: 'ride', vel: S.vel });
      const mood = name === 'ride' ? moodAt(t) : 'calm';
      r.update(dt, S, { airspeed: 25, lean, mood, watch: name === 'ride' ? watchAt(t) : undefined });
      yield frame(t, name === 'ride' ? (watchAt(t) ? 'watch' : mood) : fl.u > 0.94 ? 'playing' : 'carried');
    }
    return;
  }
  // on foot: the dragon kneeling on flat ground (the saddle 2.2 m up), the rider beside it
  const S = saddle([0, 2.2, 0], [0, 0, -1], [0, 1, 0], [0, 0, 0], [0, 0, 0]);
  const floor = () => 0;
  let pos: V3 = [2, 0, -0.5], yaw = Math.PI / 2, vel: V3 = [0, 0, 0], onGround = true, landImpact = 0, vy = 0, running = false;
  const W = () => ({ pos, yaw, vel, onGround, running, landImpact, floor, look: null, wind: [0.5, 0, 0.25] as V3 });
  const move = (speed: number, turn: number) => {
    yaw += turn * dt;
    vel = [Math.sin(yaw) * speed, vy, Math.cos(yaw) * speed];
    pos = add(pos, sc(vel, dt));
  };
  if (name === 'flute-foot') {
    r.setMode('walk', { pos: [0, 0, 0], yaw: 0 });
    pos = [0, 0, 0]; yaw = 0;
    for (let k = 0, t = 0; t < 26; k++, t = k * dt) {
      if (k === 60) fl.scripted = { auto: true };
      if (k === 22 * 60) { fl.scripted = { auto: false }; fl.setUp(false); }
      fl.staff = t > 16 && t < 19 ? 1 : 0;
      fl.aim = t > 19 && t < 22 ? [10, 4, 20] : null; fl.aimK = 1;
      move(t > 1 && t < 8 ? 1.0 : 0, t > 4 && t < 6 ? 0.3 : 0);
      fl.update(dt, { mode: 'foot', vel });
      r.walk(dt, W(), S);
      const seg = t < 1 ? 'stand' : t < 8 ? 'walk-playing' : t < 16 ? 'stand-playing' : t < 19 ? 'staff' : t < 22 ? 'aim' : 'putaway';
      yield frame(t, seg);
    }
    return;
  }
  // 'foot' (and 'walk', the same without the dismount and mount: setMode): a moment in the saddle, the dismount,
  // walking, running, standing, a jump, walking back, the mount, riding
  let phase = 'ride', since = 0;
  for (let k = 0, t = 0; t < 40; k++, t = k * dt) {
    since += dt;
    fl.update(dt, { mode: phase === 'ride' || phase === 'ride2' ? 'ride' : 'foot', vel });
    if (phase === 'ride') {
      if (k === 60) { r.dismount(S, [2, 0, -0.5], Math.PI / 2); phase = 'dismount'; since = 0; }
      else { r.update(dt, S, { airspeed: 0, lean: 0, mood: 'calm' }); yield frame(t, 'ride'); continue; }
    }
    if (phase === 'dismount' && r.mode === 'walk') { phase = 'walk'; since = 0; pos = r.root; }
    if (phase === 'walk') { move(1.4, 0.25); if (since > 5) { phase = 'run'; since = 0; } }
    else if (phase === 'run') { running = true; move(4.5, -0.4); if (since > 4) { phase = 'stand'; since = 0; running = false; } }
    else if (phase === 'stand') { move(0, 0); if (since > 4) { phase = 'jump'; since = 0; vy = 3.5; onGround = false; } }
    else if (phase === 'jump') {
      vy -= 9.81 * dt; move(0, 0); landImpact = 0;
      if (pos[1] <= 0 && since > 0.1) { pos = [pos[0], 0, pos[2]]; landImpact = -vy; vy = 0; onGround = true; phase = 'stand2'; since = 0; }
    } else if (phase === 'stand2') { landImpact = 0; move(0, 0); if (since > 2) { phase = 'back'; since = 0; yaw = Math.atan2(-pos[0], -pos[2]); } }
    else if (phase === 'back') { move(1.4, 0); if (since > 2.5 || Math.hypot(pos[0], pos[2]) < 2.5) { phase = 'mount'; since = 0; r.mount(S); } }
    if (phase === 'mount' && r.mode === 'ride') { phase = 'ride2'; since = 0; }
    if (phase === 'ride2') r.update(dt, S, { airspeed: 0, lean: 0, mood: 'calm' });
    else r.walk(dt, W(), S);
    yield frame(t, phase);
  }
}
