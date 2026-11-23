// A kit as far as declaring passes, draws and computes needs one, without a GPU: a stand-in device that counts the
// compiles it's asked for (`hold`: labels whose compiles wait for release(); `fail`: labels whose compiles fail),
// and keeps the warnings and errors reported. (pipelines.test.mjs carries its own, older copy.)
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
const { pipelinesOf, settle } = await import('../dist/src/passes.js');
const { defineShader } = await import('../dist/src/shader.js');
const { reflectWgsl } = await import('../dist/plugin/wgsl.js');

globalThis.GPUTextureView ??= class GPUTextureView {};
export const tick = () => new Promise((r) => setImmediate(r));
export const shader = (id, code) => defineShader({ id, label: id, code, files: [id], runs: [], reflect: reflectWgsl(code) });

export function fakeKit() {
  const compiled = [];
  const hold = new Set(), fail = new Set();
  let release;
  const held = new Promise((r) => { release = r; });
  const compile = (d) => {
    compiled.push(d);
    const p = { label: d.label };
    if (fail.has(d.label)) return Promise.reject(new Error(`${d.label} failed to compile`));
    return hold.has(d.label) ? held.then(() => p) : tick().then(() => p);
  };
  const device = {
    createBuffer: (d) => ({ ...d, destroy() {} }),
    createBindGroupLayout: (d) => ({ bgl: d.label }),
    createPipelineLayout: (d) => ({ layout: d.label }),
    createBindGroup: (d) => ({ bg: d.label }),
    createComputePipelineAsync: compile,
    createRenderPipelineAsync: compile,
    createComputePipeline: (d) => { compiled.push(d); return { label: d.label, now: true }; },
    createRenderPipeline: (d) => { compiled.push(d); return { label: d.label, now: true }; },
  };
  const samplers = { linear: { s: 'linear' }, nearest: { s: 'nearest' } };
  const bgls = new Map();
  const kit = {
    device, compiled, hold, fail, release, pipelines: [], pipelineCache: new Map(), compiler: null, sharedGroups: new Map(),
    frameLayout: { bgl: 'frame' }, nonFiltering: new WeakSet([samplers.nearest]), features: new Set(), format: 'bgra8unorm',
    resourceGen: 0, bindEpoch: 0, debug: false,
    /** as kit.errors: by `kind:label` */
    errors: new Map(),
    /** what was warned once: its keys in order, and each key's message */
    warned: [],
    warnings: new Map(),
    mainView: { group0: () => 'g0' },
    emptyGroup: { bg: 'empty' },
    queue: { writeBuffer() {} },
    bindGroupLayout(entries, label, key = JSON.stringify(entries)) {
      let l = bgls.get(key);
      if (!l) bgls.set(key, (l = device.createBindGroupLayout({ label, entries })));
      return l;
    },
    module: async (s) => ({ module: `${s.id}@${s.version}` }),
    moduleNow: (s) => ({ module: `${s.id}@${s.version}` }),
    report(kind, label, message) { this.errors.set(`${kind}:${label}`, { kind, label, message }); },
    clearError(label) { for (const [k, e] of this.errors) if (e.label === label) this.errors.delete(k); },
    warnOnce(key, message) { if (!this.warnings.has(key)) { this.warned.push(key); this.warnings.set(key, message); } },
    namedSampler: (n) => samplers[n],
    // (kit.ts's ready, which can't load here: its frame shader is a .wgsl import)
    ready: (...items) => settle(items.length ? () => pipelinesOf(items) : () => kit.pipelines),
  };
  return kit;
}

/** a pass or bundle encoder that writes each call down as `[call, ...what]` */
export const encoder = (into = []) => ({
  calls: into,
  setPipeline: (p) => into.push(['setPipeline', p.label]), setBindGroup() {}, setVertexBuffer() {}, setIndexBuffer() {},
  draw: (...a) => into.push(['draw', ...a]), drawIndexed: (...a) => into.push(['drawIndexed', ...a]),
  drawIndirect: (b, at) => into.push(['drawIndirect', at]), drawIndexedIndirect: (b, at) => into.push(['drawIndexedIndirect', at]),
  executeBundles() {}, finish: () => ({}),
});

export const TRI = `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i), 0.0, 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }`;
