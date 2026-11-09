/** one degree of freedom: its limit each way (lo < 0 < hi, radians), its comfortable band, a loaded joint's further
 *  passive limit (optional), and how much its middle pulls (a joint's own preference for neutral) */
export interface Dof {
    lo: number;
    hi: number;
    okLo: number;
    okHi: number;
    pLo?: number;
    pHi?: number;
    pull?: number;
    /** how much a body's suppleness moves this range (1: all of it — the spine, the hips, the hamstrings; a little: the
     *  forearm's turn and the fingers hardly change with age) */
    fk?: number;
}
/** the scale of a DOF's range for a body of suppleness k */
export declare const flexOf: (d: Dof, k: number) => number;
/** the joints measured, each a list of DOFs (named) in its own sign convention (see measure.ts):
 *  - spine segments, neck, head: flex (+ forward), side (+ toward the right), turn (+ to the left)
 *  - hip: flex (+ thigh forward), abd (+ away from the midline), rot (+ external)
 *  - knee: flex (+ bent), varus (+ the shin's foot out), rot (+ external, the foot out)
 *  - ankle: dorsi (+ toes up), inv (+ sole turned in), add (+ toes in)
 *  - toe (the ball's joint): ext (+ toes bent up)
 *  - clavicle: elev (+ shoulder up), prot (+ shoulder forward)
 *  - shoulder: elev (from hanging), cone (from the reachable cone's axis: SHOULDER_CONE), rot (+ external)
 *  - elbow: flex (+ bent; - hyperextended)
 *  - forearm: roll (from its middle: + supinated, the palm up)
 *  - wrist: flex (+ toward the palm), dev (+ toward the thumb)
 *  - fingers' knuckles (MCP): flex, abd; the middle and end joints (PIP, DIP): flex */
export declare const JOINTS: {
    readonly lumbar: {
        readonly flex: Dof;
        readonly side: Dof;
        readonly turn: Dof;
    };
    readonly thoracic: {
        readonly flex: Dof;
        readonly side: Dof;
        readonly turn: Dof;
    };
    readonly neckLow: {
        readonly flex: Dof;
        readonly side: Dof;
        readonly turn: Dof;
    };
    readonly neckUp: {
        readonly flex: Dof;
        readonly side: Dof;
        readonly turn: Dof;
    };
    readonly hip: {
        readonly flex: Dof;
        readonly abd: Dof;
        readonly rot: Dof;
    };
    readonly knee: {
        readonly flex: Dof;
        readonly varus: Dof;
        readonly rot: Dof;
    };
    readonly ankle: {
        readonly dorsi: Dof;
        readonly inv: Dof;
        readonly add: Dof;
    };
    readonly toe: {
        readonly ext: Dof;
    };
    readonly clav: {
        readonly elev: Dof;
        readonly prot: Dof;
    };
    readonly shoulder: {
        readonly elev: Dof;
        readonly cone: Dof;
        readonly rot: Dof;
    };
    readonly elbow: {
        readonly flex: Dof;
    };
    readonly forearm: {
        readonly roll: Dof;
    };
    readonly wrist: {
        readonly flex: Dof;
        readonly dev: Dof;
    };
    readonly mcp: {
        readonly flex: Dof;
        readonly abd: Dof;
    };
    readonly pip: {
        readonly flex: Dof;
    };
    readonly dip: {
        readonly flex: Dof;
    };
};
export type JointName = keyof typeof JOINTS;
/** where a humerus can point (on the thorax, the body's left side; x out, y up, z forward): within 140° of this axis —
 *  overhead and a little past (~30° back, tilted in), out to the side and some way behind it, across the chest, down
 *  behind the back toward the other side (a hand to a back pocket), back to ~70° of extension; not far behind overhead,
 *  not straight back. (A cone fitted to the AAOS ranges: the plane of elevation is meaningless overhead.) */
export declare const SHOULDER_CONE: [number, number, number];
/** the hip's flexion with the knee straight is the hamstrings': ~80° untrained, ~95° for a fit young body, 120°+ for a
 *  yogi (scaled by the body's flexibility); a bent knee frees it to the joint's own limit */
export declare function hipFlexMax(kneeFlex: number, flex?: number): number;
/** the shin's turn grows with the knee's bend (none straight, all of it past ~60°) */
export declare const kneeRotK: (kneeFlex: number) => number;
/** a body's flexibility (its ranges scaled about neutral, the comfortable bands with them): the cast's own */
export declare const FLEX: Record<string, number>;
/** how far a DOF is past its comfortable band, as a fraction of the way to its limit (0 at ease; 1 at the limit; past
 *  1 over it), for a body of flexibility k, loaded or not */
export declare function strain(x: number, d: Dof, k0?: number, loaded?: boolean): number;
/** how ill at ease a DOF is held at x (the solvers' cost): a gentle pull to its middle, quickly worse past its
 *  comfortable band, far worse past its limit (armEase's shape, for any joint) */
export declare function discomfort(x: number, d: Dof, k0?: number, loaded?: boolean): number;
/** each segment's share of the body's mass and where its centre lies from its proximal end to its distal (fraction),
 *  female and male (de Leva's adjustments to Zatsiorsky–Seluyanov) */
export declare const SEGMENTS: {
    readonly head: {
        readonly f: 0.0668;
        readonly m: 0.0694;
        readonly c: readonly [0.5, 0.5];
    };
    readonly thorax: {
        readonly f: 0.1545;
        readonly m: 0.1596;
        readonly c: readonly [0.505, 0.5066];
    };
    readonly abdomen: {
        readonly f: 0.1465;
        readonly m: 0.1633;
        readonly c: readonly [0.4502, 0.4502];
    };
    readonly pelvis: {
        readonly f: 0.1247;
        readonly m: 0.1117;
        readonly c: readonly [0.492, 0.6115];
    };
    readonly uarm: {
        readonly f: 0.0255;
        readonly m: 0.0271;
        readonly c: readonly [0.5754, 0.5772];
    };
    readonly farm: {
        readonly f: 0.0138;
        readonly m: 0.0162;
        readonly c: readonly [0.4559, 0.4574];
    };
    readonly hand: {
        readonly f: 0.0056;
        readonly m: 0.0061;
        readonly c: readonly [0.3427, 0.3624];
    };
    readonly thigh: {
        readonly f: 0.1478;
        readonly m: 0.1416;
        readonly c: readonly [0.3612, 0.4095];
    };
    readonly shank: {
        readonly f: 0.0481;
        readonly m: 0.0433;
        readonly c: readonly [0.4416, 0.4459];
    };
    readonly foot: {
        readonly f: 0.0129;
        readonly m: 0.0137;
        readonly c: readonly [0.4014, 0.4415];
    };
};
//# sourceMappingURL=anatomy.d.ts.map