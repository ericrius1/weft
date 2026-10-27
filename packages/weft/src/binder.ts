// Bind by name. A Binder turns `{ heightIn: tex, params: uniforms }` into bind group layouts (derived from the
// shader's reflection plus the actual resources, e.g. an r32float texture binds as unfilterable) and per-frame bind
// groups cached by resource identity + version. Only the bindings the chosen entry points actually use go into the
// layout, so commenting out a use never breaks the bind; a name the shader doesn't declare at all is an error.
import type { Kit, View } from './kit';
import type { Shader, BindingInfo } from './shader';
import { deref, UniformBuffer, StorageBuffer, Texture, TexView, rawUid, isDepthFormat } from './resources';
import { STAGE } from './gpuconst';

export type SamplerName = 'linear' | 'repeat' | 'nearest' | 'nearest-repeat' | 'shadow' | 'mirror';
export type BufferRange = { buffer: StorageBuffer | UniformBuffer<any> | GPUBuffer; offset?: number; size?: number };
export type Bindable = object | SamplerName;

export class BindError extends Error {}

/** set a bind group unless the pass already has that one at that index (WebGPU keeps them across draws) */
type Tracked = (GPURenderPassEncoder | GPUComputePassEncoder) & { __weftGroups?: (GPUBindGroup | undefined)[] };
function setGroup(enc: Tracked, i: number, bg: GPUBindGroup) {
  const s = (enc.__weftGroups ??= []);
  if (s[i] === bg) return;
  s[i] = bg;
  enc.setBindGroup(i, bg);
}
/** forget what a pass has set (after code outside weft may have changed it) */
export function forgetBindings(enc: GPURenderPassEncoder | GPUComputePassEncoder) { (enc as Tracked).__weftGroups = undefined; }

interface Resolved { res: GPUBindingResource; key: string; unfilterable?: boolean; format?: GPUTextureFormat }

const describe = (v: unknown) => {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return `'${v}'`;
  const o = v as { constructor?: { name?: string }; label?: string };
  return `${o.constructor?.name ?? typeof v}${o.label ? ` "${o.label}"` : ''}`;
};

function bufferOf(v: unknown): { buf: GPUBuffer; key: string; offset?: number; size?: number } | null {
  if (v instanceof UniformBuffer || v instanceof StorageBuffer) return { buf: v.gpu, key: `b${v.uid}.${v.version}` };
  if (typeof GPUBuffer !== 'undefined' && v instanceof GPUBuffer) return { buf: v, key: `g${rawUid(v)}` };
  if (v && typeof v === 'object' && 'buffer' in v) {
    const r = v as BufferRange;
    const inner = bufferOf(r.buffer);
    if (!inner) return null;
    return { buf: inner.buf, key: `${inner.key}@${r.offset ?? 0}+${r.size ?? ''}`, offset: r.offset, size: r.size };
  }
  return null;
}

