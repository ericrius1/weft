// Pure-JS DSP toolkit for the offline sound renderers (runs in a Web Worker or on the main thread).
// Everything renders into Float32Arrays; no Web Audio objects here.

export type Chans = Float32Array[];
export interface Rendered { ch: Chans; sr: number }

// ------------------------------------------------------------------ random
export class Rng {
  private a: number;
  constructor(seed: number) { this.a = (seed >>> 0) || 0x9e3779b9; }
  next(): number {
    let t = (this.a = (this.a + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  /** log-uniform in [a, b] */
  log(a: number, b: number) { return a * Math.pow(b / a, this.next()); }
  /** integer in [a, b] inclusive */
  int(a: number, b: number) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  chance(p: number) { return this.next() < p; }
  sym() { return this.next() * 2 - 1; }
  gauss() { const u = Math.max(1e-9, this.next()), v = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  /** exponential inter-arrival time for a Poisson process of `rate` per second */
  exp(rate: number) { return -Math.log(1 - this.next() * 0.999999) / Math.max(1e-6, rate); }
  /** weighted index */
  weighted(w: readonly number[]) {
    let s = 0; for (const x of w) s += Math.max(0, x);
    let u = this.next() * s;
    for (let i = 0; i < w.length; i++) { u -= Math.max(0, w[i]); if (u <= 0) return i; }
    return w.length - 1;
  }
}

export function hashSeed(...parts: (string | number)[]) {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= 0x5f; h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ------------------------------------------------------------------ math
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db: number) => Math.pow(10, db / 20);
/** pow with the base clamped at 0 (envelope shapes must never produce NaN) */
export const spow = (x: number, p: number) => Math.pow(Math.max(0, x), p);
const TAU = Math.PI * 2;

// fast sine via table (phase in cycles)
const SIN_N = 8192;
const SIN = new Float32Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN[i] = Math.sin((i / SIN_N) * TAU);
export function fsin(phaseCycles: number) {
  const p = phaseCycles - Math.floor(phaseCycles);
  const x = p * SIN_N;
  const i = x | 0;
  const f = x - i;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * f;
}

// ------------------------------------------------------------------ filters
/** RBJ biquad, transposed direct form II */
export class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; z1 = 0; z2 = 0;
  constructor(public sr: number) {}
  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; return this;
  }
  private w(f: number) { const w0 = (TAU * clamp(f, 5, this.sr * 0.49)) / this.sr; return { cs: Math.cos(w0), sn: Math.sin(w0) }; }
  lp(f: number, q = 0.7071) { const { cs, sn } = this.w(f); const al = sn / (2 * q); return this.set((1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + al, -2 * cs, 1 - al); }
  hp(f: number, q = 0.7071) { const { cs, sn } = this.w(f); const al = sn / (2 * q); return this.set((1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al); }
  /** band-pass, 0 dB peak */
  bp(f: number, q = 1) { const { cs, sn } = this.w(f); const al = sn / (2 * q); return this.set(al, 0, -al, 1 + al, -2 * cs, 1 - al); }
  notch(f: number, q = 1) { const { cs, sn } = this.w(f); const al = sn / (2 * q); return this.set(1, -2 * cs, 1, 1 + al, -2 * cs, 1 - al); }
  peak(f: number, q: number, db: number) {
    const { cs, sn } = this.w(f); const A = Math.pow(10, db / 40); const al = sn / (2 * q);
    return this.set(1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A);
  }
  lowShelf(f: number, db: number) {
    const { cs, sn } = this.w(f); const A = Math.pow(10, db / 40); const al = (sn / 2) * Math.SQRT2; const s = 2 * Math.sqrt(A) * al;
    return this.set(A * ((A + 1) - (A - 1) * cs + s), 2 * A * ((A - 1) - (A + 1) * cs), A * ((A + 1) - (A - 1) * cs - s),
      (A + 1) + (A - 1) * cs + s, -2 * ((A - 1) + (A + 1) * cs), (A + 1) + (A - 1) * cs - s);
  }
  highShelf(f: number, db: number) {
    const { cs, sn } = this.w(f); const A = Math.pow(10, db / 40); const al = (sn / 2) * Math.SQRT2; const s = 2 * Math.sqrt(A) * al;
    return this.set(A * ((A + 1) + (A - 1) * cs + s), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - s),
      (A + 1) - (A - 1) * cs + s, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - s);
  }
  run(x: number) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() { this.z1 = this.z2 = 0; return this; }
  /** filter a whole array in place */
  apply(a: Float32Array, from = 0, to = a.length) { for (let i = from; i < to; i++) a[i] = this.run(a[i]); return a; }
}

export class OnePole {
  y = 0; k = 1;
  constructor(public sr: number, f = 1000) { this.setF(f); }
  setF(f: number) { this.k = 1 - Math.exp((-TAU * clamp(f, 1, this.sr * 0.49)) / this.sr); return this; }
  lp(x: number) { this.y += (x - this.y) * this.k; return this.y; }
  hp(x: number) { this.y += (x - this.y) * this.k; return x - this.y; }
}

/** chain helper: apply a list of biquads in series to an array */
export function filt(a: Float32Array, ...fs: Biquad[]) { for (const f of fs) f.apply(a); return a; }

// ------------------------------------------------------------------ noise
export class Noise {
  private b0 = 0; private b1 = 0; private b2 = 0; private b3 = 0; private b4 = 0; private b5 = 0; private b6 = 0; private br = 0;
  constructor(private rng: Rng) {}
  white() { return this.rng.next() * 2 - 1; }
  pink() {
    const w = this.white();
    this.b0 = 0.99886 * this.b0 + w * 0.0555179; this.b1 = 0.99332 * this.b1 + w * 0.0750759; this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856; this.b4 = 0.55 * this.b4 + w * 0.5329522; this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const y = (this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362) * 0.11;
    this.b6 = w * 0.115926;
    return y;
  }
  brown() { this.br = (this.br + 0.02 * this.white()) / 1.02; return this.br * 3.5; }
}

/** smooth random control signal in [-1, 1] (cubic-interpolated random points at `rate` Hz), length n at sr */
export function ctrlNoise(rng: Rng, n: number, sr: number, rate: number): Float32Array {
  const out = new Float32Array(n);
  const step = sr / Math.max(0.01, rate);
  const pts = new Float32Array(Math.ceil(n / step) + 4);
  for (let i = 0; i < pts.length; i++) pts[i] = rng.sym();
  for (let i = 0; i < n; i++) {
    const x = i / step; const k = Math.floor(x); const t = x - k;
    const p0 = pts[k], p1 = pts[k + 1], p2 = pts[k + 2], p3 = pts[k + 3];
    // Catmull-Rom between p1 and p2
    const v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    out[i] = clamp(v, -1.2, 1.2);
  }
  return out;
}

// ------------------------------------------------------------------ buffers
export function mono(sr: number, secs: number) { return new Float32Array(Math.max(1, Math.ceil(sr * secs))); }
export function stereo(sr: number, secs: number): Chans { const n = Math.max(1, Math.ceil(sr * secs)); return [new Float32Array(n), new Float32Array(n)]; }

export function peakOf(ch: Chans) { let p = 0; for (const c of ch) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > p) p = v; } return p; }
export function rmsOf(ch: Chans) { let s = 0, n = 0; for (const c of ch) { for (let i = 0; i < c.length; i++) s += c[i] * c[i]; n += c.length; } return Math.sqrt(s / Math.max(1, n)); }
export function scale(ch: Chans, g: number) { for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= g; return ch; }
export function normPeak(ch: Chans, peak = 0.9) { const p = peakOf(ch); if (p > 1e-9) scale(ch, peak / p); return ch; }
export function normRms(ch: Chans, rms = 0.1) { const r = rmsOf(ch); if (r > 1e-9) scale(ch, rms / r); return ch; }
/** soft-saturate stray peaks (keeps loops from having a single dominating spike) */
export function softLimit(ch: Chans, ceil = 0.95) { for (const c of ch) for (let i = 0; i < c.length; i++) c[i] = ceil * Math.tanh(c[i] / ceil); return ch; }

export function dcBlock(c: Float32Array, f = 12, sr = 48000) {
  const R = Math.exp((-TAU * f) / sr); let x1 = 0, y1 = 0;
  for (let i = 0; i < c.length; i++) { const x = c[i]; const y = x - x1 + R * y1; x1 = x; y1 = y; c[i] = y; }
  return c;
}

export function fadeIn(c: Float32Array, n: number) { n = Math.min(n, c.length); for (let i = 0; i < n; i++) c[i] *= Math.sin((0.5 * Math.PI * i) / n) ** 2; return c; }
export function fadeOut(c: Float32Array, n: number) { n = Math.min(n, c.length); const L = c.length; for (let i = 0; i < n; i++) c[L - 1 - i] *= Math.sin((0.5 * Math.PI * i) / n) ** 2; return c; }
/** trim trailing near-silence and fade out the last few ms */
export function finish(ch: Chans, sr: number, opts: { fadeMs?: number; dc?: boolean; thresh?: number } = {}): Chans {
  const fade = Math.floor(((opts.fadeMs ?? 8) / 1000) * sr);
  if (opts.dc !== false) for (const c of ch) dcBlock(c, 10, sr);
  // trim
  const th = opts.thresh ?? 1e-4;
  let end = 0;
  for (const c of ch) for (let i = c.length - 1; i > end; i--) if (Math.abs(c[i]) > th) { end = i; break; }
  const len = Math.min(ch[0].length, end + fade + 1);
  const out = ch.map((c) => c.slice(0, Math.max(len, 16)));
  for (const c of out) { fadeOut(c, Math.min(fade, c.length)); fadeIn(c, 2); }
  for (const c of out) for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) < 1e-20) c[i] = 0;
  return out;
}

