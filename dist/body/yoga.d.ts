import { type V3 } from '../math.js';
import type { BodyGoal, BodyModel } from './solve.js';
export type YogaPose = 'mountain' | 'salute' | 'fold' | 'half' | 'plank' | 'chaturanga' | 'updog' | 'dog' | 'child' | 'lungeR' | 'lungeL' | 'warrior1R' | 'warrior2R' | 'treeL' | 'treeR' | 'squat' | 'prayer';
export declare const YOGA_POSES: YogaPose[];
/** where the mat is: its origin (on the ground between the feet) and the way its front faces (yaw: 0 toward -z) */
export interface Mat {
    at: V3;
    yaw: number;
}
/** a pose's goal for a body on a mat (stiff: 0 supple .. 1 an old man's: what it asks less of) */
export declare function yogaGoal(M: BodyModel, mat: Mat, pose: YogaPose, flex?: number): BodyGoal;
//# sourceMappingURL=yoga.d.ts.map