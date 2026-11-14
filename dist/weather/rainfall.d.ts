import type { Kit, RunEntry, Shader, Texture, UniformBuffer, V3 } from '@ericrius1/weft';
/** the weather it reads: rain 0..1, cloud cover 0..1, wind (m/s) and the way it blows toward ([x, z], unit) */
export interface RainWeather {
    rain: number;
    cloud: number;
    wind: number;
    windDir: ArrayLike<number>; /** the share falling as snow (0..1): absent, rain */
    snowing?: number; /** the ground under the eye (world y, m): the cloud base is over it (absent: 0, a world at the sea) */
    ground?: number;
}
/** the default shader's light (loom/rainfall_lit): linear rgb, as the scene's */
export interface RainLight {
    /** the sky's light on an upward face */
    sky: V3;
    /** the key light (sun or moon) through the cloud, and the way toward it */
    key: V3;
    dir: V3;
    /** lamps' warm glow on the drops near the ground (night), and how high it reaches (m) */
    lamps: V3;
    lampReach: number;
    /** the ground under the eye (world y): the splashes land on it, no drop is drawn below it */
    ground: number;
}
export interface RainfallOptions {
    /** the share of the drops a device draws (a phone fewer); 1 */
    scale?: number;
    /** the world's own shader (defines rainLight, rainVeil, rainGround; includes loom/rainfall); loom/rainfall_lit */
    shader?: Shader<any, any>;
    /** more bindings for the world's own shader (its group 2 past bindings 0 and 1) */
    bind?: Record<string, unknown>;
}
export declare class Rainfall {
    readonly kit: Kit;
    private opts;
    readonly u: UniformBuffer<any>;
    /** the default shader's light: set it each frame (unused with a world's own shader) */
    light: RainLight;
    /** what's drawn now: the shares of drops and splashes, the veil's extinction */
    readonly shares: {
        rain: number;
        splash: number;
        veil: number;
    };
    /** the top of the fall (world y): the cloud base */
    top: number;
    readonly shader: Shader<any, any>;
    private lit;
    private fall;
    private time;
    private pass;
    private scale;
    constructor(kit: Kit, opts?: RainfallOptions);
    /** its pass over `hdr` (cleared: no; drawn premultiplied), reading the scene's distance along the view (`sceneZ`:
     *  r32float metres, large for the sky) */
    attach(hdr: Texture, sceneZ: Texture): void;
    /** the pass, while anything falls (none at all while it's dry) */
    passes(): RunEntry[];
    /** a frame on: `under` (the eye under water) stops it */
    update(dt: number, w: RainWeather, under?: boolean): void;
}
//# sourceMappingURL=rainfall.d.ts.map