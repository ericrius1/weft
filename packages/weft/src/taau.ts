// TAAU: temporal anti-aliasing with upscaling (shaders/taau.wgsl). The scene is drawn at the render size with its
// camera jittered by a sub-pixel Halton offset each frame; `items` gather each frame into a history at the output size
// (the canvas, by default), reprojected by the camera's motion, clipped to what this frame has around each pixel, then
// sharpened by local contrast. What comes out (`out`) is anti-aliased and at the output size, however small the render
// is: an AutoResolution's lowered scale costs detail it gets back over a few frames, not a softer picture; and since
// the history is kept at the output size, a change of render scale doesn't drop it.
//
//   const taau = new Taau(kit, hdr, depth);            // after the scene and its transparent passes, before bloom
//   (hdr single-sample — an MSAA scene's resolve target; depth either the resolved one or the multisampled one itself)
//   kit.run([...scene, ...taau.items, bloomFrom(taau.out), composite(taau.out)]);
//
// The jitter for the next frame is set on the view's camera as the items run, so every pass of a frame sees one jitter
// (whatever a game does with its camera before kit.run, so long as it leaves `jitter` to this). Moving objects reproject
// by the camera's motion alone (no velocity buffer): the clip keeps them from ghosting. Call `cut()` after a camera cut.
import type { Kit, View, RunEntry } from './kit';
import type { Compute } from './passes';
import { Ref, deref, type Texture, type UniformBuffer, PingPong, RunAction } from './resources';
import { mat4Mul } from './math';
import taauShader from '../shaders/taau.wgsl';

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
  jump?: { metres: number; rel: number; turn: number } | null;
}

