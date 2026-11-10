export type Device = 'kbm' | 'pad' | 'touch';
export declare const PAD: {
    readonly A: 0;
    readonly B: 1;
    readonly X: 2;
    readonly Y: 3;
    readonly LB: 4;
    readonly RB: 5;
    readonly LT: 6;
    readonly RT: 7;
    readonly VIEW: 8;
    readonly MENU: 9;
    readonly L3: 10;
    readonly R3: 11;
    readonly UP: 12;
    readonly DOWN: 13;
    readonly LEFT: 14;
    readonly RIGHT: 15;
};
export declare class Input {
    readonly target: HTMLElement;
    readonly keys: Set<string>;
    private hits;
    private ups;
    mouseDX: number;
    mouseDY: number;
    wheel: number;
    buttons: number;
    private mouseHits;
    private mouseUps;
    locked: boolean;
    lastDevice: Device;
    /** standard-mapping gamepad state (null if none) */
    pad: {
        axes: number[];
        buttons: number[];
    } | null;
    private padPrev;
    /** ignore input while typing in a form field */
    private typing;
    constructor(target: HTMLElement);
    down(code: string): boolean;
    hit(code: string): boolean;
    released(code: string): boolean;
    mouse(button?: number): boolean;
    mouseHit(button?: number): boolean;
    mouseReleased(button?: number): boolean;
    /** -1..1 from two keys (and optionally a gamepad axis) */
    axis(neg: string | string[], pos: string | string[], padAxis?: number): number;
    padDown(i: number): boolean;
    padHit(i: number): boolean;
    padValue(i: number): number;
    lock(): void;
    unlock(): void;
    /** poll the gamepad (call at the start of the frame) */
    update(): void;
    /** clear this frame's edges and deltas */
    endFrame(): void;
}
//# sourceMappingURL=input.d.ts.map