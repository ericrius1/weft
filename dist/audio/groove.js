import { Rng, clamp, hashSeed } from './synth/dsp';
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const pc = (m) => ((m % 12) + 12) % 12;
const inKey = (lo, hi) => { const r = []; for (let m = lo; m <= hi; m++)
    if (MAJOR.includes(pc(m)))
        r.push(m); return r; };
export const MARIMBA_NOTES = inKey(55, 96);
export const BASS_NOTES = inKey(28, 52);
const near = (list, m) => list.reduce((b, x) => (Math.abs(x - m) < Math.abs(b - m) ? x : b), list[0]);
/** what the groove needs in the bank */
export const GROOVE_BANK = [
    { key: 'gr.kick', kind: 'kick', params: {}, variants: 1, sr: 32000 },
    { key: 'gr.snap', kind: 'snap', params: {}, variants: 3, sr: 44100 },
    { key: 'gr.shake', kind: 'shaker', params: {}, variants: 3, sr: 44100 },
    { key: 'gr.shakeL', kind: 'shaker', params: { long: true }, variants: 2, sr: 44100 },
    ...MARIMBA_NOTES.map((m) => ({ key: `mar.${m}`, kind: 'marimba', params: { midi: m }, variants: 1, sr: 32000 })),
    ...BASS_NOTES.map((m) => ({ key: `bass.${m}`, kind: 'pluckBass', params: { midi: m }, variants: 1, sr: 16000 })),
];
/** chords (pitch classes, root first) */
const CH = { I: [0, 4, 7, 2], ii: [2, 5, 9, 0], iii: [4, 7, 11], IV: [5, 9, 0, 4], V: [7, 11, 2, 5], vi: [9, 0, 4, 7] };
const PROGS = [['I', 'V', 'vi', 'IV'], ['I', 'vi', 'IV', 'V'], ['vi', 'IV', 'I', 'V'], ['IV', 'V', 'iii', 'vi'], ['I', 'IV', 'ii', 'V'], ['IV', 'I', 'V', 'vi']];
const WIN = ['IV', 'V', 'iii', 'vi', 'ii', 'V', 'I', 'I'];
/** bass rhythms over a bar (16th steps; 'r' root, 'f' fifth, 'o' octave, 'p' a passing tone into the next chord) */
const BASSES = [
    [[0, 'r'], [6, 'r'], [10, 'f'], [14, 'p']],
    [[0, 'r'], [3, 'o'], [8, 'r'], [11, 'f'], [14, 'p']],
    [[0, 'r'], [7, 'f'], [10, 'o'], [12, 'r'], [15, 'p']],
    [[0, 'r'], [4, 'r'], [6, 'f'], [10, 'r'], [14, 'o']],
];
export class Groove {
    core;
    rng;
    bpm = 112;
    step = 60 / 112 / 4;
    next = -1;
    idx = 0;
    bar = 0;
    prog = PROGS[0];
    bass = BASSES[0];
    motif = [];
    winBars = 0;
    /** 0..1 eased */
    energy = 0;
    target = 0.2;
    constructor(core, seed) {
        this.core = core;
        this.rng = new Rng(hashSeed(seed, 'groove'));
        this.newPhrase();
    }
    get state() { return { bar: this.bar, prog: this.prog.join(' '), energy: +this.energy.toFixed(2) }; }
    chord() { return CH[this.prog[this.bar % this.prog.length]]; }
    nextChord() { return CH[this.prog[(this.bar + 1) % this.prog.length]]; }
    newPhrase() {
        const r = this.rng;
        if (this.winBars <= 0)
            this.prog = PROGS[r.int(0, PROGS.length - 1)];
        this.bass = BASSES[r.int(0, BASSES.length - 1)];
        // a motif: a few notes in 16ths over two bars, scale degrees from the chord's root
        this.motif = [];
        const n = r.int(4, 7);
        let at = r.pick([0, 2, 3]), deg = r.pick([0, 2, 4]);
        for (let k = 0; k < n && at < 30; k++) {
            const len = r.pick([1, 2, 2, 3, 4]);
            this.motif.push({ at, deg, len });
            at += len + (r.chance(0.3) ? r.int(1, 3) : 0);
            deg += r.pick([-2, -1, 1, 1, 2, 3, -3]);
        }
    }
    /** a chord tone in [lo, hi] (for a game's blips to land in key) */
    noteFor(lo, hi) {
        const ch = this.chord();
        const list = MARIMBA_NOTES.filter((m) => m >= lo && m <= hi && ch.includes(pc(m)));
        return list.length ? this.rng.pick(list) : near(MARIMBA_NOTES, (lo + hi) / 2);
    }
    /** a marimba note now (a blip, a stinger's note) */
    blip(midi, gain = 0.3, pan = 0, delay = 0) { this.note('mar', midi, this.core.now + 0.01 + delay, gain, pan, 0.35); }
    cue(kind) {
        const t = this.core.now + 0.02, ch = this.chord();
        const tones = (lo, hi) => MARIMBA_NOTES.filter((m) => m >= lo && m <= hi && ch.includes(pc(m)));
        if (kind === 'gem')
            tones(72, 96).slice(0, 6).forEach((m, k) => this.note('mar', m, t + k * this.step, 0.34, -0.4 + k * 0.16, 0.45));
        else if (kind === 'pop')
            tones(76, 90).slice(0, 2).forEach((m, k) => this.note('mar', m, t + k * this.step * 0.5, 0.3, 0, 0.3));
        else if (kind === 'unlock') {
            this.play('gr.kick', t, 0.6);
            tones(60, 96).forEach((m, k) => this.note('mar', m, t + k * this.step * 0.5, 0.3, Math.sin(k * 1.3) * 0.6, 0.5));
            this.note('bass', near(BASS_NOTES, 36 + ch[0]), t, 0.7, 0, 0.1);
            this.target = 1;
        }
        else {
            this.winBars = 8;
            this.prog = WIN;
            this.bar = 0;
            this.idx = 0;
            this.target = 1;
        }
    }
    update(dt, energy) {
        const c = this.core, now = c.now;
        this.target = clamp(energy, 0, 1);
        this.energy += (this.target - this.energy) * Math.min(1, dt * (this.target > this.energy ? 1.5 : 0.25));
        if (this.next < 0 || this.next < now - 0.5)
            this.next = now + 0.1;
        while (this.next < now + 0.2) {
            // (swing: the off 16ths late)
            const sw = this.idx % 2 === 1 ? this.step * 0.14 : 0;
            this.playStep(this.next + sw, this.idx % 16);
            this.next += this.step;
            this.idx++;
            if (this.idx % 16 === 0) {
                this.bar++;
                if (this.winBars > 0 && --this.winBars === 0)
                    this.newPhrase();
                if (this.bar % 8 === 0)
                    this.newPhrase();
                else if (this.bar % 2 === 0 && this.rng.chance(0.4))
                    this.bass = BASSES[this.rng.int(0, BASSES.length - 1)];
            }
        }
    }
    playStep(t, s) {
        const E = this.winBars > 0 ? 1 : this.energy, r = this.rng;
        const ch = this.chord(), root = ch[0];
        // kick: on one and three; four on the floor when it's hot
        if (E > 0.15 && (s === 0 || (s === 8 && E > 0.3) || ((s === 4 || s === 12) && E > 0.65) || (s === 10 && E > 0.45 && r.chance(0.3))))
            this.play('gr.kick', t, 0.55 + 0.2 * E);
        // snap on two and four
        if (E > 0.3 && (s === 4 || s === 12))
            this.play('gr.snap', t, 0.32 + 0.12 * E, (r.next() - 0.5) * 0.3);
        // shaker: eighths, then sixteenths with the off-beats leaned on
        if (E > 0.05 && (s % 2 === 0 || E > 0.5))
            this.play(s % 4 === 2 ? 'gr.shakeL' : 'gr.shake', t, (s % 4 === 2 ? 0.2 : 0.11) * (0.5 + 0.6 * E), 0.35);
        // bass
        for (const [at, what] of this.bass) {
            if (at !== s)
                continue;
            if (E < 0.25 && at !== 0)
                continue;
            const base = 33 + ((root - 9 + 12) % 12);
            const m = what === 'r' ? base : what === 'o' ? base + 12 : what === 'f' ? base + 7 : base + ((this.nextChord()[0] - root + 12) % 12 > 6 ? -1 : 2);
            this.note('bass', near(BASS_NOTES, m), t, 0.62, 0, 0.08);
        }
        // marimba: the offbeat skank (two chord tones)
        if (E > 0.35 && s % 4 === 2) {
            const tones = MARIMBA_NOTES.filter((m) => m >= 64 && m <= 79 && ch.includes(pc(m)));
            tones.slice(0, 2 + (E > 0.7 ? 1 : 0)).forEach((m, k) => this.note('mar', m, t + k * 0.008, 0.16, -0.3 + k * 0.3, 0.25));
        }
        // the motif over it (every other two bars; always when hot)
        const s32 = (this.bar % 2) * 16 + s;
        if (E > 0.5 && (this.bar % 4 < 2 || E > 0.8)) {
            for (const n of this.motif) {
                if (n.at !== s32)
                    continue;
                const scale = MARIMBA_NOTES.filter((m) => m >= 72);
                const i0 = scale.findIndex((m) => pc(m) === root);
                const m = scale[clamp(i0 + n.deg, 0, scale.length - 1)];
                this.note('mar', m, t, 0.26, 0.25, 0.4);
            }
        }
        // a bell of the chord at the top of the bar when it's quiet
        if (E < 0.35 && s === 0)
            this.note('mar', near(MARIMBA_NOTES, 72 + ((root + 12 - 0) % 12)), t, 0.18, -0.2, 0.6);
    }
    play(key, when, gain, pan = 0) {
        const buf = this.core.synth.get(key, this.rng);
        if (buf)
            this.core.play(buf, { bus: 'music', when, gain, pan, rev: 0.12, group: 'music' });
    }
    note(inst, midi, when, gain, pan, rev) {
        const buf = this.core.synth.get(`${inst}.${midi}`);
        if (buf)
            this.core.play(buf, { bus: 'music', when, gain, pan, rev, group: 'music' });
    }
}
//# sourceMappingURL=groove.js.map