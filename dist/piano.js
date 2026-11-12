// Playing an instrument: what an instrument offers a player (where to sit, the point each note is pressed at, which
// notes are sounding) and the pianist's mind that turns the notes into her hands — which hand plays what (the low
// notes the left, the high the right, split where they part), where each hand sits over the keys (it stays put while
// its fingers can reach, and moves when a note is out of its span), which finger takes which note (by the hand's
// natural spacing, thumb inward), each pressing finger's tip down with its key, the rest resting curled over the keys;
// the right foot on the sustain pedal. With a score (her playing the piece by herself) the hands also look ahead and
// move to the next notes before they're struck. Getting up, she rises and sidesteps out past an end of the seat
// (one with room round it), so she's never left standing in the furniture. The grand piano is one
// instrument; anything else exposing a Playable (a keyboard, a marimba — strings would add their own "press" points) is
// played the same way.
//
// On a score's clock (playScore(score, { clock })): the whole piece is planned once instead — every note a hand and a
// finger (a chord too wide for one hand shares its outer note with the other; a note neither can reach is still given
// a finger and listed in `simplified`, never dropped), each hand's travel from the score's look-ahead so it's there
// before the note, and every finger's height a stroke on the clock (strike.ts's anticipation, contact and release at a
// finger's scale): over its key, a fall that quickens onto it landing on the note's second, through the key's travel,
// up as it's let go — and a key struck again let up first, so a repeated note or chord is struck on its beat. The
// pose is then a function of the clock's second, not of the frames before it: the caller schedules the sound ahead
// on the audio clock (`struck` says which finger lands when) and a frame shows the finger on the key it hears.
//
// (@ericrius1/cast: Boulder's hero/perform.ts, its Performer named Pianist here — `Performer` is kept as an alias — and
// the piano, sound and score it reads given as the shapes it needs of them, so any project's keyboard can be one.)
import { add, sub, scale, dot, norm, clamp, lerp, damp, cdSpring } from './math.js';
/** the grand piano as a Playable: the bench, the keys' tops, the sounding notes, the sustain pedal */
export function pianoPlayable(m, piano) {
    const A = m.axes;
    const yaw = Math.atan2(-m.facing[0], -m.facing[2]);
    // (the pelvis a little forward on the bench, its hips ~9 cm over the seat; the feet below the keys, the right on
    // the sustain pedal; she stands to sit between the bench and the keys)
    const floor = (p) => [p[0], m.seat[1] - 0.5, p[2]];
    const pelvis = add(add(m.seat, scale(A.up, 0.125)), scale(A.toward, -0.06));
    const left = floor(add(add(m.keyboard, scale(A.along, -0.17)), scale(A.toward, 0.12)));
    const right = add(m.pedalTop, scale(A.toward, 0.07));
    return {
        name: 'piano',
        seat: { pelvis, yaw, feet: [left, right] },
        stand: floor(sub(m.seat, scale(A.toward, 0.2))),
        // (past the bench's ends — it's 0.78 m long: 0.8 m from its middle clears it by a body's width — the bass end first:
        // a grand's lid opens over the treble side)
        leave: [-1, 1].map((s) => floor(add(m.seat, scale(A.along, s * 0.8)))),
        notePoint: (n) => (n >= 21 && n <= 108 ? m.touch(n) : null),
        pressDir: scale(A.up, -1),
        pressDepth: 0.0095,
        state: piano.state,
        low: 21, high: 108,
        axes: A,
        look: m.look,
        pedal: () => (piano.pedalState.sustain ? 1 : 0),
    };
}
/** finger rest offsets along the keys from the hand's centre (thumb to pinky), for the right hand (the left mirrored) */
const SPREAD = [-0.05, -0.024, 0, 0.0235, 0.046];
/** on a clock: where a cast hand's fingertips rest from its palm's middle along the keys (thumb to pinky, the right
 *  hand: measured on the rig — the thumb tucked under the index, the reach about 3 cm either side), a hover over a key,
 *  its fall (s), how far ahead of the fall a finger goes over its key (s), its lift between strokes (s), how far ahead
 *  of its note a hand is in place (s), the longest a hand moves for (s), the widest chord one hand takes (m), the
 *  pad's thickness under the tip's joint (m), and how far ahead of its note's second a stroke lands (s: a rig's
 *  fingertip follows its goal about a frame behind) — tuned against a seated cast body in a 60 fps harness */
