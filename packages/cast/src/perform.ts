// Playing an instrument, as articulation any body can use (Aether's band — its keyboardist, violinist, guitarist and
// holo-synthesist, src/band — taken off its skeleton and its maths library; Drake's flute fingers; Boulder's hand
// goals): what's sounding for a player on the music's clock and what's coming, how much they're playing, the beat in
// the body as a HeroRig groove, a glance at the conductor now and then, the notes shared out between two hands and
// fingers, a bow that travels at a speed and turns at the ends of its hair, a string's stops and a position's shift,
// a strum on the eighths, a finger or a mallet travelling from one note's place to the next's to land as it sounds,
// fingers on holes or keys sprung (each its own little lateness, a press quick and a little under-damped, a lift
// slower, the next note anticipated), and a fingertip solved onto a point (damped least squares over a finger's
// three numbers, held to its limits and drawn toward a relaxed curl). All CPU, no renderer, no skeleton of its own:
// the HeroRig takes what these give as hand goals, fingertip targets and a groove; another skeleton (Aether's) poses
// them itself.
import { type V3, add, sub, scale, dot, len, norm, lerp, lerp3, clamp, saturate, smoothstep, damp } from './math.js';
import type { Groove, HandGoal, HeroRig } from './rig.js';

// ---------------------------------------------------------------- the notes on the clock
/** a note a player plays: its onset (s, on the music's clock), its length (s), its pitch (MIDI), its velocity (0..1) */
export interface NoteEv { t: number; dur: number; note: number; vel: number }

export interface NotesNow {
  /** sounding now as the hands see it: a finger's down `early` s before its onset and up a moment before its end (held
   *  at least 60 ms) */
  active: NoteEv[];
  /** the latest onset (up to 20 ms ahead: a hand arrives as its sound does) */
  last: NoteEv | null;
  /** the note struck last and the one coming next (a chord struck at once: its top note), for travel() */
  prev: NoteEv | null;
  next: NoteEv | null;
}
/** a player's notes at `now` (Aether's Performer.notes and HoloSynthesist's prev / next) */
export function notesAt(evs: readonly NoteEv[], now: number, early = 0.03): NotesNow {
  const active = evs.filter((e) => e.t - early <= now && now < e.t + Math.max(0.06, e.dur - 0.03));
  let last: NoteEv | null = null, prev: NoteEv | null = null, next: NoteEv | null = null;
  for (const e of evs) {
    if (e.t <= now + 0.02 && (!last || e.t > last.t)) last = e;
    if (e.t <= now) { if (!prev || e.t > prev.t + 1e-3 || (Math.abs(e.t - prev.t) <= 1e-3 && e.note > prev.note)) prev = e; }
    else if (!next || e.t < next.t - 1e-3 || (Math.abs(e.t - next.t) <= 1e-3 && e.note > next.note)) next = e;
  }
  return { active, last, prev, next };
}

/** how much a player is playing (a glow, a lean into it): rising with each note by its velocity, falling between */
export class Heat {
  v = 0;
  /** `active` how many notes sound, `last` the latest onset */
  update(dt: number, active: number, last: NoteEv | null, now: number): number {
    const hit = last ? Math.exp(-(now - last.t) * 4) * last.vel : 0;
    this.v = damp(this.v, Math.min(1, active * 0.25 + hit), 6, dt);
    return this.v;
  }
}

// ---------------------------------------------------------------- the beat in the body
/** the beat's pulse: a kick on each beat dying away (0..1), weaker when the player isn't playing */
export function beatPulse(beat: number, playing = true): number {
  const ph = beat - Math.floor(beat);
  return Math.exp(-ph * 6) * (playing ? 1 : 0.3);
}
export interface BeatFeel {
  /** how much the body moves with it (1: Aether's band) and how much the head nods */
  amt?: number; nod?: number;
  /** playing (else the pulse is a third as strong) */
  playing?: boolean;
  /** a player's own phase for the slow sway (Aether: its id's length) */
  seed?: number;
}
/** the beat in a player's body as a HeroRig groove (RigInput.groove): the spine leaning with the beat and rocking into
 *  each, a slow sway of the chest to the side, a nod on the beat (Aether's Performer.groove, in the rig's terms) */
