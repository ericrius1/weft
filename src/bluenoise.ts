// Blue noise by void-and-cluster (Ulichney 1993): a toroidal n×n rank map whose thresholds at any level are evenly
// spread. Per-pixel jitter for raymarchers and dithering: offset it each frame by the golden ratio (fract(v + f·φ))
// and the error stays high-frequency in both space and time — what temporal filters average away best.
import type { Kit } from './kit';
import type { Texture } from './resources';

/** ranks 0..1 (n×n, row-major); deterministic for a seed. n = 64 takes ~50 ms. */
export function blueNoise(n = 64, seed = 7, sigma = 1.5): Float32Array {
  const N = n * n;
  // a toroidal Gaussian, by offset
  const lut = new Float32Array(N);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = Math.min(x, n - x), dy = Math.min(y, n - y);
    lut[y * n + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
  }
  const energy = new Float32Array(N);
  const on = new Uint8Array(N);
  const splat = (i: number, s: number) => {
    const ix = i % n, iy = (i / n) | 0;
    for (let y = 0; y < n; y++) {
      const ry = ((y - iy + n) % n) * n, row = y * n;
      for (let x = 0; x < n; x++) energy[row + x] += s * lut[ry + ((x - ix + n) % n)];
    }
  };
  let r = seed >>> 0 || 1;
  const rand = () => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; return (r >>> 0) / 4294967296; };
  // a random start, a tenth of the cells on
  let ones = 0;
  while (ones < N / 10) { const i = Math.floor(rand() * N); if (!on[i]) { on[i] = 1; splat(i, 1); ones++; } }
  const tightest = () => { let b = -1, e = -Infinity; for (let i = 0; i < N; i++) if (on[i] && energy[i] > e) { e = energy[i]; b = i; } return b; };
  const voidest = () => { let b = -1, e = Infinity; for (let i = 0; i < N; i++) if (!on[i] && energy[i] < e) { e = energy[i]; b = i; } return b; };
  // relax into the prototype pattern: move the tightest cluster's point into the largest void until it settles
  for (let it = 0; it < N; it++) {
    const c = tightest(); on[c] = 0; splat(c, -1);
    const v = voidest();
    if (v === c) { on[c] = 1; splat(c, 1); break; }
    on[v] = 1; splat(v, 1);
  }
  const rank = new Int32Array(N).fill(-1);
  const proto = on.slice(), protoE = energy.slice();
  // phase 1: rank the prototype's points down from ones-1, removing the tightest each time
  for (let k = ones - 1; k >= 0; k--) { const c = tightest(); on[c] = 0; splat(c, -1); rank[c] = k; }
  // phases 2 and 3: from the prototype, fill the largest void each time up to full
  on.set(proto); energy.set(protoE);
  for (let k = ones; k < N; k++) { const v = voidest(); on[v] = 1; splat(v, 1); rank[v] = k; }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = (rank[i] + 0.5) / N;
  return out;
}

/** the blue noise as an r8unorm texture (textureLoad it at pixel % n) */
export function blueNoiseTexture(kit: Kit, n = 64, seed = 7): Texture {
  const v = blueNoise(n, seed);
  const bytes = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) bytes[i] = Math.min(255, Math.floor(v[i] * 256));
  const t = kit.texture({ label: `bluenoise${n}`, format: 'r8unorm', size: [n, n], usage: ['sample', 'copy-dst'] });
  kit.device.queue.writeTexture({ texture: t.gpu }, bytes, { bytesPerRow: n }, [n, n]);
  return t;
}
