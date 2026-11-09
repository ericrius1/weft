import { smoothstep } from './math.js';
export const HANG_F = 'hangF', HANG_B = 'hangB';
/** the hips' middle and the scale of a body (bind space; once per body: the chains ask every frame) */
const hipsOf = new WeakMap();
function hips(a) {
    let h = hipsOf.get(a);
    if (!h) {
        const L = a.bones[a.index.thighL].head, R = a.bones[a.index.thighR].head;
        h = { c: [(L[0] + R[0]) / 2, (L[1] + R[1]) / 2, (L[2] + R[2]) / 2], s: a.header.height / 1.66 };
        hipsOf.set(a, h);
    }
    return h;
}
/** how much of a bind-space point's pelvis share the hang bones take: none down to the seat (the waist, the hips and
 *  the seat ride the pelvis), all of it from the top of the thighs down */
export function hangShare(a, y) {
    const { c, s } = hips(a);
    return smoothstep(c[1] - 0.06 * s, c[1] - 0.2 * s, y);
}
/** how much of that the front one takes (the rest the back one's), by where the point is round the hips: all of it in
 *  front, half at the sides, none behind */
export function frontShare(a, x, z) { return frontOf(hips(a).c, x, z); }
function frontOf(c, x, z) {
    const dx = x - c[0], dz = z - c[2], r = Math.hypot(dx, dz);
    return r < 1e-4 ? 0.5 : smoothstep(-0.6, 0.6, dz / r);
}
const SKIN = 0, HAIR = [3, 10], EYE = 8;
/** ?nohang: the clothes as they were built (the pelvis's share kept, the chains hung from it), to compare */
const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nohang');
/** at load (each level of detail): the two hang bones appended to the skeleton (their bind frames upright at the hips'
 *  middle) and the pelvis's share of the clothes under the hips given to them (`hangShare`, `frontShare`); how many
 *  vertices changed */
export function fitGarments(a) {
    const P = a.index.pelvis;
    if (P === undefined || a.index.thighL === undefined || a.index.thighR === undefined || a.index[HANG_F] !== undefined || OFF)
        return 0;
    const { c, s } = hips(a);
    const hF = a.bones.length, hB = hF + 1;
    for (const name of [HANG_F, HANG_B]) {
        a.index[name] = a.bones.length;
        a.bones.push({ name, head: c, tail: [c[0], c[1] - 0.1 * s, c[2]], up: [0, 0, 1] });
    }
    const H = a.header, V = a.verts, lo = H.qmin, span = [H.qmax[0] - lo[0], H.qmax[1] - lo[1], H.qmax[2] - lo[2]];
    // (one pass that only reads bytes — above the seat by the quantised height, skin, eyes and hair by the material, no
    // pelvis among the bones — so loading stays quick; the few left are refitted after)
    const y0 = c[1] - 0.06 * s, y1 = c[1] - 0.2 * s, qTop = ((y0 - lo[1]) / span[1]) * 65535;
    const todo = [];
    for (let o = 0, end = H.verts * 24; o < end; o += 24) {
        if ((V[o + 2] | (V[o + 3] << 8)) >= qTop)
            continue;
        const m = V[o + 6];
        if (m === SKIN || m === EYE || m === HAIR[0] || m === HAIR[1])
            continue;
        if ((V[o + 16] === P && V[o + 20]) || (V[o + 17] === P && V[o + 21]) || (V[o + 18] === P && V[o + 22]) || (V[o + 19] === P && V[o + 23]))
            todo.push(o);
    }
    // (the props are one-bone chains on the root: their own, left alone)
    const props = new Set(Object.entries(H.chainParents ?? {}).filter(([, v]) => v === 'root').map(([k]) => a.index[k + '0']));
    const B = [0, 0, 0, 0, 0, 0, 0], W = [0, 0, 0, 0, 0, 0, 0], at = (o, k) => lo[k] + ((V[o + k * 2] | (V[o + k * 2 + 1] << 8)) / 65535) * span[k];
    let moved = 0;
    for (const o of todo) {
        let n = 0, wp = 0, prop = false;
        for (let k = 0; k < 4; k++) {
            const b = V[o + 16 + k], w = V[o + 20 + k];
            if (w === 0)
                continue;
            if (props.has(b))
                prop = true;
            if (b === P)
                wp += w;
            else {
                B[n] = b;
                W[n] = w;
                n++;
            }
        }
        if (prop)
            continue;
        const give = wp * smoothstep(y0, y1, at(o, 1)), fr = frontOf(c, at(o, 0), at(o, 2));
        B[n] = P;
        W[n] = wp - give;
        n++;
        B[n] = hF;
        W[n] = give * fr;
        n++;
        B[n] = hB;
        W[n] = give * (1 - fr);
        n++;
        // (the four heaviest kept, back to bytes summing to 255)
        let tot = 0;
        for (let k = 0; k < 4; k++) {
            let best = k;
            for (let j = k + 1; j < n; j++)
                if (W[j] > W[best])
                    best = j;
            const tb = B[k], tw = W[k];
            B[k] = B[best];
            W[k] = W[best];
            B[best] = tb;
            W[best] = tw;
            tot += W[k];
        }
        let left = 255;
        for (let k = 0; k < 4; k++) {
            const w = k === 3 ? Math.max(0, left) : Math.round((W[k] / (tot || 1)) * 255);
            left -= w;
            V[o + 16 + k] = w > 0 ? B[k] : B[0];
            V[o + 20 + k] = w;
        }
        moved++;
    }
    return moved;
}
const qp = [0, 0, 0, 0], qa = [0, 0, 0, 0], M3 = new Float32Array(16);
/** the world's down in the legs' mean (against two legs' unit ways), and the most the front and back hang bones turn
 *  from it (rad: 120° between them) */
