// Playing an instrument: what an instrument offers a player (where to sit, the point each note is pressed at, which
// notes are sounding) and the pianist's mind that turns the notes into her hands — which hand plays what (the low
// notes the left, the high the right, split where they part), where each hand sits over the keys (it stays put while
// its fingers can reach, and moves when a note is out of its span), which finger takes which note (by the hand's
// natural spacing, thumb inward), each pressing finger's tip down with its key, the rest resting curled over the keys;
// the right foot on the sustain pedal. With a score (her playing the piece by herself) the hands also look ahead and
// move to the next notes before they're struck. Getting up, she rises and sidesteps out past an end of the seat
// (one with room round it), so she's never left standing in the furniture. The grand piano is one
// instrument; anything else exposing a Playable (a keyboard, a marimba — strings would add their own "press" points) is
// played the same way.
//
// On a score's clock (playScore(score, { clock })): the whole piece is planned once instead — every note a hand and a
// finger (a chord too wide for one hand shares its outer note with the other; a note neither can reach is still given
// a finger and listed in `simplified`, never dropped), each hand's travel from the score's look-ahead so it's there
// before the note, and every finger's height a stroke on the clock (strike.ts's anticipation, contact and release at a
// finger's scale): over its key, a fall that quickens onto it landing on the note's second, through the key's travel,
// up as it's let go — and a key struck again let up first, so a repeated note or chord is struck on its beat. The
// pose is then a function of the clock's second, not of the frames before it: the caller schedules the sound ahead
// on the audio clock (`struck` says which finger lands when) and a frame shows the finger on the key it hears.
//
// (@ericrius1/cast: Boulder's hero/perform.ts, its Performer named Pianist here — `Performer` is kept as an alias — and
// the piano, sound and score it reads given as the shapes it needs of them, so any project's keyboard can be one.)
import { type V3, add, sub, scale, dot, norm, clamp, lerp, damp, cdSpring } from './math.js';
import type { SeatPose, HandGoal } from './rig.js';

/** a piece's notes on its own clock (s): each struck at t0, let go at t1 (Boulder's audio/score.ts) */
export interface ScoreNote { note: number; t0: number; t1: number; vel: number; voice?: string }
export interface Score { notes: ScoreNote[]; pedal: { t: number; down: boolean }[]; duration: number }
/** what pianoPlayable reads of a piano's model (Boulder's interior/piano.ts PianoModel): its axes, the way it faces,
 *  the bench's top, the keyboard's middle, the sustain pedal's top, the point a note's key is touched at, where the
 *  player looks */
export interface PianoGeometry {
  axes: { along: V3; toward: V3; up: V3 };
  facing: V3; seat: V3; keyboard: V3; pedalTop: V3; look: V3;
  touch(note: number): V3 | null;
}
/** what it reads of the piano's sound (Boulder's audio/piano.ts GrandPiano): each key's state from A0, the pedal */
export interface PianoSound { state: ArrayLike<number>; pedalState: { sustain: boolean } }

export interface Playable {
  readonly name: string;
  /** where she sits: the pelvis on the seat, the way she faces (yaw), where her feet rest (left, right) */
  seat: { pelvis: V3; yaw: number; feet: [V3, V3] };
  /** where she stands before sitting down (on the floor beside the seat) */
  stand: V3;
  /** where she may step to on getting up (on the floor, clear of the seat and the instrument), the likelier first */
  leave: V3[];
  /** the point a fingertip presses for a note (at rest), the way a press goes, how deep */
  notePoint(note: number): V3 | null;
  pressDir: V3;
  pressDepth: number;
  /** what's sounding: per note from `low` (0..1) */
  state: ArrayLike<number>;
  low: number; high: number;
  /** the instrument's axes: along its keys (low to high), toward the player, up */
  axes: { along: V3; toward: V3; up: V3 };
  /** where she looks */
  look: V3;
  /** the sustain pedal under her right foot: how far it's down */
  pedal?: () => number;
}

/** the grand piano as a Playable: the bench, the keys' tops, the sounding notes, the sustain pedal */
export function pianoPlayable(m: PianoGeometry, piano: PianoSound): Playable {
  const A = m.axes;
  const yaw = Math.atan2(-m.facing[0], -m.facing[2]);
  // (the pelvis a little forward on the bench, its hips ~9 cm over the seat; the feet below the keys, the right on
  // the sustain pedal; she stands to sit between the bench and the keys)
  const floor = (p: V3): V3 => [p[0], m.seat[1] - 0.5, p[2]];
  const pelvis = add(add(m.seat, scale(A.up, 0.125)), scale(A.toward, -0.06));
  const left = floor(add(add(m.keyboard, scale(A.along, -0.17)), scale(A.toward, 0.12)));
  const right: V3 = add(m.pedalTop, scale(A.toward, 0.07));
  return {
    name: 'piano',
    seat: { pelvis, yaw, feet: [left, right] },
    stand: floor(sub(m.seat, scale(A.toward, 0.2))),
    // (past the bench's ends — it's 0.78 m long: 0.8 m from its middle clears it by a body's width — the bass end first:
    // a grand's lid opens over the treble side)
    leave: [-1, 1].map((s) => floor(add(m.seat, scale(A.along, s * 0.8)))),
    notePoint: (n) => (n >= 21 && n <= 108 ? m.touch(n) : null),
    pressDir: scale(A.up, -1),
    pressDepth: 0.0095,
    state: piano.state,
    low: 21, high: 108,
    axes: A,
    look: m.look,
    pedal: () => (piano.pedalState.sustain ? 1 : 0),
  };
}

