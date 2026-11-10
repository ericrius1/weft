import type { Kit } from './kit';
export interface ShotOptions {
    /** frames stepped, the last one captured (default 30) */
    frames?: number;
    /** seconds a frame (default 1/30) */
    dt?: number;
    /** a pause of `pauseMs` every `pauseEvery` frames, for the network and the compiles (default 6, 20 ms) */
    pauseEvery?: number;
    pauseMs?: number;
    /** the encoding (default image/jpeg at 0.9) */
    type?: string;
    quality?: number;
    /** where it's posted, ?name= added (default '/__shot'; null: not posted) */
    sink?: string | null;
}
export declare function shot(kit: Kit, name?: string, o?: ShotOptions): Promise<{
    width: number;
    height: number;
    blob: Blob;
}>;
//# sourceMappingURL=shot.d.ts.map