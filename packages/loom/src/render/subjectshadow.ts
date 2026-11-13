// A subject's own sun shadow (shaders/subject.wgsl): one small orthographic map fitted round one subject's bounding
// sphere along the sun, finer than the cascades by an order — a bird's wing on its body, a hat's brim on a face, the
// subject's shadow crisp on the ground under it — and, with `layers`, a deep opacity map: how many of its surfaces lie
// between a point and the sun (light through feathers, hair, leaves).
//
//   const sub = new SubjectShadow(kit, { size: 256, layers: true });
//   bird.drawCasters(sub.depthPass);                    // a vertex entry: clipAt(world) (the pass's view is the light's),
//                                                       //   or subjectClipRel(S, r) for r relative to the scene's eye
//   bird.drawLayers(sub.layerPass);                     // (with layers) the same, fragment: subjectLayerOut(...) — see below
//   each frame, once the scene's camera is placed: sub.fit(centre, radius, sunDir); kit.run([...sub.passes(), scene, ...])
//   receivers bind sub.uniform, sub.depth (and sub.layers) and call subjectVis / subjectLayers (subject.wgsl), or the
//   ...Rel forms with positions relative to the eye
//
// Camera-relative, as weft's clipAt / clipRel are: the light's camera has its eye in doubles (no view override, whose
// eye a float32 inverse reads back), and the receivers' matrix takes positions relative to the scene's eye (the
// difference of the two eyes taken in doubles here), so the map's 5 mm texel holds 6,000 km from the world's origin
// as beside it (test/subjectshadow.test.mjs). Receivers must draw in the view whose eye fit() was given (the main
// view by default), and be fitted after that camera has moved for the frame.
//
// The map is fitted to the subject, not snapped to a world grid (the cascades' way): it moves with the subject, so its
// texels stay where they are on it and its self-shadow doesn't crawl as it flies. Its depth reaches `reach` metres past
// the sphere, away from the sun, so the ground under it falls in the map. The layers pass draws the same casters with
// the depth map bound as a texture (`subjectLayerOut(S, map, position.xy, position.z)`), each fragment adding one to the
// slice behind the first surface it falls in; its draws want `blend: 'add'`, `depthWrite: false`, `cull: 'none'`.
import type { Kit, RenderPass, RunEntry, Texture, UniformBuffer, V3 } from '@ericrius1/weft';
import { Camera } from '@ericrius1/weft';
import subjectShader from '../shaders/subject.wgsl';
import { fitSubject } from './subjectfit';

export interface SubjectShadowOptions {
  /** the map's side in texels (256 a desktop, 128 a small laptop) */
  size?: number;
  /** a layers map too (rgba16float, the same size): the count of surfaces behind the first, in four slices */
  layers?: boolean;
  /** the slices' far ends behind the first surface (m): what's within a feather's stack, a wing's, the body's */
  slices?: [number, number, number, number];
  /** how far past the subject's sphere, away from the sun, the map's depth reaches (m): the ground it shades */
  reach?: number;
  /** the depth bias (m) */
  bias?: number;
  label?: string;
}

export class SubjectShadow {
  readonly depth: Texture;
  readonly layers: Texture | null;
  readonly depthPass: RenderPass;
  readonly layerPass: RenderPass | null;
  /** the receivers' `Subject` uniform */
  readonly uniform: UniformBuffer<any>;
  readonly camera = new Camera();
  readonly size: number;
  /** fitted this frame (fit() called since the last run): else the passes don't run and receivers see everything lit */
  fitted = false;
  /** the receivers' matrix (the uniform's m): scene-eye-relative position → the light's clip space */
  readonly m = new Float32Array(16);
  private o: Required<Omit<SubjectShadowOptions, 'label'>>;

  constructor(private kit: Kit, opts: SubjectShadowOptions = {}) {
    const label = opts.label ?? 'subject';
    this.o = { size: opts.size ?? 256, layers: opts.layers ?? false, slices: opts.slices ?? [0.012, 0.04, 0.12, 0.4], reach: opts.reach ?? 40, bias: opts.bias ?? 0.004 };
    this.size = this.o.size;
    const n = this.o.size;
    this.depth = kit.texture({ label: `${label}.depth`, format: 'depth32float', size: [n, n], usage: ['render', 'sample'] } as never);
    const view = kit.view(this.camera, [n, n], `${label}.view`);
    this.depthPass = kit.pass({ label: `${label}.depth`, depth: { target: this.depth, clear: 0 }, view, enabled: () => this.fitted });
    this.layers = this.o.layers ? kit.texture({ label: `${label}.layers`, format: 'rgba16float', size: [n, n], usage: ['render', 'sample'] } as never) : null;
    this.layerPass = this.layers ? kit.pass({ label: `${label}.layers`, color: [{ target: this.layers, clear: [0, 0, 0, 0] }], view, enabled: () => this.fitted }) : null;
    this.uniform = kit.uniforms(subjectShader.structs.Subject, label);
    this.uniform.set({ m: new Float32Array(16), k: [0, 0, 1, 0], s: this.o.slices });
  }

  /** fit the map round a sphere (world centre, radius in m) seen from the sun (the direction toward it, normalised);
   *  call each frame the subject moves, the sun turns or the scene's camera moves, after that camera is placed and
   *  before the run. `reach`: how far past the sphere, away from the sun, its shadow should still fall (m; the options'
   *  by default) — a bird 25 m up under a sun 20 degrees high shades the ground 73 m along the ray. `eye`: the scene
   *  camera's position (doubles) the receivers' positions are relative to: the kit's main camera by default */
  fit(c: ArrayLike<number>, r: number, sun: ArrayLike<number>, reach = this.o.reach, eye: ArrayLike<number> = this.kit.camera.position) {
    const range = fitSubject(this.camera, c, r, sun, reach, this.size, eye, this.m);
    this.uniform.set({
      m: this.m,
      k: [1, (2 * Math.max(r, 1e-3)) / this.size, range, this.o.bias],
      s: this.o.slices,
    });
    this.fitted = true;
  }

  /** nothing to shadow this frame (the subject gone, the sun down): receivers see everything lit */
  off() {
    this.fitted = false;
    this.uniform.set({ k: [0, 0, 1, 0] });
  }

  /** the run items, before the passes that read it */
  passes(): RunEntry[] { return this.fitted ? [this.depthPass, ...(this.layerPass ? [this.layerPass] : [])] : []; }

  dispose() { this.kit.release(this.depth, this.layers, this.uniform); }
}