/** finger rest offsets along the keys from the hand's centre (thumb to pinky), for the right hand (the left mirrored) */
const SPREAD = [-0.05, -0.024, 0, 0.0235, 0.046];
/** on a clock: where a hand's fingertips rest from its palm's middle along the keys (thumb to pinky, the right hand: a
 *  white key apiece, the thumb a little further), a hover over a key, its fall (s), how far ahead of the fall a finger
 *  goes over its key (s), its lift between strokes (s), how far ahead of its note a hand is in place (s), the longest a
 *  hand moves for (s), the widest chord one hand takes (m: an octave and a white key — the hand's own solve, fingers.ts,
 *  says what it reaches), the pad's thickness under the tip's joint (m), how far ahead of its note's second a stroke
 *  lands (s), how much nearer the player a thumb plays a white key (m: it's the short finger), and how much a resting
 *  finger's hover over its place counts against the playing ones (HandGoal.tipW) */
const SLOTS = [-0.05, -0.0245, 0, 0.0235, 0.046];
const HOVER = 0.014, FALL = 0.1, REACH = 0.2, LIFT = 0.075, TRAVEL_END = 0.08, TRAVEL_MAX = 0.3, SPAN = 0.19, PAD = 0.004, LAND = 0.004;
const THUMB_IN = 0.012, DEEP = 0.015, REST_W = 0.15;
/** finger choices for a chord of n notes (thumb first): every rising run of n of the five */
const RUNS: number[][][] = [0, 1, 2, 3, 4, 5].map((n) => {
  const out: number[][] = [];
  const go = (from: number, cur: number[]) => { if (cur.length === n) { out.push(cur); return; } for (let f = from; f < 5; f++) go(f + 1, [...cur, f]); };
  go(0, []);
  return out;
});

/** a scored note as a clocked pianist plays it: its hand (0 left) and finger (0 thumb .. 4 pinky), its key's place
 *  along the keyboard, its stroke's landing (t0, the note's second), and when the finger lets it go (`up`: its hold,
 *  cut short to lift before that finger's next stroke) */
export interface Struck { note: number; t0: number; t1: number; hand: 0 | 1; finger: number; x: number; up: number }

interface HandPlan { x: number; xv: number; notes: Map<number, number> }

