import type { Kit } from './kit';
import type { AnyPipelineRecord, Compiler } from './passes';
export declare class SerialCompiler implements Compiler {
    private kit;
    private frames;
    readonly holding = false;
    /** compiles asked of the GPU so far, and made on the spot */
    readonly stats: {
        compiled: number;
        now: number;
    };
    private chain;
    /** `frames`: frames waited between compiles (1) */
    constructor(kit: Kit, frames?: number);
    compile(_rec: AnyPipelineRecord, start: () => Promise<unknown>): Promise<unknown>;
    now(rec: AnyPipelineRecord): void;
}
//# sourceMappingURL=compile.d.ts.map