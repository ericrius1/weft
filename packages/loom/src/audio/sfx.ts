// Bending + foley SFX: the continuous held-water flow layer (at the water centroid), the orbiting swirl loop,
// and every one-shot event (layered, randomised, voice-limited).
import type { AudioEvent, AudioState, Surface, V3 } from './types';
import { Core, LayerSet, Loop, dist3 } from './core';
import { clamp, hashSeed } from './synth/dsp';

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// per-surface gains equalised by measurement (tools/audio: steps_* cases)
const STEP_GAIN: Record<Surface | 'wade', number> = { grass: 0.5, rock: 0.9, gravel: 0.7, snow: 0.5, ice: 0.95, water: 0.45, wood: 0.5, sand: 0.7, wade: 0.33 };

export class Sfx {
  private flow: { sum: GainNode; lp: BiquadFilterNode; panner: PannerNode; rev: GainNode; slosh: Loop | null; gurgle: Loop | null; stream: Loop | null; hiss: Loop | null } | null = null;
  private swirl: { sum: GainNode; panner: PannerNode; a: Loop | null; b: Loop | null; on: boolean; angle: number; center: V3; followPlayer: boolean; level: number; prevPos: V3 } | null = null;
  private sm = { held: 0, speed: 0, accel: 0, prevSpeed: 0 };
  private s: AudioState | null = null;
  private lastSurface: Surface = 'grass';
  private avoid = new Map<string, { last?: AudioBuffer }>();
  private wasUnder = false;
  private underSince = 0;
  private lastPlunge = -10;

  /** in-key note source (provided by the engine from the music state) */
  keyNotes: ((lo: number, hi: number) => { notes: number[]; tonic: number }) | null = null;
  private lantern = { last: -10, combo: 0 };

  /** a fire's loops (its roar and crackle, a dragon's breath) */
  private fireL: LayerSet;

  constructor(private core: Core) { this.fireL = new LayerSet(core); }

