import type { Kit, Texture, RunEntry, RenderPass, V3 } from '@ericrius1/weft';
export declare const CLOUD_Y0 = 180, CLOUD_Y1 = 7200;
/** the top of the ordinary layer (the storm towers rise above it to CLOUD_Y1) */
export declare const CLOUD_LAYER = 2600;
/** the weather: how much sky is cloud, what kind, how stormy, a front sweeping through */
export interface Weather {
    /** -1 (clear) .. 0 (fair) .. 1 (overcast) */
    coverage: number;
    /** 0..1 how much the storm cells can build (cumulonimbus, anvils, lightning) */
    storm: number;
    /** cloud base (world y, m) and how much it varies */
    base: number;
    baseRange: number;
    /** a front: its direction (radians), speed (m/s) and width (m); width 0: none. It starts `lead` m upwind of the
     *  camera (a wall on the horizon, arriving at speed) */
    front: {
        angle: number;
        speed: number;
        width: number;
        lead?: number;
    };
    /** the wind (m/s, xz) the cells drift on */
    wind: [number, number];
    /** the clouds' type: -1 sheets (stratus) .. 0 mixed .. 1 heaps (cumulus) */
    type: number;
    /** cover over the open sea, as a fraction of over the land (cumulus build over the land by day) */
    sea: number;
    /** the high cirrus deck's cover */
    cirrus: number;
    /** storm cells (cumulonimbus towers with anvils, lightning inside) standing in view, and their radius (m) */
    cells: number;
    cellRadius: number;
}
export declare const WEATHER: Record<string, Weather>;
/** a storm cell: centre (drifted coordinates — they ride the wind), radius (m), strength now, where it's heading (it
 *  builds over a minute or so, and dies away when the weather no longer wants it) */
