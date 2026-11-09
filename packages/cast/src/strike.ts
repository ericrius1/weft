// A stroke planner for anything swung at a surface by hand — a drum's beater, a gong's mallet, a hammer, an axe: where
// the implement is through a stroke (ready, the lift, the top, the downswing, contact, the rebound, the way back to
// ready), how the hand holds it, and how far through the body's chain the stroke is, for a body solver to carry.
//
// The implement is a rigid shaft from the grip to its head. A stroke is given by its contact: when, where, the head's
// way and speed there, and the shaft's way at that moment. Everything else follows from those:
//   - the downswing is a whip. The hand travels on a cubic from the top (at rest) to its place at contact, arriving
//     with only a part of the head's speed (`handShare`); the rest comes from the shaft turning in the swing plane
//     (the plane of the shaft and the head's way at contact) through `cock` radians, its angle as s^p over the swing so
//     its turn is fastest at contact — the wrist uncocking last, as a whip's tip. p is solved so the head arrives at
//     exactly the speed asked.
//   - contact: the head sinks into the surface along its way and comes back out over the dwell (a half sine), the hand
//     still following through a little.
//   - the rebound: the head leaves at `restitution` of its speed, the shaft swinging back up off the surface, the hand
//     carried on through the contact (it doesn't stop dead: its speed dies over `follow`) and on to where the next
//     stroke rises from.
//   - the rise: from ready up to the top, slowing into it (the hang: still rising, the anticipation), then the
//     downswing. The top is where the hand is at the start of the downswing, and the shaft there is the contact shaft
//     turned back through `cock`.
//   - the hand's whole path is quintic Hermite segments (src/rig/track.ts) through those poses, its position, velocity
//     and acceleration continuous everywhere but the contact itself (the one break a stroke should have). Strokes in
//     a sequence (Strokes) flow one into the next: the rebound carries on up into the next rise through the ready
//     pose without stopping (a figure of eight, as a drummer's hands go), unless there's time to rest there.
//   - the body's chain (ChainPhase): the hips start the downswing first, then the trunk, the shoulder, the elbow, the
//     wrist last, each a share of the swing later (`lag`), each easing through its own turn — the kinetic chain that
//     makes a stroke look like it has weight behind it. The coil (wind-up) runs the other way: the wrist cocks first
//     and the hips turn away last.
//
// Times are on whatever clock the caller keeps (a story clock that dilates is fine: a stroke is a function of time).
import { type V3, add, sub, scale, dot, cross, len, norm, lerp3, clamp, rotateAxis, minJerk, rej } from './math.js';
import { hermite5v } from './track.js';
import type { HandGoal } from './rig.js';

export interface Implement {
  /** from the grip (the middle of the fist) to the head's centre (m) */
  reach: number;
  /** the head's radius (m): its surface meets the struck one */
  headR: number;
}

export interface StrokeSpec {
  /** contact time */
  t: number;
  /** the struck point on the surface (world), and the surface's normal there (out, toward the player) */
  at: V3; normal: V3;
  /** the head's way at contact (into the surface: dot(dir, normal) < 0), and its speed (m/s) */
  dir: V3; speed: number;
  /** the shaft's way at contact, grip → head (made perpendicular to dir) */
  shaft: V3;
  /** how far the shaft turns through the downswing (rad): a tap ~0.6, a full stroke ~1.4, overhead ~3 */
  cock: number;
  /** the downswing's length (s) */
  down: number;
  /** the share of the head's speed at contact that's the hand's own travel (0..1; the rest is the shaft's turn) */
  handShare: number;
  /** the hand at the top of the backswing (world) */
  top: V3;
  /** the lift from ready to the top (s), and the hang there before the downswing (s) */
  lift: number; hang: number;
  /** how long the head is on the surface (s), and how far it sinks into it at the deepest (m) */
  dwell: number; depth: number;
  /** the rebound's speed as a share of the strike's, and how long the way back to ready takes (s) */
  restitution: number; settle: number;
  /** where the hand rests after (world) and the shaft's way there; default: this stroke's top, lowered */
  ready?: { hand: V3; shaft: V3 };
  /** the chain's lag: each link of the chain this share of the downswing after the one before (default 0.1) */
  lag?: number;
  /** how long the hand takes to lose its speed after contact (s, default 0.12), and how far its follow carries it
   *  past the contact point along the stroke's way (m, default from its speed) */
  follow?: number; followDist?: number;
  /** the hand's speed leaving the top into the downswing, as a share of the downswing's mean speed (default 0.25: the
   *  elbow leading the hand down out of the top) */
  topFlow?: number;
  /** the least exponent of the shaft's turn through the downswing (its angle as s^p; default 2.2: from rest, fastest
   *  at contact — a whip) */
  whip?: number;
  /** how much further back the shaft lays early in the downswing as the hand starts down without it (rad, default
   *  0.22): the head lagging the hand, then snapping through — what makes a stroke read as a whip, not a slide */
  lay?: number;
}