export class Pianist {
  inst: Playable | null = null;
  /** how far she's sat down (0..1), and whether she's on her way to the seat or getting up */
  w = 0;
  state: 'idle' | 'approach' | 'seated' | 'leaving' = 'idle';
  /** a piece she plays by herself: the score, its clock, what's been struck */
  private score: Score | null = null;
  private scoreT = 0;
  private scoreNext = 0;
  /** the score's notes struck and not yet let go: when (on the score's clock) */
  private offs: { t: number; note: number }[] = [];
  private pedalNext = 0;
  private hands: HandPlan[] = [{ x: -0.18, xv: 0, notes: new Map() }, { x: 0.12, xv: 0, notes: new Map() }];
  private tipDown = new Float32Array(128);
  private approachFrom: V3 | null = null;
  private approachYaw = 0;
  private t = 0;
  /** how freely she could walk off from a spot (the more ways open round it, the higher; 0 inside something): set by
   *  whoever knows the walls and the furniture */
  freedom: ((p: V3) => number) | null = null;
  /** the way with the longest clear walk from a spot, near a preferred yaw (katara.ts asks the house's collider) */
  openHeading: ((p: V3, prefer: number) => number) | null = null;
  /** getting up: from where she was to where she steps, the way she faces, and how far she's gone (0..1) */
  private leaveFrom: V3 | null = null;
  private leaveTo: V3 | null = null;
  private leaveYaw = 0;
  /** getting up: the way she turns to as she steps out (the clearest from where she lands) */
  private leaveOut = 0;
  private out = 0;
  /** where the palm sits from the press line: toward her, and up (m) */
  reach: [number, number] = [0.01, 0.038];
  /** the palm's place for a hand of this length (wrist to the middle fingertip, m): the knuckles a curved finger's
   *  reach in front of where the fingertips press and a little over the keys, as real players' hands sit (fits of our
   *  hand to tracked footage of pianists, World's tools/hands/fit.mjs: from above the fingers lie long, the knuckles
   *  well back from the black keys) — for a built hand (HeroHeader.hand); bodies without one keep the default */
  forHand(len: number) { this.reach = [0.4 * len, 0.3 * len]; this.pitch = 0.36; this.idleHover = 0.004; this.hover = 0.008; this.fingerIn = [0, 0.014, 0.024, 0.018, 0.006]; return this; }
  /** how high a finger with nothing to play rides over the white keys' tops (m; real players' idle fingers stay low,
   *  within about a centimetre of the keys, and move with their neighbours) */
  idleHover = HOVER;
  /** how high a finger waits over its next key before it falls (m) */
  hover = HOVER;
  /** how much further in (toward the fallboard) each finger plays a white key than the press line (m, thumb first):
   *  the long fingers reach further in than the thumb, so they needn't curl under to land on its line (real players'
   *  fingers lie long across the keys: World tools/hands/planstats.mjs) */
  fingerIn = [0, 0, 0, 0, 0];
  /** the hand's way from the wrist to the knuckles, up from level (as a slope: -0.18, a little down, the default; a
   *  built hand's rises, the knuckles over the wrist as a pianist's arched hand is) */
  pitch = -0.18;
  /** the widest a hand holds at once, thumb to pinky along the keys (m: about a seventh; past it the older notes ring on
   *  under the pedal: the fingers' stretch, not the hand's size, is the limit — scored) */
  span = 0.135;
  /** how far each hand may tilt about its own way to ease the arm (rad; hero/rig.ts HandGoal.turn) */
  turn = 0.3;
  /** when each note's key went down (or it first came up in the score's look-ahead): the newest are the hand's */
  private onAt = new Float32Array(128).fill(-1);
  /** each hand's correction (closed loop: what its pressing fingertips missed by, fed back into where the hand sits) */
  private fix: V3[] = [[0, 0, 0], [0, 0, 0]];
  /** the fingertip targets planned this frame, per hand (thumb .. pinky), and the palms */
  planned: (V3 | null)[][] = [[null, null, null, null, null], [null, null, null, null, null]];
  palms: V3[] = [[0, 0, 0], [0, 0, 0]];
  /** play a note (the score's), and release it */
  noteOn: ((note: number, vel: number) => void) | null = null;
  noteOff: ((note: number) => void) | null = null;
  pedalSet: ((down: boolean) => void) | null = null;
  /** on a clock (playScore's `clock`): the piece as planned — every note's stroke; any note that had to be simplified
   *  (said, never dropped); which fingers have a key to play this frame (only these steer the palm) */
  struck: Struck[] = [];
  simplified: string[] = [];
  active: boolean[][] = [[false, false, false, false, false], [false, false, false, false, false]];
  private clock: (() => number) | null = null;
  private byFinger: Struck[][][] = [[[], [], [], [], []], [[], [], [], [], []]];
  private path: { t: number; x: number }[][] = [[], []];

  sit(inst: Playable, from: V3, yaw: number) {
    this.inst = inst;
    this.state = 'approach';
    this.approachFrom = [...from] as V3;
    this.approachYaw = yaw;
    this.t = 0;
    const c = this.centre();
    this.hands[0].x = c - 0.2; this.hands[1].x = c + 0.14;
  }
  stand() {
    if (this.state === 'idle' || this.state === 'leaving') return;
    const b = this.body()!;
    this.leaveFrom = b.pos;
    this.leaveYaw = b.yaw;
    this.leaveTo = this.away();
    const step = Math.atan2(-(this.leaveTo[0] - b.pos[0]), -(this.leaveTo[2] - b.pos[2]));
    this.leaveOut = this.openHeading?.(this.leaveTo, step) ?? step;
    this.out = 0;
    this.state = 'leaving';
    this.stopScore();
  }

  /** where to step on getting up: the first of the instrument's spots with room enough round it, else the most open
   *  of them, or back where she came from (through the seat) only if that's more open still by a way */
  private away(): V3 {
    const I = this.inst!;
    const spots = this.approachFrom ? [...I.leave, this.approachFrom] : [...I.leave];
    let best = spots[0], most = -1;
    for (const p of spots) {
      const f = (this.freedom?.(p) ?? 16) - (p === this.approachFrom ? 3 : 0);
      if (f >= 5 && p !== this.approachFrom) return p;
      if (f > most) { most = f; best = p; }
    }
    return best;
  }

