import { Core } from './core';
import { Ambience } from './ambience';
import { Sfx } from './sfx';
import { Score } from './score';
import { Loop } from './core';
import { Flight } from './flight';
import { CloudAir } from './clouds';
import { Groove } from './groove';
const DEFAULT_VOLUMES = { master: 0.9, music: 0.7, ambience: 0.85, sfx: 0.9 };
export class AudioEngine {
    opts;
    core = null;
    amb = null;
    sfx = null;
    mus = null;
    motorLoop = null;
    fly = null;
    cloud = null;
    space = 'valley';
    spaceHold = 0;
    vol = { ...DEFAULT_VOLUMES };
    readyP = new Promise(() => { });
    paramTimer = 0;
    constructor(opts) {
        this.opts = opts;
    }
    static create(opts = {}) { return new AudioEngine(opts); }
    /** resolves when all pre-rendered sound banks exist (sounds missing before that are simply skipped) */
    get ready() { return this.readyP; }
    resume() {
        if (!this.core) {
            const realtime = !this.opts.context;
            let ctx;
            try {
                ctx = this.opts.context ?? new AudioContext({ latencyHint: 'interactive' });
            }
            catch (err) {
                return Promise.reject(err);
            }
            // resume synchronously inside the user gesture
            const p = typeof AudioContext !== 'undefined' && ctx instanceof AudioContext ? ctx.resume() : Promise.resolve();
            const mode = this.opts.synth ?? (realtime ? 'worker' : 'sync');
            const core = new Core(ctx, this.opts.seed ?? 20261009, mode, !!this.opts.bypassMaster);
            this.core = core;
            this.amb = new Ambience(core);
            this.sfx = new Sfx(core);
            this.fly = new Flight(core);
            this.cloud = new CloudAir(core);
            this.mus = new Score(core, this.opts.seed ?? 20261009);
            const mus = this.mus;
            this.sfx.keyNotes = (lo, hi) => mus.keyNotes(lo, hi);
            this.mus.enabled = this.opts.music !== false;
            this.amb.wildlife = this.opts.wildlife !== false;
            core.mixer.setVolumes(this.vol, 0.01);
            core.mixer.fadeIn(realtime ? 2.5 : 0.25);
            this.readyP = core.synth.loadBank(mode === 'sync', this.opts.bank);
            return p;
        }
        const ctx = this.core.ctx;
        if (typeof AudioContext !== 'undefined' && ctx instanceof AudioContext && ctx.state !== 'running')
            return ctx.resume();
        return Promise.resolve();
    }
    get running() { return !!this.core && this.core.ctx.state === 'running'; }
    setVolumes(v) {
        this.vol = { ...this.vol, ...v };
        this.core?.mixer.setVolumes(this.vol);
    }
    update(dt, s) {
        const c = this.core;
        if (!c)
            return;
        if (c.ctx.state === 'closed')
            return;
        dt = Math.min(Math.max(dt, 0), 0.25);
        c.setListener(s.camPos, s.camFwd, s.camUp, s.playerPos);
        // reverb space from the environment (dense forest near the ground vs the open valley), with hysteresis
        const env = this.amb.env;
        this.spaceHold -= dt;
        const want = s.forest === undefined && s.altitude === undefined ? (s.scene === 'river' ? 'forest' : 'valley')
            : env.forest > 0.62 && env.alt < 15 ? 'forest' : env.forest < 0.45 || env.alt > 30 ? 'valley' : this.space;
        if (want !== this.space && this.spaceHold <= 0) {
            this.space = want;
            this.spaceHold = 6;
        }
        c.mixer.setScene(this.space === 'forest' ? 'river' : 'lake');
        this.sfx.echoScale = 0.45 + 0.55 * env.open;
        // (the muffle follows the eased amount; only re-automated when it has moved)
        const uw = Math.min(Math.max(s.underwater, 0), 1);
        if (Math.abs(uw - this.lastUnder) > 0.015 || (uw !== this.lastUnder && (uw === 0 || uw === 1))) {
            this.lastUnder = uw;
            c.mixer.setUnderwater(uw, s.depth ?? 0);
        }
        this.sfx.update(dt, s);
        // ambience parameters don't need 60 Hz automation
        this.paramTimer += dt;
        if (this.paramTimer >= 1 / 30) {
            this.amb.update(this.paramTimer, s);
            this.paramTimer = 0;
        }
        this.fly.update(dt, s);
        this.cloud.update(dt, s);
        this.mus.advTarget = this.fly.intensity;
        this.mus.update(dt, s);
        c.sweep();
        c.mixer.tick(c.now);
    }
    lastUnder = 0;
    event(e) {
        const c = this.core;
        if (!c)
            return;
        if (e.type === 'sceneChange') {
            c.mixer.setScene(e.scene);
            return;
        }
        if (e.type === 'call') {
            this.amb.gameCall(e.species, e.pos);
            return;
        }
        if (e.type === 'flyStart' || e.type === 'flyStop' || e.type === 'skim') {
            this.fly.event(e);
            return;
        }
        if (e.type === 'cloudDraw') {
            this.cloud.event(e);
            return;
        }
        if (e.type === 'music') {
            if (e.action === 'start')
                this.mus?.startNow();
            else
                this.mus?.restNow(e.secs ?? 8);
            return;
        }
        this.sfx.event(e);
    }
    /** the score's stings: a star taken, a star home, a constellation whole, the finale */
    cue(kind) { this.mus?.cue(kind); }
    /** the glove's magic and the world's creatures: one-shots from the bank, placed in the world */
    magic(kind, pos, o = {}) {
        const c = this.core;
        if (!c)
            return;
        const r = c.rng;
        const spec = {
            cast: { key: 'mg.zing', gain: 0.32, ref: 4, rev: 0.25, rate: [0.94, 1.08], group: 'misc' },
            catch: { key: r.chance(0.5) ? 'mg.thrum' : 'mg.thrumHi', gain: 0.5, ref: 6, rev: 0.35, rate: [0.97, 1.03], group: 'misc' },
            zip: { key: 'mg.zip', gain: 0.45, ref: 4, rev: 0.15, rate: [0.95, 1.1], group: 'misc' },
            fling: { key: 'mg.fling', gain: 0.5, ref: 4, rev: 0.15, rate: [0.9, 1.05], group: 'misc' },
            seed: { key: 'mg.pop', gain: 0.4, ref: 5, rev: 0.3, rate: [0.9, 1.12], group: 'misc' },
            bounce: { key: 'mg.boing', gain: 0.55, ref: 6, rev: 0.35, rate: [0.92, 1.08], group: 'misc' },
            star: { key: 'mg.shimmer', gain: 0.45, ref: 6, rev: 0.6, group: 'misc' },
            rise: { key: 'mg.home', gain: 0.5, ref: 8, rev: 0.7, group: 'misc' },
            ray: { key: r.chance(0.6) ? 'mg.ray' : 'mg.rayHi', gain: 0.9, ref: 60, rev: 0.6, echo: 0.4, rate: [0.9, 1.1], group: 'bird' },
        };
        const sp = spec[kind];
        const buf = c.synth.get(sp.key, r);
        const rate = (o.rate ?? 1) * (sp.rate ? r.range(sp.rate[0], sp.rate[1]) : 1);
        c.play(buf, { bus: 'sfx', pos, gain: sp.gain * (o.gain ?? 1), ref: sp.ref, rev: sp.rev, echo: sp.echo, rate, group: sp.group });
    }
    /** a one-shot from the bank (a game's own sounds): positional when pos is given */
    play(key, o = {}) {
        const c = this.core;
        if (!c)
            return;
        const buf = c.synth.get(key, c.rng);
        c.play(buf, { bus: 'sfx', pos: o.pos ?? null, gain: o.gain ?? 1, rate: o.rate ?? 1, ref: o.ref ?? 10, rev: o.rev ?? 0.2, echo: o.echo, pan: o.pan, group: o.group ?? 'misc', when: o.delay ? c.now + o.delay : undefined, lp: o.lp });
    }
    /** a named loop (a game's engine hum, a rocket's hiss): created on first use, its level, rate, filter and position set every frame */
    loops = new Map();
    loop(key, level, o = {}) {
        const c = this.core;
        if (!c)
            return;
        let L = this.loops.get(key);
        if (!L) {
            const buf = c.synth.get(key);
            if (!buf)
                return;
            L = new Loop(c, buf, { bus: 'sfx', positional: !!o.pos, filter: 'lowpass', freq: o.freq ?? 8000, q: 0.6, rev: o.rev ?? 0.1 });
            this.loops.set(key, L);
        }
        if (o.pos)
            L.pos(o.pos, 0.03);
        L.set(level, 0.08);
        if (o.rate)
            L.rate(o.rate, 0.08);
        if (o.freq)
            L.freq(o.freq, 0.1);
    }
    /** the rover's motor: on while driving, its pitch and level following the speed (m/s) */
    motor(on, speed = 0, pos) {
        const c = this.core;
        if (!c)
            return;
        if (on && !this.motorLoop) {
            const buf = c.synth.get('loop.motor');
            if (buf)
                this.motorLoop = new Loop(c, buf, { bus: 'sfx', positional: true, filter: 'lowpass', freq: 2500, q: 0.6, rev: 0.1 });
        }
        const L = this.motorLoop;
        if (!L)
            return;
        if (pos)
            L.pos(pos, 0.05);
        L.set(on ? 0.12 + Math.min(speed / 25, 1) * 0.25 : 0, 0.15);
        L.rate(0.7 + Math.min(speed / 22, 1.3) * 0.9, 0.1);
        L.freq(900 + speed * 90, 0.2);
    }
    suspend() {
        const ctx = this.core?.ctx;
        if (ctx && typeof AudioContext !== 'undefined' && ctx instanceof AudioContext && ctx.state === 'running')
            void ctx.suspend();
    }
    // ------------------------------------------------------------------ optional extras
    /** the underlying context (null before resume) */
    get context() { return this.core?.ctx ?? null; }
    /** trigger a wildlife call now (audition / scripted moments) */
    debugCall(name, dist) { this.amb?.debugCall(name, dist === undefined ? undefined : dist > 0 ? dist : Ambience.typicalDist(name)); }
    /** music control: rest for `secs` seconds, or start the next piece right away */
    musicRest(secs) { this.mus?.restNow(secs); }
    musicStart() { this.mus?.startNow(); }
    /** receive a textual score of what the composer plays (debug) */
    musicLog(fn) { if (this.mus)
        this.mus.log = fn; }
    stats() {
        const c = this.core;
        if (!c)
            return null;
        return {
            voices: c.activeVoices, started: c.stats.started, stolen: c.stats.stolen, peakVoices: c.stats.peakVoices,
            bankMs: c.synth.bankMs, bankMB: c.synth.bankBytes / 1048576, music: this.mus?.state, layers: { ...this.amb?.layerLevels(), ...this.fly?.levels(), ...this.cloud?.levels() },
            reduction: c.mixer.limiter ? (c.mixer.comp.reduction + c.mixer.limiter.reduction) : 0,
        };
    }
    /** an AnalyserNode on the final output (metering in tools) */
    analyser() {
        const c = this.core;
        if (!c)
            return null;
        if (!this.an) {
            this.an = c.ctx.createAnalyser();
            this.an.fftSize = 2048;
            c.mixer.master.connect(this.an);
        }
        return this.an;
    }
    an = null;
    /** for games without the world's ambience: just place the listener (and tidy finished voices) each frame */
    listen(camPos, camFwd, camUp) {
        const c = this.core;
        if (!c || c.ctx.state === 'closed')
            return;
        c.setListener(camPos, camFwd, camUp, camPos);
        c.sweep();
        c.mixer.tick(c.now);
    }
    // ------------------------------------------------------------------ the groove (the bright games' band)
    grv = null;
    /** run the groove this frame (its sounds come from GROOVE_BANK in the game's bank): energy 0..1 */
    groove(dt, energy) {
        const c = this.core;
        if (!c)
            return;
        if (!this.grv)
            this.grv = new Groove(c, this.opts.seed ?? 20261009);
        this.grv.update(Math.min(Math.max(dt, 0), 0.25), energy);
        c.sweep();
        c.mixer.tick(c.now);
    }
    grooveCue(kind) { this.grv?.cue(kind); }
    /** a marimba blip in the groove's chord, between lo and hi (MIDI) */
    grooveBlip(lo, hi, gain = 0.3, pan = 0) { const g = this.grv; if (g)
        g.blip(g.noteFor(lo, hi), gain, pan); }
    get grooveState() { return this.grv?.state ?? null; }
    /** tear everything down */
    async dispose() {
        const c = this.core;
        if (!c)
            return;
        c.synth.dispose();
        if (typeof AudioContext !== 'undefined' && c.ctx instanceof AudioContext)
            await c.ctx.close();
        this.core = null;
    }
}
//# sourceMappingURL=engine.js.map