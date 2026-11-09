// The cast's faces: one model of a drawn face for everyone hero.wgsl draws (Katara, Aang, Iroh, the townsfolk). Its
// state is the eyes (blinks, the gaze and its saccades, the lids, eyes shut in a smile), the brows (each end of each,
// drawn together), the mouth (smile, frown, the jaw, the lips spread or rounded or pressed, the teeth, the tongue's
// tip, the lower lip tucked under the teeth, a smirk) and a blush. It's layered, each layer over the last:
//   1. the body's own face (what it's doing: Katara's focus as she bends, Aang's joy dancing), from its rig each frame;
//   2. a mood, held until it's changed: face.mood('worry');
//   3. passing expressions over the mood, each for a while: face.flash('laugh', { hold: 1.4 });
//   4. a sip: the lips part and round to a cup's rim (face.sip, 0..1, set as the cup comes up), or the whole of one
//      (face.drink(sipAt(u)): the lips, the eyes closed while drinking, the content breath out after; sip.ts);
//   5. speech: the visemes of the line being said, on its clock (talk.ts sets face.speech: Speaker.say), the brows
//      lifting on the stressed syllables, the eyes glancing away as a phrase starts.
// The rig hands it the eyes' aim and takes back the state: it poses the face's bones from it (the jaw, the lips, the
// lids, the brows) and HeroMesh.update hands the state to hero.wgsl, which draws the eyes, brows and mouth.
// Deterministic (a seeded random for the blinks and the saccades), so a film's faces are the same every render.
import type { V3 } from './math.js';
import { mouthAt, phraseAt, type Mouth, type Timeline } from './speech.js';
import type { SipShape } from './sip.js';

/** the drawn face's controls: 0..1 unless noted (L / R the character's own left and right) */
export interface FaceParams {
  /** the upper lids: -1 wide open (surprise, fear) .. 0 .. 1 heavy (sleepy, sad, content) */
  lidUp: number;
  /** the lower lids raised: a squint, a smile's cheeks */
  lidLow: number;
  /** the eyes shut in an arch (laughing, delight) */
  happy: number;
  /** the eyes shut (asleep, a slow blink of contentment) */
  shut: number;
  /** each brow's inner and outer end: -1 down .. 1 up */
  browInL: number; browInR: number; browOutL: number; browOutR: number;
  /** the brows drawn together and down (anger, focus) */
  knit: number;
  smile: number;
  frown: number;
  /** the jaw */
  open: number;
  /** the lips spread wide (ee, s) */
  spread: number;
  /** the lips rounded forward (oo, o, w; a pucker) */
  round: number;
  /** the lips pressed together (m b p; holding something back) */
  press: number;
  /** the upper teeth showing */
  teeth: number;
  /** the tongue's tip up behind the teeth (l, th, n), or out (a laugh) */
  tongue: number;
  /** the lower lip under the upper teeth (f, v) */
  tuck: number;
  /** one corner up: -1 the right .. 1 the left */
  smirk: number;
  blush: number;
}
export const FACE_KEYS = ['lidUp', 'lidLow', 'happy', 'shut', 'browInL', 'browInR', 'browOutL', 'browOutR', 'knit', 'smile', 'frown',
  'open', 'spread', 'round', 'press', 'teeth', 'tongue', 'tuck', 'smirk', 'blush'] as const satisfies readonly (keyof FaceParams)[];
type Key = (typeof FACE_KEYS)[number];
const MOUTH_KEYS = ['open', 'spread', 'round', 'press', 'teeth', 'tongue', 'tuck'] as const satisfies readonly (keyof Mouth & Key)[];

/** what the rig and the shader take: the controls, the eyes' closure this frame (a blink or shut), where they look
 *  (head axes: x the face's left, y up, z forward), speech's weight and the stress of the syllable being said */
export interface FaceState extends FaceParams { blink: number; gaze: V3; talk: number; emph: number }

