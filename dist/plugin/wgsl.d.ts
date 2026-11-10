export interface FieldLayout {
    name: string;
    offset: number;
    size: number;
    /** normalised WGSL type: f32 · u32 · i32 · vec3f · mat4x4f · … · 'array' · 'struct' */
    type: string;
    array?: {
        count: number;
        stride: number;
        elem: string;
        elemStruct?: string;
    };
    struct?: string;
    range?: number[];
    color?: boolean;
}
export interface StructLayout {
    name: string;
    size: number;
    align: number;
    fields: FieldLayout[];
}
export type BindingKind = 'uniform' | 'storage' | 'texture' | 'storageTexture' | 'sampler' | 'samplerComparison' | 'externalTexture';
export interface BindingInfo {
    name: string;
    group: number;
    binding: number;
    kind: BindingKind;
    access?: 'read' | 'read_write' | 'write';
    /** the declared type (normalised) */
    type: string;
    struct?: string;
    elem?: string;
    elemStruct?: string;
    texture?: {
        dim: GPUTextureViewDimension;
        sample: GPUTextureSampleType;
        multisampled: boolean;
    };
    format?: string;
}
export interface EntryInfo {
    name: string;
    stage: 'vertex' | 'fragment' | 'compute';
    resources: string[];
    overrides: string[];
    workgroupSize?: number[];
    targets?: number;
}
export interface ShaderReflection {
    structs: Record<string, StructLayout>;
    bindings: Record<string, BindingInfo>;
    entries: EntryInfo[];
    overrides: Record<string, {
        type: string;
        id?: number;
    }>;
}
export interface CompiledShader {
    id: string;
    label: string;
    code: string;
    files: string[];
    /** contiguous runs of output lines: [firstOutLine, fileIndex, firstSourceLine] … (1-based lines) */
    runs: number[];
    includes: string[];
    reflect: ShaderReflection;
}
export interface CompileOptions {
    root: string;
    libs: Record<string, string>;
}
export declare class WgslError extends Error {
}
export declare function preprocess(entry: string, opts: CompileOptions): {
    code: string;
    files: string[];
    runs: number[];
    includes: string[];
};
/** maps a 1-based output line back to { file, line } */
export declare function mapLine(runs: number[], files: string[], line: number): {
    file: string;
    line: number;
};
export declare function normType(t: string): string;
export declare function reflectWgsl(code: string): ShaderReflection;
export declare function compileWgsl(file: string, opts: CompileOptions): CompiledShader;
export declare function declaration(s: CompiledShader, weftImport: string): string;
export declare function writeDeclaration(file: string, s: CompiledShader, weftImport: string): boolean;
//# sourceMappingURL=wgsl.d.ts.map