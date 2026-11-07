// The autopilot (San Francisco's): a flight to a place and the tour that strings places together. A flight rises off
// the ground, crosses high enough to see the land whole (the farther, the higher) and comes down into the place's own
// view, its look turned toward where it's going and, the last stretch, round to the view's; a streamed world streams
// in while it flies, so it arrives on a place that's mostly there rather than cut to one that isn't yet. The tour holds
// each view a few seconds, turning slowly, its name said (`say`), then flies on. Any key, a click or a drag, the wheel
// or a touch on the view hands the camera straight back, wherever it's got to.
//
//   const pilot = new Autopilot(kit.camera, (x, z) => groundAt(x, z), canvas, () => stops, (html, s) => notice(html, s));
//   pilot.fly({ at: [x, y, z], yaw, pitch });
//   pilot.tour(true);
//   // each frame, after the controls (it has the camera's last word while it flies):
//   pilot.update(dt);
import { clamp, type Camera, type V3 } from '@ericrius1/weft';

export interface Pose { at: V3; yaw: number; pitch: number }
export interface Stop {
  pose: Pose; name: string; about?: string;
  /** held without the slow turn (someone in the middle of it: June at her easel) */
  still?: boolean;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** the short way round from a to b */
const turn = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
/** the keys (KeyboardEvent.key) that never take the camera back by default: the modifiers, Tab, and San Francisco's
 *  panel and guide (/, ?) */
export const PASS_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', '/', '?', 'Tab'];
/** the key codes that never take it back by default (San Francisco's: T the tour itself, H the guide, P the places) */
export const PASS_CODES = ['KeyT', 'KeyH', 'KeyP'];
const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable]');

export class Autopilot {
  state: 'idle' | 'flying' | 'holding' = 'idle';
  /** the tour's on (flying between its stops, or holding one) */
  touring = false;
  /** told when the tour starts or stops (the places list's button follows) */
  onTour: ((on: boolean) => void) | null = null;
  /** told of each flight as it starts, where it's going (stream the destination ahead: it arrives on a place that's
   *  there) */
  onFly: ((to: Pose) => void) | null = null;
  /** told when a flight's over: true if it arrived, false if a hand took the camera back */
  onFlown: ((arrived: boolean) => void) | null = null;
  /** the line when a hand stops the tour (how to go on: the interface says, by what's to hand) */
  stopLine = 'The tour stops here · <b>T</b> to go on';
  private from: Pose = { at: [0, 0, 0], yaw: 0, pitch: 0 };
  private to: Pose = { at: [0, 0, 0], yaw: 0, pitch: 0 };
  private t = 0;
  private T = 1;
  private arc = 0;
  private along = 0;
  private short = false;
  private hold = 0;
  private pan = 0;
  private stops: Stop[] = [];
  private at = -1;

  /** keys (KeyboardEvent.key) and codes that never take the camera back (the game's own panel keys, its tour key) */
  passKeys = new Set(PASS_KEYS);
  passCodes = new Set(PASS_CODES);
  /** a flight's least and most length (s), and how high a long one arcs at most (m) */
  shortest = 1.6;
  longest = 7.5;
  ceiling = 1100;
  /** the seconds the tour holds each stop */
  holdFor = 8;

  /** `ground`: the land's height; `stops`: the tour's, made fresh as it starts; `say`: a line at the top of the view;
   *  `reduced`: less motion (prefers-reduced-motion by default): flights cut, holds still */
  constructor(private cam: Camera, private ground: (x: number, z: number) => number, canvas: HTMLElement,
    private tourStops: () => Stop[], private say: (html: string, seconds: number) => void,
    private reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // (taken back on the window's capture, ahead of the view's own listeners: the waterbending's stop the rest)
    const take = () => { if (this.state !== 'idle') this.takeBack(); };
    addEventListener('keydown', (e) => {
      if (this.state === 'idle' || e.repeat || this.passKeys.has(e.key) || this.passCodes.has(e.code) || typing(e.target)) return;
      take();
    }, true);
    addEventListener('pointerdown', (e) => { if (e.target === canvas) take(); }, true);
    addEventListener('touchstart', (e) => { if (e.target === canvas) take(); }, { capture: true, passive: true });
    canvas.addEventListener('wheel', take, { passive: true });
  }

  get busy() { return this.state !== 'idle'; }

