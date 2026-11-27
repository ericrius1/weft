// Portable ShaderManifest emission (plugin/wgsl.ts + plugin/vite.ts): expanded WGSL, SHA-256, reflection structs/bindings,
// and line maps for native wgpu / tooling consumers. Run with `npm test` after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildShaderManifest, compileWgsl, manifestEntry } from '../dist/plugin/wgsl.js';
import { weft, weftShaders } from '../dist/plugin/vite.js';

function makeTempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'weft-manifest-'));
  writeFileSync(join(dir, 'common.wgsl'), `
struct SharedU {
  color: vec4f,
  unusedTail: vec4f,
}
fn helperTint(c: vec3f) -> vec3f { return c * 0.5; }
fn deadHelper(x: f32) -> f32 { return x + 1.0; }
`);
  writeFileSync(join(dir, 'a.wgsl'), `
#include "weft/frame"
#include "./common.wgsl"
@group(2) @binding(0) var<uniform> U: SharedU;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(0.0, 0.0, 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return vec4f(helperTint(U.color.rgb), 1.0); }
`);
  writeFileSync(join(dir, 'b.wgsl'), `
#include "./common.wgsl"
@group(2) @binding(0) var<uniform> U: SharedU;
@fragment fn fs() -> @location(0) vec4f { return U.color; }
`);
  return dir;
}

