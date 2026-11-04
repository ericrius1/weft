// The sky lab (sky.html): loom's renderer with its sprite clouds (clouds: 'sprites') over a stand-in land — plains to
// the east, a range to the west — for looking at each kind of sky. Every one of SKY_KINDS from the menu or the URL:
//   ?sky=<kind>     highland (default) | clear | fair cumulus | towering cumulus | thunderstorm | stratocumulus |
//                   altocumulus | cirrus | chinook | overcast | altostratus
//   ?view=<name>    west (default: toward the range and the sun) | north | up | air (1.5 km up) | high (5 km up)
//   ?hour=<h>       local solar time (15.5); ?seed=<n> another day's sky of the kind; ?phone: a phone's economies
//   ?ease=<s>       the menu eases from sky to sky over that many seconds (0: a cut)
// window.__sky drives it from a script: setSky(kind, secs), view(name), advance(s), grab() (a JPEG data URL), stats().
import { createKit, Capture, type RunEntry, type V3 } from '@ericrius1/weft';
import globals from '@ericrius1/loom/shaders/globals.wgsl';
import { Renderer, noTerrain } from '@ericrius1/loom/render/renderer';
import { Atmosphere, celestial } from '@ericrius1/loom/world/sky';
import { SKY_KINDS, type SkyKind } from '@ericrius1/loom/render/skyclouds';
import groundShader from './ground.wgsl';

const q = new URLSearchParams(location.search);
const HOUR = +(q.get('hour') ?? 15.5);
const DOY = 200, LAT = 40;
const HALF = 12000;
const EASE = +(q.get('ease') ?? 20);

/** ground.wgsl groundAt, on the CPU (the heaps ride over its ridges, the caps stand over its peaks) */
function ground(x: number, z: number) {
  const ss = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const range = 1 - ss(-9000, -2000, x);
  const ridge = 0.55 + 0.45 * Math.sin(z / 2300 + Math.sin(x / 3100) * 1.7) * Math.cos(x / 1900 + 0.7);
  return 60 + 25 * Math.sin(x / 900) * Math.cos(z / 1300) + range * 1900 * ridge;
}

/** the views: where from (x, z, height over the ground), facing (compass degrees: 0 north, 270 west), looking up (deg), fov */
const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  west: [4000, 0, 30, 270, 9, 70], north: [4000, 0, 30, 345, 12, 70], up: [4000, 0, 30, 200, 38, 80],
  air: [3000, 2000, 1500, 290, 2, 70], high: [3000, 2000, 5000, 280, -8, 70],
};

