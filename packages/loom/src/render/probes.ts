// Diffuse global illumination from a grid of irradiance probes (probes.wgsl; read by env.wgsl's giProbe / ambientAt).
// A box of probes `spacing` metres apart, each the light arriving at its point from every direction (L1 spherical
// harmonics): the sky as it's seen past what's in the way, and the lit surfaces around — the light they bounce. The
// surfaces' ambient light comes from the probes around them in place of the open sky's, so a courtyard's floor gets
// darker and warmer than a field's, a red wall reddens what faces it, a street between towers is lit by the towers.
//
// The probes see a source pass's draws (Renderer: the sea's mirror pass by default, where a game already puts what's
// worth reflecting and its sky), replayed into six small cube faces from each probe's point (RenderPassOptions.replay)
// — a few probes a frame, the never-captured nearest the camera first, then round and round, the oldest and nearest
// first: so it fills in over a few seconds and follows the time of day, each recapture blended into what the probe
// held. The surfaces' own lighting reads the probes too, so each recapture carries one more bounce.
//
// Probes inside something (a wall, a rock: most of their cube a surface right up against them) are marked untrusted
// and left out of the blend; `ground` lifts the ones under the terrain onto it. The capture views set Frame.user.y = 1,
// so a sky shader can leave its sun's disc out (the sun's light is the surfaces' direct light, not their ambient).
import type { Kit, RenderPass, RunEntry, Texture, UniformBuffer, V3, Compute, View } from '@ericrius1/weft';
import { Camera, lookAt, RunAction } from '@ericrius1/weft';
import probeShader from '../shaders/probes.wgsl';

export interface ProbeGridOptions {
  /** the pass whose draws the probes see (one sample, rgba16float + depth32float targets: the mirror pass's) */
  source: RenderPass;
  /** the volume: least and greatest corners (m), the probes' spacing (m) */
  min: V3; max: V3; spacing: number;
  /** a cube face's size, texels a side (default 24) */
  face?: number;
  /** the most probes captured in one frame (default 2; 8 at most) */
  maxPerFrame?: number;
  /** the ground's height at (x, z): probes under it are lifted onto it (or left out when that's beyond their cell) */
  ground?: (x: number, z: number) => number;
}

const FACES: [V3, V3][] = [[[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, 1]], [[0, -1, 0], [0, 0, -1]], [[0, 0, 1], [0, 1, 0]], [[0, 0, -1], [0, 1, 0]]];
const MAX_SLOTS = 8;

export class ProbeGrid {
  /** on (off: the sky's ambient everywhere, nothing captured); strength (the probes' light ×); perFrame (probes
   *  captured a frame); blend (a recapture's share of what the probe ends up holding: lower is steadier, slower to
   *  follow the light); normalBias / viewBias (how far a surface's read is pushed off it, along its normal and toward
   *  the eye, in spacings: against light leaking through walls); edge (spacings over which the volume fades to the
   *  sky's light); inside (the share of a probe's view right up against it past which it isn't trusted); refresh
   *  (keep recapturing once every probe has been) */
  params = { on: true, strength: 1, perFrame: 2, blend: 0.5, normalBias: 0.35, viewBias: 0.15, edge: 1, inside: 0.35, refresh: true };
  /** probes along x, y, z */
  n: [number, number, number] = [1, 1, 1];
  min: V3 = [0, 0, 0];
  spacing = 1;
  /** the volume the surfaces read (env group: giTex) */
  tex: Texture;
  /** the run items (before the opaque scene: the frame's surfaces read what it captured) */
  readonly items: RunEntry[];
  /** probes captured since the volume was last set or invalidated, and in all */
  captured = 0;
  total = 0;
  private next: Texture;
  private capColor: Texture;
  private capDepth: Texture;
  private u: UniformBuffer<any>;
  private project: Compute;
  private faces: { pass: RenderPass; cam: Camera; view: View }[][] = [];
  private slotsUsed = 0;
  private slotProbe: number[] = [];
  private stamp = new Float64Array(0);
  private valid = new Uint8Array(0);
  private lift = new Float32Array(0);
  private frame = 0;
  private cam: ArrayLike<number> = [0, 0, 0];
  private F: number;
  private maxSlots: number;
  private ground?: (x: number, z: number) => number;