/** make a seamless loop: buffers are rendered `xf` seconds longer than the loop; the tail is crossfaded into the head */
export function loopify(ch: Chans, sr: number, xfSecs: number): Chans {
  const xf = Math.floor(xfSecs * sr);
  return ch.map((c) => {
    const L = c.length - xf;
    const out = c.slice(0, L);
    for (let i = 0; i < xf; i++) {
      const t = i / xf;
      const a = Math.cos(t * 0.5 * Math.PI), b = Math.sin(t * 0.5 * Math.PI); // equal power (uncorrelated material)
      out[i] = c[L + i] * a + c[i] * b;
    }
    return out;
  });
}

// ------------------------------------------------------------------ primitives (additive into buffers)
export interface Pan { l: number; r: number }
export const panGains = (p: number): Pan => { const a = (clamp(p, -1, 1) + 1) * 0.25 * Math.PI; return { l: Math.cos(a), r: Math.sin(a) }; };

function addTo(ch: Chans, i: number, v: number, pan?: Pan) {
  if (ch.length === 1 || !pan) { for (const c of ch) if (i < c.length) c[i] += v; return; }
  if (i < ch[0].length) { ch[0][i] += v * pan.l; ch[1][i] += v * pan.r; }
}

/**
 * Minnaert bubble after van den Doel ("Physically based models for liquid sounds", 2005):
 * a damped sinusoid f0 = 3/r whose pitch rises as the bubble nears the surface.
 * r in mm. `rise` 0.1 ≈ natural (pitch +~10 % over 3 time constants), 1 ≈ strong "bloop" (~2x).
 * `damp` scales the decay rate (1 = physical, <1 rings longer).
 */