  /** let her play a piece by herself: by default its times from now, on the frames' dt; with `clock` (the score's second
   *  now: an audio transport's, a film's), planned whole and posed from the clock (sit() first: it needs the keys) */
  playScore(score: Score, o: { clock?: () => number } = {}) {
    this.score = score; this.scoreT = -0.6; this.scoreNext = 0; this.pedalNext = 0;
    this.clock = o.clock ?? null;
    this.struck = [];
    if (this.clock) this.planScore(score);
  }
  stopScore() {
    if (!this.score) return;
    this.offs.length = 0;
    for (let n = 21; n <= 108; n++) this.noteOff?.(n);
    this.pedalSet?.(false);
    this.score = null;
    // (and off the clock: the hands back on the frames' dt, not miming the rest of the piece unheard)
    this.clock = null;
    this.struck = [];
  }
  get playingScore() { return !!this.score; }

  /** the keyboard's middle, as a coordinate along it */
  private centre() {
    const I = this.inst!;
    const p = I.notePoint(60) ?? I.look;
    return dot(p, I.axes.along);
  }

  /** getting up, the way she'll face once out (null otherwise) */
  get rising(): number | null { return this.state === 'leaving' ? this.leaveOut : null; }

  /** her root while sitting down or getting up (null: she's free), her facing */
  body(): { pos: V3; yaw: number } | null {
    const I = this.inst;
    if (!I || this.state === 'idle') return null;
    if (this.state === 'leaving' && this.leaveFrom && this.leaveTo) {
      // (a sidestep, facing the instrument, then turning to the way out: up again, the view behind her looks out, not
      // back at the keys)
      const a = this.leaveFrom, b = this.leaveTo, e = this.out * this.out * (3 - 2 * this.out);
      const d = Math.atan2(Math.sin(this.leaveOut - this.leaveYaw), Math.cos(this.leaveOut - this.leaveYaw));
      const turn = clamp((this.out - 0.4) / 0.6, 0, 1);
      return { pos: [lerp(a[0], b[0], e), lerp(a[1], b[1], e), lerp(a[2], b[2], e)], yaw: this.leaveYaw + d * turn * turn * (3 - 2 * turn) };
    }
    const k = this.state === 'approach' ? clamp(this.t / 0.7, 0, 1) : 1;
    const from = this.approachFrom ?? I.stand;
    const e = k * k * (3 - 2 * k);
    const yaw = this.approachYaw + Math.atan2(Math.sin(I.seat.yaw - this.approachYaw), Math.cos(I.seat.yaw - this.approachYaw)) * e;
    return { pos: [lerp(from[0], I.stand[0], e), lerp(from[1], I.stand[1], e), lerp(from[2], I.stand[2], e)], yaw };
  }

  /** this frame: the score's notes, the sit's weight, and the pose (null when she's not at an instrument) */
  update(dt: number, audioNow: number): SeatPose | null {
    const I = this.inst;
    if (!I || this.state === 'idle') return null;
    this.t += dt;
    if (this.state === 'approach' && this.t > 0.55) this.w = Math.min(1, this.w + dt / 0.75);
    if (this.state === 'approach' && this.w >= 1) this.state = 'seated';
    if (this.state === 'leaving') {
      this.w = Math.max(0, this.w - dt / 0.6);
      // (most of the way up, she steps out)
      if (this.w < 0.45) this.out = Math.min(1, this.out + dt / 0.6);
      if (this.w <= 0 && this.out >= 1) { this.state = 'idle'; this.inst = null; return null; }
    }
    const clocked = this.clock && this.struck.length ? this.clock() : null;
    if (this.score && this.state === 'seated') this.stepScore(dt, audioNow, clocked);
    return { pelvis: I.seat.pelvis, yaw: I.seat.yaw, feet: I.seat.feet, hands: clocked !== null ? this.planAt(clocked) : this.plan(dt), look: I.look, lean: 0.2, w: this.w };
  }

  private stepScore(dt: number, now: number, clocked: number | null = null) {
    const S = this.score!;
    this.scoreT = clocked ?? this.scoreT + dt;
    while (this.scoreNext < S.notes.length && S.notes[this.scoreNext].t0 <= this.scoreT) {
      const n = S.notes[this.scoreNext++];
      this.noteOn?.(n.note, n.vel);
      // (let go on the score's own clock, as it was struck: a slow frame or the pause holds it with the rest)
      this.offs.push({ t: n.t0 + Math.max(0.06, n.t1 - n.t0), note: n.note });
    }
    for (let i = this.offs.length - 1; i >= 0; i--) if (this.offs[i].t <= this.scoreT) { this.noteOff?.(this.offs[i].note); this.offs.splice(i, 1); }
    // (the index moved outside the call: inside `pedalSet?.(…)` it was skipped with no callback, and this looped forever)
    while (this.pedalNext < S.pedal.length && S.pedal[this.pedalNext].t <= this.scoreT) { const p = S.pedal[this.pedalNext++]; this.pedalSet?.(p.down); }
    if (this.scoreT > S.duration) this.stopScore();
    void now;
  }

