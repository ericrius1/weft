import { Mixer } from './mixer';
import { SynthService } from './synth-service';
import { Rng, clamp } from './synth/dsp';
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist3 = (a, b) => len3(sub(a, b));
export const GROUP_LIMITS = {
    splash: 10, drop: 10, step: 6, shatter: 4, freeze: 3, crack: 3, whip: 5, draw: 3, wave: 2, melt: 3,
    bird: 7, frog: 8, cricket: 10, music: 48, ui: 4, misc: 8, perc: 16,
};
export class Core {
    ctx;
    rng;
    mixer;
    synth;
    listener = { pos: [0, 1.7, 5], fwd: [0, 0, -1], up: [0, 1, 0], player: [0, 0, 0] };
    voices = [];
    tracked = [];
    groups = new Map();
    paramLast = new WeakMap();
    stats = { started: 0, stolen: 0, peakVoices: 0 };
    constructor(ctx, seed, synthMode, bypassMaster = false) {
        this.ctx = ctx;
        this.rng = new Rng(seed ^ 0x5eed);
        this.synth = new SynthService(ctx, seed, synthMode);
        this.mixer = new Mixer(ctx, this.synth, bypassMaster);
    }
    get now() { return this.ctx.currentTime; }
    bus(id) { return id === 'amb' ? this.mixer.amb : id === 'sfx' ? this.mixer.sfx : id === 'music' ? this.mixer.music : this.mixer.ui; }
    /** attenuation distance: sounds near the player keep a consistent level regardless of camera zoom */
    attenDist(p) {
        return Math.min(dist3(p, this.listener.pos), dist3(p, this.listener.player) + 2.5);
    }
    /** smoothed param set, skipping redundant automation events */
    set(p, v, tau = 0.08, eps = 1e-4) {
        const last = this.paramLast.get(p);
        if (last !== undefined && Math.abs(last - v) <= eps * Math.max(1, Math.abs(v)))
            return;
        this.paramLast.set(p, v);
        p.setTargetAtTime(v, this.now, tau);
    }
    setListener(pos, fwd, up, player) {
        this.listener.pos = pos;
        this.listener.fwd = fwd;
        this.listener.up = up;
        this.listener.player = player;
        const l = this.ctx.listener;
        const t = this.now;
        if (l.positionX) {
            const s = (p, v) => p.setTargetAtTime(v, t, 0.02);
            s(l.positionX, pos[0]);
            s(l.positionY, pos[1]);
            s(l.positionZ, pos[2]);
            s(l.forwardX, fwd[0]);
            s(l.forwardY, fwd[1]);
            s(l.forwardZ, fwd[2]);
            s(l.upX, up[0]);
            s(l.upY, up[1]);
            s(l.upZ, up[2]);
        }
        else {
            const ll = l;
            ll.setPosition(pos[0], pos[1], pos[2]);
            ll.setOrientation(fwd[0], fwd[1], fwd[2], up[0], up[1], up[2]);
        }
    }
    makePanner(hrtf = true) {
        const p = this.ctx.createPanner();
        p.panningModel = hrtf ? 'HRTF' : 'equalpower';
        p.distanceModel = 'linear';
        p.rolloffFactor = 0; // distance gain is computed by us; panner does direction only
        p.refDistance = 1;
        p.maxDistance = 100000;
        p.channelCount = 1;
        p.channelCountMode = 'explicit';
        return p;
    }
    setPannerPos(p, v, when, tau = 0) {
        const t = when ?? this.now;
        if (p.positionX) {
            if (tau > 0) {
                p.positionX.setTargetAtTime(v[0], t, tau);
                p.positionY.setTargetAtTime(v[1], t, tau);
                p.positionZ.setTargetAtTime(v[2], t, tau);
            }
            else {
                p.positionX.setValueAtTime(v[0], t);
                p.positionY.setValueAtTime(v[1], t);
                p.positionZ.setValueAtTime(v[2], t);
            }
        }
        else
            p.setPosition(v[0], v[1], v[2]);
    }
    distGain(d, ref = 3, rolloff = 1, minGain = 0) {
        return Math.max(minGain, ref / Math.max(ref, ref + rolloff * (d - ref)));
    }
    airLp(d) { return d < 12 ? 22000 : clamp(22000 / (1 + (d - 12) / 70), 900, 22000); }
    /** play a buffer as a one-shot voice */
    play(buf, o) {
        if (!buf)
            return null;
        const c = this.ctx;
        const t = Math.max(this.now, o.when ?? this.now);
        const rate = o.rate ?? 1;
        const nodes = [];
        const src = c.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate;
        if (o.detune)
            src.detune.value = o.detune;
        if (o.rateTo)
            src.playbackRate.setTargetAtTime(o.rateTo.v, t, o.rateTo.secs / 3);
        nodes.push(src);
        let gain = o.gain ?? 1;
        let d = 0;
        if (o.pos) {
            d = this.attenDist(o.pos);
            gain *= this.distGain(d, o.ref ?? 3, o.rolloff ?? 1, o.minGain ?? 0);
        }
        const g = c.createGain();
        nodes.push(g);
        const fadeIn = o.fadeIn ?? 0;
        if (fadeIn > 0) {
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(gain, t + fadeIn);
        }
        else
            g.gain.value = gain;
        let head = src.connect(g);
        if (o.hp) {
            const f = c.createBiquadFilter();
            f.type = 'highpass';
            f.frequency.value = o.hp;
            f.Q.value = 0.6;
            head = head.connect(f);
            nodes.push(f);
        }
        const lpF = Math.min(o.lp ?? 22000, o.pos && o.air !== false ? this.airLp(d) : 22000);
        if (lpF < 20000) {
            const f = c.createBiquadFilter();
            f.type = 'lowpass';
            f.frequency.value = lpF;
            f.Q.value = 0.6;
            head = head.connect(f);
            nodes.push(f);
        }
        const bus = this.bus(o.bus);
        const dryIn = o.dest ?? (bus instanceof GainNode ? bus : bus.dry);
        if (o.pos) {
            const p = this.makePanner(o.hrtf !== false);
            this.setPannerPos(p, o.pos, t);
            if (o.move) {
                const to = o.move.to;
                const te = t + o.move.secs;
                if (p.positionX) {
                    p.positionX.linearRampToValueAtTime(to[0], te);
                    p.positionY.linearRampToValueAtTime(to[1], te);
                    p.positionZ.linearRampToValueAtTime(to[2], te);
                }
            }
            head.connect(p).connect(dryIn);
            nodes.push(p);
        }
        else if (o.pan !== undefined) {
            const p = c.createStereoPanner();
            p.pan.value = clamp(o.pan, -1, 1);
            head.connect(p).connect(dryIn);
            nodes.push(p);
        }
        else
            head.connect(dryIn);
        if (!(bus instanceof GainNode)) {
            // reverb falls off much more slowly with distance than the direct sound
            const wetScale = o.pos ? Math.min(1, Math.sqrt((o.ref ?? 3) / Math.max(o.ref ?? 3, d)) * 1.2 + 0.15) / Math.max(1e-3, this.distGain(d, o.ref ?? 3, o.rolloff ?? 1, o.minGain ?? 0)) : 1;
            if (o.rev) {
                const s = c.createGain();
                s.gain.value = o.rev * Math.min(wetScale, 30);
                head.connect(s).connect(bus.rev);
                nodes.push(s);
            }
            if (o.echo) {
                const s = c.createGain();
                s.gain.value = o.echo * Math.min(wetScale, 30);
                head.connect(s).connect(bus.echo);
                nodes.push(s);
            }
        }
        const off = o.offset ?? 0;
        const natural = (buf.duration - off) / Math.max(0.05, Math.min(rate, o.rateTo?.v ?? rate));
        const dur = o.dur !== undefined ? Math.min(o.dur, natural) : natural;
        src.start(t, off);
        if (o.dur !== undefined && o.dur < natural) {
            g.gain.setValueAtTime(gain, t + Math.max(0, dur - 0.05));
            g.gain.linearRampToValueAtTime(0, t + dur);
            src.stop(t + dur + 0.01);
        }
        const v = { src, gain: g, nodes, start: t, end: t + dur + 0.1, group: o.group, stopped: false };
        this.voices.push(v);
        this.stats.started++;
        this.stats.peakVoices = Math.max(this.stats.peakVoices, this.voices.length);
        if (o.group) {
            const list = this.groups.get(o.group) ?? [];
            list.push(v);
            this.groups.set(o.group, list);
            const lim = o.limit ?? GROUP_LIMITS[o.group] ?? 8;
            while (list.length > lim) {
                const old = list.shift();
                this.stopVoice(old, 0.03);
                this.stats.stolen++;
            }
        }
        return v;
    }
    stopVoice(v, fade = 0.05) {
        if (v.stopped)
            return;
        v.stopped = true;
        const t = this.now;
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setValueAtTime(v.gain.gain.value, t);
        v.gain.gain.linearRampToValueAtTime(0, t + fade);
        try {
            v.src.stop(t + fade + 0.01);
        }
        catch { /* not started */ }
        v.end = Math.min(v.end, t + fade + 0.1);
    }
    /** keep arbitrary nodes (oscillator voices) until `end`, then disconnect them */
    track(nodes, end) { this.tracked.push({ nodes, end }); }
    /** disconnect finished voices */
    sweep() {
        const t = this.now;
        for (let i = this.tracked.length - 1; i >= 0; i--) {
            if (t > this.tracked[i].end) {
                for (const n of this.tracked[i].nodes) {
                    try {
                        n.disconnect();
                    }
                    catch { /* */ }
                }
                this.tracked.splice(i, 1);
            }
        }
        for (let i = this.voices.length - 1; i >= 0; i--) {
            const v = this.voices[i];
            if (t > v.end) {
                for (const n of v.nodes) {
                    try {
                        n.disconnect();
                    }
                    catch { /* */ }
                }
                this.voices.splice(i, 1);
                if (v.group) {
                    const l = this.groups.get(v.group);
                    if (l) {
                        const k = l.indexOf(v);
                        if (k >= 0)
                            l.splice(k, 1);
                    }
                }
            }
        }
    }
    get activeVoices() { return this.voices.length + this.tracked.length; }
}
/** a continuously running loop (ambience bed / bending layer) with gain, filter, optional HRTF panner */
export class Loop {
    core;
    src;
    gain;
    filter;
    filter2;
    panner;
    stereo;
    revSend;
    echoSend;
    alive = true;
    constructor(core, buf, o) {
        this.core = core;
        const c = core.ctx;
        this.src = c.createBufferSource();
        this.src.buffer = buf;
        this.src.loop = true;
        this.src.playbackRate.value = o.rate ?? 1;
        this.gain = c.createGain();
        this.gain.gain.value = 0;
        let head = this.src.connect(this.gain);
        this.filter = null;
        this.filter2 = null;
        if (o.filter) {
            const f = c.createBiquadFilter();
            f.type = o.filter;
            f.frequency.value = o.freq ?? 1000;
            f.Q.value = o.q ?? 0.7;
            head = head.connect(f);
            this.filter = f;
        }
        if (o.filter2) {
            const f = c.createBiquadFilter();
            f.type = o.filter2;
            f.frequency.value = o.freq2 ?? 1000;
            f.Q.value = o.q2 ?? 0.7;
            head = head.connect(f);
            this.filter2 = f;
        }
        const bus = core.bus(o.bus);
        const dry = o.dest ?? (bus instanceof GainNode ? bus : bus.dry);
        this.panner = null;
        this.stereo = null;
        if (o.positional) {
            this.panner = core.makePanner(o.hrtf !== false);
            head.connect(this.panner).connect(dry);
        }
        else if (o.pan !== undefined) {
            this.stereo = c.createStereoPanner();
            this.stereo.pan.value = o.pan;
            head.connect(this.stereo).connect(dry);
        }
        else
            head.connect(dry);
        this.revSend = null;
        this.echoSend = null;
        if (!(bus instanceof GainNode)) {
            if (o.rev !== undefined) {
                this.revSend = c.createGain();
                this.revSend.gain.value = o.rev;
                head.connect(this.revSend).connect(bus.rev);
            }
            if (o.echo !== undefined) {
                this.echoSend = c.createGain();
                this.echoSend.gain.value = o.echo;
                head.connect(this.echoSend).connect(bus.echo);
            }
        }
        this.src.start(core.now, (o.offset ?? core.rng.next()) * buf.duration * 0.95);
    }
    set(v, tau = 0.1) { if (this.alive)
        this.core.set(this.gain.gain, Math.max(0, v), tau); }
    freq(f, tau = 0.1) { if (this.filter)
        this.core.set(this.filter.frequency, f, tau, 2e-3); }
    freq2(f, tau = 0.1) { if (this.filter2)
        this.core.set(this.filter2.frequency, f, tau, 2e-3); }
    rate(r, tau = 0.1) { this.core.set(this.src.playbackRate, r, tau, 1e-3); }
    rev(v, tau = 0.2) { if (this.revSend)
        this.core.set(this.revSend.gain, v, tau); }
    pos(v, tau = 0.05) { if (this.panner)
        this.core.setPannerPos(this.panner, v, undefined, tau); }
    pan(p, tau = 0.1) { if (this.stereo)
        this.core.set(this.stereo.pan, clamp(p, -1, 1), tau, 1e-3); }
    dispose(fade = 0.3) {
        if (!this.alive)
            return;
        this.alive = false;
        const t = this.core.now;
        this.gain.gain.cancelScheduledValues(t);
        this.gain.gain.setTargetAtTime(0, t, fade / 3);
        this.src.stop(t + fade + 0.05);
        this.src.onended = () => { for (const n of [this.src, this.gain, this.filter, this.filter2, this.panner, this.stereo, this.revSend, this.echoSend])
            n?.disconnect(); };
    }
}
/** a set of lazily-created loops: built when their gain becomes audible, disposed after a few seconds of silence */
export class LayerSet {
    core;
    loops = new Map();
    idle = new Map();
    dt = 1 / 30;
    constructor(core) {
        this.core = core;
    }
    layer(key, buf, o, gain, tau = 0.3) {
        let l = this.loops.get(key) ?? null;
        if (gain > 2e-4) {
            this.idle.set(key, 0);
            if (!l) {
                const b = this.core.synth.get(buf);
                if (b) {
                    l = new Loop(this.core, b, o);
                    this.loops.set(key, l);
                }
            }
        }
        else if (l) {
            const idle = (this.idle.get(key) ?? 0) + this.dt;
            this.idle.set(key, idle);
            if (idle > 4 + tau * 5) {
                l.dispose(0.1);
                this.loops.delete(key);
                return null;
            }
        }
        l?.set(Math.max(0, gain), tau);
        return l;
    }
    levels(prefix = '') { const o = {}; for (const [k, l] of this.loops)
        o[prefix + k] = l.gain.gain.value; return o; }
    get count() { return this.loops.size; }
}
//# sourceMappingURL=core.js.map