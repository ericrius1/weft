// Coplanar anti-z-fighting tests:
//   1. Pillar 1: RenderPass autoDepthBias & depthLayer (zero pipeline explosion, non-negative reversed-Z bias,
//      WebGPU topology & shadow/sky/blend guards)
//   2. Pillar 2: findCoplanar / separateCoplanar & MeshBuilder auto-separation (back-to-back, twins, same-facing
//      area-first + order tie-breaking, intersecting beams, non-indexed buffers, curved fast path)
//   3. Pillar 3 & 4: frame.wgsl clipBias / clipAtFacing / clipRelFacing lean dead-code stripping & reflection
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeKit, shader, TRI } from './fakekit.mjs';

const { RenderPass } = await import('../dist/src/passes.js');
const { Texture } = await import('../dist/src/resources.js');
const { MeshBuilder, findCoplanar, separateCoplanar } = await import('../dist/src/mesh.js');
const { reflectWgsl } = await import('../dist/plugin/wgsl.js');
const { leanWgsl } = await import('../dist/plugin/lean.js');

function depthTex(kit, label = 'depth') {
  kit.size ??= { render: [128, 128], canvas: [128, 128] };
  kit.device.createTexture ??= (d) => ({ ...d, destroy() {}, createView: () => ({}) });
  return new Texture(kit, { label, format: 'depth32float', size: [128, 128] });
}

test('autoDepthBias: distinct opaque shaders get distinct non-negative biases; same shader shares 1 pipeline', async () => {
  const kit = fakeKit();
  const dTex = depthTex(kit);
  const shA = shader('test/a.wgsl', TRI);
  const shB = shader('test/b.wgsl', TRI);
  const shC = shader('test/c.wgsl', TRI);
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }], depth: { target: dTex, clear: 0 } });
  const a1 = pass.draw(shA, { label: 'a1' });
  const a2 = pass.draw(shA, { label: 'a2' });
  const b1 = pass.draw(shB, { label: 'b1' });
  const c1 = pass.draw(shC, { label: 'c1' });
  const r = await pass.ready();
  assert.equal(r.distinct, 3, 'a1 & a2 share one pipeline despite autoDepthBias');
  assert.equal(a1.pipe.pipeline, a2.pipe.pipeline);
  const desc = (lbl) => kit.compiled.find((d) => d.label === lbl).depthStencil;
  assert.ok(desc('a1').depthBias > 0 && desc('a1').depthBiasSlopeScale > 0 && desc('a1').depthBiasClamp > 0);
  assert.ok(desc('b1').depthBias > desc('a1').depthBias, 'sequential slots increase in draw order');
  assert.ok(desc('c1').depthBias > desc('b1').depthBias);
  assert.ok(desc('b1').depthBiasSlopeScale > desc('a1').depthBiasSlopeScale);
  void b1; void c1;
});

test('depthLayer ordering: terrain (0) < base < detail < decal < overlay, all non-negative', async () => {
  const kit = fakeKit();
  const dTex = depthTex(kit);
  const pass = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }], depth: { target: dTex, clear: 0 } });
  const layers = ['terrain', 'base', 'detail', 'decal', 'overlay'];
  for (const l of layers) pass.draw(shader(`test/l-${l}.wgsl`, TRI), { label: l, depthLayer: l });
  await pass.ready();
  const ds = Object.fromEntries(layers.map((l) => [l, kit.compiled.find((d) => d.label === l).depthStencil]));
  assert.equal(ds.terrain.depthBias, 0, 'terrain is exact 0 so horizon never underflows to 0');
  assert.equal(ds.terrain.depthBiasSlopeScale, 0);
  for (let i = 1; i < layers.length; i++) {
    const prev = ds[layers[i - 1]], cur = ds[layers[i]];
    assert.ok(cur.depthBias > prev.depthBias, `${layers[i]} bias > ${layers[i - 1]}`);
    assert.ok(cur.depthBiasSlopeScale > prev.depthBiasSlopeScale, `${layers[i]} slope > ${layers[i - 1]}`);
  }
});

