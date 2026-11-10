// Under the sea (underwater.wgsl): the caustic tile (+ mips), the key light's shafts through the water (half res, then
// a blur), and the lens pass over the whole picture (the medium, the shafts, the wobble, the waterline, the drops after
// surfacing). Runs only while the camera is under or just out of the water.
import type { Kit, Texture, UniformBuffer, RunEntry } from '@ericrius1/weft';
import { MipChain } from '@ericrius1/weft';
import uw from '../shaders/underwater.wgsl';

const CAU_N = 256;
/** the camera's virtual lens: how far ahead of the eye the waterline is drawn (m) */
const LENS = 0.16;

export class Underwater {
  params = { shafts: 1, wobble: 0.006, chroma: 0.012 };
  u: UniformBuffer<any>;
  items: RunEntry[];
  /** the camera is under (or straddling) the surface */
  on = false;
  private surfacedT = -1;
  private seed = 0;
  private wasUnder = false;

  constructor(kit: Kit, depth: Texture, hdr: Texture, sceneCopy: Texture) {
    const k = kit;
    this.u = k.uniforms(uw.structs.UW, 'underwater');
    const U = this.u;
    const cau = k.texture({ label: 'uw.caustic', format: 'r16float', size: [CAU_N, CAU_N], mips: 5, usage: ['render', 'sample'] });
    const half = (label: string) => k.texture({ label, format: 'rgba16float', size: 'render', scale: 0.5, usage: ['render', 'sample'] });
    const raysA = half('uw.raysA'), raysB = half('uw.raysB');
    const shafts = () => this.on && this.params.shafts > 0;
    const lensOn = () => this.on || this.surfacedT >= 0;
    const cp = k.pass({ label: 'uw.caustic', color: [{ target: cau.mip(0), clear: [0, 0, 0, 1] }], enabled: shafts });
    cp.fullscreen(uw, { label: 'uw.caustic', fragment: 'fsCaustic', bind: { U } });
    const mips = new MipChain(k, cau);
    mips.enabled = shafts as never;
    const rays = k.pass({ label: 'uw.rays', color: [{ target: raysA, clear: [0, 0, 0, 0] }], enabled: shafts });
    rays.fullscreen(uw, { label: 'uw.rays', fragment: 'fsRays', bind: { U, depthTex: depth, cauTex: cau } });
    const blur = k.pass({ label: 'uw.raysBlur', color: [{ target: raysB, clear: [0, 0, 0, 0] }], enabled: shafts });
    blur.fullscreen(uw, { label: 'uw.raysBlur', fragment: 'fsRaysBlur', bind: { U, raysTex: raysA } });
    const copy = k.copy(hdr, sceneCopy, 'uw.copy');
    copy.enabled = lensOn as never;
    const lens = k.pass({ label: 'uw.lens', color: [{ target: hdr, clear: false }], enabled: lensOn });
    lens.fullscreen(uw, { label: 'uw.lens', fragment: 'fsLens', bind: { U, depthTex: depth, srcTex: sceneCopy, raysTex: raysB } });
    this.items = [cp, mips, rays, blur, copy, lens];
  }

  /** per frame: cameraY against the sea level */
  update(time: number, dt: number, camY: number, seaLevel: number) {
    const under = camY < seaLevel + LENS;
    // (out of the water: drops on the lens for a few seconds)
    if (this.wasUnder && !under) { this.surfacedT = 0; this.seed = (this.seed + 1) % 97; }
    else if (this.surfacedT >= 0) { this.surfacedT += dt; if (this.surfacedT > 3.5 || under) this.surfacedT = -1; }
    this.wasUnder = camY < seaLevel;
    this.on = under;
    const P = this.params;
    this.u.set({ a: [time, this.surfacedT, P.shafts, P.wobble], b: [P.chroma, this.seed, LENS, 0] });
  }
}
