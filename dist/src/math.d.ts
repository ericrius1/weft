export type V2 = [number, number];
export type V3 = [number, number, number];
export type V4 = [number, number, number, number];
export type Quat = [number, number, number, number];
export type M4 = Float32Array;
export declare const v3: (x?: number, y?: number, z?: number) => V3;
export declare const add: (a: ArrayLike<number>, b: ArrayLike<number>) => V3;
export declare const sub: (a: ArrayLike<number>, b: ArrayLike<number>) => V3;
export declare const scale: (a: ArrayLike<number>, s: number) => V3;
export declare const mul3: (a: ArrayLike<number>, b: ArrayLike<number>) => V3;
export declare const madd: (a: ArrayLike<number>, b: ArrayLike<number>, s: number) => V3;
export declare const dot: (a: ArrayLike<number>, b: ArrayLike<number>) => number;
export declare const cross: (a: ArrayLike<number>, b: ArrayLike<number>) => V3;
export declare const len: (a: ArrayLike<number>) => number;
export declare const dist: (a: ArrayLike<number>, b: ArrayLike<number>) => number;
export declare const norm: (a: ArrayLike<number>) => V3;
export declare const lerp: (a: number, b: number, t: number) => number;
export declare const lerp3: (a: ArrayLike<number>, b: ArrayLike<number>, t: number) => V3;
export declare const clamp: (x: number, a: number, b: number) => number;
export declare const saturate: (x: number) => number;
export declare const smoothstep: (a: number, b: number, x: number) => number;
/** frame-rate independent exponential approach: rate is 1/seconds */
export declare const damp: (a: number, b: number, rate: number, dt: number) => number;
export declare const damp3: (a: ArrayLike<number>, b: ArrayLike<number>, rate: number, dt: number) => V3;
export declare const wrapAngle: (a: number) => number;
export declare const angDiff: (a: number, b: number) => number;
export declare const dampAngle: (a: number, b: number, rate: number, dt: number) => number;
export declare const rand: (seed: number) => number;
/** deterministic PRNG (mulberry32) */
export declare function rng(seed: number): () => number;
export declare const quatIdentity: () => Quat;
export declare function quatAxisAngle(axis: ArrayLike<number>, a: number): Quat;
export declare function quatMul(a: Quat, b: Quat): Quat;
export declare function quatRotate(q: Quat, v: ArrayLike<number>): V3;
export declare function quatYawPitchRoll(yaw: number, pitch: number, roll?: number): Quat;
export declare function quatSlerp(a: Quat, b: Quat, t: number): Quat;
export declare const mat4: () => Float32Array<ArrayBuffer>;
export declare function mat4Mul(a: ArrayLike<number>, b: ArrayLike<number>, out?: M4): M4;
export declare function mat4Invert(m: ArrayLike<number>, out?: M4): M4;
/** infinite far plane, reversed-Z: depth = near / -zView */
export declare function perspectiveReversed(fovY: number, aspect: number, near: number, out?: M4): M4;
/** finite reversed-Z perspective (shadow cascades, reflections that need a far plane) */
export declare function perspectiveReversedFar(fovY: number, aspect: number, near: number, far: number, out?: M4): M4;
/** reversed-Z orthographic: depth 1 at -near, 0 at -far (view space looks down -z) */
export declare function orthoReversed(l: number, r: number, b: number, t: number, near: number, far: number, out?: M4): M4;
/** view matrix looking from eye along -z toward target */
export declare function lookAt(eye: ArrayLike<number>, target: ArrayLike<number>, up?: ArrayLike<number>, out?: M4): M4;
/** model matrix from rotation quaternion, translation and scale */
export declare function compose(q: ArrayLike<number>, t: ArrayLike<number>, s?: ArrayLike<number> | number, out?: M4): M4;
export declare function transformPoint(m: ArrayLike<number>, p: ArrayLike<number>): V3;
/** the six frustum planes (a, b, c, d with normals pointing inward) of a view-projection matrix */
export declare function frustumPlanes(m: ArrayLike<number>, out?: Float32Array): Float32Array;
//# sourceMappingURL=math.d.ts.map