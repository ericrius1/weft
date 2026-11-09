// The whole body from what it's doing: goals in (where the feet are and how they meet the ground, where the hands go and
// whether they bear weight, a seat, where it looks, an activity's preferences), a posed body out — as a body would hold
// it. The free parameters a pose leaves (where the pelvis is and how it's turned, the spine's bend split over its
// segments, each knee's swivel, how far a heel lifts) are chosen by ease, the way the arm's elbow is (hero/rig.ts
// armFit): every joint's discomfort (anatomy.ts: past its comfortable band quickly worse, past its limit far worse,
// loaded joints to their passive limits), the limbs' reach to their goals, the centre of mass over what holds the body
// up (de Leva's segments over the support's hull), the activity's preferences, last frame's pose.
//
// The trunk (nine numbers: the pelvis's place and turn, the spine's bend, side bend and turn) is fitted by
// Levenberg–Marquardt on those costs as residuals (a few iterations a frame, warm-started: it settles over frames as a
// body does); the spine's bend is shared over the lumbar and thoracic segments by their ranges (each reaches its limit
// together: the constrained-FABRIK idea, closed form here); the legs are two-bone IK whose knee swivels about the
// hip–ankle line to where the hip's turn, the shin's and the ankle's are most at ease (Tolani & Badler's swivel, as the
// arms'); the head turns toward its look over the neck's two levels by their ranges. The arms are left to the rig
// (armIK: armFit's elbow, the wrist's limits, the fingers) with the wrist targets solved here.
import { add, sub, scale, dot, cross, len, norm, lerp3, clamp, rotateAxis, rej } from '../math.js';
import { JOINTS, discomfort, hipFlexMax, kneeRotK, SEGMENTS, SHOULDER_CONE, flexOf } from './anatomy.js';
import { Skeleton, hullMargin, eulerXZY, eulerXYZ, relRot, mirror } from './measure.js';
export const frW = (f, l) => [f.o[0] + f.x[0] * l[0] + f.y[0] * l[1] + f.z[0] * l[2], f.o[1] + f.x[1] * l[0] + f.y[1] * l[1] + f.z[1] * l[2], f.o[2] + f.x[2] * l[0] + f.y[2] * l[1] + f.z[2] * l[2]];
export const frD = (f, l) => [f.x[0] * l[0] + f.y[0] * l[1] + f.z[0] * l[2], f.x[1] * l[0] + f.y[1] * l[1] + f.z[1] * l[2], f.x[2] * l[0] + f.y[2] * l[1] + f.z[2] * l[2]];
export const frL = (f, w) => { const d = sub(w, f.o); return [dot(d, f.x), dot(d, f.y), dot(d, f.z)]; };
const frRot = (f, axis, a) => (a === 0 ? f : { o: f.o, x: rotateAxis(f.x, axis, a), y: rotateAxis(f.y, axis, a), z: rotateAxis(f.z, axis, a) });
/** turned about its own side axis (forward +), then its forward axis (to its right +), then its up (to its left +): the
 *  joint coordinates measure.ts reads back (R = Rx Rz Ry) */
