import type { Kit, View, RunEntry } from './kit';
import { Ref, type Texture, type UniformBuffer, PingPong } from './resources';
export interface TaauOptions {
    /** the output size: 'canvas' (the default) or 'render' (anti-aliasing alone, no upscale) */
    output?: 'canvas' | 'render';
    /** the view whose camera is jittered and reprojected (default kit.mainView) */
    view?: View;
    /** a label for its textures and passes */
    label?: string;
    /** the app's own motion vectors (rg: screen uv now − uv last frame, at the render size): what moves by itself — a
     *  creature, a car, a jiggling molecule — reprojects instead of ghosting. Without, the camera's motion alone */
    velocity?: Texture;
    /** a sharpening pass after the resolve (default true; false saves its canvas-size texture — a phone's ~20 MB — for
     *  an app whose final pass sharpens) */
    sharpen?: boolean;
    /** a camera move that's a jump, not motion (an autopilot's hop, a teleport that doesn't call Camera.cut()): this
     *  frame's step past `metres` and `rel` times the last frame's, or a turn past `turn` radians, drops the history.
     *  The step against the last one, not the speed: steady fast flight keeps its history. Default { metres: 10, rel: 4,
     *  turn: 0.45 }; null never */
    jump?: {
        metres: number;
        rel: number;
        turn: number;
    } | null;
}
export declare class Taau {
    private kit;
    readonly src: Texture | Ref<Texture>;
    readonly depth: Texture;
    /** on: off leaves the camera unjittered and `out` the source; feedback: the least share of a new frame (lower:
     *  smoother, slower to settle); clip: the history's clip box width (sigmas); antiFlicker: how much a clipped history
     *  lets the new frame in; sharpen 0..1 (0: no sharpening pass); phases: the jitter sequence's length (more when
     *  upscaling further: about 8 × (output / render)²); debug: the history's rejections in red */
    params: {
        on: boolean;
        feedback: number;
        clip: number;
        antiFlicker: number;
        sharpen: number;
        phases: number;
        debug: boolean;
        /** the depth mismatch (relative) past which the history is dropped: what moved by itself, what was uncovered */
        depthReject: number;
        /** the scene's exposure (or a function giving it each frame): the blend's tonemap sees what the eye will, so a
         *  night scene's dim values and a day's bright ones are weighed alike */
        exposure: number | (() => number);
    };
    /** the jitter this frame was drawn with (render pixels, Camera.jitter's sense): for an app whose own ray marches
     *  build their rays without the camera's projection, to jitter them the same */
    jitter: [number, number];
    /** the anti-aliased picture at the output size (a Ref: bind it where the source was; read its rgb — with sharpening
     *  off its alpha is the history's depth) */
    readonly out: Ref<Texture>;
    /** the run items: put them after the scene's last pass that should be anti-aliased */
    readonly items: RunEntry[];
    readonly hist: PingPong<Texture>;
    readonly sharp: Texture | null;
    readonly u: UniformBuffer<any>;
    private resolveC;
    private sharpC;
    private view;
    private prevP;
    private prevR;
    private prevPos;
    private toCur;
    private toPrev;
    private have;
    private dropNext;
    private histSize;
    private index;
    private cuts;
    private shifted;
    private jump;
    private lastPos;
    private lastStep;
    private lastFwd;
    /** src: the scene's colour at the render size (single-sample: an MSAA scene's resolve target), or a Ref to it;
     *  depth: its depth (depth32float — the resolved one, or the multisampled one itself) */
    constructor(kit: Kit, src: Texture | Ref<Texture>, depth: Texture, opts?: TaauOptions);
    private velocity;
    /** drop the history (a camera cut, a teleport): the next frame starts it over */
    cut(): void;
    /** the world's origin moved by d this frame (a floating origin: what was at p is drawn at p − d now), so last
     *  frame's matrix is carried over to the new origin and the history still lines up */
    shift(dx: number, dy: number, dz: number): void;
    private jumped;
    /** the jitter the next frame uses, render pixels (Halton 2, 3 about the pixel's centre) */
    private nextJitter;
    private begin;
    /** stop it for good: its passes and textures are freed (the camera left unjittered) */
    dispose(): void;
}
//# sourceMappingURL=taau.d.ts.map