  /** a small soft bell (sine partials), non-positional but panned toward `pan` */
  private chime(when: number, midi: number, gain: number, pan: number, t60 = 1.6) {
    const c = this.core; const ctx = c.ctx;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const out = ctx.createGain(); out.gain.value = gain;
    const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -0.8, 0.8);
    const rv = ctx.createGain(); rv.gain.value = 0.55;
    out.connect(p).connect(c.mixer.sfx.dry); p.connect(rv).connect(c.mixer.sfx.rev);
    const nodes: AudioNode[] = [out, p, rv];
    for (const [r, a, d] of [[1, 1, 1], [2.0, 0.1, 0.4], [2.76, 0.07, 0.3], [5.4, 0.025, 0.12]] as [number, number, number][]) {
      if (f * r > ctx.sampleRate * 0.45) continue;
      const o = ctx.createOscillator(); o.frequency.value = f * r;
      const g = ctx.createGain(); g.gain.value = 0;
      g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(a, when + 0.004); g.gain.setTargetAtTime(0, when + 0.004, (t60 * d) / 6.9);
      o.connect(g).connect(out); o.start(when); o.stop(when + t60 * d + 0.05);
      nodes.push(o, g);
    }
    c.track(nodes, when + t60 + 0.2);
  }
  /** stereo pan of a world position relative to the listener */
  private panOf(pos: V3) {
    const l = this.core.listener; const f = l.fwd, u = l.up;
    const r: V3 = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
    const d = sub(pos, l.pos); const n = Math.hypot(...d) || 1, rn = Math.hypot(...r) || 1;
    return (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / (n * rn);
  }

  private buf(key: string) {
    let a = this.avoid.get(key); if (!a) { a = {}; this.avoid.set(key, a); }
    return this.core.synth.get(key, this.core.rng, a);
  }
  /** cliff-echo amount (open valley 1 .. dense forest ~0.45), set by the engine from the environment */
  echoScale = 1;

  // ------------------------------------------------------------------ continuous layers
  private ensureFlow() {
    const c = this.core;
    if (!this.flow) {
      const sum = c.ctx.createGain(); sum.gain.value = 0;
      const hp = c.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110; hp.Q.value = 0.6;
      const lp = c.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000; lp.Q.value = 0.6;
      const panner = c.makePanner(true);
      const rev = c.ctx.createGain(); rev.gain.value = 0.18;
      sum.connect(hp).connect(lp).connect(panner).connect(c.mixer.sfx.dry);
      lp.connect(rev).connect(c.mixer.sfx.rev);
      this.flow = { sum, lp, panner, rev, slosh: null, gurgle: null, stream: null, hiss: null };
    }
    const f = this.flow;
    const mk = (key: string, o: Partial<ConstructorParameters<typeof Loop>[2]> = {}) => { const b = c.synth.get(key); return b ? new Loop(c, b, { bus: 'sfx', dest: f.sum, ...o }) : null; };
    if (!f.slosh) f.slosh = mk('loop.slosh');
    if (!f.gurgle) f.gurgle = mk('loop.gurgle');
    if (!f.stream) f.stream = mk('loop.stream');
    if (!f.hiss) f.hiss = mk('noise.white', { filter: 'bandpass', freq: 2500, q: 0.9 });
    return f;
  }

  private ensureSwirl() {
    const c = this.core;
    if (!this.swirl) {
      const sum = c.ctx.createGain(); sum.gain.value = 0;
      const panner = c.makePanner(true);
      const hp = c.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140; hp.Q.value = 0.6;
      sum.connect(hp).connect(panner).connect(c.mixer.sfx.dry);
      const rv = c.ctx.createGain(); rv.gain.value = 0.2; sum.connect(rv).connect(c.mixer.sfx.rev);
      this.swirl = { sum, panner, a: null, b: null, on: false, angle: 0, center: [0, 0, 0], followPlayer: true, level: 0, prevPos: [0, 0, 0] };
    }
    const w = this.swirl;
    if (!w.a) { const b = c.synth.get('loop.stream'); if (b) { w.a = new Loop(c, b, { bus: 'sfx', dest: w.sum, offset: 0.37 }); w.a.set(0.8, 0.01); } }
    if (!w.b) { const b = c.synth.get('loop.gurgle'); if (b) { w.b = new Loop(c, b, { bus: 'sfx', dest: w.sum, offset: 0.61 }); w.b.set(0.45, 0.01); } }
    return w;
  }

  update(dt: number, s: AudioState) {
    this.s = s;
    const c = this.core;
    const k = (tau: number) => 1 - Math.exp(-dt / tau);
    const held = clamp(s.heldWater, 0, 1);
    this.sm.held += (held - this.sm.held) * k(held > this.sm.held ? 0.08 : 0.25);
    const spd = Math.max(0, s.waterSpeed);
    const acc = dt > 0 ? (spd - this.sm.prevSpeed) / dt : 0;
    this.sm.prevSpeed = spd;
    this.sm.speed += (spd - this.sm.speed) * k(0.06);
    this.sm.accel += (Math.max(0, acc) - this.sm.accel) * k(acc > this.sm.accel ? 0.03 : 0.25);

    // held water flow
    const h = this.sm.held;
    if (h > 0.003 || this.flow) {
      const f = this.ensureFlow();
      const vn = clamp(this.sm.speed / 12, 0, 1);
      const surge = 1 + 0.6 * clamp(this.sm.accel / 25, 0, 1);
      f.slosh?.set(h * 0.55 * (1 - 0.75 * vn), 0.08); f.slosh?.rate(0.9 + 0.25 * vn, 0.1);
      f.gurgle?.set(h * 0.42 * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, vn * 1.4)) ** 0.5), 0.08); f.gurgle?.rate(0.82 + 0.55 * vn, 0.08);
      f.stream?.set(h * 0.95 * Math.pow(vn, 0.9) * surge, 0.05); f.stream?.rate(0.9 + 0.3 * vn, 0.08);
      f.hiss?.set(h * 0.3 * vn * vn * surge, 0.05); f.hiss?.freq(1500 + 4500 * vn, 0.05);
      c.set(f.lp.frequency, 1600 + 9000 * Math.pow(vn, 0.8) * (0.8 + 0.2 * surge), 0.05, 2e-3);
      c.set(f.sum.gain, s.bending || h > 0.01 ? 0.6 : 0, 0.15);
      c.setPannerPos(f.panner, s.waterCentroid, undefined, 0.03);
    }

    // swirl
    if (this.swirl) this.updateSwirl(dt, s);

    // a fire: its roar and crackle where it burns, a dragon's breath of fire roaring out of its mouth
    {
      const F = s.fire ?? null;
      this.fireL.dt = dt;
      const lvl = F ? clamp(F.level, 0, 1.5) : 0, br = F ? clamp(F.breath, 0, 1) : 0;
      const gF = F ? c.distGain(dist3(c.listener.pos, F.pos), 20, 1) : 0, gB = F ? c.distGain(dist3(c.listener.pos, F.breathPos), 16, 1) : 0;
      const roar = this.fireL.layer('roar', 'loop.fireRoar', { bus: 'sfx', positional: true, rev: 0.3, echo: 0.08 }, 0.6 * lvl * gF, 0.5);
      const crk = this.fireL.layer('crackle', 'loop.fireCrackle', { bus: 'sfx', positional: true, rev: 0.2 }, 0.42 * Math.min(1, lvl) * gF, 0.5);
      const jet = this.fireL.layer('breath', 'loop.fireBreath', { bus: 'sfx', positional: true, rev: 0.3, echo: 0.15 }, 0.8 * br * gB, 0.12);
      if (F) { roar?.pos(F.pos); crk?.pos(F.pos); jet?.pos(F.breathPos); }
    }

    // plunge / emerge (with hysteresis: bobbing at the surface doesn't chatter; not again within a moment)
    const under = this.wasUnder ? s.underwater > 0.35 : s.underwater > 0.65;
    if (under !== this.wasUnder && c.now - this.lastPlunge > 0.7) {
      this.wasUnder = under;
      this.lastPlunge = c.now;
      const p = s.camPos;
      const r = c.rng;
      if (under) {
        // (heard from inside the water: past the muffle, straight into the mix)
        this.underSince = c.now;
        c.play(this.buf('uw.plunge'), { bus: 'sfx', dest: c.mixer.sum, gain: 0.42 * c.mixer.volumes.sfx, rate: r.range(0.92, 1.06), group: 'splash' });
        c.play(this.buf('splash.m'), { bus: 'sfx', pos: p, gain: 0.16, rate: 0.85, lp: 1800, group: 'splash' });
      } else {
        c.play(this.buf('splash.s'), { bus: 'sfx', pos: p, gain: 0.32, rate: r.range(1.0, 1.1), group: 'splash' });
        for (let i = 0; i < 5; i++) c.play(this.buf('drop'), { bus: 'sfx', pan: r.sym() * 0.6, gain: r.range(0.06, 0.13), when: c.now + 0.18 + i * r.range(0.1, 0.32), rate: r.range(0.9, 1.25), group: 'drop' });
        // a breath, after a real dive
        if (c.now - this.underSince > 1.5) c.play(this.buf('uw.breath'), { bus: 'sfx', gain: 0.3, pan: r.sym() * 0.1, when: c.now + r.range(0.12, 0.25), rate: r.range(0.95, 1.05), group: 'misc' });
      }
    }
  }

  private updateSwirl(dt: number, s: AudioState) {
    const c = this.core; const w = this.ensureSwirl();
    const target = w.on ? 1 : 0;
    w.level += (target - w.level) * (1 - Math.exp(-dt / (w.on ? 0.15 : 0.3)));
    w.angle += dt * 2 * Math.PI * 0.85;
    if (w.followPlayer) w.center = s.playerPos;
    const r = 2.2;
    const p: V3 = [w.center[0] + Math.cos(w.angle) * r, w.center[1] + 1.0 + 0.35 * Math.sin(w.angle * 2), w.center[2] + Math.sin(w.angle) * r];
    // doppler (radial velocity towards the listener)
    const vel: V3 = dt > 0 ? [(p[0] - w.prevPos[0]) / dt, (p[1] - w.prevPos[1]) / dt, (p[2] - w.prevPos[2]) / dt] : [0, 0, 0];
    w.prevPos = p;
    const toL = sub(c.listener.pos, p); const dl = Math.max(0.5, Math.hypot(...toL));
    const vr = (vel[0] * toL[0] + vel[1] * toL[1] + vel[2] * toL[2]) / dl;
    const dop = clamp(1 + (1.5 * vr) / 343, 0.9, 1.1);
    w.a?.rate(1.0 * dop, 0.03); w.b?.rate(0.95 * dop, 0.03);
    const near = clamp(1.4 - dl / 6, 0.6, 1.2);
    c.set(w.sum.gain, 0.75 * w.level * near, 0.03);
    c.setPannerPos(w.panner, p, undefined, 0.02);
  }

  // ------------------------------------------------------------------ events
  event(e: AudioEvent) {
    const c = this.core; const rng = c.rng;
    const r = (a: number, b: number) => rng.range(a, b);
    switch (e.type) {
      case 'draw': {
        const a = clamp(e.amount, 0, 1);
        c.play(this.buf('draw'), { bus: 'sfx', pos: e.pos, gain: 0.24 + 0.24 * a, rate: r(0.95, 1.05) * (1.08 - 0.18 * a), rev: 0.22, ref: 4, group: 'draw' });
        break;
      }
      case 'splash': this.splash(e.pos, e.size, e.speed); break;
      case 'whip': {
        const v = clamp(e.speed / 20, 0, 1);
        c.play(this.buf('whip'), { bus: 'sfx', pos: e.pos, gain: 0.4 + 0.5 * v, rate: r(0.95, 1.05) * (0.85 + 0.35 * v), rev: 0.18, ref: 4, group: 'whip' });
        break;
      }
      case 'launch': {
        const a = clamp(e.amount, 0, 1);
        c.play(this.buf('launch'), { bus: 'sfx', pos: e.pos, gain: 0.45 + 0.45 * a, rate: r(0.95, 1.05) * (1.05 - 0.15 * a), rev: 0.22, ref: 4, echo: 0.08 * a * this.echoScale, group: 'whip' });
        break;
      }
      case 'freeze': {
        const a = clamp(e.amount, 0, 1);
        c.play(this.buf('freeze'), { bus: 'sfx', pos: e.pos, gain: 0.3 + 0.32 * a, rate: r(0.96, 1.04) * (1.1 - 0.15 * a), rev: 0.35, echo: 0.12 * this.echoScale, ref: 4, group: 'freeze' });
        break;
      }
      case 'shatter': {
        const a = clamp(e.amount, 0, 1);
        const layers = 1 + Math.round(a * 2);
        for (let i = 0; i < layers; i++) {
          c.play(this.buf('shatter'), { bus: 'sfx', pos: e.pos, gain: (0.5 + 0.4 * a) * (i ? 0.55 : 1), rate: r(0.9, 1.12) * (i ? r(1.05, 1.25) : 1), when: c.now + (i ? r(0.01, 0.05) : 0), rev: 0.32, echo: 0.22 * a * this.echoScale, ref: 4, group: 'shatter' });
        }
        break;
      }
      case 'melt': {
        const a = clamp(e.amount, 0, 1);
        c.play(this.buf('melt'), { bus: 'sfx', pos: e.pos, gain: 0.25 + 0.3 * a, rate: r(0.93, 1.07), rev: 0.25, ref: 4, group: 'melt' });
        break;
      }
      case 'swirlStart': {
        const w = this.ensureSwirl();
        w.on = true;
        w.followPlayer = !this.s || dist3(e.pos, this.s.playerPos) < 5;
        w.center = e.pos;
        c.play(this.buf('whip'), { bus: 'sfx', pos: e.pos, gain: 0.3, rate: 0.75, rev: 0.2, group: 'whip' });
        break;
      }
      case 'swirlStop': {
        if (this.swirl) this.swirl.on = false;
        c.play(this.buf('splash.s'), { bus: 'sfx', pos: e.pos, gain: 0.25, rate: r(0.9, 1.05), rev: 0.2, group: 'splash' });
        break;
      }
      case 'wave': {
        const sz = clamp(e.size, 0, 1);
        c.play(this.buf('wave'), { bus: 'sfx', pos: e.pos, gain: 0.5 + 0.45 * sz, rate: r(0.96, 1.04) * (1.12 - 0.22 * sz), hp: 90, rev: 0.3, echo: 0.4 * sz * this.echoScale, ref: 6, group: 'wave' });
        break;
      }
      case 'iceCrack':
        c.play(this.buf('iceCrack'), { bus: 'sfx', pos: e.pos, gain: 0.7, rate: r(0.9, 1.1), rev: 0.4, echo: 0.45 * this.echoScale, ref: 8, group: 'crack' });
        break;
      case 'footstep': this.footstep(e.pos, e.surface, e.speed); break;
      case 'jump':
        c.play(this.buf('jump'), { bus: 'sfx', pos: e.pos, gain: 0.3, rate: r(0.9, 1.1), group: 'step' });
        this.footstep(e.pos, this.lastSurface, 3, 0.7);
        break;
      case 'land': {
        const im = clamp(e.impact, 0, 1);
        c.play(this.buf('thump'), { bus: 'sfx', pos: e.pos, gain: 0.15 + 0.25 * im, rate: r(0.9, 1.05) * (1.1 - 0.25 * im), group: 'step' });
        this.footstep(e.pos, e.surface, 4 + 4 * im, 1.2 + 0.6 * im);
        if (e.surface === 'water' || (this.s?.wadeDepth ?? 0) > 0.05) this.splash(e.pos, 0.3 + 0.4 * im, 4 + 6 * im);
        break;
      }
      case 'fishJump': {
        c.play(this.buf('splash.s'), { bus: 'amb', pos: e.pos, gain: 0.35, rate: r(1.1, 1.3), rev: 0.3, echo: 0.1 * this.echoScale, ref: 5, group: 'splash' });
        c.play(this.buf('plop'), { bus: 'amb', pos: e.pos, gain: 0.5, rate: r(0.85, 1.1), when: c.now + r(0.45, 0.9), rev: 0.3, echo: 0.12 * this.echoScale, ref: 5, group: 'splash' });
        for (let i = 0; i < 3; i++) c.play(this.buf('drop'), { bus: 'amb', pos: e.pos, gain: 0.12, rate: r(0.9, 1.3), when: c.now + r(0.1, 0.5), ref: 5, group: 'drop' });
        break;
      }
      case 'birdTakeoff': {
        const n = Math.max(1, Math.round(e.count));
        const pos = e.pos;
        void c.synth.render('flurry', { count: n }, hashSeed(rng.next() * 1e9, 'flurry')).then((res) => {
          const b = c.synth.toBuffer(res);
          c.play(b, { bus: 'amb', pos, gain: 0.45 + 0.25 * Math.min(1, n / 10), rev: 0.25, ref: 6, group: 'bird', move: { to: [pos[0] + r(-10, 10), pos[1] + 12, pos[2] + r(-10, 10)], secs: b.duration } });
        });
        break;
      }
      case 'uiOpen': c.play(this.buf('ui.open'), { bus: 'ui', gain: 0.11, group: 'ui' }); break;
      case 'uiClose': c.play(this.buf('ui.close'), { bus: 'ui', gain: 0.11, group: 'ui' }); break;
      case 'uiClick': c.play(this.buf('ui.click'), { bus: 'ui', gain: 0.09, rate: r(0.96, 1.04), group: 'ui' }); break;
      case 'lanternHit': {
        const a = clamp(e.amount, 0, 1);
        c.play(this.buf('lantern.hit'), { bus: 'sfx', pos: e.pos, gain: 0.35 + 0.4 * a, rate: r(0.94, 1.06), rev: 0.3, echo: 0.06 * this.echoScale, ref: 5, group: 'misc' });
        // reward sting: an in-key arpeggio; quick successive hits climb the scale
        const k = this.keyNotes?.(84, 103) ?? { notes: [86, 88, 91, 93, 95, 98, 100, 103], tonic: 86 };
        const now = c.now;
        this.lantern.combo = now - this.lantern.last < 2.0 ? Math.min(this.lantern.combo + 1, 6) : 0;
        this.lantern.last = now;
        let i0 = Math.max(0, k.notes.indexOf(k.tonic)); i0 = Math.min(k.notes.length - 3, i0 + this.lantern.combo);
        const steps = a < 0.4 ? [0] : a < 0.75 ? [0, 2] : [0, 1, 3];
        const pan = this.panOf(e.pos) * 0.6;
        steps.forEach((s, j) => { const m = k.notes[Math.min(k.notes.length - 1, i0 + s)]; this.chime(now + 0.06 + j * 0.085, m, (0.055 + 0.03 * a) * (j === steps.length - 1 ? 1 : 0.8), pan); });
        break;
      }
      case 'lanternRise': {
        c.play(this.buf('lantern.rise'), { bus: 'sfx', pos: e.pos, gain: 0.14, rate: r(0.95, 1.05), rev: 0.4, ref: 8, group: 'misc' });
        const k = this.keyNotes?.(88, 105) ?? { notes: [88, 91, 93, 95, 98, 100, 103], tonic: 98 };
        const pan = this.panOf(e.pos) * 0.6;
        const n = rng.int(3, 5);
        for (let j = 0; j < n; j++) this.chime(c.now + 0.35 + j * r(0.25, 0.5), rng.pick(k.notes), r(0.007, 0.013), pan + r(-0.2, 0.2), 2.2);
        break;
      }
      case 'bubbles': {
        // air rising past: clear when the listener is in the water too, faint and muffled from above it
        const a = clamp(e.amount, 0, 1);
        const inWater = (this.s?.underwater ?? 0) > 0.5;
        const key = a < 0.35 ? 'bubbles.s' : 'bubbles';
        c.play(this.buf(key), { bus: 'sfx', pos: e.pos, dest: inWater ? c.mixer.sum : undefined, gain: (0.1 + 0.4 * a) * (inWater ? c.mixer.volumes.sfx : 0.25), rate: r(0.9, 1.15) * (1.2 - 0.3 * a), lp: inWater ? 3500 : 1200, ref: 3, air: false, group: 'drop' });
        break;
      }
      case 'dragonRoar': {
        const a = clamp(e.size, 0, 1);
        c.play(this.buf('dragon.roar'), { bus: 'sfx', pos: e.pos, gain: 0.85 + 0.35 * a, rate: r(0.95, 1.04) * (e.pitch ?? 1), rev: 0.35, echo: 0.55 * this.echoScale, ref: 30, group: 'roar' });
        break;
      }
      case 'wingbeat': {
        const a = clamp(e.size, 0, 1);
        c.play(this.buf('dragon.wing'), { bus: 'sfx', pos: e.pos, gain: 0.3 + 0.45 * a, rate: r(0.92, 1.05) * (1.1 - 0.2 * a), rev: 0.2, ref: 18, group: 'wing' });
        break;
      }
      case 'douse': {
        const a = clamp(e.amount, 0, 1);
        c.play(this.buf('fire.douse'), { bus: 'sfx', pos: e.pos, gain: 0.8 + 0.4 * a, rev: 0.4, echo: 0.45 * this.echoScale, ref: 30, group: 'douse' });
        this.splash(e.pos, 1, 14);
        break;
      }
      case 'call': break; // routed to the ambience by the engine
      case 'sceneChange': break;
    }
  }

  private splash(pos: V3, size: number, speed: number) {
    const c = this.core; const rng = c.rng;
    const sz = clamp(size, 0, 1); const v = clamp(speed / 14, 0, 1);
    const key = sz < 0.08 ? 'splash.drop' : sz < 0.32 ? 'splash.s' : sz < 0.6 ? 'splash.m' : sz < 0.85 ? 'splash.l' : 'splash.xl';
    const gain = (0.22 + 0.78 * Math.pow(sz, 0.7)) * (0.65 + 0.35 * v);
    const echo = sz > 0.5 ? 0.45 * (sz - 0.4) * this.echoScale : 0;
    c.play(this.buf(key), { bus: 'sfx', pos, gain, rate: rng.range(0.94, 1.06) * (0.96 + 0.1 * v), lp: 5000 + 17000 * Math.pow(v, 0.7), rev: 0.25 + 0.1 * sz, echo, ref: 4 + 4 * sz, group: 'splash' });
    if (sz < 0.08) c.play(this.buf('drop'), { bus: 'sfx', pos, gain: gain * 0.6, rate: rng.range(0.85, 1.2), ref: 3, group: 'drop' });
    if (v > 0.25) c.play(this.buf('slap'), { bus: 'sfx', pos, gain: 0.55 * v * v * Math.sqrt(Math.max(0.1, sz)), rate: rng.range(0.9, 1.1) * (1.25 - 0.35 * sz), ref: 4, group: 'splash' });
    if (sz > 0.85) {
      c.play(this.buf('splash.l'), { bus: 'sfx', pos, gain: gain * 0.5, rate: rng.range(0.8, 0.9), when: c.now + rng.range(0.04, 0.09), rev: 0.3, echo: echo * 0.6, ref: 8, group: 'splash' });
      c.play(this.buf('thump'), { bus: 'sfx', pos, gain: 0.3, rate: 0.85, hp: 45, ref: 8, group: 'splash' });
    }
  }

  private footstep(pos: V3, surface: Surface, speed: number, mul = 1) {
    const c = this.core; const rng = c.rng;
    this.lastSurface = surface;
    const wade = this.s?.wadeDepth ?? 0;
    const sp = clamp(speed / 6, 0, 1);
    let key: Surface | 'wade' = surface;
    if (wade > 0.3) key = 'wade'; else if (wade > 0.02) key = 'water';
    const g = STEP_GAIN[key] * (0.35 + 0.65 * sp) * mul * (key === 'wade' ? 0.6 + 0.6 * clamp(wade, 0, 1) : 1);
    c.play(this.buf(`step.${key}`), { bus: 'sfx', pos, gain: g * 0.55, rate: rng.range(0.93, 1.07), lp: 5000 + 15000 * sp, rev: 0.06, ref: 2.5, group: 'step' });
    // wading also scuffs the bed underneath at shallow depth
    if (key === 'water' && surface !== 'water' && wade < 0.15) c.play(this.buf(`step.${surface}`), { bus: 'sfx', pos, gain: g * 0.18, rate: rng.range(0.93, 1.07), lp: 3000, ref: 2.5, group: 'step' });
  }
}