export type StrokePhase = 'ready' | 'lift' | 'hang' | 'down' | 'contact' | 'rebound';

export interface StrokeState {
  phase: StrokePhase;
  /** the grip (the middle of the fist), the shaft's way (grip → head), the head's centre */
  hand: V3; shaft: V3; head: V3;
  /** the head's velocity (m/s, on the stroke's clock) */
  vel: V3;
  /** 0 → 1 through the lift and hang (the coil), through the downswing, through the rebound and settle */
  coil: number; swing: number; settle: number;
  /** how deep in the surface the head is (0..1 of the stroke's depth) */
  press: number;
  /** time from contact (negative before) */
  since: number;
}

/** the chain's own progress through a downswing (each 0..1): the hips first, the wrist last */
export interface ChainPhase { hips: number; trunk: number; shoulder: number; elbow: number; wrist: number }

const along = (a: V3, b: V3, k: number): V3 => lerp3(a, b, k);
/** cubic Bézier and its derivative */
function bez(p0: V3, p1: V3, p2: V3, p3: V3, s: number): V3 {
  const u = 1 - s, a = u * u * u, b = 3 * u * u * s, c = 3 * u * s * s, d = s * s * s;
  return [p0[0] * a + p1[0] * b + p2[0] * c + p3[0] * d, p0[1] * a + p1[1] * b + p2[1] * c + p3[1] * d, p0[2] * a + p1[2] * b + p2[2] * c + p3[2] * d];
}
function bezD(p0: V3, p1: V3, p2: V3, p3: V3, s: number): V3 {
  const u = 1 - s, a = 3 * u * u, b = 6 * u * s, c = 3 * s * s;
  return [(p1[0] - p0[0]) * a + (p2[0] - p1[0]) * b + (p3[0] - p2[0]) * c, (p1[1] - p0[1]) * a + (p2[1] - p1[1]) * b + (p3[1] - p2[1]) * c,
    (p1[2] - p0[2]) * a + (p2[2] - p1[2]) * b + (p3[2] - p2[2]) * c];
}
/** the shaft's way turned from a to b by k of the angle between them (about their common normal) */
function slerpDir(a: V3, b: V3, k: number): V3 {
  const c = clamp(dot(a, b), -1, 1), ang = Math.acos(c);
  if (ang < 1e-5) return b;
  let ax = cross(a, b);
  if (len(ax) < 1e-6) ax = Math.abs(a[1]) < 0.9 ? cross(a, [0, 1, 0]) : cross(a, [1, 0, 0]);
  return rotateAxis(a, norm(ax), ang * k);
}

