// weft checks: what 0.2 fixed and added, exercised in the browser. Each check prints a line here and lands in
// window.__checks; a few small kits each own a canvas. The compile-info stall goes last (it stalls every new module
// on the page for its few seconds). window.__probe gives where the SDR and HDR canvases sit, both filled with the same
// mid grey, for a screenshot to compare.
import { createKit, Capture, Draw, MipChain, Painter, type Compiler, type Kit, type AnyPipelineRecord } from '@ericrius1/weft';
import checks from './checks.wgsl';
import shared from './checkshared.wgsl';
import post from './post.wgsl';

const lines: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  lines.push({ name, ok, detail });
  document.getElementById('out')!.textContent = lines.map((l) => `${l.ok ? 'ok  ' : 'FAIL'} ${l.name}${l.detail ? ` — ${l.detail}` : ''}`).join('\n');
};
const warnings: string[] = [];
const warn = console.warn.bind(console);
console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(' ')); warn(...a); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let left = 8;
const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.style.cssText = `left:${left}px;top:8px;width:${w}px;height:${h}px`;
  left += w + 8;
  document.body.appendChild(c);
  return c;
};
const frames = async (kit: Kit, n: number) => {
  for (let i = 0; i < n; i++) { kit.step(1 / 60); await kit.device.queue.onSubmittedWorkDone(); }
};
const rgba = (bytes: ArrayBuffer, w: number, x: number, y: number) => [...new Uint8Array(bytes, (y * w + x) * 4, 4)];
const near = (a: number[], b: number[], tol = 3) => b.every((v, i) => Math.abs(a[i] - v) <= tol);
const errorsOf = (kit: Kit) => [...kit.errors.values()].map((e) => `${e.kind} ${e.label}: ${e.message.split('\n')[0]}`);

// ---- a shared group 1 and 3 beside per-draw group 1 (the lab's tonemap) and weft's own group-3 shaders
const kit = await createKit(canvas(256, 128));
const tint = kit.uniforms(shared.structs.Tint).set({ color: [1, 0.5, 0.25, 1] });
const white = kit.texture({ label: 'white', format: 'rgba8unorm', size: [4, 4] }).write(new Uint8Array(64).fill(255));
kit.shareGroup(1, shared, { envTint: tint });
kit.shareGroup(3, shared, { tint, tintTex: white });
const hdr = kit.texture({ label: 'hdr', format: 'rgba16float', size: 'render', mips: 'full' });
const scene = kit.pass({ label: 'scene', color: [{ target: hdr, clear: [0, 0, 0, 1] }] });
scene.fullscreen(checks, { label: 'shared3', fragment: 'fs_shared' });
const mips = new MipChain(kit, hdr);
const painter = new Painter(kit, { width: 64, height: 16, label: 'hud' });
const out = kit.pass({ label: 'out', color: [{ target: 'screen', clear: [0, 0, 0, 1] }] });
out.fullscreen(post, { bind: { post: kit.uniforms(post.structs.Post).set({ exposure: 1, vignette: 0 }), hdr } });
// ---- alpha to coverage asked of a one-sample pass, and of a multisampled one
const fill = (color: number[], rect = [-1, -1, 1, 1]) => kit.uniforms(checks.structs.Fill).set({ color, rect });
const a2c = scene.fullscreen(checks, { label: 'a2c.single', fragment: 'fs', bind: { fill: fill([0, 0, 0, 0]) }, alphaToCoverage: true, blend: 'alpha' });
const ms = kit.texture({ label: 'ms', format: 'rgba8unorm', size: [16, 16], samples: 4 });
const msOut = kit.texture({ label: 'ms.resolved', format: 'rgba8unorm', size: [16, 16] });
const msPass = kit.pass({ label: 'ms', color: [{ target: ms, resolve: msOut, clear: [0, 0, 0, 1] }] });
const a2cMs = msPass.fullscreen(checks, { label: 'a2c.ms', fragment: 'fs', bind: { fill: fill([1, 1, 1, 0.5]) }, alphaToCoverage: true });
const r0 = await kit.ready();
kit.loop(() => {
  painter.begin().text('weft', 2, 2);
  painter.end();
  kit.run([scene, mips, painter.pass, msPass, out]);
});
kit.manual = true;
await frames(kit, 4);
check('shared groups 1 and 3 beside per-draw group 1 and weft group-3 shaders', !r0.failed && !kit.errors.size, `${r0.pipelines} pipelines, ${r0.failed} failed${kit.errors.size ? `; ${errorsOf(kit).join('; ')}` : ''}`);
check('alpha to coverage in a one-sample pass: built without it, warned once', !!a2c.pipe.pipeline && !a2c.pipe.error && warnings.filter((w) => w.includes('a2c.single')).length === 1);
check('alpha to coverage in a 4-sample pass: kept', !!a2cMs.pipe.pipeline && !warnings.some((w) => w.includes('a2c.ms')));

