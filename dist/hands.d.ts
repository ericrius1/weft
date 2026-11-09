import type { HeroAsset } from './asset.js';
/** each hand's skin given to the bones it lies along; returns how many vertices changed (no allocation per vertex:
 *  it runs as each body loads) */
export declare function fitHands(a: HeroAsset): number;
/** the fiddle's chin rest moved to the bass side of its tailpiece (its own piece of the mesh, mirrored across the
 *  fiddle's middle: the positions, the normals and the triangles' winding) */
export declare function mirrorChinRest(a: HeroAsset): number;
//# sourceMappingURL=hands.d.ts.map