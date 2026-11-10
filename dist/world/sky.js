import { norm, smoothstep } from '@ericrius1/weft';
import atmo from '../shaders/atmosphere.wgsl';
const DEG = Math.PI / 180;
const mod = (a, n) => ((a % n) + n) % n;
/** sun / moon for local solar time `hour` on day-of-year `doy` at latitude `latDeg`; world -z points `northOffset` rad
 *  east of north (from waterbending's src/world/sky.ts) */
export function celestial(hour, doy, latDeg, northOffset, moonPhase = 0.42) {
    const lat = latDeg * DEG;
    const dir = (h, decl) => {
        const H = (h - 12) * 15 * DEG;
        const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
        const el = Math.asin(sinEl);
        const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
        const a = az - northOffset;
        return [Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el)];
    };
    const decl = 23.44 * DEG * Math.sin((2 * Math.PI * (doy - 81)) / 365);
    const sunDir = dir(hour, decl);
    const lag = moonPhase * 24;
    const moonDir = norm(dir(mod(hour - lag, 24), -decl * 0.8 + 5 * DEG));
    const illum = 0.5 - 0.5 * Math.cos(moonPhase * 2 * Math.PI);
    const kw = smoothstep(-0.02, -0.1, sunDir[1]);
    const lightDir = norm([sunDir[0] + (moonDir[0] - sunDir[0]) * kw, sunDir[1] + (moonDir[1] - sunDir[1]) * kw + 1e-3, sunDir[2] + (moonDir[2] - sunDir[2]) * kw]);
    const pole = [Math.sin(-northOffset) * Math.cos(lat), Math.sin(lat), -Math.cos(-northOffset) * Math.cos(lat)];
    const nightness = smoothstep(-0.02, -0.18, sunDir[1]);
    const dayLight = smoothstep(-0.1, 0.12, sunDir[1]);
    const starRot = (hour / 24) * Math.PI * 2;
    return { sunDir, moonDir, lightDir, pole, nightness, dayLight, starRot, moonPhase: illum };
}
/** loom's own: an earth sky painted the way Seven Havens paints its own — the dome luminous and a touch toward teal over
 *  the land, its light on the land a little lavender, a golden dust low down in the afternoon, rose at golden hour, a
 *  violet twilight, a navy night */
export const AIR_DEFAULT = {
    tint: 0.08, dust: 0.1, dustColor: [1.0, 0.82, 0.6], dustBase: 0.15,
    sky: 1.45, skyTint: [0.94, 1.0, 0.97], farKm: 30, farPaint: 0.25, skyLight: 1.15, shadeTint: [1.04, 1.0, 1.16],
    twilight: [1.6, 1.0, 1.5], golden: [1.12, 0.94, 1.06], hazeDawn: [0.8, 0.88, 1.18], hazeGolden: [1.05, 1.0, 0.86],
    shadeDawn: [0.72, 0.88, 1.38], shadeGolden: [0.95, 0.97, 1.1], night: [0.45, 0.55, 1.5],
};
/** Seven Havens' (its world/daylight.ts): the teal sky of the other Boulder, its desert dust, the dome painted bright */
export const AIR_HAVENS = {
    tint: 0.75, dust: 1, dustColor: [1.0, 0.76, 0.45], dustBase: 0.25,
    sky: 8, skyTint: [0.82, 1.0, 0.8], farKm: 10, farPaint: 1, skyLight: 1.3, shadeTint: [1.12, 1.0, 1.36],
    twilight: [1.9, 1.0, 1.7], golden: [1.14, 0.92, 1.08], hazeDawn: [0.72, 0.84, 1.24], hazeGolden: [1.04, 1.0, 0.84],
    shadeDawn: [0.62, 0.84, 1.5], shadeGolden: [0.94, 0.96, 1.12], night: [0.45, 0.55, 1.5],
};
/** the air as the earth's, unpainted (loom before the Havens look) */
export const AIR_PLAIN = {
    tint: 0, dust: 0, dustColor: [1, 1, 1], dustBase: 0, sky: 1, skyTint: [1, 1, 1], farKm: 10, farPaint: 0, skyLight: 1, shadeTint: [1, 1, 1],
    twilight: [1, 1, 1], golden: [1, 1, 1], hazeDawn: [1, 1, 1], hazeGolden: [1, 1, 1], shadeDawn: [1, 1, 1], shadeGolden: [1, 1, 1], night: [1, 1, 1],
};
export const AIR_PRESETS = { default: AIR_DEFAULT, havens: AIR_HAVENS, plain: AIR_PLAIN };
/** the dust through the day: [hour, density over the low ground (/km), scale height (km)] — the night's settled layer;
 *  dawn's shallow and pooled; the morning's lifting; the afternoon's deep golden haze (Seven Havens') */
const DUST = [
    [0, 0.09, 0.55], [4.5, 0.09, 0.4], [6.2, 0.12, 0.25], [8.5, 0.1, 0.55], [12, 0.12, 0.95], [15, 0.15, 1.25],
    [18, 0.18, 1.4], [20, 0.13, 1.0], [24, 0.09, 0.55],
];
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lean = (v, k) => [1 + (v[0] - 1) * k, 1 + (v[1] - 1) * k, 1 + (v[2] - 1) * k];
const mul3 = (...vs) => vs.reduce((a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]], [1, 1, 1]);
/** the air's uniform at an hour, the sun at an altitude (degrees): the painted dome brightest and leanest with the sun
 *  well up, as the air makes it once the sun is down (the twilight's own colours lifted) */
