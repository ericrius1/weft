import { Chans, Rendered, Rng } from './dsp';
export declare function addArr(dst: Float32Array, src: Float32Array, g?: number, off?: number): void;
/** granular amplitude texture: a sum of raised-cosine grains (gives noise a splattery, liquid grain) */
export declare function grainTexture(rng: Rng, n: number, sr: number, rate: (t: number) => number, dMin: number, dMax: number, ampPow?: number): Float32Array<ArrayBuffer>;
export interface SwarmOpts {
    t0: number;
    n: number;
    rMin: number;
    rMax: number;
    amp: number;
    /** exponential time constant of the onsets (s); otherwise uniform over `dur` */
    decay?: number;
    dur?: number;
    rise?: [number, number];
    damp?: number;
    panSpread?: number;
    panCenter?: number;
    rPow?: number;
}
/** a population of bubbles, radii log-uniform, louder for bigger bubbles */
export declare function swarm(ch: Chans, sr: number, rng: Rng, o: SwarmOpts): void;
/** a water drop: impact tick + "plink" (strongly rising bubble) + a tiny secondary drop (Worthington jet) */
export declare function drop(p: {
    big?: number;
}, rng: Rng, sr: number): Rendered;
/** the impact transient alone (layered on splashes by impact speed) */
export declare function slap(p: {
    size: number;
}, rng: Rng, sr: number): Rendered;
/**
 * Splash: slap transient + granular crown body + bubble swarm + cavity "bloop" + droplet patter tail
 * (+ a fall-back wash for the big ones). size 0..1.
 */
export declare function splash(p: {
    size: number;
}, rng: Rng, sr: number): Rendered;
/** cavity plop: a stone/fish entering water — small slap, deep bloop, a few drops */
export declare function plop(p: {
    size?: number;
}, rng: Rng, sr: number): Rendered;
/** rising bubbles (underwater breath / plunge) */
export declare function bubbleRise(p: {
    n?: number;
    dur?: number;
}, rng: Rng, sr: number): Rendered;
/** draw: water lifted out of the surface — suction "schlorp", rising pour, droplets falling back */
export declare function draw(p: {
    amount?: number;
}, rng: Rng, sr: number): Rendered;
/** whip: a fast bandpass whoosh (with doppler-ish fall) tearing a stream of spray, then patter */
export declare function whip(p: {
    heavy?: number;
}, rng: Rng, sr: number): Rendered;
/** wave: building surge -> crash -> foaming wash that recedes */
export declare function wave(p: {
    size?: number;
}, rng: Rng, sr: number): Rendered;
/** lake shore lapping: irregular wavelets that slosh against stones, glug into gaps and fizz as they recede */
export declare function lap(p: {
    choppy: number;
}, rng: Rng, sr: number): Rendered;
/** river: the babbling body of a stream (mid distance) — turbulent noise + dense mid-size bubbles, stereo */
export declare function riverBody(_p: unknown, rng: Rng, sr: number): Rendered;
/** river close-up: rapids detail — small splashes, gurgles, spray hiss, standing-wave surges, stereo */
export declare function riverDetail(_p: unknown, rng: Rng, sr: number): Rendered;
/** waterfall roar (mono, positional): pounding low thunder + broadband impact splatter + huge bubble swarm */
export declare function fallsRoar(_p: unknown, rng: Rng, sr: number): Rendered;
/** waterfall mist: fine spray hiss and droplet rain (stereo, diffuse) */
export declare function fallsMist(_p: unknown, rng: Rng, sr: number): Rendered;
/** underwater bed: low pressure rumble, distant muffled bubbling (rendered at low sample rate) */
export declare function underwaterBed(_p: unknown, rng: Rng, sr: number): Rendered;
/** held water: gurgling (clusters of mid bubbles) — mono loop */
export declare function gurgle(_p: unknown, rng: Rng, sr: number): Rendered;
/** held water: sloshing mass (slow heavy swells with big glugs) — mono loop */
export declare function slosh(_p: unknown, rng: Rng, sr: number): Rendered;
/** swirl / stream: a continuous rushing ribbon of water (granular band noise + quick bubbles) — mono loop */
export declare function stream(_p: unknown, rng: Rng, sr: number): Rendered;
/** noise loops for realtime filtering */
export declare function noiseLoop(p: {
    color: 'white' | 'pink' | 'brown';
    secs?: number;
}, rng: Rng, sr: number): Rendered;
/** going under: the dull thump of the body hitting the water, a whoosh sinking in pitch, the rush of air dragged down
 *  with it — a swarm of bubbles, a few big glugs — all heard from inside the water (no air-borne crack) */
export declare function plunge(_p: unknown, rng: Rng, sr: number): Rendered;
/** coming up for air: a calm, open-mouthed breath in — breathy noise shaped by a mouth formant that opens as it goes */
export declare function breath(_p: unknown, rng: Rng, sr: number): Rendered;
/** a soft knock from somewhere in the lake: a stone settling, a pebble tumbling down a slope — a few low inharmonic
 *  partials behind a muffled tap */
export declare function uwKnock(_p: unknown, rng: Rng, sr: number): Rendered;
/** the lake's slow breathing heard from inside it: soft surges of distant water moving (wavelets on the surface, the
 *  far shore), and the faint fizz of tiny bubbles far off — a stereo loop */
export declare function uwSwell(_p: unknown, rng: Rng, sr: number): Rendered;
//# sourceMappingURL=water.d.ts.map