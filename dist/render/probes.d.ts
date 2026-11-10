import type { Kit, RenderPass, RunEntry, StorageBuffer, V3 } from '@ericrius1/weft';
export interface ProbeGridOptions {
    /** the pass whose draws the probes see (one sample, rgba16float + depth32float targets: the mirror pass's) */
    source: RenderPass;
    /** the volume: least and greatest corners (m), the probes' spacing (m) */
    min: V3;
    max: V3;
    spacing: number;
    /** a cube face's size, texels a side (default 24) */
    face?: number;
    /** the most probes captured in one frame (default 2; 8 at most) */
    maxPerFrame?: number;
    /** the ground's height at (x, z): probes under it are lifted onto it (or left out when that's beyond their cell) */
    ground?: (x: number, z: number) => number;
    /** which of the source's draws the probes leave out, by label (what moves: a dragon, birds; a pattern or a test) */
    skip?: RegExp | ((label: string) => boolean);
}
export declare class ProbeGrid {
    private kit;
    /** on (off: the sky's ambient everywhere, nothing captured); strength (the probes' light ×); perFrame (probes
     *  captured a frame); blend (a recapture's share of what the probe ends up holding: lower is steadier, slower to
     *  follow the light); normalBias / viewBias (how far a surface's read is pushed off it, along its normal and toward
     *  the eye, in spacings: against light leaking through walls); edge (spacings over which the volume fades to the
     *  sky's light); inside (the share of a probe's view right up against it past which it isn't trusted); refresh
     *  (keep recapturing once every probe has been) */
    params: {
        on: boolean;
        strength: number;
        perFrame: number;
        blend: number;
        normalBias: number;
        viewBias: number;
        edge: number;
        inside: number;
        refresh: boolean;
    };
    /** probes along x, y, z */
    n: [number, number, number];
    min: V3;
    spacing: number;
    /** the probes' records (64 bytes each: red's, green's, blue's coefficients, validity), copied by the Renderer into
     *  the point lights' buffer after the lights and the light grid (env.wgsl giProbe) */
    probes: StorageBuffer;
    /** the run items (before the opaque scene: the frame's surfaces read what it captured) */
    readonly items: RunEntry[];
    /** probes captured since the volume was last set or invalidated, and in all */
    captured: number;
    total: number;
    private capColor;
    private capDepth;
    private u;
    private project;
    private faces;
    private slotsUsed;
    private slotProbe;
    private stamp;
    private valid;
    private lift;
    private frame;
    private cam;
    private F;
    private maxSlots;
    private ground?;
    constructor(kit: Kit, opts: ProbeGridOptions);
    /** (re)place the volume: least and greatest corners, spacing (m). Its probes start over (the sky's light meanwhile) */
    setVolume(min: V3, max: V3, spacing: number): void;
    /** forget every probe's light (a different scene, a big change of light): each is captured again */
    invalidate(): void;
    /** probes in the volume */
    get count(): number;
    /** told when the volume's size changes (the Renderer lays the point lights' buffer out again) */
    onResize: ((count: number) => void) | null;
    /** the camera's position (probes nearer it come first) */
    follow(cam: ArrayLike<number>): void;
    private probePos;
    private schedule;
    /** the shaders' values for it (envx: giMin, giN, giK) */
    envx(): {
        giMin: number[];
        giN: number[];
        giK: number[];
    };
    dispose(): void;
}
//# sourceMappingURL=probes.d.ts.map