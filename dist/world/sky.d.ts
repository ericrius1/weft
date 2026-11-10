import type { Kit, Texture, StorageBuffer, Compute, UniformBuffer } from '@ericrius1/weft';
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
/** the look of the air over the day (atmosphere.wgsl Air; airAt makes the hour's): what a scene sets once, or a preset */
export interface AirLook {
    /** the Rayleigh scattering's lean toward sea green: 0 the earth's blue .. 1 Seven Havens' teal */
    tint: number;
    /** the dust over the low ground, times the day's own (0: clear air): how dense, its colour (single-scattering albedo:
     *  it takes the blues), and up to what height (km above the sea) it's as dense as that */
    dust: number;
    dustColor: V3;
    dustBase: number;
    /** the painted sky: the dome's brightness with the sun well up (times the air's own: 1 as the air makes it), and its
     *  lean then (rgb gain); how far off (km) the far air has gone most of the way to it, and how much of the way (0..1: at
     *  1 the far hills melt into a luminous dome, Seven Havens' desert; less keeps a highland's far ridges) */
    sky: number;
    skyTint: V3;
    farKm: number;
    farPaint: number;
    /** the sky's light on the land with the sun up (times the air's own), and its lean (lavender: the shadows go violet) */
    skyLight: number;
    shadeTint: V3;
    /** the leans toward a low sun: the twilight's (brighter, magenta toward violet), golden hour's (rose); the haze over the
     *  land at dawn (cool, lavender) and at golden hour (gold); the sky's light on the land then (lilac at dawn, cooler
     *  under the evening's gold); each 0..1 as strong as given */
    twilight: V3;
    golden: V3;
    hazeDawn: V3;
    hazeGolden: V3;
    shadeDawn: V3;
    shadeGolden: V3;
    /** the moon's sky (its light in the air and on the land) as the eye takes it */
    night: V3;
}
/** loom's own: an earth sky painted the way Seven Havens paints its own — the dome luminous and a touch toward teal over
 *  the land, its light on the land a little lavender, a golden dust low down in the afternoon, rose at golden hour, a
 *  violet twilight, a navy night */
export declare const AIR_DEFAULT: AirLook;
/** Seven Havens' (its world/daylight.ts): the teal sky of the other Boulder, its desert dust, the dome painted bright */
export declare const AIR_HAVENS: AirLook;
/** the air as the earth's, unpainted (loom before the Havens look) */
export declare const AIR_PLAIN: AirLook;
export declare const AIR_PRESETS: {
    readonly default: AirLook;
    readonly havens: AirLook;
    readonly plain: AirLook;
};
/** the air's uniform at an hour, the sun at an altitude (degrees): the painted dome brightest and leanest with the sun
 *  well up, as the air makes it once the sun is down (the twilight's own colours lifted) */
export declare function airAt(hour: number, sunAlt: number, a: AirLook): {
    tint: [number, number, number, number];
    dust: [number, number, number, number];
    paint: [number, number, number, number];
    shade: [number, number, number, number];
    haze: [number, number, number, number];
    night: [number, number, number, number];
};
export declare class Atmosphere {
    trans: Texture;
    ms: Texture;
    skyView: Texture;
    aerial: Texture;
    lighting: StorageBuffer;
    /** the air's look (AIR_DEFAULT, AIR_HAVENS, AIR_PLAIN, or a scene's own): read every frame (setHour) */
    look: AirLook;
    readonly airU: UniformBuffer<any>;
    private statics;
    private perFrame;
    private staticDone;
    /** what the static tables were built with (the air's lean and its dust: they're rebuilt once these move) */
    private builtAir;
    constructor(kit: Kit, heights: Texture);
    /** the haze setting feeds the static LUTs: rebuild them when it changes */
    invalidate(): void;
    /** the air for an hour and the sun's altitude (degrees; the Renderer's update calls it each frame): its painted sky,
     *  its leans, its dust — the static tables rebuilt once the dust or the lean has moved a few per cent */
    setHour(hour: number, sunAltDeg: number): void;
    /** this frame's atmosphere passes */
    items(): Compute<import("@ericrius1/weft").Shader<Record<string, unknown>, string>>[];
}
//# sourceMappingURL=sky.d.ts.map