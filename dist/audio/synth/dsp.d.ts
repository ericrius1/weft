export type Chans = Float32Array[];
export interface Rendered {
    ch: Chans;
    sr: number;
}
export declare class Rng {
    private a;
    constructor(seed: number);
    next(): number;
    range(a: number, b: number): number;
    /** log-uniform in [a, b] */
    log(a: number, b: number): number;
    /** integer in [a, b] inclusive */
    int(a: number, b: number): number;
    pick<T>(arr: readonly T[]): T;
    chance(p: number): boolean;
    sym(): number;
    gauss(): number;
    /** exponential inter-arrival time for a Poisson process of `rate` per second */
    exp(rate: number): number;
    /** weighted index */
    weighted(w: readonly number[]): number;
}
export declare function hashSeed(...parts: (string | number)[]): number;
export declare const clamp: (x: number, a: number, b: number) => number;
export declare const lerp: (a: number, b: number, t: number) => number;
export declare const sstep: (a: number, b: number, x: number) => number;
export declare const mtof: (m: number) => number;
export declare const dbToGain: (db: number) => number;
/** pow with the base clamped at 0 (envelope shapes must never produce NaN) */
export declare const spow: (x: number, p: number) => number;
export declare function fsin(phaseCycles: number): number;
/** RBJ biquad, transposed direct form II */
export declare class Biquad {
    sr: number;
    b0: number;
    b1: number;
    b2: number;
    a1: number;
    a2: number;
    z1: number;
    z2: number;
    constructor(sr: number);
    private set;
    private w;
    lp(f: number, q?: number): this;
    hp(f: number, q?: number): this;
    /** band-pass, 0 dB peak */
    bp(f: number, q?: number): this;
    notch(f: number, q?: number): this;
    peak(f: number, q: number, db: number): this;
    lowShelf(f: number, db: number): this;
    highShelf(f: number, db: number): this;
    run(x: number): number;
    reset(): this;
    /** filter a whole array in place */
    apply(a: Float32Array, from?: number, to?: number): Float32Array<ArrayBufferLike>;
}
export declare class OnePole {
    sr: number;
    y: number;
    k: number;
    constructor(sr: number, f?: number);
    setF(f: number): this;
    lp(x: number): number;
    hp(x: number): number;
}
/** chain helper: apply a list of biquads in series to an array */
export declare function filt(a: Float32Array, ...fs: Biquad[]): Float32Array<ArrayBufferLike>;
export declare class Noise {
    private rng;
    private b0;
    private b1;
    private b2;
    private b3;
    private b4;
    private b5;
    private b6;
    private br;
    constructor(rng: Rng);
    white(): number;
    pink(): number;
    brown(): number;
}
/** smooth random control signal in [-1, 1] (cubic-interpolated random points at `rate` Hz), length n at sr */
export declare function ctrlNoise(rng: Rng, n: number, sr: number, rate: number): Float32Array;
export declare function mono(sr: number, secs: number): Float32Array<ArrayBuffer>;
export declare function stereo(sr: number, secs: number): Chans;
export declare function peakOf(ch: Chans): number;
export declare function rmsOf(ch: Chans): number;
export declare function scale(ch: Chans, g: number): Chans;
export declare function normPeak(ch: Chans, peak?: number): Chans;
export declare function normRms(ch: Chans, rms?: number): Chans;
/** soft-saturate stray peaks (keeps loops from having a single dominating spike) */
export declare function softLimit(ch: Chans, ceil?: number): Chans;
export declare function dcBlock(c: Float32Array, f?: number, sr?: number): Float32Array<ArrayBufferLike>;
export declare function fadeIn(c: Float32Array, n: number): Float32Array<ArrayBufferLike>;
export declare function fadeOut(c: Float32Array, n: number): Float32Array<ArrayBufferLike>;
/** trim trailing near-silence and fade out the last few ms */
export declare function finish(ch: Chans, sr: number, opts?: {
    fadeMs?: number;
    dc?: boolean;
    thresh?: number;
}): Chans;
/** make a seamless loop: buffers are rendered `xf` seconds longer than the loop; the tail is crossfaded into the head */
export declare function loopify(ch: Chans, sr: number, xfSecs: number): Chans;
export interface Pan {
    l: number;
    r: number;
}
export declare const panGains: (p: number) => Pan;
/**
 * Minnaert bubble after van den Doel ("Physically based models for liquid sounds", 2005):
 * a damped sinusoid f0 = 3/r whose pitch rises as the bubble nears the surface.
 * r in mm. `rise` 0.1 ≈ natural (pitch +~10 % over 3 time constants), 1 ≈ strong "bloop" (~2x).
 * `damp` scales the decay rate (1 = physical, <1 rings longer).
 */
