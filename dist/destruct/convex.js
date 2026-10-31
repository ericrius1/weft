const EPS = 1e-7;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** a polygon's normal (Newell's method: robust for slightly non-planar or sliver polygons) */
function newell(pts) {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        x += (a[1] - b[1]) * (a[2] + b[2]);
        y += (a[2] - b[2]) * (a[0] + b[0]);
        z += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return norm([x, y, z]);
}
/** a box of half extents h, centred */
export function boxPoly(hx, hy, hz) {
    const c = (x, y, z) => [x * hx, y * hy, z * hz];
    const quad = (a, b, c2, d) => ({ pts: [a, b, c2, d], n: newell([a, b, c2, d]), cut: false });
    return {
        faces: [
            quad(c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)), // +x
            quad(c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1), c(-1, -1, -1)), // -x
            quad(c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)), // +y
            quad(c(-1, -1, 1), c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1)), // -y
            quad(c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)), // +z
            quad(c(1, -1, -1), c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1)), // -z
        ],
    };
}
/** an upright prism (a cylinder of `sides`), radius r, half height hh */
export function prismPoly(r, hh, sides) {
    const ring = (y) => Array.from({ length: sides }, (_, k) => { const a = (k / sides) * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
    const lo = ring(-hh), hi = ring(hh);
    const faces = [];
    for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        const pts = [lo[k], hi[k], hi[k1], lo[k1]];
        faces.push({ pts, n: newell(pts), cut: false });
    }
    const top = [...hi].reverse(), bot = [...lo];
    faces.push({ pts: top, n: newell(top), cut: false }, { pts: bot, n: newell(bot), cut: false });
    // (wind each so its normal points out)
    for (const f of faces) {
        const c = centre(f.pts);
        if (dot(f.n, c) < 0) {
            f.pts.reverse();
            f.n = [-f.n[0], -f.n[1], -f.n[2]];
        }
    }
    return { faces };
}
/** a polyhedron from a point cloud's convex hull faces (indices into pts, any winding: fixed here) */
export function polyFromHull(pts, tris) {
    const c = centre(pts);
    const faces = [];
    for (let i = 0; i < tris.length; i += 3) {
        let f = [pts[tris[i]], pts[tris[i + 1]], pts[tris[i + 2]]];
        let n = newell(f);
        if (dot(n, sub(f[0], c)) < 0) {
            f = [f[0], f[2], f[1]];
            n = [-n[0], -n[1], -n[2]];
        }
        faces.push({ pts: f, n, cut: false });
    }
    return { faces };
}
function centre(pts) {
    let x = 0, y = 0, z = 0;
    for (const p of pts) {
        x += p[0];
        y += p[1];
        z += p[2];
    }
    const k = 1 / Math.max(1, pts.length);
    return [x * k, y * k, z * k];
}
/** keep the part where dot(n, x) <= d (null if nothing is left); `cut` marks the new cap face */
export function clip(poly, n, d, cut = true) {
    const faces = [];
    const cap = [];
    let removed = false;
    for (const f of poly.faces) {
        const pts = f.pts;
        const out = [];
        const m = pts.length;
        for (let i = 0; i < m; i++) {
            const a = pts[i], b = pts[(i + 1) % m];
            const da = dot(n, a) - d, db = dot(n, b) - d;
            const ia = da <= EPS, ib = db <= EPS;
            if (ia)
                out.push(a);
            else
                removed = true;
            const onA = ia && Math.abs(da) <= EPS;
            if (onA)
                cap.push(a);
            // (crossing between them: a new point — unless an end is on the plane, which is the crossing itself)
            if (ia !== ib && !onA && !(ib && Math.abs(db) <= EPS)) {
                const t = da / (da - db);
                const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
                out.push(p);
                cap.push(p);
            }
        }
        if (out.length >= 3)
            faces.push({ pts: out, n: f.n, cut: f.cut });
    }
    if (!removed)
        return poly;
    if (faces.length < 3)
        return null;
    // the cap: the crossing points, deduplicated, in order round their centre (counter-clockwise about n)
    const uniq = [];
    for (const p of cap)
        if (!uniq.some((q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-6))
            uniq.push(p);
    if (uniq.length >= 3) {
        const c = centre(uniq);
        const u = norm(cross(Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], n));
        const v = cross(n, u);
        uniq.sort((p, q) => Math.atan2(dot(sub(p, c), v), dot(sub(p, c), u)) - Math.atan2(dot(sub(q, c), v), dot(sub(q, c), u)));
        faces.push({ pts: uniq, n: [...n], cut });
    }
    return { faces };
}
/** distinct vertices (a polyhedron has a few dozen: compared directly — no keys to build — which is what a break's
 *  hot path wants) */
export function vertices(poly, eps = 1e-6) {
    const out = [];
    for (const f of poly.faces)
        for (const p of f.pts) {
            let dup = false;
            for (let i = 0; i < out.length; i++) {
                const o = out[i];
                if (Math.abs(o[0] - p[0]) <= eps && Math.abs(o[1] - p[1]) <= eps && Math.abs(o[2] - p[2]) <= eps) {
                    dup = true;
                    break;
                }
            }
            if (!dup)
                out.push(p);
        }
    return out;
}
/** volume and centre of mass (tetrahedra from a point inside) */
export function massProps(poly) {
    // (any point inside will do for the tetrahedra: the faces' corners averaged, repeats and all)
    let ox = 0, oy = 0, oz = 0, on = 0;
    for (const f of poly.faces)
        for (const p of f.pts) {
            ox += p[0];
            oy += p[1];
            oz += p[2];
            on++;
        }
    const o = on ? [ox / on, oy / on, oz / on] : [0, 0, 0];
    let vol = 0, cx = 0, cy = 0, cz = 0;
    for (const f of poly.faces) {
        const p0 = f.pts[0];
        for (let i = 1; i + 1 < f.pts.length; i++) {
            const p1 = f.pts[i], p2 = f.pts[i + 1];
            const v = dot(sub(p0, o), cross(sub(p1, o), sub(p2, o))) / 6;
            vol += v;
            cx += v * (o[0] + p0[0] + p1[0] + p2[0]) / 4;
            cy += v * (o[1] + p0[1] + p1[1] + p2[1]) / 4;
            cz += v * (o[2] + p0[2] + p1[2] + p2[2]) / 4;
        }
    }
    return vol > 1e-12 ? { volume: vol, centroid: [cx / vol, cy / vol, cz / vol] } : { volume: 0, centroid: o };
}
export function bounds(poly) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const f of poly.faces)
        for (const p of f.pts)
            for (let k = 0; k < 3; k++) {
                lo[k] = Math.min(lo[k], p[k]);
                hi[k] = Math.max(hi[k], p[k]);
            }
    return { lo, hi };
}
export function translate(poly, t) {
    return { faces: poly.faces.map((f) => ({ pts: f.pts.map((p) => [p[0] + t[0], p[1] + t[1], p[2] + t[2]]), n: f.n, cut: f.cut })) };
}
/** is p inside (every face's plane in front of it)? */
export function contains(poly, p, margin = 0) {
    for (const f of poly.faces)
        if (dot(f.n, sub(p, f.pts[0])) > -margin)
            return false;
    return true;
}
/** the Voronoi cells of `sites` inside the polyhedron (each a polyhedron; empty and sliver cells dropped) */
export function voronoi(poly, sites, minVolume = 1e-5) {
    const out = [];
    for (let i = 0; i < sites.length; i++) {
        const s = sites[i];
        // nearest sites first: their planes cut the most, so the far ones are skipped once the cell is small
        const order = sites.map((q, j) => ({ j, d: (q[0] - s[0]) ** 2 + (q[1] - s[1]) ** 2 + (q[2] - s[2]) ** 2 })).filter((o) => o.j !== i).sort((a, b) => a.d - b.d);
        let cell = poly;
        for (const { j, d } of order) {
            if (!cell)
                break;
            // (a plane further from the site than the cell's furthest vertex can't cut it)
            let reach = 0;
            for (const f of cell.faces)
                for (const p of f.pts)
                    reach = Math.max(reach, (p[0] - s[0]) ** 2 + (p[1] - s[1]) ** 2 + (p[2] - s[2]) ** 2);
            if (d / 4 > reach)
                break;
            const q = sites[j];
            const n = norm(sub(q, s));
            const m = [(q[0] + s[0]) / 2, (q[1] + s[1]) / 2, (q[2] + s[2]) / 2];
            cell = clip(cell, n, dot(n, m));
        }
        if (cell && massProps(cell).volume > minVolume)
            out.push(cell);
    }
    return out;
}
/** n points inside the polyhedron, gathered round `focus` (if given: `spread` its reach, as a share of the size) */
export function scatter(poly, n, rand, focus, spread = 0.5, stretch = [1, 1, 1]) {
    const { lo, hi } = bounds(poly);
    const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const out = [];
    for (let tries = 0; out.length < n && tries < n * 60; tries++) {
        let p;
        if (focus && rand() < 0.75) {
            // (a gaussian round the focus: the fragments small where it was struck)
            const g = () => { const u = Math.max(1e-6, rand()), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v); };
            p = [focus[0] + g() * size[0] * spread * stretch[0], focus[1] + g() * size[1] * spread * stretch[1], focus[2] + g() * size[2] * spread * stretch[2]];
        }
        else
            p = [lo[0] + rand() * size[0], lo[1] + rand() * size[1], lo[2] + rand() * size[2]];
        if (contains(poly, p, 1e-4))
            out.push(p);
    }
    return out;
}
/** flat-shaded triangles: positions, normals, and per vertex 1 on a cut face */
export function triangulate(poly) {
    const pos = [], nrm = [], cut = [];
    for (const f of poly.faces) {
        const p0 = f.pts[0];
        for (let i = 1; i + 1 < f.pts.length; i++) {
            for (const p of [p0, f.pts[i], f.pts[i + 1]]) {
                pos.push(p[0], p[1], p[2]);
                nrm.push(f.n[0], f.n[1], f.n[2]);
                cut.push(f.cut ? 1 : 0);
            }
        }
    }
    return { pos, nrm, cut };
}
//# sourceMappingURL=convex.js.map