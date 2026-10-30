// Which bindings and overrides each entry point uses (plugin/wgsl.ts reflectWgsl): the pipeline layout is built from
// exactly these, so a name missed here is a pipeline that fails to build (a binding) or a constant that silently keeps
// its default (an override). Run with `npm test` after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflectWgsl } from '../dist/plugin/wgsl.js';

const uses = (code, stage = 'fragment') => {
  const e = reflectWgsl(code).entries.find((x) => x.stage === stage);
  return { resources: [...e.resources].sort(), overrides: [...e.overrides].sort() };
};
const STRUCTS = 'struct W { lv: array<vec4f, 5> } struct T { level: vec4f, i: vec4u }';

test('a uniform read only inside an index after a member access', () => {
  const r = uses(`${STRUCTS}
@group(0) @binding(1) var<uniform> world: W;
@group(2) @binding(0) var<uniform> TS: T;
@fragment fn fs() -> @location(0) vec4f { return world.lv[i32(TS.level.x)]; }`);
  assert.deepEqual(r.resources, ['TS', 'world']);
});

test('a uniform read only inside the second of two indices', () => {
  const r = uses(`${STRUCTS}
@group(0) @binding(0) var<storage, read> data: array<array<vec4f, 4>>;
@group(2) @binding(0) var<uniform> U: T;
@fragment fn fs() -> @location(0) vec4f { return data[0][U.i.x]; }`);
  assert.deepEqual(r.resources, ['U', 'data']);
});

test('the same, reached through a called function, and a swizzle after the index', () => {
  const r = uses(`${STRUCTS}
@group(0) @binding(1) var<uniform> world: W;
@group(2) @binding(0) var<uniform> TS: T;
fn level() -> f32 { return world.lv[i32(TS.level.x)].y; }
@fragment fn fs() -> @location(0) vec4f { return vec4f(level()); }`);
  assert.deepEqual(r.resources, ['TS', 'world']);
});

test('an override read only inside such an index', () => {
  const r = uses(`${STRUCTS}
override LEVEL: f32 = 0.0;
@group(0) @binding(1) var<uniform> world: W;
@fragment fn fs() -> @location(0) vec4f { return world.lv[i32(LEVEL)]; }`);
  assert.deepEqual(r.overrides, ['LEVEL']);
  assert.deepEqual(r.resources, ['world']);
});

test('a local named like a binding, read inside such an index, is the local', () => {
  const r = uses(`${STRUCTS}
@group(0) @binding(1) var<uniform> world: W;
@group(2) @binding(0) var<uniform> TS: T;
@fragment fn fs() -> @location(0) vec4f { let TS = vec4f(1.0); return world.lv[i32(TS.x)]; }`);
  assert.deepEqual(r.resources, ['world']);
});

test('each entry point keeps only what it reaches', () => {
  const code = `${STRUCTS}
@group(0) @binding(1) var<uniform> world: W;
@group(2) @binding(0) var<uniform> TS: T;
@vertex fn vs() -> @builtin(position) vec4f { return world.lv[0]; }
@fragment fn fs() -> @location(0) vec4f { return world.lv[i32(TS.level.x)]; }`;
  assert.deepEqual(uses(code, 'vertex').resources, ['world']);
  assert.deepEqual(uses(code, 'fragment').resources, ['TS', 'world']);
});
