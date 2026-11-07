# @ericrius1/loom

A cinematic WebGPU renderer on [`@ericrius1/weft`](https://www.npmjs.com/package/@ericrius1/weft) — the renderer the
games at [games.ericlevin.dev](https://games.ericlevin.dev) share.

- **Sky & light**: a physically based atmosphere (after Hillaire 2020: transmittance + multiple-scattering LUTs, a
  sky-view LUT, aerial-perspective froxels), sun, moon with phase, stars; shadow cascades; the terrain's own long
  shadows from its heightfield; GTAO; valley mist; sun and moon shafts.
- **Clouds** (`render/clouds`): Nubis-style shape and erosion noise over an evolving weather map, storm cells with
  anvils and lightning, a baked light volume, multiple-scattering octaves, two temporally resolved layers, holes torn
  by things flying through. Or **sprite clouds** (`clouds: 'sprites'`, `render/skyclouds`): Boulder's procedural
  heaps, storms, lenticulars and decks, every kind of its weather and Drake's Highland, eased from sky to sky.
- **Water**: Gerstner seas with a dispersive ripple sim round the player (Kelvin wakes, ring trains; any window size),
  refraction absorbed per channel, a planar mirror; under the sea, caustics and shafts through a medium a world can set
  (a lagoon, a peaty loch).
- **Weather & lamps**: rain drawn from index and time (nothing simulated), splashes placed on the depth buffer; spot and
  point lights with headlamp profiles; light in the air sampled equi-angularly (Kulla & Fajardo). For a world with its
  own renderer, **rainfall** (`weather/rainfall`, `#include "loom/rainfall"`): rain round the eye from a weather's
  rain, cloud and wind, in three wrapped boxes of drops, splashes and a veil over the distance, lit and grounded by
  three functions the world's shader defines (or from a uniform: `loom/rainfall_lit`).
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
const q = loadQuality('mygame', phoneOr('smooth'));            // 'mobile' on a phone unless the player picked
const r = new Renderer(kit, terrain, atmo, half, rendererOptions(q)); // { msaa: 1, shadowSize: 1024, ... } on a phone
applyQuality(kit, r, q);
```

Modules are imported by path (`@ericrius1/loom/<dir>/<module>`); shaders by `@ericrius1/loom/shaders/<name>.wgsl`.
Multithreaded physics wants box3d.js's `dist/box3d.mt.*` copied to your app's `public/box3d/` and a cross-origin
isolated page (`loadBox3D({ mtUrl })` to put it elsewhere).

MIT.
