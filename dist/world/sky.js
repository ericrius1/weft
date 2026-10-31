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
export class Atmosphere {
    trans;
    ms;
    skyView;
    aerial;
    lighting;
    statics;
    perFrame;
    staticDone = false;
    constructor(kit, heights) {
        const tex = (label, w, h) => kit.texture({ label, format: 'rgba16float', size: [w, h], usage: ['sample', 'storage'] });
        this.trans = tex('atmo.transmittance', 256, 64);
        this.ms = tex('atmo.multiscatter', 32, 32);
        this.skyView = tex('atmo.skyview', 256, 128);
        this.aerial = kit.texture({ label: 'atmo.aerial', format: 'rgba16float', size: [32, 32, 32], dimension: '3d', usage: ['sample', 'storage'] });
        this.lighting = kit.storage({ label: 'atmo.lighting', struct: atmo.structs.Lighting, count: 1 });
        this.statics = [
            kit.compute(atmo, { label: 'atmo.transmittance', entry: 'transmittanceMain', bind: { out2d: this.trans }, threads: [256, 64] }),
            kit.compute(atmo, { label: 'atmo.multiscatter', entry: 'multiScatMain', bind: { transTex: this.trans, out2d: this.ms }, threads: [32, 32] }),
        ];
        this.perFrame = [
            kit.compute(atmo, { label: 'atmo.skyview', entry: 'skyViewMain', bind: { transTex: this.trans, msTex: this.ms, out2d: this.skyView }, threads: [256, 128] }),
            kit.compute(atmo, { label: 'atmo.aerial', entry: 'aerialMain', bind: { transTex: this.trans, msTex: this.ms, out3d: this.aerial, heightIn: heights }, threads: [32, 32] }),
            kit.compute(atmo, { label: 'atmo.lighting', entry: 'lightingMain', bind: { transTex: this.trans, skyIn: this.skyView, lightOut: this.lighting }, workgroups: [1] }),
        ];
    }
    /** the haze setting feeds the static LUTs: rebuild them when it changes */
    invalidate() { this.staticDone = false; }
    /** this frame's atmosphere passes */
    items() {
        const out = this.staticDone ? this.perFrame : [...this.statics, ...this.perFrame];
        this.staticDone = true;
        return out;
    }
}
//# sourceMappingURL=sky.js.map