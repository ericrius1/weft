# Changelog

## 0.2.0

Measured on the lab's bench (`examples/lab/bench.html`: N cubes, each its own draw with its own group, all sharing a
16-binding environment group; `kit.run` CPU time, median of 300-400 frames, 0.1.1 and 0.2.0 run back to back the same
way, headless Chrome on an Apple-silicon Mac):

| | 0.1.1 | 0.2.0 | 0.2.0, bundled |
| --- | --- | --- | --- |
| 2,000 draws | 5.2 ms | 0.4 ms | 0.1 ms |
| 2,000 draws + 4 shadow cascades (10,000 draws) | 28 ms | 4.1 ms | 0.2 ms |
| 2,000 draws, each bound through a ping-pong Ref | 5.8 ms | 0.6 ms | (not for bundles) |

- **Every name an entry point reads counts, however deep.** wgsl_reflect missed a binding or override read only inside
  an index that follows a member access or another index (`world.levels[i32(u.level.x)]`, `data[0][u.i.x]`): the
  binding fell out of the pipeline layout ("uses bindings in group 2 but the PipelineLayout doesn't have a
  BindGroupLayout") and an override fell out of the constants, silently keeping its default. The plugin now walks every
  function an entry reaches through its whole syntax tree and adds what wgsl_reflect missed (parameters and locals that
  shadow a binding's name aren't it). `npm test` covers it. The stale compiled copies under `plugin/` are gone (the
  package's `exports` always pointed at `dist/`).
- **Bind groups by numbers, once per run epoch.** A group remembers the bind group it made and what that holds (uid and
  version per binding, compared as numbers: no key strings per draw). A group of direct resources is reused untouched
  until a resource is reallocated (`kit.resourceGen`) or a value is set on it; a group holding a `Ref` or a buffer range
  is resolved once per run epoch (`kit.bindEpoch`: each `kit.run`, and each `RunAction` in it, starts one), so draws
  sharing a group resolve it once; a resolution finding the same resources reuses that bind group or one of the last
  few (both sides of a ping-pong). `View.group0()` is made again only when the Frame buffer or the globals change.
  This is boulder's "run epoch" + "bind memo" patch, native. **The rule it rests on: a Ref's target changes only between
  epochs** — in a RunAction (as a ping-pong's swap does) or between runs, not inside a RawItem or a draw's callback.
  Resource `version` is an accessor now: bumping it by hand (after rewriting a texture) bumps `kit.resourceGen` too.
- **`pass.bundle(label)`: static draws in a GPURenderBundle** (`DrawBundle`, at that point of the pass's order, with
  `draw()` / `fullscreen()` like a pass). Its draws are recorded once and replayed with one call a frame. It re-records
  itself when a draw is added, disposed, set, switched on or off or rebuilt, when a pipeline lands or changes, when the
  pass's formats or view or a shared group's bind group change; after any reallocation it replays its draws' logic
  without the GPU and re-records only if their calls differ. Options given as functions are asked each frame. Plain
  options changed in place need `bundle.invalidate()`; Ref-bound draws make it re-record whenever the Ref moves (it
  warns once). `bundle.records` counts its recordings. A bundled draw can't have an `encode` callback.
- **Alpha to coverage needs samples**: a draw asking for it in a one-sample pass gets it turned off, with a one-time
  warning, instead of a pipeline that fails (and a draw that never draws).
- **Compile info timeout**: a module whose `getCompilationInfo` never answers (WebKit, now and then) is used as it is
  after 4 s (warned once), so it can't hold `kit.ready()` for ever.
- **Profiler raw samples**: `lastFrameMs`, `lastMs` (ms per pass label) and `serial` (bumped per frame read back), beside
  the smoothed `frameMs` / `ms`.
- **The loop can't die**: `step()` guards `beginFrame`, the frame callback and `endFrame`, `endFrame` guards the texture
  viewer, the profiler, the overlay and AutoResolution, and the rAF tick re-arms in a `finally` — whatever throws is
  reported and the next frame comes. `beginFrame` resets the frame's state before resizing (a resize that threw used to
  leave last frame's swapchain view to be drawn into). The overlay's texture viewer reports and lets go of a texture it
  can't show; a stat that throws shows its error.
- **Shared groups by include** (behaviour change): a shared group now serves the shaders that include the file declaring
  it (found from the declaring shader's `@group(n)` lines), not every shader using that group index. weft's own group-3
  shaders (painter, mip chain, texture viewer) work beside an app's shared group 3, and an app shader with its own
  bindings in a shared index (a tonemap in group 1) binds them per draw. A shader that re-declared a shared group's
  bindings by copy, without the include, used to get the shared group: include the file instead (the "not provided"
  error now says so).
- **HDR canvas (opt-in)**: `createKit(canvas, { hdr: true })` configures rgba16float with `toneMapping: { mode:
  'extended' }`, in Display P3 where supported, when the display reports `(dynamic-range: high)` and the browser can
  tone-map a canvas (`'force'` skips the display check); otherwise the canvas is SDR as before. `kit.hdr` says which:
  `{ enabled, format, colorSpace, toneMapping }`, and `kit.format` follows. The last pass writes colour in the canvas
  colour space with the sRGB transfer (which P3 shares), past 1 brighter than SDR white on HDR: the new
  `#include "weft/output"` has `canvasEncode(linear, p3)`. The lab's `?hdr` shows it.
- **Release and memory**: `destroy()` on a Texture, UniformBuffer or StorageBuffer frees it for good (it leaves the kit's
  sets, so a resize doesn't reallocate it and the run stops uploading it); `dispose()` on a Draw, DrawBundle,
  RenderPass, Compute, View, MipChain or Painter stops it and takes its pipelines out of `kit.pipelines`;
  `kit.release(...things)` does either. `kit.memory()` tallies the bytes of textures (`Texture.bytes`: every mip, layer
  and sample) and buffers (`kit.buffers` now tracks storage buffers); the overlay shows it.
- **Compile scheduler (opt-in)**: an app's `kit.compiler` says when each pipeline compiles (WebKit compiles one at a
  time): records built while it holds are `deferred` (`kit.ready()` doesn't wait for them) and made on the spot when
  first needed (`PipelineRecord.makeNow` with `kit.moduleNow`); `PipelineRecord.gate` holds a draw back. Boulder's
  `util/compile.ts` runs on it unchanged. Without a compiler nothing changes.
- `Capture` keeps the kit's canvas configuration (it used to reset it, dropping HDR) and reads an HDR canvas back as
  8-bit sRGB. `kit.configureCanvas(usage)`, `kit.warnOnce(key, message)`.
- `pass.draws` is `PassItem[]` (`Draw | DrawBundle`); `Draw.enabled` is an accessor; `Draw.dispose()` called twice no
  longer removes the pass's last draw. `MipChain` lets its old passes go when a resize rebuilds them.

## 0.1.1

- `Texture.readTexel(x, y)`: one texel back to the CPU without stalling the frame, staging buffers pooled so it can
  run every frame (picking, the depth under a cursor). Depth formats, which WebGPU only copies whole, are read by a
  one-thread compute.
- `Capture`: frames read back from the swapchain — `grab()` for screenshots (headless Chrome doesn't composite a
  WebGPU canvas into page screenshots), `step(dt)` / `blob()` for films rendered at a fixed step.
- `filmSink({ dir })` (from `@ericrius1/weft/vite`): a dev/preview-server middleware that writes a film's posted
  frames, soundtrack and metadata to disk.
- Profiler: a second `kit.run` in a frame resolved its timestamps to an offset WebGPU rejects (not a multiple of 256
  bytes), taking the frame's whole submit down; it now resolves from the 32-query block the range starts in.
- Draws skip `setPipeline` / `setBindGroup` when the pass already has that pipeline or group (consecutive draws with
  one pipeline, the frame group, shared groups). A draw's own `encode` callback resets the tracking.
- The package build (and so `npm publish`) runs from PowerShell and cmd too: `dist` is cleared with Node, not `rm -rf`.

## 0.1.0

- First release: the kit, the Vite plugin, the shader library.
