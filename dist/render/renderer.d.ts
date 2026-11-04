import type { Kit, Texture, RenderPass, RunEntry, View, UniformBuffer, StorageBuffer, V3 } from '@ericrius1/weft';
import { Camera } from '@ericrius1/weft';
import type { Atmosphere } from '../world/sky';
import { Ripples, type RippleOptions } from '../world/ripples';
import { TerrainShadow } from './hfshadow';
import { Clouds } from './clouds';
import { Cinema } from './cinema';
import { Underwater } from './underwater';
/** the defaults: the opaque scene's samples a pixel, a shadow cascade's size (texels a side) */
export declare const MSAA = 4;
export declare const SHADOW_SIZE = 2048;
/** a point light, or a spot when it has a direction and a cone (half-angles, radians: full within `inner`, nothing
 *  past `outer`) */
export interface PointLight {
    pos: V3;
    radius: number;
    color: V3;
    size?: number;
    dir?: V3;
    inner?: number;
    outer?: number;
    owner?: number;
    /** a spot's flattening up and down (1 round; 3: a headlamp's fan) */
    squash?: number;
    /** how much it shows in the air (the light-shaft pass): 1 fully */
    haze?: number;
}
/** the ground under the world: the maps env.wgsl reads (heights with mips, normals, splat, masks). A world with no
 *  land passes none: flat stand-ins far under the sea. */
export interface TerrainMaps {
    heightTex: Texture;
    normalTex: Texture;
    splatTex: Texture;
    maskTex: Texture;
}
/** flat stand-in maps: ground at -5000 m everywhere */
export declare function noTerrain(kit: Kit): TerrainMaps;
/** what's fixed when the renderer is made (each optional: the defaults are the desktop's) — see quality.ts
 *  `rendererOptions(quality)` for a profile's */