const GRAV = 0.3, SPLIT = 1.05;
/** both thighs raised before the pelvis this far (rad: 60°) the hang bones begin to follow them, all the way by 83° (a
 *  walk's lesser thigh reaches ~38°, a run's ~58° landing from its float, a jump's ~59°; sitting in a chair ~80°, the
 *  air scooter's squat ~100°) */
const FLEX = [1.05, 1.45];
/** each body's hold of the raised thighs (its skin matrices the key), eased (rates 1/s): taken up quickly, let go
 *  slowly — pedalling off from a stop both thighs pass over the line on each stroke, and the clothes swung with them */
const flexK = new WeakMap();
const FLEX_IN = 10, FLEX_OUT = 1.5;
/** the hang bones' skin matrices (column-major, bind -> posed), about the hips' middle carried where the two hip
 *  joints are now: the pelvis's rotation while it's upright, the thighs' rotations averaged (the shorter way) once it
 *  has tipped over or the thighs are raised before it (sitting, squatting, a tucked jump), between the two on the way;
 *  then the front one turned forward by half the legs' split (seen from the side) and the back one back by as much.
 *  `bones` is a rig's skin matrices, dt the frame's (the raised thighs' hold eased over it). Returns how far it has
 *  tipped (0 upright .. 1 over): the rigs hold the hips' chains to their rest shape by it (`HOLD`) */
