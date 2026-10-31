import { TexView, isDepthFormat } from './resources';
import viewerShader from '../shaders/viewer.wgsl';
const css = `
.weft-ov{position:fixed;top:8px;left:8px;z-index:99999;max-height:calc(100vh - 16px);overflow:auto;width:340px;
  font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:#dfe6ee;background:rgba(12,14,20,.86);
  border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px;backdrop-filter:blur(6px);user-select:none}
.weft-ov h4{margin:8px 0 4px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8fa3b8;font-weight:600}
.weft-ov table{width:100%;border-collapse:collapse}.weft-ov td{padding:1px 2px;white-space:nowrap}
.weft-ov td.n{text-align:right;color:#9fd3ff}.weft-ov tr.off td{opacity:.4}
.weft-ov input[type=range]{width:120px;height:12px;vertical-align:middle}
.weft-ov select,.weft-ov button{font:inherit;background:#232833;color:#dfe6ee;border:1px solid #3a4150;border-radius:4px;padding:1px 4px}
.weft-ov .row{display:flex;gap:6px;align-items:center;margin:2px 0}.weft-ov .row span.k{flex:1;overflow:hidden;text-overflow:ellipsis}
.weft-err{position:fixed;left:8px;bottom:8px;z-index:99999;max-width:min(860px,calc(100vw - 16px));max-height:45vh;overflow:auto;
  font:11px/1.4 ui-monospace,Menlo,monospace;color:#ffd9d9;background:rgba(60,8,12,.92);border:1px solid #ff6b6b;
  border-radius:8px;padding:8px 10px;white-space:pre-wrap}
.weft-err b{color:#fff}.weft-err button{float:right;font:inherit;background:none;color:#fff;border:0;cursor:pointer}`;
export class DebugOverlay {
    kit;
    open = false;
    root = null;
    errBox = null;
    disabled = new Set();
    lastUpdate = 0;
    cpuMs = 16;
    lastFrame = performance.now();
    tweaks = [];
    stats = [];
    viewer = { tex: null, mip: 0, layer: 0, lo: 0, hi: 1, channel: 0, size: 0.32 };
    viewerPass = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    viewerDraws = {};
    viewerU = null;
    errorsDismissed = false;
    constructor(kit) {
        this.kit = kit;
        if (kit.debug)
            this.open = true;
        addEventListener('keydown', (e) => {
            if (e.code === 'Backquote' && !e.repeat) {
                this.open = !this.open;
                this.render();
            }
        });
        queueMicrotask(() => this.render());
    }
    isEnabled(label) { return !this.disabled.has(label); }
    get viewerActive() { return this.open && !!this.viewer.tex; }
    /** a uniform buffer whose annotated fields get sliders */
    tweak(u, label = u.label) { this.tweaks.push({ u, label }); this.render(); }
    /** a custom line in the stats block */
    stat(name, fn) { this.stats.push({ name, fn }); }
    frame(ran) {
        const now = performance.now();
        this.cpuMs = this.cpuMs * 0.9 + (now - this.lastFrame) * 0.1;
        this.lastFrame = now;
        if (!this.open || !this.root || now - this.lastUpdate < 250)
            return;
        this.lastUpdate = now;
        this.updateLive(ran);
    }
    errorsChanged() {
        this.errorsDismissed = false;
        this.renderErrors();
    }
    renderErrors() {
        const errs = [...this.kit.errors.values()];
        if (!errs.length || this.errorsDismissed) {
            this.errBox?.remove();
            this.errBox = null;
            return;
        }
        if (!this.errBox) {
            this.ensureStyle();
            this.errBox = document.createElement('div');
            this.errBox.className = 'weft-err';
            document.body.appendChild(this.errBox);
        }
        const prod = import.meta.env?.PROD;
        if (prod && !this.open) {
            this.errBox.textContent = `⚠ ${errs.length} GPU error${errs.length > 1 ? 's' : ''} — press \` for details`;
            return;
        }
        this.errBox.innerHTML = '<button title="dismiss">✕</button>' + errs.map((e) => `<b>${esc(e.kind)} · ${esc(e.label)}</b>\n${esc(e.message)}`).join('\n\n');
        this.errBox.querySelector('button').onclick = () => { this.errorsDismissed = true; this.renderErrors(); };
    }
    ensureStyle() {
        if (document.getElementById('weft-css'))
            return;
        const s = document.createElement('style');
        s.id = 'weft-css';
        s.textContent = css;
        document.head.appendChild(s);
    }
    render() {
        this.renderErrors();
        if (!this.open) {
            this.root?.remove();
            this.root = null;
            return;
        }
        this.ensureStyle();
        if (!this.root) {
            this.root = document.createElement('div');
            this.root.className = 'weft-ov';
            document.body.appendChild(this.root);
            this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
            this.root.addEventListener('keydown', (e) => e.stopPropagation());
        }
        const r = this.root;
        r.innerHTML = `<div class="row"><b>weft</b><span class="k"></span><span id="wo-stats"></span></div>
      <div class="row"><span id="wo-mem"></span></div>
      <div id="wo-custom"></div>
      <h4>passes <span style="text-transform:none;font-weight:400">(click to switch off)</span></h4><table id="wo-passes"></table>
      <h4>pipelines</h4><div id="wo-pipes"></div>
      <h4>texture viewer</h4><div class="row"><select id="wo-tex"><option value="">—</option></select>
        <select id="wo-ch"><option value="0">rgb</option><option value="1">r</option><option value="2">g</option><option value="3">b</option><option value="4">a</option></select></div>
      <div class="row">range <input id="wo-lo" type="number" step="0.1" value="${this.viewer.lo}" style="width:54px"> <input id="wo-hi" type="number" step="0.1" value="${this.viewer.hi}" style="width:54px"> mip <input id="wo-mip" type="number" min="0" value="${this.viewer.mip}" style="width:36px"></div>
      <div id="wo-tweaks"></div>`;
        const sel = r.querySelector('#wo-tex');
        const texs = [...this.kit.textures].filter((t) => t.samples === 1 && (t.desc.dimension ?? '2d') === '2d');
        texs.forEach((t, i) => {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = `${t.label} ${t.width}×${t.height} ${t.format}`;
            if (t === this.viewer.tex)
                o.selected = true;
            sel.appendChild(o);
        });
        sel.onchange = () => { this.viewer.tex = sel.value === '' ? null : texs[Number(sel.value)]; this.viewer.mip = 0; };
        const ch = r.querySelector('#wo-ch');
        ch.value = String(this.viewer.channel);
        ch.onchange = () => { this.viewer.channel = Number(ch.value); };
        const num = (id, k) => {
            const el = r.querySelector(id);
            el.oninput = () => { this.viewer[k] = Number(el.value); };
        };
        num('#wo-lo', 'lo');
        num('#wo-hi', 'hi');
        num('#wo-mip', 'mip');
        this.renderTweaks(r.querySelector('#wo-tweaks'));
        this.updateLive([]);
    }
    updateLive(ran) {
        const r = this.root;
        const p = this.kit.profiler;
        const s = this.kit.size;
        const mem = this.kit.memory();
        r.querySelector('#wo-stats').textContent = `${(1000 / this.cpuMs).toFixed(0)} fps · cpu ${this.cpuMs.toFixed(1)} · gpu ${p.available ? p.frameMs.toFixed(2) : 'n/a'} ms · ${s.render[0]}×${s.render[1]}`;
        r.querySelector('#wo-mem').textContent = `gpu memory ${mb(mem.total)} (textures ${mb(mem.textures)}, buffers ${mb(mem.buffers)})`;
        const stat = (fn) => { try {
            return fn();
        }
        catch (e) {
            return `⚠ ${e.message}`;
        } };
        r.querySelector('#wo-custom').innerHTML = this.stats.map((x) => `<div class="row"><span class="k">${esc(x.name)}</span><span>${esc(stat(x.fn))}</span></div>`).join('');
        const names = [...new Set([...ran, ...this.disabled])];
        if (ran.length) {
            const t = r.querySelector('#wo-passes');
            t.innerHTML = names.map((n) => `<tr data-n="${esc(n)}" class="${this.disabled.has(n) ? 'off' : ''}" style="cursor:pointer"><td>${this.disabled.has(n) ? '☐' : '☑'} ${esc(n)}</td><td class="n">${p.ms.has(n) && !this.disabled.has(n) ? p.ms.get(n).toFixed(2) : ''}</td></tr>`).join('');
            t.querySelectorAll('tr').forEach((tr) => {
                tr.onclick = () => {
                    const n = tr.dataset.n;
                    if (this.disabled.has(n))
                        this.disabled.delete(n);
                    else
                        this.disabled.add(n);
                };
            });
        }
        const pipes = this.kit.pipelines;
        const failed = pipes.filter((x) => x.error).length;
        const slow = [...pipes].sort((a, b) => b.ms - a.ms).slice(0, 4);
        r.querySelector('#wo-pipes').innerHTML = `${pipes.length} pipelines${failed ? `, <b style="color:#ff8a8a">${failed} failed</b>` : ''} · slowest: ` +
            slow.map((x) => `${esc(x.label)} ${x.ms.toFixed(0)}ms`).join(', ');
    }
    renderTweaks(el) {
        el.innerHTML = '';
        for (const { u, label } of this.tweaks) {
            const fields = u.def.fields.filter((f) => f.range || f.color);
            if (!fields.length)
                continue;
            const h = document.createElement('h4');
            h.textContent = label;
            el.appendChild(h);
            for (const f of fields) {
                const cur = u.get(f.name);
                const comps = Array.isArray(cur) ? cur : [cur];
                if (f.color) {
                    const row = document.createElement('div');
                    row.className = 'row';
                    row.innerHTML = `<span class="k">${esc(f.name)}</span>`;
                    const inp = document.createElement('input');
                    inp.type = 'color';
                    inp.value = '#' + comps.slice(0, 3).map((c) => Math.round(Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2) * 255).toString(16).padStart(2, '0')).join('');
                    inp.oninput = () => {
                        const hex = inp.value.slice(1);
                        const rgb = [0, 2, 4].map((i) => Math.pow(parseInt(hex.slice(i, i + 2), 16) / 255, 2.2));
                        u.set({ [f.name]: rgb });
                    };
                    row.appendChild(inp);
                    el.appendChild(row);
                    continue;
                }
                const [lo, hi, step] = f.range;
                comps.forEach((c, i) => {
                    const row = document.createElement('div');
                    row.className = 'row';
                    row.innerHTML = `<span class="k">${esc(f.name)}${comps.length > 1 ? '.' + 'xyzw'[i] : ''}</span>`;
                    const inp = document.createElement('input');
                    inp.type = 'range';
                    inp.min = String(lo);
                    inp.max = String(hi);
                    inp.step = String(step ?? (hi - lo) / 200);
                    inp.value = String(c);
                    const out = document.createElement('span');
                    out.textContent = Number(c).toFixed(3);
                    inp.oninput = () => {
                        const v = Number(inp.value);
                        out.textContent = v.toFixed(3);
                        if (comps.length > 1) {
                            const arr = u.get(f.name).slice();
                            arr[i] = v;
                            u.set({ [f.name]: arr });
                        }
                        else
                            u.set({ [f.name]: v });
                    };
                    row.append(inp, out);
                    el.appendChild(row);
                });
            }
        }
    }
    // ------------------------------------------------------------ texture viewer
    /** draws the chosen texture over the frame (a texture it can't show is reported and let go) */
    encodeViewer(enc) {
        const t = this.viewer.tex;
        if (!t)
            return;
        if (t.destroyed) {
            this.viewer.tex = null;
            return;
        }
        try {
            this.viewTexture(enc, t);
        }
        catch (e) {
            this.kit.report('viewer', t.label, e.message);
            this.viewer.tex = null;
        }
    }
    viewTexture(enc, t) {
        const kind = isDepthFormat(t.format) ? 'depth' : /uint/.test(t.format) ? 'uint' : 'float';
        if (!this.viewerPass) {
            const k = this.kit;
            this.viewerU = k.uniforms(viewerShader.structs.Viewer, 'weft.viewer');
            this.viewerPass = k.pass({
                label: 'weft.viewer', color: [{ target: 'screen', clear: false }],
                viewport: () => {
                    const [w, h] = k.size.canvas;
                    const vw = Math.round(w * this.viewer.size);
                    const vh = Math.round(vw * (this.viewer.tex ? this.viewer.tex.height / this.viewer.tex.width : 1));
                    return [w - vw - 8, h - vh - 8, vw, vh];
                },
            });
        }
        const src = t.layers > 1 ? t.layer(0) : t;
        const mip = Math.min(this.viewer.mip, t.mips - 1);
        const bindName = kind === 'depth' ? 'dtex' : kind === 'uint' ? 'utex' : 'tex';
        // (one draw per binding class: an r32float texture needs an unfilterable layout, depth a depth layout…)
        const key = kind + (t.unfilterable ? '-u' : '');
        let d = this.viewerDraws[key];
        const value = src instanceof TexView ? src : mip > 0 ? new TexView(t, { baseMipLevel: 0, mipLevelCount: t.mips }) : t;
        if (!d) {
            d = this.viewerPass.fullscreen(viewerShader, { label: 'weft.viewer.' + key, fragment: 'fs_' + kind, bind: { viewer: this.viewerU, [bindName]: value } });
            this.viewerDraws[key] = d;
        }
        else
            d.set(bindName, value);
        for (const [k, dd] of Object.entries(this.viewerDraws))
            dd.enabled = k === key;
        this.viewerU.set({ lo: this.viewer.lo, hi: this.viewer.hi, channel: this.viewer.channel, mip });
        this.viewerU.upload();
        if (!d.pipe.pipeline)
            return;
        this.viewerPass.encode(enc);
    }
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
//# sourceMappingURL=debug.js.map