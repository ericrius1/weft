// Math.random, seeded, per bundle (each build's own, reset per act)
let s = 1;
export const __rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
export const __seed = (v: number) => { s = v >>> 0 || 1; };