/** a stroke's fixed geometry, worked out once */
export class Stroke {
  readonly dir: V3; readonly shaft: V3; readonly axis: V3;
  /** the grip at contact, the shaft at the top, the downswing's exponent */
  readonly handC: V3; readonly shaftTop: V3; readonly p: number;
  readonly ready: { hand: V3; shaft: V3 };
  constructor(readonly s: StrokeSpec, readonly tool: Implement) {
    this.dir = norm(s.dir);
    // (the shaft at contact square to the head's way)
    this.shaft = norm(rej(s.shaft, this.dir));
    // the swing plane's normal: turning about it carries the head along dir at contact
    this.axis = norm(cross(this.shaft, this.dir));
    // the head's centre at contact: its surface on the struck point
    const headC = sub(s.at, scale(this.dir, tool.headR));
    this.handC = sub(headC, scale(this.shaft, tool.reach));
    this.shaftTop = rotateAxis(this.shaft, this.axis, -s.cock);
    // ω at contact = p·cock/down must give the shaft's share of the speed: reach·ω = (1 − handShare)·speed — but never
    // under `whip` (the shaft must start its turn from rest at the top, its angular velocity and acceleration both
    // rising from nothing: an exponent of 1 starts it spinning in a frame), so a big turn in a short swing lands faster
    // than asked, as it would
    this.p = Math.max(s.whip ?? 2.2, ((1 - s.handShare) * s.speed * s.down) / (Math.max(1e-3, s.cock) * tool.reach));
    this.ready = s.ready ?? { hand: add(s.top, [0, -0.12, 0]), shaft: slerpDir(this.shaftTop, this.shaft, 0.5) };
    // the hand meets the surface still accelerating: never slower than a little over its mean speed down the swing
    // (a hand that slows into contact places the head; one that's still speeding up strikes)
    this.vHand = Math.max(s.handShare * s.speed, (1.15 * len(sub(this.handC, s.top))) / s.down);
    // and the head's real speed then (the hand's and the shaft's turn): what it rebounds from
    this.vContact = len(add(scale(this.dir, this.vHand), scale(cross(this.axis, this.shaft), (s.cock * this.p * tool.reach) / s.down)));
  }
  /** the hand's speed at contact, and the head's (m/s) */
  readonly vHand: number; readonly vContact: number;
  /** the shaft's turn from the top through the downswing (0..1 of it → rad): s^p, laid further back early */
  // (the lay is a bump 64·q³(1 − q)³ over the first 0.65 of the swing: 1 at its middle, and its value, rate and
  // acceleration all 0 at both ends — a sin² there started the shaft's turn with an angular acceleration from nothing,
  // a jolt at the head as the downswing began)
  turn(s: number): number {
    const lay = this.s.lay ?? 0.22, q = Math.min(1, s / 0.65), b = q * (1 - q);
    return this.s.cock * Math.pow(s, this.p) - lay * 64 * b * b * b;
  }
  turnRate(s: number): number {
    const lay = this.s.lay ?? 0.22, q = Math.min(1, s / 0.65), b = q * (1 - q);
    const dq = s < 0.65 ? 1 / 0.65 : 0;
    return this.s.cock * this.p * Math.pow(Math.max(s, 1e-6), this.p - 1) - lay * 64 * 3 * b * b * (1 - 2 * q) * dq;
  }
  /** when the lift starts (it's ready before), and when it's settled after (a sequence's flow may move both) */
  get begins() { return this.riseAt ?? this.s.t - this.s.down - this.s.hang - this.s.lift; }
  get ends() { return this.endAt ?? this.s.t + this.s.dwell + this.s.settle; }
  /** set by a sequence (Strokes): when this stroke's rise starts and the hand's velocity there; when its way back ends
   *  and the velocity it leaves with (0: a rest at ready) */
  riseAt?: number; riseVel: V3 = [0, 0, 0];
  endAt?: number; endVel: V3 = [0, 0, 0];

  /** the hand at the start of the downswing: where it is (the top), its velocity (the elbow leading it down) */
  get topVel(): V3 {
    const S = this.s;
    const mean = scale(sub(this.handC, S.top), 1 / S.down);
    // (out of the top along the way to the approach: down toward the body's line before it swings out to the hide)
    const P2 = sub(this.handC, scale(this.dir, (S.handShare * S.speed * S.down) / 3));
    const way = norm(sub(P2, S.top));
    return scale(way, len(mean) * (S.topFlow ?? 0.25));
  }
  /** where the hand is when its follow is spent, and its velocity then (the rebound's start) */
  get followEnd(): { p: V3; v: V3; t: number } {
    const S = this.s;
    const fol = S.follow ?? 0.12;
    const vC = this.vHand;
    const dist = S.followDist ?? vC * fol * 0.42;
    // (it carries on along the stroke's way, curling up off the surface as the head rebounds)
    const up = norm(rej(scale(this.dir, -1), this.shaft));
    const p = add(this.handC, add(scale(this.dir, dist), scale(this.shaft, -dist * 0.3)));
    return { p, v: add(scale(this.dir, vC * 0.08), scale(up, vC * 0.04)), t: S.t + S.dwell + fol };
  }

