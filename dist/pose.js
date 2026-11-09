// Aang's rig: his skeleton (the heroine's bone names, order and bind conventions, hero/asset.ts) posed each frame from
// a Pose in his body's own frame — where the pelvis is and how it's turned, the spine's bend, the head's turn and what
// he looks at, each wrist's target with its palm and the elbow's way, each ankle's with the foot's way, the sole's and
// the knee's, the fingers' curl — solved by two-bone IK as Katara's rig solves her limbs (hero/rig.ts: the same frames,
// the same clavicle shrug, elbow pole and forearm twist, the same per-joint fingers); the face (blinks, the gaze, an
// expression) for the drawn face; the sash's tails as verlet chains hanging from the pelvis; the props he uses (the
// cushion, the tray, the teapot, the cup: one-bone 'chains') wherever the behaviour sets them. Each bone's skin
// transform goes to the GPU as a dual quaternion (HeroMesh).
//
// (@ericrius1/cast: Boulder's aang/rig.ts as the Solarium carried it on — its forearm held to a forearm's turn and the
// wrist to its bend, props held in the fingers from the hand as posed, a braid hung from the head — the AangRig, also
// exported as PoseRig: any body posed whole from a Pose rather than walked by the HeroRig.)
import { add, sub, scale, norm, cross, dot, len, clamp, lerp, lerp3, rotateAxis, damp, rej, smoothstep } from './math.js';
import { MAX_BONES } from './asset.js';
import { matToDQ, legUps, carryUp, NECK } from './rig.js';
import { poseHang, hang, hangBone, HOLD } from './garment.js';
import { Face, fromLegacy, toLegacy, blank } from './face.js';
const frW = (f, l) => [f.o[0] + f.x[0] * l[0] + f.y[0] * l[1] + f.z[0] * l[2], f.o[1] + f.x[1] * l[0] + f.y[1] * l[1] + f.z[1] * l[2], f.o[2] + f.x[2] * l[0] + f.y[2] * l[1] + f.z[2] * l[2]];
const frD = (f, l) => [f.x[0] * l[0] + f.y[0] * l[1] + f.z[0] * l[2], f.x[1] * l[0] + f.y[1] * l[1] + f.z[1] * l[2], f.x[2] * l[0] + f.y[2] * l[1] + f.z[2] * l[2]];
const frL = (f, w) => { const d = sub(w, f.o); return [dot(d, f.x), dot(d, f.y), dot(d, f.z)]; };
const frRot = (f, axis, a) => (a === 0 ? f : { o: f.o, x: rotateAxis(f.x, axis, a), y: rotateAxis(f.y, axis, a), z: rotateAxis(f.z, axis, a) });
/** turned by yaw (about its up: to its left +), pitch (about its left: forward +), roll (about its forward: to its right +) */
function frEuler(f, e, k = 1) {
    let g = frRot(f, f.y, e[0] * k);
    g = frRot(g, g.x, e[1] * k);
    return frRot(g, g.z, e[2] * k);
}
/** the knee's way (its pole), kept off the hip-to-ankle line. A pose's knee aimed along that line — the dog's
 *  forward-and-up with the legs still level behind from plank, lowering the knees from a dog — leaves the knee free to
 *  swing round the line: the thigh and shin roll a quarter turn in a few frames (or settle the wrong way round), the
 *  trousers and the robe with them. Near the line (within ~25°) the knee turns instead toward its natural front, ahead
 *  and a little down in the body's frame (forward standing, down with the legs out behind, down and ahead in a dog or
 *  kneeling), blended back to the pose's as its pole comes off the line */
