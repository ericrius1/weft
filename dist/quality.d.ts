import { type Kit } from '@ericrius1/weft';
import type { Renderer } from './render/renderer';
export type Quality = 'epic' | 'smooth';
export declare function loadQuality(game: string, fallback?: Quality): Quality;
export declare function saveQuality(game: string, q: Quality): void;
/** the frame budget for a quality: the fps cap, auto resolution's target, the clouds' march */
export declare function applyQuality(kit: Kit, r: Renderer, q: Quality, qs?: URLSearchParams): 60 | 30;
/** the Epic / Smooth buttons (in `parent`), the game's choice lit; picking one applies and remembers it */
export declare function qualityPicker(parent: HTMLElement, game: string, kit: Kit, r: Renderer, onChange?: (q: Quality) => void): HTMLDivElement;
//# sourceMappingURL=quality.d.ts.map