interface Cell {
    x: number;
    z: number;
    r: number;
    s: number;
    target: number;
    rate: number;
    pinned: boolean;
    id?: number;
    front?: number;
}
export declare class Clouds {
    private kit;
    private heights;
    private depth;
    params: {
        density: number;
        erosion: number;
        curl: number;
        stratusThick: number;
        cumulusThick: number;
        multiScatter: number;
        ambient: number;
        powder: number;
        silver: number;
        /** the octaves' energy (the light a thick cloud returns after many scatterings) */
        msEnergy: number;
        /** how much of the diffusion floor clouds seen from outside keep */
        diffuseOut: number;
        /** the light deep inside a cloud (diffusion's algebraic falloff, where the octaves give out) */
        diffuse: number;
        steps: number;
        lightReach: number;
        fineReach: number;
        nearStep: number;
        maxDist: number;
        wisps: number;
        evolve: number;
        healTime: number;
        ao: number;
        /** a full-strength storm tower's top (world y) */
        towerTop: number;
        /** the history: the far layer's α floor and sample cap, the near layer's */
        farAlphaMin: number;
        farCap: number;
        nearAlphaMin: number;
        nearCap: number;
        /** 0: everything in the far layer (cost breakdown) */
        nearLayer: number;
        /** the march: 'quarter' (a quarter of the pixels, interleaved over 4 frames) or 'half' (every half-res pixel) */
        marchRes: "quarter" | "half";
        /** 1 no shadow map, 2 no cone, 3 no erosion */
        debug: number;
        /** 1: the composite shows the cloud layer alone (the flicker bench) */
        layerOnly: number;
        /** 1: skip the light (cost breakdown) */
        noLight: number;
    };
    weather: Weather;
    /** the storm cells (cumulonimbus): the weather keeps `cells` of them standing 6–15 km off; a game can add its own */
    cells: Cell[];
    private target;
    private blend;
    on: boolean;
    /** the camera is under the sea: no march, no composite (the sea's underside shows the sky through its window) */
    hidden: boolean;
    get live(): boolean;
    /** the clouds' own clock (s) */
    time: number;
    /** the camera is up in or above the slab (the composite goes after the mist) */
    above: boolean;
    readonly smap: Texture;
    /** the window of the shadow map: origin x, z, size (m), reference plane height */
    readonly cloudMap: [number, number, number, number];
    private u;
    private weatherTex;
    private ground;
    private lvol;
    private towers;
    private bakeTowers;
    private twFirst;
    private twSlices;
    private twSig;
    private nextCellId;
    /** the painted look (stylized worlds): brightness mapped to three tones of a palette, crisp silhouettes */
    style: {
        on: boolean;
        lit: number;
        soft: number;
        edge: number;
        palette: [number, number, number][];
    };
    private wake;
    private wakeNext;
    private blue;
    /** the march's outputs, at quarter res (interleaved) and half (every pixel): far, its depth, near, its depth */
    private q;
    private h;
    /** the resolved layers (half res) and their meta (z̄, σ_z, scene distance, sample count); the history copies */
    private farOut;
    private farMeta;
    private farHist;
    private farMetaHist;
    private nearOut;
    private nearMeta;
    private nearHist;
    private nearMetaHist;
    private base;
    private detail;
    private noise;
    private bakeGround;
    private bakeLight;
    private lvolSlice;
    private lvolSlices;
    private bakeWeather;
    private bakeShadow;
    private bakeWake;
    private passesQ;
    private passesH;
    private copies;
    private wakeCopy;
    private probeBuf;
    private probePass;
    private probing;
    private probeD;
    /** how deep in cloud the camera is (0 clear .. 1 thick fog; eased): for the eye's adaptation, sound, gameplay */
    inside: number;
    private once;
    private wwin;
    private drift;
    private evolveT;
    private wRow;
    private wRows;
    private smapRow;
    private smapFull;
    private rows;
    private frame;
    private histVersion;
    private camVel;
    private lastCam;
    private frontPos;
    private placeFront;
    /** (the weather was set at once: new cells stand at full height straight away) */
    private instant;
    private stampList;
    private flash;
    /** the bench's reference mode: > 0 counts the frames accumulated (set 1 to start; 0 off) */
    reference: number;
    /** this frame's near/far split (m) */
    split: number;
    /** the clouds' clock state (the bench restores it to render a reference of the same instant) */
    get state(): {
        time: number;
        drift: number[];
        evolveT: number;
        frontPos: number;
        cells?: Cell[];
    };
    set state(s: {
        time: number;
        drift: number[];
        evolveT: number;
        frontPos: number;
        cells?: Cell[];
    });
    constructor(kit: Kit, heights: Texture, depth: Texture, half: number);
    /** the passes (after the env group is shared: the march reads it) */
    build(): void;
    /** the resolved clouds (half res: rgb in-scatter, a transmittance) — the shafts read it too */
    get outTex(): Texture;
    /** the full-res composite, drawn into a pass over the scene (hdr): blend one, src-alpha */
    addComposite(pass: RenderPass): void;
    /** ease the weather toward a preset (or any Weather) over `secs` */
    setWeather(w: Weather | keyof typeof WEATHER, secs?: number): void;
    /** a storm cell at world x, z (radius m, strength 0..1); `grow` 0: standing at once, else building over that many
     *  seconds */
    addCell(x: number, z: number, radius?: number, strength?: number, grow?: number): void;
    /** the cells' centres in the world (they ride the wind) */
    cellPos(c: Cell): [number, number];
    /** what the sky shaders need from the weather (games pass it on in world): the cirrus's cover, how overcast (inside
     *  a cloud too: the scene is lit by the cloud's own diffuse grey, not the open sky) */
    get sky(): {
        cloudCover: number;
        overcast: number;
    };
    private blendRate;
    private stepWeather;
    /** something flew through from a to b this frame: tear a tunnel (radius m, strength 0..1) that heals */
    stamp(a: V3, b: V3, radius: number, strength?: number): void;
    /** a lightning strike inside a cloud at p (intensity: the flash's peak radiance) */
    strike(p: V3, intensity?: number): void;
    /** the current flash (for the scene's light and the thunder): position, intensity */
    get lightning(): {
        pos: V3;
        k: number;
        next: number;
    };
    /** per frame, before the run: the uniforms, which bakes are due */
    update(dt: number, cam: V3, _cover?: number, fovY?: number): void;
    /** keep the weather's storm cells standing: build new ones 6–15 km off (upwind, so they come to you), let the ones too
     *  far behind die away */
    private updateCells;
    /** a front's line of towers: three on it, 6.5 km apart round where the camera is along it, riding with the line
     *  (moved onto it each frame); when the camera has gone far along, they're left to die and three more rise */
    private frontCells;
    /** compute before the passes: the bakes */
    bakes(): RunEntry[];
    /** after the scene's depth is complete (the water in): march + resolve + keep the history */
    render(): RunEntry[];
}
export {};
//# sourceMappingURL=clouds.d.ts.map