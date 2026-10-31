import type { Kit } from './kit';
import type { RenderPass } from './passes';
import { Texture } from './resources';
export type Color = ArrayLike<number>;
/** '#rrggbb' (sRGB) → linear rgba, optionally scaled (values above 1 glow under bloom) */
export declare function hex(h: string, intensity?: number, alpha?: number): [number, number, number, number];
export declare const withAlpha: (c: Color, a: number) => [number, number, number, number];
export declare const scaleColor: (c: Color, k: number) => [number, number, number, number];
export interface Sprite {
    name: string;
    uv: [number, number, number, number];
    w: number;
    h: number;
}
/** one shared atlas per kit: the 5×7 font, then sprites shelf-packed below it */
export declare class Atlas {
    private kit;
    readonly tex: Texture;
    readonly data: Uint8Array<ArrayBuffer>;
    readonly glyphs: Map<string, [number, number, number, number]>;
    readonly sprites: Map<string, Sprite>;
    private shelfX;
    private shelfY;
    private shelfH;
    private dirty;
    constructor(kit: Kit);
    /** add RGBA pixels; returns the sprite (uv rect in the atlas) */
    add(name: string, w: number, h: number, rgba: Uint8Array): Sprite;
    /** a pixel-art sprite from rows of palette characters ('.' or ' ' = transparent) */
    pixels(name: string, rows: string[], palette: Record<string, string>): Sprite;
    flush(): void;
}
export declare const atlasOf: (kit: Kit) => Atlas;
export interface PainterOptions {
    width: number;
    height: number;
    /** draw into this texture (default: a new rgba16float texture of width × height) or 'screen' */
    target?: Texture | 'screen';
    format?: GPUTextureFormat;
    clear?: GPUColor | false;
    label?: string;
    /** give the target a mip chain (glow lookups on a CRT) */
    mips?: boolean;
}
export interface ShapeOpts {
    rot?: number;
    glow?: number;
    add?: boolean;
    radius?: number;
}
export declare class Painter {
    private kit;
    readonly pass: RenderPass;
    readonly target: Texture | 'screen';
    readonly atlas: Atlas;
    private ownTarget;
    readonly width: number;
    readonly height: number;
    camera: {
        x: number;
        y: number;
        zoom: number;
    };
    private prims;
    private u32;
    private n;
    private buf;
    private view;
    constructor(kit: Kit, o: PainterOptions);
    begin(): this;
    get count(): number;
    private push;
    /** rectangle by its top-left corner */
    rect(x: number, y: number, w: number, h: number, c: Color, o?: ShapeOpts): this;
    /** rectangle by its centre */
    box(cx: number, cy: number, w: number, h: number, c: Color, o?: ShapeOpts): this;
    circle(x: number, y: number, r: number, c: Color, o?: ShapeOpts): this;
    ring(x: number, y: number, r: number, thickness: number, c: Color, o?: ShapeOpts): this;
    line(x0: number, y0: number, x1: number, y1: number, width: number, c: Color, o?: ShapeOpts): this;
    /** a polyline through flat [x0, y0, x1, y1, …] points */
    poly(pts: ArrayLike<number>, width: number, c: Color, closed?: boolean, o?: ShapeOpts): this;
    sprite(s: Sprite, x: number, y: number, o?: {
        scale?: number;
        rot?: number;
        flipX?: boolean;
        flipY?: boolean;
        tint?: Color;
        alpha?: number;
        add?: boolean;
        center?: boolean;
    }): this;
    /** pixel text; returns its width. size is the pixel scale (1 = 5×7 glyphs on a 6px advance) */
    text(str: string, x: number, y: number, o?: {
        size?: number;
        color?: Color;
        align?: 'left' | 'center' | 'right';
        add?: boolean;
        shadow?: Color;
        spacing?: number;
    }): number;
    textWidth(str: string, size?: number, spacing?: number): number;
    /** free it for good: its pass, its buffers, and the texture it made for itself (the shared atlas stays) */
    dispose(): void;
    /** upload this frame's primitives (call before kit.run) */
    end(): this;
}
//# sourceMappingURL=painter.d.ts.map