  /** fly from where the camera is to a view */
  fly(to: Pose) {
    // (a view that isn't one — another player's position not yet heard, say — is no reason to lose the camera)
    if (!to?.at || !to.at.every(Number.isFinite) || !Number.isFinite(to.yaw) || !Number.isFinite(to.pitch)) return;
    const c = this.cam;
    this.from = { at: [c.position[0], c.position[1], c.position[2]], yaw: c.yaw, pitch: c.pitch };
    this.to = { at: [to.at[0], to.at[1], to.at[2]], yaw: to.yaw, pitch: to.pitch };
    const dx = to.at[0] - c.position[0], dz = to.at[2] - c.position[2], d = Math.hypot(dx, dz);
    this.short = d < 60;
    this.arc = this.short ? 0 : clamp(d * 0.28, 30, this.ceiling);
    this.along = Math.atan2(-dx, -dz);
    // (a street in a couple of seconds, across the city in six or seven; with less motion asked for, a moment)
    this.T = this.reduced ? 0.01 : clamp(2 + 0.95 * Math.log2(1 + d / 250), this.shortest, this.longest);
    this.t = 0;
    this.state = 'flying';
    this.onFly?.(this.to);
  }

  /** the tour: from its first stop, or on from the one it was stopped at */
  tour(on = !this.touring) {
    if (on === this.touring) return;
    this.touring = on;
    if (on) {
      this.stops = this.tourStops();
      if (this.at >= this.stops.length) this.at = -1;
      this.next();
    } else this.state = 'idle';
    this.onTour?.(on);
  }

  private next() {
    this.at = (this.at + 1) % this.stops.length;
    this.fly(this.stops[this.at].pose);
  }

  /** a hand on the controls: everything stops where it is */
  private takeBack() {
    const was = this.state, touring = this.touring;
    this.state = 'idle';
    if (touring) {
      this.touring = false;
      // (stopped mid-flight it goes on to that stop next time; holding one, to the one after)
      if (was === 'flying') this.at--;
      this.say(this.stopLine, 3);
      this.onTour?.(false);
    }
    if (was === 'flying') this.onFlown?.(false);
  }

  /** stop without a word (another place chosen, one of the cast put on) */
  cancel() {
    if (this.touring) { this.touring = false; this.onTour?.(false); }
    this.state = 'idle';
  }

  /** each frame, after the controls (it has the camera's last word while it flies) */
  update(dt: number) {
    // (a long frame — a stream landing, a pipeline compiled — slows it a moment rather than jumping it along)
    dt = Math.min(dt, 0.1);
    if (this.state === 'holding') {
      // (the view held, turning slowly, then on to the next)
      this.cam.yaw += this.pan * dt;
      this.hold -= dt;
      if (this.hold <= 0) this.next();
      return;
    }
    if (this.state !== 'flying') return;
    this.t = Math.min(1, this.t + dt / this.T);
    const k = this.t, F = this.from, G = this.to, c = this.cam;
    const s = smoother(k), up = 4 * k * (1 - k);
    const x = lerp(F.at[0], G.at[0], s), z = lerp(F.at[2], G.at[2], s);
    // (over the land all the way: higher in the middle of a long flight, where nothing's to be seen close; a hop
    // along a street keeps to the street)
    const y = Math.max(lerp(F.at[1], G.at[1], s) + this.arc * up * up, this.ground(x, z) + 2 + Math.min(28, this.arc * 0.1) * Math.sqrt(up));
    c.position = [x, y, z];
    if (this.short) {
      const u = smooth(k);
      c.yaw = turn(F.yaw, G.yaw, u);
      c.pitch = lerp(F.pitch, G.pitch, u);
    } else {
      // (turned toward the way it's going, looking down to where it's headed; the last stretch round to the view)
      const left = Math.hypot(G.at[0] - x, G.at[2] - z);
      const toward = clamp(Math.atan2(G.at[1] - y, Math.max(left, 1)), -0.6, 0.05);
      const a = smooth(clamp(k / 0.3, 0, 1)), b = smooth(clamp((k - 0.6) / 0.4, 0, 1));
      c.yaw = b > 0 ? turn(this.along, G.yaw, b) : turn(F.yaw, this.along, a);
      c.pitch = b > 0 ? lerp(toward, G.pitch, b) : lerp(F.pitch, toward, a);
    }
    c.roll = 0;
    if (k < 1) return;
    c.position = [G.at[0], Math.max(G.at[1], this.ground(G.at[0], G.at[2]) + 1.7), G.at[2]];
    c.yaw = G.yaw;
    c.pitch = G.pitch;
    if (this.touring) {
      const st = this.stops[this.at];
      this.state = 'holding';
      this.hold = this.reduced ? this.holdFor + 2 : this.holdFor;
      // (a few degrees over the hold, one way then the other stop by stop)
      this.pan = this.reduced || st.still ? 0 : 0.009 * (this.at % 2 ? -1 : 1);
      this.say(`<b>${st.name}</b>${st.about ? ` · ${st.about}` : ''}`, this.hold - 0.5);
    } else this.state = 'idle';
    this.onFlown?.(true);
  }
}
