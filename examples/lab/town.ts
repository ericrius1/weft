// The town lab (town.html): loom's renderer over a few houses round a courtyard — one wall red, one green — and a few
// hundred lanterns, for looking at its temporal upscaler (TAAU), its irradiance probes (diffuse GI) and its clustered
// point lights, each switched on and off from the keys or the URL:
//   ?taau=0|1 (1)    t: on / off        ?scale=<0.3..1>  the render scale (0.6: TAAU upscales 0.6 → 1)
//   ?gi=0|1 (1)      g: on / off        ?lights=<n>      lanterns (300)
//   ?cluster=0|1 (1) c: on / off        ?hour=<h>        local solar time (17.2: low sun; 19.6 dusk)
//   ?view=<name>     court (default) | street | high | low;  ?debug: the TAAU's rejections in red
// window.__town drives it from a script: set({ taau, gi, cluster, scale, hour }), view(name), grab(), stats().
import { createKit, Capture, type RunEntry, type V3 } from '@ericrius1/weft';
import globals from '@ericrius1/loom/shaders/globals.wgsl';
import { Renderer, noTerrain, type PointLight } from '@ericrius1/loom/render/renderer';
import { Atmosphere, celestial } from '@ericrius1/loom/world/sky';
import townShader from './town.wgsl';

const q = new URLSearchParams(location.search);
const flag = (k: string, d: boolean) => (q.has(k) ? q.get(k) !== '0' : d);
let HOUR = +(q.get('hour') ?? 17.2);
const DOY = 200, LAT = 40, HALF = 2000;
const NLIGHTS = +(q.get('lights') ?? 300);

/** the town: [centre, half size, colour, glow] */
type Box = [V3, V3, V3, number];
function town(): { boxes: Box[]; lights: PointLight[] } {
  const boxes: Box[] = [[[0, -0.5, 0], [120, 0.5, 120], [0.5, 0.5, 0.5], 0]];
  // the courtyard: four houses round a 24 m square, one wall red, one green, the others plaster
  boxes.push([[0, 6, -16], [14, 6, 3], [0.7, 0.12, 0.08], 0]);
  boxes.push([[-16, 4, 0], [3, 4, 12], [0.12, 0.55, 0.15], 0]);
  boxes.push([[16, 5, 2], [3, 5, 10], [0.72, 0.7, 0.66], 0]);
  boxes.push([[-6, 2, 15], [7, 2, 2.5], [0.72, 0.7, 0.66], 0]);
  // a white block in the middle (it picks up the walls' colours), an arch over the gap
  boxes.push([[2, 1.25, 0], [2.5, 1.25, 2.5], [0.85, 0.85, 0.85], 0]);
  boxes.push([[9, 7, 15], [3, 1, 2.5], [0.72, 0.7, 0.66], 0]);
  // streets of houses round it
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let gx = -4; gx <= 4; gx++) for (let gz = -4; gz <= 4; gz++) {
    if (Math.abs(gx) <= 1 && Math.abs(gz) <= 1) continue;
    const h = 3 + rnd() * 9, w = 4 + rnd() * 4, d = 4 + rnd() * 4;
    const t = rnd();
    boxes.push([[gx * 22 + (rnd() - 0.5) * 4, h, gz * 22 + (rnd() - 0.5) * 4], [w, h, d], t < 0.15 ? [0.6, 0.25, 0.15] : t < 0.25 ? [0.25, 0.35, 0.6] : [0.7, 0.66, 0.6], 0]);
  }
  // lanterns: on posts along the streets, warm and cool
  const lights: PointLight[] = [];
  for (let i = 0; i < NLIGHTS; i++) {
    const a = rnd() * Math.PI * 2, r = 6 + Math.sqrt(rnd()) * 100;
    const p: V3 = [Math.cos(a) * r, 2.6 + rnd() * 2, Math.sin(a) * r];
    const warm = rnd() < 0.75;
    const c: V3 = warm ? [1, 0.55, 0.22] : [0.35, 0.6, 1];
    const s = 12 + rnd() * 18;
    lights.push({ pos: p, radius: 9 + rnd() * 6, color: [c[0] * s, c[1] * s, c[2] * s], size: 0.25 });
    boxes.push([p, [0.15, 0.2, 0.15], c, 30]);
  }
  // (last: a thin pole that slides across the court by itself — what the TAAU mustn't ghost)
  boxes.push([[0, 1.5, 4], [0.06, 1.5, 0.06], [0.9, 0.9, 0.95], 0]);
  return { boxes, lights };
}