// ---- the texture viewer on group 3 while the app shares group 3 (it used to throw in endFrame and stop the loop)
(kit.overlay as unknown as { viewer: { tex: unknown } }).viewer.tex = hdr;
kit.overlay.open = true;
const f0 = kit.frameIndex;
await frames(kit, 3);
kit.overlay.open = false;
check('texture viewer beside a shared group 3', kit.frameIndex === f0 + 3 && !kit.errors.size, errorsOf(kit).join('; '));

// ---- the frame group is made once, again only when the globals change
const g0 = kit.mainView.group0();
await frames(kit, 2);
const same = kit.mainView.group0() === g0;
kit.setGlobals(kit.uniforms(checks.structs.Fill));
check('View.group0 memoised, remade for new globals', same && kit.mainView.group0() !== g0);

// ---- profiler raw samples
if (kit.profiler.available) {
  kit.profiler.force = true;
  for (let i = 0; i < 60 && !kit.profiler.serial; i++) { await frames(kit, 1); await sleep(10); }
  const p = kit.profiler;
  check('profiler raw samples', p.serial > 0 && p.lastFrameMs > 0 && p.lastMs.has('scene'), `serial ${p.serial}, lastFrameMs ${p.lastFrameMs.toFixed(3)}, passes ${[...p.lastMs.keys()].join(' ')}`);
  kit.profiler.force = false;
} else check('profiler raw samples', true, 'skipped: no timestamp-query here');

// ---- bundles: four quads baked once; what re-records them, what doesn't
const W = 32;
const target = kit.texture({ label: 'bundle.target', format: 'rgba8unorm', size: [W, W] });
const probe = kit.texture({ label: 'probe', format: 'r8unorm', size: 'render', usage: ['sample', 'render', 'copy-dst'] });
const bpass = kit.pass({ label: 'bundled', color: [{ target, clear: [0, 0, 0, 1] }] });
const bundle = bpass.bundle('quads');
const quad = (i: number, color: number[]) => fill(color, [i & 1 ? 0 : -1, i & 2 ? 0 : -1, i & 1 ? 1 : 0, i & 2 ? 1 : 0]);
let lit = true;
const quads = [
  bundle.draw(checks, { label: 'q0', vertex: 'vs_rect', fragment: 'fs', bind: { fill: quad(0, [1, 0, 0, 1]) }, count: 6, cull: 'none' }),
  bundle.draw(checks, { label: 'q1', vertex: 'vs_rect', fragment: 'fs', bind: { fill: quad(1, [0, 1, 0, 1]) }, count: 6, cull: 'none' }),
  bundle.draw(checks, { label: 'q2', vertex: 'vs_rect', fragment: 'fs', bind: { fill: quad(2, [0, 0, 1, 1]) }, count: 6, cull: 'none', enabled: () => lit }),
];
const probeFill = quad(3, [1, 1, 1, 1]);
quads.push(bundle.draw(checks, { label: 'q3', vertex: 'vs_rect', fragment: 'fs_probe', bind: { fill: probeFill, probe }, count: 6, cull: 'none' }));
probe.write(new Uint8Array(probe.width * probe.height).fill(255), { bytesPerRow: probe.width });
// (the quads' corners in the target, y down: q0 bottom-left, q1 bottom-right, q2 top-left, q3 top-right)
const corners = { q0: [4, W - 4], q1: [W - 4, W - 4], q2: [4, 4], q3: [W - 4, 4] };
const pixels = async () => {
  kit.run([bpass]);
  const px = await target.read();
  return Object.fromEntries(Object.entries(corners).map(([k, [x, y]]) => [k, rgba(px, W, x, y)])) as Record<keyof typeof corners, number[]>;
};
await kit.ready();
let px = await pixels();
await pixels();
const rec = () => bundle.records;
check('bundle draws its quads, recorded once', rec() === 1 && near(px.q0, [255, 0, 0, 255]) && near(px.q1, [0, 255, 0, 255]) && near(px.q2, [0, 0, 255, 255]) && near(px.q3, [255, 255, 255, 255]),
  `records ${rec()}, ${JSON.stringify(px)}`);
