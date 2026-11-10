// Where an app's data lives, and how its big files stream (San Francisco's and Boulder's, shared).
//
// In development everything is beside the app under /assets (the dev server sends what isn't on this disk on to R2:
// plugin/vite.ts remoteAssets). A deployed build lists the big files in /assets/remote.json — path under /assets → its
// content-addressed URL (objects/<sha256>/<name>, never overwritten: tools/publish-assets.mjs) — and fetches them from
// there. Those objects never change under their names, so with `keep` they're held in the browser's Cache Storage once
// fetched and a later visit takes them from there: the HTTP cache can't be counted on for ~100 MB (Boulder measured it
// dropping two thirds between two visits).
//
// A layer too big to fetch whole streams as tiles out of a pack: one file, each tile a byte range in it, its index
// beside it (<dir>/<name>.json). A tile is a Range request (retried, and a server that ignores the range still works).
//
//   const assets = await new Assets({ keep: 'mygame-objects' }).init();
//   const trees = await (await assets.fetch('trees.bin')).arrayBuffer();
//   const pack = await Pack.load(assets, 'height0');
//   const bytes = await pack.bytes(row, col, signal);       // null where the pack has no tile
//   const metres = await decodeH16(bytes!, 256, pack.index.q!);

export interface AssetsOptions {
  /** the folder the files are under (default: `assets` beside the page, whatever path it's served at; '/assets' in a
   *  worker) */
  root?: string;
  /** the manifest under root mapping a path to where it really is (default 'remote.json'; null: none, everything's
   *  beside the app) */
  manifest?: string | null;
  /** a Cache Storage name to keep the content-addressed objects in (null, the default: the HTTP cache only). Name it
   *  for the app: several apps can share an origin (ericlevin.dev), and forgetExcept clears what this one doesn't use */
  keep?: string | null;
  /** what the page already asked for before the bundle ran (a build's index.html: plugin/vite.ts earlyFetch), path →
   *  its fetch; each taken once, by init (the manifest) or a plain fetch(rel) — e.g. `globalThis.__early` */
  early?: Record<string, Promise<Response | null>> | null;
}

/** a content-addressed object's URL: objects/<sha256>/<name> (it never changes, so it can be kept) */
export const isLasting = (url: string) => /\/objects\/[0-9a-f]{64}\//.test(url);

/** fetch, through Cache Storage `cache` for a content-addressed object (any other URL, or no Cache Storage: as usual) */
export async function fetchKept(url: string, init: RequestInit | undefined, cache: string | null): Promise<Response> {
  if (!cache || !isLasting(url) || typeof caches === 'undefined' || (init?.headers && new Headers(init.headers).has('range'))) return fetch(url, init);
  try {
    const c = await caches.open(cache);
    const hit = await c.match(url);
    if (hit) return hit;
    const r = await fetch(url, init);
    if (r.ok && r.status === 200) c.put(url, r.clone()).catch(() => {});
    return r;
  } catch {
    return fetch(url, init);
  }
}

export class Assets {
  readonly root: string;
  readonly keep: string | null;
  /** path under root → its URL (the manifest; empty until init, or with none) */
  remote: Record<string, string> = {};
  private manifest: string | null;
  private early: Record<string, Promise<Response | null>>;
  constructor(opts: AssetsOptions = {}) {
    this.root = opts.root ?? (typeof document === 'undefined' ? '/assets' : new URL('assets', document.baseURI).pathname);
    this.manifest = opts.manifest === undefined ? 'remote.json' : opts.manifest;
    this.keep = opts.keep ?? null;
    this.early = opts.early ?? {};
  }

  /** the page's early fetch of `rel`, once (null: none, or already taken) */
  takeEarly(rel: string): Promise<Response | null> | null {
    const e = this.early[rel];
    if (!e) return null;
    delete this.early[rel];
    return e;
  }

  /** read the manifest (revalidated every load: a map cached from the last deploy would send moved files to this one's
   *  404s). None, or not JSON (a dev server's index.html fallback): everything's beside the app */
  async init(): Promise<this> {
    if (!this.manifest) return this;
    try {
      const r = (await this.takeEarly(this.manifest)) ?? await fetch(`${this.root}/${this.manifest}`, { cache: 'no-cache' });
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) this.remote = await r.json();
    } catch { /* none */ }
    return this;
  }

  /** the URL of a file under root */
  url(rel: string) { return this.remote[rel] ?? `${this.root}/${rel}`; }

  /** a file (a range's 206 counts as there); throws with its path and status when it isn't */
  async fetch(rel: string, init?: RequestInit): Promise<Response> {
    const e = init ? null : this.takeEarly(rel);
    const r = (e && await e) || await fetchKept(this.url(rel), init, this.keep);
    if (!r.ok && r.status !== 206) throw new Error(`${rel}: ${r.status}`);
    return r;
  }
  async json<T>(rel: string): Promise<T> { return (await this.fetch(rel)).json() as Promise<T>; }
  async bytes(rel: string): Promise<ArrayBuffer> { return (await this.fetch(rel)).arrayBuffer(); }

  /** let go of the kept objects this deploy doesn't use (default: everything the manifest names is kept) */
  async forgetExcept(keep: Iterable<string> = Object.values(this.remote)) {
    if (!this.keep || typeof caches === 'undefined') return;
    const want = new Set([...keep].map((u) => new URL(u, location.href).href));
    const c = await caches.open(this.keep);
    for (const req of await c.keys()) if (!want.has(req.url)) await c.delete(req);
  }
}