export function addBubble(ch: Chans, sr: number, t0: number, rMm: number, amp: number, rise = 0.1, damp = 1, pan?: Pan) {
  const f0 = 3000 / Math.max(0.15, rMm);
  if (f0 > sr * 0.45) return;
  const d = (0.043 * f0 + 0.0014 * Math.pow(f0, 1.5)) * damp;
  const len = Math.min(Math.floor((5.5 / d) * sr), Math.floor(sr * 0.7));
  const s0 = Math.floor(t0 * sr);
  let ph = 0;
  const dec = Math.exp(-d / sr);
  let e = amp;
  const att = Math.max(2, Math.floor(sr * 0.0006));
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = f0 * (1 + 0.35 * rise * Math.min(d * t, 5));
    if (f > sr * 0.47) break;
    ph += f / sr;
    const a = i < att ? i / att : 1;
    addTo(ch, s0 + i, fsin(ph) * e * a, pan);
    e *= dec;
  }
}

/** sum of exponentially decaying partials: [freq Hz, amp, decay seconds (to -60 dB)] */
export function addModal(ch: Chans, sr: number, t0: number, partials: [number, number, number][], amp = 1, pan?: Pan, attackMs = 0.3) {
  const s0 = Math.floor(t0 * sr);
  const att = Math.max(1, Math.floor((attackMs / 1000) * sr));
  for (const [f, a, t60] of partials) {
    if (f >= sr * 0.47 || a <= 0) continue;
    const len = Math.min(Math.floor(t60 * sr), Math.floor(sr * 8));
    const dec = Math.exp(Math.log(0.001) / Math.max(1, t60 * sr));
    let e = a * amp; const inc = f / sr; let ph = 0; // sine phase 0 -> no click
    for (let i = 0; i < len; i++) {
      ph += inc;
      const w = i < att ? i / att : 1;
      addTo(ch, s0 + i, fsin(ph) * e * w, pan);
      e *= dec;
    }
  }
}