export function beatGroove(beat: number, time: number, f: BeatFeel = {}, out: Groove = { bounce: 0, sway: 0, twist: 0, rock: 0, roll: 0, nod: 0, tilt: 0 }): Groove {
  const amt = f.amt ?? 1, nod = f.nod ?? 1, pulse = beatPulse(beat, f.playing ?? true);
  out.bounce = 0; out.sway = 0; out.twist = 0; out.tilt = 0;
  out.rock = (Math.sin(beat * Math.PI) * 0.035 + pulse * 0.02) * amt;
  out.roll = Math.sin(time * 0.6 + (f.seed ?? 0)) * 0.04 * amt;
  out.nod = pulse * 0.09 * nod;
  return out;
}

/** now and then a glance at someone (the conductor, the audience), else at the instrument: how far the look goes from
 *  the instrument toward them (0..1; Aether's Performer.gaze). `seed` a player's own phase */
export function glance(time: number, seed = 0, toward = 0.45): number {
  return smoothstep(0, 1, (Math.sin(time * 0.31 + seed * 2) - 0.35) * 3) * toward + 0.15;
}

// ---------------------------------------------------------------- a keyboard
/** a keyboard's sounding notes shared between two hands (MIDI, any order): split at the widest gap when it's more than
 *  `gap` semitones (two hands), else all to one, the left if they're low (under `middle`) — [left, right], each low to
 *  high (Aether's keyboardist) */
export function splitHands(notes: readonly number[], gap = 5, middle = 66): [number[], number[]] {
  const ks = [...new Set(notes.map((n) => Math.round(n)))].sort((a, b) => a - b);
  let split = ks.length, wide = -1;
  for (let i = 1; i < ks.length; i++) if (ks[i] - ks[i - 1] > wide) { wide = ks[i] - ks[i - 1]; split = i; }
  if (wide > gap) return [ks.slice(0, split), ks.slice(split)];
  const low = ks.reduce((a, n) => a + n, 0) / Math.max(1, ks.length) < middle;
  return low ? [ks, []] : [[], ks];
}
/** which of a hand's fingers takes each of its notes (low to high), thumb inward: `fingers` 4 (thumb .. ring: Aether's
 *  animals) or 5; `side` -1 the left hand (its thumb toward the high notes), 1 the right. More notes than fingers: the
 *  lowest two and the highest kept. Returns per finger (thumb first) the note it plays, or null */
export function fingersFor(notes: readonly number[], side: 1 | -1, fingers: 4 | 5 = 4): (number | null)[] {
  let ns = side < 0 ? [...notes].reverse() : [...notes];
  if (ns.length > fingers) ns = [...ns.slice(0, 2), ...ns.slice(-(fingers - 2))];
  const PICK4 = [[], [1], [0, 2], [0, 1, 3], [0, 1, 2, 3]], PICK5 = [[], [1], [0, 2], [0, 2, 4], [0, 1, 3, 4], [0, 1, 2, 3, 4]];
  const pick = (fingers === 4 ? PICK4 : PICK5)[ns.length];
  const out: (number | null)[] = new Array(fingers).fill(null);
  ns.forEach((n, i) => { out[pick[i]] = n; });
  return out;
}

// ---------------------------------------------------------------- strings
/** a note on a bowed or fretted instrument: the string it's played on (the highest open string at or under it; the
 *  note brought into range by octaves, at most `top` semitones over the top string), and how far above that string
 *  it is (Aether's violinist; `open` low to high, MIDI: a violin's G3 D4 A4 E5 is [55, 62, 69, 76]) */
