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

// (4×4 column-major, in doubles)
function mul4(a: ArrayLike<number>, b: ArrayLike<number>, out = new Float64Array(16)) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = v;
  }
  out.set(o);
  return out;
}
function inv4(m: ArrayLike<number>) {
  // (Gauss-Jordan with partial pivoting on [m | I], rows of the row-major form)
  const a: number[][] = [];
  for (let r = 0; r < 4; r++) a.push([m[r], m[4 + r], m[8 + r], m[12 + r], r === 0 ? 1 : 0, r === 1 ? 1 : 0, r === 2 ? 1 : 0, r === 3 ? 1 : 0]);
  for (let c = 0; c < 4; c++) {
    let piv = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    [a[c], a[piv]] = [a[piv], a[c]];
    const d = a[c][c] || 1e-30;
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++) if (r !== c) { const f = a[r][c]; if (f) for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k]; }
  }
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = a[r][4 + c];
  return out;
}

const halton = (i: number, b: number) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export class Taau {
  /** on: off leaves the camera unjittered and `out` the source; feedback: the least share of a new frame (lower:
   *  smoother, slower to settle); clip: the history's clip box width (sigmas); antiFlicker: how much a clipped history
   *  lets the new frame in; sharpen 0..1 (0: no sharpening pass); phases: the jitter sequence's length (more when
   *  upscaling further: about 8 × (output / render)²); debug: the history's rejections in red */
  params = {
    on: true, feedback: 1 / 12, clip: 1, antiFlicker: 0.6, sharpen: 0.35, phases: 16, debug: false,
    /** the depth mismatch (relative) past which the history is dropped: what moved by itself, what was uncovered */
    depthReject: 0.035,
    /** the scene's exposure (or a function giving it each frame): the blend's tonemap sees what the eye will, so a
     *  night scene's dim values and a day's bright ones are weighed alike */
    exposure: 1 as number | (() => number),
  };
  /** the jitter this frame was drawn with (render pixels, Camera.jitter's sense): for an app whose own ray marches
   *  build their rays without the camera's projection, to jitter them the same */
  jitter: [number, number] = [0, 0];
  /** the anti-aliased picture at the output size (a Ref: bind it where the source was; read its rgb — with sharpening
   *  off its alpha is the history's depth) */
  readonly out: Ref<Texture>;
  /** the run items: put them after the scene's last pass that should be anti-aliased */
  readonly items: RunEntry[];
  readonly hist: PingPong<Texture>;
  readonly sharp: Texture | null;
  readonly u: UniformBuffer<any>;
  private resolveC: Compute;
  private sharpC: Compute | null;
  private view: View;
  // (last frame's unjittered projection, rotation and position, in doubles: the reprojection is made from the camera's
  // step, never from world positions — two thousand kilometres up, a float's world position is ~12 cm coarse)
  private prevP = new Float64Array(16);
  private prevR = new Float64Array(9);
  private prevPos = [0, 0, 0];
  private toCur = new Float64Array(16);
  private toPrev = new Float64Array(16);
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
    // this frame's projection with and without its jitter (Camera.update writes it into the projection)
    const Pj = Float64Array.from(cam.proj), Pu = Float64Array.from(cam.proj);
    const jx = (cam.jitter[0] * 2) / w, jy = (cam.jitter[1] * 2) / h;
    if (cam.ortho) { Pu[12] -= jx; Pu[13] -= jy; } else { Pu[8] += jx; Pu[9] += jy; }
    const V = cam.view, R = Float64Array.from([V[0], V[1], V[2], V[4], V[5], V[6], V[8], V[9], V[10]]);
    const pos = [cam.position[0], cam.position[1], cam.position[2]];
    const hw = this.hist.a.width, hh = this.hist.a.height;
    // (a camera cut — Camera.cut() — a jump, or a new output size starts the history over)
    const drop = this.dropNext || !this.have || hw !== this.histSize[0] || hh !== this.histSize[1] || cam.cuts !== this.cuts || this.jumped(cam);
    this.cuts = cam.cuts;
    this.histSize = [hw, hh];
    const iPj = inv4(Pj);
    mul4(Pu, iPj, this.toCur);
    if (this.have) {
      // the camera's step: last frame's view times this frame's inverse = [Rp·Rcᵀ | Rp·(pc − pp + shift)]
      const Rp = this.prevR, d = this.shifted;
      const t = [pos[0] - this.prevPos[0] + d[0], pos[1] - this.prevPos[1] + d[1], pos[2] - this.prevPos[2] + d[2]];
      const S = new Float64Array(16);
      // (R as stored: column-major 3×3, R[c*3+r]; Rp·Rcᵀ: (r, c) = Σk Rp(r,k)·Rc(c,k))
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          let v = 0;
          for (let k = 0; k < 3; k++) v += Rp[k * 3 + r] * R[k * 3 + c];
          S[c * 4 + r] = v;
        }
        S[12 + r] = Rp[r] * t[0] + Rp[3 + r] * t[1] + Rp[6 + r] * t[2];
      }
      S[15] = 1;
      mul4(this.prevP, mul4(S, iPj), this.toPrev);
    } else this.toPrev.set(this.toCur);
    this.shifted = [0, 0, 0];
    this.prevP.set(Pu); this.prevR.set(R); this.prevPos = pos;
    const E = typeof P.exposure === 'function' ? P.exposure() : P.exposure;
    this.jitter = [cam.jitter[0], cam.jitter[1]];
    this.u.set({
      toCur: Float32Array.from(this.toCur), toPrev: Float32Array.from(this.toPrev),
      jitter: [cam.jitter[0], cam.jitter[1], drop ? 1 : 0, Math.min(1, Math.max(0, P.sharpen))],
      k: [P.feedback, P.clip, P.antiFlicker, P.debug ? 1 : 0],
      o: [this.velocity ? 1 : 0, E > 0 && isFinite(E) ? E : 1, cam.ortho ? 1 : 0, Math.max(0, P.depthReject)],
    });
    // (uploaded now: the encoder's commands are submitted after this write)
    this.u.upload();
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
