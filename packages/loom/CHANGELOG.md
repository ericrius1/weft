# Changelog

## 0.1.16

The Seven Havens look as loom's default: the air painted, the eye a white card's, the grade a painter's by the hour.
Everything below is on by default with gentle settings; `atmo.look = AIR_PLAIN` with `film.card`, `split`, `rich`,
`glow`, `halation`, `dusk`, `keepGreens` and `punch` at 0 gives back 0.1.15's picture.

- **The air as a painter takes it** (`Atmosphere.look: AirLook`, `AIR_DEFAULT`, `AIR_HAVENS`, `AIR_PLAIN`,
  `AIR_PRESETS`, `airAt`; atmosphere.wgsl `Air`): the Rayleigh scattering leaned toward sea green (`tint`), a dust layer
  pooled over low ground that follows the day (`dust`, `dustColor`, `dustBase`: the night's settled layer, dawn's
  pooled one, the afternoon's golden haze), the sun's sky painted brighter than the air makes it and leaned with the hour
  (`sky`, `skyTint`, `twilight`, `golden`: teal-ish by day, rose at golden hour, violet in the twilight), the far air
  going toward the painted dome with distance (`farKm`, `farPaint`), the sky's light on the land kept near the air's own
  and leaned lavender (`skyLight`, `shadeTint`, `shadeDawn`, `shadeGolden`), the haze over the land leaned at dawn and
  golden hour (`hazeDawn`, `hazeGolden`), and the moon's sky navy (`night`). The Renderer's `update` sets the hour's air
  each frame (pass `sun` for the sun's own direction; else it's taken from the key light by day). The static tables are
  rebuilt when the dust or the lean moves.
- **The eye as a white card's** (`film.card`, `dayCard`, `nightCard`, `cardNoon`, `cardNight`, `cardRise`,
  `cardRiseNight`; post.wgsl `adapt`): a level white card under the key light and the sky mapped to its place on the
  screen, leading the exposure by day (`card`, 0.85; the histogram the rest, and most of it by night) — so a painted
  sky, a bright cloud or a dark wall filling the frame doesn't swing the land's brightness. `cardRise` is how fast the
  card's place rises with the light: Seven Havens' 0.14 keeps its noon from being a white sheet over red sandstone; the
  default 0.7 keeps a green land about as bright through the day, half a stop over 0.1.15's in the afternoon.
- **The painter's grade** (`film.split`, `rich`, `glow`, `glowFrom`, `halation`, `dusk`; post.wgsl `painterGrade`): the
  shadows toward lavender (indigo by night) and the highlights toward gold, most at golden hour; the reds and golds
  richer; the glow on what's brighter on the screen than a knee (gold in the sun, lamps, fire); film's red halation; the
  dusk's magenta-violet.
- **Seven Havens' punch and the greens kept** (`film.punch`, 0.3: its AgX look, a firmer curve and richer colour;
  `film.keepGreens`, 0.7: how much of the grass's green the grade keeps — 0.1.15 calmed the yellow-greens by 30%).
- A shader of a game's own that reads `skySample` from the atmosphere's lighting pass sees the painted dome; the light
  on the land (`lighting.sh`, `ambientAt`, `shIrradiance`) is the air's own, leaned by `shade`.

- **Rainfall falls down**: `rainPlaced` took the fall away from each drop's spot instead of adding it, so the drops
  (their streaks drawn the right way up) rose from the ground and drifted upwind.

## 0.1.15

All opt-in (`RendererOptions`); without them nothing renders differently. Needs weft 0.2.7.

- **Diffuse GI from irradiance probes** (`gi: { min, max, spacing, … }`, `render/probes.ts`, `shaders/probes.wgsl`):
  a box of probes, each L1 spherical harmonics of the light arriving at its point — the sky past what's in the way and
  the lit surfaces round it, so their bounce. Captured a few a frame (`maxPerFrame`, `params.perFrame`) by replaying
  the mirror pass's draws (or `source`'s; `skip` leaves out what moves) into six small cube faces, never-captured
  probes nearest the camera first, then round and round, each recapture blended in (`blend`): it fills in over seconds,
  follows the time of day, and gains a bounce each round. Probes inside things are untrusted and left out of the blend;
  `ground` lifts those under the terrain. Read through `ambientAt(wp, n)` (`lightDiffuse` uses it): a game's own
  shader swaps `shIrradiance(n)` for it to take part. Capture views set Frame.user.y = 1 (loom's sky leaves the sun's
  disc out there).
