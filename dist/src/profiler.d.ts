import type { Kit } from './kit';
export declare class Profiler {
    private kit;
    readonly available: boolean;
    /** keep timing even with the overlay closed (e.g. for dynamic resolution) */
    force: boolean;
    /** ms per pass label, smoothed */
    readonly ms: Map<string, number>;
    /** whole-frame GPU time (first pass start → last pass end), smoothed */
    frameMs: number;
    /** the newest completed frame's GPU time, raw */
    lastFrameMs: number;
    /** the newest completed frame's ms per pass label, raw */
    lastMs: Map<string, number>;
    /** bumped with each completed frame's raw numbers (a frame read back is counted once) */
    serial: number;
    private qs;
    private resolveBuf;
    private readBuf;
    private next;
    private resolved;
    private labels;
    private pending;
    private on;
    constructor(kit: Kit);
    get active(): boolean;
    beginFrame(): void;
    writes(label: string): GPURenderPassTimestampWrites | undefined;
    /** resolve what this run wrote (appended to the run's command buffers) */
    resolve(cbs: GPUCommandBuffer[]): void;
    endFrame(): void;
}
//# sourceMappingURL=profiler.d.ts.map