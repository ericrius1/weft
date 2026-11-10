import type { Kit } from './kit';
export interface BeaconOptions {
    /** where the reports are posted (default the dev sink, '/__beacon') */
    url?: string;
    /** ms between reports (default 5000) */
    every?: number;
    /** more fields for each report */
    extra?: () => Record<string, unknown>;
    /** posted without CORS (default true: a beacon to another origin needs no preflight; the body goes as text/plain) */
    noCors?: boolean;
}
export interface BeaconReport {
    fps: number;
    worst: number;
    gpu: number;
    scale: number;
    size: readonly number[];
    ua: string;
    [k: string]: unknown;
}
/** starts reporting; returns a function that stops it */
export declare function perfBeacon(kit: Kit, o?: BeaconOptions): () => void;
//# sourceMappingURL=beacon.d.ts.map