export function resolveBinding(kit: Kit, info: BindingInfo, value: unknown, where: string): Resolved {
  const v = deref(value);
  const fail = (want: string) => new BindError(`${where}: '${info.name}' (@group(${info.group}) @binding(${info.binding}) ${info.type}) needs ${want}, got ${describe(v)}`);
  switch (info.kind) {
    case 'uniform':
    case 'storage': {
      const b = bufferOf(v);
      if (!b) throw fail(info.kind === 'uniform' ? 'a UniformBuffer (kit.uniforms)' : 'a StorageBuffer (kit.storage)');
      const res: GPUBufferBinding = { buffer: b.buf };
      if (b.offset !== undefined) res.offset = b.offset;
      if (b.size !== undefined) res.size = b.size;
      return { res, key: b.key };
    }
    case 'texture':
    case 'storageTexture': {
      const dim = info.texture?.dim ?? '2d';
      if (v instanceof Texture) {
        const depth = isDepthFormat(v.format);
        const desc: GPUTextureViewDescriptor = { dimension: dim };
        if (info.kind === 'storageTexture') { desc.baseMipLevel = 0; desc.mipLevelCount = 1; }
        if (depth) desc.aspect = 'depth-only';
        return { res: v.view(desc), key: `t${v.uid}.${v.version}:${dim}`, unfilterable: v.unfilterable || (depth && info.texture?.sample !== 'depth'), format: v.format };
      }
      if (v instanceof TexView) {
        const depth = isDepthFormat(v.texture.format);
        const desc = { ...v.desc };
        if (!desc.dimension) desc.dimension = dim;
        return { res: v.texture.view(desc), key: v.key + dim, unfilterable: v.texture.unfilterable || (depth && info.texture?.sample !== 'depth'), format: v.texture.format };
      }
      if (typeof GPUTextureView !== 'undefined' && v instanceof GPUTextureView) return { res: v, key: `v${rawUid(v)}` };
      if (typeof GPUTexture !== 'undefined' && v instanceof GPUTexture) {
        let view = kit.rawViews.get(v);
        if (!view) kit.rawViews.set(v, (view = v.createView({ dimension: dim })));
        return { res: view, key: `v${rawUid(v)}`, format: v.format };
      }
      throw fail('a Texture (kit.texture)');
    }
    case 'sampler':
    case 'samplerComparison': {
      if (typeof v === 'string') {
        const s = kit.namedSampler(v as SamplerName);
        if (!s) throw fail(`a sampler (one of linear, repeat, nearest, nearest-repeat, mirror, shadow)`);
        return { res: s, key: `s${rawUid(s)}` };
      }
      if (typeof GPUSampler !== 'undefined' && v instanceof GPUSampler) return { res: v, key: `s${rawUid(v)}` };
      throw fail('a sampler');
    }
    case 'externalTexture': {
      if (typeof GPUExternalTexture !== 'undefined' && v instanceof GPUExternalTexture) return { res: v, key: `x${rawUid(v)}` };
      throw fail('a GPUExternalTexture');
    }
  }
}

function layoutEntry(kit: Kit, info: BindingInfo, r: Resolved, visibility: number): GPUBindGroupLayoutEntry {
  const e: GPUBindGroupLayoutEntry = { binding: info.binding, visibility };
  switch (info.kind) {
    case 'uniform': e.buffer = { type: 'uniform' }; break;
    case 'storage': e.buffer = { type: info.access === 'read_write' ? 'storage' : 'read-only-storage' }; break;
    case 'texture': {
      const t = info.texture!;
      let sampleType = t.sample;
      if (sampleType === 'float' && (r.unfilterable || t.multisampled)) sampleType = 'unfilterable-float';
      e.texture = { sampleType, viewDimension: t.dim, multisampled: t.multisampled };
      break;
    }
    case 'storageTexture':
      e.storageTexture = { access: info.access === 'read' ? 'read-only' : info.access === 'read_write' ? 'read-write' : 'write-only', format: (info.format ?? r.format) as GPUTextureFormat, viewDimension: info.texture?.dim ?? '2d' };
      break;
    case 'sampler': e.sampler = { type: kit.nonFiltering.has(r.res as GPUSampler) ? 'non-filtering' : 'filtering' }; break;
    case 'samplerComparison': e.sampler = { type: 'comparison' }; break;
    case 'externalTexture': e.externalTexture = {}; break;
  }
  return e;
}

// group 0 is the kit's frame group: Frame, app globals, then the standard samplers
export const FRAME_GROUP: { kind: BindingInfo['kind'] }[] = [
  { kind: 'uniform' }, { kind: 'uniform' }, { kind: 'sampler' }, { kind: 'sampler' }, { kind: 'sampler' }, { kind: 'samplerComparison' },
];

/** A bind group shared by every pipeline that declares it (an environment: lighting, sky, shadows, terrain maps…).
 *  Its layout comes from the declaring include's reflection — every binding of that group, visible to every stage — so
 *  one bind group serves all of them. Draws never pass these bindings themselves. */
