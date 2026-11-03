// A game's quality, the same in every loom game: Epic — a cinematic 30 fps at full resolution, the clouds traced at
// every half-res pixel every frame (the best they look) — or Smooth: 60 fps, the resolution gives first, the clouds
// traced a quarter of the pixels a frame (interleaved over four) — or Mobile, a phone's: no MSAA, smaller shadows, the
// clouds at a quarter, no ambient occlusion, shafts or motion blur, 30 fps from a lower resolution held to the phone's
// pace (after Seven Havens' and boulder's iPhone profile). Remembered per game in this browser; ?quality=epic|smooth|
// mobile, ?fps=30|60 and ?noautores / ?uncapped override. `qualityPicker` puts the buttons on a title card (style
// `.qpick` in the game).
//
// MSAA and the shadow maps' sizes are fixed when the renderer is made: `rendererOptions(q)` gives them for a quality
// (new Renderer(kit, terrain, atmo, half, rendererOptions(q))); `applyQuality` sets the rest, any time.
import { AutoResolution, type Kit } from '@ericrius1/weft';
import type { Renderer, RendererOptions } from './render/renderer';

export type Quality = 'epic' | 'smooth' | 'mobile';

/** what a quality fixes at construction (RendererOptions) and sets after (applyQuality) */
export interface QualityProfile {
  /** RendererOptions: the scene's samples, the cascades' size, the terrain shadow's size */
  msaa: 1 | 4;
  shadowSize: number;
  terrainShadowSize: number;
  /** the fps cap; auto resolution's GPU budget (ms), its least and most render scale, the scale to begin at (null:
   *  as the kit has it) and how far it steps; the canvas's device pixels a CSS pixel at most (null: the kit's) */
  fps: 30 | 60;
  budgetMs: number;
  minScale: number;
  maxScale: number;
  startScale: number | null;
  step: number;
  maxPixelRatio: number | null;
  /** (with no GPU timing: a phone) a frame late past the display's interval times this */
  slack: number;
  /** the clouds' march resolution and steps (null: the clouds' own) */
  marchRes: 'quarter' | 'half';
  cloudSteps: number | null;
  /** ambient occlusion, the sun's shafts, camera motion blur (null: leave the game's own setting alone) */
  ao: boolean | null;
  shafts: boolean | null;
  motionBlur: boolean | null;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  epic: {
    msaa: 4, shadowSize: 2048, terrainShadowSize: 2048,
    fps: 30, budgetMs: 30, minScale: 0.6, maxScale: 1, startScale: null, step: 0.08, maxPixelRatio: null, slack: 1.25,
    marchRes: 'half', cloudSteps: null, ao: null, shafts: null, motionBlur: null,
  },
  smooth: {
    msaa: 4, shadowSize: 2048, terrainShadowSize: 2048,
    fps: 60, budgetMs: 14.5, minScale: 0.5, maxScale: 1, startScale: null, step: 0.08, maxPixelRatio: null, slack: 1.25,
    marchRes: 'quarter', cloudSteps: null, ao: null, shafts: null, motionBlur: null,
  },
  // (a phone's GPU is a tenth of a desktop's and it heats: one sample a pixel, half the shadow texels, a quarter of
  // the clouds' pixels a frame and fewer steps, the passes that cost a full-screen pass or more each off; 30 fps from
  // 0.7 of the canvas at 2 pixels a CSS pixel, auto resolution moving in small steps no more than every two seconds
  // between 0.45 and 0.85 — gentle, as a phone's frame times are noisy)
  mobile: {
    msaa: 1, shadowSize: 1024, terrainShadowSize: 1024,
    fps: 30, budgetMs: 28, minScale: 0.45, maxScale: 0.85, startScale: 0.7, step: 0.05, maxPixelRatio: 2, slack: 1.35,
    marchRes: 'quarter', cloudSteps: 112, ao: false, shafts: false, motionBlur: false,
  },
};

/** a phone or a tablet: by its browser, or a compact screen with a coarse pointer (boulder's and Seven Havens' guess) */
export function isPhone(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // (an iPad's Safari says it's a Mac: a Mac with a touch screen is one)
  if (/iPhone|iPod|iPad|Android/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)) return true;
  try {
    return typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 600 && matchMedia('(pointer: coarse)').matches;
  } catch { return false; }
}

const QUALITIES: Quality[] = ['epic', 'smooth', 'mobile'];
const isQuality = (q: unknown): q is Quality => QUALITIES.includes(q as Quality);
const key = (game: string) => `${game}.quality`;
/** 'mobile' on a phone (isPhone), else `desktop`: the fallback for loadQuality that starts a phone on its profile —
 *  loadQuality(game, phoneOr('smooth')) */
export function phoneOr(desktop: Quality = 'epic'): Quality { return isPhone() ? 'mobile' : desktop; }

