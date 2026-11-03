import type { Kit } from './kit';
export declare class Profiler {
    private kit;
    readonly available: boolean;
    /** keep timing even with the overlay closed (e.g. for dynamic resolution) */
    force: boolean;
    /** ms per pass label, smoothed: only passes seen in the last `stale` frames read back (one run while loading, or
     *  switched off, isn't shown as a current cost) */
    readonly ms: Map<string, number>;
    /** frames read back a pass may go unseen before it leaves `ms` */
    stale: number;
    /** whole-frame GPU time (first pass start → last pass end), smoothed */
    frameMs: number;
    /** the newest completed frame's GPU time, raw */
    lastFrameMs: number;
    /** the newest completed frame's ms per pass label, raw */
    lastMs: Map<string, number>;
    /** bumped with each completed frame's raw numbers (a frame read back is counted once) */
    serial: number;
    /** whether the device's timestamps add up: a frame's GPU time can't stay far past the time between its frames, and
     *  an iPhone's Safari (WebKit, iOS 26) gave frames of seconds at 12 a second — most of the first frames read back
     *  that way and it's false for good, and what steers by it (AutoResolution) paces by the frames' intervals instead */
    trusted: boolean;
    /** the time between frames (ms, smoothed), by the clock: what a frame's GPU time is held against */
    wallMs: number;
    private lastBegin;
    private judged;
    private implausible;
    private qs;
    private resolveBuf;
    private readBuf;
    private next;
    private resolved;
    private labels;
    private pending;
    private on;
    private reads;
    private seen;
    constructor(kit: Kit);
    get active(): boolean;
    beginFrame(): void;
    writes(label: string): GPURenderPassTimestampWrites | undefined;
    /** resolve what this run wrote (appended to the run's command buffers) */
    resolve(cbs: GPUCommandBuffer[]): void;
    endFrame(): void;
    /** a frame's GPU time against the clock: over 200 ms and four times the frames' own interval is no GPU's time; of
     *  the first 60 judged, more than half like that and the timestamps aren't trusted */
    private judge;
}
//# sourceMappingURL=profiler.d.ts.map