// Web Worker entry: renders sounds off the main thread and transfers the sample buffers back.
import { Rng } from './dsp';
import { RENDERERS } from './registry';

interface Req { id: number; kind: string; params: unknown; seed: number; sr: number }
const scope = self as unknown as { onmessage: ((e: MessageEvent<Req>) => void) | null; postMessage(m: unknown, transfer?: Transferable[]): void };

scope.onmessage = (e) => {
  const { id, kind, params, seed, sr } = e.data;
  try {
    const fn = RENDERERS[kind];
    if (!fn) throw new Error('unknown renderer ' + kind);
    const r = fn(params, new Rng(seed), sr);
    scope.postMessage({ id, ch: r.ch, sr: r.sr }, r.ch.map((c) => c.buffer as ArrayBuffer));
  } catch (err) {
    scope.postMessage({ id, error: String((err as Error)?.stack ?? err) });
  }
};
