# weft for coding agents

How to use weft (and loom and cast) well without reading the engine's source first. This file ships inside the
package, so a project that depends on weft has it at `node_modules/@ericrius1/weft/AGENTS.md`. The types in
`node_modules/@ericrius1/weft/dist/src/*.d.ts` (and the TypeScript source beside them in `src/`) are the reference for
anything not covered here. For the reasoning behind the design, see the repo's README
(https://github.com/ericrius1/weft).

| package | what it is | import from |
| --- | --- | --- |
| `@ericrius1/weft` | the kit: device, resources, passes, WGSL tooling, frame loop, TAAU, frame budget, assets | `@ericrius1/weft`, `@ericrius1/weft/vite` |
| `@ericrius1/loom` | a cinematic renderer on weft: sky, clouds, sea, shadows, film grade, terrain streaming, forests, audio | by path: `@ericrius1/loom/render/renderer`, `@ericrius1/loom/audio`, … |
| `@ericrius1/cast` | character runtime, CPU only: the hero rig, face, garments, strands, the whole-body solver | `@ericrius1/cast/rig`, `@ericrius1/cast/asset`, … |

## The model in five lines

1. **A frame is the list you pass to `kit.run([...])`.** Each item is encoded in that order into one command encoder,
   then submitted. There is no scene graph and no hidden scheduling. Anything not in the list doesn't run.
2. **WGSL is the single definition of the data.** The Vite plugin reflects each `.wgsl` file into a typed module.
   You lay out uniforms with `kit.uniforms(shader.structs.Name)` and bind by the shader's own variable names
   (`bind: { prev: buf }`). Never hand-write byte offsets.
3. **Declaring a compute or draw starts compiling its pipeline right away.** `await kit.ready()` waits for every
   pipeline. A draw or compute whose pipeline hasn't finished compiling is **skipped without an error**.
4. **Resources manage their own lifetimes.** `size: 'render'` textures reallocate on resize, and bind groups follow
   automatically. A ping-pong pair swaps when its `swap` item runs.
5. **Bind group 0 belongs to the frame** (the camera and time in `frame`, the app's globals, samplers), and every
   pipeline gets it automatically. Your own bindings go in groups 1 and up.

## Setting up a project

Dependencies come from the dist branches on GitHub, not from npm:

```json
"@ericrius1/weft": "git+https://github.com/ericrius1/weft.git#dist/weft",
"@ericrius1/loom": "git+https://github.com/ericrius1/weft.git#dist/loom",
"@ericrius1/cast": "git+https://github.com/ericrius1/weft.git#dist/cast"
```

A project keeps the canonical `tools/engine-latest.mjs`, copied from the weft repo, wired in as
`"predev": "node tools/engine-latest.mjs"` and `"prebuild": "node tools/engine-latest.mjs --strict"`. It moves these
dependencies to the dist branches' tips before every dev server and build, so you never bump them by hand. If npm
rewrites a spec to `github:ericrius1/weft#dist/...`, put the `git+https` form back. Where a project supports it,
`WEFT_LOCAL=1 npm run dev` compiles `../weft`'s source in for live engine work.

```ts
// vite.config.ts
import { weft } from '@ericrius1/weft/vite';
export default defineConfig({
  plugins: [weft({ libs: { loom: '@ericrius1/loom' } })],   // libs: #include "loom/…" prefixes (a dir or a package)
  build: { target: 'esnext' },                              // top-level await, WGSL modules
});
```

```jsonc
// tsconfig.json
{ "compilerOptions": { "allowArbitraryExtensions": true, "types": ["@webgpu/types", "vite/client", "@ericrius1/weft/client"] } }
```

The plugin writes a `foo.d.wgsl.ts` beside each `foo.wgsl`. These files are generated: don't edit them. Projects commit
them, and they regenerate when the shader changes under a running dev server or build.

`@ericrius1/weft/vite` also exports dev-server sinks and build helpers. Use these instead of writing your own:
`shotSink({ dir })` (screenshots from `shot()`), `filmSink({ dir })` (film frames and audio POSTed by a page),
`beaconSink({ dir })` (`perfBeacon` reports), `remoteAssets({ omit })` (R2-hosted assets: served in dev, left out of
the build) and `earlyFetch({ files })` (the first view's files requested from `index.html`).

Wrap `createKit` in a try/catch: on `WebGPUUnavailable`, show the player a message. Many projects also reload the page
on `kit.device.lost`.

## A complete small frame

```ts
import { createKit } from '@ericrius1/weft';
import ripple from './ripple.wgsl';   // ripple.structs.Sim is typed from the WGSL struct
import water from './water.wgsl';
import post from './post.wgsl';

const kit = await createKit(canvas, { hdr: true });          // throws WebGPUUnavailable: show a message
const N = 256;
const state = kit.pingpong((i) => kit.storage({ label: `ripple${i}`, count: N * N, stride: 8 }), 'ripple');
const sim = kit.uniforms(ripple.structs.Sim).set({ size: N, damping: 0.996 });
const hdr = kit.texture({ label: 'hdr', format: 'rgba16float', size: 'render' });
const depth = kit.texture({ label: 'depth', format: 'depth32float', size: 'render' });

const step = kit.compute(ripple, { bind: { sim, prev: state.read, next: state.write }, threads: [N, N] });
const scene = kit.pass({ label: 'scene', color: [{ target: hdr, clear: [0, 0, 0, 1] }], depth: { target: depth, clear: 0 } });
scene.draw(water, { bind: { state: state.read }, count: (N - 1) * (N - 1) * 6 });
const out = kit.pass({ label: 'out', color: [{ target: 'screen' }] });
out.fullscreen(post, { bind: { hdr }, constants: { HDR: kit.hdr.enabled ? 1 : 0, P3: kit.hdr.colorSpace === 'display-p3' ? 1 : 0 } });

await kit.ready();                                            // behind the loading screen
kit.loop(({ time, dt }) => {
  kit.camera.lookAt([Math.sin(time) * 30, 15, Math.cos(time) * 30], [0, 0, 0]);
  sim.set({ drop: [0, 0, 0, 0] });
  kit.run([step, state.swap, scene, out]);
});
```

```wgsl
// ripple.wgsl
struct Sim {
  size: u32,
  damping: f32,     // @range(0.95, 1.0, 0.0005)   ← a slider in the debug overlay (kit.overlay.tweak(sim))
  drop: vec4f,
}
@group(1) @binding(0) var<uniform> sim: Sim;
@group(1) @binding(1) var<storage, read> prev: array<vec2f>;
@group(1) @binding(2) var<storage, read_write> next: array<vec2f>;
@compute @workgroup_size(8, 8)
fn step(@builtin(global_invocation_id) id: vec3u) { /* … */ }
```

The examples in the weft repo, `examples/lab/*.ts`, are small complete programs: `main.ts` is the one above, `town.ts`
is loom's renderer with TAAU, irradiance probes and a thousand lights, and `bench.ts` covers bundles and many draws.

## The kit: what to call

**Resources**

| call | what | notes |
| --- | --- | --- |
| `kit.uniforms(shader.structs.S, label?)` | `UniformBuffer` laid out from WGSL | `.set({ field })` writes only those fields, nested partials OK; it's uploaded at the start of the next `kit.run` |
| `kit.storage({ count, stride \| struct, size, usage, data, label })` | `StorageBuffer` | `.write(data, offset)`, `.ensure(bytes)` grows it (contents are lost, bind groups follow), `.read()` returns the contents to the CPU |
| `kit.texture({ format, size, scale, mips, samples, usage, dimension, view, label })` | `Texture` | `size: [w, h]`, `[w, h, layers]`, `'render'` or `'canvas'` (times `scale`); `mips: 'full'`; `.write`, `.writeImage`, `.readTexel(x, y)`, `.mip(n)` → `TexView` |
| `kit.pingpong((i) => make(i))` | `PingPong` | bind `.read` / `.write` (Refs); put `.swap` in the run list |
| `new StructArray(shader.structs.S, n)` | instance data in one ArrayBuffer | `arr.set(i, { … })`, then `buf.write(arr.data)`, using the struct's real stride |
| `kit.setGlobals(u)` | the app's globals at group 0, binding 1 | declare `@group(0) @binding(1) var<uniform> globals: MyGlobals;` in a shared include |
| `kit.shareGroup(i, include, { name: res })` | one bind group (i ≥ 1) shared by every shader that includes `include` | declare it before the passes that use it; per pass you can swap values: `kit.pass({ shared: { 1: { shadowTex: dummy } } })` |
| `new Ref(() => x)` | a value resolved when it's bound | e.g. "whichever texture is current". It's resolved once per run epoch (see Rule 6) |
| `kit.release(...things)` | destroy or dispose for good | streamed-out chunks; `kit.memory()` reports the bytes held |

Samplers: group 0 already provides `samp_linear`, `samp_repeat`, `samp_nearest` and `samp_shadow` (comparison). For a
sampler binding of your own, pass a name (`'linear' | 'repeat' | 'nearest' | 'nearest-repeat' | 'mirror' | 'shadow'`)
or a `GPUSampler` from `kit.sampler(desc)`.

**Work items** (anything you can put in `kit.run`)

| call | what |
| --- | --- |
| `kit.compute(shader, { entry, bind, constants, threads \| workgroups \| indirect, view, enabled })` | one dispatch. `threads` is divided by the shader's `@workgroup_size` for you |
| `kit.pass({ color: [{ target, clear, resolve }], depth: { target, clear, readOnly }, view, viewport, shared, replay, enabled })` | a render pass. `target: 'screen'` is the canvas. `clear: false` loads what's there |
| `pass.draw(shader, { vertex, fragment, bind, constants, count, instances, indices, indirect, blend, cull, depthWrite, depthCompare, topology, enabled })` | a draw in the pass. `fragment: null` makes it depth-only. `count` and `instances` can be functions, which are evaluated each frame |
| `pass.fullscreen(shader, { bind, … })` | a fullscreen triangle. The shader includes `weft/fullscreen` and has a fragment entry taking `FullscreenOut` |
| `pass.bundle(label).draw(...)` | static draws recorded once into a `GPURenderBundle` and re-recorded only when something they use changes |
| `kit.copy(src, dst)`, `kit.raw(enc => …)`, `kit.action(() => …)`, `pingpong.swap` | a copy, raw encoder access, and a CPU step at that point in the list |
| `new MipChain(kit, tex)` | fills a texture's mips |
| `new Taau(kit, hdr, depth, opts)` | temporal AA and upscaling. Run `taau.items`, then read `taau.out` |

Every item accepts `enabled: boolean | () => boolean`. Prefer that over rebuilding the run list. Draws and computes
have `.set(name, value)` to rebind one resource later (the layout stays the same), `.ready()` to wait for their own
pipeline, and `.dispose()` to remove them for good.

**The loop**: `kit.loop(cb)` drives rAF, resizing, `kit.time`, `kit.dt` (clamped to 1/15 s and scaled by
`kit.timeScale`) and the overlay. When frames are stepped by hand (films, captures, a hidden tab), use `kit.manual =
true` with `kit.step(dt)`. Use `kit.maxFps` to cap the rate.

**Views and cameras**: `kit.camera` is the main view's `Camera` (`position`, `yaw`, `pitch`, `roll`, `fovY`, `near`,
`lookAt(eye, target)`, `ortho`, `viewOverride`, `cut()`, `sees(center, r)`, `ray(px, py, w, h)`). For a second
viewpoint (a shadow cascade, a mirror, a probe), use `kit.view(camera, size)`, and pass that view to the passes and
computes that draw from it (`view: v`). Each view has its own `Frame` uniform and a `user: vec4` slot. A yaw of 0 looks
down −z, and positive yaw turns left.

## WGSL side

- **Includes**: `#include "./common"` (relative to the file; `.wgsl` optional), `#include "weft/frame"`, `"weft/fullscreen"`,
  `"weft/mesh"`, `"weft/output"`, `"weft/skin"`, `"weft/lodfade"`; `"loom/env"`, `"loom/common"`, … with the plugin's
  `libs`. Each file is included once, and compile errors point at the real `file:line`.
- **Group 0** (`weft/frame`): `frame: Frame` holds `viewProj, view, proj, invViewProj, invProj, invView, prevViewProj,
  camPos, camFwd, camRight, camUp, time, dt, near, frame (u32), res, invRes, jitter, fovY, aspect, mouse, user`.
  After `user` (0.2.8; none of the fields before it moved): `viewProjRel, invViewProjRel, prevViewProjRel` (the same
  matrices with the eye at the origin, for positions relative to the eye; `prevViewProjRel` is last frame's about this
  frame's eye, the eye's move taken in doubles) and `camLo` (what float32 lost of the eye: `camPos + camLo` is the eye).
  **Draw camera-relative** so a world far from its origin stays sharp: `clipAt(p)` for a world position (as
  `viewProj * vec4(p, 1)`, but `(p − camPos) − camLo` through `viewProjRel`), `clipRel(r)` for a position already
  relative to the eye (an origin − camera computed in doubles on the CPU, plus local), `prevClipAt(p)` / `prevClipRel(r)`
  for motion vectors, `fromEye(p)`, and `relFromDepth(uv, d)` (a position relative to the eye from depth:
  `worldFromDepth` without the large coordinates). On the CPU the same are `Camera.viewRel`, `viewProjRel`,
  `invViewProjRel`, `prevViewProjRel`, `camLo`. A `viewOverride` camera (a shadow cascade, a reflection) takes its eye
  from that Float32 matrix, so its `camLo` is 0 and it is only as precise as the matrix far from the origin: give it a
  `position` in doubles and a rotation-only override when it must be exact there.
  Also there: samplers at bindings 2–5 and `globals` at binding 1. Don't declare anything else in group 0: binding fails
  with an error that tells you so.
- **Depth is reversed-Z with an infinite far plane.** Clear depth to `0` and keep in mind that a larger depth is
  nearer. A draw's default `depthCompare` is `'greater-equal'`; a fullscreen draw's is `'always'`, without depth
  writes. `linearDepth(d)`, `worldFromDepth(uv, d)` and
  `viewRay(uv)` are in `weft/frame`. A positive `depthBias` pulls toward the camera.
- **UVs**: a fullscreen pass's `uv` runs from (0, 0) at the top left, with y pointing down. That's also the uv
  convention of `worldFromDepth` and `viewRay`.
- **Variants are `override` constants**, set per draw or compute with `constants: { NAME: 1 }` (booleans as 0 or 1).
  Don't build WGSL source strings. Pipelines that differ only in their label share one compile.
- **The browser gets lean code** (`plugin/lean.ts`): no comments, only what the module's entry points reach, and a
  uniform-only struct cut after the last field it reads. Browsers cache compiled pipelines keyed on that code (Chrome
  on the exact text), so a comment, an unused function or a new field in a shared include no longer recompiles every
  shader that includes it. A code line that's kept is kept exactly, so a runtime `code.replace` of a whole line still
  works. `weft({ lean: false })` sends the whole text.
- **Chrome keeps ~6 MB of compiled pipelines per site.** Past that, every load evicts what the next one needs and
  compiles it again (San Francisco's load writes ~21 MB: each warm desktop load recompiled ~100 pipelines). What fills
  it: each pipeline's generated code, so every override variant and every shared function a shader reaches counts.
  Keep a project's first frame, and ideally its whole load, under that.
- **Bind by name**: `bind` keys are the WGSL variable names. A name the shader doesn't declare throws a `BindError`
  that lists the names it does have. Only the bindings an entry point actually uses go into its layout, so a binding
  you've commented out doesn't break anything, and a used binding that isn't provided fails loudly. The reflection
  follows every function an entry point calls, however deep. Comments in some projects say it only sees one call
  deep; those comments are out of date.
- **Shared helpers already exist**, so don't paste new copies into each shader. `loom/common` has `sat`, `luminance`,
  hashes (`hashu`, `hash12`, `hash13`, `hash22i`, …), `fbm`, `fbm3` and `rot2`; `weft/mesh` has `srgbToLinear`;
  `weft/output` has `srgbEncode`, `srgbToP3` and `canvasEncode`; `weft/lodfade` has `ign` (interleaved gradient noise)
  and a dithered LOD crossfade. Projects have defined their own `rotY`, `srgbToLin`, `fbm` and hashes dozens of times.
- **A project's own world include**: kit-only projects keep a `world.wgsl` that declares their globals struct
  (group 0, binding 1) and a shared group 1 of world textures. Set it up once with `kit.setGlobals(worldUniforms)` and
  `kit.shareGroup(1, worldShader, { … })`, and have every other shader `#include` it.
- **Group numbering**: group 0 is the frame. Under loom, group 1 is loom's shared environment (`env.wgsl`). weft's own
  helper shaders (the painter, the mip chain, the texture viewer) use group 3, but a project can still use group 3 for
  its own shaders: shared groups only serve the shaders that include the file declaring them. A project under loom puts
  its per-draw bindings in group 2, and in group 1 where loom's env isn't included.
- **Mesh vertices** from `MeshBuilder` are pulled from a storage buffer by `vertex_index` (`weft/mesh`: `MeshVertex`,
  40 bytes; `meshPos`, `meshNormal`, `meshUV`, `meshColor`), not through vertex buffers.
- **Last pass to the canvas**: `#include "weft/output"`, tone-map yourself, then
  `return vec4f(canvasEncode(mapped, P3), 1.0);` with `override HDR`/`P3` set as in the example above. On an HDR canvas,
  values above 1 are brighter than SDR white.

## Rules that save hours

1. **A draw or compute with no pipeline yet does nothing, and nothing reports it.** A one-off pass run right after it's declared
   (a bake, a mip fill, a readback) silently renders nothing. Await its own pipelines first:
   `await kit.ready(fill)`, `await pass.ready()` or `await kit.ready(items)`, then `kit.run(items)`. When nothing is
   given, `kit.ready()` waits for **every** pipeline declared so far, so don't use it to wait on one pass in the
   middle of a game.
2. **Declare draws and computes once, at setup, and never inside the loop.** Each one is a pipeline record and a
   compile. For something that comes and goes, use `enabled`. To swap a resource, use `draw.set(name, value)` or a
   `Ref`. To vary what's drawn, change a uniform, a `count` function or an indirect buffer. For a buffer that loads
   later, bind `new Ref(() => this.buf ?? dummy)` with a small placeholder buffer, plus `enabled: () => !!this.buf`.
   **A pass draws its draws in the order they were declared**, so a system declared late lands after everything else,
   including the translucent draws. Declare in drawing order, or give translucent work its own pass. (Three projects
   have each written their own "insert this draw before that one" helper.)
3. **A uniform buffer has one value per `kit.run`.** Dirty uniforms are uploaded with `queue.writeBuffer` before the
   run's commands are submitted, so changing one in a `RunAction` or between two draws doesn't give those draws
   different values. Give each draw its own buffer, or index a storage array by instance.
4. **Each view's Frame is filled once per frame**, at that frame's first `kit.run`. Camera changes between two runs in
   the same frame don't reach the shaders unless you call `view.update(true)`.
5. **Leave `camera.jitter` alone when TAAU is on.** Taau sets it for the next frame as its items run. After a teleport
   or a cut, call `camera.cut()` (or `taau.cut()`). When a floating origin moves, call `taau.shift(dx, dy, dz)`. Things
   that move by themselves ghost less if you hand over motion vectors (`velocity`: rg = uv now − uv last frame).
6. **A Ref's target can change only between run epochs**, because a bind group is resolved once per epoch. Each
   `kit.run` starts an epoch, and so does each `RunAction` in it. That's why `pingpong.swap` is a run item: put it in
   the list between the passes that should see each side.
7. **Mind the binding budget.** WebGPU's baseline, which plenty of phones have exactly, is 16 sampled textures and 8
   storage buffers per shader stage. loom's env already binds about ten textures. Pack data into existing buffers
   before adding bindings, and test with the lab's `?lowlimits` idea: `createKit(canvas, { limits: {
   maxSampledTexturesPerShaderStage: 16, maxStorageBuffersPerShaderStage: 8, maxStorageTexturesPerShaderStage: 4 } })`.
8. **WebKit (every iPhone browser) compiles pipelines one at a time.** Asking for hundreds at once froze an iPhone for
   about 10 s. While building a world there, set `kit.compiler = new SerialCompiler(kit)` (when `isWebKit()`), and
   put back the previous compiler after `await kit.ready()`. Don't trust its GPU
   timestamps: `FrameBudget` paces by frame intervals instead.
9. **`r32float` textures are unfilterable** unless the device has `float32-filterable`, which weft requests when it's
   available. weft builds the layout to match, but in WGSL read them with `textureLoad` or a non-filtering sampler.
   Depth textures are the same unless the shader declares `texture_depth_2d`.
10. **Free what you stream out** with `kit.release(...)`. A texture that's merely dropped stays in `kit.textures`, and
    a resize reallocates it.
11. **Hot reload keeps state.** Editing a `.wgsl` file rebuilds only the pipelines made from it. Uniform values carry
    over by field name, and buffers keep their contents. You don't need to reload the page after shader edits. After
    editing TypeScript, the page reloads as usual.
12. **Don't fork engine code into the project.** If weft, loom or cast is missing something, add it upstream, in the
    weft repo, so every project gets it. Several projects have carried drifting copies of the same thing, and these
    copies have since been merged back into the packages. Check the package exports (`dist/**/*.d.ts`) before writing
    a camera, sky, film grade, asset loader, frame budget, rig or audio voice of your own. What projects still carry
    copies of: `isWebKit` and `FrameBudget` (both in weft), a temporal upscaler (weft's `Taau`), screenshot, film and
    R2 dev-server middleware (weft/vite's sinks), and an atmosphere, shadow cascades and clouds (loom's `world/sky` and
    `Renderer`).

## Debugging

- `?debug` in the URL (or the backquote key) opens the overlay. It lists the passes that ran with their GPU times,
  with a switch to turn each off. It also has a texture viewer for any texture, sliders from `// @range(min, max,
  step)` annotations (after `kit.overlay.tweak(uniformBuffer)`), the errors so far, and memory.
- With `debug`, every item is encoded inside its own error scope, so a validation error names the pass it came from.
  Errors reach the console as `[weft <kind>] <label>: …`, and shader errors as `file:line:col`.
- The `label` you give a resource, pass or draw is what errors, the overlay and GPU captures show. Name things.
- `kit.ready()` resolves to `{ pipelines, failed, … }`. Log it once at startup.
- `kit.memory()` returns `{ textures, buffers, total }` in bytes. `kit.errors` holds the current errors.
- Pictures from a headless or hidden tab: `await shot(kit, 'name')` with `shotSink({ dir })` in the Vite config, or
  `new Capture(kit)` with `cap.grab()` / `cap.step(dt)`. For films, `filmSink({ dir })` takes POSTed frames and audio.
- Device performance from a phone: `perfBeacon(kit, { url: '/__beacon' })` with `beaconSink`.

## Recipes

**A bake before the game starts** (a heightfield fill, a cubemap, mips):
```ts
const bake = [fill, kit.copy(heights, terrain), new MipChain(kit, terrain)];
await kit.ready(bake);
kit.run(bake);
```

**GPU-driven drawing**: a compute culls and writes draw arguments (instanceCount 0 where culled), then one draw
issues them all:
```ts
const args = kit.storage({ label: 'args', size: pieces * 20, usage: ['storage', 'indirect'] });
const cull = kit.compute(cullShader, { bind: { pieces: data, args }, threads: [pieces] });
scene.draw(shader, { indices: { buffer: idx, format: 'uint32' }, indirect: { buffer: args, count: pieces, stride: 20 } });
kit.run([cull, scene]);
```

**Static geometry** (a city, a temple): put it in a bundle (`const city = scene.bundle('city'); city.draw(...)`). It
replays with one call a frame and re-records only when something it uses changes.

**A reflection or second camera**: `const v = kit.view(mirrorCam, 0.5)` (half the render size), then
`kit.pass({ view: v, ... })`. To draw what another pass draws without declaring it twice, use
`kit.pass({ view: v, replay: scenePass, replayFilter: (d) => !d.label.startsWith('bird') })`. The targets' formats
must match the source pass's.

**Reading the GPU back**: `await tex.readTexel(x, y)` reads one texel a frame or two later without stalling (for
picking or the cursor's depth). `await buf.read()` copies a whole buffer back.

**HDR, a second canvas, images**: `createKit(canvas, { hdr: true })` and `kit.hdr`. `kit.sibling(canvas2)` gives a
second canvas on the same device (an overlay drawn at full resolution). `loadImageTexture(kit, url, { srgb: true, mips:
true })` decodes off the main thread.

**Holding the frame rate**: `kit.autoRes = new AutoResolution(budgetMs, { min: 0.5 })`, or `FrameBudget` for phones.
Both move `kit.renderScale`, and `'render'`-sized textures follow. Pair it with TAAU so a lower scale stays sharp.
`LoadGuard` steps a heavy load down to a lighter profile after one that crashed the tab.

**Big assets**: `new Assets({ keep: 'app-objects' }).init()` maps paths to content-addressed R2 URLs (`assets.url(p)`).
`Pack.load(assets, name)` streams tiles by Range request. The `remoteAssets()` plugin serves the R2 copy in dev when a
file isn't on disk. To publish, run `node node_modules/@ericrius1/weft/tools/publish-assets.mjs`.

**A planetarium dome**: `new Fulldome(kit, { size, source })` stitches six `Camera.shift` views into a 180° fisheye.
Turn off screen-space effects (vignette, grain, lens flares, shafts, motion blur, temporal accumulation) while
rendering it.

## loom: the renderer

loom's `Renderer` builds a whole cinematic frame and gives you the passes to add your draws to:

```ts
import globals from '@ericrius1/loom/shaders/globals.wgsl';
import { Renderer, noTerrain } from '@ericrius1/loom/render/renderer';
import { Atmosphere, celestial } from '@ericrius1/loom/world/sky';
import { applyQuality, loadQuality, phoneOr, rendererOptions } from '@ericrius1/loom/quality';

