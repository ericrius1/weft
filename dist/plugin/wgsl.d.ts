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
    /** build-time only: absolute path of the .wgsl file that declared each struct (omitted from runtime bundle) */
    structFiles?: Record<string, string>;
    reflect: ShaderReflection;
}
export interface CompileOptions {
    root: string;
    libs: Record<string, string>;
    /** the browser given only the comment-free code its entry points reach (lean.ts: a change elsewhere in an included
     *  file then leaves its compiled pipelines in the browser's cache). Default true */
    lean?: boolean;
}
export declare class WgslError extends Error {
}
export declare function preprocess(entry: string, opts: CompileOptions): {
    code: string;
    files: string[];
    runs: number[];
    includes: string[];
    structFiles: Record<string, string>;
};
/** maps a 1-based output line back to { file, line } */
export declare function mapLine(runs: number[], files: string[], line: number): {
    file: string;
    line: number;
};
export declare function normType(t: string): string;
export declare function reflectWgsl(code: string): ShaderReflection;
export declare function compileWgsl(file: string, opts: CompileOptions): CompiledShader;
export interface DeclarationOptions {
    /** absolute path of the shader file being declared */
    file?: string;
    /** project root; only included shaders inside `root` (and outside `node_modules`) are imported by type */
    root?: string;
    /** import structs declared in project-local included .wgsl files instead of copying them into every .d.wgsl.ts */
    sharedTypes?: boolean;
}
export declare function declaration(s: CompiledShader, weftImport: string, opts?: DeclarationOptions): string;
export declare function writeDeclaration(file: string, s: CompiledShader, weftImport: string, opts?: DeclarationOptions): boolean;
export interface ShaderManifestEntry {
    id: string;
    label: string;
    /** first 16 hex chars of SHA-256 over `code` */
    sha256: string;
    code: string;
    files: string[];
    runs: number[];
    reflect: ShaderReflection;
}
export interface ShaderManifest {
    version: 1;
    shaders: Record<string, ShaderManifestEntry>;
}
/** Convert a compiled shader into a portable, JSON-serializable manifest entry (expanded WGSL + reflection + line map). */
export declare function manifestEntry(s: CompiledShader): ShaderManifestEntry;
/** Compile a list of `.wgsl` files into a deterministic, UTF-16-sorted `ShaderManifest` for native engines or offline
 *  audits. Throws at the first file that fails to preprocess or reflect. */
export declare function buildShaderManifest(files: readonly string[], opts: CompileOptions): ShaderManifest;
//# sourceMappingURL=wgsl.d.ts.map