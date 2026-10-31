import type { StructDef, StructLayout } from './shader';
export type DeepPartial<T> = T extends ArrayLike<number> ? T : T extends object ? {
    [K in keyof T]?: DeepPartial<T[K]>;
} : T;
export declare class StructView<T = Record<string, unknown>> {
    readonly def: StructDef<T> | StructLayout;
    readonly base: number;
    private structs?;
    readonly data: ArrayBuffer;
    readonly f32: Float32Array;
    readonly u32: Uint32Array;
    readonly i32: Int32Array;
    constructor(def: StructDef<T> | StructLayout, data?: ArrayBuffer, base?: number, structs?: Record<string, StructLayout> | undefined);
    /** byte offset of a top-level field */
    offset(field: keyof T & string): number;
    set(values: DeepPartial<T>): this;
    get(field: keyof T & string): unknown;
    /** every field as a plain object (used to carry values across a hot layout change) */
    toObject(): Record<string, unknown>;
    layoutOf(name: string): StructLayout;
}
/** an array of structs in one ArrayBuffer (instance data, particles…): `arr.set(i, { … })` */
export declare class StructArray<T = Record<string, unknown>> {
    readonly def: StructDef<T>;
    readonly count: number;
    readonly data: ArrayBuffer;
    readonly stride: number;
    private view;
    constructor(def: StructDef<T>, count: number);
    get f32(): Float32Array<ArrayBufferLike>;
    get u32(): Uint32Array<ArrayBufferLike>;
    set(i: number, values: DeepPartial<T>): this;
    /** byte offset of a field inside element i */
    offset(i: number, field: keyof T & string): number;
}
//# sourceMappingURL=struct.d.ts.map