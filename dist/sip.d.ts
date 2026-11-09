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
export declare const SIP_DUR = 3.7;
/** a cup's size: its rim's radius and height above its base (m) */
export interface CupSize {
    r: number;
    h: number;
}
export declare const CUPS: {
    bowl: {
        r: number;
        h: number;
    };
    aang: {
        r: number;
        h: number;
    };
    iroh: {
        r: number;
        h: number;
    };
};
/** the sip's shape at u s into it */
export declare function sipAt(u: number): SipShape;
/** a cup's base and up so its near rim rests on the lower lip (lip: the lower lip's front, world; fwd: the way the face
 *  looks), tipped toward the face by `tip` of `maxTilt` (rad) */
export declare function cupAtLips(lip: ArrayLike<number>, fwd: ArrayLike<number>, tip: number, cup: CupSize, maxTilt?: number): {
    at: V3;
    up: V3;
};
//# sourceMappingURL=sip.d.ts.map