/** an expression: some of the controls, and where it looks off to (yaw, pitch, rad) or a laugh's rhythm (Hz) */
export type Expr = Partial<FaceParams> & { look?: [number, number]; pulse?: number };
export const EXPRESSIONS = {
  neutral: {},
  calm: { smile: 0.25 },
  smile: { smile: 0.75, lidLow: 0.2, browInL: 0.12, browInR: 0.12 },
  grin: { happy: 0, shut: 0, smile: 1, open: 0.3, teeth: 1, spread: 0.45, lidLow: 0.35, browInL: 0.25, browInR: 0.25, browOutL: 0.2, browOutR: 0.2 },
  laugh: { smile: 1, open: 0.55, teeth: 0.9, tongue: 0.35, happy: 0.85, browInL: 0.35, browInR: 0.35, browOutL: 0.15, browOutR: 0.15, pulse: 4.2 },
  giggle: { smile: 0.9, open: 0.18, teeth: 0.8, spread: 0.3, happy: 0.6, browInL: 0.3, browInR: 0.3, pulse: 6 },
  surprise: { happy: 0, shut: 0, open: 0.5, round: 0.55, lidUp: -1, browInL: 0.9, browInR: 0.9, browOutL: 0.75, browOutR: 0.75, smile: 0 },
  awe: { happy: 0, shut: 0, open: 0.28, round: 0.3, lidUp: -0.6, browInL: 0.6, browInR: 0.6, browOutL: 0.45, browOutR: 0.45, smile: 0.3 },
  worry: { happy: 0, shut: 0, browInL: 0.85, browInR: 0.85, browOutL: -0.35, browOutR: -0.35, frown: 0.35, smile: 0, open: 0.05, lidUp: -0.15 },
  sad: { happy: 0, browInL: 0.7, browInR: 0.7, browOutL: -0.55, browOutR: -0.55, frown: 0.7, smile: 0, lidUp: 0.45, look: [0, -0.22] },
  thinking: { happy: 0, shut: 0, smirk: 0.45, press: 0.35, browInL: 0.45, browOutL: 0.5, browInR: -0.25, knit: 0.15, smile: 0.1, look: [0.25, 0.2] },
  angry: { happy: 0, shut: 0, knit: 1, browInL: -0.7, browInR: -0.7, browOutL: 0.15, browOutR: 0.15, frown: 0.45, press: 0.55, lidLow: 0.35, smile: 0 },
  determined: { happy: 0, shut: 0, knit: 0.55, press: 0.45, browInL: -0.3, browInR: -0.3, lidLow: 0.15, smile: 0.05 },
  sleepy: { lidUp: 0.75, smile: 0.2, browInL: -0.1, browInR: -0.1 },
  content: { happy: 0.7, smile: 0.7, browInL: 0.15, browInR: 0.15 },
  shy: { happy: 0, shut: 0, blush: 0.9, smile: 0.45, lidUp: 0.25, browInL: 0.35, browInR: 0.35, look: [-0.25, -0.2] },
  fond: { shut: 0, smile: 0.6, lidUp: 0.2, lidLow: 0.15, browInL: 0.35, browInR: 0.35, browOutL: -0.1, browOutR: -0.1 },
  mischief: { happy: 0, shut: 0, smirk: 0.7, smile: 0.4, browOutL: 0.6, browInR: -0.3, lidLow: 0.35 },
  scared: { happy: 0, shut: 0, lidUp: -0.9, browInL: 1, browInR: 1, browOutL: 0.1, browOutR: 0.1, open: 0.3, spread: 0.6, teeth: 0.7, frown: 0.3, smile: 0 },
  disgust: { happy: 0, frown: 0.5, smirk: -0.4, knit: 0.5, lidLow: 0.5, browInL: -0.4, browInR: -0.2, smile: 0 },
  wince: { knit: 0.6, lidLow: 0.7, lidUp: 0.4, spread: 0.7, teeth: 0.9, open: 0.12, frown: 0.3, smile: 0 },
  proud: { shut: 0, smile: 0.6, lidUp: 0.15, browOutL: 0.2, browOutR: 0.2, look: [0, 0.12] },
} satisfies Record<string, Expr>;
export type ExprName = keyof typeof EXPRESSIONS;