- **Clustered point lights** (`lights: { max, clustered, cells, cap }`, `render/clusters.ts`): a grid of cells round
  the camera, small near it and growing with distance, binned on the GPU each frame; `pointLightsAt`,
  `pointLightsSpec` and `pointLightsIn` loop their cell's lights only. 1000 lamps: ~6× faster than the plain loop on an
  M3 Max. `r.clustered = false` loops them all (to compare); a shader looping `plights[i]` for `world.lights.x` still
  works.
- **`taau`** (`true` or `{ velocity }`): weft's Taau after the fx, motion blur and depth of field, before bloom; bloom,
  the grade and the lens read its canvas-size output.
- The grid's cells and the probes are records of the point lights' own buffer (env.wgsl `plights`, now runtime-sized):
  the shaders that include env bind nothing new for them but the `envx` uniform — a probe texture had pushed the cloud
  march past a phone's 16 sampled textures. Lab: `examples/lab/town.html`.

## 0.1.14

- **Forests on the GPU** (`world/forest.ts`, `shaders/forest.wgsl` — `#include "loom/forest"`): San Francisco's
  trees' cull, with nothing of its trees in it. Every instance (16 bytes: x, z, its stored foot y, and a packed u32 of
  archetype, height, crown radius and seed) is stood on the ground, frustum-culled and sorted by distance into four
  lists with capacities — near, far (overlapping the impostors over a crossfade band), impostor and the shadows'
  casters — the impostors thinned far off by seed (a share kept that falls with the distance squared, each kept crown
  widened to cover for those let go, those going shrinking away over a band of the seeds), and the four indirect draws'
  args written. The world's shader defines `forestGround(xz, stored)`, `forestAccept(xz, ground)` and
  `forestReach(t)` and includes `loom/forest`; its draws read `forestVisible` from `forestListBase(list)` and unpack
  with `forestUnpack`. `new Forest(kit, shader, { label, caps, thin })`, `load(instances, bind)`, `update({ near, far,
  imp, band, shadow, verts, user })` (four vec4s of the world's own for its draws), `passes()`, `drawBind()`,
  `args` / `argsOffset(list)`. `decodeForest(bytes, { origin, step })` reads the compact 'TRE2' byte planes in any
  frame (and shuffles them, so a full list drops trees evenly); `packForest` packs the u32.

## 0.1.13

- **Clipmaps fed from tile packs** (`terrain/clipmap.ts`, `shaders/clipmap.wgsl` — `#include "loom/clipmap"`): San
  Francisco's land streaming, with nothing of San Francisco's in it (its packs by name). Up to four levels of heights
  (r32float), four of colour (rgba8 sRGB, webp tiles with three mips) and one of surface classes, each a toroidal
  window of tiles round the camera in its own layer, slid a tile at a time; every tile fades in over the coarser level
  (half a second), each level's drawn rect eases to where it's going and a slot's old tile is written over only once
  the rect has let go of it; the coarsest levels whole and still; heights kept on the CPU for `heightAt`; a fast
  camera's road ahead and a flight's destination prefetched. Bring the streamer (`ClipStream`: rank, get, upload,
  cached, prefetch, width) and the decoders (`ClipDecode`, a worker's); `ClipSet.create(kit, stream, heightWindow,
  colorWindow, { heights, colors, mat, load, decode, fill })`; `fill(u)` writes the levels' uniforms and the
  residency (9 levels x 64 slots). In a shader, define `clipTileInfo(lv)` and `clipTileSlot(k)` (where the residency
  is) and include `loom/clipmap`: `clipUv`, `rectWeight`, `tileFade`, `levelWeight`.

## 0.1.12

- **A volume in the air at a fraction of the resolution** (`render/volume.ts`, `shaders/volume.wgsl` — `#include
  "loom/volume"`): San Francisco's fog's frame, with nothing of the fog in it, for a world with its own renderer. Each
  frame the march runs at `scale` of the render (each low-res pixel's depth picked from the scene pixels under it: the
  nearest where near things fill at least half of it, the farthest where they don't, so a pixel-wide wire takes the
  volume behind it), the result is blended with the last frames' wherever the same place was seen (reprojected by the
  depth, clamped to the neighbourhood: no ghosts), and laid over the scene at full resolution, each pixel taking the
  low-res samples nearest it in depth (premultiplied). The world's shader defines `volumeMarch(px, uv, z) -> vec4f`
  (light, transmittance) and includes `loom/volume`; `LowResVolume` makes the targets and runs the passes
  (`update(steps, history, user)`: four vec4s of the world's own for its march; `on` gates them all; `current()` the
  frame's result for shafts or a light meter).
- **The scene's distance** (`render/scenez.ts`, `shaders/scenez.wgsl`, `scenez_ms.wgsl`): the depth as metres along
  the view axis (r32float, 1e9 for the sky; a 4x MSAA depth's nearest sample), what the volume, rainfall, AO and
  shafts read: `sceneZ(kit, depth)` or `sceneZShader(samples)`.

## 0.1.11

- **Rainfall for any world** (`weather/rainfall.ts`, `shaders/rainfall.wgsl` — `#include "loom/rainfall"`): San
  Francisco's rain (Boulder's precip, its rain), with nothing of either in it. From a weather's `rain` (0..1, read as
  millimetres an hour: a drizzle's fine slow mist to a downpour's long fast streaks), `cloud` (the cloud base, the top
  of the fall) and `wind`/`windDir` (the slant): three nested boxes of drops wrapped round the eye, each a quad along
  its fall as a shutter sees it, at least a pixel wide; splashes, a ring and a crown, near the eye; the veil, the
  fall's extinction over the distance (Koschmieder) up to the cloud base. Drawn premultiplied over the finished scene
  in a pass of its own (`attach(hdr, sceneZ)`: the scene's distance as r32float metres), nothing run while it's dry,
  `scale` for a phone's fewer drops. The world lights it: its shader defines `rainLight(p, g, side)`, `rainVeil()` and
  `rainGround(xz)` from its own sky, shadows, lamps and ground, then includes `loom/rainfall` (passed as `shader`); or
  the default, `loom/rainfall_lit`, from `Rainfall.light` (sky, key light and its way, lamps, a flat ground) set each
  frame. Additive: `render/rain` (the Renderer's own) is unchanged.

## 0.1.10

- **`Autopilot.onFly`**: told of each flight as it starts, where it's going — stream the destination ahead, so the
  flight lands on a place that's there (San Francisco prefetches its clipmap and city there).

## 0.1.9

- **The autopilot** (`camera/autopilot.ts`, San Francisco's): `fly(pose)` rises off the ground, crosses high enough to
  see the land whole — the farther, the higher, over the land the whole way — and comes down into the place's own
  view, looking where it's going and, the last stretch, round to the view's; `tour(true)` strings `Stop`s together, each
  held a few seconds turning slowly and named (`say`). Any key, click, drag, wheel or touch on the view hands the camera
  straight back (`passKeys`/`passCodes`: the game's own keys that don't); less motion asked for, flights cut and holds
  still. `onTour`, `onFlown`; `shortest`, `longest`, `ceiling`, `holdFor`.

## 0.1.8

- **The film, shared** (`shaders/film.wgsl` — `#include "loom/film"` — and `render/film.ts`): the film Universe's whole
  dive goes through, molecules to the edge of the universe and past it, ported from Seven Havens' and generalized —
  bloom's share and the glow past a knee, film's red halation, exposure and a warm/cool white balance, AgX with its
  punch, the saturation after it, a contrast with a soft toe, a grade by the time of day, vignettes, a fixed dither and
  grain kept to the mids, the screen's curve; `filmLock` runs it backwards for characters drawn as colour models. No
  bindings of its own: bind a `FilmU`, call `filmCurve` then `filmFinish`. `Film` names its settings as numbers,
  `mixFilm` takes one look toward another (the bloom's knee weighted by how much bloom each adds), `filmFields` packs
  one into the uniform (`levels`: the bloom chain's).
- **The stats box** (`ui/stats.ts`): Universe's and Seven Havens' — frame rate and time, the GPU's time, the render
  scale, GPU memory by what's been made (`trackGpuMemory`), the JS heap; `className` for the page's own interface
  class.

## 0.1.7

- **The sea under a body in it** (`shaders/ocean.wgsl`): a swimmer's or a skimming dragon's own mirror image no longer
  lies over its wake in crisp threads. Churned, aerated water (the ripple sim's churn) holds no mirror image, only the
  sky's sheen; the waves' slope that breaks the mirror up is read over two cells as well as one, so a wake's finest
  ripples don't cut it into lace. The water's sun shadow, its foam's and its milk's light are read half a metre over
  the surface, so a body lying in the water doesn't shadow the water over its own submerged belly in a lace of acne.

## 0.1.6

- **Sprite clouds, built in** (`render/skyclouds.ts`, `render/skies.ts`, `shaders/skyclouds*.wgsl`): Boulder's
  procedural sky — the one Boulder and Drake's Dragon each carried a port of — as one renderer option.
  **`RendererOptions.clouds: 'sprites'`** makes **`r.skyClouds`** (a `CloudSource`, plugged in with `r.clouds.use`; the
  volumetric resources never made, as with `'none'`) and steps it from `r.update`. Heaps, wisps, towers and
  cumulonimbus are fixed clusters of soft lit sprites on grids of cells drifting with the wind, each cloud forming,
  growing its upper puffs, maturing and thinning away on the clouds' own clock; lenticular caps are ellipsoids traced
  in the same pass; rain hangs from the big ones' bases; and up to four decks a sky (low, mid, high and the chinook's
  wave deck) are slabs of baked noise composited per pixel round the puffs — far off one sample, close up marched
  through (a lid to climb out of, a sea of cloud from above), clipped where a ridge stands in one. Lit by loom's key
  light at each cloud's height, its sky harmonics and aerial perspective; they fill `r.clouds.smap` (every surface's
  cloud shadows), their `inside` lifts the exposure in a heap or a deck, and their cover cuts loom's sun shafts as the
  volumetric clouds' does.
- **Skies**: `SKY_KINDS` — every kind of Boulder's weather (`clear`, `fair cumulus`, `towering cumulus`, `thunderstorm`,
  `stratocumulus`, `altocumulus`, `cirrus` with its 22-degree halo now and then, `chinook`: lenticular stacks upwind and
  the wave deck ending in a clean line across the wind, `overcast`, `altostratus`), each varied by a seed as Boulder's
  days are, and **`'highland'`**, Drake's glen (fair cumulus over the hills, wisps, far towers, caps over the peaks,
  a patch of altocumulus) exactly as Drake draws it. Or a `SkyRecipe` of one's own (`skyRecipe(kind, seed)` to start
  from). **`r.skyClouds.setSky(kind | recipe, secs)`** eases from one sky to another: the old clouds thin away as the
  new ones form on their own wind, the decks break up and spread.
- **Options** (`RendererOptions.sky`): `{ phone, range, towerRange, lod, spriteCap, shadowPx, shadowEvery, deckRich,
  shadows, ground, half, seed, sky }` — `phone` the economies Drake's phone profile had (nearer ranges and levels of
  detail, 6000 sprites, a 256 px shadow every third frame, plainer decks). **`r.skyClouds.ground = (x, z) => height`**
  (any time): heaps ride up over the ridges they drift onto, caps stand over the peaks. For the world uniforms:
  `r.clouds.sky` (now the source's when it has one: loom's cirrus cover and how overcast it is overhead — a lid turns
  the sky light to its grey) and `r.skyClouds.shadowK` (world.misc.y). `clouds: 'volumetric'` stays the default and
  is unchanged.

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
