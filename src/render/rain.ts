// Rain (shaders/rain.wgsl): drops and splashes, drawn into an hdr pass with the scene's depth read-only (the fx pass).
// Nothing simulated: every drop's place is a function of its index and the time — the box round the camera wraps
// them — so it costs only the drawing. `intensity` thins it (0 dry .. 1 a downpour); `wind` slants it.
import type { Kit, RenderPass, Texture, UniformBuffer, V3 } from '@ericrius1/weft';
import rainShader from '../shaders/rain.wgsl';

export class Rain {
  params = {
    /** the most drops and splashes drawn (the intensity thins them) */
    drops: 26000, splashes: 1800,
    /** 0..1 */
    intensity: 1,
    /** fall speed (m/s), a drop's width (m), the streaks' exposure (s), a splash's life (s) */
    fall: 8.5, width: 0.0016, exposure: 1 / 50, splashLife: 0.22,
    /** the box round the camera (m) */
    box: [46, 30, 46] as V3,
  };
  /** the wind (m/s) */
  wind: V3 = [0, 0, 0];
  on = true;
  private u: UniformBuffer<any>;
  private camVel: V3 = [0, 0, 0];
  private last: V3 | null = null;
  private time = 0;

  constructor(kit: Kit, private depth: Texture) {
    this.u = kit.uniforms(rainShader.structs.RainU, 'rain');
  }

  /** the drops and the splashes into a pass (hdr, the scene's depth read-only) */
  addTo(pass: RenderPass) {
    const bind = { R: this.u, sceneDepth: this.depth };
    pass.draw(rainShader, { label: 'rain.drops', vertex: 'vs_drop', fragment: 'fs_drop', bind, count: 6, instances: () => Math.round(this.params.drops), blend: 'add', depthWrite: false, cull: 'none', enabled: () => this.on && this.params.intensity > 0.01 });
    pass.draw(rainShader, { label: 'rain.splashes', vertex: 'vs_splash', fragment: 'fs_splash', bind, count: 6, instances: () => Math.round(this.params.splashes), blend: 'add', depthWrite: false, depthCompare: 'always', cull: 'none', enabled: () => this.on && this.params.intensity > 0.01 });
  }

  update(dt: number, cam: V3) {
    this.time += dt;
    if (this.last && dt > 0) {
      const v: V3 = [(cam[0] - this.last[0]) / dt, (cam[1] - this.last[1]) / dt, (cam[2] - this.last[2]) / dt];
      // (eased: a cut shouldn't fling the streaks across the screen)
      const k = Math.hypot(...v) > 200 ? 0 : 1 - Math.exp(-dt * 12);
      this.camVel = [this.camVel[0] + (v[0] - this.camVel[0]) * k, this.camVel[1] + (v[1] - this.camVel[1]) * k, this.camVel[2] + (v[2] - this.camVel[2]) * k];
    }
    this.last = [...cam];
    const P = this.params;
    this.u.set({
      box: [...P.box, P.drops],
      fall: [this.wind[0], -P.fall + this.wind[1], this.wind[2], P.intensity],
      cam: [...this.camVel, P.exposure],
      misc: [this.time, P.splashes, P.width, P.splashLife],
    });
  }
}