  /** the fingertips as the rig put them (per hand, thumb .. pinky): what the pressing ones missed by moves the hand */
  feedback(actual: (V3 | null)[][], dt: number) {
    for (let h = 0; h < 2; h++) {
      let n = 0;
      const e: V3 = [0, 0, 0];
      for (let f = 0; f < 5; f++) {
        const want = this.planned[h][f], got = actual[h][f];
        if (!want || !got || (this.clock && !this.active[h][f])) continue;
        e[0] += want[0] - got[0]; e[1] += want[1] - got[1]; e[2] += want[2] - got[2];
        n++;
      }
      const F = this.fix[h];
      // (on a clock slower and further: the hand's place is planned, and a quick correction against the rig's own lag
      // swings — tools measured 3/s best)
      const gain = this.clock ? 3 : 12, lim = this.clock ? 0.05 : 0.035;
      const k = n ? 1 - Math.exp(-dt * gain) : 1 - Math.exp(-dt * 2);
      for (let i = 0; i < 3; i++) F[i] = clamp(n ? F[i] + (e[i] / n) * k : F[i] * (1 - k), -lim, lim);
    }
  }

  /** the notes the hands are to play now: what's sounding, and with a score what's coming within a beat; each with when
   *  it came (`at`: the coming ones count as newest) */
  private targets(): { note: number; down: number; soon: number; at: number }[] {
    const I = this.inst!;
    const out: { note: number; down: number; soon: number; at: number }[] = [];
    for (let n = I.low; n <= I.high; n++) {
      const s = I.state[n - I.low];
      if (s > 0.02) {
        if (this.onAt[n] < 0) this.onAt[n] = this.t;
        out.push({ note: n, down: s, soon: 0, at: this.onAt[n] });
      } else this.onAt[n] = -1;
    }
    const S = this.score;
    if (S) {
      for (let k = this.scoreNext; k < S.notes.length && S.notes[k].t0 < this.scoreT + 0.35; k++) {
        const n = S.notes[k];
        if (!out.some((o) => o.note === n.note)) out.push({ note: n.note, down: 0, soon: 1 - (n.t0 - this.scoreT) / 0.35, at: this.t + 1 });
      }
    }
    return out;
  }

  /** what one hand holds: the newest of its notes that fit its span (older ones held longer than a hand can stretch
   *  — the bass note under the chord, a melody note left ringing — sound on under the pedal, the fingers gone on) */
  private holdable<T extends { x: number; at: number }>(G: T[]): T[] {
    if (G.length < 2 || G[G.length - 1].x - G[0].x <= this.span) return G;
    const byNew = [...G].sort((a, b) => b.at - a.at);
    const keep: T[] = [];
    let lo = Infinity, hi = -Infinity;
    for (const t of byNew) {
      const l = Math.min(lo, t.x), h = Math.max(hi, t.x);
      if (keep.length && h - l > this.span) continue;
      keep.push(t); lo = l; hi = h;
    }
    return keep.sort((a, b) => a.x - b.x);
  }

