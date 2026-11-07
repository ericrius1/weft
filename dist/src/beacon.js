/** starts reporting; returns a function that stops it */
export function perfBeacon(kit, o = {}) {
    const url = o.url ?? '/__beacon', every = o.every ?? 5000;
    let n = 0, t0 = performance.now(), worst = 0, last = performance.now(), on = true;
    const tick = () => {
        if (!on)
            return;
        const now = performance.now();
        worst = Math.max(worst, now - last);
        last = now;
        n++;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const timer = setInterval(() => {
        const now = performance.now(), fps = (n * 1000) / (now - t0);
        const body = {
            fps: +fps.toFixed(1), worst: +worst.toFixed(0), gpu: kit.profiler.available ? +kit.profiler.frameMs.toFixed(1) : -1,
            scale: kit.renderScale, size: kit.size.render, ua: typeof navigator === 'undefined' ? '' : navigator.userAgent.slice(0, 120),
            ...o.extra?.(),
        };
        void fetch(url, { method: 'POST', body: JSON.stringify(body), mode: o.noCors === false ? 'cors' : 'no-cors', keepalive: true }).catch(() => { });
        n = 0;
        t0 = now;
        worst = 0;
    }, every);
    return () => { on = false; clearInterval(timer); };
}
//# sourceMappingURL=beacon.js.map