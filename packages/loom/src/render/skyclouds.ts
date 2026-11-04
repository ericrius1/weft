// Sprite clouds: Boulder's procedural sky (its clouds.ts and weather.ts, by way of Drake's port to loom) as loom's
// CloudSource — the renderer made with `clouds: 'sprites'` makes them, runs them where its march would have run and
// never makes the volumetric resources. Not a volume but cheap pieces that keep their shape (skyclouds.wgsl):
//   puffs   cumulus, fractus, towers and storms (skies.ts) as fixed clusters of soft lit sprites. The sky is a grid of
//           cells drifting with the wind; each cell's slots hold a cloud made from a hash of the cell, the slot and the
//           slot's generation — built when the camera comes within range and dropped when it leaves. Each cloud forms,
//           grows (its upper puffs coming in), matures and thins away on the clouds' own clock, and the slot's next
//           cloud forms somewhere else. Every few frames the puffs in range are gathered (fewer far off, faded at the
//           range), lifted clear of the ground under them (`ground`), and sorted back to front.
//   lenses  lenticular caps over the highest peaks, or Boulder's wave clouds upwind: ellipsoids ray-traced in the same
//           pass, standing still whatever the wind
//   decks   Boulder's cloud layers — stratocumulus, altocumulus, altostratus, cirrus, an overcast lid, the chinook's
//           wave deck — composited per pixel round the puffs (the ones beyond first)
// and what they do to the light: the cloud shadow map (the sprites and decks drawn facing the light into a target of
// ours, then written into loom's map in its format — so every surface reading loom's cloudShadowAt is shaded by these
// clouds; the world's misc.y should be `shadowK`), how overcast the sky overhead is and loom's cirrus cover (`sky`: a
// game passes them on in its world uniforms), the veil when the eye is inside a heap and loom's exposure lift (`inside`).
// A sky is a kind (skies.ts SKY_KINDS: every one of Boulder's, and the Highland) or a recipe of one's own; `setSky`
// eases from the sky there is to another — its clouds fading out as the new ones form, its decks thinning away.
import type { Kit, RenderPass, RunEntry, StorageBuffer, Texture, UniformBuffer, V3, Compute } from '@ericrius1/weft';
import { MipChain } from '@ericrius1/weft';
import type { CloudSource } from './clouds';
import shader from '../shaders/skyclouds.wgsl';
import noiseShader from '../shaders/skyclouds_noise.wgsl';
import smapShader from '../shaders/skyclouds_shadow.wgsl';
import {
  Ceiling, DECK_SLOTS, copyRecipe, hash3, heap, rng, skyRecipe, smooth, tower, virga, wisp,
  type CloudDef, type LayerSpec, type Lens, type SkyKind, type SkyRecipe,
} from './skies';

export { SKY_KINDS, HIGHLAND, skyRecipe, type SkyKind, type SkyRecipe, type LayerSpec } from './skies';

/** what's fixed when the clouds are made (each optional: the desktop's defaults; `phone` a phone's) */
export interface SkyCloudOptions {
  /** a phone's economies: nearer ranges and levels of detail, fewer sprites, a smaller shadow less often, plainer decks */
  phone?: boolean;
  /** how far the heaps reach round the camera (m: 16000, a phone 10000); the towers' coarser grid (40000 / 26000) */
  range?: number;
  towerRange?: number;
  /** far off, a cloud keeps only its biggest puffs: the distances' scale (1, a phone 0.6) */
  lod?: number;
  /** the most sprites drawn (14000 / 6000) */
  spriteCap?: number;
  /** the shadow target, texels a side (512 / 256: upsampled into loom's map), redrawn every this many frames (2 / 3) */
  shadowPx?: number;
  shadowEvery?: number;
  /** the decks' fine detail and relief (true / false) */
  deckRich?: boolean;
  /** the clouds' shadows' strength on the ground (0.85): `shadowK`, once the map is first written */
  shadows?: number;
  /** the terrain's height at a point (lifting heaps over ridges, finding the peaks the caps stand over) and the world's
   *  half size (m) it's sampled over — settable later: `ground` */
  ground?: ((x: number, z: number) => number) | null;
  half?: number;
  /** another sky: the cells' hash, and a kind's variation (Boulder's days) */
  seed?: number;
  /** the sky to begin with ('highland') */
  sky?: SkyKind | SkyRecipe;
}

export interface SkyCloudSettings {
  enabled: boolean;
  /** how firmly painted (0 Boulder's soft photographic heaps .. 1 a gouache cumulus's firm edge and two tones); null:
   *  the sky's own (its recipe's `paint`) */
  paint: number | null;
  /** the clouds' clock's rate (1 real time) */
  speed: number;
}

/** where the clouds draw: the renderer's scene colour and depth, and loom's cloud shadow map */
export interface SkyCloudTargets { hdr: Texture; depth: Texture; smap: Texture }

