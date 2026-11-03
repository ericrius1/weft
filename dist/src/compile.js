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
    /** compiles asked of the GPU so far, and made on the spot */
    stats = { compiled: 0, now: 0 };
    chain = Promise.resolve();
    /** `frames`: frames waited between compiles (1) */
    constructor(kit, frames = 1) {
        this.kit = kit;
        this.frames = frames;
    }
    compile(_rec, start) {
        const p = this.chain.then(async () => { for (let i = 0; i < this.frames; i++)
            await nextFrame(); }).then(() => { this.stats.compiled++; return start(); });
        this.chain = p.catch(() => { });
        return p;
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