export function stringFor(note: number, open: readonly number[], top = 9): { str: number; semi: number; note: number } {
  let n = Math.round(note);
  while (n < open[0]) n += 12;
  while (n > open[open.length - 1] + top) n -= 12;
  let str = 0;
  for (let k = 0; k < open.length; k++) if (open[k] <= n) str = k;
  return { str, semi: n - open[str], note: n };
}
/** where a stop is along its string from the nut (0) toward the bridge (1), `semi` semitones above the open string */
export const stopAt = (semi: number) => 1 - 2 ** (-semi / 12);
/** high on the top string the hand shifts up the neck: the position's shift (semitones) for a stop */
export const shiftFor = (semi: number) => (semi > 6 ? semi - 5 : 0);
/** which finger stops `semi` with the hand shifted by `shift` (0 the open string; then the first, second and third) */
export const fingerFor = (semi: number, shift = 0) => (semi <= 0 ? 0 : semi - shift <= 2 ? 1 : semi - shift <= 4 ? 2 : 3);
/** a singing stopped note's vibrato (m along the string, at scale 1): only after it's sounded `delay` s */
export const vibrato = (time: number, since: number, width = 0.0025, hz = 5.4, delay = 0.15) =>
  since > delay ? Math.sin(time * hz * 2 * Math.PI) * width : 0;

/** a bow that travels at a speed, not by the note (Aether's violinist): a long note (or one with the bow nearly out of
 *  hair that way) starts a new stroke the other way, its speed set to spend a good length of hair over the note; quick
 *  notes are slurred on in the same stroke. The hair stays between `u0` (a little out from the frog: the hand never at
 *  the face) and `u1` (near the tip), easing through each change of way; it lifts off the string between phrases */
export class Bow {
  /** how far along the hair it's touching the string (0 at the frog, 1 at the tip), which way it's going, its speed */
  u = 0.5; dir = 1; v = 0; speed = 0.4;
  /** off the string (0 on it .. 1 lifted) */
  lift = 0;
  private lastOnset = -1;
  constructor(readonly u0 = 0.36, readonly u1 = 0.82, readonly long = 0.42) {}
  /** `last` the latest onset, `singing` whether a note sounds */
  update(dt: number, now: number, last: NoteEv | null, singing: boolean) {
    const { u0, u1 } = this;
    if (last && last.t !== this.lastOnset && now >= last.t - 0.02) {
      this.lastOnset = last.t;
      const left = this.dir > 0 ? u1 - this.u : this.u - u0;
      if (last.dur >= this.long || left < 0.18) {
        this.dir = this.u > (u0 + u1) / 2 ? -1 : this.u < (u0 + u1) / 2 - 0.05 ? 1 : -this.dir;
        this.speed = clamp((0.2 + last.dur * 0.35) / Math.max(0.35, last.dur), 0.2, 0.9);
      } else this.speed = Math.max(this.speed, 0.3);
    }
    if ((this.dir > 0 && this.u >= u1) || (this.dir < 0 && this.u <= u0)) this.dir = -this.dir;
    this.v = damp(this.v, singing ? this.dir * this.speed : 0, 14, dt);
    this.u = clamp(this.u + this.v * dt, u0 - 0.02, u1 + 0.02);
    this.lift = damp(this.lift, singing ? 0 : 1, singing ? 20 : 3, dt);
    return this;
  }
}

/** a strumming hand on the eighths (Aether's guitarist): its sweep across the strings (signed, × its amplitude) and how
 *  far down-stroke it is; `amp` eased by the caller (louder, wider) */
export const strum = (beat: number, amp: number) => Math.cos(Math.PI * beat * 2) * amp;
/** the chord a fretting hand goes to: the next one a little before the bar's end (`lead`, a share of a bar of `beats`) */
export const chordAt = (beat: number, chord: number, next: number, beats = 4, lead = 0.12) => {
  const ph = beat / beats - Math.floor(beat / beats);
  return ph > 1 - lead ? next : chord;
};