test('autoDepthBias guards: shadows, readOnly depth, sky (equal), blended, line-list, explicit bias, autoDepthBias:false', async () => {
  const kit = fakeKit();
  const dTex = depthTex(kit);
  const sh = shader('test/guards.wgsl', TRI);

  // Depth-only shadow pass: no auto bias
  const shadow = new RenderPass(kit, { label: 'shadow', depth: { target: dTex, clear: 0 } });
  shadow.draw(sh, { label: 'shadow.cast', fragment: null });

  // Read-only depth pass: no auto bias
  const fx = new RenderPass(kit, { label: 'fx', color: [{ target: 'screen' }], depth: { target: dTex, readOnly: true } });
  fx.draw(sh, { label: 'fx.glow' });

  // Main pass with special draws
  const scene = new RenderPass(kit, { label: 'scene', color: [{ target: 'screen' }], depth: { target: dTex, clear: 0 } });
  scene.draw(sh, { label: 'sky', depthCompare: 'equal', depthWrite: false });
  scene.draw(sh, { label: 'glass', blend: 'alpha', depthWrite: false });
  scene.draw(sh, { label: 'wires', topology: 'line-list' });
  scene.draw(sh, { label: 'road', depthBias: 4000, depthBiasSlopeScale: 3 });
  // Explicit depthLayer on a blended decal DOES apply
  scene.draw(sh, { label: 'decal.blend', blend: 'alpha', depthWrite: false, depthLayer: 'decal' });

  // Opt-out pass
  const raw = new RenderPass(kit, { label: 'raw', color: [{ target: 'screen' }], depth: { target: dTex, clear: 0 }, autoDepthBias: false });
  raw.draw(shader('test/raw.wgsl', TRI), { label: 'raw.draw' });

  await kit.ready();
  const ds = (lbl) => kit.compiled.find((d) => d.label === lbl).depthStencil;
  for (const lbl of ['shadow.cast', 'fx.glow', 'sky', 'glass', 'wires', 'raw.draw']) {
    assert.equal(ds(lbl).depthBias, undefined, `${lbl} must have no auto depthBias`);
    assert.equal(ds(lbl).depthBiasSlopeScale, undefined, `${lbl} must have no auto slopeScale`);
  }
  assert.equal(ds('road').depthBias, 4000);
  assert.equal(ds('road').depthBiasSlopeScale, 3);
  assert.ok(ds('decal.blend').depthBias >= 128, 'explicit depthLayer works on blended decals');
});

