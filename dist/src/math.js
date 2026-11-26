// Small math for the kit and games: tuples for vectors, column-major Float32Array mat4s (WGSL order), quaternions.
// Projection matrices are reversed-Z (depth 1 at the near plane → 0 far), the kit's one depth convention: clear depth
// to 0, compare 'greater-equal', and remember depthBias signs flip (positive pulls toward the camera).
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const mul3 = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
export const dist = (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; return Math.sqrt(dx * dx + dy * dy + dz * dz); };
export const norm = (a) => { const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a, b, x) => { const t = saturate((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** frame-rate independent exponential approach: rate is 1/seconds */
export const damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);
export const damp3 = (a, b, rate, dt) => { const k = Math.exp(-rate * dt); return [b[0] + (a[0] - b[0]) * k, b[1] + (a[1] - b[1]) * k, b[2] + (a[2] - b[2]) * k]; };
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const angDiff = (a, b) => wrapAngle(b - a);
export const dampAngle = (a, b, rate, dt) => a + angDiff(a, b) * (1 - Math.exp(-rate * dt));
export const rand = (seed) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** deterministic PRNG (mulberry32) */
export function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// ---------------------------------------------------------------- quaternions
export const quatIdentity = () => [0, 0, 0, 1];
export function quatAxisAngle(axis, a) {
    const s = Math.sin(a / 2);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a / 2)];
}
export function quatMul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}
export function quatRotate(q, v) {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
export function quatYawPitchRoll(yaw, pitch, roll = 0) {
    return quatMul(quatMul(quatAxisAngle([0, 1, 0], yaw), quatAxisAngle([1, 0, 0], pitch)), quatAxisAngle([0, 0, 1], roll));
}
export function quatSlerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const s = d < 0 ? -1 : 1;
    d *= s;
    if (d > 0.9995) {
        const r = [a[0] + (b[0] * s - a[0]) * t, a[1] + (b[1] * s - a[1]) * t, a[2] + (b[2] * s - a[2]) * t, a[3] + (b[3] * s - a[3]) * t];
        const l = Math.hypot(...r);
        return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
    }
    const th = Math.acos(d), sn = Math.sin(th);
    const wa = Math.sin((1 - t) * th) / sn, wb = (Math.sin(t * th) / sn) * s;
    return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb];
}
// ---------------------------------------------------------------- mat4 (column-major)
const MAT4_SCRATCH = new Float32Array(16);
export const mat4 = () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
export function mat4Mul(a, b, out = new Float32Array(16)) {
    const r = out === a || out === b ? MAT4_SCRATCH : out;
    const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
    const a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
    const a8 = a[8], a9 = a[9], a10 = a[10], a11 = a[11];
    const a12 = a[12], a13 = a[13], a14 = a[14], a15 = a[15];
    for (let c = 0; c < 16; c += 4) {
        const b0 = b[c], b1 = b[c + 1], b2 = b[c + 2], b3 = b[c + 3];
        r[c] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
        r[c + 1] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
        r[c + 2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
        r[c + 3] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
    }
    if (r !== out)
        out.set(r);
    return out;
}
export function mat4Invert(m, out = new Float32Array(16)) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) {
        out.set(mat4());
        return out;
    }
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
}
/** infinite far plane, reversed-Z: depth = near / -zView */
export function perspectiveReversed(fovY, aspect, near, out = new Float32Array(16)) {
    const f = 1 / Math.tan(fovY / 2);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[11] = -1;
    out[14] = near;
    return out;
}
/** finite reversed-Z perspective (shadow cascades, reflections that need a far plane) */
export function perspectiveReversedFar(fovY, aspect, near, far, out = new Float32Array(16)) {
    const f = 1 / Math.tan(fovY / 2);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = near / (far - near);
    out[11] = -1;
    out[14] = (far * near) / (far - near);
    return out;
}
/** reversed-Z orthographic: depth 1 at -near, 0 at -far (view space looks down -z) */
export function orthoReversed(l, r, b, t, near, far, out = new Float32Array(16)) {
    out.fill(0);
    out[0] = 2 / (r - l);
    out[5] = 2 / (t - b);
    out[10] = 1 / (far - near);
    out[12] = -(r + l) / (r - l);
    out[13] = -(t + b) / (t - b);
    out[14] = far / (far - near);
    out[15] = 1;
    return out;
}
/** view matrix looking from eye along -z toward target */
export function lookAt(eye, target, up = [0, 1, 0], out = new Float32Array(16)) {
    const ex = eye[0], ey = eye[1], ez = eye[2];
    let zx = ex - target[0], zy = ey - target[1], zz = ez - target[2];
    const zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
    zx /= zl;
    zy /= zl;
    zz /= zl;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    let xl = Math.sqrt(xx * xx + xy * xy + xz * xz);
    if (xl < 1e-6) {
        xx = -zy;
        xy = zx;
        xz = 0;
        xl = Math.sqrt(xx * xx + xy * xy) || 1;
    }
    xx /= xl;
    xy /= xl;
    xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    out[0] = xx;
    out[1] = yx;
    out[2] = zx;
    out[3] = 0;
    out[4] = xy;
    out[5] = yy;
    out[6] = zy;
    out[7] = 0;
    out[8] = xz;
    out[9] = yz;
    out[10] = zz;
    out[11] = 0;
    out[12] = -(xx * ex + xy * ey + xz * ez);
    out[13] = -(yx * ex + yy * ey + yz * ez);
    out[14] = -(zx * ex + zy * ey + zz * ez);
    out[15] = 1;
    return out;
}
/** model matrix from rotation quaternion, translation and scale */
export function compose(q, t, s = 1, out = new Float32Array(16)) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const sx = typeof s === 'number' ? s : s[0], sy = typeof s === 'number' ? s : s[1], sz = typeof s === 'number' ? s : s[2];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    out[0] = (1 - (yy + zz)) * sx;
    out[1] = (xy + wz) * sx;
    out[2] = (xz - wy) * sx;
    out[3] = 0;
    out[4] = (xy - wz) * sy;
    out[5] = (1 - (xx + zz)) * sy;
    out[6] = (yz + wx) * sy;
    out[7] = 0;
    out[8] = (xz + wy) * sz;
    out[9] = (yz - wx) * sz;
    out[10] = (1 - (xx + yy)) * sz;
    out[11] = 0;
    out[12] = t[0];
    out[13] = t[1];
    out[14] = t[2];
    out[15] = 1;
    return out;
}
export function transformPoint(m, p) {
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15] || 1;
    return [(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w, (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w, (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w];
}
/** the six frustum planes (a, b, c, d with normals pointing inward) of a view-projection matrix */
export function frustumPlanes(m, out = new Float32Array(24)) {
    const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
    const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
    const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
    const m12 = m[12], m13 = m[13], m14 = m[14], m15 = m[15];
    let a, b, c, d, l;
    // left: r3 + r0
    a = m3 + m0;
    b = m7 + m4;
    c = m11 + m8;
    d = m15 + m12;
    l = Math.sqrt(a * a + b * b + c * c) || 1;
    out[0] = a / l;
    out[1] = b / l;
    out[2] = c / l;
    out[3] = d / l;
    // right: r3 - r0
    a = m3 - m0;
    b = m7 - m4;
    c = m11 - m8;
    d = m15 - m12;
    l = Math.sqrt(a * a + b * b + c * c) || 1;
    out[4] = a / l;
    out[5] = b / l;
    out[6] = c / l;
    out[7] = d / l;
    // bottom: r3 + r1
    a = m3 + m1;
    b = m7 + m5;
    c = m11 + m9;
    d = m15 + m13;
    l = Math.sqrt(a * a + b * b + c * c) || 1;
    out[8] = a / l;
    out[9] = b / l;
    out[10] = c / l;
    out[11] = d / l;
    // top: r3 - r1
    a = m3 - m1;
    b = m7 - m5;
    c = m11 - m9;
    d = m15 - m13;
    l = Math.sqrt(a * a + b * b + c * c) || 1;
    out[12] = a / l;
    out[13] = b / l;
    out[14] = c / l;
    out[15] = d / l;
    // far: r2 (reversed-Z: depth >= 0 → z_clip >= 0)
    a = m2;
    b = m6;
    c = m10;
    d = m14;
    l = Math.sqrt(a * a + b * b + c * c) || 1;
    out[16] = a / l;
    out[17] = b / l;
    out[18] = c / l;
    out[19] = d / l;
    // near: r3 - r2 (z_clip <= w)
    a = m3 - m2;
    b = m7 - m6;
    c = m11 - m10;
    d = m15 - m14;
    l = Math.sqrt(a * a + b * b + c * c) || 1;
    out[20] = a / l;
    out[21] = b / l;
    out[22] = c / l;
    out[23] = d / l;
    return out;
}
//# sourceMappingURL=math.js.map