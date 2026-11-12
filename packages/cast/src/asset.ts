// A cast member's mesh, as the waterbending game's Blender pipeline ships it (and Boulder's town pipeline after it): a
// DNC1 file — a quantised skinned vertex stream (24 bytes: position u16x3 + material u16, normal s8x4 with baked AO in
// w, strand flow s8x4 (or the lip mask, thickness, curvature), bones u8x4, weights u8x4) and the bind skeleton (head /
// tail / up per bone in bind space: A-pose, facing +z, +x = her left, feet at y = 0). Gzipped or not.
//
// Where the file comes from is the project's (its asset map, R2, a plain URL): `loadHero(url, { fetch })` takes the
// project's own fetch. How many bones a project's GPU buffer holds is the project's too (its hero.wgsl): MAX_BONES here
// is what the rig's CPU arrays are sized for, and a project checks its own limit with `maxBones`.
import type { V3 } from './math.js';
import { fitGarments } from './garment.js';

export interface BoneDef { name: string; head: V3; tail: V3; up: V3 }
export interface HeroHeader {
  char: string; version: number; height: number; scale: number;
  bones: { name: string; head: number[]; tail: number[]; up: number[] }[];
  chains: Record<string, number[][]>;
  chainParents?: Record<string, string>;
  eye: { x: number; y: number; z: number; r: number };
  face: { brow_y: number; mouth_y: number; lip_w: number; nose_tip: [number, number]; chin: [number, number] };
  verts: number; indices: number; qmin: number[]; qmax: number[]; stride: number;
  /** per palette slot rgb + silk (the export's outfit colours) */
  pal?: number[][];
  iris?: number[];
  /** the hair's lock lines' axis: the pole in front of the forehead and the gather at the nape, each (y, z) in bind
   *  space */
  hairAxis?: number[];
  /** the hands as built (a modelled hand grafted on and weighted to its own bones: fitHands leaves it alone): where
   *  it came from, wrist-to-middle-fingertip length (m), breadth against the source's */
  hand?: { source: string; len: number; breadth: number };
  /** a modelled face (lips, a jaw that opens on teeth and a tongue, brows, lids over real eyes: built, not drawn): its
   *  bones move as far as a real face's (rig.ts MODELLED), times `gain` */
  faceRig?: { gain?: number; /** the jaw's opening at full (rad; 0.24 if unset) */ jaw?: number;
    /** each speech shape's own gain over `gain` (round, press, spread, tuck, open: 1 if unset) */ shapes?: Record<string, number>;
    /** 0..1: how steadily the eyes hold what they look at (the saccades and the phrase's glances scaled down) */ attend?: number;
    /** the lids held this much more open at rest (0..1) */ lidOpen?: number };
}
export interface HeroAsset {
  header: HeroHeader;
  bones: BoneDef[];
  index: Record<string, number>;
  chains: Record<string, V3[]>;
  verts: Uint8Array<ArrayBuffer>;
  idx: Uint32Array<ArrayBuffer>;
}

export const VBYTES = 24;
/** the bones a rig's arrays hold (HeroRig.bones, .dq): a body's own and what's added after them (Drake's robe adds
 *  its chains' segments: 220). A project's GPU buffer may hold fewer (Boulder's, Seven Havens', San Francisco's:
 *  160): it uploads `dq.subarray(0, nBones * 8)` and checks its own limit (loadHero's `maxBones`) */
export const MAX_BONES = 220;
export const CORE = ['root', 'pelvis', 'spine', 'chest', 'neck', 'head', 'clavL', 'uarmL', 'farmL', 'handL', 'clavR', 'uarmR', 'farmR', 'handR',
  'thighL', 'shinL', 'footL', 'toeL', 'thighR', 'shinR', 'footR', 'toeR'] as const;

async function gunzipIfNeeded(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b0 = new Uint8Array(buf, 0, 2);
  if (b0[0] === 0x1f && b0[1] === 0x8b) return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return buf;
}

export interface LoadHeroOpts {
  /** how to fetch the file (default: the global fetch) — a project's asset map or its CDN (Boulder's fetchUrl) */
  fetch?: (url: string) => Promise<Response>;
  /** the most bones the project's GPU buffer holds (default MAX_BONES): more and it throws */
  maxBones?: number;
}

/** a DNC1 file read (from bytes already fetched): `name` is for its errors */
export async function parseHero(bytes: ArrayBuffer, name = 'hero', maxBones = MAX_BONES): Promise<HeroAsset> {
  const buf = await gunzipIfNeeded(bytes);
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'DNC1') throw new Error(`${name}: not a DNC1 character file`);
  const hl = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hl))) as HeroHeader;
  if (header.stride !== VBYTES) throw new Error(`${name}: stride ${header.stride}`);
  const vOff = 12 + hl, vBytes = header.verts * header.stride;
  const verts = new Uint8Array(buf.slice(vOff, vOff + vBytes));
  const idx = new Uint32Array(buf.slice(vOff + vBytes, vOff + vBytes + header.indices * 4));
  const bones: BoneDef[] = header.bones.map((b) => ({ name: b.name, head: b.head as V3, tail: b.tail as V3, up: b.up as V3 }));
  const index: Record<string, number> = {};
  bones.forEach((b, i) => { index[b.name] = i; });
  for (const n of CORE) if (index[n] === undefined) throw new Error(`${name}: missing bone ${n}`);
  const chains: Record<string, V3[]> = {};
  for (const [k, v] of Object.entries(header.chains ?? {})) chains[k] = v.map((p) => [p[0], p[1], p[2]] as V3);
  const a: HeroAsset = { header, bones, index, chains, verts, idx };
  // (the clothes under the hips hung from the hips' hanging frame: garment.ts)
  fitGarments(a);
  if (bones.length > maxBones) throw new Error(`${name}: ${bones.length} bones > ${maxBones}`);
  return a;
}

export async function loadHero(url: string, o: LoadHeroOpts = {}): Promise<HeroAsset> {
  const r = await (o.fetch ?? fetch)(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return parseHero(await r.arrayBuffer(), url, o.maxBones ?? MAX_BONES);
}
