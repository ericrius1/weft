import type { V3 } from './math.js';
export interface BoneDef {
    name: string;
    head: V3;
    tail: V3;
    up: V3;
}
export interface HeroHeader {
    char: string;
    version: number;
    height: number;
    scale: number;
    /** what body it is: absent (or 'human') a person, rigged by HeroRig, with the CORE bones; anything else ('bird',
     *  'dog', …) a body of its own: no bone is required by name, each bone names its parent (an earlier bone's name or
     *  index; null or -1 the root's), and posing it is the caller's (skin matrices through matToDQ, as HeroRig does) */
    kind?: string;
    bones: {
        name: string;
        head: number[];
        tail: number[];
        up: number[];
        parent?: number | string | null;
    }[];
    chains: Record<string, number[][]>;
    chainParents?: Record<string, string>;
    eye: {
        x: number;
        y: number;
        z: number;
        r: number;
    };
    face: {
        brow_y: number;
        mouth_y: number;
        lip_w: number;
        nose_tip: [number, number];
        chin: [number, number];
    };
    verts: number;
    indices: number;
    qmin: number[];
    qmax: number[];
    stride: number;
    /** per palette slot rgb + silk (the export's outfit colours) */
    pal?: number[][];
    iris?: number[];
    /** the hair's lock lines' axis: the pole in front of the forehead and the gather at the nape, each (y, z) in bind
     *  space */
    hairAxis?: number[];
    /** the hands as built (a modelled hand grafted on and weighted to its own bones: fitHands leaves it alone): where
     *  it came from, wrist-to-middle-fingertip length (m), breadth against the source's */
    hand?: {
        source: string;
        len: number;
        breadth: number;
    };
    /** a modelled face (lips, a jaw that opens on teeth and a tongue, brows, lids over real eyes: built, not drawn): its
     *  bones move as far as a real face's (rig.ts MODELLED), times `gain` */
    faceRig?: {
        gain?: number; /** the jaw's opening at full (rad; 0.24 if unset) */
        jaw?: number;
        /** each speech shape's own gain over `gain` (round, press, spread, tuck, open: 1 if unset) */ shapes?: Record<string, number>;
        /** 0..1: how steadily the eyes hold what they look at (the saccades and the phrase's glances scaled down) */ attend?: number;
        /** the lids held this much more open at rest (0..1) */ lidOpen?: number;
    };
}
export interface HeroAsset {
    header: HeroHeader;
    bones: BoneDef[];
    index: Record<string, number>;
    chains: Record<string, V3[]>;
    verts: Uint8Array<ArrayBuffer>;
    idx: Uint32Array<ArrayBuffer>;
    /** each bone's parent (-1 the root): from the header for a body of its own kind (header.kind); empty for a person,
     *  whose hierarchy HeroRig knows by name */
    parents: Int16Array;
}
/** a body that isn't a person (header.kind set and not 'human'): no CORE bones, its own hierarchy */
export declare const isOwnBody: (h: HeroHeader) => boolean;
export declare const VBYTES = 24;
/** the bones a rig's arrays hold (HeroRig.bones, .dq): a body's own and what's added after them (Drake's robe adds
 *  its chains' segments: 220). A project's GPU buffer may hold fewer (Boulder's, Seven Havens', San Francisco's:
 *  160): it uploads `dq.subarray(0, nBones * 8)` and checks its own limit (loadHero's `maxBones`) */
export declare const MAX_BONES = 220;
export declare const CORE: readonly ["root", "pelvis", "spine", "chest", "neck", "head", "clavL", "uarmL", "farmL", "handL", "clavR", "uarmR", "farmR", "handR", "thighL", "shinL", "footL", "toeL", "thighR", "shinR", "footR", "toeR"];
export interface LoadHeroOpts {
    /** how to fetch the file (default: the global fetch) — a project's asset map or its CDN (Boulder's fetchUrl) */
    fetch?: (url: string) => Promise<Response>;
    /** the most bones the project's GPU buffer holds (default MAX_BONES): more and it throws */
    maxBones?: number;
}
/** a DNC1 file read (from bytes already fetched): `name` is for its errors */
export declare function parseHero(bytes: ArrayBuffer, name?: string, maxBones?: number): Promise<HeroAsset>;
export declare function loadHero(url: string, o?: LoadHeroOpts): Promise<HeroAsset>;
//# sourceMappingURL=asset.d.ts.map