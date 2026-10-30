// Fulldome: a planetarium's domemaster — a 180-degree equidistant fisheye, the zenith at the centre, the heading at the
// bottom rim and its right on the right — made from six ordinary perspective views of one moment (domelayout.ts: the
// four sides' upper halves and the zenith's two halves, every one the same size, lens-shifted with Camera.shift), then
// stitched on the GPU with every seam feathered across the margin the views overlap by (shaders/dome.wgsl). The dome
// stays level: only the camera's heading is kept.
//
// The app renders each view however it renders a frame (kit.step, its own post chain); the view's finished picture is
// read from `source` — a texture the size of the canvas with 'copy-src' in its usage, or by default the canvas itself.
// The first view should move the world on by the frame's time and the other five barely at all (a tiny step, not zero:
// velocities divided by it), so all six show one moment. What a view draws in screen space and can't be stitched is the
// app's to turn off for a dome: vignetting, film grain, chromatic aberration, lens flares and screen-space sun shafts
// (they follow the sun's place on the screen), camera motion blur (it sees the turn between views as motion), temporal
// accumulation (each view's history is another view's). Shaders that rebuild view rays must honour the projection's
// off-axis part (frame.wgsl's viewRay does).
//
//   const L = domeLayout(4096);                 // size the canvas to L.tile first (CSS pixels at a pixel ratio of 1)
//   const dome = new Fulldome(kit, { size: 4096, source: post.film });
//   await dome.frame((k) => kit.step(k === 0 ? 1 / 30 - 5e-4 : 1e-4));
//   const img = await dome.read();              // ImageData, size x size (or dome.output, a texture)
import type { Kit } from './kit';
import type { RenderPass } from './passes';
import type { Texture, UniformBuffer } from './resources';
import { TEX } from './gpuconst';
import { domeLayout, type DomeLayout, type DomeOptions } from './domelayout';
import domeShader from '../shaders/dome.wgsl';

export interface FulldomeOptions extends DomeOptions {
  /** the dome's size (pixels across) */
  size: number;
  /** where each view's finished picture is read from (default: the canvas) */
  source?: Texture;
}

export class Fulldome {
  readonly layout: DomeLayout;
  /** the last frame's dome (rgba8unorm, size x size) */
  readonly output: Texture;
  private tiles: Texture;
  private u: UniformBuffer<any>;
  private pass: RenderPass;
  private basis: number[][] = Array.from({ length: 18 }, () => [0, 0, 0, 0]);

  constructor(private kit: Kit, private o: FulldomeOptions) {
    const L = (this.layout = domeLayout(o.size, o));
    const [w, h] = L.tile, [rw, rh] = kit.size.render;
    if (rw !== w || rh !== h) throw new Error(`Fulldome: the views render at ${rw}x${rh}; a ${o.size} dome's want ${w}x${h} (size the canvas to domeLayout(size).tile)`);
    if (!o.source) kit.configureCanvas(TEX.COPY_SRC);
    const format = o.source?.format ?? kit.format;
    this.tiles = kit.texture({ label: 'dome.tiles', format, size: [w, h, 6], view: '2d-array', usage: ['sample', 'copy-dst'] });
    this.output = kit.texture({ label: 'dome.out', format: 'rgba8unorm', size: [o.size, o.size], usage: ['render', 'copy-src', 'sample'] });
    this.u = kit.uniforms(domeShader.structs.DomeU, 'dome');
    this.pass = kit.pass({ label: 'dome.stitch', color: [{ target: this.output, clear: [0, 0, 0, 1] }] });
    this.pass.fullscreen(domeShader, { label: 'dome.stitch', bind: { DU: this.u, tiles: this.tiles } });
  }

  /** one dome: each of the six views set on the camera, rendered by `render(k)` (it steps the app), its picture copied
   *  out; then stitched into `output`. The camera is put back as it was. `heading`: the way the dome's bottom faces
   *  (default: the camera's yaw) */
  async frame(render: (k: number) => void | Promise<void>, heading = this.kit.camera.yaw): Promise<Texture> {
    const kit = this.kit, cam = kit.camera, L = this.layout, [w, h] = L.tile;
    const was = { yaw: cam.yaw, pitch: cam.pitch, roll: cam.roll, fovY: cam.fovY, shift: cam.shift, override: cam.viewOverride };
    const views = L.views(heading);
    try {
      for (let k = 0; k < views.length; k++) {
        cam.viewOverride = null;
        cam.yaw = views[k].yaw;
        cam.pitch = views[k].pitch;
        cam.roll = 0;
        cam.fovY = L.fovY;
        cam.shift = [0, L.shift];
        // (no motion between one view and the next: the previous view is this one)
        cam.cut();
        await render(k);
        this.basis[k * 3] = [cam.right[0], cam.right[1], cam.right[2], 0];
        this.basis[k * 3 + 1] = [cam.up[0], cam.up[1], cam.up[2], 0];
        this.basis[k * 3 + 2] = [cam.forward[0], cam.forward[1], cam.forward[2], 0];
        const src = this.o.source?.gpu ?? kit.context.getCurrentTexture();
        const enc = kit.device.createCommandEncoder({ label: 'dome.view' });
        enc.copyTextureToTexture({ texture: src }, { texture: this.tiles.gpu, origin: [0, 0, k] }, [w, h, 1]);
        kit.queue.submit([enc.finish()]);
      }
    } finally {
      cam.yaw = was.yaw; cam.pitch = was.pitch; cam.roll = was.roll; cam.fovY = was.fovY; cam.shift = was.shift; cam.viewOverride = was.override;
    }
    const sy = Math.sin(heading), cy = Math.cos(heading);
    this.u.set({ fwd: [-sy, 0, -cy, this.o.size], right: [cy, 0, -sy, L.ax], ext: [L.y1, L.y0, 1, 0], basis: this.basis });
    kit.run([this.pass]);
    return this.output;
  }

  /** the last dome back on the CPU */
  async read(): Promise<ImageData> {
    const n = this.o.size;
    return new ImageData(new Uint8ClampedArray(await this.output.read()), n, n);
  }

  destroy() { this.tiles.destroy(); this.output.destroy(); this.u.destroy(); this.pass.dispose(); }
}
