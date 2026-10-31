import type { ShaderReflection, StructLayout, BindingInfo } from '../plugin/wgsl';
export type { ShaderReflection, StructLayout, BindingInfo, FieldLayout, EntryInfo, BindingKind } from '../plugin/wgsl';
export type Vec2 = ArrayLike<number>;
export type Vec3 = ArrayLike<number>;
export type Vec4 = ArrayLike<number>;
export type Mat3 = ArrayLike<number>;
export type Mat4 = ArrayLike<number>;
/** a struct layout from a shader; T is the generated TS shape of its fields */
export interface StructDef<T = unknown> extends StructLayout {
    readonly shader: Shader;
    /** bumped when a hot update changes the layout */
    version: number;
    /** phantom: the field types */
    readonly __fields?: T;
}
export interface ShaderData {
    id: string;
    label: string;
    code: string;
    files: string[];
    runs: number[];
    reflect: ShaderReflection;
    error?: string;
}
export interface Shader<S extends object = Record<string, unknown>, B extends string = string> extends ShaderData {
    version: number;
    structs: {
        [K in keyof S]: StructDef<S[K]>;
    };
    bindings: Record<B, BindingInfo>;
    /** subscribe to hot updates; returns an unsubscribe function */
    onChange(cb: (s: Shader) => void): () => void;
    /** phantom: binding names, used to type-check `bind: { … }` */
    readonly __bindings?: B;
}
type AnyShader = Shader<object, string>;
export declare function defineShader(data: ShaderData): AnyShader;
/** maps a 1-based line of the preprocessed code back to its source file and line */
export declare function sourceLine(s: ShaderData, line: number): {
    file: string;
    line: number;
};
/** every shader loaded so far (the debug overlay lists them) */
export declare const allShaders: () => AnyShader[];
//# sourceMappingURL=shader.d.ts.map