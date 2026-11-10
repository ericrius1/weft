// Keyboard, mouse (with pointer lock) and gamepad, sampled once per frame: `down` is held, `hit` went down this frame.
// Call `input.update()` at the start of a frame and `input.endFrame()` at the end (the per-frame edges reset).
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
export class Input {
    target;
    keys = new Set();
    hits = new Set();
    ups = new Set();
    mouseDX = 0;
    mouseDY = 0;
    wheel = 0;
    buttons = 0;
    mouseHits = 0;
    mouseUps = 0;
    locked = false;
    lastDevice = 'kbm';
    /** standard-mapping gamepad state (null if none) */
    pad = null;
    padPrev = [];
    /** ignore input while typing in a form field */
    typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); };
    constructor(target) {
        this.target = target;
        addEventListener('keydown', (e) => {
            if (this.typing())
                return;
            if (!e.repeat)
                this.hits.add(e.code);
            this.keys.add(e.code);
            this.lastDevice = 'kbm';
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code))
                e.preventDefault();
        });
        addEventListener('keyup', (e) => { this.keys.delete(e.code); this.ups.add(e.code); });
        addEventListener('blur', () => { this.keys.clear(); this.buttons = 0; });
        target.addEventListener('mousedown', (e) => { this.buttons |= 1 << e.button; this.mouseHits |= 1 << e.button; this.lastDevice = 'kbm'; });
        addEventListener('mouseup', (e) => { this.buttons &= ~(1 << e.button); this.mouseUps |= 1 << e.button; });
        addEventListener('mousemove', (e) => {
            if (this.locked || this.buttons) {
                this.mouseDX += e.movementX;
                this.mouseDY += e.movementY;
            }
        });
        target.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
        target.addEventListener('contextmenu', (e) => e.preventDefault());
        document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === target; });
    }
    down(code) { return this.keys.has(code); }
    hit(code) { return this.hits.has(code); }
    released(code) { return this.ups.has(code); }
    mouse(button = 0) { return (this.buttons & (1 << button)) !== 0; }
    mouseHit(button = 0) { return (this.mouseHits & (1 << button)) !== 0; }
    mouseReleased(button = 0) { return (this.mouseUps & (1 << button)) !== 0; }
    /** -1..1 from two keys (and optionally a gamepad axis) */
    axis(neg, pos, padAxis) {
        const any = (k) => (Array.isArray(k) ? k.some((c) => this.keys.has(c)) : this.keys.has(k));
        let v = (any(pos) ? 1 : 0) - (any(neg) ? 1 : 0);
        if (padAxis !== undefined && this.pad) {
            const a = this.pad.axes[padAxis] ?? 0;
            if (Math.abs(a) > 0.15)
                v = Math.max(-1, Math.min(1, v + Math.sign(a) * (Math.abs(a) - 0.15) / 0.85));
        }
        return v;
    }
    padDown(i) { return (this.pad?.buttons[i] ?? 0) > 0.5; }
    padHit(i) { return (this.pad?.buttons[i] ?? 0) > 0.5 && (this.padPrev[i] ?? 0) <= 0.5; }
    padValue(i) { return this.pad?.buttons[i] ?? 0; }
    lock() { if (!this.locked)
        this.target.requestPointerLock?.()?.catch?.(() => { }); }
    unlock() { if (this.locked)
        document.exitPointerLock(); }
    /** poll the gamepad (call at the start of the frame) */
    update() {
        const pads = navigator.getGamepads?.() ?? [];
        const gp = [...pads].find((p) => p && p.connected && p.mapping === 'standard') ?? [...pads].find((p) => p && p.connected);
        this.padPrev = this.pad?.buttons ?? [];
        if (gp) {
            const buttons = gp.buttons.map((b) => b.value);
            const axes = [...gp.axes];
            if (buttons.some((b) => b > 0.5) || axes.some((a) => Math.abs(a) > 0.3))
                this.lastDevice = 'pad';
            this.pad = { axes, buttons };
        }
        else
            this.pad = null;
    }
    /** clear this frame's edges and deltas */
    endFrame() {
        this.hits.clear();
        this.ups.clear();
        this.mouseHits = 0;
        this.mouseUps = 0;
        this.mouseDX = 0;
        this.mouseDY = 0;
        this.wheel = 0;
    }
}
//# sourceMappingURL=input.js.map