quads[0].set('fill', quad(0, [1, 1, 0, 1]));
px = await pixels();
check('draw.set re-records', rec() === 2 && near(px.q0, [255, 255, 0, 255]), `records ${rec()}, q0 ${px.q0}`);
quads[1].enabled = false;
px = await pixels();
check('enabled = false re-records', rec() === 3 && near(px.q1, [0, 0, 0, 255]), `records ${rec()}, q1 ${px.q1}`);
lit = false;
px = await pixels();
check('a function option is asked each frame', rec() === 4 && near(px.q2, [0, 0, 0, 255]), `records ${rec()}, q2 ${px.q2}`);
const grown = kit.storage({ label: 'unrelated', size: 64 });
grown.ensure(1 << 16);
px = await pixels();
check('an unrelated reallocation: checked, not re-recorded', rec() === 4, `records ${rec()}`);
kit.renderScale = 0.5;
kit.step(1 / 60);
probe.write(new Uint8Array(probe.width * probe.height).fill(128), { bytesPerRow: probe.width });
px = await pixels();
// (128 of 255 is linear 0.502, sRGB 0.735: 188)
check('a resize reallocating a bundled binding re-records', rec() === 5 && near(px.q3, [188, 188, 188, 255], 4), `records ${rec()}, probe ${probe.width}×${probe.height}, q3 ${px.q3}`);
const late = bundle.draw(checks, { label: 'late', vertex: 'vs_rect', fragment: 'fs', bind: { fill: quad(2, [1, 0, 1, 1]) }, count: 6, cull: 'none' });
px = await pixels();
const before = px.q2;
await kit.ready();
px = await pixels();
check('a pipeline landing after the recording re-records', near(px.q2, [255, 0, 255, 255]), `before it landed ${before}, after ${px.q2}, records ${rec()}`);
const pipes = kit.pipelines.length, recs = rec();
late.dispose();
px = await pixels();
check('dispose re-records and lets the pipeline go', rec() === recs + 1 && kit.pipelines.length === pipes - 1 && near(px.q2, [0, 0, 0, 255]), `records ${rec()}, pipelines ${pipes} → ${kit.pipelines.length}`);
check('bundles: no errors', !kit.errors.size, errorsOf(kit).join('; '));

// ---- release: a destroyed render-sized texture stays gone through a resize; the memory tally follows
const gone = kit.texture({ label: 'gone', format: 'rgba16float', size: 'render' });
const mem0 = kit.memory(), bytes = gone.bytes, v0 = gone.version;
gone.destroy();
const mem1 = kit.memory();
kit.renderScale = 1;
const u = kit.uniforms(checks.structs.Fill);
u.destroy();
const view = kit.view();
view.dispose();
await frames(kit, 2);
check('release: destroyed texture not reallocated by a resize', !kit.textures.has(gone) && gone.version === v0 && mem0.textures - mem1.textures === bytes, `${bytes} bytes freed, version ${v0} → ${gone.version}`);
check('release: destroyed uniforms and disposed views leave the kit', !kit.uniformBuffers.has(u) && !kit.views.includes(view) && !kit.errors.size, errorsOf(kit).join('; '));

// ---- the compile scheduler: a deferred pipeline made on the spot when its draw is first encoded
const ks = await createKit(canvas(32, 32));
const parked = new Map<AnyPipelineRecord, (p: unknown) => void>();
const compiler: Compiler = {
  holding: true,
  compile: (rec) => new Promise((res) => parked.set(rec, res)),
  now(rec) {
    const m = ks.moduleNow(rec.shader);
    if (!m || !rec.makeNow || rec._pipe) return;
    const p = rec.makeNow(m);
    rec.deferred = false;
    rec.pipeline = p;
    parked.get(rec)?.(p);
  },
};
ks.compiler = compiler;
const st = ks.texture({ label: 'sched', format: 'rgba8unorm', size: [8, 8] });
const sp = ks.pass({ label: 'sched', color: [{ target: st, clear: [0, 0, 0, 1] }] });
const sd = sp.fullscreen(checks, { fragment: 'fs', bind: { fill: ks.uniforms(checks.structs.Fill).set({ color: [0, 1, 1, 1] }) } });
const t0 = performance.now();
await ks.ready();
const waited = performance.now() - t0, deferred = sd.pipe.deferred && !sd.pipe._pipe;
ks.loop(() => ks.run([sp]));
ks.manual = true;
await frames(ks, 1);
const sched = rgba(await st.read(), 8, 4, 4);
check('compile scheduler: deferred, ready() not held, made on the spot', (Draw as unknown as { scheduled: boolean }).scheduled && deferred && waited < 200 && !!sd.pipe._pipe && near(sched, [0, 255, 255, 255]),
  `ready in ${waited.toFixed(0)} ms, pixel ${sched}`);

