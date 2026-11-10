import { AutoResolution, type Kit } from './kit';
export interface FrameBudgetOptions {
    min?: number;
    max?: number;
    step?: number;
    interval?: number;
    /** a localStorage key to keep the scale that held under, for the next visit (null: not kept) */
    keep?: string | null;
    /** pace by the frames (true) or by the GPU (false); default: by the frames on WebKit */
    byPace?: boolean;
}
export declare class FrameBudget extends AutoResolution {
    /** the scale kept under `key` (0.5..1), or null */
    static kept(key: string): number | null;
    /** told when the GPU can't hold the budget even at the least scale (see above) */
    starved: (() => void) | null;
    /** told when there's room to spare (see above) */
    roomy: (() => void) | null;
    readonly keep: string | null;
    readonly byPace: boolean;
    private queued;
    private waiting;
    private since;
    private frames;
    private keptAt;
    private keptScale;
    private gaps;
    private onTime;
    private lateSince;
    private framesSince;
    private cap;
    private capUntil;
    private lastFrame;
    private lateShare;
    private starve;
    private starveFrom;
    private starveAt;
    private room;
    private roomAt;
    constructor(budgetMs: number, opts?: FrameBudgetOptions);
    private restart;
    private remember;
    private paceFrames;
    /** `over`: this frame over budget at the least scale */
    private watchStarve;
    private watchRoom;
    private overAtLeast;
    update(kit: Kit): void;
}
//# sourceMappingURL=budget.d.ts.map