/** the rigs' older face (hero/rig.ts FaceExpr): the controls they're set by */
export interface LegacyExpr { smile?: number; jaw?: number; pucker?: number; frown?: number; brows?: number; tender?: number; browDown?: number; squint?: number; wide?: number; closed?: number }
/** the older face's keys as the drawn face's controls (into out, every key set) */
export function fromLegacy(e: LegacyExpr, out: FaceParams = blank()): FaceParams {
  for (const k of FACE_KEYS) out[k] = 0;
  const jaw = e.jaw ?? 0, b = e.brows ?? 0, t = e.tender ?? 0, d = e.browDown ?? 0, c = e.closed ?? 0;
  out.smile = e.smile ?? 0;
  out.open = Math.max(0, jaw);
  out.press = Math.max(0, -jaw) * 2;
  out.round = e.pucker ?? 0;
  out.frown = e.frown ?? 0;
  out.browInL = out.browInR = b + 0.8 * t - 0.5 * d;
  out.browOutL = out.browOutR = b - 0.3 * t - 0.15 * d;
  out.knit = d;
  out.lidLow = e.squint ?? 0;
  out.lidUp = -(e.wide ?? 0);
  // (shut in delight when smiling, else just shut)
  if (out.smile > 0.45) out.happy = c; else out.shut = c;
  return out;
}
/** the drawn face's state as the older face (for what still reads it) */
export function toLegacy(s: FaceState, out: Required<LegacyExpr>) {
  out.smile = s.smile; out.jaw = s.open - s.press * 0.06; out.pucker = s.round; out.frown = s.frown;
  out.brows = Math.max(0, (s.browInL + s.browInR + s.browOutL + s.browOutR) / 4);
  out.tender = Math.max(0, (s.browInL + s.browInR - s.browOutL - s.browOutR) / 4);
  out.browDown = s.knit; out.squint = s.lidLow; out.wide = Math.max(0, -s.lidUp); out.closed = Math.max(s.shut, s.happy);
  return out;
}
export function blank(): FaceParams {
  const o = {} as FaceParams;
  for (const k of FACE_KEYS) o[k] = 0;
  return o;
}

/** a sip at a cup's rim: the lips parted and rounded a little, the smile kept softly */
const SIP: Partial<FaceParams> = { open: 0.3, round: 0.45, spread: 0, press: 0, teeth: 0.15, tongue: 0, tuck: 0 };

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const damp = (a: number, b: number, rate: number, dt: number) => b + (a - b) * Math.exp(-rate * dt);
let seeds = 1;

export interface FaceOpts {
  /** the random's seed (blinks, saccades): each face its own */
  seed?: number;
  /** the gap between blinks (s, a range) */
  blinkGap?: [number, number];
  /** how wide the mouth opens when talking (1; more for a beard to show it through) */
  talkOpen?: number;
}

export class Face {
  readonly state: FaceState;
  /** the line being said and the time on it, and how much it holds the mouth (talk.ts sets it each frame) */
  speech: { tl: Timeline; t: number; w: number } | null = null;
  /** a cup at the lips (0..1), set as the cup comes up */
  sip = 0;
  /** while drinking: the eyes closed (0..1); after it, the content breath out (0..1) (drink() sets them) */
  sipEyes = 0;
  sipAhh = 0;
  /** eating (hero/table.ts sets them each frame): the mouth open for a bite (0..1), the jaw chewing after it (0..1) */
  bite = 0;
  chew = 0;
  /** how wide the mouth opens talking */
  talkOpen: number;
  /** this face's own look at rest, added under any mood (a lopsided half-smile, say) */
  rest: Partial<FaceParams> | null = null;
  private moodE: Expr = {};
  private moodK = 0;
  private moodW = 0;
  private moodFade = 0.35;
  private flashes: { e: Expr; t: number; hold: number; fade: number; k: number }[] = [];
  private T = blank();
  private rnd: () => number;
  private blinkT = 1;
  private nextBlink: number;
  private blinkGap: [number, number];
  private saccT = 0;
  private sacc: [number, number] = [0, 0];
  private time = 0;
  private lastAim: V3 | null = null;
  private lastBlinkAt = -9;
  private lastPhrase = -1;
  private mouthTmp: Mouth = { open: 0, spread: 0, round: 0, press: 0, teeth: 0, tongue: 0, tuck: 0 };

  constructor(o: FaceOpts = {}) {
    this.rnd = mulberry(o.seed ?? (seeds++ * 7919));
    this.blinkGap = o.blinkGap ?? [1.8, 5.2];
    this.nextBlink = this.gap();
    this.talkOpen = o.talkOpen ?? 1;
    this.state = { ...blank(), blink: 0, gaze: [0, 0, 1], talk: 0, emph: 0 };
  }