export function poseHang(a, bones, dt = 0) {
    const hF = a.index[HANG_F], hB = a.index[HANG_B];
    if (hF === undefined || hB === undefined)
        return 0;
    const iP = a.index.pelvis * 16, iL = a.index.thighL * 16, iR = a.index.thighR * 16;
    // (how far the pelvis has tipped from upright: its bind up, posed, against the world's)
    const tip = Math.acos(Math.max(-1, Math.min(1, bones[iP + 5] / (Math.hypot(bones[iP + 4], bones[iP + 5], bones[iP + 6]) || 1))));
    const tipK = smoothstep(0.45, 1.05, tip);
    // (the legs' way, not the thighs' whole turns: their mean direction, with the pelvis's side for across — a thigh's
    // roll about its own length, which can turn over in a frame with the knee's pole, then never reaches the cloth;
    // the same frame made from the bind pose's legs is undone first, so upright and at rest it's the identity)
    const TLb = a.bones[a.index.thighL], TRb = a.bones[a.index.thighR];
    const dL = norm3(sub3(xf(bones, iL, TLb.tail), xf(bones, iL, TLb.head))), dR = norm3(sub3(xf(bones, iR, TRb.tail), xf(bones, iR, TRb.head)));
    const b0 = sub3(add3(TLb.tail, TRb.tail), add3(TLb.head, TRb.head)), bl = Math.hypot(b0[0], b0[1], b0[2]) / 2 || 1;
    // (and how far both thighs are raised before the pelvis — the lesser of the two, each against where it hangs at rest
    // from the pelvis as it is: a stride always has one leg under or behind. Sitting or squatting upright, the clothes
    // riding the pelvis stayed where they hang standing — the trousers' legs a curtain from the thighs down to where the
    // feet would be, torn across the knees; a robe's skirt the same from the knees)
    const raised = (d, b) => { const r = norm3(xd(bones, iP, sub3(b.tail, b.head))); return Math.acos(Math.max(-1, Math.min(1, d[0] * r[0] + d[1] * r[1] + d[2] * r[2]))); };
    const want = smoothstep(FLEX[0], FLEX[1], Math.min(raised(dL, TLb), raised(dR, TRb))), was = flexK.get(bones);
    const fk = was === undefined || dt <= 0 ? want : was + (want - was) * (1 - Math.exp(-(want > was ? FLEX_IN : FLEX_OUT) * dt));
    flexK.set(bones, fk);
    const k = Math.max(tipK, fk);
    quatOf(bones, iP, qp);
    let x = qp[0], y = qp[1], z = qp[2], w = qp[3], half = 0, X = [1, 0, 0];
    if (k > 0) {
        // (a little of the world's down in the mean: a leg stepping through from a dog, its knee driven up to the chest, points
        // nearly opposite the one behind, and the two alone would leave the mean nowhere)
        const F = legFrame([dL[0] + dR[0], dL[1] + dR[1] - GRAV, dL[2] + dR[2]], [bones[iP], bones[iP + 1], bones[iP + 2]], [bones[iP + 8], bones[iP + 9], bones[iP + 10]]);
        const F0 = legFrame([b0[0] / bl, b0[1] / bl - GRAV, b0[2] / bl], [1, 0, 0], [0, 0, 1]);
        // (F F0^T, column-major into the scratch matrix, as a quaternion)
        for (let c = 0; c < 3; c++)
            for (let r = 0; r < 3; r++)
                M3[c * 4 + r] = F[0][r] * F0[0][c] + F[1][r] * F0[1][c] + F[2][r] * F0[2][c];
        quatOf(M3, 0, qa);
        const sp = x * qa[0] + y * qa[1] + z * qa[2] + w * qa[3] < 0 ? -1 : 1;
        x += (qa[0] * sp - x) * k;
        y += (qa[1] * sp - y) * k;
        z += (qa[2] * sp - z) * k;
        w += (qa[3] * sp - w) * k;
        const l = Math.hypot(x, y, z, w) || 1;
        x /= l;
        y /= l;
        z /= l;
        w /= l;
        // (the legs' split seen from the side, in that frame: each thigh's forward lean, half the difference)
        const Z = rot(x, y, z, w, 0, 0, 1);
        const fL = dL[0] * Z[0] + dL[1] * Z[1] + dL[2] * Z[2], fR = dR[0] * Z[0] + dR[1] * Z[1] + dR[2] * Z[2];
        // (at most SPLIT each way: further, the front and back ones' cloth blended between them at the sides turns over)
        half = k * Math.min(SPLIT, Math.asin(Math.max(-1, Math.min(1, Math.abs(fL - fR) / 2))));
        X = rot(x, y, z, w, 1, 0, 0);
    }
    const TL = a.bones[a.index.thighL].head, TR = a.bones[a.index.thighR].head;
    const pL = xf(bones, iL, TL), pR = xf(bones, iR, TR);
    const c0 = [(TL[0] + TR[0]) / 2, (TL[1] + TR[1]) / 2, (TL[2] + TR[2]) / 2];
    const c1 = [(pL[0] + pR[0]) / 2, (pL[1] + pR[1]) / 2, (pL[2] + pR[2]) / 2];
    // (turned about the side axis, forward for the front one: q' = turn * q; a leg swinging forward turns about +x by -)
    for (const [bi, ang] of [[hF, -half], [hB, half]]) {
        const sn = Math.sin(ang / 2), cs = Math.cos(ang / 2), tx = X[0] * sn, ty = X[1] * sn, tz = X[2] * sn;
        writeMat(bones, bi * 16, cs * x + tx * w + ty * z - tz * y, cs * y - tx * z + ty * w + tz * x, cs * z + tx * y - ty * x + tz * w, cs * w - tx * x - ty * y - tz * z, c0, c1);
    }
    // (raised thighs alone don't hold the chains: a sash's tail falls over the lap from them)
    return tipK;
}
/** how firmly (a pull a 60 Hz step, times how far the hips have tipped) the chains hung from tipped hips keep to their
 *  rest shape along the legs: left to hang free from hips that are the highest point (a dog), a panel falls either way
 *  — down the back toward the head as often as down the legs — and the cloth skinned half to it and half to a thigh
 *  tears across them and flips about */
