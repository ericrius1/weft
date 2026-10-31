import type { Kit, RenderPass, Texture, V3 } from '@ericrius1/weft';
export declare class Rain {
    private depth;
    params: {
        /** the most drops and splashes drawn (the intensity thins them) */
        drops: number;
        splashes: number;
        /** 0..1 */
        intensity: number;
        /** fall speed (m/s), a drop's width (m), the streaks' exposure (s), a splash's life (s) */
        fall: number;
        width: number;
        exposure: number;
        splashLife: number;
        /** the box round the camera (m) */
        box: V3;
    };
    /** the wind (m/s) */
    wind: V3;
    on: boolean;
    private u;
    private camVel;
    private last;
    private time;
    constructor(kit: Kit, depth: Texture);
    /** the drops and the splashes into a pass (hdr, the scene's depth read-only) */
    addTo(pass: RenderPass): void;
    update(dt: number, cam: V3): void;
}
//# sourceMappingURL=rain.d.ts.map