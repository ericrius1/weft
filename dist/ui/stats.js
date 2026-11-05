// Key numbers while the interface is showing (its toggle, `/`), bottom right: frame rate and time, the GPU's time
// (timestamp queries), the render scale, roughly how much GPU memory the app holds (every texture and buffer created,
// counted as they are made and destroyed) and the JS heap (Chrome). Universe's and Seven Havens'.
const BYTES = {
    r8unorm: 1, r8snorm: 1, r8uint: 1, r8sint: 1, stencil8: 1,
    rg8unorm: 2, rg8snorm: 2, rg8uint: 2, rg8sint: 2, r16float: 2, r16uint: 2, r16sint: 2, depth16unorm: 2,
    'rg11b10ufloat': 4,
    rgba16float: 8, rg32float: 8, rg32uint: 8, rg32sint: 8, rgba16uint: 8, rgba16sint: 8,
    rgba32float: 16, rgba32uint: 16, rgba32sint: 16, 'depth32float-stencil8': 8,
};
const texelBytes = (f) => BYTES[f] ?? 4;
/** what's held, and by label (the biggest holders: `[...gpuMemory.by].sort((a, b) => b[1] - a[1])`) */
export const gpuMemory = { bytes: 0, textures: 0, buffers: 0, by: new Map() };
const hold = (label, bytes) => {
    const k = label || '?';
    gpuMemory.bytes += bytes;
    gpuMemory.by.set(k, (gpuMemory.by.get(k) ?? 0) + bytes);
};
/** count every texture and buffer the app makes (call before the device exists) */
export function trackGpuMemory() {
    if (typeof GPUDevice === 'undefined')
        return;
    const P = GPUDevice.prototype;
    const tex = P.createTexture, buf = P.createBuffer;
    P.createTexture = function (d) {
        const t = tex.call(this, d);
        const s = d.size;
        const [w, h, l] = Array.isArray(s) ? [s[0], s[1] ?? 1, s[2] ?? 1] : [s.width, s.height ?? 1, s.depthOrArrayLayers ?? 1];
        const mips = (d.mipLevelCount ?? 1) > 1 ? 1.334 : 1;
        const bytes = Math.round(w * h * l * texelBytes(d.format) * mips * (d.sampleCount ?? 1));
        hold(d.label, bytes);
        gpuMemory.textures++;
        const destroy = t.destroy.bind(t);
        let gone = false;
        t.destroy = () => { if (!gone) {
            gone = true;
            hold(d.label, -bytes);
            gpuMemory.textures--;
        } destroy(); };
        return t;
    };
    P.createBuffer = function (d) {
        const b = buf.call(this, d);
        hold(d.label, d.size);
        gpuMemory.buffers++;
        const destroy = b.destroy.bind(b);
        let gone = false;
        b.destroy = () => { if (!gone) {
            gone = true;
            hold(d.label, -d.size);
            gpuMemory.buffers--;
        } destroy(); };
        return b;
    };
}
// (the kit's glass and mono: its --k-* tokens, with their values to fall back on where the page has no kit)
const CSS = `
#stats-box { position: fixed; right: 12px; bottom: 12px; z-index: 11; pointer-events: none; padding: 8px 12px; border-radius: 12px;
  background: var(--k-glass, rgba(14, 16, 26, 0.72)); color: var(--k-muted, #8f97b5); font: 11px/1.5 var(--k-mono, ui-monospace, Menlo, monospace);
  white-space: pre; -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3); border: 1px solid var(--k-line, rgba(160, 180, 255, 0.1)); }
#stats-box b { color: var(--k-accent, #f2c66b); font-weight: 500; }
`;
export class StatsBox {
    src;
    visible;
    el = document.createElement('div');
    last = 0;
    /** `className`: the page's class for its interface (hidden with it by the page's own toggle) */
    constructor(src, visible, className = 'stats-ui') {
        this.src = src;
        this.visible = visible;
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        this.el.id = 'stats-box';
        this.el.className = className;
        document.body.appendChild(this.el);
    }
    update(now) {
        const show = this.visible();
        this.el.style.display = show ? '' : 'none';
        if (!show || now - this.last < 250)
            return;
        this.last = now;
        const s = this.src;
        const mb = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(0)} MB`);
        const heap = performance.memory;
        const gpu = s.gpuMs();
        const lines = [
            `<b>${s.fps.toFixed(0).padStart(3)}</b> fps  ${s.ms.toFixed(1)} ms`,
            `gpu ${gpu > 0 ? `${gpu.toFixed(1)} ms` : '-'}  scale ${(s.scale() * 100).toFixed(0)}%`,
            `vram ~${mb(gpuMemory.bytes)}  (${gpuMemory.textures} tex, ${gpuMemory.buffers} buf)`,
            heap ? `heap ${mb(heap.usedJSHeapSize)} / ${mb(heap.jsHeapSizeLimit)}` : '',
            s.extra?.() ?? '',
        ].filter(Boolean);
        this.el.innerHTML = lines.join('\n');
    }
}
//# sourceMappingURL=stats.js.map