// Bind by name. A Binder turns `{ heightIn: tex, params: uniforms }` into bind group layouts (derived from the
// shader's reflection plus the actual resources, e.g. an r32float texture binds as unfilterable) and bind groups.
// Only the bindings the chosen entry points actually use go into the layout, so commenting out a use never breaks the
// bind; a name the shader doesn't declare at all is an error.
//
// Resolving a group is nearly free in the common case. Each group remembers the bind group it made and the identity
// of what that holds (uid and version per binding, compared as numbers: no keys are built):
//  - a group of direct resources (no Ref, no buffer range) is reused untouched until a resource is reallocated
//    somewhere (kit.resourceGen) or a value is set on it;
//  - any other group is resolved once per run epoch (kit.bindEpoch: each kit.run and each RunAction in it starts one),
//    so a thousand draws sharing a group resolve it once;
//  - a resolution that finds the same resources reuses that bind group, or one of the last few it made (both sides of
//    a ping-pong).
// A shared group (kit.shareGroup) serves the shaders that include the file declaring it; any other shader's bindings in
// that group index are its own, so weft's group-3 shaders (painter, mip chain, texture viewer) live beside an app's
// shared group 3.
import type { Kit, View } from './kit';
import type { Shader, BindingInfo } from './shader';
import { sourceLine } from './shader';
import { Ref, deref, UniformBuffer, StorageBuffer, Texture, TexView, rawUid, isDepthFormat } from './resources';
import { STAGE } from './gpuconst';

export type SamplerName = 'linear' | 'repeat' | 'nearest' | 'nearest-repeat' | 'shadow' | 'mirror';
export type BufferRange = { buffer: StorageBuffer | UniformBuffer<any> | GPUBuffer; offset?: number; size?: number };
export type Bindable = object | SamplerName;

export class BindError extends Error {}

/** what bind groups are set on: a render or compute pass, a render bundle */
export interface BindTarget { setBindGroup(index: number, bindGroup: GPUBindGroup): void }
/** set a bind group unless the pass already has that one at that index (WebGPU keeps them across draws) */
type Tracked = BindTarget & { __weftGroups?: (GPUBindGroup | undefined)[] };
function setGroup(enc: Tracked, i: number, bg: GPUBindGroup) {
  const s = (enc.__weftGroups ??= []);
  if (s[i] === bg) return;
  s[i] = bg;
  enc.setBindGroup(i, bg);
}
/** forget what a pass has set (after code outside weft may have changed it) */
export function forgetBindings(enc: BindTarget) { (enc as Tracked).__weftGroups = undefined; }

interface Resolved { res: GPUBindingResource; unfilterable?: boolean; format?: GPUTextureFormat }

const describe = (v: unknown) => {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return `'${v}'`;
  const o = v as { constructor?: { name?: string }; label?: string };
  return `${o.constructor?.name ?? typeof v}${o.label ? ` "${o.label}"` : ''}`;
};

function bufferOf(v: unknown): { buf: GPUBuffer; offset?: number; size?: number } | null {
  if (v instanceof UniformBuffer || v instanceof StorageBuffer) return { buf: v.gpu };
  if (typeof GPUBuffer !== 'undefined' && v instanceof GPUBuffer) return { buf: v };
  if (v && typeof v === 'object' && 'buffer' in v) {
    const r = v as BufferRange;
    const inner = bufferOf(r.buffer);
    if (!inner) return null;
    return { buf: inner.buf, offset: r.offset, size: r.size };
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
      return { res };
    }
    case 'texture':
    case 'storageTexture': {
      const dim = info.texture?.dim ?? '2d';
      if (v instanceof Texture) {
        const depth = isDepthFormat(v.format);
        const desc: GPUTextureViewDescriptor = { dimension: dim };
        if (info.kind === 'storageTexture') { desc.baseMipLevel = 0; desc.mipLevelCount = 1; }
        if (depth) desc.aspect = 'depth-only';
        return { res: v.view(desc), unfilterable: v.unfilterable || (depth && info.texture?.sample !== 'depth'), format: v.format };
      }
      if (v instanceof TexView) {
        const depth = isDepthFormat(v.texture.format);
        const desc = { ...v.desc };
        if (!desc.dimension) desc.dimension = dim;
        return { res: v.texture.view(desc), unfilterable: v.texture.unfilterable || (depth && info.texture?.sample !== 'depth'), format: v.texture.format };
      }
      if (typeof GPUTextureView !== 'undefined' && v instanceof GPUTextureView) return { res: v };
      if (typeof GPUTexture !== 'undefined' && v instanceof GPUTexture) {
        let view = kit.rawViews.get(v);
        if (!view) kit.rawViews.set(v, (view = v.createView({ dimension: dim })));
        return { res: view, format: v.format };
      }
      throw fail('a Texture (kit.texture)');
    }
    case 'sampler':
    case 'samplerComparison': {
      if (typeof v === 'string') {
        const s = kit.namedSampler(v as SamplerName);
        if (!s) throw fail(`a sampler (one of linear, repeat, nearest, nearest-repeat, mirror, shadow)`);
        return { res: s };
      }
      if (typeof GPUSampler !== 'undefined' && v instanceof GPUSampler) return { res: v };
      throw fail('a sampler');
    }
    case 'externalTexture': {
      if (typeof GPUExternalTexture !== 'undefined' && v instanceof GPUExternalTexture) return { res: v };
      throw fail('a GPUExternalTexture');
    }
  }
}

