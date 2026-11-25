// Explicit phase-ordered frame graph: register run items once into named phases, get back a cached RunEntry[] array
// rebuilt only when registrations or owner flags change (no per-frame array spreads, no label-based splicing).
import type { RunEntry } from './kit';

export interface GraphEntryOptions {
  /** tie-breaker within a phase (lower runs first; equal orders keep registration order). Default 0. */
  order?: number;
  /** logical owner name (for bulk removal or active gating) */
  owner?: string;
}

interface Slot {
  phase: number;
  order: number;
  seq: number;
  owner: string | null;
  entry: RunEntry;
}

export class FrameGraph {
  private phaseIdx = new Map<string, number>();
  private slots: Slot[] = [];
  private seq = 0;
  private disabledOwners = new Set<string>();
  private dirty = true;
  private cached: RunEntry[] = [];

  constructor(readonly phases: readonly string[]) {
    for (let i = 0; i < phases.length; i++) this.phaseIdx.set(phases[i], i);
  }

  /** register an entry (or list of entries) in `phase`; returns a disposer that removes it */
  add(phase: string, entry: RunEntry | readonly RunEntry[], opts: GraphEntryOptions = {}): () => void {
    const p = this.phaseIdx.get(phase);
    if (p === undefined) throw new Error(`weft FrameGraph: unknown phase '${phase}' (has: ${this.phases.join(', ')})`);
    const order = opts.order ?? 0;
    const owner = opts.owner ?? null;
    const list = Array.isArray(entry) ? entry : [entry];
    const added: Slot[] = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it) continue;
      const slot: Slot = { phase: p, order, seq: this.seq++, owner, entry: it };
      this.slots.push(slot);
      added.push(slot);
    }
    if (added.length) this.dirty = true;
    let gone = false;
    return () => {
      if (gone) return;
      gone = true;
      let removed = false;
      for (const s of added) {
        const idx = this.slots.indexOf(s);
        if (idx >= 0) { this.slots.splice(idx, 1); removed = true; }
      }
      if (removed) this.dirty = true;
    };
  }

  /** remove every entry belonging to `owner` */
  removeOwner(owner: string) {
    const before = this.slots.length;
    this.slots = this.slots.filter((s) => s.owner !== owner);
    if (this.slots.length !== before) this.dirty = true;
  }

  /** enable or disable all entries belonging to `owner` without re-registering */
  setOwnerEnabled(owner: string, enabled: boolean) {
    const wasDisabled = this.disabledOwners.has(owner);
    if (enabled && wasDisabled) { this.disabledOwners.delete(owner); this.dirty = true; }
    else if (!enabled && !wasDisabled) { this.disabledOwners.add(owner); this.dirty = true; }
  }

  /** mark cached run list dirty */
  invalidate() { this.dirty = true; }

  /** cached flat run list ready to pass straight to `kit.run(graph.entries())` */
  entries(): readonly RunEntry[] {
    if (!this.dirty) return this.cached;
    this.slots.sort((a, b) => (a.phase - b.phase) || (a.order - b.order) || (a.seq - b.seq));
    const out = this.cached;
    out.length = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.owner !== null && this.disabledOwners.has(s.owner)) continue;
      out.push(s.entry);
    }
    this.dirty = false;
    return out;
  }
}