const halton = (i: number, b: number) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export class Taau {
  /** on: off leaves the camera unjittered and `out` the source; feedback: the least share of a new frame (lower:
   *  smoother, slower to settle); clip: the history's clip box width (sigmas); antiFlicker: how much a clipped history
   *  lets the new frame in; sharpen 0..1 (0: no sharpening pass); phases: the jitter sequence's length (more when
   *  upscaling further: about 8 × (output / render)²); debug: the history's rejections in red */
  params = { on: true, feedback: 1 / 12, clip: 1, antiFlicker: 0.6, sharpen: 0.35, phases: 16, debug: false };
  /** the jitter this frame was drawn with (render pixels, Camera.jitter's sense): for an app whose own ray marches
   *  build their rays without the camera's projection, to jitter them the same */
  jitter: [number, number] = [0, 0];
  /** the anti-aliased picture at the output size (a Ref: bind it where the source was) */
  readonly out: Ref<Texture>;
  /** the run items: put them after the scene's last pass that should be anti-aliased */
  readonly items: RunEntry[];
  readonly hist: PingPong<Texture>;
  readonly sharp: Texture | null;
  readonly u: UniformBuffer<any>;
  private resolveC: Compute;
  private sharpC: Compute | null;
  private view: View;
  private prevVP = new Float32Array(16);
  private curVP = new Float32Array(16);
  private proj = new Float32Array(16);
  private have = false;
  private dropNext = true;
  private histSize = [0, 0];
  private index = 0;
  private cuts = -1;
  private shifted = [0, 0, 0];

  private jump: { metres: number; rel: number; turn: number } | null;
  private lastPos: number[] | null = null;
  private lastStep = 0;
  private lastFwd: number[] | null = null;

  /** src: the scene's colour at the render size (single-sample: an MSAA scene's resolve target), or a Ref to it;
   *  depth: its depth (depth32float — the resolved one, or the multisampled one itself) */
  constructor(private kit: Kit, readonly src: Texture | Ref<Texture>, readonly depth: Texture, opts: TaauOptions = {}) {
    const k = kit, label = opts.label ?? 'taau', size = opts.output ?? 'canvas';
    this.view = opts.view ?? k.mainView;
    const tex = (l: string) => k.texture({ label: l, format: 'rgba16float', size, usage: ['storage', 'sample', 'copy-src'] });
    this.hist = k.pingpong((i) => tex(`${label}.hist${i}`), `${label}.hist`);
    this.sharp = opts.sharpen === false ? null : tex(`${label}.sharp`);
    this.jump = opts.jump === undefined ? { metres: 10, rel: 4, turn: 0.45 } : opts.jump;
    this.u = k.uniforms(taauShader.structs.Taau, label);
    const on = () => this.params.on;
    const threads = () => [this.hist.a.width, this.hist.a.height];
    // (an MSAA scene's depth read straight from its first sample: no resolve needed)
    const ms = depth.samples > 1;
    this.velocity = opts.velocity ?? null;
    const vel = opts.velocity ?? k.texture({ label: `${label}.noVelocity`, format: 'rg16float', size: [1, 1], usage: ['sample'] });
    this.resolveC = k.compute(taauShader, {
      label: `${label}.resolve`, entry: ms ? 'resolveMS' : 'resolve', view: this.view, enabled: on, threads,
      bind: { T: this.u, taauSrc: src, [ms ? 'taauDepthMS' : 'taauDepth']: depth, taauHist: this.hist.read, taauOut: this.hist.write, taauVel: vel },
    });
    this.sharpC = this.sharp ? k.compute(taauShader, {
      label: `${label}.sharpen`, entry: 'sharpen', view: this.view, threads, enabled: () => on() && this.params.sharpen > 0,
      bind: { T: this.u, sharpSrc: this.hist.read, sharpOut: this.sharp },
    }) : null;
    const swap = new RunAction(() => { if (this.params.on) this.hist.flip(); }, `${label}.swap`);
    this.out = new Ref(() => (!this.params.on ? deref(this.src) as Texture : this.sharp && this.params.sharpen > 0 ? this.sharp : this.hist.current), `${label}.out`);
    this.items = [new RunAction(() => this.begin(), `${label}.begin`), this.resolveC, swap, this.sharpC];
    // (a Ref source is bound as given: resolved each run, so it may switch — the motion blur's output or the scene's)
  }

  private velocity: Texture | null;

  /** drop the history (a camera cut, a teleport): the next frame starts it over */
  cut() { this.dropNext = true; }

  /** the world's origin moved by d this frame (a floating origin: what was at p is drawn at p − d now), so last
   *  frame's matrix is carried over to the new origin and the history still lines up */
  shift(dx: number, dy: number, dz: number) { this.shifted[0] += dx; this.shifted[1] += dy; this.shifted[2] += dz; }

  // (a jump: this frame's step far past the last one's, or a sharp turn — Camera.cut() not called)
  private jumped(cam: { position: ArrayLike<number>; forward: ArrayLike<number> }) {
    const p = cam.position, f = cam.forward, J = this.jump;
    let hop = false;
    if (J && this.lastPos && this.lastFwd) {
      const step = Math.hypot(p[0] - this.lastPos[0], p[1] - this.lastPos[1], p[2] - this.lastPos[2]);
      const dot = f[0] * this.lastFwd[0] + f[1] * this.lastFwd[1] + f[2] * this.lastFwd[2];
      hop = (step > J.metres && step > J.rel * Math.max(this.lastStep, 1e-3)) || Math.acos(Math.max(-1, Math.min(1, dot))) > J.turn;
      this.lastStep = step;
    }
    this.lastPos = [p[0], p[1], p[2]];
    this.lastFwd = [f[0], f[1], f[2]];
    return hop;
  }

  /** the jitter the next frame uses, render pixels (Halton 2, 3 about the pixel's centre) */
  private nextJitter(): [number, number] {
    const n = Math.max(1, Math.round(this.params.phases));
    this.index = (this.index % n) + 1;
    return [halton(this.index, 2) - 0.5, halton(this.index, 3) - 0.5];
  }

  // (at the items' place in the run: this frame's matrices have been made with the camera's current jitter)
  private begin() {
    const cam = this.view.camera, P = this.params;
    if (!P.on) { cam.jitter = [0, 0]; this.have = false; return; }
    const w = this.view.width, h = this.view.height;
    // this frame's view-projection without its jitter (Camera.update writes it into the projection)
    this.proj.set(cam.proj);
    const jx = (cam.jitter[0] * 2) / w, jy = (cam.jitter[1] * 2) / h;
    if (cam.ortho) { this.proj[12] -= jx; this.proj[13] -= jy; } else { this.proj[8] += jx; this.proj[9] += jy; }
    mat4Mul(this.proj, cam.view, this.curVP);
    const hw = this.hist.a.width, hh = this.hist.a.height;
    // (a camera cut — Camera.cut() — or a new output size starts the history over)
    const drop = this.dropNext || !this.have || hw !== this.histSize[0] || hh !== this.histSize[1] || cam.cuts !== this.cuts || this.jumped(cam);
    this.cuts = cam.cuts;
    this.histSize = [hw, hh];
    // (a floating origin's move: last frame's matrix times a translation by it, prevVP · T(d))
    const d = this.shifted, P0 = this.prevVP;
    if (d[0] || d[1] || d[2]) {
      for (let r = 0; r < 4; r++) P0[12 + r] += P0[r] * d[0] + P0[4 + r] * d[1] + P0[8 + r] * d[2];
      d[0] = d[1] = d[2] = 0;
    }
    this.jitter = [cam.jitter[0], cam.jitter[1]];
    this.u.set({
      curVP: this.curVP, prevVP: this.have ? this.prevVP : this.curVP,
      jitter: [cam.jitter[0], cam.jitter[1], drop ? 1 : 0, Math.min(1, Math.max(0, P.sharpen))],
      k: [P.feedback, P.clip, P.antiFlicker, P.debug ? 1 : 0],
      o: [this.velocity ? 1 : 0, 0, 0, 0],
    });
    // (uploaded now: the encoder's commands are submitted after this write)
    this.u.upload();
    this.prevVP.set(this.curVP);
    this.have = true;
    this.dropNext = false;
    cam.jitter = this.nextJitter();
  }

  /** stop it for good: its passes and textures are freed (the camera left unjittered) */
  dispose() {
    this.view.camera.jitter = [0, 0];
    this.kit.release(this.resolveC, this.sharpC, this.hist.a, this.hist.b, this.sharp, this.u);
  }
}