/** the sky's grids (m): the heaps' cells and the towers' coarser ones */
const CELL = 1600;
const TCELL = 9000;
/** floats per sprite (skyclouds.wgsl Puff), the sort's distance buckets (finer near the camera) */
const STRIDE = 16;
const SORT_BUCKETS = 4096;
/** the clouds' clock starts here (s): a while in, every slot's cloud somewhere in its life */
const T0 = 7200;
/** the decks' drift is wrapped every WRAP of their tiles (where every octave of their noise repeats) */
const WRAP = 200;
/** the decks drawn at once (skyclouds_layer.wgsl MAX_LAYERS): a sky's four, and the four of the one it's easing from */
const MAX_LAYERS = 8;

interface Slot { kind: 0 | 1 | 2; period: number; phase: number; gen: number; def: CloudDef | null }
/** a sky in the frame: its recipe, its clouds built round the camera, its caps, its wind's carry so far (its own wind
 *  over the clouds' clock: the cells are laid out in the drifted sky), when it came in or began going out (the clock's
 *  real seconds) and over how long, its weight then */
interface Sky {
  recipe: SkyRecipe; key: number;
  cells: Map<string, Slot[]>; towers: Map<string, Slot[]>; lenses: Lens[];
  drift: [number, number];
  at: number; secs: number; w0: number;
}

export class SkyClouds implements CloudSource {
  settings: SkyCloudSettings = { enabled: true, paint: null, speed: 1 };
  /** how far the eye is inside cloud this frame (0 clear .. 1 lost in it): loom's exposure lift, a game's sound */
  inside = 0;
  readonly noise: Texture;
  readonly u: UniformBuffer<any>;
  /** what the clouds over the scene let through, per pixel (a: the transmittance) — loom's sun shafts are cut by it as by
   *  the volumetric clouds' own */
  readonly cover: Texture;
  private heapInside = 0;
  private shadowTex: Texture;
  private puffBuf: StorageBuffer;
  private cap: number;
  private data: Float32Array;
  private sorted: Float32Array;
  private bucket: Uint16Array;
  private counts = new Uint32Array(SORT_BUCKETS + 1);
  private order: Uint32Array;
  private n = 0;
  private listed = { cam: [0, -1e9, 0] as V3, frames: 0, drift: [0, 0] as [number, number], key: -1 };
  private pass: RenderPass;
  private shadowPass: RenderPass;
  private toLoom: Compute;
  private bake: RunEntry[];
  private baked = 0;
  private shadowTick = 0;
  private shadowRuns = 0;
  private ceiling: Ceiling;
  private half: number;
  private t = T0;
  /** the real seconds the clouds have run (the skies' fades) */
  private clock = 0;
  private seed: number;
  private skies: Sky[] = [];
  private nextKey = 0;
  private overcast = 0;
  private layersOn = [false, false];
  private o: Required<Omit<SkyCloudOptions, 'ground' | 'sky' | 'half' | 'seed' | 'phone'>>;

