// The sprite clouds' skies (skyclouds.ts): what kinds of cloud a sky has, how many, how big, how high (a recipe), and
// how each cloud is built from puffs. Boulder's skies (its weather.ts: every kind it has, varied by a seed as its days
// are) and Drake's Highland one, on one recipe:
//   cumulus    heaps on a grid of cells drifting with the wind, a few hundred metres to a couple of km across, flat
//              bases, lifted clear of the ground they drift over (SkyClouds.ground), favouring the high ground
//   fractus    small ragged wisps low down, thin
//   towers     a coarser grid of towering cumulus, now and then trailing rain, some grown into cumulonimbus with their
//              anvils spread downwind and rain shafts under them
//   lenses     lenticular caps standing still, over the highest peaks (`at: 'peaks'`) or in a wave train upwind
//   layers     up to four decks (low, mid, high, wave): a slab each, its density the baked noise — stratus, strato-,
//              alto- and cirrocumulus, altostratus, cirrus (fibres, a 22-degree halo), the chinook's wave deck that ends
//              in a clean line across the wind
//   cirrus     loom's own high ice cloud, in its sky shader (world.cloudCover)
// Heights are world y (m). Every cloud lives a while — forms, grows its upper puffs, matures, thins away — on the
// clouds' own clock, and another takes its slot somewhere else in the same patch of sky.
/** a small seeded generator (mulberry32) */
export function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hash3 = (a, b, c) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
export function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
export const DECK_SLOTS = ['low', 'mid', 'high', 'wave'];
export const SKY_KINDS = ['highland', 'clear', 'fair cumulus', 'towering cumulus', 'thunderstorm', 'stratocumulus', 'altocumulus', 'cirrus', 'chinook', 'overcast', 'altostratus'];
/** Drake's Highland: a late-summer afternoon over an 8 km glen in a ring of 700–1400 m mountains — fair cumulus building
 *  over the hills, wisps in the glens, towers far off, caps over the peaks, a patch of altocumulus high over it all */
export const HIGHLAND = {
    wind: [4.6, -1.9],
    cumulus: { cover: 1.25, base: 880, size: [340, 1500], tall: [0.45, 0.9], dark: 0.12 },
    fractus: { cover: 0.45, base: [430, 640], size: [110, 300], alpha: 0.6 },
    towers: { chance: 0.42, base: 1050, size: [1500, 2600], tall: [1.05, 1.6], rain: 0.35, storm: 0.16, stormTop: 7200, clear: 7500 },
    lenses: { count: 2, at: 'peaks', above: [320, 620] },
    layers: { mid: { cover: 0.3, base: 3800, thick: 240, tau: 2.3, scale: 4200, lumpy: 1, streak: 0.08, halo: 0, patches: true, bright: 1, offset: 0.13 } },
    cirrus: 0.35,
    paint: 0.55,
};
/** a sky of a kind: Boulder's recipe for it (its weather.ts), varied by the seed as its days are — the same seed, the
 *  same sky. Boulder's heights were over its site; here they're world y over ground near sea level. */
