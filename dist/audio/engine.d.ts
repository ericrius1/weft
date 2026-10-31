import type { AudioEngineOptions, AudioEvent, AudioState, DebugCall, Volumes } from './types';
import type { V3 } from './types';
export declare class AudioEngine {
    private opts;
    private core;
    private amb;
    private sfx;
    private mus;
    private motorLoop;
    private fly;
    private cloud;
    private space;
    private spaceHold;
    private vol;
    private readyP;
    private paramTimer;
    private constructor();
    static create(opts?: AudioEngineOptions): AudioEngine;
    /** resolves when all pre-rendered sound banks exist (sounds missing before that are simply skipped) */
    get ready(): Promise<void>;
    resume(): Promise<void>;
    get running(): boolean;
    setVolumes(v: Partial<Volumes>): void;
    update(dt: number, s: AudioState): void;
    private lastUnder;
    event(e: AudioEvent): void;
    /** the score's stings: a star taken, a star home, a constellation whole, the finale */
    cue(kind: 'take' | 'home' | 'whole' | 'finale'): void;
    /** the glove's magic and the world's creatures: one-shots from the bank, placed in the world */
    magic(kind: 'cast' | 'catch' | 'zip' | 'fling' | 'seed' | 'bounce' | 'star' | 'rise' | 'ray', pos: V3, o?: {
        gain?: number;
        rate?: number;
    }): void;
    /** a one-shot from the bank (a game's own sounds): positional when pos is given */
    play(key: string, o?: {
        pos?: V3 | null;
        gain?: number;
        rate?: number;
        ref?: number;
        rev?: number;
        echo?: number;
        pan?: number;
        group?: string;
        delay?: number;
        lp?: number;
    }): void;
    /** a named loop (a game's engine hum, a rocket's hiss): created on first use, its level, rate, filter and position set every frame */
    private loops;
    loop(key: string, level: number, o?: {
        rate?: number;
        freq?: number;
        pos?: V3 | null;
        rev?: number;
    }): void;
    /** the rover's motor: on while driving, its pitch and level following the speed (m/s) */
    motor(on: boolean, speed?: number, pos?: V3): void;
    suspend(): void;
    /** the underlying context (null before resume) */
    get context(): BaseAudioContext | null;
    /** trigger a wildlife call now (audition / scripted moments) */
    debugCall(name: DebugCall, dist?: number): void;
    /** music control: rest for `secs` seconds, or start the next piece right away */
    musicRest(secs: number): void;
    musicStart(): void;
    /** receive a textual score of what the composer plays (debug) */
    musicLog(fn: ((line: string) => void) | null): void;
    stats(): {
        voices: number;
        started: number;
        stolen: number;
        peakVoices: number;
        bankMs: number;
        bankMB: number;
        music: {
            mode: "rest" | "piece";
            bar: number;
            prog: string;
            adv: number;
        } | undefined;
        layers: {
            [x: string]: number;
        };
        reduction: number;
    } | null;
    /** an AnalyserNode on the final output (metering in tools) */
    analyser(): AnalyserNode | null;
    private an;
    /** for games without the world's ambience: just place the listener (and tidy finished voices) each frame */
    listen(camPos: V3, camFwd: V3, camUp: V3): void;
    private grv;
    /** run the groove this frame (its sounds come from GROOVE_BANK in the game's bank): energy 0..1 */
    groove(dt: number, energy: number): void;
    grooveCue(kind: 'gem' | 'unlock' | 'pop' | 'win'): void;
    /** a marimba blip in the groove's chord, between lo and hi (MIDI) */
    grooveBlip(lo: number, hi: number, gain?: number, pan?: number): void;
    get grooveState(): {
        bar: number;
        prog: string;
        energy: number;
    } | null;
    /** tear everything down */
    dispose(): Promise<void>;
}
//# sourceMappingURL=engine.d.ts.map