  constructor(readonly kit: Kit, t: SkyCloudTargets, opts: SkyCloudOptions = {}) {
    const k = kit, phone = !!opts.phone;
    this.o = {
      range: opts.range ?? (phone ? 10000 : 16000), towerRange: opts.towerRange ?? (phone ? 26000 : 40000), lod: opts.lod ?? (phone ? 0.6 : 1),
      spriteCap: opts.spriteCap ?? (phone ? 6000 : 14000), shadowPx: opts.shadowPx ?? (phone ? 256 : 512), shadowEvery: Math.max(1, opts.shadowEvery ?? (phone ? 3 : 2)),
      deckRich: opts.deckRich ?? !phone, shadows: opts.shadows ?? 0.85,
    };
    this.seed = opts.seed ?? 0x5eed;
    this.half = opts.half ?? 4096;
    const cap = this.cap = this.o.spriteCap;
    this.data = new Float32Array(cap * STRIDE); this.sorted = new Float32Array(cap * STRIDE);
    this.bucket = new Uint16Array(cap); this.order = new Uint32Array(cap);
    this.u = k.uniforms(shader.structs.SkyCloudU, 'skyclouds.u');
    this.noise = k.texture({ label: 'skyclouds.noise', format: 'rgba8unorm', size: [512, 512], mips: 'full', usage: ['storage', 'sample', 'render'] });
    this.puffBuf = k.storage({ label: 'skyclouds.puffs', size: cap * STRIDE * 4, usage: ['storage', 'copy-dst'] });
    this.shadowTex = k.texture({ label: 'skyclouds.shadow', format: 'rgba16float', size: [this.o.shadowPx, this.o.shadowPx], usage: ['render', 'sample'] });
    this.ceiling = new Ceiling(opts.ground ?? null, this.half);

    this.bake = [
      k.compute(noiseShader, { label: 'skyclouds.noise', entry: 'bake', threads: [512, 512], bind: { noiseOut: this.noise.mip(0) } as never }),
      new MipChain(k, this.noise),
    ];
    // the clouds over the scene: after the opaque scene and the water, before the mist and the shafts (loom's own
    // clouds' place in its frame), tested against the scene's depth (read-only: the sprites and decks also read it, to
    // soften where a hillside goes up into a cloud and to clip a deck where a ridge stands in it)
    // (and their cover: cleared to clear sky each frame, each draw's opacity multiplied out of it)
    this.cover = k.texture({ label: 'skyclouds.cover', format: 'rgba8unorm', size: 'render', usage: ['render', 'sample'] });
    this.pass = k.pass({ label: 'skyclouds', color: [{ target: t.hdr, clear: false }, { target: this.cover, clear: [1, 1, 1, 1] }], depth: { target: t.depth, readOnly: true } });
    // (premultiplied; the scene's alpha kept)
    const over: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
    const through: GPUBlendState = { color: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const blend = [over, through];
    const rich = this.o.deckRich ? 1 : 0;
    const layerBind = { SC: this.u, cloudNoise: this.noise, sceneDepth: t.depth } as never;
    // (the decks beyond the puffs, the puffs, the decks in front of them, the veil of a heap the eye is in)
    this.pass.fullscreen(shader, { label: 'skyclouds.layers.far', fragment: 'fsLayers', blend, bind: layerBind, constants: { FRONT: 0, RICH: rich }, enabled: () => this.settings.enabled && this.layersOn[0] });
    this.pass.draw(shader, {
      label: 'skyclouds.puffs', vertex: 'vs', fragment: 'fs', count: 6, instances: () => this.n, blend, cull: 'none', depthWrite: false,
      bind: { SC: this.u, cloudNoise: this.noise, sceneDepth: t.depth, puffs: this.puffBuf } as never, enabled: () => this.n > 0,
    });
    this.pass.fullscreen(shader, { label: 'skyclouds.layers.near', fragment: 'fsLayers', blend, bind: layerBind, constants: { FRONT: 1, RICH: rich }, enabled: () => this.settings.enabled && this.layersOn[1] });
    this.pass.fullscreen(shader, { label: 'skyclouds.veil', fragment: 'fsVeil', blend, bind: { SC: this.u, sceneDepth: t.depth } as never, enabled: () => this.heapInside > 0.002 });
    // the shadow: the sprites and the decks facing the light, multiplied in (alpha: the lowest cloud on each ray)
    this.shadowPass = k.pass({ label: 'skyclouds.shadow', color: [{ target: this.shadowTex, clear: [1, 1, 1, 6e4] }] });
    const shadowBlend: GPUBlendState = { color: { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'min' } };
    this.shadowPass.draw(shader, {
      label: 'skyclouds.shadow.puffs', vertex: 'vsShadow', fragment: 'fsShadow', count: 6, instances: () => this.n, blend: shadowBlend, cull: 'none',
      bind: { SC: this.u, cloudNoise: this.noise, puffs: this.puffBuf } as never, enabled: () => this.n > 0,
    });
    this.shadowPass.fullscreen(shader, { label: 'skyclouds.shadow.layers', fragment: 'fsLayersShadow', blend: shadowBlend, bind: { SC: this.u, cloudNoise: this.noise } as never, enabled: () => this.layersOn[0] || this.layersOn[1] });
    // ... and into loom's map (every surface's cloudShadowAt reads it)
    const smap = t.smap;
    this.toLoom = k.compute(smapShader, { label: 'skyclouds.shadow.loom', entry: 'bake', threads: [smap.width, smap.height], bind: { shadowIn: this.shadowTex, smapOut: smap } as never });
    this.setSky(opts.sky ?? 'highland', 0);
  }

  /** the terrain's height at a point (null: none — the heaps keep their bases, the caps that stand over peaks have
   *  none to stand over). Setting it rebuilds the sky round the camera. */
  set ground(fn: ((x: number, z: number) => number) | null) {
    this.ceiling = new Ceiling(fn, this.half);
    for (const s of this.skies) { s.cells.clear(); s.towers.clear(); s.lenses = this.buildLenses(s.recipe); }
    this.listed.frames = 1e9;
  }

  /** the sky there is now (the one coming in) */
  get recipe(): SkyRecipe { return this.skies[0].recipe; }

  /** ease to another sky over `secs` (0: at once) — a kind (Boulder's, varied by `seed`; 'highland') or a recipe:
   *  its clouds form as the old ones thin away, its decks thicken in as theirs break up */
  setSky(sky: SkyKind | SkyRecipe, secs = 0, seed = this.seed) {
    const recipe = typeof sky === 'string' ? skyRecipe(sky, seed) : copyRecipe(sky);
    const w = recipe.wind;
    const s: Sky = {
      recipe, key: this.nextKey++, cells: new Map(), towers: new Map(), lenses: this.buildLenses(recipe),
      drift: [w[0] * this.t, w[1] * this.t], at: this.clock, secs: Math.max(0, secs), w0: 1,
    };
    if (secs <= 0 || !this.skies.length) this.skies = [s];
    else {
      // (each sky there fades on from the weight it has now; the faintest goes when there'd be more than three)
      const old = this.skies.map((k) => ({ ...k, w0: this.weight(k), at: this.clock, secs }));
      this.skies = [s, ...old.filter((k) => k.w0 > 0.02).sort((a, b) => b.w0 - a.w0).slice(0, 2)];
    }
    this.listed.frames = 1e9;
  }

  /** a sky's share of the frame: the one coming in rises from 0, the ones going out fall from where they were */
  private weight(s: Sky) {
    const f = s.secs > 0 ? smooth(0, s.secs, this.clock - s.at) : 1;
    return s === this.skies[0] ? f : s.w0 * (1 - f);
  }

  /** the shadows' strength for loom's world (misc.y): none until our map is first written */
  get shadowK() { return this.settings.enabled && this.shadowRuns > 1 ? this.o.shadows : 0; }
  /** loom's sky values (a game passes them on in its world): loom's cirrus's cover (world.cloudCover), how overcast it
   *  is overhead (world.sky.x: the sky's light from the decks' grey undersides; in a heap, its grey) */
  get sky() {
    let c = 0;
    for (const s of this.skies) c += this.weight(s) * s.recipe.cirrus;
    return { cloudCover: this.settings.enabled ? c : 0, overcast: Math.max(this.inside * 0.85, this.overcast) };
  }
  /** a count for a debug hook */
  debug() {
    const s = this.skies[0];
    return { sprites: this.n, cap: this.cap, skies: this.skies.length, cells: s.cells.size, towers: s.towers.size, lenses: s.lenses.length, inside: +this.inside.toFixed(3), overcast: +this.overcast.toFixed(3), shadowRuns: this.shadowRuns };
  }

  // ------------------------------------------------------------------ the frame
  /** before the scene: the noise (once, until its pipeline exists) and the shadow map (every few frames) */
  bakes(): RunEntry[] {
    const out: RunEntry[] = [];
    // (counted once a pipeline exists: a pass whose pipeline is still compiling records nothing)
    const compiled = (c: Compute) => !!(c.pipe as { pipeline?: unknown } | undefined)?.pipeline;
    if (this.baked < 3) {
      if (compiled(this.bake[0] as Compute)) this.baked++;
      out.push(...this.bake);
    }
    // (the shadow drifts a metre or two between updates: a profile trades its cadence for load)
    if (this.settings.enabled && (this.shadowRuns < 4 || this.shadowTick++ % this.o.shadowEvery === 0)) {
      out.push(this.shadowPass, this.toLoom);
      if (compiled(this.toLoom)) this.shadowRuns++;
    }
    return out;
  }
  render(): RunEntry[] {
    // (always: a clear sky's cover is cleared too)
    return [this.pass];
  }

  /** per frame, before loom's update (the renderer calls it when it made these): the clouds' clock and drift, the
   *  sprites round the camera, the decks, the uniforms */
  update(dt: number, cam: V3, o: { night: number; light: V3 }) {
    const st = this.settings;
    this.t += dt * st.speed;
    this.clock += dt;
    // (the skies gone out of the frame dropped)
    this.skies = this.skies.filter((s, i) => i === 0 || this.weight(s) > 0.001);
    for (const s of this.skies) { const w = s.recipe.wind; s.drift = [w[0] * this.t, w[1] * this.t]; }
    const sky = this.skies[0];
    const L = this.listed;
    const moved = Math.hypot(cam[0] - L.cam[0], cam[1] - L.cam[1], cam[2] - L.cam[2]);
    // (while skies ease into one another, every frame: theirs is a carry of their own winds)
    if (!st.enabled) this.n = 0;
    else if (moved > 25 || ++L.frames >= (this.skies.length > 1 ? 1 : 6) || L.key !== sky.key) {
      this.list(cam);
      L.cam = [cam[0], cam[1], cam[2]]; L.frames = 0; L.drift = [sky.drift[0], sky.drift[1]]; L.key = sky.key;
    }
    this.heapInside = st.enabled ? this.insideHeaps(cam) : 0;
    const layers = this.fillLayers(cam);
    this.inside = Math.max(this.heapInside, layers.inside);
    this.overcast = layers.overcast;
    const w = sky.recipe.wind;
    const wl = Math.hypot(w[0], w[1]) || 1;
    // the painted shade's lean: lilac-grey in the day, a cool slate under the moon, a rose-violet as the sun goes
    const golden = 1 - smooth(0.05, 0.35, o.light[1]);
    const day: V3 = [0.74 + 0.08 * golden, 0.72 - 0.04 * golden, 0.94 - 0.04 * golden];
    const nk = smooth(0.25, 0.85, o.night);
    const tint: V3 = [day[0] + (0.62 - day[0]) * nk, day[1] + (0.68 - day[1]) * nk, day[2] + (0.9 - day[2]) * nk];
    let paint = 0, ws = 0;
    for (const s of this.skies) { const k = this.weight(s); paint += k * (s.recipe.paint ?? 0); ws += k; }
    this.u.set({
      wind: [w[0] / wl, w[1] / wl, sky.drift[0] - L.drift[0], sky.drift[1] - L.drift[1]],
      misc: [this.heapInside, this.overcast, st.paint ?? (ws > 0 ? paint / ws : 0), o.night],
      tint: [...tint, 0.45],
      L: layers.L as never,
    });
  }

  // ------------------------------------------------------------------ the decks
  /** the decks of the sky coming in (slots 0–3) and of the strongest going out (4–7), each faded by its sky's share; which
   *  sides of the puffs they're drawn on; how overcast it is overhead and how far the eye is in a deck */
  private fillLayers(cam: V3) {
    const L: { a: number[]; b: number[]; c: number[]; d: number[]; e: number[] }[] = [];
    const off = { a: [0, 0, 0, 0], b: [1, 0, 0, 0], c: [0, 0, 0, 0], d: [0, 0, 0, 0], e: [1, 0, 0, 0] };
    const now = this.skies[0].recipe;
    // (the heaps' band: a deck below it seen from under it is in front of them, one above it beyond)
    const band = now.cumulus ? now.cumulus.base + 1000 : now.lenses?.at === 'upwind' ? now.lenses.base : 2500;
    const on = [false, false];
    let clear = 1, inside = 0;
    const set = (s: Sky | undefined, w: number) => {
      DECK_SLOTS.forEach((slot, k) => {
        const l0 = s?.recipe.layers[slot];
        const l = l0 && this.settings.enabled ? fadeLayer(l0, w) : null;
        if (!s || !l || l.cover <= 0.001 || l.tau <= 0) { L.push(off); return; }
        const front = cam[1] < l.base ? l.base < band : cam[1] < l.base + l.thick || l.base > band;
        on[front ? 1 : 0] = true;
        const wd = s.recipe.wind, wl = Math.hypot(wd[0], wd[1]) || 1, wx = wd[0] / wl, wz = wd[1] / wl;
        // the drift in the deck's wind's frame (along it, across it), wrapped where its noise repeats
        const along = s.drift[0] * wx + s.drift[1] * wz, across = wx * s.drift[1] - wz * s.drift[0];
        const tile = l.scale;
        L.push({
          a: [l.base, l.thick, l.cover, l.tau], b: [tile, l.lumpy, l.streak, l.halo],
          c: [mod(along, tile * WRAP), mod(across, tile * WRAP), l.band ? l.band[0] : 0, l.band ? l.band[1] : 0],
          d: [front ? 1 : 0, l.offset ?? k * 0.37 + 0.13, l.bright ?? 1, l.patches ? 1 : 0], e: [wx, wz, 0, 1],
        });
        // (overhead: its opaque share; the eye in it: fog, as thick as the deck is)
        if (cam[1] < l.base + l.thick * 0.5) clear *= 1 - l.cover * (1 - Math.exp(-l.tau * 0.6));
        const depth = Math.min(cam[1] - l.base, l.base + l.thick - cam[1]);
        if (depth > 0) inside = Math.max(inside, l.cover * smooth(0, Math.min(80, l.thick * 0.25), depth) * (1 - Math.exp(-l.tau * 0.25)));
      });
    };
    set(this.skies[0], this.weight(this.skies[0]));
    const old = this.skies.slice(1).sort((a, b) => this.weight(b) - this.weight(a))[0];
    set(old, old ? this.weight(old) : 0);
    this.layersOn = on;
    // (a patchy deck leaves the sky's light the clear sky's; a lid makes it the deck's grey)
    return { L: L.slice(0, MAX_LAYERS), overcast: smooth(0.3, 0.95, 1 - clear), inside };
  }

  // ------------------------------------------------------------------ the sky's clouds
  /** a slot's life now: 0 before it forms .. 1 grown .. 0 gone, and its generation */
  private life(sl: Slot) {
    const x = this.t / sl.period + sl.phase, g = Math.floor(x), f = x - g;
    return { gen: g, dev: smooth(0.0, 0.24, f) * (1 - smooth(0.72, 1.0, f)) };
  }

  /** a fair cell's slots: cumulus and wisps, more of them in patches (a slow field leaves stretches of open sky) */
  private slots(R: SkyRecipe, ix: number, iz: number): Slot[] {
    const r = rng(hash3(ix, iz, this.seed));
    const f = Math.sin(ix * 0.53 + 1.7) * Math.cos(iz * 0.41 - 0.6) + 0.5 * Math.sin((ix + iz) * 0.83 + 1.3);
    const out: Slot[] = [];
    const add = (want: number, kind: 0 | 1, p0: number, p1: number) => {
      const n = Math.floor(want) + (r() < want - Math.floor(want) ? 1 : 0);
      for (let k = 0; k < n; k++) out.push({ kind, period: p0 + (p1 - p0) * r(), phase: r(), gen: -1e9, def: null });
    };
    const C = R.cumulus;
    if (C) {
      const [p0, p1] = C.patch ?? [0.12, 1.9];
      const [l0, l1] = C.life ?? [1100, 2400];
      add(C.cover * (p0 + p1 * smooth(-0.8, 1.2, f)), 0, l0, l1);
    }
    if (R.fractus) add(R.fractus.cover * (0.6 + 0.6 * (0.12 + 1.9 * smooth(-0.8, 1.2, f))), 1, 500, 1100);
    return out;
  }

  /** the cloud a slot holds in its generation `g` (null: none this time — the ground turned it away) */
  private make(s: Sky, ix: number, iz: number, k: number, sl: Slot, g: number, cell: number): CloudDef | null {
    const r = rng(hash3(ix * 31 + k, iz * 17 - k, (this.seed ^ Math.imul(g, 2654435761)) >>> 0));
    const R = s.recipe;
    const x = (ix + r()) * cell, z = (iz + r()) * cell;
    if (sl.kind === 2) {
      // a tower, now and then a storm
      const T = R.towers!;
      if (r() > T.chance) return null;
      // (never over the middle of the world in its prime, if the sky keeps it clear: a valley's towers stand far off)
      const tm = (g + 0.5 - sl.phase) * sl.period, w = R.wind;
      if (T.clear && Math.hypot(x + w[0] * tm * 0.45, z + w[1] * tm * 0.45) < T.clear) return null;
      if (r() < T.storm) {
        const [s0, s1] = T.stormSize ?? [2400, 3800];
        const W = s0 + (s1 - s0) * r();
        const c: CloudDef = { x, z, base: T.base + (r() - 0.5) * 150, w: W, h: T.stormTop - T.base, dark: 0.7, puffs: [], anvil: 1, drift: 0.45, alpha: 1 };
        tower(c, r, R.wind, T.full);
        virga(c, r, 8 + Math.floor(r() * 5), c.base * 0.95, 1.6);
        c.puffs.sort((a, b) => b.r - a.r);
        return c;
      }
      const W = T.size[0] + (T.size[1] - T.size[0]) * Math.pow(r(), 1.5);
      const c: CloudDef = { x, z, base: T.base + (r() - 0.5) * 150, w: W, h: W * (T.tall[0] + (T.tall[1] - T.tall[0]) * r()), dark: 0.32, puffs: [], anvil: 0, drift: 0.45, alpha: 1 };
      heap(c, r, T.full);
      if (r() < T.rain) virga(c, r, 4 + Math.floor(r() * 4), c.base * 0.8, 0.9);
      c.puffs.sort((a, b) => b.r - a.r);
      return c;
    }
    if (sl.kind === 1) {
      const F = R.fractus!;
      const W = F.size[0] + (F.size[1] - F.size[0]) * r();
      const c: CloudDef = { x, z, base: F.base[0] + (F.base[1] - F.base[0]) * r(), w: W, h: W * 0.4, dark: 0.05, puffs: [], anvil: 0, drift: 1.05, alpha: F.alpha * (0.6 + 0.4 * r()) };
      wisp(c, r, R.wind);
      c.puffs.sort((a, b) => b.r - a.r);
      return c;
    }
    const C = R.cumulus!;
    // (heaps favour the high ground: thermals off the slopes)
    const [h0, h1] = C.high ?? [80, 650], H = C.hills ?? 0.45;
    const hill = smooth(h0, h1, this.ceiling.at(x + s.drift[0], z + s.drift[1]));
    if (r() > (1 - H) + H * hill) return null;
    // a size off a long tail: mostly middling heaps, now and then a big one
    const W = C.size[0] + (C.size[1] - C.size[0]) * Math.pow(r(), 2.4);
    const Ht = W * (C.tall[0] + (C.tall[1] - C.tall[0]) * r());
    const c: CloudDef = { x, z, base: C.base + (r() - 0.5) * 140, w: W, h: Ht, dark: C.dark * (0.7 + 0.6 * r()), puffs: [], anvil: 0, drift: 1, alpha: 1 };
    heap(c, r, C.full);
    if (C.virga && r() < C.virga) virga(c, r, 3 + Math.floor(r() * 4), Math.min(c.base * 0.7, 600 + 900 * r()), 0.6);
    c.puffs.sort((a, b) => b.r - a.r);
    return c;
  }

  /** the lenticular caps: over the highest peaks (still, whatever the wind; their long axis across it, a little downwind
   *  of the summit where the wave stands), or Boulder's wave train upwind of the origin (kilometres long, in stacks) */
  private buildLenses(R: SkyRecipe): Lens[] {
    const out: Lens[] = [];
    const ls = R.lenses;
    if (!ls) return out;
    const r = rng(this.seed ^ 0x1e75);
    const w = R.wind, wl = Math.hypot(w[0], w[1]) || 1, yaw = Math.atan2(w[0], -w[1]);
    if (ls.at === 'peaks') {
      for (const [px, ph, pz] of this.ceiling.peaks(ls.peak).slice(0, ls.count)) {
        const x = px + w[0] / wl * (150 + 250 * r()), z = pz + w[1] / wl * (150 + 250 * r());
        const a = 360 + 380 * r(), c = 150 + 150 * r(), b = 32 + 30 * r();
        const plates = r() < 0.3 ? 2 : 1;
        let y = ph + ls.above[0] + (ls.above[1] - ls.above[0]) * r();
        for (let p = 0; p < plates; p++) {
          const s = 1 - p * (0.18 + 0.15 * r());
          out.push({ x: x + (r() - 0.5) * 120, z: z + (r() - 0.5) * 200, y, a: a * s, b: b * (0.8 + 0.4 * r()), c: c * s, yaw: yaw + (r() - 0.5) * 0.15, tau: 3 + 4 * r(), seed: r(), smooth: false });
          y += b * (2.1 + 0.8 * r());
        }
      }
      return out;
    }
    // (Boulder's stand over the Front Range, 6–25 km west of the site, the wind from the west: here upwind of the origin)
    const ux = -w[0] / wl, uz = -w[1] / wl;
    for (let k = 0; k < ls.count; k++) {
      const up = 6160 + 19000 * r(), side = (r() - 0.5) * 50000;
      const x = ux * up - uz * side, z = uz * up + ux * side;
      const ly = yaw + (r() - 0.5) * 0.6;
      const a = 4000 + 7000 * r(), c = 1200 + 2300 * r(), b = 220 + 380 * r();
      const plates = 1 + Math.floor(r() * 3);
      let y = ls.base + (r() - 0.5) * 1200;
      for (let p = 0; p < plates; p++) {
        const s = 1 - p * (0.15 + 0.15 * r());
        out.push({ x: x + (r() - 0.5) * 600, z: z + (r() - 0.5) * 1200, y, a: a * s, b: b * (0.8 + 0.4 * r()), c: c * s, yaw: ly + (r() - 0.5) * 0.1, tau: 5 + 9 * r(), seed: r(), smooth: true });
        y += b * (2.1 + 0.8 * r());
      }
    }
    return out;
  }

  private list(cam: V3) {
    const d = this.data, CAP = this.cap, O = this.o;
    let n = 0;
    let drifts = 1;
    const push = (x: number, y: number, z: number, rad: number, ox: number, oy: number, oz: number, base: number, seed: number, alpha: number, dark: number, kind: number, a0 = 0, a1 = 0, a2 = 0) => {
      if (n >= CAP) return;
      const o = n * STRIDE;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = rad;
      d[o + 4] = ox; d[o + 5] = oy; d[o + 6] = oz; d[o + 7] = base;
      d[o + 8] = seed; d[o + 9] = alpha; d[o + 10] = dark; d[o + 11] = kind;
      d[o + 12] = a0; d[o + 13] = a1; d[o + 14] = a2; d[o + 15] = kind === 1 ? 0 : drifts;
      n++;
    };
    // (the earth's curve: far clouds sink toward the horizon)
    const fall = (x: number, z: number) => ((x - cam[0]) ** 2 + (z - cam[2]) ** 2) / (2 * 6.371e6);
    let sortRange = O.towerRange;
    for (const s of this.skies) {
      const weight = this.weight(s);
      if (weight <= 0.003) continue;
      const R = s.recipe;
      const emit = (c: CloudDef, dev: number, range: number) => {
        if (dev <= 0.01) return;
        const cx = c.x + s.drift[0] * c.drift, cz = c.z + s.drift[1] * c.drift;
        drifts = c.drift;
        // lifted clear of the ground it's over (a heap drifting onto a ridge rides up over it)
        const lift = Math.max(0, this.ceiling.under(cx, cz, c.w * 0.42) + 50 + 0.06 * c.w - c.base);
        const base0 = c.base + lift;
        const dist = Math.hypot(cx - cam[0], base0 - cam[1], cz - cam[2]);
        if (dist > range + c.w) return;
        const fade = (1 - smooth(range * 0.7, range, dist)) * weight;
        // (far off, only the biggest puffs — the outline is all a few pixels can show — the small ones fading out over a
        // few kilometres, never cut; a big cloud keeps its detail farther out)
        const ls = Math.max(1, c.w / 700) * O.lod;
        const f16 = 1 - smooth(6500 * ls, 10000 * ls, dist), f8 = 1 - smooth(3200 * ls, 5500 * ls, dist);
        const up = 0.45 + 0.55 * dev, grow = 0.6 + 0.4 * dev;
        // (the whole cloud fades in as it forms and out as it evaporates: its lowest puffs never pop in or out)
        const whole = smooth(0.01, 0.3, dev);
        const base = base0 - fall(cx, cz);
        for (let k = 0; k < c.puffs.length; k++) {
          const p = c.puffs[k];
          const lod = k < 10 ? 1 : k < 24 ? f16 : f8;
          const a = fade * lod * whole * c.alpha * smooth(p.rel - 0.25, p.rel + 0.05, dev * 1.15);
          if (a <= 0.003) continue;
          if (p.kind === 2) {
            // (rain falls once the cloud is grown)
            const va = a * smooth(0.6, 0.9, dev);
            if (va > 0.003) push(cx + p.dx, base + 20, cz + p.dz, p.r, p.len * (0.5 + 0.5 * dev), 0, 0, base, p.seed, va, c.dark, 2);
            continue;
          }
          // (an anvil spreads downwind as the storm matures)
          const spread = c.anvil && p.dy > c.h * 0.84 ? 0.35 + 0.65 * smooth(0.5, 1, dev) : 1;
          push(cx + p.dx * spread, base + p.dy * up, cz + p.dz * spread, p.r * grow, p.dx / (c.w * 0.5), p.dy / Math.max(c.h, 1), p.dz / (c.w * 0.5), base, p.seed, a, c.dark, 0, p.ceil ? base + p.ceil * up : 0);
        }
      };
      // the cells in range (in the drifted sky): the fair clouds, the towers' coarser grid
      const field = (map: Map<string, Slot[]>, cell: number, range: number, drift: number, make: (ix: number, iz: number) => Slot[]) => {
        const ux = cam[0] - s.drift[0] * drift, uz = cam[2] - s.drift[1] * drift;
        const c0x = Math.floor((ux - range) / cell), c1x = Math.floor((ux + range) / cell);
        const c0z = Math.floor((uz - range) / cell), c1z = Math.floor((uz + range) / cell);
        const seen = new Set<string>();
        for (let ix = c0x; ix <= c1x; ix++) for (let iz = c0z; iz <= c1z; iz++) {
          const key = `${ix},${iz}`;
          seen.add(key);
          let list = map.get(key);
          if (!list) { list = make(ix, iz); map.set(key, list); }
          list.forEach((sl, k) => {
            const { gen, dev } = this.life(sl);
            if (gen !== sl.gen) { sl.gen = gen; sl.def = this.make(s, ix, iz, k, sl, gen, cell); }
            if (sl.def) emit(sl.def, dev, range);
          });
        }
        for (const k of map.keys()) if (!seen.has(k)) map.delete(k);
      };
      if (R.cumulus || R.fractus) field(s.cells, R.cell ?? CELL, R.range ? R.range * O.range / 16000 : O.range, 1, (ix, iz) => this.slots(R, ix, iz));
      if (R.towers) {
        const tr = R.towers.range ? R.towers.range * O.towerRange / 40000 : O.towerRange;
        sortRange = Math.max(sortRange, tr);
        field(s.towers, R.towers.cell ?? TCELL, tr, 0.45, (ix, iz) => {
          const r = rng(hash3(ix, iz, this.seed ^ 0x70e5));
          return [{ kind: 2, period: 2400 + 1800 * r(), phase: r(), gen: -1e9, def: null }];
        });
      }
      // the caps, breathing a little
      const reach = R.lenses?.reach ?? 30000;
      for (const l of s.lenses) {
        const dist = Math.hypot(l.x - cam[0], l.y - cam[1], l.z - cam[2]);
        if (dist > reach) continue;
        const br = 1 + 0.05 * Math.sin(this.t / (l.smooth ? 1100 : 300) + l.seed * 40);
        const a = l.a * br, c = l.c * br;
        push(l.x, l.y - fall(l.x, l.z), l.z, Math.max(a, c, l.b), a, l.b, c, l.y, l.seed, (1 - smooth(reach * 2 / 3, reach, dist)) * weight, l.smooth ? 1 : 0, 1, Math.cos(l.yaw), Math.sin(l.yaw), l.tau);
      }
    }
    // back to front: a counting sort over distance buckets (by the square root of the distance: finer near)
    const bk = this.bucket, counts = this.counts, order = this.order;
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      const dist = Math.hypot(d[o] - cam[0], d[o + 1] - cam[1], d[o + 2] - cam[2]);
      const b = SORT_BUCKETS - 1 - Math.min(SORT_BUCKETS - 1, Math.floor(Math.sqrt(dist / sortRange) * SORT_BUCKETS));
      bk[i] = b; counts[b + 1]++;
    }
    for (let b = 0; b < SORT_BUCKETS; b++) counts[b + 1] += counts[b];
    for (let i = 0; i < n; i++) order[counts[bk[i]]++] = i;
    const s = this.sorted;
    for (let i = 0; i < n; i++) s.set(d.subarray(order[i] * STRIDE, order[i] * STRIDE + STRIDE), i * STRIDE);
    this.n = n;
    if (n) this.puffBuf.write(s.subarray(0, n * STRIDE));
  }

