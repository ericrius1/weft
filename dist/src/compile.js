/** a frame's turn: the next animation frame, or a moment where there are none (a worker, a hidden page) */
const nextFrame = () => new Promise((r) => {
    if (typeof requestAnimationFrame !== 'function') {
        setTimeout(r, 16);
        return;
    }
    // (a hidden page gets no animation frames: the timeout keeps the queue moving there)
    const t = setTimeout(r, 100);
    requestAnimationFrame(() => { clearTimeout(t); r(); });
});
export class SerialCompiler {
    kit;
    frames;
    holding = false;
    /** compiles asked of the GPU so far, made on the spot, promoted via urge(), and asks settled without a turn (their
     *  compile already made: on the spot, or by a record sharing it) */
    stats = { compiled: 0, now: 0, urged: 0, spared: 0 };
    queue = [];
    busy = false;
    /** `frames`: frames waited between compiles (1) */
    constructor(kit, frames = 1) {
        this.kit = kit;
        this.frames = frames;
    }
    compile(rec, start, asked) {
        return new Promise((ok, fail) => {
            this.queue.push({ rec, start, ok, fail, urgent: false, asked });
            if (!this.busy)
                void this.pump();
        });
    }
    /** promote a queued pipeline (e.g. a site the camera is approaching) ahead of background compiles */
    urge(rec) {
        const i = this.queue.findIndex((q) => q.rec === rec);
        if (i < 0 || this.queue[i].urgent)
            return;
        const [item] = this.queue.splice(i, 1);
        item.urgent = true;
        const at = this.queue.findIndex((q) => !q.urgent);
        if (at < 0)
            this.queue.push(item);
        else
            this.queue.splice(at, 0, item);
        this.stats.urged++;
    }
    async pump() {
        this.busy = true;
        while (this.queue.length) {
            const item = this.queue.shift();
            // (one whose compile is already made — on the spot, or by the record it shares it with — asks the GPU nothing:
            // settled at once, no frame spent waiting for its turn. A hundred made on the spot were a hundred idle frames)
            if (!item.asked?.())
                for (let i = 0; i < this.frames; i++)
                    await nextFrame();
            if (item.asked?.())
                this.stats.spared++;
            else
                this.stats.compiled++;
            try {
                item.ok(await item.start());
            }
            catch (e) {
                item.fail(e);
            }
        }
        this.busy = false;
    }
    now(rec) {
        if (rec._pipe)
            return;
        const m = this.kit.moduleNow(rec.shader);
        if (!m)
            return;
        this.stats.now++;
        rec.pipeline = rec.makeNow(m);
    }
}
//# sourceMappingURL=compile.js.map