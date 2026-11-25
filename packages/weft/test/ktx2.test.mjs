// KTX2 v2.0 compressed texture parser/encoder, mip block-alignment, format selection, and VRAM byte accounting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
const { parseKtx2, encodeKtx2, bestCompressedFormat, supportsTextureFormat, textureFromKtx2 } = await import('../dist/src/ktx2.js');
const { compressedBlock } = await import('../dist/src/resources.js');

const deflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());

test('encodeKtx2 / parseKtx2 round-trips BC7 2-mip texture with exact block layout', async () => {
  // 8x8 BC7 -> 2x2 blocks * 16 B = 64 B; 4x4 BC7 -> 1x1 block * 16 B = 16 B; 2x2 BC7 -> 1x1 block * 16 B = 16 B
  const m0 = new Uint8Array(64).fill(0xaa);
  const m1 = new Uint8Array(16).fill(0xbb);
  const m2 = new Uint8Array(16).fill(0xcc);
  const bin = encodeKtx2({ format: 'bc7-rgba-unorm-srgb', width: 8, height: 8, levels: [m0, m1, m2] });
  const img = await parseKtx2(bin);
  assert.equal(img.format, 'bc7-rgba-unorm-srgb');
  assert.equal(img.width, 8);
  assert.equal(img.height, 8);
  assert.equal(img.levels.length, 3);
  assert.equal(img.levels[0].bytesPerRow, 32);
  assert.equal(img.levels[0].copyWidth, 8);
  assert.equal(img.levels[2].width, 2);
  assert.equal(img.levels[2].copyWidth, 4);
  assert.equal(img.levels[2].copyHeight, 4);
  assert.equal(img.levels[2].data[0], 0xcc);
});

test('parseKtx2 inflates zlib supercompression (scheme 3) for ASTC 4x4', async () => {
  const raw = new Uint8Array(16 * 4).map((_, i) => (i * 13) & 255); // 8x8 ASTC 4x4 = 4 blocks * 16 B
  const comp = await deflate(raw);
  const bin = encodeKtx2({
    format: 'astc-4x4-unorm', width: 8, height: 8, levels: [comp],
    supercompression: 3, uncompressedByteLengths: [raw.byteLength],
  });
  const img = await parseKtx2(bin);
  assert.equal(img.format, 'astc-4x4-unorm');
  assert.equal(img.supercompression, 3);
  assert.deepEqual(img.levels[0].data, raw);
});

test('bestCompressedFormat & compressedBlock choose optimal native format and exact VRAM size', () => {
  assert.equal(bestCompressedFormat({ features: new Set(['texture-compression-bc', 'texture-compression-astc']) }), 'bc7');
  assert.equal(bestCompressedFormat({ features: new Set(['texture-compression-astc']) }), 'astc');
  assert.equal(bestCompressedFormat({ features: new Set(['texture-compression-etc2']) }), 'etc2');
  assert.equal(bestCompressedFormat({ features: new Set() }), null);
  assert.equal(supportsTextureFormat({ features: new Set(['texture-compression-bc']) }, 'bc7-rgba-unorm'), true);
  assert.equal(supportsTextureFormat({ features: new Set() }, 'bc7-rgba-unorm'), false);
  assert.deepEqual(compressedBlock('bc7-rgba-unorm-srgb'), { bw: 4, bh: 4, bytes: 16 });
  assert.deepEqual(compressedBlock('bc1-rgba-unorm'), { bw: 4, bh: 4, bytes: 8 });
  assert.deepEqual(compressedBlock('astc-6x6-unorm'), { bw: 6, bh: 6, bytes: 16 });
  assert.deepEqual(compressedBlock('rgba8unorm'), { bw: 1, bh: 1, bytes: 4 });
});

test('textureFromKtx2 trims top mips past max and uploads block-aligned extents', async () => {
  const m0 = new Uint8Array(16 * 16).fill(1); // 16x16 BC7 = 4x4 blocks * 16 B = 256 B
  const m1 = new Uint8Array(4 * 16).fill(2);  // 8x8 BC7 = 2x2 blocks * 16 B = 64 B
  const m2 = new Uint8Array(1 * 16).fill(3);  // 4x4 BC7 = 1x1 block * 16 B = 16 B
  const bin = encodeKtx2({ format: 'bc7-rgba-unorm', width: 16, height: 16, levels: [m0, m1, m2] });
  const writes = [];
  let created = null;
  const fakeKit = {
    features: new Set(['texture-compression-bc']),
    texture(desc) { created = desc; return { gpu: { label: desc.label }, ...desc }; },
    queue: { writeTexture(dst, data, layout, size) { writes.push({ mip: dst.mipLevel, bytes: data.byteLength, layout, size }); } },
  };
  await textureFromKtx2(fakeKit, bin, { label: 'test.ktx2', max: 8 });
  assert.deepEqual(created.size, [8, 8, 1]);
  assert.equal(created.mips, 2);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].mip, 0);
  assert.equal(writes[0].bytes, 64);
  assert.deepEqual(writes[0].size, [8, 8, 1]);
  assert.equal(writes[1].mip, 1);
  assert.equal(writes[1].bytes, 16);
  assert.deepEqual(writes[1].size, [4, 4, 1]);
});

test('textureFromKtx2 stops max trim before block-unaligned non-POT mip and rejects unaligned or 3D inputs', async () => {
  const mk = (w, h) => new Uint8Array(Math.ceil(w / 4) * Math.ceil(h / 4) * 16).fill(7);
  // 1000x600 (mult of 4) -> 500x300 (mult of 4) -> 250x150 (NOT mult of 4): max=300 must stop at 500x300
  const bin = encodeKtx2({ format: 'bc7-rgba-unorm', width: 1000, height: 600, levels: [mk(1000, 600), mk(500, 300), mk(250, 150)] });
  let created = null;
  const fakeKit = {
    features: new Set(['texture-compression-bc']),
    texture(desc) { created = desc; return { gpu: { label: desc.label }, ...desc }; },
    queue: { writeTexture() {} },
  };
  await textureFromKtx2(fakeKit, bin, { label: 'npot.ktx2', max: 300 });
  assert.deepEqual(created.size, [500, 300, 1]);
  assert.equal(created.mips, 2);

  // Unaligned top level throws synchronously before kit.texture
  const bad = encodeKtx2({ format: 'bc7-rgba-unorm', width: 10, height: 10, levels: [mk(10, 10)] });
  await assert.rejects(() => textureFromKtx2(fakeKit, bad), /not a multiple/);

  // 3D KTX2 throws cleanly
  const vol = encodeKtx2({ format: 'rgba8unorm', width: 4, height: 4, depth: 2, levels: [new Uint8Array(4 * 4 * 2 * 4)] });
  await assert.rejects(() => textureFromKtx2(fakeKit, vol), /3D textures/);
});
