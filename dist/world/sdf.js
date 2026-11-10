const len2 = (x, y) => Math.sqrt(x * x + y * y);
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
/** p rotated by the inverse of q (into a solid's own frame) */
function invRot(q, x, y, z) {
    const qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
    // t = 2 q.xyz × v; v' = v + w t + q.xyz × t
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}
/** one solid's distance (its own frame) */
export function solidDist(s, px, py, pz) {
    let x = px - s.c[0], y = py - s.c[1], z = pz - s.c[2];
    if (s.q)
        [x, y, z] = invRot(s.q, x, y, z);
    switch (s.kind) {
        case 'box': {
            const r = Math.min(s.round ?? 0, s.h[0], s.h[1], s.h[2]);
            const qx = Math.abs(x) - s.h[0] + r, qy = Math.abs(y) - s.h[1] + r, qz = Math.abs(z) - s.h[2] + r;
            return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
        }
        case 'cyl': {
            const rr = Math.min(s.round ?? 0, s.r, s.hh);
            const dx = len2(x, z) - s.r + rr, dy = Math.abs(y) - s.hh + rr;
            return Math.min(Math.max(dx, dy), 0) + len2(Math.max(dx, 0), Math.max(dy, 0)) - rr;
        }
        case 'sphere': return len3(x, y, z) - s.r;
        case 'torus': return len2(len2(x, z) - s.R, y) - s.r;
        case 'capsule': {
            const cy = Math.max(-s.hh, Math.min(s.hh, y));
            return len3(x, y - cy, z) - s.r;
        }
        case 'cone': {
            // (iq's capped cone: bottom radius r1 at -hh, top r2 at +hh)
            const qx = len2(x, z), qy = y, h = s.hh, r1 = s.r1, r2 = s.r2;
            const k1x = r2, k1y = h, k2x = r2 - r1, k2y = 2 * h;
            const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h;
            const kk = k2x * k2x + k2y * k2y;
            const tt = Math.max(0, Math.min(1, ((k1x - qx) * k2x + (k1y - qy) * k2y) / kk));
            const cbx = qx - k1x + k2x * tt, cby = qy - k1y + k2y * tt;
            const sgn = cbx < 0 && cay < 0 ? -1 : 1;
            return sgn * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
        }
    }
}
/** how far a solid reaches from its centre */
export function solidReach(s) {
    switch (s.kind) {
        case 'box': return len3(s.h[0], s.h[1], s.h[2]);
        case 'cyl': return len2(s.r, s.hh);
        case 'sphere': return s.r;
        case 'torus': return s.R + s.r;
        case 'cone': return len2(Math.max(s.r1, s.r2), s.hh);
        case 'capsule': return s.hh + s.r;
    }
}
export class SdfScene {
    solids;
    /** distances are exact up to this far from the surface */
    margin;
    cell;
    lo;
    dims;
    cells;
    constructor(solids, o = {}) {
        this.solids = solids;
        this.margin = o.margin ?? 3;
        this.cell = o.cell ?? 4;
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const s of solids) {
            const r = solidReach(s);
            for (let k = 0; k < 3; k++) {
                lo[k] = Math.min(lo[k], s.c[k] - r);
                hi[k] = Math.max(hi[k], s.c[k] + r);
            }
        }
        for (let k = 0; k < 3; k++) {
            lo[k] -= this.margin + this.cell;
            hi[k] += this.margin + this.cell;
        }
        this.lo = lo;
        this.dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil((hi[k] - lo[k]) / this.cell)));
        const lists = Array.from({ length: this.dims[0] * this.dims[1] * this.dims[2] }, () => []);
        solids.forEach((s, i) => {
            const r = solidReach(s) + this.margin;
            const a = [0, 1, 2].map((k) => Math.max(0, Math.floor((s.c[k] - r - lo[k]) / this.cell)));
            const b = [0, 1, 2].map((k) => Math.min(this.dims[k] - 1, Math.floor((s.c[k] + r - lo[k]) / this.cell)));
            for (let z = a[2]; z <= b[2]; z++)
                for (let y = a[1]; y <= b[1]; y++)
                    for (let x = a[0]; x <= b[0]; x++) {
                        // (only the cells the solid's reach really touches: the distance from the cell's box to the centre)
                        const cx = Math.max(lo[0] + x * this.cell, Math.min(s.c[0], lo[0] + (x + 1) * this.cell));
                        const cy = Math.max(lo[1] + y * this.cell, Math.min(s.c[1], lo[1] + (y + 1) * this.cell));
                        const cz = Math.max(lo[2] + z * this.cell, Math.min(s.c[2], lo[2] + (z + 1) * this.cell));
                        if (len3(cx - s.c[0], cy - s.c[1], cz - s.c[2]) <= r)
                            lists[(z * this.dims[1] + y) * this.dims[0] + x].push(i);
                    }
        });
        this.cells = lists.map((l) => Uint32Array.from(l));
    }
    /** the bounds the grid covers */
    get bounds() { return { lo: [...this.lo], hi: [0, 1, 2].map((k) => this.lo[k] + this.dims[k] * this.cell) }; }
    list(x, y, z) {
        const ix = Math.floor((x - this.lo[0]) / this.cell), iy = Math.floor((y - this.lo[1]) / this.cell), iz = Math.floor((z - this.lo[2]) / this.cell);
        if (ix < 0 || iy < 0 || iz < 0 || ix >= this.dims[0] || iy >= this.dims[1] || iz >= this.dims[2])
            return null;
        return this.cells[(iz * this.dims[1] + iy) * this.dims[0] + ix];
    }
    /** the distance to the nearest surface (negative inside); at least `margin` where none is near */
    dist(x, y, z) {
        const l = this.list(x, y, z);
        if (!l)
            return this.margin;
        let d = this.margin;
        for (let k = 0; k < l.length; k++)
            d = Math.min(d, solidDist(this.solids[l[k]], x, y, z));
        return d;
    }
    /** the nearest solid's index (-1: none within margin) */
    nearest(x, y, z) {
        const l = this.list(x, y, z);
        if (!l)
            return -1;
        let d = this.margin, best = -1;
        for (let k = 0; k < l.length; k++) {
            const e = solidDist(this.solids[l[k]], x, y, z);
            if (e < d) {
                d = e;
                best = l[k];
            }
        }
        return best;
    }
    /** the surface's normal at (near) p: the distance's gradient (a tetrahedron of samples) */
    normal(x, y, z, e = 0.01) {
        const a = this.dist(x + e, y - e, z - e), b = this.dist(x - e, y - e, z + e), c = this.dist(x - e, y + e, z - e), d = this.dist(x + e, y + e, z + e);
        const nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
        const l = len3(nx, ny, nz) || 1;
        return [nx / l, ny / l, nz / l];
    }
    /** march a ray (unit dir) against the scene; null if nothing within maxT */
    raycast(o, d, maxT, pad = 0) {
        let t = 0;
        for (let i = 0; i < 160 && t < maxT; i++) {
            const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
            const e = this.dist(x, y, z) - pad;
            if (e < 0.002 * (1 + t)) {
                const n = this.normal(x, y, z);
                return { t, p: [x, y, z], n, solid: this.nearest(x, y, z) };
            }
            t += Math.max(e, 0.01);
        }
        return null;
    }
    /** a sphere's push out of the scene: the corrected centre and the contact's normal (null: no contact) */
    pushOut(p, r) {
        let q = [p[0], p[1], p[2]];
        let n = null, depth = 0;
        for (let it = 0; it < 4; it++) {
            const d = this.dist(q[0], q[1], q[2]);
            if (d >= r)
                break;
            const nn = this.normal(q[0], q[1], q[2]);
            q = [q[0] + nn[0] * (r - d), q[1] + nn[1] * (r - d), q[2] + nn[2] * (r - d)];
            n = nn;
            depth = Math.max(depth, r - d);
        }
        return n ? { p: q, n, depth } : null;
    }
}
//# sourceMappingURL=sdf.js.map