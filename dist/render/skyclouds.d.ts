import type { Kit, RunEntry, Texture, UniformBuffer, V3 } from '@ericrius1/weft';
import type { CloudSource } from './clouds';
import { type SkyKind, type SkyRecipe } from './skies';
export { SKY_KINDS, HIGHLAND, skyRecipe, type SkyKind, type SkyRecipe, type LayerSpec } from './skies';
/** what's fixed when the clouds are made (each optional: the desktop's defaults; `phone` a phone's) */
export interface SkyCloudOptions {
    /** a phone's economies: nearer ranges and levels of detail, fewer sprites, a smaller shadow less often, plainer decks */
    phone?: boolean;
    /** how far the heaps reach round the camera (m: 16000, a phone 10000); the towers' coarser grid (40000 / 26000) */
    range?: number;
    towerRange?: number;
    /** far off, a cloud keeps only its biggest puffs: the distances' scale (1, a phone 0.6) */
    lod?: number;
    /** the most sprites drawn (14000 / 6000) */
    spriteCap?: number;
    /** the shadow target, texels a side (512 / 256: upsampled into loom's map), redrawn every this many frames (2 / 3) */
    shadowPx?: number;
    shadowEvery?: number;
    /** the decks' fine detail and relief (true / false) */
    deckRich?: boolean;
    /** the clouds' shadows' strength on the ground (0.85): `shadowK`, once the map is first written */
    shadows?: number;
    /** the terrain's height at a point (lifting heaps over ridges, finding the peaks the caps stand over) and the world's
     *  half size (m) it's sampled over — settable later: `ground` */
    ground?: ((x: number, z: number) => number) | null;
    half?: number;
    /** another sky: the cells' hash, and a kind's variation (Boulder's days) */
    seed?: number;
    /** the sky to begin with ('highland') */
    sky?: SkyKind | SkyRecipe;
}
export interface SkyCloudSettings {
    enabled: boolean;
    /** how firmly painted (0 Boulder's soft photographic heaps .. 1 a gouache cumulus's firm edge and two tones); null:
     *  the sky's own (its recipe's `paint`) */
    paint: number | null;
    /** the clouds' clock's rate (1 real time) */
    speed: number;
}
/** where the clouds draw: the renderer's scene colour and depth, and loom's cloud shadow map */
export interface SkyCloudTargets {
    hdr: Texture;
    depth: Texture;
    smap: Texture;
}
export declare class SkyClouds implements CloudSource {
    readonly kit: Kit;
    settings: SkyCloudSettings;
    /** how far the eye is inside cloud this frame (0 clear .. 1 lost in it): loom's exposure lift, a game's sound */
    inside: number;
    readonly noise: Texture;
    readonly u: UniformBuffer<any>;
    /** what the clouds over the scene let through, per pixel (a: the transmittance) — loom's sun shafts are cut by it as by
     *  the volumetric clouds' own */
    readonly cover: Texture;
    private heapInside;
    private shadowTex;
    private puffBuf;
    private cap;
    private data;
    private sorted;
    private bucket;
    private counts;
    private order;
    private n;
    private listed;
    private pass;
    private shadowPass;
    private toLoom;
    private bake;
    private baked;
    private shadowTick;
    private shadowRuns;
    private ceiling;
    private half;
    private t;
    /** the real seconds the clouds have run (the skies' fades) */
    private clock;
    private seed;
    private skies;
    private nextKey;
    private overcast;
    private layersOn;
    private o;
    constructor(kit: Kit, t: SkyCloudTargets, opts?: SkyCloudOptions);
    /** the terrain's height at a point (null: none — the heaps keep their bases, the caps that stand over peaks have
     *  none to stand over). Setting it rebuilds the sky round the camera. */
    set ground(fn: ((x: number, z: number) => number) | null);
    /** the sky there is now (the one coming in) */
    get recipe(): SkyRecipe;
    /** ease to another sky over `secs` (0: at once) — a kind (Boulder's, varied by `seed`; 'highland') or a recipe:
     *  its clouds form as the old ones thin away, its decks thicken in as theirs break up */
    setSky(sky: SkyKind | SkyRecipe, secs?: number, seed?: number): void;
    /** a sky's share of the frame: the one coming in rises from 0, the ones going out fall from where they were */
    private weight;
    /** the shadows' strength for loom's world (misc.y): none until our map is first written */
    get shadowK(): number;
    /** loom's sky values (a game passes them on in its world): loom's cirrus's cover (world.cloudCover), how overcast it
     *  is overhead (world.sky.x: the sky's light from the decks' grey undersides; in a heap, its grey) */
    get sky(): {
        cloudCover: number;
        overcast: number;
    };
    /** a count for a debug hook */
    debug(): {
        sprites: number;
        cap: number;
        skies: number;
        cells: number;
        towers: number;
        lenses: number;
        inside: number;
        overcast: number;
        shadowRuns: number;
    };
    /** before the scene: the noise (once, until its pipeline exists) and the shadow map (every few frames) */
    bakes(): RunEntry[];
    render(): RunEntry[];
    /** per frame, before loom's update (the renderer calls it when it made these): the clouds' clock and drift, the
     *  sprites round the camera, the decks, the uniforms */
    update(dt: number, cam: V3, o: {
        night: number;
        light: V3;
    }): void;
    /** the decks of the sky coming in (slots 0–3) and of the strongest going out (4–7), each faded by its sky's share; which
     *  sides of the puffs they're drawn on; how overcast it is overhead and how far the eye is in a deck */
    private fillLayers;
    /** a slot's life now: 0 before it forms .. 1 grown .. 0 gone, and its generation */
    private life;
    /** a fair cell's slots: cumulus and wisps, more of them in patches (a slow field leaves stretches of open sky) */
    private slots;
    /** the cloud a slot holds in its generation `g` (null: none this time — the ground turned it away) */
    private make;
    /** the lenticular caps: over the highest peaks (still, whatever the wind; their long axis across it, a little downwind
     *  of the summit where the wave stands), or Boulder's wave train upwind of the origin (kilometres long, in stacks) */
    private buildLenses;
    private list;
    /** the eye in the heaps: each puff it's within reach of (where its sprite fades as the lens comes up to it, from 1.45
     *  radii in) adds its share, the more the deeper in, none under a cloud's flat base; the puffs where the wind has
     *  carried them since they were listed, as the shaders have them */
    private insideHeaps;
}
//# sourceMappingURL=skyclouds.d.ts.map