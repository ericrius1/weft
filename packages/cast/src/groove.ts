// The riddim in a body: a reggae one-drop at 74 BPM — nothing on the one, the kick and the rim together on three (the
// drop), the skank on the offbeats. Dancing on the spot to it, laid back: the knees give on every beat (deepest on the
// drop) and come up on the skank, the weight rolls from one foot to the other over the bar, the shoulders roll the
// other way, the head nods a hair behind the beat. Each dancer their own amounts and lag.
import type { Groove } from './rig.js';

export interface Feel {
  /** the knees' give (m) on a beat and extra on the drop */
  dip: number; drop: number;
  /** the weight's roll over the bar (m), the chest's turn and roll against it (rad) */
  sway: number; twist: number; roll: number;
  /** the nod (rad), how far behind the beat it comes (a fraction of a beat), the head's tilt with the sway (rad) */
  nod: number; lag: number; tilt: number;
  /** a rock of the chest with the skank (rad) */
  rock: number;
}

const TAU = Math.PI * 2;
/** a beat's give: down quickly on the beat, up slowly through the skank (0..1, peak just after the beat) */
function give(ph: number) {
  const u = ((ph % 1) + 1) % 1;
  return u < 0.18 ? Math.sin((u / 0.18) * Math.PI * 0.5) : 0.5 + 0.5 * Math.cos(((u - 0.18) / 0.82) * Math.PI);
}

/** the dance at this point of the bar (bar 0..1, beat 3 at 0.5), by k (0 still .. 1 dancing), the kick's punch */
export function groove(bar: number, k: number, F: Feel, kick = 0, out: Groove = { bounce: 0, sway: 0, twist: 0, rock: 0, roll: 0, nod: 0, tilt: 0 }): Groove {
  const beats = bar * 4;
  const beatIn = Math.floor(((beats % 4) + 4) % 4);
  const g = give(beats);
  const onDrop = beatIn === 2 ? 1 : 0;
  out.bounce = k * (F.dip * g + F.drop * onDrop * g + 0.006 * kick);
  // (the weight over the left foot on the one, the right on the drop)
  const sw = Math.cos(TAU * bar);
  out.sway = k * F.sway * sw;
  out.twist = k * F.twist * Math.sin(TAU * bar);
  out.roll = -k * F.roll * sw;
  out.rock = k * F.rock * (give(beats + 0.5) - 0.5);
  out.nod = k * (F.nod * (give(beats - F.lag) - 0.35) + 0.4 * F.nod * onDrop * give(beats - F.lag));
  out.tilt = k * F.tilt * sw;
  return out;
}

/** a groove blended over another by w (and added: a strike's turn over the dance) */
export function mixGroove(a: Groove, b: Partial<Groove>, w = 1): Groove {
  return {
    bounce: a.bounce + (b.bounce ?? 0) * w, sway: a.sway + (b.sway ?? 0) * w, twist: a.twist + (b.twist ?? 0) * w, rock: a.rock + (b.rock ?? 0) * w,
    roll: a.roll + (b.roll ?? 0) * w, nod: a.nod + (b.nod ?? 0) * w, tilt: a.tilt + (b.tilt ?? 0) * w,
  };
}