/** the quality to start at: ?quality=epic|smooth|mobile, else the one remembered for this game, else `fallback`
 *  (phoneOr(…) to start a phone on 'mobile') */
export function loadQuality(game: string, fallback: Quality = 'epic', qs = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)): Quality {
  const asked = qs.get('quality');
  if (isQuality(asked)) return asked;
  try { const q = localStorage.getItem(key(game)); if (isQuality(q)) return q; } catch { /* (private mode) */ }
  return fallback;
}
export function saveQuality(game: string, q: Quality) {
  try { localStorage.setItem(key(game), q); } catch { /* (private mode: this session only) */ }
}

/** the Renderer's construction options for a quality (a game passes them to `new Renderer(…, opts)`); `over` on top */
export function rendererOptions(q: Quality, over: RendererOptions = {}): RendererOptions {
  const P = QUALITY[q];
  return { msaa: P.msaa, shadowSize: P.shadowSize, terrainShadowSize: P.terrainShadowSize, ...over };
}

/** the frame budget for a quality: the fps cap, auto resolution, the clouds' march; for 'mobile' also the passes it
 *  turns off and the start scale. Returns the fps. (MSAA and the shadows' sizes are the Renderer's, made with
 *  rendererOptions; a renderer made otherwise keeps its own.) */
export function applyQuality(kit: Kit, r: Renderer, q: Quality, qs = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)) {
  const P = QUALITY[q];
  const fps = qs.get('fps') === '60' ? 60 : qs.get('fps') === '30' ? 30 : P.fps;
  kit.maxFps = qs.has('uncapped') ? 0 : fps;
  const phone = q === 'mobile';
  // (Epic and Smooth by the fps, as they always were — ?fps can swap them; Mobile its own, its budget following ?fps)
  const D = QUALITY[fps === 60 ? 'smooth' : 'epic'];
  const budget = phone ? (fps === P.fps ? P.budgetMs : 14.5) : D.budgetMs;
  kit.autoRes = qs.has('noautores') ? null : phone
    ? new AutoResolution(budget, { min: P.minScale, max: P.maxScale, step: P.step, slack: P.slack, interval: 2 })
    : new AutoResolution(budget, { min: D.minScale, max: D.maxScale });
  if (P.maxPixelRatio !== null) kit.maxPixelRatio = Math.min(kit.maxPixelRatio, P.maxPixelRatio);
  if (P.startScale !== null) kit.renderScale = Math.min(Math.max(kit.renderScale, P.minScale), P.startScale);
  else if (kit.renderScale > P.maxScale) kit.renderScale = P.maxScale;
  const C = r.clouds.params;
  C.marchRes = phone ? P.marchRes : D.marchRes;
  if (P.cloudSteps !== null) { cloudSteps.set(r, cloudSteps.get(r) ?? C.steps); C.steps = P.cloudSteps; } else if (cloudSteps.has(r)) C.steps = cloudSteps.get(r)!;
  // (what a profile turns off is put back as the game had it when another quality is picked)
  toggle(r, 'ao', P.ao, () => r.cinema.params.ao, (v) => { r.cinema.params.ao = v; });
  toggle(r, 'shafts', P.shafts, () => r.cinema.params.shafts, (v) => { r.cinema.params.shafts = v; });
  toggle(r, 'motionBlur', P.motionBlur, () => r.motionBlur.shutter, (v) => { r.motionBlur.shutter = v; });
  return fps;
}
const cloudSteps = new WeakMap<Renderer, number>();
const kept = new WeakMap<Renderer, Record<string, number>>();
function toggle(r: Renderer, name: string, on: boolean | null, get: () => number, set: (v: number) => void) {
  const k = kept.get(r) ?? {};
  kept.set(r, k);
  if (on === false) { if (!(name in k)) k[name] = get(); set(0); }
  else if (name in k) { set(k[name]); delete k[name]; }
}

/** the quality buttons (in `parent`), the game's choice lit; picking one applies and remembers it. With `mobile: true`
 *  (isPhone(), say) a third, Phone; MSAA and the shadows' sizes take effect when the renderer is next made (the game
 *  reloads, or rebuilds it, in onChange) */
export function qualityPicker(parent: HTMLElement, game: string, kit: Kit, r: Renderer, onChange?: (q: Quality) => void, o: { mobile?: boolean } = {}) {
  const box = document.createElement('div');
  box.className = 'qpick';
  const mobile = o.mobile ?? false;
  box.innerHTML = '<span>Quality</span><button data-q="epic">Epic · 30 fps</button><button data-q="smooth">Smooth · 60 fps</button>'
    + (mobile ? '<button data-q="mobile">Phone · 30 fps</button>' : '');
  const show = (q: Quality) => box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.q === q));
  show(loadQuality(game));
  box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const q = b.dataset.q as Quality;
    saveQuality(game, q);
    applyQuality(kit, r, q);
    show(q);
    onChange?.(q);
  }));
  parent.appendChild(box);
  return box;
}
