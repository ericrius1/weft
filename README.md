# weft & loom

Two small WebGPU libraries, the engine under the games at **[games.ericlevin.dev](https://games.ericlevin.dev)**:
Starthread, Stormbreak, Rainline, Fauve, Smithereens and Night Owl Arcade.

| package | what it is |
| --- | --- |
| [`@ericrius1/weft`](packages/weft) | A thin WebGPU kit. A frame is an explicit, ordered list of passes over named resources; WGSL is the single definition of the data. A Vite plugin makes `.wgsl` files typed, hot-reloading imports. |
| [`@ericrius1/loom`](packages/loom) | A cinematic renderer built on weft: a physically based atmosphere, volumetric clouds and storm cells, the sea, rain, light in the air, GTAO, bloom, eye adaptation and an AgX film grade — plus GPU particles, paint, ink and toon light, breakable rubble on box3d, and a procedural audio engine. |

The long read on how it works, and why it's built this way rather than on a scene graph like three.js:
**[games.ericlevin.dev/engine/](https://games.ericlevin.dev/engine/)**

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
                  prices encoding thousands of draws (?n=2000&cascades=4&bundle=1); checks.html exercises the kit
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
