// Tests for weft 0.2.14 foundation upgrades: warm pipeline LRU cache + module release, FrameGraph phase ordering
// and caching, phased RenderPass insertion, draw/compute tags & owner metadata, and sharedTypes .d.wgsl.ts output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

register('./hooks.mjs', import.meta.url);
const { Compute, RenderPass } = await import('../dist/src/passes.js');
const { FrameGraph } = await import('../dist/src/graph.js');
const { defineShader } = await import('../dist/src/shader.js');
const { StorageBuffer } = await import('../dist/src/resources.js');
const { reflectWgsl, compileWgsl, declaration } = await import('../dist/plugin/wgsl.js');

globalThis.GPUTextureView ??= class GPUTextureView {};
const tick = () => new Promise((r) => setImmediate(r));
const shader = (id, code) => defineShader({ id, label: id, code, files: [id], runs: [], reflect: reflectWgsl(code) });

const FILL = `
override GAIN: f32 = 1.0;
@group(1) @binding(0) var<storage, read_write> data: array<f32>;
@compute @workgroup_size(64) fn fill(@builtin(global_invocation_id) id: vec3u) { data[id.x] = f32(id.x) * GAIN; }`;

const QUAD = `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i), 0.0, 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }`;

function warmKit(warmLimit = 2) {
  const compiled = [];
  const modules = new Map();
  const warmPipelines = new Map();
  const pinnedPipelines = new Set();
  let warmHits = 0, warmEvictions = 0;
  const compile = (d) => { compiled.push(d); return tick().then(() => ({ label: d.label })); };
  const device = {
    createBuffer: (d) => ({ ...d, destroy() {} }),
    createBindGroupLayout: (d) => ({ bgl: d.label }),
    createPipelineLayout: (d) => ({ layout: d.label }),
    createComputePipelineAsync: compile,
    createRenderPipelineAsync: compile,
  };
  const bgls = new Map();
  const kit = {
    device, compiled, modules, warmPipelines, pinnedPipelines, warmLimit,
    pipelines: [], pipelineCache: new Map(), compiler: null, sharedGroups: new Map(),
    frameLayout: { bgl: 'frame' }, nonFiltering: new WeakSet(), features: new Set(), format: 'bgra8unorm',
    resourceGen: 0, bindEpoch: 0, errors: [],
    bindGroupLayout(entries, label, key = JSON.stringify(entries)) {
      let l = bgls.get(key);
      if (!l) bgls.set(key, (l = device.createBindGroupLayout({ label, entries })));
      return l;
    },
    async module(s) {
      let c = modules.get(s);
      if (!c || c.version !== s.version) { c = { version: s.version, raw: { mod: `${s.id}@${s.version}` } }; modules.set(s, c); }
      return c.raw;
    },
    takeWarmPipeline(key) {
      const e = warmPipelines.get(key);
      if (!e) return undefined;
      warmPipelines.delete(key);
      if (!e.pipeline || e.shaderVersion !== e.shader.version) { this.releaseModuleIfUnused(e.shader); return undefined; }
      warmHits++;
      return e;
    },
    retirePipeline(e) {
      if (e.pipeline && e.shaderVersion === e.shader.version && this.warmLimit > 0) {
        warmPipelines.delete(e.key);
        warmPipelines.set(e.key, e);
        this.trimWarmPipelines();
      } else {
        this.releaseModuleIfUnused(e.shader);
      }
    },
    trimWarmPipelines(limit = this.warmLimit) {
      for (const [k, e] of warmPipelines) {
        if (warmPipelines.size <= limit) break;
        if (pinnedPipelines.has(k)) continue;
        warmPipelines.delete(k);
        warmEvictions++;
        this.releaseModuleIfUnused(e.shader);
      }
    },
    releaseModuleIfUnused(s) {
      if (!modules.has(s)) return;
      for (const e of this.pipelineCache.values()) if (e.shader === s) return;
      for (const e of warmPipelines.values()) if (e.shader === s) return;
      for (const p of this.pipelines) if (p.shader === s) return;
      modules.delete(s);
    },
    stats: () => ({ warmHits, warmEvictions, warm: warmPipelines.size, modules: modules.size, active: kit.pipelineCache.size }),
    report() {}, clearError() {}, warnOnce() {}, namedSampler: () => undefined,
    ready: async () => { for (const p of [...kit.pipelines]) await p.pending; },
  };
  return kit;
}

test('warm pipeline LRU reuses evicted pipelines with 0 compiles, respects pins, and releases unused modules', async () => {
  const kit = warmKit(2);
  const s1 = shader('test/w1.wgsl', FILL);
  const s2 = shader('test/w2.wgsl', FILL);
  const s3 = shader('test/w3.wgsl', FILL);
  const mk = (s, label, owner) => new Compute(kit, s, { label, owner, tags: { hold: 'site' }, entry: 'fill', bind: { data: new StorageBuffer(kit, { size: 64 }) } });

  const c1 = mk(s1, 'c1', 'siteA');
  await kit.ready();
  assert.equal(kit.compiled.length, 1);
  assert.equal(c1.owner, 'siteA');
  assert.equal(c1.pipe.tags?.hold, 'site');
  const pipe1 = c1.pipe.pipeline;
  const key1 = c1.pipe.entry.key;

  // Dispose c1 -> moves to warm LRU (0 active, 1 warm, module retained)
  c1.dispose();
  assert.deepEqual(kit.stats(), { warmHits: 0, warmEvictions: 0, warm: 1, modules: 1, active: 0 });

  // Revisit siteA -> warm hit, 0 new compiles!
  const c1b = mk(s1, 'c1b', 'siteA');
  await kit.ready();
  assert.equal(kit.compiled.length, 1);
  assert.equal(c1b.pipe.pipeline, pipe1);
  assert.equal(kit.stats().warmHits, 1);

  // Pin s1's pipeline, retire s1, s2, s3 -> limit 2 evicts s2 (oldest unpinned) and drops s2's module
  kit.pinnedPipelines.add(key1);
  c1b.dispose();
  const c2 = mk(s2, 'c2', 'siteB');
  const c3 = mk(s3, 'c3', 'siteC');
  await kit.ready();
  c2.dispose();
  c3.dispose();
  assert.equal(kit.stats().warm, 2);
  assert.equal(kit.stats().warmEvictions, 1);
  assert.ok(kit.warmPipelines.has(key1), 'pinned s1 survives eviction');
  assert.ok(kit.modules.has(s1) && !kit.modules.has(s2) && kit.modules.has(s3), 'evicted s2 module released');
});