/** filtered noise grain with attack/decay envelope (exp decay, tau seconds) */
export function addNoiseGrain(ch: Chans, sr: number, rng: Rng, t0: number, opts: {
  dur: number; amp: number; attack?: number; tau?: number; f?: number; q?: number; type?: 'bp' | 'lp' | 'hp'; f2?: number; pan?: Pan; shape?: 'exp' | 'sine' | 'tri';
}) {
  const s0 = Math.floor(t0 * sr);
  const n = Math.floor(opts.dur * sr);
  const att = Math.max(1, Math.floor((opts.attack ?? 0.002) * sr));
  const tau = opts.tau ?? opts.dur / 4;
  const bq = new Biquad(sr);
  const type = opts.type ?? 'bp';
  if (type === 'bp') bq.bp(opts.f ?? 1000, opts.q ?? 1); else if (type === 'lp') bq.lp(opts.f ?? 1000, opts.q ?? 0.7); else bq.hp(opts.f ?? 1000, opts.q ?? 0.7);
  const bq2 = opts.f2 ? new Biquad(sr).lp(opts.f2, 0.7) : null;
  for (let i = 0; i < n; i++) {
    let e: number;
    if (opts.shape === 'sine') e = Math.sin((Math.PI * i) / n);
    else if (opts.shape === 'tri') e = i < att ? i / att : 1 - (i - att) / Math.max(1, n - att);
    else e = i < att ? i / att : Math.exp(-(i - att) / (tau * sr));
    let x = bq.run(rng.sym());
    if (bq2) x = bq2.run(x);
    addTo(ch, s0 + i, x * e * opts.amp, opts.pan);
  }
}

/** a tiny impulse "tick" (droplet impact / grain click): band-limited, with a short raised onset */
export function addTick(ch: Chans, sr: number, rng: Rng, t0: number, amp: number, f = 3000, durMs = 1.2, pan?: Pan) {
  const n = Math.max(3, Math.floor((durMs / 1000) * sr));
  const att = Math.max(2, Math.floor(sr * 0.00018));
  const hp = new Biquad(sr).hp(f, 0.7), lp = new Biquad(sr).lp(Math.min(11000, sr * 0.42), 0.7);
  const s0 = Math.floor(t0 * sr);
  for (let i = 0; i < n + 60; i++) {
    const e = i < att ? 0.5 - 0.5 * Math.cos((Math.PI * i) / att) : i < n + att ? Math.exp(-(i - att) / (n * 0.35)) : 0;
    addTo(ch, s0 + i, lp.run(hp.run(rng.sym() * e)) * amp, pan);
  }
}

