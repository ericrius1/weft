import { Camera, orthoReversed, lookAt, mat4Mul, Taau } from '@ericrius1/weft';
import envShader from '../shaders/env.wgsl';
import skyShader from '../shaders/sky.wgsl';
import dofShader from '../shaders/dof.wgsl';
import postShader from '../shaders/post.wgsl';
import lensShader from '../shaders/lens.wgsl';
import { Ripples } from '../world/ripples';
import { TerrainShadow } from './hfshadow';
import { Clouds } from './clouds';
import { SkyClouds } from './skyclouds';
import { Cinema } from './cinema';
import { Underwater } from './underwater';
import { LightClusters } from './clusters';
import { ProbeGrid } from './probes';
/** the defaults: the opaque scene's samples a pixel, a shadow cascade's size (texels a side) */
export const MSAA = 4;
export const SHADOW_SIZE = 2048;
/** point lights kept without clustering (RendererOptions.lights) */
const MAX_LIGHTS = 32;
const BLOOM_LEVELS = 6;
/** flat stand-in maps: ground at -5000 m everywhere */
export function noTerrain(kit) {
    const heightTex = kit.texture({ label: 'terrain.none.height', format: 'r32float', size: [64, 64], mips: 'full', usage: ['sample', 'copy-dst'] });
    const flat = new Float32Array(64 * 64).fill(-5000);
    for (let l = 0; l < heightTex.mips; l++) {
        const n = Math.max(1, 64 >> l);
        kit.device.queue.writeTexture({ texture: heightTex.gpu, mipLevel: l }, flat.subarray(0, n * n), { bytesPerRow: n * 4 }, [n, n]);
    }
    const tex = (label, format) => kit.texture({ label, format, size: [4, 4], usage: ['sample', 'copy-dst'] });
    return { heightTex, normalTex: tex('terrain.none.normal', 'rgba16float'), splatTex: tex('terrain.none.splat', 'rgba8unorm'), maskTex: tex('terrain.none.mask', 'rgba8unorm') };
}
export class Renderer {
    kit;
    atmo;
    /** the opaque scene's samples a pixel (RendererOptions.msaa) */
    msaa;
    /** a shadow cascade's size, texels a side (RendererOptions.shadowSize) */
    shadowSize;
    /** the scene's colour and depth as drawn: multisampled at msaa 4; at msaa 1 the same textures as `hdr` and `depth` */
    hdrMS;
    depthMS;
    hdr;
    depth;
    sceneCopy;
    refl;
    reflDepth;
    bloom;
    shadow;
    /** wakes and splashes around the player (the env group binds its latest side) */
    ripples;
    hf;
    clouds;
    /** the sprite clouds, when the renderer was made with clouds: 'sprites' (r.clouds' source; `update` steps them) —
     *  `setSky(kind, secs)`, `ground = (x, z) => height`, and for the world uniforms `sky` and `shadowK` */
    skyClouds = null;
    cinema;
    underwater;
    /** the temporal upscaler (RendererOptions.taau), or null: r.taau.params (on, sharpen, feedback…), r.taau.cut() */
    taau = null;
    /** the clustered point lights (RendererOptions.lights), or null: r.clusters.reach */
    clusters = null;
    /** with clusters: false has the surfaces loop every light (to compare) */
    clustered = true;
    /** the irradiance probes (RendererOptions.gi), or null: r.gi.params, r.gi.setVolume(min, max, spacing) */
    gi = null;
    /** the environment's extras (envx.wgsl): the light grid's and the probes' values, set by update() */
    envx;
    /** the shared environment group (env.wgsl, group 1) */
    env;
    /** the most point lights kept (RendererOptions.lights.max) */
    maxLights;
    /** where the light grid's cells and the probes start in the point lights' buffer (64-byte records) */
    bases = [0, 0];
    cellsCopy;
    probesCopy;
    /** the opaque scene (MSAA): add draws to it */
    scene;
    /** the mirror image over the sea (half res, single sample; a mirrored camera, so draw with cull 'none') */
    reflPass;
    reflView;
    /** the sea and what's seen through it, after the opaque scene is resolved */
    water;
    /** glows, threads, particles: after the clouds and the air (single sample, depth read-only) */
    fx;
    /** a game's own work after the scene's depth is complete, before the fx pass draws (light shafts, etc.) */
    beforeFx = [];
    /** depth-only cascade passes (each with its own light view) */
    shadowPasses = [];
    shadowViews = [];
    /** compute that must land before the passes (sims…) */
    compute = [];
    post;
    postFirst;
    /** the depth resolve (MSAA only) */
    resolve = null;
    copy;
    copyMB;
    mb;
    mbU;
    cloudsBelow;
    cloudsAbove;
    bloomPasses = [];
    adapt;
    composite;
    lights;
    lightData;
    lightCount = 0;
    expo;
    cascades = [24, 90, 320];
    /** how each cascade's light view is fitted (updateShadows): its eye at least `back` m toward the light from the
     *  cascade's centre and always its bounding sphere's radius plus `reach` (casters that far past the sphere toward the
     *  light still shadow it: hills, towers, a dragon overhead); its depth to at least `far` m and always past the
     *  sphere's far side. At the default cascades this is the old fixed 600 m back, 1400 m deep; a flight game's long
     *  cascades ([40, 160, 600] m, more) push both out with their radius. */
    shadowFit = { back: 600, reach: 180, far: 1400 };
    shadowsOn = true;
    /** the sea's mirror of the scene (a night scene may not need it) */
    mirror = true;
    /** the terrain's long shadows (hfshadow): low suns over mountains */
    hfOn = true;
    /** lights further than this from the camera than their own reach are dropped (huge ones — lightning — always kept) */
    lightCull = 400;
    reflOn = true;
    /** camera motion blur: shutter (1 = a whole frame's motion), max length (px at 1080p), near mask (m) */
    motionBlur = { shutter: 0.5, maxPx: 40, near0: 1.5, near1: 4, taps: 10, her: null };
    /** depth of field: off unless on; focus (m), aperture (blur px at 1080p per unit |1 − focus/z|), max blur (px at
     *  1080p), taps; and a tilt-shift band (centre 0..1 down the frame, half width, ramp, amount 0..1) */
    dof = { on: false, focus: 30, aperture: 6, maxPx: 12, taps: 32, bandY: 0.55, band: 0.1, ramp: 0.28, tilt: 0 };
    dofU;
    copyDof;
    dofPass;
    /** the grade: … `vivid` swaps the film look (AgX, which bleaches bright colours toward white) for one that keeps a
     *  bright colour saturated — for stylized worlds */
    /** inside a cloud: the exposure lifted by (1 + lift), the vignette cut by this share */
    inCloud = { lift: 0.8, vignette: 0.7 };
    film = { exposure: 1.24, bloom: 0.22, saturation: 1.06, contrast: 1.06, vignette: 0.28, grain: 0.035, warmth: 0, bloomWide: 1.12, splitTone: 1, autoExposure: 1, vivid: false,
        /** the eye's exposure as a white card's (0..1: how much; the rest the scene's own brightness, histogram-adapted): a
         *  level white card mapped to `dayCard` on the screen by day (pre-tone-map), `nightCard` on a moonlit night — what
         *  the card's light is at noon and by such a night (`cardNoon`, `cardNight`: the lighting block's radiance) — so a
         *  painted sky or a dark wall filling the frame doesn't swing the land's brightness (Seven Havens' eye). How fast the
         *  card's place rises with the light (`cardRise`: Seven Havens' 0.14 keeps noon from being a white sheet; 0.7 keeps
         *  a green land as bright through the day) */
        card: 0.85, dayCard: 3.0, nightCard: 0.18, cardNoon: 3.7, cardNight: 0.24, cardRise: 0.7, cardRiseNight: 0.16,
        /** the painter's grade (Seven Havens'): the warm-cool split by the time of day (shadows lavender, highlights gold,
         *  most at golden hour), the reds' and golds' richness, the glow on what's bright (its strength, and the brightness
         *  on the screen it glows from), film's red halation, the dusk's magenta-violet. 0 leaves each out */
        split: 0.5, rich: 0.2, glow: 0.18, glowFrom: 0.9, halation: 0.05, dusk: 1,
        /** how much of the grass's green the grade keeps (0: the yellow-greens calmed, 0.1.15's), and the punch (Seven
         *  Havens' AgX look: a firmer curve, richer colour) */
        keepGreens: 0.7, punch: 0.3,
        /** the grade's lift (added to the shadows) and gain (the highlights' multiplier), per channel */
        lift: [0, 0, 0], gain: [1, 1, 1] };
    /** the lens after the grade (off unless on): halation (strength, radius px at 1080, threshold, warmth), chromatic
     *  aberration, barrel, sharpening, scope bars (an aspect like 2.39; 0 none) */
    lens = { on: false, halation: 0.35, halationRadius: 18, threshold: 0.62, warmth: 0.85, aberration: 1, barrel: 0.02, sharpen: 0.15, letterbox: 0 };
    /** the display-space picture the lens reads (when on) */
    ldr;
    compositeLdr;
    lensPass;
    lensU;
    constructor(kit, terrain, atmo, half, opts = {}) {
        this.kit = kit;
        this.atmo = atmo;
        const k = kit;
        const msaa = this.msaa = opts.msaa === 1 ? 1 : MSAA;
        const SZ = this.shadowSize = Math.max(256, Math.round(opts.shadowSize ?? SHADOW_SIZE));
        this.hdr = k.texture({ label: 'hdr', format: 'rgba16float', size: 'render', usage: ['render', 'sample', 'storage', 'copy-src', 'copy-dst'] });
        this.depth = k.texture({ label: 'depth', format: 'depth32float', size: 'render', usage: ['render', 'sample'] });
        this.hdrMS = msaa > 1 ? k.texture({ label: 'hdr.ms', format: 'rgba16float', size: 'render', samples: msaa }) : this.hdr;
        this.depthMS = msaa > 1 ? k.texture({ label: 'depth.ms', format: 'depth32float', size: 'render', samples: msaa, usage: ['render', 'sample'] }) : this.depth;
        this.sceneCopy = k.texture({ label: 'scene.copy', format: 'rgba16float', size: 'render', usage: ['sample', 'copy-dst'] });
        this.refl = k.texture({ label: 'refl', format: 'rgba16float', size: 'render', scale: 0.5, usage: ['render', 'sample'] });
        this.reflDepth = k.texture({ label: 'refl.depth', format: 'depth32float', size: 'render', scale: 0.5, usage: ['render'] });
        this.bloom = k.texture({ label: 'bloom', format: 'rgba16float', size: 'render', scale: 0.5, mips: BLOOM_LEVELS, usage: ['render', 'sample'] });
        this.shadow = k.texture({ label: 'shadow', format: 'depth32float', size: [SZ, SZ, 3], usage: ['render', 'sample'] });
        const clustered = opts.lights?.clustered ?? (opts.lights?.max ?? MAX_LIGHTS) > MAX_LIGHTS;
        this.maxLights = Math.max(1, Math.round(opts.lights?.max ?? (clustered ? 256 : MAX_LIGHTS)));
        this.lightData = new Float32Array(this.maxLights * 16);
        // (the point lights' buffer: the lights, then the light grid's cells, then the probes — laidOut())
        this.lights = k.storage({ label: 'pointLights', size: this.maxLights * 64 });
        this.envx = k.uniforms(envShader.structs.EnvX, 'envx');
        if (clustered)
            this.clusters = new LightClusters(k, this.lights, this.envx, { cells: opts.lights?.cells, cap: opts.lights?.cap });
        this.ripples = new Ripples(k, terrain.heightTex, half, opts.ripples);
        this.hf = new TerrainShadow(k, terrain.heightTex, half, opts.terrainShadowSize ?? 2048);
        this.clouds = new Clouds(k, terrain.heightTex, this.depth, half, { volumetric: (opts.clouds ?? 'volumetric') === 'volumetric' });
        // the environment, shared by every surface shader (group 1)
        this.env = k.shareGroup(1, envShader, {
            lighting: atmo.lighting, skyTex: atmo.skyView, aerialTex: atmo.aerial,
            heightTex: terrain.heightTex, normalTex: terrain.normalTex, splatTex: terrain.splatTex, maskTex: terrain.maskTex,
            shadowTex: this.shadow, rippleTex: this.ripples.out, hfShadowTex: this.hf.shown, cloudShadowTex: this.clouds.smap,
            plights: this.lights, envx: this.envx,
        }, 'env');
        this.clouds.build();
        // the sprite clouds in the march's place (its resources never made: clouds 'sprites' isn't volumetric)
        if (opts.clouds === 'sprites') {
            this.skyClouds = new SkyClouds(k, { hdr: this.hdr, depth: this.depth, smap: this.clouds.smap }, { half, ...opts.sky });
            this.clouds.use(this.skyClouds);
        }
        // (a shadow pass can't have the shadow map it writes bound for sampling: those passes see a 1×1 stand-in)
        const noShadow = k.texture({ label: 'shadow.none', format: 'depth32float', size: [1, 1, 3], usage: ['render', 'sample'] });
        for (let c = 0; c < 3; c++) {
            const view = k.view(new Camera(), [SZ, SZ], `shadow${c}`);
            this.shadowViews.push(view);
            this.shadowPasses.push(k.pass({ label: `shadow${c}`, depth: { target: this.shadow.layer(c), clear: 0 }, view, shared: { 1: { shadowTex: noShadow } }, enabled: () => this.shadowsOn }));
        }
        // the mirror: the camera reflected in the sea plane (user.x = 1: shaders clip what's under the water)
        this.reflView = k.view(new Camera(), 0.5, 'refl');
        this.reflView.user = [1, 0, 0, 0];
        this.reflPass = k.pass({
            label: 'reflection', view: this.reflView, enabled: () => this.reflOn,
            color: [{ target: this.refl, clear: [0, 0, 0, 0] }], depth: { target: this.reflDepth, clear: 0, store: false },
        });
        // (MSAA: into the multisampled targets, the colour resolved into hdr, the depth resolved by a pass of its own; one
        // sample: straight into hdr and depth)
        this.scene = msaa > 1 ? k.pass({
            label: 'scene',
            color: [{ target: this.hdrMS, resolve: this.hdr, clear: [0, 0, 0, 1], store: false }],
            depth: { target: this.depthMS, clear: 0 },
        }) : k.pass({ label: 'scene', color: [{ target: this.hdr, clear: [0, 0, 0, 1] }], depth: { target: this.depth, clear: 0 } });
        if (msaa > 1) {
            this.resolve = k.pass({ label: 'depth.resolve', depth: { target: this.depth, clear: 0 } });
            this.resolve.fullscreen(postShader, { label: 'depth.resolve', fragment: 'fs_depth', bind: { depthMS: this.depthMS }, depthWrite: true, depthCompare: 'always' });
        }
        if (opts.gi) {
            const g = opts.gi;
            this.gi = new ProbeGrid(k, { source: g.source ?? this.reflPass, min: g.min, max: g.max, spacing: g.spacing, face: g.face, maxPerFrame: g.maxPerFrame, ground: g.ground, skip: g.skip });
            this.gi.onResize = () => this.laidOut();
        }
        this.laidOut();
        // (the grid's cells and the probes into the point lights' buffer each frame, after they're made)
        this.cellsCopy = k.raw((enc) => {
            const c = this.clusters;
            if (c)
                enc.copyBufferToBuffer(c.buffer.gpu, 0, this.lights.gpu, this.bases[0] * 64, c.records * 64);
        }, 'lights.cells');
        this.probesCopy = k.raw((enc) => {
            const g = this.gi;
            if (g && g.params.on)
                enc.copyBufferToBuffer(g.probes.gpu, 0, this.lights.gpu, this.bases[1] * 64, g.count * 64);
        }, 'gi.store');
        this.copy = k.copy(this.hdr, this.sceneCopy, 'scene.copy');
        this.water = k.pass({ label: 'water', color: [{ target: this.hdr, clear: false }], depth: { target: this.depth, readOnly: true } });
        // (the shafts are cut by the clouds: the march's output, or the sprite clouds' cover)
        this.cinema = new Cinema(k, this.depth, this.hdr, this.skyClouds?.cover ?? this.clouds.outTex);
        this.cloudsBelow = k.pass({ label: 'clouds.below', color: [{ target: this.hdr, clear: false }], enabled: () => this.clouds.live && !this.clouds.above });
        this.cloudsAbove = k.pass({ label: 'clouds.above', color: [{ target: this.hdr, clear: false }], enabled: () => this.clouds.live && this.clouds.above });
        this.clouds.addComposite(this.cloudsBelow);
        this.clouds.addComposite(this.cloudsAbove);
        this.underwater = new Underwater(k, this.depth, this.hdr, this.sceneCopy);
        this.fx = k.pass({ label: 'fx', color: [{ target: this.hdr, clear: false }], depth: { target: this.depth, readOnly: true } });
        // post: exposure state, the bloom chain, eye adaptation, motion blur, the grade
        this.expo = k.storage({ label: 'exposure', size: 16, usage: ['storage', 'copy-dst', 'copy-src'] });
        this.post = k.uniforms(postShader.structs.Post, 'post');
        this.postFirst = k.uniforms(postShader.structs.Post, 'post.first');
        k.overlay.tweak(this.post, 'post');
        this.mbU = k.uniforms(postShader.structs.MB, 'motionBlur');
        this.copyMB = k.copy(this.hdr, this.sceneCopy, 'mb.copy');
        this.mb = k.compute(postShader, { label: 'motionBlur', entry: 'blur', bind: { mb: this.mbU, mbSrc: this.sceneCopy, mbDepth: this.depth, mbOut: this.hdr }, threads: () => [this.hdr.width, this.hdr.height] });
        this.dofU = k.uniforms(dofShader.structs.Dof, 'dof');
        this.copyDof = k.copy(this.hdr, this.sceneCopy, 'dof.copy');
        this.dofPass = k.compute(dofShader, { label: 'dof', entry: 'gather', bind: { dof: this.dofU, dofSrc: this.sceneCopy, dofDepth: this.depth, dofOut: this.hdr }, threads: () => [this.hdr.width, this.hdr.height] });
        // (the temporal upscale: what follows — bloom, the grade, the lens — reads its output, at the canvas's size)
        if (opts.taau)
            this.taau = new Taau(k, this.hdr, this.depth, { velocity: typeof opts.taau === 'object' ? opts.taau.velocity : undefined });
        const graded = this.taau ? this.taau.out : this.hdr;
        for (let i = 0; i < BLOOM_LEVELS; i++) {
            const p = k.pass({ label: `bloom.down${i}`, color: [{ target: this.bloom.mip(i), clear: [0, 0, 0, 1] }] });
            p.fullscreen(postShader, { fragment: 'fs_down', bind: { src: i === 0 ? graded : this.bloom.mip(i - 1), P: i === 0 ? this.postFirst : this.post, expo: this.expo } });
            this.bloomPasses.push(p);
        }
        this.adapt = k.compute(postShader, { label: 'adapt', entry: 'adapt', bind: { P: this.post, lumSrc: this.bloom.mip(4), expoOut: this.expo, litIn: atmo.lighting }, workgroups: [1] });
        for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
            const p = k.pass({ label: `bloom.up${i}`, color: [{ target: this.bloom.mip(i), clear: false }] });
            p.fullscreen(postShader, { fragment: 'fs_up', blend: 'add', bind: { src: this.bloom.mip(i + 1), P: this.post } });
            this.bloomPasses.push(p);
        }
        this.composite = k.pass({ label: 'composite', color: [{ target: 'screen', clear: [0, 0, 0, 1] }] });
        this.composite.fullscreen(postShader, { fragment: 'fs_composite', bind: { src: graded, bloomTex: this.bloom.mip(0), P: this.post, expo: this.expo } });
        // (with the lens on: the grade into a display-space target, the lens from it to the screen)
        this.ldr = k.texture({ label: 'ldr', format: 'rgba16float', size: this.taau ? 'canvas' : 'render', usage: ['render', 'sample'] });
        this.compositeLdr = k.pass({ label: 'composite.ldr', color: [{ target: this.ldr, clear: [0, 0, 0, 1] }] });
        this.compositeLdr.fullscreen(postShader, { fragment: 'fs_composite', bind: { src: graded, bloomTex: this.bloom.mip(0), P: this.post, expo: this.expo } });
        this.lensU = k.uniforms(lensShader.structs.Lens, 'lens');
        this.lensPass = k.pass({ label: 'lens', color: [{ target: 'screen', clear: [0, 0, 0, 1] }] });
        this.lensPass.fullscreen(lensShader, { fragment: 'fs_lens', bind: { LN: this.lensU, lensSrc: this.ldr } });
    }
    // (the point lights' buffer laid out: the lights, the cells, the probes; grown to hold them)
    laidOut() {
        const cells = this.maxLights, probes = cells + (this.clusters?.records ?? 0);
        this.bases = [cells, probes];
        this.lights.ensure((probes + (this.gi?.count ?? 0)) * 64);
    }
    /** the sky goes last in the opaque passes, where nothing wrote depth (a game's own sky shader, or loom's) */
    addSky(shader = skyShader, bind = {}) {
        this.scene.fullscreen(shader, { label: 'sky', depthCompare: 'equal', bind });
        this.reflPass.fullscreen(shader, { label: 'sky.refl', depthCompare: 'equal', bind });
    }
    /** small point lights (fallen stars, lamps, blooms): the nearest `maxLights` to the camera are kept (clustered: in
     *  that order, so a crowded cell of the grid keeps its nearest) */
    setPointLights(list, cam) {
        // (the ones whose light can reach anywhere near the camera; then the nearest maxLights)
        const near = list.filter((l) => l.radius > 1000 || Math.sqrt(dist2(l.pos, cam)) - l.radius < this.lightCull);
        const max = this.maxLights;
        const sorted = near.length > max || (this.clusters && near.length > 1) ? [...near].sort((a, b) => dist2(a.pos, cam) - dist2(b.pos, cam)).slice(0, max) : near;
        this.lightData.fill(0);
        sorted.forEach((l, i) => this.lightData.set([...l.pos, l.radius, ...l.color, l.size ?? 0.3, ...(l.dir ?? [0, -1, 0]), l.dir ? Math.cos(l.outer ?? 0.6) : -2, l.dir ? Math.cos(l.inner ?? 0.35) : -2, l.owner ?? 0, l.squash ?? 1, l.haze ?? 1], i * 16));
        this.lights.write(this.lightData.subarray(0, Math.max(1, sorted.length) * 16));
        this.lightCount = sorted.length;
        this.clusters?.update(cam, sorted.length);
    }
    /** fit the three cascades around the camera's view for a key light direction (each a sphere round its stretch of the
     *  view, the light's eye and depth from its radius: shadowFit), texel-snapped so they don't crawl */
    updateShadows(cam, light) {
        const near = [0, ...this.cascades];
        const mats = [];
        const F = this.shadowFit;
        for (let c = 0; c < 3; c++) {
            const d0 = near[c], d1 = near[c + 1];
            const mid = (d0 + d1) / 2;
            const f = cam.forward;
            const centre = [cam.position[0] + f[0] * mid, cam.position[1] + f[1] * mid, cam.position[2] + f[2] * mid];
            const tanH = Math.tan(cam.fovY / 2) * Math.max(1, cam.aspect);
            const r = Math.hypot((d1 - d0) / 2, d1 * tanH * 1.2);
            // (the eye far enough back that casters `reach` past the sphere are in front of it; the depth past its far side)
            const back = Math.max(F.back, r + F.reach);
            const far = Math.max(F.far, back + r + 50);
            const view = lookAt([centre[0] + light[0] * back, centre[1] + light[1] * back, centre[2] + light[2] * back], centre, Math.abs(light[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0]);
            const texel = (2 * r) / this.shadowSize;
            view[12] = Math.round(view[12] / texel) * texel;
            view[13] = Math.round(view[13] / texel) * texel;
            const proj = orthoReversed(-r, r, -r, r, 1, far);
            mats.push(mat4Mul(proj, view));
            const sc = this.shadowViews[c].camera;
            sc.viewOverride = view;
            sc.ortho = { halfWidth: r, halfHeight: r };
            sc.near = 1;
            sc.far = far;
        }
        return mats;
    }
    /** the mirrored camera for the sea's reflection (call after the main camera has been updated) */
    updateReflection(cam, seaLevel) {
        const rc = this.reflView.camera;
        // view * mirror(y = seaLevel)
        const m = new Float32Array(cam.view);
        // a point p maps to (px, 2s - py, pz): the view's y column flips and its translation picks up 2s * y column
        const yc = [m[4], m[5], m[6]];
        m[4] = -yc[0];
        m[5] = -yc[1];
        m[6] = -yc[2];
        m[12] += 2 * seaLevel * yc[0];
        m[13] += 2 * seaLevel * yc[1];
        m[14] += 2 * seaLevel * yc[2];
        rc.viewOverride = m;
        rc.fovY = cam.fovY;
        rc.near = cam.near;
        rc.far = cam.far;
        this.reflOn = this.mirror && cam.position[1] > seaLevel + 0.05;
    }
    /** per frame: post, motion blur, the cinema's and the clouds' uniforms */
    update(o) {
        const f = this.film;
        // (the air's look for the hour: the sun's altitude from its own direction, else from the key light by day)
        const sunY = o.sun ? o.sun[1] : o.night < 0.5 ? o.light[1] : -0.3;
        this.atmo.setHour(o.hour, Math.asin(Math.max(-1, Math.min(1, sunY))) * 180 / Math.PI);
        let norm = 0;
        for (let i = 0; i < BLOOM_LEVELS; i++)
            norm += f.bloomWide ** i;
        const p = {
            // (inside a cloud: brighter — the eye's adaptation alone would pull the glowing white fog down to a dull grey — and
            // no vignette darkening its edges)
            exposure: f.exposure * (1 + this.inCloud.lift * this.clouds.inside), bloom: f.bloom * (1 + 0.6 * o.night), bloomThreshold: 0, saturation: f.saturation, contrast: f.contrast,
            warmth: f.warmth, vignette: f.vignette * (1 - this.inCloud.vignette * this.clouds.inside), grain: f.grain, time: o.time, autoExposure: f.autoExposure, first: 0, card: f.card,
            lift: [f.lift[0], f.lift[1], f.lift[2], o.night], gain: [f.gain[0], f.gain[1], f.gain[2], 1], look: [f.vivid ? 0 : 1, f.bloomWide, 1 / norm, f.splitTone], uw: [o.under * 0.6, o.under * 0.5, o.under * 0.3, o.under],
            ex: [f.dayCard, f.nightCard, f.cardNoon, f.cardNight], ex2: [f.cardRise, f.cardRiseNight, 0, 0], hv: [f.split, f.rich, f.glow, f.glowFrom], hv2: [f.halation, f.dusk, f.keepGreens, f.punch],
        };
        this.post.set(p);
        this.postFirst.set({ ...p, first: 1 });
        const m = this.motionBlur, h = this.hdr.height, her = m.her ?? [0, 0, 0, 0, 0, 0];
        this.mbU.set({ a: [m.shutter, m.maxPx * h / 1080, m.near0, m.near1], her: [her[0], her[1], her[2], her[3]], herV: [her[4], her[5], m.taps, 0] });
        const D = this.dof;
        if (D.on)
            this.dofU.set({ a: [D.focus, D.aperture * h / 1080, Math.max(1, D.maxPx * h / 1080), D.taps], t: [D.bandY, D.band, D.ramp, D.tilt] });
        const Ln = this.lens;
        if (Ln.on)
            this.lensU.set({ a: [Ln.halation, Ln.halationRadius, Ln.threshold, Ln.aberration], b: [Ln.barrel, Ln.letterbox, Ln.sharpen, o.time], c: [this.ldr.width, this.ldr.height, 1 / this.ldr.width, 1 / this.ldr.height], d: [Ln.warmth, 0, 0, 0] });
        this.cinema.hour = o.hour;
        this.cinema.under = o.under > 0.5;
        this.cinema.update(o.time, o.cam, o.light, o.night, this.hdr.height, o.seaLevel, this.clouds.live || (!!this.skyClouds && !this.clouds.hidden));
        this.clouds.hidden = o.cam.position[1] < o.seaLevel - 0.3;
        this.skyClouds?.update(o.dt, o.cam.position, { night: o.night, light: o.light });
        this.clouds.update(o.dt, o.cam.position, o.cover, o.cam.fovY);
        this.underwater.update(o.time, o.dt, o.cam.position[1], o.seaLevel);
        // (the light grid's and the probes' values for the shaders)
        this.gi?.follow(o.cam.position);
        const ex = { grid: [0, 0, 0, 0], giN: [2, 2, 2, 0], bases: [this.bases[0], this.bases[1], this.clusters?.perCell ?? 1, 0] };
        if (this.clusters)
            Object.assign(ex, this.clusters.envx(this.clustered));
        if (this.gi)
            Object.assign(ex, this.gi.envx());
        this.envx.set(ex);
    }
    items(light) {
        return [
            ...this.ripples.items(), ...(this.hfOn ? this.hf.items(light) : []), ...this.clouds.bakes(), ...this.compute,
            ...(this.clusters ? [...this.clusters.items, this.cellsCopy] : []), ...this.shadowPasses, ...(this.gi ? [...this.gi.items, this.probesCopy] : []), this.reflPass, this.scene, this.resolve, ...this.cinema.aoItems, this.copy, this.water,
            ...this.clouds.render(), this.cloudsBelow, ...this.cinema.airItems, this.cloudsAbove, ...this.underwater.items, ...this.beforeFx, this.fx,
            this.motionBlur.shutter > 0 ? this.copyMB : null, this.motionBlur.shutter > 0 ? this.mb : null,
            this.dof.on ? this.copyDof : null, this.dof.on ? this.dofPass : null,
            ...(this.taau?.items ?? []),
            ...this.bloomPasses.slice(0, BLOOM_LEVELS), this.adapt, ...this.bloomPasses.slice(BLOOM_LEVELS),
            ...(this.lens.on ? [this.compositeLdr, this.lensPass] : [this.composite]),
        ];
    }
}
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
//# sourceMappingURL=renderer.js.map