function kneePole(hip, ankle, pole, Bf) {
    const d = norm(sub(ankle, hip)), pp = rej(pole, d), l = len(pp);
    const w = smoothstep(0.15, 0.42, l);
    if (w >= 1)
        return scale(pp, 1 / l);
    const nat = rej(norm(sub(Bf.z, scale(Bf.y, 0.6))), d), ln = len(nat);
    if (ln < 1e-4)
        return l > 1e-6 ? scale(pp, 1 / l) : [0, 1, 0];
    // (turned from the natural front toward the pose's about the line by w of the angle between: a blend through the
    // middle would snap round when the two lie opposite)
    const a = scale(nat, 1 / ln);
    if (l < 1e-6)
        return a;
    const b = scale(pp, 1 / l), ang = Math.atan2(dot(cross(a, b), d), dot(a, b));
    return norm(rotateAxis(a, d, ang * w));
}
/** two-bone IK: the middle joint, bending toward `pole`, a soft reach near full extension */
function ik2(a, target, l1, l2, pole, soft = 0) {
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
        pp = [0, 1, 0];
    return add(add(a, scale(dn, x)), scale(norm(pp), h));
}
const VKEYS = ['pelvis', 'pelvisRot', 'spine', 'head'];
const PKEYS = ['hand', 'palm', 'elbow', 'foot', 'footDir', 'sole', 'knee'];
export function zeroPose() {
    const z = () => [0, 0, 0];
    return { pelvis: z(), pelvisRot: z(), spine: z(), head: z(), hand: [z(), z()], palm: [z(), z()], elbow: [z(), z()], curl: [0, 0],
        foot: [z(), z()], footDir: [z(), z()], sole: [z(), z()], knee: [z(), z()] };
}
/** add w of p into o */
export function addPose(o, p, w) {
    if (w <= 1e-6)
        return;
    for (const k of VKEYS)
        for (let i = 0; i < 3; i++)
            o[k][i] += p[k][i] * w;
    for (const k of PKEYS)
        for (let s = 0; s < 2; s++)
            for (let i = 0; i < 3; i++)
                o[k][s][i] += p[k][s][i] * w;
    o.curl[0] += p.curl[0] * w;
    o.curl[1] += p.curl[1] * w;
}
/** a blend of poses (weights summing to 1) */
export function blendPoses(list) {
    const o = zeroPose();
    for (const [p, w] of list)
        addPose(o, p, w);
    return o;
}
// ---------------------------------------------------------------- the sash's tails (as hero/rig.ts' chains)
class Chain {
    p;
    pp;
    rest;
    constructor(pts) {
        this.p = pts.map((q) => [...q]);
        this.pp = pts.map((q) => [...q]);
        this.rest = [];
        for (let i = 0; i < pts.length - 1; i++)
            this.rest.push(len(sub(pts[i + 1], pts[i])));
    }
    reset(pts) { for (let i = 0; i < this.p.length; i++) {
        this.p[i] = [...pts[i]];
        this.pp[i] = [...pts[i]];
    } }
    /** at rest where it is (no swing carried on) */
    still() { for (let i = 0; i < this.p.length; i++)
        this.pp[i] = [...this.p[i]]; }
    step(dt, target, pull, wind, push, floor) {
        const P = this.p, PP = this.pp, n = P.length;
        const dmp = Math.exp(-1.6 * dt);
        for (let i = 1; i < n; i++) {
            const p = P[i], q = PP[i];
            const u = i / (n - 1);
            const ka = (1 - Math.exp(-2 * dt)) * (0.3 + 0.7 * u);
            const dx = (p[0] - q[0]) * dmp, dy = (p[1] - q[1]) * dmp, dz = (p[2] - q[2]) * dmp;
            PP[i] = [p[0], p[1], p[2]];
            p[0] += dx + (wind[0] * dt - dx) * ka;
            p[1] += dy + (wind[1] * dt - dy) * ka * 0.5 - 9.8 * dt * dt;
            p[2] += dz + (wind[2] * dt - dz) * ka;
            const k = pull[i], g = target[i];
            p[0] += (g[0] - p[0]) * k;
            p[1] += (g[1] - p[1]) * k;
            p[2] += (g[2] - p[2]) * k;
        }
        P[0] = [...target[0]];
        for (let it = 0; it < 4; it++) {
            for (let i = 0; i < n - 1; i++) {
                const a = P[i], b = P[i + 1];
                const d = sub(b, a);
                const l = len(d) || 1e-6;
                const k = (l - this.rest[i]) / l;
                if (i === 0) {
                    b[0] -= d[0] * k;
                    b[1] -= d[1] * k;
                    b[2] -= d[2] * k;
                }
                else {
                    const h = k * 0.5;
                    a[0] += d[0] * h;
                    a[1] += d[1] * h;
                    a[2] += d[2] * h;
                    b[0] -= d[0] * h;
                    b[1] -= d[1] * h;
                    b[2] -= d[2] * h;
                }
            }
            for (let i = 1; i < n; i++) {
                push(P[i], PP[i]);
                if (P[i][1] < floor)
                    P[i][1] = floor;
            }
        }
    }
}
const PROPS = ['cushion', 'tray', 'pot', 'cup'];
const FACE_BONES = ['jaw', 'lipU', 'lipUL', 'lipUR', 'lipD', 'lipDL', 'lipDR', 'mouthL', 'mouthR', 'cheekL', 'cheekR', 'browInL', 'browInR', 'browOutL', 'browOutR', 'eyeL', 'eyeR', 'lidUL', 'lidDL', 'lidUR', 'lidDR'];
const JAW_OPEN = 0.16;
/** the forearm's turn (rad, about its length) from neutral — the thumb along the elbow's bend, a handshake's hand; the
 *  mesh is built so, its thumbs forward with the arms hanging — as far as a forearm goes: pronation (the palm turned
 *  down, the thumb in) to PRO, supination (the palm up, the thumb out) to SUP, the last TW_SOFT of each eased in */
const PRO = 1.38, SUP = 1.5, TW_SOFT = 0.3;
/** a request the forearm can't turn to (the palm asked round the back, past both ends): held to the end it went out by
 *  unless the other is nearer by this much (rad) — a request wavering about the far side doesn't swap ends */
const TW_STICK = 0.5;
/** how fast the forearm turns (rad/s) at most: going from one end to the other it turns the way a forearm does, through
 *  neutral, never the short way round behind */
const TW_RATE = 8;
/** the wrist's bend from the forearm's line (rad): flexion (toward the palm), extension, radial deviation (toward the
 *  thumb), ulnar (toward the little finger); a bend asked further is eased to the edge of that (an ellipse's) */
const FLEX = 1.2, EXT = 1.0, RAD = 0.33, ULN = 0.5;
/** x eased to [lo, hi]: unchanged inside, the last `soft` of each end approached and never passed */
function softClamp(x, lo, hi, soft) {
    if (x > hi - soft)
        return hi - soft * Math.exp(-(x - (hi - soft)) / soft);
    if (x < lo + soft)
        return lo + soft * Math.exp((x - (lo + soft)) / soft);
    return x;
}
/** how far a cup turns in the fingers that hold it (rad), about the palm's normal, toward the way it's wanted up */
const GRIP_TURN = 0.75;
/** how far a cup standing on a palm stays upright as the palm tips (rad): the curled fingers keep it from tipping */
const PALM_TURN = 1.0;
/** where along the hand (wrist to fingertips, its fraction) a held cup's axis lies: over the palm's middle, toward the
 *  knuckles, the fingers curling round its far side */
