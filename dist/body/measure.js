import { add, sub, scale, dot, cross, len, norm, lerp3, rotateAxis, rej } from '../math.js';
import { JOINTS, strain, SHOULDER_CONE, hipFlexMax, kneeRotK, SEGMENTS } from './anatomy.js';
/** a bone's skin rotation (columns: the images of bind x, y, z) as a row-major 3x3 */
function rotOf(m, i) {
    const k = i * 16;
    return [m[k], m[k + 4], m[k + 8], m[k + 1], m[k + 5], m[k + 9], m[k + 2], m[k + 6], m[k + 10]];
}
/** Rp^T Rc */
export function relRot(p, c) {
    const o = new Array(9);
    for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
            o[i * 3 + j] = p[i] * c[j] + p[3 + i] * c[3 + j] + p[6 + i] * c[6 + j];
    return o;
}
/** the right side's mirrored into the left's (x flipped both sides) */
export const mirror = (R) => [R[0], -R[1], -R[2], -R[3], R[4], R[5], -R[6], R[7], R[8]];
const mul = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const asin = (x) => Math.asin(Math.max(-1, Math.min(1, x)));
/** R = Rx(a) Rz(b) Ry(c): [a, b, c] */
export function eulerXZY(R) { return [Math.atan2(R[7], R[4]), asin(-R[1]), Math.atan2(R[2], R[0])]; }
/** R = Rx(a) Ry(c) Rz(b): [a, b, c] */
export function eulerXYZ(R) { return [Math.atan2(-R[5], R[8]), Math.atan2(-R[1], R[0]), asin(R[2])]; }
/** the signed angle from a to b about axis n */
const angAbout = (a, b, n) => Math.atan2(dot(cross(a, b), n), dot(a, b));
/** the shortest rotation taking unit a to unit b, applied to v */
function arc(a, b, v) {
    const ax = cross(a, b), s = len(ax), c = dot(a, b);
    if (s < 1e-6)
        return c > 0 ? v : rotateAxis(v, Math.abs(a[0]) < 0.9 ? norm(cross(a, [1, 0, 0])) : norm(cross(a, [0, 1, 0])), Math.PI);
    return rotateAxis(v, scale(ax, 1 / s), Math.atan2(s, c));
}
/** a skeleton's bind frames and lengths, made once per asset */
export class Skeleton {
    asset;
    bi;
    frames = [];
    constructor(asset) {
        this.asset = asset;
        this.bi = asset.index;
        for (const b of asset.bones) {
            const z = norm(sub(b.tail, b.head));
            let x = cross(b.up, z);
            if (len(x) < 1e-5)
                x = cross([1, 0, 0], z);
            x = norm(x);
            this.frames.push({ o: b.head, x, y: cross(z, x), z });
        }
    }
    has(n) { return this.bi[n] !== undefined; }
    dir(n) { return this.frames[this.bi[n]].z; }
    /** a bone's bind y (the 'up' it was posed with: the knee's front, the elbow's inside, the thumb's side) */
    up(n) { return this.frames[this.bi[n]].y; }
}
function pt(m, i, p) {
    const k = i * 16;
    return [m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12], m[k + 1] * p[0] + m[k + 5] * p[1] + m[k + 9] * p[2] + m[k + 13], m[k + 2] * p[0] + m[k + 6] * p[1] + m[k + 10] * p[2] + m[k + 14]];
}
function dirW(m, i, d) {
    const k = i * 16;
    return [m[k] * d[0] + m[k + 4] * d[1] + m[k + 8] * d[2], m[k + 1] * d[0] + m[k + 5] * d[1] + m[k + 9] * d[2], m[k + 2] * d[0] + m[k + 6] * d[1] + m[k + 10] * d[2]];
}
/** every joint of a posed body read off its bones */
export function measure(sk, m, o = {}) {
    const B = sk.asset.bones, bi = sk.bi, k = o.flex ?? 1;
    const out = [];
    const R = (n) => rotOf(m, bi[n]);
    const rel = (p, c, right) => { const r = relRot(R(p), R(c)); return right ? mirror(r) : r; };
    const P = (n, f = 0) => pt(m, bi[n], lerp3(B[bi[n]].head, B[bi[n]].tail, f));
    const push = (joint, side, dofName, v, d, loaded = false, lim) => {
        let dd = d;
        // (a limit that moves with another joint — the hamstrings', the shin's turn, the shoulder's by its plane: the
        // comfortable band kept inside it)
        if (lim) {
            const hi = lim.hi ?? d.hi, lo = lim.lo ?? d.lo;
            dd = { ...d, hi, lo, okHi: Math.min(d.okHi, hi * 0.6), okLo: Math.max(d.okLo, lo * 0.6), pHi: lim.hi !== undefined ? Math.max(hi, d.pHi ?? 0) : d.pHi, pLo: lim.lo !== undefined ? Math.min(lo, d.pLo ?? 0) : d.pLo };
        }
        const s = strain(v, dd, k, loaded);
        out.push({ joint, side, dof: dofName, v, strain: s, over: s > 1.0001, loaded: loaded || undefined });
    };
    // ---- what's on the ground (the support; a hand, a foot or a knee on it carries weight: its passive limits)
    const g = o.ground;
    const near = (p) => !!g && p[1] - g(p[0], p[2]) < 0.035;
    const support = [];
    const feetOn = [false, false], handsOn = [false, false], toesOn = [false, false];
    for (let s = 0; s < 2; s++) {
        const T = s === 0 ? 'L' : 'R';
        const heel = P('foot' + T, 0), ball = P('toe' + T, 0), tip = P('toe' + T, 1);
        // (the heel's point on the sole: below the ankle)
        const sole = g ? [heel[0], g(heel[0], heel[2]), heel[2]] : heel;
        if (g && heel[1] - sole[1] < 0.11 * (sk.asset.header.height / 1.66)) {
            support.push(sole);
            feetOn[s] = true;
        }
        if (near(ball)) {
            support.push(ball);
            feetOn[s] = true;
        }
        if (near(tip)) {
            support.push(tip);
            toesOn[s] = true;
        }
        const knee = P('shin' + T, 0);
        if (near(knee) || (g && knee[1] - g(knee[0], knee[2]) < 0.08))
            support.push(knee);
        if (sk.has('middle1' + T)) {
            const palm = P('middle1' + T, 0), wrist = P('hand' + T, 0);
            if (near(palm) || (g && palm[1] - g(palm[0], palm[2]) < 0.05 && wrist[1] - g(wrist[0], wrist[2]) < 0.09)) {
                support.push(palm, wrist);
                handsOn[s] = true;
            }
        }
    }
    if (o.seat)
        support.push(...o.seat);
    // ---- the spine, the neck and the head: flexion, side bend, turn (R = Rx Rz Ry)
    const spineJ = [['lumbar', 'pelvis', 'spine'], ['thoracic', 'spine', 'chest'], ['neckLow', 'chest', 'neck'], ['neckUp', 'neck', 'head']];
    for (const [j, p, c] of spineJ) {
        const [a, b, cc] = eulerXZY(rel(p, c, false));
        const J = JOINTS[j];
        push(j, '', 'flex', a, J.flex);
        push(j, '', 'side', b, J.side);
        push(j, '', 'turn', cc, J.turn);
    }
    for (let s = 0; s < 2; s++) {
        const T = s === 0 ? 'L' : 'R', side = T, right = s === 1;
        // ---- the hip (the thigh on the pelvis), the knee, the ankle, the toes
        const [ha, hb, hc] = eulerXZY(rel('pelvis', 'thigh' + T, right));
        const thighD = norm(sub(P('thigh' + T, 1), P('thigh' + T, 0))), shinD = norm(sub(P('shin' + T, 1), P('shin' + T, 0)));
        const kneeFront = norm(rej(dirW(m, bi['thigh' + T], sk.up('thigh' + T)), thighD));
        let kneeFlex = Math.atan2(-dot(shinD, kneeFront), dot(shinD, thighD));
        if (kneeFlex < -Math.PI / 2)
            kneeFlex += Math.PI * 2;
        // (a hip under the body's weight — its foot or knee down — goes to its passive range: a lunge's back leg, a squat)
        const hipLoad = feetOn[s] || toesOn[s];
        push('hip', side, 'flex', -ha, JOINTS.hip.flex, hipLoad, { hi: hipLoad && kneeFlex > 1.6 ? JOINTS.hip.flex.pHi : hipFlexMax(kneeFlex, k) / k });
        push('hip', side, 'abd', hb, JOINTS.hip.abd, hipLoad);
        push('hip', side, 'rot', hc, JOINTS.hip.rot);
        const kneeAx = norm(cross(thighD, kneeFront));
        push('knee', side, 'flex', kneeFlex, JOINTS.knee.flex, feetOn[s] || toesOn[s]);
        push('knee', side, 'varus', (right ? -1 : 1) * Math.asin(Math.max(-1, Math.min(1, dot(shinD, kneeAx)))), JOINTS.knee.varus);
        const [, , kc] = eulerXZY(rel('thigh' + T, 'shin' + T, right));
        const kr = kneeRotK(kneeFlex);
        push('knee', side, 'rot', kc, JOINTS.knee.rot, false, { lo: JOINTS.knee.rot.lo * kr, hi: JOINTS.knee.rot.hi * kr });
        const [aa, ab, ac] = eulerXYZ(rel('shin' + T, 'foot' + T, right));
        const footLoad = feetOn[s] || toesOn[s];
        push('ankle', side, 'dorsi', -aa, JOINTS.ankle.dorsi, footLoad);
        push('ankle', side, 'inv', ab, JOINTS.ankle.inv, footLoad);
        push('ankle', side, 'add', -ac, JOINTS.ankle.add);
        const [ta] = eulerXYZ(rel('foot' + T, 'toe' + T, right));
        push('toe', side, 'ext', -ta, JOINTS.toe.ext, toesOn[s]);
        // ---- the clavicle and the shoulder (on the chest)
        const cR = rel('chest', 'clav' + T, right), cd0 = sk.dir('clav' + T), cdb = right ? [-cd0[0], cd0[1], cd0[2]] : cd0, cd = mul(cR, cdb);
        push('clav', side, 'elev', asin(cd[1]) - asin(cdb[1]), JOINTS.clav.elev);
        push('clav', side, 'prot', Math.atan2(cd[2], cd[0]) - Math.atan2(cdb[2], cdb[0]), JOINTS.clav.prot);
        const uR = rel('chest', 'uarm' + T, right), ud0 = sk.dir('uarm' + T), uu0 = sk.up('uarm' + T);
        const mb = (v) => (right ? [-v[0], v[1], v[2]] : v);
        const hd = mul(uR, mb(ud0)), fold = mul(uR, mb(uu0));
        const elev = Math.acos(Math.max(-1, Math.min(1, -hd[1])));
        push('shoulder', side, 'elev', elev, JOINTS.shoulder.elev, handsOn[s]);
        push('shoulder', side, 'cone', Math.acos(Math.max(-1, Math.min(1, dot(norm(hd), SHOULDER_CONE)))), JOINTS.shoulder.cone, handsOn[s]);
        // (its rotation: the elbow's inside against where raising the arm straight from hanging would have carried it —
        // forward hanging, up with the arm forward, back overhead: Codman's paradox makes it undefined straight up, so the
        // limit's let go near there)
        const ref = arc([0, -1, 0], norm(hd), [0, 0, 1]), up = Math.max(0, Math.min(1, (elev - 150 * Math.PI / 180) / (20 * Math.PI / 180)));
        push('shoulder', side, 'rot', -angAbout(ref, fold, norm(hd)), JOINTS.shoulder.rot, false, up > 0 ? { lo: JOINTS.shoulder.rot.lo - up * 2, hi: JOINTS.shoulder.rot.hi + up * 2 } : undefined);
        // ---- the elbow, the forearm's roll, the wrist (as the rig's armStat reads them)
        const ud = norm(sub(P('uarm' + T, 1), P('uarm' + T, 0))), fd = norm(sub(P('farm' + T, 1), P('farm' + T, 0)));
        const elbowUp = norm(rej(dirW(m, bi['uarm' + T], sk.up('uarm' + T)), ud));
        push('elbow', side, 'flex', Math.atan2(dot(fd, elbowUp), dot(fd, ud)), JOINTS.elbow.flex, handsOn[s]);
        const hax = cross(ud, fd), hal = len(hax);
        const faUp = norm(rej(hal > 1e-6 ? rotateAxis(elbowUp, scale(hax, 1 / hal), Math.atan2(hal, dot(ud, fd))) : elbowUp, fd));
        const hdir = norm(sub(P('hand' + T, 1), P('hand' + T, 0)));
        const thumb = norm(rej(dirW(m, bi['hand' + T], sk.up('hand' + T)), hdir));
        const tp = norm(rej(thumb, fd));
        push('forearm', side, 'roll', Math.atan2(dot(cross(faUp, tp), fd), dot(faUp, tp)), JOINTS.forearm.roll);
        const sg = s === 0 ? 1 : -1, palm = scale(cross(hdir, thumb), sg), fh = dot(fd, hdir);
        push('wrist', side, 'flex', Math.atan2(-dot(fd, palm), fh), JOINTS.wrist.flex, handsOn[s]);
        push('wrist', side, 'dev', Math.atan2(-dot(fd, thumb), fh), JOINTS.wrist.dev, handsOn[s]);
        // ---- the fingers: each joint's flexion from its bind (toward the palm +), the knuckle's spread
        if ((o.fingers ?? true) && sk.has('index1' + T)) {
            const hb = bi['hand' + T];
            const pb = sk.dir('hand' + T), tb = norm(rej([0, 0, 1], pb)), palmB = scale(cross(pb, tb), sg);
            const palmW = norm(dirW(m, hb, palmB)), handW = norm(dirW(m, hb, pb));
            for (const f of ['index', 'middle', 'ring', 'pinky']) {
                if (!sk.has(f + '3' + T))
                    continue;
                const segB = [1, 2, 3].map((j) => sk.dir(f + j + T));
                const segW = [1, 2, 3].map((j) => norm(sub(P(f + j + T, 1), P(f + j + T, 0))));
                // (b's angle from a toward the palm's side, pn: the palm's normal square to a)
                const flexOf = (a, b, pn) => Math.atan2(dot(b, pn), dot(a, b));
                // (the knuckle: the first segment against the hand's own line, its flexion toward the palm and its spread)
                const kB = flexOf(pb, segB[0], palmB), kW = flexOf(handW, segW[0], palmW);
                push('mcp', side, f + '.flex', kW - kB, JOINTS.mcp.flex, handsOn[s]);
                const spreadAx = norm(cross(handW, palmW)), spreadAxB = norm(cross(pb, palmB));
                push('mcp', side, f + '.abd', Math.asin(Math.max(-1, Math.min(1, dot(segW[0], spreadAx)))) - Math.asin(Math.max(-1, Math.min(1, dot(segB[0], spreadAxB)))), JOINTS.mcp.abd);
                for (let j = 1; j < 3; j++) {
                    // (the palm's side of the segment before: its own bone's up, carried round with the joints already bent)
                    const prev = f + j + T, pnB = norm(rej(sk.up(prev), segB[j - 1])), pnW = norm(rej(dirW(m, bi[prev], sk.up(prev)), segW[j - 1]));
                    push(j === 1 ? 'pip' : 'dip', side, f + '.flex', flexOf(segW[j - 1], segW[j], pnW) - flexOf(segB[j - 1], segB[j], pnB), j === 1 ? JOINTS.pip.flex : JOINTS.dip.flex);
                }
            }
        }
    }
    // ---- the centre of mass (de Leva's segments), its margin inside the support's hull
    const sx = o.female ? 'f' : 'm', ci = o.female ? 0 : 1;
    let mass = 0, com = [0, 0, 0];
    const seg = (n, a, b) => { const S = SEGMENTS[n]; const w = S[sx]; mass += w; com = add(com, scale(lerp3(a, b, S.c[ci]), w)); };
    seg('head', P('neck', 0), P('head', 1));
    seg('thorax', P('chest', 0), P('chest', 1));
    seg('abdomen', P('spine', 0), P('spine', 1));
    seg('pelvis', scale(add(P('thighL', 0), P('thighR', 0)), 0.5), P('pelvis', 1));
    for (const T of ['L', 'R']) {
        seg('uarm', P('uarm' + T, 0), P('uarm' + T, 1));
        seg('farm', P('farm' + T, 0), P('farm' + T, 1));
        seg('hand', P('hand' + T, 0), P('hand' + T, 1));
        seg('thigh', P('thigh' + T, 0), P('thigh' + T, 1));
        seg('shank', P('shin' + T, 0), P('shin' + T, 1));
        seg('foot', P('foot' + T, 0), P('toe' + T, 1));
    }
    com = scale(com, 1 / mass);
    const margin = support.length >= 1 ? hullMargin(support.map((p) => [p[0], p[2]]), [com[0], com[2]]) : null;
    let worst = null;
    for (const r of out)
        if (!worst || r.strain > worst.strain)
            worst = r;
    return { joints: out, worst, over: out.filter((r) => r.over), com, support, margin };
}
/** a point's signed distance inside the convex hull of points (m; + inside; one or two points: minus the distance to
 *  them) */