export function skyRecipe(kind, seed = 0) {
    if (kind === 'highland')
        return copyRecipe(HIGHLAND);
    const r = rng((seed >>> 0) ^ 0x9e3779b9);
    const between = (a, b) => a + (b - a) * r();
    let speed = between(6, 13), from = between(245, 300);
    const out = { wind: [0, 0], cell: 2500, range: 28000, cumulus: null, fractus: null, towers: null, lenses: null, layers: {}, cirrus: 0, paint: 0 };
    const cirrus = (cover) => ({ cover, base: between(6500, 9000), thick: between(300, 700), tau: between(0.08, 0.35), scale: between(10000, 16000), lumpy: 0, streak: 1, halo: 0 });
    // (Boulder's heaps, a midsummer afternoon's: its convection's base, its sizes' long tail, and its cover — three
    // candidates a cell, half turned away off the high ground, each living an hour or two of the afternoon — as cells'
    // slots, each cloud living most of its slot's period; the share turned away off the high ground taken back into the
    // candidates, so a sky over flat ground keeps Boulder's cover. They reach the horizon as Boulder's do.)
    const cuBase = 2100 + between(-200, 250);
    const heaps = (cover, size, tall, virga, dark, mountains, hills = mountains * 0.5) => ({
        cover: cover * 0.42 / (1 - hills), base: cuBase, size: [size * 0.62, size * 2.2], tall: [tall * 0.5, tall * 1.25],
        dark, virga, hills, high: [cuBase * 0.25, cuBase * 0.75], patch: [0.35, 1.4], life: [2200, 5400], full: true,
    });
    switch (kind) {
        case 'clear': break;
        case 'fair cumulus':
            out.cumulus = heaps(between(0.7, 1.2), between(800, 1400), between(0.45, 0.75), 0, 0.1, between(0.5, 0.85));
            if (r() < 0.35)
                out.layers.high = cirrus(between(0.15, 0.4));
            break;
        case 'towering cumulus':
            out.cumulus = heaps(between(0.4, 0.7), between(1300, 2200), between(0.9, 1.5), between(0.1, 0.3), 0.3, between(0.55, 0.9));
            if (r() < 0.3)
                out.layers.mid = { cover: between(0.2, 0.4), base: between(3600, 4800), thick: 250, tau: between(1.5, 3.5), scale: between(2600, 3800), lumpy: 1, streak: 0, halo: 0 };
            break;
        case 'thunderstorm': {
            out.cumulus = heaps(between(0.5, 0.85), between(1000, 1600), between(0.8, 1.4), between(0.15, 0.35), 0.35, between(0.6, 0.9));
            // (its storms: a few cumulonimbus standing kilometres off, born over the high ground and crawling downwind)
            const count = between(2, 4.6);
            out.towers = { chance: 0.06 * count, base: cuBase - 150, size: [2200, 3400], tall: [1.1, 1.6], rain: 0.6, storm: 0.85, stormTop: between(8500, 10500), stormSize: [5000, 9000], clear: 9000, cell: 16000, range: 70000, full: true };
            out.layers.high = { ...cirrus(between(0.2, 0.45)), base: between(8000, 9500) };
            speed = between(7, 12);
            break;
        }
        case 'stratocumulus':
            out.layers.low = { cover: between(0.6, 0.95), base: between(800, 1700), thick: between(450, 800), tau: between(8, 16), scale: between(9000, 14000), lumpy: between(0.75, 1), streak: 0, halo: 0 };
            break;
        case 'altocumulus':
            out.layers.mid = { cover: between(0.45, 0.75), base: between(3200, 5200), thick: between(150, 300), tau: between(2, 5), scale: between(2500, 4000), lumpy: 1, streak: between(0, 0.25), halo: 0 };
            if (r() < 0.4)
                out.layers.high = cirrus(between(0.2, 0.5));
            break;
        case 'cirrus':
            out.layers.high = cirrus(between(0.3, 0.75));
            if (r() < 0.3)
                out.layers.high.halo = between(0.5, 1);
            speed = between(15, 35);
            break;
        case 'chinook':
            out.lenses = { count: Math.round(between(2, 5.4)), at: 'upwind', base: between(3200, 5600), reach: 60000 };
            out.layers.wave = { cover: between(0.85, 1), base: between(3600, 4600), thick: between(500, 900), tau: between(5, 10), scale: between(14000, 22000), lumpy: between(0.2, 0.45), streak: between(0.25, 0.5), halo: 0, band: [between(-3160, 3340), between(900, 2200)] };
            if (r() < 0.5)
                out.layers.high = cirrus(between(0.2, 0.45));
            speed = between(20, 32);
            from = between(260, 290);
            break;
        case 'overcast':
            out.layers.low = { cover: 1, base: between(250, 1000), thick: between(800, 1500), tau: between(16, 32), scale: between(10000, 16000), lumpy: between(0.2, 0.4), streak: 0, halo: 0 };
            // (upslope: the wind comes from the plains)
            speed = between(3, 8);
            from = between(40, 100);
            break;
        case 'altostratus':
            out.layers.mid = { cover: between(0.9, 1), base: between(3500, 5000), thick: 1000, tau: between(2.5, 5.5), scale: between(16000, 24000), lumpy: between(0.05, 0.2), streak: between(0, 0.3), halo: 0 };
            if (r() < 0.3)
                out.layers.low = { cover: between(0.25, 0.5), base: between(1000, 1800), thick: 400, tau: between(3, 6), scale: between(9000, 14000), lumpy: 0.85, streak: 0, halo: 0 };
            break;
    }
    // (Boulder's wind: m/s and where it blows from, 270 from the west)
    const to = ((from + 180) * Math.PI) / 180;
    out.wind = [Math.sin(to) * speed, -Math.cos(to) * speed];
    return out;
}
export function copyRecipe(r) {
    const L = {};
    for (const s of DECK_SLOTS) {
        const l = r.layers[s];
        if (l)
            L[s] = { ...l, band: l.band && [...l.band] };
    }
    return {
        ...r, wind: [...r.wind], layers: L,
        cumulus: r.cumulus && { ...r.cumulus }, fractus: r.fractus && { ...r.fractus }, towers: r.towers && { ...r.towers }, lenses: r.lenses && { ...r.lenses },
    };
}
/** a cumulus heap: broad puffs across the base, their bottoms cut flat by the condensation level, then a lumpy crown
 *  piled toward the middle; `rel` is how far up each sits (the order they come in as it grows). `full`: Boulder's
 *  counts (a puff more at the least) */
