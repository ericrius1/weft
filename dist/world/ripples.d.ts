import type { Kit, Texture, PingPong, Compute, UniformBuffer, RunEntry, V3 } from '@ericrius1/weft';
export declare const RIPPLE_N = 256;
export declare const RIPPLE_CELL = 0.22;
export declare class Ripples {
    pp: PingPong<Texture>;
    u: UniformBuffer<any>;
    step: Compute;
    private origin;
    private imp;
    private n;
    constructor(kit: Kit);
    /** push the water at x, z: radius (m), strength (m per step; negative pushes it down) */
    push(x: number, z: number, radius: number, strength: number): void;
    /** slide the window to follow `centre`, hand the sim this frame's pushes; returns world.ripple */
    update(centre: V3, dt: number): [number, number, number, number];
    items(): RunEntry[];
}
//# sourceMappingURL=ripples.d.ts.map