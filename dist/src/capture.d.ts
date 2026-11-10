import type { Kit } from './kit';
export declare class Capture {
    private kit;
    private canvas2d;
    constructor(kit: Kit);
    /** let n frames of the live loop go by */
    frames(n: number): Promise<void>;
    /** one frame stepped by hand (dt seconds) and read back: RGBA, top row first */
    step(dt: number): Promise<ImageData>;
    /** a frame as an image (data URL) */
    grab(type?: string, quality?: number, dt?: number): Promise<string>;
    /** a frame as an encoded file (a film's frames) */
    blob(type?: string, quality?: number, dt?: number): Promise<Blob>;
}
//# sourceMappingURL=capture.d.ts.map