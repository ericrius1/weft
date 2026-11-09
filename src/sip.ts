// A sip of tea, the same for everyone (Katara's bowl, Aang's and Iroh's cups, the townsfolk's): the cup comes up in the
// hand, the lips part for it as it nears, it tips against the lower lip while the eyes close, it goes back down and they
// breathe out, content. `sipAt(u)` is the moment's shape on its own clock (u: seconds since it began; over by SIP_DUR);
// `cupAtLips` puts a cup's near rim on the lower lip, tipped toward the face; `face.drink(shape)` (face.ts) shows it.
//   const s = sipAt(u);  cupAt = lerp3(lapCup, cupAtLips(rig.J.lip, rig.J.headFwd, s.tip, CUP).at, s.k);  face.drink(s);
import type { V3 } from './math.js';

export interface SipShape {
  /** the cup's way from the lap to the lips (0..1) */
  k: number;
  /** tipped to drink (0..1) */
  tip: number;
  /** the lips parted to the rim (0..1) */
  lips: number;
  /** the eyes closed while drinking (0..1) */
  eyes: number;
  /** the head: down to meet the cup (negative), then back a little as it tips (radians of pitch, + up) */
  nod: number;
  /** the breath out after it: content (0..1) */
  ahh: number;
}
export const SIP_DUR = 3.7;
/** a cup's size: its rim's radius and height above its base (m) */
export interface CupSize { r: number; h: number }
export const CUPS = { bowl: { r: 0.037, h: 0.052 }, aang: { r: 0.0325, h: 0.0403 }, iroh: { r: 0.0315, h: 0.0505 } } satisfies Record<string, CupSize>;

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** the sip's shape at u s into it */
export function sipAt(u: number): SipShape {
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
export function cupAtLips(lip: ArrayLike<number>, fwd: ArrayLike<number>, tip: number, cup: CupSize, maxTilt = 0.52): { at: V3; up: V3 } {
  // (the face's way, level)
  let fx = fwd[0], fz = fwd[2];
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl; fz /= fl;
  const th = maxTilt * tip, c = Math.cos(th), s = Math.sin(th);
  const up: V3 = [-fx * s, c, -fz * s];
  // (in the rim's plane, toward the face)
  const n: V3 = [-fx * c, -s, -fz * c];
  // (the rim just in front of the lip, its thickness)
  const L: V3 = [lip[0] + fx * 0.004, lip[1] - 0.002, lip[2] + fz * 0.004];
  return { at: [L[0] - up[0] * cup.h - n[0] * cup.r, L[1] - up[1] * cup.h - n[1] * cup.r, L[2] - up[2] * cup.h - n[2] * cup.r], up };
}