export const HOLD = 0.35;
/** a bind-space point where the chains hang it: through the pelvis down to the seat, through the hang bones below it
 *  (the front one's in front, the back one's behind), blended between (rigs' `rigChains`: the rest shape the cloth is
 *  pulled toward) */
export function hang(a, bones, p) {
    const hF = a.index[HANG_F], f = hF === undefined ? 0 : hangShare(a, p[1]);
    const q = xf(bones, a.index.pelvis * 16, p);
    if (f <= 0)
        return q;
    const fr = frontShare(a, p[0], p[2]);
    const rf = xf(bones, hF * 16, p), rb = xf(bones, a.index[HANG_B] * 16, p);
    const r = [rb[0] + (rf[0] - rb[0]) * fr, rb[1] + (rf[1] - rb[1]) * fr, rb[2] + (rf[2] - rb[2]) * fr];
    return [q[0] + (r[0] - q[0]) * f, q[1] + (r[1] - q[1]) * f, q[2] + (r[2] - q[2]) * f];
}
/** the frame a chain hangs in (its swing is followed in its axes): the pelvis's, or a hang bone's (the front one's or
 *  the back one's by where it hangs) when the chain's middle is under the seat */
export function hangBone(a, pts) {
    const hF = a.index[HANG_F], mid = pts[pts.length >> 1];
    if (hF === undefined || hangShare(a, mid[1]) <= 0.5)
        return a.index.pelvis;
    return frontShare(a, mid[0], mid[2]) >= 0.5 ? hF : a.index[HANG_B];
}
const SKIN_MATS = new Set([0, 6, 11]);
/** at load: a robe's wide sleeves measured for the drape, and their cloth's share of the fingers given to the hand (a
 *  thumb curling round a cup otherwise drags the cuff's hem with it); null where there's no forearm to hang from */