export declare function addBubble(ch: Chans, sr: number, t0: number, rMm: number, amp: number, rise?: number, damp?: number, pan?: Pan): void;
/** sum of exponentially decaying partials: [freq Hz, amp, decay seconds (to -60 dB)] */
export declare function addModal(ch: Chans, sr: number, t0: number, partials: [number, number, number][], amp?: number, pan?: Pan, attackMs?: number): void;
/** filtered noise grain with attack/decay envelope (exp decay, tau seconds) */
export declare function addNoiseGrain(ch: Chans, sr: number, rng: Rng, t0: number, opts: {
    dur: number;
    amp: number;
    attack?: number;
    tau?: number;
    f?: number;
    q?: number;
    type?: 'bp' | 'lp' | 'hp';
    f2?: number;
    pan?: Pan;
    shape?: 'exp' | 'sine' | 'tri';
}): void;
/** a tiny impulse "tick" (droplet impact / grain click): band-limited, with a short raised onset */
export declare function addTick(ch: Chans, sr: number, rng: Rng, t0: number, amp: number, f?: number, durMs?: number, pan?: Pan): void;
/** sine/harmonic voice with per-sample frequency & amplitude arrays (control-rate arrays are linearly interpolated) */
export declare function renderVoice(sr: number, f: Float32Array, a: Float32Array, ctrlRate: number, harm: number[], out?: Float32Array, phase0?: number): Float32Array<ArrayBufferLike>;
/** control-rate contour builder: piecewise glides of frequency and amplitude */
export declare class Contour {
    rate: number;
    dur: number;
    f: Float32Array;
    a: Float32Array;
    constructor(rate: number, dur: number, f0?: number);
    private idx;
    /** glide f from f0 to f1 over [t, t+d] with curve exponent (1 linear-in-log), amp envelope by function */
    note(t: number, d: number, f0: number, f1: number, amp: number, env?: (u: number) => number, curve?: number, fShape?: (u: number) => number): this;
    /** set frequency only (for legato) */
    freq(t: number, d: number, fn: (u: number) => number): this;
    amp(t: number, d: number, fn: (u: number) => number): this;
    /** hold the frequency of gaps at the neighbouring note's value (avoids pitch jumps while silent) */
    fillGaps(): this;
}
export declare const envBell: (u: number) => number;
export declare const envAD: (att: number) => (u: number) => number;
export declare const envPluck: (u: number) => number;
export declare const envFlat: (att?: number, rel?: number) => (u: number) => number;
/** apply a function per sample of an array (convenience) */
export declare function mapArr(a: Float32Array, fn: (x: number, i: number) => number): Float32Array<ArrayBufferLike>;
/** mix src into dst at sample offset with gain (and optional stereo pan when dst is stereo and src mono) */
export declare function mixInto(dst: Chans, src: Float32Array, offset: number, gain?: number, pan?: Pan): void;
/** PolyBLEP band-limited sawtooth oscillator */
export declare function polyBlep(t: number, dt: number): number;
/** Karplus-Strong plucked string with fractional tuning, loop damping and optional stiffness (dispersion) */
export declare function ksString(sr: number, f: number, secs: number, rng: Rng, o: {
    t60: number;
    t60hi?: number;
    pos?: number;
    excLp?: number;
    excMs?: number;
    stiff?: number;
    pickNoise?: number;
}): Float32Array;
//# sourceMappingURL=dsp.d.ts.map