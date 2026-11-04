# Changelog

## 0.1.5

- **Bring your own clouds** (`render/clouds.ts`, `render/renderer.ts`): **`r.clouds.use(source)`** runs a game's own
  clouds (sprites, layers, anything implementing `CloudSource`: `bakes()` before the scene, `render()` after its depth,
  `inside` 0..1) where the volumetric march ran. The source fills `r.clouds.smap`, so every surface's cloud shadows
  and the loch's keep working, and its `inside` drives the exposure's lift in a cloud as before. The volumetric
  resources (noise volumes, weather, light, wake and tower maps, the march's targets and histories, ~80 MB at 1080p)
  are given back at once. **`RendererOptions.clouds: 'none'`** never makes them in the first place (just the shadow
  map and four 1×1 targets the composite and the shafts bind): a game's own clouds, or a clear sky. `r.clouds.live`
  is false with either; `stamp()` and the weather are no-ops. `r.clouds.volumetric` / `r.clouds.source` say which.

## 0.1.4

- **A mix bus for a game's own sound** (`audio/engine.ts`): **`audio.bus('sfx' | 'music' | 'amb')`** gives `{ dry, rev,
  echo }` — nodes to connect a live voice into (an instrument, a game's own synth), so it plays behind the volumes,
  the master, the compressor and limiter and the start's fade, and sits in the world's reverb and echo like the
  engine's own sounds (before, a game could only reach `context.destination`, past all of them). null before
  `resume()`.

## 0.1.3

- **Ripples, dispersive and any size** (`world/ripples.ts`, `shaders/ripple.wgsl`): the wave-equation window round the
  player is now boulder's iWave — `h'' = -g|k|h`, the `|k|` a 13x13 convolution staged per 16x16 block in workgroup
  memory — so long waves outrun short ones: a splash spreads as a widening train of rings and a body moving over the
  water leaves a feathered Kelvin wake (the old field gave single hard rings and a narrow rubbery cone). Stepped at a
  steady 60 a second (as many steps as the frame took, up to two), slowed in the shallows (`tanh(k d)`), damped on a
  beach, dry land a wall (the depth read from the terrain's height map as cells come into the window), a sponge at the
  window's edges. `new Ripples(kit, heights, half, { n, cell })` / `RendererOptions.ripples`; **`r.ripples.configure({
  n, cell })` any time** (a 27 m dragon's wake: `{ n: 512, cell: 0.6 }`, 307 m of water) — the env group binds
  `r.ripples.out`, a Ref that follows it. Impulses: `splash(x, z, amount, radius, foam)` and **`line(x, z, x2, z2,
  amount, radius, foam, crest)`** (a trough ploughed this frame, a wake's arm; a crest's whitecap foam there only a
  moment), up to 1024 a step; `push(x, z, radius, strength)` kept. Rests (rippleAt reads flat, no compute) with the
  player more than `reach` (160 m) over the water and nothing pushed for `settle` s. The published texture: height
  (m), its rate (m/s), foam, the whitecaps' share (`.x` and `.z` as before). Fields: `damping`, `foamLife`,
  `viscosity`, `crestLife`, `maxHeight`, `active`, `window`.
- **The sea's foam and mirror over churned water** (`ocean.wgsl`): the ripple sim's foam drawn as lace — threads of
  bubbles round dark holes (ridges of a warped noise at the window's scale, fine enough that no blots or cells show),
  filling in where thick, whitecaps solid while they last, the water under it aerated and milky — and never darker
  than the sheen beside it; the planar mirror fades to the sky's sheen where the ripple field is steep (a reflection
  torn by a wake into its slopes read as shards).
- **A world's own water under the surface** (`globals.wgsl` World `uwAbs`, `uwScat`: rgb per metre, w 1 to use it —
  0, the default, keeps the lagoon's): env.wgsl's medium (`uwAbsorb()`, `uwScatter()`, and everything built on them:
  the lens's fog, the shafts, the surface seen from below) takes them — a peaty loch's tea-green.
- **`splash.xl`** in the default bank (sfx.ts's splash asked for it at the top of its range and got silence).

## 0.1.2

- **Renderer options** (`new Renderer(kit, terrain, atmo, half, opts?)`, `RendererOptions`): `msaa: 1 | 4` (default 4)
  — at 1 the opaque scene draws straight into `hdr` and `depth`, no multisampled targets and no depth-resolve pass
  (`hdrMS` / `depthMS` are then `hdr` / `depth`); an `alphaToCoverage` draw is drawn without it, and a shader declaring
  `override ALPHA_TO_COVERAGE: bool` is told so (weft 0.2.4) to cut out by alpha. `shadowSize` (default 2048) sizes the
  three cascades (env.wgsl reads the size off the map: `shadowRes()`; the depth resolve its sample count);
  `terrainShadowSize` (default 2048) the terrain's long shadow. `r.msaa`, `r.shadowSize` say what it was made with.
- **Cascades fitted to their size** (`updateShadows`, `r.shadowFit = { back: 600, reach: 180, far: 1400 }`): each
  cascade's light eye sits at least `back` m toward the light and always its bounding sphere's radius plus `reach`
  (casters that far past it still shadow it), its depth runs to at least `far` and always past the sphere's far side —
  a flight game's long cascades (`[40, 160, 600]` m or more) are no longer clipped by the old fixed 600 m / 1400 m.
  Still texel-snapped (at `shadowSize`). The default cascades are fitted as before.
- **A phone's quality** (`quality.ts`): `Quality` is `'epic' | 'smooth' | 'mobile'`; `QUALITY[q]` its profile;
  `rendererOptions(q, over?)` the Renderer's construction options for it (mobile: `{ msaa: 1, shadowSize: 1024,
  terrainShadowSize: 1024 }`); `applyQuality(kit, r, 'mobile')` caps at 30 fps from 0.7 of the canvas (2 device pixels
  a CSS pixel at most), a gentler AutoResolution (0.45–0.85 in steps of 0.05, two seconds apart, slack 1.35 where the
  GPU can't time itself), the clouds at a quarter with fewer steps, AO, shafts and motion blur off (put back as the
  game had them when another quality is applied). `isPhone()`, `phoneOr(desktop)` (a fallback for `loadQuality` that
  starts a phone on mobile), `?quality=epic|smooth|mobile`; `qualityPicker(…, { mobile: true })` adds a Phone button.
  Epic and Smooth are unchanged.
- **Fire and a dragon, heard** (`audio/synth/dragon.ts`, in the default BANK): `loop.fireBreath` (a dragon's breath
  of fire, a turbulent jet's roar, looped), `loop.fireRoar` (a blaze, puffing), `loop.fireCrackle` (clicks, pops and
  sizzle, folded round the loop so it has no seam), `fire.ignite` (gas hiss, whump, flare), `fire.douse` (crash, steam,
  sputter), `dragon.roar` (a rattling 48 Hz growl into a 120 Hz bellow), `dragon.wing` (a downstroke's whoosh and
  thump, the membrane's snap, the upstroke), `loop.windRush` (fast flight's buffeting, gusting rush and hiss) —
  sfx.ts's fire loops, `dragonRoar`, `wingbeat` and `douse` events played nothing till now. A state's fire breath
  plays `fire.ignite` each time it starts from nothing; an `ignite` event plays one anywhere; `flight.windRush` (0
  off, the default; about 1 for a dragon) layers the wind loop over the flight's own wind, its rate and brightness
  with the speed. The positional ones are mono (a panner places them).
- **Startup**: the bloom and AO-depth textures no longer fail validation at 1×1 before the canvas is sized (weft 0.2.4).
