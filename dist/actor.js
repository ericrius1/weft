// One of a cast on a stage (Drake's, Gong Bong's): a mesh, its rig, where it stands and faces, its hands' goals eased in
// and out (exact where a thing is held in them), and the hands' frames as posed (where a held thing goes). Whoever
// directs them says what each is doing every frame; this poses it. The mesh is the project's (its renderer's): all
// this needs of it is its asset and a way to send it the pose (ActorMesh).
import { HeroRig } from './rig.js';
import { add, sub, scale, norm, cross, dot, len, lerp, lerp3, damp, rej } from './math.js';
const IDLE = { mode: 'idle', target: [0, 0, 0], intensity: 0, t: 0 };
const flat = (x, z) => { void x; void z; return 0; };
/** a point in a body's frame (x its left, y up, z forward; metres at its own scale) */
export const P = (B, x, y, z) => [B.pos[0] + (B.left[0] * x + B.fwd[0] * z) * B.s, B.pos[1] + y * B.s, B.pos[2] + (B.left[2] * x + B.fwd[2] * z) * B.s];
/** a direction in a body's frame */
export const D = (B, x, y, z) => norm([B.left[0] * x + B.fwd[0] * z, y, B.left[2] * x + B.fwd[2] * z]);
/** the rig's yaw facing a way (its forward is (-sin yaw, 0, -cos yaw)) */
export const yawOf = (d) => Math.atan2(-d[0], -d[2]);
export const fwdOf = (yaw) => [-Math.sin(yaw), 0, -Math.cos(yaw)];
export const leftOf = (yaw) => [-Math.cos(yaw), 0, Math.sin(yaw)];
export class Actor {
    mesh;
    rig;
    pos;
    yaw;
    vel = [0, 0, 0];
    t = 0;
    held = [null, null];
    heldW = [0, 0];
    stoopV = 0;
    /** each hand bone's bind frame's thumb way (its y), for its posed frame */
    handBind = [];
    constructor(mesh, pos, yaw) {
        this.mesh = mesh;
        this.rig = new HeroRig(mesh.asset);
        this.pos = [...pos];
        this.yaw = yaw;
        const a = mesh.asset;
        for (const T of ['L', 'R']) {
            const bi = a.index['hand' + T], b = a.bones[bi];
            const z = norm(sub(b.tail, b.head));
            let x = cross(b.up, z);
            if (len(x) < 1e-5)
                x = cross([1, 0, 0], z);
            x = norm(x);
            const mb = a.index['middle1' + T];
            const kl = mb === undefined ? len(sub(b.tail, b.head)) * 0.5 : Math.max(0.02, dot(sub(a.bones[mb].head, b.head), z));
            this.handBind.push({ bi, y: cross(z, x), kl, hl: len(sub(b.tail, b.head)) });
        }
    }
    get s() { return this.rig.s; }
    moodNow = null;
    moodK = -1;
    /** the face's mood, set only when it changes (face.mood restarts its fade each time it's called) */
    mood(e, k = 1, fade) {
        if (e === this.moodNow && Math.abs(k - this.moodK) < 0.02)
            return;
        this.moodNow = e;
        this.moodK = k;
        this.rig.face.mood(e, { k, fade });
    }
    body() { return { pos: this.pos, fwd: fwdOf(this.yaw), left: leftOf(this.yaw), s: this.rig.s }; }
    /** a hand's goal round a handle: its middle G, its way A (out past the thumb, toward what's at its end), the fingers
     *  about along F, the handle tilted toward the fingertips by `tilt` (rad); the fist closed by `grip` */
    fistGoal(side, G, A, F, o = {}) {
        const hb = this.handBind[side > 0 ? 0 : 1];
        const a = o.tilt ?? 0.25;
        const Y0 = norm(A);
        let Z0 = rej(F, Y0);
        if (len(Z0) < 1e-4)
            Z0 = rej([0, -1, 0], Y0);
        Z0 = norm(Z0);
        const ca = Math.cos(a), sa = Math.sin(a);
        const Y = norm(sub(scale(Y0, ca), scale(Z0, sa))), Z = norm(add(scale(Z0, ca), scale(Y0, sa)));
        const N = side > 0 ? cross(Z, Y) : cross(Y, Z);
        const W = sub(sub(G, scale(Z, hb.kl * FIST_IN)), scale(N, o.out ?? FIST_OUT));
        return { palm: add(W, scale(Z, hb.hl * 0.55)), fwd: Z, down: N, tips: [null, null, null, null, null], curl: o.curl ?? 0.8, grip: o.grip ?? 1, exact: o.exact ?? true };
    }
    /** a hand as posed now (after the rig's update): its frame, and the handle's middle and way through its fist */
    fist(side, tilt = 0.25, out = FIST_OUT) {
        const hb = this.handBind[side > 0 ? 0 : 1], r = this.rig;
        const a = r.asset.bones[hb.bi];
        const W = r.skinPoint(hb.bi, a.head);
        const Z = norm(sub(r.skinPoint(hb.bi, a.tail), W));
        const Y = norm(rej(r.skinDir(hb.bi, hb.y), Z));
        const N = side > 0 ? cross(Z, Y) : cross(Y, Z);
        const ca = Math.cos(tilt), sa = Math.sin(tilt);
        const A = norm(add(scale(Y, ca), scale(Z, sa)));
        const G = add(add(W, scale(Z, hb.kl * FIST_IN)), scale(N, out));
        return { W, Z, Y, N, G, A };
    }
    /** this frame: the hands' goals (null: hanging free), the stoop (and how much of it's in the knees), where it looks,
     *  its dance; posed, then sent to its mesh */
    pose(dt, hands, stoop, bend, look, groove, stoopRate = 3) {
        this.t += dt;
        for (const i of [0, 1]) {
            const g = hands[i].goal, h = this.held[i], rate = hands[i].rate ?? 7;
            const k = 1 - Math.exp(-dt * rate);
            if (g)
                this.held[i] = !h || this.heldW[i] <= 0.02 || rate === Infinity ? g
                    : { ...g, palm: lerp3(h.palm, g.palm, k), fwd: norm(lerp3(h.fwd, g.fwd, k)), down: norm(lerp3(h.down, g.down, k)), curl: lerp(h.curl ?? 0.45, g.curl ?? 0.45, k), grip: lerp(h.grip ?? 0, g.grip ?? 0, k) };
            this.heldW[i] = rate === Infinity && g ? 1 : damp(this.heldW[i], g ? 1 : 0, g ? 5 : 3.5, dt);
        }
        this.stoopV = damp(this.stoopV, stoop, stoopRate, dt);
        const hold = { hands: [this.heldW[0] > 0.01 ? this.held[0] : null, this.heldW[1] > 0.01 ? this.held[1] : null], w: [this.heldW[0], this.heldW[1]], stoop: this.stoopV, bend };
        const sp = Math.hypot(this.vel[0], this.vel[2]);
        this.rig.update({
            dt, time: this.t, pos: this.pos, yaw: this.yaw, vel: this.vel, speed: sp, running: false, onGround: true, wade: 0, landImpact: 0,
            pose: IDLE, look, wind: [0.4, 0, 0.2], ground: flat, hold, groove,
        });
    }
    /** the mesh's uniforms and bones from the pose */
    send() { this.mesh.update(this.rig, this.rig.jawOpen); }
}
/** the handle's middle in the fist: this far along the hand from the wrist (a share of the way to the knuckles) and
 *  out from the palm (m) */
const FIST_IN = 0.92, FIST_OUT = 0.026;
/** a vector turned about a unit axis by a (Rodrigues) */
export function rot(v, k, a) {
    const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v) * (1 - c);
    return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}
//# sourceMappingURL=actor.js.map