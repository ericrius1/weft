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
    bones: {
        name: string;
        head: number[];
        tail: number[];
        up: number[];
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
}
export interface HeroAsset {
    header: HeroHeader;
    bones: BoneDef[];
    index: Record<string, number>;
    chains: Record<string, V3[]>;
    verts: Uint8Array<ArrayBuffer>;
    idx: Uint32Array<ArrayBuffer>;
}
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