import { Rendered, Rng } from './dsp';
/** a knock: a short resonant tock — kind 0 brick/stone, 1 wood, 2 metal, 3 concrete */
export declare function knock(p: {
    kind: number;
}, rng: Rng, sr: number): Rendered;
/** masonry giving way: a deep thump, then a fall of grit and chunks thinning out (size 0..1) */
export declare function crumble(p: {
    size?: number;
}, rng: Rng, sr: number): Rendered;
/** wood splitting: a sharp crack, splinters, a hollow knock under it */
export declare function splinter(_p: object, rng: Rng, sr: number): Rendered;
/** steel struck hard: a clang, partials beating as they ring away */
export declare function clang(p: {
    pitch?: number;
}, rng: Rng, sr: number): Rendered;
/** a collapse's rumble (loop) */
export declare function rumble(_p: object, rng: Rng, sr: number): Rendered;
/** a cutting laser (loop): a buzz with a hiss over it */
export declare function laserLoop(_p: object, rng: Rng, sr: number): Rendered;
/** a black hole (loop): a sub drone and a dark rushing, beating slowly */
export declare function holeLoop(_p: object, rng: Rng, sr: number): Rendered;
/** something falling from very high: a whistle dropping in pitch, the air roaring louder */
export declare function incoming(_p: object, rng: Rng, sr: number): Rendered;
//# sourceMappingURL=smash.d.ts.map