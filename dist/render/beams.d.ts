import type { Kit, Compute, RenderPass, Texture } from '@ericrius1/weft';
import type { PointLight } from './renderer';
export declare class Beams {
    air: {
        scatter: number;
        extinction: number;
        maxDist: number;
    };
    /** the phase's two lobes: the drops' narrow forward one (g), the mist's broad one (g), the narrow one's share */
    phase: {
        drops: number;
        mist: number;
        share: number;
    };
    /** samples per lamp along its stretch of each ray */
    params: {
        samples: number;
        strength: number;
    };
    private lights;
    on: boolean;
    private u;
    private tex;
    private pass;
    private frame;
    constructor(kit: Kit, depth: Texture);
    private depth;
    /** the march (run after the scene's depth is done) */
    get items(): Compute<import("@ericrius1/weft").Shader<Record<string, unknown>, string>>[];
    /** the composite into an hdr pass */
    addTo(pass: RenderPass): void;
    /** the lamps that show in the air this frame: the hazy ones (haze > 0.05), the nearest eight to the camera */
    setLights(list: PointLight[], cam: ArrayLike<number>): void;
    update(): void;
}
//# sourceMappingURL=beams.d.ts.map