export function heap(c, r, full = false) {
    const W = c.w, H = c.h;
    const ang = r() * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang), stretch = 0.55 + 0.45 * r();
    const ellipse = (u, v) => [(u * ca - v * stretch * sa) * W * 0.5, (u * sa + v * stretch * ca) * W * 0.5];
    // (seen from the ground the base is what shows: enough of them to close it)
    const nb = Math.max(full ? 7 : 6, Math.round(W / 70));
    for (let i = 0; i < nb; i++) {
        const a = r() * Math.PI * 2, q = 0.1 + 0.85 * Math.sqrt(r());
        const [dx, dz] = ellipse(Math.cos(a) * q, Math.sin(a) * q);
        const pr = W * (0.15 + 0.09 * r()) * (1 - 0.3 * q);
        c.puffs.push({ dx, dy: pr * 0.45, dz, r: pr, seed: r(), rel: 0, kind: 0, len: 0 });
    }
    const nt = Math.max(full ? 6 : 5, Math.round(W / 50 * Math.min(1.8, 0.6 + c.h / W)));
    const lean = [(r() - 0.5) * 0.4, (r() - 0.5) * 0.4];
    for (let i = 0; i < nt; i++) {
        const a = r() * Math.PI * 2, q = Math.pow(r(), 0.7) * 0.72;
        const [dx, dz] = ellipse(Math.cos(a) * q + lean[0], Math.sin(a) * q + lean[1]);
        const top = Math.pow(Math.max(0, 1 - q * q * 1.6), 0.7);
        const dy = H * top * (0.4 + 0.6 * r());
        const pr = W * (0.08 + 0.09 * r()) * (1 - 0.3 * dy / Math.max(H, 1));
        const y = Math.max(dy, pr * 0.7);
        c.puffs.push({ dx, dy: y, dz, r: pr, seed: r(), rel: Math.min(1, y / Math.max(H, 1)), kind: 0, len: 0 });
    }
}
/** a ragged wisp (fractus): a few small puffs strung out along the wind, no crown, a thin flat-ish body */
export function wisp(c, r, wind) {
    const W = c.w;
    const wl = Math.hypot(wind[0], wind[1]) || 1, wx = wind[0] / wl, wz = wind[1] / wl;
    const n = 4 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
        const along = (r() - 0.5) * 1.3, side = (r() - 0.5) * 0.45;
        const pr = W * (0.16 + 0.14 * r());
        c.puffs.push({ dx: (wx * along - wz * side) * W, dy: pr * (0.3 + 0.5 * r()), dz: (wz * along + wx * side) * W, r: pr, seed: r(), rel: 0.3 * r(), kind: 0, len: 0 });
    }
}
/** a cumulonimbus: a broad dark base, a column of billows to the top, an anvil spread flat downwind (`full`: Boulder's
 *  counts, for its bigger storms) */
export function tower(c, r, wind, full = false) {
    const W = c.w, H = c.h;
    const wl = Math.hypot(wind[0], wind[1]) || 1, wx = wind[0] / wl, wz = wind[1] / wl;
    const [nb, nc, na] = full ? [40, 170, 90] : [34, 130, 70];
    for (let i = 0; i < nb; i++) {
        const a = r() * Math.PI * 2, q = Math.sqrt(r()) * 0.5;
        const pr = W * (0.1 + 0.07 * r());
        c.puffs.push({ dx: Math.cos(a) * q * W, dy: pr * 0.4, dz: Math.sin(a) * q * W, r: pr, seed: r(), rel: 0, kind: 0, len: 0 });
    }
    for (let i = 0; i < nc; i++) {
        const h = Math.pow(r(), 0.8);
        const rad = W * 0.42 * (1 - 0.3 * h);
        const a = r() * Math.PI * 2, q = Math.sqrt(r());
        const pr = W * (0.08 + 0.07 * r()) * (1 - 0.25 * h);
        // (the tower leans downwind with height)
        c.puffs.push({ dx: Math.cos(a) * q * rad + wx * h * W * 0.25, dy: H * 0.85 * h, dz: Math.sin(a) * q * rad + wz * h * W * 0.25, r: pr, seed: r(), rel: h * 0.85, kind: 0, len: 0 });
    }
    // the anvil: wide, thin, its downwind edge farthest out
    for (let i = 0; i < na; i++) {
        const along = -0.3 + 2.4 * Math.pow(r(), 0.8), side = (r() - 0.5) * (1.1 + 0.6 * along);
        const pr = W * (0.13 + 0.1 * r());
        const dx = (wx * along - wz * side) * W, dz = (wz * along + wx * side) * W;
        // (its top cut flat: the tropopause stops it)
        c.puffs.push({ dx, dy: H * (0.86 + 0.06 * r()) - pr * 0.15 * along, dz, r: pr, seed: r(), rel: 0.6 + 0.2 * r(), kind: 0, len: 0, ceil: H * 0.96 });
    }
}
/** rain or virga: sheets hanging from under the base */
export function virga(c, r, count, len, width) {
    for (let i = 0; i < count; i++) {
        const a = r() * Math.PI * 2, q = Math.sqrt(r()) * 0.35;
        c.puffs.push({ dx: Math.cos(a) * q * c.w, dy: 0, dz: Math.sin(a) * q * c.w, r: c.w * (0.06 + 0.06 * r()) * width, seed: r(), rel: 0.5, kind: 2, len: len * (0.7 + 0.5 * r()) });
    }
}
/** the land under the sky, coarsely: each point's highest ground within a few hundred metres (a cloud drifting over a
 *  ridge is lifted clear of it, smoothly), and the peaks over `peak` m (where the caps stand), highest first */
