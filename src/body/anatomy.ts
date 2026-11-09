// The body's joints as a body's: each joint's degrees of freedom with how far they go (the limit), how far they go at
// ease (the comfortable band, after the ergonomists' REBA and RULA bands and Kee & Karwowski's discomfort-vs-range
// curves), and how far they go loaded (a passive limit: a hand flat under the body's weight bends its wrist back further
// than a wrist can lift itself). Angles in radians; each DOF's sign as `measure.ts` reads it. Plus the segments' masses
// and centres (de Leva 1996) for the body's centre of mass.
//
// Ranges: adult norms (AAOS; Norkin & White; Soucie et al. 2011), the spine's split by level after White & Panjabi, the
// neck's upper (occiput–C2) and lower (C2–C7) after the same; a body's own flexibility scales them (`FLEX`): Iroh's an
// old man's, Aang's a supple airbender's.

const D = Math.PI / 180;

/** one degree of freedom: its limit each way (lo < 0 < hi, radians), its comfortable band, a loaded joint's further
 *  passive limit (optional), and how much its middle pulls (a joint's own preference for neutral) */
export interface Dof { lo: number; hi: number; okLo: number; okHi: number; pLo?: number; pHi?: number; pull?: number;
  /** how much a body's suppleness moves this range (1: all of it — the spine, the hips, the hamstrings; a little: the
   *  forearm's turn and the fingers hardly change with age) */
  fk?: number }
const dof = (lo: number, hi: number, okLo: number, okHi: number, pLo?: number, pHi?: number, pull = 0.1, fk = 1): Dof =>
  ({ lo: lo * D, hi: hi * D, okLo: okLo * D, okHi: okHi * D, pLo: pLo === undefined ? undefined : pLo * D, pHi: pHi === undefined ? undefined : pHi * D, pull, fk });
/** the scale of a DOF's range for a body of suppleness k */
export const flexOf = (d: Dof, k: number) => 1 + (k - 1) * (d.fk ?? 1);

/** the joints measured, each a list of DOFs (named) in its own sign convention (see measure.ts):
 *  - spine segments, neck, head: flex (+ forward), side (+ toward the right), turn (+ to the left)
 *  - hip: flex (+ thigh forward), abd (+ away from the midline), rot (+ external)
 *  - knee: flex (+ bent), varus (+ the shin's foot out), rot (+ external, the foot out)
 *  - ankle: dorsi (+ toes up), inv (+ sole turned in), add (+ toes in)
 *  - toe (the ball's joint): ext (+ toes bent up)
 *  - clavicle: elev (+ shoulder up), prot (+ shoulder forward)
 *  - shoulder: elev (from hanging), cone (from the reachable cone's axis: SHOULDER_CONE), rot (+ external)
 *  - elbow: flex (+ bent; - hyperextended)
 *  - forearm: roll (from its middle: + supinated, the palm up)
 *  - wrist: flex (+ toward the palm), dev (+ toward the thumb)
 *  - fingers' knuckles (MCP): flex, abd; the middle and end joints (PIP, DIP): flex */
