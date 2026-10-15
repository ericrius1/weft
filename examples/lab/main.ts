// weft lab: the smallest complete use of the kit — a compute ripple tank (ping-pong storage), a lit grid drawn
// straight from the sim buffer, a sky, and a tonemap pass. Press ` for the overlay; edit a .wgsl file and the tank
// keeps rippling through the hot reload.
import { createKit, Input } from '@ericrius1/weft';
import ripple from './ripple.wgsl';
import water from './water.wgsl';
import post from './post.wgsl';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const kit = await createKit(canvas);
const input = new Input(canvas);
const N = 256;
const EXTENT = 40;

const state = kit.pingpong((i) => kit.storage({ label: `ripple${i}`, count: N * N, stride: 8 }), 'ripple');
const sim = kit.uniforms(ripple.structs.Sim).set({ size: N, damping: 0.996, speed: 0.35, dropRadius: 5, drop: [0, 0, 0, 0] });
const look = kit.uniforms(water.structs.Water).set({
  size: N, extent: EXTENT, heightScale: 0.6, sunPower: 18, deep: [0.01, 0.06, 0.1], shallow: [0.05, 0.3, 0.35], sunDir: [0.4, 0.6, -0.5],
});
const tone = kit.uniforms(post.structs.Post).set({ exposure: 1.1, vignette: 0.35 });
kit.overlay.tweak(sim, 'ripple sim');
kit.overlay.tweak(look, 'water');
kit.overlay.tweak(tone, 'post');

const hdr = kit.texture({ label: 'hdr', format: 'rgba16float', size: 'render' });
const depth = kit.texture({ label: 'depth', format: 'depth32float', size: 'render' });

const step = kit.compute(ripple, { bind: { sim, prev: state.read, next: state.write }, threads: [N, N] });
const scene = kit.pass({ label: 'scene', color: [{ target: hdr, clear: [0, 0, 0, 1] }], depth: { target: depth, clear: 0 } });
scene.draw(water, { label: 'water', bind: { water: look, state: state.read }, count: (N - 1) * (N - 1) * 6, cull: 'none' });
scene.fullscreen(water, { label: 'sky', fragment: 'fs_sky', bind: { water: look }, depthCompare: 'equal' });
const out = kit.pass({ label: 'tonemap', color: [{ target: 'screen', clear: [0, 0, 0, 1] }] });
out.fullscreen(post, { bind: { post: tone, hdr } });

const t0 = performance.now();
const r = await kit.ready();
console.log(`weft lab: ${r.pipelines} pipelines ready in ${(performance.now() - t0).toFixed(0)} ms (${r.failed} failed)`);

const cam = kit.camera;
let nextRain = 0;
cam.fovY = 0.9;
kit.loop(({ time }) => {
  input.update();
  const a = time * 0.06;
  cam.lookAt([Math.sin(a) * 34, 17, Math.cos(a) * 34], [0, 0, 0]);
  // click: a drop where the cursor's ray meets the water plane
  // a slow rain so the tank is never still, plus a drop wherever you click
  let drop = [0, 0, 0, 0];
  if (time > nextRain) {
    nextRain = time + 0.15 + Math.random() * 0.5;
    drop = [Math.random() * N, Math.random() * N, 0.08 + Math.random() * 0.12, 1];
  }
  if (input.mouse(0)) {
    const ray = cam.ray(kit.mouse[0], kit.mouse[1], kit.size.render[0], kit.size.render[1]);
    if (ray.dir[1] < 0) {
      const t = -ray.origin[1] / ray.dir[1];
      const px = ray.origin[0] + ray.dir[0] * t, pz = ray.origin[2] + ray.dir[2] * t;
      drop = [(px / EXTENT + 0.5) * (N - 1), (pz / EXTENT + 0.5) * (N - 1), 0.12, 1];
    }
  }
  sim.set({ drop });
  kit.run([step, state.swap, step, state.swap, scene, out]);
  input.endFrame();
});
Object.assign(window, { kit, state, sim, step });
