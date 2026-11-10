/** what's held, and by label (the biggest holders: `[...gpuMemory.by].sort((a, b) => b[1] - a[1])`) */
export declare const gpuMemory: {
    bytes: number;
    textures: number;
    buffers: number;
    by: Map<string, number>;
};
/** count every texture and buffer the app makes (call before the device exists) */
export declare function trackGpuMemory(): void;
export interface StatsSource {
    fps: number;
    ms: number;
    gpuMs: () => number;
    scale: () => number;
    extra?: () => string;
}
export declare class StatsBox {
    private src;
    private visible;
    readonly el: HTMLDivElement;
    private last;
    /** `className`: the page's class for its interface (hidden with it by the page's own toggle) */
    constructor(src: StatsSource, visible: () => boolean, className?: string);
    update(now: number): void;
}
//# sourceMappingURL=stats.d.ts.map