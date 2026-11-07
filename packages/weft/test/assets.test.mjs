// The asset plumbing San Francisco and Boulder share (src/assets.ts): the manifest's mapping, a pack's tiles by Range
// (and from a server that ignores it), retried, and the h16 height codec round trip. Without a network: fetch is a
// stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
const { Assets, Pack, packH16, decodeH16, isLasting, fetchKept } = await import('../dist/src/assets.js');

const deflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());

function serve(files, { ignoreRange = false, failFirst = 0 } = {}) {
  const log = [];
  let fails = failFirst;
  globalThis.fetch = async (url, init = {}) => {
    const h = new Headers(init.headers);
    log.push({ url, range: h.get('range') });
    if (fails > 0) { fails--; throw new TypeError('network'); }
    const f = files[url];
    if (!f) return new Response('nope', { status: 404 });
    const m = !ignoreRange && /bytes=(\d+)-(\d+)/.exec(h.get('range') ?? '');
    if (m) return new Response(f.body.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 });
    return new Response(f.body, { status: 200, headers: { 'content-type': f.type ?? 'application/octet-stream' } });
  };
  return log;
}

test('the manifest maps a path to its R2 copy; anything else is beside the app', async () => {
  serve({ '/assets/remote.json': { body: JSON.stringify({ 'tiles/a.pack': 'https://r2/objects/' + 'f'.repeat(64) + '/a.pack' }), type: 'application/json' } });
  const a = await new Assets({ root: '/assets' }).init();
  assert.equal(a.url('tiles/a.pack'), 'https://r2/objects/' + 'f'.repeat(64) + '/a.pack');
  assert.equal(a.url('trees.bin'), '/assets/trees.bin');
  assert.ok(isLasting(a.url('tiles/a.pack')));
  assert.ok(!isLasting(a.url('trees.bin')));
});

test('a manifest that is not JSON (a dev server answering index.html) is none', async () => {
  serve({ '/assets/remote.json': { body: '<html>', type: 'text/html' } });
  const a = await new Assets({ root: '/assets' }).init();
  assert.deepEqual(a.remote, {});
  await assert.rejects(a.fetch('missing.bin'), /missing\.bin: 404/);
});

test('fetchKept without Cache Storage, or for a range, is a plain fetch', async () => {
  const log = serve({ '/x': { body: 'abc' } });
  const r = await fetchKept('/x', { headers: { Range: 'bytes=0-1' } }, 'game-objects');
  assert.equal(await r.text(), 'ab');
  assert.equal(log.length, 1);
});

const index = { name: 'h0', file: 'h0.pack', grid: 2, offsets: [0, 3, 0, 7], lengths: [3, 4, 0, 2], codec: 'rgba8', half: 100, texel: 1, tile: 4 };
const body = new Uint8Array([1, 2, 3, 10, 11, 12, 13, 20, 21]);

test('a tile is its byte range of the pack; no tile where the length is 0 or off the grid', async () => {
  const log = serve({ '/assets/tiles/h0.json': { body: JSON.stringify(index), type: 'application/json' }, '/assets/tiles/h0.pack': { body } });
  const p = await Pack.load(new Assets({ root: '/assets', manifest: null }), 'h0');
  assert.deepEqual([...new Uint8Array(await p.bytes(0, 1))], [10, 11, 12, 13]);
  assert.deepEqual([...new Uint8Array(await p.bytes(1, 1))], [20, 21]);
  assert.equal(await p.bytes(1, 0), null);
  assert.equal(p.has(2, 0), false);
  assert.equal(p.has(-1, 0), false);
  assert.equal(log.at(-2).range, 'bytes=3-6');
});

test('a server that ignores the range still gives the tile', async () => {
  serve({ '/p': { body } }, { ignoreRange: true });
  const p = new Pack(index, '/p');
  assert.deepEqual([...new Uint8Array(await p.bytes(0, 1))], [10, 11, 12, 13]);
});

test('a failed fetch is retried, then gives up', async () => {
  serve({ '/p': { body } }, { failFirst: 2 });
  const p = new Pack(index, '/p');
  p.backoff = 1;
  assert.deepEqual([...new Uint8Array(await p.bytes(0, 0))], [1, 2, 3]);
  serve({ '/p': { body } }, { failFirst: 9 });
  const q = new Pack(index, '/p');
  q.backoff = 1;
  q.retries = 2;
  await assert.rejects(q.bytes(0, 0), /network/);
});

test('h16 heights round trip: planes, prediction and zig-zag', async () => {
  const n = 16, v = new Uint16Array(n * n);
  for (let i = 0; i < v.length; i++) v[i] = (Math.sin(i * 0.37) * 30000 + 32768 + ((i * 7919) % 5000)) & 0xffff;
  v[0] = 0; v[1] = 65535; v[n] = 65535;
  const z = await deflate(packH16(v, n));
  const m = await decodeH16(z, n, [-50, 0.01]);
  for (let i = 0; i < v.length; i++) assert.ok(Math.abs(m[i] - (-50 + v[i] * 0.01)) < 1e-3, `texel ${i}`);
});
