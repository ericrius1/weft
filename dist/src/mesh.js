import { mat4, mat4Mul, mat4Invert, compose, quatAxisAngle, norm, cross, sub } from './math';
import { separateCoplanar } from './coplanar';
export { findCoplanar, separateCoplanar } from './coplanar';
export const VERTEX_BYTES = 40;
const toSrgb8 = (c) => {
    const x = Math.max(0, Math.min(1, c));
    return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255);
};
export const packColor = (c) => (toSrgb8(c[0]) | (toSrgb8(c[1]) << 8) | (toSrgb8(c[2]) << 16) | (Math.round(Math.max(0, Math.min(1, c[3] ?? 1)) * 255) << 24)) >>> 0;
export class MeshBuilder {
    f = [];
    u = [];
    idx = [];
    stack = [];
    m = mat4();
    nm = mat4();
    /** linear rgba for the next primitives */
    color = [0.8, 0.8, 0.8, 1];
    mat = 0;
    /** uv scale: uvs are in metres × this (so tiling textures stay square) */
    uvScale = 1;
    get vertexCount() { return this.f.length / 8; }
    get indexCount() { return this.idx.length; }
    push() { this.stack.push(this.m.slice()); return this; }
    pop() { this.m = this.stack.pop() ?? mat4(); this.updateNormal(); return this; }
    updateNormal() {
        const inv = mat4Invert(this.m);
        // normal matrix = transpose(inverse(m)) (upper 3×3)
        const n = this.nm;
        n[0] = inv[0];
        n[1] = inv[4];
        n[2] = inv[8];
        n[4] = inv[1];
        n[5] = inv[5];
        n[6] = inv[9];
        n[8] = inv[2];
        n[9] = inv[6];
        n[10] = inv[10];
    }
    apply(t) { mat4Mul(this.m, t, this.m); this.updateNormal(); return this; }
    translate(x, y, z) { return this.apply(compose([0, 0, 0, 1], [x, y, z], 1)); }
    rotate(axis, a) { return this.apply(compose(quatAxisAngle(axis, a), [0, 0, 0], 1)); }
    rotateY(a) { return this.rotate([0, 1, 0], a); }
    rotateX(a) { return this.rotate([1, 0, 0], a); }
    rotateZ(a) { return this.rotate([0, 0, 1], a); }
    scale(x, y = x, z = x) { return this.apply(compose([0, 0, 0, 1], [0, 0, 0], [x, y, z])); }
    setColor(c, mat = this.mat) { this.color = [c[0], c[1], c[2], c[3] ?? 1]; this.mat = mat; return this; }
    /** add a vertex (local space); returns its index */
    vertex(p, n, uv = [0, 0], color = this.color, mat = this.mat) {
        const m = this.m, q = this.nm;
        const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
        const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
        const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
        let nx = q[0] * n[0] + q[4] * n[1] + q[8] * n[2], ny = q[1] * n[0] + q[5] * n[1] + q[9] * n[2], nz = q[2] * n[0] + q[6] * n[1] + q[10] * n[2];
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        this.f.push(x, y, z, nx, ny, nz, uv[0] * this.uvScale, uv[1] * this.uvScale);
        this.u.push(packColor(color), mat);
        return this.f.length / 8 - 1;
    }
    tri(a, b, c) { this.idx.push(a, b, c); return this; }
    /** a quad from four corners (counter-clockwise seen from the front) */
    quad(p0, p1, p2, p3, uvw = 1, uvh = 1) {
        const n = norm(cross(sub(p1, p0), sub(p3, p0)));
        const a = this.vertex(p0, n, [0, 0]), b = this.vertex(p1, n, [uvw, 0]), c = this.vertex(p2, n, [uvw, uvh]), d = this.vertex(p3, n, [0, uvh]);
        this.idx.push(a, b, c, a, c, d);
        return this;
    }
    /** axis-aligned box centred on the origin (current transform applies) */
    box(w, h, d) {
        const x = w / 2, y = h / 2, z = d / 2;
        this.quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], w, h); // +z
        this.quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], w, h); // -z
        this.quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], d, h); // +x
        this.quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], d, h); // -x
        this.quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], w, d); // +y
        this.quad([-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], w, d); // -y
        return this;
    }
    /** box from min corner to max corner */
    boxMinMax(a, b) {
        this.push().translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2).box(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]));
        return this.pop();
    }
    /** cylinder along y, centred, with optional caps */
    cylinder(r, h, seg = 16, caps = true, r2 = r) {
        const base = this.vertexCount;
        for (let i = 0; i <= seg; i++) {
            const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
            const slope = (r - r2) / h;
            const n = norm([c, slope, s]);
            this.vertex([c * r, -h / 2, s * r], n, [(i / seg) * Math.PI * 2 * r, 0]);
            this.vertex([c * r2, h / 2, s * r2], n, [(i / seg) * Math.PI * 2 * r, h]);
        }
        for (let i = 0; i < seg; i++) {
            const a = base + i * 2;
            this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
        }
        if (caps) {
            for (const [y, rr, ny] of [[h / 2, r2, 1], [-h / 2, r, -1]]) {
                const ctr = this.vertex([0, y, 0], [0, ny, 0], [0, 0]);
                const first = this.vertexCount;
                for (let i = 0; i <= seg; i++) {
                    const a = (i / seg) * Math.PI * 2;
                    this.vertex([Math.cos(a) * rr, y, Math.sin(a) * rr], [0, ny, 0], [Math.cos(a) * rr, Math.sin(a) * rr]);
                }
                for (let i = 0; i < seg; i++) {
                    if (ny > 0)
                        this.idx.push(ctr, first + i + 1, first + i);
                    else
                        this.idx.push(ctr, first + i, first + i + 1);
                }
            }
        }
        return this;
    }
    sphere(r, seg = 16, rings = 10) {
        const base = this.vertexCount;
        for (let j = 0; j <= rings; j++) {
            const v = j / rings, phi = v * Math.PI;
            for (let i = 0; i <= seg; i++) {
                const u = i / seg, th = u * Math.PI * 2;
                const n = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
                this.vertex([n[0] * r, n[1] * r, n[2] * r], n, [u * Math.PI * 2 * r, v * Math.PI * r]);
            }
        }
        for (let j = 0; j < rings; j++) {
            for (let i = 0; i < seg; i++) {
                const a = base + j * (seg + 1) + i, b = a + seg + 1;
                this.idx.push(a, a + 1, b, b, a + 1, b + 1);
            }
        }
        return this;
    }
    /** surface of revolution around y from a profile of [radius, y] points (bottom to top) */
    lathe(profile, seg = 24) {
        const base = this.vertexCount;
        for (let i = 0; i <= seg; i++) {
            const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
            for (let k = 0; k < profile.length; k++) {
                const [r, y] = profile[k];
                const [r0, y0] = profile[Math.max(0, k - 1)], [r1, y1] = profile[Math.min(profile.length - 1, k + 1)];
                const dr = r1 - r0, dy = y1 - y0;
                const n = norm([c * dy, -dr, s * dy]);
                this.vertex([c * r, y, s * r], n, [i / seg, k / (profile.length - 1)]);
            }
        }
        const P = profile.length;
        for (let i = 0; i < seg; i++) {
            for (let k = 0; k < P - 1; k++) {
                const a = base + i * P + k, b = a + P;
                this.idx.push(a, a + 1, b, a + 1, b + 1, b);
            }
        }
        return this;
    }
    /** a flat polygon (convex, counter-clockwise from the front) */
    polygon(pts) {
        const n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
        const ids = pts.map((p) => this.vertex(p, n, [p[0], p[2]]));
        for (let i = 1; i < ids.length - 1; i++)
            this.idx.push(ids[0], ids[i], ids[i + 1]);
        return this;
    }
    /** a tube along a path (neon signs, pipes, trunks); r may taper: a function of the path parameter 0..1 */
    tube(path, r, seg = 8, closed = false) {
        const rad = typeof r === 'number' ? () => r : r;
        const base = this.vertexCount;
        const N = path.length;
        for (let k = 0; k < N; k++) {
            const p = path[k];
            const a = path[Math.max(0, k - 1)], b = path[Math.min(N - 1, k + 1)];
            const t = norm(sub(b, a));
            let up = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
            const nx = norm(cross(up, t));
            up = cross(t, nx);
            const rk = rad(N > 1 ? k / (N - 1) : 0);
            for (let i = 0; i <= seg; i++) {
                const ang = (i / seg) * Math.PI * 2;
                const n = [nx[0] * Math.cos(ang) + up[0] * Math.sin(ang), nx[1] * Math.cos(ang) + up[1] * Math.sin(ang), nx[2] * Math.cos(ang) + up[2] * Math.sin(ang)];
                this.vertex([p[0] + n[0] * rk, p[1] + n[1] * rk, p[2] + n[2] * rk], n, [i / seg, k]);
            }
        }
        for (let k = 0; k < (closed ? N : N - 1); k++) {
            const k2 = (k + 1) % N;
            for (let i = 0; i < seg; i++) {
                const a = base + k * (seg + 1) + i, b = base + k2 * (seg + 1) + i;
                this.idx.push(a, a + 1, b, a + 1, b + 1, b);
            }
        }
        return this;
    }
    /** extrude a profile drawn in the (z, y) plane (counter-clockwise, simple polygon) along x from x0 to x1.
     *  `edge(i)` may restyle the side face of edge i → i+1 (return a colour / material); caps use the current style. */
    extrudeX(profile, x0, x1, o = {}) {
        const n = profile.length;
        const keep = { color: this.color.slice(), mat: this.mat };
        if (o.caps !== false) {
            const tris = triangulate(profile);
            for (const [x, nx] of [[x1, 1], [x0, -1]]) {
                const ids = profile.map(([z, y]) => this.vertex([x, y, z], [nx, 0, 0], [z, y]));
                for (let t = 0; t < tris.length; t += 3) {
                    // looking from +x the (z, y) polygon is clockwise, so flip there
                    if (nx > 0)
                        this.idx.push(ids[tris[t]], ids[tris[t + 2]], ids[tris[t + 1]]);
                    else
                        this.idx.push(ids[tris[t]], ids[tris[t + 1]], ids[tris[t + 2]]);
                }
            }
        }
        for (let i = 0; i < n; i++) {
            const style = o.edge?.(i);
            if (style && style.skip)
                continue;
            if (style?.color)
                this.color = [style.color[0], style.color[1], style.color[2], style.color[3] ?? 1];
            if (style?.mat !== undefined)
                this.mat = style.mat;
            const [za, ya] = profile[i], [zb, yb] = profile[(i + 1) % n];
            // outward normal of a counter-clockwise (z, y) edge
            this.quad([x1, ya, za], [x1, yb, zb], [x0, yb, zb], [x0, ya, za], Math.hypot(zb - za, yb - ya), x1 - x0);
            this.color = keep.color.slice();
            this.mat = keep.mat;
        }
        return this;
    }
    /** append another builder's geometry (already in world space) */
    merge(o) {
        const off = this.vertexCount;
        for (const x of o.f)
            this.f.push(x);
        for (const x of o.u)
            this.u.push(x);
        for (const i of o.idx)
            this.idx.push(i + off);
        return this;
    }
    /** interleaved vertex data (40 bytes per vertex). Automatically separates coplanar overlapping faces unless
     *  `opts.separateCoplanar === false`. */
    data(opts) {
        const n = this.vertexCount;
        const buf = new ArrayBuffer(n * VERTEX_BYTES);
        const fv = new Float32Array(buf), uv = new Uint32Array(buf);
        const f = this.f, u = this.u;
        for (let i = 0; i < n; i++) {
            for (let k = 0; k < 8; k++)
                fv[i * 10 + k] = f[i * 8 + k];
            uv[i * 10 + 8] = u[i * 2];
            uv[i * 10 + 9] = u[i * 2 + 1];
        }
        const indices = new Uint32Array(this.idx);
        const sep = opts?.separateCoplanar;
        if (sep !== false && indices.length >= 6) {
            separateCoplanar(fv, indices, { stride: 10, offset: 0, vertexCount: n, ...(typeof sep === 'object' ? sep : undefined) });
        }
        return { vertices: buf, indices };
    }
    /** separate coplanar overlapping faces in this builder in-place and return resolution stats */
    separateCoplanar(opts) {
        return separateCoplanar(this.f, this.idx, { stride: 8, offset: 0, vertexCount: this.vertexCount, ...opts });
    }
    upload(kit, label = 'mesh', opts) {
        const { vertices, indices } = this.data(opts);
        return {
            vertices: kit.storage({ label: `${label}.v`, data: vertices, stride: VERTEX_BYTES }),
            indices: kit.storage({ label: `${label}.i`, data: indices, usage: ['index', 'storage', 'copy-dst'] }),
            count: indices.length,
            vertexCount: this.vertexCount,
        };
    }
}
const _tagBuf = new ArrayBuffer(4);
const _tagU32 = new Uint32Array(_tagBuf);
const _tagF32 = new Float32Array(_tagBuf);
/** Pack up to four byte/6-bit material/sub-material/part/extra fields into a single f32 bit-pattern (read via `bitcast<u32>` in WGSL). */
export function packTag(mat, sub = 0, part = 0, extra = 0) {
    _tagU32[0] = (mat & 255) | ((sub & 255) << 8) | ((part & 255) << 16) | ((extra & 63) << 24);
    return _tagF32[0];
}
/**
 * Lightweight 9-float/vertex non-indexed triangle soup builder (`px, py, pz, nx, ny, nz, u, v, f32(tag)`) for
 * architectural and procedural features with custom WGSL shaders. Automatically runs `separateCoplanar()` in `data()`
 * so overlapping quads/boxes never z-fight internally.
 */