export function sleeveFit(a) {
    const I = a.index;
    if ([I.uarmL, I.farmL, I.handL, I.uarmR, I.farmR, I.handR, I.spine, I.pelvis].some((i) => i === undefined))
        return null;
    const H = a.header, V = a.verts, lo = H.qmin, span = [H.qmax[0] - lo[0], H.qmax[1] - lo[1], H.qmax[2] - lo[2]];
    const at = (o, k) => lo[k] + ((V[o + k * 2] | (V[o + k * 2 + 1] << 8)) / 65535) * span[k];
    const eL = a.bones[I.farmL].head, wL = a.bones[I.handL].head, eR = a.bones[I.farmR].head, wR = a.bones[I.handR].head;
    const ab = sub3(wL, eL), bl2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    // (each hand's fingers, to hand their cloth's weights to the hand)
    const finger = new Map();
    for (const T of ['L', 'R'])
        for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky', 'fingers', 'tips'])
            for (const j of ['', '1', '2', '3']) {
                const b = I[f + j + T];
                if (b !== undefined)
                    finger.set(b, I['hand' + T]);
            }
    let rE = 0, rW = 0;
    const torso = new Set([I.pelvis, I.spine, I.chest]);
    let zMax = -1, zMin = 1, xMax = 0;
    // (the belly, from a little under the hips' joint up past the spine's: the chest above is narrower, and a hand on it
    // keeps its sleeve where it is)
    const y0 = a.bones[I.pelvis].head[1] - 0.06, y1 = a.bones[I.spine].head[1] + 0.12;
    for (let o = 0, end = H.verts * 24; o < end; o += 24) {
        const m = V[o + 6];
        let own = 0, arm = 0;
        for (let k = 0; k < 4; k++) {
            const b = V[o + 16 + k], w = V[o + 20 + k];
            if (b === I.farmL)
                own += w;
            if (torso.has(b))
                arm -= w;
            else
                arm += w;
        }
        const p = [at(o, 0), at(o, 1), at(o, 2)];
        // (the skin round the left forearm, near each end: the arm's radius there)
        if (SKIN_MATS.has(m) && own > 128) {
            const d = sub3(p, eL), u = (d[0] * ab[0] + d[1] * ab[1] + d[2] * ab[2]) / bl2;
            const r = Math.hypot(d[0] - ab[0] * u, d[1] - ab[1] * u, d[2] - ab[2] * u);
            if (u > 0.04 && u < 0.2)
                rE = Math.max(rE, r);
            if (u > 0.8 && u < 0.95)
                rW = Math.max(rW, r);
        }
        // (the belly's front, back and sides: what rides the trunk between the hips and the chest)
        if (arm < -128 && p[1] > y0 && p[1] < y1) {
            zMax = Math.max(zMax, p[2]);
            zMin = Math.min(zMin, p[2]);
            xMax = Math.max(xMax, Math.abs(p[0]));
        }
        // (the cloth's weights on a finger to that hand)
        if (!SKIN_MATS.has(m))
            for (let k = 0; k < 4; k++) {
                const h = finger.get(V[o + 16 + k]);
                if (h !== undefined && V[o + 20 + k])
                    V[o + 16 + k] = h;
            }
    }
    if (rE <= 0 || rW <= 0)
        return null;
    return {
        elbow: [eL, eR], wrist: [wL, wR], rElbow: rE, rWrist: rW,
        bones: [[I.uarmL, I.farmL, I.handL], [I.uarmR, I.farmR, I.handR]], spine: I.spine,
        belly: { zc: (zMax + zMin) / 2, ax: xMax * 0.92, az: (zMax - zMin) / 2, y0, y1 },
    };
}
function xf(m, k, p) {
    return [m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12], m[k + 1] * p[0] + m[k + 5] * p[1] + m[k + 9] * p[2] + m[k + 13], m[k + 2] * p[0] + m[k + 6] * p[1] + m[k + 10] * p[2] + m[k + 14]];
}
/** a bind-space direction turned as the skin matrix at k turns it */
function xd(m, k, d) {
    return [m[k] * d[0] + m[k + 4] * d[1] + m[k + 8] * d[2], m[k + 1] * d[0] + m[k + 5] * d[1] + m[k + 9] * d[2], m[k + 2] * d[0] + m[k + 6] * d[1] + m[k + 10] * d[2]];
}
const sub3 = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const add3 = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
/** the frame the cloth below the hips hangs in, from the legs' way `down` and the hips' side `side` (the forward `fwd`
 *  for across when the legs lie along the side, a split): its columns x (the side, square to the legs), y (up the legs),
 *  z (forward) */
