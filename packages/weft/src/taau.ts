// TAAU: temporal anti-aliasing with upscaling (shaders/taau.wgsl). The scene is drawn at the render size with its
// camera jittered by a sub-pixel Halton offset each frame; `items` gather each frame into a history at the output size
// (the canvas, by default), reprojected by the camera's motion, clipped to what this frame has around each pixel, then
// sharpened by local contrast. What comes out (`out`) is anti-aliased and at the output size, however small the render
// is: an AutoResolution's lowered scale costs detail it gets back over a few frames, not a softer picture; and since
// the history is kept at the output size, a change of render scale doesn't drop it.
//
//   const taau = new Taau(kit, hdr, depth);            // after the scene and its transparent passes, before bloom
//   kit.run([...scene, ...taau.items, bloomFrom(taau.out), composite(taau.out)]);
//
// The jitter for the next frame is set on the view's camera as the items run, so every pass of a frame sees one jitter
// (whatever a game does with its camera before kit.run, so long as it leaves `jitter` to this). Moving objects reproject
// by the camera's motion alone (no velocity buffer): the clip keeps them from ghosting. Call `cut()` after a camera cut.
import type { Kit, View, RunEntry } from './kit';
import type { Compute } from './passes';
import { Ref, type Texture, type UniformBuffer, PingPong, RunAction } from './resources';
import { mat4Mul } from './math';
import taauShader from '../shaders/taau.wgsl';

export interface TaauOptions {
  /** the output size: 'canvas' (the default) or 'render' (anti-aliasing alone, no upscale) */
  output?: 'canvas' | 'render';
  /** the view whose camera is jittered and reprojected (default kit.mainView) */
  view?: View;
  /** a label for its textures and passes */
  label?: string;
}

const halton = (i: number, b: number) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export class Taau {
  /** on: off leaves the camera unjittered and `out` the source; feedback: the least share of a new frame (lower:
   *  smoother, slower to settle); clip: the history's clip box width (sigmas); antiFlicker: how much a clipped history
   *  lets the new frame in; sharpen 0..1 (0: no sharpening pass); phases: the jitter sequence's length (more when
   *  upscaling further: about 8 × (output / render)²); debug: the history's rejections in red */
  params = { on: true, feedback: 1 / 12, clip: 1.25, antiFlicker: 0.6, sharpen: 0.35, phases: 16, debug: false };
  /** the anti-aliased picture at the output size (a Ref: bind it where the source was) */
  readonly out: Ref<Texture>;
  /** the run items: put them after the scene's last pass that should be anti-aliased */
  readonly items: RunEntry[];
  readonly hist: PingPong<Texture>;
  readonly sharp: Texture;
  readonly u: UniformBuffer<any>;
  private resolveC: Compute;
  private sharpC: Compute;
  private view: View;
  private prevVP = new Float32Array(16);
  private curVP = new Float32Array(16);
  private proj = new Float32Array(16);
  private have = false;
  private dropNext = true;
  private histSize = [0, 0];
  private index = 0;

  constructor(private kit: Kit, readonly src: Texture, readonly depth: Texture, opts: TaauOptions = {}) {
    const k = kit, label = opts.label ?? 'taau', size = opts.output ?? 'canvas';
    this.view = opts.view ?? k.mainView;
    const tex = (l: string) => k.texture({ label: l, format: 'rgba16float', size, usage: ['storage', 'sample', 'copy-src'] });
    this.hist = k.pingpong((i) => tex(`${label}.hist${i}`), `${label}.hist`);
    this.sharp = tex(`${label}.sharp`);
    this.u = k.uniforms(taauShader.structs.Taau, label);
    const on = () => this.params.on;
    const threads = () => [this.hist.a.width, this.hist.a.height];
    this.resolveC = k.compute(taauShader, {
      label: `${label}.resolve`, entry: 'resolve', view: this.view, enabled: on, threads,
      bind: { T: this.u, taauSrc: src, taauDepth: depth, taauHist: this.hist.read, taauOut: this.hist.write },
    });
    this.sharpC = k.compute(taauShader, {
      label: `${label}.sharpen`, entry: 'sharpen', view: this.view, threads, enabled: () => on() && this.params.sharpen > 0,
      bind: { T: this.u, sharpSrc: this.hist.read, sharpOut: this.sharp },
    });
    const swap = new RunAction(() => { if (this.params.on) this.hist.flip(); }, `${label}.swap`);
    this.out = new Ref(() => (!this.params.on ? this.src : this.params.sharpen > 0 ? this.sharp : this.hist.current), `${label}.out`);
    this.items = [new RunAction(() => this.begin(), `${label}.begin`), this.resolveC, swap, this.sharpC];
  }

  /** drop the history (a camera cut, a teleport): the next frame starts it over */
  cut() { this.dropNext = true; }

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
    const drop = this.dropNext || !this.have || hw !== this.histSize[0] || hh !== this.histSize[1];
    this.histSize = [hw, hh];
    this.u.set({
      curVP: this.curVP, prevVP: this.have ? this.prevVP : this.curVP,
      jitter: [cam.jitter[0], cam.jitter[1], drop ? 1 : 0, Math.min(1, Math.max(0, P.sharpen))],
      k: [P.feedback, P.clip, P.antiFlicker, P.debug ? 1 : 0],
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