const VIEWS: Record<string, [V3, V3, number]> = {
  court: [[-9, 1.7, 10], [8, 3, -12], 70], street: [[11, 2, 75], [9, 3, -40], 60],
  high: [[60, 45, 70], [0, 0, 0], 55], low: [[-12, 0.6, 2], [10, 2.5, -14], 80],
};

async function main() {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  // (?lowlimits: the baseline WebGPU limits a phone may have, to catch a shader that binds too much)
  const kit = await createKit(canvas, { maxPixelRatio: 1, powerPreference: 'high-performance', ...(q.has('lowlimits') ? { limits: { maxSampledTexturesPerShaderStage: 16, maxStorageBuffersPerShaderStage: 8, maxStorageTexturesPerShaderStage: 4 } } : {}) });
  kit.profiler.force = true;
  kit.renderScale = +(q.get('scale') ?? 1);
  const W = kit.uniforms(globals.structs.World, 'world');
  kit.setGlobals(W);
  W.set({ worldHalf: HALF, fogParams: [2e-5, 0.004, 1, 0], cascades: [24, 90, 320, 2], seaLevel: -100, exposure: 1, haze: 0.5, altitudeKm: 0 });
  const terrain = noTerrain(kit);
  const atmo = new Atmosphere(kit, terrain.heightTex);
  const { boxes, lights } = town();
  const r = new Renderer(kit, terrain, atmo, HALF, {
    clouds: (q.get('clouds') ?? 'none') as 'none' | 'volumetric' | 'sprites', msaa: 1,
    // (?vel: a still motion-vector texture handed to the TAAU — the velocity path, for a still camera: ?still)
    taau: flag('taau', true) && (q.has('vel') ? { velocity: kit.texture({ label: 'town.vel', format: 'rg16float', size: 'render', usage: ['sample', 'render'] }) } : true),
    lights: { max: Math.max(32, NLIGHTS), clustered: true },
    gi: { min: [-36, 0.5, -36], max: [36, 14.5, 36], spacing: 2, face: 24, maxPerFrame: 8 },
  });
  r.mirror = false; r.reflOn = false; r.hfOn = false;
  r.motionBlur.shutter = 0;
  if (r.taau) r.taau.params.debug = q.has('debug');
  if (r.gi) { r.gi.params.on = flag('gi', true); r.gi.params.perFrame = 8; }
  r.clustered = flag('cluster', true);
  const data = new Float32Array(boxes.length * 12);
  boxes.forEach(([c, h, col, glow], i) => data.set([...c, 0, ...h, 0, ...col, glow], i * 12));
  const boxBuf = kit.storage({ label: 'town.boxes', size: data.byteLength });
  boxBuf.write(data);
  const draw = { bind: { boxes: boxBuf }, count: 36, instances: boxes.length, cull: 'none' as const };
  r.scene.draw(townShader, { label: 'town', ...draw });
  // (the probes see the mirror pass's draws: the town, and the sky)
  r.reflPass.draw(townShader, { label: 'town.refl', ...draw });
  r.addSky();
  const cap = new Capture(kit);
  const ready = await kit.ready();
  console.log(`town lab: ${ready.pipelines} pipelines (${ready.failed} failed)`);

  const cam = kit.camera;
  let view = VIEWS[q.get('view') ?? 'court'] ?? VIEWS.court;
  let t = 0;
  const times: number[] = [];
  const info = document.createElement('span');
  hud.append(info);
  addEventListener('keydown', (e) => {
    if (e.key === 't' && r.taau) r.taau.params.on = !r.taau.params.on;
    if (e.key === 'g' && r.gi) r.gi.params.on = !r.gi.params.on;
    if (e.key === 'c') r.clustered = !r.clustered;
  });
  const frame = (dt: number) => {
    t += dt;
    const [eye, at, fov] = view;
    // (a slow drift: the TAAU's reprojection at work)
    const sway = q.has('still') ? 0 : Math.sin(t * 0.3) * 0.6;
    cam.fovY = fov * Math.PI / 180;
    cam.near = 0.1; cam.far = Infinity;
    cam.lookAt([eye[0] + sway, eye[1], eye[2]], at);
    kit.mainView.update(true);
    // (the pole: a few metres a second side to side)
    if (!q.has('nopole')) boxBuf.write(new Float32Array([Math.sin(t * 1.3) * 5, 1.5, 4, 0]), (boxes.length - 1) * 48);
    const cel = celestial(HOUR, DOY, LAT, 0);
    const mats = r.updateShadows(cam, cel.lightDir as V3);
    const ripple = r.ripples.update(cam.position, dt);
    r.setPointLights(lights, cam.position);
    r.update({ time: t, dt, cam, light: cel.lightDir as V3, night: cel.nightness, hour: HOUR, seaLevel: -100, cover: 0, under: 0 });
    W.set({
      sunDir: cel.sunDir, nightness: cel.nightness, moonDir: cel.moonDir, moonPhase: cel.moonPhase, lightDir: cel.lightDir, dayLight: cel.dayLight,
      pole: cel.pole, starRot: cel.starRot, wind: [2, 0, 1], gust: 0.3, seaLevel: -100, worldHalf: HALF,
      cloudCover: 0, cloudTime: t, haze: 0.5, altitudeKm: 0, exposure: 1, underwater: 0,
      player: [...cam.position, 1] as never, grade: [1, 1, 0, 0],
      shadow0: mats[0] as never, shadow1: mats[1] as never, shadow2: mats[2] as never, cascades: [...r.cascades, 2] as never, ripple: ripple as never, wave: [0, 0, 0, 0],
      fogParams: [2e-5, 0.004, 1, 0], sky: [0, 0, 0, 0], cloudMap: r.clouds.cloudMap as never, hfWin: r.hf.win as never,
      misc: [0, 0, 0, 0], under: [0, 0, 0, 1], lights: [r.lightCount, 0, 0, 0],
    });
    kit.run([...atmo.items(), ...r.items(cel.lightDir as V3)] as RunEntry[]);
    times.push(dt);
    if (times.length > 120) times.shift();
    const gi = r.gi;
    info.textContent = `taau ${r.taau?.params.on ? 'on' : 'off'} (t) · gi ${gi?.params.on ? `on ${gi.captured}/${gi.total}` : 'off'} (g) · lights ${r.lightCount} ${r.clustered ? 'clustered' : 'all'} (c) · scale ${kit.renderScale} · gpu ${kit.profiler.frameMs.toFixed(2)} ms`;
  };
  kit.loop(({ dt }) => frame(Math.min(dt, 1 / 20)));

  (window as any).__town = {
    ready: true, kit, r,
    set(o: { taau?: boolean; gi?: boolean; cluster?: boolean; scale?: number; hour?: number; debug?: boolean }) {
      if (o.taau !== undefined && r.taau) r.taau.params.on = o.taau;
      if (o.gi !== undefined && r.gi) r.gi.params.on = o.gi;
      if (o.cluster !== undefined) r.clustered = o.cluster;
      if (o.scale !== undefined) kit.renderScale = o.scale;
      if (o.hour !== undefined) HOUR = o.hour;
      if (o.debug !== undefined && r.taau) r.taau.params.debug = o.debug;
    },
    view(name: string) { view = VIEWS[name] ?? view; },
    async grab() { return cap.grab('image/jpeg', 0.92, 1 / 60); },
    stats() {
      const passes: Record<string, number> = {};
      for (const [k, v] of kit.profiler.ms) passes[k] = +v.toFixed(3);
      const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
      return { fps: 1 / mean, gpuMs: kit.profiler.frameMs, giCaptured: r.gi?.captured, giTotal: r.gi?.total, lights: r.lightCount, errors: [...kit.errors.values()], passes };
    },
  };
}

main().catch((e) => { console.error(e); const h = document.getElementById('hud'); if (h) h.textContent = String(e?.stack ?? e); });
