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

test('an override read only inside a called function', () => {
  const r = uses(`${STRUCTS}
override RAGGED: f32 = 1.0;
@group(0) @binding(1) var<uniform> world: W;
fn edge(x: f32) -> f32 { return x * RAGGED; }
@fragment fn fs() -> @location(0) vec4f { return world.lv[0] * edge(0.5); }`);
  assert.deepEqual(r.overrides, ['RAGGED']);
});

// wgsl_reflect's parser kept only the first two statements of a `case` or `default` body (plugin/wgsl.ts caseBody): a
// binding read only from the third on fell out of the layout (World's ppie fsGlass, its sky and aerial in group 1).
const SWITCH = `${STRUCTS}
@group(0) @binding(1) var<uniform> world: W;
@group(1) @binding(0) var<uniform> SKY: T;
@group(2) @binding(0) var<uniform> TS: T;
override GLOW: f32 = 1.0;
fn sky() -> vec4f { return SKY.level; }`;

test('a binding read only from a case body\'s third statement on', () => {
  const r = uses(`${SWITCH}
@fragment fn fs(@location(0) @interpolate(flat) m: u32) -> @location(0) vec4f {
  var c = vec4f(0.0);
  switch m {
    case 1u: { c.x = 1.0; c.y = 2.0; c.z = 3.0; return c * TS.level; }
    case 2u, 3u: { let a = 1.0; let b = 2.0; let d = 3.0; c = sky() * a * b * d; }
    default: { c.x = 1.0; c.y = 2.0; c.z = GLOW; }
  }
  return c * world.lv[0];
}`);
  assert.deepEqual(r.resources, ['SKY', 'TS', 'world']);
  assert.deepEqual(r.overrides, ['GLOW']);
});

test('a case body\'s locals still shadow, and a binding after a nested switch is still read', () => {
  const r = uses(`${SWITCH}
@fragment fn fs(@location(0) @interpolate(flat) m: u32) -> @location(0) vec4f {
  var c = vec4f(0.0);
  switch m {
    case 1u: {
      let a = 1.0; let b = 2.0;
      let TS = vec4f(3.0);
      switch m { case 0u: { c.x = 1.0; c.y = 2.0; c.z = 3.0; } default: {} }
      c += TS * a * b + sky();
    }
    default: {}
  }
  return c * world.lv[0];
}`);
  assert.deepEqual(r.resources, ['SKY', 'world']);
});

test('every statement of a case body is in the syntax tree', async () => {
  const { WgslParser } = await import('wgsl_reflect/wgsl_reflect.module.js');
  await import('../dist/plugin/wgsl.js');
  const ast = new WgslParser().parse('fn f(m: u32) -> i32 { var a = 0; switch m { case 1u: { a = 1; a = 2; a = 3; a = 4; } case 2u: { ; } default: { a = 5; ; a = 6; a = 7; } } return a; }');
  const sw = ast[0].body.find((s) => s.astNodeType === 'switch');
  assert.deepEqual(sw.cases.map((c) => c.body.length), [4, 0, 3]);
});

test('fragment output locations are reflected accurately including non-contiguous MRT', () => {
  const code = `
struct Out02 { @location(0) c: vec4f, @location(2) g: vec4f }
@fragment fn fs02() -> Out02 { return Out02(vec4f(1.0), vec4f(0.0)); }
@fragment fn fs0() -> @location(0) vec4f { return vec4f(1.0); }`;
  const r = reflectWgsl(code);
  const e02 = r.entries.find((e) => e.name === 'fs02');
  const e0 = r.entries.find((e) => e.name === 'fs0');
  assert.equal(e02.targets, 2);
  assert.deepEqual(e02.targetLocations, [0, 2]);
  assert.equal(e0.targets, 1);
  assert.deepEqual(e0.targetLocations, [0]);
});
