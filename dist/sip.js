export const SIP_DUR = 3.7;
export const CUPS = { bowl: { r: 0.037, h: 0.052 }, aang: { r: 0.0325, h: 0.0403 }, iroh: { r: 0.0315, h: 0.0505 } };
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** ease-out cubic for purposeful arrival / gentle settle */
const easeOut = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); const q = 1 - t; return 1 - q * q * q; };
/** the sip's shape at u s into it: purposeful lift with slow-out lip settle, overlapping head anticipation & tilt,
 *  lingering eyes-closed savour, and unhurried lowered cup with a warm contented exhale */
export function sipAt(u) {
    // brisk purposeful lift to the mouth (0..0.88), calm hold while savouring, slower relaxed return to the lap (2.52..3.48)
    const k = easeOut(0, 0.88, u) * (1 - ss(2.52, 3.48, u));
    // slight pause at lip contact before smoothly tipping the rim (0.84..1.34) and settling back upright (2.18..2.62)
    const tip = ss(0.84, 1.34, u) * (1 - ss(2.18, 2.62, u));
    // anticipation: head dips gently early to meet the rising cup, lifts back during tip, then lifts softly on the exhale
    const meet = ss(0.18, 0.82, u) * (1 - ss(1.15, 1.65, u));
    const ahh = ss(2.50, 2.86, u) * (1 - ss(3.18, 3.7, u));
    return {
        k, tip,
        lips: ss(0.36, 0.80, u) * (1 - ss(2.42, 2.86, u)),
        // overlapping action: eyes shut softly just as tea reaches the lip and linger closed a beat past upright
        eyes: ss(0.86, 1.16, u) * (1 - ss(2.38, 2.80, u)),
        nod: -0.075 * meet + 0.055 * tip + 0.022 * ahh,
        ahh,
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