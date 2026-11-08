import { Camera, lookAt, RunAction } from '@ericrius1/weft';
import probeShader from '../shaders/probes.wgsl';
const FACES = [[[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, 1]], [[0, -1, 0], [0, 0, -1]], [[0, 0, 1], [0, 1, 0]], [[0, 0, -1], [0, 1, 0]]];
const MAX_SLOTS = 8;
export class ProbeGrid {
    kit;
    /** on (off: the sky's ambient everywhere, nothing captured); strength (the probes' light ×); perFrame (probes
     *  captured a frame); blend (a recapture's share of what the probe ends up holding: lower is steadier, slower to
     *  follow the light); normalBias / viewBias (how far a surface's read is pushed off it, along its normal and toward
     *  the eye, in spacings: against light leaking through walls); edge (spacings over which the volume fades to the
     *  sky's light); inside (the share of a probe's view right up against it past which it isn't trusted); refresh
     *  (keep recapturing once every probe has been) */
    params = { on: true, strength: 1, perFrame: 2, blend: 0.5, normalBias: 0.35, viewBias: 0.15, edge: 1, inside: 0.35, refresh: true };
    /** probes along x, y, z */
    n = [1, 1, 1];
    min = [0, 0, 0];
    spacing = 1;
    /** the probes' records (64 bytes each: red's, green's, blue's coefficients, validity), copied by the Renderer into
     *  the point lights' buffer after the lights and the light grid (env.wgsl giProbe) */
    probes;
    /** the run items (before the opaque scene: the frame's surfaces read what it captured) */
    items;
    /** probes captured since the volume was last set or invalidated, and in all */
    captured = 0;
    total = 0;
    capColor;
    capDepth;
    u;
    project;
    faces = [];
    slotsUsed = 0;
    slotProbe = [];
    stamp = new Float64Array(0);
    valid = new Uint8Array(0);
    lift = new Float32Array(0);
    frame = 0;
    cam = [0, 0, 0];
    F;
    maxSlots;
    ground;
    constructor(kit, opts) {
        this.kit = kit;
        const k = kit;
        this.F = Math.max(8, Math.round(opts.face ?? 24));
        this.maxSlots = Math.max(1, Math.min(MAX_SLOTS, opts.maxPerFrame ?? 2));
        this.ground = opts.ground;
        const F = this.F, L = this.maxSlots * 6;
        const sk = opts.skip;
        const skip = sk ? (d) => !(typeof sk === 'function' ? sk(d.label) : sk.test(d.label)) : undefined;
        this.capColor = k.texture({ label: 'gi.capture', format: 'rgba16float', size: [F, F, L], usage: ['render', 'sample'] });
        this.capDepth = k.texture({ label: 'gi.captureDepth', format: 'depth32float', size: [F, F, L], usage: ['render', 'sample'] });
        this.probes = k.storage({ label: 'gi.probes', size: 64 });
        this.u = k.uniforms(probeShader.structs.Probes, 'gi');
        for (let s = 0; s < this.maxSlots; s++) {
            const row = [];
            for (let f = 0; f < 6; f++) {
                const cam = new Camera();
                cam.fovY = Math.PI / 2;
                cam.near = 0.05;
                cam.far = Infinity;
                const view = k.view(cam, [F, F], `gi.s${s}f${f}`);
                view.user = [0, 1, 0, 0];
                const slot = s;
                const pass = k.pass({
                    label: `gi.capture.s${s}f${f}`, view, replay: opts.source, replayFilter: skip, enabled: () => this.params.on && slot < this.slotsUsed,
                    color: [{ target: this.capColor.layer(s * 6 + f), clear: [0, 0, 0, 1] }], depth: { target: this.capDepth.layer(s * 6 + f), clear: 0 },
                });
                row.push({ pass, cam, view });
            }
            this.faces.push(row);
        }
        // each face's basis as the capture's camera has it (whatever lookAt's handedness)
        const fwd = [], right = [], up = [];
        for (let f = 0; f < 6; f++) {
            const c = new Camera();
            c.fovY = Math.PI / 2;
            c.viewOverride = lookAt([0, 0, 0], FACES[f][0], FACES[f][1]);
            c.update(F, F);
            fwd.push([...c.forward, 0]);
            right.push([...c.right, 0]);
            up.push([...c.up, 0]);
        }
        this.u.set({ fwd, right, up });
        this.project = k.compute(probeShader, {
            label: 'gi.project', entry: 'project', enabled: () => this.params.on && this.slotsUsed > 0, workgroups: () => [this.slotsUsed],
            bind: { PB: this.u, capColor: this.capColor, capDepth: this.capDepth, probes: this.probes },
        });
        this.items = [new RunAction(() => this.schedule(), 'gi.schedule'), ...this.faces.flat().map((f) => f.pass), this.project];
        this.setVolume(opts.min, opts.max, opts.spacing);
    }
    /** (re)place the volume: least and greatest corners, spacing (m). Its probes start over (the sky's light meanwhile) */
    setVolume(min, max, spacing) {
        this.spacing = Math.max(0.05, spacing);
        const n = [0, 1, 2].map((a) => Math.max(2, Math.min(a === 0 ? 256 : 128, Math.round((max[a] - min[a]) / this.spacing) + 1)));
        this.min = [...min];
        this.n = n;
        const count = n[0] * n[1] * n[2];
        // (a bigger volume: a bigger buffer, and the Renderer lays the point lights' buffer out again)
        this.probes.ensure(count * 64);
        this.onResize?.(count);
        this.stamp = new Float64Array(count).fill(-1);
        this.valid = new Uint8Array(count).fill(1);
        this.lift = new Float32Array(count);
        if (this.ground) {
            for (let i = 0; i < count; i++) {
                const p = this.probePos(i, false), g = this.ground(p[0], p[2]) + 0.25 * this.spacing;
                if (p[1] < g) {
                    if (g - p[1] > 0.5 * this.spacing)
                        this.valid[i] = 0;
                    else
                        this.lift[i] = g - p[1];
                }
            }
        }
        this.invalidate();
    }
    /** forget every probe's light (a different scene, a big change of light): each is captured again */
    invalidate() {
        this.stamp.fill(-1);
        this.captured = 0;
        // (the records cleared: nothing trusted until captured again)
        this.probes.write(new Uint8Array(this.count * 64));
    }
    /** probes in the volume */
    get count() { return this.n[0] * this.n[1] * this.n[2]; }
    /** told when the volume's size changes (the Renderer lays the point lights' buffer out again) */
    onResize = null;
    /** the camera's position (probes nearer it come first) */
    follow(cam) { this.cam = cam; }
    probePos(i, lifted = true) {
        const N = this.n, s = this.spacing;
        const x = i % N[0], y = Math.floor(i / N[0]) % N[1], z = Math.floor(i / (N[0] * N[1]));
        return [this.min[0] + x * s, this.min[1] + y * s + (lifted ? this.lift[i] : 0), this.min[2] + z * s];
    }
    // (each frame: the probes to capture — the never-captured nearest the camera first, then the stalest by their
    // distance — and their six cameras)
    schedule() {
        this.frame++;
        this.slotsUsed = 0;
        if (!this.params.on)
            return;
        const want = Math.max(0, Math.min(this.maxSlots, Math.round(this.params.perFrame)));
        if (!want)
            return;
        const count = this.stamp.length, c = this.cam, best = [], score = [];
        const all = this.captured >= this.total && this.total > 0;
        if (all && !this.params.refresh)
            return;
        for (let i = 0; i < count; i++) {
            if (!this.valid[i])
                continue;
            const p = this.probePos(i);
            const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
            const st = this.stamp[i];
            // (never captured: ahead of everything, nearest first; else age over distance)
            const sc = st < 0 ? 1e12 - d : (this.frame - st) / (1 + d / (8 * this.spacing));
            if (st >= 0 && this.frame - st < 2)
                continue;
            if (best.length < want) {
                best.push(i);
                score.push(sc);
                continue;
            }
            let lo = 0;
            for (let k = 1; k < score.length; k++)
                if (score[k] < score[lo])
                    lo = k;
            if (sc > score[lo]) {
                best[lo] = i;
                score[lo] = sc;
            }
        }
        const slots = [];
        for (let s = 0; s < best.length; s++) {
            const i = best[s], p = this.probePos(i), N = this.n;
            if (this.stamp[i] < 0)
                this.captured++;
            this.stamp[i] = this.frame;
            this.slotProbe[s] = i;
            for (let f = 0; f < 6; f++) {
                const cam = this.faces[s][f].cam;
                cam.viewOverride = lookAt(p, [p[0] + FACES[f][0][0], p[1] + FACES[f][0][1], p[2] + FACES[f][0][2]], FACES[f][1]);
                cam.cut();
                // (the run updated the views before this action: these move now, uploaded ahead of the frame's commands)
                const v = this.faces[s][f].view;
                v.update(true);
                v.frame.upload();
            }
            slots.push({ at: [i % N[0], Math.floor(i / N[0]) % N[1], Math.floor(i / (N[0] * N[1])), 1], k: [this.params.blend, 0, 0, 0] });
        }
        while (slots.length < MAX_SLOTS)
            slots.push({ at: [0, 0, 0, 0], k: [0, 0, 0, 0] });
        this.slotsUsed = best.length;
        this.total = 0;
        for (let i = 0; i < count; i++)
            this.total += this.valid[i];
        this.u.set({ slots, n: [...this.n, this.slotsUsed], k: [0.05, this.params.inside > 0 ? 0.3 * this.spacing : 0, Math.max(0.05, this.params.inside), this.F] });
        this.u.upload();
    }
    /** the shaders' values for it (envx: giMin, giN, giK) */
    envx() {
        const P = this.params;
        return {
            giMin: [...this.min, this.spacing], giN: [...this.n, P.on ? 1 : 0],
            giK: [P.strength, P.normalBias, P.viewBias, Math.max(0.01, P.edge)],
        };
    }
    dispose() {
        for (const row of this.faces)
            for (const f of row)
                f.pass.dispose();
        this.kit.release(this.project, this.capColor, this.capDepth, this.probes, this.u);
    }
}
//# sourceMappingURL=probes.js.map