  /** the stroke at time t, coming from `from` (the previous stroke's ready, or this one's) and going to `to` */
  at(t: number, from = this.ready, to = this.ready): StrokeState {
    const S = this.s, T = this.tool;
    const since = t - S.t;
    const tTop = S.t - S.down, tRise = this.begins, tEnd = this.ends;
    const Z: V3 = [0, 0, 0];
    let hand: V3, shaft: V3, vel: V3 = [0, 0, 0], phase: StrokePhase, coil = 0, swing = 0, settle = 0, press = 0;
    const vTop = this.topVel;
    if (t < tRise) {
      phase = 'ready'; hand = from.hand; shaft = from.shaft;
    } else if (t < tTop) {
      // the rise: from ready up to the top, slowing into it (the hang: the breath before the stroke)
      const hang = Math.min(S.hang, (tTop - tRise) * 0.4);
      const tHang = tTop - hang;
      phase = t < tHang ? 'lift' : 'hang';
      const hs = this.hangStart;
      if (t < tHang) {
        const h = tHang - tRise, u = (t - tRise) / h;
        // (into the hang still rising, slowly)
        const vh = scale(sub(S.top, hs), 0.9 / Math.max(hang, 1e-3));
        const r = hermite5v(from.hand, this.riseVel, Z, hs, vh, Z, h, u);
        hand = r.p; vel = r.v;
        coil = 0.85 * minJerk(u);
      } else {
        const h = tTop - tHang, u = (t - tHang) / h;
        const vh = scale(sub(S.top, hs), 0.9 / Math.max(hang, 1e-3));
        const r = hermite5v(hs, vh, Z, S.top, vTop, Z, h, u);
        hand = r.p; vel = r.v;
        coil = 0.85 + 0.15 * minJerk(u);
      }
      // the shaft: turned back to the top's cock over the whole rise, easing in and out
      shaft = slerpDir(from.shaft, this.shaftTop, minJerk((t - tRise) / (tTop - tRise)));
    } else if (t < S.t) {
      // the downswing: the hand on its quintic from the top to the contact, the shaft whipping through its turn
      phase = 'down';
      const s = (t - tTop) / S.down;
      swing = s; coil = 1 - s;
      const vC = scale(this.dir, this.vHand);
      const r = hermite5v(S.top, vTop, Z, this.handC, vC, Z, S.down, s);
      hand = r.p;
      shaft = rotateAxis(this.shaftTop, this.axis, this.turn(s));
      vel = add(r.v, scale(cross(this.axis, shaft), (this.turnRate(s) / S.down) * T.reach));
    } else if (t < S.t + S.dwell) {
      // contact: in along dir and back out (the surface's own give and spring), the hand carrying on
      phase = 'contact';
      const k = since / S.dwell;
      press = Math.sin(Math.PI * k);
      swing = 1;
      const f = this.followEnd;
      hand = hermite5v(this.handC, scale(this.dir, this.vHand), Z, f.p, f.v, Z, f.t - S.t, since / (f.t - S.t)).p;
      // (the shaft keeps the head where the surface puts it)
      const head = add(sub(S.at, scale(this.dir, T.headR)), scale(this.dir, S.depth * press));
      shaft = norm(sub(head, hand));
      return { phase, hand, shaft, head, vel: scale(this.dir, S.speed * Math.cos(Math.PI * k)), coil, swing, settle, press, since };
    } else {
      // the rebound and the way back: the head flung back off the surface, the hand's follow spent, then on to ready
      phase = t < tEnd ? 'rebound' : 'ready';
      const u = clamp((since - S.dwell) / Math.max(1e-3, tEnd - S.t - S.dwell), 0, 1);
      settle = u;
      const k = minJerk(u);
      const f = this.followEnd;
      if (t < f.t) {
        const r = hermite5v(this.handC, scale(this.dir, this.vHand), Z, f.p, f.v, Z, f.t - S.t, since / (f.t - S.t));
        hand = r.p; vel = r.v;
      } else if (t < tEnd) {
        const r = hermite5v(f.p, f.v, Z, to.hand, this.endVel, Z, tEnd - f.t, (t - f.t) / (tEnd - f.t));
        hand = r.p; vel = r.v;
      } else hand = to.hand;
      // (the head's flight back off the surface: a turn the other way through the swing plane, as quick as the
      // rebound — its angle rising as 1 − e^(−τ/τr), leaving at the rebound's own angular speed — then eased on to
      // ready's)
      const tau = Math.max(0, since - S.dwell);
      const wr = S.restitution * this.vContact / T.reach;
      const back = clamp(wr * 0.13, 0.2, 1.0), tr = back / Math.max(wr, 1e-3);
      const flung = rotateAxis(this.shaft, this.axis, -back * (1 - Math.exp(-tau / tr)) * (1 - k));
      shaft = slerpDir(flung, to.shaft, k);
      swing = 1;
      // (and never back into the surface while the hand follows through: turned back out as far as it went in)
      const h0 = add(hand, scale(shaft, T.reach));
      const into = dot(sub(h0, S.at), scale(S.normal, -1)) + T.headR;
      if (into > 0) shaft = rotateAxis(shaft, this.axis, -Math.asin(Math.min(1, into / T.reach)) * 1.05);
    }
    const head = add(hand, scale(shaft, T.reach));
    return { phase, hand, shaft, head, vel, coil, swing, settle, press, since };
  }
  // (the hang starts a little short of the top, along the line from ready)
  private get hangStart(): V3 { return add(this.s.top, scale(sub(this.ready.hand, this.s.top), 0.12)); }