// ---------------------------------------------------------------- from note to note
/** a finger (or a mallet's head) going from where the last note was played (`A`, at `tA`) to where the next is (`B`,
 *  at `tB`): it leaves, swings back off the surface (`back`, a unit way out of it) by up to `arc`, and lands on time;
 *  then strikes through (`press`, 0..1: quickly in, a little after, and out). Nothing coming within `horizon` s, it
 *  hovers `hover` off A (Aether's holo-synthesist) */
export function travel(A: V3, B: V3 | null, tA: number | null, tB: number | null, now: number, back: V3,
  o: { arc?: number; hover?: number; horizon?: number; strike?: number } = {}): { at: V3; press: number } {
  const arc = o.arc ?? 0.22, horizon = o.horizon ?? 1.2;
  let at: V3;
  if (B && tB !== null && tB - now < horizon) {
    const t0 = tA ?? tB - 0.4, span = Math.max(0.06, tB - t0);
    const u = saturate((now - t0) / span);
    at = add(lerp3(A, B, smoothstep(0, 1, u)), scale(back, Math.sin(Math.PI * u) * Math.min(arc, span * 0.55)));
  } else at = add(A, scale(back, o.hover ?? 0.05));
  const since = tA !== null ? now - tA : 9;
  const press = since >= 0 ? Math.exp(-since * (o.strike ?? 11)) * Math.min(1, since * 60 + 0.35) : 0;
  return { at, press };
}

// ---------------------------------------------------------------- sprung fingers
export interface SprungFingersOpts {
  /** how high each finger hovers lifted (m, at scale 1): its count is the fingers' */
  hover: readonly number[];
  /** each finger's own lateness behind a change (s: fingers never move as one, a roll of 10-30 ms) */
  late?: readonly number[];
  /** how far a down finger's pad presses on past the surface (m: the flesh flattening), and how far it can go */
  seal?: number; floor?: number;
  /** a press: quick and a little under-damped (it lands, the pad squashes and settles); a lift: slower, eased */
  press?: { hz: number; zeta: number }; lift?: { hz: number; zeta: number };
  /** how early a finger starts down for the next note when it's known (s: its pad lands as the note sounds), and how
   *  early one that will lift lets go */
  pressLead?: number; liftLead?: number;
}
/** Drake's flute's six (holes 1-6: the top hand's index, middle, ring, then the bottom's) */
export const FLUTE_FINGERS: SprungFingersOpts = {
  hover: [0.0145, 0.013, 0.0105, 0.0155, 0.0135, 0.0115], late: [0.0, 0.011, 0.02, 0.004, 0.014, 0.024],
  seal: 0.0009, floor: 0.0018, press: { hz: 13, zeta: 0.6 }, lift: { hz: 7.5, zeta: 0.9 }, pressLead: 0.036, liftLead: 0.008,
};
/** each finger's lift over its hole or key (m; below 0, its pad pressed into it): sprung, not eased — each finger its
 *  own little delay, a press landing quickly with a little squash, a lift a touch slower; the next fingering, when it's
 *  known (a melody playing by itself), anticipated so the fingers arrive as it sounds; lifted fingers hovering a natural
 *  height with a little life of their own; in a breath the down ones ease their weight (Drake's flute, src/flute/hold.ts
 *  Fingers, for any count of fingers) */
