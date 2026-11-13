// Rainfall round the eye (shaders/rainfall.wgsl draws it over the finished scene, after its fog), for any world: how
// much falls and how, from the weather's rain (0..1, a drizzle to a winter storm's downpour) — drizzle a mist of fine
// slow drops, a downpour long fast streaks driven by the wind — how far each of the three boxes of drops has fallen and
// drifted (kept on the CPU, wrapped to the box, so nothing jumps), and the veil the fall draws over the distance.
// Nothing at all is run while it's dry. Boulder's weather/precip.ts, its rain, by way of San Francisco's.
// Snow too, by the weather's `snowing` (the share of what falls that's snow, 0..1): flakes about a metre a second,
// carried by the wind and fluttering as they come, round and soft, no splashes; the veil thicker (snow hides the
// distance at a tenth of the rain's water).
//
// The world lights it: by default from `light` (a uniform: the sky's light, the key light, lamps, a flat ground at
// the eye's), or with its own shader, one that defines rainLight / rainVeil / rainGround from the world's own sky,
// shadows and ground and then `#include "loom/rainfall"` (see that file), passed as `shader`.
import type { Kit, RenderPass, RunEntry, Shader, Texture, UniformBuffer, V3 } from '@ericrius1/weft';
import litShader from '../shaders/rainfall_lit.wgsl';

/** the weather it reads: rain 0..1, cloud cover 0..1, wind (m/s) and the way it blows toward ([x, z], unit) */
export interface RainWeather { rain: number; cloud: number; wind: number; windDir: ArrayLike<number>; /** the share falling as snow (0..1): absent, rain */ snowing?: number }

/** the default shader's light (loom/rainfall_lit): linear rgb, as the scene's */
export interface RainLight {
  /** the sky's light on an upward face */
  sky: V3;
  /** the key light (sun or moon) through the cloud, and the way toward it */
  key: V3; dir: V3;
  /** lamps' warm glow on the drops near the ground (night), and how high it reaches (m) */
  lamps: V3; lampReach: number;
  /** the ground under the eye (world y): the splashes land on it, no drop is drawn below it */
  ground: number;
}

export interface RainfallOptions {
  /** the share of the drops a device draws (a phone fewer); 1 */
  scale?: number;
  /** the world's own shader (defines rainLight, rainVeil, rainGround; includes loom/rainfall); loom/rainfall_lit */
  shader?: Shader<any, any>;
  /** more bindings for the world's own shader (its group 2 past bindings 0 and 1) */
  bind?: Record<string, unknown>;
}

/** the most instances of each (rainfall.wgsl's): the first `share` of them are drawn, so the count follows the rate */
const RAIN_MAX = 22000;
const SPLASH_MAX = 2400;
/** the boxes round the eye: size (m) and the share of the instances in it (a near dense one, a middle, a far sparse one) */
const BOXES: [number, number, number, number][] = [[14, 12, 14, 0.4], [34, 24, 34, 0.35], [80, 46, 80, 0.25]];

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mod = (x: number, m: number) => ((x % m) + m) % m;

export class Rainfall {
  readonly u: UniformBuffer<any>;
  /** the default shader's light: set it each frame (unused with a world's own shader) */
  light: RainLight = { sky: [0.5, 0.55, 0.6], key: [1, 1, 1], dir: [0, 1, 0], lamps: [0, 0, 0], lampReach: 60, ground: 0 };
  /** what's drawn now: the shares of drops and splashes, the veil's extinction */
  readonly shares = { rain: 0, splash: 0, veil: 0 };
  /** the top of the fall (world y): the cloud base */
  top = 900;
  readonly shader: Shader<any, any>;
  private lit: UniformBuffer<any> | null = null;
  private fall: V3[] = BOXES.map(() => [0, 0, 0]);
  private time = 0;
  private pass: RenderPass | null = null;
  private scale: number;

  constructor(readonly kit: Kit, private opts: RainfallOptions = {}) {
    this.shader = opts.shader ?? litShader;
    this.scale = opts.scale ?? 1;
    this.u = kit.uniforms(this.shader.structs.RainU, 'rain');
    if (!opts.shader) this.lit = kit.uniforms(litShader.structs.RainLight, 'rain.light');
  }

