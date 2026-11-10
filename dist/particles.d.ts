import type { Kit, RenderPass, Texture, V3, RunEntry } from '@ericrius1/weft';
export declare const PK: {
    readonly SPARK: 0;
    readonly FIRE: 1;
    readonly SMOKE: 2;
    readonly TRACER: 3;
    readonly DEBRIS: 4;
    readonly SPRAY: 5;
    readonly FLASH: 6;
    readonly VAPOR: 7;
    readonly PAINT: 8;
};
/** a point of light for this frame only: position, size (m), colour (linear radiance), its least size on screen (px),
 *  its velocity and how many seconds of it to streak */
export interface Glint {
    pos: V3;
    size: number;
    color: V3;
    minPx?: number;
    vel?: V3;
    streak?: number;
}
export interface Burst {
    pos: V3;
    count: number;
    kind: number;
    vel?: V3;
    spread?: number;
    dir?: V3;
    cone?: number;
    size?: number;
    sizeJit?: number;
    life?: number;
    lifeJit?: number;
    posJit?: number;
    tint?: [number, number, number, number];
}
export declare class Particles {
    private kit;
    readonly capacity: number;
    private parts;
    private emitBuf;
    private u;
    private kinds;
    private queue;
    private head;
    private emitted;
    private bursts;
    private time;
    private emitData;
    /** the lighting the lit kinds (smoke, debris, spray, vapour) see; a multiplier for the glowing ones */
    light: {
        sun: V3;
        sunCol: V3;
        amb: V3;
        glow: number;
    };
    wind: V3;
    /** how far behind a sprite the scene must be for it to show fully (m) */
    softness: number;
    /** how strongly the lamps (point lights) light the spray */
    sprayLamps: number;
    private emitPass;
    private simPass;
    private glintBuf;
    private glintData;
    private glintCount;
    private glintsDrawn;
    constructor(kit: Kit, capacity?: number);
    /** a point of light, this frame only */
    glint(g: Glint): void;
    /** queue a burst for this frame */
    burst(b: Burst): void;
    explosion(p: V3, scale?: number, vel?: V3): void;
    sparks(p: V3, dir: V3, count?: number, speed?: number): void;
    smoke(p: V3, vel?: V3, size?: number, life?: number, dark?: number): void;
    muzzle(p: V3, dir: V3, vel?: V3): void;
    tracer(p: V3, vel: V3, life?: number): void;
    splash(p: V3, scale?: number): void;
    vapour(p: V3, vel: V3, size?: number, life?: number): void;
    /** this frame's compute: emit the queued bursts, step everything */
    items(dt: number): RunEntry[];
    /** both blend classes into a pass (additive first, then alpha) */
    addTo(pass: RenderPass, depth: Texture): void;
}
//# sourceMappingURL=particles.d.ts.map