export const GRIP_AT = 0.32;
export class AangRig {
    asset;
    bones = new Float32Array(MAX_BONES * 16);
    dq = new Float32Array(MAX_BONES * 8);
    nBones;
    bind = [];
    bi;
    B;
    len = [];
    /** his landmarks in bind space (pelvis, waist, chest, neck, head, shoulders, hips, ankles, balls...) */
    sk = {};
    /** world joints for others (the props in his hands, the wind at his hands and feet, the camera) */
    J = { handL: [0, 0, 0], handR: [0, 0, 0], palmL: [0, 1, 0], palmR: [0, 1, 0], head: [0, 0, 0], mouth: [0, 0, 0], lip: [0, 0, 0],
        chest: [0, 0, 0], pelvis: [0, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0], headFwd: [0, 0, 1], headUp: [0, 1, 0] };
    // the face (cast/face.ts: moods, passing expressions, a sip, speech); fx its state as the older face's keys
    face = new Face();
    fx = { smile: 0.5, jaw: 0, pucker: 0, frown: 0, brows: 0, tender: 0, browDown: 0, squint: 0, wide: 0, closed: 0 };
    fxBase = blank();
    gaze = [0, 0, 1];
    blink = 0;
    headYaw = 0;
    headPitch = 0;
    /** each forearm's turn (rad, pronation +) as posed, the end of its range a request beyond it went to (1 pronation, -1
     *  supination, 0 none), and what was asked (for the gesture tools) */
    tw = [0, 0];
    twEnd = [0, 0];
    twAsk = [0, 0];
    /** each hand as posed (left, right): what it holds is placed from it (`hold`) */
    hands = [{ wrist: [0, 0, 0], dir: [0, -1, 0], thumb: [0, 0, 1], palm: [-1, 0, 0] }, { wrist: [0, 0, 0], dir: [0, -1, 0], thumb: [0, 0, 1], palm: [1, 0, 0] }];
    dt = 1 / 60;
    /** how far his hips have tipped over (garment.ts poseHang) */
    hangK = 0;
    /** (each hung from the hips: garment.ts hang; `frame` the bone it hangs in) */
    chains = [];
    chainAcc = 0;
    first = true;
    /** where each prop is: its base point, up and forward (world); null where it sits at its bind spot (unseen) */
    props = { cushion: null, tray: null, pot: null, cup: null };
    /** a prop held in a hand (0 the left), placed from that hand as it's posed — so it's always in the fingers, wherever
     *  the arm's limits leave the hand — by k (0..1, from where `props` puts it): a cup (its rim's radius r, its height h)
     *  in the hollow of the palm, its axis along the hand's thumb side, turned in the fingers toward `up` (world) as far
     *  as a grip lets (GRIP_TURN); `rest`: until it's taken, standing on that hand's palm (rather than where `props` puts
     *  it), tipped toward `up` as far as it would stay — or, the palm turned away from up, held round its side as the
     *  other hand would */
    holds = {};
    /** where each prop was put this frame (world: its base and up) */
    held = {};
    get faceState() { return { gaze: this.gaze, blink: this.blink, face: this.fx, s: this.face.state }; }
    get jawOpen() { return this.fx.jaw; }
    constructor(asset) {
        this.asset = asset;
        this.B = asset.bones;
        this.bi = asset.index;
        this.nBones = asset.bones.length;
        for (const b of this.B) {
            const z = norm(sub(b.tail, b.head));
            let x = cross(b.up, z);
            if (len(x) < 1e-5)
                x = cross([1, 0, 0], z);
            x = norm(x);
            const y = cross(z, x);
            this.bind.push({ o: b.head, x, y, z, t: [-dot(x, b.head), -dot(y, b.head), -dot(z, b.head)] });
            this.len.push(len(sub(b.tail, b.head)));
        }
        const g = (n) => this.B[this.bi[n]];
        this.sk = {
            pelvis: g('pelvis').head, waist: g('pelvis').tail, chestBase: g('chest').head, neckBase: g('neck').head, headBase: g('head').head, headTop: g('head').tail,
            clavL: g('clavL').head, shoulderL: g('uarmL').head, clavR: g('clavR').head, shoulderR: g('uarmR').head,
            hipL: g('thighL').head, hipR: g('thighR').head, ankleL: g('footL').head, ankleR: g('footR').head, ballL: g('toeL').head, ballR: g('toeR').head,
        };
        for (let i = 0; i < MAX_BONES; i++) {
            const k = i * 16;
            this.bones[k] = this.bones[k + 5] = this.bones[k + 10] = this.bones[k + 15] = 1;
        }
        // (every chain but the props: his sash's tails; another's robe's skirt panels, stiffer; Katara's braid and hair
        // loops, hung from her head as Boulder's rig hangs them: the loops short and springy)
        for (const [name, pts] of Object.entries(asset.chains)) {
            const b0 = this.bi[name + '0'];
            if (PROPS.includes(name) || b0 === undefined || pts.length < 2)
                continue;
            const head = asset.header.chainParents?.[name] === 'head' || /braid|loop|pony|hair/.test(name);
            const n = pts.length, k = /loop/.test(name) ? 0.35 : /panel/.test(name) ? 0.2 : head ? 0.12 : 0.1;
            this.chains.push({ name, bind: pts, b0, ch: new Chain(pts), pull: pts.map((_, i) => (i === 0 ? 1 : k * Math.pow(1 - i / n, 1.5) + 0.01)), frame: head ? this.bi.head : hangBone(asset, pts), head, roll: { up: [], dir: [] } });
        }
    }
    /** a bone's bind head */
    bindHead(name) { return this.B[this.bi[name]].head; }
    /** re-seat the chains where he is now (after moving him by hand) */
    snap() { this.first = true; }
    // ---------------------------------------------------------------- bone transforms (as hero/rig.ts)
    setBone(i, head, tail, up) {
        if (i === undefined)
            return;
        const z = norm(sub(tail, head));
        let x = cross(up, z);
        if (len(x) < 1e-5)
            x = cross([1, 0, 0], z);
        x = norm(x);
        const y = cross(z, x);
        const bf = this.bind[i], t = bf.t;
        const o = this.bones, k = i * 16;
        for (let c = 0; c < 3; c++) {
            const a = bf.x[c], b = bf.y[c], cc = bf.z[c];
            o[k + c * 4 + 0] = x[0] * a + y[0] * b + z[0] * cc;
            o[k + c * 4 + 1] = x[1] * a + y[1] * b + z[1] * cc;
            o[k + c * 4 + 2] = x[2] * a + y[2] * b + z[2] * cc;
            o[k + c * 4 + 3] = 0;
        }
        o[k + 12] = x[0] * t[0] + y[0] * t[1] + z[0] * t[2] + head[0];
        o[k + 13] = x[1] * t[0] + y[1] * t[1] + z[1] * t[2] + head[1];
        o[k + 14] = x[2] * t[0] + y[2] * t[1] + z[2] * t[2] + head[2];
        o[k + 15] = 1;
    }
    /** a bone rigidly with another (the face's bones with the head) */
    follow(i, of) {
        if (i === undefined)
            return;
        this.bones.copyWithin(i * 16, of * 16, of * 16 + 16);
    }
    skinPoint(i, p) {
        const m = this.bones, k = i * 16;
        return [m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12], m[k + 1] * p[0] + m[k + 5] * p[1] + m[k + 9] * p[2] + m[k + 13], m[k + 2] * p[0] + m[k + 6] * p[1] + m[k + 10] * p[2] + m[k + 14]];
    }
    skinDir(i, d) {
        const m = this.bones, k = i * 16;
        return [m[k] * d[0] + m[k + 4] * d[1] + m[k + 8] * d[2], m[k + 1] * d[0] + m[k + 5] * d[1] + m[k + 9] * d[2], m[k + 2] * d[0] + m[k + 6] * d[1] + m[k + 10] * d[2]];
    }
    /** a bone's posed head / tail */
    joint(name) { const i = this.bi[name]; return this.skinPoint(i, this.B[i].head); }
    /** the body frame's left and forward for a facing */
    static axes(yaw) { return { fwd: [-Math.sin(yaw), 0, -Math.cos(yaw)], left: [-Math.cos(yaw), 0, Math.sin(yaw)] }; }
    // ---------------------------------------------------------------- the frame
    /** pose him: P in his body frame at `root` (the floor under him) facing `yaw`; he looks at `look` (world) by lookW;
     *  the face's goal; the breeze on the tails; dt for the springs, the blinks and the chains */
    update(dt, root, yaw, P, look, lookW, face, wind, bodyOnly = false) {
        dt = Math.max(1e-4, Math.min(dt, 1 / 20));
        this.dt = dt;
        const sk = this.sk;
        const { fwd, left } = AangRig.axes(yaw);
        const Bf = { o: root, x: left, y: [0, 1, 0], z: fwd };
        // ---- the trunk: pelvis, spine, chest
        const pel = frEuler({ o: frW(Bf, P.pelvis), x: left, y: [0, 1, 0], z: fwd }, P.pelvisRot);
        const rel = (q) => sub(q, sk.pelvis);
        const waistW = frW(pel, rel(sk.waist));
        this.setBone(this.bi.pelvis, pel.o, waistW, pel.z);
        const mid = frEuler(pel, P.spine, 0.45);
        const chestBaseW = add(waistW, frD(mid, sub(sk.chestBase, sk.waist)));
        this.setBone(this.bi.spine, waistW, chestBaseW, mid.z);
        const ch = frEuler(pel, P.spine);
        const chF = { o: chestBaseW, x: ch.x, y: ch.y, z: ch.z };
        const neckBaseW = frW(chF, sub(sk.neckBase, sk.chestBase));
        this.setBone(this.bi.chest, chestBaseW, neckBaseW, ch.z);
        // ---- the head: the pose's turn, toward what he's watching by lookW (limited: never over his shoulder)
        let hy = P.head[0], hp = P.head[1];
        if (look && lookW > 0.001) {
            const lv = frL({ o: neckBaseW, x: ch.x, y: ch.y, z: ch.z }, look);
            const ly = clamp(Math.atan2(lv[0], Math.max(lv[2], 0.05)), -1.1, 1.1);
            const lp = clamp(-Math.atan2(lv[1] - 0.12, Math.hypot(lv[0], lv[2])), -0.6, 0.5);
            hy = lerp(hy, ly, lookW);
            hp = lerp(hp, lp, lookW);
        }
        if (this.first) {
            this.headYaw = hy;
            this.headPitch = hp;
        }
        this.headYaw = damp(this.headYaw, hy, 9, dt);
        this.headPitch = damp(this.headPitch, hp, 9, dt);
        const he = [this.headYaw, this.headPitch, P.head[2]];
        const nk = frEuler(ch, [he[0] * NECK.turn, he[1] * NECK.nod, he[2] * NECK.tilt]);
        const headBaseW = add(neckBaseW, frD(nk, sub(sk.headBase, sk.neckBase)));
        this.setBone(this.bi.neck, neckBaseW, headBaseW, nk.z);
        const hd = frEuler(ch, he);
        const headTopW = add(headBaseW, frD(hd, sub(sk.headTop, sk.headBase)));
        this.setBone(this.bi.head, headBaseW, headTopW, hd.z);
        const E = this.asset.header.eye, Fh = this.asset.header.face;
        this.J.chest = chestBaseW;
        this.J.pelvis = pel.o;
        this.J.head = this.skinPoint(this.bi.head, [0, E.y, E.z * 0.3]);
        this.J.mouth = this.skinPoint(this.bi.head, [0, Fh.mouth_y, (Fh.nose_tip?.[1] ?? E.z + 0.04) - 0.01]);
        this.J.lip = this.skinPoint(this.bi.head, [0, Fh.mouth_y - 0.007, (Fh.nose_tip?.[1] ?? E.z + 0.04) - 0.026]);
        this.J.headFwd = hd.z;
        this.J.headUp = hd.y;
        // ---- arms
        for (const side of [1, -1]) {
            const i = side > 0 ? 0 : 1, T = side > 0 ? 'L' : 'R';
            this.armIK(side, T, chF, ch, Bf, P.hand[i], P.palm[i], P.elbow[i], P.curl[i], P.handDir?.[i]);
        }
        // ---- legs
        for (const side of [1, -1]) {
            const i = side > 0 ? 0 : 1, T = side > 0 ? 'L' : 'R';
            const hip = frW(pel, rel(side > 0 ? sk.hipL : sk.hipR));
            const ankle = frW(Bf, P.foot[i]);
            const lt = this.len[this.bi['thigh' + T]], ls = this.len[this.bi['shin' + T]];
            const pole = kneePole(hip, ankle, norm(frD(Bf, P.knee[i])), Bf);
            const knee = ik2(hip, ankle, lt, ls, pole, 0.02 * (lt + ls));
            const sd = norm(sub(ankle, knee));
            const ankleA = add(knee, scale(sd, ls));
            const fd = norm(frD(Bf, P.footDir[i]));
            const soleD = norm(rej(frD(Bf, P.sole[i]), fd));
            const footLen = len(sub(side > 0 ? sk.ballL : sk.ballR, side > 0 ? sk.ankleL : sk.ankleR));
            // (the ankle sits above the sole: the foot's line runs down to the ball)
            const ball = add(ankleA, add(scale(fd, footLen * 0.94), scale(soleD, footLen * 0.33)));
            const fn = norm(sub(ball, ankleA));
            // (the toes along the foot, or bent at the ball their own way)
            const tw = P.toeDir ? Math.min(1, len(P.toeDir[i])) : 0;
            const td = tw > 1e-3 ? norm(lerp3(fd, norm(frD(Bf, P.toeDir[i])), tw)) : fd;
            const toe = add(ball, scale(td, this.len[this.bi['toe' + T]]));
            // (each bone's front about the knee's hinge: no flip with the shin along the pole, kneeling)
            const [kUp, sUp] = legUps(norm(sub(knee, hip)), sd, sub(ankleA, hip), pole);
            this.setBone(this.bi['thigh' + T], hip, knee, kUp);
            this.setBone(this.bi['shin' + T], knee, ankleA, sUp);
            this.setBone(this.bi['foot' + T], ankleA, ball, norm(rej(scale(soleD, -1), fn)));
            this.setBone(this.bi['toe' + T], ball, toe, norm(rej(scale(soleD, -1), td)));
            if (side > 0)
                this.J.footL = ankleA;
            else
                this.J.footR = ankleA;
        }
        this.setBone(this.bi.root, root, add(root, fwd), [0, 1, 0]);
        // (the hips' hanging frame: the clothes under the hips and the tails hang from it, garment.ts)
        this.hangK = poseHang(this.asset, this.bones, dt);
        // (the body alone: another rig takes its bones and does its own face, cloth and props — Katara's yoga)
        if (bodyOnly) {
            this.first = false;
            return;
        }
        // ---- the face and its bones, the tails, the props
        this.rigFace(dt, look, face);
        this.rigChains(dt, wind);
        for (const name of PROPS) {
            const i = this.bi[name + '0'];
            if (i === undefined)
                continue;
            let p = this.props[name];
            // (held: from the hand as it's posed, by how far it's in it; resting on a palm until then)
            const g = this.holds[name];
            if (g && g.rest !== undefined) {
                // (on the palm while it's turned up; turned away, the fingers have it round its side instead)
                const want = g.up ?? [0, 1, 0], on = this.palmFrame(g.rest, want), side = this.gripFrame({ hand: g.rest, r: g.r, h: g.h, up: want });
                const k = smoothstep(0.15, 0.55, dot(this.hands[g.rest].palm, norm(want)));
                p = { at: lerp3(side.at, on.at, k), up: norm(lerp3(side.up, on.up, k)), fwd: norm(lerp3(side.fwd, on.fwd, k)) };
            }
            if (g && g.k > 1e-3) {
                const f = this.gripFrame(g);
                p = p && g.k < 1 ? { at: lerp3(p.at, f.at, g.k), up: norm(lerp3(norm(p.up), f.up, g.k)), fwd: norm(lerp3(norm(p.fwd), f.fwd, g.k)) } : f;
            }
            this.held[name] = p ? { at: p.at, up: norm(p.up) } : undefined;
            if (!p) {
                this.setBone(i, this.B[i].head, this.B[i].tail, [0, 0, 1]);
                continue;
            }
            this.setBone(i, p.at, add(p.at, scale(norm(p.up), this.len[i])), p.fwd);
        }
        this.first = false;
        for (let i = 0; i < this.nBones; i++)
            matToDQ(this.bones, i * 16, this.dq, i * 8);
    }
    /** one arm to its wrist target (body frame): the clavicle shrugs as the hand rises and reaches forward, the elbow
     *  bends toward its way, the hand turns so its palm faces `palmB` (hero/rig.ts armIK, its twist kept continuous) */
    armIK(side, T, chF, ch, Bf, handB, palmB, elbowB, curl, dirB) {
        const sk = this.sk;
        const clavBind = side > 0 ? sk.clavL : sk.clavR, shoulderBind = side > 0 ? sk.shoulderL : sk.shoulderR;
        const target = frW(Bf, handB);
        const clavIn = frW(chF, sub(clavBind, sk.chestBase));
        const CS = { o: frW(chF, sub([0, shoulderBind[1], shoulderBind[2]], sk.chestBase)), x: ch.x, y: ch.y, z: ch.z };
        const tl = frL(CS, target);
        const shrug = clamp((tl[1] + 0.05) / 0.4, 0, 1);
        const protract = clamp((tl[2] - 0.13) / 0.3, 0, 1);
        let cv = frD(chF, sub(shoulderBind, clavBind));
        cv = rotateAxis(cv, ch.z, side * shrug * 0.45);
        cv = rotateAxis(cv, ch.y, -side * protract * 0.22);
        const shoulder = add(clavIn, cv);
        const ci = this.bi['clav' + T], ua = this.bi['uarm' + T], fa = this.bi['farm' + T], ha = this.bi['hand' + T];
        this.setBone(ci, clavIn, shoulder, ch.y);
        const lu = this.len[ua], lf = this.len[fa];
        const pole = norm(frD(Bf, elbowB));
        const elbow = ik2(shoulder, target, lu, lf, pole, 0.015 * (lu + lf));
        const fd = norm(sub(target, elbow));
        const wrist = add(elbow, scale(fd, lf));
        const ud = norm(sub(elbow, shoulder));
        // ---- the forearm's own frame: the elbow's bend carried down it (faUp: where the thumb is at neutral)
        const bend = rej(fd, ud), bl = len(bend);
        const pdir = norm(scale(rej(pole, ud), -1));
        let elbowUp = bl > 1e-5 ? lerp3(pdir, scale(bend, 1 / bl), smoothstep(0.02, 0.2, bl)) : pdir;
        elbowUp = len(elbowUp) > 1e-4 ? norm(elbowUp) : pdir;
        const hax = cross(ud, fd), hal = len(hax);
        let faUp = hal > 1e-6 ? rotateAxis(elbowUp, scale(hax, 1 / hal), Math.atan2(hal, dot(ud, fd))) : elbowUp;
        faUp = norm(rej(faUp, fd));
        // ---- what's asked of the hand: its palm's way (against the forearm), or its own way with the palm about that (a
        // palm flat on the floor, the forearm upright over it: the palm's way taken against the hand)
        const palmW = frD(Bf, palmB);
        const dw = dirB ? Math.min(1, len(dirB)) : 0;
        const hd = dw > 1e-3 ? norm(frD(Bf, dirB)) : fd;
        let ask = rej(palmW, dw > 1e-3 ? norm(lerp3(fd, hd, dw)) : fd);
        // (a palm asked along the forearm says nothing of its turn: the turn it has is kept, wholly so as it lines up)
        const sure = smoothstep(0.08, 0.3, len(ask) / Math.max(len(palmW), 1e-6));
        ask = len(ask) > 1e-6 ? norm(ask) : scale(ch.x, -side);
        // the forearm's turn the palm asks for (pronation +): the thumb's place about the forearm from neutral
        const askThumb = norm(rej(scale(cross(ask, fd), side), fd));
        const ti = side > 0 ? 0 : 1;
        let p = side * Math.atan2(dot(cross(faUp, askThumb), fd), dot(faUp, askThumb));
        this.twAsk[ti] = p;
        // (asked round the back, past both ends — no forearm turns there: to the nearer end, the one it went out by held a
        // while, so a request wavering about the far side doesn't send the hand from one end to the other and back)
        if (p > PRO || p < -SUP) {
            const pastPro = p > PRO ? p - PRO : p + Math.PI * 2 - PRO, pastSup = p < -SUP ? -SUP - p : Math.PI * 2 - SUP - p;
            const end = this.twEnd[ti];
            const toPro = pastPro - (end > 0 ? TW_STICK : 0) < pastSup - (end < 0 ? TW_STICK : 0);
            this.twEnd[ti] = toPro ? 1 : -1;
            p = toPro ? PRO + pastPro : -SUP - pastSup;
        }
        else
            this.twEnd[ti] = 0;
        const want = softClamp(p, -SUP, PRO, TW_SOFT);
        // (turned at a forearm's pace: from one end to the other it goes through neutral, the way a forearm turns)
        const prev = this.tw[ti], step = TW_RATE * this.dt;
        const cur = this.first ? want : prev + clamp(lerp(0, want - prev, sure), -step, step);
        this.tw[ti] = cur;
        const thumb0 = rotateAxis(faUp, fd, side * cur), palm0 = scale(cross(fd, thumb0), side);
        // ---- the wrist's bend: toward the palm a little as the fingers curl (a hand at rest is a little back), or the hand's
        // own way; held to what a wrist does — flexion, extension, and a little either way sideways
        const want3 = dw > 1e-3 ? norm(lerp3(add(fd, scale(palm0, curl * 0.5 - 0.08)), hd, dw)) : add(fd, scale(palm0, curl * 0.5 - 0.08));
        let fl = Math.atan2(dot(want3, palm0), Math.max(dot(want3, fd), 1e-4)), dv = Math.atan2(dot(want3, thumb0), Math.max(dot(want3, fd), 1e-4));
        const fe = fl / (fl >= 0 ? FLEX : EXT), de = dv / (dv >= 0 ? RAD : ULN), e = Math.hypot(fe, de);
        if (e > 0.85) {
            const k = softClamp(e, 0, 1, 0.15) / e;
            fl *= k;
            dv *= k;
        }
        const hdir = norm(add(fd, add(scale(palm0, Math.tan(fl)), scale(thumb0, Math.tan(dv)))));
        const thumbT = norm(rej(thumb0, hdir)), palmT = scale(cross(hdir, thumbT), side);
        this.setBone(ua, shoulder, elbow, elbowUp);
        // (the forearm's skin takes half the turn, the hand all of it: the radius rolls over the ulna along its length)
        this.setBone(fa, elbow, wrist, rotateAxis(faUp, fd, 0.5 * side * cur));
        this.setBone(ha, wrist, add(wrist, scale(hdir, this.len[ha])), thumbT);
        const mid = add(wrist, scale(hdir, this.len[ha] * 0.45));
        if (side > 0) {
            this.J.handL = mid;
            this.J.palmL = palmT;
        }
        else {
            this.J.handR = mid;
            this.J.palmR = palmT;
        }
        const H = this.hands[ti];
        H.wrist = wrist;
        H.dir = hdir;
        H.thumb = thumbT;
        H.palm = palmT;
        this.rigFingers(side, curl);
    }
    /** a held cup's frame from its hand as posed: its axis through the palm's hollow (the cup's radius and the palm's
     *  flesh out from the hand's middle), along the thumb's side turned toward the asked up about the palm's normal, the
     *  hand round its lower half */
    gripFrame(g) {
        const H = this.hands[g.hand], L = this.len[this.bi[g.hand === 0 ? 'handL' : 'handR']];
        let up = H.thumb;
        if (g.up) {
            const want = rej(g.up, H.palm);
            if (len(want) > 1e-4)
                up = rotateAxis(up, H.palm, clamp(Math.atan2(dot(cross(up, want), H.palm), dot(up, norm(want))), -GRIP_TURN, GRIP_TURN));
        }
        const axis = add(add(H.wrist, scale(H.dir, L * GRIP_AT)), scale(H.palm, g.r * 0.9 + 0.014));
        return { at: sub(axis, scale(up, g.h * 0.4)), up, fwd: norm(rej(H.dir, up)) };
    }
    /** a cup standing on a palm (the left's, cradled in his lap): on its middle, upright as far as it would stay (PALM_TURN
     *  from the palm's normal toward `up`) */
    palmFrame(hand, want) {
        const H = this.hands[hand], L = this.len[this.bi[hand === 0 ? 'handL' : 'handR']];
        let up = H.palm;
        const ax = cross(up, norm(want)), s = len(ax);
        if (s > 1e-5)
            up = rotateAxis(up, scale(ax, 1 / s), Math.min(Math.atan2(s, dot(up, norm(want))), PALM_TURN));
        return { at: add(add(H.wrist, scale(H.dir, L * GRIP_AT)), scale(H.palm, 0.013)), up, fwd: norm(rej(H.dir, up)) };
    }
    /** the fingers relaxed (a cascade: the index curling least) or curled toward a fist, the thumb swinging in (hero/rig.ts
     *  rigFingers without the instruments' targets) */
    rigFingers(side, curl) {
        const t = side > 0 ? 'L' : 'R';
        const hb = this.bi['hand' + t];
        const Bn = this.B, H = Bn[hb];
        const d = norm(sub(H.tail, H.head));
        const tdir = norm(rej([0, 0, 1], d));
        const palm = scale(cross(d, tdir), side);
        const c = clamp(curl, -0.3, 1.2);
        const grip = clamp((curl - 0.6) / 0.4, 0, 1);
        const fi = this.bi['fingers' + t], ti = this.bi['tips' + t], th = this.bi['thumb' + t];
        const rot = (v, a) => {
            const vd = dot(v, d), vp = dot(v, palm), rest = sub(v, add(scale(d, vd), scale(palm, vp)));
            const co = Math.cos(a), sn = Math.sin(a);
            return add(rest, add(scale(d, vd * co - vp * sn), scale(palm, vd * sn + vp * co)));
        };
        if (fi !== undefined && ti !== undefined) {
            const a1 = 0.12 + c * 0.75 + grip * 1.05, a2 = 0.18 + c * 0.7 + grip * 0.9;
            const F = Bn[fi], Tb = Bn[ti];
            const k = F.head, m = add(k, rot(sub(F.tail, k), a1));
            const tip = add(m, rot(sub(Tb.tail, Tb.head), a1 + a2));
            const up = this.skinDir(hb, tdir);
            this.setBone(fi, this.skinPoint(hb, k), this.skinPoint(hb, m), up);
            this.setBone(ti, this.skinPoint(hb, m), this.skinPoint(hb, tip), up);
        }
        if (th !== undefined) {
            const Th = Bn[th];
            const tv = sub(Th.tail, Th.head);
            const ta = grip * 0.7 + Math.max(0, c) * 0.25;
            const tv2 = add(scale(tv, Math.cos(ta)), scale(palm, len(tv) * Math.sin(ta) * 0.8));
            this.setBone(th, this.skinPoint(hb, Th.head), this.skinPoint(hb, add(Th.head, tv2)), this.skinDir(hb, rej(tdir, norm(tv2))));
        }
        if (this.bi['index1' + t] === undefined)
            return;
        const FAN = [0.06, 0.02, -0.03, -0.08], CASCADE = [0, 0.04, 0.1, 0.16], REL = [-0.14, -0.02, 0.1, 0.2];
        const rc = Math.max(0, c) * (1 - grip);
        const names = ['index', 'middle', 'ring', 'pinky'];
        const fanAx = norm(cross(d, tdir));
        for (let f = 0; f < 4; f++) {
            const ids = [1, 2, 3].map((k) => this.bi[names[f] + k + t]);
            if (ids.some((x) => x === undefined))
                continue;
            const q = [Bn[ids[0]].head, Bn[ids[0]].tail, Bn[ids[1]].tail, Bn[ids[2]].tail];
            const ab = FAN[f] * (1 - grip) * (c < 0 ? 2.5 : 1);
            const ang = [c * 0.45 + grip * (1.25 + CASCADE[f]) + REL[f] * rc * 1.1, -0.05 + c * 0.33 + grip * (1.22 + CASCADE[f]) + REL[f] * rc,
                -0.12 + c * 0.1 + grip * 0.87 + REL[f] * rc * 0.4];
            const flexAx = norm(cross(rotateAxis(d, fanAx, ab), rotateAxis(palm, fanAx, ab)));
            let p = q[0], a = 0;
            for (let k = 0; k < 3; k++) {
                a += ang[k];
                const v = rotateAxis(rotateAxis(sub(q[k + 1], q[k]), fanAx, ab), flexAx, a);
                const n = add(p, v);
                const up = rotateAxis(rotateAxis(palm, fanAx, ab), flexAx, a);
                this.setBone(ids[k], this.skinPoint(hb, p), this.skinPoint(hb, n), this.skinDir(hb, up));
                p = n;
            }
        }
        const tid = [1, 2, 3].map((k) => this.bi['thumb' + k + t]);
        if (tid.some((x) => x === undefined))
            return;
        const tq = [Bn[tid[0]].head, Bn[tid[0]].tail, Bn[tid[1]].tail, Bn[tid[2]].tail];
        const t0 = norm(sub(tq[1], tq[0]));
        const oppAx = norm(cross(t0, palm));
        const inAx = norm(cross(t0, d));
        const tin = 0.52 * clamp((c + 0.1) / 0.5, 0, 1) * (1 - grip);
        const tang = [0.2 + grip * 0.63 + Math.max(0, c) * 0.25, 0.08 + grip * 0.49 + c * 0.2, 0.06 + grip * 0.44 + c * 0.16];
        let p = tq[0], a = 0;
        for (let k = 0; k < 3; k++) {
            a += tang[k];
            const v = rotateAxis(rotateAxis(sub(tq[k + 1], tq[k]), inAx, tin), oppAx, a);
            const n = add(p, v);
            this.setBone(tid[k], this.skinPoint(hb, p), this.skinPoint(hb, n), this.skinDir(hb, rotateAxis(rotateAxis(palm, inAx, tin), oppAx, a)));
            p = n;
        }
    }
    /** the drawn face's state (blinks, saccades, the gaze toward what he looks at, the expression) and the face's bones
     *  riding the head, the jaw opening */
    rigFace(dt, look, goal) {
        const head = this.bi.head;
        const E = this.asset.header.eye;
        const want = { smile: 0.5, jaw: 0, pucker: 0, frown: 0, brows: 0, tender: 0, browDown: 0, squint: 0, wide: 0, closed: goal.closed };
        for (const k of Object.keys(goal.expr))
            want[k] = goal.expr[k];
        // (the body's own face: the face model eases it and layers its mood, expressions, sip and speech over it)
        const hx = norm(this.skinDir(head, [1, 0, 0])), hu = norm(this.skinDir(head, [0, 1, 0])), hf = norm(this.skinDir(head, [0, 0, 1]));
        const mid = this.skinPoint(head, [0, E.y, E.z]);
        const to = look ? norm(sub(look, mid)) : hf;
        const S = this.face.update(dt, fromLegacy(want, this.fxBase), [dot(to, hx), dot(to, hu), dot(to, hf)]);
        toLegacy(S, this.fx);
        this.gaze = S.gaze;
        this.blink = S.blink;
        // the face's bones: with the head, the jaw (and the lower lip, half the mouth's corners) turned open about its hinge
        for (const name of FACE_BONES)
            this.follow(this.bi[name], head);
        // (the brows' bones with the face: each end up or down, drawn in and down knitting — Iroh's hair brows ride them)
        const sc = this.asset.header.height / 1.66;
        for (const [name, side, inner] of [['browInL', 1, true], ['browInR', -1, true], ['browOutL', 1, false], ['browOutR', -1, false]]) {
            const bi = this.bi[name];
            if (bi === undefined)
                continue;
            const v = inner ? (side > 0 ? S.browInL : S.browInR) : side > 0 ? S.browOutL : S.browOutR;
            const o = [-side * 0.0032 * S.knit * (inner ? 1 : 0.35) * sc, (0.0085 * v - 0.0026 * S.knit) * sc, 0.0009 * Math.abs(v) * sc];
            const b = this.B[bi];
            this.setBone(bi, this.skinPoint(head, add(b.head, o)), this.skinPoint(head, add(b.tail, o)), this.skinDir(head, b.up));
        }
        const ji = this.bi.jaw;
        if (ji === undefined)
            return;
        const hinge = this.B[ji].head;
        const ang = JAW_OPEN * Math.max(0, this.fx.jaw);
        const turn = (p, a) => { const dy = p[1] - hinge[1], dz = p[2] - hinge[2], c = Math.cos(a), s = Math.sin(a); return [p[0], hinge[1] + dy * c - dz * s, hinge[2] + dy * s + dz * c]; };
        const turnD = (d, a) => [d[0], d[1] * Math.cos(a) - d[2] * Math.sin(a), d[1] * Math.sin(a) + d[2] * Math.cos(a)];
        for (const [name, k] of [['jaw', 1], ['lipD', 1], ['lipDL', 1], ['lipDR', 1], ['mouthL', 0.5], ['mouthR', 0.5]]) {
            const bi = this.bi[name];
            if (bi === undefined)
                continue;
            const b = this.B[bi];
            this.setBone(bi, this.skinPoint(head, turn(b.head, ang * k)), this.skinPoint(head, turn(b.tail, ang * k)), this.skinDir(head, turnD(b.up, ang * k)));
        }
    }
    /** his legs as capsules for the sash's tails (per leg: thigh, shin; a, b, radius) */
    legs = new Float32Array(4 * 7);
    /** a point on a tail pushed out of his legs */
    /** a point of a chain out of his legs, out the side it was on a step before (`from`): through the middle it would
     *  come out the far side, a jump across the leg in a step */
    pushLegs = (p, from) => {
        const L = this.legs;
        for (let k = 0; k < L.length; k += 7) {
            const ax = L[k], ay = L[k + 1], az = L[k + 2], ex = L[k + 3] - ax, ey = L[k + 4] - ay, ez = L[k + 5] - az, r = L[k + 6];
            const u = clamp(((p[0] - ax) * ex + (p[1] - ay) * ey + (p[2] - az) * ez) / Math.max(ex * ex + ey * ey + ez * ez, 1e-9), 0, 1);
            const cx = ax + ex * u, cy = ay + ey * u, cz = az + ez * u;
            let dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz, l = Math.hypot(dx, dy, dz);
            if (l >= r)
                continue;
            const fx = from[0] - cx, fy = from[1] - cy, fz = from[2] - cz, fl = Math.hypot(fx, fy, fz);
            if (fx * dx + fy * dy + fz * dz < 0 && fl > 1e-6) {
                dx = fx;
                dy = fy;
                dz = fz;
                l = fl;
            }
            if (l > 1e-6) {
                const s = r / l;
                p[0] = cx + dx * s;
                p[1] = cy + dy * s;
                p[2] = cz + dz * s;
            }
        }
    };
    /** the sash's tails (another's skirt panels): hanging from the hips (garment.ts hang), swinging with him and the wind, kept off his legs */
    rigChains(dt, wind) {
        if (!this.chains.length)
            return;
        let n0 = 0;
        const leg = (a, b, r) => { const L = this.legs; L[n0] = a[0]; L[n0 + 1] = a[1]; L[n0 + 2] = a[2]; L[n0 + 3] = b[0]; L[n0 + 4] = b[1]; L[n0 + 5] = b[2]; L[n0 + 6] = r; n0 += 7; };
        for (const T of ['L', 'R']) {
            const shin = this.joint('shin' + T);
            leg(this.joint('thigh' + T), shin, 0.15);
            leg(shin, this.joint('foot' + T), 0.12);
        }
        const push = this.pushLegs;
        // (hair off the head, the neck and the back too, and a braid kept behind the back within the shoulders' width:
        // swung round as she turns to sit, it came to rest through her chest — hero/rig.ts's)
        const s = this.asset.header.height / 1.66, hi = this.bi.head;
        const neck = this.joint('neck'), chest = this.joint('chest'), pel = this.joint('pelvis');
        const cz = norm(this.skinDir(this.bi.chest, [0, 0, 1])), cx = norm(this.skinDir(this.bi.chest, [1, 0, 0]));
        const caps = [[add(neck, scale(cz, -0.01 * s)), add(chest, scale(cz, -0.01 * s)), 0.1 * s], [chest, pel, 0.12 * s]];
        const pushHair = (braid) => (p, from) => {
            push(p, from);
            for (const [a, b, r] of caps) {
                const ab = sub(b, a), u = clamp(dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-9), 0, 1), q = add(a, scale(ab, u));
                const d = sub(p, q), l = len(d);
                if (l < r && l > 1e-6) {
                    const k = r / l;
                    p[0] = q[0] + d[0] * k;
                    p[1] = q[1] + d[1] * k;
                    p[2] = q[2] + d[2] * k;
                }
            }
            if (!braid)
                return;
            const d = sub(p, chest), fz = dot(d, cz) + 0.04 * s;
            if (fz > 0 && Math.abs(dot(d, cx)) < 0.2 * s && d[1] < 0.12 * s && d[1] > -0.5 * s) {
                p[0] -= cz[0] * fz;
                p[1] -= cz[1] * fz;
                p[2] -= cz[2] * fz;
            }
        };
        const floor = this.J.footL[1] - 0.08;
        const H = 1 / 120;
        this.chainAcc = Math.min(this.chainAcc + dt, 0.1);
        const n = Math.floor(this.chainAcc / H + 1e-6);
        this.chainAcc -= n * H;
        const f = this.chainAcc / H;
        for (const c of this.chains) {
            const bz = this.skinDir(c.frame, [0, 0, 1]);
            const tg = c.head ? c.bind.map((p) => this.skinPoint(hi, p)) : c.bind.map((p) => hang(this.asset, this.bones, p));
            const push = c.head ? pushHair(/braid/.test(c.name)) : this.pushLegs;
            // (re-seated: hanging at rest this frame, swinging from the next)
            const fresh = this.first || !c.prev;
            // (tipped hips: held to the rest shape along the legs, garment.ts HOLD)
            const pull = c.pull.map((p, i) => 1 - Math.pow(1 - (i === 0 ? p : Math.max(p, HOLD * this.hangK)), H * 60));
            if (fresh) {
                // (and let settle round his legs, without swinging)
                c.ch.reset(tg);
                for (let k = 0; k < 10; k++) {
                    c.ch.step(H, tg, pull, [0, 0, 0], push, floor);
                    c.ch.still();
                }
                c.prev = c.ch.p.map((q) => [...q]);
            }
            const prev = c.prev;
            for (let k = 0; k < (fresh ? 0 : n); k++) {
                for (let i = 0; i < prev.length; i++)
                    prev[i] = [...c.ch.p[i]];
                c.ch.step(H, tg, pull, wind, push, floor);
            }
            const P = c.ch.p.map((q, i) => lerp3(prev[i], q, f));
            for (let i = 0; i < P.length - 1; i++) {
                const r = norm(sub(tg[i + 1], tg[i])), z = norm(sub(P[i + 1], P[i]));
                let upv = norm(rej(bz, r));
                const ax = cross(r, z), sa = len(ax);
                if (sa > 1e-6)
                    upv = rotateAxis(upv, scale(ax, 1 / sa), Math.atan2(sa, dot(r, z)));
                this.setBone(c.b0 + i, P[i], P[i + 1], carryUp(c.roll, i, z, upv, fresh, dt));
            }
        }
    }
}
/** (the AangRig by what it is: any body posed from a Pose) */
export { AangRig as PoseRig };
//# sourceMappingURL=pose.js.map