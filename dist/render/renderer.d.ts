import type { Kit, Texture, RenderPass, RunEntry, View, UniformBuffer, StorageBuffer, V3 } from '@ericrius1/weft';
import { Camera } from '@ericrius1/weft';
import type { Atmosphere } from '../world/sky';
import { Ripples } from '../world/ripples';
import { TerrainShadow } from './hfshadow';
import { Clouds } from './clouds';
import { Cinema } from './cinema';
import { Underwater } from './underwater';
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
export declare class Renderer {
    private kit;
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
    constructor(kit: Kit, terrain: TerrainMaps, atmo: Atmosphere, half: number);
    /** the sky goes last in the opaque passes, where nothing wrote depth (a game's own sky shader, or loom's) */
    addSky(shader?: any, bind?: Record<string, unknown>): void;
    /** small point lights (fallen stars, lamps, blooms): the nearest MAX_LIGHTS to the camera are kept */
    setPointLights(list: PointLight[], cam: ArrayLike<number>): void;
    /** fit the three cascades around the camera's view for a key light direction */
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