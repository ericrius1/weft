/** the code with its comments removed (each comment's newlines kept, so lines still line up) */
export declare function stripComments(code: string): string;
/** the lean code (see above) and its line map, in the same form as `runs` */
export declare function leanWgsl(code: string, runs: number[]): {
    code: string;
    runs: number[];
};
/** Split comment-free WGSL into contiguous slices aligned to top-level declarations; `parts.join('') === code`. */
export declare function splitDeclarations(code: string): string[];
//# sourceMappingURL=lean.d.ts.map