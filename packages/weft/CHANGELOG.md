# Changelog

## 0.2.8

- **Camera-relative matrices**, for drawing far from the world's origin: `Camera.viewRel` (the view's rotation alone),
  `viewProjRel`, `invViewProjRel`, `prevViewProjRel` (last frame's, taken about this frame's eye) and `camLo` (what
  float32 loses of the eye's position: `position − fround(position)`). The `Frame` uniform carries them after its old
  fields (`viewProjRel, invViewProjRel, prevViewProjRel, camLo`): nothing that was there moves, and a shader that
  doesn't read them is given the same code as before. `weft/frame` gains `fromEye(p)` (`(p − camPos) − camLo`),
  `clipAt(p)` (a world position's clip position through the relative matrix: as `viewProj * p`, without the eye's
  large translation rounded into the product), `clipRel(r)` (a position already relative to the eye) and
  `prevClipAt(p)`.
- **`AGENTS.md`'s cast section** covers cast 0.6.0: a reference pose for a built hand (`HandGoal.ref`), `neck.restAt`,
  `stopRest`/`stopW`, the bow grasp drawn in.
- **`AGENTS.md`'s cast section** covers cast 0.5.0: a neck held in the hand (`HandGoal.neck`) for a fretting or
  stopping hand, the bow hold and the pick as grasps, `elbowW` of 100 or more, `Pianist.blackIn`.
- **`AGENTS.md`'s cast section** covers cast 0.4.0: grasps (`grasp`, `graspGoal`, `HandGoal.pose`), `HandGoal.around`,
  the built hand's thumb, real pianists' hands as a prior (`HandGoal.prior`, `Pianist.forHand`), the hand's solve the
  same in every engine, a modelled face (`header.faceRig`) and lip timing from a recording (`lineFromWords`).
- **`AGENTS.md`'s cast section** covers the hand as a hand (cast 0.3.0's `fingers`): each `HandGoal` option for
  fingertips (`palmFree`, `tipW`, `square`, `lay`, `floor`), how an instrument gives a fretting or stopping hand its
  goal, `Pianist.forHand`, and a body file's own hand (`header.hand`, the optional `ring0`/`pinky0` bones).