const SLOTS = [-0.028, -0.023, -0.007, 0.010, 0.029];
const HOVER = 0.014, FALL = 0.1, REACH = 0.2, LIFT = 0.075, TRAVEL_END = 0.08, TRAVEL_MAX = 0.3, SPAN = 0.06, PAD = 0.004, LAND = 0.004;
export class Pianist {
    inst = null;
    /** how far she's sat down (0..1), and whether she's on her way to the seat or getting up */
    w = 0;
    state = 'idle';
    /** a piece she plays by herself: the score, its clock, what's been struck */
    score = null;
    scoreT = 0;
    scoreNext = 0;
    /** the score's notes struck and not yet let go: when (on the score's clock) */
    offs = [];
    pedalNext = 0;
    hands = [{ x: -0.18, xv: 0, notes: new Map() }, { x: 0.12, xv: 0, notes: new Map() }];
    tipDown = new Float32Array(128);
    approachFrom = null;
    approachYaw = 0;
    t = 0;
    /** how freely she could walk off from a spot (the more ways open round it, the higher; 0 inside something): set by
     *  whoever knows the walls and the furniture */
    freedom = null;
    /** the way with the longest clear walk from a spot, near a preferred yaw (katara.ts asks the house's collider) */
    openHeading = null;
    /** getting up: from where she was to where she steps, the way she faces, and how far she's gone (0..1) */
    leaveFrom = null;
    leaveTo = null;
    leaveYaw = 0;
    /** getting up: the way she turns to as she steps out (the clearest from where she lands) */
    leaveOut = 0;
    out = 0;
    /** where the palm sits from the press line: toward her, and up (m) */
    reach = [0.01, 0.038];
    /** the widest a hand holds at once, thumb to pinky along the keys (m: about a seventh; past it the older notes ring on
     *  under the pedal: the fingers' stretch, not the hand's size, is the limit — scored) */
    span = 0.135;
    /** how far each hand may tilt about its own way to ease the arm (rad; hero/rig.ts HandGoal.turn) */
    turn = 0.3;
    /** when each note's key went down (or it first came up in the score's look-ahead): the newest are the hand's */
    onAt = new Float32Array(128).fill(-1);
    /** each hand's correction (closed loop: what its pressing fingertips missed by, fed back into where the hand sits) */
    fix = [[0, 0, 0], [0, 0, 0]];
    /** the fingertip targets planned this frame, per hand (thumb .. pinky), and the palms */
    planned = [[null, null, null, null, null], [null, null, null, null, null]];
    palms = [[0, 0, 0], [0, 0, 0]];
    /** play a note (the score's), and release it */
    noteOn = null;
    noteOff = null;
    pedalSet = null;
    /** on a clock (playScore's `clock`): the piece as planned — every note's stroke; any note that had to be simplified
     *  (said, never dropped); which fingers have a key to play this frame (only these steer the palm) */
    struck = [];
    simplified = [];
    active = [[false, false, false, false, false], [false, false, false, false, false]];
    clock = null;
    byFinger = [[[], [], [], [], []], [[], [], [], [], []]];
    path = [[], []];
    sit(inst, from, yaw) {
        this.inst = inst;
        this.state = 'approach';
        this.approachFrom = [...from];
        this.approachYaw = yaw;
        this.t = 0;
        const c = this.centre();
        this.hands[0].x = c - 0.2;
        this.hands[1].x = c + 0.14;
    }
    stand() {
        if (this.state === 'idle' || this.state === 'leaving')
            return;
        const b = this.body();
        this.leaveFrom = b.pos;
        this.leaveYaw = b.yaw;
        this.leaveTo = this.away();
        const step = Math.atan2(-(this.leaveTo[0] - b.pos[0]), -(this.leaveTo[2] - b.pos[2]));
        this.leaveOut = this.openHeading?.(this.leaveTo, step) ?? step;
        this.out = 0;
        this.state = 'leaving';
        this.stopScore();
    }
    /** where to step on getting up: the first of the instrument's spots with room enough round it, else the most open
     *  of them, or back where she came from (through the seat) only if that's more open still by a way */
    away() {
        const I = this.inst;
        const spots = this.approachFrom ? [...I.leave, this.approachFrom] : [...I.leave];
        let best = spots[0], most = -1;
        for (const p of spots) {
            const f = (this.freedom?.(p) ?? 16) - (p === this.approachFrom ? 3 : 0);
            if (f >= 5 && p !== this.approachFrom)
                return p;
            if (f > most) {
                most = f;
                best = p;
            }
        }
        return best;
    }
    /** let her play a piece by herself: by default its times from now, on the frames' dt; with `clock` (the score's second
     *  now: an audio transport's, a film's), planned whole and posed from the clock (sit() first: it needs the keys) */
    playScore(score, o = {}) {
        this.score = score;
        this.scoreT = -0.6;
        this.scoreNext = 0;
        this.pedalNext = 0;
        this.clock = o.clock ?? null;
        this.struck = [];
        if (this.clock)
            this.planScore(score);
    }
    stopScore() {
        if (!this.score)
            return;
        this.offs.length = 0;
        for (let n = 21; n <= 108; n++)
            this.noteOff?.(n);
        this.pedalSet?.(false);
        this.score = null;
        // (and off the clock: the hands back on the frames' dt, not miming the rest of the piece unheard)
        this.clock = null;
        this.struck = [];
    }
    get playingScore() { return !!this.score; }
    /** the keyboard's middle, as a coordinate along it */
    centre() {
        const I = this.inst;
        const p = I.notePoint(60) ?? I.look;
        return dot(p, I.axes.along);
    }
    /** getting up, the way she'll face once out (null otherwise) */
    get rising() { return this.state === 'leaving' ? this.leaveOut : null; }
    /** her root while sitting down or getting up (null: she's free), her facing */
    body() {
        const I = this.inst;
        if (!I || this.state === 'idle')
            return null;
        if (this.state === 'leaving' && this.leaveFrom && this.leaveTo) {
            // (a sidestep, facing the instrument, then turning to the way out: up again, the view behind her looks out, not
            // back at the keys)
            const a = this.leaveFrom, b = this.leaveTo, e = this.out * this.out * (3 - 2 * this.out);
            const d = Math.atan2(Math.sin(this.leaveOut - this.leaveYaw), Math.cos(this.leaveOut - this.leaveYaw));
            const turn = clamp((this.out - 0.4) / 0.6, 0, 1);
            return { pos: [lerp(a[0], b[0], e), lerp(a[1], b[1], e), lerp(a[2], b[2], e)], yaw: this.leaveYaw + d * turn * turn * (3 - 2 * turn) };
        }
        const k = this.state === 'approach' ? clamp(this.t / 0.7, 0, 1) : 1;
        const from = this.approachFrom ?? I.stand;
        const e = k * k * (3 - 2 * k);
        const yaw = this.approachYaw + Math.atan2(Math.sin(I.seat.yaw - this.approachYaw), Math.cos(I.seat.yaw - this.approachYaw)) * e;
        return { pos: [lerp(from[0], I.stand[0], e), lerp(from[1], I.stand[1], e), lerp(from[2], I.stand[2], e)], yaw };
    }
    /** this frame: the score's notes, the sit's weight, and the pose (null when she's not at an instrument) */
    update(dt, audioNow) {
        const I = this.inst;
        if (!I || this.state === 'idle')
            return null;
        this.t += dt;
        if (this.state === 'approach' && this.t > 0.55)
            this.w = Math.min(1, this.w + dt / 0.75);
        if (this.state === 'approach' && this.w >= 1)
            this.state = 'seated';
        if (this.state === 'leaving') {
            this.w = Math.max(0, this.w - dt / 0.6);
            // (most of the way up, she steps out)
            if (this.w < 0.45)
                this.out = Math.min(1, this.out + dt / 0.6);
            if (this.w <= 0 && this.out >= 1) {
                this.state = 'idle';
                this.inst = null;
                return null;
            }
        }
        const clocked = this.clock && this.struck.length ? this.clock() : null;
        if (this.score && this.state === 'seated')
            this.stepScore(dt, audioNow, clocked);
        return { pelvis: I.seat.pelvis, yaw: I.seat.yaw, feet: I.seat.feet, hands: clocked !== null ? this.planAt(clocked) : this.plan(dt), look: I.look, lean: 0.2, w: this.w };
    }
    stepScore(dt, now, clocked = null) {
        const S = this.score;
        this.scoreT = clocked ?? this.scoreT + dt;
        while (this.scoreNext < S.notes.length && S.notes[this.scoreNext].t0 <= this.scoreT) {
            const n = S.notes[this.scoreNext++];
            this.noteOn?.(n.note, n.vel);
            // (let go on the score's own clock, as it was struck: a slow frame or the pause holds it with the rest)
            this.offs.push({ t: n.t0 + Math.max(0.06, n.t1 - n.t0), note: n.note });
        }
        for (let i = this.offs.length - 1; i >= 0; i--)
            if (this.offs[i].t <= this.scoreT) {
                this.noteOff?.(this.offs[i].note);
                this.offs.splice(i, 1);
            }
        // (the index moved outside the call: inside `pedalSet?.(…)` it was skipped with no callback, and this looped forever)
        while (this.pedalNext < S.pedal.length && S.pedal[this.pedalNext].t <= this.scoreT) {
            const p = S.pedal[this.pedalNext++];
            this.pedalSet?.(p.down);
        }
        if (this.scoreT > S.duration)
            this.stopScore();
        void now;
    }
    /** the fingertips as the rig put them (per hand, thumb .. pinky): what the pressing ones missed by moves the hand */
    feedback(actual, dt) {
        for (let h = 0; h < 2; h++) {
            let n = 0;
            const e = [0, 0, 0];
            for (let f = 0; f < 5; f++) {
                const want = this.planned[h][f], got = actual[h][f];
                if (!want || !got || (this.clock && !this.active[h][f]))
                    continue;
                e[0] += want[0] - got[0];
                e[1] += want[1] - got[1];
                e[2] += want[2] - got[2];
                n++;
            }
            const F = this.fix[h];
            // (on a clock slower and further: the hand's place is planned, and a quick correction against the rig's own lag
            // swings — tools measured 3/s best)
            const gain = this.clock ? 3 : 12, lim = this.clock ? 0.05 : 0.035;
            const k = n ? 1 - Math.exp(-dt * gain) : 1 - Math.exp(-dt * 2);
            for (let i = 0; i < 3; i++)
                F[i] = clamp(n ? F[i] + (e[i] / n) * k : F[i] * (1 - k), -lim, lim);
        }
    }
    /** the notes the hands are to play now: what's sounding, and with a score what's coming within a beat; each with when
     *  it came (`at`: the coming ones count as newest) */
    targets() {
        const I = this.inst;
        const out = [];
        for (let n = I.low; n <= I.high; n++) {
            const s = I.state[n - I.low];
            if (s > 0.02) {
                if (this.onAt[n] < 0)
                    this.onAt[n] = this.t;
                out.push({ note: n, down: s, soon: 0, at: this.onAt[n] });
            }
            else
                this.onAt[n] = -1;
        }
        const S = this.score;
        if (S) {
            for (let k = this.scoreNext; k < S.notes.length && S.notes[k].t0 < this.scoreT + 0.35; k++) {
                const n = S.notes[k];
                if (!out.some((o) => o.note === n.note))
                    out.push({ note: n.note, down: 0, soon: 1 - (n.t0 - this.scoreT) / 0.35, at: this.t + 1 });
            }
        }
        return out;
    }
    /** what one hand holds: the newest of its notes that fit its span (older ones held longer than a hand can stretch
     *  — the bass note under the chord, a melody note left ringing — sound on under the pedal, the fingers gone on) */
    holdable(G) {
        if (G.length < 2 || G[G.length - 1].x - G[0].x <= this.span)
            return G;
        const byNew = [...G].sort((a, b) => b.at - a.at);
        const keep = [];
        let lo = Infinity, hi = -Infinity;
        for (const t of byNew) {
            const l = Math.min(lo, t.x), h = Math.max(hi, t.x);
            if (keep.length && h - l > this.span)
                continue;
            keep.push(t);
            lo = l;
            hi = h;
        }
        return keep.sort((a, b) => a.x - b.x);
    }
    /** the hands' goals: each hand's place over the keys and each finger's tip */
    plan(dt) {
        const I = this.inst, A = I.axes;
        const tg = this.targets();
        // which hand: below the split the left, above it the right — the split where the notes part (a gap), else middle C
        const xs = tg.map((t) => ({ ...t, x: dot(I.notePoint(t.note), A.along) })).sort((a, b) => a.x - b.x);
        let split = this.centre();
        if (xs.length >= 2) {
            let gap = 0;
            for (let i = 1; i < xs.length; i++) {
                const g = xs[i].x - xs[i - 1].x;
                if (g > gap) {
                    gap = g;
                    split = (xs[i].x + xs[i - 1].x) / 2;
                }
            }
            // (one hand can't span more than about a ninth: a cluster wider than that is two hands anyway)
            if (gap < 0.04 && xs[xs.length - 1].x - xs[0].x < 0.2)
                split = xs[0].x > this.centre() ? xs[0].x - 1 : xs[xs.length - 1].x + 1;
        }
        else if (xs.length === 1)
            split = xs[0].x < this.centre() ? xs[0].x + 0.5 : xs[0].x - 0.5;
        const groups = [this.holdable(xs.filter((t) => t.x < split)), this.holdable(xs.filter((t) => t.x >= split))];
        const goals = [];
        for (let h = 0; h < 2; h++) {
            const H = this.hands[h], G = groups[h];
            const side = h === 0 ? -1 : 1;
            // fingers: each note to the finger whose resting place is nearest, in order along the keys (thumb inward)
            const tips = [null, null, null, null, null];
            const order = side > 0 ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
            const rest = order.map((f) => H.x + SPREAD[f] * side);
            const fingerOf = [];
            let fj = 0;
            for (const t of G) {
                while (fj < 4 && Math.abs(rest[fj + 1] - t.x) < Math.abs(rest[fj] - t.x))
                    fj++;
                fingerOf.push(fj);
                fj = Math.min(4, fj + 1);
            }
            // the hand: over its notes so each finger's resting place is over the note it takes (quickly when a note is out of
            // the fingers' reach from where it is, gently while they can reach: the hand settles over the chord); no notes, it
            // drifts back to its resting place beside the middle
            if (G.length) {
                const lo = G[0].x, hi = G[G.length - 1].x;
                const span = [H.x + SPREAD[0] * (side > 0 ? 1 : -1), H.x + SPREAD[4] * (side > 0 ? 1 : -1)].sort((a, b) => a - b);
                const out = lo < span[0] - 0.004 || hi > span[1] + 0.004;
                let fit = 0;
                G.forEach((t, i) => { fit += t.x - SPREAD[order[fingerOf[i]]] * side; });
                fit /= G.length;
                // (a chord wider than the resting spread: centred on it, the fingers spread to it)
                const want = hi - lo > SPREAD[4] - SPREAD[0] ? (lo + hi) / 2 : fit;
                [H.x, H.xv] = cdSpring(H.x, H.xv, want, out ? 38 : 14, dt);
            }
            else {
                [H.x, H.xv] = cdSpring(H.x, H.xv, this.centre() + (h === 0 ? -0.2 : 0.14), 4, dt);
            }
            let fi = 0;
            for (const t of G) {
                fi = fingerOf[G.indexOf(t)];
                const f = order[fi];
                const p = I.notePoint(t.note);
                // (down with its key; a note about to be struck hovers its finger just over it)
                const k = this.tipDown[t.note] = damp(this.tipDown[t.note], t.down, t.down > this.tipDown[t.note] ? 60 : 25, dt);
                const lift = t.down > 0 ? 0 : 0.012 * (1 - t.soon);
                tips[f] = add(add(p, scale(I.pressDir, I.pressDepth * k)), scale(A.up, lift + 0.004));
            }
            // the palm: just in front of where the fingers press, its middle finger's line, a few cm over the white keys
            const mid = I.notePoint(60);
            const base = add(add(mid, scale(A.along, H.x - dot(mid, A.along))), scale(A.toward, this.reach[0]));
            const palm = add(add(base, scale(A.up, this.reach[1])), this.fix[h]);
            this.planned[h] = tips;
            this.palms[h] = palm;
            const fwd = norm(add(scale(A.toward, -1), scale(A.up, -0.18)));
            // (the hand may tilt a little about its own way, as a pianist's does, to ease a forearm at its full turn)
            goals.push({ palm, fwd, down: scale(A.up, -1), tips, turn: this.turn });
        }
        return [goals[0], goals[1]];
    }
    // ---------------------------------------------------------------- on a score's clock
    along(n) { return dot(this.inst.notePoint(n), this.inst.axes.along); }
    /** the whole piece planned: hands, fingers, strokes, each hand's places */
    planScore(score) {
        const I = this.inst;
        if (!I)
            throw new Error('Pianist: sit() before playScore() on a clock');
        this.simplified = [];
        const notes = score.notes.filter((n) => I.notePoint(n.note));
        for (const n of score.notes)
            if (!I.notePoint(n.note))
                this.simplified.push(`${n.t0.toFixed(2)} ${n.note}: off the keyboard`);
        // (chords: notes struck within 30 ms of each other)
        const events = [];
        for (const n of [...notes].sort((a, b) => a.t0 - b.t0 || a.note - b.note)) {
            const e = events[events.length - 1];
            if (e && n.t0 - e[0].t0 < 0.03)
                e.push(n);
            else
                events.push([n]);
        }
        const c = this.centre(), split = c - 0.012;
        // (each hand starts over its first notes: nothing to travel for the first chord)
        const first = (left) => { const n = notes.find((x) => (this.along(x.note) < split) === left); return n ? this.along(n.note) - SLOTS[2] * (left ? -1 : 1) : left ? c - 0.2 : c + 0.14; };
        const last = [first(true), first(false)];
        this.path = [[{ t: -Infinity, x: last[0] }], [{ t: -Infinity, x: last[1] }]];
        const struck = [];
        const width = (g) => (g.length ? g[g.length - 1].x - g[0].x : 0);
        for (const e of events) {
            const xs = e.map((n) => ({ n, x: this.along(n.note) })).sort((a, b) => a.x - b.x);
            // which hand: below middle C the left; a hand that can't span its share gives its outer note to the other if that
            // one then can
            const H = [xs.filter((o) => o.x < split), xs.filter((o) => o.x >= split)];
            for (let k = 0; k < 4; k++) {
                if (width(H[0]) > SPAN && width([...H[1], H[0][H[0].length - 1]].sort((a, b) => a.x - b.x)) <= SPAN)
                    H[1].unshift(H[0].pop());
                else if (width(H[1]) > SPAN && width([H[1][0], ...H[0]].sort((a, b) => a.x - b.x)) <= SPAN)
                    H[0].push(H[1].shift());
            }
            for (const h of [0, 1]) {
                const G = H[h];
                if (!G.length)
                    continue;
                if (width(G) > SPAN)
                    this.simplified.push(`${G[0].n.t0.toFixed(2)} ${G.map((o) => o.n.note).join(',')}: wider than a hand, stretched for`);
                const side = h === 0 ? -1 : 1, cur = last[h], lo = G[0].x, hi = G[G.length - 1].x;
                // the hand stays while every note is in a finger's reach of where it rests; else it's centred on a chord, or put
                // so the nearest of index, middle and ring is over a single note (a cast hand's thumb and pinky come down short
                // of a key)
                const slots = SLOTS.map((o) => cur + o * side);
                let x = cur;
                if (lo < Math.min(...slots) - 0.006 || hi > Math.max(...slots) + 0.006) {
                    if (G.length > 1)
                        x = (lo + hi) / 2;
                    else {
                        let best = Infinity;
                        for (let f = 1; f < 4; f++) {
                            const t = G[0].x - SLOTS[f] * side;
                            if (Math.abs(t - cur) < best) {
                                best = Math.abs(t - cur);
                                x = t;
                            }
                        }
                    }
                }
                const used = new Set(), rest = SLOTS.map((o) => x + o * side), fs = [];
                for (const o of G) {
                    let f = 1, bd = Infinity;
                    for (let k = G.length > 4 ? 0 : 1; k < (G.length > 3 ? 5 : 4); k++) {
                        if (used.has(k))
                            continue;
                        const d = Math.abs(rest[k] - o.x);
                        if (d < bd) {
                            bd = d;
                            f = k;
                        }
                    }
                    used.add(f);
                    fs.push(f);
                }
                // (and where a moved hand goes, set by its fingers: each finger's resting place as near its note as can be —
                // the slots aren't symmetric about the palm, so a chord's middle isn't the hand's)
                if (x !== cur)
                    x = G.reduce((m, o, i) => m + o.x - SLOTS[fs[i]] * side, 0) / G.length;
                if (x !== cur)
                    this.path[h].push({ t: G[0].n.t0, x });
                last[h] = x;
                G.forEach((o, i) => struck.push({ note: o.n.note, t0: o.n.t0, t1: o.n.t1, hand: h, finger: fs[i], x: o.x, up: o.n.t1 }));
            }
        }
        // (each finger's strokes in order; a hold cut short so the finger's up before its next fall)
        this.byFinger = [[[], [], [], [], []], [[], [], [], [], []]];
        for (const st of struck.sort((a, b) => a.t0 - b.t0))
            this.byFinger[st.hand][st.finger].push(st);
        for (const H of this.byFinger)
            for (const F of H)
                for (let i = 0; i + 1 < F.length; i++) {
                    const a = F[i], b = F[i + 1];
                    a.up = Math.max(a.t0 + 0.03, Math.min(a.t1, b.t0 - FALL - LIFT * 0.6));
                }
        this.struck = struck;
    }
    /** a hand's centre at second s: eased from one place to the next, arriving TRAVEL_END before the note it's for */
    handAt(h, s) {
        const P = this.path[h];
        let i = 0;
        while (i + 1 < P.length && P[i + 1].t - TRAVEL_END <= s)
            i++;
        const a = P[i], b = P[i + 1];
        if (!b)
            return a.x;
        const end = b.t - TRAVEL_END, start = Math.max(Number.isFinite(a.t) ? a.t + 0.02 : -Infinity, end - TRAVEL_MAX);
        if (s <= start)
            return a.x;
        const u = clamp((s - start) / Math.max(1e-3, end - start), 0, 1);
        return lerp(a.x, b.x, u * u * (3 - 2 * u));
    }
    /** a finger's stroke at second s: its note (null: resting) and its tip's height over the key's top (m) */
    stroke(h, f, s) {
        let st = null;
        // (the next stroke takes the finger only once this one's let go: never before it's landed)
        for (const x of this.byFinger[h][f]) {
            if (x.t0 - FALL - REACH > s || (st && s < st.up))
                break;
            st = x;
        }
        if (!st)
            return { st: null, dy: HOVER };
        const D = this.inst.pressDepth;
        // (it lands LAND before the note's second: a rig's fingertip follows its goal about a frame behind)
        const t0 = st.t0 - LAND;
        if (s < t0) {
            const u = clamp((t0 - s) / FALL, 0, 1);
            return { st, dy: HOVER * (1 - (1 - u) ** 3) };
        }
        if (s < st.up)
            return { st, dy: -D * Math.min(1, (s - t0) / 0.012) };
        const u = clamp((s - st.up) / LIFT, 0, 1);
        return { st: s - st.up > 0.6 ? null : st, dy: -D + (D + HOVER) * Math.sin((Math.PI / 2) * u) };
    }
    /** the hands' goals at the clock's second s */
    planAt(s) {
        const I = this.inst, A = I.axes, mid = I.notePoint(60) ?? I.look;
        const goals = [];
        for (let h = 0; h < 2; h++) {
            const side = h === 0 ? -1 : 1, x = this.handAt(h, s);
            const tips = [null, null, null, null, null];
            // (the palm as high over the keyboard as the highest key its fingers are on: a black key's top stands over a
            // white's, and a finger can only lift so far over its palm)
            let high = 0;
            for (let f = 0; f < 5; f++) {
                const { st, dy } = this.stroke(h, f, s);
                this.active[h][f] = !!st;
                if (st)
                    high = Math.max(high, dot(sub(I.notePoint(st.note), mid), A.up));
                // (a finger with nothing to play rests over its place at a hover: left to the rig's curl it sinks below the
                // keys' tops and comes up through them)
                const p = st ? I.notePoint(st.note) : add(add(mid, scale(A.along, x + SLOTS[f] * side - dot(mid, A.along))), scale(A.toward, -0.03));
                tips[f] = add(p, scale(A.up, PAD + dy));
            }
            const base = add(add(mid, scale(A.along, x - dot(mid, A.along))), scale(A.toward, this.reach[0]));
            const palm = add(add(base, scale(A.up, this.reach[1] + high)), this.fix[h]);
            this.planned[h] = tips;
            this.palms[h] = palm;
            goals.push({ palm, fwd: norm(add(scale(A.toward, -1), scale(A.up, -0.18))), down: scale(A.up, -1), tips, turn: this.turn });
        }
        return [goals[0], goals[1]];
    }
}
/** (Boulder's name for it) */
export { Pianist as Performer };
//# sourceMappingURL=piano.js.map