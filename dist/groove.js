const TAU = Math.PI * 2;
/** a beat's give: down quickly on the beat, up slowly through the skank (0..1, peak just after the beat) */
function give(ph) {
    const u = ((ph % 1) + 1) % 1;
    return u < 0.18 ? Math.sin((u / 0.18) * Math.PI * 0.5) : 0.5 + 0.5 * Math.cos(((u - 0.18) / 0.82) * Math.PI);
}
/** the dance at this point of the bar (bar 0..1, beat 3 at 0.5), by k (0 still .. 1 dancing), the kick's punch */
export function groove(bar, k, F, kick = 0, out = { bounce: 0, sway: 0, twist: 0, rock: 0, roll: 0, nod: 0, tilt: 0 }) {
    const beats = bar * 4;
    const beatIn = Math.floor(((beats % 4) + 4) % 4);
    const g = give(beats);
    const onDrop = beatIn === 2 ? 1 : 0;
    out.bounce = k * (F.dip * g + F.drop * onDrop * g + 0.006 * kick);
    // (the weight over the left foot on the one, the right on the drop)
    const sw = Math.cos(TAU * bar);
    out.sway = k * F.sway * sw;
    out.twist = k * F.twist * Math.sin(TAU * bar);
    out.roll = -k * F.roll * sw;
    out.rock = k * F.rock * (give(beats + 0.5) - 0.5);
    out.nod = k * (F.nod * (give(beats - F.lag) - 0.35) + 0.4 * F.nod * onDrop * give(beats - F.lag));
    out.tilt = k * F.tilt * sw;
    return out;
}
/** a groove blended over another by w (and added: a strike's turn over the dance) */
export function mixGroove(a, b, w = 1) {
    return {
        bounce: a.bounce + (b.bounce ?? 0) * w, sway: a.sway + (b.sway ?? 0) * w, twist: a.twist + (b.twist ?? 0) * w, rock: a.rock + (b.rock ?? 0) * w,
        roll: a.roll + (b.roll ?? 0) * w, nod: a.nod + (b.nod ?? 0) * w, tilt: a.tilt + (b.tilt ?? 0) * w,
    };
}
//# sourceMappingURL=groove.js.map