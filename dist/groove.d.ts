import type { Groove } from './rig.js';
export interface Feel {
    /** the knees' give (m) on a beat and extra on the drop */
    dip: number;
    drop: number;
    /** the weight's roll over the bar (m), the chest's turn and roll against it (rad) */
    sway: number;
    twist: number;
    roll: number;
    /** the nod (rad), how far behind the beat it comes (a fraction of a beat), the head's tilt with the sway (rad) */
    nod: number;
    lag: number;
    tilt: number;
    /** a rock of the chest with the skank (rad) */
    rock: number;
}
/** the dance at this point of the bar (bar 0..1, beat 3 at 0.5), by k (0 still .. 1 dancing), the kick's punch */
export declare function groove(bar: number, k: number, F: Feel, kick?: number, out?: Groove): Groove;
/** a groove blended over another by w (and added: a strike's turn over the dance) */
export declare function mixGroove(a: Groove, b: Partial<Groove>, w?: number): Groove;
//# sourceMappingURL=groove.d.ts.map