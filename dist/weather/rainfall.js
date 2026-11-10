import litShader from '../shaders/rainfall_lit.wgsl';
/** the most instances of each (rainfall.wgsl's): the first `share` of them are drawn, so the count follows the rate */
const RAIN_MAX = 22000;
const SPLASH_MAX = 2400;
/** the boxes round the eye: size (m) and the share of the instances in it (a near dense one, a middle, a far sparse one) */
const BOXES = [[14, 12, 14, 0.4], [34, 24, 34, 0.35], [80, 46, 80, 0.25]];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mod = (x, m) => ((x % m) + m) % m;
export class Rainfall {
    kit;
    opts;
    u;
    /** the default shader's light: set it each frame (unused with a world's own shader) */
    light = { sky: [0.5, 0.55, 0.6], key: [1, 1, 1], dir: [0, 1, 0], lamps: [0, 0, 0], lampReach: 60, ground: 0 };
    /** what's drawn now: the shares of drops and splashes, the veil's extinction */
    shares = { rain: 0, splash: 0, veil: 0 };
    /** the top of the fall (world y): the cloud base */
    top = 900;
    shader;
    lit = null;
    fall = BOXES.map(() => [0, 0, 0]);
    time = 0;
    pass = null;
    scale;
    constructor(kit, opts = {}) {
        this.kit = kit;
        this.opts = opts;
        this.shader = opts.shader ?? litShader;
        this.scale = opts.scale ?? 1;
        this.u = kit.uniforms(this.shader.structs.RainU, 'rain');
        if (!opts.shader)
            this.lit = kit.uniforms(litShader.structs.RainLight, 'rain.light');
    }
    /** its pass over `hdr` (cleared: no; drawn premultiplied), reading the scene's distance along the view (`sceneZ`:
     *  r32float metres, large for the sky) */
    attach(hdr, sceneZ) {
        const pass = this.kit.pass({ label: 'rain', color: [{ target: hdr, clear: false }] });
        const bind = { ...this.opts.bind, rainP: this.u, rainZ: sceneZ, ...(this.lit ? { rainL: this.lit } : {}) };
        const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
        const sh = this.shares, shader = this.shader;
        pass.fullscreen(shader, { label: 'rain.veil', fragment: 'fsVeil', blend, bind, enabled: () => sh.veil > 2e-6 });
        const draw = (label, vertex, fragment, max, share) => pass.draw(shader, {
            label, vertex, fragment, topology: 'triangle-strip', count: 4, instances: () => Math.ceil(max * Math.min(1, share() * this.scale)), blend, cull: 'none', bind, enabled: () => share() > 0.001,
        });
        draw('rain.drops', 'vsRain', 'fsDrop', RAIN_MAX, () => sh.rain);
        draw('rain.splash', 'vsSplash', 'fsSplash', SPLASH_MAX, () => sh.splash);
        this.pass = pass;
    }
    /** the pass, while anything falls (none at all while it's dry) */
    passes() { return this.pass && (this.shares.rain > 0 || this.shares.veil > 2e-6) ? [this.pass] : []; }
    /** a frame on: `under` (the eye under water) stops it */
    update(dt, w, under = false) {
        this.time += dt;
        // (the weather's 0..1 as millimetres an hour: a drizzle's half to a storm's dozen and more)
        const R = under ? 0 : w.rain > 0.01 ? 14 * Math.pow(w.rain, 1.6) : 0;
        const sh = this.shares;
        sh.rain = R > 0.01 ? 1 - Math.exp(-R / 3.5) : 0;
        sh.splash = sh.rain;
        // the visibility in rain (Koschmieder: extinction = 3.9 / visibility)
        const vis = R > 0.01 ? 20000 * Math.pow(R, -0.65) : Infinity;
        sh.veil = 3.912 / vis;
        // the cloud base: low in a storm, higher in showers
        this.top = 1400 - 900 * smooth(0.2, 0.9, w.cloud);
        // the drops: drizzle fine and slow, a downpour big and fast; the wind carries them
        const fall = 3 + 6 * smooth(0.2, 8, R);
        // (near the ground the drops take only part of the wind's speed: a gale slants them, it doesn't fling them flat)
        const push = Math.min(w.wind * 0.55, 7);
        const v = [w.windDir[0] * push, -fall, w.windDir[1] * push];
        for (let k = 0; k < BOXES.length; k++) {
            const B = BOXES[k];
            for (let a = 0; a < 3; a++)
                this.fall[k][a] = mod(this.fall[k][a] + v[a] * dt, B[a]);
        }
        if (sh.rain <= 0)
            return;
        let acc = 0;
        this.u.set({
            rain: [sh.rain, 1 / 45, 0.0016 + 0.0016 * smooth(0.5, 20, R), 0.62],
            vel: [...v, this.top],
            fall: this.fall.map((f) => [...f, 0]),
            box: BOXES.map((b) => { acc += b[3]; return [b[0], b[1], b[2], acc]; }),
            veil: [sh.veil, 0, sh.splash, this.time],
        });
        if (this.lit) {
            const L = this.light;
            this.lit.set({ sky: [...L.sky, 0], key: [...L.key, 0], dir: [...L.dir, L.ground], lamps: [...L.lamps, L.lampReach] });
        }
    }
}
//# sourceMappingURL=rainfall.js.map