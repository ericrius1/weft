# @ericrius1/loom

A cinematic WebGPU renderer on [`@ericrius1/weft`](https://github.com/ericrius1/weft).

- **Sky & light**: a physically based atmosphere (after Hillaire 2020: transmittance + multiple-scattering LUTs, a
  sky-view LUT, aerial-perspective froxels), sun, moon with phase, stars; shadow cascades; the terrain's own long
  shadows from its heightfield; GTAO; valley mist; sun and moon shafts.
- **Clouds** (`render/clouds`): Nubis-style shape and erosion noise over an evolving weather map, storm cells with
  anvils and lightning, a baked light volume, multiple-scattering octaves, two temporally resolved layers, holes torn
  by things flying through. Or **sprite clouds** (`clouds: 'sprites'`, `render/skyclouds`): procedural
  heaps, storms, lenticulars and decks, every kind of weather, eased from sky to sky.
- **Water**: Gerstner seas with a dispersive ripple sim round the player (Kelvin wakes, ring trains; any window size),
  refraction absorbed per channel, a planar mirror; under the sea, caustics and shafts through a medium a world can set
  (a lagoon, a peaty loch).
- **Light that bounces, lamps by the hundred** (opt-in, `RendererOptions`): `gi` — irradiance probes over a box
  (`render/probes`: L1 spherical harmonics captured a few a frame from the mirror pass's draws, the sky past what's in
  the way and the lit surfaces' bounce, read by `ambientAt(wp, n)` / `lightDiffuse`); `lights: { max }` — the point
  lights clustered in a grid round the camera (`render/clusters`), each pixel looping only those near it; `taau` —
  weft's temporal upscaler after the scene. Both live in the point lights' buffer: no shader binds more for them.
- **Weather & lamps**: rain drawn from index and time (nothing simulated), splashes placed on the depth buffer; spot and
  point lights with headlamp profiles; light in the air sampled equi-angularly (Kulla & Fajardo). For a world with its
  own renderer, **rainfall** (`weather/rainfall`, `#include "loom/rainfall"`): rain round the eye from a weather's
  rain, cloud and wind, in three wrapped boxes of drops, splashes and a veil over the distance, lit and grounded by
  three functions the world's shader defines (or from a uniform: `loom/rainfall_lit`); and a **low-res volume**
  (`render/volume`, `#include "loom/volume"`: fog, mist, smoke marched at a fraction of the resolution, a reprojected
  history, a depth-aware upsample; the world's shader marches it) over the **scene's distance** (`render/scenez`).
- **Land streaming** (`terrain/clipmap`, `#include "loom/clipmap"`): clipmaps of heights, colour and surface classes
  fed from range-addressed tile packs through the world's own streamer, every tile fading in, nothing popping.
- **Forests** (`world/forest`, `#include "loom/forest"`): hundreds of thousands of trees, 16 bytes each, culled and
  sorted on the GPU each frame into near, far, impostor and shadow lists with caps, the impostors thinned by seed far
  off, the indirect draws' counts written; the world's shader says what the ground under a tree is, whether it stands
  there and how far each kind is drawn, and draws the lists itself. A compact on-disk format (`decodeForest`) in the
  world's own frame.
- **The film**: motion blur, depth of field and tilt-shift, wide bloom, histogram eye adaptation, an AgX grade with
  split toning and scotopic night, a lens pass (halation, fringes, barrel).
- **Stylized**: toon light with complementary shadows, ink outlines from the depth's second difference, a paint
  volume.
- **Things that break**: Voronoi fracture of convex cells, bonded rubble, one draw for thousands of pieces, physics on
  [box3d.js](https://github.com/isaac-mason/box3d.js).
- **Sound**: a procedural audio engine (Web Audio, no samples) — ambience, foley, Minnaert-bubble water, engines,
  fire (a dragon's breath, a blaze, its crackle, ignition, dousing), a dragon's roar and wingbeats, the wind of fast
  flight, generative scores.
- **Quality**: Epic, Smooth and a phone's Mobile profile (`quality`): one sample a pixel, smaller shadows, the clouds
  at a quarter, no AO, shafts or motion blur, a gentle auto resolution.

```bash
npm install @ericrius1/weft @ericrius1/loom
```

```ts
// vite.config.ts — `#include "loom/env"` etc. in your shaders
import { weft } from '@ericrius1/weft/vite';
export default defineConfig({ plugins: [weft({ libs: { loom: '@ericrius1/loom' } })], build: { target: 'esnext' } });
```

```ts
import { Renderer } from '@ericrius1/loom/render/renderer';
import { Clouds } from '@ericrius1/loom/render/clouds';
import { AudioEngine } from '@ericrius1/loom/audio';
```

On a phone, make the renderer with the profile's construction options and apply the rest:

```ts
import { Renderer } from '@ericrius1/loom/render/renderer';
import { applyQuality, loadQuality, phoneOr, rendererOptions } from '@ericrius1/loom/quality';
const q = loadQuality('myapp', phoneOr('smooth'));            // 'mobile' on a phone unless the player picked
const r = new Renderer(kit, terrain, atmo, half, rendererOptions(q)); // { msaa: 1, shadowSize: 1024, ... } on a phone
applyQuality(kit, r, q);
```

Modules are imported by path (`@ericrius1/loom/<dir>/<module>`); shaders by `@ericrius1/loom/shaders/<name>.wgsl`.
Multithreaded physics wants box3d.js's `dist/box3d.mt.*` copied to your app's `public/box3d/` and a cross-origin
isolated page (`loadBox3D({ mtUrl })` to put it elsewhere).

MIT.
