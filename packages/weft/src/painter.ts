// weft 2D: an immediate-mode painter. Between begin() and end() you push shapes, sprites and text; end() uploads
// them as one storage buffer and the painter's pass draws them all in a single instanced call. It renders into its
// own texture (a cabinet screen, a marquee, a HUD) or straight to the screen, in virtual pixels with y down.
import type { Kit } from './kit';
import type { RenderPass } from './passes';
import { Texture, StorageBuffer, UniformBuffer } from './resources';
import { FONT_CHARS, glyphRows } from './font5x7';
import painterShader from '../shaders/painter.wgsl';

export type Color = ArrayLike<number>;

/** '#rrggbb' (sRGB) → linear rgba, optionally scaled (values above 1 glow under bloom) */
export function hex(h: string, intensity = 1, alpha = 1): [number, number, number, number] {
  const n = parseInt(h.replace('#', ''), 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return [lin((n >> 16) & 255) * intensity, lin((n >> 8) & 255) * intensity, lin(n & 255) * intensity, alpha];
}
export const withAlpha = (c: Color, a: number): [number, number, number, number] => [c[0], c[1], c[2], (c[3] ?? 1) * a];
export const scaleColor = (c: Color, k: number): [number, number, number, number] => [c[0] * k, c[1] * k, c[2] * k, c[3] ?? 1];

export interface Sprite { name: string; uv: [number, number, number, number]; w: number; h: number }

const ATLAS = 1024;
const KIND = { rect: 0, circle: 1, ring: 2, line: 3, sprite: 4, glyph: 5 } as const;
const ADD = 256;
const FLOATS = 16;

/** one shared atlas per kit: the 5×7 font, then sprites shelf-packed below it */
export class Atlas {
  readonly tex: Texture;
  readonly data = new Uint8Array(ATLAS * ATLAS * 4);
  readonly glyphs = new Map<string, [number, number, number, number]>();
  readonly sprites = new Map<string, Sprite>();
  private shelfX = 0;
  private shelfY = 80;
  private shelfH = 0;
  private dirty = true;
  constructor(private kit: Kit) {
    this.tex = kit.texture({ label: 'weft.atlas', format: 'rgba8unorm', size: [ATLAS, ATLAS], usage: ['sample', 'copy-dst'] });
    FONT_CHARS.forEach((ch, i) => {
      const cx = (i % 32) * 8, cy = Math.floor(i / 32) * 8;
      const rows = glyphRows(ch);
      for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) {
        if (rows[y][x] !== '#') continue;
        const o = ((cy + y) * ATLAS + cx + x) * 4;
        this.data[o] = this.data[o + 1] = this.data[o + 2] = this.data[o + 3] = 255;
      }
      this.glyphs.set(ch, [cx / ATLAS, cy / ATLAS, (cx + 5) / ATLAS, (cy + 7) / ATLAS]);
    });
  }
  /** add RGBA pixels; returns the sprite (uv rect in the atlas) */
  add(name: string, w: number, h: number, rgba: Uint8Array): Sprite {
    if (this.shelfX + w + 1 > ATLAS) { this.shelfX = 0; this.shelfY += this.shelfH + 1; this.shelfH = 0; }
    if (this.shelfY + h > ATLAS) throw new Error('weft atlas full');
    const x0 = this.shelfX, y0 = this.shelfY;
    for (let y = 0; y < h; y++) this.data.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), ((y0 + y) * ATLAS + x0) * 4);
    this.shelfX += w + 1;
    this.shelfH = Math.max(this.shelfH, h);
    this.dirty = true;
    const s: Sprite = { name, w, h, uv: [x0 / ATLAS, y0 / ATLAS, (x0 + w) / ATLAS, (y0 + h) / ATLAS] };
    this.sprites.set(name, s);
    return s;
  }
  /** a pixel-art sprite from rows of palette characters ('.' or ' ' = transparent) */
  pixels(name: string, rows: string[], palette: Record<string, string>): Sprite {
    const prev = this.sprites.get(name);
    if (prev) return prev;
    const h = rows.length, w = Math.max(...rows.map((r) => r.length));
    const px = new Uint8Array(w * h * 4);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = palette[row[x]];
        if (!c) continue;
        const n = parseInt(c.replace('#', ''), 16);
        const o = (y * w + x) * 4;
        px[o] = (n >> 16) & 255; px[o + 1] = (n >> 8) & 255; px[o + 2] = n & 255; px[o + 3] = 255;
      }
    });
    return this.add(name, w, h, px);
  }
  flush() {
    if (!this.dirty) return;
    this.tex.write(this.data);
    this.dirty = false;
  }
}
const atlases = new WeakMap<Kit, Atlas>();
export const atlasOf = (kit: Kit) => { let a = atlases.get(kit); if (!a) atlases.set(kit, (a = new Atlas(kit))); return a; };