  /** the mood: an expression (by name or its controls) held until it's changed, faded in over `fade` s; null: none */
  mood(e: ExprName | Expr | null, o: { k?: number; fade?: number } = {}) {
    if (e === null) { this.moodK = 0; this.moodFade = o.fade ?? 0.5; return this; }
    const E = typeof e === 'string' ? EXPRESSIONS[e] : e;
    // (a new mood over an old one: from where the face is, not from nothing)
    if (this.moodW > 0.05 && E !== this.moodE) this.flashes.push({ e: this.moodE, t: 0, hold: 0, fade: o.fade ?? 0.35, k: this.moodW });
    this.moodE = E;
    this.moodK = o.k ?? 1;
    this.moodFade = o.fade ?? 0.35;
    if (this.moodW > 0.05) this.moodW = 0;
    return this;
  }
  /** a passing expression over the mood, held `hold` s (then gone over `fade` s) */
  flash(e: ExprName | Expr, o: { hold?: number; k?: number; fade?: number } = {}) {
    this.flashes.push({ e: typeof e === 'string' ? EXPRESSIONS[e] : e, t: 0, hold: o.hold ?? 1.2, fade: o.fade ?? 0.22, k: o.k ?? 1 });
    if (this.flashes.length > 6) this.flashes.shift();
    return this;
  }
  /** a passing expression let go now (over its fade): an act that set it, cut short */
  unflash(e: ExprName | Expr) {
    const E = typeof e === 'string' ? EXPRESSIONS[e] : e;
    for (const f of this.flashes) if (f.e === E) f.hold = Math.min(f.hold, f.t);
    return this;
  }
  /** a sip's moment (sip.ts sipAt), or null when there's none: the lips, the eyes, the breath out after */
  drink(s: SipShape | null) {
    this.sip = s ? s.lips : 0;
    this.sipEyes = s ? s.eyes : 0;
    this.sipAhh = s ? s.ahh : 0;
  }
  /** a blink now */
  blink() { if (this.blinkT >= 1) { this.blinkT = 0; this.lastBlinkAt = this.time; this.nextBlink = this.gap(); } }
  get speaking() { return !!this.speech && this.speech.w > 0.01; }

  private gap() { const [a, b] = this.blinkGap; return a + this.rnd() * (b - a); }