export class SharedGroup {
  readonly infos: BindingInfo[];
  bgl!: GPUBindGroupLayout;
  private lastKey = '';
  private last: GPUBindGroup | null = null;
  private cache = new Map<string, GPUBindGroup>();
  constructor(private kit: Kit, readonly index: number, readonly shader: Shader, readonly values: Record<string, unknown>, readonly label: string) {
    this.infos = Object.values(shader.bindings).filter((b) => b.group === index).sort((a, b) => a.binding - b.binding);
    if (!this.infos.length) throw new BindError(`${label}: ${shader.id} declares nothing in group ${index}`);
    for (const n of Object.keys(values)) {
      if (!this.infos.some((i) => i.name === n)) throw new BindError(`${label}: group ${index} of ${shader.id} has no binding '${n}' (has: ${this.infos.map((i) => i.name).join(', ')})`);
    }
    this.build();
  }
  private build() {
    const entries = this.infos.map((info) => {
      if (!(info.name in this.values)) throw new BindError(`${this.label}: shared binding '${info.name}' (@group(${this.index}) @binding(${info.binding}) ${info.type}) not provided`);
      const r = resolveBinding(this.kit, info, this.values[info.name], this.label);
      const writable = (info.kind === 'storage' && info.access === 'read_write') || (info.kind === 'storageTexture' && info.access !== 'read');
      return layoutEntry(this.kit, info, r, writable ? STAGE.FRAGMENT | STAGE.COMPUTE : STAGE.VERTEX | STAGE.FRAGMENT | STAGE.COMPUTE);
    });
    this.bgl = this.kit.bindGroupLayout(entries, this.label);
  }
  set(name: string, value: unknown) {
    if (!this.infos.some((i) => i.name === name)) throw new BindError(`${this.label}: no shared binding '${name}'`);
    this.values[name] = value;
    return this;
  }
  /** check a pipeline's own declaration of this group against the shared one */
  check(shader: Shader, where: string) {
    for (const b of Object.values(shader.bindings)) {
      if (b.group !== this.index) continue;
      const mine = this.infos.find((i) => i.binding === b.binding);
      if (!mine || mine.kind !== b.kind || mine.type !== b.type) {
        throw new BindError(`${where}: @group(${this.index}) @binding(${b.binding}) '${b.name}: ${b.type}' doesn't match the shared group (${mine ? `'${mine.name}: ${mine.type}'` : 'nothing there'}) — include the same declaration`);
      }
    }
  }
  /** the bind group (with some values swapped for one pass, e.g. a dummy shadow map while rendering the shadows) */
  bindGroup(overrides?: Record<string, unknown>): GPUBindGroup {
    let key = '';
    const res: Resolved[] = [];
    for (const info of this.infos) {
      const v = overrides && info.name in overrides ? overrides[info.name] : this.values[info.name];
      const r = resolveBinding(this.kit, info, v, this.label);
      res.push(r);
      key += r.key + ',';
    }
    if (key !== this.lastKey || !this.last) {
      let bg = this.cache.get(key);
      if (!bg) {
        bg = this.kit.device.createBindGroup({ label: this.label, layout: this.bgl, entries: this.infos.map((info, i) => ({ binding: info.binding, resource: res[i].res })) });
        if (this.cache.size > 8) this.cache.clear();
        this.cache.set(key, bg);
      }
      this.last = bg;
      this.lastKey = key;
    }
    return this.last;
  }
}

interface Group {
  index: number;
  infos: BindingInfo[];
  bgl: GPUBindGroupLayout;
  lastKey: string;
  last: GPUBindGroup | null;
  cache: Map<string, GPUBindGroup>;
  shared?: SharedGroup;
}

export class Binder {
  groups: Group[] = [];
  layout!: GPUPipelineLayout;
  /** layout identity: a pipeline must be rebuilt when this changes */
  layoutKey = '';
  constructor(private kit: Kit, public shader: Shader, public entries: string[], public values: Record<string, unknown>, public label: string) {
    this.build();
  }

  /** the bindings each stage uses (names) */
  private usage() {
    const used = new Map<string, number>();
    for (const name of this.entries) {
      const e = this.shader.reflect.entries.find((x) => x.name === name);
      if (!e) throw new BindError(`${this.label}: ${this.shader.id} has no entry point '${name}' (has: ${this.shader.reflect.entries.map((x) => `${x.stage} ${x.name}`).join(', ')})`);
      const stage = e.stage === 'vertex' ? STAGE.VERTEX : e.stage === 'fragment' ? STAGE.FRAGMENT : STAGE.COMPUTE;
      for (const r of e.resources) used.set(r, (used.get(r) ?? 0) | stage);
    }
    return used;
  }