  /** its pass over `hdr` (cleared: no; drawn premultiplied), reading the scene's distance along the view (`sceneZ`:
   *  r32float metres, large for the sky) */
  attach(hdr: Texture, sceneZ: Texture) {
    const pass = this.kit.pass({ label: 'rain', color: [{ target: hdr, clear: false }] });
    const bind = { ...this.opts.bind, rainP: this.u, rainZ: sceneZ, ...(this.lit ? { rainL: this.lit } : {}) } as never;
    const blend: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const sh = this.shares, shader = this.shader;
    pass.fullscreen(shader, { label: 'rain.veil', fragment: 'fsVeil', blend, bind, enabled: () => sh.veil > 2e-6 });
    const draw = (label: string, vertex: string, fragment: string, max: number, share: () => number) => pass.draw(shader, {
      label, vertex, fragment, topology: 'triangle-strip', count: 4, instances: () => Math.ceil(max * Math.min(1, share() * this.scale)), blend, cull: 'none', bind, enabled: () => share() > 0.001,
    });
    draw('rain.drops', 'vsRain', 'fsDrop', RAIN_MAX, () => sh.rain);
    draw('rain.splash', 'vsSplash', 'fsSplash', SPLASH_MAX, () => sh.splash);
    this.pass = pass;
  }

  /** the pass, while anything falls (none at all while it's dry) */
  passes(): RunEntry[] { return this.pass && (this.shares.rain > 0 || this.shares.veil > 2e-6) ? [this.pass] : []; }

  /** a frame on: `under` (the eye under water) stops it */
  update(dt: number, w: RainWeather, under = false) {
    this.time += dt;
    // (the weather's 0..1 as millimetres an hour: a drizzle's half to a storm's dozen and more)
    const R = under ? 0 : w.rain > 0.01 ? 14 * Math.pow(w.rain, 1.6) : 0;
    const snow = Math.min(1, Math.max(0, w.snowing ?? 0));
    const sh = this.shares;
    // (snow: more flakes than drops for the same water, each far bigger and slower)
    sh.rain = R > 0.01 ? Math.min(1, (1 - Math.exp(-R / 3.5)) * (1 + 0.8 * snow)) : 0;
    sh.splash = sh.rain * (1 - snow);
    // the visibility (Koschmieder: extinction = 3.9 / visibility): in rain by its rate; in snow far less, a moderate
    // fall (R ~1 mm/h of water) a kilometre or so
    const visRain = R > 0.01 ? 20000 * Math.pow(R, -0.65) : Infinity;
    const visSnow = R > 0.01 ? 1400 * Math.pow(R, -0.8) : Infinity;
    const vis = snow > 0 ? 1 / ((1 - snow) / visRain + snow / visSnow) : visRain;
    sh.veil = 3.912 / vis;
    // the cloud base: low in a storm, higher in showers
    this.top = 1400 - 900 * smooth(0.2, 0.9, w.cloud);
    // the drops: drizzle fine and slow, a downpour big and fast; the wind carries them
    const fall = (3 + 6 * smooth(0.2, 8, R)) * (1 - snow) + (0.9 + 0.3 * smooth(0.5, 5, R)) * snow;
    // (near the ground the drops take only part of the wind's speed: a gale slants them, it doesn't fling them flat;
    // a flake rides it nearly whole)
    const push = Math.min(w.wind * (0.55 + 0.3 * snow), 7 + 3 * snow);
    const v: V3 = [w.windDir[0] * push, -fall, w.windDir[1] * push];
    for (let k = 0; k < BOXES.length; k++) {
      const B = BOXES[k];
      for (let a = 0; a < 3; a++) this.fall[k][a] = mod(this.fall[k][a] + v[a] * dt, B[a]);
    }
    if (sh.rain <= 0) return;
    let acc = 0;
    this.u.set({
      rain: [sh.rain, 1 / 45, (0.0016 + 0.0016 * smooth(0.5, 20, R)) * (1 - snow) + 0.007 * snow, 0.62 + 0.3 * snow],
      vel: [...v, this.top],
      fall: this.fall.map((f) => [...f, 0]) as never,
      box: BOXES.map((b) => { acc += b[3]; return [b[0], b[1], b[2], acc]; }) as never,
      veil: [sh.veil, snow, sh.splash, this.time],
    });
    if (this.lit) {
      const L = this.light;
      this.lit.set({ sky: [...L.sky, 0], key: [...L.key, 0], dir: [...L.dir, L.ground], lamps: [...L.lamps, L.lampReach] });
    }
  }
}
