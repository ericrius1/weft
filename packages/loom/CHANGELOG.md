# Changelog

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