const W = kit.uniforms(globals.structs.World, 'world');
kit.setGlobals(W);                                                  // loom's `world`, group 0 binding 1: you fill it
const terrain = noTerrain(kit);                                     // or your own { heightTex, normalTex, splatTex, maskTex }
const atmo = new Atmosphere(kit, terrain.heightTex);
const q = loadQuality('myapp', phoneOr('smooth'));                  // 'mobile' on a phone unless the player chose
const r = new Renderer(kit, terrain, atmo, HALF, rendererOptions(q, { taau: true }));   // HALF: the map's half size, m
applyQuality(kit, r, q);
r.scene.draw(myShader, { bind: { … }, count });                    // your opaque draws
r.addSky();
await kit.ready();

kit.loop(({ time, dt }) => {
  const cel = celestial(hour, dayOfYear, latitude, 0);
  const mats = r.updateShadows(cam, cel.lightDir);
  const ripple = r.ripples.update(cam.position, dt);
  r.update({ time, dt, cam, light: cel.lightDir, night: cel.nightness, hour, seaLevel, cover: 0, under: 0 });
  W.set({ sunDir: cel.sunDir, lightDir: cel.lightDir, nightness: cel.nightness, /* … */ shadow0: mats[0], shadow1: mats[1],
    shadow2: mats[2], cascades: [...r.cascades, 2], ripple, cloudMap: r.clouds.cloudMap, hfWin: r.hf.win, lights: [r.lightCount, 0, 0, 0] });
  kit.run([...atmo.items(), ...r.items(cel.lightDir)]);
});
```

The weft repo's `examples/lab/town.ts` is this loop, complete, with every `World` field it sets. loom reads its
shadow matrices, ripple window, cloud map and light count from `world`, so leaving one of them unset breaks that
feature without any error.

- **Where your work goes**: `r.scene` is the opaque scene pass (MSAA at `msaa: 4`). `r.reflPass` with `r.reflView` is
  the mirror over the sea (half resolution, mirrored, so use `cull: 'none'`). `r.shadowPasses` / `r.shadowViews` are
  the depth-only cascades. `r.fx` is for glows and particles after the clouds (single-sample, depth read-only).
  `r.compute` is for simulations that must land before the passes, and `r.beforeFx` for work after the scene's depth
  is complete. A draw that should appear in the reflection and the shadows has to be added to those passes too (or
  replayed). A shadow draw is depth-only, with its own vertex entry:
  `r.shadowPasses.forEach((p) => p.draw(shader, { vertex: 'vs_shadow', fragment: null, bind, count }))`. Your
  own shaders can bind the renderer's resources: `r.depth`, `r.sceneCopy` (the scene before the water) and `r.refl`
  (all textures), and `r.expo` (a storage buffer holding the eye adaptation's current exposure). The frame's order is the list in `r.items()`: read `render/renderer.ts` when you need the details.
- **Surface shaders** `#include "loom/env"` and get loom's shared group 1 without binding anything. The helpers include
  `terrainHeight(xz)`, `skyRadiance(dir)`, `applyAtmosphere(col, wp)`, `shadowAt(wp, n, px)`, `lightDiffuse(albedo, n,
  wp, px, ao, wrap)`, `ambientAt(wp, n)` (sky, or irradiance probes with `gi`), `pointLightsAt`, `pointLightsSpec`,
  `rippleAt(xz)` and `skyReflect(r)`. `world` (loom's globals at group 0, binding 1) holds `sunDir`, `lightDir`,
  `nightness`, `wind`, `seaLevel` and more.
- **Options** (`RendererOptions`): `msaa: 1 | 4`, `clouds: 'volumetric' | 'sprites' | 'none'`, `shadowSize`, `taau`,
  `lights: { max }` (more than 32 lights are clustered), `gi: { min, max, spacing }` (irradiance probes) and `ripples`.
  Point lights are set with `r.setPointLights(list, camPos)`.
- Other modules are imported by path: `@ericrius1/loom/terrain/clipmap`, `world/forest`, `weather/rainfall`,
  `render/volume`, `render/film`, `render/clouds`, `destruct/rubble`, `physics/box3d`, `audio` (a procedural Web Audio
  engine: `audio.bus('sfx' | 'music' | 'amb')`), `camera/autopilot`, `particles`. Each module's header comment explains
  how to use it.

## cast: characters

CPU only: it poses bones and gives you dual quaternions. The project keeps its own mesh, shader and look.

```ts
import { HeroRig } from '@ericrius1/cast/rig';
import { loadHero } from '@ericrius1/cast/asset';
const rig = new HeroRig(await loadHero(url, { maxBones }));
rig.update({ dt, time, pos, yaw, vel, speed, running, onGround, wade: 0, landImpact: 0, pose, look: null, wind, ground });
skin.write(rig.dq.subarray(0, rig.nBones * 8));     // a storage buffer, read in WGSL through weft/skin
```

In the vertex shader: `#include "weft/skin"`, declare `DQ: array<vec4f>` (two per bone), then
`let q = skinBlend(bones, weights); let p = skinPoint(q, bones, weights, pos); let n = skinDir(q, bones, weights, nrm);`.
cast's README lists every module (face, speech, garments, strands, strokes, the body solver, performers), and its
MIGRATION.md explains how a project replaces its local copy.

A pianist (`@ericrius1/cast/piano`) plays a seat at any `Playable` keyboard (`pianoPlayable(geometry, sound)` for a
piano). `p.sit(playable, from, yaw)`, then `p.playScore(score)` plays a `{ notes: { note, t0, t1, vel }[], pedal:
{ t, down }[], duration }` on the frames' dt, calling `noteOn`, `noteOff` and `pedalSet`. Pass
`p.playScore(score, { clock: () => transport.seconds })` (after `sit()`) to tie it to your audio clock instead: the
whole piece is planned once, and the hands are posed from the clock's second alone, so a slow or dropped frame never
puts a finger on the wrong key. `p.struck` lists every stroke (hand, finger, `t0`, `up`) to schedule the sound ahead,
and `p.simplified` names any note it had to stretch for. `p.stopScore()` stops it and takes the hands off the clock.

The hand as a hand (`@ericrius1/cast/fingers`, cast 0.3.0): `HandModel.of(asset, 'L' | 'R')` reads a body's bind hand
(null unless every finger and the thumb are three bones each), and `solveHand(model, solve, ask)` places several
fingertips at once with each joint inside a person's range (`body/anatomy.ts`: knuckle spread and the webs, the thumb's
opposing saddle, the palm's arch, enslaved neighbours). You rarely call it yourself. The rig uses it for every
`HandGoal` with fingertip targets (`tips`), on any body with three-bone fingers. A goal without targets poses an older
body's fingers exactly as before. A target more than about a finger's length from its knuckle fades out (by 1.5
lengths it's let go) and the finger keeps its own rest, so a hand still on its way to a flute's holes doesn't reach
for them straight-fingered. Five `HandGoal` options steer the solve:

- `palmFree` (0..1, default 0): how far the palm may move and turn from the goal's `palm`/`fwd`/`down` to reach its
  fingertips (1: within the wrist's and arm's ease, a few cm and tens of degrees). The palm and fingers are solved
  together and the arm is handed the palm as solved. Use it for a hand that places itself on its notes (keys, a
  fingerboard). Leave it 0 for a hand held to something (a flute's holes). Ignored with `exact`.
- `tipW` (per finger, thumb first, default 1): how much each target counts. Lower it for a finger that only hovers
  over its place, so it gives way to the fingers that are playing.
- `square` (per finger, 0..1): how square a finger comes down on its target (1: its middle joint well bent and its end
  joint with it, the tip meeting the string end-on), as a guitarist's or violinist's stopping finger does.
- `lay` (per finger, 0..1): how flat a finger lies along what it presses (1: its middle and end joints straight and held
  down along the surface too). Use it for a barre, the index laid across every string.
- `floor` (`{ at, n, clear }`, world): a surface the fingertips without a target keep `clear` metres above (the keys'
  tops, a fingerboard), so a resting finger never sinks into it.

A fretting or stopping hand (a guitar, a violin) gets its goal from the instrument each frame: the fingertip targets
on the strings at their frets or stops (null for a finger not stopping), `palmFree: 1`, `turn: 0`, `square` for the
stopping fingers, `lay` for a barre, the fingerboard as `floor` (a point on it, its normal toward the hand, `clear`
~0.006), and a starting frame the solve moves from. Put `palm` near where the hand sits under the neck (the knuckles
by the board's edge), `fwd` along the hand across the neck, and `down` with the palm toward the board. The solve starts
there each frame (warm from the last), so a frame a few cm off still lands. One on the wrong side of the neck does not.
On a built hand, give the goal the neck too (cast 0.5.0: `neck: { at, axis, up, half, depth, air?, w?, rest? }`,
world): `at` a point on the fingerboard's surface over the neck's middle by the hand, `axis` the neck's way, `up` out
of the board toward the strings, `half` the board's half width and `depth` the neck's depth under it (m). The solve then
keeps the palm `air` off the wood (default 12 mm) and the knuckles and joints just touching, `rest` (0..1) draws the
index's base onto the board's edge (1 on open shapes, 0 through a barre), and the hand is a player's: its thumb rests
wrapped round behind the neck (give the thumb's tip a target on the neck's back or over its edge), and a finger with
`tipW` under 0.5 hovers lifted from the knuckle (`HeroRig.neckHand`). `elbowW` of 100 or more keeps the elbow the goal's
`elbow` way whatever the arm's ease (a violinist's left elbow under the fiddle; below 100 it's weighed against the
arm's ease, default 0.35). The bow hold and the pick are grasps: `grasp(M, 'bow', size)` and `grasp(M, 'pinch', size)`
solved once, placed each frame with `graspGoal` (below).
`rig.handMiss(i)` gives each fingertip's miss after the solve (m) for checking. `HeroRig.handIters` (default `[8, 6]`)
caps the iterations a frame, and `HeroRig.keysHand` holds a hand's rests at the keys.

The pianist uses the same solve: on a clock it fingers each chord with the run of fingers that fits it (thumb and
little finger too, up to an octave and a white key a hand), the palm free, and the long fingers playing further in
than the thumb (`p.fingerIn`). For a body with a built hand, call `p.forHand(asset.header.hand.len)` before `sit()`.
It places the palm where real players hold theirs (knuckles back and over the wrist, the hand long across the keys)
and sets `reach`, `pitch`, `hover`, `idleHover`, `fingerIn`, `idleW`, `idleLift` (idle thumbs and little fingers ride
highest), `idleClear` (18 mm: how far a finger with nothing to play keeps over the keys), `idleRelease` (a let-go
finger eases to an idle one's weight), `blackIn` (cast 0.5.0: how much further along a black key the long fingers land
than the thumb and little finger, 3 cm at Katara's 17.8 cm hand) and `prior: 1` for a hand of that length. Bodies without one keep the defaults.
With `prior` (cast 0.4.0: `HandGoal.prior`, 0..1, built hands at the keys only) real pianists' hands shape the hand:
the playing fingertips land on their keys, and the idle fingers, the thumb, the arch and how the playing fingers bend
take the posture real hands have with those fingers down (`body/handprior.ts`, a Gaussian fitted from 431 tracked
overhead hands). An idle finger is held off its key as a lever, lifted at the knuckle, not curled into a hook. At the
keys every body's thumb rests as a pianist's (`HeroRig.keysHand.thumbIdle`/`thumbTip`), and the Pianist lets a
finger's last key go 0.2 s after release.

A body file can carry its own hand: `header.hand` (`{ source, len, breadth }`: where the modelled hand came from, its
wrist-to-middle-fingertip length in m, its breadth against the source's) says the hand is grafted on and weighted to
its own bones. With it, `fitHands` leaves the weights alone, and with nothing to reach the fingers rest through the
hand model (each about its own knuckle's axis, a relaxed hand's curls) instead of the older bodies' one-axis curl.
cast only checks that `header.hand` is there. World's graft also writes `v: 2` for a hand with anatomically placed
joints and metacarpals, which cast doesn't read. The two optional bones `ring0L/R` and `pinky0L/R` (the ring and
little metacarpals, parents of `ring1`/`pinky1`) are found by name and turn with the palm's arch. Without them a
built hand still works, with no arch in the skin. A file without `header.hand` loads and poses as before.
A built hand's thumb opposes as a person's does (its pad turns about 100° round to the fingers at full opposition; the
column flexes to 62°, the MCP to 75°). A hand that isn't built keeps the older saddle and ranges.

Grasps (`@ericrius1/cast/grasp`, cast 0.4.0, built hands): solve a hold once per thing and size, then place it each
frame. The solve is in the hand's own space (x along the hand, y toward the thumb, z out of the palm):

```ts
import { HandModel } from '@ericrius1/cast/fingers';
import { grasp, graspGoal, heldWorld } from '@ericrius1/cast/grasp';
const M = HandModel.of(asset, 'R')!, hb = asset.bones[asset.index.handR];
const hl = Math.hypot(hb.tail[0] - hb.head[0], hb.tail[1] - hb.head[1], hb.tail[2] - hb.head[2]);
const g = grasp(M, 'wrap', { r: 0.035, len: 0.12 });            // a glass; g.miss, g.into, g.opp say how well it holds
const goal = graspGoal(M, g, 'R', hl, { at: glassCentre, axis: [0, 1, 0], near: shoulder });
rig.update({ ...input, hold: { hands: [null, goal], w: [0, 1], stoop: 0 } });
const shape = heldWorld(g, goal, 'R', hl);                      // where the held shape is, to draw it or test it
```

The kinds are `wrap`, `power`, `stick`, `bow`, `pinch`, `tripod`, `stem`, `flat`, `rim`, `clasp` and `cloth`
(`GRASPS`). `size` is `{ r, len, thick }` (m). `graspGoal` takes the shape's centre `at` and its `axis` (a glass's up,
a tool's head end, a disc's normal out of the palm), plus `from` (the way round it the palm comes from) or `near` (the
way round that puts the wrist nearest that point). It returns a `HandGoal` whose `pose` holds the solved fingers.
Without a solve, `HandGoal.around` (`{ at, axis, r, len?, pad? }`, world; a ball has `axis` [0,0,0]) with `grip` set
closes a built hand's fingers joint by joint until each touches the shape, the thumb swinging round first.

The hand's solve gives the same bits in every JavaScript engine (cast 0.4.0). `math`'s `dsin`, `dcos`, `dexp`,
`datan2` and `drotateAxis` use + - * / only, and `q30` rounds what enters the solve to a 2^-30 grid, so a film
rendered headless in Node poses the hands exactly as a visitor's browser does. The rest of the body can still differ in
the last bit.

A modelled face (`header.faceRig`: lips, a jaw opening on teeth, brows and lids built into the body, not drawn) has its
face bones moved as far as a real face's, with the lips following the speech's shapes (spread for ee, round for oo,
press for m b p, tuck for f v). Its fields: `gain`, `jaw` (the full opening, rad, default 0.24), `shapes` (each
shape's own gain), `attend` (0..1: steadier eyes for someone speaking a metre away) and `lidOpen` (0..1). To move a
mouth with a recorded voice, build its timeline from the recording's word times, not the text's guessed pace:
`rig.face.speech = { tl: lineFromWords(text, words, env), t, w: 1 }` (`@ericrius1/cast/speech`; `words` is one
`[t0, t1]` per whitespace-separated word of `text`, `env` the optional loudness envelope `{ rate, v }`), with `t`
advanced by the audio's clock.

## Where to look in the source

| question | file (in `src/`, `shaders/` or `plugin/`) |
| --- | --- |
| what `kit.*` does, the frame loop, `View`, `AutoResolution` | `src/kit.ts` |
| draw, compute and pass options, pipeline sharing, compile scheduling | `src/passes.ts`, `src/compile.ts` |
| how a binding resolves, the `BindError` messages, shared groups | `src/binder.ts` |
| buffers, textures, Ref, PingPong, readback | `src/resources.ts` |
| struct layout from reflection | `src/struct.ts`, `plugin/wgsl.ts` |
| the Vite plugin and the dev-server sinks | `plugin/vite.ts` |
| TAAU, frame budget, device detection | `src/taau.ts`, `src/budget.ts`, `src/device.ts` |
| the shader library | `shaders/*.wgsl` |
| what changed, version by version | `CHANGELOG.md` |

## Changing weft itself

Work in the weft repo (github.com/ericrius1/weft), not in a project's `node_modules`. Build it with `npm run build`, and
test with `npm test -w @ericrius1/weft` (and `-w @ericrius1/cast`). Bump the package's `version` and add a
`CHANGELOG.md` entry, then push to `main`. CI builds the dist branches within a minute or two, and every project
picks the change up on its next dev server or build. Keep the files LF.
