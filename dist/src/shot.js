import { Capture } from './capture';
const captures = new WeakMap();
export async function shot(kit, name = 'shot', o = {}) {
    const frames = Math.max(1, o.frames ?? 30), dt = o.dt ?? 1 / 30;
    const every = o.pauseEvery ?? 6, ms = o.pauseMs ?? 20;
    for (let i = 0; i < frames - 1; i++) {
        kit.step(dt);
        if (every > 0 && i % every === every - 1)
            await new Promise((r) => setTimeout(r, ms));
    }
    let cap = captures.get(kit);
    if (!cap)
        captures.set(kit, (cap = new Capture(kit)));
    const img = await cap.step(dt);
    const blob = await encode(img, o.type ?? 'image/jpeg', o.quality ?? 0.9);
    const sink = o.sink === undefined ? '/__shot' : o.sink;
    if (sink) {
        const sep = sink.includes('?') ? '&' : '?';
        await fetch(`${sink}${sep}name=${encodeURIComponent(name)}`, { method: 'POST', body: blob }).catch(() => { });
    }
    return { width: img.width, height: img.height, blob };
}
async function encode(img, type, quality) {
    if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d').putImageData(img, 0, 0);
        return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('shot: the picture could not be encoded'))), type, quality));
    }
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext('2d').putImageData(img, 0, 0);
    return c.convertToBlob({ type, quality });
}
//# sourceMappingURL=shot.js.map