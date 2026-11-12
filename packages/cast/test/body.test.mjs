// A body that isn't a person (header.kind, cast 0.7): read through the same DNC1 reader and 24-byte vertex, its own
// hierarchy from each bone's parent, no human bone required; a person's file is read exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHero, CORE } from '../dist/asset.js';
import { HeroRig } from '../dist/rig.js';

/** a DNC1 file: header JSON, then verts (24 bytes each) and u32 indices */
function dnc1(header, nv = 3) {
  let j = JSON.stringify({ verts: nv, indices: 3, qmin: [0, 0, 0], qmax: [1, 1, 1], stride: 24, chains: {}, ...header });
  while (j.length % 4) j += ' ';
  const h = new TextEncoder().encode(j);
  const buf = new ArrayBuffer(12 + h.length + nv * 24 + 12);
  const u = new Uint8Array(buf);
  u.set([68, 78, 67, 49]);
  new DataView(buf).setUint32(8, h.length, true);
  u.set(h, 12);
  new Uint32Array(buf, 12 + h.length + nv * 24, 3).set([0, 1, 2]);
  return buf;
}
const bone = (name, parent, y) => ({ name, head: [0, y, 0], tail: [0, y + 0.05, 0], up: [0, 0, 1], parent });
const bird = (bones) => dnc1({ char: 'redtail', kind: 'bird', version: 1, height: 0.5, scale: 1, bones });

test('a bird: no human bone, its parents read, no garments fitted', async () => {
  const bones = [bone('root', -1, 0), bone('body', 0, 0.1), bone('neck', 1, 0.2), bone('head', 2, 0.25), bone('humerusL', 1, 0.15), bone('ulnaL', 4, 0.15)];
  const a = await parseHero(bird(bones), 'bird');
  assert.deepEqual(Array.from(a.parents), [-1, 0, 1, 2, 1, 4]);
  assert.equal(a.bones.length, 6, 'nothing added (a person gets its hanging frame bones)');
  assert.equal(a.index.ulnaL, 5);
  assert.throws(() => new HeroRig(a), /bird, not a person/);
  // (parents by name, the root's null: as the bird's Blender export writes them)
  const named = bones.map((b, i) => ({ ...b, parent: i === 0 ? null : bones[b.parent].name }));
  assert.deepEqual(Array.from((await parseHero(bird(named), 'bird')).parents), [-1, 0, 1, 2, 1, 4]);
});

test('a bird file refused for a bad hierarchy: a missing or later parent, two roots', async () => {
  await assert.rejects(parseHero(bird([bone('root', -1, 0), { ...bone('a', 0, 0), parent: undefined }]), 'x'), /parent/);
  await assert.rejects(parseHero(bird([bone('root', -1, 0), bone('a', 2, 0), bone('b', 0, 0)]), 'x'), /parent/);
  await assert.rejects(parseHero(bird([bone('root', -1, 0), { ...bone('a', 0, 0), parent: 'nobody' }]), 'x'), /parent/);
  await assert.rejects(parseHero(bird([bone('root', -1, 0), bone('a', -1, 0)]), 'x'), /2 roots/);
});

test('a person: the CORE bones still required, parents empty', async () => {
  const bones = CORE.map((n, i) => ({ name: n, head: [0, i * 0.05, 0], tail: [0, i * 0.05 + 0.04, 0], up: [0, 0, 1] }));
  const a = await parseHero(dnc1({ char: 'p', version: 1, height: 1.7, scale: 1, bones }), 'p');
  assert.equal(a.parents.length, 0);
  await assert.rejects(parseHero(dnc1({ char: 'p', version: 1, height: 1.7, scale: 1, bones: bones.slice(1) }), 'p'), /missing bone root/);
  await assert.rejects(parseHero(dnc1({ char: 'p', kind: 'human', version: 1, height: 1.7, scale: 1, bones: bones.slice(1) }), 'p'), /missing bone root/);
});
