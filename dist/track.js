/** the quintic Hermite between (p0, v0, a0) and (p1, v1, a1) over h, at u ∈ [0, 1]: its value and its rate */
export function hermite5(p0, v0, a0, p1, v1, a1, h, u) {
    const u2 = u * u, u3 = u2 * u, u4 = u3 * u, u5 = u4 * u;
    const h00 = 1 - 10 * u3 + 15 * u4 - 6 * u5, h01 = 1 - h00;
    const h10 = u - 6 * u3 + 8 * u4 - 3 * u5, h11 = -4 * u3 + 7 * u4 - 3 * u5;
    const h20 = 0.5 * (u2 - 3 * u3 + 3 * u4 - u5), h21 = 0.5 * (u3 - 2 * u4 + u5);
    const d00 = (-30 * u2 + 60 * u3 - 30 * u4), d10 = 1 - 18 * u2 + 32 * u3 - 15 * u4, d11 = -12 * u2 + 28 * u3 - 15 * u4;
    const d20 = 0.5 * (2 * u - 9 * u2 + 12 * u3 - 5 * u4), d21 = 0.5 * (3 * u2 - 8 * u3 + 5 * u4);
    const x = h00 * p0 + h01 * p1 + h * (h10 * v0 + h11 * v1) + h * h * (h20 * a0 + h21 * a1);
    const dx = (d00 * p0 - d00 * p1) / h + (d10 * v0 + d11 * v1) + h * (d20 * a0 + d21 * a1);
    return [x, dx];
}
/** the same, for points */
export function hermite5v(p0, v0, a0, p1, v1, a1, h, u) {
    const p = [0, 0, 0], v = [0, 0, 0];
    for (let k = 0; k < 3; k++)
        [p[k], v[k]] = hermite5(p0[k], v0[k], a0[k], p1[k], v1[k], a1[k], h, u);
    return { p, v };
}
/** a scalar through keys */
export class Track {
    k;
    constructor(keys, monotone = false) {
        const K = [...keys].sort((a, b) => a.t - b.t);
        const n = K.length;
        this.k = K.map((key, i) => {
            const prev = K[i - 1], next = K[i + 1];
            let d = 0, a = 0;
            const sl = prev ? (key.v - prev.v) / (key.t - prev.t) : 0, sr = next ? (next.v - key.v) / (next.t - key.t) : 0;
            if (prev && next) {
                const hl = key.t - prev.t, hr = next.t - key.t;
                d = (sl * hr + sr * hl) / (hl + hr);
                a = (2 * (sr - sl)) / (hl + hr);
                // (a key that's a turning point keeps still there: no overshoot past it)
                if (monotone && sl * sr <= 0) {
                    d = 0;
                    a = 0;
                }
                if (monotone && sl * sr > 0)
                    d = Math.sign(d) * Math.min(Math.abs(d), 3 * Math.min(Math.abs(sl), Math.abs(sr)));
            }
            const end = i === 0 || i === n - 1;
            if (key.vel === 'hold' || end) {
                d = 0;
                a = 0;
            }
            if (typeof key.vel === 'number')
                d = key.vel;
            return { t: key.t, v: key.v, d, a };
        });
    }
    at(t) { return this.eval(t)[0]; }
    rate(t) { return this.eval(t)[1]; }
    eval(t) {
        const K = this.k;
        if (t <= K[0].t)
            return [K[0].v, 0];
        if (t >= K[K.length - 1].t)
            return [K[K.length - 1].v, 0];
        let i = 0;
        while (i < K.length - 2 && K[i + 1].t <= t)
            i++;
        const a = K[i], b = K[i + 1], h = b.t - a.t;
        return hermite5(a.v, a.d, a.a, b.v, b.d, b.a, h, (t - a.t) / h);
    }
}
//# sourceMappingURL=track.js.map