  /** the eye in the heaps: each puff it's within reach of (where its sprite fades as the lens comes up to it, from 1.45
   *  radii in) adds its share, the more the deeper in, none under a cloud's flat base; the puffs where the wind has
   *  carried them since they were listed, as the shaders have them */
  private insideHeaps(cam: V3): number {
    const sky = this.skies[0];
    const s = this.sorted, wx = sky.drift[0] - this.listed.drift[0], wz = sky.drift[1] - this.listed.drift[1];
    let tau = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * STRIDE;
      if (s[o + 11] !== 0) continue;
      const r = s[o + 3], dy = s[o + 1] - cam[1];
      if (Math.abs(dy) > r * 1.45 || cam[1] < s[o + 7]) continue;
      const k = s[o + 15], dx = s[o] + wx * k - cam[0], dz = s[o + 2] + wz * k - cam[2];
      const dd = Math.hypot(dx, dy, dz);
      if (dd > r * 1.45) continue;
      tau += s[o + 9] * (1 - smooth(r * 0.5, r * 1.45, dd)) * 0.9;
    }
    return 1 - Math.exp(-tau);
  }
}

/** a deck in a sky coming in or going out (`k` its share, 0..1): one that comes or goes thickens or thins as it spreads
 *  or breaks up (never a hard-edged scatter of thin cells); a deck on the ground (fog) only thickens or thins, so it
 *  never stands round the eye as walls (Boulder's morphLayer) */
function fadeLayer(l: LayerSpec, k: number): LayerSpec {
  if (k >= 1) return l;
  return l.base < 150 ? { ...l, tau: l.tau * k * k * k } : { ...l, cover: l.cover * (0.5 + 0.5 * k), tau: l.tau * k * k };
}

const mod = (x: number, m: number) => ((x % m) + m) % m;