test('separateCoplanar: back-to-back boxes, same-facing detail over wall, intersecting beams, twins, and MeshBuilder', () => {
  // 1. Two flush boxes sitting on top of each other (back-to-back touching faces at y = 1)
  const b1 = new MeshBuilder();
  b1.push().translate(0, 0.5, 0).box(2, 1, 2).pop();
  b1.push().translate(0, 1.5, 0).box(1, 1, 1).pop();
  const raw1 = b1.data({ separateCoplanar: false });
  const fv1Raw = new Float32Array(raw1.vertices);
  const pairsBefore1 = findCoplanar(fv1Raw, raw1.indices, { stride: 10 });
  assert.ok(pairsBefore1.length > 0, 'touching boxes have back-to-back coplanar faces before separation');
  const clean1 = b1.data(); // auto separateCoplanar on by default
  const fv1Clean = new Float32Array(clean1.vertices);
  const pairsAfter1 = findCoplanar(fv1Clean, clean1.indices, { stride: 10, tol: 0.0005 });
  assert.equal(pairsAfter1.length, 0, 'MeshBuilder.data() resolves all touching-box coplanar faces automatically');

  // 2. Small detail quad emitted BEFORE a large wall in the exact same plane (z = 0, normal +Z):
  //    area-first tie-breaking keeps the smaller detail in front (z = 0) and recesses the large wall (z = -eps)!
  const b2 = new MeshBuilder();
  b2.quad([-0.2, -0.2, 0], [0.2, -0.2, 0], [0.2, 0.2, 0], [-0.2, 0.2, 0]); // small plaque (0.16 m²) FIRST
  b2.quad([-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]);                 // big wall (100 m²) SECOND
  const d2 = b2.data();
  const fv2 = new Float32Array(d2.vertices);
  assert.equal(findCoplanar(fv2, d2.indices, { stride: 10, tol: 0.0005 }).length, 0);
  const plaqueZ = fv2[2];        // vertex 0 z
  const wallZ = fv2[4 * 10 + 2]; // vertex 4 z
  assert.ok(plaqueZ > wallZ + 0.0005, `smaller detail (${plaqueZ}) stays in front of larger wall (${wallZ})`);

  // 3. Intersecting beams with flush top/bottom/front/back faces (non-indexed raw Float32Array)
  const b3 = new MeshBuilder();
  b3.box(4, 0.4, 0.4); // beam along X
  b3.box(0.4, 0.4, 4); // beam along Z (coplanar at y = ±0.2!)
  const raw3 = b3.data({ separateCoplanar: false });
  const rawF = new Float32Array(raw3.vertices);
  // Expand to non-indexed tightly-packed XYZ to test non-indexed path
  const ni = new Float32Array(raw3.indices.length * 3);
  for (let i = 0; i < raw3.indices.length; i++) {
    const vi = raw3.indices[i];
    ni[i * 3] = rawF[vi * 10];
    ni[i * 3 + 1] = rawF[vi * 10 + 1];
    ni[i * 3 + 2] = rawF[vi * 10 + 2];
  }
  assert.ok(findCoplanar(ni).length > 0, 'intersecting beams have flush top/bottom coplanar faces');
  const stats = separateCoplanar(ni);
  assert.ok(stats.pairs > 0 && stats.sameFacing > 0);
  assert.equal(findCoplanar(ni, undefined, { tol: 0.0005 }).length, 0, 'all flush intersecting faces separated');

  // 4. Exact twin two-sided sheet (opposite normals, same triangle)
  const twin = new Float32Array([
    0, 0, 0,  1, 0, 0,  0, 1, 0, // +Z face
    0, 0, 0,  0, 1, 0,  1, 0, 0, // -Z face
  ]);
  const twinStats = separateCoplanar(twin, undefined, { eps: 0.002 });
  assert.equal(twinStats.twins, 1);
  assert.ok(twin[2] > 0.001 && twin[11] < -0.001, 'front pushed +eps, back pushed -eps');

  // 5. Curved sphere has 0 coplanar pairs (fast path untouched)
  const sp = new MeshBuilder().sphere(2, 16, 10);
  const spRaw = sp.data({ separateCoplanar: false });
  const spAuto = sp.data();
  assert.deepEqual(new Float32Array(spAuto.vertices), new Float32Array(spRaw.vertices));
});

test('frame.wgsl: new clipBias/clipAtFacing helpers are dead-code stripped when unused and reflect cleanly when used', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const frameSrc = readFileSync(resolve(here, '../shaders/frame.wgsl'), 'utf8');
  const plain = `${frameSrc}\n@vertex fn vs() -> @builtin(position) vec4f { return clipAt(vec3f(0.0)); }\n@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }`;
  const leanPlain = leanWgsl(plain, ['vs', 'fs']).code;
  assert.ok(!leanPlain.includes('clipBias'), 'unused clipBias stripped by leanWgsl');
  assert.ok(!leanPlain.includes('clipAtFacing'), 'unused clipAtFacing stripped by leanWgsl');

  const used = `${frameSrc}\n@vertex fn vs(@builtin(instance_index) id: u32) -> @builtin(position) vec4f { return clipBias(clipAtFacing(vec3f(0.0), vec3f(0.0, 1.0, 0.0)), id, 0.8); }\n@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }`;
  const ref = reflectWgsl(used);
  assert.ok(ref.entries.some((e) => e.name === 'vs' && e.resources.includes('frame')));
  const leanUsed = leanWgsl(used, ['vs', 'fs']).code;
  assert.ok(leanUsed.includes('clipBias') && leanUsed.includes('clipAtFacing'));
});
