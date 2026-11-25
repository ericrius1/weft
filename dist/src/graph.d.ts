import type { RunEntry } from './kit';
export interface GraphEntryOptions {
    /** tie-breaker within a phase (lower runs first; equal orders keep registration order). Default 0. */
    order?: number;
    /** logical owner name (for bulk removal or active gating) */
    owner?: string;
}
export declare class FrameGraph {
    readonly phases: readonly string[];
    private phaseIdx;
    private slots;
    private seq;
    private disabledOwners;
    private dirty;
    private cached;
    constructor(phases: readonly string[]);
    /** register an entry (or list of entries) in `phase`; returns a disposer that removes it */
    add(phase: string, entry: RunEntry | readonly RunEntry[], opts?: GraphEntryOptions): () => void;
    /** remove every entry belonging to `owner` */
    removeOwner(owner: string): void;
    /** enable or disable all entries belonging to `owner` without re-registering */
    setOwnerEnabled(owner: string, enabled: boolean): void;
    /** mark cached run list dirty */
    invalidate(): void;
    /** cached flat run list ready to pass straight to `kit.run(graph.entries())` */
    entries(): readonly RunEntry[];
}
//# sourceMappingURL=graph.d.ts.map