  /** each frame, from the rig: the body's own face (its activity's controls), the eyes' aim in the head's axes (x the
   *  face's left, y up, z forward; null: ahead) */
  update(dt: number, base: Partial<FaceParams>, aim: V3 | null): FaceState {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    const T = this.T, S = this.state;
    for (const k of FACE_KEYS) T[k] = base[k] ?? 0;
    const R = this.rest;
    if (R) for (const k of FACE_KEYS) { const v = R[k]; if (v !== undefined) T[k] += v; }
    let lookY = 0, lookP = 0, pulse = 0;
    // the mood
    this.moodW = damp(this.moodW, this.moodK, 1 / Math.max(this.moodFade, 0.05), dt);
    if (this.moodW > 1e-3) {
      const E = this.moodE, w = this.moodW;
      for (const k of FACE_KEYS) { const v = E[k]; if (v !== undefined) T[k] += (v - T[k]) * w; }
      if (E.look) { lookY += E.look[0] * w; lookP += E.look[1] * w; }
      if (E.pulse) pulse = Math.max(pulse, E.pulse * w);
    }
    // passing expressions
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      if (f.t > f.hold + f.fade) { this.flashes.splice(i, 1); continue; }
    }
    for (const f of this.flashes) {
      const env = (f.hold > 0 ? smoothstep(0, f.fade, f.t) : 1) * (1 - smoothstep(f.hold, f.hold + f.fade, f.t)) * f.k;
      if (env <= 1e-3) continue;
      for (const k of FACE_KEYS) { const v = f.e[k]; if (v !== undefined) T[k] += (v - T[k]) * env; }
      if (f.e.look) { lookY += f.e.look[0] * env; lookP += f.e.look[1] * env; }
      if (f.e.pulse) pulse = Math.max(pulse, f.e.pulse * env);
    }
    // (a laugh's rhythm: ha, ha, ha)
    if (pulse > 0) T.open *= 0.55 + 0.45 * Math.abs(Math.sin(Math.PI * 4.2 * this.time));
    // a sip
    if (this.sip > 1e-3) {
      const w = Math.min(this.sip, 1);
      for (const k of MOUTH_KEYS) T[k] += ((SIP[k] ?? 0) - T[k]) * w;
      T.smile *= 1 - 0.5 * w; T.frown *= 1 - w;
      T.lidUp += (0.3 - T.lidUp) * w * 0.6;
    }
    // eating: the mouth open for the fork, then the jaw chewing, the lips together between
    if (this.bite > 1e-3 || this.chew > 1e-3) {
      const c = this.chew * (0.5 + 0.5 * Math.sin(Math.PI * 2 * 1.7 * this.time)), w = Math.min(1, this.bite + this.chew);
      T.open += (Math.max(0.42 * this.bite, 0.14 * c) - T.open) * w;
      T.round += (0.25 * this.bite - T.round) * w;
      T.press = Math.max(T.press, 0.3 * this.chew * (1 - c));
      T.spread *= 1 - 0.5 * w;
    }
    // (set again each frame by whoever's eating: a seat dropped leaves the mouth be)
    this.bite = 0; this.chew = 0;
    // (the eyes closed while drinking; after it a breath out, content: the eyes shut in a smile, the lips just apart)
    if (this.sipEyes > 1e-3) { T.shut = Math.max(T.shut, 0.95 * this.sipEyes); T.happy *= 1 - this.sipEyes; }
    if (this.sipAhh > 1e-3) {
      const a = this.sipAhh;
      T.happy = Math.max(T.happy, 0.6 * a); T.smile = Math.max(T.smile, 0.65 * a); T.open = Math.max(T.open, 0.1 * a);
      T.browInL += 0.18 * a; T.browInR += 0.18 * a;
    }
    // speech: the visemes over the mouth, the brows with the stress, a glance aside as a phrase starts
    let talk = 0, emph = 0;
    const sp = this.speech;
    if (sp && sp.w > 1e-3) {
      talk = Math.min(1, sp.w);
      const { mouth, emph: e } = mouthAt(sp.tl, sp.t, this.mouthTmp);
      emph = e * talk;
      const o = this.talkOpen;
      for (const k of MOUTH_KEYS) T[k] += (Math.min(1, mouth[k] * (k === 'open' ? o : 1)) - T[k]) * talk;
      T.smile *= 1 - 0.3 * talk;
      T.browInL += 0.22 * emph; T.browInR += 0.22 * emph; T.browOutL += 0.16 * emph; T.browOutR += 0.16 * emph;
      T.lidUp -= 0.1 * emph;
      // (a phrase's start: the eyes away for a moment, then back)
      const pi = phraseAt(sp.tl, sp.t);
      if (pi !== this.lastPhrase && pi >= 0) {
        this.lastPhrase = pi;
        if (this.rnd() < 0.6) { this.saccT = 0.5 + this.rnd() * 0.5; this.sacc = [(this.rnd() - 0.5) * 0.4, (this.rnd() - 0.3) * 0.18]; }
        if (pi > 0 && this.rnd() < 0.5) this.blink();
      }
    } else this.lastPhrase = -1;
    // blinks (and one with a big look elsewhere)
    if (aim && this.lastAim) {
      const d = aim[0] * this.lastAim[0] + aim[1] * this.lastAim[1] + aim[2] * this.lastAim[2];
      if (d < 0.93 && this.time - this.lastBlinkAt > 0.8 && this.rnd() < 0.5) this.blink();
    }
    this.lastAim = aim ? [aim[0], aim[1], aim[2]] : null;
    this.blinkT += dt / 0.17;
    if (this.blinkT >= 1) {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) this.blink();
    }
    const bt = Math.min(this.blinkT, 1);
    const blinkC = bt < 0.38 ? smoothstep(0, 0.38, bt) : 1 - smoothstep(0.38, 1, bt);
    // the controls, eased (the mouth quick while talking)
    for (const k of FACE_KEYS) {
      const mouthK = (MOUTH_KEYS as readonly string[]).includes(k);
      const rate = mouthK ? (talk > 0.05 ? 34 : 14) : k === 'blush' ? 3 : k === 'happy' || k === 'shut' ? 10 : 8;
      S[k] = damp(S[k], T[k], rate, dt);
    }
    S.blink = Math.max(blinkC * (1 - S.happy), Math.min(1, S.shut));
    S.talk = talk; S.emph = emph;
    // the gaze: the aim (clamped to where eyes can turn), the saccades, the expression's glance
    this.saccT -= dt;
    if (this.saccT <= 0) {
      this.saccT = 0.4 + this.rnd() * 2.0;
      this.sacc = [(this.rnd() - 0.5) * 0.16, (this.rnd() - 0.5) * 0.08];
    }
    const a = aim ?? [0, 0, 1];
    const yaw = Math.min(0.5, Math.max(-0.5, Math.atan2(a[0], Math.max(a[2], 0.05)) + this.sacc[0] + lookY));
    const pitch = Math.min(0.3, Math.max(-0.4, Math.atan2(a[1], Math.hypot(a[0], a[2])) + this.sacc[1] + lookP));
    const g = S.gaze, k = 1 - Math.exp(-28 * dt);
    const tx = Math.sin(yaw) * Math.cos(pitch), ty = Math.sin(pitch), tz = Math.cos(yaw) * Math.cos(pitch);
    g[0] += (tx - g[0]) * k; g[1] += (ty - g[1]) * k; g[2] += (tz - g[2]) * k;
    const gl = Math.hypot(g[0], g[1], g[2]) || 1;
    g[0] /= gl; g[1] /= gl; g[2] /= gl;
    return S;
  }
}
