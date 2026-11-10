import outlineShader from '../shaders/outline.wgsl';
export class Outline {
    depth;
    /** the ink's colour (linear) and strength */
    ink = [0.04, 0.02, 0.1];
    strength = 0.92;
    /** width at 1080 lines (px; scaled with the render's height) */
    width = 1.6;
    /** how sharp a crease (1/z's second difference) and a silhouette (its step) must be to draw */
    crease = 0.012;
    silhouette = 0.18;
    /** redraws a second (0: still) and the wobble (px) */
    boil = 6;
    wobble = 0.7;
    /** lines thin away between these distances (m) */
    fade = [90, 260];
    on = true;
    u;
    constructor(kit, depth) {
        this.depth = depth;
        this.u = kit.uniforms(outlineShader.structs.OutlineU, 'outline');
    }
    addTo(pass) {
        pass.fullscreen(outlineShader, { label: 'outline', bind: { O: this.u, sceneDepth: this.depth }, blend: 'premultiplied', depthCompare: 'always', enabled: () => this.on });
    }
    /** each frame (the render's height, for the width) */
    update(renderHeight) {
        const k = Math.max(0.75, renderHeight / 1080);
        this.u.set({
            ink: [...this.ink, this.strength], p: [this.width * k, this.crease, this.silhouette, this.boil],
            fade: [this.fade[0], this.fade[1], this.wobble * k, 0],
        });
    }
}
//# sourceMappingURL=outline.js.map