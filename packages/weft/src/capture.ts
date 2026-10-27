// Frames read back from the GPU, for screenshots and films. Headless Chrome (on Windows at least) doesn't composite a
// WebGPU canvas into a page screenshot, and a film wants every frame at a fixed step whatever the machine's speed:
// so the canvas is configured as a copy source, a frame is stepped by hand (kit.step) and its swapchain texture copied
// out before the browser presents it.
//
//   const cap = new Capture(kit);
//   const png = await cap.grab();                 // a data URL
//   const jpg = await cap.blob('image/jpeg', 0.93, 1 / 30);   // one film frame, 1/30 s after the last
import type { Kit } from './kit';
import { BUF, MAP, TEX } from './gpuconst';

export class Capture {
  private canvas2d: HTMLCanvasElement | null = null;
  constructor(private kit: Kit) {
    kit.context.configure({ device: kit.device, format: kit.format, alphaMode: 'opaque', usage: TEX.RENDER_ATTACHMENT | TEX.COPY_SRC });
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
    const w = tex.width, h = tex.height, row = Math.ceil((w * 4) / 256) * 256;
    const buf = k.device.createBuffer({ label: 'capture', size: row * h, usage: BUF.COPY_DST | BUF.MAP_READ });
    const enc = k.device.createCommandEncoder({ label: 'capture' });
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: row }, [w, h]);
    k.queue.submit([enc.finish()]);
    await buf.mapAsync(MAP.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const out = new ImageData(w, h);
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
