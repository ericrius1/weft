import type { Kit, View } from './kit';
import type { Shader, BindingInfo } from './shader';
import { UniformBuffer, StorageBuffer } from './resources';
export type SamplerName = 'linear' | 'repeat' | 'nearest' | 'nearest-repeat' | 'shadow' | 'mirror';
export type BufferRange = {
    buffer: StorageBuffer | UniformBuffer<any> | GPUBuffer;
    offset?: number;
    size?: number;
};
export type Bindable = object | SamplerName;
export declare class BindError extends Error {
}
/** what bind groups are set on: a render or compute pass, a render bundle */
export interface BindTarget {
    setBindGroup(index: number, bindGroup: GPUBindGroup): void;
}
/** forget what a pass has set (after code outside weft may have changed it) */
export declare function forgetBindings(enc: BindTarget): void;
interface Resolved {
    res: GPUBindingResource;
    unfilterable?: boolean;
    format?: GPUTextureFormat;
}
export declare function resolveBinding(kit: Kit, info: BindingInfo, value: unknown, where: string): Resolved;
/** a group's last bind group, the identity of what it holds, and when that was last checked */
declare class Memo {
    bg: GPUBindGroup | null;
    ids: number[];
    gen: number;
    vgen: number;
    epoch: number;
    /** a value can move without notice (a Ref, a range): checked once per run epoch rather than only on changes */
    moves: boolean;
    /** the last few bind groups made (the two sides of a ping-pong…) */
    recent: {
        ids: number[];
        bg: GPUBindGroup;
    }[];
}
export declare const FRAME_GROUP: {
    kind: BindingInfo['kind'];
}[];
/** A bind group shared by every pipeline whose shader includes its declaration (an environment: lighting, sky, shadows,
 *  terrain maps…). Its layout comes from the declaring include's reflection — every binding of that group, visible to
 *  every stage — so one bind group serves all of them. Draws never pass these bindings themselves. */
export declare class SharedGroup {
    private kit;
    readonly index: number;
    readonly shader: Shader;
    readonly values: Record<string, unknown>;
    readonly label: string;
    readonly infos: BindingInfo[];
    /** the source files that declare it: a shader shares the group when it includes one of them */
    readonly files: Set<string>;
    bgl: GPUBindGroupLayout;
    /** its layout's description (kit.bindGroupLayout's key) */
    bglKey: string;
    /** bumped by set() */
    vgen: number;
    private memo;
    private memos;
    constructor(kit: Kit, index: number, shader: Shader, values: Record<string, unknown>, label: string);
    private build;
    set(name: string, value: unknown): this;
    /** whether `shader` shares this group (it includes the declaration) */
    serves(shader: Shader): boolean;
    /** check a pipeline's own declaration of this group against the shared one */
    check(shader: Shader, where: string): void;
    /** the bind group (with some values swapped for one pass, e.g. a dummy shadow map while rendering the shadows) */
    bindGroup(overrides?: Record<string, unknown>): GPUBindGroup;
}
interface Group {
    index: number;
    infos: BindingInfo[];
    bgl: GPUBindGroupLayout;
    label: string;
    memo: Memo;
    shared?: SharedGroup;
}
export declare class Binder {
    private kit;
    shader: Shader;
    entries: string[];
    values: Record<string, unknown>;
    label: string;
    groups: Group[];
    layout: GPUPipelineLayout;
    /** layout identity, the description of each group's layout after the frame's (a shared group's too): a pipeline must
     *  be rebuilt when this changes, and binders with the same one have the same bind group layouts (kit.bindGroupLayout
     *  makes one per description), so their pipelines can be one (kit.pipelineCache) */
    layoutKey: string;
    /** bumped whenever its values or its groups change */
    vgen: number;
    constructor(kit: Kit, shader: Shader, entries: string[], values: Record<string, unknown>, label: string);
    /** the bindings each stage uses (names) */
    private usage;
    build(): void;
    /** change one binding's value (the layout stays; bind groups follow) */
    set(name: string, value: unknown): void;
    /** one of its groups' bind group now (`shared`: a pass's swapped shared values) */
    groupFor(g: Group, shared?: Record<number, Record<string, unknown>>): GPUBindGroup;
    /** whether a value of its own can move without notice (a Ref or a buffer range, as last resolved) */
    get moves(): boolean;
    apply(enc: BindTarget, view: View, shared?: Record<number, Record<string, unknown>>): void;
}
export {};
//# sourceMappingURL=binder.d.ts.map