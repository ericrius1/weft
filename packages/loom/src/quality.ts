// A game's quality, the same in every loom game: Epic — a cinematic 30 fps at full resolution, the clouds traced at
// every half-res pixel every frame (the best they look) — or Smooth: 60 fps, the resolution gives first, the clouds
// traced a quarter of the pixels a frame (interleaved over four). Remembered per game in this browser; ?fps=30|60 and
// ?noautores / ?uncapped override. `qualityPicker` puts the two buttons on a title card (style `.qpick` in the game).
import { AutoResolution, type Kit } from '@ericrius1/weft';
import type { Renderer } from './render/renderer';

export type Quality = 'epic' | 'smooth';

const key = (game: string) => `${game}.quality`;
export function loadQuality(game: string, fallback: Quality = 'epic'): Quality {
  try { const q = localStorage.getItem(key(game)); return q === 'epic' || q === 'smooth' ? q : fallback; } catch { return fallback; }
}
export function saveQuality(game: string, q: Quality) {
  try { localStorage.setItem(key(game), q); } catch { /* (private mode: this session only) */ }
}

/** the frame budget for a quality: the fps cap, auto resolution's target, the clouds' march */
export function applyQuality(kit: Kit, r: Renderer, q: Quality, qs = new URLSearchParams(location.search)) {
  const fps = qs.get('fps') === '60' ? 60 : qs.get('fps') === '30' ? 30 : q === 'smooth' ? 60 : 30;
  kit.maxFps = qs.has('uncapped') ? 0 : fps;
  kit.autoRes = qs.has('noautores') ? null : new AutoResolution(fps === 60 ? 14.5 : 30, { min: fps === 60 ? 0.5 : 0.6, max: 1 });
  r.clouds.params.marchRes = fps === 60 ? 'quarter' : 'half';
  return fps;
}

/** the Epic / Smooth buttons (in `parent`), the game's choice lit; picking one applies and remembers it */
export function qualityPicker(parent: HTMLElement, game: string, kit: Kit, r: Renderer, onChange?: (q: Quality) => void) {
  const box = document.createElement('div');
  box.className = 'qpick';
  box.innerHTML = '<span>Quality</span><button data-q="epic">Epic · 30 fps</button><button data-q="smooth">Smooth · 60 fps</button>';
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