export const frBend = (f, flex, side, turn) => { let g = frRot(f, f.x, flex); g = frRot(g, g.z, side); return frRot(g, g.y, turn); };
/** HeroRig's frEuler: yaw about its up, pitch about its side (forward +), roll about its forward */
export const frEuler = (f, yaw, pitch, roll) => { let g = frRot(f, f.y, yaw); g = frRot(g, g.x, pitch); return frRot(g, g.z, roll); };
const D = Math.PI / 180;
/** two-bone IK (as the rig's): the middle joint bending toward pole */
export function ik2(a, target, l1, l2, pole, soft = 0) {
    const d = sub(target, a);
    let dl = len(d);
    const da = l1 + l2 - soft;
    if (soft > 0 && dl > da)
        dl = da + soft * (1 - Math.exp(-(dl - da) / soft));
    dl = clamp(dl, 1e-4, l1 + l2 - 1e-4);
    const dn = norm(d);
    const x = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    let pp = rej(pole, dn);
    if (len(pp) < 1e-5)
        pp = Math.abs(dn[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    return add(add(a, scale(dn, x)), scale(norm(pp), h));
}
/** a body's own measurements, from its bind skeleton */
export class BodyModel {
    asset;
    female;
    sk;
    s;
    P = {};
    L = {};
    knuckle;
    FH;
    /** the toes' bind angle up from the foot's line (the toe joint's zero) */
    toe0;
    constructor(asset, female = false) {
        this.asset = asset;
        this.female = female;
        this.sk = new Skeleton(asset);
        const B = asset.bones, I = asset.index, g = (n) => B[I[n]];
        this.s = asset.header.height / 1.66;
        const P = this.P;
        P.pelvis = g('pelvis').head;
        P.waist = g('pelvis').tail;
        P.chestBase = g('chest').head;
        P.neckBase = g('neck').head;
        P.headBase = g('head').head;
        P.headTop = g('head').tail;
        for (const T of ['L', 'R']) {
            P['hip' + T] = g('thigh' + T).head;
            P['clav' + T] = g('clav' + T).head;
            P['shoulder' + T] = g('uarm' + T).head;
            P['ankle' + T] = g('foot' + T).head;
            P['ball' + T] = g('toe' + T).head;
        }
        const ln = (n) => len(sub(g(n).tail, g(n).head));
        for (const n of ['thighL', 'shinL', 'uarmL', 'farmL', 'handL', 'toeL'])
            this.L[n.slice(0, -1)] = ln(n);
        this.FH = Math.sqrt(Math.max(len(sub(P.ballL, P.ankleL)) ** 2 - (P.ankleL[1] - P.ballL[1]) ** 2, 1e-6));
        const kn = (T) => {
            const hb = I['hand' + T], mb = I['middle1' + T];
            if (hb === undefined || mb === undefined)
                return this.L.hand * 0.5;
            const H = B[hb], d = norm(sub(H.tail, H.head));
            return Math.max(0.02, dot(sub(B[mb].head, H.head), d));
        };
        this.knuckle = [kn('L'), kn('R')];
        const fz = this.sk.dir('footL'), fy = this.sk.up('footL'), tz = this.sk.dir('toeL');
        this.toe0 = Math.atan2(dot(tz, fy), dot(tz, fz));
    }
    /** a bone's skin rotation for a posed frame built from its head-to-tail way and an up (as HeroRig.setBone builds it) */
    skinR(n, dir, up) {
        const F = this.sk.frames[this.sk.bi[n]];
        const z = norm(dir);
        let x = cross(up, z);
        if (len(x) < 1e-5)
            x = cross([1, 0, 0], z);
        x = norm(x);
        const y = cross(z, x);
        const R = new Array(9);
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++)
                R[i * 3 + j] = x[i] * F.x[j] + y[i] * F.y[j] + z[i] * F.z[j];
        return R;
    }
}
/** what the solver keeps between frames: the trunk's numbers, each knee's last pole, each heel's lift */
export class BodyState {
    x = null;
    pole = [null, null];
    heel = [0.3, 0.3];
    lam = 1e-2;
    /** where the eyes and neck were turned (smoothed) */
    head = [0, 0];
    /** the frame's time (s; set by whoever solves each frame), the goal's `at` last frame, and the trunk's numbers' rate
     *  (per s) under a goal's `ease` */
    dt = 0;
    at = null;
    v = null;
    reset() { this.x = null; this.pole = [null, null]; this.lam = 1e-2; this.at = null; this.v = null; }
}
// the spine's share of a bend over its lumbar and thoracic segments: by their ranges (each reaches its limit together)
const SHARE = {
    flexF: JOINTS.lumbar.flex.hi / (JOINTS.lumbar.flex.hi + JOINTS.thoracic.flex.hi),
    flexB: JOINTS.lumbar.flex.lo / (JOINTS.lumbar.flex.lo + JOINTS.thoracic.flex.lo),
    side: JOINTS.lumbar.side.hi / (JOINTS.lumbar.side.hi + JOINTS.thoracic.side.hi),
    turn: JOINTS.lumbar.turn.hi / (JOINTS.lumbar.turn.hi + JOINTS.thoracic.turn.hi),
};
export function spineSplit(flex, side, turn) {
    const f = flex >= 0 ? SHARE.flexF : SHARE.flexB;
    return [[flex * f, side * SHARE.side, turn * SHARE.turn], [flex * (1 - f), side * (1 - SHARE.side), turn * (1 - SHARE.turn)]];
}
// the neck's: the nod mostly the lower neck's, the turn mostly the upper's (C1–C2)
const NECK = {
    down: JOINTS.neckLow.flex.hi / (JOINTS.neckLow.flex.hi + JOINTS.neckUp.flex.hi),
    up: JOINTS.neckLow.flex.lo / (JOINTS.neckLow.flex.lo + JOINTS.neckUp.flex.lo),
    turn: JOINTS.neckLow.turn.hi / (JOINTS.neckLow.turn.hi + JOINTS.neckUp.turn.hi),
};
/** the residuals of a DOF's discomfort (anatomy.discomfort's three terms, each smooth: a pull to its middle, past its
 *  comfortable band, past its limit), weighted */
function dofRes(r, x, d, k0, loaded, w = 1) {
    const k = flexOf(d, k0);
    const hi = (loaded && d.pHi !== undefined ? d.pHi : d.hi) * k, lo = (loaded && d.pLo !== undefined ? d.pLo : d.lo) * k;
    const okHi = d.okHi * k, okLo = d.okLo * k;
    r.push(Math.sqrt(d.pull ?? 0.1) * x * w);
    r.push(Math.sqrt(3) * (x > okHi ? x - okHi : x < okLo ? x - okLo : 0) * w);
    r.push(Math.sqrt(40) * (x > hi ? x - hi : x < lo ? x - lo : 0) * w);
}
/** a foot's geometry from its goal: the ankle and the ball, the foot's left, its way (ankle to ball's direction comes
 *  from these), the toes' way, its up; and the sole's points on the ground (for the support) */
function footFrom(M, f, heel) {
    const s = M.s, FH = M.FH;
    const fwd = [-Math.sin(f.yaw), 0, -Math.cos(f.yaw)], left = [-Math.cos(f.yaw), 0, Math.sin(f.yaw)];
    const aY = M.P.ankleL[1], bY = M.P.ballL[1];
    let ankle, ball, toeDir = fwd;
    const sole = [];
    if (f.kind === 'flat') {
        ankle = add(f.at, add(scale(fwd, -FH * 0.5), [0, aY, 0]));
        ball = add(f.at, add(scale(fwd, FH * 0.5), [0, bY, 0]));
        sole.push(add(f.at, scale(fwd, -FH * 0.5 - 0.045 * s)), add(ball, add(scale(left, 0.035 * s), [0, -bY, 0])), add(ball, add(scale(left, -0.035 * s), [0, -bY, 0])), add(f.at, scale(fwd, FH * 0.5 + M.L.toe)));
    }
    else if (f.kind === 'ball') {
        // (the foot turned up about the ball by its heel's lift)
        ball = add(f.at, [0, bY, 0]);
        const a0 = add(f.at, add(scale(fwd, -FH), [0, aY, 0]));
        ankle = add(ball, rotateAxis(sub(a0, ball), left, heel));
        sole.push(add(f.at, scale(left, 0.035 * s)), add(f.at, scale(left, -0.035 * s)), add(f.at, scale(fwd, M.L.toe)));
    }
    else if (f.kind === 'top') {
        // (toes pointing back along the ground, the sole up: the ankle a little higher than the ball's top)
        ball = add(f.at, [0, 0.022 * s, 0]);
        ankle = add(ball, add(scale(fwd, -FH * 0.97), [0, 0.035 * s, 0]));
        if (f.knee) {
            // kneeling: the shin lies from the knee toward the foot, the ankle a shin's length from the knee
            const K = add(f.knee, [0, 0.045 * s, 0]);
            const dh = ankle[1] - K[1], toA = rej(sub(f.at, K), [0, 1, 0]), l = len(toA);
            const hz = Math.sqrt(Math.max(1e-6, M.L.shin ** 2 - dh * dh));
            ankle = add(K, add(scale(l > 1e-4 ? scale(toA, 1 / l) : fwd, hz), [0, dh, 0]));
            ball = add(ankle, add(scale(fwd, FH * 0.97), [0, -0.035 * s, 0]));
        }
        sole.push(f.at, add(ankle, [0, -ankle[1] + f.at[1], 0]));
    }
    else {
        ankle = f.at;
        ball = add(ankle, add(scale(fwd, FH), [0, bY - aY, 0]));
    }
    // (the foot's own left: a foot laid on its top, toes back, is plantarflexed, not turned round: its left stays the leg's)
    const footLeft = f.kind === 'top' ? scale(left, -1) : left;
    return { ankle, ball, toeDir, left, footLeft, fwd, sole };
}
/** the knee's preferred way for a leg (before its swivel's fitted): square to the leg, toward the foot's front (planted,
 *  kneeling), or as the goal says (free) */
function kneePole(f, legDir, footLeft, bodyFwd) {
    if (f?.kind === 'free')
        return f.kneeDir ?? bodyFwd;
    const p = cross(legDir, footLeft);
    return len(p) > 1e-3 ? norm(p) : bodyFwd;
}
export function trunkOf(M, B0, breath, x) {
    const P = M.P, rel = (q) => sub(q, P.pelvis);
    const pel = frEuler({ ...B0, o: [x[0], x[1], x[2]] }, x[3], x[4], x[5]);
    const [lu, th] = spineSplit(x[6], x[7], x[8]);
    const mid = frBend(pel, lu[0], lu[1], lu[2]);
    const ch0 = frBend(mid, th[0], th[1], th[2]);
    // (a breath: the chest lifts a little, opening forward)
    const ch = breath > 0 ? frBend(ch0, -0.035 * breath, 0, 0) : ch0;
    const waist = frW(pel, rel(P.waist));
    const chestBase = add(waist, frD(mid, sub(P.chestBase, P.waist)));
    const neckBase = add(chestBase, frD(ch, sub(P.neckBase, P.chestBase)));
    const chF = { o: chestBase, x: ch.x, y: ch.y, z: ch.z };
    return { pel, mid, ch, chF, waist, chestBase, neckBase, hips: [frW(pel, rel(P.hipL)), frW(pel, rel(P.hipR))], lu, th };
}
/** the shoulder for a wrist target (the clavicle's shrug and reach, as armIK's) */
export function shoulderOf(M, i, chF, target) {
    const P = M.P, s = M.s, side = i === 0 ? 1 : -1, T = i === 0 ? 'L' : 'R';
    const clavB = P['clav' + T], shB = P['shoulder' + T];
    const clavIn = frW(chF, sub(clavB, P.chestBase));
    const CS = { o: frW(chF, sub([0, shB[1], shB[2]], P.chestBase)), x: chF.x, y: chF.y, z: chF.z };
    const tl = frL(CS, target);
    const shrug = clamp((tl[1] + 0.05 * s) / (0.45 * s), 0, 1), protract = clamp((tl[2] - 0.15 * s) / (0.35 * s), 0, 1);
    let cv = frD(chF, sub(shB, clavB));
    cv = rotateAxis(cv, chF.z, side * shrug * 0.45);
    cv = rotateAxis(cv, chF.y, -side * protract * 0.22);
    return add(clavIn, cv);
}
/** a leg's joints for its hip and its foot's goal (the knee by a pole, or the goal's kneeling point), and its joints
 *  read as measure.ts reads them */
export function legOf(M, k, i, T0, f, heel, poleIn) {
    const s = M.s, T = i === 0 ? 'L' : 'R', right = i === 1;
    const hip = T0.hips[i];
    const F = footFrom(M, f, heel);
    const lt = M.L.thigh, ls = M.L.shin;
    const legDir = norm(sub(F.ankle, hip));
    let pole = poleIn ?? kneePole(f, legDir, F.footLeft, T0.pel.z);
    const knee = f.knee ? add(f.knee, [0, 0.045 * s, 0]) : ik2(hip, F.ankle, lt, ls, pole, 0.004 * s);
    const thighD = norm(sub(knee, hip));
    let shinD = norm(sub(F.ankle, knee));
    // (kneeling, the knee's set: its front is the fold's apex, away from the hip–ankle line, so it bends in its own plane)
    if (f.knee) {
        const r = sub(knee, lerp3(hip, F.ankle, 0.5));
        if (len(r) > 1e-4)
            pole = norm(r);
    }
    const ankle = f.knee ? F.ankle : add(knee, scale(shinD, ls));
    if (!f.knee)
        shinD = norm(sub(ankle, knee));
    // (the foot: planted, as the goal lays it; free, from the shin, pointed by `point`)
    let fdir = sub(F.ball, F.ankle);
    if (f.kind === 'free') {
        const ax = norm(cross(shinD, pole));
        const pf = (f.point ?? 0.4) * 45 * D * k;
        fdir = scale(norm(rotateAxis(shinD, ax, -(72 * D - pf))), len(sub(M.P.ballL, M.P.ankleL)));
        if (dot(fdir, pole) < 0)
            fdir = scale(norm(rotateAxis(shinD, ax, 72 * D - pf)), len(sub(M.P.ballL, M.P.ankleL)));
    }
    const ball = add(ankle, fdir);
    const fn = norm(fdir);
    const sideAx = f.kind === 'free' ? norm(cross(pole, fn)) : F.footLeft;
    const footUp = norm(cross(fn, sideAx));
    const toeDir = f.kind === 'free' ? norm(rotateAxis(fn, sideAx, -M.toe0)) : f.kind === 'top' ? norm(rej(fn, [0, 1, 0])) : F.toeDir;
    const toe = add(ball, scale(toeDir, M.L.toe));
    const kUp = norm(rej(pole, thighD));
    const Rp = M.skinR('pelvis', sub(T0.waist, T0.pel.o), T0.pel.z);
    const Rt = M.skinR('thigh' + T, thighD, kUp), Rs = M.skinR('shin' + T, shinD, norm(rej(pole, shinD)));
    const Rf = M.skinR('foot' + T, fn, footUp);
    const relR = (a, b) => (right ? mirror(relRot(a, b)) : relRot(a, b));
    const [ha, hb, hc] = eulerXZY(relR(Rp, Rt));
    let kneeFlex = Math.atan2(-dot(shinD, kUp), dot(shinD, thighD));
    // (a fold past a straight line back on itself reads past 180°, not as a hyperextension: its limit then pulls it back)
    if (kneeFlex < -Math.PI / 2)
        kneeFlex += Math.PI * 2;
    const [, , kc] = eulerXZY(relR(Rt, Rs));
    const [aa, ab, ac] = eulerXYZ(relR(Rs, Rf));
    const toeExt = Math.atan2(dot(toeDir, footUp), dot(toeDir, fn)) - M.toe0;
    return { hip, knee, ankle, ball, toe, pole, footUp, toeDir, toeUp: norm(cross(toeDir, sideAx)), heel, sole: F.sole, hipA: [-ha, hb, hc], kneeFlex, kneeRot: kc, ankleA: [-aa, ab, -ac], toeExt, legLen: len(sub(F.ankle, hip)) };
}
/** the body solved for its goal: the trunk fitted (iters LM iterations from last frame's), the legs' swivels and the
 *  head's turn chosen by ease */
export function solveBody(M, G, S, iters = 4, debug) {
    const s = M.s, k = G.flex ?? 1, P = M.P;
    const fwd0 = [-Math.sin(G.yaw), 0, -Math.cos(G.yaw)], left0 = [-Math.cos(G.yaw), 0, Math.sin(G.yaw)];
    const B0 = { o: G.at, x: left0, y: [0, 1, 0], z: fwd0 };
    const ground = G.at[1];
    const trunk = (x) => trunkOf(M, B0, G.breath ?? 0, x);
    const shoulderFor = (i, chF, target) => shoulderOf(M, i, chF, target);
    const legFor = (i, T0, f, heel, pole) => legOf(M, k, i, T0, f, heel, pole);
    // (the hands' goals in the world, given the chest)
    const handGoal = (i, chF) => {
        const h = G.hands[i];
        if (!h)
            return null;
        if (!h.rel)
            return h.goal;
        const g = h.goal, W = (p) => frW(chF, p), Dd = (d) => frD(chF, d);
        return { ...g, palm: W(g.palm), fwd: Dd(g.fwd), down: Dd(g.down), tips: g.tips.map((t) => (t ? W(t) : null)), knuckles: g.knuckles ? W(g.knuckles) : undefined, elbow: g.elbow ? Dd(g.elbow) : undefined };
    };
    const wristOf = (i, g) => (g.knuckles ? sub(g.knuckles, scale(g.fwd, M.knuckle[i])) : sub(g.palm, scale(g.fwd, M.L.hand * 0.55)));
    // ---- the residuals for the trunk's numbers
    const evalX = (x, withLegs = true) => {
        const T0 = trunk(x);
        const r = [];
        // the spine's segments
        const J = JOINTS;
        dofRes(r, T0.lu[0], J.lumbar.flex, k, false);
        dofRes(r, T0.lu[1], J.lumbar.side, k, false);
        dofRes(r, T0.lu[2], J.lumbar.turn, k, false);
        dofRes(r, T0.th[0], J.thoracic.flex, k, false);
        dofRes(r, T0.th[1], J.thoracic.side, k, false);
        dofRes(r, T0.th[2], J.thoracic.turn, k, false);
        const legs = [];
        const support = [];
        for (let i = 0; i < 2; i++) {
            const f = G.feet[i];
            if (!f || !withLegs) {
                for (let q = 0; q < 18; q++)
                    r.push(0);
                continue;
            }
            const L = legFor(i, T0, f, S.heel[i], null);
            legs.push(L);
            const fw = f.w ?? 1;
            // reach: the leg can't stretch past straight nor fold past its knee's limit
            const lt = M.L.thigh, ls = M.L.shin;
            if (f.knee) {
                r.push((len(sub(L.knee, L.hip)) - lt) * 40 * fw);
                r.push(0);
            }
            else {
                const d = L.legLen, dmin = Math.sqrt(lt * lt + ls * ls - 2 * lt * ls * Math.cos(Math.PI - J.knee.flex.pHi * k));
                r.push(Math.max(0, d - 0.999 * (lt + ls)) * 40 * fw);
                r.push(Math.max(0, dmin - d) * 40 * fw);
            }
            const loaded = f.kind !== 'free';
            dofRes(r, L.hipA[0], { ...J.hip.flex, hi: loaded && L.kneeFlex > 1.6 ? J.hip.flex.pHi : hipFlexMax(L.kneeFlex, k) / k }, k, loaded);
            dofRes(r, L.hipA[1], J.hip.abd, k, loaded);
            dofRes(r, L.hipA[2], J.hip.rot, k, false, 0.5);
            dofRes(r, L.kneeFlex, J.knee.flex, k, loaded);
            dofRes(r, L.ankleA[0], J.ankle.dorsi, k, loaded);
            r.push(f.kind === 'ball' ? Math.sqrt(40) * Math.max(0, L.toeExt - J.toe.ext.pHi * k) : 0);
            // (the hips' and knees' flexion wished)
            const hf = G.legs?.hip?.[i], kf = G.legs?.knee?.[i], lw = (G.legs?.w ?? 1) * 2;
            r.push(hf !== null && hf !== undefined ? (L.hipA[0] - hf) * lw : 0, kf !== null && kf !== undefined ? (L.kneeFlex - kf) * lw : 0);
            if (f.kind !== 'free')
                support.push(...L.sole);
            if (f.knee)
                support.push(f.knee);
        }
        // the hands: their reach from the shoulders, the shoulders' lift
        const chF = T0.chF;
        const hands = [null, null];
        const sh = [];
        for (let i = 0; i < 2; i++) {
            const h = G.hands[i], g = handGoal(i, chF);
            if (!h || !g) {
                r.push(0, 0, 0, 0, 0, 0, 0, 0);
                sh.push(frW(chF, sub(P[i === 0 ? 'shoulderL' : 'shoulderR'], P.chestBase)));
                continue;
            }
            const wrist = wristOf(i, g);
            const shoulder = shoulderFor(i, chF, wrist);
            sh.push(shoulder);
            const L = M.L.uarm + M.L.farm, d = len(sub(wrist, shoulder)), w = h.w ?? 1;
            r.push(Math.max(0, d - 0.985 * L) * 40 * w, Math.max(0, 0.3 * L - d) * 20 * w + Math.max(0, 0.975 * L - d) * 10 * (h.straight ?? 0));
            // (the arm's lift: the shoulder-to-wrist line's elevation in the chest's frame, a stand-in for the humerus's)
            const ld = frL({ ...chF, o: [0, 0, 0] }, norm(sub(wrist, shoulder)));
            const elev = Math.acos(clamp(-ld[1], -1, 1)), lx = i === 0 ? ld[0] : -ld[0];
            dofRes(r, elev, J.shoulder.elev, k, !!h.bear, 0.5);
            dofRes(r, Math.acos(clamp(lx * SHOULDER_CONE[0] + ld[1] * SHOULDER_CONE[1] + ld[2] * SHOULDER_CONE[2], -1, 1)), J.shoulder.cone, 1, false, 0.7);
            hands[i] = { wrist, goal: g, bear: !!h.bear, w };
            if (h.bear)
                support.push(g.palm, add(g.palm, scale(g.fwd, 0.06 * s)));
        }
        // the seat
        const sitPt = add(scale(add(T0.hips[0], T0.hips[1]), 0.5), add(scale(T0.pel.y, -0.085 * s), scale(T0.pel.z, -0.015 * s)));
        if (G.seat) {
            const e = sub(sitPt, G.seat);
            r.push(e[0] * 40, e[1] * 40, e[2] * 40);
            support.push(add(G.seat, scale(T0.pel.z, 0.08 * s)), add(G.seat, scale(T0.pel.z, -0.06 * s)), add(G.seat, scale(T0.pel.x, 0.09 * s)), add(G.seat, scale(T0.pel.x, -0.09 * s)));
        }
        else
            r.push(0, 0, 0);
        // the centre of mass over what holds the body up
        const com = comOf(M, T0, legs, sh, hands, G.feet);
        let margin = null;
        if (support.length)
            margin = hullMargin(support.map((p) => [p[0], p[2]]), [com[0], com[2]]);
        r.push(G.balance && margin !== null ? Math.max(0, 0.035 * s - margin) * 25 * G.balance : 0);
        // nothing of the trunk through the ground
        for (const p of [scale(add(T0.hips[0], T0.hips[1]), 0.5), T0.chestBase, T0.neckBase])
            r.push(Math.max(0, ground + 0.07 * s - p[1]) * 20);
        // the activity's wishes
        const Pv = G.pelvis;
        if (Pv?.at) {
            const e = sub([x[0], x[1], x[2]], Pv.at);
            const w = Pv.w ?? 1;
            r.push(e[0] * w, e[1] * w, e[2] * w);
        }
        else
            r.push(0, 0, 0);
        r.push(Pv?.height !== undefined ? (x[1] - (ground + Pv.height)) * (Pv.hw ?? 1) * 3 : 0);
        const rw = Pv?.rw ?? 1;
        r.push(Pv?.yaw !== undefined ? (x[3] - Pv.yaw) * rw : 0, Pv?.pitch !== undefined ? (x[4] - Pv.pitch) * rw : 0, Pv?.roll !== undefined ? (x[5] - Pv.roll) * rw : 0);
        const Sp = G.spine, sw = Sp?.w ?? 1;
        r.push(Sp?.flex !== undefined ? (x[6] - Sp.flex) * sw : 0, Sp?.side !== undefined ? (x[7] - Sp.side) * sw : 0, Sp?.turn !== undefined ? (x[8] - Sp.turn) * sw : 0);
        // (a little of last frame's: no jumps between nearly-as-good poses)
        const xp = S.x;
        for (let j = 0; j < 9; j++)
            r.push(xp ? (x[j] - xp[j]) * (j < 3 ? 0.6 : 0.25) : 0);
        // (the pelvis and the spine near their middles when nothing else says: a body at rest)
        r.push(x[4] * 0.15, x[5] * 0.3, x[3] * 0.15);
        return { x, r, pose: { pel: T0.pel, mid: T0.mid, ch: T0.ch, waist: T0.waist, chestBase: T0.chestBase, neckBase: T0.neckBase, com, margin, support } };
    };
    // ---- the first guess: last frame's, or the pelvis over the feet at standing height (a new pose: both, the better kept)
    if (S.x && G.fresh) {
        G.fresh = false;
        const S2 = new BodyState();
        S2.heel = S.heel.slice();
        S2.pole = S.pole.slice();
        const a = solveBody(M, G, S, Math.max(iters, 30)), b = solveBody(M, G, S2, 40);
        if (b.cost < a.cost) {
            S.x = S2.x;
            S.heel = S2.heel;
            S.pole = S2.pole;
            S.lam = S2.lam;
            return b;
        }
        return a;
    }
    let x;
    // (where the trunk was, and its goal's frame, for an `ease`)
    const x0 = S.x ? S.x.slice() : null, at0 = S.at;
    S.at = [G.at[0], G.at[1], G.at[2]];
    if (S.x)
        x = S.x.slice();
    else {
        const feet = G.feet.filter((f) => !!f);
        const c = G.seat ? add(G.seat, [0, 0.09 * s, 0]) : feet.length ? scale(feet.reduce((a, f) => add(a, f.knee ?? f.at), [0, 0, 0]), 1 / feet.length) : G.at;
        const h = G.seat ? 0 : (G.pelvis?.height ?? P.pelvis[1] * 0.97);
        x = [c[0], (G.seat ? c[1] : ground + h), c[2], G.pelvis?.yaw ?? 0, G.pelvis?.pitch ?? 0, 0, G.spine?.flex ?? 0, G.spine?.side ?? 0, G.spine?.turn ?? 0];
        if (G.pelvis?.at) {
            x[0] = G.pelvis.at[0];
            x[1] = G.pelvis.at[1];
            x[2] = G.pelvis.at[2];
        }
        iters = Math.max(iters, 40);
    }
    // ---- the heels: each lifted as far as eases the leg (a small search, from where it was)
    const heelFit = (xx) => {
        const T0 = trunk(xx);
        for (let i = 0; i < 2; i++) {
            const f = G.feet[i];
            if (f?.kind !== 'ball')
                continue;
            const cost = (h) => {
                const L = legFor(i, T0, f, h, null), r = [];
                const lt = M.L.thigh, ls = M.L.shin;
                r.push(Math.max(0, L.legLen - 0.999 * (lt + ls)) * 40);
                dofRes(r, L.ankleA[0], JOINTS.ankle.dorsi, k, true);
                r.push(Math.sqrt(40) * Math.max(0, L.toeExt - JOINTS.toe.ext.pHi * k), Math.sqrt(3) * Math.max(0, L.toeExt - JOINTS.toe.ext.okHi * k));
                dofRes(r, L.kneeFlex, JOINTS.knee.flex, k, true);
                // (the heels toward the ground as far as the ankles let them: a teacher's cue)
                return r.reduce((a, b) => a + b * b, 0) + 0.5 * (h - S.heel[i]) ** 2 + 0.3 * h * h;
            };
            let lo = 0, hi = 1.6;
            for (let it = 0; it < 14; it++) {
                const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
                if (cost(m1) < cost(m2))
                    hi = m2;
                else
                    lo = m1;
            }
            S.heel[i] = (lo + hi) / 2;
        }
    };
    // ---- Levenberg–Marquardt on the trunk's nine numbers
    let E = evalX(x);
    let c = E.r.reduce((a, b) => a + b * b, 0);
    const H = [1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4];
    let n = 0;
    for (; n < iters; n++) {
        heelFit(x);
        E = evalX(x);
        c = E.r.reduce((a, b) => a + b * b, 0);
        const m = E.r.length, J = [];
        for (let j = 0; j < 9; j++) {
            const xj = x.slice();
            xj[j] += H[j];
            const rj = evalX(xj).r;
            J.push(rj.map((v, q) => (v - E.r[q]) / H[j]));
        }
        const A = Array.from({ length: 9 }, () => new Array(9).fill(0)), g = new Array(9).fill(0);
        for (let a = 0; a < 9; a++) {
            for (let q = 0; q < m; q++)
                g[a] += J[a][q] * E.r[q];
            for (let b = a; b < 9; b++) {
                let v = 0;
                for (let q = 0; q < m; q++)
                    v += J[a][q] * J[b][q];
                A[a][b] = A[b][a] = v;
            }
        }
        let improved = false;
        // (tried until a step helps, the damping raised each time: given up after a few, a frame kept the trunk where it
        // was and the next made two frames' way at once — a body moving at half the frame rate, in steps)
        for (let tries = 0; tries < 8 && !improved; tries++) {
            const Al = A.map((row, a) => row.map((v, b) => (a === b ? v + S.lam * (v + 1e-6) : v)));
            const dx = solveLin(Al, g.map((v) => -v));
            if (!dx) {
                S.lam *= 4;
                continue;
            }
            // (a step no longer than a hand's breadth or a quarter radian: the fit walks to its pose, never leaps past it)
            const big = Math.max(...dx.map((v, j) => Math.abs(v) / (j < 3 ? 0.12 : 0.25)));
            const xn = x.map((v, j) => v + dx[j] / Math.max(1, big));
            const En = evalX(xn), cn = En.r.reduce((a, b) => a + b * b, 0);
            if (cn < c) {
                x = xn;
                E = En;
                improved = cn < c - 1e-9;
                c = cn;
                S.lam = Math.max(1e-6, S.lam / 3);
            }
            else
                S.lam = Math.min(1e4, S.lam * 4);
        }
        if (!improved)
            break;
    }
    // (eased: the trunk after its fit by a critically damped follow, each number against the goal's own frame — its
    // place by how far `at` moved, the turns as they are, being in the body's frame already)
    if (G.ease && G.ease > 0 && S.dt > 0 && x0 && at0) {
        const w = 2 / G.ease, dt = S.dt, e = Math.exp(-w * dt), v = S.v ?? (S.v = new Array(9).fill(0));
        for (let j = 0; j < 9; j++) {
            const shift = j < 3 ? G.at[j] - at0[j] : 0, from = x0[j] + shift, d = from - x[j];
            const tmp = (v[j] + w * d) * dt;
            v[j] = (v[j] - w * tmp) * e;
            x[j] = x[j] + (d + tmp) * e;
        }
        E = evalX(x);
        c = E.r.reduce((a, b) => a + b * b, 0);
    }
    else
        S.v = null;
    S.x = x;
    if (debug) {
        // (the residuals by what they are, for a test's report)
        const names = residualNames(G);
        const r = evalX(x).r, agg = {};
        r.forEach((v, q) => { const n = names[q] ?? '?'; agg[n] = (agg[n] ?? 0) + v * v; });
        debug(Object.entries(agg).filter(([, v]) => v > 1e-4).sort((a, b) => b[1] - a[1]));
    }
    const T0 = trunk(x);
    // ---- the legs: each knee swivelled to its ease about the hip–ankle line
    const legs = [];
    for (let i = 0; i < 2; i++) {
        const f = G.feet[i];
        if (!f) {
            legs.push(restLeg(M, T0, i));
            continue;
        }
        const L0 = legFor(i, T0, f, S.heel[i], null);
        let pole = L0.pole;
        if (!f.knee)
            pole = legFit(M, T0, f, i, S, k);
        const L = legFor(i, T0, f, S.heel[i], pole);
        S.pole[i] = pole;
        legs.push({ hip: L.hip, knee: L.knee, ankle: L.ankle, ball: L.ball, toe: L.toe, pole, footUp: L.footUp, toeDir: L.toeDir, toeUp: L.toeUp, heel: S.heel[i] });
    }
    // ---- the neck and the head: toward the look, over the neck's two levels by their ranges
    const chF = T0.chF;
    let hy = 0, hp = (G.nod ?? 0);
    if (G.look) {
        const lv = frL({ o: T0.neckBase, x: T0.ch.x, y: T0.ch.y, z: T0.ch.z }, G.look);
        hy = Math.atan2(lv[0], Math.max(lv[2], 0.05));
        hp += -Math.atan2(lv[1] - 0.15 * s, Math.hypot(lv[0], lv[2]));
    }
    // (what the neck can't take, the eyes do: each level to its limit)
    const nl = 1 - 0.4 * (G.neckLong ?? 0);
    const turnMax = (JOINTS.neckLow.turn.hi + JOINTS.neckUp.turn.hi) * k * 0.92 * nl;
    hy = clamp(hy, -turnMax, turnMax);
    hp = clamp(hp * nl, (JOINTS.neckLow.flex.lo + JOINTS.neckUp.flex.lo) * k * 0.9, (JOINTS.neckLow.flex.hi + JOINTS.neckUp.flex.hi) * k * 0.9);
    const lowF = hp >= 0 ? NECK.down : NECK.up;
    const nk = frBend(T0.ch, hp * lowF, 0, hy * NECK.turn);
    const headBase = add(T0.neckBase, frD(nk, sub(P.headBase, P.neckBase)));
    const hd = frBend(nk, hp * (1 - lowF), 0, hy * (1 - NECK.turn));
    const headTop = add(headBase, frD(hd, sub(P.headTop, P.headBase)));
    void chF;
    return {
        pel: T0.pel, mid: T0.mid, ch: T0.ch, waist: T0.waist, chestBase: T0.chestBase, neckBase: T0.neckBase, headBase, headTop, nk, hd,
        legs: legs, hands: [0, 1].map((i) => {
            const g = handGoal(i, T0.chF), h = G.hands[i];
            if (!g || !h)
                return null;
            let wrist = wristOf(i, g);
            if (!h.bear)
                wrist = shoulderLimit(i, T0.chF, shoulderOf(M, i, T0.chF, wrist), wrist, k);
            return { wrist, goal: g, bear: !!h.bear, w: h.w ?? 1 };
        }),
        com: E.pose.com, margin: E.pose.margin ?? null, support: E.pose.support ?? [], cost: c, iters: n,
    };
}
/** a hand's wrist brought back within the shoulder's reach (its elevation, its cone: anatomy.ts) about the shoulder,
 *  the arm's length kept: what's past a limit the hand gives up, not the joint (as the wrist's wristLimit) */
function shoulderLimit(i, chF, shoulder, wrist, k) {
    const d = sub(wrist, shoulder), dl = len(d);
    if (dl < 1e-4)
        return wrist;
    const side = i === 0 ? 1 : -1, C0 = { ...chF, o: [0, 0, 0] };
    let ld = frL(C0, scale(d, 1 / dl));
    const eMax = JOINTS.shoulder.elev.hi * flexOf(JOINTS.shoulder.elev, k) * 0.97;
    const e = Math.acos(clamp(-ld[1], -1, 1));
    if (e > eMax) {
        const ax = cross([0, -1, 0], ld), al = len(ax);
        if (al > 1e-5)
            ld = rotateAxis(ld, scale(ax, 1 / al), eMax - e);
    }
    const C = [side * SHOULDER_CONE[0], SHOULDER_CONE[1], SHOULDER_CONE[2]];
    const cMax = JOINTS.shoulder.cone.hi * flexOf(JOINTS.shoulder.cone, k) * 0.97, c = Math.acos(clamp(dot(ld, C), -1, 1));
    if (c > cMax) {
        const ax = cross(C, ld), al = len(ax);
        if (al > 1e-5)
            ld = rotateAxis(ld, scale(ax, 1 / al), cMax - c);
    }
    return add(shoulder, scale(frD(C0, ld), dl));
}
/** the residuals' names in evalX's order (for a report) */
function residualNames(G) {
    const n = [];
    const dof = (k) => n.push(k + '.pull', k + '.band', k + '.limit');
    for (const j of ['lumbar', 'thoracic'])
        for (const d of ['flex', 'side', 'turn'])
            dof(`${j}.${d}`);
    for (let i = 0; i < 2; i++) {
        const T = i ? 'R' : 'L';
        n.push(`leg${T}.reach`, `leg${T}.fold`);
        dof(`hip${T}.flex`);
        dof(`hip${T}.abd`);
        dof(`hip${T}.rot`);
        dof(`knee${T}.flex`);
        dof(`ankle${T}.dorsi`);
        n.push(`toe${T}.ext`, `hip${T}.wish`, `knee${T}.wish`);
    }
    for (let i = 0; i < 2; i++) {
        const T = i ? 'R' : 'L';
        n.push(`hand${T}.reach`, `hand${T}.fold`);
        dof(`shoulder${T}.elev`);
        dof(`shoulder${T}.cone`);
    }
    n.push('seat.x', 'seat.y', 'seat.z', 'balance', 'ground.hips', 'ground.chest', 'ground.neck', 'pelvis.x', 'pelvis.y', 'pelvis.z', 'pelvis.height', 'pelvis.yaw', 'pelvis.pitch', 'pelvis.roll', 'spine.flex', 'spine.side', 'spine.turn');
    for (let j = 0; j < 9; j++)
        n.push('last' + j);
    n.push('rest.pitch', 'rest.roll', 'rest.yaw');
    void G;
    return n;
}
/** a leg without a goal: hanging straight from its hip */
function restLeg(M, T0, i) {
    const hip = T0.hips[i], down = scale(T0.pel.y, -1);
    const knee = add(hip, scale(down, M.L.thigh)), ankle = add(knee, scale(down, M.L.shin));
    const ball = add(ankle, add(scale(T0.pel.z, M.FH), scale(down, 0.04 * M.s)));
    const fn = norm(sub(ball, ankle));
    return { hip, knee, ankle, ball, toe: add(ball, scale(fn, M.L.toe)), pole: T0.pel.z, footUp: norm(cross(fn, T0.pel.x)), toeDir: fn, toeUp: norm(cross(fn, T0.pel.x)), heel: 0 };
}
/** the knee's swivel about the hip–ankle line where the leg is most at ease: the hip's turn and spread, the shin's turn
 *  (as far as the knee's bend allows it), the ankle's roll — near its goal's way and last frame's. Sampled round the
 *  circle, then refined (as armFit). */
function legFit(M, T0, f, i, S, k) {
    const legFor = (i, T0, f, heel, pole) => legOf(M, k, i, T0, f, heel, pole);
    const L0 = legFor(i, T0, f, S.heel[i], null);
    const ax = norm(sub(L0.ankle, L0.hip));
    const r0 = norm(rej(L0.pole, ax)), r1 = cross(ax, r0);
    const prev = S.pole[i];
    const cost = (phi) => {
        const pole = add(scale(r0, Math.cos(phi)), scale(r1, Math.sin(phi)));
        const L = legFor(i, T0, f, S.heel[i], pole);
        const loaded = f.kind !== 'free';
        let c = discomfort(L.hipA[2], JOINTS.hip.rot, k) + discomfort(L.hipA[1], JOINTS.hip.abd, k)
            + discomfort(L.hipA[0], { ...JOINTS.hip.flex, hi: hipFlexMax(L.kneeFlex, k) / k }, k);
        const kr = kneeRotK(L.kneeFlex);
        c += discomfort(L.kneeRot, { ...JOINTS.knee.rot, lo: JOINTS.knee.rot.lo * kr, hi: JOINTS.knee.rot.hi * kr, okLo: JOINTS.knee.rot.okLo * kr, okHi: JOINTS.knee.rot.okHi * kr }, k);
        c += discomfort(L.ankleA[1], JOINTS.ankle.inv, k, loaded) + discomfort(L.ankleA[2], JOINTS.ankle.add, k, loaded);
        // (planted, the knee tracks over the toes, as a teacher says: a firmer pull to the foot's own way)
        c += (f.kind === 'free' ? 0.25 : 1.2) * (1 - Math.cos(phi));
        if (prev)
            c += 1.0 * (1 - dot(pole, norm(rej(prev, ax))));
        return c;
    };
    const N = 24;
    let bi = 0, bc = Infinity;
    for (let q = 0; q < N; q++) {
        const c = cost((q / N) * Math.PI * 2);
        if (c < bc) {
            bc = c;
            bi = q;
        }
    }
    let lo = ((bi - 1) / N) * Math.PI * 2, hi = ((bi + 1) / N) * Math.PI * 2;
    for (let it = 0; it < 10; it++) {
        const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
        if (cost(m1) < cost(m2))
            hi = m2;
        else
            lo = m1;
    }
    const phi = (lo + hi) / 2;
    return norm(add(scale(r0, Math.cos(phi)), scale(r1, Math.sin(phi))));
}
/** the centre of mass of a posed body (de Leva's segments; the arms straight-ish from shoulder to wrist) */
function comOf(M, T0, legs, sh, hands, feet) {
    const sx = M.female ? 'f' : 'm', ci = M.female ? 0 : 1, s = M.s;
    let mass = 0, com = [0, 0, 0];
    const seg = (n, a, b) => { const S = SEGMENTS[n]; const w = S[sx]; mass += w; com = add(com, scale(lerp3(a, b, S.c[ci]), w)); };
    const headTop = add(T0.neckBase, scale(T0.ch.y, 0.26 * s));
    seg('head', T0.neckBase, headTop);
    seg('thorax', T0.chestBase, T0.neckBase);
    seg('abdomen', T0.waist, T0.chestBase);
    seg('pelvis', scale(add(T0.hips[0], T0.hips[1]), 0.5), T0.waist);
    for (let i = 0; i < 2; i++) {
        const shp = sh[i] ?? T0.chestBase;
        const wr = hands[i]?.wrist ?? add(shp, scale(T0.ch.y, -(M.L.uarm + M.L.farm) * 0.95));
        seg('uarm', shp, lerp3(shp, wr, 0.5));
        seg('farm', lerp3(shp, wr, 0.5), wr);
        seg('hand', wr, add(wr, scale(norm(sub(wr, shp)), M.L.hand)));
        const L = legs.find((l) => l.hip === T0.hips[i]) ?? null;
        if (L && feet[i]) {
            seg('thigh', L.hip, L.knee);
            seg('shank', L.knee, L.ankle);
            seg('foot', L.ankle, L.toe);
        }
        else {
            const hip = T0.hips[i], kn = add(hip, scale(T0.pel.y, -M.L.thigh)), an = add(kn, scale(T0.pel.y, -M.L.shin));
            seg('thigh', hip, kn);
            seg('shank', kn, an);
            seg('foot', an, add(an, scale(T0.pel.z, M.FH)));
        }
    }
    return scale(com, 1 / mass);
}
/** A x = b (small, dense: Gaussian elimination with partial pivoting); null if singular */
function solveLin(A, b) {
    const n = b.length, M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++)
            if (Math.abs(M[r][c]) > Math.abs(M[p][c]))
                p = r;
        if (Math.abs(M[p][c]) < 1e-12)
            return null;
        [M[c], M[p]] = [M[p], M[c]];
        for (let r = c + 1; r < n; r++) {
            const f = M[r][c] / M[c][c];
            for (let q = c; q <= n; q++)
                M[r][q] -= f * M[c][q];
        }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
        let v = M[r][n];
        for (let q = r + 1; q < n; q++)
            v -= M[r][q] * x[q];
        x[r] = v / M[r][r];
    }
    return x;
}
//# sourceMappingURL=solve.js.map