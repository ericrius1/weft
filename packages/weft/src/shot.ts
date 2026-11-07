// A picture of the view, taken by stepping the kit by hand (San Francisco's app.shot): it works in a background tab or
// a hidden pane, where the browser runs no animation frames at all, and in headless Chrome, which doesn't composite a
// WebGPU canvas into its own screenshots. `frames - 1` frames are stepped first (streams land, the exposure and the
// temporal passes settle; a pause every few lets fetches and compiles answer), then one is stepped and read back
// (Capture), encoded, and — on a dev server with the shot sink (plugin/vite.ts shotSink) — posted there, written to
// shots/<name>.jpg.
//
//   await shot(kit, 'harbour');                         // dev: shots/harbour.jpg
//   const { blob } = await shot(kit, 'x', { sink: null });
import type { Kit } from './kit';
import { Capture } from './capture';

export interface ShotOptions {
  /** frames stepped, the last one captured (default 30) */
  frames?: number;
  /** seconds a frame (default 1/30) */
  dt?: number;
  /** a pause of `pauseMs` every `pauseEvery` frames, for the network and the compiles (default 6, 20 ms) */
  pauseEvery?: number;
  pauseMs?: number;
  /** the encoding (default image/jpeg at 0.9) */
  type?: string;
  quality?: number;
  /** where it's posted, ?name= added (default '/__shot'; null: not posted) */
  sink?: string | null;
}

const captures = new WeakMap<Kit, Capture>();

export async function shot(kit: Kit, name = 'shot', o: ShotOptions = {}): Promise<{ width: number; height: number; blob: Blob }> {
  const frames = Math.max(1, o.frames ?? 30), dt = o.dt ?? 1 / 30;
  const every = o.pauseEvery ?? 6, ms = o.pauseMs ?? 20;
  for (let i = 0; i < frames - 1; i++) {
    kit.step(dt);
    if (every > 0 && i % every === every - 1) await new Promise((r) => setTimeout(r, ms));
  }
  let cap = captures.get(kit);
  if (!cap) captures.set(kit, (cap = new Capture(kit)));
  const img = await cap.step(dt);
  const blob = await encode(img, o.type ?? 'image/jpeg', o.quality ?? 0.9);
  const sink = o.sink === undefined ? '/__shot' : o.sink;
  if (sink) {
    const sep = sink.includes('?') ? '&' : '?';
    await fetch(`${sink}${sep}name=${encodeURIComponent(name)}`, { method: 'POST', body: blob }).catch(() => {});
  }
  return { width: img.width, height: img.height, blob };
}

async function encode(img: ImageData, type: string, quality: number): Promise<Blob> {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    return new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('shot: the picture could not be encoded'))), type, quality));
  }
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c.convertToBlob({ type, quality });
}
