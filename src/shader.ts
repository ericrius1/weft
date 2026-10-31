// The runtime side of a .wgsl import: one canonical Shader object per file. Hot updates replace its code and
// reflection in place (so every pass holding it sees the new version) and notify listeners, which rebuild pipelines.
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
  id: string; label: string; code: string; files: string[]; runs: number[];
  reflect: ShaderReflection; error?: string;
}

export interface Shader<S extends object = Record<string, unknown>, B extends string = string> extends ShaderData {
  version: number;
  structs: { [K in keyof S]: StructDef<S[K]> };
  bindings: Record<B, BindingInfo>;
  /** subscribe to hot updates; returns an unsubscribe function */
  onChange(cb: (s: Shader) => void): () => void;
  /** phantom: binding names, used to type-check `bind: { … }` */
  readonly __bindings?: B;
}

type AnyShader = Shader<object, string>;
const REG: Map<string, AnyShader> = ((globalThis as unknown as { __weftShaders?: Map<string, AnyShader> }).__weftShaders ??= new Map());

function syncStructs(s: AnyShader, structs: Record<string, StructLayout>) {
  const out = s.structs as Record<string, StructDef>;
  for (const [name, layout] of Object.entries(structs)) {
    const prev = out[name];
    if (prev) {
      const changed = JSON.stringify(layout) !== JSON.stringify({ name: prev.name, size: prev.size, align: prev.align, fields: prev.fields });
      Object.assign(prev, layout);
      if (changed) prev.version++;
    } else {
      out[name] = Object.assign({ shader: s, version: 1 }, layout) as StructDef;
    }
  }
}

export function defineShader(data: ShaderData): AnyShader {
  const prev = REG.get(data.id);
  if (prev) {
    Object.assign(prev, { code: data.code, files: data.files, runs: data.runs, reflect: data.reflect, error: data.error, label: data.label });
    prev.bindings = data.reflect.bindings;
    syncStructs(prev, data.reflect.structs);
    prev.version++;
    for (const cb of listeners.get(prev) ?? []) cb(prev);
    return prev;
  }
  const s = {
    ...data,
    version: 1,
    structs: {},
    bindings: data.reflect.bindings,
    onChange(cb: (s: AnyShader) => void) {
      let set = listeners.get(s);
      if (!set) listeners.set(s, (set = new Set()));
      set.add(cb);
      return () => set!.delete(cb);
    },
  } as unknown as AnyShader;
  syncStructs(s, data.reflect.structs);
  REG.set(data.id, s);
  return s;
}
const listeners = new WeakMap<AnyShader, Set<(s: AnyShader) => void>>();

/** maps a 1-based line of the preprocessed code back to its source file and line */
export function sourceLine(s: ShaderData, line: number) {
  const runs = s.runs;
  let r = 0;
  for (let i = 0; i < runs.length; i += 3) if (runs[i] <= line) r = i; else break;
  if (!runs.length) return { file: s.id, line };
  return { file: s.files[runs[r + 1]], line: runs[r + 2] + (line - runs[r]) };
}

/** every shader loaded so far (the debug overlay lists them) */
export const allShaders = () => [...REG.values()];