export const JOINTS = {
  // the lumbar spine (L1–S1: the rig's spine bone on its pelvis): bends forward ~45°, back ~25°, sideways ~20°, turns
  // hardly at all (~10°: its facets lock it); at ease within about a third of that (REBA's trunk: upright to 20°)
  lumbar: { flex: dof(-25, 45, -8, 18, -40, 55), side: dof(-20, 20, -8, 8), turn: dof(-8, 8, -3, 3) },
  // the thoracic spine (T1–T12: the chest on the spine): forward ~40°, back ~25°, sideways ~25°, turns ~35° each way
  thoracic: { flex: dof(-25, 40, -8, 15, -35, 45), side: dof(-25, 25, -8, 8), turn: dof(-35, 35, -12, 12) },
  // the lower neck (C2–C7: the neck bone on the chest) and the upper (occiput–C2: the head on the neck): the turn is
  // mostly the upper's (C1–C2), the nod mostly the lower's; REBA's neck: at ease to 20° forward, none back
  neckLow: { flex: dof(-50, 35, -10, 15, undefined, undefined, 0.1, 0.7), side: dof(-30, 30, -10, 10, undefined, undefined, 0.1, 0.7), turn: dof(-35, 35, -15, 15, undefined, undefined, 0.1, 0.7) },
  neckUp: { flex: dof(-25, 18, -8, 10, undefined, undefined, 0.1, 0.7), side: dof(-8, 8, -4, 4, undefined, undefined, 0.1, 0.7), turn: dof(-45, 45, -25, 25, undefined, undefined, 0.1, 0.7) },
  // the hip: forward 120° (a bent knee; a straight one hamstring-limited, see legFlexMax), back 20° (a lunge's back leg
  // further with the pelvis tipped), out 45°, in 30°, turned in 40°, out 45°
  hip: { flex: dof(-20, 120, -8, 60, -30, 140), abd: dof(-30, 45, -10, 20, -35, 60), rot: dof(-40, 45, -15, 20) },
  // the knee: a hinge to ~140° (kneeling, sat back on the heels, ~155° pressed), straight (a few degrees past); the shin
  // turns only with the knee bent (tibial rotation, scaled by the bend: kneeRotK); varus/valgus barely
  knee: { flex: dof(-5, 140, 0, 90, -8, 158, 0.1, 0.3), varus: dof(-6, 6, -3, 3, undefined, undefined, 0.1, 0.3), rot: dof(-15, 28, -6, 12, undefined, undefined, 0.1, 0.5) },
  // the ankle: toes up 20° (a loaded lunge 35°), down 50° (pointed: 60°+), the sole turned in 35°, out 20° (loaded, the
  // foot's arch flattening: 26°)
  ankle: { dorsi: dof(-50, 20, -20, 10, -65, 38, 0.1, 0.6), inv: dof(-20, 35, -8, 12, -26, 40, 0.1, 0.6), add: dof(-22, 25, -10, 12, undefined, undefined, 0.1, 0.6) },
  // the toes at the ball (MTP): bent up 70° (on the balls; 90° loaded), down 35°
  toe: { ext: dof(-35, 70, -10, 35, -40, 92, 0.1, 0.5) },
  // the clavicle (sternoclavicular): the shoulder's girdle up 35°, down 8°, forward 25°, back 25°
  clav: { elev: dof(-8, 35, -3, 12, undefined, undefined, 0.1, 0.5), prot: dof(-25, 25, -10, 10, undefined, undefined, 0.1, 0.5) },
  // the shoulder (the humerus on the thorax: with the scapula's turn): raised to 180° (at ease to ~50°: RULA's upper
  // arm), anywhere within its reach (SHOULDER_CONE), turned in 80°, out 95° (at ease a quarter turn either way)
  shoulder: { elev: dof(0, 185, 0, 50, undefined, undefined, 0.1, 0.8), cone: dof(0, 140, 0, 112, undefined, undefined, 0.1, 0.5), rot: dof(-80, 95, -35, 45, undefined, undefined, 0.1, 0.7) },
  // the elbow: to 150°, straight (a few degrees past: more in women and children)
  elbow: { flex: dof(-5, 150, 15, 110, -10, 155, 0.1, 0.2) },
  // the forearm's roll from its middle (pronation, supination): 85° either way, at ease to ~50° (bonfire's ROLL_MAX)
  forearm: { roll: dof(-85, 85, -49, 49, undefined, undefined, 0.1, 0.25) },
  // the wrist: toward the palm 70°, back 57° (a hand flat under the body's weight ~88°), toward the thumb 20°, away 32°
  wrist: { flex: dof(-57, 70, -20, 29, -88, 80, 0.1, 0.4), dev: dof(-32, 20, -15, 8, undefined, undefined, 0.1, 0.4) },
  // the fingers: the knuckle (MCP) 90° in, ~25° back (a flat hand pressed: 45°), spread ±20°; the middle joint (PIP)
  // to 110°; the end joint (DIP) to 80° (a few degrees back)
  mcp: { flex: dof(-25, 92, -10, 60, -45, 95, 0.1, 0.2), abd: dof(-22, 22, -10, 10, undefined, undefined, 0.1, 0.2) },
  pip: { flex: dof(-8, 110, -2, 70, undefined, undefined, 0.1, 0.2) },
  dip: { flex: dof(-10, 80, 0, 50, undefined, undefined, 0.1, 0.2) },
} as const;
export type JointName = keyof typeof JOINTS;

/** where a humerus can point (on the thorax, the body's left side; x out, y up, z forward): within 140° of this axis —
 *  overhead and a little past (~30° back, tilted in), out to the side and some way behind it, across the chest, down
 *  behind the back toward the other side (a hand to a back pocket), back to ~70° of extension; not far behind overhead,
 *  not straight back. (A cone fitted to the AAOS ranges: the plane of elevation is meaningless overhead.) */
