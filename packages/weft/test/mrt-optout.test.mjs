import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapFragmentZeroLocation, shaderWithZeroLocation } from '../dist/src/mrt-optout.js';
import { reflectWgsl } from '../dist/plugin/wgsl.js';

test('wrapFragmentZeroLocation wraps plain @location(0) vec4f entry with @builtin params and preserves line count', () => {
  const wgsl = `
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs() -> VOut { return VOut(vec4f(0.0), vec2f(0.0)); }
// @fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }
@fragment fn fs(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  if (!ff) { discard; }
  return vec4f(i.uv, 0.0, 1.0);
}
`;
  const wrapped = wrapFragmentZeroLocation(wgsl, 'fs', 2);
  assert.ok(wrapped);
  assert.match(wrapped, /fn weft_z2_fs\(i: VOut, ff: bool\) -> vec4f \{/);
  assert.match(wrapped, /@location\(2\) w_c2: vec4f/);
  assert.doesNotMatch(wrapped, /\b__/);
  const refl = reflectWgsl(wrapped);
  const fs = refl.entries.find((e) => e.stage === 'fragment' && e.name === 'fs');
  assert.ok(fs);
  assert.deepEqual(fs.targetLocations, [0, 2]);
});

test('wrapFragmentZeroLocation wraps multi-target struct return including @builtin(frag_depth)', () => {
  const wgsl = `
struct VOut { @builtin(position) pos: vec4f }
struct FOutM { @location(0) c: vec4f, @location(1) m: vec4f, @builtin(frag_depth) d: f32 }
@vertex fn vs() -> VOut { return VOut(vec4f(0.0)); }
@fragment fn fsM(in: VOut) -> FOutM {
  return FOutM(vec4f(1.0), vec4f(0.0), 0.5);
}
`;
  const wrapped = wrapFragmentZeroLocation(wgsl, 'fsM', 2);
  assert.ok(wrapped);
  const refl = reflectWgsl(wrapped);
  const fsM = refl.entries.find((e) => e.stage === 'fragment' && e.name === 'fsM');
  assert.ok(fsM);
  assert.deepEqual(fsM.targetLocations, [0, 1, 2]);
});

test('wrapFragmentZeroLocation returns null when @location(2) is already present', () => {
  const wgsl = `
struct FOutG { @location(0) c: vec4f, @location(2) g: vec4f }
@fragment fn fsG() -> FOutG { return FOutG(vec4f(1.0), vec4f(0.0)); }
`;
  assert.equal(wrapFragmentZeroLocation(wgsl, 'fsG', 2), null);
});

test('shaderWithZeroLocation caches per (shader, version, fsName, loc) and updates reflect.targetLocations', () => {
  const code = `
@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }
`;
  const base = {
    id: 'test.wgsl',
    label: 'test',
    code,
    files: ['test.wgsl'],
    runs: [1, 0, 1],
    version: 1,
    reflect: reflectWgsl(code),
    structs: {},
    bindings: {},
    onChange: () => () => {},
  };
  const s1 = shaderWithZeroLocation(base, 'fs', 2);
  const s2 = shaderWithZeroLocation(base, 'fs', 2);
  assert.equal(s1, s2);
  assert.notEqual(s1.id, base.id);
  const entry = s1.reflect.entries.find((e) => e.name === 'fs');
  assert.deepEqual(entry.targetLocations, [0, 2]);
});
