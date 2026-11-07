import { type Camera, type V3 } from '@ericrius1/weft';
export interface Pose {
    at: V3;
    yaw: number;
    pitch: number;
}
export interface Stop {
    pose: Pose;
    name: string;
    about?: string;
    /** held without the slow turn (someone in the middle of it: June at her easel) */
    still?: boolean;
}
/** the keys (KeyboardEvent.key) that never take the camera back by default: the modifiers, Tab, and San Francisco's
 *  panel and guide (/, ?) */
export declare const PASS_KEYS: string[];
/** the key codes that never take it back by default (San Francisco's: T the tour itself, H the guide, P the places) */
export declare const PASS_CODES: string[];
export declare class Autopilot {
    private cam;
    private ground;
    private tourStops;
    private say;
    private reduced;
    state: 'idle' | 'flying' | 'holding';
    /** the tour's on (flying between its stops, or holding one) */
    touring: boolean;
    /** told when the tour starts or stops (the places list's button follows) */
    onTour: ((on: boolean) => void) | null;
    /** told when a flight's over: true if it arrived, false if a hand took the camera back */
    onFlown: ((arrived: boolean) => void) | null;
    /** the line when a hand stops the tour (how to go on: the interface says, by what's to hand) */
    stopLine: string;
    private from;
    private to;
    private t;
    private T;
    private arc;
    private along;
    private short;
    private hold;
    private pan;
    private stops;
    private at;
    /** keys (KeyboardEvent.key) and codes that never take the camera back (the game's own panel keys, its tour key) */
    passKeys: Set<string>;
    passCodes: Set<string>;
    /** a flight's least and most length (s), and how high a long one arcs at most (m) */
    shortest: number;
    longest: number;
    ceiling: number;
    /** the seconds the tour holds each stop */
    holdFor: number;
    /** `ground`: the land's height; `stops`: the tour's, made fresh as it starts; `say`: a line at the top of the view;
     *  `reduced`: less motion (prefers-reduced-motion by default): flights cut, holds still */
    constructor(cam: Camera, ground: (x: number, z: number) => number, canvas: HTMLElement, tourStops: () => Stop[], say: (html: string, seconds: number) => void, reduced?: boolean);
    get busy(): boolean;
    /** fly from where the camera is to a view */
    fly(to: Pose): void;
    /** the tour: from its first stop, or on from the one it was stopped at */
    tour(on?: boolean): void;
    private next;
    /** a hand on the controls: everything stops where it is */
    private takeBack;
    /** stop without a word (another place chosen, one of the cast put on) */
    cancel(): void;
    /** each frame, after the controls (it has the camera's last word while it flies) */
    update(dt: number): void;
}
//# sourceMappingURL=autopilot.d.ts.map