async function main() {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const kit = await createKit(canvas, { maxPixelRatio: 1, powerPreference: 'high-performance' });
  kit.profiler.force = true;
  const W = kit.uniforms(globals.structs.World, 'world');
  kit.setGlobals(W);
  W.set({ worldHalf: HALF, fogParams: [6e-5, 0.004, 1, 0], cascades: [40, 160, 600, 2], seaLevel: -100, exposure: 1, haze: 0.5, altitudeKm: 0 });
  const terrain = noTerrain(kit);
  const atmo = new Atmosphere(kit, terrain.heightTex);
  const first = (q.get('sky') ?? 'highland') as SkyKind;
  const r = new Renderer(kit, terrain, atmo, HALF, { clouds: 'sprites', sky: { phone: q.has('phone'), seed: q.has('seed') ? +q.get('seed')! : undefined, sky: first }, msaa: 4 });
  const sky = r.skyClouds!;
  sky.ground = ground;
  r.mirror = false; r.reflOn = false; r.hfOn = false;
  r.motionBlur.shutter = 0;
  r.cascades = [40, 160, 600];
  r.scene.draw(groundShader, { label: 'ground', count: 160 * 256 * 6, cull: 'none' });
  r.addSky();
  const cap = new Capture(kit);
  const ready = await kit.ready();
  console.log(`sky lab: ${ready.pipelines} pipelines (${ready.failed} failed)`);

  // ---- the menu
  const sel = document.createElement('select');
  for (const k of SKY_KINDS) { const o = document.createElement('option'); o.value = o.textContent = k; sel.append(o); }
  sel.value = first;
  sel.onchange = () => sky.setSky(sel.value as SkyKind, EASE);
  const info = document.createElement('span');
  hud.append(sel, info);

  // ---- the frame
  const cam = kit.camera;
  let view = VIEWS[q.get('view') ?? 'west'] ?? VIEWS.west;
  const place = () => {
    const [x, z, h, face, upDeg, fov] = view;
    const y = ground(x, z) + h;
    const a = face * Math.PI / 180, e = upDeg * Math.PI / 180;
    cam.fovY = fov * Math.PI / 180;
    cam.near = 0.5; cam.far = 2e6;
    cam.lookAt([x, y, z], [x + Math.sin(a) * Math.cos(e) * 100, y + Math.sin(e) * 100, z - Math.cos(a) * Math.cos(e) * 100]);
  };
  let t = 0;
  const times: number[] = [];
  const frame = (dt: number) => {
    t += dt;
    place();
    kit.mainView.update(true);
    const cel = celestial(HOUR, DOY, LAT, 0);
    const mats = r.updateShadows(cam, cel.lightDir as V3);
    const ripple = r.ripples.update(cam.position, dt);
    r.setPointLights([], cam.position);
    r.update({ time: t, dt, cam, light: cel.lightDir as V3, night: cel.nightness, hour: HOUR, seaLevel: -100, cover: 0, under: 0 });
    // (the clouds' sky values and shadows into the world: loom's cirrus cover, how overcast, the shadows' strength)
    const cs = sky.sky;
    W.set({
      sunDir: cel.sunDir, nightness: cel.nightness, moonDir: cel.moonDir, moonPhase: cel.moonPhase, lightDir: cel.lightDir, dayLight: cel.dayLight,
      pole: cel.pole, starRot: cel.starRot, wind: [sky.recipe.wind[0], 0, sky.recipe.wind[1]], gust: 0.3, seaLevel: -100, worldHalf: HALF,
      cloudCover: cs.cloudCover, cloudTime: t, haze: 0.5, altitudeKm: Math.max(0, cam.position[1]) / 1000, exposure: 1, underwater: 0,
      player: [...cam.position, 1] as never, grade: [1, 1, 0, 0],
      shadow0: mats[0] as never, shadow1: mats[1] as never, shadow2: mats[2] as never, cascades: [...r.cascades, 2] as never, ripple: ripple as never, wave: [0, 0, 0, 0],
      fogParams: [6e-5, 0.004, 1, 0], sky: [cs.overcast, 0, 0, 0], cloudMap: r.clouds.cloudMap as never, hfWin: r.hf.win as never,
      misc: [0, sky.shadowK, 0, 0], under: [0, 0, 0, 1], lights: [r.lightCount, 0, 0, 0],
    });
    kit.run([...atmo.items(), ...r.items(cel.lightDir as V3)] as RunEntry[]);
    times.push(dt);
    if (times.length > 120) times.shift();
    const d = sky.debug();
    info.textContent = `  ${d.sprites} sprites · ${d.skies} sk${d.skies > 1 ? 'ies' : 'y'} · gpu ${kit.profiler.frameMs.toFixed(1)} ms · overcast ${d.overcast}`;
  };
  kit.loop(({ dt }) => frame(Math.min(dt, 1 / 20)));

  // ---- a script's handle (headless screenshots)
  (window as any).__sky = {
    ready: true, kit, r, sky,
    setSky(kind: SkyKind, secs = 0) { sky.setSky(kind, secs); sel.value = kind; },
    view(name: string) { view = VIEWS[name] ?? view; },
    /** a view of one's own: from x, z, height over the ground, facing (compass degrees), looking up (deg), fov */
    look(x: number, z: number, h: number, face: number, up: number, fov = 70) { view = [x, z, h, face, up, fov]; },
    /** run the clouds' clock on by s seconds (nothing drawn) */
    advance(s: number) { const st = sky.settings.speed; sky.settings.speed = s * 60; frame(1 / 60); sky.settings.speed = st; },
    async grab() { return cap.grab('image/jpeg', 0.9, 1 / 60); },
    stats() {
      const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
      const passes: Record<string, number> = {};
      for (const [k, v] of kit.profiler.ms) if (/sky|cloud/.test(k)) passes[k] = +v.toFixed(3);
      return { fps: 1 / mean, gpuMs: kit.profiler.frameMs, passes, ...sky.debug() };
    },
  };
}

main().catch((e) => { console.error(e); const h = document.getElementById('hud'); if (h) h.textContent = String(e?.stack ?? e); });
