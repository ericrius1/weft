// weft bench: the CPU cost of encoding a frame of many draws. N cubes, each its own draw with a per-draw group (a
// uniform and a texture), all sharing a 16-binding environment group as a world's draws share its sky, shadows and
// maps, optionally drawn again into shadow cascades (each its own view, the shadow map swapped for a stand-in there).
// bundle=1 bakes each pass's cubes into a DrawBundle. Frames are stepped by hand and kit.run is timed; the numbers land
// in window.__bench and on the page.
//   bench.html?n=2000&cascades=4&refs=1&bundle=1&frames=300
import { createKit, Camera, Capture, mat4, type DrawBundle, type RenderPass } from '@ericrius1/weft';
import envShader from './benchenv.wgsl';
import cube from './bench.wgsl';

const q = new URLSearchParams(location.search);
const N = Number(q.get('n') ?? 2000);
const CASCADES = Number(q.get('cascades') ?? 0);
const REFS = q.get('refs') === '1';
const BUNDLE = q.get('bundle') === '1';
const FRAMES = Number(q.get('frames') ?? 300);
const WARM = 30;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const kit = await createKit(canvas);
const say = (s: string) => { document.getElementById('out')!.textContent = s; };

// ---- the shared environment
const tex = (label: string, format: GPUTextureFormat, size: [number, number] | [number, number, number], dimension: GPUTextureDimension = '2d') =>
  kit.texture({ label, format, size, dimension, usage: ['sample', 'copy-dst'] });
const shadowMap = kit.texture({ label: 'shadowMap', format: 'depth32float', size: [1024, 1024, Math.max(1, CASCADES)], view: '2d-array' });
const noShadow = kit.texture({ label: 'noShadow', format: 'depth32float', size: [1, 1, 1], view: '2d-array' });
const env = kit.uniforms(envShader.structs.Env, 'env').set({ sun: [0.4, 0.8, 0.3, 1.2], wind: [1, 0.3, 0.04, 0] });
kit.shareGroup(1, envShader, {
  env, lutA: tex('lutA', 'rgba16float', [256, 64]), lutB: tex('lutB', 'rgba16float', [32, 32]), lutC: tex('lutC', 'rgba16float', [192, 108]),
  lut3d: tex('lut3d', 'rgba16float', [32, 32, 32], '3d'), shadowMap, heights: tex('heights', 'r32float', [512, 512]),
  cloudShadow: tex('cloudShadow', 'r8unorm', [256, 256]), irradiance: kit.storage({ label: 'irradiance', data: new Float32Array(36).fill(0.12) }),
  noiseTex: tex('noise', 'r8unorm', [64, 64, 64], '3d'), aurora: tex('aurora', 'rgba8unorm', [512, 256]), windTex: tex('wind', 'rg8unorm', [128, 128]),
  lights: kit.storage({ label: 'lights', count: 256, stride: 16 }), grid: kit.storage({ label: 'grid', count: 4096 }),
  envSamp: 'linear', cmpSamp: 'shadow',
}, 'env');

// ---- per-draw: four albedo textures, a uniform each, a ping-pong pair seen through a Ref (refs=1)
const albedos = [0, 1, 2, 3].map((i) => {
  const t = kit.texture({ label: `albedo${i}`, format: 'rgba8unorm', size: [64, 64], usage: ['sample', 'copy-dst'] });
  const px = new Uint8Array(64 * 64 * 4);
  for (let p = 0; p < 64 * 64; p++) {
    const check = ((p % 64) >> 3) ^ ((p >> 9) & 1) ? 255 : 170;
    px.set([check, (check * (i + 1)) / 4, 200 - i * 40, 255], p * 4);
  }
  return t.write(px);
});
const wobble = kit.pingpong((i) => kit.storage({ label: `wobble${i}`, data: new Float32Array([0, 0.05 * i, 0.1, 0]) }), 'wobble');

