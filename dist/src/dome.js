import { TEX } from './gpuconst';
import { domeLayout } from './domelayout';
import domeShader from '../shaders/dome.wgsl';
export class Fulldome {
    kit;
    o;
    layout;
    /** the last frame's dome (rgba8unorm, size x size) */
    output;
    tiles;
    u;
    pass;
    basis = Array.from({ length: 18 }, () => [0, 0, 0, 0]);
    constructor(kit, o) {
        this.kit = kit;
        this.o = o;
        const L = (this.layout = domeLayout(o.size, o));
        const [w, h] = L.tile, [rw, rh] = kit.size.render;
        if (rw !== w || rh !== h)
            throw new Error(`Fulldome: the views render at ${rw}x${rh}; a ${o.size} dome's want ${w}x${h} (size the canvas to domeLayout(size).tile)`);
        if (!o.source)
            kit.configureCanvas(TEX.COPY_SRC);
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
    async frame(render, heading = this.kit.camera.yaw) {
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
        }
        finally {
            cam.yaw = was.yaw;
            cam.pitch = was.pitch;
            cam.roll = was.roll;
            cam.fovY = was.fovY;
            cam.shift = was.shift;
            cam.viewOverride = was.override;
        }
        const sy = Math.sin(heading), cy = Math.cos(heading);
        this.u.set({ fwd: [-sy, 0, -cy, this.o.size], right: [cy, 0, -sy, L.ax], ext: [L.y1, L.y0, 1, 0], basis: this.basis });
        kit.run([this.pass]);
        return this.output;
    }
    /** the last dome back on the CPU */
    async read() {
        const n = this.o.size;
        return new ImageData(new Uint8ClampedArray(await this.output.read()), n, n);
    }
    destroy() { this.tiles.destroy(); this.output.destroy(); this.u.destroy(); this.pass.dispose(); }
}
//# sourceMappingURL=dome.js.map