import { blueNoiseTexture } from '@ericrius1/weft';
import cloudShader from '../shaders/clouds.wgsl';
import noiseShader from '../shaders/clouds_noise.wgsl';
const WEATHER_N = 1024;
const WEATHER_SIZE = 56000;
const GROUND_N = 512;
const SMAP_N = 1024;
const LVOL_N = 160, LVOL_NY = 40, LVOL_SIZE = 8000;
const WAKE_N = 256;
const WAKE_SIZE = 2048;
export const CLOUD_Y0 = 180, CLOUD_Y1 = 7200;
/** the top of the ordinary layer (the storm towers rise above it to CLOUD_Y1) */
export const CLOUD_LAYER = 2600;
const MAX_CELLS = 8;
const NOFRONT = { angle: 0, speed: 0, width: 0 };
export const WEATHER = {
    fair: { coverage: 0.05, storm: 0, base: 360, baseRange: 40, front: NOFRONT, wind: [4, 1.5], type: 0.3, sea: 0.75, cirrus: 0.25, cells: 0, cellRadius: 2000 },
    cumulus: { coverage: 0.6, storm: 0.15, base: 340, baseRange: 50, front: NOFRONT, wind: [5, 2], type: 0.3, sea: 0.85, cirrus: 0.12, cells: 0, cellRadius: 2000 },
    front: { coverage: 0.25, storm: 0.6, base: 300, baseRange: 60, front: { angle: 0.6, speed: 9, width: 3500, lead: 9000 }, wind: [7, 3], type: 0.2, sea: 1, cirrus: 0.45, cells: 1, cellRadius: 2200 },
    storm: { coverage: 0.62, storm: 1, base: 260, baseRange: 60, front: NOFRONT, wind: [9, 4], type: 0.5, sea: 1, cirrus: 0.3, cells: 3, cellRadius: 2400 },
    overcast: { coverage: 1.5, storm: 0.25, base: 280, baseRange: 40, front: NOFRONT, wind: [6, 2], type: -0.6, sea: 1, cirrus: 0, cells: 0, cellRadius: 2000 },
};
const copyWeather = (t) => ({ ...t, front: { ...t.front }, wind: [...t.wind] });
/** the storm towers' light boxes (shaders/clouds.wgsl bakeTowers): texels across, up; slices baked a frame */
const TW_N = 48, TW_NY = 64, TW_STEP = 6;
export class Clouds {
    kit;
    heights;
    depth;
    params = {
        density: 0.08, erosion: 0.5, curl: 1,
        stratusThick: 600, cumulusThick: 950,
        multiScatter: 0.5, ambient: 1.0, powder: 0.6, silver: 1,
        /** the octaves' energy (the light a thick cloud returns after many scatterings) */
        msEnergy: 2.3,
        /** how much of the diffusion floor clouds seen from outside keep */
        diffuseOut: 0,
        /** the light deep inside a cloud (diffusion's algebraic falloff, where the octaves give out) */
        diffuse: 0.4,
        steps: 160, lightReach: 4000, fineReach: 90, nearStep: 3.5, maxDist: 28000,
        wisps: 1, evolve: 1, healTime: 22, ao: 0.3,
        /** a full-strength storm tower's top (world y) */
        towerTop: 7000,
        /** the history: the far layer's α floor and sample cap, the near layer's */
        farAlphaMin: 0.1, farCap: 24, nearAlphaMin: 0.4, nearCap: 4,
        /** 0: everything in the far layer (cost breakdown) */
        nearLayer: 1,
        /** the march: 'quarter' (a quarter of the pixels, interleaved over 4 frames) or 'half' (every half-res pixel) */
        marchRes: 'quarter',
        /** 1 no shadow map, 2 no cone, 3 no erosion */
        debug: 0,
        /** 1: the composite shows the cloud layer alone (the flicker bench) */
        layerOnly: 0,
        /** 1: skip the light (cost breakdown) */
        noLight: 0,
    };
    weather = copyWeather(WEATHER.cumulus);
    /** the storm cells (cumulonimbus): the weather keeps `cells` of them standing 6–15 km off; a game can add its own */
    cells = [];
    target = null;
    blend = 0;
    on = true;
    /** the camera is under the sea: no march, no composite (the sea's underside shows the sky through its window) */
    hidden = false;
    get live() { return this.on && !this.hidden; }
    /** the clouds' own clock (s) */
    time = 900;
    /** the camera is up in or above the slab (the composite goes after the mist) */
    above = false;
    smap;
    /** the window of the shadow map: origin x, z, size (m), reference plane height */
    cloudMap;
    u;
    weatherTex;
    ground;
    lvol;
    towers;
    bakeTowers;
    twFirst = 0;
    twSlices = TW_N;
    twSig = '';
    nextCellId = 1;
    /** the painted look (stylized worlds): brightness mapped to three tones of a palette, crisp silhouettes */
    style = { on: false, lit: 1, soft: 0.06, edge: 0.35, palette: [[0.35, 0.3, 0.75], [0.95, 0.6, 0.75], [1.0, 0.94, 0.82]] };
    wake;
    wakeNext;
    blue;
    /** the march's outputs, at quarter res (interleaved) and half (every pixel): far, its depth, near, its depth */
    q;
    h;
    /** the resolved layers (half res) and their meta (z̄, σ_z, scene distance, sample count); the history copies */
    farOut;
    farMeta;
    farHist;
    farMetaHist;
    nearOut;
    nearMeta;
    nearHist;
    nearMetaHist;
    base;
    detail;
    noise = [];
    bakeGround;
    bakeLight;
    lvolSlice = 0;
    lvolSlices = LVOL_N;
    bakeWeather;
    bakeShadow;
    bakeWake;
    passesQ = [];
    passesH = [];
    copies = [];
    wakeCopy;
    probeBuf;
    probePass;
    probing = false;
    probeD = 0;
    /** how deep in cloud the camera is (0 clear .. 1 thick fog; eased): for the eye's adaptation, sound, gameplay */
    inside = 0;
    once = true;
    wwin = [1e9, 1e9];
    drift = [0, 0];
    evolveT = 0;
    wRow = 0;
    wRows = WEATHER_N;
    smapRow = 0;
    smapFull = true;
    rows = SMAP_N;
    frame = 0;
    histVersion = -1;
    camVel = [0, 0, 0];
    lastCam = null;
    frontPos = -20000;
    placeFront = false;
    /** (the weather was set at once: new cells stand at full height straight away) */
    instant = false;
    stampList = [];
    flash = { pos: [0, 0, 0], k: 0, next: 4 };
    /** the bench's reference mode: > 0 counts the frames accumulated (set 1 to start; 0 off) */
    reference = 0;
    /** this frame's near/far split (m) */
    split = 150;
    /** the clouds' clock state (the bench restores it to render a reference of the same instant) */
    get state() { return { time: this.time, drift: [...this.drift], evolveT: this.evolveT, frontPos: this.frontPos, cells: this.cells.map((c) => ({ ...c })) }; }
    set state(s) {
        this.time = s.time;
        this.drift = [s.drift[0], s.drift[1]];
        this.evolveT = s.evolveT;
        this.frontPos = s.frontPos;
        if (s.cells)
            this.cells = s.cells.map((c) => ({ ...c }));
    }
    constructor(kit, heights, depth, half) {
        this.kit = kit;
        this.heights = heights;
        this.depth = depth;
        const k = kit;
        this.u = k.uniforms(cloudShader.structs.CloudU, 'clouds');
        this.base = k.texture({ label: 'clouds.noise.base', format: 'r32float', size: [128, 128, 128], dimension: '3d', mips: 8, usage: ['storage', 'sample'] });
        this.detail = k.texture({ label: 'clouds.noise.detail', format: 'rgba8unorm', size: [64, 64, 64], dimension: '3d', mips: 7, usage: ['storage', 'sample'] });
        this.weatherTex = k.texture({ label: 'clouds.weather', format: 'rgba16float', size: [WEATHER_N, WEATHER_N], usage: ['storage', 'sample'] });
        this.ground = k.texture({ label: 'clouds.ground', format: 'rgba16float', size: [GROUND_N, GROUND_N], usage: ['storage', 'sample'] });
        this.lvol = k.texture({ label: 'clouds.light', format: 'rgba16float', size: [LVOL_N, LVOL_NY, LVOL_N], dimension: '3d', usage: ['storage', 'sample'] });
        this.towers = k.storage({ label: 'clouds.towers', size: TW_N * TW_NY * TW_N * MAX_CELLS * 8, usage: ['storage', 'copy-src'] });
        this.wake = k.texture({ label: 'clouds.wake', format: 'rgba32float', size: [WAKE_N, WAKE_N], usage: ['sample', 'copy-dst'] });
        this.wakeNext = k.texture({ label: 'clouds.wake.next', format: 'rgba32float', size: [WAKE_N, WAKE_N], usage: ['storage', 'copy-src'] });
        this.smap = k.texture({ label: 'clouds.shadow', format: 'rgba8unorm', size: [SMAP_N, SMAP_N], usage: ['storage', 'sample'] });
        this.blue = blueNoiseTexture(k, 64, 11);
        const tex = (label, scale, format, usage) => k.texture({ label, format, size: 'render', scale, usage });
        const set = (scale, tag) => ({
            far: tex(`clouds.far.${tag}`, scale, 'rgba16float', ['storage', 'sample', 'copy-src']),
            farZ: tex(`clouds.farZ.${tag}`, scale, 'rgba32float', ['storage', 'sample']),
            near: tex(`clouds.near.${tag}`, scale, 'rgba16float', ['storage', 'sample']),
            nearZ: tex(`clouds.nearZ.${tag}`, scale, 'rg32float', ['storage', 'sample']),
        });
        this.q = set(0.25, 'q');
        this.h = set(0.5, 'h');
        this.farOut = tex('clouds.far', 0.5, 'rgba16float', ['storage', 'sample', 'copy-src']);
        this.farMeta = tex('clouds.farMeta', 0.5, 'rgba32float', ['storage', 'sample', 'copy-src']);
        this.farHist = tex('clouds.farHist', 0.5, 'rgba16float', ['sample', 'copy-dst']);
        this.farMetaHist = tex('clouds.farMetaHist', 0.5, 'rgba32float', ['sample', 'copy-dst']);
        this.nearOut = tex('clouds.near', 0.5, 'rgba16float', ['storage', 'sample', 'copy-src']);
        this.nearMeta = tex('clouds.nearMeta', 0.5, 'rgba32float', ['storage', 'sample', 'copy-src']);
        this.nearHist = tex('clouds.nearHist', 0.5, 'rgba16float', ['sample', 'copy-dst']);
        this.nearMetaHist = tex('clouds.nearMetaHist', 0.5, 'rgba32float', ['sample', 'copy-dst']);
        const S = 2 * half + 3000;
        this.cloudMap = [-S / 2, -S / 2, S, 700];
    }
    /** the passes (after the env group is shared: the march reads it) */
    build() {
        const k = this.kit, base = this.base, detail = this.detail;
        this.noise.push(k.compute(noiseShader, { label: 'clouds.noise.base', entry: 'bakeBase', bind: { baseOut: base.mip(0), detailOut: detail.mip(0) }, threads: [128, 128, 128] }));
        this.noise.push(k.compute(noiseShader, { label: 'clouds.noise.detail', entry: 'bakeDetail', bind: { baseOut: base.mip(0), detailOut: detail.mip(0), blueIn: this.blue }, threads: [64, 64, 64] }));
        for (const t of [base, detail]) {
            const r32 = t === base;
            for (let l = 1; l < t.mips; l++) {
                const n = Math.max(1, t.width >> l);
                this.noise.push(r32
                    ? k.compute(noiseShader, { label: `clouds.noise.mipR${l}`, entry: 'downR', bind: { mipSrc: t.mip(l - 1), mipDstR: t.mip(l) }, threads: [n, n, n] })
                    : k.compute(noiseShader, { label: `clouds.noise.mip${l}`, entry: 'down', bind: { mipSrc: t.mip(l - 1), mipDst: t.mip(l) }, threads: [n, n, n] }));
            }
        }
        const C = this.u;
        const common = { C, cBase: base, cDetail: detail, cWeather: this.weatherTex, cGround: this.ground, cLight: this.lvol, cWake: this.wake, cTower: this.towers };
        this.bakeTowers = k.compute(cloudShader, { label: 'clouds.towers', entry: 'bakeTowers', bind: { C, cBase: base, cDetail: detail, cWeather: this.weatherTex, cWake: this.wake, towerOut: this.towers }, threads: () => [TW_N, TW_NY, this.twSlices * MAX_CELLS], enabled: () => this.cells.length > 0 });
        this.bakeGround = k.compute(cloudShader, { label: 'clouds.ground', entry: 'bakeGround', bind: { groundOut: this.ground, heightIn: this.heights }, threads: [GROUND_N, GROUND_N] });
        this.bakeLight = k.compute(cloudShader, { label: 'clouds.light', entry: 'bakeLight', bind: { C, cBase: base, cDetail: detail, cWeather: this.weatherTex, cWake: this.wake, lightOut: this.lvol }, threads: () => [LVOL_N, LVOL_NY, this.lvolSlices] });
        this.bakeWeather = k.compute(cloudShader, { label: 'clouds.weather', entry: 'bakeWeather', bind: { C, weatherOut: this.weatherTex, cGround: this.ground }, threads: () => [WEATHER_N, this.wRows] });
        this.bakeWake = k.compute(cloudShader, { label: 'clouds.wake', entry: 'bakeWake', bind: { C, cWake: this.wake, wakeOut: this.wakeNext }, threads: [WAKE_N, WAKE_N] });
        this.wakeCopy = k.copy(this.wakeNext, this.wake, 'clouds.wake.copy');
        this.probeBuf = k.storage({ label: 'clouds.probe', size: 16, usage: ['storage', 'copy-src'] });
        this.probePass = k.compute(cloudShader, { label: 'clouds.probe', entry: 'probe', bind: { C, cBase: base, cDetail: detail, cWeather: this.weatherTex, cWake: this.wake, probeOut: this.probeBuf }, threads: [1] });
        this.bakeShadow = k.compute(cloudShader, { label: 'clouds.shadowmap', entry: 'bakeShadow', bind: { ...common, smapOut: this.smap }, threads: () => [SMAP_N, this.rows] });
        const march = (m, label) => k.compute(cloudShader, { label, entry: 'march', bind: { ...common, sceneDepth: this.depth, farOut: m.far, farZOut: m.farZ, nearOut: m.near, nearZOut: m.nearZ }, threads: () => [m.far.width, m.far.height] });
        const resolve = (inLT, inZ, hist, histM, out, outM, entry, label) => k.compute(cloudShader, { label, entry, bind: { C, sceneDepth: this.depth, inLT, inZ, histLT: hist, histM, outLT: out, outM }, threads: () => [out.width, out.height] });
        const resolves = (m, tag) => [
            resolve(m.far, m.farZ, this.farHist, this.farMetaHist, this.farOut, this.farMeta, 'resolveFar', `clouds.resolveFar.${tag}`),
            resolve(m.near, m.nearZ, this.nearHist, this.nearMetaHist, this.nearOut, this.nearMeta, 'resolveNear', `clouds.resolveNear.${tag}`),
        ];
        this.passesQ = [march(this.q, 'clouds.march'), ...resolves(this.q, 'q')];
        this.passesH = [march(this.h, 'clouds.march.half'), ...resolves(this.h, 'h')];
        this.copies = [
            k.copy(this.farOut, this.farHist, 'clouds.farHist'), k.copy(this.farMeta, this.farMetaHist, 'clouds.farMetaHist'),
            k.copy(this.nearOut, this.nearHist, 'clouds.nearHist'), k.copy(this.nearMeta, this.nearMetaHist, 'clouds.nearMetaHist'),
        ];
    }
    /** the resolved clouds (half res: rgb in-scatter, a transmittance) — the shafts read it too */
    get outTex() { return this.farOut; }
    /** the full-res composite, drawn into a pass over the scene (hdr): blend one, src-alpha */
    addComposite(pass) {
        pass.fullscreen(cloudShader, { label: 'clouds.composite', fragment: 'composite', bind: { C: this.u, farLT: this.farOut, farM: this.farMeta, nearLT: this.nearOut, nearM: this.nearMeta, sceneDepth: this.depth }, blend: { color: { srcFactor: 'one', dstFactor: 'src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } }, enabled: () => this.live });
    }
    // ---------------------------------------------------------------- the world's hand in it
    /** ease the weather toward a preset (or any Weather) over `secs` */
    setWeather(w, secs = 30) {
        const t = typeof w === 'string' ? WEATHER[w] : w;
        this.target = copyWeather(t);
        this.blend = secs <= 0 ? 1 : 0;
        this.blendRate = secs > 0 ? 1 / secs : 1;
        // a front starts upwind, a wall on the horizon, and sweeps in
        if (t.front.width > 0)
            this.placeFront = true;
        if (secs <= 0) {
            this.stepWeather(0);
            for (const c of this.cells)
                c.s = c.target;
            this.instant = true;
        }
    }
    /** a storm cell at world x, z (radius m, strength 0..1); `grow` 0: standing at once, else building over that many
     *  seconds */
    addCell(x, z, radius = 2400, strength = 1, grow = 60) {
        if (this.cells.length >= MAX_CELLS)
            this.cells.shift();
        this.cells.push({ x: x - this.drift[0], z: z - this.drift[1], r: radius, s: grow > 0 ? 0.05 : strength, target: strength, rate: grow > 0 ? strength / grow : 1, pinned: true, id: this.nextCellId++ });
    }
    /** the cells' centres in the world (they ride the wind) */
    cellPos(c) { return [c.x + this.drift[0], c.z + this.drift[1]]; }
    /** what the sky shaders need from the weather (games pass it on in world): the cirrus's cover, how overcast (inside
     *  a cloud too: the scene is lit by the cloud's own diffuse grey, not the open sky) */
    get sky() {
        const W = this.weather;
        // (under a tower's anvil the sky's shut out as surely as under a deck)
        let tower = 0;
        if (this.lastCam)
            for (const c of this.cells) {
                const [x, z] = this.cellPos(c);
                const d = Math.hypot(this.lastCam[0] - x, this.lastCam[2] - z);
                tower = Math.max(tower, c.s * (1 - Math.min(1, Math.max(0, (d - c.r) / (c.r * 0.6)))));
            }
        // (a front announces itself: the cirrus thickens into a veil of cirrostratus as it comes)
        let veil = 0;
        if (this.lastCam && W.front.width > 300) {
            const ahead = this.frontPos - (this.lastCam[0] * Math.cos(W.front.angle) + this.lastCam[2] * Math.sin(W.front.angle));
            veil = 0.3 * (1 - Math.min(1, Math.max(0, (Math.abs(ahead) - 3000) / 22000)));
        }
        return { cloudCover: Math.min(1, W.cirrus + veil), overcast: Math.max(Math.min(1, Math.max(0, (W.coverage - 0.7) / 0.7)), this.inside * 0.85, tower * 0.9) };
    }
    blendRate = 1;
    stepWeather(dt) {
        const t = this.target;
        if (!t)
            return;
        this.blend = Math.min(1, this.blend + dt * this.blendRate);
        const w = this.weather, k = this.blend >= 1 ? 1 : 1 - Math.exp(-dt * this.blendRate * 3);
        w.coverage += (t.coverage - w.coverage) * k;
        w.storm += (t.storm - w.storm) * k;
        w.base += (t.base - w.base) * k;
        w.baseRange += (t.baseRange - w.baseRange) * k;
        w.wind = [w.wind[0] + (t.wind[0] - w.wind[0]) * k, w.wind[1] + (t.wind[1] - w.wind[1]) * k];
        w.front = { angle: t.front.angle, speed: t.front.speed, width: w.front.width + (t.front.width - w.front.width) * k, lead: t.front.lead };
        w.type += (t.type - w.type) * k;
        w.sea += (t.sea - w.sea) * k;
        w.cirrus += (t.cirrus - w.cirrus) * k;
        w.cells = t.cells;
        w.cellRadius = t.cellRadius;
        if (this.blend >= 1)
            this.target = null;
    }
    /** something flew through from a to b this frame: tear a tunnel (radius m, strength 0..1) that heals */
    stamp(a, b, radius, strength = 0.95) {
        if (this.stampList.length >= 64)
            return;
        // (only where there could be cloud)
        if (Math.max(a[1], b[1]) < CLOUD_Y0 - radius || Math.min(a[1], b[1]) > CLOUD_Y1 + radius)
            return;
        this.stampList.push(a[0], a[1], a[2], radius, b[0], b[1], b[2], strength);
    }
    /** a lightning strike inside a cloud at p (intensity: the flash's peak radiance) */
    strike(p, intensity = 60) { this.flash.pos = [...p]; this.flash.k = intensity; }
    /** the current flash (for the scene's light and the thunder): position, intensity */
    get lightning() { return this.flash; }
    /** per frame, before the run: the uniforms, which bakes are due */
    update(dt, cam, _cover, fovY = 55 * Math.PI / 180) {
        this.time += dt;
        this.frame++;
        this.stepWeather(dt);
        // (the camera's cloud, read back a frame or two late)
        if (!this.probing && this.probeBuf) {
            this.probing = true;
            this.probeBuf.read().then((b) => { this.probeD = new Float32Array(b)[0]; this.probing = false; }, () => { this.probing = false; });
        }
        const want = this.live ? Math.min(1, Math.max(0, (this.probeD - 0.02) / 0.3)) : 0;
        this.inside += (want - this.inside) * (1 - Math.exp(-dt * 4));
        if (this.lastCam && dt > 0) {
            const v = [(cam[0] - this.lastCam[0]) / dt, (cam[1] - this.lastCam[1]) / dt, (cam[2] - this.lastCam[2]) / dt];
            this.camVel = Math.hypot(...v) > 600 ? [0, 0, 0] : v;
        }
        this.lastCam = [...cam];
        this.above = cam[1] > CLOUD_Y0;
        const P = this.params, W = this.weather;
        this.drift = [this.drift[0] + W.wind[0] * dt, this.drift[1] + W.wind[1] * dt];
        this.evolveT += dt * P.evolve;
        // the front sweeps across (once past, it comes round again from upwind)
        const fdir = [Math.cos(W.front.angle), Math.sin(W.front.angle)];
        if (this.placeFront) {
            this.frontPos = cam[0] * fdir[0] + cam[2] * fdir[1] - (W.front.lead ?? 9000);
            this.placeFront = false;
        }
        this.frontPos += W.front.speed * dt;
        if (this.frontPos - (cam[0] * fdir[0] + cam[2] * fdir[1]) > 30000)
            this.frontPos = cam[0] * fdir[0] + cam[2] * fdir[1] - (W.front.lead ?? 9000);
        this.updateCells(dt, cam);
        // the weather map: a camera-centred window in drifted coordinates (re-centred when the camera wanders off); a band of
        // rows a frame (an eighth: the cells evolve over minutes)
        const ux = cam[0] - this.drift[0], uz = cam[2] - this.drift[1];
        const recentre = Math.hypot(ux - (this.wwin[0] + WEATHER_SIZE / 2), uz - (this.wwin[1] + WEATHER_SIZE / 2)) > 9000;
        if (recentre) {
            this.wwin = [Math.round(ux / 1000) * 1000 - WEATHER_SIZE / 2, Math.round(uz / 1000) * 1000 - WEATHER_SIZE / 2];
            this.smapFull = true;
        }
        const full = recentre || this.once;
        const band = WEATHER_N / 8;
        this.wRow = full ? 0 : (this.wRow + band) % WEATHER_N;
        this.wRows = full ? WEATHER_N : band;
        // the light volume: a quarter of its slices a frame (the sun and the cells move slowly; the camera's wrap is
        // covered within four frames)
        const lb = LVOL_N / 4;
        this.lvolSlice = full ? 0 : (this.lvolSlice + lb) % LVOL_N;
        this.lvolSlices = full ? LVOL_N : lb;
        // the towers' light boxes: a few slices a frame (the sun and the cells move slowly); all of them when the cells
        // change (a cell's slot in the stack moves with it)
        const sig = this.cells.map((c) => c.id ?? 0).join(',');
        if (sig !== this.twSig || full) {
            this.twSig = sig;
            this.twFirst = 0;
            this.twSlices = TW_N;
        }
        else {
            this.twFirst = (this.twFirst + this.twSlices) % TW_N;
            this.twSlices = TW_STEP;
        }
        // the shadow map: a sixteenth a frame
        const sband = SMAP_N / 16;
        this.smapRow = this.smapFull ? 0 : (this.smapRow + sband) % SMAP_N;
        this.rows = this.smapFull ? SMAP_N : sband;
        this.smapFull = false;
        // lightning: inside the storm cells, now and then — the stronger and nearer, the oftener
        this.flash.k *= Math.exp(-dt * 9);
        const live = this.cells.filter((c) => c.s > 0.4);
        if (live.length) {
            this.flash.next -= dt * Math.min(2, live.reduce((a, c) => a + c.s, 0) * 0.6);
            if (this.flash.next <= 0) {
                this.flash.next = 1.5 + Math.random() * 6;
                const c = live[Math.floor(Math.random() * live.length)];
                const [cx, cz] = this.cellPos(c);
                const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * c.r * 0.55;
                const top = CLOUD_LAYER + (P.towerTop - CLOUD_LAYER) * c.s;
                this.strike([cx + Math.cos(a) * d, W.base + 150 + Math.random() * (top - W.base) * 0.6, cz + Math.sin(a) * d], 40 + Math.random() * 90);
            }
        }
        // (the history: none after a resize reallocated it, on the first frame, or as a reference render starts)
        const valid = this.farHist.version === this.histVersion;
        this.histVersion = this.farHist.version;
        const reset = !valid || this.once || this.reference === 1;
        if (this.reference > 0)
            this.reference++;
        // the near/far split: where reprojecting a cloud of typical depth spread stops being within a pixel at this speed
        const travel = Math.hypot(...this.camVel) * Math.max(dt, 1 / 120);
        const fpx = (this.farOut.height / 2) / Math.tan(fovY / 2);
        const split = P.nearLayer ? Math.min(800, Math.max(150, 0.2 * fpx * travel)) : 0;
        const nearStep = Math.min(25, Math.max(4, split / 32));
        this.split = split;
        const wl = Math.hypot(W.wind[0], W.wind[1]) || 1;
        const shear = [W.wind[0] / wl, W.wind[1] / wl];
        const stamps = new Float32Array(64);
        const ns = Math.min(8, this.stampList.length / 8);
        stamps.set(this.stampList.slice(0, ns * 8));
        this.stampList.length = 0;
        this.u.set({
            shape: [W.coverage, P.density, P.erosion, P.curl],
            layer: [W.base, W.baseRange, P.stratusThick, P.cumulusThick],
            drift: [this.drift[0], this.drift[1], this.evolveT, this.time],
            wwin: [this.wwin[0], this.wwin[1], WEATHER_SIZE, WEATHER_N],
            light: [P.multiScatter, P.ambient, P.powder, P.silver],
            march: [P.steps, P.lightReach, P.nearStep, P.maxDist],
            misc: [this.frame, reset ? 1 : 0, P.wisps, P.marchRes === 'half' ? 4 : this.frame & 3],
            smap: [this.cloudMap[0], this.cloudMap[1], this.cloudMap[2], SMAP_N],
            vel: [...this.camVel, W.storm],
            bake: [this.smapRow, this.rows, this.wRow, this.wRows],
            wake: [WAKE_SIZE, WAKE_N, 1 / Math.max(P.healTime, 0.1), ns],
            flash: [...this.flash.pos, this.flash.k > 0.05 ? this.flash.k : 0],
            front: [fdir[0], fdir[1], this.frontPos, W.front.width],
            stamps: Array.from({ length: 16 }, (_, i) => [stamps[i * 4], stamps[i * 4 + 1], stamps[i * 4 + 2], stamps[i * 4 + 3]]),
            lvol: [LVOL_SIZE, LVOL_N, LVOL_NY, this.lvolSlice],
            lvol2: [this.lvolSlices, P.fineReach, P.ao, P.msEnergy],
            // (half-res march: less of each frame's jittered sample per pixel — its grain shows more than the quarter's)
            layers: [split, nearStep, Math.ceil(split / nearStep) + 1, P.marchRes === 'half' ? Math.min(P.farAlphaMin, 0.06) : P.farAlphaMin],
            layers2: [P.nearAlphaMin, P.farCap, P.nearCap, travel],
            debug: [P.debug, P.layerOnly, this.reference > 0 ? 1 : 0, P.noLight],
            // (the diffusion floor: in full inside a cloud — the fog round the eye luminous — and a little of it outside: the
            // light a thick tower passes on through itself greys its shaded side; in full it would warm every shadow)
            weather2: [W.type, W.sea, W.front.lead ?? 9000, P.diffuse * Math.max(this.inside, P.diffuseOut)],
            cellInfo: [this.cells.length, P.towerTop, ...shear],
            cells: Array.from({ length: MAX_CELLS }, (_, i) => { const c = this.cells[i]; return c ? [c.x, c.z, c.r, c.s] : [0, 0, 0, 0]; }),
            // (each box over its tower and the anvil it spreads downwind: centred halfway along the shear)
            boxes: Array.from({ length: MAX_CELLS }, (_, i) => {
                const c = this.cells[i];
                if (!c)
                    return [0, 0, 0, 0];
                const [x, z] = this.cellPos(c);
                return [x + shear[0] * c.r * 0.65, z + shear[1] * c.r * 0.65, c.r * 3.1, 1];
            }),
            towerBake: [this.twFirst, this.twSlices, 0, 0],
            style: [this.style.on ? 1 : 0, this.style.lit, this.style.soft, this.style.edge],
            pal: this.style.palette.map((c) => [c[0], c[1], c[2], 1]),
        });
    }
    /** keep the weather's storm cells standing: build new ones 6–15 km off (upwind, so they come to you), let the ones too
     *  far behind die away */
    updateCells(dt, cam) {
        const W = this.weather;
        const want = Math.round(W.cells);
        const ux = cam[0] - this.drift[0], uz = cam[2] - this.drift[1];
        const auto = this.cells.filter((c) => !c.pinned);
        for (const c of this.cells) {
            if (Math.hypot(c.x - ux, c.z - uz) > 24000)
                c.target = 0;
            c.s += Math.sign(c.target - c.s) * Math.min(Math.abs(c.target - c.s), c.rate * dt * (c.target < c.s ? 2 : 1));
        }
        this.cells = this.cells.filter((c) => c.s > 0.02 || c.target > 0);
        this.frontCells(cam);
        let n = auto.filter((c) => c.target > 0).length;
        // (fewer wanted: the oldest die away)
        for (const c of auto)
            if (n > want && c.target > 0) {
                c.target = 0;
                n--;
            }
        while (n < want && this.cells.length < MAX_CELLS) {
            const wl = Math.hypot(W.wind[0], W.wind[1]) || 1;
            const up = Math.atan2(-W.wind[1] / wl, -W.wind[0] / wl);
            const a = up + (Math.random() - 0.5) * 2.4, d = 6000 + Math.random() * 9000;
            const r = W.cellRadius * (0.75 + Math.random() * 0.5);
            const target = 0.75 + Math.random() * 0.25;
            this.cells.push({ x: ux + Math.cos(a) * d, z: uz + Math.sin(a) * d, r, s: this.once || this.instant ? target : 0.05, target, rate: 1 / 70, pinned: false, id: this.nextCellId++ });
            n++;
        }
        this.instant = false;
    }
    /** a front's line of towers: three on it, 6.5 km apart round where the camera is along it, riding with the line
     *  (moved onto it each frame); when the camera has gone far along, they're left to die and three more rise */
    frontCells(cam) {
        const W = this.weather;
        const fdir = [Math.cos(W.front.angle), Math.sin(W.front.angle)], perp = [-fdir[1], fdir[0]];
        const along = cam[0] * perp[0] + cam[2] * perp[1];
        const live = this.cells.filter((c) => c.front !== undefined && c.target > 0);
        const fronting = W.front.width > 300;
        if (!fronting || (live.length && Math.min(...live.map((c) => Math.abs(c.front - along))) > 9000))
            for (const c of live)
                c.target = 0;
        if (fronting && !this.cells.some((c) => c.front !== undefined && c.target > 0)) {
            for (const k of [-1, 0, 1]) {
                if (this.cells.length >= MAX_CELLS)
                    break;
                const r = W.cellRadius * (0.85 + 0.3 * Math.random()), target = 0.8 + 0.2 * Math.random();
                this.cells.push({ x: 0, z: 0, r, s: this.once || this.instant ? target : 0.05, target, rate: 1 / 40, pinned: true, id: this.nextCellId++, front: along + k * 6500 + (Math.random() - 0.5) * 1500 });
            }
        }
        for (const c of this.cells)
            if (c.front !== undefined) {
                c.x = fdir[0] * this.frontPos + perp[0] * c.front - this.drift[0];
                c.z = fdir[1] * this.frontPos + perp[1] * c.front - this.drift[1];
            }
    }
    /** compute before the passes: the bakes */
    bakes() {
        const out = [];
        if (this.once) {
            out.push(...this.noise, this.bakeGround);
            this.once = false;
        }
        out.push(this.bakeWeather, this.bakeLight, this.bakeTowers, this.bakeWake, this.wakeCopy, this.bakeShadow, this.probePass);
        return out;
    }
    /** after the scene's depth is complete (the water in): march + resolve + keep the history */
    render() {
        if (!this.live)
            return [];
        return [...(this.params.marchRes === 'half' ? this.passesH : this.passesQ), ...this.copies];
    }
}
//# sourceMappingURL=clouds.js.map