test('buildShaderManifest emits deterministic sorted entries with full reflection and lean WGSL', () => {
  const dir = makeTempProject();
  try {
    const m = buildShaderManifest(['b.wgsl', 'a.wgsl'], { root: dir, libs: { weft: weftShaders } });
    assert.equal(m.version, 1);
    assert.deepEqual(Object.keys(m.shaders), ['a.wgsl', 'b.wgsl']);

    const a = m.shaders['a.wgsl'];
    assert.equal(a.id, 'a.wgsl');
    assert.equal(a.label, 'a');
    assert.match(a.sha256, /^[0-9a-f]{16}$/);
    assert.ok(!a.code.includes('deadHelper'), 'lean code strips dead helpers');
    assert.ok(a.code.includes('helperTint'), 'lean code keeps reachable helpers');
    assert.ok(a.reflect.structs.SharedU, 'reflect preserves SharedU');
    assert.equal(a.reflect.structs.SharedU.size, 32, 'reflect preserves full canonical struct size even when lean trims uniform tail');
    assert.deepEqual(a.reflect.structs.SharedU.fields.map((f) => f.name), ['color', 'unusedTail']);
    assert.ok(a.reflect.structs.Frame, 'reflect includes weft/frame structs');
    assert.equal(a.reflect.bindings.U.group, 2);
    assert.equal(a.reflect.bindings.U.binding, 0);
    assert.ok(!('includes' in a), 'manifest entry omits build-only includes');
    assert.ok(!('structFiles' in a), 'manifest entry omits build-only structFiles');

    // Deterministic across runs
    const m2 = buildShaderManifest(['a.wgsl', 'b.wgsl'], { root: dir, libs: { weft: weftShaders } });
    assert.equal(JSON.stringify(m), JSON.stringify(m2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('manifestEntry sha256 changes when compiled code changes', () => {
  const dir = makeTempProject();
  try {
    const s1 = compileWgsl(join(dir, 'b.wgsl'), { root: dir, libs: { weft: weftShaders }, lean: true });
    const s2 = compileWgsl(join(dir, 'b.wgsl'), { root: dir, libs: { weft: weftShaders }, lean: false });
    const e1 = manifestEntry(s1);
    const e2 = manifestEntry(s2);
    assert.notEqual(e1.sha256, e2.sha256);
    assert.ok(e2.code.includes('deadHelper'), 'lean:false preserves full preprocessed code');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('weft vite plugin writes shaders.manifest.json on build closeBundle when manifest option is set', () => {
  const dir = makeTempProject();
  try {
    const outRel = 'out/shaders.manifest.json';
    const plugin = weft({ types: false, manifest: outRel });
    const cfg = { root: dir, command: 'build' };
    plugin.configResolved(cfg);
    plugin.buildStart();
    const ctx = { addWatchFile() {}, error(m) { throw new Error(m); }, warn() {} };
    plugin.load.call(ctx, join(dir, 'b.wgsl'));
    plugin.load.call(ctx, join(dir, 'a.wgsl'));
    plugin.closeBundle();

    const outAbs = join(dir, outRel);
    assert.ok(existsSync(outAbs), 'manifest file written');
    const parsed = JSON.parse(readFileSync(outAbs, 'utf8'));
    assert.equal(parsed.version, 1);
    assert.deepEqual(Object.keys(parsed.shaders), ['a.wgsl', 'b.wgsl']);
    assert.equal(parsed.shaders['a.wgsl'].reflect.structs.SharedU.size, 32);

    // Failed build (buildEnd or closeBundle error) must NOT overwrite the existing manifest
    plugin.buildStart();
    plugin.load.call(ctx, join(dir, 'a.wgsl'));
    plugin.buildEnd(new Error('synthetic build failure'));
    plugin.closeBundle();
    const afterBuildEndErr = JSON.parse(readFileSync(outAbs, 'utf8'));
    assert.deepEqual(Object.keys(afterBuildEndErr.shaders), ['a.wgsl', 'b.wgsl'], 'buildEnd error preserves prior manifest');

    plugin.buildStart();
    plugin.load.call(ctx, join(dir, 'a.wgsl'));
    plugin.closeBundle(new Error('synthetic closeBundle failure'));
    const afterCloseErr = JSON.parse(readFileSync(outAbs, 'utf8'));
    assert.deepEqual(Object.keys(afterCloseErr.shaders), ['a.wgsl', 'b.wgsl'], 'closeBundle error preserves prior manifest');

    // Successful build with zero shaders overwrites stale manifest with empty shaders map
    plugin.buildStart();
    plugin.buildEnd();
    plugin.closeBundle();
    const afterEmpty = JSON.parse(readFileSync(outAbs, 'utf8'));
    assert.deepEqual(afterEmpty, { version: 1, shaders: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('weft vite plugin writes nothing when manifest option is omitted and matches buildShaderManifest key order', () => {
  const dir = makeTempProject();
  try {
    for (const name of ['B.wgsl', 'a-b.wgsl', 'a_b.wgsl']) {
      writeFileSync(join(dir, name), '@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }\n');
    }
    const files = ['B.wgsl', 'a.wgsl', 'a-b.wgsl', 'a_b.wgsl'];
    const offline = buildShaderManifest(files, { root: dir, libs: { weft: weftShaders } });

    const outRel = 'out/order.json';
    const withManifest = weft({ types: false, manifest: outRel });
    withManifest.configResolved({ root: dir, command: 'build' });
    withManifest.buildStart();
    const ctx = { addWatchFile() {}, error(m) { throw new Error(m); }, warn() {} };
    for (const f of files) withManifest.load.call(ctx, join(dir, f));
    withManifest.buildEnd();
    withManifest.closeBundle();
    const fromPlugin = JSON.parse(readFileSync(join(dir, outRel), 'utf8'));
    assert.deepEqual(Object.keys(fromPlugin.shaders), Object.keys(offline.shaders));
    assert.deepEqual(Object.keys(offline.shaders), ['B.wgsl', 'a-b.wgsl', 'a.wgsl', 'a_b.wgsl']);

    // Default (no manifest option) writes nothing
    const noManifest = weft({ types: false });
    noManifest.configResolved({ root: dir, command: 'build' });
    noManifest.buildStart();
    noManifest.load.call(ctx, join(dir, 'a.wgsl'));
    noManifest.buildEnd();
    noManifest.closeBundle();
    assert.ok(!existsSync(join(dir, 'shaders.manifest.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
