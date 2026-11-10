import { Rendered, Rng } from './dsp';
/** hermit thrush: a pure intro whistle, then an ethereal, rapid flute-like flourish sung with two voices */
export declare function thrush(p: {
    level?: number;
}, rng: Rng, sr: number): Rendered;
/** chickadee "fee-bee" */
export declare function chickadee(_p: unknown, rng: Rng, sr: number): Rendered;
/** chickadee "chick-a-dee-dee-dee" */
export declare function chickadeeCall(_p: unknown, rng: Rng, sr: number): Rendered;
/** woodpecker: drumming (rapid knocks with a trunk resonance) or slow foraging taps */
export declare function woodpecker(p: {
    taps?: boolean;
}, rng: Rng, sr: number): Rendered;
/** raven: deep, rough, resonant croaks; optional fly-over wingbeats */
export declare function raven(p: {
    flyby?: boolean;
}, rng: Rng, sr: number): Rendered;
/** red-tailed-hawk-like scream: hoarse, descending "kee-eeeer" */
export declare function hawk(_p: unknown, rng: Rng, sr: number): Rendered;
/** eagle: thin, high chittering "kleek-kik-ik-ik" */
export declare function eagle(_p: unknown, rng: Rng, sr: number): Rendered;
/** common-loon wail: soft onset, a held note, a slide up to a higher held note (and sometimes a third) */
export declare function loonWail(_p: unknown, rng: Rng, sr: number): Rendered;
/** loon tremolo ("laughing"): rapid frequency/amplitude warble */
export declare function loonTremolo(_p: unknown, rng: Rng, sr: number): Rendered;
/** loon yodel: a rising intro then repeated two-syllable phrases */
export declare function loonYodel(_p: unknown, rng: Rng, sr: number): Rendered;
/** great horned owl: "hoo, h'hoo — hoo — hoo" */
export declare function owl(_p: unknown, rng: Rng, sr: number): Rendered;
/** wolf howl: long glide up, sustained waver, falling end; optional second wolf */
export declare function wolf(p: {
    n?: number;
}, rng: Rng, sr: number): Rendered;
/** American dipper: loud, varied, repeated whistles, trills and buzzes */
export declare function dipper(_p: unknown, rng: Rng, sr: number): Rendered;
/** belted kingfisher: a dry, mechanical rattle */
export declare function kingfisher(_p: unknown, rng: Rng, sr: number): Rendered;
/** robin-like caroling: slurred whistled phrases */
export declare function robin(_p: unknown, rng: Rng, sr: number): Rendered;
/** warbler/sparrow trill: rapid down-chirps, often accelerating */
export declare function warbler(_p: unknown, rng: Rng, sr: number): Rendered;
/** chorus frog "krek-ek": pulsed nasal ratchet, rising */
export declare function chorusFrog(_p: unknown, rng: Rng, sr: number): Rendered;
/** toad trill: a long, sweet musical trill */
export declare function toad(_p: unknown, rng: Rng, sr: number): Rendered;
/** green frog "gunk": a loose banjo-string twang, sometimes repeated */
export declare function greenFrog(_p: unknown, rng: Rng, sr: number): Rendered;
/** one cricket chirp: a few carrier pulses; kind 'field' (~4.6 kHz, 3-5 pulses) or 'tree' (~2.8 kHz, more pulses) */
export declare function cricketChirp(p: {
    kind?: 'field' | 'tree';
}, rng: Rng, sr: number): Rendered;
/** distant cricket chorus bed (stereo loop) */
export declare function cricketBed(_p: unknown, rng: Rng, sr: number): Rendered;
/** leaf rustle loop: papery resonant grains in gust flurries (after the autumnvibes soundscape) */
export declare function rustle(p: {
    needles?: boolean;
}, rng: Rng, sr: number): Rendered;
/** osprey: a series of clear, high, up-slurred whistles "kyew-kyew-kyew", rising in urgency */
export declare function osprey(_p: unknown, rng: Rng, sr: number): Rendered;
/** common merganser: low, harsh frog-like croaks */
export declare function merganser(_p: unknown, rng: Rng, sr: number): Rendered;
/** Canada goose: nasal two-part honks "ha-RONK", sometimes two birds */
export declare function goose(p: {
    birds?: number;
}, rng: Rng, sr: number): Rendered;
/** bull elk bugle: low growl climbing to a long, high, pure whistle over a rough low voice, falling into grunts */
export declare function elk(_p: unknown, rng: Rng, sr: number): Rendered;
/** elk alarm bark: a short, harsh, noisy "aagh" */
export declare function elkAlarm(_p: unknown, rng: Rng, sr: number): Rendered;
/** hoary marmot: a loud, piercing whistle (sometimes a few) */
export declare function marmot(_p: unknown, rng: Rng, sr: number): Rendered;
/** dipper call: a buzzy "zeet", 1-3 times */
export declare function dipperCall(_p: unknown, rng: Rng, sr: number): Rendered;
/** golden-crowned kinglet: very high thin "tsee-tsee-tsee", sometimes tumbling into a chatter */
export declare function kinglet(_p: unknown, rng: Rng, sr: number): Rendered;
/** chipping-sparrow-like dry trill of rapid chips on one pitch */
export declare function sparrow(_p: unknown, rng: Rng, sr: number): Rendered;
/** dark-eyed junco: a sweet, musical trill of slurred notes on one pitch */
export declare function junco(_p: unknown, rng: Rng, sr: number): Rendered;
/** American pika: short, nasal, high "eeep" squeaks, 1-4 in a row */
export declare function pika(_p: unknown, rng: Rng, sr: number): Rendered;
//# sourceMappingURL=nature.d.ts.map