- **`AGENTS.md`'s cast section** says how to play a score with cast's pianist, on the frames or on an audio clock
  (cast 0.2.0's `playScore(score, { clock })`).
- **`triangulate`** is exported from the package (the ear clipping MeshBuilder's polygons use): a footprint or a
  river's outline triangulated for a roof or a surface (Dublin's district), no copy in the project.
- **`AGENTS.md`**, shipped in the package (`node_modules/@ericrius1/weft/AGENTS.md`): a guide for coding agents in the
  projects. It covers the kit, loom's renderer and cast on one page: the model, setup, every call with its options, the WGSL
  side (group 0, reversed-Z, uv, includes, the shared helpers), the rules that cost hours (an uncompiled draw is
  skipped silently, one uniform value per run, draw order, the binding budget, WebKit's compiles), debugging, recipes,
  and where in the source to look.
- **`weft/skin`** (`shaders/skin.wgsl`): dual-quaternion skinning for a mesh posed on the CPU — four bones and weights
  blended into one dual quaternion (antipodal ones the short way round), a point and a direction through it, faded to
  linear blending where the bones are nearly half a turn apart (a lunge's thighs: no flip from frame to frame). The
  including file declares `DQ: array<vec4f>` (two a bone). The skinning Boulder's heroes and townsfolk, Seven Havens'
  and Codevember's shaman each carried a copy of; it also skins what's laid on a body at run time (cards anchored to
  its vertices: `skinBlend` from a packed `unpackBones` and unpacked weights).
- **`kit.ready(mipChain)`** waits for a `MipChain`'s own passes (pipelinesOf takes any run item made of passes), and
  `mipChain.ready()` does the same: a chain run before its pipelines compiled drew nothing and left the mips black
  (a texture's far mips then, seen at a grazing angle or from afar, black).

## 0.2.7

- **`Taau`** (`src/taau.ts`, `shaders/taau.wgsl`): temporal anti-aliasing that upscales. The view's camera is jittered
  by a Halton offset each frame (set for the next frame as its items run, so every pass of a frame sees one jitter);
  each frame's render-size samples are gathered into a history at the canvas's size (`output: 'render'` for AA alone),
  reprojected by the camera's motion — a matrix made in doubles from the camera's step alone, never from world
  positions, so a camera 2000 km up or at San Francisco's coordinates reprojects as precisely as one at the origin —
  or by the app's own motion vectors (`velocity`, rg: uv now − then); dropped where the depth it remembers (kept in
  its alpha) isn't the depth that should be there now (what moves by itself — a robot's arm, a pole — and what was
  uncovered), clipped to the frame's neighbourhood (variance box in YCoCg, blended in a tonemapped space after the
  app's `exposure`), less of it the faster it moves, a wide-kernel upsample wherever it can't be used, then sharpened by local contrast (`sharpen:
  false` saves that canvas-size texture). An MSAA scene's depth is read as it is (its first sample). The history drops
  on `Camera.cut()` (new: `camera.cuts`), on a jump (`jump`: a step far past the last one, a sharp turn), on a new
  output size; a render-scale change keeps it. `shift(dx, dy, dz)` carries it across a floating origin's move;
  `taau.jitter` the frame's jitter for ray marches that build their own rays. Tried in San Francisco, Boulder,
  Universe, PortfolioII's home and drake: at 0.5–0.6 of the canvas it comes close to native with TAA, and holds still
  far better than Boulder's and San Francisco's own temporal upscalers (Boulder's forest at 0.6: 0.16 % of pixels
  flickering against 2.24 %; its lab: 1.4 % against 10 %).
- **`RenderPassOptions.replay`** (and `replayFilter`): a pass draws another pass's draws — its bundles opened up —
  from its own view into its own targets (same formats), e.g. a probe's six cube faces seeing the scene.
- **Plugin**: a page load reloads any shader changed on disk since it was loaded (a rebuilt package's dist, deleted or
  renamed into place, could drop the watcher's hold and serve the old one).

## 0.2.6

- **`Pack.range(a, n, signal)`**: a run of a pack's bytes in one Range request, retried like a tile (San Francisco's
  streamer fetches a row's neighbouring tiles at once); `bytes()` goes through it.
- **`Assets` `early`**: the fetches a page started before its bundle ran, path → promise, each taken once by `init`
  (the manifest) or a plain `fetch(rel)`; `takeEarly(rel)`.
- **`earlyFetch()`** (plugin/vite.ts): a build's index.html asks for the first view's files itself (the R2 map, packs'
  indexes, small binaries) into `window.__early`, and preconnects to the R2 map's hosts. San Francisco's early start.

## 0.2.5

What San Francisco and Boulder each carried a copy of, shared: every addition is new, nothing before it changes.

- **Assets** (`Assets`, `Pack`, `inflate`, `decodeH16`): an app's files beside it under /assets in development and
  content-addressed on R2 once published, by a manifest (remote.json: path → URL) a build ships; with `keep`, the
  content-addressed objects (objects/<sha256>/…) held in Cache Storage for the next visit (Boulder's: the HTTP cache
  dropped two thirds of ~100 MB between two visits) and `forgetExcept` to let go of a past deploy's. A `Pack` is a layer
  too big to fetch whole, its tiles byte ranges of one file (San Francisco's terrain): a tile by Range request, retried
  with backoff, abortable, and from a server that ignores the range too. `decodeH16`/`unpackH16`/`packH16`: the h16
  height-tile codec (two byte planes of row-predicted, zig-zagged u16s, deflated). Tested without a network.
- **Images** (`loadImageTexture`, `loadImageArray`, `textureFromBitmaps`, `generateMips`, `warmMips`, `solidTexture`):
  Boulder's — decoded off the main thread, mip chains filled at once by a tiny pipeline made on the spot (MipChain's
  compile asynchronously: a one-off run right after would draw nothing), the common formats' pipelines warmed in the
  background so a texture arriving later doesn't stall the page on a compile; `max` keeps a big image from its first mip
  within a size (a phone's memory).
- **The device** (`isWebKit`, `isPhone`, `gpuName`, `isAppleGpu`) and **the load guard** (`LoadGuard`): a load that
  crashed the tab, the GPU or the machine steps the next one down a ladder of profiles, kept as the heaviest auto may
  choose; a GPU lost while shown does the same. Tested without a browser.
- **`FrameBudget`**: Boulder's and San Francisco's dynamic resolution (an `AutoResolution`), tuned on an iPhone 16e —
  paced by the frames on WebKit (whose timestamps and queue don't measure the GPU), a frame the CPU made late not
  counted, never back to a scale that missed in the last 45 s; the queue's time where there are no timestamps; the
  governor's `starved` and `roomy`; `keep`: the scale that held kept for the next visit. Tested without a GPU.
- **`shot(kit, name)`**: a picture of the view stepped by hand (`kit.step`, `Capture`), so it works in a hidden tab or
  pane and headless; posted to the dev server's **`shotSink`** (plugin/vite.ts), written to shots/<name>.jpg.
- **`perfBeacon(kit, { url })`**: every few seconds the frame rate, worst frame, GPU time, render scale and size — and
  the app's own fields — posted from a device you can't attach a profiler to; the dev server's **`beaconSink`**
  (Boulder's) logs them to shots/perf/beacon.jsonl.
- **`remoteAssets()`** (plugin/vite.ts): dev and preview send an asset not on this disk to its R2 copy (the map re-read
  when it changes); a build ships the map as assets/remote.json and leaves out what only R2 serves (`omit`).
- **`tools/publish-assets.mjs`** (in the package): an app's big files up to R2 as objects/<sha256>/<name> through
  Wrangler, the map written; `--match` globs, `--dry`.
- **`#include "weft/lodfade"`**: the dithered crossfade between two levels of detail (San Francisco's buildings'):
  `ign` (interleaved gradient noise), `lodFadeT`, `lodFadeDrop` — each pixel drawn by exactly one level.

## 0.2.4

- **A texture sized by the canvas, too small for its mips, is made big enough to hold them**: before the canvas is
  measured the render size is 1×1, and a texture of it with mips (loom's bloom, 6; its AO depth, 3) was a validation
  error at startup, its mip views errors after. Now such a texture's longer side is at least 2^(mips−1) until the canvas
  is sized (then it's reallocated at its real size, as before); a fixed size and `mips: 'full'` are as they were.
- **A shader can be told whether its draw's alpha to coverage is on**: a fragment shader declaring
  `override ALPHA_TO_COVERAGE: bool` gets 1 or 0 (unless the draw sets it), so on a one-sample pass — a phone's, loom's
  `msaa: 1` — it can cut out by alpha (discard) instead; such a draw isn't warned about. Tested without a GPU.

## 0.2.3

- **From GitHub only**: npm is retired — every project takes the `dist/weft` and `dist/loom` branches (README,
  Releasing), built from each push to main; the npm publishing workflow is gone (0.2.2 never made it there: npm refused
  the publish).
- **`profiler.trusted`**: whether the device's timestamps add up. A frame's GPU time can't stay far past the time
  between its frames, and an iPhone's (WebKit, iOS 26; Chrome there is WebKit too) came out at seconds a frame at 12
  frames a second — `AutoResolution` read that as hopelessly over budget and held the render at its least. Of the first
  60 frames read back, more than half over 200 ms and four times the frames' interval (`wallMs`, by the clock) and
  they're not trusted, for good (a warning says so); `AutoResolution` then paces by the frames' intervals, as it does
  with no timestamp-query at all.
- **`SerialCompiler`** (`src/compile.ts`), a compile scheduler for `kit.compiler`: one pipeline at a time, a frame
  apart. WebKit compiles them one by one and answers nothing else meanwhile: a hundred asked for at once — a world built
  in the background while another shows (Universe building Seven Havens' gardens) — showed no frame for ten seconds on
  an iPhone 16e. Nothing held back (kit.ready() waits for them all); one needed before its turn is made on the spot.

## 0.2.2

- **`AutoResolution` paces by the frames where the GPU can't time itself**: a phone's Safari has no `timestamp-query`, so there it never moved and a phone drew at the scale it started at. With no GPU timing it now watches the frames' intervals (a second's worth at a time, their slower quarter against the display's own interval, 60 Hz at the fastest, times `slack`, 1.25): over, down by about what it'd take to keep up; on time three seconds running, a step up, and a scale that ran late just after it was stepped up to isn't tried again for twenty seconds. `paced: false` keeps the old behaviour (stay put). After Universe's FramePace.
- **A compile scheduler is asked for every record sharing a compile** while it hasn't landed, the first ask it lets through starting the one compile. Asked only for the record that started it, a compile the scheduler held back for that one (a mirror's view of a house, not in the first frame) kept its twin, which the first frame waits on, waiting too: boulder's load never finished in Chrome.
- **A multi-draw indirect** (`indirect: { buffer, offset, count, stride }` on a draw): `count` indirect draws (default
  1), `stride` bytes apart (default 20 indexed, 16 not), each reading its own arguments — a GPU cull's one draw per
  piece, those it culled with no instances. Still one Draw (one pipeline, one bind, one record in a bundle) however
  many pieces, so a bundle replays them all with one call a frame; `count` may be a function (asked each frame, as
  the other counts are: a bundle records again when it moves). Without `count`, one draw, as before.
- **`kit.sibling(canvas, opts)`**: a kit for another canvas, drawn with this kit's device: an overlay at the display's
  full resolution over a world drawn at less (ericlevin.dev's way in: the page's words handed to the GPU over the
  world as it comes in), a second view. Its own size, frame, passes and resources; drive it by hand (beginFrame, run,
  endFrame) or with its own loop. The device's errors and its loss are reported by the kit that made it (it used to
  take a second `new Kit` on the same device, which reported every error twice), and a sibling has no debug overlay of
  its own (its errors still show).
- **`Texture.writeImage(source, o)`**: an image into a texture (a canvas, an ImageBitmap, a video or a VideoFrame, its
  own size read off it), all of it or a part (`from`, `size`, at `origin`), with `premultiply` (as filtering and mips
  want for anything with transparent edges) and `flipY`.
- **Draws and computes that would make the same pipeline share one** (`kit.pipelineCache`, `SharedPipeline`;
  `src/passes.ts`). A pipeline was made per draw and compute even when its descriptor was another's, and concurrent
  asynchronous creates of one descriptor each compiled from scratch: Seven Havens declares 206 at load — a character's
  near and far meshes, each classic, drawn and inked, in the scene and its shadow cascades; a mip chain's levels;
  bloom's steps — of which 108 are distinct. Now each record (`kit.pipelines`: a draw's or compute's label, errors,
  `ms`, wait) joins the compile of its descriptor's key: the descriptor with the label left out, the layout as the
  description of its bind group layouts (`Binder.layoutKey`: equal descriptions are already the same
  `GPUBindGroupLayout`s; a shared group's is now its structure, not its label) and each stage's module as its shader
  and version. Identical pipelines share one compile, in flight or done, and one GPU pipeline (labelled as the first
  record that asked for it). A hot edit makes new keys (the shader's version), so its records compile anew; a compile
  leaves the cache with its last record (disposed, or rebuilt into another) or when it fails — each record sharing it
  reports the failure under its own label, and the next record asking tries again. `record.shared` says a record
  waited on another's compile (its `ms` is that wait); the overlay counts the distinct pipelines and leaves those out of
  its slowest, marking how many records share each (`×n`). A compile scheduler is asked once per distinct pipeline,
  and a record made on the spot is made for all sharing its compile. Constants an entry doesn't read are left out of
  its descriptor, as if none were given. `PipelineRecord` takes a describe function now; `make` and `makeNow` are
  methods (a scheduler's `rec.makeNow(module)` as before).

  Seven Havens' production build on the PC (the 5090, headless Chrome, D3D12; median of three cold loads each, the
  0.2.1 engine and this one alternated; the same picture but for the film's grain):

  | | 0.2.1 | this |
  | --- | --- | --- |
  | GPU pipelines made at load | 206 | 108 |
  | their compiles' ms, summed | 110 s | 69 s |
  | the slowest compile | 2.3 s | 1.8 s |
  | `load.world` | 4.35 s | 4.01 s |
  | `load.ready` | 5.37 s | 5.00 s |
- **`kit.ready(...items)` waits for those alone**: computes, passes (their draws and bundles), draws, bundles, records,
  and lists of them, so a run list can be given as it is (`await kit.ready(items); kit.run(items)`; an empty list waits
  for nothing); `pass.ready()`, `compute.ready()`, `draw.ready()`, `bundle.ready()` for one. `kit.ready()` with nothing
  given is, as before, the whole app — every pipeline declared so far, and those declared while it waits — and its
  doc comment and the README say so: Seven Havens' canyon, awaiting it to run one fill, waited 2.5 to 3 s for every
  other shader. Both resolve with `distinct` beside `pipelines` and `failed`. loom's terrain waits for its own passes.
- **The profiler's smoothed times drop passes that stopped running** (`Profiler.stale`, 60 frames read back): a perf
  readout showed passes run only while loading as current costs. Timing again after a while off starts afresh.
- `npm test` covers the key and the sharing, the waits and the profiler without a GPU (a stand-in device;
  `test/hooks.mjs` lets Node load dist's extensionless imports).

## 0.2.1

- **Fulldome** (`Fulldome`, `domeLayout`; `src/dome.ts`, `shaders/dome.wgsl`): a planetarium's domemaster, a 180-degree
  equidistant fisheye with the zenith at the centre and the heading at the bottom rim, made from six perspective views
  of one moment — the four sides' upper halves and the zenith face's two halves, each widened by a margin (6 degrees)
  and all the same size, so one canvas renders every one — and stitched on the GPU, four taps a pixel, each seam
  feathered across the margin so one view's screen-space effects fade into the next's. The views' detail matches the
  dome's (size / pi pixels per radian) or `oversample`s it. `npm test` checks the whole hemisphere is covered and the
  orientation. Made for boulder's 5-minute 4K dome film ("A Boulder Christmas", rendered on an RTX 5090 at about half a
  second a frame with 1.4x oversampled views).
- **`Camera.shift`**: a lens shift (normalised device units), an off-axis frustum that keeps the camera's axis where it
  points while its frame slides across the image plane. Unlike `jitter` (the TAA's, in pixels) nothing per-frame resets
  it; the two add.
- **`Texture.read()` keeps its staging buffers** (two per size) instead of making and destroying one each call: a film
  reading a 4096 dome every frame allocated 67 MB a frame.
- **`viewRay` follows an off-axis projection.** It rebuilt the ray from `proj[0][0]` and `proj[1][1]` alone, so any
  shifted or jittered projection drew what used it (a sky, an atmosphere, fog) misaligned with the geometry: a lens
  shift put the sky's horizon in the middle of the frame, and the TAA's jitter moved the sky by its sub-pixel offset
  against everything else. It now adds `proj[2].xy`.

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
