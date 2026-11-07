// How the frames really run on a device you can't attach a profiler to (a phone): every few seconds a report is posted
// — the frame rate over the window, its worst frame, the GPU's time where the kit can measure it, the render scale and
// size — plus whatever the app adds (its profile, where the camera is). San Francisco's ?perf, shared. Point it at a
// server that logs the reports: a dev server's beacon sink (plugin/vite.ts beaconSink, '/__beacon' → shots/perf/
// beacon.jsonl), or a deployed server's own endpoint.
//
//   if (qs.has('perf')) perfBeacon(kit, { url: qs.get('perf') || '/__beacon', extra: () => ({ profile: tier.name }) });
import type { Kit } from './kit';

export interface BeaconOptions {
  /** where the reports are posted (default the dev sink, '/__beacon') */
  url?: string;
  /** ms between reports (default 5000) */
  every?: number;
  /** more fields for each report */
  extra?: () => Record<string, unknown>;
  /** posted without CORS (default true: a beacon to another origin needs no preflight; the body goes as text/plain) */
  noCors?: boolean;
}

export interface BeaconReport {
  fps: number; worst: number; gpu: number; scale: number; size: readonly number[]; ua: string;
  [k: string]: unknown;
}

/** starts reporting; returns a function that stops it */
export function perfBeacon(kit: Kit, o: BeaconOptions = {}): () => void {
  const url = o.url ?? '/__beacon', every = o.every ?? 5000;
  let n = 0, t0 = performance.now(), worst = 0, last = performance.now(), on = true;
  const tick = () => {
    if (!on) return;
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
    n++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const timer = setInterval(() => {
    const now = performance.now(), fps = (n * 1000) / (now - t0);
    const body: BeaconReport = {
      fps: +fps.toFixed(1), worst: +worst.toFixed(0), gpu: kit.profiler.available ? +kit.profiler.frameMs.toFixed(1) : -1,
      scale: kit.renderScale, size: kit.size.render, ua: typeof navigator === 'undefined' ? '' : navigator.userAgent.slice(0, 120),
      ...o.extra?.(),
    };
    void fetch(url, { method: 'POST', body: JSON.stringify(body), mode: o.noCors === false ? 'cors' : 'no-cors', keepalive: true }).catch(() => {});
    n = 0; t0 = now; worst = 0;
  }, every);
  return () => { on = false; clearInterval(timer); };
}