export function airAt(hour, sunAlt, a) {
    const h = ((hour % 24) + 24) % 24;
    let k = 0;
    while (k < DUST.length - 2 && DUST[k + 1][0] <= h)
        k++;
    const d0 = DUST[k], d1 = DUST[k + 1], f = (h - d0[0]) / (d1[0] - d0[0]), s = f * f * (3 - 2 * f);
    const up = smooth(5, 45, sunAlt), g = smooth(-2, 35, sunAlt), tw = smooth(-16, -6, sunAlt) * (1 - smooth(-2, 4, sunAlt));
    const gold = smooth(-1, 5, sunAlt) * (1 - smooth(8, 18, sunAlt));
    const deep = smooth(-15, -9, sunAlt) * (1 - smooth(-6, -2, sunAlt));
    const paint = mul3([1 + (a.sky - 1) * up, 1 + (a.sky - 1) * up, 1 + (a.sky - 1) * up], lean(a.skyTint, g), lean(a.twilight, tw), lean(a.golden, gold), [1 + 1.5 * deep * (a.sky > 1 ? 1 : 0), 1 + 1.5 * deep * (a.sky > 1 ? 1 : 0), 1 + 1.5 * deep * (a.sky > 1 ? 1 : 0)]);
    const lit = smooth(-6, 10, sunAlt), low = smooth(-6, 2, sunAlt) * (1 - smooth(10, 22, sunAlt)), morning = h < 12;
    const shade = mul3(lean([a.skyLight * a.shadeTint[0], a.skyLight * a.shadeTint[1], a.skyLight * a.shadeTint[2]], lit), lean(morning ? a.shadeDawn : a.shadeGolden, low));
    const haze = lean(morning ? a.hazeDawn : a.hazeGolden, low);
    return {
        tint: [a.tint, (d0[1] + (d1[1] - d0[1]) * s) * a.dust, d0[2] + (d1[2] - d0[2]) * s, a.dustBase],
        dust: [...a.dustColor, 0], paint: [...paint, a.farKm],
        shade: [...shade, 0], haze: [...haze, a.farPaint], night: [...a.night, 0],
    };
}
export class Atmosphere {
    trans;
    ms;
    skyView;
    aerial;
    lighting;
    /** the air's look (AIR_DEFAULT, AIR_HAVENS, AIR_PLAIN, or a scene's own): read every frame (setHour) */
    look = { ...AIR_DEFAULT };
    airU;
    statics;
    perFrame;
    staticDone = false;
    /** what the static tables were built with (the air's lean and its dust: they're rebuilt once these move) */
    builtAir = null;
    constructor(kit, heights) {
        const tex = (label, w, h) => kit.texture({ label, format: 'rgba16float', size: [w, h], usage: ['sample', 'storage'] });
        this.trans = tex('atmo.transmittance', 256, 64);
        this.ms = tex('atmo.multiscatter', 32, 32);
        this.skyView = tex('atmo.skyview', 256, 128);
        this.aerial = kit.texture({ label: 'atmo.aerial', format: 'rgba16float', size: [32, 32, 32], dimension: '3d', usage: ['sample', 'storage'] });
        this.lighting = kit.storage({ label: 'atmo.lighting', struct: atmo.structs.Lighting, count: 1 });
        this.airU = kit.uniforms(atmo.structs.Air, 'atmo.air');
        const air = this.airU;
        this.setHour(16, 30);
        this.statics = [
            kit.compute(atmo, { label: 'atmo.transmittance', entry: 'transmittanceMain', bind: { out2d: this.trans, air }, threads: [256, 64] }),
            kit.compute(atmo, { label: 'atmo.multiscatter', entry: 'multiScatMain', bind: { transTex: this.trans, out2d: this.ms, air }, threads: [32, 32] }),
        ];
        this.perFrame = [
            kit.compute(atmo, { label: 'atmo.skyview', entry: 'skyViewMain', bind: { transTex: this.trans, msTex: this.ms, out2d: this.skyView, air }, threads: [256, 128] }),
            kit.compute(atmo, { label: 'atmo.aerial', entry: 'aerialMain', bind: { transTex: this.trans, msTex: this.ms, out3d: this.aerial, heightIn: heights, air }, threads: [32, 32] }),
            kit.compute(atmo, { label: 'atmo.lighting', entry: 'lightingMain', bind: { transTex: this.trans, skyIn: this.skyView, lightOut: this.lighting, air }, workgroups: [1] }),
        ];
    }
    /** the haze setting feeds the static LUTs: rebuild them when it changes */
    invalidate() { this.staticDone = false; }
    /** the air for an hour and the sun's altitude (degrees; the Renderer's update calls it each frame): its painted sky,
     *  its leans, its dust — the static tables rebuilt once the dust or the lean has moved a few per cent */
    setHour(hour, sunAltDeg) {
        const u = airAt(hour, sunAltDeg, this.look), b = this.builtAir, t = u.tint;
        if (!b || b[0] !== t[0] || Math.abs(t[1] - b[1]) > b[1] * 0.04 + 1e-5 || Math.abs(t[2] - b[2]) > b[2] * 0.04 || b[3] !== t[3]) {
            this.builtAir = [...t];
            this.staticDone = false;
        }
        // (what the static tables hold stays as built until they're rebuilt, so every table agrees)
        this.airU.set({ ...u, tint: this.builtAir });
    }
    /** this frame's atmosphere passes */
    items() {
        const out = this.staticDone ? this.perFrame : [...this.statics, ...this.perFrame];
        this.staticDone = true;
        return out;
    }
}
//# sourceMappingURL=sky.js.map