/** 'TRE2' */
export const FOREST_MAGIC = 0x32455254;
/** a compact forest ('TRE2': magic, n, then byte planes x lo, x hi, z lo, z hi, y, and the packed u32's four bytes)
 *  back into 16 bytes an instance (x z y as f32, then the packed u32) — and shuffled, so when a list fills, the ones it
 *  can't take are spread evenly rather than a neighbourhood. Anything else is taken as the 16-byte records already. */
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
        u32[o + 3] = (p0[i] | (p1[i] << 8) | (p2[i] << 16) | (p3[i] << 24)) >>> 0;
    }
    return u32;
}
/** an instance's packed u32 (forest.wgsl forestUnpack): archetype (0..63), height and crown radius (m, to 0.1), seed (0..1) */
export function packForest(arch, h, r, seed) {
    const hh = Math.min(1023, Math.max(0, Math.round(h * 10)));
    const rr = Math.min(255, Math.max(0, Math.round(r * 10)));
    const ss = Math.min(255, Math.max(0, Math.round(seed * 255)));
    return ((arch & 63) | (hh << 6) | (rr << 16) | (ss << 24)) >>> 0;
}
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
    count = 0;
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
        this.counters = kit.storage({ label: `${L}.counters`, size: 16, usage: ['storage'] });
        this.args = kit.storage({ label: `${L}.args`, size: 64, usage: ['storage', 'indirect'] });
    }
    /** the instances (16 bytes each: decodeForest's), and the two computes over them (`bind`: more of the world's
     *  bindings for its hooks, over the options') */
    load(instances, bind = {}) {
        const kit = this.kit, L = this.label;
        this.count = instances.length / 4;
        this.instances = kit.storage({ label: `${L}.instances`, data: instances });
        const own = { forest: this.u, forestTrees: this.instances, forestLists: this.lists, forestCounters: this.counters, forestArgsOut: this.args };
        this.computes = [
            kit.compute(this.shader, { label: `${L}.cull`, entry: 'forestCull', threads: [this.count], bind: { ...this.bind, ...bind, ...own } }),
            kit.compute(this.shader, { label: `${L}.args`, entry: 'forestWriteArgs', workgroups: [1], bind: { forest: this.u, forestCounters: this.counters, forestArgsOut: this.args } }),
        ];
    }
    /** a frame's reaches, the draws' vertices, the world's own vec4s */
    update(f) {
        const u = [0, 1, 2, 3].map((k) => (f.user?.[k] ? [f.user[k][0] ?? 0, f.user[k][1] ?? 0, f.user[k][2] ?? 0, f.user[k][3] ?? 0] : [0, 0, 0, 0]));
        this.u.set({
            lod: [f.near, f.far, f.imp, f.band],
            caps: this.caps,
            verts: f.verts,
            counts: [this.count, f.shadow, this.slack, 0],
            thin: [...this.thin, 0],
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