import { MipChain } from '@ericrius1/weft';
import uw from '../shaders/underwater.wgsl';
const CAU_N = 256;
/** the camera's virtual lens: how far ahead of the eye the waterline is drawn (m) */
const LENS = 0.16;
export class Underwater {
    params = { shafts: 1, wobble: 0.006, chroma: 0.012 };
    u;
    items;
    /** the camera is under (or straddling) the surface */
    on = false;
    surfacedT = -1;
    seed = 0;
    wasUnder = false;
    constructor(kit, depth, hdr, sceneCopy) {
        const k = kit;
        this.u = k.uniforms(uw.structs.UW, 'underwater');
        const U = this.u;
        const cau = k.texture({ label: 'uw.caustic', format: 'r16float', size: [CAU_N, CAU_N], mips: 5, usage: ['render', 'sample'] });
        const half = (label) => k.texture({ label, format: 'rgba16float', size: 'render', scale: 0.5, usage: ['render', 'sample'] });
        const raysA = half('uw.raysA'), raysB = half('uw.raysB');
        const shafts = () => this.on && this.params.shafts > 0;
        const lensOn = () => this.on || this.surfacedT >= 0;
        const cp = k.pass({ label: 'uw.caustic', color: [{ target: cau.mip(0), clear: [0, 0, 0, 1] }], enabled: shafts });
        cp.fullscreen(uw, { label: 'uw.caustic', fragment: 'fsCaustic', bind: { U } });
        const mips = new MipChain(k, cau);
        mips.enabled = shafts;
        const rays = k.pass({ label: 'uw.rays', color: [{ target: raysA, clear: [0, 0, 0, 0] }], enabled: shafts });
        rays.fullscreen(uw, { label: 'uw.rays', fragment: 'fsRays', bind: { U, depthTex: depth, cauTex: cau } });
        const blur = k.pass({ label: 'uw.raysBlur', color: [{ target: raysB, clear: [0, 0, 0, 0] }], enabled: shafts });
        blur.fullscreen(uw, { label: 'uw.raysBlur', fragment: 'fsRaysBlur', bind: { U, raysTex: raysA } });
        const copy = k.copy(hdr, sceneCopy, 'uw.copy');
        copy.enabled = lensOn;
        const lens = k.pass({ label: 'uw.lens', color: [{ target: hdr, clear: false }], enabled: lensOn });
        lens.fullscreen(uw, { label: 'uw.lens', fragment: 'fsLens', bind: { U, depthTex: depth, srcTex: sceneCopy, raysTex: raysB } });
        this.items = [cp, mips, rays, blur, copy, lens];
    }
    /** per frame: cameraY against the sea level */
    update(time, dt, camY, seaLevel) {
        const under = camY < seaLevel + LENS;
        // (out of the water: drops on the lens for a few seconds)
        if (this.wasUnder && !under) {
            this.surfacedT = 0;
            this.seed = (this.seed + 1) % 97;
        }
        else if (this.surfacedT >= 0) {
            this.surfacedT += dt;
            if (this.surfacedT > 3.5 || under)
                this.surfacedT = -1;
        }
        this.wasUnder = camY < seaLevel;
        this.on = under;
        const P = this.params;
        this.u.set({ a: [time, this.surfacedT, P.shafts, P.wobble], b: [P.chroma, this.seed, LENS, 0] });
    }
}
//# sourceMappingURL=underwater.js.map