const hdr = kit.texture({ label: 'hdr', format: 'rgba16float', size: 'render' });
const depth = kit.texture({ label: 'depth', format: 'depth32float', size: 'render' });
const scene = kit.pass({ label: 'scene', color: [{ target: hdr, clear: [0.05, 0.07, 0.1, 1] }], depth: { target: depth, clear: 0 } });
const cascades: RenderPass[] = [];
for (let c = 0; c < CASCADES; c++) {
  const cam = new Camera();
  cam.ortho = { halfWidth: 60, halfHeight: 60 };
  cam.lookAt([30 + c, 80, 40], [0, 0, 0]);
  cascades.push(kit.pass({
    label: `cascade${c}`, view: kit.view(cam, [1024, 1024], `cascade${c}`),
    depth: { target: shadowMap.layer(c), clear: 0 }, shared: { 1: { shadowMap: noShadow } },
  }));
}

const side = Math.ceil(Math.sqrt(N));
const sceneDraws = BUNDLE ? scene.bundle('cubes') : scene;
const cascadeDraws: (RenderPass | DrawBundle)[] = cascades.map((p) => (BUNDLE ? p.bundle('cubes.shadow') : p));
for (let i = 0; i < N; i++) {
  const m = mat4();
  m[12] = ((i % side) - side / 2) * 2.2;
  m[14] = (Math.floor(i / side) - side / 2) * 2.2;
  const hue = (i * 0.618) % 1;
  const inst = kit.uniforms(cube.structs.Inst, `inst${i}`).set({ model: m, color: [0.5 + 0.5 * hue, 0.7, 1.2 - hue, hue] });
  const bind = { inst, albedo: albedos[i & 3], ...(REFS ? { wobble: wobble.read } : {}) };
  const vertex = REFS ? 'vs_wobble' : 'vs';
  sceneDraws.draw(cube, { label: 'cube', vertex, bind, count: 36 });
  for (const p of cascadeDraws) p.draw(cube, { label: 'cube.shadow', vertex, fragment: null, bind, count: 36 });
}
const out = kit.pass({ label: 'tonemap', color: [{ target: 'screen', clear: [0, 0, 0, 1] }] });
out.fullscreen(cube, { label: 'tonemap', fragment: 'fs_out', bind: { scene: hdr } });

say(`compiling ${kit.pipelines.length} pipelines…`);
await kit.ready();
const cam = kit.camera;
cam.fovY = 0.8;
cam.lookAt([side * 1.1, side * 1.3, side * 1.6], [0, 0, 0]);

const times: number[] = [];
const items = [...cascades, ...(REFS ? [wobble.swap] : []), scene, out];
kit.loop(({ time }) => {
  env.set({ wind: [1, 0.3, 0.04, time * 2] });
  const t0 = performance.now();
  kit.run(items);
  times.push(performance.now() - t0);
});
kit.manual = true;
for (let f = 0; f < WARM + FRAMES; f++) {
  kit.step(1 / 60);
  await kit.device.queue.onSubmittedWorkDone();
}
const ms = times.slice(WARM).sort((a, b) => a - b);
const pick = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
const total = N * (1 + CASCADES);
const result = {
  n: N, cascades: CASCADES, refs: REFS, bundle: BUNDLE, draws: total, frames: ms.length,
  records: BUNDLE ? [sceneDraws as DrawBundle, ...(cascadeDraws as DrawBundle[])].map((b) => b.records) : [],
  median: pick(0.5), p10: pick(0.1), p90: pick(0.9), mean: ms.reduce((a, b) => a + b, 0) / ms.length,
  usPerDraw: (pick(0.5) * 1000) / total, errors: [...kit.errors.values()].map((e) => `${e.kind} ${e.label}: ${e.message}`),
};
say(`${total} draws: kit.run ${result.median.toFixed(2)} ms median (p10 ${result.p10.toFixed(2)}, p90 ${result.p90.toFixed(2)}) · ${result.usPerDraw.toFixed(2)} µs a draw`);
const png = await new Capture(kit).grab();
Object.assign(window, { kit, __bench: result, __benchPng: png });
