import type { Kit, Texture, StorageBuffer, Compute } from '@ericrius1/weft';
import { type V3 } from '@ericrius1/weft';
export interface Celestial {
    sunDir: V3;
    moonDir: V3;
    lightDir: V3;
    pole: V3;
    nightness: number;
    dayLight: number;
    starRot: number;
    moonPhase: number;
}
/** sun / moon for local solar time `hour` on day-of-year `doy` at latitude `latDeg`; world -z points `northOffset` rad
 *  east of north (from waterbending's src/world/sky.ts) */
export declare function celestial(hour: number, doy: number, latDeg: number, northOffset: number, moonPhase?: number): Celestial;
export declare class Atmosphere {
    trans: Texture;
    ms: Texture;
    skyView: Texture;
    aerial: Texture;
    lighting: StorageBuffer;
    private statics;
    private perFrame;
    private staticDone;
    constructor(kit: Kit, heights: Texture);
    /** the haze setting feeds the static LUTs: rebuild them when it changes */
    invalidate(): void;
    /** this frame's atmosphere passes */
    items(): Compute<import("@ericrius1/weft").Shader<Record<string, unknown>, string>>[];
}
//# sourceMappingURL=sky.d.ts.map