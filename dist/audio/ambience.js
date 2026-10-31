import { LayerSet, dist3 } from './core';
import { clamp, hashSeed, sstep } from './synth/dsp';
const bump = (x, c, w) => Math.max(0, 1 - Math.abs(x - c) / w);
const hourBump = (h, c, w) => Math.max(bump(h, c, w), bump(h + 24, c, w), bump(h - 24, c, w));
const CALLS = {
    thrush: { kind: 'thrush', ref: 14, gain: 0.33, dist: [25, 90], elev: [4, 14], echo: 0.12, rev: 0.45 },
    chickadee: { kind: 'chickadee', ref: 8, gain: 0.093, dist: [10, 45], elev: [3, 9], echo: 0.05, rev: 0.3 },
    chickadeeCall: { kind: 'chickadeeCall', ref: 8, gain: 0.24, dist: [8, 40], elev: [2, 8], echo: 0.05, rev: 0.3 },
    woodpecker: { kind: 'woodpecker', ref: 20, gain: 0.42, dist: [35, 140], elev: [5, 15], echo: 0.25, rev: 0.4 },
    raven: { kind: 'raven', ref: 30, gain: 0.83, dist: [50, 200], elev: [20, 70], echo: 0.25, rev: 0.4 },
    hawk: { kind: 'hawk', ref: 90, gain: 0.14, dist: [180, 500], elev: [80, 200], echo: 0.45, rev: 0.5 },
    eagle: { kind: 'eagle', ref: 60, gain: 0.3, dist: [120, 350], elev: [40, 150], echo: 0.35, rev: 0.45 },
    loonWail: { kind: 'loonWail', ref: 90, gain: 0.1, dist: [150, 550], elev: [0, 1], echo: 0.55, rev: 0.55, water: true },
    loonTremolo: { kind: 'loonTremolo', ref: 90, gain: 0.14, dist: [150, 500], elev: [0, 1], echo: 0.5, rev: 0.55, water: true },
    loonYodel: { kind: 'loonYodel', ref: 100, gain: 0.095, dist: [200, 600], elev: [0, 1], echo: 0.55, rev: 0.55, water: true },
    owl: { kind: 'owl', ref: 45, gain: 0.2, dist: [60, 220], elev: [6, 18], echo: 0.25, rev: 0.5 },
    wolf: { kind: 'wolf', ref: 250, gain: 0.06, dist: [700, 1400], elev: [50, 200], echo: 0.6, rev: 0.6, params: () => ({ n: 1 }) },
    dipper: { kind: 'dipper', ref: 14, gain: 0.17, dist: [12, 50], elev: [0, 1.5], echo: 0.05, rev: 0.3, water: true },
    kingfisher: { kind: 'kingfisher', ref: 20, gain: 0.35, dist: [20, 90], elev: [2, 10], echo: 0.08, rev: 0.3 },
    robin: { kind: 'robin', ref: 14, gain: 0.16, dist: [18, 70], elev: [4, 12], echo: 0.05, rev: 0.35 },
    warbler: { kind: 'warbler', ref: 10, gain: 0.22, dist: [15, 55], elev: [4, 14], echo: 0.03, rev: 0.3 },
    chorusFrog: { kind: 'chorusFrog', ref: 5, gain: 0.35, dist: [8, 40], elev: [0, 0.5], echo: 0, rev: 0.3, water: true },
    toad: { kind: 'toad', ref: 6, gain: 0.125, dist: [15, 60], elev: [0, 0.5], echo: 0, rev: 0.35 },
    greenFrog: { kind: 'greenFrog', ref: 6, gain: 0.4, dist: [8, 35], elev: [0, 0.5], echo: 0, rev: 0.3, water: true },
    osprey: { kind: 'osprey', ref: 60, gain: 0.14, dist: [80, 300], elev: [20, 80], echo: 0.35, rev: 0.45 },
    merganser: { kind: 'merganser', ref: 20, gain: 0.37, dist: [20, 120], elev: [0, 0.5], echo: 0.1, rev: 0.35, water: true },
    goose: { kind: 'goose', ref: 60, gain: 0.27, dist: [60, 300], elev: [0, 40], echo: 0.35, rev: 0.45 },
    elk: { kind: 'elk', ref: 150, gain: 0.067, dist: [200, 700], elev: [0, 30], echo: 0.5, rev: 0.55 },
    elkAlarm: { kind: 'elkAlarm', ref: 60, gain: 0.31, dist: [40, 200], elev: [0, 10], echo: 0.3, rev: 0.45 },
    marmot: { kind: 'marmot', ref: 60, gain: 0.088, dist: [40, 200], elev: [0, 20], echo: 0.35, rev: 0.45 },
    dipperCall: { kind: 'dipperCall', ref: 14, gain: 0.23, dist: [10, 40], elev: [0, 1.5], echo: 0.05, rev: 0.3, water: true },
    kinglet: { kind: 'kinglet', ref: 8, gain: 0.11, dist: [8, 30], elev: [5, 15], echo: 0.03, rev: 0.3 },
    sparrow: { kind: 'sparrow', ref: 10, gain: 0.11, dist: [10, 50], elev: [1, 6], echo: 0.03, rev: 0.3 },
    junco: { kind: 'junco', ref: 10, gain: 0.086, dist: [10, 50], elev: [1, 8], echo: 0.03, rev: 0.3 },
    pika: { kind: 'pika', ref: 12, gain: 0.4, dist: [15, 80], elev: [0, 4], echo: 0.15, rev: 0.35 },
};
/** game 'call' species -> renderer choice (+ the spontaneous-ambience channel it replaces) */
const SPECIES = {
    junco: { calls: ['junco'], channel: 'smallbird' }, raven: { calls: ['raven'], channel: 'raven' },
    eagle: { calls: ['eagle'], channel: 'raptor' }, osprey: { calls: ['osprey'], channel: 'raptor' },
    loon: { calls: ['loonWail', 'loonTremolo', 'loonYodel'], weights: [0.5, 0.4, 0.1], channel: 'loon' },
    merganser: { calls: ['merganser'], channel: 'duck' }, goose: { calls: ['goose'], channel: 'goose' },
    elk: { calls: ['elk'], channel: 'elk' }, elkAlarm: { calls: ['elkAlarm'], channel: 'elk' }, marmot: { calls: ['marmot'], channel: 'marmot' },
    dipper: { calls: ['dipper', 'dipperCall'], weights: [0.4, 0.6], channel: 'dipper' }, owl: { calls: ['owl'], channel: 'owl' },
    thrush: { calls: ['thrush'], channel: 'thrush' }, chickadee: { calls: ['chickadee', 'chickadeeCall'], weights: [0.55, 0.45], channel: 'chickadee' },
    kinglet: { calls: ['kinglet'], channel: 'smallbird' }, sparrow: { calls: ['sparrow'], channel: 'smallbird' },
    pika: { calls: ['pika'], channel: 'pika' },
};
/** spontaneous-ambience poisson keys -> species channel (for suppression while the game voices that channel) */
const CHANNEL_OF = { thrush: 'thrush', chickadee: 'chickadee', raven: 'raven', raptor: 'raptor', loon: 'loon', owl: 'owl', dipper: 'dipper', warbler: 'smallbird', marmot: 'marmot', pika: 'pika' };
export class Ambience {
    core;
    layers;
    scene = 'lake';
    wind = 0;
    uw = 0;
    gustPh;
    crickets = [];
    sessions = [];
    s = null;
    frogBout = 0;
    wildlife = true;
    /** last time (ctx seconds) the game voiced a species channel; spontaneous ambience of that channel is suppressed for 60 s */
    gameVoiced = new Map();
    time = 0;
    dt = 0.016;
    constructor(core) {
        this.core = core;
        this.layers = new LayerSet(core);
        this.gustPh = Array.from({ length: 12 }, () => core.rng.range(0, 100));
    }
    /** slow pseudo-random 0..1 signals for gusts */
    n(i, t, speed = 1) {
        const p = this.gustPh;
        const v = Math.sin(0.23 * speed * t + p[i]) + 0.6 * Math.sin(0.57 * speed * t + p[i + 1]) + 0.35 * Math.sin(1.31 * speed * t + p[i + 2]);
        return clamp(0.5 + v / 3.9, 0, 1);
    }
    /** environment descriptors shared with the engine (reverb space, echo amount) */
    env = { forest: 0.45, open: 0.55, high: 0, alt: 0, lake: 0, river: 0 };
    update(dt, s) {
        this.s = s;
        const c = this.core;
        this.time += dt;
        this.dt = Math.min(0.25, Math.max(0, dt));
        this.layers.dt = this.dt;
        const k = (tau) => 1 - Math.exp(-dt / tau);
        this.scene = s.scene;
        this.wind += (clamp(s.wind, 0, 1) - this.wind) * k(0.4);
        this.uw += (clamp(s.underwater, 0, 1) - this.uw) * k(0.05);
        const deep = sstep(1, 12, s.depth ?? 0);
        const dry = 1 - 0.85 * this.uw; // surface beds duck when the head goes under (they also get low-passed)
        const night = clamp(s.nightness, 0, 1), day = 1 - night;
        const T = this.time;
        const lp0 = c.listener.pos;
        // ---------------- continuous environment (one connected world; `scene` is only a legacy hint)
        const e = this.env;
        e.forest += (clamp(s.forest ?? (s.scene === 'river' ? 0.8 : 0.45), 0, 1) - e.forest) * k(1.5);
        e.alt += (Math.max(0, s.altitude ?? 0) - e.alt) * k(0.5);
        e.high = sstep(12, 80, e.alt);
        e.open = clamp(Math.max(1 - e.forest, e.high), 0, 1);
        const F = e.forest, open = e.open, high = e.high, ground = 1 - 0.85 * high;
        const altAtt = 1 / (1 + e.alt / 12);
        // 3D distances when the nearest points are known (flight), else horizontal distance combined with altitude
        const dS = s.shoreNearest ? dist3(lp0, s.shoreNearest) : Math.hypot(Math.max(0, s.distToShore), e.alt);
        const rdRaw = Number.isFinite(s.riverDist) ? Math.max(0, s.riverDist) : 1e4;
        const rd = s.riverNearest ? Math.min(dist3(lp0, s.riverNearest), Math.hypot(rdRaw, e.alt)) : Math.hypot(rdRaw, e.alt);
        e.lake = 1 / (1 + Math.pow(dS / 150, 2));
        e.river = Math.exp(-rd / 80);
        // ---------------- wind: trees sough in the forest; the open valley (and altitude) gets the broad low wind and howl
        const w = this.wind;
        const gL = w * (0.5 + 0.5 * this.n(0, T)), gR = w * (0.5 + 0.5 * this.n(3, T));
        const gust = 0.5 * (gL + gR);
        const L = this.layers;
        for (const [key, g, pan, off] of [['windLowL', gL, -0.5, 0.1], ['windLowR', gR, 0.5, 0.6]]) {
            L.layer(key, 'noise.brown', { bus: 'amb', filter: 'lowpass', freq: 300, q: 0.5, pan, offset: off }, (0.006 + 0.07 * Math.pow(g, 1.2)) * (0.7 + 0.6 * open) * dry, 0.25)?.freq(120 + 260 * g, 0.3);
        }
        for (const [key, g, pan, off] of [['soughL', gL, -0.75, 0.2], ['soughR', gR, 0.75, 0.7]]) {
            L.layer(key, 'noise.pink', { bus: 'amb', filter: 'bandpass', freq: 500, q: 0.8, pan, offset: off, rev: 0.15 }, (0.035 + 0.22 * Math.pow(g, 1.3)) * (0.75 + 0.4 * F * ground) * dry, 0.2)?.freq(320 + 900 * g, 0.25);
        }
        for (const [key, g, pan, off] of [['needlesL', gL, -0.6, 0.3], ['needlesR', gR, 0.6, 0.8]]) {
            L.layer(key, 'noise.white', { bus: 'amb', filter: 'highpass', freq: 2600, q: 0.5, filter2: 'lowpass', freq2: 9000, pan, offset: off }, (0.04 + 0.1 * F) * ground * Math.pow(g, 1.8) * dry, 0.15);
        }
        L.layer('howl', 'noise.pink', { bus: 'amb', filter: 'bandpass', freq: 420, q: 9, rev: 0.4, offset: 0.4 }, 0.06 * open * clamp((w - 0.45) * 2 + 0.5 * high, 0, 1) * this.n(6, T, 1.7) * dry, 0.4)?.freq(320 + 260 * this.n(7, T, 0.8), 0.5);
        L.layer('rustle', 'loop.rustle', { bus: 'amb', filter: 'highpass', freq: 700, q: 0.5, rev: 0.12 }, (0.08 + 0.36 * F) * ground * (0.08 + 0.92 * Math.pow(gust, 1.4)) * dry, 0.25);
        // high above the valley: a thin airy spaciousness
        L.layer('airHigh', 'noise.pink', { bus: 'amb', filter: 'bandpass', freq: 2600, q: 0.45, rev: 0.6, offset: 0.55 }, 0.02 * high * (0.6 + 0.4 * w) * dry, 0.6);
        // ---------------- lake shore
        const prox = 1 / (1 + Math.pow(dS / 5, 1.5));
        const chop = clamp(w * 1.25 + 0.3 * high, 0, 1);
        const lapLevel = (0.55 * prox + 0.07 * e.lake) * (0.4 + 0.6 * altAtt) * dry;
        const shoreShare = s.shoreNearest ? 0.5 : 0;
        L.layer('lapCalm', 'loop.lapCalm', { bus: 'amb', rev: 0.12, filter: 'highpass', freq: 70, q: 0.6 }, lapLevel * (1 - 0.75 * chop) * (1 - shoreShare), 0.3);
        L.layer('lapChoppy', 'loop.lapChoppy', { bus: 'amb', rev: 0.12, filter: 'highpass', freq: 70, q: 0.6 }, lapLevel * (0.15 + chop) * (1 - shoreShare), 0.3);
        const lapP = L.layer('lapPos', chop > 0.5 ? 'loop.lapChoppy' : 'loop.lapCalm', { bus: 'amb', positional: true, rev: 0.1, filter: 'highpass', freq: 70, q: 0.6, offset: 0.45 }, lapLevel * (0.6 + 0.4 * chop) * shoreShare * 1.4, 0.3);
        if (s.shoreNearest)
            lapP?.pos(s.shoreNearest, 0.15);
        // ---------------- the sea (Starthread): sets of swells breaking along the shore — a low body that rises with each
        // wave, the hiss of the wash running up the sand after it breaks; a distant roar off the reefs
        {
            const surfProx = 1 / (1 + Math.pow(dS / 30, 1.3));
            const per = 8.5;
            const ph = (T / per) % 1, ph2 = ((T + 3.1) / (per * 1.37)) % 1;
            const crash = Math.pow(Math.max(0, Math.sin(Math.PI * ph)), 5) * (0.75 + 0.25 * this.n(11, T, 0.1));
            const crash2 = Math.pow(Math.max(0, Math.sin(Math.PI * ph2)), 6) * 0.6;
            const wash = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (ph - 0.45) * 2.2))));
            const lvl = surfProx * (0.4 + 0.6 * altAtt) * dry * (0.7 + 0.5 * chop);
            L.layer('surfBody', 'noise.brown', { bus: 'amb', filter: 'lowpass', freq: 420, q: 0.6, rev: 0.25, offset: 0.2 }, lvl * (0.06 + 0.5 * (crash + crash2)), 0.35)?.freq(250 + 500 * crash, 0.3);
            L.layer('surfCrash', 'noise.pink', { bus: 'amb', filter: 'bandpass', freq: 900, q: 0.5, rev: 0.3, offset: 0.5, pan: -0.2 }, lvl * 0.35 * (crash + 0.7 * crash2), 0.25)?.freq(600 + 900 * crash, 0.25);
            L.layer('surfWash', 'noise.white', { bus: 'amb', filter: 'highpass', freq: 2200, q: 0.5, filter2: 'lowpass', freq2: 9000, rev: 0.2, offset: 0.7, pan: 0.25 }, lvl * 0.12 * wash, 0.3);
            // far off: the reefs and headlands, always faintly there
            L.layer('seaFar', 'noise.brown', { bus: 'amb', filter: 'lowpass', freq: 260, q: 0.5, rev: 0.5, offset: 0.9 }, (0.035 + 0.04 * chop) * dry * (0.5 + 0.5 * altAtt), 0.8);
        }
        // an explicit distant falls/creek (optional)
        if (s.distantFallsPos) {
            const fp = s.distantFallsPos;
            const d = dist3(fp, lp0);
            const df = L.layer('distFalls', 'loop.fallsRoar', { bus: 'amb', positional: true, filter: 'lowpass', freq: 900, q: 0.5, rev: 0.6, offset: 0.33 }, 0.5 * c.distGain(d, 40, 1, 0.04) * dry, 0.5);
            df?.pos(fp, 0.2);
            df?.freq(Math.min(2500, c.airLp(d) * 0.4), 0.5);
        }
        else
            L.layer('distFalls', 'loop.fallsRoar', { bus: 'amb' }, 0);
        // ---------------- creeks / river: timbre and level by (3D) distance and flow speed
        const spd = clamp(s.riverSpeed / 3, 0, 1.4);
        const level = (0.35 + 0.65 * spd) * dry * (rd < 3000 ? 1 : 0);
        const A = Math.sqrt(4 / Math.max(4, rd)); // line source: -3 dB per doubling
        const hasPos = !!s.riverNearest;
        const rumble = 0.075 * level * Math.sqrt(10 / Math.max(10, rd));
        for (const [key, pan, off] of [['riverRumbleL', -0.6, 0.15], ['riverRumbleR', 0.6, 0.65]]) {
            L.layer(key, 'noise.brown', { bus: 'amb', filter: 'lowpass', freq: 300, q: 0.6, pan, offset: off }, rumble, 0.3)?.freq(420 - 220 * clamp(rd / 90, 0, 1), 0.4);
        }
        const bodyLp = Math.max(500, 9500 / (1 + rd / 11));
        const near = Math.exp(-rd / 5);
        const posShare = hasPos ? 0.55 : 0;
        L.layer('riverBody', 'loop.riverBody', { bus: 'amb', filter: 'lowpass', freq: 6000, q: 0.5, filter2: 'highpass', freq2: 90, q2: 0.6, rev: 0.2 }, 0.5 * level * A * (1 - posShare), 0.3)?.freq(bodyLp, 0.3);
        const bodyP = L.layer('riverBodyPos', 'loop.riverBody', { bus: 'amb', positional: true, filter: 'lowpass', freq: 6000, q: 0.5, filter2: 'highpass', freq2: 90, q2: 0.6, rev: 0.15, offset: 0.5 }, 0.5 * level * A * posShare * 1.3, 0.3);
        bodyP?.freq(bodyLp, 0.3);
        L.layer('riverDetail', 'loop.riverDetail', { bus: 'amb', filter: 'lowpass', freq: 12000, q: 0.5, rev: 0.1 }, 0.85 * level * near * (1 - posShare), 0.25)?.freq(Math.max(2500, 14000 / (1 + rd / 8)), 0.3);
        const detailP = L.layer('riverDetailPos', 'loop.riverDetail', { bus: 'amb', positional: true, filter: 'lowpass', freq: 12000, q: 0.5, rev: 0.08, offset: 0.4 }, 0.85 * level * near * posShare * 1.3, 0.25);
        if (hasPos) {
            bodyP?.pos(s.riverNearest, 0.15);
            detailP?.pos(s.riverNearest, 0.15);
        }
        // ---------------- nearest waterfall: roar scaled by its height and distance
        const wf = s.waterfallPos;
        const fd = wf ? dist3(wf, lp0) : 1e4;
        const fallsOn = wf ? dry : 0;
        const hs = clamp((s.waterfallHeight ?? 15) / 15, 0.2, 4);
        const fref = 12 * Math.sqrt(hs);
        const roar = L.layer('fallsRoar', 'loop.fallsRoar', { bus: 'amb', positional: true, filter: 'lowpass', freq: 16000, q: 0.5, filter2: 'highpass', freq2: 150, q2: 0.6, rev: 0.35, echo: 0.05 }, fallsOn * 0.55 * Math.sqrt(hs) * c.distGain(fd, fref, 1), 0.3);
        if (roar && wf) {
            roar.pos(wf, 0.1);
            roar.freq(Math.min(16000, c.airLp(fd) * 0.8 / (1 + fd / 150)), 0.3);
            roar.rev(0.35 + 0.3 * clamp(fd / 80, 0, 1), 0.5);
            roar.rate(clamp(1.12 - 0.12 * Math.log2(hs), 0.85, 1.25), 0.5); // bigger falls sound deeper
        }
        L.layer('fallsMist', 'loop.fallsMist', { bus: 'amb', rev: 0.1 }, fallsOn * 0.5 * Math.exp(-fd / (14 * Math.sqrt(hs))), 0.3);
        L.layer('fallsDiffuse', 'loop.riverBody', { bus: 'amb', filter: 'lowpass', freq: 3500, q: 0.5, filter2: 'highpass', freq2: 220, q2: 0.6, offset: 0.1 }, fallsOn * 0.25 * Math.exp(-fd / (22 * Math.sqrt(hs))), 0.3);
        L.layer('fallsRumble', 'noise.brown', { bus: 'amb', filter: 'lowpass', freq: 110, q: 0.7, offset: 0.9 }, fallsOn * 0.06 * hs * c.distGain(fd, 18 * Math.sqrt(hs), 1), 0.3);
        // ---------------- under water (past the muffle: these are heard from inside the water): the low pressure bed, a
        // darker hush deeper down; the lake's slow surges; now and then a far bubble cluster or a stone settling
        const av = this.uw * c.mixer.volumes.ambience;
        L.layer('underwater', 'loop.underwater', { bus: 'amb', dest: c.mixer.sum, filter: 'lowpass', freq: 1800, q: 0.6 }, av * (0.5 + 0.15 * deep), 0.05)?.freq(1800 - 900 * deep, 0.3);
        L.layer('uwSwell', 'loop.uwSwell', { bus: 'amb', dest: c.mixer.sum, offset: 0.3 }, av * 0.42 * (1 - 0.4 * deep), 0.08);
        if (this.uw > 0.5) {
            if (this.poisson('uwBubbles', 9))
                c.play(c.synth.get('bubbles.s', c.rng), { bus: 'amb', dest: c.mixer.sum, pan: c.rng.sym() * 0.8, gain: c.rng.range(0.03, 0.08) * av, rate: c.rng.range(0.7, 1.1), lp: 1600, group: 'drop' });
            if (this.poisson('uwKnock', 2.2))
                c.play(c.synth.get('uw.knock', c.rng), { bus: 'amb', dest: c.mixer.sum, pan: c.rng.sym() * 0.9, gain: c.rng.range(0.03, 0.07) * av, rate: c.rng.range(0.8, 1.15), group: 'misc' });
        }
        // ---------------- crickets (ground level)
        const temp = s.temperatureC ?? this.temperature(s);
        const dusk = hourBump(s.hour, 20, 2);
        const activity = clamp(night * sstep(5.5, 11, temp) + 0.25 * dusk * sstep(8, 12, temp), 0, 1) * dry * ground;
        const bed = L.layer('cricketBed', 'loop.crickets', { bus: 'amb', rev: 0.25, filter: 'lowpass', freq: 6000, q: 0.5 }, activity * (0.06 + 0.04 * F), 1.5);
        bed?.rate(clamp(0.93 + 0.012 * (temp - 12), 0.85, 1.08), 2);
        this.updateCrickets(activity * altAtt, temp);
        // ---------------- wildlife
        this.updateWildlife(s, day, night);
    }
    /** air temperature model: alpine lake is cold at night, the forest river a little milder */
    temperature(s) {
        const dayCurve = Math.max(0, Math.sin((Math.PI * (s.hour - 6)) / 14));
        return 9 + 9 * dayCurve + 1.5 * this.env.forest - 0.008 * this.env.alt;
    }
    updateCrickets(activity, temp) {
        const c = this.core;
        const want = activity > 0.03 ? 6 : 0;
        const lp = c.listener.player;
        while (this.crickets.length < want) {
            const g = c.ctx.createGain();
            g.gain.value = 0;
            const p = c.makePanner(false);
            g.connect(p).connect(c.mixer.amb.dry);
            const cr = { panner: p, gain: g, pos: [0, 0, 0], next: c.now + c.rng.range(0, 2), tree: c.rng.chance(0.35), buf: c.rng.int(0, 3), pitch: c.rng.range(0.97, 1.03) };
            this.placeCricket(cr);
            this.crickets.push(cr);
        }
        if (want === 0 && this.crickets.length) {
            for (const cr of this.crickets) {
                cr.gain.gain.setTargetAtTime(0, c.now, 0.5);
            }
            if (activity <= 0.005) {
                for (const cr of this.crickets) {
                    cr.panner.disconnect();
                    cr.gain.disconnect();
                }
                this.crickets = [];
            }
            return;
        }
        // Dolbear: chirps/min = 40 + 4 (F - 50)  (F = 1.8 C + 32)
        const perMin = Math.max(8, 40 + 4 * (temp * 1.8 + 32 - 50));
        const rate = perMin / 60;
        const tNow = c.now;
        for (const cr of this.crickets) {
            if (dist3(cr.pos, lp) > 45)
                this.placeCricket(cr);
            const d = c.attenDist(cr.pos);
            c.set(cr.gain.gain, activity * 0.07 * c.distGain(d, 4, 1), 0.5);
            if (cr.next < tNow - 1)
                cr.next = tNow + c.rng.range(0, 1);
            while (cr.next < tNow + 0.25) {
                const buf = c.synth.all(cr.tree ? 'cricket.tree' : 'cricket.field')[cr.buf % Math.max(1, c.synth.all(cr.tree ? 'cricket.tree' : 'cricket.field').length)];
                if (buf) {
                    const src = c.ctx.createBufferSource();
                    src.buffer = buf;
                    src.playbackRate.value = cr.pitch * clamp(0.9 + 0.012 * (temp - 8), 0.85, 1.1);
                    src.connect(cr.gain);
                    src.start(cr.next);
                    src.onended = () => src.disconnect();
                }
                cr.next += (1 / (rate * (cr.tree ? 1.4 : 1))) * c.rng.range(0.96, 1.04);
            }
        }
    }
    placeCricket(cr) {
        const c = this.core;
        const lp = c.listener.player;
        const a = c.rng.range(0, Math.PI * 2), d = c.rng.range(5, 30);
        cr.pos = [lp[0] + Math.cos(a) * d, lp[1] + c.rng.range(-0.5, 0.5), lp[2] + Math.sin(a) * d];
        c.setPannerPos(cr.panner, cr.pos);
    }
    // ------------------------------------------------------------------ wildlife
    around(spec) {
        const c = this.core;
        const lp = c.listener.pos;
        const a = c.rng.range(0, Math.PI * 2);
        const d = c.rng.log(spec.dist[0], spec.dist[1]);
        let base = lp;
        if (spec.water) {
            const st = this.s;
            if (st?.riverNearest && this.env.river > this.env.lake)
                base = st.riverNearest;
            else if (st?.shoreNearest)
                base = st.shoreNearest;
        }
        const groundY = lp[1] - (this.env.alt > 0 ? this.env.alt : spec.water ? 1.6 : 0);
        return [base[0] + Math.cos(a) * d, groundY + c.rng.range(spec.elev[0], spec.elev[1]), base[2] + Math.sin(a) * d];
    }
    /** request a fresh render of a call and play it at pos */
    call(name, pos, gainMul = 1, params) {
        const c = this.core;
        const spec = CALLS[name];
        const p = pos ?? this.around(spec);
        const seed = hashSeed(c.rng.next() * 1e9, name);
        const echo = spec.echo * (0.4 + 0.6 * this.env.open);
        const flyby = name === 'raven' && c.rng.chance(0.35);
        const prm = params ?? (flyby ? { flyby: true } : spec.params?.() ?? {});
        void c.synth.render(spec.kind, prm, seed).then((r) => {
            const buf = c.synth.toBuffer(r);
            const move = flyby ? { to: [p[0] + c.rng.range(-60, 60), p[1], p[2] + c.rng.range(-60, 60)], secs: buf.duration } : undefined;
            c.play(buf, { bus: 'amb', pos: p, gain: spec.gain * gainMul * c.rng.range(0.75, 1.1), ref: spec.ref, rev: spec.rev, echo, group: 'bird', rate: c.rng.range(0.97, 1.03), move });
        });
    }
    /** per-frame hazard of a Poisson process (adapts instantly to rate changes); muted while the game voices that channel */
    poisson(key, perMin) {
        const ch = CHANNEL_OF[key];
        if (ch) {
            const t = this.gameVoiced.get(ch);
            if (t !== undefined && this.core.now - t < 60)
                return false;
        }
        return perMin > 0 && this.core.rng.next() < 1 - Math.exp(-(perMin / 60) * this.dt);
    }
    /** a call emitted by the game's wildlife simulation at a real position */
    gameCall(species, pos) {
        const sp = SPECIES[species];
        if (!sp)
            return;
        this.gameVoiced.set(sp.channel, this.core.now);
        const name = sp.calls[sp.weights ? this.core.rng.weighted(sp.weights) : 0];
        this.call(name, pos, 1, name === 'thrush' ? { level: this.core.rng.next() } : undefined);
    }
    updateWildlife(s, day, night) {
        const c = this.core;
        const h = s.hour;
        const dawn = hourBump(h, 6, 1.6), dusk = hourBump(h, 19.5, 1.8);
        const calm = 1 - 0.65 * clamp(this.wind, 0, 1);
        if (s.underwater > 0.5 || !this.wildlife)
            return;
        const { forest: F, open, high, lake, river } = this.env;
        const ground = 1 - 0.8 * high; // small birds are not heard from high above
        const woods = (0.2 + 0.8 * F) * ground; // forest songbirds
        const alpine = open * day; // open slopes / talus
        // sessions (thrush songs / owl series)
        for (let i = this.sessions.length - 1; i >= 0; i--) {
            const ss = this.sessions[i];
            if (c.now >= ss.next) {
                const params = ss.kind === 'thrush' ? { level: (ss.level = (ss.level + c.rng.range(0.25, 0.6)) % 1) } : undefined;
                this.call(ss.kind, ss.pos, 1, params);
                ss.left--;
                ss.next = c.now + c.rng.range(ss.gap[0], ss.gap[1]);
                if (ss.left <= 0)
                    this.sessions.splice(i, 1);
            }
        }
        const session = (kind, n, gap) => {
            if (this.sessions.some((x) => x.kind === kind))
                return;
            this.sessions.push({ kind, left: c.rng.int(n[0], n[1]), next: c.now + 0.05, pos: this.around(CALLS[kind]), gap, level: c.rng.next() });
        };
        // forest
        if (this.poisson('thrush', (0.5 * day + 2.2 * dawn + 2.6 * dusk) * calm * woods))
            session('thrush', [3, 7], [2.5, 5]);
        if (this.poisson('chickadee', 1.2 * day * calm * (1 - dusk) * woods))
            this.call(c.rng.chance(0.6) ? 'chickadee' : 'chickadeeCall');
        if (this.poisson('woodpecker', 0.45 * day * calm * woods * F))
            this.call('woodpecker', undefined, 1, { taps: c.rng.chance(0.3) });
        if (this.poisson('robin', (0.6 * day + 1.8 * dawn + 1.0 * dusk) * calm * woods * F))
            this.call('robin');
        if (this.poisson('warbler', 0.8 * day * calm * woods * F))
            this.call(c.rng.pick(['warbler', 'kinglet', 'junco']));
        if (this.poisson('owl', 0.7 * night * (0.3 + 0.7 * F)))
            session('owl', [2, 4], [7, 13]);
        // open valley / alpine slopes
        if (this.poisson('raven', 0.6 * day * (0.4 + 0.6 * open)))
            this.call('raven');
        if (this.poisson('raptor', 0.25 * day * (0.3 + 0.7 * open) * sstep(8, 10, h) * (1 - sstep(16, 18, h))))
            this.call(c.rng.pick(['hawk', 'eagle', 'osprey']));
        // (Starthread: the mountains' pikas, marmots and wolves aren't on the isles)
        // lakes
        // (Starthread: no loons on the sea; the ospreys fish the lagoon instead)
        if (this.poisson('osprey', 0.3 * day * lake))
            this.call('osprey');
        const loonRate = 0;
        if (loonRate > 0 && this.poisson('loon', loonRate * (0.5 + 0.5 * calm))) {
            const u = c.rng.next();
            this.call(u < 0.5 ? 'loonWail' : u < 0.85 ? 'loonTremolo' : night > 0.5 ? 'loonYodel' : 'loonWail');
        }
        // creeks
        if (this.poisson('dipper', 1.4 * day * river))
            this.call(c.rng.chance(0.6) ? 'dipper' : 'dipperCall');
        if (this.poisson('kingfisher', 0.45 * day * river))
            this.call('kingfisher');
        // frogs: choral bouts near water at night
        const frogs = clamp(night + 0.5 * dusk, 0, 1) * Math.max(river, lake * 0.7) * ground;
        if (frogs > 0.05) {
            if (this.frogBout <= 0 && this.poisson('frogBout', 3 * frogs))
                this.frogBout = c.rng.range(5, 14);
            if (this.frogBout > 0) {
                this.frogBout -= this.dt;
                if (this.poisson('chorusFrog', 70 * frogs))
                    this.call('chorusFrog');
            }
            if (this.poisson('toad', 0.35 * frogs))
                this.call('toad');
            if (this.poisson('greenFrog', 0.9 * frogs))
                this.call('greenFrog');
        }
    }
    /** trigger a call now; `dist` places it straight ahead of the listener at that distance (calibration) */
    debugCall(name, dist) {
        let pos;
        if (dist !== undefined) {
            const spec = CALLS[name];
            const l = this.core.listener;
            const f = l.fwd;
            const n = Math.hypot(f[0], f[2]) || 1;
            pos = [l.pos[0] + (f[0] / n) * dist, l.pos[1] - (spec.water ? 1.6 : 0) + 0.5 * (spec.elev[0] + spec.elev[1]), l.pos[2] + (f[2] / n) * dist];
        }
        this.call(name, pos, 1, name === 'thrush' ? { level: this.core.rng.next() } : undefined);
    }
    /** typical distance of a species (geometric mean of its range) */
    static typicalDist(name) { const d = CALLS[name].dist; return Math.sqrt(d[0] * d[1]); }
    /** a call placed at a given world position (e.g. birds bursting from a tree) */
    callAt(name, pos, gain = 1) { this.call(name, pos, gain); }
    layerLevels() { return this.layers.levels(); }
}
//# sourceMappingURL=ambience.js.map