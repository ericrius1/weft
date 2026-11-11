// What the browser is given of a shader (plugin/lean.ts): comments gone, only what the entry points reach, a
// uniform-only struct cut after the last field read — and the lines that stay mapped back to their source. Browsers
// cache compiled pipelines keyed on that code, so a change the shader doesn't use must leave it the same. Run with
// `npm test` after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leanWgsl, stripComments } from '../dist/plugin/lean.js';
import { reflectWgsl } from '../dist/plugin/wgsl.js';

const lean = (code) => leanWgsl(code, [1, 0, 1]).code;

const BASE = `
// the world
struct World {
  sun: vec4f,     // toward the sun
  fog: vec4f,
  wind: vec4f,
}
@group(0) @binding(0) var<uniform> world: World;
@group(0) @binding(1) var tex: texture_2d<f32>;
override SOFT: u32 = 1u;
/* a block /* nested */ comment */
fn unused(x: f32) -> f32 { return x * 2.0; }
fn light(n: vec3f) -> f32 { return max(dot(n, world.sun.xyz), 0.0) * f32(SOFT); }
@fragment fn fs(@location(0) n: vec3f) -> @location(0) vec4f { return vec4f(light(n)); }
`;

test('comments, and declarations no entry reaches, are left out', () => {
  const c = lean(BASE);
  assert.ok(!/\/\/|\/\*/.test(c), c);
  assert.ok(!c.includes('unused'), c);
  assert.ok(!c.includes('tex'), c);
  assert.ok(c.includes('fn light') && c.includes('override SOFT') && c.includes('var<uniform> world'), c);
});

test('a change the shader does not use leaves its code the same', () => {
  const was = lean(BASE);
  assert.equal(lean(BASE.replace('// the world', '// the world, edited')), was);
  assert.equal(lean(BASE.replace('fn unused', 'fn another(y: f32) -> f32 { return y; }\nfn unused')), was);
  // a field added after the last one read, or one unread renamed
  assert.equal(lean(BASE.replace('wind: vec4f,', 'wind: vec4f,\n  rain: vec4f,')), was);
  assert.equal(lean(BASE.replace('fog: vec4f,', 'mist: vec4f,')), was);
  // and a change it does use doesn't
  assert.notEqual(lean(BASE.replace('max(dot', 'min(dot')), was);
});

test('a uniform struct keeps every offset up to the last field read', () => {
  const c = lean(BASE.replace('world.sun.xyz', 'world.wind.xyz'));
  const s = reflectWgsl(c).structs.World;
  assert.deepEqual(s.fields.map((f) => [f.name, f.offset]), [['_p0', 0], ['_p1', 16], ['wind', 32]]);
});

test('a struct in an array or a storage buffer is left whole', () => {
  const code = `struct P { a: vec4f, b: vec4f }
@group(0) @binding(0) var<storage, read> ps: array<P>;
@compute @workgroup_size(1) fn main() { let x = ps[0].a; }`;
  assert.ok(lean(code).includes('b: vec4f'));
});

test('directives stay, and a module with no entry point keeps everything', () => {
  assert.ok(lean('enable f16;\n' + BASE).startsWith('enable f16;'));
  const lib = 'fn a() -> f32 { return 1.0; }\nfn b() -> f32 { return 2.0; }';
  assert.equal(lean(lib), lib);
});

test('each line kept maps back to its source line', () => {
  const { code, runs } = leanWgsl(BASE, [1, 0, 1]);
  const src = BASE.split('\n');
  code.split('\n').forEach((line, i) => {
    let r = 0;
    for (let j = 0; j < runs.length; j += 3) if (runs[j] <= i + 1) r = j;
    const at = runs[r + 2] + (i + 1 - runs[r]);
    assert.ok(stripComments(src[at - 1]).startsWith(line), `${i + 1}: ${line} <- ${src[at - 1]}`);
  });
});
