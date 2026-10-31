import { Camera, orthoReversed, lookAt, mat4Mul } from '@ericrius1/weft';
import envShader from '../shaders/env.wgsl';
import skyShader from '../shaders/sky.wgsl';
import dofShader from '../shaders/dof.wgsl';
import postShader from '../shaders/post.wgsl';
import lensShader from '../shaders/lens.wgsl';
import { Ripples } from '../world/ripples';
import { TerrainShadow } from './hfshadow';
import { Clouds } from './clouds';
import { Cinema } from './cinema';
import { Underwater } from './underwater';
export const MSAA = 4;
export const SHADOW_SIZE = 2048;
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
    cinema;
    underwater;
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
    resolve;
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
    lightData = new Float32Array(MAX_LIGHTS * 16);
    lightCount = 0;
    expo;
    cascades = [24, 90, 320];
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
    constructor(kit, terrain, atmo, half) {
        this.kit = kit;
        const k = kit;
        this.hdrMS = k.texture({ label: 'hdr.ms', format: 'rgba16float', size: 'render', samples: MSAA });
        this.depthMS = k.texture({ label: 'depth.ms', format: 'depth32float', size: 'render', samples: MSAA, usage: ['render', 'sample'] });
        this.hdr = k.texture({ label: 'hdr', format: 'rgba16float', size: 'render', usage: ['render', 'sample', 'storage', 'copy-src', 'copy-dst'] });
        this.depth = k.texture({ label: 'depth', format: 'depth32float', size: 'render', usage: ['render', 'sample'] });
        this.sceneCopy = k.texture({ label: 'scene.copy', format: 'rgba16float', size: 'render', usage: ['sample', 'copy-dst'] });
        this.refl = k.texture({ label: 'refl', format: 'rgba16float', size: 'render', scale: 0.5, usage: ['render', 'sample'] });
        this.reflDepth = k.texture({ label: 'refl.depth', format: 'depth32float', size: 'render', scale: 0.5, usage: ['render'] });
        this.bloom = k.texture({ label: 'bloom', format: 'rgba16float', size: 'render', scale: 0.5, mips: BLOOM_LEVELS, usage: ['render', 'sample'] });
        this.shadow = k.texture({ label: 'shadow', format: 'depth32float', size: [SHADOW_SIZE, SHADOW_SIZE, 3], usage: ['render', 'sample'] });
        this.lights = k.storage({ label: 'pointLights', size: MAX_LIGHTS * 64 });
        this.ripples = new Ripples(k);
        this.hf = new TerrainShadow(k, terrain.heightTex, half);
        this.clouds = new Clouds(k, terrain.heightTex, this.depth, half);
        // the environment, shared by every surface shader (group 1)
        k.shareGroup(1, envShader, {
            lighting: atmo.lighting, skyTex: atmo.skyView, aerialTex: atmo.aerial,
            heightTex: terrain.heightTex, normalTex: terrain.normalTex, splatTex: terrain.splatTex, maskTex: terrain.maskTex,
            shadowTex: this.shadow, rippleTex: this.ripples.pp.read, hfShadowTex: this.hf.shown, cloudShadowTex: this.clouds.smap,
            plights: this.lights,
        }, 'env');
        this.clouds.build();
        // (a shadow pass can't have the shadow map it writes bound for sampling: those passes see a 1×1 stand-in)
        const noShadow = k.texture({ label: 'shadow.none', format: 'depth32float', size: [1, 1, 3], usage: ['render', 'sample'] });
        for (let c = 0; c < 3; c++) {
            const view = k.view(new Camera(), [SHADOW_SIZE, SHADOW_SIZE], `shadow${c}`);
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
        this.scene = k.pass({
            label: 'scene',
            color: [{ target: this.hdrMS, resolve: this.hdr, clear: [0, 0, 0, 1], store: false }],
            depth: { target: this.depthMS, clear: 0 },
        });
        this.resolve = k.pass({ label: 'depth.resolve', depth: { target: this.depth, clear: 0 } });
        this.resolve.fullscreen(postShader, { label: 'depth.resolve', fragment: 'fs_depth', bind: { depthMS: this.depthMS }, depthWrite: true, depthCompare: 'always' });
        this.copy = k.copy(this.hdr, this.sceneCopy, 'scene.copy');
        this.water = k.pass({ label: 'water', color: [{ target: this.hdr, clear: false }], depth: { target: this.depth, readOnly: true } });
        this.cinema = new Cinema(k, this.depth, this.hdr, this.clouds.outTex);
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
        for (let i = 0; i < BLOOM_LEVELS; i++) {
            const p = k.pass({ label: `bloom.down${i}`, color: [{ target: this.bloom.mip(i), clear: [0, 0, 0, 1] }] });
            p.fullscreen(postShader, { fragment: 'fs_down', bind: { src: i === 0 ? this.hdr : this.bloom.mip(i - 1), P: i === 0 ? this.postFirst : this.post, expo: this.expo } });
            this.bloomPasses.push(p);
        }
        this.adapt = k.compute(postShader, { label: 'adapt', entry: 'adapt', bind: { P: this.post, lumSrc: this.bloom.mip(4), expoOut: this.expo }, workgroups: [1] });
        for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
            const p = k.pass({ label: `bloom.up${i}`, color: [{ target: this.bloom.mip(i), clear: false }] });
            p.fullscreen(postShader, { fragment: 'fs_up', blend: 'add', bind: { src: this.bloom.mip(i + 1), P: this.post } });
            this.bloomPasses.push(p);
        }
        this.composite = k.pass({ label: 'composite', color: [{ target: 'screen', clear: [0, 0, 0, 1] }] });
        this.composite.fullscreen(postShader, { fragment: 'fs_composite', bind: { src: this.hdr, bloomTex: this.bloom.mip(0), P: this.post, expo: this.expo } });
        // (with the lens on: the grade into a display-space target, the lens from it to the screen)
        this.ldr = k.texture({ label: 'ldr', format: 'rgba16float', size: 'render', usage: ['render', 'sample'] });
        this.compositeLdr = k.pass({ label: 'composite.ldr', color: [{ target: this.ldr, clear: [0, 0, 0, 1] }] });
        this.compositeLdr.fullscreen(postShader, { fragment: 'fs_composite', bind: { src: this.hdr, bloomTex: this.bloom.mip(0), P: this.post, expo: this.expo } });
        this.lensU = k.uniforms(lensShader.structs.Lens, 'lens');
        this.lensPass = k.pass({ label: 'lens', color: [{ target: 'screen', clear: [0, 0, 0, 1] }] });
        this.lensPass.fullscreen(lensShader, { fragment: 'fs_lens', bind: { LN: this.lensU, lensSrc: this.ldr } });
    }
    /** the sky goes last in the opaque passes, where nothing wrote depth (a game's own sky shader, or loom's) */
    addSky(shader = skyShader, bind = {}) {
        this.scene.fullscreen(shader, { label: 'sky', depthCompare: 'equal', bind });
        this.reflPass.fullscreen(shader, { label: 'sky.refl', depthCompare: 'equal', bind });
    }
    /** small point lights (fallen stars, lamps, blooms): the nearest MAX_LIGHTS to the camera are kept */
    setPointLights(list, cam) {
        // (the ones whose light can reach anywhere near the camera; then the nearest MAX_LIGHTS)
        const near = list.filter((l) => l.radius > 1000 || Math.sqrt(dist2(l.pos, cam)) - l.radius < this.lightCull);
        const sorted = near.length > MAX_LIGHTS ? [...near].sort((a, b) => dist2(a.pos, cam) - dist2(b.pos, cam)).slice(0, MAX_LIGHTS) : near;
        this.lightData.fill(0);
        sorted.forEach((l, i) => this.lightData.set([...l.pos, l.radius, ...l.color, l.size ?? 0.3, ...(l.dir ?? [0, -1, 0]), l.dir ? Math.cos(l.outer ?? 0.6) : -2, l.dir ? Math.cos(l.inner ?? 0.35) : -2, l.owner ?? 0, l.squash ?? 1, l.haze ?? 1], i * 16));
        this.lights.write(this.lightData);
        this.lightCount = sorted.length;
    }
    /** fit the three cascades around the camera's view for a key light direction */
    updateShadows(cam, light) {
        const near = [0, ...this.cascades];
        const mats = [];
        for (let c = 0; c < 3; c++) {
            const d0 = near[c], d1 = near[c + 1];
            const mid = (d0 + d1) / 2;
            const f = cam.forward;
            const centre = [cam.position[0] + f[0] * mid, cam.position[1] + f[1] * mid, cam.position[2] + f[2] * mid];
            const tanH = Math.tan(cam.fovY / 2) * Math.max(1, cam.aspect);
            const r = Math.hypot((d1 - d0) / 2, d1 * tanH * 1.2);
            const view = lookAt([centre[0] + light[0] * 600, centre[1] + light[1] * 600, centre[2] + light[2] * 600], centre, Math.abs(light[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0]);
            const texel = (2 * r) / SHADOW_SIZE;
            view[12] = Math.round(view[12] / texel) * texel;
            view[13] = Math.round(view[13] / texel) * texel;
            const proj = orthoReversed(-r, r, -r, r, 1, 1400);
            mats.push(mat4Mul(proj, view));
            const sc = this.shadowViews[c].camera;
            sc.viewOverride = view;
            sc.ortho = { halfWidth: r, halfHeight: r };
            sc.near = 1;
            sc.far = 1400;
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
        let norm = 0;
        for (let i = 0; i < BLOOM_LEVELS; i++)
            norm += f.bloomWide ** i;
        const p = {
            // (inside a cloud: brighter — the eye's adaptation alone would pull the glowing white fog down to a dull grey — and
            // no vignette darkening its edges)
            exposure: f.exposure * (1 + this.inCloud.lift * this.clouds.inside), bloom: f.bloom * (1 + 0.6 * o.night), bloomThreshold: 0, saturation: f.saturation, contrast: f.contrast,
            warmth: f.warmth, vignette: f.vignette * (1 - this.inCloud.vignette * this.clouds.inside), grain: f.grain, time: o.time, autoExposure: f.autoExposure, first: 0,
            lift: [f.lift[0], f.lift[1], f.lift[2], o.night], gain: [f.gain[0], f.gain[1], f.gain[2], 1], look: [f.vivid ? 0 : 1, f.bloomWide, 1 / norm, f.splitTone], uw: [o.under * 0.6, o.under * 0.5, o.under * 0.3, o.under],
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
        this.cinema.update(o.time, o.cam, o.light, o.night, this.hdr.height, o.seaLevel, this.clouds.live);
        this.clouds.hidden = o.cam.position[1] < o.seaLevel - 0.3;
        this.clouds.update(o.dt, o.cam.position, o.cover, o.cam.fovY);
        this.underwater.update(o.time, o.dt, o.cam.position[1], o.seaLevel);
    }
    items(light) {
        return [
            ...this.ripples.items(), ...(this.hfOn ? this.hf.items(light) : []), ...this.clouds.bakes(), ...this.compute,
            ...this.shadowPasses, this.reflPass, this.scene, this.resolve, ...this.cinema.aoItems, this.copy, this.water,
            ...this.clouds.render(), this.cloudsBelow, ...this.cinema.airItems, this.cloudsAbove, ...this.underwater.items, ...this.beforeFx, this.fx,
            this.motionBlur.shutter > 0 ? this.copyMB : null, this.motionBlur.shutter > 0 ? this.mb : null,
            this.dof.on ? this.copyDof : null, this.dof.on ? this.dofPass : null,
            ...this.bloomPasses.slice(0, BLOOM_LEVELS), this.adapt, ...this.bloomPasses.slice(BLOOM_LEVELS),
            ...(this.lens.on ? [this.compositeLdr, this.lensPass] : [this.composite]),
        ];
    }
}
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
//# sourceMappingURL=renderer.js.map