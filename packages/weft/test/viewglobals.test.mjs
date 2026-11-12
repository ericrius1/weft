// A view's own globals (kit.ts View.globals): a view may bind its own copy of the app's globals struct in group 0 in
// place of the kit's (a place mounted in another's frame with its own sun); by default it binds the kit's, and the
// group is made again when either changes. Without a GPU: a stand-in device records the bind groups made.
// Run with `npm test` after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
register('./wgsl-stub.mjs', import.meta.url);
const { View } = await import('../dist/src/kit.js');

function fakeKit() {
  const groups = [];
  const kit = {
    device: { createBindGroup: (d) => { groups.push(d); return { made: groups.length, d }; } },
    frameLayout: { bgl: 'frame' }, samplers: { linear: 'l', repeat: 'r', nearest: 'n', shadow: 's' },
    dummyGlobals: { dummy: true }, globals: null, groups,
    uniforms: () => ({ version: 0, gpu: { frame: true } }),
  };
  return kit;
}
const buf = (name) => ({ version: 0, gpu: { name } });

test('view globals: the kit\'s by default, a view\'s own when set, the group made again on a change', () => {
  const kit = fakeKit();
  const v = new View(kit, {}, null, 'v');
  v.group0();
  assert.equal(kit.groups.at(-1).entries[1].resource.buffer, kit.dummyGlobals, 'no globals: the dummy');
  kit.globals = buf('kit');
  v.group0();
  assert.equal(kit.groups.at(-1).entries[1].resource.buffer.name, 'kit', 'the kit\'s');
  const n = kit.groups.length;
  v.group0();
  assert.equal(kit.groups.length, n, 'unchanged: no new group');
  v.globals = buf('own');
  v.group0();
  assert.equal(kit.groups.at(-1).entries[1].resource.buffer.name, 'own', 'the view\'s own');
  const w = new View(kit, {}, null, 'w');
  w.group0();
  assert.equal(kit.groups.at(-1).entries[1].resource.buffer.name, 'kit', 'another view keeps the kit\'s');
  v.globals.version++;
  v.group0();
  assert.equal(kit.groups.length, n + 3, 'its own buffer replaced: made again');
  v.globals = null;
  v.group0();
  assert.equal(kit.groups.at(-1).entries[1].resource.buffer.name, 'kit', 'cleared: the kit\'s again');
});