  /** the chain through the downswing: each link `lag` of it after the one before, eased through its own share */
  chain(st: StrokeState): ChainPhase {
    const lag = this.s.lag ?? 0.1;
    const s = st.phase === 'down' ? st.swing : st.since >= 0 ? 1 : 0;
    const link = (i: number) => minJerk(clamp((s - (i - 2) * lag) / (1 - 2 * lag), 0, 1));
    // (the hips lead from before the top: a good stroke starts in the legs while the hands are still going up)
    return { hips: link(0), trunk: link(1), shoulder: link(2), elbow: link(3), wrist: link(4) };
  }
}

/** a sequence of strokes on one clock: which one is going on at t, from where, to where */
export class Strokes {
  readonly list: Stroke[];
  /** rest at ready between two strokes only when there's at least this long to (s); less, and the hand flows through */
  static REST = 0.3;
  constructor(specs: StrokeSpec[], tool: Implement, readonly rest: { hand: V3; shaft: V3 }) {
    this.list = specs.map((s) => new Stroke(s, tool)).sort((a, b) => a.s.t - b.s.t);
    // where each stroke's way back meets the next one's rise, and how fast the hand is going through the ready there
    for (let i = 0; i + 1 < this.list.length; i++) {
      const a = this.list[i], b = this.list[i + 1];
      const e = a.ends, r = b.begins;
      if (r - e >= Strokes.REST) continue;
      const tm = (e + r) / 2;
      a.endAt = tm; b.riseAt = tm;
      // (on through the ready: along the way from the follow's end up to the next top)
      const f = a.followEnd, tTop = b.s.t - b.s.down;
      const v = scale(sub(b.s.top, f.p), 0.75 / Math.max(0.05, tTop - f.t));
      a.endVel = v; b.riseVel = v;
    }
  }
  at(t: number): { st: StrokeState; stroke: Stroke; index: number } {
    const L = this.list;
    // the stroke whose span holds t: from the previous one's end to its own
    let i = L.findIndex((k) => t < k.ends);
    if (i < 0) i = L.length - 1;
    const k = L[i];
    // (from the last one's ready — it's where that one ends — to its own ready, where the next rises from)
    const from = i > 0 ? L[i - 1].ready : this.rest;
    return { st: k.at(t, from, k.ready), stroke: k, index: i };
  }
}

/** a hand's goal for holding the implement in a hammer grip at the stroke's state: the shaft leaves the fist on the
 *  thumb's side toward the head; the forearm's way is the arm's (from the shoulder), square to the shaft. `right`: the
 *  right hand (the thumb is fwd × palm-normal); `shoulder` the arm's root, for the forearm's way */
export function gripGoal(st: { hand: V3; shaft: V3 }, shoulder: V3, right: boolean, o: { curl?: number; elbow?: V3; elbowW?: number; turn?: number; axis?: V3 } = {}): HandGoal {
  const U = st.shaft;
  // the forearm's way: from the shoulder's side of the hand, square to the shaft — and, given the swing plane's axis,
  // leaning on the plane's own square to the shaft (the forearm turns with the shaft in a stroke), which is what holds
  // it when the shaft passes in line with the arm (where the shoulder's way alone flips over)
  let F = rej(sub(st.hand, shoulder), U);
  if (o.axis) F = add(scale(F, 2.5), rej(cross(o.axis, U), U));
  if (len(F) < 1e-4) F = rej([0, 1, 0], U);
  F = norm(F);
  // the palm's normal: thumb = F × D (right) or D × F (left) must be the shaft's way
  const D = right ? norm(cross(U, F)) : norm(cross(F, U));
  // the knuckles' line a little ahead of the shaft and toward the back of the hand (the shaft in the curled fingers)
  const knuckles = add(st.hand, add(scale(F, 0.018), scale(D, -0.028)));
  return { palm: knuckles, knuckles, fwd: F, down: D, tips: [null, null, null, null, null], curl: o.curl ?? 0.9, grip: 1, exact: true,
    elbow: o.elbow, elbowW: o.elbowW, turn: o.turn };
}