export class SprungFingers {
  readonly n: number;
  readonly lift: number[];
  /** each finger's velocity (m/s) */
  readonly vel: number[];
  /** how much each finger is pressing now (0..1.5: its pad's weight) — for the hand's own small give */
  readonly press: number[];
  private want: number[]; private seen: number[]; private seenAt: number[];
  private t = 0;
  private o: Required<SprungFingersOpts>;
  constructor(o: SprungFingersOpts) {
    const n = this.n = o.hover.length;
    this.o = { late: new Array(n).fill(0), seal: 0.0009, floor: 0.0018, press: { hz: 13, zeta: 0.6 }, lift: { hz: 7.5, zeta: 0.9 }, pressLead: 0.036, liftLead: 0.008, ...o };
    this.lift = [...o.hover]; this.vel = new Array(n).fill(0); this.press = new Array(n).fill(0);
    this.want = new Array(n).fill(1); this.seen = new Array(n).fill(-1); this.seenAt = new Array(n).fill(0);
  }
  /** `down` the fingering sounding now (1 / true a finger down); `next` the one coming (if known) in `tNext` s;
   *  `breath` 0..1 between phrases (the down fingers ease off); `up` how far they're lifted at most (0..1) */
  update(down: ArrayLike<number | boolean>, dt: number, next: ArrayLike<number | boolean> | null = null, tNext = Infinity, breath = 0, up = 1) {
    if (dt <= 0) return;
    this.t += dt;
    const t = this.t, O = this.o;
    for (let i = 0; i < this.n; i++) {
      const now = down[i] === 1 || down[i] === true ? 1 : 0;
      // (a change seen: this finger goes after its own little delay)
      if (now !== this.seen[i]) { this.seen[i] = now; this.seenAt[i] = t; }
      // (unless it's already there: it went early for this note)
      let w = t - this.seenAt[i] < O.late[i] * 0.6 ? this.want[i] : now;
      // (the next note's coming: a finger that will press goes early to land as it sounds, one that will lift lets go a
      // moment before — each a little later than the one before it)
      const nx = next ? (next[i] === 1 || next[i] === true ? 1 : 0) : now;
      if (next && nx !== now) {
        const lead = (nx === 1 ? O.pressLead : O.liftLead) - O.late[i] * 0.5;
        if (tNext <= lead) w = nx;
      }
      this.want[i] = w;
      // where it's going: pressed (less in a breath), or hovering with a little drift of its own
      const drift = 0.0016 * Math.sin(t * (1.3 + 0.23 * i) + i * 1.9) + 0.0009 * Math.sin(t * (2.9 + 0.31 * i) + i * 0.7);
      const target = w ? -O.seal * (1 - 0.8 * breath) : (O.hover[i] + drift + 0.002 * breath) * up;
      // sprung (semi-implicit, substeps so it's the same at any frame rate)
      const S = w ? O.press : O.lift, om = 2 * Math.PI * S.hz;
      const k = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / k;
      let x = this.lift[i], v = this.vel[i];
      for (let j = 0; j < k; j++) {
        v += (om * om * (target - x) - 2 * S.zeta * om * v) * h;
        x += v * h;
        // (the wood or the key's bed: it lands, it stops)
        if (x < -O.floor) { x = -O.floor; if (v < 0) v = 0; }
      }
      this.lift[i] = x; this.vel[i] = v;
      this.press[i] = clamp(-x / O.seal, 0, 1.5);
    }
  }
}

// ---------------------------------------------------------------- a fingertip onto a point
export interface Finger3Opts {
  /** each number's range (the knuckle's bend, the two outer joints', the spread: rad) */
  lo: readonly [number, number, number]; hi: readonly [number, number, number];
  /** the relaxed curl it's drawn toward (knuckle, outer) */
  relax?: readonly [number, number];
  /** the body's scale (the tolerances and damping are a hand's at 1) */
  scale?: number;
}
/** a finger's ranges (Aether's): the thumb's, and the others' */
export const THUMB3: Finger3Opts = { lo: [-0.6, -0.3, -0.9], hi: [1.3, 1.3, 0.9], relax: [0.2, 0.3] };
export const FINGER3: Finger3Opts = { lo: [-0.35, 0, -0.5], hi: [1.6, 1.75, 0.5], relax: [0.5, 0.6] };
/** a fingertip onto `target`: its three numbers (x: the knuckle's bend, the outer joints', the spread) solved by damped
 *  least squares from last frame's answer, held to what a finger can do and drawn a little toward a relaxed curl; if
 *  that's stuck at its limits, tried again from the relaxed curl and the better kept (Aether's Performer.reachFinger,
 *  after Boulder's fiddler). `tip(x)` poses the finger at x and says where its tip is then. `x` is updated in place;
 *  returns the miss (m) */
