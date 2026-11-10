import type { AudioEvent, AudioState } from './types';
import { Core } from './core';
export declare class CloudAir {
    private core;
    private layers;
    private last;
    private rush;
    private muffled;
    constructor(core: Core);
    update(dt: number, s: AudioState): void;
    event(e: AudioEvent): void;
    levels(): Record<string, number>;
}
//# sourceMappingURL=clouds.d.ts.map