test('RenderPass phases insert draws in phase + order buckets regardless of declaration order', async () => {
  const kit = warmKit(0);
  const sh = shader('test/phased.wgsl', QUAD);
  const pass = new RenderPass(kit, {
    label: 'scene',
    color: [{ target: 'screen' }],
    phases: ['sky', 'opaque', 'water', 'translucent', 'skim'],
  });
  pass.draw(sh, { label: 'spray', phase: 'skim' });
  pass.draw(sh, { label: 'glass', blend: 'alpha' }); // inferred translucent
  pass.draw(sh, { label: 'sea', phase: 'water' });
  pass.draw(sh, { label: 'ground', phase: 'opaque', order: -10 });
  pass.draw(sh, { label: 'building' }); // inferred opaque (order 0)
  pass.draw(sh, { label: 'sky', phase: 'sky' });
  pass.draw(sh, { label: 'lateSite', phase: 'opaque', order: 5 });

  const warnings = [];
  kit.warnOnce = (k, m) => warnings.push([k, m]);
  const b = pass.bundle('city', { phase: 'opaque', order: -1, tags: { kind: 'city' }, owner: 'earth' });
  assert.equal(b.owner, 'earth');
  assert.equal(b.hasTag('kind', 'city'), true);
  assert.equal(b.hasTag('kind', 'sky'), false);
  pass.draw(sh, { label: 'typo', phase: 'doesNotExist' });
  assert.equal(warnings.length, 1);

  assert.deepEqual(
    pass.draws.map((d) => d.label),
    ['sky', 'ground', 'city', 'building', 'typo', 'lateSite', 'sea', 'glass', 'spray'],
  );
});

test('FrameGraph orders phases, caches entries until dirty, and gates/removes owners', () => {
  const g = new FrameGraph(['compute', 'shadow', 'scene', 'post']);
  const item = (label) => ({ label, encode() {} });
  const offPost = g.add('post', item('tone'), { owner: 'core' });
  g.add('scene', item('scene'), { owner: 'core' });
  g.add('compute', item('cullB'), { order: 10, owner: 'siteA' });
  g.add('compute', item('cullA'), { order: -5, owner: 'core' });
  g.add('shadow', item('sun0'), { owner: 'core' });

  const e1 = g.entries();
  const e2 = g.entries();
  assert.equal(e1, e2, 'cached array reused when clean');
  assert.deepEqual(e1.map((x) => x.label), ['cullA', 'cullB', 'sun0', 'scene', 'tone']);

  g.setOwnerEnabled('siteA', false);
  assert.deepEqual(g.entries().map((x) => x.label), ['cullA', 'sun0', 'scene', 'tone']);

  g.setOwnerEnabled('siteA', true);
  assert.deepEqual(g.entries().map((x) => x.label), ['cullA', 'cullB', 'sun0', 'scene', 'tone']);

  offPost();
  g.removeOwner('siteA');
  assert.deepEqual(g.entries().map((x) => x.label), ['cullA', 'sun0', 'scene']);
});

test('sharedTypes emits import type instead of duplicating included project structs in .d.wgsl.ts', () => {
  const root = mkdtempSync(join(tmpdir(), 'weft-shared-types-'));
  try {
    const worldWgsl = join(root, 'world.wgsl');
    const featWgsl = join(root, 'feat.wgsl');
    writeFileSync(worldWgsl, 'struct World { sun: vec4f, exposure: f32 }\n@group(0) @binding(1) var<uniform> world: World;\n');
    writeFileSync(featWgsl, '#include "./world.wgsl"\nstruct Local { tint: vec4f }\n@group(2) @binding(0) var<uniform> local: Local;\n@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i), world.exposure, local.tint.x, 1.0); }\n@fragment fn fs() -> @location(0) vec4f { return local.tint; }\n');

    const compiled = compileWgsl(featWgsl, { root, libs: {} });
    const inlineDts = declaration(compiled, '@ericrius1/weft', { file: featWgsl, root, sharedTypes: false });
    const sharedDts = declaration(compiled, '@ericrius1/weft', { file: featWgsl, root, sharedTypes: true });

    assert.match(inlineDts, /export interface World \{/);
    assert.doesNotMatch(sharedDts, /export interface World \{/);
    assert.match(sharedDts, /import type \{ World \} from '\.\/world\.wgsl';/);
    assert.match(sharedDts, /export type \{ World \};/);
    assert.match(sharedDts, /export interface Local \{/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
