import type { V3 } from './types';
import { Mixer, Bus } from './mixer';
import { SynthService } from './synth-service';
import { Rng } from './synth/dsp';
export type BusId = 'amb' | 'sfx' | 'music' | 'ui';
export interface PlayOpts {
    bus: BusId;
    pos?: V3 | null;
    pan?: number;
    gain?: number;
    rate?: number;
    detune?: number;
    rev?: number;
    echo?: number;
    lp?: number;
    hp?: number;
    ref?: number;
    rolloff?: number;
    minGain?: number;
    hrtf?: boolean;
    group?: string;
    limit?: number;
    when?: number;
    offset?: number;
    dur?: number;
    fadeIn?: number;
    move?: {
        to: V3;
        secs: number;
    };
    rateTo?: {
        v: number;
        secs: number;
    };
    air?: boolean;
    dest?: AudioNode;
}
export interface Voice {
    src: AudioBufferSourceNode;
    gain: GainNode;
    nodes: AudioNode[];
    start: number;
    end: number;
    group?: string;
    stopped: boolean;
}
export declare const len3: (a: V3) => number;
export declare const dist3: (a: V3, b: V3) => number;
export declare const GROUP_LIMITS: Record<string, number>;
export declare class Core {
    readonly ctx: BaseAudioContext;
    readonly rng: Rng;
    readonly mixer: Mixer;
    readonly synth: SynthService;
    readonly listener: {
        pos: V3;
        fwd: V3;
        up: V3;
        player: V3;
    };
    private voices;
    private tracked;
    private groups;
    private paramLast;
    stats: {
        started: number;
        stolen: number;
        peakVoices: number;
    };
    constructor(ctx: BaseAudioContext, seed: number, synthMode: 'worker' | 'sync', bypassMaster?: boolean);
    get now(): number;
    bus(id: BusId): Bus | GainNode;
    /** attenuation distance: sounds near the player keep a consistent level regardless of camera zoom */
    attenDist(p: V3): number;
    /** smoothed param set, skipping redundant automation events */
    set(p: AudioParam, v: number, tau?: number, eps?: number): void;
    setListener(pos: V3, fwd: V3, up: V3, player: V3): void;
    makePanner(hrtf?: boolean): PannerNode;
    setPannerPos(p: PannerNode, v: V3, when?: number, tau?: number): void;
    distGain(d: number, ref?: number, rolloff?: number, minGain?: number): number;
    airLp(d: number): number;
    /** play a buffer as a one-shot voice */
    play(buf: AudioBuffer | null, o: PlayOpts): Voice | null;
    stopVoice(v: Voice, fade?: number): void;
    /** keep arbitrary nodes (oscillator voices) until `end`, then disconnect them */
    track(nodes: AudioNode[], end: number): void;
    /** disconnect finished voices */
    sweep(): void;
    get activeVoices(): number;
}
/** a continuously running loop (ambience bed / bending layer) with gain, filter, optional HRTF panner */
export declare class Loop {
    private core;
    readonly src: AudioBufferSourceNode;
    readonly gain: GainNode;
    readonly filter: BiquadFilterNode | null;
    readonly filter2: BiquadFilterNode | null;
    readonly panner: PannerNode | null;
    readonly stereo: StereoPannerNode | null;
    readonly revSend: GainNode | null;
    readonly echoSend: GainNode | null;
    private alive;
    constructor(core: Core, buf: AudioBuffer, o: {
        bus: BusId;
        positional?: boolean;
        hrtf?: boolean;
        filter?: BiquadFilterType;
        freq?: number;
        q?: number;
        filter2?: BiquadFilterType;
        freq2?: number;
        q2?: number;
        rate?: number;
        rev?: number;
        echo?: number;
        pan?: number;
        offset?: number;
        dest?: AudioNode;
    });
    set(v: number, tau?: number): void;
    freq(f: number, tau?: number): void;
    freq2(f: number, tau?: number): void;
    rate(r: number, tau?: number): void;
    rev(v: number, tau?: number): void;
    pos(v: V3, tau?: number): void;
    pan(p: number, tau?: number): void;
    dispose(fade?: number): void;
}
/** a set of lazily-created loops: built when their gain becomes audible, disposed after a few seconds of silence */
export declare class LayerSet {
    private core;
    private loops;
    private idle;
    dt: number;
    constructor(core: Core);
    layer(key: string, buf: string, o: ConstructorParameters<typeof Loop>[2], gain: number, tau?: number): Loop | null;
    levels(prefix?: string): Record<string, number>;
    get count(): number;
}
//# sourceMappingURL=core.d.ts.map