export interface RendererOptions {
    /** the opaque scene's samples a pixel: 4 (MSAA, resolved: the default) or 1 (a phone's: the scene draws straight
     *  into `hdr` and `depth`, no multisampled targets and no depth resolve; an `alphaToCoverage` draw is drawn without
     *  it — a shader declaring `override ALPHA_TO_COVERAGE: bool` is told which, to cut out by alpha instead) */
    msaa?: 1 | 4;
    /** the clouds: loom's volumetric ones (the default), or 'none' — never made, for a game that brings its own
     *  (r.clouds.use(source)) or wants a clear sky */
    clouds?: 'volumetric' | 'none';
    /** each of the three shadow cascades' size, texels a side (default SHADOW_SIZE, 2048) */
    shadowSize?: number;
    /** the terrain's long shadow (hfshadow) over the whole map, texels a side (default 2048) */
    terrainShadowSize?: number;
    /** the ripple window: cells across, metres a cell (default 256 at 0.22 m; `ripples.configure` changes it later) */
    ripples?: RippleOptions;
}
export declare class Renderer {
    private kit;
    /** the opaque scene's samples a pixel (RendererOptions.msaa) */
    readonly msaa: 1 | 4;
    /** a shadow cascade's size, texels a side (RendererOptions.shadowSize) */
    readonly shadowSize: number;
    /** the scene's colour and depth as drawn: multisampled at msaa 4; at msaa 1 the same textures as `hdr` and `depth` */
    hdrMS: Texture;
    depthMS: Texture;
    hdr: Texture;
    depth: Texture;
    sceneCopy: Texture;
    refl: Texture;
    reflDepth: Texture;
    bloom: Texture;
    shadow: Texture;
    /** wakes and splashes around the player (the env group binds its latest side) */
    ripples: Ripples;
    hf: TerrainShadow;
    clouds: Clouds;
    cinema: Cinema;
    underwater: Underwater;
    /** the opaque scene (MSAA): add draws to it */
    scene: RenderPass;
    /** the mirror image over the sea (half res, single sample; a mirrored camera, so draw with cull 'none') */
    reflPass: RenderPass;
    reflView: View;
    /** the sea and what's seen through it, after the opaque scene is resolved */
    water: RenderPass;
    /** glows, threads, particles: after the clouds and the air (single sample, depth read-only) */
    fx: RenderPass;
    /** a game's own work after the scene's depth is complete, before the fx pass draws (light shafts, etc.) */
    beforeFx: RunEntry[];
    /** depth-only cascade passes (each with its own light view) */
    shadowPasses: RenderPass[];
    shadowViews: View[];
    /** compute that must land before the passes (sims…) */
    compute: RunEntry[];
    post: UniformBuffer<any>;
    private postFirst;
    /** the depth resolve (MSAA only) */
    private resolve;
    private copy;
    private copyMB;
    private mb;
    mbU: UniformBuffer<any>;
    private cloudsBelow;
    private cloudsAbove;
    private bloomPasses;
    private adapt;
    private composite;
    private lights;
    private lightData;
    lightCount: number;
    expo: StorageBuffer;
    cascades: number[];
    /** how each cascade's light view is fitted (updateShadows): its eye at least `back` m toward the light from the
     *  cascade's centre and always its bounding sphere's radius plus `reach` (casters that far past the sphere toward the
     *  light still shadow it: hills, towers, a dragon overhead); its depth to at least `far` m and always past the
     *  sphere's far side. At the default cascades this is the old fixed 600 m back, 1400 m deep; a flight game's long
     *  cascades ([40, 160, 600] m, more) push both out with their radius. */
    shadowFit: {
        back: number;
        reach: number;
        far: number;
    };
    shadowsOn: boolean;
    /** the sea's mirror of the scene (a night scene may not need it) */
    mirror: boolean;
    /** the terrain's long shadows (hfshadow): low suns over mountains */
    hfOn: boolean;
    /** lights further than this from the camera than their own reach are dropped (huge ones — lightning — always kept) */
    lightCull: number;
    reflOn: boolean;
    /** camera motion blur: shutter (1 = a whole frame's motion), max length (px at 1080p), near mask (m) */
    motionBlur: {
        shutter: number;
        maxPx: number;
        near0: number;
        near1: number;
        taps: number;
        her: null | number[];
    };
    /** depth of field: off unless on; focus (m), aperture (blur px at 1080p per unit |1 − focus/z|), max blur (px at
     *  1080p), taps; and a tilt-shift band (centre 0..1 down the frame, half width, ramp, amount 0..1) */
    dof: {
        on: boolean;
        focus: number;
        aperture: number;
        maxPx: number;
        taps: number;
        bandY: number;
        band: number;
        ramp: number;
        tilt: number;
    };
    dofU: UniformBuffer<any>;
    private copyDof;
    private dofPass;
    /** the grade: … `vivid` swaps the film look (AgX, which bleaches bright colours toward white) for one that keeps a
     *  bright colour saturated — for stylized worlds */
    /** inside a cloud: the exposure lifted by (1 + lift), the vignette cut by this share */
    inCloud: {
        lift: number;
        vignette: number;
    };
    film: {
        exposure: number;
        bloom: number;
        saturation: number;
        contrast: number;
        vignette: number;
        grain: number;
        warmth: number;
        bloomWide: number;
        splitTone: number;
        autoExposure: number;
        vivid: boolean;
        /** the grade's lift (added to the shadows) and gain (the highlights' multiplier), per channel */
        lift: V3;
        gain: V3;
    };
    /** the lens after the grade (off unless on): halation (strength, radius px at 1080, threshold, warmth), chromatic
     *  aberration, barrel, sharpening, scope bars (an aspect like 2.39; 0 none) */
    lens: {
        on: boolean;
        halation: number;
        halationRadius: number;
        threshold: number;
        warmth: number;
        aberration: number;
        barrel: number;
        sharpen: number;
        letterbox: number;
    };
    /** the display-space picture the lens reads (when on) */
    ldr: Texture;
    private compositeLdr;
    private lensPass;
    lensU: UniformBuffer<any>;
    constructor(kit: Kit, terrain: TerrainMaps, atmo: Atmosphere, half: number, opts?: RendererOptions);
    /** the sky goes last in the opaque passes, where nothing wrote depth (a game's own sky shader, or loom's) */
    addSky(shader?: any, bind?: Record<string, unknown>): void;
    /** small point lights (fallen stars, lamps, blooms): the nearest MAX_LIGHTS to the camera are kept */
    setPointLights(list: PointLight[], cam: ArrayLike<number>): void;
    /** fit the three cascades around the camera's view for a key light direction (each a sphere round its stretch of the
     *  view, the light's eye and depth from its radius: shadowFit), texel-snapped so they don't crawl */
    updateShadows(cam: Camera, light: V3): Float32Array<ArrayBufferLike>[];
    /** the mirrored camera for the sea's reflection (call after the main camera has been updated) */
    updateReflection(cam: Camera, seaLevel: number): void;
    /** per frame: post, motion blur, the cinema's and the clouds' uniforms */
    update(o: {
        time: number;
        dt: number;
        cam: Camera;
        light: V3;
        night: number;
        hour: number;
        seaLevel: number;
        cover: number;
        under: number;
    }): void;
    items(light: V3): RunEntry[];
}
//# sourceMappingURL=renderer.d.ts.map