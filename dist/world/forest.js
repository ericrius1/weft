/** 'TRE2' */
export const FOREST_MAGIC = 0x32455254;
/** archetype slot mask in the runtime packed u32 (bits 0..7, 0..255) */
export const FOREST_ARCH_MASK = 255;
/** pinned-y flag in the runtime packed u32 (bit 31: 1 = use stored y directly, 0 = drape via forestGround) */
export const FOREST_PINNED_BIT = 0x80000000;
/** an instance's packed u32 (forest.wgsl forestUnpack):
 *  - bits  0..7  (8b): archetype slot (0..255)
 *  - bits  8..16 (9b): piecewise height (0..383 -> 0..38.3 m at 0.1 m; 384..511 -> 38.4..140.0 m at 0.8 m)
 *  - bits 17..23 (7b): piecewise crown radius (0..95 -> 0..9.5 m at 0.1 m; 96..127 -> 9.6..25.1 m at 0.5 m)
 *  - bits 24..30 (7b): seed (0..127 -> 0..1)
 *  - bit  31     (1b): pinnedY (1 = use exact stored y, 0 = drape on terrain via forestGround) */
export function packForest(arch, h, r, seed, pinned = false) {
    const dm = Math.round(h * 10);
    const hh = dm <= 383 ? Math.max(0, dm) : Math.min(511, 384 + Math.max(0, Math.round((h - 38.4) * 1.25)));
    const rm = Math.round(r * 10);
    const rr = rm <= 95 ? Math.max(0, rm) : Math.min(127, 96 + Math.max(0, Math.round((r - 9.6) * 2)));
    const ss = Math.min(127, Math.max(0, Math.round(seed * 127)));
    return ((arch & FOREST_ARCH_MASK) | (hh << 8) | (rr << 17) | (ss << 24) | (pinned ? FOREST_PINNED_BIT : 0)) >>> 0;
}
/** unpack a runtime packed u32 produced by `packForest` */
export function unpackForest(k) {
    const arch = k & FOREST_ARCH_MASK;
    const hh = (k >>> 8) & 511;
    const h = hh < 384 ? hh * 0.1 : 38.4 + (hh - 384) * 0.8;
    const rr = (k >>> 17) & 127;
    const r = rr < 96 ? rr * 0.1 : 9.6 + (rr - 96) * 0.5;
    const seed = ((k >>> 24) & 127) / 127;
    const pinned = (k & FOREST_PINNED_BIT) !== 0;
    return { arch, h, r, seed, pinned };
}
/** a compact forest ('TRE2': magic, n, then byte planes x lo, x hi, z lo, z hi, y, and the legacy packed u32's four
 *  bytes) back into 16 bytes an instance (x z y as f32, then the runtime packed u32) — and shuffled, so when a list
 *  fills, the ones it can't take are spread evenly rather than a neighbourhood. Anything else is taken as the 16-byte
 *  runtime records already. */
