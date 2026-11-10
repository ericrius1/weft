import { smoothstep } from '@ericrius1/weft';
import fx from '../shaders/cinema.wgsl';
export class Cinema {
    kit;
    params = {
        ao: 1, aoRadius: 1.1, aoPower: 2, aoDirect: 0.25, aoBounce: 1,
        mist: 1, mistHeight: 10, mistTop: 50,
        shafts: 1,
        /** 1: show the AO factor */
        debug: 0,
    };
    /** time of day (hour): the mist is a morning / evening / night thing */
    hour = 12;
    /** extra mist (a place, a mood) on top of the time of day's */
    mistBoost = 0;
    u;
    z;
    aoRaw;
    aoOut;
    shA;
    shB;
    mistT;
    mistZ;
    aoItems;
    airItems;
    mistOn = false;
    shaftOn = false;
    under = false;
    constructor(kit, depth, hdr, cloudsOut) {
        this.kit = kit;
        const k = kit;
        this.u = k.uniforms(fx.structs.FX, 'cinema');
        const half = (label, format, mips = 1) => k.texture({ label, format, size: 'render', scale: 0.5, mips, usage: ['render', 'sample'] });
        this.z = half('fx.z', 'r16float', 3);
        this.aoRaw = half('fx.aoRaw', 'rgba16float');
        this.aoOut = half('fx.ao', 'rgba16float');
        this.shA = half('fx.shaftA', 'r16float');
        this.shB = half('fx.shaftB', 'r16float');
        this.mistT = half('fx.mist', 'rgba16float');
        this.mistZ = half('fx.mistZ', 'r16float');
        const X = this.u;
        const pass = (label, target, fragment, bind, extra = {}, enabled) => {
            const p = k.pass({ label, color: [{ target, clear: [0, 0, 0, 1] }], enabled });
            p.fullscreen(fx, { label, fragment, bind: { X, ...bind }, ...extra });
            return p;
        };
        const aoOn = () => this.params.ao > 0;
        const prep = pass('fx.prep', this.z.mip(0), 'fsPrep', { depthFull: depth });
        const zd1 = pass('fx.zdown1', this.z.mip(1), 'fsZDown', { zHalf: this.z.mip(0) }, {}, aoOn);
        const zd2 = pass('fx.zdown2', this.z.mip(2), 'fsZDown', { zHalf: this.z.mip(1) }, {}, aoOn);
        const ao = pass('fx.ao', this.aoRaw, 'fsAO', { depthFull: depth, zHalf: this.z }, {}, aoOn);
        const blur = pass('fx.aoBlur', this.aoOut, 'fsAOBlur', { zHalf: this.z, texA: this.aoRaw, texB: hdr }, {}, aoOn);
        const apply = k.pass({ label: 'fx.aoApply', color: [{ target: hdr, clear: false }], enabled: aoOn });
        apply.fullscreen(fx, { label: 'fx.aoApply', fragment: 'fsAOApply', bind: { X, depthFull: depth, zHalf: this.z, texA: this.aoOut }, blend: 'multiply', enabled: () => this.params.debug < 1 });
        apply.fullscreen(fx, { label: 'fx.aoDebug', fragment: 'fsAODebug', bind: { X, depthFull: depth, zHalf: this.z, texA: this.aoOut }, enabled: () => this.params.debug >= 1 });
        this.aoItems = [prep, zd1, zd2, ao, blur, apply];
        const mist = k.pass({ label: 'fx.mist', color: [{ target: this.mistT, clear: [0, 0, 0, 1] }, { target: this.mistZ, clear: [0, 0, 0, 1] }], enabled: () => this.mistOn });
        mist.fullscreen(fx, { label: 'fx.mist', fragment: 'fsMist', bind: { X, depthFull: depth } });
        const sh0 = pass('fx.shaft0', this.shA, 'fsShaft', { zHalf: this.z, texA: cloudsOut }, { constants: { SHAFT_PASS: 0 } }, () => this.shaftOn);
        const sh1 = pass('fx.shaft1', this.shB, 'fsShaft', { zHalf: this.z, texA: this.shA }, { constants: { SHAFT_PASS: 1 } }, () => this.shaftOn);
        const air = k.pass({ label: 'fx.air', color: [{ target: hdr, clear: false }], enabled: () => this.mistOn || this.shaftOn });
        air.fullscreen(fx, { label: 'fx.air', fragment: 'fsAirApply', bind: { X, depthFull: depth, zHalf: this.mistZ, texA: this.mistT, texB: this.shB }, blend: { color: { srcFactor: 'one', dstFactor: 'src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } });
        this.airItems = [mist, sh0, sh1, air];
    }
    /** per frame: the uniforms (and which passes run at all) */
    update(time, cam, light, night, renderH, seaLevel, cloudsLive) {
        const P = this.params, u = {};
        u.ao = [P.aoRadius, P.ao, Math.min(renderH * 0.11, 140), P.aoDirect];
        u.aoK = [P.aoBounce, 250, 1200, 0.02];
        // shafts toward the key light (sun, or the moon at night): only when it's low and on (or near) the screen
        const vp = cam.viewProj, c = cam.position;
        const wp = [c[0] + light[0] * 1000, c[1] + light[1] * 1000, c[2] + light[2] * 1000, 1];
        const clip = [0, 1, 3].map((i) => vp[i] * wp[0] + vp[4 + i] * wp[1] + vp[8 + i] * wp[2] + vp[12 + i] * wp[3]);
        let sx = 0.5, sy = 0.5, k = 0;
        if (clip[2] > 1e-3) {
            sx = clip[0] / clip[2] * 0.5 + 0.5;
            sy = 0.5 - clip[1] / clip[2] * 0.5;
            const out = Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5)) - 0.5;
            const ly = light[1];
            k = (1 - smoothstep(0.0, 0.35, out)) * (1 - smoothstep(0.3, 0.6, ly)) * smoothstep(-0.03, 0.04, ly);
            k *= night > 0.5 ? 0.6 : 1;
        }
        k *= P.shafts;
        const dry = !this.under;
        this.shaftOn = k > 0.002 && dry;
        u.shaft = [sx, sy, this.shaftOn ? k * 0.022 : 0, 0.75];
        u.shaftK = [0.93, 180, 0.78, cloudsLive ? 1 : 0];
        // mist: dawn the thickest, dusk and night thinner, little by day
        const h = this.hour;
        const ss = smoothstep;
        const dawn = ss(3.5, 5.5, h) * (1 - ss(6.5, 9.0, h));
        const dusk = ss(17.5, 19.5, h) * (1 - ss(21.5, 23.5, h));
        const nightM = Math.max(1 - ss(5, 7, h), ss(20.5, 23, h));
        const amt = (Math.max(dawn, dusk * 0.4, nightM * 0.25) + this.mistBoost) * P.mist;
        this.mistOn = amt > 0.01 && dry;
        u.mist = [this.mistOn ? 0.003 * amt : 0, P.mistHeight, P.mistTop, 2500];
        u.mistK = [time, seaLevel, 0.85, night > 0.5 ? 0.25 : 0.55];
        u.dbg = [P.debug, P.aoPower, 0, 0];
        this.u.set(u);
    }
}
//# sourceMappingURL=cinema.js.map