  /** the hands' goals: each hand's place over the keys and each finger's tip */
  private plan(dt: number): [HandGoal, HandGoal] {
    const I = this.inst!, A = I.axes;
    const tg = this.targets();
    // which hand: below the split the left, above it the right — the split where the notes part (a gap), else middle C
    const xs = tg.map((t) => ({ ...t, x: dot(I.notePoint(t.note)!, A.along) })).sort((a, b) => a.x - b.x);
    let split = this.centre();
    if (xs.length >= 2) {
      let gap = 0;
      for (let i = 1; i < xs.length; i++) { const g = xs[i].x - xs[i - 1].x; if (g > gap) { gap = g; split = (xs[i].x + xs[i - 1].x) / 2; } }
      // (one hand can't span more than about a ninth: a cluster wider than that is two hands anyway)
      if (gap < 0.04 && xs[xs.length - 1].x - xs[0].x < 0.2) split = xs[0].x > this.centre() ? xs[0].x - 1 : xs[xs.length - 1].x + 1;
    } else if (xs.length === 1) split = xs[0].x < this.centre() ? xs[0].x + 0.5 : xs[0].x - 0.5;
    const groups = [this.holdable(xs.filter((t) => t.x < split)), this.holdable(xs.filter((t) => t.x >= split))];
    const goals: HandGoal[] = [];
    for (let h = 0; h < 2; h++) {
      const H = this.hands[h], G = groups[h];
      const side = h === 0 ? -1 : 1;
      // fingers: each note to the finger whose resting place is nearest, in order along the keys (thumb inward)
      const tips: (V3 | null)[] = [null, null, null, null, null];
      const order = side > 0 ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
      const rest = order.map((f) => H.x + SPREAD[f] * side);
      const fingerOf: number[] = [];
      let fj = 0;
      for (const t of G) {
        while (fj < 4 && Math.abs(rest[fj + 1] - t.x) < Math.abs(rest[fj] - t.x)) fj++;
        fingerOf.push(fj);
        fj = Math.min(4, fj + 1);
      }
      // the hand: over its notes so each finger's resting place is over the note it takes (quickly when a note is out of
      // the fingers' reach from where it is, gently while they can reach: the hand settles over the chord); no notes, it
      // drifts back to its resting place beside the middle
      if (G.length) {
        const lo = G[0].x, hi = G[G.length - 1].x;
        const span = [H.x + SPREAD[0] * (side > 0 ? 1 : -1), H.x + SPREAD[4] * (side > 0 ? 1 : -1)].sort((a, b) => a - b);
        const out = lo < span[0] - 0.004 || hi > span[1] + 0.004;
        let fit = 0;
        G.forEach((t, i) => { fit += t.x - SPREAD[order[fingerOf[i]]] * side; });
        fit /= G.length;
        // (a chord wider than the resting spread: centred on it, the fingers spread to it)
        const want = hi - lo > SPREAD[4] - SPREAD[0] ? (lo + hi) / 2 : fit;
        [H.x, H.xv] = cdSpring(H.x, H.xv, want, out ? 38 : 14, dt);
      } else {
        [H.x, H.xv] = cdSpring(H.x, H.xv, this.centre() + (h === 0 ? -0.2 : 0.14), 4, dt);
      }
      let fi = 0;
      for (const t of G) {
        fi = fingerOf[G.indexOf(t)];
        const f = order[fi];
        const p = I.notePoint(t.note)!;
        // (down with its key; a note about to be struck hovers its finger just over it)
        const k = this.tipDown[t.note] = damp(this.tipDown[t.note], t.down, t.down > this.tipDown[t.note] ? 60 : 25, dt);
        const lift = t.down > 0 ? 0 : 0.012 * (1 - t.soon);
        tips[f] = add(add(p, scale(I.pressDir, I.pressDepth * k)), scale(A.up, lift + 0.004));
      }
      // the palm: just in front of where the fingers press, its middle finger's line, a few cm over the white keys
      const mid = I.notePoint(60)!;
      const base = add(add(mid, scale(A.along, H.x - dot(mid, A.along))), scale(A.toward, this.reach[0]));
      const palm = add(add(base, scale(A.up, this.reach[1])), this.fix[h]);
      this.planned[h] = tips;
      this.palms[h] = palm;
      const fwd = norm(add(scale(A.toward, -1), scale(A.up, this.pitch)));
      // (the hand may tilt a little about its own way, as a pianist's does, to ease a forearm at its full turn)
      goals.push({ palm, fwd, down: scale(A.up, -1), tips, turn: this.turn });
    }
    return [goals[0], goals[1]];
  }

  // ---------------------------------------------------------------- on a score's clock

  private along(n: number): number { return dot(this.inst!.notePoint(n)!, this.inst!.axes.along); }
  /** a key that stands over the others (a black key: its touch point higher than middle C's) */
  private black(n: number): boolean { const I = this.inst!, m = I.notePoint(60)!, p = I.notePoint(n); return !!p && dot(sub(p, m), I.axes.up) > 0.004; }

