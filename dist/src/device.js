// What the page is running on, and a guard against a load that crashed (Boulder's and San Francisco's, shared).
//
//   isWebKit()   Safari, or any iPhone/iPad browser (all WebKit underneath; an iPad says it's a Mac): pipelines compile
//                one at a time there (SerialCompiler), and its GPU timestamps aren't to be trusted
//   isPhone()    a phone or a tablet: by its browser, or a compact screen with a coarse pointer
//   gpuName()    the GPU's name as the browser gives it (Chrome names the Apple chip or the card through ANGLE; Safari
//                says "Apple GPU")
//   isAppleGpu() an Apple GPU, a Mac's or a phone's: a tile GPU, where MSAA writes the multisampled depth out every
//                frame (two to four times the frame) — start it without
//
// The load guard (Boulder's, after a friend's RTX 4090 crashed loading the maximum profile): a load marks itself
// unsettled as it starts (begin) and clears the mark once it has run long enough (settle); one that crashed the tab,
// the GPU or the machine never does, and the next load steps a profile down the ladder, kept in this browser as the
// heaviest auto may choose (cap). A GPU lost while the page is shown does the same (failed). A choice by hand isn't
// overruled: reset() forgets the cap.
//
//   const guard = new LoadGuard({ guard: 'game.loadGuard', safe: 'game.safeProfile' }, ['rtx', 'm5', 'm1pro', 'm1air']);
//   const run = byHand ?? guard.choose(detected);
//   guard.begin(run);
//   …the world built, the loop running…
//   guard.settle(() => kit.frameIndex);
//   kit.device.lost.then((i) => { if (i.reason !== 'destroyed') guard.failed(); });
export function isWebKit() {
    if (typeof navigator === 'undefined')
        return false;
    const ua = navigator.userAgent;
    return /iPhone|iPad|iPod/.test(ua) || (/AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua));
}
export function isPhone() {
    if (typeof navigator === 'undefined')
        return false;
    const ua = navigator.userAgent;
    if (/iPhone|iPod|iPad|Android|Mobile.+Firefox/i.test(ua))
        return true;
    // (an iPad's Safari says it's a Mac: a Mac with a touch screen is one)
    if (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
        return true;
    try {
        return typeof screen !== 'undefined' && typeof matchMedia !== 'undefined' && Math.min(screen.width, screen.height) < 600 && matchMedia('(pointer: coarse)').matches;
    }
    catch {
        return false;
    }
}
let gpuNameCache = null;
/** the GPU's name ('' where the browser won't say), asked of a throwaway WebGL context once */
export function gpuName() {
    if (gpuNameCache !== null)
        return gpuNameCache;
    gpuNameCache = '';
    if (typeof document === 'undefined')
        return gpuNameCache;
    try {
        const gl = document.createElement('canvas').getContext('webgl');
        if (!gl)
            return gpuNameCache;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        gpuNameCache = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') : String(gl.getParameter(gl.RENDERER) ?? '');
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    catch { /* unnamed */ }
    return gpuNameCache;
}
export function isAppleGpu(name = gpuName()) {
    if (/Apple/.test(name))
        return true;
    if (typeof navigator === 'undefined')
        return false;
    return /iPhone|iPad|Macintosh/.test(navigator.userAgent) && !/Intel|AMD|NVIDIA|Radeon/i.test(name);
}
export class LoadGuard {
    keys;
    ladder;
    /** the heaviest step auto may choose in this browser (null: no limit) — after a load that crashed */
    cap;
    /** the step the last load ran at, if it never settled (it crashed, or the machine did) */
    crashed;
    running = null;
    timer = null;
    /** `ladder`: the steps auto may choose, heaviest first (a step not on it — a phone's own — is never stepped down) */
    constructor(keys, ladder) {
        this.keys = keys;
        this.ladder = ladder;
        const was = this.read(keys.guard);
        this.crashed = this.valid(was) ? was : null;
        const s = this.read(keys.safe);
        this.cap = this.valid(s) ? s : null;
        if (this.crashed)
            this.lower(this.below(this.crashed));
        if (typeof addEventListener !== 'undefined')
            addEventListener('pagehide', () => this.write(keys.guard, null));
    }
    /** one step lighter than `p` on the ladder (null at its foot, or off it) */
    below(p) {
        const i = this.ladder.indexOf(p);
        return i >= 0 && i < this.ladder.length - 1 ? this.ladder[i + 1] : null;
    }
    /** the lighter of two steps (either null: the other) */
    lighter(a, b) {
        if (!a)
            return b;
        if (!b)
            return a;
        return this.ladder.indexOf(a) >= this.ladder.indexOf(b) ? a : b;
    }
    /** what auto runs: `detected`, no heavier than the cap (a step off the ladder as it is) */
    choose(detected) {
        return this.ladder.includes(detected) ? this.lighter(detected, this.cap) : detected;
    }
    /** the cap lowered to `p` (if it's lighter than the cap) — the governor's last step: lighter from the next load on */
    lower(p) {
        const now = this.lighter(this.cap, p);
        if (now === this.cap)
            return false;
        this.cap = now;
        this.write(this.keys.safe, now);
        return true;
    }
    /** this load runs `step`: marked unsettled until settle() clears it */
    begin(step) {
        this.running = step;
        this.write(this.keys.guard, step);
    }
    /** cleared once the page has shown `seconds` of frames (counted a second at a time, only while visible and only if
     *  frameIndex moved) */
    settle(frameIndex, seconds = 20) {
        if (this.timer)
            clearInterval(this.timer);
        let ran = 0, frame = frameIndex();
        this.timer = setInterval(() => {
            const shown = typeof document === 'undefined' || document.visibilityState === 'visible';
            if (shown && frameIndex() > frame)
                ran++;
            frame = frameIndex();
            if (ran >= seconds) {
                clearInterval(this.timer);
                this.timer = null;
                this.write(this.keys.guard, null);
            }
        }, 1000);
    }
    /** the GPU failed while the page was shown: the next load a step lighter than this one */
    failed() {
        if (this.running)
            this.lower(this.below(this.running));
        this.write(this.keys.guard, null);
    }
    /** forget the cap (a profile chosen by hand) */
    reset() {
        this.cap = null;
        this.write(this.keys.safe, null);
    }
    valid(v) { return !!v && this.ladder.includes(v); }
    read(k) { try {
        return localStorage.getItem(k);
    }
    catch {
        return null;
    } }
    write(k, v) {
        try {
            if (v === null)
                localStorage.removeItem(k);
            else
                localStorage.setItem(k, v);
        }
        catch { /* no guard */ }
    }
}
//# sourceMappingURL=device.js.map