export function hullMargin(pts, p) {
    const H = hull(pts);
    if (H.length === 1)
        return -Math.hypot(p[0] - H[0][0], p[1] - H[0][1]);
    if (H.length === 2)
        return -segDist(p, H[0], H[1]);
    let inside = true, best = Infinity;
    for (let i = 0; i < H.length; i++) {
        const a = H[i], b = H[(i + 1) % H.length];
        const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        if (cr < 0)
            inside = false;
        best = Math.min(best, segDist(p, a, b));
    }
    return inside ? best : -best;
}
function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}
/** the convex hull, counter-clockwise (monotone chain) */
export function hull(pts) {
    const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (P.length < 3)
        return P;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const p of P) {
        while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-12)
            lo.pop();
        lo.push(p);
    }
    for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 1e-12)
            hi.pop();
        hi.push(p);
    }
    lo.pop();
    hi.pop();
    return lo.concat(hi);
}
/** a reading's lines for a report: each DOF past its comfortable band (degrees, strain), worst first */
export function report(r, min = 0.5) {
    const deg = (x) => Math.round((x * 180) / Math.PI);
    return r.joints.filter((j) => j.strain >= min).sort((a, b) => b.strain - a.strain)
        .map((j) => `${j.joint}${j.side}.${j.dof} ${deg(j.v)}° ${j.over ? 'OVER' : ''}${j.loaded ? ' (loaded)' : ''} ${j.strain.toFixed(2)}`);
}
//# sourceMappingURL=measure.js.map