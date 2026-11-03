import { type Kit } from '@ericrius1/weft';
import type { Renderer, RendererOptions } from './render/renderer';
export type Quality = 'epic' | 'smooth' | 'mobile';
/** what a quality fixes at construction (RendererOptions) and sets after (applyQuality) */
export interface QualityProfile {
    /** RendererOptions: the scene's samples, the cascades' size, the terrain shadow's size */
    msaa: 1 | 4;
    shadowSize: number;
    terrainShadowSize: number;
    /** the fps cap; auto resolution's GPU budget (ms), its least and most render scale, the scale to begin at (null:
     *  as the kit has it) and how far it steps; the canvas's device pixels a CSS pixel at most (null: the kit's) */
    fps: 30 | 60;
    budgetMs: number;
    minScale: number;
    maxScale: number;
    startScale: number | null;
    step: number;
    maxPixelRatio: number | null;
    /** (with no GPU timing: a phone) a frame late past the display's interval times this */
    slack: number;
    /** the clouds' march resolution and steps (null: the clouds' own) */
    marchRes: 'quarter' | 'half';
    cloudSteps: number | null;
    /** ambient occlusion, the sun's shafts, camera motion blur (null: leave the game's own setting alone) */
    ao: boolean | null;
    shafts: boolean | null;
    motionBlur: boolean | null;
}
export declare const QUALITY: Record<Quality, QualityProfile>;
/** a phone or a tablet: by its browser, or a compact screen with a coarse pointer (boulder's and Seven Havens' guess) */
export declare function isPhone(): boolean;
/** 'mobile' on a phone (isPhone), else `desktop`: the fallback for loadQuality that starts a phone on its profile —
 *  loadQuality(game, phoneOr('smooth')) */
export declare function phoneOr(desktop?: Quality): Quality;
/** the quality to start at: ?quality=epic|smooth|mobile, else the one remembered for this game, else `fallback`
 *  (phoneOr(…) to start a phone on 'mobile') */
export declare function loadQuality(game: string, fallback?: Quality, qs?: URLSearchParams): Quality;
export declare function saveQuality(game: string, q: Quality): void;
/** the Renderer's construction options for a quality (a game passes them to `new Renderer(…, opts)`); `over` on top */
export declare function rendererOptions(q: Quality, over?: RendererOptions): RendererOptions;
/** the frame budget for a quality: the fps cap, auto resolution, the clouds' march; for 'mobile' also the passes it
 *  turns off and the start scale. Returns the fps. (MSAA and the shadows' sizes are the Renderer's, made with
 *  rendererOptions; a renderer made otherwise keeps its own.) */
export declare function applyQuality(kit: Kit, r: Renderer, q: Quality, qs?: URLSearchParams): 60 | 30;
/** the quality buttons (in `parent`), the game's choice lit; picking one applies and remembers it. With `mobile: true`
 *  (isPhone(), say) a third, Phone; MSAA and the shadows' sizes take effect when the renderer is next made (the game
 *  reloads, or rebuilds it, in onChange) */
export declare function qualityPicker(parent: HTMLElement, game: string, kit: Kit, r: Renderer, onChange?: (q: Quality) => void, o?: {
    mobile?: boolean;
}): HTMLDivElement;
//# sourceMappingURL=quality.d.ts.map