  constructor(private kit: Kit, opts: ProbeGridOptions) {
    const k = kit;
    this.F = Math.max(8, Math.round(opts.face ?? 24));
    this.maxSlots = Math.max(1, Math.min(MAX_SLOTS, opts.maxPerFrame ?? 2));
    this.ground = opts.ground;
    const F = this.F, L = this.maxSlots * 6;
    this.capColor = k.texture({ label: 'gi.capture', format: 'rgba16float', size: [F, F, L], usage: ['render', 'sample'] });
    this.capDepth = k.texture({ label: 'gi.captureDepth', format: 'depth32float', size: [F, F, L], usage: ['render', 'sample'] });
    this.tex = this.volume('gi.probes', ['sample', 'copy-dst']);
    this.next = this.volume('gi.probes.next', ['storage', 'copy-src']);
    this.u = k.uniforms(probeShader.structs.Probes, 'gi');
    for (let s = 0; s < this.maxSlots; s++) {
      const row: { pass: RenderPass; cam: Camera; view: View }[] = [];
      for (let f = 0; f < 6; f++) {
        const cam = new Camera();
        cam.fovY = Math.PI / 2;
        cam.near = 0.05;
        cam.far = Infinity;
        const view = k.view(cam, [F, F], `gi.s${s}f${f}`);
        view.user = [0, 1, 0, 0];
        const slot = s;
        const pass = k.pass({
          label: `gi.capture.s${s}f${f}`, view, replay: opts.source, enabled: () => this.params.on && slot < this.slotsUsed,
          color: [{ target: this.capColor.layer(s * 6 + f), clear: [0, 0, 0, 1] }], depth: { target: this.capDepth.layer(s * 6 + f), clear: 0 },
        });
        row.push({ pass, cam, view });
      }
      this.faces.push(row);
    }
    // each face's basis as the capture's camera has it (whatever lookAt's handedness)
    const fwd: number[][] = [], right: number[][] = [], up: number[][] = [];
    for (let f = 0; f < 6; f++) {
      const c = new Camera();
      c.fovY = Math.PI / 2;
      c.viewOverride = lookAt([0, 0, 0], FACES[f][0], FACES[f][1]);
      c.update(F, F);
      fwd.push([...c.forward, 0]); right.push([...c.right, 0]); up.push([...c.up, 0]);
    }
    this.u.set({ fwd, right, up } as never);
    this.project = k.compute(probeShader, {
      label: 'gi.project', entry: 'project', enabled: () => this.params.on && this.slotsUsed > 0, workgroups: () => [this.slotsUsed],
      bind: { PB: this.u, capColor: this.capColor, capDepth: this.capDepth, giPrev: this.tex, giNext: this.next },
    });
    const copy = k.raw((enc) => {
      if (!this.params.on) return;
      const N = this.n;
      for (let s = 0; s < this.slotsUsed; s++) {
        const i = this.slotProbe[s], x = i % N[0], y = Math.floor(i / N[0]) % N[1], z = Math.floor(i / (N[0] * N[1]));
        for (let sl = 0; sl < 4; sl++) {
          const o = [x + sl * N[0], y, z];
          enc.copyTextureToTexture({ texture: this.next.gpu, origin: o }, { texture: this.tex.gpu, origin: o }, [1, 1, 1]);
        }
      }
    }, 'gi.store');
    this.items = [new RunAction(() => this.schedule(), 'gi.schedule'), ...this.faces.flat().map((f) => f.pass), this.project, copy];
    this.setVolume(opts.min, opts.max, opts.spacing);
  }

  private volume(label: string, usage: ('sample' | 'copy-dst' | 'storage' | 'copy-src')[]) {
    return this.kit.texture({ label, format: 'rgba16float', size: [4 * this.n[0], this.n[1], this.n[2]], dimension: '3d', usage });
  }

  /** (re)place the volume: least and greatest corners, spacing (m). Its probes start over (the sky's light meanwhile) */
  setVolume(min: V3, max: V3, spacing: number) {
    this.spacing = Math.max(0.05, spacing);
    const n = [0, 1, 2].map((a) => Math.max(2, Math.min(a === 0 ? 256 : 128, Math.round((max[a] - min[a]) / this.spacing) + 1))) as [number, number, number];
    this.min = [...min];
    const grew = n[0] !== this.n[0] || n[1] !== this.n[1] || n[2] !== this.n[2];
    this.n = n;
    if (grew) {
      this.kit.release(this.tex, this.next);
      this.tex = this.volume('gi.probes', ['sample', 'copy-dst']);
      this.next = this.volume('gi.probes.next', ['storage', 'copy-src']);
      this.project.set('giPrev', this.tex);
      this.project.set('giNext', this.next);
      this.onTexture?.(this.tex);
    }
    const count = n[0] * n[1] * n[2];
    this.stamp = new Float64Array(count).fill(-1);
    this.valid = new Uint8Array(count).fill(1);
    this.lift = new Float32Array(count);
    if (this.ground) {
      for (let i = 0; i < count; i++) {
        const p = this.probePos(i, false), g = this.ground(p[0], p[2]) + 0.25 * this.spacing;
        if (p[1] < g) { if (g - p[1] > 0.5 * this.spacing) this.valid[i] = 0; else this.lift[i] = g - p[1]; }
      }
    }
    this.invalidate();
  }

