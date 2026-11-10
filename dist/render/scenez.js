import zShader from '../shaders/scenez.wgsl';
import zmsShader from '../shaders/scenez_ms.wgsl';
/** the shader that resolves `depth` (one sample, or the nearest of 4) */
export function sceneZShader(samples = 1) { return samples > 1 ? zmsShader : zShader; }
/** the target and its pass: run `pass` after the scene, read `tex` */
export function sceneZ(kit, depth, label = 'sceneZ') {
    const tex = kit.texture({ label, format: 'r32float', size: 'render', usage: ['render', 'sample'] });
    const pass = kit.pass({ label, color: [{ target: tex, clear: [1e9, 0, 0, 0] }] });
    pass.fullscreen(sceneZShader(depth.samples), { label, bind: { depth } });
    return { tex, pass };
}
//# sourceMappingURL=scenez.js.map