export interface PainterOptions {
  width: number;
  height: number;
  /** draw into this texture (default: a new rgba16float texture of width × height) or 'screen' */
  target?: Texture | 'screen';
  format?: GPUTextureFormat;
  clear?: GPUColor | false;
  label?: string;
  /** give the target a mip chain (glow lookups on a CRT) */
  mips?: boolean;
}

export interface ShapeOpts { rot?: number; glow?: number; add?: boolean; radius?: number }

export class Painter {
  readonly pass: RenderPass;
  readonly target: Texture | 'screen';
  readonly atlas: Atlas;
  private ownTarget: boolean;
  readonly width: number;
  readonly height: number;
  camera = { x: 0, y: 0, zoom: 1 };
  private prims: Float32Array;
  private u32: Uint32Array;
  private n = 0;
  private buf: StorageBuffer;
  private view: UniformBuffer<any>;
  constructor(private kit: Kit, o: PainterOptions) {
    this.width = o.width;
    this.height = o.height;
    this.atlas = atlasOf(kit);
    const label = o.label ?? 'painter';
    this.ownTarget = !o.target;
    this.target = o.target ?? kit.texture({ label, format: o.format ?? 'rgba16float', size: [o.width, o.height], mips: o.mips ? 'full' : 1 });
    this.prims = new Float32Array(1024 * FLOATS);
    this.u32 = new Uint32Array(this.prims.buffer);
    this.buf = kit.storage({ label: `${label}.prims`, size: this.prims.byteLength });
    this.view = kit.uniforms(painterShader.structs.PainterView, `${label}.view`);
    this.pass = kit.pass({ label, color: [{ target: this.target, clear: o.clear ?? [0, 0, 0, 1] }] });
    this.pass.draw(painterShader, {
      label: `${label}.draw`, bind: { pv: this.view, prims: this.buf, atlas: this.atlas.tex, atlasSamp: 'nearest' },
      blend: 'premultiplied', cull: 'none', count: 6, instances: () => this.n,
    });
  }

  begin() { this.n = 0; return this; }
  get count() { return this.n; }

  private push(kind: number, x: number, y: number, hw: number, hh: number, c: Color, rot: number, param: number, soft: number, uv?: ArrayLike<number>) {
    if ((this.n + 1) * FLOATS > this.prims.length) {
      const bigger = new Float32Array(this.prims.length * 2);
      bigger.set(this.prims);
      this.prims = bigger;
      this.u32 = new Uint32Array(bigger.buffer);
    }
    const p = this.prims, o = this.n * FLOATS;
    p[o] = x; p[o + 1] = y; p[o + 2] = hw; p[o + 3] = hh;
    p[o + 4] = c[0]; p[o + 5] = c[1]; p[o + 6] = c[2]; p[o + 7] = c[3] ?? 1;
    p[o + 8] = uv ? uv[0] : 0; p[o + 9] = uv ? uv[1] : 0; p[o + 10] = uv ? uv[2] : 0; p[o + 11] = uv ? uv[3] : 0;
    p[o + 12] = rot; p[o + 13] = param; p[o + 14] = soft;
    this.u32[o + 15] = kind;
    this.n++;
  }