export function decodeForest(raw, ref, shuffle = true) {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (raw.byteLength < 8 || dv.getUint32(0, true) !== FOREST_MAGIC)
        return new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2);
    const n = dv.getUint32(4, true);
    const b = raw.subarray(8);
    const P = (k) => b.subarray(k * n, (k + 1) * n);
    const [xl, xh, zl, zh, y, p0, p1, p2, p3] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(P);
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++)
        order[i] = i;
    if (shuffle) {
        let s = 0x2545f491;
        for (let i = n - 1; i > 0; i--) {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            const j = s % (i + 1);
            const t = order[i];
            order[i] = order[j];
            order[j] = t;
        }
    }
    const [ox, oy, oz] = ref.origin, [sxz, sy] = ref.step;
    const u32 = new Uint32Array(n * 4);
    const f = new Float32Array(u32.buffer);
    for (let k = 0; k < n; k++) {
        const i = order[k], o = k * 4;
        f[o] = (xl[i] | (xh[i] << 8)) * sxz + ox;
        f[o + 1] = (zl[i] | (zh[i] << 8)) * sxz + oz;
        f[o + 2] = y[i] * sy + oy;
        // Repack legacy TRE2 (6b arch, 10b h dm, 8b r dm, 8b seed) into the runtime 32-bit layout.
        const leg = (p0[i] | (p1[i] << 8) | (p2[i] << 16) | (p3[i] << 24)) >>> 0;
        u32[o + 3] = packForest(leg & 63, ((leg >>> 6) & 1023) * 0.1, ((leg >>> 16) & 255) * 0.1, (leg >>> 24) / 255, false);
    }
    return u32;
}
const MAX_INSTANCES = 65535 * 64;
const DYNAMIC_HEADROOM = 4096;
export class Forest {
    kit;
    shader;
    u;
    label;
    caps;
    /** the four lists end to end (16 bytes an entry: x, the ground's y, z, the packed u32) */
    lists;
    counters;
    /** the four indirect draws' args (16 bytes each: near, far, impostor, shadow) */
    args;
    instances = null;
    /** total active instances (`staticCount + dynamicCount`) */
    count = 0;
    /** static instances loaded via `load()` at `[0 .. staticCount)` */
    staticCount = 0;
    /** dynamic tail instances written via `setDynamic()` at `[staticCount .. staticCount + dynamicCount)` */
    dynamicCount = 0;
    instancesCap = 0;
    staticSrc = null;
    dynamicSrc = null;
    cullPass = null;
    lastBind = null;
    computes = [];
    thin;
    slack;
    bind;
    constructor(kit, shader, opts) {
        this.kit = kit;
        this.shader = shader;
        const L = (this.label = opts.label ?? 'forest');
        this.caps = opts.caps;
        this.thin = [opts.thin?.factor ?? 1.4, opts.thin?.least ?? 0.3, opts.thin?.band ?? 0.06];
        this.slack = opts.slack ?? 60;
        this.bind = opts.bind ?? {};
        this.u = kit.uniforms(shader.structs.ForestU, L);
        const c = this.caps;
        this.lists = kit.storage({ label: `${L}.lists`, size: (c[0] + c[1] + c[2] + c[3]) * 16, usage: ['storage'] });
        this.counters = kit.storage({ label: `${L}.counters`, size: 48, usage: ['storage'] });
        this.args = kit.storage({ label: `${L}.args`, size: 64, usage: ['storage', 'indirect'] });
    }
    sameBind(bind) {
        if (!this.lastBind)
            return false;
        const ak = Object.keys(this.lastBind), bk = Object.keys(bind);
        if (ak.length !== bk.length)
            return false;
        for (const k of ak)
            if (this.lastBind[k] !== bind[k])
                return false;
        return true;
    }
    ensureInstances(need) {
        if (!this.instances) {
            const cap = Math.min(MAX_INSTANCES, Math.max(DYNAMIC_HEADROOM, Math.ceil(Math.max(1, need) * 1.25) + DYNAMIC_HEADROOM));
            this.instances = this.kit.storage({ label: `${this.label}.instances`, size: cap * 16, usage: ['storage', 'copy-dst', 'copy-src'] });
            this.instancesCap = Math.floor(this.instances.size / 16);
            return true;
        }
        if (need <= this.instancesCap)
            return false;
        const cap = Math.min(MAX_INSTANCES, Math.max(need + DYNAMIC_HEADROOM, Math.ceil(need * 1.5)));
        this.instances.ensure(cap * 16);
        this.instancesCap = Math.floor(this.instances.size / 16);
        return true;
    }
    /** the static instances (16 bytes each: decodeForest's), and the two computes over them (`bind`: more of the world's
     *  bindings for its hooks, over the options'). Reuses the GPU buffer and compute passes whenever capacity fits, and
     *  preserves any active dynamic tail set via `setDynamic()`. */
    load(instances, bind = {}) {
        const kit = this.kit, L = this.label;
        const maxStatic = Math.max(0, MAX_INSTANCES - this.dynamicCount);
        const n = Math.min(maxStatic, Math.floor(instances.length / 4));
        this.staticCount = n;
        this.count = this.staticCount + this.dynamicCount;
        const src = n * 4 < instances.length ? instances.subarray(0, n * 4) : instances;
        this.staticSrc = src;
        this.ensureInstances(this.count);
        if (src.byteLength)
            this.instances.write(src, 0);
        if (this.dynamicCount > 0 && this.dynamicSrc)
            this.instances.write(this.dynamicSrc, this.staticCount * 16);
        const bindSame = this.computes.length > 0 && this.sameBind(bind);
        if (bindSame)
            return;
        if (this.computes.length)
            kit.release(...this.computes);
        this.lastBind = { ...bind };
        const own = { forest: this.u, forestTrees: this.instances, forestLists: this.lists, forestCounters: this.counters, forestArgsOut: this.args };
        this.cullPass = kit.compute(this.shader, { label: `${L}.cull`, entry: 'forestCull', threads: () => [Math.max(1, this.count)], bind: { ...this.bind, ...bind, ...own } });
        this.computes = [
            this.cullPass,
            kit.compute(this.shader, { label: `${L}.args`, entry: 'forestWriteArgs', workgroups: [1], bind: { forest: this.u, forestCounters: this.counters, forestArgsOut: this.args } }),
        ];
    }
    /** write only the dynamic tail slice `[staticCount .. staticCount + dynamicCount)` without copying or re-uploading
     *  the static instances. Safe to call before or after `load()`. */
    setDynamic(instances) {
        const maxDyn = Math.max(0, MAX_INSTANCES - this.staticCount);
        const n = Math.min(maxDyn, Math.floor(instances.length / 4));
        const src = n * 4 < instances.length ? instances.subarray(0, n * 4) : instances;
        this.dynamicSrc = src.length ? src.slice() : null;
        this.dynamicCount = n;
        this.count = this.staticCount + this.dynamicCount;
        if (!this.instances)
            return;
        const grew = this.ensureInstances(this.count);
        if (grew && this.staticCount > 0 && this.staticSrc)
            this.instances.write(this.staticSrc, 0);
        if (n > 0 && this.dynamicSrc)
            this.instances.write(this.dynamicSrc, this.staticCount * 16);
    }
    /** release all GPU buffers and compute passes owned by this forest */
    dispose() {
        if (this.computes.length)
            this.kit.release(...this.computes);
        this.computes = [];
        this.cullPass = null;
        this.lastBind = null;
        this.kit.release(this.instances, this.lists, this.counters, this.args, this.u);
        this.instances = null;
        this.instancesCap = 0;
        this.staticSrc = null;
        this.dynamicSrc = null;
        this.staticCount = 0;
        this.dynamicCount = 0;
        this.count = 0;
    }
    /** a frame's reaches, the draws' vertices, the world's own vec4s */
    update(f) {
        const u = [0, 1, 2, 3].map((k) => (f.user?.[k] ? [f.user[k][0] ?? 0, f.user[k][1] ?? 0, f.user[k][2] ?? 0, f.user[k][3] ?? 0] : [0, 0, 0, 0]));
        const thinFactor = f.thinFar ? this.thin[0] * (f.thinFar / Math.max(1, f.far)) : this.thin[0];
        this.u.set({
            lod: [f.near, f.far, f.imp, f.band],
            caps: this.caps,
            verts: f.verts,
            counts: [this.count, f.shadow, this.slack, this.staticCount],
            thin: [thinFactor, this.thin[1], this.thin[2], 0],
            user: u,
        });
    }
    /** what a draw binds to read the lists: the uniform and forestVisible */
    drawBind() { return { forest: this.u, forestVisible: this.lists }; }
    /** list's (0 near, 1 far, 2 impostor, 3 shadow) indirect args' offset in `args` */
    argsOffset(list) { return list * 16; }
    /** the computes for this frame (the cull, then the args): none before load */
    passes() { return this.computes; }
}
//# sourceMappingURL=forest.js.map