export class TriangleSoup {
    buf = [];
    get count() { return this.buf.length / 9; }
    vert(p, n, u, v, tag = 0) {
        this.buf.push(p[0], p[1], p[2], n[0], n[1], n[2], u, v, tag);
        return this;
    }
    tri(a, b, c, ua, ub, uc, tag = 0, n) {
        let nx, ny, nz;
        if (n) {
            [nx, ny, nz] = n;
        }
        else {
            const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
            const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
            nx = uy * vz - uz * vy;
            ny = uz * vx - ux * vz;
            nz = ux * vy - uy * vx;
            const l = Math.hypot(nx, ny, nz) || 1;
            nx /= l;
            ny /= l;
            nz /= l;
        }
        this.buf.push(a[0], a[1], a[2], nx, ny, nz, ua[0], ua[1], tag, b[0], b[1], b[2], nx, ny, nz, ub[0], ub[1], tag, c[0], c[1], c[2], nx, ny, nz, uc[0], uc[1], tag);
        return this;
    }
    /** Quad with corners (p00 -> p10 -> p11 -> p01) in CCW order from outside. */
    quad(p00, p10, p11, p01, tag = 0, uvScale = 1, uvRect) {
        const ux = p10[0] - p00[0], uy = p10[1] - p00[1], uz = p10[2] - p00[2];
        const vx = p01[0] - p00[0], vy = p01[1] - p00[1], vz = p01[2] - p00[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        const n = [nx, ny, nz];
        let u0 = 0, v0 = 0, u1 = Math.hypot(ux, uy, uz) * uvScale, v1 = Math.hypot(vx, vy, vz) * uvScale;
        if (uvRect)
            [u0, v0, u1, v1] = uvRect;
        this.tri(p00, p10, p11, [u0, v1], [u1, v1], [u1, v0], tag, n);
        this.tri(p00, p11, p01, [u0, v1], [u1, v0], [u0, v0], tag, n);
        return this;
    }
    /** Axis-aligned box from (x0,y0,z0) to (x1,y1,z1), outward CCW normals. Mask bits: 1:+Y, 2:-Y, 4:+Z, 8:-Z, 16:+X, 32:-X. */
    box(x0, y0, z0, x1, y1, z1, tag = 0, uvScale = 0.25, mask = 63) {
        if (mask & 1)
            this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], tag, uvScale);
        if (mask & 2)
            this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], tag, uvScale);
        if (mask & 4)
            this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], tag, uvScale);
        if (mask & 8)
            this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], tag, uvScale);
        if (mask & 16)
            this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], tag, uvScale);
        if (mask & 32)
            this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], tag, uvScale);
        return this;
    }
    /** Upright tapered cylinder around (cx, cz) from y0..y1. */
    cyl(cx, cz, y0, y1, r0, r1, segs, tag = 0, capTop = true, capBot = false) {
        for (let i = 0; i < segs; i++) {
            const a0 = (i / segs) * Math.PI * 2;
            const a1 = ((i + 1) / segs) * Math.PI * 2;
            const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
            const p00 = [cx + c0 * r0, y0, cz + s0 * r0];
            const p10 = [cx + c1 * r0, y0, cz + s1 * r0];
            const p11 = [cx + c1 * r1, y1, cz + s1 * r1];
            const p01 = [cx + c0 * r1, y1, cz + s0 * r1];
            this.quad(p00, p10, p11, p01, tag, 0.5);
            if (capTop)
                this.tri([cx, y1, cz], p11, p01, [0.5, 0.5], [1, 0], [0, 0], tag, [0, 1, 0]);
            if (capBot)
                this.tri([cx, y0, cz], p00, p10, [0.5, 0.5], [0, 0], [1, 0], tag, [0, -1, 0]);
        }
        return this;
    }
    /** Flat Float32Array (9 floats/vertex). Automatically runs `separateCoplanar()` unless `opts.separateCoplanar === false`. */
    data(opts) {
        const arr = new Float32Array(this.buf);
        const sep = opts?.separateCoplanar;
        if (sep !== false && arr.length >= 54) {
            separateCoplanar(arr, undefined, { stride: 9, offset: 0, ...(typeof sep === 'object' ? sep : undefined) });
        }
        return arr;
    }
}
/** ear-clipping triangulation of a simple polygon (counter-clockwise); returns index triples */
export function triangulate(poly) {
    const idx = poly.map((_, i) => i);
    const out = [];
    const area = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    const inside = (p, a, b, c) => area(a, b, p) >= 0 && area(b, c, p) >= 0 && area(c, a, p) >= 0;
    let guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
        let clipped = false;
        for (let i = 0; i < idx.length; i++) {
            const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
            const a = poly[ia], b = poly[ib], c = poly[ic];
            if (area(a, b, c) <= 1e-12)
                continue;
            let ear = true;
            for (const j of idx) {
                if (j === ia || j === ib || j === ic)
                    continue;
                if (inside(poly[j], a, b, c)) {
                    ear = false;
                    break;
                }
            }
            if (!ear)
                continue;
            out.push(ia, ib, ic);
            idx.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped)
            break;
    }
    if (idx.length === 3)
        out.push(idx[0], idx[1], idx[2]);
    return out;
}
//# sourceMappingURL=mesh.js.map