/** sine/harmonic voice with per-sample frequency & amplitude arrays (control-rate arrays are linearly interpolated) */
export function renderVoice(sr: number, f: Float32Array, a: Float32Array, ctrlRate: number, harm: number[], out?: Float32Array, phase0 = 0) {
  const n = Math.floor((f.length / ctrlRate) * sr);
  const o = out ?? new Float32Array(n);
  let ph = phase0;
  const step = ctrlRate / sr;
  for (let i = 0; i < n && i < o.length; i++) {
    const x = i * step; const k = Math.min(f.length - 2, x | 0); const t = x - k;
    const fi = f[k] + (f[k + 1] - f[k]) * t;
    const ai = a[k] + (a[k + 1] - a[k]) * t;
    ph += fi / sr;
    if (ai < 1e-6) continue;
    let v = 0;
    for (let h = 0; h < harm.length; h++) { if (harm[h] === 0 || fi * (h + 1) > sr * 0.45) continue; v += harm[h] * fsin(ph * (h + 1)); }
    o[i] += v * ai;
  }
  return o;
}

/** control-rate contour builder: piecewise glides of frequency and amplitude */
export class Contour {
  f: Float32Array; a: Float32Array;
  constructor(public rate: number, public dur: number, f0 = 1000) {
    const n = Math.ceil(dur * rate) + 2;
    this.f = new Float32Array(n).fill(f0); this.a = new Float32Array(n);
  }
  private idx(t: number) { return clamp(Math.round(t * this.rate), 0, this.f.length - 1); }
  /** glide f from f0 to f1 over [t, t+d] with curve exponent (1 linear-in-log), amp envelope by function */
  note(t: number, d: number, f0: number, f1: number, amp: number, env: (u: number) => number = envBell, curve = 1, fShape?: (u: number) => number) {
    const i0 = this.idx(t), i1 = this.idx(t + d);
    for (let i = i0; i <= i1; i++) {
      const u = (i - i0) / Math.max(1, i1 - i0);
      const uf = fShape ? fShape(u) : Math.pow(u, curve);
      this.f[i] = f0 * Math.pow(f1 / f0, uf);
      this.a[i] = Math.max(this.a[i], amp * env(u));
    }
    return this;
  }
  /** set frequency only (for legato) */
  freq(t: number, d: number, fn: (u: number) => number) { const i0 = this.idx(t), i1 = this.idx(t + d); for (let i = i0; i <= i1; i++) this.f[i] = fn((i - i0) / Math.max(1, i1 - i0)); return this; }
  amp(t: number, d: number, fn: (u: number) => number) { const i0 = this.idx(t), i1 = this.idx(t + d); for (let i = i0; i <= i1; i++) this.a[i] = fn((i - i0) / Math.max(1, i1 - i0)); return this; }
  /** hold the frequency of gaps at the neighbouring note's value (avoids pitch jumps while silent) */
  fillGaps() {
    let last = -1;
    for (let i = 0; i < this.a.length; i++) {
      if (this.a[i] > 1e-5) { if (last >= 0 && i - last > 1) { const fv = this.f[i]; for (let j = last + 1; j < i; j++) this.f[j] = fv; } last = i; }
    }
    return this;
  }
}

export const envBell = (u: number) => Math.sin(Math.PI * clamp(u, 0, 1)) ** 0.8;
export const envAD = (att: number) => (u: number) => (u < att ? Math.sin((0.5 * Math.PI * u) / att) : spow(1 - (u - att) / (1 - att), 1.5));
export const envPluck = (u: number) => (u < 0.04 ? u / 0.04 : Math.exp(-(u - 0.04) * 4));
export const envFlat = (att = 0.1, rel = 0.15) => (u: number) => Math.min(1, u / att, (1 - u) / rel);

