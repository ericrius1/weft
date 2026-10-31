// Web Worker entry: renders sounds off the main thread and transfers the sample buffers back.
import { Rng } from './dsp';
import { RENDERERS } from './registry';
const scope = self;
scope.onmessage = (e) => {
    const { id, kind, params, seed, sr } = e.data;
    try {
        const fn = RENDERERS[kind];
        if (!fn)
            throw new Error('unknown renderer ' + kind);
        const r = fn(params, new Rng(seed), sr);
        scope.postMessage({ id, ch: r.ch, sr: r.sr }, r.ch.map((c) => c.buffer));
    }
    catch (err) {
        scope.postMessage({ id, error: String(err?.stack ?? err) });
    }
};
//# sourceMappingURL=worker.js.map