import { Rendered, Rng } from './dsp';
import type { Surface } from '../types';
/** one footstep (heel then toe) on a surface */
export declare function step(p: {
    surface: Surface | 'wade';
}, rng: Rng, sr: number): Rendered;
/** jump push-off whoosh (body/cloth through air) */
export declare function jumpWhoosh(_p: unknown, rng: Rng, sr: number): Rendered;
/** landing body thump */
export declare function bodyThump(p: {
    heavy?: number;
}, rng: Rng, sr: number): Rendered;
/** a startled flock taking off: overlapping wingbeat trains moving away, a few alarm chips */
export declare function flurry(p: {
    count?: number;
}, rng: Rng, sr: number): Rendered;
/** UI: open = a rising water drop with two soft pentatonic bell tones; close = falling drop + wooden tock; click = tock */
export declare function ui(p: {
    kind: 'open' | 'close' | 'click';
}, rng: Rng, sr: number): Rendered;
/** paper spirit lantern knocked out: soft papery thump + crinkle, a little spray, the flame doused (sizzle + steam) */
export declare function lanternHit(_p: unknown, rng: Rng, sr: number): Rendered;
/** lantern re-lighting and floating up: soft relight puff, flame flutter, an airy rising shimmer */
export declare function lanternRise(_p: unknown, rng: Rng, sr: number): Rendered;
/** cloth / hair flutter in a strong airflow (mono loop): irregular flapping pulses through fabric resonances */
export declare function flutter(_p: unknown, rng: Rng, sr: number): Rendered;
/** take-off / landing whoosh: a broad air sweep with a burst of cloth flaps (dir 'up' rises, 'down' settles) */
export declare function flyWhoosh(p: {
    dir?: 'up' | 'down';
}, rng: Rng, sr: number): Rendered;
//# sourceMappingURL=foley.d.ts.map