/** apply a function per sample of an array (convenience) */
export function mapArr(a: Float32Array, fn: (x: number, i: number) => number) { for (let i = 0; i < a.length; i++) a[i] = fn(a[i], i); return a; }

/** mix src into dst at sample offset with gain (and optional stereo pan when dst is stereo and src mono) */
export function mixInto(dst: Chans, src: Float32Array, offset: number, gain = 1, pan?: Pan) {
  if (dst.length === 2 && pan) {
    const gl = gain * pan.l, gr = gain * pan.r;
    for (let i = 0; i < src.length; i++) { const j = offset + i; if (j < 0 || j >= dst[0].length) continue; dst[0][j] += src[i] * gl; dst[1][j] += src[i] * gr; }
  } else {
    for (const d of dst) for (let i = 0; i < src.length; i++) { const j = offset + i; if (j >= 0 && j < d.length) d[j] += src[i] * gain; }
  }
}

/** PolyBLEP band-limited sawtooth oscillator */
export function polyBlep(t: number, dt: number) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** Karplus-Strong plucked string with fractional tuning, loop damping and optional stiffness (dispersion) */
export function ksString(sr: number, f: number, secs: number, rng: Rng, o: {
  t60: number; t60hi?: number; pos?: number; excLp?: number; excMs?: number; stiff?: number; pickNoise?: number;
}): Float32Array {
  const n = Math.floor(secs * sr);
  const out = new Float32Array(n);
  const P = sr / f;
  // one-zero loop filter y = (1-s) x + s x[-1] -> group delay s; s controls high-frequency damping
  const hiRatio = clamp((o.t60hi ?? o.t60 * 0.35) / o.t60, 0.02, 1);
  const s = clamp(0.5 * (1 - hiRatio), 0.02, 0.5);
  const stiffA = -(o.stiff ?? 0); // first order allpass coefficient (negative = more delay at high f)
  const apDelay = stiffA !== 0 ? (1 - stiffA) / (1 + stiffA) : 0;
  const total = P - s - apDelay;
  let N = Math.floor(total - 0.5);
  if (N < 2) N = 2;
  const d = total - N; // in [0.5,1.5)
  const c = (1 - d) / (1 + d);
  const g = Math.pow(10, -3 / (o.t60 * f));
  const L = N + 4;
  const line = new Float32Array(L);
  // excitation: filtered noise burst shaped by pluck position comb
  const excN = Math.max(Math.floor(P), Math.floor(((o.excMs ?? 0) / 1000) * sr));
  const exc = new Float32Array(excN);
  const lp = new Biquad(sr).lp(o.excLp ?? 6000, 0.6);
  for (let i = 0; i < excN; i++) exc[i] = lp.run(rng.sym()) * (1 - i / excN * 0.3);
  const posN = Math.max(1, Math.round((o.pos ?? 0.2) * P));
  for (let i = excN - 1; i >= posN; i--) exc[i] -= exc[i - posN];
  let w = 0; let ap1x = 0, ap1y = 0, st1x = 0, st1y = 0; let prev = 0;
  for (let i = 0; i < n; i++) {
    const rd = (w - N + L) % L;
    const yN = line[rd];
    // loop filter
    const lf = (1 - s) * yN + s * prev; prev = yN;
    // tuning allpass
    const ap = c * lf + ap1x - c * ap1y; ap1x = lf; ap1y = ap;
    // stiffness allpass
    let st = ap;
    if (stiffA !== 0) { st = stiffA * ap + st1x - stiffA * st1y; st1x = ap; st1y = st; }
    const x = (i < excN ? exc[i] : 0) + g * st;
    line[w] = x;
    w = (w + 1) % L;
    out[i] = x;
  }
  if (o.pickNoise) {
    const hp = new Biquad(sr).hp(2500, 0.7);
    const m = Math.floor(sr * 0.004);
    for (let i = 0; i < m; i++) out[i] += hp.run(rng.sym()) * o.pickNoise * (1 - i / m);
  }
  return out;
}
