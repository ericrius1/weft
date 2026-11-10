import shader from './shaders/particles.wgsl';
export const PK = { SPARK: 0, FIRE: 1, SMOKE: 2, TRACER: 3, DEBRIS: 4, SPRAY: 5, FLASH: 6, VAPOR: 7, PAINT: 8 };
const MAX_BURSTS = 256;
/** a linear rgba (0..1) tint packed into a u32 (the shader unpacks it as is) */
const packLinear = (c) => ((Math.round(c[0] * 255) | (Math.round(c[1] * 255) << 8) | (Math.round(c[2] * 255) << 16) | (Math.round(c[3] * 255) << 24)) >>> 0);
const EMIT_BYTES = 80;
const MAX_GLINTS = 1024;
// per kind: gravity scale, drag, growth, buoyancy | streak (s), blend (0 add / 1 alpha), emissive, turbulence
const KINDS = [
    [[1.0, 1.2, -0.3, 0], [0.025, 0, 1, 0]], // spark
    [[0.0, 2.5, 1.2, 6], [0, 1, 1, 3]], // fire (alpha: an occluding, glowing ball)
    [[0.0, 1.4, 0.55, 2.2], [0, 1, 0, 1.5]], // smoke
    [[0.0, 0.0, 0.0, 0], [0.02, 0, 1, 0]], // tracer
    [[1.0, 0.5, 0.0, 0], [0, 1, 0, 0]], // debris
    [[1.0, 1.5, 0.6, 0], [0, 1, 0, 0.5]], // spray
    [[0.0, 0.0, 0.0, 0], [0, 0, 1, 0]], // flash
    [[0.0, 0.4, 0.6, 0], [0, 1, 0, 0.3]], // vapour (left in the air: puffs that make a trail)
    [[1.0, 0.5, 0.0, 0], [0.01, 1, 0, 0]], // paint (crisp droplets: a stylized world's)
];
export class Particles {
    kit;
    capacity;
    parts;
    emitBuf;
    u;
    kinds;
    queue = [];
    head = 0;
    emitted = 0;
    bursts = 0;
    time = 0;
    emitData = new ArrayBuffer(MAX_BURSTS * EMIT_BYTES);
    /** the lighting the lit kinds (smoke, debris, spray, vapour) see; a multiplier for the glowing ones */
    light = { sun: [0.4, 0.8, 0.3], sunCol: [3, 2.9, 2.7], amb: [0.5, 0.6, 0.75], glow: 1 };
    wind = [0, 0, 0];
    /** how far behind a sprite the scene must be for it to show fully (m) */
    softness = 2;
    /** how strongly the lamps (point lights) light the spray */
    sprayLamps = 1;
    emitPass;
    simPass;
    glintBuf;
    glintData = new Float32Array(MAX_GLINTS * 12);
    glintCount = 0;
    glintsDrawn = 0;
    constructor(kit, capacity = 65536) {
        this.kit = kit;
        this.capacity = capacity;
        this.parts = kit.storage({ label: 'particles', size: capacity * 48, usage: ['storage', 'copy-dst'] });
        this.emitBuf = kit.storage({ label: 'particles.emit', size: MAX_BURSTS * EMIT_BYTES, usage: ['storage', 'copy-dst'] });
        this.u = kit.uniforms(shader.structs.PU, 'particles');
        this.kinds = kit.uniforms(shader.structs.Kinds, 'particles.kinds').set({ a: KINDS.map((k) => k[0]), b: KINDS.map((k) => k[1]) });
        this.emitPass = kit.compute(shader, { label: 'particles.emit', entry: 'emit', bind: { P: this.u, K: this.kinds, parts: this.parts, emits: this.emitBuf }, threads: () => [Math.max(1, this.emitted)], enabled: () => this.emitted > 0 });
        this.simPass = kit.compute(shader, { label: 'particles.sim', entry: 'simulate', bind: { P: this.u, K: this.kinds, parts: this.parts }, threads: [capacity] });
        this.glintBuf = kit.storage({ label: 'particles.glints', size: MAX_GLINTS * 48, usage: ['storage', 'copy-dst'] });
    }
    /** a point of light, this frame only */
    glint(g) {
        if (this.glintCount >= MAX_GLINTS)
            return;
        const v = g.vel ?? [0, 0, 0];
        this.glintData.set([g.pos[0], g.pos[1], g.pos[2], g.size, g.color[0], g.color[1], g.color[2], g.minPx ?? 2, v[0], v[1], v[2], g.streak ?? 0], this.glintCount * 12);
        this.glintCount++;
    }
    /** queue a burst for this frame */
    burst(b) { if (this.queue.length < MAX_BURSTS)
        this.queue.push(b); }
    // ---------------------------------------------------------------- presets
    explosion(p, scale = 1, vel = [0, 0, 0]) {
        const s = scale;
        this.burst({ pos: p, vel, count: 1, kind: PK.FLASH, size: 9 * s, life: 0.22 });
        this.burst({ pos: p, vel, count: Math.round(40 * s), kind: PK.FIRE, spread: 18 * s, size: 2.6 * s, sizeJit: 0.5, life: 0.9, lifeJit: 0.4, posJit: 1.5 * s });
        this.burst({ pos: p, vel, count: Math.round(70 * s), kind: PK.SPARK, spread: 60 * s, size: 0.18, life: 1.1, lifeJit: 0.5 });
        this.burst({ pos: p, vel, count: Math.round(30 * s), kind: PK.SMOKE, spread: 9 * s, size: 3.5 * s, sizeJit: 0.5, life: 4.5, lifeJit: 0.4, posJit: 2 * s });
        this.burst({ pos: p, vel, count: Math.round(24 * s), kind: PK.DEBRIS, spread: 35 * s, size: 0.35, sizeJit: 0.6, life: 2.5, lifeJit: 0.4 });
    }
    sparks(p, dir, count = 20, speed = 30) {
        this.burst({ pos: p, count, kind: PK.SPARK, dir, cone: 0.6, spread: speed, size: 0.12, life: 0.6, lifeJit: 0.5 });
    }
    smoke(p, vel = [0, 0, 0], size = 1.5, life = 2.5, dark = 1) {
        this.burst({ pos: p, vel, count: 1, kind: PK.SMOKE, spread: 1.5, size, sizeJit: 0.3, life, lifeJit: 0.3, tint: [dark, dark, dark, 1] });
    }
    muzzle(p, dir, vel = [0, 0, 0]) {
        this.burst({ pos: p, vel, count: 1, kind: PK.FLASH, size: 1.2, life: 0.06 });
        this.burst({ pos: p, vel, count: 4, kind: PK.SPARK, dir, cone: 0.3, spread: 40, size: 0.08, life: 0.15 });
    }
    tracer(p, vel, life = 0.6) { this.burst({ pos: p, vel, count: 1, kind: PK.TRACER, size: 0.12, life }); }
    splash(p, scale = 1) {
        this.burst({ pos: p, count: Math.round(50 * scale), kind: PK.SPRAY, dir: [0, 1, 0], cone: 0.55, spread: 14 * scale, size: 0.5 * scale, sizeJit: 0.6, life: 1.4, lifeJit: 0.4 });
    }
    vapour(p, vel, size = 0.3, life = 0.9) { this.burst({ pos: p, vel, count: 1, kind: PK.VAPOR, size, sizeJit: 0.2, life, lifeJit: 0.2 }); }
    /** this frame's compute: emit the queued bursts, step everything */
    items(dt) {
        this.time += dt;
        const q = this.queue;
        this.queue = [];
        let total = 0;
        const f = new Float32Array(this.emitData), u = new Uint32Array(this.emitData);
        q.forEach((b, i) => {
            const o = (i * EMIT_BYTES) / 4;
            const dir = b.dir ?? [0, 1, 0];
            f.set([b.pos[0], b.pos[1], b.pos[2]], o);
            u[o + 3] = b.count;
            f.set([...(b.vel ?? [0, 0, 0]), b.spread ?? 5], o + 4);
            f.set([...dir, b.cone ?? 0], o + 8);
            u[o + 12] = b.kind;
            f[o + 13] = b.size ?? 1;
            f[o + 14] = b.life ?? 1;
            u[o + 15] = total;
            u[o + 16] = packLinear((b.tint ?? [1, 1, 1, 1]).map((x) => Math.max(0, Math.min(1, x))));
            f[o + 17] = b.sizeJit ?? 0.25;
            f[o + 18] = b.lifeJit ?? 0.25;
            f[o + 19] = b.posJit ?? 0;
            total += b.count;
        });
        total = Math.min(total, this.capacity);
        if (q.length)
            this.emitBuf.write(new Uint8Array(this.emitData, 0, q.length * EMIT_BYTES));
        this.emitted = total;
        this.bursts = q.length;
        const L = this.light;
        this.u.set({
            sun: [...L.sun, 0], sunCol: [...L.sunCol, 0], amb: [...L.amb, L.glow],
            sim: [dt, this.time, this.head, total], wind: [...this.wind, 0], misc: [this.capacity, this.bursts, this.softness, this.sprayLamps],
        });
        this.head = (this.head + total) % this.capacity;
        this.glintsDrawn = this.glintCount;
        if (this.glintCount)
            this.glintBuf.write(this.glintData.subarray(0, this.glintCount * 12));
        this.glintCount = 0;
        return [this.emitPass, this.simPass];
    }
    /** both blend classes into a pass (additive first, then alpha) */
    addTo(pass, depth) {
        const bind = { P: this.u, K: this.kinds, partsR: this.parts, sceneDepth: depth };
        pass.draw(shader, { label: 'particles.add', vertex: 'vs', fragment: 'fs', bind, count: 6, instances: this.capacity, blend: 'add', depthWrite: false, cull: 'none', constants: { BLEND_CLASS: 0 } });
        pass.draw(shader, { label: 'particles.alpha', vertex: 'vs', fragment: 'fs', bind, count: 6, instances: this.capacity, blend: 'premultiplied', depthWrite: false, cull: 'none', constants: { BLEND_CLASS: 1 } });
        pass.draw(shader, { label: 'particles.glints', vertex: 'vs_glint', fragment: 'fs_glint', bind: { P: this.u, glints: this.glintBuf, sceneDepth: depth }, count: 6, instances: () => this.glintsDrawn, enabled: () => this.glintsDrawn > 0, blend: 'add', depthWrite: false, cull: 'none' });
    }
}
//# sourceMappingURL=particles.js.map