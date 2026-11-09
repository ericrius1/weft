import type { V3 } from './math.js';
/** the quintic Hermite between (p0, v0, a0) and (p1, v1, a1) over h, at u ∈ [0, 1]: its value and its rate */
export declare function hermite5(p0: number, v0: number, a0: number, p1: number, v1: number, a1: number, h: number, u: number): [number, number];
/** the same, for points */
export declare function hermite5v(p0: V3, v0: V3, a0: V3, p1: V3, v1: V3, a1: V3, h: number, u: number): {
    p: V3;
    v: V3;
};
export interface Key<T> {
    t: number;
    v: T;
    vel?: T | 'auto' | 'hold';
}
/** a scalar through keys */
export declare class Track {
    private k;
    constructor(keys: Key<number>[], monotone?: boolean);
    at(t: number): number;
    rate(t: number): number;
    eval(t: number): [number, number];
}
//# sourceMappingURL=track.d.ts.map