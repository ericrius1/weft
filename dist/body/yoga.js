// Yoga's poses as goals, not angles: where the feet and hands meet the mat and how (flat, on the ball, the foot's top,
// a knee down, a palm bearing weight), where the hands go in the air (in the chest's frame: overhead, at the heart, out
// to the sides), where the eyes go, and the little a teacher would add (hips square, legs straight, the spine long).
// The body solver (body/solve.ts) finds each body's own way into each: a supple body folds deep with straight knees, a
// stiff one bends its knees and keeps its heels up — its joints, its reach, its balance decide, not a table of angles.
//
// From the references (docs/body/references.md): the sun salutation's sequence (mountain, upward salute, standing fold,
// halfway lift, plank, chaturanga, upward dog, down dog, child's pose, low lunge), warrior I and II, tree. The mat's
// frame: x the body's left, y up, z toward the mat's front; its origin on the mat between the feet in mountain.
import { add, scale, norm, sub } from '../math.js';
export const YOGA_POSES = ['mountain', 'prayer', 'salute', 'fold', 'half', 'plank', 'chaturanga', 'updog', 'dog', 'child', 'lungeR', 'warrior1R', 'warrior2R', 'treeL', 'squat'];
const D = Math.PI / 180;
/** a mat's frame: a point and a direction from the mat's coordinates */
function matFrame(m) {
    const fwd = [-Math.sin(m.yaw), 0, -Math.cos(m.yaw)], left = [-Math.cos(m.yaw), 0, Math.sin(m.yaw)];
    const P = (x, y, z) => add(m.at, add(scale(left, x), add([0, y, 0], scale(fwd, z))));
    const Dd = (x, y, z) => norm(add(scale(left, x), add([0, y, 0], scale(fwd, z))));
    return { P, D: Dd, fwd, left };
}
/** a hand flat on the mat (palm down, fingers forward and a little out), bearing weight */
function flatHand(F, side, x, z, s, out, flex) {
    // (a stiffer body's hands turn out a little more: less of the forearm's turn to lay them flat)
    out += Math.max(0, 1 - flex) * 0.8;
    const fw = F.D(side * Math.sin(out), 0, Math.cos(out));
    const goal = { palm: F.P(x, 0.016 * s, z), fwd: fw, down: [0, -1, 0], tips: [null, null, null, null, null], curl: 0, loose: true };
    return { goal, bear: true };
}
/** a hand in the chest's frame (x its left, y up, z forward, from the chest's base): where the palm is, the way the
 *  fingers point, the way the palm faces */
