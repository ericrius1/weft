import type { Kit } from './kit';
import type { AnyPipelineRecord, Compiler } from './passes';
export declare class SerialCompiler implements Compiler {
    private kit;
    private frames;
    readonly holding = false;
    /** compiles asked of the GPU so far, made on the spot, and promoted via urge() */
    readonly stats: {
        compiled: number;
        now: number;
        urged: number;
    };
    private queue;
    private busy;
    /** `frames`: frames waited between compiles (1) */
    constructor(kit: Kit, frames?: number);
    compile(rec: AnyPipelineRecord, start: () => Promise<unknown>): Promise<unknown>;
    /** promote a queued pipeline (e.g. a site the camera is approaching) ahead of background compiles */
    urge(rec: AnyPipelineRecord): void;
    private pump;
    now(rec: AnyPipelineRecord): void;
}
//# sourceMappingURL=compile.d.ts.map