// ---- the rAF loop survives a throwing beginFrame, endFrame and overlay
const kl = await createKit(canvas(32, 32));
const lp = kl.pass({ label: 'loop', color: [{ target: 'screen', clear: [0, 0, 0, 1] }] });
lp.fullscreen(checks, { fragment: 'fs', bind: { fill: kl.uniforms(checks.structs.Fill).set({ color: [0.2, 0.2, 0.2, 1] }) } });
await kl.ready();
kl.loop(() => kl.run([lp]));
const moved = async (ms: number) => { const f = kl.frameIndex; await sleep(ms); return kl.frameIndex - f; };
const k = kl as unknown as { applySize: () => boolean; profiler: { endFrame: () => void } };
const n0 = await moved(250);
const endFrame = k.profiler.endFrame;
k.profiler.endFrame = () => { throw new Error('profiler boom'); };
const n1 = await moved(250);
k.profiler.endFrame = endFrame;
const applySize = k.applySize;
k.applySize = () => { throw new Error('resize boom'); };
const n2 = await moved(250);
k.applySize = applySize;
const overlayFrame = kl.overlay.frame;
kl.overlay.frame = () => { throw new Error('overlay boom'); };
const n3 = await moved(250);
kl.overlay.frame = overlayFrame;
const reported = errorsOf(kl);
check('rAF loop survives a throwing endFrame, beginFrame and overlay', [n0, n1, n2, n3].every((n) => n > 3) && reported.length === 3 && reported.every((r) => r.startsWith('frame')),
  `frames ${n0}/${n1}/${n2}/${n3}; ${reported.join(' | ')}`);
kl.manual = true;

// ---- an HDR canvas (forced past the display check) beside an SDR one, each a mid grey (left) and an orange (right)
// through canvasEncode: both read back alike, and a page screenshot shows them alike
const kh = await createKit(canvas(64, 64), { hdr: 'force' });
const kd = await createKit(canvas(64, 64));
const swatches = await Promise.all([kd, kh].map(async (kk) => {
  const p = kk.pass({ label: 'swatches', color: [{ target: 'screen', clear: [0, 0, 0, 1] }] });
  const constants = { P3: kk.hdr.colorSpace === 'display-p3' ? 1 : 0 };
  // (linear 0.214 is sRGB 0.5)
  for (const [color, rect] of [[[0.214, 0.214, 0.214, 1], [-1, -1, 0, 1]], [[0.5, 0.25, 0.1, 1], [0, -1, 1, 1]]]) {
    p.draw(checks, { vertex: 'vs_rect', fragment: 'fs', bind: { fill: kk.uniforms(checks.structs.Fill).set({ color, rect }) }, count: 6, cull: 'none', constants });
  }
  await kk.ready();
  kk.loop(() => kk.run([p]));
  kk.manual = true;
  const img = await new Capture(kk).step(1 / 60);
  return [[...img.data.slice((32 * 64 + 16) * 4, (32 * 64 + 16) * 4 + 4)], [...img.data.slice((32 * 64 + 48) * 4, (32 * 64 + 48) * 4 + 4)]];
}));
check('HDR canvas', true, `hdr ${JSON.stringify(kh.hdr)}; sdr ${kd.format}`);
check('HDR capture reads back what an SDR canvas does', swatches[0].every((s, i) => near(s, swatches[1][i], 2)) && near(swatches[0][0], [128, 128, 128, 255], 2),
  `sdr ${swatches[0].join(' / ')}, hdr ${swatches[1].join(' / ')}`);
const at = (c: HTMLCanvasElement, x: number) => { const r = c.getBoundingClientRect(); return [Math.round(r.left + x), Math.round(r.top + 32)]; };
Object.assign(window, { __probe: { sdrGrey: at(kd.canvas, 16), sdrOrange: at(kd.canvas, 48), hdrGrey: at(kh.canvas, 16), hdrOrange: at(kh.canvas, 48) } });

// ---- a module whose compile info never comes doesn't hold kit.ready() (last: it stalls every module made meanwhile)
const proto = GPUShaderModule.prototype, info = proto.getCompilationInfo;
proto.getCompilationInfo = () => new Promise<GPUCompilationInfo>(() => {});
const kc = await createKit(canvas(8, 8));
const cp = kc.pass({ color: [{ target: kc.texture({ format: 'rgba8unorm', size: [8, 8] }), clear: [0, 0, 0, 1] }] });
const cd = cp.fullscreen(checks, { fragment: 'fs', bind: { fill: kc.uniforms(checks.structs.Fill) } });
const t1 = performance.now();
await kc.ready();
const stalled = performance.now() - t1;
proto.getCompilationInfo = info;
check('compile info that never comes: ready() after the 4 s wait', stalled > 3500 && stalled < 7000 && !!cd.pipe.pipeline && warnings.some((w) => w.includes('no compile info')), `${(stalled / 1000).toFixed(1)} s`);

Object.assign(window, { __checks: { passed: lines.filter((l) => l.ok).length, failed: lines.filter((l) => !l.ok).length, lines } });