function relHand(palm, fwd, down, curl = 0.12) {
    return { goal: { palm, fwd: norm(fwd), down: norm(down), tips: [null, null, null, null, null], curl, loose: true }, rel: true };
}
const foot = (F, kind, x, z, yaw, extra = {}) => ({ kind, at: F.P(x, 0, z), yaw, ...extra });
/** a pose's goal for a body on a mat (stiff: 0 supple .. 1 an old man's: what it asks less of) */
export function yogaGoal(M, mat, pose, flex = 1) {
    const F = matFrame(mat), s = M.s, y0 = mat.yaw;
    const hipX = Math.abs(M.P.hipL[0]), shX = Math.abs(M.P.shoulderL[0]);
    const leg = M.L.thigh + M.L.shin, arm = M.L.uarm + M.L.farm;
    // (the chest's frame from its base: the shoulders' height and the heart's)
    const shY = M.P.shoulderL[1] - M.P.chestBase[1], heartY = shY - 0.09 * s;
    const flat = (side, x, z, out = 0.18) => flatHand(F, side, x, z, s, out, flex);
    const G = { at: mat.at, yaw: y0, feet: [null, null], hands: [null, null], flex, look: F.P(0, 1.5 * s, 6), balance: 1 };
    const standing = (w = hipX * 1.05) => { G.feet = [foot(F, 'flat', w, 0, y0 + 0.06), foot(F, 'flat', -w, 0, y0 - 0.06)]; };
    // (overhead: the shoulders shrug up with the arms, the arms straight, the palms a hand's middle past the wrists)
    const upY = shY + 0.07 * s + arm * 0.99 + M.L.hand * 0.55;
    const overhead = () => { G.hands = [relHand([0.1 * s, upY, 0.03 * s], [0, 1, 0.05], [-1, 0, 0.1]), relHand([-0.1 * s, upY, 0.03 * s], [0, 1, 0.05], [1, 0, 0.1])]; };
    const prayer = () => { G.hands = [relHand([0.014 * s, heartY, 0.2 * s], [0, 0.85, 0.35], [-1, 0, 0], 0.05), relHand([-0.014 * s, heartY, 0.2 * s], [0, 0.85, 0.35], [1, 0, 0], 0.05)]; };
    switch (pose) {
        case 'mountain':
            standing();
            G.spine = { flex: 0, w: 0.5 };
            G.legs = { knee: [0.03, 0.03], w: 0.5 };
            G.neckLong = 0.5;
            break;
        case 'prayer':
            standing();
            prayer();
            G.spine = { flex: 0, w: 0.5 };
            G.legs = { knee: [0.03, 0.03], w: 0.5 };
            G.neckLong = 0.5;
            break;
        case 'salute':
            // arms up overhead, palms facing, the chest lifting into a small backbend, the gaze up to the thumbs
            standing();
            overhead();
            G.spine = { flex: -0.18, w: 1 };
            G.legs = { knee: [0.03, 0.03], w: 0.5 };
            G.look = F.P(0, 3.2 * s, 1.2 * s);
            break;
        case 'fold':
            // a hinge at the hips, the spine let go toward the legs, the palms to the mat beside the feet (as far as they go)
            standing();
            G.hands = [flat(1, shX * 1.2, 0.2 * s, 0.05), flat(-1, -shX * 1.2, 0.2 * s, 0.05)];
            G.hands.forEach((h) => { if (h) {
                h.bear = false;
                h.w = 0.5;
            } });
            G.legs = { knee: [0.05, 0.05], w: 0.6 };
            G.spine = { flex: 0.6, w: 0.3 };
            G.look = F.P(0, 0, -0.4 * s);
            G.nod = 0.3;
            break;
        case 'half':
            // halfway lift: the spine long and level, the hands on the shins, the gaze ahead on the mat
            // (the palms on the shins, fingers down)
            standing();
            const shin = (sd) => ({ goal: { palm: F.P(sd * hipX * 1.15, M.P.ankleL[1] + M.L.shin * 0.45, 0.065 * s), fwd: F.D(0, -1, 0.15), down: F.D(0, 0, -1), tips: [null, null, null, null, null], curl: 0.25, loose: true }, w: 0.7 });
            G.hands = [shin(1), shin(-1)];
            G.spine = { flex: -0.05, w: 2 };
            G.pelvis = { pitch: 1.15, rw: 1.5 };
            G.legs = { knee: [0.08, 0.08], w: 0.5 };
            G.look = F.P(0, 0, 0.9 * s);
            break;
        case 'plank':
        case 'chaturanga': {
            // the hands under the shoulders, the body one line from the heels to the crown, on the balls of the feet;
            // chaturanga: lowered on bent elbows, the shoulders down to the elbows' height
            const z = pose === 'plank' ? 0 : -0.12 * s;
            G.hands = [flat(1, shX * 1.05, z), flat(-1, -shX * 1.05, z)];
            if (pose === 'plank')
                G.hands.forEach((h) => { if (h)
                    h.straight = 1; });
            const back = -(M.P.shoulderL[1] - M.P.ankleL[1]) * 0.98;
            G.feet = [foot(F, 'ball', hipX * 0.9, back, y0), foot(F, 'ball', -hipX * 0.9, back, y0)];
            G.spine = { flex: 0, side: 0, turn: 0, w: 3 };
            G.legs = { hip: [0, 0], knee: [0, 0], w: 2 };
            G.pelvis = { roll: 0, yaw: 0, rw: 2, at: F.P(0, pose === 'plank' ? 0.42 * s : 0.26 * s, back * 0.5), w: 0.15, pitch: 1.3 };
            if (pose === 'chaturanga')
                G.pelvis.height = 0.24 * s, G.pelvis.hw = 3;
            G.look = F.P(0, 0, 0.5 * s);
            G.balance = 0.5;
            break;
        }
        case 'updog': {
            // the hips lowered to just over the mat, the chest drawn forward and up through straight arms, the legs long with
            // the tops of the feet pressing down
            G.hands = [flat(1, shX * 1.05, 0.02 * s), flat(-1, -shX * 1.05, 0.02 * s)];
            G.hands.forEach((h) => { if (h)
                h.straight = 2; });
            const back = -(leg + 0.42 * s) * 1.0;
            G.feet = [foot(F, 'top', hipX * 0.9, back, y0 + Math.PI), foot(F, 'top', -hipX * 0.9, back, y0 + Math.PI)];
            G.spine = { flex: -0.75, w: 1.5 };
            G.legs = { knee: [0, 0], w: 2 };
            G.pelvis = { height: 0.2 * s, hw: 2, roll: 0, yaw: 0, rw: 2, at: F.P(0, 0.2 * s, back * 0.55), w: 0.15, pitch: 1.2 };
            G.look = F.P(0, 1.4 * s, 2.5 * s);
            G.balance = 0.5;
            break;
        }
        case 'dog': {
            // an inverted V: the hands pressing forward, the hips high and back, the spine long, the heels toward the mat
            G.hands = [flat(1, shX * 1.1, 0), flat(-1, -shX * 1.1, 0)];
            G.hands.forEach((h) => { if (h)
                h.straight = 1.5; });
            const back = -(arm + leg) * 1.02;
            // (on the balls, the heels as far down as the ankles let them)
            G.feet = [foot(F, 'ball', hipX * 0.95, back + M.FH, y0), foot(F, 'ball', -hipX * 0.95, back + M.FH, y0)];
            G.spine = { flex: -0.05, side: 0, turn: 0, w: 2 };
            G.legs = { knee: [0.02, 0.02], w: 1.5 };
            G.pelvis = { height: leg * 1.12, hw: 2, roll: 0, yaw: 0, rw: 2, at: F.P(0, leg * 1.0, back * 0.55), w: 0.15, pitch: 2.0 };
            G.look = F.P(0, 0, back * 0.6);
            G.balance = 0.5;
            break;
        }
        case 'child': {
            // kneeling, sat back on the heels, the chest down on the thighs, the arms long in front, the forehead to the mat
            const kz = 0;
            G.feet = [foot(F, 'top', hipX * 0.85, kz - 0.5 * s, y0 + Math.PI, { knee: F.P(hipX * 1.1, 0, kz) }), foot(F, 'top', -hipX * 0.85, kz - 0.5 * s, y0 + Math.PI, { knee: F.P(-hipX * 1.1, 0, kz) })];
            G.hands = [flat(1, shX * 1.0, 0.62 * s, 0.05), flat(-1, -shX * 1.0, 0.62 * s, 0.05)];
            G.hands.forEach((h) => { if (h)
                h.w = 0.6; });
            G.pelvis = { height: 0.2 * s, hw: 2, roll: 0, yaw: 0, rw: 1, at: F.P(0, 0.2 * s, -0.38 * s), w: 0.15, pitch: 1.0 };
            G.spine = { flex: 0.75, w: 1 };
            G.look = F.P(0, 0, 0.5 * s);
            G.nod = 0.4;
            G.balance = 0.3;
            break;
        }
        case 'lungeR':
        case 'lungeL': {
            // low lunge: the front foot between the hands, its knee over its ankle, the back knee down with the foot's top on
            // the mat, the hips sinking forward, the chest up
            const sd = pose === 'lungeR' ? -1 : 1;
            const zf = 0.42 * s, zb = -0.24 * s;
            G.feet = [null, null];
            G.feet[sd > 0 ? 0 : 1] = foot(F, 'flat', sd * hipX * 1.1, zf, y0);
            G.feet[sd > 0 ? 1 : 0] = foot(F, 'top', -sd * hipX * 1.1, zb - 0.5 * s, y0 + Math.PI, { knee: F.P(-sd * hipX * 1.1, 0, zb) });
            // (the hands framing the front foot)
            const fx = sd * hipX * 1.1;
            G.hands = [flat(1, fx + 0.18 * s, zf - 0.02 * s), flat(-1, fx - 0.18 * s, zf - 0.02 * s)];
            G.hands.forEach((h) => { if (h)
                h.w = 0.7; });
            G.spine = { flex: 0.05, side: 0, turn: 0, w: 2.5 };
            G.pelvis = { roll: 0, yaw: 0, rw: 1.5, at: F.P(0, 0.3 * s, 0), w: 0.15, pitch: 0.2, height: 0.26 * s, hw: 1.5 };
            G.look = F.P(0, 0.4 * s, 2);
            G.balance = 0.6;
            break;
        }
        case 'warrior1R': {
            // the right foot forward, its knee bent over the ankle; the left back, turned out 45°, its leg straight; the hips
            // squared to the front; the arms up overhead
            const st = 1 - 1.2 * Math.max(0, 1 - flex);
            G.feet = [foot(F, 'flat', hipX * 1.45, -0.62 * s * st, y0 + 35 * D), foot(F, 'flat', -hipX * 1.2, 0.42 * s * st, y0)];
            overhead();
            G.spine = { flex: -0.12, w: 1 };
            G.pelvis = { yaw: 0.12 * (1 - Math.min(1, flex)), roll: 0, rw: 1.5, height: leg * (0.72 + 0.1 * (1 - st)), hw: 1.5 };
            G.legs = { knee: [0.02, 1.35], w: 1 };
            G.look = F.P(0, 2.2 * s, 3);
            break;
        }
        case 'warrior2R': {
            // the legs wide along the mat (the body facing its long side): the right foot pointing along it, its knee bent
            // over the ankle; the left foot turned in a little, its leg straight; the arms out level over the legs; the gaze
            // over the right hand
            const w = 0.29 * s;
            G.feet = [foot(F, 'flat', w, 0, y0 - 20 * D), foot(F, 'flat', -w, 0, y0 - Math.PI / 2)];
            G.hands = [relHand([0.75 * s, shY - 0.01 * s, 0.0], [1, 0, 0], [0, -1, 0], 0.08), relHand([-0.75 * s, shY - 0.01 * s, 0.0], [-1, 0, 0], [0, -1, 0], 0.08)];
            G.spine = { flex: 0, side: 0, turn: 0, w: 1.5 };
            G.pelvis = { yaw: 0, roll: 0, pitch: 0, rw: 1.2, height: leg * 0.78, hw: 1.5 };
            G.legs = { knee: [0.02, 1.35], w: 1 };
            G.look = F.P(-4, 1.4 * s, 0);
            break;
        }
        case 'treeL':
        case 'treeR': {
            // standing on one leg, the other's sole pressed to its inner thigh, that knee open to the side; the hands at the
            // heart; the body's weight over the standing foot
            const sd = pose === 'treeL' ? 1 : -1;
            const stand = foot(F, 'flat', sd * 0.02 * s, 0, y0 + sd * 0.05);
            const thighIn = F.P(sd * 0.035 * s, M.P.hipL[1] * 0.58, 0.04 * s);
            const lifted = foot(F, 'free', thighIn[0], thighIn[1], 0, { at: thighIn, kneeDir: F.D(-sd * 0.85, -0.1, 0.5), point: 0.35, yaw: y0 - sd * 1.2 });
            G.feet = sd > 0 ? [stand, lifted] : [lifted, stand];
            prayer();
            G.spine = { flex: 0, side: 0, w: 1 };
            G.pelvis = { roll: 0, rw: 1 };
            G.legs = { knee: sd > 0 ? [0.03, null] : [null, 0.03], w: 1 };
            G.balance = 1;
            break;
        }
        case 'squat': {
            // a deep squat (garland): the feet wide and turned out, the heels down if they'll go, the hips low between them,
            // the elbows inside the knees, the palms together
            G.feet = [foot(F, 'ball', hipX * 1.9, 0.06 * s, y0 + 0.4), foot(F, 'ball', -hipX * 1.9, 0.06 * s, y0 - 0.4)];
            prayer();
            G.pelvis = { height: 0.3 * s, hw: 1.5 };
            G.spine = { flex: 0.2, w: 0.5 };
            G.legs = { knee: [2.3, 2.3], w: 0.5 };
            G.balance = 1;
            break;
        }
    }
    void sub;
    return G;
}
//# sourceMappingURL=yoga.js.map