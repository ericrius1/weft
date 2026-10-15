# @ericrius1/loom

A cinematic WebGPU renderer on [`@ericrius1/weft`](https://www.npmjs.com/package/@ericrius1/weft) — the renderer the
games at [games.ericlevin.dev](https://games.ericlevin.dev) share.

- **Sky & light**: a physically based atmosphere (after Hillaire 2020: transmittance + multiple-scattering LUTs, a
  sky-view LUT, aerial-perspective froxels), sun, moon with phase, stars; shadow cascades; the terrain's own long
  shadows from its heightfield; GTAO; valley mist; sun and moon shafts.
- **Clouds** (`render/clouds`): Nubis-style shape and erosion noise over an evolving weather map, storm cells with
  anvils and lightning, a baked light volume, multiple-scattering octaves, two temporally resolved layers, holes torn
  by things flying through.
- **Water**: Gerstner seas with a wave-equation ripple sim round the player, refraction absorbed per channel, a planar
  mirror; under the sea, caustics and shafts.
- **Weather & lamps**: rain drawn from index and time (nothing simulated), splashes placed on the depth buffer; spot and
  point lights with headlamp profiles; light in the air sampled equi-angularly (Kulla & Fajardo).
- **The film**: motion blur, depth of field and tilt-shift, wide bloom, histogram eye adaptation, an AgX grade with
  split toning and scotopic night, a lens pass (halation, fringes, barrel).
- **Stylized**: toon light with complementary shadows, ink outlines from the depth's second difference, a paint
  volume.
- **Things that break**: Voronoi fracture of convex cells, bonded rubble, one draw for thousands of pieces, physics on
  [box3d.js](https://github.com/isaac-mason/box3d.js).
- **Sound**: a procedural audio engine (Web Audio, no samples) — ambience, foley, Minnaert-bubble water, engines,
  generative scores.

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

Modules are imported by path (`@ericrius1/loom/<dir>/<module>`); shaders by `@ericrius1/loom/shaders/<name>.wgsl`.
Multithreaded physics wants box3d.js's `dist/box3d.mt.*` copied to your app's `public/box3d/` and a cross-origin
isolated page (`loadBox3D({ mtUrl })` to put it elsewhere).

MIT.
