// Frames read back from the GPU, for screenshots and films. Headless Chrome (on Windows at least) doesn't composite a
// WebGPU canvas into a page screenshot, and a film wants every frame at a fixed step whatever the machine's speed:
// so the canvas is configured as a copy source, a frame is stepped by hand (kit.step) and its swapchain texture copied
// out before the browser presents it. An HDR canvas (kit.hdr) is read as SDR sRGB: Display P3 converted, past-white
// clipped.
//
//   const cap = new Capture(kit);
//   const png = await cap.grab();                 // a data URL
//   const jpg = await cap.blob('image/jpeg', 0.93, 1 / 30);   // one film frame, 1/30 s after the last
import type { Kit } from './kit';
import { BUF, MAP, TEX } from './gpuconst';

export class Capture {
  private canvas2d: HTMLCanvasElement | null = null;
  constructor(private kit: Kit) {
    kit.configureCanvas(TEX.COPY_SRC);
  }

  /** let n frames of the live loop go by */
  frames(n: number) {
    return new Promise<void>((done) => {
      const t0 = this.kit.frameIndex;
      const wait = () => (this.kit.frameIndex - t0 >= n ? done() : requestAnimationFrame(wait));
      requestAnimationFrame(wait);
    });
  }

  /** one frame stepped by hand (dt seconds) and read back: RGBA, top row first */
  async step(dt: number): Promise<ImageData> {
    const k = this.kit;
    // (stepped synchronously: the live loop's next animation frame is already queued and carries on after)
    k.step(dt);
    const tex = k.context.getCurrentTexture();
    const half = tex.format === 'rgba16float', px = half ? 8 : 4;
    const w = tex.width, h = tex.height, row = Math.ceil((w * px) / 256) * 256;
    const buf = k.device.createBuffer({ label: 'capture', size: row * h, usage: BUF.COPY_DST | BUF.MAP_READ });
    const enc = k.device.createCommandEncoder({ label: 'capture' });
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: row }, [w, h]);
    k.queue.submit([enc.finish()]);
    await buf.mapAsync(MAP.READ);
    const out = new ImageData(w, h);
    if (half) toSrgb8(new Uint16Array(buf.getMappedRange()), row / 2, w, h, k.hdr.colorSpace === 'display-p3', out.data);
    else {
      const src = new Uint8Array(buf.getMappedRange());
      const bgra = tex.format.startsWith('bgra');
      for (let y = 0; y < h; y++) {
        const s = y * row, d = y * w * 4;
        for (let x = 0; x < w * 4; x += 4) {
          out.data[d + x] = src[s + x + (bgra ? 2 : 0)];
          out.data[d + x + 1] = src[s + x + 1];
          out.data[d + x + 2] = src[s + x + (bgra ? 0 : 2)];
          out.data[d + x + 3] = 255;
        }
      }
    }
    buf.unmap();
    buf.destroy();
    return out;
  }

  /** a frame as an image (data URL) */
  async grab(type = 'image/png', quality = 0.92, dt = 1 / 60): Promise<string> {
    const img = await this.step(dt);
    const c = (this.canvas2d ??= document.createElement('canvas'));
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    return c.toDataURL(type, quality);
  }

  /** a frame as an encoded file (a film's frames) */
  async blob(type = 'image/jpeg', quality = 0.93, dt = 1 / 30): Promise<Blob> {
    const img = await this.step(dt);
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext('2d')!.putImageData(img, 0, 0);
    return c.convertToBlob({ type, quality });
  }
}

// half floats → numbers, all 65536 of them
let halves: Float32Array | null = null;
function halfTable() {
  if (halves) return halves;
  halves = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const e = (i >> 10) & 31, m = i & 1023, sign = i & 0x8000 ? -1 : 1;
    halves[i] = sign * (e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15));
  }
  return halves;
}
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** an rgba16float frame (values in the canvas colour space, sRGB-encoded) as 8-bit sRGB: a Display P3 one converted
 *  through linear light, everything past white clipped */
function toSrgb8(src: Uint16Array, rowHalves: number, w: number, h: number, p3: boolean, out: Uint8ClampedArray) {
  const t = halfTable();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = y * rowHalves + x * 4, d = (y * w + x) * 4;
      let r = t[src[s]], g = t[src[s + 1]], b = t[src[s + 2]];
      if (p3) {
        const lr = decode(r), lg = decode(g), lb = decode(b);
        r = encode(1.2249401 * lr - 0.2249404 * lg);
        g = encode(-0.0420569 * lr + 1.0420571 * lg);
        b = encode(-0.0196376 * lr - 0.0786361 * lg + 1.0982735 * lb);
      }
      out[d] = byte(r); out[d + 1] = byte(g); out[d + 2] = byte(b); out[d + 3] = 255;
    }
  }
}
