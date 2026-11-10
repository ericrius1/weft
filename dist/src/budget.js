// Dynamic resolution that holds the frames on anything from a phone to a desktop card, and says when it can't (Boulder's
// and San Francisco's FrameBudget, tuned on an iPhone 16e, shared). An AutoResolution with three things more:
//
//  - WebKit (an iPhone) has timestamp queries, but its are nonsense (a "frame" of 123 s), and its queue answers ~40 ms
//    after a frame's submit even when every frame is on time: neither measures the GPU. There the scale follows the
//    frames themselves: down a step once a tenth of them miss the frame rate held to (kit.maxFps, else 60), up a step
//    after five seconds with at most one in fifty late, never back to a scale that missed in the last 45 s (a phone warms
//    and slows as it plays). A frame the CPU made late isn't helped by fewer pixels and doesn't count.
//  - Where there are no timestamps at all, the GPU's time from the queue: how long after a frame's submit its work is
//    done, one frame measured at a time, smoothed (a stall — a reading over four budgets, a long gap, the tab coming
//    back — starts the measure again).
//  - The governor's hooks: `starved` when the budget can't be held even at the least scale (a fifth over it there for
//    ~8 s, not in the first 20 s, every 20 s at most): make the world lighter; `roomy` when there's room to spare (full
//    scale with the GPU's own trusted time under two fifths of the budget for half a minute): give a step back.
//
// And with `keep` (a localStorage key) the scale that held — unchanged for 20 s, what the device holds warm, not its
// first cool minute — is kept for the next visit to start at (FrameBudget.kept(key)).
//
//   kit.renderScale = FrameBudget.kept('game.autores.scale') ?? 0.85;
//   const fb = new FrameBudget(28, { min: 0.7, max: 1, keep: 'game.autores.scale' });
//   fb.starved = () => lighterWorld();
//   kit.autoRes = fb;
import { AutoResolution } from './kit';
import { isWebKit } from './device';
export class FrameBudget extends AutoResolution {
    /** the scale kept under `key` (0.5..1), or null */
    static kept(key) {
        try {
            const v = Number(localStorage.getItem(key));
            return v >= 0.5 && v <= 1 ? v : null;
        }
        catch {
            return null;
        }
    }
    /** told when the GPU can't hold the budget even at the least scale (see above) */
    starved = null;
    /** told when there's room to spare (see above) */
    roomy = null;
    keep;
    byPace;
    queued = 0;
    waiting = false;
    since = 0;
    frames = 0;
    keptAt = 0;
    keptScale = 0;
    // (paced: the frames since the last step, late or not; how long every frame has been on time; a scale that missed and
    // until when it's off limits; the last frame's start)
    gaps = [];
    onTime = 0;
    lateSince = 0;
    framesSince = 0;
    cap = 2;
    capUntil = 0;
    lastFrame = 0;
    lateShare = 0;
    starve = 0;
    starveFrom = 0;
    starveAt = 0;
    room = 0;
    roomAt = 0;
    constructor(budgetMs, opts = {}) {
        const { keep, byPace, ...rest } = opts;
        super(budgetMs, rest);
        this.keep = keep ?? null;
        this.byPace = byPace ?? isWebKit();
        if (typeof document !== 'undefined')
            document.addEventListener('visibilitychange', () => this.restart());
    }
    restart() { this.queued = 0; this.frames = 0; this.since = 0; this.gaps.length = 0; this.lastFrame = 0; this.lateShare = 0; }
    remember(s) {
        if (!this.keep)
            return;
        const now = performance.now();
        if (s !== this.keptScale) {
            this.keptScale = s;
            this.keptAt = now;
            return;
        }
        if (this.keptAt && now - this.keptAt > 20000) {
            this.keptAt = 0;
            try {
                localStorage.setItem(this.keep, s.toFixed(2));
            }
            catch { /* not kept */ }
        }
    }
    paceFrames(kit) {
        const now = performance.now(), gap = this.lastFrame ? now - this.lastFrame : 0;
        this.lastFrame = now;
        // (a stall — a compile, the tab away — says nothing about the resolution)
        if (!gap || gap > 250)
            return;
        const target = 1000 / (kit.maxFps > 0 ? kit.maxFps : 60);
        // (a frame the CPU made late isn't helped by fewer pixels: the step's own time, from its animation frame)
        const cpu = now - (kit.lastNow ?? now);
        const late = gap > target * 1.3 && cpu < target * 0.7;
        this.gaps.push(late ? 1 : 0);
        // (starved here: a quarter of the frames late, lately, at the least scale)
        this.lateShare += ((late ? 1 : 0) - this.lateShare) * 0.03;
        this.watchStarve(kit, kit.renderScale <= this.min + 0.011 && this.lateShare > 0.25);
        this.onTime += gap / 1000;
        this.framesSince++;
        if (late)
            this.lateSince++;
        const s = kit.renderScale;
        let next = s;
        // (down a step once 10% of frames run late; up after 5 s with at most one in fifty late, never back to a scale
        // that missed in the last 45 s. Tighter still — 6%, one in a hundred — only cost resolution on the iPhone 16e: the
        // few frames still late there are the browser's hiccups, not the GPU's)
        if (this.gaps.length >= 45) {
            const missed = this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length;
            if (missed > 0.1) {
                next = Math.max(this.min, s - this.step);
                this.cap = s;
                this.capUntil = now + 45000;
            }
            this.gaps.length = 0;
        }
        if (next === s && this.onTime > 5) {
            const cap = now < this.capUntil ? this.cap - 0.02 : this.max;
            if (this.lateSince <= this.framesSince * 0.02 && s + 0.04 <= cap + 1e-6)
                next = Math.min(this.max, s + 0.04);
            this.onTime = 0;
            this.lateSince = this.framesSince = 0;
        }
        next = Math.round(next / 0.02) * 0.02;
        if (Math.abs(next - s) < 0.02)
            return;
        kit.renderScale = next;
        this.gaps.length = 0;
        this.onTime = 0;
        this.lateSince = this.framesSince = 0;
        this.onChange?.(next);
    }
    /** `over`: this frame over budget at the least scale */
    watchStarve(kit, over) {
        if (!this.starved)
            return;
        const dt = Math.min(kit.dt || 0, 0.1), now = performance.now();
        if (!this.starveFrom)
            this.starveFrom = now;
        if (now - this.starveFrom < 20000)
            return;
        if (over)
            this.starve += dt;
        else
            this.starve = Math.max(0, this.starve - dt * 0.5);
        if (this.starve > 8 && (!this.starveAt || now - this.starveAt > 20000)) {
            this.starve = 0;
            this.starveAt = now;
            this.room = 0;
            this.starved();
        }
    }
    watchRoom(kit, ms) {
        if (!this.roomy || ms <= 0)
            return;
        const dt = Math.min(kit.dt || 0, 0.1), now = performance.now();
        if (kit.renderScale >= this.max - 0.011 && ms < this.budgetMs * 0.4)
            this.room += dt;
        else
            this.room = 0;
        if (this.room > 30 && now - this.starveAt > 60000 && (!this.roomAt || now - this.roomAt > 60000)) {
            this.room = 0;
            this.roomAt = now;
            this.roomy();
        }
    }
    overAtLeast(kit, ms) { return ms > 0 && kit.renderScale <= this.min + 0.011 && ms > this.budgetMs * 1.2; }
    update(kit) {
        this.remember(kit.renderScale);
        // (AutoResolution paces by itself where the GPU's timestamps aren't trusted: here this pacing does)
        if (this.byPace || (kit.profiler.available && !kit.profiler.trusted)) {
            this.paceFrames(kit);
            return;
        }
        if (kit.profiler.available) {
            super.update(kit);
            this.watchStarve(kit, this.overAtLeast(kit, kit.profiler.frameMs));
            this.watchRoom(kit, kit.profiler.frameMs);
            return;
        }
        if ((kit.dt || 0) > 0.25) {
            this.restart();
            return;
        }
        if (!this.waiting) {
            this.waiting = true;
            const t0 = performance.now();
            void kit.queue.onSubmittedWorkDone().then(() => {
                const ms = performance.now() - t0;
                if (ms < this.budgetMs * 4)
                    this.queued = this.queued ? this.queued * 0.8 + ms * 0.2 : ms;
                this.waiting = false;
            });
        }
        this.since += kit.dt || 1 / 60;
        this.frames++;
        this.watchStarve(kit, this.overAtLeast(kit, this.queued));
        const ms = this.queued, s = kit.renderScale;
        if (ms <= 0 || this.frames < 30 || this.since < this.interval)
            return;
        const fit = s * Math.sqrt(this.budgetMs / ms);
        let next = s;
        if (ms > this.budgetMs)
            next = Math.max(this.min, s - this.step);
        else if (ms < this.budgetMs * this.headroom * 0.85)
            next = Math.min(this.max, s + this.step, fit * Math.sqrt(this.headroom));
        next = Math.round(next / 0.02) * 0.02;
        if (Math.abs(next - s) < 0.02)
            return;
        kit.renderScale = next;
        this.since = 0;
        this.frames = 0;
        this.onChange?.(next);
    }
}
//# sourceMappingURL=budget.js.map