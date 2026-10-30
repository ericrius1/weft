# @ericrius1/weft

A thin WebGPU kit: **a frame is an explicit, ordered list of passes over named resources, and WGSL is the single
definition of the data.** The engine under [games.ericlevin.dev](https://games.ericlevin.dev).

1. **Passes are the unit of work**, run in the order you list them (`kit.run([...])`). No scene graph, no hidden
   scheduling.
2. **WGSL is the single definition.** The Vite plugin resolves `#include`s, reflects each shader (struct layouts,
   bindings, entry points, overrides) and writes a `.d.wgsl.ts` beside it, so struct fields and binding names are
   type-checked. Bindings are passed by WGSL variable name.
3. **Pipelines are created eagerly and asynchronously**; `await kit.ready()` waits for all of them, so nothing compiles
   mid-game. Variants are WGSL `override`s. (Where pipelines compile one at a time, WebKit, an app can set a compile
   scheduler, `kit.compiler`, that defers them and makes each on the spot when first needed.)
4. **Resources own their lifetimes**: render-relative textures follow the render size, bind groups are rebuilt from
   resource versions (nothing ever binds a destroyed texture), ping-pong is built in, `kit.copy()` is a run item.
   `destroy()` / `dispose()` (or `kit.release(...)`) free things for good; `kit.memory()` tallies what's held.
5. **Group 0 is the frame** (camera, time, a per-view `user` vec4, app globals, samplers). Groups 1+ can be shared
   with every pipeline whose shader includes the declaring file (`kit.shareGroup`); weft's own shaders keep theirs in
   group 3. Views: one camera + Frame each (shadow cascades, a reflection).
6. **Shader hot reload keeps state.** Mistakes are loud (file:line, binding names). A debug overlay (`?debug`, or the
   backquote key) lists the passes that ran with GPU timings and on/off switches, any texture, and sliders built from
   `// @range(…)` annotations in WGSL structs.
7. **A frame budget**: `kit.maxFps` and `AutoResolution` (GPU timestamps → render scale).
8. **Encoding is cheap.** Bind groups are checked by number, not rebuilt as keys: a group of direct resources is reused
   until something is reallocated, and anything else (a `Ref`) is resolved once per run epoch (each `kit.run` and each
   `RunAction` starts one — so a Ref's target changes only between them). Static draws can be baked into a render
   bundle (`pass.bundle()`), replayed with one call a frame.
9. **HDR when the display has it** (`createKit(canvas, { hdr: true })`): an rgba16float canvas with extended tone
   mapping, Display P3 where supported; `kit.hdr` says what you got, and `weft/output` encodes for either.

```bash
npm install @ericrius1/weft
```

```ts
// vite.config.ts
import { weft } from '@ericrius1/weft/vite';
export default defineConfig({ plugins: [weft()], build: { target: 'esnext' } });
```

```ts
import { createKit } from '@ericrius1/weft';
import post from './post.wgsl';

const kit = await createKit(canvas);
const hdr = kit.texture({ format: 'rgba16float', size: 'render' });
const out = kit.pass({ color: [{ target: 'screen' }] });
out.fullscreen(post, { bind: { hdr } });
await kit.ready();
kit.loop(() => kit.run([/* your passes… */ out]));
```

Static draws (a city, a temple) baked once into a GPURenderBundle; it re-records itself when one of them, its pipeline
or a resource it binds changes:

```ts
const city = scene.bundle('city');
for (const m of meshes) city.draw(shader, { bind: { mesh: m.buffer, tex: m.texture }, count: m.count });
```

An HDR canvas where the display has one (SDR otherwise, as before). The last pass writes colour in the canvas colour
space with the sRGB transfer — past 1 brighter than SDR white on an HDR canvas:

```ts
const kit = await createKit(canvas, { hdr: true });   // kit.hdr: { enabled, format, colorSpace, toneMapping }
out.fullscreen(post, { bind: { hdr }, constants: { HDR: kit.hdr.enabled ? 1 : 0, P3: kit.hdr.colorSpace === 'display-p3' ? 1 : 0 } });
```

```wgsl
#include "weft/output"
override HDR: bool = false;
override P3: bool = false;
@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let mapped = myTonemap(myScene(i.uv), select(1.0, 4.0, HDR));   // yours: to [0, 1] on SDR, [0, peak] on HDR
  return vec4f(canvasEncode(mapped, P3), 1.0);
}
```

(The lab's `post.wgsl` is a whole one: `npm run dev`, then `?hdr`.)

Freeing what a streamed-out chunk made (a resize no longer brings a destroyed texture back), and what's held:

```ts
kit.release(chunk.texture, chunk.buffer, chunk.bundle);   // destroy() / dispose() each
const { textures, buffers, total } = kit.memory();        // bytes (the overlay shows it too)
```

Reading back and recording:

```ts
const d = await depth.readTexel(x, y);      // one texel, no stall (pooled; depth formats too): picking, cursor depth
const cap = new Capture(kit);               // frames read from the swapchain (headless Chrome screenshots, films)
const png = await cap.grab();               // a data URL; cap.step(dt) / cap.blob() step a frame by hand
// vite.config.ts: plugins: [weft(), filmSink({ dir: resolve(__dirname, '../film') })]
//   a page POSTs /__film/frame?name=&i= (JPEG), /__film/audio (WAV), /__film/meta → <dir>/<name>/…
```

A planetarium's fulldome (a 180-degree equidistant fisheye: the zenith at the centre, the heading at the bottom rim,
its right on the right) from six ordinary views of one moment, stitched on the GPU with feathered seams:

```ts
const L = domeLayout(4096, { oversample: 1.4 });   // size the canvas to L.tile (CSS pixels, pixel ratio 1) first
const dome = new Fulldome(kit, { size: 4096, oversample: 1.4, source: filmTexture });   // default source: the canvas
await dome.frame((k) => kit.step(k === 0 ? 1 / 30 - 5e-4 : 1e-4));   // the first view moves the world on; the rest don't
const img = await dome.read();                     // ImageData 4096 x 4096 (or dome.output, a texture)
```

Each view is a half cube face (the four sides' upper halves, the zenith's two halves) rendered with `Camera.shift`, a
lens shift that keeps the view's axis level or vertical while its frame slides up the image plane; `viewRay` follows
it, as must any shader that rebuilds view rays from the projection (`proj[2].xy` is the off-axis part). Turn off for a
dome whatever a view draws in screen space that can't be stitched: vignetting, grain, chromatic aberration, lens flares
and screen-space sun shafts, camera motion blur, temporal accumulation.

In WGSL, `#include "weft/frame"`, `"weft/fullscreen"`, `"weft/mesh"`, `"weft/output"` reach the kit's shader library;
`libs` in the plugin options adds your own prefixes (a directory, or a package name).

Exports: `@ericrius1/weft` (the kit), `/vite` (the plugin), `/wgsl` (the compiler: include resolution, reflection,
declarations), `/runtime` (the shader registry the generated modules use), `/client` (fallback `.wgsl` typings).

See the [repo](https://github.com/ericrius1/weft) for the lab example (`bench.html` prices encoding many draws,
`checks.html` exercises the kit in the browser). MIT.