  /** forget every probe's light (a different scene, a big change of light): each is captured again */
  invalidate() {
    this.stamp.fill(-1);
    this.captured = 0;
    // (the volume itself cleared: nothing trusted until captured again)
    const N = this.n, zero = new Uint16Array(4 * N[0] * N[1] * N[2] * 4);
    this.kit.device.queue.writeTexture({ texture: this.tex.gpu }, zero, { bytesPerRow: 4 * N[0] * 8, rowsPerImage: N[1] }, [4 * N[0], N[1], N[2]]);
  }

  /** told when the volume's texture is made again (a bigger volume): the env group has to bind the new one */
  onTexture: ((t: Texture) => void) | null = null;

  /** the camera's position (probes nearer it come first) */
  follow(cam: ArrayLike<number>) { this.cam = cam; }

  private probePos(i: number, lifted = true): V3 {
    const N = this.n, s = this.spacing;
    const x = i % N[0], y = Math.floor(i / N[0]) % N[1], z = Math.floor(i / (N[0] * N[1]));
    return [this.min[0] + x * s, this.min[1] + y * s + (lifted ? this.lift[i] : 0), this.min[2] + z * s];
  }

  // (each frame: the probes to capture — the never-captured nearest the camera first, then the stalest by their
  // distance — and their six cameras)
  private schedule() {
    this.frame++;
    this.slotsUsed = 0;
    if (!this.params.on) return;
    const want = Math.max(0, Math.min(this.maxSlots, Math.round(this.params.perFrame)));
    if (!want) return;
    const count = this.stamp.length, c = this.cam, best: number[] = [], score: number[] = [];
    const all = this.captured >= this.total && this.total > 0;
    if (all && !this.params.refresh) return;
    for (let i = 0; i < count; i++) {
      if (!this.valid[i]) continue;
      const p = this.probePos(i);
      const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
      const st = this.stamp[i];
      // (never captured: ahead of everything, nearest first; else age over distance)
      const sc = st < 0 ? 1e12 - d : (this.frame - st) / (1 + d / (8 * this.spacing));
      if (st >= 0 && this.frame - st < 2) continue;
      if (best.length < want) { best.push(i); score.push(sc); continue; }
      let lo = 0;
      for (let k = 1; k < score.length; k++) if (score[k] < score[lo]) lo = k;
      if (sc > score[lo]) { best[lo] = i; score[lo] = sc; }
    }
    const slots: { at: number[]; k: number[] }[] = [];
    for (let s = 0; s < best.length; s++) {
      const i = best[s], p = this.probePos(i), N = this.n;
      if (this.stamp[i] < 0) this.captured++;
      this.stamp[i] = this.frame;
      this.slotProbe[s] = i;
      for (let f = 0; f < 6; f++) {
        const cam = this.faces[s][f].cam;
        cam.viewOverride = lookAt(p, [p[0] + FACES[f][0][0], p[1] + FACES[f][0][1], p[2] + FACES[f][0][2]], FACES[f][1]);
        cam.cut();
        // (the run updated the views before this action: these move now, uploaded ahead of the frame's commands)
        const v = this.faces[s][f].view;
        v.update(true);
        v.frame.upload();
      }
      slots.push({ at: [i % N[0], Math.floor(i / N[0]) % N[1], Math.floor(i / (N[0] * N[1])), 1], k: [this.params.blend, 0, 0, 0] });
    }
    while (slots.length < MAX_SLOTS) slots.push({ at: [0, 0, 0, 0], k: [0, 0, 0, 0] });
    this.slotsUsed = best.length;
    this.total = 0;
    for (let i = 0; i < count; i++) this.total += this.valid[i];
    this.u.set({ slots, n: [...this.n, this.slotsUsed], k: [0.05, this.params.inside > 0 ? 0.3 * this.spacing : 0, Math.max(0.05, this.params.inside), this.F] } as never);
    this.u.upload();
  }

  /** the shaders' values for it (envx: giMin, giN, giK) */
  envx() {
    const P = this.params;
    return {
      giMin: [...this.min, this.spacing], giN: [...this.n, P.on ? 1 : 0],
      giK: [P.strength, P.normalBias, P.viewBias, Math.max(0.01, P.edge)],
    };
  }

  dispose() {
    for (const row of this.faces) for (const f of row) f.pass.dispose();
    this.kit.release(this.project, this.capColor, this.capDepth, this.tex, this.next, this.u);
  }
}