  build() {
    const { bindings } = this.shader;
    if (this.shader.error) throw new BindError(this.shader.error);
    for (const name of Object.keys(this.values)) {
      if (!(name in bindings)) {
        const names = Object.keys(bindings).filter((n) => bindings[n].group > 0);
        throw new BindError(`${this.label}: ${this.shader.id} has no binding named '${name}' (bindings: ${names.join(', ') || 'none'})`);
      }
    }
    const used = this.usage();
    const byGroup = new Map<number, { info: BindingInfo; vis: number; r: Resolved }[]>();
    const sharedUsed = new Set<number>();
    for (const [name, vis] of used) {
      const info = bindings[name];
      if (!info) continue;
      if (info.group === 0) {
        const want = FRAME_GROUP[info.binding];
        if (!want || want.kind !== info.kind) throw new BindError(`${this.label}: '${name}' is in group 0, which is reserved for the frame (bindings 0 Frame, 1 globals, 2-4 samplers, 5 comparison sampler)`);
        continue;
      }
      const sh = this.kit.sharedGroups.get(info.group);
      if (sh) {
        if (name in this.values) throw new BindError(`${this.label}: '${name}' belongs to shared group ${info.group} (${sh.label}); set it there, not per draw`);
        sharedUsed.add(info.group);
        continue;
      }
      if (!(name in this.values) || this.values[name] === undefined) {
        throw new BindError(`${this.label}: binding '${name}' (@group(${info.group}) @binding(${info.binding}) ${info.kind} ${info.type}) is used by ${this.entries.join('/')} but not provided`);
      }
      const r = resolveBinding(this.kit, info, this.values[name], this.label);
      let list = byGroup.get(info.group);
      if (!list) byGroup.set(info.group, (list = []));
      list.push({ info, vis, r });
    }
    for (const g of sharedUsed) this.kit.sharedGroups.get(g)!.check(this.shader, this.label);
    const maxGroup = Math.max(0, ...byGroup.keys(), ...sharedUsed);
    const groups: Group[] = [];
    const bgls: GPUBindGroupLayout[] = [this.kit.frameLayout];
    const keyParts: string[] = [];
    for (let g = 1; g <= maxGroup; g++) {
      const sh = sharedUsed.has(g) ? this.kit.sharedGroups.get(g)! : null;
      if (sh) {
        bgls.push(sh.bgl);
        keyParts.push(`shared:${sh.label}`);
        groups.push({ index: g, infos: [], bgl: sh.bgl, lastKey: '', last: null, cache: new Map(), shared: sh });
        continue;
      }
      const list = (byGroup.get(g) ?? []).sort((a, b) => a.info.binding - b.info.binding);
      const entries = list.map((x) => layoutEntry(this.kit, x.info, x.r, x.vis));
      const key = JSON.stringify(entries);
      keyParts.push(key);
      const bgl = this.kit.bindGroupLayout(entries, `${this.label} g${g}`, key);
      bgls.push(bgl);
      groups.push({ index: g, infos: list.map((x) => x.info), bgl, lastKey: '', last: null, cache: new Map() });
    }
    const layoutKey = keyParts.join('/');
    if (layoutKey !== this.layoutKey || !this.layout) {
      this.layout = this.kit.device.createPipelineLayout({ label: this.label, bindGroupLayouts: bgls });
      this.layoutKey = layoutKey;
    }
    this.groups = groups;
  }

  /** change one binding's value (the layout stays; bind groups follow) */
  set(name: string, value: unknown) {
    if (!(name in this.shader.bindings)) throw new BindError(`${this.label}: no binding named '${name}'`);
    this.values[name] = value;
  }

  apply(enc: GPURenderPassEncoder | GPUComputePassEncoder, view: View, shared?: Record<number, Record<string, unknown>>) {
    setGroup(enc, 0, view.group0());
    for (const g of this.groups) {
      if (g.shared) { setGroup(enc, g.index, g.shared.bindGroup(shared?.[g.index])); continue; }
      if (!g.infos.length) { setGroup(enc, g.index, this.kit.emptyGroup); continue; }
      let key = '';
      const res: Resolved[] = [];
      for (const info of g.infos) {
        const r = resolveBinding(this.kit, info, this.values[info.name], this.label);
        res.push(r);
        key += r.key + ',';
      }
      if (key !== g.lastKey || !g.last) {
        let bg = g.cache.get(key);
        if (!bg) {
          bg = this.kit.device.createBindGroup({
            label: `${this.label} g${g.index}`, layout: g.bgl,
            entries: g.infos.map((info, i) => ({ binding: info.binding, resource: res[i].res })),
          });
          if (g.cache.size > 8) g.cache.clear();
          g.cache.set(key, bg);
        }
        g.last = bg;
        g.lastKey = key;
      }
      setGroup(enc, g.index, g.last);
    }
  }
}
