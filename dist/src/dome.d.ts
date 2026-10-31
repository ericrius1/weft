import type { Kit } from './kit';
import type { Texture } from './resources';
import { type DomeLayout, type DomeOptions } from './domelayout';
export interface FulldomeOptions extends DomeOptions {
    /** the dome's size (pixels across) */
    size: number;
    /** where each view's finished picture is read from (default: the canvas) */
    source?: Texture;
}
export declare class Fulldome {
    private kit;
    private o;
    readonly layout: DomeLayout;
    /** the last frame's dome (rgba8unorm, size x size) */
    readonly output: Texture;
    private tiles;
    private u;
    private pass;
    private basis;
    constructor(kit: Kit, o: FulldomeOptions);
    /** one dome: each of the six views set on the camera, rendered by `render(k)` (it steps the app), its picture copied
     *  out; then stitched into `output`. The camera is put back as it was. `heading`: the way the dome's bottom faces
     *  (default: the camera's yaw) */
    frame(render: (k: number) => void | Promise<void>, heading?: number): Promise<Texture>;
    /** the last dome back on the CPU */
    read(): Promise<ImageData>;
    destroy(): void;
}
//# sourceMappingURL=dome.d.ts.map