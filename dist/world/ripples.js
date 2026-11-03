// The ripples round the player (ripple.wgsl): a dispersive heightfield over a window of cells that follows them — by
// default 256 cells at 0.22 m (56 m: a wader's, a swimmer's), `configure` any time for a bigger body's wake (a 27 m
// dragon's: 512 at 0.6 m, 307 m of water) — stepped at a steady 60 a second (as many steps as the frame took, up to
// two; none when paused) while the player is within `reach` of the water or it's still settling, idle otherwise (and
// rippleAt reads flat). Anything can drop an impulse into it: a point (`splash`, `push`) or a line (`line`: a crest or
// a trough the length of it — a wake's arm, the stretch a skimmer ploughed this frame), each with the foam it leaves
// (and how much of that is a breaking crest's whitecap, there only a moment). The env group binds the published
// texture (height, rate, foam, whitecap share), which every surface samples through rippleAt.
import { Ref } from '@ericrius1/weft';
import rippleShader from '../shaders/ripple.wgsl';
/** the default window: cells across, metres a cell */
export const RIPPLE_N = 256;
export const RIPPLE_CELL = 0.22;
/** impulses a step can take (ripple.wgsl's blocks keep up to 512 that reach them) */
const MAX_IMPULSES = 1024;
const STEP = 1 / 60;
export class Ripples {
    kit;
    heights;
    half;
    /** the published texture (the env group's rippleTex: it follows a `configure`) */
    out;
    f;
    impulses;
    u0;
    u1;
    pending = [];
    buf = new Float32Array(MAX_IMPULSES * 8);
    acc = 0;
    origin = [0, 0];
    clear = true;
    list = [];
    quiet = 1e9;
    /** cells across, metres a cell (configure changes them) */
    n = RIPPLE_N;
    cell = RIPPLE_CELL;
    /** running this frame */
    active = false;
    /** the player this far above the water (m) or nearer keeps it running; with nothing pushed for `settle` s further
     *  off it rests */
    reach = 160;
    settle = 10;
    /** damping (1/s), how long foam lasts (s to fade to a third), the viscosity that takes the shortest waves, how long a
     *  crest's whitecap lasts (s), the largest height (m) */
    damping = 0.08;
    foamLife = 2.6;
    viscosity = 0.5;
    crestLife = 0.2;
    maxHeight = 6;
    seaLevel = 0;
    constructor(kit, heights, half, o = {}) {
        this.kit = kit;
        this.heights = heights;
        this.half = half;
        this.impulses = kit.storage({ label: 'ripples.impulses', count: MAX_IMPULSES, stride: 32 });
        this.u0 = kit.uniforms(rippleShader.structs.RippleU, 'ripples.u0');
        this.u1 = kit.uniforms(rippleShader.structs.RippleU, 'ripples.u1');
        this.out = new Ref(() => this.f.tex, 'ripples.out');
        this.build(o.n ?? RIPPLE_N, o.cell ?? RIPPLE_CELL);
    }
    build(n, cell) {
        const k = this.kit;
        n = Math.max(32, Math.round(n / 16) * 16);
        this.n = n;
        this.cell = cell;
        if (this.f && this.f.n === n) {
            this.clear = true;
            return;
        }
        const state = k.pingpong((i) => k.storage({ label: `ripples.state${i}`, count: n * n, stride: 16 }), 'ripples.state');
        const crest = k.pingpong((i) => k.storage({ label: `ripples.crest${i}`, count: n * n, stride: 4 }), 'ripples.crest');
        const tex = k.texture({ label: 'ripples', format: 'rgba16float', size: [n, n], usage: ['storage', 'sample'] });
        const step = (u, label) => k.compute(rippleShader, {
            label, entry: 'sim', workgroups: [n / 16, n / 16],
            bind: { R: u, rin: state.read, rout: state.write, impulses: this.impulses, rippleOut: tex, heights: this.heights, cin: crest.read, cout: crest.write },
        });
        const s0 = step(this.u0, 'ripples.sim0');
        const s1 = step(this.u1, 'ripples.sim1');
        this.f = { n, tex, state, crest, one: [s0, state.swap, crest.swap], two: [s0, state.swap, crest.swap, s1, state.swap, crest.swap] };
        this.clear = true;
    }
    /** a new window: cells across (a multiple of 16), metres a cell; the water starts still */
    configure(o) { this.build(o.n ?? this.n, o.cell ?? this.cell); }
    /** the window's extent [x0, z0, size] (m) */
    get window() { return [this.origin[0] * this.cell, this.origin[1] * this.cell, this.n * this.cell]; }
    /** a round impulse: m of height at its middle (negative a dent, positive a heap) over a radius (m); the foam it
     *  leaves (by default none: a drop, a step; churned water makes its own) */
    splash(x, z, amount, radius, foam = 0) { this.line(x, z, x, z, amount, radius, foam); }
    /** the same along a line from (x, z) to (x2, z2): a crest or a trough the length of it; how much of its foam is a
     *  breaking crest's whitecap, there only a moment (0..1) */
    line(x, z, x2, z2, amount, radius, foam = 0, crest = 0) {
        if (this.pending.length >= MAX_IMPULSES * 8)
            return;
        const [x0, z0, s] = this.window, m = this.cell * 2;
        if (this.active && (Math.max(x, x2) < x0 + m || Math.min(x, x2) > x0 + s - m || Math.max(z, z2) < z0 + m || Math.min(z, z2) > z0 + s - m))
            return;
        this.pending.push(x, z, amount, Math.max(radius, this.cell * 1.5), foam, x2, z2, crest);
        this.quiet = 0;
    }
    /** (the old API) push the water at x, z: radius (m), strength (m; negative pushes it down) */
    push(x, z, radius, strength) { this.splash(x, z, strength, radius * 1.5, Math.min(1, Math.abs(strength) * 6)); }
    /** follow `centre` on the water at `seaLevel`, take this frame's impulses; returns world.ripple (the window's centre,
     *  size and texels; far off when resting, so rippleAt reads flat) */
    update(centre, dt, seaLevel = 0) {
        this.list = [];
        this.quiet += dt;
        const near = centre[1] - seaLevel < this.reach || this.quiet < this.settle;
        if (!near) {
            if (this.active) {
                this.active = false;
                this.pending.length = 0;
            }
            return [1e9, 1e9, this.n * this.cell, this.n];
        }
        if (!this.active || Math.abs(seaLevel - this.seaLevel) > 0.01) {
            this.clear = true;
            this.acc = STEP;
        }
        this.active = true;
        this.seaLevel = seaLevel;
        const n = this.n, cell = this.cell;
        const half = n / 2;
        this.acc = Math.min(this.acc + dt, STEP * 2);
        const steps = Math.floor(this.acc / STEP + 1e-3);
        const centreOut = [(this.origin[0] + half) * cell, (this.origin[1] + half) * cell, n * cell, n];
        if (steps === 0)
            return centreOut;
        this.acc -= steps * STEP;
        const prev = [...this.origin];
        this.origin = [Math.floor(centre[0] / cell) - half, Math.floor(centre[2] / cell) - half];
        const nImp = Math.min(this.pending.length / 8, MAX_IMPULSES);
        if (nImp) {
            this.buf.set(this.pending.slice(0, nImp * 8));
            this.impulses.write(this.buf.subarray(0, nImp * 8));
        }
        this.pending.length = 0;
        const foamKeep = Math.exp(-STEP / this.foamLife);
        const look = [this.viscosity, Math.exp(-STEP / this.crestLife), this.half, this.maxHeight];
        // (the shallows' slowing and the beach's damping scaled to the cell: the waves a window holds are ~10 cells and up)
        const shore = [0.33 / cell, 0.27 * cell, 3.3 * cell, 0];
        const clr = this.clear ? 1 : 0;
        this.u0.set({ win: [this.origin[0], this.origin[1], prev[0], prev[1]], grid: [n, cell, seaLevel, nImp], sim: [STEP, this.damping, foamKeep, clr], look, shore });
        this.u1.set({ win: [this.origin[0], this.origin[1], this.origin[0], this.origin[1]], grid: [n, cell, seaLevel, 0], sim: [STEP, this.damping, foamKeep, 0], look, shore });
        this.clear = false;
        this.list = steps > 1 ? this.f.two : this.f.one;
        return [(this.origin[0] + half) * cell, (this.origin[1] + half) * cell, n * cell, n];
    }
    items() { return this.list; }
}
//# sourceMappingURL=ripples.js.map