/** zlib-deflated bytes inflated by the browser's own decompressor (`format` 'gzip' or 'deflate-raw' for those) */
export async function inflate(b: ArrayBuffer | Uint8Array, format: 'deflate' | 'gzip' | 'deflate-raw' = 'deflate'): Promise<Uint8Array> {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** a pack's index: its tiles' grid and each tile's byte range in the pack (row-major over the grid; length 0: no tile
 *  there), and the pack's file name beside the index */
export interface PackIndex {
  name: string;
  file: string;
  grid: number;
  offsets: number[];
  lengths: number[];
  /** what the tiles are (an app's own names: San Francisco's 'h16', 'rgba8', 'webp') */
  codec?: string;
}
/** a terrain layer's pack (San Francisco's pipeline/tiles.py): a level of a clipmap, its tiles `tile` texels a side at
 *  `texel` metres, the grid centred on the origin out to `half` metres */
export interface TileIndex extends PackIndex {
  /** 'h16' (heights: u16 planes, deflated: decodeH16), 'rgba8' (deflated bytes), 'webp' (an image) */
  codec: 'h16' | 'rgba8' | 'webp';
  half: number;
  texel: number;
  tile: number;
  /** heights: metres = q[0] + v * q[1] */
  q?: [number, number];
  /** the value where there's no tile (heights: the open sea's floor) */
  fill?: number;
}

export class Pack<I extends PackIndex = TileIndex> {
  /** tries after the first before a tile's fetch gives up, and the first wait between them (ms, doubling) */
  retries = 3;
  backoff = 400;
  constructor(readonly index: I, readonly url: string) {}
  /** a pack by its index's name: <dir>/<name>.json, the pack beside it */
  static async load<I extends PackIndex = TileIndex>(assets: Assets, name: string, dir = 'tiles'): Promise<Pack<I>> {
    const index = await assets.json<I>(`${dir}/${name}.json`);
    return new Pack<I>(index, assets.url(`${dir}/${index.file}`));
  }
  /** whether there's a tile at (row, col) */
  has(r: number, c: number) {
    const g = this.index.grid;
    return r >= 0 && c >= 0 && r < g && c < g && this.index.lengths[r * g + c] > 0;
  }
  /** a tile's bytes (null where there's none); aborted with `signal`, retried on a network error or a bad status */
  async bytes(r: number, c: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    if (!this.has(r, c)) return null;
    const k = r * this.index.grid + c;
    return this.range(this.index.offsets[k], this.index.lengths[k], signal);
  }
  /** a run of the pack's bytes, `n` from `a` (a block of neighbouring tiles in one request: San Francisco's streamer
   *  fetches a row's run of tiles at once), retried like a tile */
  async range(a: number, n: number, signal?: AbortSignal): Promise<ArrayBuffer> {
    for (let tries = 0; ; tries++) {
      try {
        const res = await fetch(this.url, { headers: { Range: `bytes=${a}-${a + n - 1}` }, signal });
        if (res.status === 206) return await res.arrayBuffer();
        // (a server that ignores the range sends the whole pack: take our part of it)
        if (res.ok) return (await res.arrayBuffer()).slice(a, a + n);
        throw new Error(`${this.index.name} ${a}+${n}: ${res.status}`);
      } catch (e) {
        if (signal?.aborted || tries >= this.retries) throw e;
        await new Promise((ok) => setTimeout(ok, this.backoff * 2 ** tries));
      }
    }
  }
}

/** an h16 height tile's metres (n×n): deflated; two planes, the high bytes' then the low's, of u16s each predicted from
 *  the one before it in its row (a row's first from the one above it), the difference zig-zagged */
export async function decodeH16(b: ArrayBuffer | Uint8Array, n: number, q: [number, number]): Promise<Float32Array> {
  return unpackH16(await inflate(b), n, q);
}
/** decodeH16's second half, on bytes already inflated */
export function unpackH16(raw: Uint8Array, n: number, q: [number, number]): Float32Array {
  const out = new Float32Array(n * n);
  const lo = n * n;
  const [off, step] = q;
  let first = 0;
  for (let r = 0; r < n; r++) {
    let prev = first;
    const row = r * n;
    for (let c = 0; c < n; c++) {
      const k = row + c;
      const z = (raw[k] << 8) | raw[lo + k];
      const v = (prev + ((z >>> 1) ^ -(z & 1))) & 0xffff;
      if (c === 0) first = v;
      prev = v;
      out[k] = off + v * step;
    }
  }
  return out;
}
/** the inverse of unpackH16 (before deflating): u16 values (0..65535) to the two planes — for tests and tools */
export function packH16(v: ArrayLike<number>, n: number): Uint8Array {
  const out = new Uint8Array(2 * n * n), lo = n * n;
  let first = 0;
  for (let r = 0; r < n; r++) {
    let prev = first;
    for (let c = 0; c < n; c++) {
      const k = r * n + c, x = v[k] & 0xffff;
      let d = (x - prev) & 0xffff;
      if (d >= 0x8000) d -= 0x10000;
      const z = ((d << 1) ^ (d >> 31)) & 0xffff;
      out[k] = z >> 8;
      out[lo + k] = z & 0xff;
      if (c === 0) first = x;
      prev = x;
    }
  }
  return out;
}