// ---------------------------------------------------------------- identities
/** numbers per binding in an identity: [kind, uid, version, view description or offset, size] */
const STRIDE = 5;
const scratch: number[] = [];

/** writes the identity of what `value` binds into out[at…]; true when it can move without notice (a Ref, a range) */
function identify(kit: Kit, value: unknown, out: number[], at: number): boolean {
  let v = value, moves = false;
  while (v instanceof Ref) { v = v.get(); moves = true; }
  let kind = -1, id = 0, version = 0, x = 0, y = 0;
  if (v instanceof UniformBuffer || v instanceof StorageBuffer || v instanceof Texture) { kind = 1; id = v.uid; version = v.version; }
  else if (v instanceof TexView) { kind = 2; id = v.texture.uid; version = v.texture.version; x = v.descId; }
  else if (typeof v === 'string') { const s = kit.namedSampler(v as SamplerName); kind = 3; id = s ? rawUid(s) : -1; }
  else if (v && typeof v === 'object') {
    if ('buffer' in v) {
      const r = v as BufferRange, b = r.buffer;
      kind = 4; moves = true;
      if (b instanceof UniformBuffer || b instanceof StorageBuffer) { id = b.uid; version = b.version; } else id = rawUid(b);
      x = r.offset ?? 0; y = r.size ?? -1;
    } else { kind = 5; id = rawUid(v); }
  }
  out[at] = kind; out[at + 1] = id; out[at + 2] = version; out[at + 3] = x; out[at + 4] = y;
  return moves;
}
const same = (a: number[], b: number[], n: number) => {
  if (a.length !== n) return false;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** a group's last bind group, the identity of what it holds, and when that was last checked */
class Memo {
  bg: GPUBindGroup | null = null;
  ids: number[] = [];
  gen = -1;
  vgen = -1;
  epoch = -1;
  /** a value can move without notice (a Ref, a range): checked once per run epoch rather than only on changes */
  moves = false;
  /** the last few bind groups made (the two sides of a ping-pong…) */
  recent: { ids: number[]; bg: GPUBindGroup }[] = [];
}

/** a group's bind group now: `vgen` is its owner's count of value changes */
function groupOf(kit: Kit, m: Memo, infos: BindingInfo[], values: Record<string, unknown>, overrides: Record<string, unknown> | undefined, vgen: number, layout: GPUBindGroupLayout, label: string): GPUBindGroup {
  if (m.bg && m.gen === kit.resourceGen && m.vgen === vgen && (!m.moves || m.epoch === kit.bindEpoch)) return m.bg;
  const n = infos.length * STRIDE;
  let moves = !!overrides;
  for (let i = 0; i < infos.length; i++) {
    const name = infos[i].name;
    if (identify(kit, overrides && name in overrides ? overrides[name] : values[name], scratch, i * STRIDE)) moves = true;
  }
  let bg = m.bg && same(m.ids, scratch, n) ? m.bg : null;
  if (!bg) {
    const hit = m.recent.find((r) => same(r.ids, scratch, n));
    if (hit) { bg = hit.bg; m.ids = hit.ids; }
  }
  if (!bg) {
    const ids = scratch.slice(0, n);
    bg = kit.device.createBindGroup({
      label, layout,
      entries: infos.map((info) => ({ binding: info.binding, resource: resolveBinding(kit, info, overrides && info.name in overrides ? overrides[info.name] : values[info.name], label).res })),
    });
    m.recent.push({ ids, bg });
    if (m.recent.length > 8) m.recent.shift();
    m.ids = ids;
  }
  m.bg = bg;
  m.gen = kit.resourceGen;
  m.vgen = vgen;
  m.epoch = kit.bindEpoch;
  m.moves = moves;
  return bg;
}

/** the files whose code declares `index` in a shader (where its `@group(index)` lines come from) */
function declaringFiles(shader: Shader, index: number) {
  const at = new RegExp(`@group\\(\\s*${index}\\s*\\)`);
  const files = new Set<string>();
  shader.code.split('\n').forEach((line, i) => { if (at.test(line.replace(/\/\/.*$/, ''))) files.add(sourceLine(shader, i + 1).file); });
  if (!files.size) files.add(shader.id);
  return files;
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

/** A bind group shared by every pipeline whose shader includes its declaration (an environment: lighting, sky, shadows,
 *  terrain maps…). Its layout comes from the declaring include's reflection — every binding of that group, visible to
 *  every stage — so one bind group serves all of them. Draws never pass these bindings themselves. */
export class SharedGroup {
  readonly infos: BindingInfo[];
  /** the source files that declare it: a shader shares the group when it includes one of them */
  readonly files: Set<string>;
  bgl!: GPUBindGroupLayout;
  /** its layout's description (kit.bindGroupLayout's key) */
  bglKey = '';
  /** bumped by set() */
  vgen = 0;
  private memo = new Memo();
  private memos = new WeakMap<object, Memo>();
  constructor(private kit: Kit, readonly index: number, readonly shader: Shader, readonly values: Record<string, unknown>, readonly label: string) {
    this.infos = Object.values(shader.bindings).filter((b) => b.group === index).sort((a, b) => a.binding - b.binding);
    if (!this.infos.length) throw new BindError(`${label}: ${shader.id} declares nothing in group ${index}`);
    this.files = declaringFiles(shader, index);
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
    this.bglKey = JSON.stringify(entries);
    this.bgl = this.kit.bindGroupLayout(entries, this.label, this.bglKey);
  }
  set(name: string, value: unknown) {
    if (!this.infos.some((i) => i.name === name)) throw new BindError(`${this.label}: no shared binding '${name}'`);
    this.values[name] = value;
    this.vgen++;
    return this;
  }
  /** whether `shader` shares this group (it includes the declaration) */
  serves(shader: Shader) { return shader === this.shader || shader.files.some((f) => this.files.has(f)); }
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
    let m = this.memo;
    if (overrides) {
      const o = this.memos.get(overrides);
      if (o) m = o; else this.memos.set(overrides, (m = new Memo()));
    }
    return groupOf(this.kit, m, this.infos, this.values, overrides, this.vgen, this.bgl, this.label);
  }
}

interface Group {
  index: number;
  infos: BindingInfo[];
  bgl: GPUBindGroupLayout;
  label: string;
  memo: Memo;
  shared?: SharedGroup;
}

export class Binder {
  groups: Group[] = [];
  layout!: GPUPipelineLayout;
  /** layout identity, the description of each group's layout after the frame's (a shared group's too): a pipeline must
   *  be rebuilt when this changes, and binders with the same one have the same bind group layouts (kit.bindGroupLayout
   *  makes one per description), so their pipelines can be one (kit.pipelineCache) */
  layoutKey = '';
  /** bumped whenever its values or its groups change */
  vgen = 0;
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
      if (sh?.serves(this.shader)) {
        if (name in this.values) throw new BindError(`${this.label}: '${name}' belongs to shared group ${info.group} (${sh.label}); set it there, not per draw`);
        sharedUsed.add(info.group);
        continue;
      }
      if (!(name in this.values) || this.values[name] === undefined) {
        const hint = sh ? ` (group ${info.group} is shared as '${sh.label}' only with shaders that include ${[...sh.files].join(' or ')})` : '';
        throw new BindError(`${this.label}: binding '${name}' (@group(${info.group}) @binding(${info.binding}) ${info.kind} ${info.type}) is used by ${this.entries.join('/')} but not provided${hint}`);
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
        keyParts.push(sh.bglKey);
        groups.push({ index: g, infos: [], bgl: sh.bgl, label: sh.label, memo: new Memo(), shared: sh });
        continue;
      }
      const list = (byGroup.get(g) ?? []).sort((a, b) => a.info.binding - b.info.binding);
      const entries = list.map((x) => layoutEntry(this.kit, x.info, x.r, x.vis));
      const key = JSON.stringify(entries);
      keyParts.push(key);
      const bgl = this.kit.bindGroupLayout(entries, `${this.label} g${g}`, key);
      bgls.push(bgl);
      groups.push({ index: g, infos: list.map((x) => x.info), bgl, label: `${this.label} g${g}`, memo: new Memo() });
    }
    const layoutKey = keyParts.join('/');
    if (layoutKey !== this.layoutKey || !this.layout) {
      this.layout = this.kit.device.createPipelineLayout({ label: this.label, bindGroupLayouts: bgls });
      this.layoutKey = layoutKey;
    }
    this.groups = groups;
    this.vgen++;
  }

  /** change one binding's value (the layout stays; bind groups follow) */
  set(name: string, value: unknown) {
    if (!(name in this.shader.bindings)) throw new BindError(`${this.label}: no binding named '${name}'`);
    this.values[name] = value;
    this.vgen++;
  }

  /** one of its groups' bind group now (`shared`: a pass's swapped shared values) */
  groupFor(g: Group, shared?: Record<number, Record<string, unknown>>): GPUBindGroup {
    if (g.shared) return g.shared.bindGroup(shared?.[g.index]);
    if (!g.infos.length) return this.kit.emptyGroup;
    return groupOf(this.kit, g.memo, g.infos, this.values, undefined, this.vgen, g.bgl, g.label);
  }

  /** whether a value of its own can move without notice (a Ref or a buffer range, as last resolved) */
  get moves() { return this.groups.some((g) => !g.shared && g.memo.moves); }

  apply(enc: BindTarget, view: View, shared?: Record<number, Record<string, unknown>>) {
    setGroup(enc, 0, view.group0());
    for (const g of this.groups) setGroup(enc, g.index, this.groupFor(g, shared));
  }
}