export function reachFinger3(tip: (x: readonly [number, number, number]) => V3, target: V3, x: [number, number, number], o: Finger3Opts = FINGER3): number {
  const ms = o.scale ?? 1, relax = o.relax ?? [0.5, 0.6];
  const pull = [relax[0], relax[1], 0];
  const h = 0.01, lam = 4e-5 * ms * ms, mu = 1.5e-5 * ms * ms;
  const run = (y: [number, number, number], iters: number) => {
    for (let it = 0; it < iters; it++) {
      const p0 = tip(y), e = sub(target, p0);
      if (len(e) < 0.0006 * ms) break;
      const J: V3[] = [];
      for (let k = 0; k < 3; k++) {
        const z: [number, number, number] = [y[0], y[1], y[2]];
        z[k] += h;
        J.push(scale(sub(tip(z), p0), 1 / h));
      }
      // (JᵀJ + λ) dx = Jᵀe + μ(relaxed − x); a joint at its limit and pushed past it is held there
      const A = [0, 1, 2].map((r) => [0, 1, 2].map((c) => dot(J[r], J[c]) + (r === c ? lam + mu : 0)));
      const b = [0, 1, 2].map((r) => dot(J[r], e) + mu * (pull[r] - y[r]));
      const dx = solve3(A, b);
      for (let k = 0; k < 3; k++) y[k] = clamp(y[k] + clamp(dx[k], -0.5, 0.5), o.lo[k], o.hi[k]);
    }
    return len(sub(target, tip(y)));
  };
  const y: [number, number, number] = [x[0], x[1], x[2]];
  let err = run(y, 8), best = y;
  if (err > 0.003 * ms) {
    const r: [number, number, number] = [relax[0], relax[1], 0];
    const e2 = run(r, 12);
    if (e2 < err) { best = r; err = e2; }
  }
  x[0] = best[0]; x[1] = best[1]; x[2] = best[2];
  tip(x);
  return err;
}
/** A x = b for a 3x3 (Cramer's rule; [0, 0, 0] when it's singular) */
export function solve3(A: number[][], b: number[]): number[] {
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-18) return [0, 0, 0];
  return [0, 1, 2].map((c) => det(A.map((row, r) => row.map((v, k) => (k === c ? b[r] : v)))) / D);
}

// ---------------------------------------------------------------- hand goals
/** between two hand goals (k 0..1): the palm, its ways, the curl and grip; the fingertips' targets from the nearer
 *  (Drake's flute: from the belt to the lips and back) */
export function mixGoal(a: HandGoal | null, b: HandGoal, k: number): HandGoal {
  if (!a || k >= 0.999) return b;
  if (k <= 0.001) return a;
  return {
    ...(k < 0.5 ? a : b),
    palm: lerp3(a.palm, b.palm, k), fwd: norm(lerp3(a.fwd, b.fwd, k)), down: norm(lerp3(a.down, b.down, k)),
    curl: lerp(a.curl ?? 0.6, b.curl ?? 0.45, k), grip: lerp(a.grip ?? 0, b.grip ?? 0, k),
    tips: k < 0.55 ? a.tips : b.tips, exact: false, knuckles: undefined,
  };
}
/** a body's hand measures (bind space; the lengths hold posed): the hand bone's length, and from the wrist to the
 *  knuckles (the middle finger's first bone) */
export interface HandSize { hl: number; kl: number }
export function handSize(rig: HeroRig, T: 'L' | 'R'): HandSize {
  const a = rig.asset, hb = a.index['hand' + T], mb = a.index['middle1' + T];
  if (hb === undefined) return { hl: 0.09, kl: 0.09 };
  const H = a.bones[hb], d = sub(H.tail, H.head), hl = len(d);
  const kl = mb === undefined ? hl * 0.5 : Math.max(0.02, dot(sub(a.bones[mb].head, H.head), norm(d)));
  return { hl, kl };
}
