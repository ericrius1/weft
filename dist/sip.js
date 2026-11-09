export const SIP_DUR = 3.7;
export const CUPS = { bowl: { r: 0.037, h: 0.052 }, aang: { r: 0.0325, h: 0.0403 }, iroh: { r: 0.0315, h: 0.0505 } };
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** the sip's shape at u s into it */
export function sipAt(u) {
    const k = ss(0, 0.95, u) * (1 - ss(2.55, 3.4, u));
    const tip = ss(0.8, 1.3, u) * (1 - ss(2.2, 2.65, u));
    return {
        k, tip,
        lips: ss(0.4, 0.85, u) * (1 - ss(2.45, 2.85, u)),
        eyes: ss(0.9, 1.2, u) * (1 - ss(2.3, 2.65, u)),
        nod: -0.07 * k * (1 - tip) + 0.05 * tip,
        ahh: ss(2.55, 2.85, u) * (1 - ss(3.25, 3.7, u)),
    };
}
/** a cup's base and up so its near rim rests on the lower lip (lip: the lower lip's front, world; fwd: the way the face
 *  looks), tipped toward the face by `tip` of `maxTilt` (rad) */
export function cupAtLips(lip, fwd, tip, cup, maxTilt = 0.52) {
    // (the face's way, level)
    let fx = fwd[0], fz = fwd[2];
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    const th = maxTilt * tip, c = Math.cos(th), s = Math.sin(th);
    const up = [-fx * s, c, -fz * s];
    // (in the rim's plane, toward the face)
    const n = [-fx * c, -s, -fz * c];
    // (the rim just in front of the lip, its thickness)
    const L = [lip[0] + fx * 0.004, lip[1] - 0.002, lip[2] + fz * 0.004];
    return { at: [L[0] - up[0] * cup.h - n[0] * cup.r, L[1] - up[1] * cup.h - n[1] * cup.r, L[2] - up[2] * cup.h - n[2] * cup.r], up };
}
//# sourceMappingURL=sip.js.map