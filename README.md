# weft & loom

Two WebGPU libraries, the engine under the games at **[games.ericlevin.dev](https://games.ericlevin.dev)**
(Starthread, Stormbreak, Rainline, Fauve, Smithereens, Night Owl Arcade) and under the bigger worlds round them: San
Francisco, Boulder, Universe's dive from a cell to the edge of everything, the portfolio's home world, Drake's Highlands.

| package | what it is |
| --- | --- |
| [`@ericrius1/weft`](packages/weft) | A thin WebGPU kit. A frame is an explicit, ordered list of passes over named resources; WGSL is the single definition of the data. A Vite plugin makes `.wgsl` files typed, hot-reloading imports. Temporal upscaling, GPU-driven draws, a frame budget that holds a phone's frame rate. |
| [`@ericrius1/loom`](packages/loom) | A cinematic renderer built on weft: a physically based atmosphere, volumetric clouds and storm cells, the sea, rain, light in the air, light that bounces (irradiance probes), lamps by the hundred (clustered lighting), GTAO, bloom, eye adaptation and an AgX film grade — plus streamed land and forests, ink and toon light, breakable rubble on box3d, and a procedural audio engine. |

This page is the tour: how a frame is put together, then a closer look at the techniques inside, each with what it's
for, how it works and what it costs. The package READMEs are the reference; the long read on why it's built this way
rather than on a scene graph is at **[games.ericlevin.dev/engine/](https://games.ericlevin.dev/engine/)**.

- [The idea in one screen](#the-idea-in-one-screen)
- [A frame, from the ground up](#a-frame-from-the-ground-up): passes · WGSL as the source of truth · pipelines ·
  cheap encoding · GPU-driven draws · holding the frame rate
- [Deep dives](#deep-dives): [TAAU](#taau-a-full-size-picture-from-a-smaller-render) ·
  [irradiance probes](#light-that-bounces-irradiance-probes) · [clustered lights](#lamps-by-the-hundred-clustered-lighting) ·
  [the sky](#the-sky-an-atmosphere-in-four-tables) · [clouds](#clouds) · [water](#water) ·
  [the film](#the-film-from-light-to-a-picture) · [streaming worlds](#streaming-worlds) ·
  [stylized and breakable](#stylized-and-breakable) · [the binding budget](#lesson-the-binding-budget)
- [Install](#install) · [This repo](#this-repo) · [Releasing](#releasing)

## The idea in one screen

```ts
import { createKit } from '@ericrius1/weft';
import ripple from './ripple.wgsl';   // typed: ripple.structs.Sim, binding names checked
import water from './water.wgsl';
import post from './post.wgsl';

const kit = await createKit(canvas);
const state = kit.pingpong((i) => kit.storage({ label: `ripple${i}`, count: N * N, stride: 8 }));
const sim = kit.uniforms(ripple.structs.Sim).set({ size: N, damping: 0.996, speed: 0.35 });
const look = kit.uniforms(water.structs.Water).set({ size: N, extent: 40, heightScale: 0.6 });
const hdr = kit.texture({ format: 'rgba16float', size: 'render' });

const step = kit.compute(ripple, { bind: { sim, prev: state.read, next: state.write }, threads: [N, N] });
const scene = kit.pass({ color: [{ target: hdr, clear: [0, 0, 0, 1] }] });
scene.draw(water, { bind: { water: look, state: state.read }, count: (N - 1) * (N - 1) * 6 });
const out = kit.pass({ color: [{ target: 'screen' }] });
out.fullscreen(post, { bind: { hdr } });

await kit.ready();                      // every pipeline compiled before the first frame
kit.loop(() => kit.run([step, state.swap, scene, out]));   // what you list is what runs, in that order
```

No scene graph, no hidden scheduling. Bindings are passed by their WGSL variable names; a name the shader doesn't
declare is an error that says so. Edit a `.wgsl` file and only the pipelines made from it rebuild — the simulation keeps
running.

## A frame, from the ground up

### Passes over named resources

A GPU frame is a sequence of jobs, each reading some resources and writing others: a compute dispatch steps a
simulation, a render pass draws geometry into colour and depth targets, a fullscreen pass reads those and writes the
next. Engines built on a scene graph (three.js, most game engines) decide that sequence for you: you describe objects
and materials, and a renderer walks the graph, sorts, batches and schedules. That's convenient until you want something
the renderer didn't anticipate — a simulation feeding a shadow pass feeding a reflection — and then you're fighting
the scheduler.

weft makes the sequence the program. `kit.run([...])` encodes exactly the passes listed, in that order, into one
command encoder, and submits it. Resources are named objects with lifetimes the kit manages: textures that follow the
render size reallocate themselves on a resize (and every bind group that held them is rebuilt, because bind groups
are made from resource *versions*), ping-pong pairs swap with a run item (`state.swap`), copies are run items too. What
a frame does is readable top to bottom in one array — loom's whole cinematic frame is a single `items()` list.

### WGSL as the single source of truth

On the CPU side a shader's data has to be mirrored: a uniform struct's byte layout, with WGSL's alignment rules (a
`vec3f` is 16-byte aligned, a struct rounds up to its largest member, arrays have strides), the names and types of
every binding, the workgroup size of every entry point. Hand-mirrored, these drift.

So the Vite plugin compiles each `.wgsl` file at build time: it resolves `#include`s (keeping a line map, so a compile
error points at the real file and line), reflects the result (struct offsets and strides, bindings by name, which
bindings and overrides each entry point actually uses, workgroup sizes), and writes a `.d.wgsl.ts` beside it. A shader
import is then typed: `kit.uniforms(ripple.structs.Sim).set({ damping: 0.996 })` lays the values out exactly as WGSL
will read them, and `bind: { prev: ... }` is checked against the shader's own names. Only the bindings an entry point
uses go into its pipeline layout, so commenting out a use never breaks a bind. Change the file and the plugin hot-swaps
the module; the kit rebuilds just the pipelines made from it, and the simulation's buffers keep their state. Variants
are WGSL `override` constants, not string templating.

### Pipelines, compiled before they're needed

A pipeline (shader + layout + fixed state) costs real time to compile, and compiling one the first time it's drawn
is the classic mid-game hitch. weft creates every pipeline eagerly and asynchronously when the draw is declared;
`await kit.ready()` waits for all of them. Draws that would make an identical pipeline share one compile. WebKit (every
browser on an iPhone) compiles pipelines one at a time and answers nothing meanwhile — asked for a hundred at once, an
iPhone 16e showed no frame for ten seconds — so a `SerialCompiler` can ask for one a frame instead.

### Encoding cheaply

Encoding thousands of draws a frame in JavaScript is mostly bookkeeping: which pipeline, which bind groups. weft
resolves a bind group by comparing a few numbers (each resource's id and version), not by building keys, and reuses it
until something it holds is reallocated. Draws that never change — a city, a temple — can be baked into a
`GPURenderBundle` (`pass.bundle()`): recorded once, replayed with one call a frame, re-recorded only when something it
baked actually moved. `examples/lab/bench.html` prices this: thousands of draws across shadow cascades.

### Drawn by the GPU's own numbers

The fastest draw is the one the GPU decides itself. A compute pass can cull (test each piece against the view, its
distance, a level of detail) and write each piece's draw arguments into a buffer, zero instances where it's culled; then
one `drawIndirect` per piece — or one multi-draw over all of them — issues the lot without the CPU ever learning what
was visible. loom's forests do this for hundreds of thousands of trees: one thread per tree stands it on the ground,
tests it, sorts it into near / far / impostor / shadow-caster lists, and the draws read those lists.

### Holding the frame rate

Pixels are the dial: GPU time scales roughly with the number of pixels shaded, so `AutoResolution` reads the GPU's own
timestamps and steps the render scale by `scale × √(budget / measured)` — down quickly when over, up slowly when
there's room. Phones complicate this. An iPhone's timestamps are nonsense (a "frame" of 123 seconds) and its queue
answers ~40 ms late even when every frame is on time, so `FrameBudget` paces by the frames themselves there: down a step
once a tenth of them miss, up after five clean seconds, never back to a scale that missed in the last 45 (a phone warms
up and slows as it plays). A lowered scale used to mean a softer picture. With [TAAU](#taau-a-full-size-picture-from-a-smaller-render)
it doesn't.

## Deep dives

### TAAU: a full-size picture from a smaller render

`new Taau(kit, hdr, depth)` — weft, so any renderer on it can use it; loom's is `RendererOptions.taau`.

**The problem.** A pixel is a point sample of a continuous image. Edges alias into stair-steps, thin lines break into
dashes, and fine detail (distant windows, foliage, a checker floor) shimmers as the camera moves. MSAA fixes geometry
edges only, and costs four samples of every target. And rendering below the screen's resolution — the cheapest
performance lever there is — throws pixels away outright.

**The idea.** Spread the samples over time instead of space. Each frame the projection is shifted by a sub-pixel
offset (a *jitter*), so successive frames sample different points inside each pixel; a history buffer accumulates
them. Sixteen frames of jittered samples are, for a still image, sixteen samples per pixel. Keep the history at the
*output* resolution and the samples can come from a smaller render: each frame contributes a sparse, jittered set of
samples to a full-size image, and the image fills in. That's temporal anti-aliasing with upscaling.

The pieces, in the order the resolve runs:

1. **Jitter.** Offsets follow a Halton (2, 3) sequence, which covers the pixel evenly at every prefix length — better
   than random. The offset goes into the projection matrix's off-axis terms, so every pass of the frame (shadows aside)
   sees one consistent jitter, and the next frame's is set as this frame's resolve runs, whatever the app does with
   its camera before `kit.run`.
2. **Reconstruction.** For each output pixel, the 3 × 3 render texels around it are weighted by how near their
   *unjittered* centres fall to the pixel — a Blackman–Harris-like Gaussian, `exp(−2.29 d²)` with `d` in *output*
   pixels. When upscaling, most output pixels have no sample nearby on a given frame; they lean on their history until
   the jitter brings one close, which keeps the result sharp rather than smeared. The sum of weights says how much this
   frame actually knows about the pixel, and sets how much of it goes into the blend. Where the history can't be used at
   all, a second, wider kernel (in input pixels) gives a smooth upsample instead, so the render's own pixel grid never
   shows.
3. **Reprojection.** Where was this surface last frame? Take the nearest depth in the neighbourhood (so edges follow
   the foreground), and carry that point back through this frame's projection and forward through last frame's. The
   matrix that does it is built in JavaScript doubles from the camera's *step* — last frame's rotation times this
   frame's inverse, and the difference of the two positions — never from world positions. That matters more than it
   sounds: a float32 has a 24-bit mantissa, so two thousand kilometres from the origin a position is only good to about
   12 cm, and San Francisco's coordinates are big too. Built from the step, a camera in orbit reprojects as precisely
   as one at the origin. A floating origin's jump is passed in with `taau.shift(dx, dy, dz)`, and an app with its own
   motion vectors (what moves by itself) hands them over as `velocity`.
4. **Rejecting stale history.** Reprojection is only right for things that moved with the camera. The defence is
   *neighbourhood clipping*: whatever the current frame has around a pixel bounds what the pixel can plausibly be, so
   the history colour is clipped into that box. The box is built in YCoCg (luma separated from chroma, so the box hugs
   the colour distribution better than RGB) from the mean and standard deviation of the 3 × 3 neighbourhood, intersected
   with its min/max — a *variance* box. History that lay well outside it is let go faster (detail that changed in place,
   a window streaming in). Clipping fails for a thin object moving by itself — its neighbourhood still contains the
   background, so a stale background history passes the clip and the object fades — so the history also keeps each
   pixel's depth in its alpha channel: where the remembered depth doesn't match the depth that should be there now, the
   history is dropped. (Not at a silhouette against the sky: there the jitter flips pixels between the two, and the colour
   clip handles it.)
5. **Blending.** The new frame's share is small (1/12 at full confidence) so the history averages many frames, larger
   where the history was clipped hard, and larger the faster the pixel moves — every reprojection resamples the
   history a little softer. Colours are blended in a reversible tonemapped space, `c / (1 + luma)`, after the app's
   exposure: one blazing texel can't dominate the average and flicker.
6. **Sharpening.** A contrast-adaptive sharpen (CAS in spirit: less where the neighbourhood is already contrasty)
   restores what resampling softens. Optional, since some apps' final passes already sharpen.

The history drops on `Camera.cut()`, on a jump (a step far past the last frame's, or a sharp turn), or on a new output
size — but not on a render-scale change, since the history lives at the output size: AutoResolution can move the scale
every second and the picture holds. An MSAA scene's depth is read directly. Measured in the real games: at 0.5–0.6 of
the canvas it comes close to native resolution with TAA; in Boulder's forest at 0.6 scale, 0.16 % of pixels flicker
between still frames against 2.24 % with Boulder's previous upscaler (its lab: 1.4 % against 10 %); in San Francisco,
frame-to-frame change at street level fell to about a third of its previous TAA's at 0.6 scale. The resolve costs about 0.2–0.6 ms at 1600 × 900
on an M3 Max.

### Light that bounces: irradiance probes

`RendererOptions.gi` in loom (`render/probes`, `shaders/probes.wgsl`), read in shaders through `ambientAt(wp, n)`.

**The problem.** Direct light is easy: the sun, a shadow map, done. But much of what makes a place look real is light
that has bounced: the shadowed side of a courtyard lit warm by the sunlit wall opposite, a red wall tinting the floor
beside it, the dark under a bridge. A renderer without it lights every shadow with the open sky's ambient, whatever is
actually around — the classic flat, floaty look.

**The idea.** Sample the light arriving at a grid of points in space ahead of time — *probes* — and let each surface
interpolate between the probes around it. A probe records, for every direction, the light coming from that direction:
the sky where it's visible, the lit surfaces where something's in the way. A surface facing `n` gathers the cosine-
weighted integral of that over its hemisphere — its *irradiance*.

- **Storing a sphere of light in twelve numbers.** Irradiance is a very smooth function of direction (it's an integral
  over a hemisphere), so it needs very few terms of a spherical-harmonic expansion: the first two bands, L0 and L1 —
  a constant and a linear gradient — capture most of it. Projecting the incoming radiance `L(ω)` onto the basis
  (`Y₀₀ = 0.282095`, `Y₁ₘ = 0.488603 · (y, z, x)`) and convolving with the cosine lobe (Ramamoorthi & Hanrahan: band
  factors `Â₀ = π`, `Â₁ = 2π/3`) leaves four coefficients per colour channel, and then `E(n)/π = c₀ + c₁ nᵧ + c₂ n_z + c₃ nₓ`:
  one dot product per channel at shading time.
- **Capturing.** A probe is captured by drawing the scene into the six faces of a small cube (24 × 24 by default) from
  its point. loom doesn't ask the game to submit its scene again: weft passes can *replay* another pass's draws from
  their own view (`RenderPassOptions.replay`), so the probes see whatever the game already draws into the sea's mirror
  pass — its terrain, buildings and sky — with what moves (a dragon, birds) filtered out. A compute pass then integrates
  each cube onto the SH basis, weighting every texel by the solid angle it covers on the sphere,
  `dω = 4 / (N² (1 + u² + v²)^{3/2})`.
- **A few a frame.** Capturing every probe every frame would be absurd; instead a scheduler picks a few a frame (two
  by default): never-captured probes nearest the camera first, then round and round, the stalest and nearest first. A
  courtyard fills in within seconds, and the probes follow the time of day as they're recaptured, each recapture
  blended into what the probe held. Because the captured surfaces are themselves shaded with the probes, every
  round adds a bounce: multiple bounces converge for free.
- **Trust.** A probe that landed inside a wall or a rock sees nothing but the inside of it; its light would leak
  through. Each probe measures how much of its cube is a surface right up against it and is marked untrusted past a
  threshold; probes are stored premultiplied by that validity, so the trilinear blend of the eight probes round a point,
  divided by their blended validity, simply leaves the bad ones out. Surfaces also read the probes from a point pushed
  off them along the normal and toward the eye, so the probes behind a wall don't leak through it. Probes under the
  terrain are lifted onto it.

In the town lab, the shadowed side of a red wall goes from near black (sky only) to lit by the sunlit plaster and
paving across the courtyard; at dusk the lanterns' light bounces too.

### Lamps by the hundred: clustered lighting

`RendererOptions.lights: { max }` in loom (`render/clusters`, `shaders/clusters.wgsl`).

Forward shading loops over every light for every pixel. With 32 lamps that's fine; with a city's streetlights and
windows at dusk it isn't — most of the work is establishing that a lamp 300 m away doesn't reach this pixel. The fix
is to bin lights by where they reach, once, so each pixel only looks at its own bin.

loom's grid is centred on the camera, 32 × 16 × 32 cells over ±400 m across and ±200 m up, and *warped*: a cell's index
along each axis comes from the square root of the distance, so cells are small near the eye (where light detail
matters) and large far off. Each frame a compute pass gives one thread to each cell; it computes the cell's world-space
box by inverting the warp, tests every light's sphere against it (and a spotlight's cone, widened by the box's angular
size), and records up to 24 light indices. Lights are sorted nearest-first on the CPU beforehand, so an overcrowded cell
keeps its nearest. A surface finds its cell from its world position — any pass can use the grid, not just the main
camera's — and loops only that cell's list. With 1000 lamps at 2560 × 1440 on an M3 Max, the frame went from 30–38 ms
to 5.5 ms; the picture is identical.

### Lesson: the binding budget

A GPU limits how many resources one shader stage can bind: WebGPU's baseline is 16 sampled textures and 8 storage
buffers per stage, and plenty of phones offer exactly that. loom's shared environment (the sky, aerial perspective, the
terrain's maps, shadows, ripples, clouds' shadow) is bound into every surface shader — ten textures before a shader adds
its own. The first version of the probes added one 3D texture, which pushed the cloud march to 17 and would have broken
clouds on those phones (the lab's `?lowlimits` caught it). So the probes and the light grid live *inside the point
lights' own storage buffer*, after the lights, one 64-byte record per probe or cell, read with plain indexing. No shader
binds anything new for either feature.

### The sky: an atmosphere in four tables

loom's sky follows Hillaire's 2020 production atmosphere. Real sky colour comes from light scattering off air
molecules (Rayleigh: strongly wavelength-dependent, hence blue) and aerosols (Mie: forward-scattering, the glow round the
sun), absorbed by ozone, scattered again and again. Integrating that per pixel is far too slow, so it's precomputed into
lookup tables: *transmittance* (how much light survives a path through the atmosphere, by altitude and angle) and
*multiple scattering* (the energy of all the higher-order bounces, approximated as isotropic) are made once; a *sky-view*
table of the sky's radiance in every direction from the camera, and *aerial perspective* froxels (in-scattered light and
transmittance along each view ray, in 32 depth slices to 48 km) are made every frame. A surface's colour is then
`colour × transmittance + in-scatter`, one 3D texture read. The same tables light everything — the sun's colour at each
altitude, the sky's ambient projected to spherical harmonics — so sunsets redden the land and the clouds together.

### Clouds

Volumetric clouds in the spirit of Guerrilla's Nubis: a weather map that evolves and drifts (coverage, type from
stratus to cumulonimbus, base height, storminess) over a Perlin–Worley shape volume, cut by a height profile per type,
eroded by curl-distorted Worley detail (wispy underneath, billowy on top). Light uses a light volume (optical depth toward
the sun and straight up, baked a slice band a frame) plus two short taps for the billows' own shading, Wrenninge's
multiple-scattering octaves over a dual-lobe phase function with a droplet lobe for the silver lining, and Hillaire's
energy-conserving integration of each step. Marching that every pixel every frame is too slow, so it's split: a near
layer marched every frame with a short history, a far layer marched a quarter of the pixels a frame on a deterministic
lattice with a long history, each reprojected by its own depth and clipped in tonemapped YCoCg. Lightning relights a
storm cell from inside; things flying through tear holes that heal. Or, for stylized skies, sprite clouds: lit sprite
clusters fixed in the world, sorted and composited back to front.

### Water

The sea is a camera-following radial grid displaced by a sum of Gerstner waves (points move in circles, which sharpens
crests the way real swell does), calmed over the shallows, shaded with refraction of the scene behind it absorbed
per colour channel by the thickness of water the light crossed — turquoise over sand, deep blue over the drop-off — a
planar mirror, a sun glint and foam. Round the player, a ripple simulation: a *dispersive* heightfield (iWave:
`h'' = −g |k| h`, the `|k|` a 13 × 13 convolution staged in workgroup memory). Real water waves are dispersive — long
ones outrun short ones — which is what turns a splash into a widening train of rings and a moving body's wake into a
feathered Kelvin wedge; a plain wave equation gives single hard rings and a rubbery cone. The simulation window is
toroidal (a cell's slot is its world index modulo the size), so following the player only clears the cells that scroll in.

### The film: from light to a picture

The scene is rendered in HDR — actual radiance, from moonlight to the sun's disc — and turned into a picture the way a
camera and film would:

- **Ambient occlusion**: GTAO at half resolution (horizon-based: how much of each pixel's hemisphere is blocked by the
  depth buffer around it), multi-bounce coloured, depth-aware denoised, applied only to the ambient share of the light.
- **Bloom**: a mip chain down with a 13-tap filter (Jimenez, *Call of Duty: Advanced Warfare*; Karis-averaged on the first
  level so single bright pixels don't sparkle) and back up with a tent filter. Mixed in rather than added, so it's the
  scene's own light spread wider, not extra energy.
- **Eye adaptation**: a centre-weighted histogram of log luminance (64 bins over 24 stops), the mean of its 15th to
  90th percentiles (no deepest shadows, no sky glare) set against a key that sits lower at dusk and at night, the
  brightest highlights protected, approached at the eye's speed — faster toward the light than into the dark.
- **Tone mapping**: AgX (a filmic transform that desaturates very bright colours toward white the way film and the eye
  do, instead of clipping hue), then a grade (split toning by time of day, scotopic night vision — dim light loses its
  colour and shifts blue), vignette, grain and dither.
- **Light in the air**: lamps' beams in rain and mist, sampled *equi-angularly* along each view ray (Kulla & Fajardo:
  samples bunch where the ray passes nearest the lamp, so the inverse-square falloff cancels out of the estimate and a
  handful of samples per lamp is smooth).

### Streaming worlds

- **Clipmaps** for land too big to hold: nested square windows of height, colour and surface class around the camera,
  each coarser level covering more ground at less detail, stored toroidally (a texel's slot is its index modulo the
  window) so moving the window rewrites only the row or column of tiles that came in. Tiles stream in from range-addressed packs on R2 and each fades in over the coarser level, so nothing pops.
- **Forests**: 16 bytes per tree (position, archetype, height, crown, seed), culled and sorted on the GPU each frame
  into near, far, impostor and shadow-caster lists. Far off, impostors are thinned by seed — a share
  `keep = (d₀ / d)²` survives, each survivor widened by `1/√keep` to cover for the ones let go — so a wood keeps its
  look while its count stays bounded.
- **The terrain's long shadows** come from its heightfield: each texel marches toward the sun with growing steps
  through coarser mips, keeping how far below the ray the ground stays — a soft penumbra the width of the sun, rebuilt a
  band of rows a frame.

### Stylized and breakable

- **Ink outlines** from one observation: reversed-Z depth is `1/z`, which is linear across any plane in screen space —
  so its second difference is zero on every flat face at any angle and spikes at creases and silhouettes. One test finds
  both. The line wobbles and redraws a few times a second, like a hand's.
- **Toon light** blocks light the way a painter does: the lit side in the light's warm colour, the shade in a cool
  complementary one (a white wall's shadow violet, a yellow one's orange), a hot line where they meet.
- **Things that break**: structures are convex cells held by bonds; an impact's energy (½mv² from the physics engine's
  hit events) snaps bonds and shatters cells into Voronoi fragments — each fragment the cell clipped by the bisector
  planes to every other fracture site (Sutherland–Hodgman). Parts that lose their path to the ground fall as one body and
  break again where they land. Thousands of pieces draw in one call.
- **Sound** with no samples: a procedural Web Audio engine — wind, fire, engines, a dragon's roar, water from Minnaert
  bubble resonances (a bubble of radius `r` rings near 3.26 m / r Hz), generative scores.

## Install

```bash
npm install @ericrius1/weft
npm install @ericrius1/loom   # the renderer, if you want it
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { weft } from '@ericrius1/weft/vite';

export default defineConfig({ plugins: [weft({ libs: { loom: '@ericrius1/loom' } })], build: { target: 'esnext' } });
```

```jsonc
// tsconfig.json
{ "compilerOptions": { "allowArbitraryExtensions": true, "types": ["@webgpu/types", "vite/client", "@ericrius1/weft/client"] } }
```

## This repo

```
packages/weft     the kit (src/), its shader library (shaders/), the Vite plugin and WGSL compiler (plugin/)
packages/loom     the renderer, world, physics glue and audio (src/), its shaders (src/shaders/)
examples/lab      the smallest complete use of the kit: a compute ripple tank (?hdr for an HDR canvas); bench.html
                  prices encoding thousands of draws (?n=2000&cascades=4&bundle=1); checks.html exercises the kit;
                  town.html is loom's renderer over a courtyard and hundreds of lanterns, for TAAU (?scale=0.5,
                  ?debug), the probes (?gi=0) and clustered lights (?lights=1000, ?cluster=0), and ?lowlimits for a
                  phone's binding limits
```

```bash
npm install
npm run build      # both packages
npm run dev        # the lab
WEFT_SRC=1 npm run dev   # the lab on the kit's source: engine edits without a rebuild
```

Working on the engine and a game together: `npm link` the packages into the game, or point its dependency at a
local path (`"@ericrius1/weft": "file:../weft/packages/weft"`), then rebuild here as you go.

## Releasing

GitHub is where the packages come from — not npm (retired: nothing goes there any more). Push to `main`:
`.github/workflows/dist.yml` builds and tests both packages and commits each, packed as npm would pack it, to a branch
of its own, `dist/weft` and `dist/loom`. Every project depends on those branches,

```json
"@ericrius1/weft": "git+https://github.com/ericrius1/weft.git#dist/weft",
"@ericrius1/loom": "git+https://github.com/ericrius1/weft.git#dist/loom"
```

and never has to be bumped by hand: the next dev server, build or deploy of every project takes the branches' tips.
Each project has the same small script, [`tools/engine-latest.mjs`](tools/engine-latest.mjs) (this copy is the
canonical one; copy it over the projects' when it changes), wired in as

```json
"predev":   "node tools/engine-latest.mjs",
"prebuild": "node tools/engine-latest.mjs --strict",
"weft":     "node tools/engine-latest.mjs --strict"
```

and wherever a deploy builds without `npm run build`: the Vercel projects' `installCommand` (`npm ci && node
tools/engine-latest.mjs --strict`: PortfolioII, Universe), Boulder's Dockerfile (Railway: after `npm ci`), and the
deploy scripts that call `vite build` themselves (Seven Havens, Aether, Cell, Universe). It reads the tips of
`dist/weft` and `dist/loom` over HTTPS (no git needed, ~0.3 s; nothing else happens when the project is already
there), and when the installed or locked commit is behind, moves it: `npm update` where git is installed (the lockfile
moves too: commit it), or `npm install --no-save` of the tip's commit where it isn't (Railway's slim Node image; npm
takes the commit's tarball from GitHub). It checks the result. `--strict` fails the build when the tip can't be
confirmed; without it (dev) an offline machine is told so and runs on what it has. `ENGINE_LATEST=0` skips it.

So a fix propagates by pushing weft's `main`: once dist.yml has pushed the branches (a minute or two), every project's
next `npm run dev` or build has it. A project only *changes* when it is next built: Vercel/Railway projects on their
next deploy, the builds copied into PortfolioII's `public/` (Cell, The Gem Dancers, Gong Bong) when they're rebuilt
and copied, Seven Havens and Aether when their `tools/deploy.sh` runs again. Dev servers use the dist builds too, the
same bits a deploy ships (loom's audio worker only loads from dist); `WEFT_LOCAL=1 npm run dev`, where a project has
it, compiles `../weft`'s source in for live engine work. Bump the package's `version` and its CHANGELOG with what
changed, so a project's lockfile says which it has.

## License

MIT © Eric Levin