  /** rectangle by its top-left corner */
  rect(x: number, y: number, w: number, h: number, c: Color, o: ShapeOpts = {}) {
    this.push(KIND.rect | (o.add ? ADD : 0), x + w / 2, y + h / 2, w / 2, h / 2, c, o.rot ?? 0, o.radius ?? 0, o.glow ?? 0);
    return this;
  }
  /** rectangle by its centre */
  box(cx: number, cy: number, w: number, h: number, c: Color, o: ShapeOpts = {}) {
    this.push(KIND.rect | (o.add ? ADD : 0), cx, cy, w / 2, h / 2, c, o.rot ?? 0, o.radius ?? 0, o.glow ?? 0);
    return this;
  }
  circle(x: number, y: number, r: number, c: Color, o: ShapeOpts = {}) {
    this.push(KIND.circle | (o.add ? ADD : 0), x, y, r, r, c, 0, 0, o.glow ?? 0);
    return this;
  }
  ring(x: number, y: number, r: number, thickness: number, c: Color, o: ShapeOpts = {}) {
    this.push(KIND.ring | (o.add ? ADD : 0), x, y, r, r, c, 0, thickness, o.glow ?? 0);
    return this;
  }
  line(x0: number, y0: number, x1: number, y1: number, width: number, c: Color, o: ShapeOpts = {}) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), r = width / 2;
    this.push(KIND.line | (o.add ? ADD : 0), (x0 + x1) / 2, (y0 + y1) / 2, len / 2 + r, r, c, Math.atan2(dy, dx), r, o.glow ?? 0);
    return this;
  }
  /** a polyline through flat [x0, y0, x1, y1, …] points */
  poly(pts: ArrayLike<number>, width: number, c: Color, closed = true, o: ShapeOpts = {}) {
    const n = pts.length / 2;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n;
      this.line(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], width, c, o);
    }
    return this;
  }
  sprite(s: Sprite, x: number, y: number, o: { scale?: number; rot?: number; flipX?: boolean; flipY?: boolean; tint?: Color; alpha?: number; add?: boolean; center?: boolean } = {}) {
    const k = o.scale ?? 1, hw = (s.w * k) / 2, hh = (s.h * k) / 2;
    let [u0, v0, u1, v1] = s.uv;
    if (o.flipX) [u0, u1] = [u1, u0];
    if (o.flipY) [v0, v1] = [v1, v0];
    const t = o.tint ?? [1, 1, 1, 1];
    const cx = o.center === false ? x + hw : x, cy = o.center === false ? y + hh : y;
    this.push(KIND.sprite | (o.add ? ADD : 0), cx, cy, hw, hh, [t[0], t[1], t[2], (t[3] ?? 1) * (o.alpha ?? 1)], o.rot ?? 0, 0, 0, [u0, v0, u1, v1]);
    return this;
  }
  /** pixel text; returns its width. size is the pixel scale (1 = 5×7 glyphs on a 6px advance) */
  text(str: string, x: number, y: number, o: { size?: number; color?: Color; align?: 'left' | 'center' | 'right'; add?: boolean; shadow?: Color; spacing?: number } = {}) {
    const k = o.size ?? 1, adv = (6 + (o.spacing ?? 0)) * k;
    const w = this.textWidth(str, k, o.spacing);
    let cx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
    cx = Math.round(cx);
    const cy = Math.round(y);
    const c = o.color ?? [1, 1, 1, 1];
    for (const ch of str) {
      if (ch !== ' ') {
        const uv = this.atlas.glyphs.get(ch) ?? this.atlas.glyphs.get(ch.toUpperCase()) ?? this.atlas.glyphs.get('?')!;
        if (o.shadow) this.push(KIND.glyph, cx + 2.5 * k + k, cy + 3.5 * k + k, 2.5 * k, 3.5 * k, o.shadow, 0, 0, 0, uv);
        this.push(KIND.glyph | (o.add ? ADD : 0), cx + 2.5 * k, cy + 3.5 * k, 2.5 * k, 3.5 * k, c, 0, 0, 0, uv);
      }
      cx += adv;
    }
    return w;
  }
  textWidth(str: string, size = 1, spacing = 0) { return Math.max(0, [...str].length * (6 + spacing) * size - (1 + spacing) * size); }

  /** free it for good: its pass, its buffers, and the texture it made for itself (the shared atlas stays) */
  dispose() {
    this.pass.dispose();
    this.buf.destroy();
    this.view.destroy();
    if (this.ownTarget && this.target !== 'screen') this.target.destroy();
  }

  /** upload this frame's primitives (call before kit.run) */
  end() {
    this.atlas.flush();
    const bytes = this.n * FLOATS * 4;
    this.buf.ensure(bytes);
    if (bytes) this.buf.write(this.prims.subarray(0, this.n * FLOATS));
    this.view.set({ size: [this.width, this.height], offset: [this.camera.x, this.camera.y], zoom: this.camera.zoom, pixel: 1 });
    return this;
  }
}
