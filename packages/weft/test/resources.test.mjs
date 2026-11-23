// A storage buffer's edges (resources.ts): a write that doesn't all fit, or isn't whole words, says so once; one
// asked for again after it was freed is made anew and counted by the kit again. Without a GPU: a stand-in device and
// queue. Run with `npm test` after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
const { StorageBuffer } = await import('../dist/src/resources.js');

function fakeKit() {
  const kit = {
    made: [], wrote: [], warned: [], resourceGen: 0, buffers: new Set(),
    device: { createBuffer: (d) => { const b = { ...d, destroyed: false, destroy() { this.destroyed = true; } }; kit.made.push(b); return b; } },
    queue: { writeBuffer: (gpu, at, buf, from, n) => kit.wrote.push([at, n]) },
    warnOnce(key, message) { if (!kit.warned.some((w) => w[0] === key)) kit.warned.push([key, message]); },
    // (as Kit.storage: the kit counts what it makes)
    storage(o) { const b = new StorageBuffer(kit, o); kit.buffers.add(b); return b; },
  };
  return kit;
}

test("a texture's view as an attachment is made once, and again when the texture is reallocated", async () => {
  const { Texture } = await import('../dist/src/resources.js');
  const views = [];
  const kit = {
    size: { render: [640, 360], canvas: [640, 360] }, features: new Set(), resourceGen: 0, textures: new Set(),
    device: { createTexture: (d) => ({ ...d, destroy() {}, createView: (v) => { const view = { of: d.size.join('x'), ...v }; views.push(view); return view; } }) },
  };
  const hdr = new Texture(kit, { label: 'hdr', format: 'rgba16float', size: 'render' });
  const a = hdr.attachment;
  assert.equal(hdr.attachment, a);
  assert.equal(views.length, 1);
  assert.deepEqual([a.dimension, a.baseMipLevel, a.mipLevelCount, a.baseArrayLayer, a.arrayLayerCount], ['2d', 0, 1, 0, 1]);
  // (the same view a pass got before: Texture.view's, by its description)
  assert.equal(hdr.view({ dimension: '2d', baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1 }), a);
  // (one layer of an array, as a TexView)
  const cascades = new Texture(kit, { label: 'cascades', format: 'depth32float', size: [512, 512, 4] });
  const layer = cascades.layer(2), la = layer.attachment;
  assert.equal(layer.attachment, la);
  assert.deepEqual([la.dimension, la.baseArrayLayer, la.arrayLayerCount], ['2d', 2, 1]);
  assert.equal(cascades.view({ ...layer.desc, dimension: '2d' }), la);
  const made = views.length;
  for (let i = 0; i < 5; i++) { void hdr.attachment; void layer.attachment; }
  assert.equal(views.length, made, 'asked every frame, made once');
  // (a resize: the texture is new, and so are its views)
  kit.size.render = [1280, 720];
  assert.equal(hdr.alloc(), true);
  const b = hdr.attachment;
  assert.notEqual(b, a);
  assert.equal(b.of, '1280x720x1');
  assert.equal(hdr.attachment, b);
  // (a TexView follows its texture's reallocation)
  const half = new Texture(kit, { label: 'half', format: 'rgba16float', size: 'render', scale: 0.5, mips: 2 });
  const mip = half.mip(1), m0 = mip.attachment;
  kit.size.render = [640, 360];
  half.alloc();
  assert.notEqual(mip.attachment, m0);
  assert.equal(mip.attachment.of, '320x180x1');
});

test('a write that fits, in whole words, says nothing', () => {
  const kit = fakeKit(), b = kit.storage({ label: 'cells', size: 64 });
  b.write(new Float32Array(16));
  b.write(new Uint8Array(8), 56);
  b.write(new ArrayBuffer(0));
  assert.deepEqual(kit.wrote, [[0, 64], [56, 8]]);
  assert.deepEqual(kit.warned, []);
});

test('a write past the end is cut to what fits, and said once a buffer', () => {
  const kit = fakeKit(), b = kit.storage({ label: 'cells', size: 64 });
  b.write(new Float32Array(20));
  b.write(new Float32Array(4), 56);
  b.write(new Float32Array(4), 64);
  // (as before: what fits is written, nothing where nothing does)
  assert.deepEqual(kit.wrote, [[0, 64], [56, 8]]);
  assert.deepEqual(kit.warned.map((w) => w[0]), ['write-past:cells']);
  assert.match(kit.warned[0][1], /a write of 80 bytes at 0 runs past its 64 bytes: only 64 written/);
  // (another buffer is told of its own)
  kit.storage({ label: 'other', size: 16 }).write(new Uint8Array(32));
  assert.deepEqual(kit.warned.map((w) => w[0]), ['write-past:cells', 'write-past:other']);
});

test("a write that isn't whole 4-byte words loses its last bytes, and says so; as data given at its making", () => {
  const kit = fakeKit(), b = kit.storage({ label: 'bytes', size: 64 });
  b.write(new Uint8Array(10));
  b.write(new Uint8Array(7), 8);
  assert.deepEqual(kit.wrote, [[0, 8], [8, 4]]);
  assert.deepEqual(kit.warned.map((w) => w[0]), ['write-odd:bytes']);
  assert.match(kit.warned[0][1], /a write of 10 bytes isn't a multiple of 4: its last 2 left out/);
  const made = kit.storage({ label: 'made', data: new Uint8Array(6) });
  assert.equal(made.size, 16);
  assert.deepEqual(kit.wrote.at(-1), [0, 4]);
  assert.equal(kit.warned.at(-1)[0], 'write-odd:made');
});

test('ensure() grows a buffer; after destroy() it makes it anew, counted by the kit again', () => {
  const kit = fakeKit(), b = kit.storage({ label: 'grown', size: 64, stride: 16 });
  assert.equal(b.ensure(64), false);
  assert.equal(b.ensure(100), true);
  assert.equal(b.size, 128);
  assert.equal(b.count, 8);
  assert.equal(kit.made[0].destroyed, true);
  assert.equal(kit.made.length, 2);
  const v = b.version;
  b.destroy();
  assert.equal(b.destroyed, true);
  assert.equal(kit.buffers.has(b), false);
  assert.equal(kit.made[1].destroyed, true);
  assert.deepEqual(kit.warned, []);
  // (asked for again: no smaller than it was, the kit counts it, bind groups are checked again)
  assert.equal(b.ensure(32), true);
  assert.equal(b.destroyed, false);
  assert.equal(b.size, 128);
  assert.equal(kit.buffers.has(b), true);
  assert.equal(kit.made.length, 3);
  assert.equal(kit.made[2].destroyed, false);
  assert.ok(b.version > v);
  assert.deepEqual(kit.warned.map((w) => w[0]), ['ensure-freed:grown']);
  // (and from there as any buffer)
  assert.equal(b.ensure(64), false);
  assert.equal(b.ensure(300), true);
  assert.equal(b.size, 304);
  assert.equal(kit.buffers.size, 1);
});
