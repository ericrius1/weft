import type { Kit, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
export declare const RINGS = 150;
export declare const SEGMENTS = 192;
export declare class Ocean {
    index: StorageBuffer;
    count: number;
    vertexCount: number;
    uniforms: UniformBuffer<any>;
    waves: {
        d: [number, number];
        k: number;
        a: number;
        w: number;
        q: number;
        phase: number;
    }[];
    constructor(kit: Kit);
    /** swell height (m, roughly the biggest wave's) and the wind's direction */
    setSea(height: number, wind: [number, number]): void;
    /** sea surface height (Gerstner sum, no horizontal correction) at a point — swimming, buoyancy */
    heightAt(x: number, z: number, t: number, fade?: number): number;
}
//# sourceMappingURL=ocean.d.ts.map