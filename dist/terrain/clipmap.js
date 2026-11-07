/** how long a tile takes to fade in (s), and the rect's easing (s) */
const FADE = 0.5;
const EASE = 0.3;
/** the slots a level may have (8x8: the uniform's room) */
export const MAX_SLOTS = 64;
/** the levels the residency uniform has: heights 0-3, colour 4-7, surface classes 8 */
export const MAX_LEVELS = 9;
/** one level's window */
export class ClipLevel {
    set;
    kind;
    layer;
    index;
    pack;
    window;
    shrink;
    n;
    grid;
    texel;
    half;
    tile;
    /** the window's first tile (column, row) */
    c0 = 0;
    r0 = 0;
    /** what's in (x0, z0, x1, z1, m), and the rect drawn: eased toward it */
    rect = [0, 0, 0, 0];
    shown = [0, 0, 0, 0];
    blend;
    /** a whole level (its window is its grid): never moves */
    whole;
    /** how much detail a tile adds, for the queue (ClipStream rank) */
    scale;
    /** the coarsest of the heights' or the colours' levels: asked a little ahead of the rest */
    coarsest;
    slots;
    placed = false;
    constructor(set, kind, layer, index, pack, window, shrink, levels = 4) {
        this.set = set;
        this.kind = kind;
        this.layer = layer;
        this.index = index;
        this.pack = pack;
        this.window = window;
        this.shrink = shrink;
        const ix = pack.index;
        this.tile = ix.tile;
        this.grid = ix.grid;
        this.texel = ix.texel;
        this.half = ix.half;
        this.n = Math.min(window / ix.tile, ix.grid, Math.sqrt(MAX_SLOTS));
        this.whole = this.n >= this.grid;
        this.scale = kind === 'color' ? ix.texel * 2 : ix.texel;
        this.coarsest = kind !== 'mat' && layer === levels - 1;
        this.slots = Array.from({ length: this.n * this.n }, () => ({ r: -1, c: -1, state: 'loading', retry: 0, res: -1, alpha: 0 }));
        this.blend = Math.max(this.n * this.tile * this.texel * 0.1, this.texel * 8);
    }
    /** the uniform: texel (m), window (px), half extent (m), blend (m) */
    get uniform() { return [this.texel, this.n * this.tile, this.half, this.blend]; }
    /** the residency uniform's per-level part: a tile's size (m), the window's tiles a side, the grid's */
    get tileInfo() { return [this.tile * this.texel, this.n, this.grid, 0]; }
    /** a world point's tile coordinates (fractional) */
    tileOf(x, z) {
        const s = this.tile * this.texel;
        return [(x + this.half) / s, (z + this.half) / s];
    }
    /** the window's first tile for a camera at (x, z) */
    windowAt(x, z) {
        const [tx, tz] = this.tileOf(x, z), n = this.n;
        const want = (t) => Math.max(0, Math.min(this.grid - n, Math.round(t - n / 2)));
        return [want(tx), want(tz)];
    }
    /** a tile's middle and half its side (m) */
    middle(r, c) {
        const s = this.tile * this.texel;
        return [-this.half + (c + 0.5) * s, -this.half + (r + 0.5) * s, s / 2];
    }
    /** the queue's order for a tile of this level (Infinity once the window's let it go) */
    prio(r, c) {
        if (!this.wants(r, c))
            return Infinity;
        // (the coarsest levels a little ahead of the rest: under everything, where they're missing the land's flat)
        const [x, z, h] = this.middle(r, c);
        return this.set.stream.rank(x, z, h, this.scale) - (this.coarsest ? 100 : 0);
    }
    /** follow the camera: slide the window when it's left the middle tile by most of a tile */
    follow(x, z) {
        const [tx, tz] = this.tileOf(x, z), n = this.n;
        if (!this.placed) {
            [this.c0, this.r0] = this.windowAt(x, z);
            this.placed = true;
        }
        else {
            const [wc, wr] = this.windowAt(x, z);
            if (Math.abs(tx - (this.c0 + n / 2)) > 0.75)
                this.c0 = wc;
            if (Math.abs(tz - (this.r0 + n / 2)) > 0.75)
                this.r0 = wr;
        }
        // (every tile of the window asked for; a slot whose tile has left is taken over, its old tile kept until the new
        // one's written over it)
        const now = performance.now();
        for (let r = this.r0; r < this.r0 + n; r++)
            for (let c = this.c0; c < this.c0 + n; c++) {
                const s = this.slots[(r % n) * n + (c % n)];
                if (s.r === r && s.c === c) {
                    if (s.retry && now > s.retry) {
                        s.retry = 0;
                        this.set.request(this, r, c);
                    }
                    continue;
                }
                s.r = r;
                s.c = c;
                s.state = 'loading';
                s.retry = 0;
                this.set.request(this, r, c);
            }
    }
    /** whether (r, c) is still this window's, in its slot */
    wants(r, c) {
        const n = this.n, s = this.slots[(r % n) * n + (c % n)];
        return s.r === r && s.c === c;
    }
    /** whether a tile's data may be written over its slot's now: the slot's old tile is out of the drawn rect */
    canPut(r, c) {
        const n = this.n, s = this.slots[(r % n) * n + (c % n)];
        if (s.res < 0 || s.alpha <= 0)
            return true;
        const or = Math.floor(s.res / this.grid), oc = s.res % this.grid;
        if (or === r && oc === c)
            return true;
        const [x, z, h] = this.middle(or, oc), q = this.shown;
        return !(x + h > q[0] && x - h < q[2] && z + h > q[1] && z - h < q[3]);
    }
    /** a tile's data is in its slot now: it starts fading in */
    put(r, c, data) {
        const n = this.n, s = this.slots[(r % n) * n + (c % n)];
        s.res = r * this.grid + c;
        s.data = data;
        s.alpha = this.set.instant ? 1 : 0;
        s.state = 'in';
        this.measure();
    }
    /** a tile that couldn't be had: asked again on the next follow */
    failed(r, c) {
        const n = this.n, s = this.slots[(r % n) * n + (c % n)];
        if (s.r === r && s.c === c && s.state !== 'in')
            s.retry = performance.now() + 2000;
    }
    /** the fades and the rect's easing, a frame on; whether anything's still moving */
    tick(dt) {
        let moving = false;
        for (const s of this.slots) {
            if (s.res >= 0 && s.alpha < 1) {
                s.alpha = Math.min(1, s.alpha + dt / FADE);
                moving = true;
            }
        }
        this.measure();
        const t = this.rect, q = this.shown;
        const empty = (a) => a[2] <= a[0] || a[3] <= a[1];
        if (empty(t)) {
            q[0] = q[1] = q[2] = q[3] = 0;
            return moving;
        }
        // (from nothing, or nowhere near: the rect starts where it's going — the tiles' own fades bring them in)
        if (empty(q) || t[0] >= q[2] || t[2] <= q[0] || t[1] >= q[3] || t[3] <= q[1] || this.set.instant) {
            q[0] = t[0];
            q[1] = t[1];
            q[2] = t[2];
            q[3] = t[3];
            return moving;
        }
        // (eased, and never slower than a tile in EASE * 2: a slot waiting on it isn't kept long)
        const k = 1 - Math.exp(-dt / EASE), least = (this.tile * this.texel * dt) / (EASE * 2);
        for (let i = 0; i < 4; i++) {
            const d = t[i] - q[i], step = Math.max(Math.abs(d) * k, least);
            if (Math.abs(d) <= step)
                q[i] = t[i];
            else {
                q[i] += Math.sign(d) * step;
                moving = true;
            }
        }
        return moving;
    }
    /** the slots' residency for the shader: (tile + 1) << 8 | fade, row by row of the window's slots */
    residency(out, at) {
        for (let k = 0; k < this.slots.length; k++) {
            const s = this.slots[k];
            out[at + k] = s.res >= 0 ? (((s.res + 1) << 8) | Math.round(s.alpha * 255)) >>> 0 : 0;
        }
    }
    /** the rect that's in: the window, its edges pulled in past any row or column still loading */
    measure() {
        const n = this.n;
        let c0 = this.c0, c1 = this.c0 + n - 1, r0 = this.r0, r1 = this.r0 + n - 1;
        const isIn = (r, c) => { const s = this.slots[(r % n) * n + (c % n)]; return s.state === 'in' && s.r === r && s.c === c; };
        for (let guard = 0; guard < 4 * n && c0 <= c1 && r0 <= r1; guard++) {
            let moved = false;
            for (let r = r0; r <= r1; r++) {
                if (!isIn(r, c0)) {
                    c0++;
                    moved = true;
                    break;
                }
            }
            if (c0 > c1)
                break;
            for (let r = r0; r <= r1; r++) {
                if (!isIn(r, c1)) {
                    c1--;
                    moved = true;
                    break;
                }
            }
            if (c0 > c1)
                break;
            for (let c = c0; c <= c1; c++) {
                if (!isIn(r0, c)) {
                    r0++;
                    moved = true;
                    break;
                }
            }
            if (r0 > r1)
                break;
            for (let c = c0; c <= c1; c++) {
                if (!isIn(r1, c)) {
                    r1--;
                    moved = true;
                    break;
                }
            }
            if (!moved)
                break;
        }
        const s = this.tile * this.texel, h = this.half, k = this.shrink * this.texel;
        if (c0 > c1 || r0 > r1) {
            this.rect = [0, 0, 0, 0];
            return;
        }
        this.rect = [-h + c0 * s + k, -h + r0 * s + k, -h + (c1 + 1) * s - k, -h + (r1 + 1) * s - k];
    }
    /** the share of the window's tiles in */
    get progress() {
        let k = 0;
        for (const s of this.slots)
            if (s.state === 'in')
                k++;
        return k / this.slots.length;
    }
    /** a height from the CPU's copy (NaN where it's not in) */
    heightAt(x, z) {
        const q = this.shown;
        if (x < q[0] || x > q[2] || z < q[1] || z > q[3])
            return NaN;
        const T = this.tile, n = this.n, g = this.grid;
        const gx = (x + this.half) / this.texel - 0.5, gz = (z + this.half) / this.texel - 0.5;
        const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
        const at = (cx, cz) => {
            const tc = Math.floor(cx / T), tr = Math.floor(cz / T);
            const s = this.slots[(((tr % n) + n) % n) * n + (((tc % n) + n) % n)];
            if (!s.data || s.res !== tr * g + tc)
                return NaN;
            return s.data[(cz - tr * T) * T + (cx - tc * T)];
        };
        const a = at(ix, iz), b = at(ix + 1, iz), c = at(ix, iz + 1), d = at(ix + 1, iz + 1);
        return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
    }
    /** the window round (x, z)'s tiles that aren't here or in the cache, fetched into it (a flight's destination, the
     *  road ahead); `live` says when it's moot */
    prefetch(x, z, live) {
        if (this.whole)
            return;
        const [c0, r0] = this.windowAt(x, z), n = this.n;
        for (let r = r0; r < r0 + n; r++)
            for (let c = c0; c < c0 + n; c++) {
                if (this.wants(r, c) || this.set.stream.cached(this.pack, r, c))
                    continue;
                const [mx, mz, h] = this.middle(r, c);
                this.set.stream.prefetch(this.pack, r, c, () => (live() ? Math.hypot(Math.max(Math.abs(mx - x) - h, 0), Math.max(Math.abs(mz - z) - h, 0)) / this.scale : Infinity));
            }
    }
}
/** every level of every layer, and what they stream through */
export class ClipSet {
    kit;
    stream;
    heightWindow;
    colorWindow;
    heights;
    colors;
    mats;
    h = [];
    c = [];
    m = null;
    /** decoded tiles waiting for their upload (the frame's allowance, their slot let go of) */
    ready = [];
    inflight = 0;
    /** tiles written in all (a terrain's bounds are measured again where they changed: `changed`) */
    version = 0;
    /** the squares (x0, z0, x1, z1) of the height tiles written since the terrain last looked */
    changed = [];
    /** the residency of every level's slots (clipmap.wgsl clipTileSlot) */
    slots = new Uint32Array(MAX_LEVELS * MAX_SLOTS);
    /** whether a level is still fading or easing (the uniform's rewritten while so) */
    fades = true;
    /** new tiles in at once, no fade (the first view, behind a splash) */
    instant = true;
    decode = { height: () => Promise.reject(new Error('no decoder')), mat: () => Promise.reject(new Error('no decoder')) };
    fill0 = 0;
    ahead0 = { speed: 25, every: 400, seconds: 4, reach: 1500, texel: 4 };
    lastTick = performance.now();
    ahead = 0;
    aheadAt = 0;
    dest = 0;
    constructor(kit, stream, heightWindow, colorWindow) {
        this.kit = kit;
        this.stream = stream;
        this.heightWindow = heightWindow;
        this.colorWindow = colorWindow;
        this.heights = kit.texture({ label: 'clip.heights', format: 'r32float', size: [heightWindow, heightWindow, 4], view: '2d-array', usage: ['sample', 'copy-dst'] });
        this.colors = kit.texture({ label: 'clip.colors', format: 'rgba8unorm-srgb', size: [colorWindow, colorWindow, 4], mips: 3, view: '2d-array', usage: ['sample', 'copy-dst', 'render'] });
        this.mats = kit.texture({ label: 'clip.mats', format: 'rgba8unorm', size: [heightWindow, heightWindow], usage: ['sample', 'copy-dst'] });
    }
    /** the textures and every level, once the packs' indexes are in (a pack that isn't there: its level left out) */
    static async create(kit, stream, heightWindow, colorWindow, o) {
        const set = new ClipSet(kit, stream, heightWindow, colorWindow);
        set.decode = o.decode;
        set.fill0 = o.fill ?? 0;
        Object.assign(set.ahead0, o.ahead ?? {});
        const load = (n) => o.load(n).catch((e) => { console.warn(`[clip] no pack ${n}`, e); return null; });
        const [hp, cp, mp] = await Promise.all([
            Promise.all(o.heights.slice(0, 4).map(load)),
            Promise.all(o.colors.slice(0, 4).map(load)),
            o.mat ? load(o.mat) : Promise.resolve(null),
        ]);
        hp.forEach((p, i) => { if (p)
            set.h[i] = new ClipLevel(set, 'height', i, i, p, heightWindow, 1, hp.length); });
        cp.forEach((p, i) => { if (p)
            set.c[i] = new ClipLevel(set, 'color', i, 4 + i, p, colorWindow, 4, cp.length); });
        if (mp)
            set.m = new ClipLevel(set, 'mat', 0, 8, mp, heightWindow, 1, 1);
        // (a block no wider than a level's window, and a whole level's rows at once)
        for (const L of set.levels)
            stream.width(L.pack, L.whole ? L.grid : L.n);
        return set;
    }
    get levels() { return [...this.h, ...this.c, this.m].filter((l) => !!l); }
    /** each frame: the windows follow the camera, the decoded tiles go up (within the frame's allowance), the fades
     *  move on; and the road ahead of a fast camera prefetched */
    follow(x, z) {
        for (const l of this.levels)
            l.follow(x, z);
        const now = performance.now(), dt = Math.min(0.1, (now - this.lastTick) / 1000);
        this.lastTick = now;
        this.upload();
        let moving = false;
        for (const l of this.levels)
            moving = l.tick(dt) || moving;
        this.fades = moving;
        const v = this.stream.view, speed = Math.hypot(v.vx, v.vz), A = this.ahead0;
        if (speed > A.speed && now - this.aheadAt > A.every) {
            this.aheadAt = now;
            const id = ++this.ahead, t = Math.min(A.seconds, A.reach / speed);
            for (const l of this.levels)
                if (l.texel <= A.texel)
                    l.prefetch(x + v.vx * t, z + v.vz * t, () => this.ahead === id);
        }
    }
    /** the land round a place fetched ahead of arriving there (a flight's destination): until the next, or 30 s */
    prefetch(x, z) {
        const id = ++this.dest, until = performance.now() + 30000;
        for (const l of this.levels)
            l.prefetch(x, z, () => this.dest === id && performance.now() < until);
    }
    /** a tile asked of the streamer, decoded, and queued for its upload */
    request(L, r, c) {
        void this.stream.get(L.pack, r, c, () => L.prio(r, c)).then(async (bytes) => {
            if (!L.wants(r, c))
                return;
            if (bytes === undefined) {
                L.failed(r, c);
                return;
            }
            const ix = L.pack.index, T = ix.tile, n = L.n;
            const x = (c % n) * T, y = (r % n) * T;
            this.inflight++;
            try {
                if (L.kind === 'height') {
                    const h = bytes ? await this.decode.height(bytes, T, ix.q) : new Float32Array(T * T).fill(ix.fill ?? this.fill0);
                    if (!L.wants(r, c))
                        return;
                    this.queue(L, r, c, h.byteLength, () => {
                        this.heights.write(h, { layer: L.layer, origin: [x, y], width: T, height: T });
                        L.put(r, c, h);
                        const [mx, mz, hs] = L.middle(r, c);
                        this.changed.push([mx - hs, mz - hs, mx + hs, mz + hs]);
                    });
                }
                else if (L.kind === 'mat') {
                    const m = bytes ? await this.decode.mat(bytes) : new Uint8Array(T * T * 4);
                    if (!L.wants(r, c))
                        return;
                    this.queue(L, r, c, m.byteLength, () => { this.mats.write(m, { origin: [x, y], width: T, height: T }); L.put(r, c); });
                }
                else if (bytes) {
                    const blob = new Blob([bytes], { type: 'image/webp' });
                    const o = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
                    const mips = await Promise.all([
                        createImageBitmap(blob, o),
                        createImageBitmap(blob, { ...o, resizeWidth: T / 2, resizeHeight: T / 2, resizeQuality: 'high' }),
                        createImageBitmap(blob, { ...o, resizeWidth: T / 4, resizeHeight: T / 4, resizeQuality: 'high' }),
                    ]);
                    if (!L.wants(r, c)) {
                        mips.forEach((m) => m.close());
                        return;
                    }
                    this.queue(L, r, c, T * T * 4 * 1.33, () => {
                        mips.forEach((m, k) => {
                            this.kit.queue.copyExternalImageToTexture({ source: m }, { texture: this.colors.gpu, mipLevel: k, origin: [x >> k, y >> k, L.layer] }, [T >> k, T >> k, 1]);
                            m.close();
                        });
                        L.put(r, c);
                    }, () => mips.forEach((m) => m.close()));
                }
                else {
                    this.queue(L, r, c, T * T * 4 * 1.33, () => {
                        for (let k = 0; k < 3; k++) {
                            const s = T >> k;
                            this.colors.write(new Uint8Array(s * s * 4), { mip: k, layer: L.layer, origin: [x >> k, y >> k], width: s, height: s });
                        }
                        L.put(r, c);
                    });
                }
            }
            catch (e) {
                console.warn(`[clip] ${ix.name} ${r},${c}`, e);
                L.failed(r, c);
            }
            finally {
                this.inflight--;
            }
        });
    }
    queue(level, r, c, bytes, put, drop) {
        this.ready.push({ level, r, c, bytes, put, drop, since: performance.now() });
    }
    /** the decoded tiles up, nearest the view first, as many as the frame's allowance takes; a slot whose old tile's
     *  still drawn waits for the rect to ease off it (a second and a half at most) */
    upload() {
        if (!this.ready.length)
            return;
        const now = performance.now();
        this.ready = this.ready.filter((j) => { if (j.level.wants(j.r, j.c))
            return true; j.drop?.(); return false; });
        this.ready.sort((a, b) => a.level.prio(a.r, a.c) - b.level.prio(b.r, b.c));
        const keep = [];
        for (const j of this.ready) {
            if (!j.level.canPut(j.r, j.c) && now - j.since < 1500) {
                keep.push(j);
                continue;
            }
            if (!this.stream.upload(j.bytes)) {
                keep.push(j);
                continue;
            }
            j.put();
            this.version++;
        }
        this.ready = keep;
    }
    /** the ground's height at (x, z): the finest height level that's in there */
    heightAt(x, z) {
        for (const L of this.h) {
            if (!L)
                continue;
            const v = L.heightAt(x, z);
            if (!Number.isNaN(v))
                return v;
        }
        return 0;
    }
    /** the uniforms clipmap.wgsl and a terrain read: per level its uniform and its drawn rect, the residency */
    fill(u) {
        const info = [];
        for (let i = 0; i < 4; i++) {
            const h = this.h[i], c = this.c[i];
            u.hLevel[i] = h ? h.uniform : [1, 1, 0, 1];
            u.hRect[i] = h ? h.shown : [0, 0, 0, 0];
            u.cLevel[i] = c ? c.uniform : [1, 1, 0, 1];
            u.cRect[i] = c ? c.shown : [0, 0, 0, 0];
            info[i] = h ? h.tileInfo : [1, 1, 1, 0];
            info[4 + i] = c ? c.tileInfo : [1, 1, 1, 0];
        }
        u.mLevel = this.m ? this.m.uniform : [1, 1, 0, 1];
        u.mRect = this.m ? this.m.shown : [0, 0, 0, 0];
        info[8] = this.m ? this.m.tileInfo : [1, 1, 1, 0];
        for (const L of this.levels)
            L.residency(this.slots, L.index * MAX_SLOTS);
        u.tileInfo = info;
        u.tileSlots = this.slots;
    }
    /** the share of every window that's in */
    get progress() {
        const ls = this.levels;
        if (!ls.length)
            return 1;
        return ls.reduce((a, l) => a + l.progress, 0) / ls.length;
    }
    /** the share of the coarse land in: each kind's coarsest level (whole, over everything, but on a phone's small
     *  windows; the rest's wanted by what's in view: ClipStream rank) */
    get coarse() {
        const ls = this.levels.filter((l) => l.whole || l.coarsest);
        return ls.length ? ls.reduce((a, l) => a + l.progress, 0) / ls.length : 1;
    }
    /** tiles fetched and waiting to be decoded or uploaded */
    get waiting() { return this.ready.length + this.inflight; }
    /** tiles still to come: asked, decoding, or waiting for their upload */
    get pending() {
        let n = 0;
        for (const l of this.levels)
            n += Math.round((1 - l.progress) * l.n * l.n);
        return n;
    }
}
//# sourceMappingURL=clipmap.js.map