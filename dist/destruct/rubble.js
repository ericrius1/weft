// Rubble: things built to be broken. A structure is cells (bricks, slabs, beams, panes — convex pieces) held by bonds
// where they touch, and to the ground where they stand on it. A whole anchored structure is one static body; a part
// that loses its way to the ground becomes a dynamic body of its own, falls as one piece and breaks again when it
// lands. Energy does the breaking: an impact (½·m·v² of the pair, from box3d's hit events) or a blast spends itself on
// the bonds and cells round where it struck — bonds snap, cells shatter into Voronoi fragments (loom/destruct/convex),
// small fragments are debris that settles, fades and goes. A crude load rule brings down what is left standing on too
// few anchors. The pieces drawn are loom/render/pieces; the game hears about every crack, shatter and splash.
import { quat, vec3 } from 'math';
import { mulberry32 } from 'math/random';
import { boxPoly, massProps, scatter, translate, triangulate, vertices, voronoi } from './convex';
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ID = [0, 0, 0, 1];
export class Rubble {
    phys;
    pieces;
    cells = new Set();
    bodies = new Map();
    byShape = new Map();
    events = [];
    /** the ground's height (cells standing on it are anchored) and the sea's (below it things splash and sink) */
    groundY = 0;
    seaY = -Infinity;
    /** cells that won't shatter (one being carried) */
    protect = new Set();
    /** cells allowed before debris is hurried away */
    budget = 2200;
    /** pieces smaller than this (m) don't collide with each other, sleep sooner and fade in seconds */
    smallSize = 0.34;
    /** how hard impacts break things (energy multiplier), and the least energy that does anything */
    impactK = 1;
    minImpact = 1500;
    /** the least approach speed (m/s) that breaks anything: a heavy thing settling is a bump, not a crash */
    minSpeed = 0;
    /** the reach of a hit's damage (m, at most), and a blast's (least, most) and its push (impulse per m², at most) */
    maxRadius = 8;
    blastMin = 1.5;
    blastMax = 10;
    blastPush = 2600;
    /** cells in moving bodies (the debris budget counts these: what stands costs nothing per frame) */
    dynCells = 0;
    /** what a break may make: fragments a frame (past it, the small ones go to dust), most fragments a cell, fragments
     *  added per metre of the cell's size; moving bodies fall asleep below this speed (m/s; 0: box3d's own); past the
     *  budget, fragments under this size are hurried away too, not just the debris */
    fragsPerFrame = 160;
    maxShards = 28;
    sizeShards = 2;
    sleepSpeed = 0;
    crowdSize = 0;
    /** a part that came loose (its new body, its cells) — the game may push it over */
    onDetach = null;
    time = 0;
    /** what's been broken: the game's score */
    stats = { bonds: 0, shattered: 0, detached: 0, fragments: 0, value: 0 };
    /** value per m³ of material broken off (the score) */
    valueOf = (_m, vol) => vol * 100;
    nextId = 1;
    markId = 1;
    rng = mulberry32.create(20261014);
    boxHulls = new Map();
    hits = [];
    dirty = new Set();
    booms = [];
    loadT = 0;
    /** standing bodies hit since the load rule last found them sound */
    loadBodies = new Set();
    /** cells whose heat or damage the pieces haven't caught up with */
    hot = new Set();
    /** fragments that may become bodies this frame (the rest: dust) */
    fragBudget = this.fragsPerFrame;
    scratchV = [0, 0, 0];
    constructor(phys, pieces) {
        this.phys = phys;
        this.pieces = pieces;
        phys.onMove = (ev) => {
            const rb = this.bodies.get(ev.bodyId.index1);
            if (!rb || rb.id.generation !== ev.bodyId.generation)
                return;
            rb.p[0] = ev.position[0];
            rb.p[1] = ev.position[1];
            rb.p[2] = ev.position[2];
            rb.q[0] = ev.rotation[0];
            rb.q[1] = ev.rotation[1];
            rb.q[2] = ev.rotation[2];
            rb.q[3] = ev.rotation[3];
            for (const c of rb.cells)
                this.place(c, rb);
        };
        phys.onHit = (ev) => {
            if (ev.approachSpeed < 2.5 || this.hits.length > 256)
                return;
            this.hits.push({ a: { ...ev.shapeIdA }, b: { ...ev.shapeIdB }, p: [ev.point[0], ev.point[1], ev.point[2]], n: [ev.normal[0], ev.normal[1], ev.normal[2]], v: ev.approachSpeed });
        };
    }
    rand() { return mulberry32.sample(this.rng); }
    // ------------------------------------------------------------------------------------------------ building
    /** a structure: cells bonded where they touch and anchored where they stand on the ground (bonded=false: loose,
     *  each cell its own body — a stack of crates). Anchored parts become one static body; the rest fall. */
    build(specs, o = {}) {
        const made = specs.map((s) => this.makeCell(s));
        if (o.bonded !== false)
            this.bondAll(made, o.bondK ?? 1);
        // (bonds the bounds can't see: cells turned to each other, like the stones of a ring)
        for (const [i, j, area] of o.links ?? []) {
            const a = made[i], b = made[j];
            if (!a || !b || a.bonds.some((x) => x.a === b || x.b === b))
                continue;
            const hp = Math.min(a.mat.bond, b.mat.bond) * area * (o.bondK ?? 1);
            const bond = { a, b, hp, hp0: hp, area, mark: 0 };
            a.bonds.push(bond);
            b.bonds.push(bond);
        }
        if (o.anchored !== false) {
            made.forEach((c, i) => {
                const lo = this.lowestY(c);
                if (specs[i].anchor || lo <= this.groundY + 0.04)
                    c.ground = c.mat.bond * Math.max(0.05, this.footprint(c)) * 2;
            });
        }
        // bodies: anchored components together in one static body; each loose component its own dynamic body
        const comps = this.components(made, (c) => true);
        const anchored = [];
        for (const comp of comps) {
            const anchors = comp.filter((c) => c.ground > 0);
            if (anchors.length) {
                anchored.push(...comp);
                for (const a of anchors)
                    a.load0 = comp.length / anchors.length;
            }
            else
                this.makeBody(comp, true, this.centroid(comp), ID);
        }
        if (anchored.length)
            this.makeBody(anchored, false, [0, 0, 0], ID);
        return made;
    }
    /** a loose thing (a crate, a ball, a barrel): one dynamic body */
    loose(spec, vel, angVel) {
        const c = this.makeCell(spec);
        this.makeBody([c], true, [...c.wp], [...c.wq], vel, angVel);
        return c;
    }
    makeCell(s) {
        const poly = s.poly ?? boxPoly(s.half[0], s.half[1], s.half[2]);
        const mp = massProps(poly);
        // (a polyhedron off its centre: re-centred so the cell's frame sits at its centre of mass)
        const p0 = Math.hypot(...mp.centroid) > 1e-5 ? translate(poly, [-mp.centroid[0], -mp.centroid[1], -mp.centroid[2]]) : poly;
        const q = s.q && s.q.length === 4 ? [...s.q] : s.q ? this.euler(s.q) : [0, 0, 0, 1];
        let radius = 0;
        const verts = vertices(p0, 1e-4);
        for (const v of verts)
            radius = Math.max(radius, Math.hypot(v[0], v[1], v[2]));
        const size = Math.cbrt(mp.volume);
        const hp0 = s.mat.tough * mp.volume + 2000;
        const c = {
            id: this.nextId++, poly: p0, half: s.poly ? null : s.half, mat: s.mat, vol: mp.volume, size, radius,
            body: null, shape: null, lp: [...s.p], lq: q, wp: [...s.p], wq: [...q], piece: null,
            m0: [...(s.m0 ?? s.p)], tint: s.tint ?? s.mat.color, bonds: [], ground: 0, hp: hp0, hp0, debris: size < s.mat.minSize, small: size < this.smallSize,
            die: Infinity, fade: 1, heat: 0, dmgShown: 0, mark: 0, born: this.time, load0: 0, verts,
        };
        const tri = triangulate(p0);
        c.piece = this.pieces.add(tri, s.mat.id, c.m0, c.tint, this.rand(), c.half);
        this.cells.add(c);
        if (c.piece)
            this.pieces.set(c.piece, c.wp, c.wq, 1);
        return c;
    }
    euler(e) { const q = quat.create(); quat.fromEuler(q, [e[0], e[1], e[2], 'yxz']); return q; }
    /** bonds between cells whose bounds touch face to face (area: their overlap) */
    bondAll(cells, k) {
        const grid = new Map();
        const boxes = new Map();
        // (the grid's cell about the size of the cells: a city block's slabs and a pier's bricks alike)
        let span = 0;
        for (const c of cells) {
            const b = this.aabb(c);
            boxes.set(c, b);
            span += Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]);
        }
        const H = Math.min(12, Math.max(2, (span / Math.max(1, cells.length)) * 0.75));
        for (const c of cells) {
            const b = boxes.get(c);
            for (let x = Math.floor(b.lo[0] / H); x <= Math.floor(b.hi[0] / H); x++)
                for (let y = Math.floor(b.lo[1] / H); y <= Math.floor(b.hi[1] / H); y++)
                    for (let z = Math.floor(b.lo[2] / H); z <= Math.floor(b.hi[2] / H); z++) {
                        const key = `${x},${y},${z}`;
                        const l = grid.get(key);
                        if (l)
                            l.push(c);
                        else
                            grid.set(key, [c]);
                    }
        }
        const seen = new Set();
        const E = 0.03;
        for (const l of grid.values())
            for (let i = 0; i < l.length; i++)
                for (let j = i + 1; j < l.length; j++) {
                    const a = l[i], b = l[j];
                    const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
                    if (seen.has(key))
                        continue;
                    seen.add(key);
                    const A = boxes.get(a), B = boxes.get(b);
                    const ov = [0, 1, 2].map((d) => Math.min(A.hi[d], B.hi[d]) - Math.max(A.lo[d], B.lo[d]));
                    if (ov.some((o) => o < -E))
                        continue;
                    // (touching on one axis, overlapping on the other two)
                    const touch = ov.map((o) => o < E);
                    const nT = touch.filter(Boolean).length;
                    if (nT !== 1)
                        continue;
                    const area = ov.filter((_, d) => !touch[d]).reduce((s, o) => s * Math.max(o, 0), 1);
                    if (area < 0.01)
                        continue;
                    const hp = Math.min(a.mat.bond, b.mat.bond) * area * k;
                    const bond = { a, b, hp, hp0: hp, area, mark: 0 };
                    a.bonds.push(bond);
                    b.bonds.push(bond);
                }
    }
    aabb(c) {
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        const t = [0, 0, 0];
        for (const v of c.verts) {
            vec3.transformQuat(t, v, c.wq);
            for (let d = 0; d < 3; d++) {
                const x = t[d] + c.wp[d];
                lo[d] = Math.min(lo[d], x);
                hi[d] = Math.max(hi[d], x);
            }
        }
        return { lo, hi };
    }
    lowestY(c) { return this.aabb(c).lo[1]; }
    footprint(c) {
        // (a standing cell doesn't move: its footprint, found once)
        if (c.body && !c.body.dynamic && c.foot !== undefined)
            return c.foot;
        const b = this.aabb(c), f = (b.hi[0] - b.lo[0]) * (b.hi[2] - b.lo[2]);
        if (c.body && !c.body.dynamic)
            c.foot = f;
        return f;
    }
    centroid(cells) {
        let m = 0;
        const p = [0, 0, 0];
        for (const c of cells) {
            m += c.vol;
            p[0] += c.wp[0] * c.vol;
            p[1] += c.wp[1] * c.vol;
            p[2] += c.wp[2] * c.vol;
        }
        return m > 0 ? [p[0] / m, p[1] / m, p[2] / m] : [...cells[0].wp];
    }
    /** connected groups (by bonds between cells that `keep`) */
    components(cells, keep) {
        const id = this.markId++;
        const out = [];
        const set = new Set();
        for (const c of cells)
            if (keep(c))
                set.add(c);
        for (const c of set) {
            if (c.mark === id)
                continue;
            const comp = [];
            const stack = [c];
            c.mark = id;
            while (stack.length) {
                const x = stack.pop();
                comp.push(x);
                for (const b of x.bonds) {
                    const y = b.a === x ? b.b : b.a;
                    if (y.mark !== id && set.has(y)) {
                        y.mark = id;
                        stack.push(y);
                    }
                }
            }
            out.push(comp);
        }
        return out;
    }
    // ------------------------------------------------------------------------------------------------ bodies
    shapeDefs = new Map();
    shapeDef(m, small) {
        const key = m.name + (small ? ':s' : '');
        let sd = this.shapeDefs.get(key);
        if (!sd) {
            const b3 = this.phys.b3;
            sd = b3.b3DefaultShapeDef();
            sd.density = m.density;
            sd.baseMaterial.friction = m.friction;
            sd.baseMaterial.restitution = m.restitution;
            sd.baseMaterial.rollingResistance = small ? 0.08 : 0.02;
            sd.enableHitEvents = true;
            sd.updateBodyMass = false;
            // (small pieces are category 2 and skip each other: piles of shards cost nothing)
            if (small)
                sd.filter = { categoryBits: 2n, maskBits: ~2n & 0xffffffffffffffffn, groupIndex: 0 };
            this.shapeDefs.set(key, sd);
        }
        return sd;
    }
    hullFor(c) {
        const b3 = this.phys.b3;
        if (c.half) {
            const k = c.half.map((x) => x.toFixed(3)).join(',');
            let h = this.boxHulls.get(k);
            if (!h) {
                const [x, y, z] = c.half;
                h = b3.b3CreateHull([-x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z, -x, y, -z, x, y, -z, x, y, z, -x, y, z]);
                this.boxHulls.set(k, h);
            }
            return { hull: h, own: false };
        }
        const vs = c.verts;
        let h = b3.b3CreateHull(vs.flat());
        if (!h) {
            // (too many corners for a hull: the furthest 24 from the centre)
            const far = [...vs].sort((a, b) => Math.hypot(...b) - Math.hypot(...a)).slice(0, 24);
            h = b3.b3CreateHull(far.flat());
        }
        return { hull: h, own: true };
    }
    makeBody(cells, dynamic, p, q, vel, ang) {
        const b3 = this.phys.b3;
        const bd = b3.b3DefaultBodyDef();
        bd.type = dynamic ? b3.b3BodyType.b3_dynamicBody : b3.b3BodyType.b3_staticBody;
        bd.position = [p[0], p[1], p[2]];
        bd.rotation = [q[0], q[1], q[2], q[3]];
        if (vel)
            bd.linearVelocity = vel;
        if (ang)
            bd.angularVelocity = ang;
        if (dynamic) {
            bd.angularDamping = 0.05;
            bd.linearDamping = 0.02;
            if (this.sleepSpeed > 0)
                bd.sleepThreshold = this.sleepSpeed;
            if (cells.length === 1 && cells[0].small) {
                bd.sleepThreshold = Math.max(0.3, this.sleepSpeed);
                bd.angularDamping = 0.3;
            }
        }
        const id = b3.b3CreateBody(this.phys.world, bd);
        const rb = { id, key: id.index1, cells: new Set(), dynamic, p: [...p], q: [...q], wet: false, born: this.time };
        this.bodies.set(rb.key, rb);
        const qi = quat.invert(quat.create(), q);
        const t = [0, 0, 0];
        for (const c of cells) {
            // the cell's place in the new body's frame
            vec3.transformQuat(t, sub(c.wp, p), qi);
            c.lp = [t[0], t[1], t[2]];
            c.lq = quat.multiply(quat.create(), qi, c.wq);
            this.attach(c, rb);
        }
        if (dynamic)
            b3.b3Body_ApplyMassFromShapes(id);
        return rb;
    }
    attach(c, rb) {
        const b3 = this.phys.b3;
        const { hull, own } = this.hullFor(c);
        if (!hull)
            return;
        c.shape = b3.b3CreateTransformedHullShape(rb.id, this.shapeDef(c.mat, c.small), hull, { position: c.lp, quaternion: c.lq }, [1, 1, 1]);
        if (own)
            b3.b3DestroyHull(hull);
        this.byShape.set(c.shape.index1, c);
        c.body = rb;
        rb.cells.add(c);
    }
    detachShape(c) {
        if (c.shape) {
            this.byShape.delete(c.shape.index1);
            if (this.phys.b3.b3Shape_IsValid(c.shape))
                this.phys.b3.b3DestroyShape(c.shape, false);
            c.shape = null;
        }
        c.body?.cells.delete(c);
        c.body = null;
    }
    dropBody(rb) {
        this.bodies.delete(rb.key);
        this.dirty.delete(rb);
        if (this.phys.b3.b3Body_IsValid(rb.id))
            this.phys.b3.b3DestroyBody(rb.id);
    }
    /** where a cell is: its body's transform and its place in it */
    place(c, rb) {
        const t = this.scratchV;
        vec3.transformQuat(t, c.lp, rb.q);
        c.wp[0] = rb.p[0] + t[0];
        c.wp[1] = rb.p[1] + t[1];
        c.wp[2] = rb.p[2] + t[2];
        quat.multiply(c.wq, rb.q, c.lq);
        if (c.piece)
            this.pieces.set(c.piece, c.wp, c.wq, c.fade);
    }
    /** the cell a shape belongs to */
    cellOf(s) {
        const c = this.byShape.get(s.index1);
        return c && c.shape && c.shape.generation === s.generation ? c : null;
    }
    massOfShape(s) {
        const b3 = this.phys.b3;
        if (!b3.b3Shape_IsValid(s))
            return Infinity;
        const body = b3.b3Shape_GetBody(s);
        return b3.b3Body_GetType(body) === b3.b3BodyType.b3_dynamicBody ? b3.b3Body_GetMass(body) : Infinity;
    }
    velAt(rb, p) {
        if (!rb || !rb.dynamic || !this.phys.b3.b3Body_IsValid(rb.id))
            return { v: [0, 0, 0], w: [0, 0, 0] };
        const v = [0, 0, 0], w = [0, 0, 0];
        this.phys.b3.b3Body_GetWorldPointVelocity(v, rb.id, p);
        this.phys.b3.b3Body_GetAngularVelocity(w, rb.id);
        return { v, w };
    }
    /** remove a cell for good */
    remove(c) {
        const rb = c.body;
        for (const b of [...c.bonds])
            this.unbond(b);
        this.detachShape(c);
        if (c.piece) {
            this.pieces.remove(c.piece);
            c.piece = null;
        }
        this.cells.delete(c);
        if (rb) {
            if (rb.cells.size === 0)
                this.dropBody(rb);
            else {
                if (rb.dynamic)
                    this.phys.b3.b3Body_ApplyMassFromShapes(rb.id);
                this.dirty.add(rb);
            }
        }
    }
    unbond(b) {
        b.a.bonds.splice(b.a.bonds.indexOf(b), 1);
        b.b.bonds.splice(b.b.bonds.indexOf(b), 1);
        if (b.a.body)
            this.dirty.add(b.a.body);
        if (b.b.body)
            this.dirty.add(b.b.body);
    }
    // ------------------------------------------------------------------------------------------------ breaking
    /** spend `energy` (J) at p. It spreads as from a point — the intensity (J/m²) falls as 1/(4πd²) — and each bond takes
     *  the intensity over its area (it snaps past its strength), the ground's hold likewise, each cell over its cross
     *  section (it shatters past its toughness). `fresh`: impacts spare what has only just broken off (no chain reaction). */
    damage(p, energy, o = {}) {
        // (out to where the intensity is down to the weakest bond's)
        const R = o.radius ?? Math.min(this.maxRadius, Math.max(0.5, Math.sqrt(energy / (4 * Math.PI * 6000))));
        const hitCells = [];
        this.phys.overlapAABB([p[0] - R, p[1] - R, p[2] - R], [p[0] + R, p[1] + R, p[2] + R], (s) => {
            const c = this.cellOf(s);
            if (c)
                hitCells.push(c);
        });
        const mark = this.markId++;
        const shatter = [];
        const I = (d) => energy / (4 * Math.PI * Math.max(d, 0.3) ** 2) * (1 - Math.min(1, d / R) ** 2);
        for (const c of hitCells) {
            const d = Math.max(0, dist(c.wp, p) - c.radius * 0.5);
            if (d > R)
                continue;
            const i = I(d);
            if (c.body && !c.body.dynamic)
                this.loadBodies.add(c.body);
            for (const b of [...c.bonds]) {
                if (b.mark === mark)
                    continue;
                b.mark = mark;
                const mid = [(b.a.wp[0] + b.b.wp[0]) / 2, (b.a.wp[1] + b.b.wp[1]) / 2, (b.a.wp[2] + b.b.wp[2]) / 2];
                b.hp -= I(dist(mid, p)) * b.area;
                if (b.hp <= 0) {
                    this.unbond(b);
                    this.stats.bonds++;
                    if (this.rand() < 0.35)
                        this.events.push({ kind: 'crack', p: mid, mat: b.a.mat, size: Math.sqrt(b.area), energy });
                }
            }
            if (c.ground > 0) {
                c.ground -= i * Math.max(0.05, this.footprint(c));
                if (c.ground <= 0) {
                    c.ground = 0;
                    if (c.body)
                        this.dirty.add(c.body);
                }
            }
            if (o.heat) {
                c.heat = Math.max(c.heat, o.heat * (1 - d / R));
                this.hot.add(c);
            }
            if ((o.fresh && this.time - c.born < 0.25) || this.protect.has(c))
                continue;
            if (!c.debris || c.size > 0.12) {
                c.hp -= i * c.size * c.size * (o.shatterK ?? 1);
                this.hot.add(c);
                if (c.hp <= 0)
                    shatter.push(c);
            }
        }
        for (const c of shatter)
            if (this.cells.has(c))
                this.shatter(c, p, I(Math.max(0, dist(c.wp, p) - c.radius * 0.5)) * c.size * c.size, o.dir);
    }
    /** break a cell into fragments round `at` (world) */
    shatter(c, at, energy, dir) {
        const rb = c.body;
        const { v: v0, w: w0 } = this.velAt(rb, c.wp);
        const mat = c.mat;
        this.stats.shattered++;
        this.stats.value += this.valueOf(mat, c.vol);
        if (mat.explosive && !c.__boomed) {
            c.__boomed = true;
            this.booms.push({ at: this.time + 0.04 + this.rand() * 0.12, p: [...c.wp], e: mat.explosive, mat });
        }
        // (small enough already: it goes to dust)
        if (c.debris || c.size < mat.minSize * 1.6) {
            this.events.push({ kind: 'dust', p: [...c.wp], mat, size: c.size, energy });
            this.remove(c);
            return;
        }
        // where it was struck, in the cell's own frame
        const qi = quat.invert(quat.create(), c.wq);
        const local = vec3.transformQuat([0, 0, 0], sub(at, c.wp), qi);
        const lim = c.radius * 0.9;
        const ll = Math.hypot(...local);
        if (ll > lim) {
            local[0] *= lim / ll;
            local[1] *= lim / ll;
            local[2] *= lim / ll;
        }
        const [lo, hi] = mat.shards;
        const n = Math.round(lo + (hi - lo) * Math.min(1, Math.sqrt(energy / Math.max(1, c.hp0 * 4)))) + Math.round(c.size * this.sizeShards);
        const sites = scatter(c.poly, Math.min(this.maxShards, n), () => this.rand(), local, 0.28, mat.stretch ?? [1, 1, 1]);
        const frags = sites.length >= 2 ? voronoi(c.poly, sites) : [c.poly];
        const wq = [...c.wq], wp = [...c.wp], m0 = c.m0, tint = c.tint;
        const heat = c.heat;
        this.events.push({ kind: 'shatter', p: [...at], mat, size: c.size, energy, n: frags.length });
        this.remove(c);
        const t = [0, 0, 0];
        const spare = this.dynCells > this.budget;
        for (const f of frags) {
            const mp = massProps(f);
            if (mp.volume < 1e-5)
                continue;
            const fp = translate(f, [-mp.centroid[0], -mp.centroid[1], -mp.centroid[2]]);
            vec3.transformQuat(t, mp.centroid, wq);
            const p = [wp[0] + t[0], wp[1] + t[1], wp[2] + t[2]];
            const size = Math.cbrt(mp.volume);
            // (the dust of a big break: the smallest bits needn't be bodies at all)
            if (size < 0.08 || ((spare || this.fragBudget <= 0) && size < Math.max(this.smallSize, mat.minSize * 1.5))) {
                this.events.push({ kind: 'dust', p, mat, size, energy: 0 });
                continue;
            }
            // (its texture runs on from where it was in the whole)
            const cell = this.makeCell({ poly: fp, mat, p, q: wq, tint, m0: [m0[0] + mp.centroid[0], m0[1] + mp.centroid[1], m0[2] + mp.centroid[2]] });
            cell.heat = heat;
            cell.frag = true;
            if (heat > 0)
                this.hot.add(cell);
            if (cell.small)
                cell.die = this.time + 3.5 + this.rand() * 4;
            else if (cell.debris)
                cell.die = this.time + 9 + this.rand() * 6;
            // thrown out from where it was struck, on top of how the whole was moving
            const out = sub(p, at);
            const ol = Math.hypot(...out) || 1;
            const mass = mp.volume * mat.density;
            const kick = Math.min(14, Math.sqrt((2 * energy * 0.15) / Math.max(mass * frags.length, 1)));
            const vel = [v0[0] + (out[0] / ol) * kick + (dir ? dir[0] * kick * 0.5 : 0), v0[1] + (out[1] / ol) * kick + kick * 0.2, v0[2] + (out[2] / ol) * kick + (dir ? dir[2] * kick * 0.5 : 0)];
            const ang = [w0[0] + (this.rand() - 0.5) * kick, w0[1] + (this.rand() - 0.5) * kick, w0[2] + (this.rand() - 0.5) * kick];
            this.makeBody([cell], true, p, [...wq], vel, ang);
            this.stats.fragments++;
            this.fragBudget--;
        }
    }
    /** a blast: everything pushed away (box3d's explosion), and its energy spent on what's near */
    explode(p, energy, heat = 1) {
        const R = Math.min(this.blastMax, Math.max(this.blastMin, Math.sqrt(energy / (4 * Math.PI * 6000))));
        this.damage(p, energy * 0.6, { shatterK: 1.3, heat, radius: R });
        this.phys.explode(p, R * 1.8, Math.min(this.blastPush, Math.max(300, energy / 900)), R);
        this.events.push({ kind: 'boom', p: [...p], mat: { name: 'blast' }, size: R, energy });
    }
    // ------------------------------------------------------------------------------------------------ per frame
    /** after the physics: impacts, splits, blasts, debris, the sea, the load rule; the pieces' attributes */
    update(dt) {
        this.time += dt;
        this.fragBudget = this.fragsPerFrame;
        const b3 = this.phys.b3;
        // impacts: the pair's energy, spent where they met
        const hits = this.hits;
        this.hits = [];
        for (const h of hits) {
            const A = this.cellOf(h.a), B = this.cellOf(h.b);
            if (!A && !B)
                continue;
            // (static things — the ground, a standing structure — are infinitely heavy; a cannonball is what it weighs)
            const mA = this.massOfShape(h.a), mB = this.massOfShape(h.b);
            const mred = mA === Infinity && mB === Infinity ? 0 : mA === Infinity ? mB : mB === Infinity ? mA : (mA * mB) / (mA + mB);
            const E = 0.5 * mred * h.v * h.v * this.impactK;
            const big = A ?? B;
            this.events.push({ kind: 'impact', p: h.p, mat: big.mat, size: Math.max(A?.size ?? 0, B?.size ?? 0), energy: E });
            if (E < this.minImpact || h.v < this.minSpeed)
                continue;
            this.damage(h.p, E * 0.6, { dir: h.n, fresh: true });
        }
        // ghosts solid again
        if (this.ghosts.length) {
            for (const g of this.ghosts)
                if (this.time >= g.until && g.c.shape && b3.b3Shape_IsValid(g.c.shape))
                    b3.b3Shape_SetFilter(g.c.shape, b3.b3DefaultShapeDef().filter, true);
            this.ghosts = this.ghosts.filter((g) => this.time < g.until);
        }
        // chained blasts
        if (this.booms.length) {
            const now = this.booms.filter((b) => b.at <= this.time);
            this.booms = this.booms.filter((b) => b.at > this.time);
            for (const b of now)
                this.explode(b.p, b.e);
        }
        // splits: what lost its way to the ground falls; what came apart goes its own ways
        for (const rb of [...this.dirty])
            this.resplit(rb);
        this.dirty.clear();
        // the load rule (every half second): too few anchors for what they hold, and they give
        this.loadT -= dt;
        if (this.loadT <= 0) {
            this.loadT = 0.5;
            this.loadRule();
        }
        // debris fades and goes; the sea takes what falls in (only what moves is looked at: a standing city costs nothing)
        const dyn = [];
        for (const rb of this.bodies.values())
            if (rb.dynamic)
                for (const c of rb.cells)
                    dyn.push(c);
        this.dynCells = dyn.length;
        const crowded = dyn.length > this.budget;
        for (const c of dyn) {
            const rb = c.body;
            if (!rb || !this.cells.has(c))
                continue;
            if ((c.debris || c.small || (c.frag && c.size < this.crowdSize)) && crowded && c.die > this.time + 3)
                c.die = this.time + 0.5 + this.rand() * 2;
            if (c.die < Infinity && this.time > c.die) {
                c.fade -= dt * 2;
                if (c.fade <= 0) {
                    this.remove(c);
                    continue;
                }
                if (c.piece)
                    this.pieces.set(c.piece, c.wp, c.wq, c.fade);
            }
            if (!rb.wet && c.wp[1] < this.seaY) {
                rb.wet = true;
                this.events.push({ kind: 'splash', p: [c.wp[0], this.seaY, c.wp[2]], mat: c.mat, size: c.size, energy: 0 });
                b3.b3Body_SetLinearDamping(rb.id, 2.5);
                b3.b3Body_SetAngularDamping(rb.id, 2);
                for (const x of rb.cells)
                    if (x.die === Infinity)
                        x.die = this.time + 5;
            }
            if (c.wp[1] < this.groundY - 120) {
                this.remove(c);
                continue;
            }
        }
        // cooling, and the cracks catching up with the damage
        for (const c of this.hot) {
            if (!this.cells.has(c) || !c.piece) {
                this.hot.delete(c);
                continue;
            }
            if (c.heat > 0)
                c.heat = Math.max(0, c.heat - dt * 0.35);
            const dmg = 1 - Math.max(0, c.hp) / c.hp0;
            if (Math.abs(dmg - c.dmgShown) > 0.04 || c.heat > 0) {
                c.dmgShown = dmg;
                this.pieces.setAttr(c.piece, c.heat, dmg);
            }
            if (c.heat <= 0) {
                this.pieces.setAttr(c.piece, 0, c.dmgShown);
                this.hot.delete(c);
            }
        }
        this.pieces.upload();
    }
    resplit(rb) {
        if (!this.bodies.has(rb.key))
            return;
        if (rb.cells.size === 0) {
            this.dropBody(rb);
            return;
        }
        const comps = this.components(rb.cells, (c) => c.body === rb);
        if (!rb.dynamic) {
            for (const comp of comps)
                if (!comp.some((c) => c.ground > 0))
                    this.detach(comp, rb);
        }
        else if (comps.length > 1) {
            let keep = comps[0], km = 0;
            for (const comp of comps) {
                const m = comp.reduce((s, c) => s + c.vol * c.mat.density, 0);
                if (m > km) {
                    km = m;
                    keep = comp;
                }
            }
            for (const comp of comps)
                if (comp !== keep)
                    this.detach(comp, rb);
        }
    }
    /** a group leaves its body: a dynamic body of its own, moving as that part of the old one was */
    detach(comp, from) {
        const c0 = this.centroid(comp);
        const { v, w } = this.velAt(from, c0);
        for (const c of comp)
            this.detachShape(c);
        if (from.dynamic && from.cells.size)
            this.phys.b3.b3Body_ApplyMassFromShapes(from.id);
        if (from.cells.size === 0)
            this.dropBody(from);
        // (lone small pieces are debris)
        if (comp.length === 1 && comp[0].debris && comp[0].die === Infinity)
            comp[0].die = this.time + 8 + this.rand() * 6;
        const rb = this.makeBody(comp, true, c0, from.dynamic ? [...from.q] : [0, 0, 0, 1], v, w);
        this.stats.detached++;
        this.onDetach?.(rb, comp, from);
        this.stats.value += comp.reduce((s, c) => s + this.valueOf(c.mat, c.vol) * 0.25, 0);
        this.events.push({ kind: 'detach', p: c0, mat: comp[0].mat, size: comp.length, energy: 0 });
    }
    loadRule() {
        for (const rb of this.loadBodies) {
            if (rb.dynamic || this.bodies.get(rb.key) !== rb) {
                this.loadBodies.delete(rb);
                continue;
            }
            let any = false;
            const comps = this.components(rb.cells, (c) => c.body === rb);
            for (const comp of comps) {
                const anchors = comp.filter((c) => c.ground > 0);
                if (!anchors.length)
                    continue;
                // (it stands while what's left of its footing could hold twice its share as built — it loses half and falls)
                let cap = 0, mat = 0;
                for (const a of anchors) {
                    cap += a.load0 * 2;
                    mat += a.mat.load;
                }
                cap = Math.max(cap, mat);
                if (comp.length <= cap)
                    continue;
                any = true;
                // (overloaded: the anchors crumble, a quarter of their hold a tick — the more overloaded, the faster)
                const over = Math.min(4, comp.length / cap);
                for (const a of anchors) {
                    a.ground -= a.mat.bond * 0.6 * over;
                    a.hp -= a.hp0 * 0.08 * over;
                    this.hot.add(a);
                    if (a.ground <= 0) {
                        a.ground = 0;
                        this.dirty.add(rb);
                    }
                }
                if (this.rand() < 0.5)
                    this.events.push({ kind: 'crack', p: [...anchors[0].wp], mat: anchors[0].mat, size: 1, energy: 0 });
            }
            if (!any)
                this.loadBodies.delete(rb);
        }
    }
    /** pull a cell out of whatever holds it (a grab): its bonds and its hold on the ground let go — a body of its own */
    free(c, ghost = 0.6) {
        for (const b of [...c.bonds]) {
            this.unbond(b);
            this.stats.bonds++;
        }
        c.ground = 0;
        const rb = c.body;
        if (!rb)
            return null;
        this.resplit(rb);
        this.dirty.delete(rb);
        // (it slides out through its neighbours — they'd hold it fast — and is solid again a moment later)
        if (ghost > 0 && c.shape) {
            this.phys.b3.b3Shape_SetFilter(c.shape, { categoryBits: 1n, maskBits: ~1n & 0xffffffffffffffffn, groupIndex: 0 }, true);
            this.ghosts.push({ c, until: this.time + ghost });
        }
        return c.body;
    }
    ghosts = [];
    /** the bodies that move */
    *dynamicBodies() { for (const b of this.bodies.values())
        if (b.dynamic)
            yield b; }
    /** everything gone (a reset) */
    clear() {
        for (const c of [...this.cells]) {
            if (c.piece)
                this.pieces.remove(c.piece);
            this.cells.delete(c);
        }
        for (const rb of [...this.bodies.values()])
            this.dropBody(rb);
        this.byShape.clear();
        this.dirty.clear();
        this.hot.clear();
        this.loadBodies.clear();
        this.dynCells = 0;
        this.booms = [];
        this.hits = [];
        this.events = [];
        this.pieces.upload();
    }
}
//# sourceMappingURL=rubble.js.map