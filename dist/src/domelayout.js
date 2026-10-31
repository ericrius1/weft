// The fulldome's tiles (dome.ts), as numbers: six perspective views that together see the whole upper hemisphere, each
// half of a cube face widened by a margin on every side — the four sides' upper halves (from a little under the
// horizon to a little past 45 degrees up) and the zenith face's two halves — all the same size, so one canvas renders
// every one of them. A tile's frame is its half face: the camera keeps a cube face's axis (level, or straight up) and
// its lens is shifted (Camera.shift) so that half fills the frame. At the tiles' centres the detail matches the
// dome's own: an equidistant dome `size` pixels across has size / pi pixels per radian at every radius.
export function domeLayout(size, o = {}) {
    const margin = o.margin ?? (6 * Math.PI) / 180, f = (size / Math.PI) * (o.oversample ?? 1);
    const a = Math.tan(Math.PI / 4 + margin), d = Math.tan(margin);
    const w = 2 * Math.round(a * f), h = Math.round((a + d) * f);
    // (the top's margin is the sides': y1 = ax; the frame's middle at the middle of [y0, y1])
    const ax = w / (2 * f), ty = h / (2 * f), y1 = ax, y0 = y1 - h / f;
    return {
        size, tile: [w, h], fovY: 2 * Math.atan(ty), shift: -((y1 + y0) / 2) / ty, ax, y0, y1,
        views: (Y) => [[Y, 0], [Y + Math.PI / 2, 0], [Y + Math.PI, 0], [Y - Math.PI / 2, 0], [Y, Math.PI / 2], [Y + Math.PI, Math.PI / 2]].map(([yaw, pitch]) => ({ yaw, pitch })),
    };
}
/** a tile camera's basis (right, up, forward), as weft's Camera builds it from yaw and pitch */
export function viewBasis(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = [-sy * cp, sp, -cy * cp], r = [cy, 0, -sy];
    return [r, [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]], f];
}
/** the direction (world, unit) through a point of the dome (u, v in 0..1 across it, v down), for a heading; null
 *  outside its circle */
export function domeDirection(u, v, heading) {
    const px = u - 0.5, py = v - 0.5, rho = Math.hypot(px, py) * 2;
    if (rho > 1)
        return null;
    const theta = (rho * Math.PI) / 2, phi = Math.atan2(px, py), s = Math.sin(theta);
    const fx = -Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = -Math.sin(heading);
    return [(fx * Math.cos(phi) + rx * Math.sin(phi)) * s, Math.cos(theta), (fz * Math.cos(phi) + rz * Math.sin(phi)) * s];
}
/** each tile's weight for a direction (dome.wgsl's, on the CPU): what a stitch would mix it from */
export function tileWeights(L, d, heading) {
    const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    return L.views(heading).map(({ yaw, pitch }) => {
        const [r, u, f] = viewBasis(yaw, pitch);
        const df = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
        if (df <= 1e-4)
            return 0;
        const x = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / df, y = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / df;
        if (Math.abs(x) > L.ax || y > L.y1 || y < L.y0)
            return 0;
        return ss(0, L.ax - 1, L.ax - Math.abs(x)) * ss(0, L.y1 - 1, L.y1 - y) * ss(0, -2 * L.y0, y - L.y0);
    });
}
//# sourceMappingURL=domelayout.js.map