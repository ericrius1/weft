// The scene's distance along the view axis (r32float metres, 1e9 for the sky), made right after the scene from its
// depth (reversed-Z, infinite far: weft's linearDepth), for the passes after it: loom/volume, loom/rainfall, AO,
// shafts. San Francisco's sceneZ.
import type { Kit, RenderPass, Texture } from '@ericrius1/weft';
import zShader from '../shaders/scenez.wgsl';
import zmsShader from '../shaders/scenez_ms.wgsl';

/** the shader that resolves `depth` (one sample, or the nearest of 4) */
export function sceneZShader(samples = 1) { return samples > 1 ? zmsShader : zShader; }

/** the target and its pass: run `pass` after the scene, read `tex` */
export function sceneZ(kit: Kit, depth: Texture, label = 'sceneZ'): { tex: Texture; pass: RenderPass } {
  const tex = kit.texture({ label, format: 'r32float', size: 'render', usage: ['render', 'sample'] });
  const pass = kit.pass({ label, color: [{ target: tex, clear: [1e9, 0, 0, 0] }] });
  pass.fullscreen(sceneZShader(depth.samples), { label, bind: { depth } as never });
  return { tex, pass };
}
