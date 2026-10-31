export class Mixer {
    ctx;
    synth;
    sum;
    world;
    amb;
    sfx;
    music;
    ui;
    master;
    startFade;
    envIn;
    echoIn;
    uw1;
    uw2;
    cloudShelf;
    musicLp;
    /** score swell (flight 'adventure' layer), 1 = neutral */
    musicSwell;
    musicRevIn;
    musicDelayIn;
    env = null;
    echo = null;
    dying = [];
    scene = null;
    vol = { master: 1, music: 1, ambience: 1, sfx: 1 };
    comp = null;
    limiter = null;
    constructor(ctx, synth, bypass = false) {
        this.ctx = ctx;
        this.synth = synth;
        const c = ctx;
        const g = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };
        this.sum = g();
        this.master = g(0);
        this.startFade = g(0);
        if (bypass) {
            this.sum.connect(this.startFade);
        }
        else {
            // glue compressor (makeup gain compensated: Chrome applies (1/fullRangeGain)^0.6)
            const comp = c.createDynamicsCompressor();
            const CT = -12, CR = 2, LT = -2;
            comp.threshold.value = CT;
            comp.knee.value = 6;
            comp.ratio.value = CR;
            comp.attack.value = 0.012;
            comp.release.value = 0.25;
            // measured residual of Chrome's makeup estimate: +0.9 dB (tools/audio calibrate())
            const compMk = g(Math.pow(10, (-0.6 * -CT * (1 - 1 / CR) + 0.9) / 20));
            const lim = c.createDynamicsCompressor();
            lim.threshold.value = LT;
            lim.knee.value = 0;
            lim.ratio.value = 20;
            lim.attack.value = 0.001;
            lim.release.value = 0.1;
            const limMk = g(Math.pow(10, (-0.6 * -LT * (1 - 1 / 20)) / 20));
            // soft clip: linear to 0.8, tanh knee to 1.0; input scaled into the shaper's [-1,1] domain (covers ±2.0)
            const pre = g(0.5);
            const clip = c.createWaveShaper();
            const N = 4097;
            const curve = new Float32Array(N);
            for (let i = 0; i < N; i++) {
                const x = ((i / (N - 1)) * 2 - 1) * 2;
                const a = Math.abs(x);
                const y = a < 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18);
                curve[i] = Math.sign(x) * y;
            }
            clip.curve = curve;
            clip.oversample = '4x';
            this.sum.connect(comp).connect(compMk).connect(lim).connect(limMk).connect(pre).connect(clip).connect(this.startFade);
            this.comp = comp;
            this.limiter = lim;
        }
        this.startFade.connect(this.master).connect(c.destination);
        // world (ambience + sfx) through the underwater filter
        this.world = g();
        this.uw1 = c.createBiquadFilter();
        this.uw1.type = 'lowpass';
        this.uw1.frequency.value = 22000;
        this.uw1.Q.value = 0.5;
        this.uw2 = c.createBiquadFilter();
        this.uw2.type = 'lowpass';
        this.uw2.frequency.value = 22000;
        this.uw2.Q.value = 0.5;
        this.world.connect(this.uw1).connect(this.uw2).connect(this.sum);
        this.envIn = g();
        this.echoIn = g();
        const mk = () => {
            const b = { dry: g(), rev: g(), echo: g() };
            b.dry.connect(this.world);
            b.rev.connect(this.envIn);
            b.echo.connect(this.echoIn);
            return b;
        };
        this.amb = mk();
        this.sfx = mk();
        // (in a cloud the world's sounds soften: a high shelf on the ambience's dry path — setCloud)
        this.cloudShelf = c.createBiquadFilter();
        this.cloudShelf.type = 'highshelf';
        this.cloudShelf.frequency.value = 1800;
        this.cloudShelf.gain.value = 0;
        this.amb.dry.disconnect();
        this.amb.dry.connect(this.cloudShelf).connect(this.world);
        this.ui = g();
        this.ui.connect(this.sum);
        // music: dry + its own hall + a soft ping-pong delay
        this.musicLp = c.createBiquadFilter();
        this.musicLp.type = 'lowpass';
        this.musicLp.frequency.value = 22000;
        this.musicLp.Q.value = 0.5;
        // keep the score's sub-bass out of the way of the world (taiko/horn fundamentals still pass)
        const mHp = c.createBiquadFilter();
        mHp.type = 'highpass';
        mHp.frequency.value = 38;
        mHp.Q.value = 0.6;
        const mShelf = c.createBiquadFilter();
        mShelf.type = 'lowshelf';
        mShelf.frequency.value = 120;
        mShelf.gain.value = -3;
        this.musicSwell = g(1);
        this.musicLp.connect(this.musicSwell).connect(mHp).connect(mShelf).connect(this.sum);
        this.musicRevIn = g();
        this.musicDelayIn = g();
        this.music = { dry: g(), rev: g(), echo: g() };
        this.music.dry.connect(this.musicLp);
        this.music.rev.connect(this.musicRevIn);
        this.music.echo.connect(this.musicDelayIn);
        {
            const dl = c.createDelay(2), dr = c.createDelay(2);
            dl.delayTime.value = 0.61;
            dr.delayTime.value = 0.83;
            const fb = g(0.3), lp = c.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 2800;
            const merger = c.createChannelMerger(2);
            this.musicDelayIn.connect(dl);
            dl.connect(lp).connect(dr);
            dr.connect(fb).connect(dl);
            dl.connect(merger, 0, 0);
            dr.connect(merger, 0, 1);
            const dOut = g(0.45);
            merger.connect(dOut);
            dOut.connect(this.musicLp);
            dOut.connect(this.musicRevIn);
        }
        const hall = () => {
            const b = this.synth.get('ir.hall');
            if (!b)
                return false;
            const conv = c.createConvolver();
            conv.normalize = false;
            conv.buffer = b;
            const out = g(1);
            this.musicRevIn.connect(conv).connect(out).connect(this.musicLp);
            return true;
        };
        if (!hall())
            this.synth.onLoaded((k) => { if (k === 'ir.hall')
                hall(); });
        this.synth.onLoaded((k) => {
            if (this.scene && (k === 'ir.valley' || k === 'ir.forest' || k === 'ir.echoLake' || k === 'ir.echoRiver'))
                this.attachScene(this.scene, 0.5);
        });
    }
    attachScene(scene, fade) {
        const now = this.ctx.currentTime;
        const mk = (key, input, gain, cur) => {
            if (cur?.key === key)
                return null;
            const b = this.synth.get(key);
            if (!b)
                return null;
            const conv = this.ctx.createConvolver();
            conv.normalize = false;
            conv.buffer = b;
            const out = this.ctx.createGain();
            out.gain.value = 0;
            out.gain.setValueAtTime(0, now);
            out.gain.linearRampToValueAtTime(gain, now + fade);
            input.connect(conv).connect(out).connect(this.world);
            return { key, conv, out, killAt: Infinity };
        };
        const retire = (s, input) => {
            if (!s)
                return;
            s.out.gain.cancelScheduledValues(now);
            s.out.gain.setValueAtTime(s.out.gain.value, now);
            s.out.gain.linearRampToValueAtTime(0, now + fade);
            s.killAt = now + fade + 0.1;
            try {
                input.disconnect(s.conv);
            }
            catch { /* already */ }
            this.dying.push(s);
        };
        const envKey = scene === 'lake' ? 'ir.valley' : 'ir.forest';
        const echoKey = scene === 'lake' ? 'ir.echoLake' : 'ir.echoRiver';
        const ne = mk(envKey, this.envIn, 1, this.env);
        if (ne) {
            retire(this.env, this.envIn);
            this.env = ne;
        }
        const nh = mk(echoKey, this.echoIn, 1, this.echo);
        if (nh) {
            retire(this.echo, this.echoIn);
            this.echo = nh;
            // echoes are also slightly diffused by the space
            const d = this.ctx.createGain();
            d.gain.value = 0.25;
            nh.out.connect(d).connect(this.envIn);
        }
    }
    setScene(scene) {
        if (scene === this.scene)
            return;
        this.scene = scene;
        this.attachScene(scene, 2.0);
    }
    /** remove retired convolvers after their fade */
    tick(now) {
        for (let i = this.dying.length - 1; i >= 0; i--) {
            const s = this.dying[i];
            if (now > s.killAt) {
                s.conv.disconnect();
                s.out.disconnect();
                this.dying.splice(i, 1);
            }
        }
    }
    /** under water (u 0..1, eased by the caller; depth in m): the world above heard through the surface — a smooth
     *  low-pass with a little resonance, sweeping down as the head goes under (log-interpolated, so the crossfade sounds
     *  even), a touch darker deeper down; the score softened rather than drowned */
    setUnderwater(u, depth = 0) {
        const t = this.ctx.currentTime;
        const ny = this.ctx.sampleRate * 0.45;
        const k = Math.min(Math.max(u, 0), 1);
        const deep = Math.min(Math.max(depth / 12, 0), 1);
        const lerpLog = (a, b) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * k);
        const tau = 0.05;
        for (const p of [this.uw1.frequency, this.uw2.frequency, this.uw1.Q, this.musicLp.frequency])
            p.cancelScheduledValues(t);
        this.uw1.frequency.setTargetAtTime(lerpLog(ny, 560 - 160 * deep), t, tau);
        this.uw2.frequency.setTargetAtTime(lerpLog(ny, 900 - 250 * deep), t, tau);
        this.uw1.Q.setTargetAtTime(0.5 + 1.1 * k, t, tau);
        this.musicLp.frequency.setTargetAtTime(lerpLog(ny, 1900 - 500 * deep), t, tau * 2);
    }
    /** in a cloud (k 0..1): the world's sounds soften — its highs damped a little, as if through wool */
    setCloud(k) {
        const t = this.ctx.currentTime;
        this.cloudShelf.gain.cancelScheduledValues(t);
        this.cloudShelf.gain.setTargetAtTime(-10 * Math.min(Math.max(k, 0), 1), t, 0.15);
    }
    setVolumes(v, tau = 0.05) {
        this.vol = v;
        const t = this.ctx.currentTime;
        const set = (p, x) => { p.cancelScheduledValues(t); p.setTargetAtTime(Math.max(0, x), t, tau); };
        set(this.master.gain, v.master);
        for (const n of [this.amb.dry, this.amb.rev, this.amb.echo])
            set(n.gain, v.ambience);
        for (const n of [this.sfx.dry, this.sfx.rev, this.sfx.echo])
            set(n.gain, v.sfx);
        set(this.ui.gain, v.sfx);
        for (const n of [this.music.dry, this.music.rev, this.music.echo])
            set(n.gain, v.music);
    }
    get volumes() { return this.vol; }
    fadeIn(secs) {
        const t = this.ctx.currentTime;
        this.startFade.gain.cancelScheduledValues(t);
        this.startFade.gain.setValueAtTime(this.startFade.gain.value, t);
        this.startFade.gain.linearRampToValueAtTime(1, t + secs);
    }
}
//# sourceMappingURL=mixer.js.map