export const SHOULDER_CONE: [number, number, number] = (() => { const v = [0.35, -0.3, 0.89], l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; })();

/** the hip's flexion with the knee straight is the hamstrings': ~80° untrained, ~95° for a fit young body, 120°+ for a
 *  yogi (scaled by the body's flexibility); a bent knee frees it to the joint's own limit */
export function hipFlexMax(kneeFlex: number, flex = 1): number {
  const straight = 95 * D * flex * flex, bent = JOINTS.hip.flex.hi * Math.min(1.12, flex);
  const k = Math.min(1, Math.max(0, kneeFlex / (70 * D)));
  return straight + (bent - straight) * k * k * (3 - 2 * k);
}
/** the shin's turn grows with the knee's bend (none straight, all of it past ~60°) */
export const kneeRotK = (kneeFlex: number) => { const k = Math.min(1, Math.max(0, kneeFlex / (60 * D))); return 0.15 + 0.85 * k * k * (3 - 2 * k); };

/** a body's flexibility (its ranges scaled about neutral, the comfortable bands with them): the cast's own */
export const FLEX: Record<string, number> = { katara: 1.0, aang: 1.15, iroh: 0.8 };

/** how far a DOF is past its comfortable band, as a fraction of the way to its limit (0 at ease; 1 at the limit; past
 *  1 over it), for a body of flexibility k, loaded or not */
export function strain(x: number, d: Dof, k0 = 1, loaded = false): number {
  const k = flexOf(d, k0);
  const hi = (loaded && d.pHi !== undefined ? d.pHi : d.hi) * k, lo = (loaded && d.pLo !== undefined ? d.pLo : d.lo) * k;
  const okHi = d.okHi * k, okLo = d.okLo * k;
  if (x > okHi) return (x - okHi) / Math.max(1e-3, hi - okHi);
  if (x < okLo) return (okLo - x) / Math.max(1e-3, okLo - lo);
  return 0;
}
/** how ill at ease a DOF is held at x (the solvers' cost): a gentle pull to its middle, quickly worse past its
 *  comfortable band, far worse past its limit (armEase's shape, for any joint) */
export function discomfort(x: number, d: Dof, k0 = 1, loaded = false): number {
  const k = flexOf(d, k0);
  const hi = (loaded && d.pHi !== undefined ? d.pHi : d.hi) * k, lo = (loaded && d.pLo !== undefined ? d.pLo : d.lo) * k;
  const okHi = d.okHi * k, okLo = d.okLo * k;
  const e = x > okHi ? x - okHi : x < okLo ? okLo - x : 0;
  const b = x > hi ? x - hi : x < lo ? lo - x : 0;
  return 3 * e * e + 40 * b * b + (d.pull ?? 0.1) * x * x;
}

// ---------------------------------------------------------------- the segments' masses (de Leva 1996)
/** each segment's share of the body's mass and where its centre lies from its proximal end to its distal (fraction),
 *  female and male (de Leva's adjustments to Zatsiorsky–Seluyanov) */
export const SEGMENTS = {
  head: { f: 0.0668, m: 0.0694, c: [0.5, 0.5] },        // the head and neck (from the neck's base to the crown)
  thorax: { f: 0.1545, m: 0.1596, c: [0.5050, 0.5066] }, // the upper trunk (the chest bone)
  abdomen: { f: 0.1465, m: 0.1633, c: [0.4502, 0.4502] }, // the middle trunk (the spine bone)
  pelvis: { f: 0.1247, m: 0.1117, c: [0.4920, 0.6115] }, // the lower trunk (the pelvis bone: hips to waist)
  uarm: { f: 0.0255, m: 0.0271, c: [0.5754, 0.5772] },
  farm: { f: 0.0138, m: 0.0162, c: [0.4559, 0.4574] },
  hand: { f: 0.0056, m: 0.0061, c: [0.3427, 0.3624] },
  thigh: { f: 0.1478, m: 0.1416, c: [0.3612, 0.4095] },
  shank: { f: 0.0481, m: 0.0433, c: [0.4416, 0.4459] },
  foot: { f: 0.0129, m: 0.0137, c: [0.4014, 0.4415] },
} as const;