export class Ceiling {
    ground;
    half;
    n;
    step;
    g;
    raw;
    constructor(ground, half, n = 112) {
        this.ground = ground;
        this.half = half;
        this.n = n;
        this.step = (2 * half) / (n - 1);
        const raw = this.raw = new Float32Array(n * n);
        this.g = new Float32Array(n * n);
        if (!ground)
            return;
        for (let j = 0; j < n; j++)
            for (let i = 0; i < n; i++)
                raw[j * n + i] = ground(-half + i * this.step, -half + j * this.step);
        // (the highest within ~3 cells: a cloud's edge clears the ridge, not just its middle)
        const R = 3;
        for (let j = 0; j < n; j++)
            for (let i = 0; i < n; i++) {
                let m = -1e9;
                for (let b = -R; b <= R; b++)
                    for (let a = -R; a <= R; a++) {
                        if (a * a + b * b > R * R + 1)
                            continue;
                        const ii = Math.min(n - 1, Math.max(0, i + a)), jj = Math.min(n - 1, Math.max(0, j + b));
                        m = Math.max(m, raw[jj * n + ii]);
                    }
                this.g[j * n + i] = m;
            }
    }
    /** the peaks: local maxima over ~600 m round, over `min` m, high ones first, kept 1800 m apart (the ring's summits
     *  stand near the map's edge: neighbours past it don't count) */
    peaks(min = 650) {
        const out = [];
        if (!this.ground)
            return out;
        const n = this.n, raw = this.raw, P = 6, cand = [];
        for (let j = 1; j < n - 1; j++)
            for (let i = 1; i < n - 1; i++) {
                const h = raw[j * n + i];
                if (h < min)
                    continue;
                let top = true;
                for (let b = -P; b <= P && top; b++) {
                    const jj = j + b;
                    if (jj < 0 || jj >= n)
                        continue;
                    for (let a = -P; a <= P; a++) {
                        const ii = i + a;
                        if (ii >= 0 && ii < n && raw[jj * n + ii] > h) {
                            top = false;
                            break;
                        }
                    }
                }
                if (top)
                    cand.push([-this.half + i * this.step, h, -this.half + j * this.step]);
            }
        cand.sort((a, b) => b[1] - a[1]);
        for (const c of cand)
            if (out.every((p) => Math.hypot(p[0] - c[0], p[2] - c[2]) > 1800))
                out.push(c);
        return out;
    }
    /** the highest ground near (x, z) (beyond the map: the edge's; no ground: far below everything) */
    at(x, z) {
        if (!this.ground)
            return -1e4;
        const n = this.n;
        const fx = Math.min(n - 1.001, Math.max(0, (x + this.half) / this.step)), fz = Math.min(n - 1.001, Math.max(0, (z + this.half) / this.step));
        const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, G = this.g;
        const a = G[j * n + i], b = G[j * n + i + 1], c = G[(j + 1) * n + i], d = G[(j + 1) * n + i + 1];
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    /** the highest ground under a cloud's footprint (its middle and four points round it) */
    under(x, z, rad) {
        return Math.max(this.at(x, z), this.at(x + rad, z), this.at(x - rad, z), this.at(x, z + rad), this.at(x, z - rad));
    }
}
//# sourceMappingURL=skies.js.map