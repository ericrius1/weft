import type { Kit, Texture, UniformBuffer, RunEntry } from '@ericrius1/weft';
export declare class Cinema {
    private kit;
    params: {
        ao: number;
        aoRadius: number;
        aoPower: number;
        aoDirect: number;
        aoBounce: number;
        mist: number;
        mistHeight: number;
        mistTop: number;
        shafts: number;
        /** 1: show the AO factor */
        debug: number;
    };
    /** time of day (hour): the mist is a morning / evening / night thing */
    hour: number;
    /** extra mist (a place, a mood) on top of the time of day's */
    mistBoost: number;
    u: UniformBuffer<any>;
    private z;
    private aoRaw;
    private aoOut;
    private shA;
    private shB;
    private mistT;
    private mistZ;
    aoItems: RunEntry[];
    airItems: RunEntry[];
    private mistOn;
    private shaftOn;
    under: boolean;
    constructor(kit: Kit, depth: Texture, hdr: Texture, cloudsOut: Texture);
    /** per frame: the uniforms (and which passes run at all) */
    update(time: number, cam: {
        position: ArrayLike<number>;
        viewProj: Float32Array;
    }, light: ArrayLike<number>, night: number, renderH: number, seaLevel: number, cloudsLive: boolean): void;
}
//# sourceMappingURL=cinema.d.ts.map