  /** the whole piece planned: hands, fingers, strokes, each hand's places */
  private planScore(score: Score) {
    const I = this.inst;
    if (!I) throw new Error('Pianist: sit() before playScore() on a clock');
    this.simplified = [];
    const notes = score.notes.filter((n) => I.notePoint(n.note));
    for (const n of score.notes) if (!I.notePoint(n.note)) this.simplified.push(`${n.t0.toFixed(2)} ${n.note}: off the keyboard`);
    // (chords: notes struck within 30 ms of each other)
    const events: ScoreNote[][] = [];
    for (const n of [...notes].sort((a, b) => a.t0 - b.t0 || a.note - b.note)) {
      const e = events[events.length - 1];
      if (e && n.t0 - e[0].t0 < 0.03) e.push(n); else events.push([n]);
    }
    const c = this.centre(), split = c - 0.012;
    // (each hand starts over its first notes: nothing to travel for the first chord)
    const first = (left: boolean) => { const n = notes.find((x) => (this.along(x.note) < split) === left); return n ? this.along(n.note) - SLOTS[2] * (left ? -1 : 1) : left ? c - 0.2 : c + 0.14; };
    const last = [first(true), first(false)];
    this.path = [[{ t: -Infinity, x: last[0] }], [{ t: -Infinity, x: last[1] }]];
    const struck: Struck[] = [];
    type O = { n: ScoreNote; x: number };
    const width = (g: O[]) => (g.length ? g[g.length - 1].x - g[0].x : 0);
    for (const e of events) {
      const xs: O[] = e.map((n) => ({ n, x: this.along(n.note) })).sort((a, b) => a.x - b.x);
      // which hand: below middle C the left; a hand that can't span its share gives its outer note to the other if that
      // one then can
      const H: O[][] = [xs.filter((o) => o.x < split), xs.filter((o) => o.x >= split)];
      for (let k = 0; k < 4; k++) {
        if (width(H[0]) > SPAN && width([...H[1], H[0][H[0].length - 1]].sort((a, b) => a.x - b.x)) <= SPAN) H[1].unshift(H[0].pop()!);
        else if (width(H[1]) > SPAN && width([H[1][0], ...H[0]].sort((a, b) => a.x - b.x)) <= SPAN) H[0].push(H[1].shift()!);
      }
      for (const h of [0, 1] as const) {
        const G = H[h];
        if (!G.length) continue;
        if (width(G) > SPAN) this.simplified.push(`${G[0].n.t0.toFixed(2)} ${G.map((o) => o.n.note).join(',')}: wider than a hand, stretched for`);
        const side = h === 0 ? -1 : 1, cur = last[h];
        // the fingers: of every rising run of fingers (thumb inward), the one whose resting places best fit the notes
        // with the hand where it is — or, if none fits there within a finger's stretch, where the hand moves least to
        // fit them (a chord: its notes spread to the fingers that span it; a single note: the nearest finger)
        const ord = side > 0 ? G : [...G].reverse();
        let fs: number[] = [], x = cur, best = Infinity;
        for (const run of RUNS[Math.min(5, ord.length)]) {
          // (where the hand would sit for this run: each finger's place over its note, on average)
          const at = ord.reduce((m, o, i) => m + o.x - SLOTS[run[i]] * side, 0) / ord.length;
          // (staying put if every finger's within 1.5 cm of its note from here; else the move counts)
          const stay = ord.every((o, i) => Math.abs(cur + SLOTS[run[i]] * side - o.x) < 0.015), from = stay ? cur : at;
          // (each finger's stretch from its resting place to its note: a little free, then dearer than moving the hand)
          let stretch = 0;
          ord.forEach((o, i) => { stretch += Math.max(0, Math.abs(o.x - SLOTS[run[i]] * side - from) - 0.006); });
          // (and the thumb and the little finger, the short ones, kept off the black keys if they can be)
          let short = 0;
          ord.forEach((o, i) => { if ((run[i] === 0 || run[i] === 4) && this.black(o.n.note)) short += 0.03; });
          const cost = (stay ? 0 : 0.02 + Math.abs(at - cur)) + 2 * stretch + short + (ord.length === 1 && (run[0] === 0 || run[0] === 4) ? 0.004 : 0);
          if (cost < best) { best = cost; fs = run; x = stay ? cur : at; }
        }
        if (side < 0) fs = [...fs].reverse();
        if (x !== cur) this.path[h].push({ t: G[0].n.t0, x });
        last[h] = x;
        G.forEach((o, i) => struck.push({ note: o.n.note, t0: o.n.t0, t1: o.n.t1, hand: h, finger: fs[i], x: o.x, up: o.n.t1 }));
      }
    }
    // (each finger's strokes in order; a hold cut short so the finger's up before its next fall)
    this.byFinger = [[[], [], [], [], []], [[], [], [], [], []]];
    for (const st of struck.sort((a, b) => a.t0 - b.t0)) this.byFinger[st.hand][st.finger].push(st);
    for (const H of this.byFinger) for (const F of H) for (let i = 0; i + 1 < F.length; i++) {
      const a = F[i], b = F[i + 1];
      // (to another key, a whole lift's time to go over; the same key again, most of one)
      a.up = Math.max(a.t0 + 0.03, Math.min(a.t1, b.t0 - FALL - LIFT * (a.note === b.note ? 0.6 : 1)));
    }
    this.struck = struck;
  }

  /** a hand's centre at second s: eased from one place to the next, arriving TRAVEL_END before the note it's for */
  private handAt(h: number, s: number): number {
    const P = this.path[h];
    let i = 0;
    while (i + 1 < P.length && P[i + 1].t - TRAVEL_END <= s) i++;
    const a = P[i], b = P[i + 1];
    if (!b) return a.x;
    const end = b.t - TRAVEL_END, start = Math.max(Number.isFinite(a.t) ? a.t + 0.02 : -Infinity, end - TRAVEL_MAX);
    if (s <= start) return a.x;
    const u = clamp((s - start) / Math.max(1e-3, end - start), 0, 1);
    return lerp(a.x, b.x, u * u * (3 - 2 * u));
  }

