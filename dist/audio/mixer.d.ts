import type { SceneId, Volumes } from './types';
import type { SynthService } from './synth-service';
export interface Bus {
    dry: GainNode;
    rev: GainNode;
    echo: GainNode;
}
export declare class Mixer {
    private ctx;
    private synth;
    readonly sum: GainNode;
    readonly world: GainNode;
    readonly amb: Bus;
    readonly sfx: Bus;
    readonly music: Bus;
    readonly ui: GainNode;
    readonly master: GainNode;
    readonly startFade: GainNode;
    private envIn;
    private echoIn;
    private uw1;
    private uw2;
    private cloudShelf;
    private musicLp;
    /** score swell (flight 'adventure' layer), 1 = neutral */
    readonly musicSwell: GainNode;
    private musicRevIn;
    private musicDelayIn;
    private env;
    private echo;
    private dying;
    private scene;
    private vol;
    readonly comp: DynamicsCompressorNode | null;
    readonly limiter: DynamicsCompressorNode | null;
    constructor(ctx: BaseAudioContext, synth: SynthService, bypass?: boolean);
    private attachScene;
    setScene(scene: SceneId): void;
    /** remove retired convolvers after their fade */
    tick(now: number): void;
    /** under water (u 0..1, eased by the caller; depth in m): the world above heard through the surface — a smooth
     *  low-pass with a little resonance, sweeping down as the head goes under (log-interpolated, so the crossfade sounds
     *  even), a touch darker deeper down; the score softened rather than drowned */
    setUnderwater(u: number, depth?: number): void;
    /** in a cloud (k 0..1): the world's sounds soften — its highs damped a little, as if through wool */
    setCloud(k: number): void;
    setVolumes(v: Volumes, tau?: number): void;
    get volumes(): Volumes;
    fadeIn(secs: number): void;
}
//# sourceMappingURL=mixer.d.ts.map