function legFrame(down, side, fwd) {
    const y = norm3([-down[0], -down[1], -down[2]]);
    let x = sub3(side, scaleBy(y, side[0] * y[0] + side[1] * y[1] + side[2] * y[2]));
    if (Math.hypot(x[0], x[1], x[2]) < 0.2) {
        const zf = sub3(fwd, scaleBy(y, fwd[0] * y[0] + fwd[1] * y[1] + fwd[2] * y[2]));
        x = [y[1] * zf[2] - y[2] * zf[1], y[2] * zf[0] - y[0] * zf[2], y[0] * zf[1] - y[1] * zf[0]];
    }
    x = norm3(x);
    return [x, y, [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]];
}
const scaleBy = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
/** v turned by the quaternion (x y z w) */
function rot(x, y, z, w, vx, vy, vz) {
    const cx = y * vz - z * vy + w * vx, cy = z * vx - x * vz + w * vy, cz = x * vy - y * vx + w * vz;
    return [vx + 2 * (y * cz - z * cy), vy + 2 * (z * cx - x * cz), vz + 2 * (x * cy - y * cx)];
}
/** a rigid skin matrix: the rotation (x y z w), the bind point c0 carried to c1 */
function writeMat(o, j, x, y, z, w, c0, c1) {
    o[j] = 1 - 2 * (y * y + z * z);
    o[j + 1] = 2 * (x * y + z * w);
    o[j + 2] = 2 * (x * z - y * w);
    o[j + 3] = 0;
    o[j + 4] = 2 * (x * y - z * w);
    o[j + 5] = 1 - 2 * (x * x + z * z);
    o[j + 6] = 2 * (y * z + x * w);
    o[j + 7] = 0;
    o[j + 8] = 2 * (x * z + y * w);
    o[j + 9] = 2 * (y * z - x * w);
    o[j + 10] = 1 - 2 * (x * x + y * y);
    o[j + 11] = 0;
    o[j + 12] = c1[0] - (o[j] * c0[0] + o[j + 4] * c0[1] + o[j + 8] * c0[2]);
    o[j + 13] = c1[1] - (o[j + 1] * c0[0] + o[j + 5] * c0[1] + o[j + 9] * c0[2]);
    o[j + 14] = c1[2] - (o[j + 2] * c0[0] + o[j + 6] * c0[1] + o[j + 10] * c0[2]);
    o[j + 15] = 1;
}
/** a skin matrix's rotation as a quaternion (x y z w), into out */
function quatOf(m, k, out) {
    const m00 = m[k], m10 = m[k + 1], m20 = m[k + 2], m01 = m[k + 4], m11 = m[k + 5], m21 = m[k + 6], m02 = m[k + 8], m12 = m[k + 9], m22 = m[k + 10];
    const tr = m00 + m11 + m22;
    let S;
    if (tr > 0) {
        S = Math.sqrt(tr + 1) * 2;
        out[0] = (m21 - m12) / S;
        out[1] = (m02 - m20) / S;
        out[2] = (m10 - m01) / S;
        out[3] = 0.25 * S;
    }
    else if (m00 > m11 && m00 > m22) {
        S = Math.sqrt(1 + m00 - m11 - m22) * 2;
        out[0] = 0.25 * S;
        out[1] = (m01 + m10) / S;
        out[2] = (m02 + m20) / S;
        out[3] = (m21 - m12) / S;
    }
    else if (m11 > m22) {
        S = Math.sqrt(1 + m11 - m00 - m22) * 2;
        out[0] = (m01 + m10) / S;
        out[1] = 0.25 * S;
        out[2] = (m12 + m21) / S;
        out[3] = (m02 - m20) / S;
    }
    else {
        S = Math.sqrt(1 + m22 - m00 - m11) * 2;
        out[0] = (m02 + m20) / S;
        out[1] = (m12 + m21) / S;
        out[2] = 0.25 * S;
        out[3] = (m10 - m01) / S;
    }
}
//# sourceMappingURL=garment.js.map