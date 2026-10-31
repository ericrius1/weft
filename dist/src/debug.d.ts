import type { Kit } from './kit';
import type { UniformBuffer } from './resources';
export declare class DebugOverlay {
    private kit;
    open: boolean;
    private root;
    private errBox;
    private disabled;
    private lastUpdate;
    private cpuMs;
    private lastFrame;
    private tweaks;
    private stats;
    private viewer;
    private viewerPass;
    private viewerDraws;
    private viewerU;
    private errorsDismissed;
    constructor(kit: Kit);
    isEnabled(label: string): boolean;
    get viewerActive(): boolean;
    /** a uniform buffer whose annotated fields get sliders */
    tweak(u: UniformBuffer<any>, label?: string): void;
    /** a custom line in the stats block */
    stat(name: string, fn: () => string): void;
    frame(ran: string[]): void;
    errorsChanged(): void;
    private renderErrors;
    private ensureStyle;
    private render;
    private updateLive;
    private renderTweaks;
    /** draws the chosen texture over the frame (a texture it can't show is reported and let go) */
    encodeViewer(enc: GPUCommandEncoder): void;
    private viewTexture;
}
//# sourceMappingURL=debug.d.ts.map