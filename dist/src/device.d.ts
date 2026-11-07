export declare function isWebKit(): boolean;
export declare function isPhone(): boolean;
/** the GPU's name ('' where the browser won't say), asked of a throwaway WebGL context once */
export declare function gpuName(): string;
export declare function isAppleGpu(name?: string): boolean;
/** a load guard's two keys in localStorage: the mark a load holds while unsettled, and the heaviest step auto may
 *  choose */
export interface LoadGuardKeys {
    guard: string;
    safe: string;
}
export declare class LoadGuard<P extends string = string> {
    readonly keys: LoadGuardKeys;
    readonly ladder: readonly P[];
    /** the heaviest step auto may choose in this browser (null: no limit) — after a load that crashed */
    cap: P | null;
    /** the step the last load ran at, if it never settled (it crashed, or the machine did) */
    readonly crashed: P | null;
    private running;
    private timer;
    /** `ladder`: the steps auto may choose, heaviest first (a step not on it — a phone's own — is never stepped down) */
    constructor(keys: LoadGuardKeys, ladder: readonly P[]);
    /** one step lighter than `p` on the ladder (null at its foot, or off it) */
    below(p: P): P | null;
    /** the lighter of two steps (either null: the other) */
    lighter(a: P | null, b: P | null): P | null;
    /** what auto runs: `detected`, no heavier than the cap (a step off the ladder as it is) */
    choose(detected: P): P;
    /** the cap lowered to `p` (if it's lighter than the cap) — the governor's last step: lighter from the next load on */
    lower(p: P | null): boolean;
    /** this load runs `step`: marked unsettled until settle() clears it */
    begin(step: P): void;
    /** cleared once the page has shown `seconds` of frames (counted a second at a time, only while visible and only if
     *  frameIndex moved) */
    settle(frameIndex: () => number, seconds?: number): void;
    /** the GPU failed while the page was shown: the next load a step lighter than this one */
    failed(): void;
    /** forget the cap (a profile chosen by hand) */
    reset(): void;
    private valid;
    private read;
    private write;
}
//# sourceMappingURL=device.d.ts.map