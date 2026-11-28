import type { Shader } from './shader';
/**
 * Rewrite a WGSL fragment entry point `fsName` so it also outputs `vec4f(0.0)` at `@location(loc)`.
 * Returns the transformed WGSL source string, or `null` if the entry signature cannot be safely wrapped.
 */
export declare function wrapFragmentZeroLocation(code: string, fsName: string, loc: number): string | null;
/** Return a cached derived `Shader` whose fragment entry `fsName` writes `vec4f(0.0)` to `@location(loc)`. */
export declare function shaderWithZeroLocation<S extends Shader>(shader: S, fsName: string, loc: number): S;
//# sourceMappingURL=mrt-optout.d.ts.map