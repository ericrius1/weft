const VB = 32; // bytes per vertex
const XF = 16; // floats per slot
export class Pieces {
    kit;
    maxVerts;
    maxSlots;
    verts;
    xf;
    /** vertices drawn (the arena's high-water mark) */
    top = 0;
    freeRanges = [];
    freeSlots = [];
    slotTop = 1; // (slot 0 is the dead slot: scale 0, every freed vertex points at it)
    xfData;
    xfU32;
    lo = Infinity;
    hi = -1;
    live = 0;
    constructor(kit, maxVerts = 786432, maxSlots = 16384) {
        this.kit = kit;
        this.maxVerts = maxVerts;
        this.maxSlots = maxSlots;
        this.verts = kit.storage({ label: 'pieces.verts', size: maxVerts * VB, usage: ['storage', 'copy-dst'] });
        this.xfData = new Float32Array(maxSlots * XF);
        this.xfU32 = new Uint32Array(this.xfData.buffer);
        this.xf = kit.storage({ label: 'pieces.xf', size: this.xfData.byteLength, usage: ['storage', 'copy-dst'] });
        this.xf.write(this.xfData);
    }
    /** register the draws: the game's shader (it includes loom/pieces), into the scene and the shadow cascades */
    draw(shader, scene, shadows, bind = {}, extra = []) {
        const common = { bind: { pieceVerts: this.verts, pieceXf: this.xf, ...bind }, count: () => this.top, enabled: () => this.top > 0 };
        scene.draw(shader, { label: 'pieces', ...common, cull: 'back' });
        for (const p of extra)
            p.draw(shader, { label: 'pieces.extra', ...common, cull: 'none' });
        shadows.forEach((p, c) => p.draw(shader, { label: `pieces.shadow${c}`, vertex: 'vs_shadow', fragment: null, ...common, bind: { pieceVerts: this.verts, pieceXf: this.xf, ...bind }, cull: 'none' }));
    }
    /** a new piece: its triangles (local), material id (0..127), material-space offset, tint (linear rgb 0..1) */
    add(mesh, mat, m0, tint = [1, 1, 1], seed = Math.random(), half = null) {
        const n = mesh.pos.length / 3;
        const at = this.allocVerts(n);
        if (at < 0)
            return null;
        const slot = this.freeSlots.pop() ?? (this.slotTop < this.maxSlots ? this.slotTop++ : -1);
        if (slot < 0) {
            this.freeVerts(at, n);
            return null;
        }
        const buf = new ArrayBuffer(n * VB);
        const f = new Float32Array(buf), u = new Uint32Array(buf);
        const s8 = (x) => (Math.max(-127, Math.min(127, Math.round(x * 127))) & 255);
        for (let i = 0; i < n; i++) {
            const o = i * 8;
            f[o] = mesh.pos[i * 3];
            f[o + 1] = mesh.pos[i * 3 + 1];
            f[o + 2] = mesh.pos[i * 3 + 2];
            u[o + 3] = slot;
            f[o + 4] = mesh.pos[i * 3] + m0[0];
            f[o + 5] = mesh.pos[i * 3 + 1] + m0[1];
            f[o + 6] = mesh.pos[i * 3 + 2] + m0[2];
            const cut = mesh.cut ? mesh.cut[i] : 0;
            u[o + 7] = (s8(mesh.nrm[i * 3]) | (s8(mesh.nrm[i * 3 + 1]) << 8) | (s8(mesh.nrm[i * 3 + 2]) << 16) | ((mat & 127) << 24) | (cut ? 0x80000000 : 0)) >>> 0;
        }
        this.verts.write(buf, at * VB);
        const x = slot * XF;
        this.xfData.fill(0, x, x + XF);
        this.xfData[x + 3] = 1;
        this.xfData[x + 7] = 1;
        this.xfU32[x + 8] = (Math.round(tint[0] * 255) | (Math.round(tint[1] * 255) << 8) | (Math.round(tint[2] * 255) << 16) | (255 << 24)) >>> 0;
        this.xfData[x + 9] = seed;
        if (half) {
            this.xfData[x + 12] = half[0];
            this.xfData[x + 13] = half[1];
            this.xfData[x + 14] = half[2];
        }
        this.touch(slot);
        this.live++;
        return { slot, at, n };
    }
    remove(p) {
        this.freeVerts(p.at, p.n);
        const x = p.slot * XF;
        this.xfData.fill(0, x, x + XF);
        this.touch(p.slot);
        this.freeSlots.push(p.slot);
        this.live--;
    }
    /** where a piece is this frame (scale 0 hides it) */
    set(p, pos, q, scale = 1) {
        const x = p.slot * XF, d = this.xfData;
        d[x] = pos[0];
        d[x + 1] = pos[1];
        d[x + 2] = pos[2];
        d[x + 3] = scale;
        d[x + 4] = q[0];
        d[x + 5] = q[1];
        d[x + 6] = q[2];
        d[x + 7] = q[3];
        this.touch(p.slot);
    }
    /** the game's own per-piece value (b.w) */
    setUser(p, v) { this.xfData[p.slot * XF + 15] = v; this.touch(p.slot); }
    /** heat (a glow, 0..1+) and damage (cracks, 0..1) */
    setAttr(p, heat, damage) {
        const x = p.slot * XF;
        this.xfData[x + 10] = heat;
        this.xfData[x + 11] = damage;
        this.touch(p.slot);
    }
    /** send the slots that changed */
    upload() {
        if (this.hi < this.lo)
            return;
        this.xf.write(this.xfData.subarray(this.lo * XF, (this.hi + 1) * XF), this.lo * XF * 4);
        this.lo = Infinity;
        this.hi = -1;
    }
    get stats() { return { verts: this.top, live: this.live, slots: this.slotTop, freeRanges: this.freeRanges.length }; }
    touch(slot) { if (slot < this.lo)
        this.lo = slot; if (slot > this.hi)
        this.hi = slot; }
    allocVerts(n) {
        for (let i = 0; i < this.freeRanges.length; i++) {
            const r = this.freeRanges[i];
            if (r.n < n)
                continue;
            const at = r.at;
            r.at += n;
            r.n -= n;
            if (r.n === 0)
                this.freeRanges.splice(i, 1);
            return at;
        }
        if (this.top + n > this.maxVerts)
            return -1;
        const at = this.top;
        this.top += n;
        return at;
    }
    freeVerts(at, n) {
        // (collapse the range: every vertex at the dead slot, so its triangles have no area)
        this.verts.write(new Uint32Array(n * 8), at * VB);
        const R = this.freeRanges;
        let i = 0;
        while (i < R.length && R[i].at < at)
            i++;
        R.splice(i, 0, { at, n });
        // merge with the neighbours
        if (i + 1 < R.length && R[i].at + R[i].n === R[i + 1].at) {
            R[i].n += R[i + 1].n;
            R.splice(i + 1, 1);
        }
        if (i > 0 && R[i - 1].at + R[i - 1].n === R[i].at) {
            R[i - 1].n += R[i].n;
            R.splice(i, 1);
            i--;
        }
        // (the last range at the top: give it back)
        const last = R[R.length - 1];
        if (last && last.at + last.n === this.top) {
            this.top = last.at;
            R.pop();
        }
    }
}
//# sourceMappingURL=pieces.js.map