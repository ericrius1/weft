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
/** a content-addressed object's URL: objects/<sha256>/<name> (it never changes, so it can be kept) */
export const isLasting = (url) => /\/objects\/[0-9a-f]{64}\//.test(url);
/** fetch, through Cache Storage `cache` for a content-addressed object (any other URL, or no Cache Storage: as usual) */
export async function fetchKept(url, init, cache) {
    if (!cache || !isLasting(url) || typeof caches === 'undefined' || (init?.headers && new Headers(init.headers).has('range')))
        return fetch(url, init);
    try {
        const c = await caches.open(cache);
        const hit = await c.match(url);
        if (hit)
            return hit;
        const r = await fetch(url, init);
        if (r.ok && r.status === 200)
            c.put(url, r.clone()).catch(() => { });
        return r;
    }
    catch {
        return fetch(url, init);
    }
}
export class Assets {
    root;
    keep;
    /** path under root → its URL (the manifest; empty until init, or with none) */
    remote = {};
    manifest;
    early;
    constructor(opts = {}) {
        this.root = opts.root ?? (typeof document === 'undefined' ? '/assets' : new URL('assets', document.baseURI).pathname);
        this.manifest = opts.manifest === undefined ? 'remote.json' : opts.manifest;
        this.keep = opts.keep ?? null;
        this.early = opts.early ?? {};
    }
    /** the page's early fetch of `rel`, once (null: none, or already taken) */
    takeEarly(rel) {
        const e = this.early[rel];
        if (!e)
            return null;
        delete this.early[rel];
        return e;
    }
    /** read the manifest (revalidated every load: a map cached from the last deploy would send moved files to this one's
     *  404s). None, or not JSON (a dev server's index.html fallback): everything's beside the app */
    async init() {
        if (!this.manifest)
            return this;
        try {
            const r = (await this.takeEarly(this.manifest)) ?? await fetch(`${this.root}/${this.manifest}`, { cache: 'no-cache' });
            if (r.ok && (r.headers.get('content-type') ?? '').includes('json'))
                this.remote = await r.json();
        }
        catch { /* none */ }
        return this;
    }
    /** the URL of a file under root */
    url(rel) { return this.remote[rel] ?? `${this.root}/${rel}`; }
    /** a file (a range's 206 counts as there); throws with its path and status when it isn't */
    async fetch(rel, init) {
        const e = init ? null : this.takeEarly(rel);
        const r = (e && await e) || await fetchKept(this.url(rel), init, this.keep);
        if (!r.ok && r.status !== 206)
            throw new Error(`${rel}: ${r.status}`);
        return r;
    }
    async json(rel) { return (await this.fetch(rel)).json(); }
    async bytes(rel) { return (await this.fetch(rel)).arrayBuffer(); }
    /** let go of the kept objects this deploy doesn't use (default: everything the manifest names is kept) */
    async forgetExcept(keep = Object.values(this.remote)) {
        if (!this.keep || typeof caches === 'undefined')
            return;
        const want = new Set([...keep].map((u) => new URL(u, location.href).href));
        const c = await caches.open(this.keep);
        for (const req of await c.keys())
            if (!want.has(req.url))
                await c.delete(req);
    }
}
/** zlib-deflated bytes inflated by the browser's own decompressor (`format` 'gzip' or 'deflate-raw' for those) */
export async function inflate(b, format = 'deflate') {
    const s = new Blob([b]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(s).arrayBuffer());
}
export class Pack {
    index;
    url;
    /** tries after the first before a tile's fetch gives up, and the first wait between them (ms, doubling) */
    retries = 3;
    backoff = 400;
    constructor(index, url) {
        this.index = index;
        this.url = url;
    }
    /** a pack by its index's name: <dir>/<name>.json, the pack beside it */
    static async load(assets, name, dir = 'tiles') {
        const index = await assets.json(`${dir}/${name}.json`);
        return new Pack(index, assets.url(`${dir}/${index.file}`));
    }
    /** whether there's a tile at (row, col) */
    has(r, c) {
        const g = this.index.grid;
        return r >= 0 && c >= 0 && r < g && c < g && this.index.lengths[r * g + c] > 0;
    }
    /** a tile's bytes (null where there's none); aborted with `signal`, retried on a network error or a bad status */
    async bytes(r, c, signal) {
        if (!this.has(r, c))
            return null;
        const k = r * this.index.grid + c;
        return this.range(this.index.offsets[k], this.index.lengths[k], signal);
    }
    /** a run of the pack's bytes, `n` from `a` (a block of neighbouring tiles in one request: San Francisco's streamer
     *  fetches a row's run of tiles at once), retried like a tile */
    async range(a, n, signal) {
        for (let tries = 0;; tries++) {
            try {
                const res = await fetch(this.url, { headers: { Range: `bytes=${a}-${a + n - 1}` }, signal });
                if (res.status === 206)
                    return await res.arrayBuffer();
                // (a server that ignores the range sends the whole pack: take our part of it)
                if (res.ok)
                    return (await res.arrayBuffer()).slice(a, a + n);
                throw new Error(`${this.index.name} ${a}+${n}: ${res.status}`);
            }
            catch (e) {
                if (signal?.aborted || tries >= this.retries)
                    throw e;
                await new Promise((ok) => setTimeout(ok, this.backoff * 2 ** tries));
            }
        }
    }
}
/** an h16 height tile's metres (n×n): deflated; two planes, the high bytes' then the low's, of u16s each predicted from
 *  the one before it in its row (a row's first from the one above it), the difference zig-zagged */
export async function decodeH16(b, n, q) {
    return unpackH16(await inflate(b), n, q);
}
/** decodeH16's second half, on bytes already inflated */
export function unpackH16(raw, n, q) {
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
            if (c === 0)
                first = v;
            prev = v;
            out[k] = off + v * step;
        }
    }
    return out;
}
/** the inverse of unpackH16 (before deflating): u16 values (0..65535) to the two planes — for tests and tools */
export function packH16(v, n) {
    const out = new Uint8Array(2 * n * n), lo = n * n;
    let first = 0;
    for (let r = 0; r < n; r++) {
        let prev = first;
        for (let c = 0; c < n; c++) {
            const k = r * n + c, x = v[k] & 0xffff;
            let d = (x - prev) & 0xffff;
            if (d >= 0x8000)
                d -= 0x10000;
            const z = ((d << 1) ^ (d >> 31)) & 0xffff;
            out[k] = z >> 8;
            out[lo + k] = z & 0xff;
            if (c === 0)
                first = x;
            prev = x;
        }
    }
    return out;
}
//# sourceMappingURL=assets.js.map