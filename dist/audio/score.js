import { Rng, clamp, hashSeed } from './synth/dsp';
import { CELESTA_NOTES, CHOIR_NOTES, GLASS_NOTES, HARP_NOTES, PAD_NOTES, SCALE_PCS, SUB_NOTES } from './synth/registry';
/** chords by name: their pitch classes (root first) */
const CH = {
    I: [2, 6, 9, 1], II: [4, 8, 11, 2], iii: [6, 9, 1], IV: [7, 11, 2, 6], V: [9, 1, 4], vi: [11, 2, 6, 9],
};
const DAY = [['I', 'II', 'I', 'II'], ['I', 'II', 'vi', 'V'], ['vi', 'IV', 'I', 'V'], ['I', 'iii', 'IV', 'II'], ['IV', 'I', 'II', 'I'], ['I', 'V', 'vi', 'II']];
const NIGHT = [['vi', 'IV', 'I', 'V'], ['vi', 'II', 'vi', 'V'], ['vi', 'iii', 'IV', 'vi'], ['IV', 'vi', 'II', 'vi']];
const FINALE = ['I', 'II', 'vi', 'IV', 'I', 'II', 'V', 'I'];
const pc = (m) => ((m % 12) + 12) % 12;
const near = (list, m) => list.reduce((b, x) => (Math.abs(x - m) < Math.abs(b - m) ? x : b), list[0]);
export class Score {
    core;
    rng;
    bpm = 66;
    beat = 60 / 66;
    nextBeat = -1;
    beatIdx = 0;
    bar = 0;
    prog = DAY[0];
    barsLeft = 0;
    mode = 'rest';
    restUntil = 0;
    night = 0;
    motif = [];
    finaleBars = 0;
    enabled = true;
    log = null;
    /** 0..1: flight / swinging (more harp, shorter rests) */
    advTarget = 0;
    adv = 0;
    I = 0;
    constructor(core, seed) {
        this.core = core;
        this.rng = new Rng(hashSeed(seed, 'score'));
    }
    get state() { return { mode: this.mode, bar: this.bar, prog: this.prog.join(' '), adv: +this.adv.toFixed(2) }; }
    /** midi notes of the pitch collection in [lo, hi] (for in-key stings) */
    keyNotes(lo, hi) { const r = []; for (let m = lo; m <= hi; m++)
        if (SCALE_PCS.includes(pc(m)))
            r.push(m); return { notes: r, tonic: 62 }; }
    startNow() { this.restUntil = 0; if (this.mode === 'rest')
        this.begin(); }
    restNow(secs) { this.mode = 'rest'; this.restUntil = this.core.now + secs; }
    chord() { return CH[this.prog[Math.floor(this.bar / 2) % this.prog.length]]; }
    begin(finale = false) {
        const r = this.rng;
        this.mode = 'piece';
        this.bar = 0;
        this.prog = finale ? FINALE : this.night > 0.5 ? NIGHT[r.int(0, NIGHT.length - 1)] : DAY[r.int(0, DAY.length - 1)];
        this.barsLeft = finale ? 16 : r.pick([8, 8, 12, 16]);
        // a motif for the piece: a short shape in scale steps
        const len = r.int(4, 6);
        this.motif = [0];
        for (let k = 1; k < len; k++)
            this.motif.push(this.motif[k - 1] + r.pick([-2, -1, 1, 1, 2, 3, -3]));
        this.log?.(`piece ${this.prog.join(' ')} ×${this.barsLeft}`);
    }
    // ---------------------------------------------------------------- one note
    note(inst, midi, when, gain, o = {}) {
        const lists = { harp: HARP_NOTES, celesta: CELESTA_NOTES, pad: PAD_NOTES, sub: SUB_NOTES, choir: CHOIR_NOTES, glass: GLASS_NOTES };
        const list = lists[inst];
        const m = near(list, midi);
        const buf = this.core.synth.get(`${inst}.${m}`);
        if (!buf)
            return;
        this.core.play(buf, { bus: 'music', when, gain, pan: o.pan ?? 0, rev: o.rev ?? 0.5, dur: o.dur, fadeIn: o.fadeIn, group: 'music' });
    }
    // ---------------------------------------------------------------- stings
    /** the game's moments: a star taken, a star home, a constellation whole, the finale */
    cue(kind) {
        const c = this.core, t = c.now + 0.03;
        const ch = this.mode === 'piece' ? this.chord() : CH.I;
        const tones = (lo, hi) => { const r = []; for (let m = lo; m <= hi; m++)
            if (ch.includes(pc(m)))
                r.push(m); return r; };
        if (kind === 'take') {
            tones(74, 93).slice(0, 4).forEach((m, k) => this.note('celesta', m, t + k * 0.09, 0.32, { pan: -0.3 + k * 0.2, rev: 0.7 }));
        }
        else if (kind === 'home') {
            tones(62, 88).forEach((m, k) => this.note('harp', m, t + k * 0.06, 0.28, { pan: -0.6 + k * 0.12, rev: 0.6 }));
            tones(57, 69).slice(0, 3).forEach((m) => this.note('choir', m, t + 0.4, 0.22, { fadeIn: 0.8, dur: 6, rev: 0.8 }));
        }
        else if (kind === 'whole') {
            tones(50, 74).forEach((m) => this.note('choir', m, t, 0.3, { fadeIn: 1.2, dur: 8, rev: 0.9 }));
            tones(55, 91).forEach((m, k) => this.note('harp', m, t + k * 0.05, 0.25, { pan: Math.sin(k), rev: 0.6 }));
            this.restUntil = 0;
        }
        else {
            this.finaleBars = 16;
            this.begin(true);
            this.nextBeat = c.now + 0.1;
            this.beatIdx = 0;
        }
    }
    // ---------------------------------------------------------------- per frame: schedule a beat ahead
    update(dt, s) {
        if (!this.enabled)
            return;
        const c = this.core, now = c.now;
        this.night += (clamp(s.nightness, 0, 1) - this.night) * Math.min(1, dt * 0.2);
        this.adv += (clamp(this.advTarget, 0, 1) - this.adv) * Math.min(1, dt * (this.advTarget > this.adv ? 1 : 0.15));
        this.I = clamp(Math.max(s.musicIntensity, this.adv), 0, 1);
        if (this.mode === 'rest') {
            if (this.restUntil === 0)
                this.restUntil = now + 8;
            // (flying, swinging: the music comes back sooner)
            if (now >= this.restUntil - this.adv * 20) {
                this.begin();
                this.nextBeat = now + 0.15;
                this.beatIdx = 0;
            }
            return;
        }
        if (this.nextBeat < 0)
            this.nextBeat = now + 0.1;
        while (this.nextBeat < now + 0.25) {
            this.playBeat(this.nextBeat);
            this.nextBeat += this.beat;
            this.beatIdx++;
            if (this.beatIdx % 4 === 0) {
                this.bar++;
                if (--this.barsLeft <= 0) {
                    this.mode = 'rest';
                    this.restUntil = now + this.rng.range(25, 55) * (1 - 0.5 * this.adv);
                    if (this.finaleBars > 0) {
                        this.finaleBars = 0;
                        this.restUntil = now + 6;
                    }
                    this.log?.('rest');
                    return;
                }
            }
        }
    }
    playBeat(t) {
        const r = this.rng, b = this.beatIdx % 4, bar = this.bar;
        const ch = this.chord();
        const night = this.night, I = this.I, fin = this.finaleBars > 0;
        const root = ch[0];
        // (the music sits lower and softer at night)
        const base = night > 0.5 ? 50 : 55;
        const tones = (lo, hi) => { const out = []; for (let m = lo; m <= hi; m++)
            if (ch.includes(pc(m)))
                out.push(m); return out; };
        const startOfChord = b === 0 && bar % 2 === 0;
        // ---- the pad (and sub, choir) on each chord
        if (startOfChord) {
            const dur = this.beat * 8 + 1.5;
            const pt = tones(base - 5, base + 9).slice(0, 4);
            pt.forEach((m, k) => this.note('pad', m, t, 0.11 * (0.7 + 0.3 * (1 - night)), { pan: -0.5 + k * 0.33, dur, rev: 0.45 }));
            if (I > 0.35 || fin || night > 0.6)
                this.note('sub', 26 + ((root - 2 + 12) % 12), t, 0.16 * (fin ? 1.3 : 0.6 + 0.5 * I), { dur });
            if (fin)
                tones(50, 74).slice(0, 4).forEach((m, k) => this.note('choir', m, t, 0.2, { pan: -0.4 + k * 0.27, dur, fadeIn: 1.0, rev: 0.85 }));
        }
        // ---- the harp: arpeggios (eighths), sparser at rest and at night, fuller while flying
        const dens = clamp(0.35 + 0.5 * I + (fin ? 0.4 : 0) - 0.2 * night, 0.15, 1);
        const arp = tones(base + 2, base + 26);
        if (arp.length) {
            const shape = (bar >> 1) % 3;
            for (let e = 0; e < 2; e++) {
                const step = b * 2 + e;
                if (r.next() > dens && step !== 0)
                    continue;
                let k = shape === 0 ? step : shape === 1 ? (step < 4 ? step : 7 - step) : (step * 3) % 8;
                k = k % arp.length;
                const m = arp[Math.min(arp.length - 1, k + (bar % 2) * 2)];
                const swing = e === 1 ? this.beat * 0.5 + this.beat * 0.04 : 0;
                this.note('harp', m, t + swing + r.range(0, 0.012), (0.2 + 0.1 * r.next()) * (e === 0 ? 1 : 0.8), { pan: -0.4 + (k / 8) * 0.8, rev: 0.5 });
            }
        }
        // ---- the melody: the motif in the second half of each four-bar phrase (celesta by day, glass by night)
        if ((bar % 4 === 2 || bar % 4 === 3) && (b === 0 || b === 2 || (b === 1 && r.chance(0.4)))) {
            const scale = this.keyNotes(base + 14, base + 40).notes;
            const anchor = near(scale, base + 22 + (bar % 8 >= 4 ? 3 : 0));
            const ai = scale.indexOf(anchor);
            const idx = ((bar % 4) - 2) * 3 + (b === 0 ? 0 : b === 1 ? 1 : 2);
            const step = this.motif[idx % this.motif.length] + (bar % 8 >= 4 ? 1 : 0);
            let m = scale[clamp(ai + step, 0, scale.length - 1)];
            // land the phrase's last note on a chord tone
            if (bar % 4 === 3 && b === 2)
                m = near(tones(m - 4, m + 4), m) ?? m;
            if (night > 0.55 && !fin)
                this.note('glass', m, t, 0.12, { dur: this.beat * 3, rev: 0.8 });
            else
                this.note('celesta', m, t, 0.26 * (fin ? 1.2 : 1), { pan: 0.25, rev: 0.65 });
        }
    }
}
//# sourceMappingURL=score.js.map