  /** a finger's stroke at second s: its note (null: resting) and its tip's height over the key's top (m) */
  private stroke(h: number, f: number, s: number): { st: Struck | null; dy: number; from: Struck | null; u: number; w: number } {
    let st: Struck | null = null, pv: Struck | null = null;
    // (the next stroke takes the finger only once this one's let go: never before it's landed)
    for (const x of this.byFinger[h][f]) { if (x.t0 - FALL - REACH > s || (st && s < st.up)) break; pv = st; st = x; }
    if (!st) return { st: null, dy: this.idleHover, from: null, u: 1, w: REST_W };
    const D = this.inst!.pressDepth;
    // (it lands LAND before the note's second: a rig's fingertip follows its goal about a frame behind)
    const t0 = st.t0 - LAND;
    if (s >= t0) {
      if (s < st.up) return { st, dy: -D * Math.min(1, (s - t0) / 0.012), from: null, u: 1, w: 1 };
      const u = clamp((s - st.up) / LIFT, 0, 1);
      return { st: s - st.up > 0.6 ? null : st, dy: -D + (D + this.hover) * Math.sin((Math.PI / 2) * u), from: null, u: 1, w: 1 };
    }
    // before it lands: from its last key (let go) up, over to this one, a wait at its hover, the fall — each part
    // shortened alike when the notes come too quickly for all of it, never out of order (a finger crossing the keys
    // low, or still on its way over as it falls, is seen on the wrong key)
    const fall = (k: number) => { const u = clamp((t0 - s) / (FALL * k), 0, 1); return this.hover * (1 - (1 - u) ** 3); };
    if (!pv || s < pv.up) return { st, dy: fall(1), from: null, u: 1, w: 1 };
    const lift = LIFT * (pv.note === st.note ? 0.6 : 1), k = Math.min(1, (t0 - pv.up) / (FALL + lift));
    const a = s - pv.up, rise = lift * 0.5 * k, over = lift * 0.5 * k;
    if (a < rise) return { st, dy: -D + (D + this.hover) * Math.sin((Math.PI / 2) * (a / rise)), from: pv, u: 0, w: 1 };
    if (a < rise + over) { const v = (a - rise) / over; return { st, dy: this.hover, from: pv, u: v * v * (3 - 2 * v), w: 1 }; }
    return { st, dy: fall(k), from: null, u: 1, w: 1 };
  }

  /** the hands' goals at the clock's second s */
  private planAt(s: number): [HandGoal, HandGoal] {
    const I = this.inst!, A = I.axes, mid = I.notePoint(60) ?? I.look;
    const goals: HandGoal[] = [];
    for (let h = 0; h < 2; h++) {
      const side = h === 0 ? -1 : 1, x = this.handAt(h, s);
      const tips: (V3 | null)[] = [null, null, null, null, null], tipW = [1, 1, 1, 1, 1];
      // (the palm as high over the keyboard as the highest key its fingers are on: a black key's top stands over a
      // white's, and a finger can only lift so far over its palm)
      // (a hand with a black key under it plays its white keys further in, between the black ones, as a pianist's does)
      let deep = false;
      for (let f = 0; f < 5; f++) { const st = this.stroke(h, f, s).st; if (st && this.black(st.note)) deep = true; }
      for (let f = 0; f < 5; f++) {
        const { st, dy, from, u, w } = this.stroke(h, f, s);
        this.active[h][f] = !!st;
        // (a finger with nothing to play rests over its place at a hover: left to the rig's curl it sinks below the
        // keys' tops and comes up through them)
        const key = (n: number) => {
          const q = I.notePoint(n)!;
          // (the thumb, the short finger, plays a white key nearer its front — unless the hand's in among the black keys)
          if (dot(sub(q, mid), A.up) >= 0.004) return q;
          return add(q, scale(A.toward, deep ? -Math.max(DEEP, this.fingerIn[f]) : (f === 0 ? THUMB_IN : 0) - this.fingerIn[f]));
        };
        let p = st ? key(st.note) : add(add(mid, scale(A.along, x + SLOTS[f] * side - dot(mid, A.along))), scale(A.toward, -this.fingerIn[f]));
        if (st && from && from.note !== st.note) { const q = key(from.note); p = [q[0] + (p[0] - q[0]) * u, q[1] + (p[1] - q[1]) * u, q[2] + (p[2] - q[2]) * u]; }
        tips[f] = add(p, scale(A.up, PAD + dy));
        tipW[f] = w;
      }
      const base = add(add(mid, scale(A.along, x - dot(mid, A.along))), scale(A.toward, this.reach[0]));
      // (the palm where the pianist would hold it; the hand's solve moves it to its fingers — a black key's height too)
      const palm = add(add(base, scale(A.up, this.reach[1])), this.fix[h]);
      this.planned[h] = tips;
      this.palms[h] = palm;
      // (the hand's own solve places the palm with its fingers, a resting finger keeping clear of the keys' tops)
      goals.push({ palm, fwd: norm(add(scale(A.toward, -1), scale(A.up, this.pitch))), down: scale(A.up, -1), tips, turn: 0, palmFree: 1, tipW,
        floor: { at: mid, n: A.up, clear: 0.006 } });
    }
    return [goals[0], goals[1]];
  }
}

/** (Boulder's name for it) */
export { Pianist as Performer };
