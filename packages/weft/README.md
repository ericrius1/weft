# @ericrius1/weft

A thin WebGPU kit: **a frame is an explicit, ordered list of passes over named resources, and WGSL is the single
definition of the data.** The engine under [games.ericlevin.dev](https://games.ericlevin.dev).

1. **Passes are the unit of work**, run in the order you list them (`kit.run([...])`). No scene graph, no hidden
   scheduling.
2. **WGSL is the single definition.** The Vite plugin resolves `#include`s, reflects each shader (struct layouts,
   bindings, entry points, overrides) and writes a `.d.wgsl.ts` beside it, so struct fields and binding names are
   type-checked. Bindings are passed by WGSL variable name.
3. **Pipelines are created eagerly and asynchronously**; `await kit.ready()` waits for all of them, so nothing compiles
   mid-game. Variants are WGSL `override`s.
4. **Resources own their lifetimes**: render-relative textures follow the render size, bind groups are rebuilt from
   resource versions (nothing ever binds a destroyed texture), ping-pong is built in, `kit.copy()` is a run item.
5. **Group 0 is the frame** (camera, time, a per-view `user` vec4, app globals, samplers). Groups 1+ can be shared
   across every pipeline that declares them (`kit.shareGroup`). Views: one camera + Frame each (shadow cascades, a
   reflection).
6. **Shader hot reload keeps state.** Mistakes are loud (file:line, binding names). A debug overlay (`?debug`, or the
   backquote key) lists the passes that ran with GPU timings and on/off switches, any texture, and sliders built from
   `// @range(…)` annotations in WGSL structs.
7. **A frame budget**: `kit.maxFps` and `AutoResolution` (GPU timestamps → render scale).

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

In WGSL, `#include "weft/frame"`, `"weft/fullscreen"`, `"weft/mesh"` reach the kit's shader library; `libs` in the plugin
options adds your own prefixes (a directory, or a package name).

Exports: `@ericrius1/weft` (the kit), `/vite` (the plugin), `/wgsl` (the compiler: include resolution, reflection,
declarations), `/runtime` (the shader registry the generated modules use), `/client` (fallback `.wgsl` typings).

See the [repo](https://github.com/ericrius1/weft) for the lab example. MIT.
