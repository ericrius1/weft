import type { Kit, Texture, UniformBuffer, RunEntry } from '@ericrius1/weft';
export declare class Underwater {
    params: {
        shafts: number;
        wobble: number;
        chroma: number;
    };
    u: UniformBuffer<any>;
    items: RunEntry[];
    /** the camera is under (or straddling) the surface */
    on: boolean;
    private surfacedT;
    private seed;
    private wasUnder;
    constructor(kit: Kit, depth: Texture, hdr: Texture, sceneCopy: Texture);
    /** per frame: cameraY against the sea level */
    update(time: number, dt: number, camY: number, seaLevel: number): void;
}
//# sourceMappingURL=underwater.d.ts.map