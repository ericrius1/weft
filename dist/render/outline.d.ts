import type { Kit, RenderPass, Texture } from '@ericrius1/weft';
import type { V3 } from './paint';
export declare class Outline {
    private depth;
    /** the ink's colour (linear) and strength */
    ink: V3;
    strength: number;
    /** width at 1080 lines (px; scaled with the render's height) */
    width: number;
    /** how sharp a crease (1/z's second difference) and a silhouette (its step) must be to draw */
    crease: number;
    silhouette: number;
    /** redraws a second (0: still) and the wobble (px) */
    boil: number;
    wobble: number;
    /** lines thin away between these distances (m) */
    fade: [number, number];
    on: boolean;
    private u;
    constructor(kit: Kit, depth: Texture);
    addTo(pass: RenderPass): void;
    /** each frame (the render's height, for the width) */
    update(renderHeight: number): void;
}
//# sourceMappingURL=outline.d.ts.map