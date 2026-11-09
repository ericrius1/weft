# Moving a project onto @ericrius1/cast

Every project carried its own copy of the cast's runtime, and the copies had drifted. This package is all of them
merged: for each module the common ancestor was found in the projects' histories and every project's later work was
applied to it. This file says, per project, which of its files the package replaces, how its API differs from that
project's copy, what will behave differently, and how to switch. Drake has switched; the others haven't yet (each
deploys on a push to its main, so each is its own change).

## Where each module came from

| module | base | merged in |
| --- | --- | --- |
| `rig` | Boulder `web/src/hero/rig.ts` at 6a634da (2026-10-20), the copy every other one forked from | Boulder to 01f163a (seat let go walks on at once; setting off at speed catches the gait's clock up; a moving deck under the feet, `RigInput.carry`; steps never off an edge; the glider's legs, `RigInput.glider`; held goals in a leaned body, `HoldPose.leaned`; `HandGoal.elbowW`; the arm fit's `torso` and upper-arm clearance; elbow continuity, `HeroRig.armContinuity`; `bodyRelease` from the pose's last weight; the body solver's `dt`). Codevember d2b5de4 (the elbow's swivel as a spring, `HeroRig.armSpring`). Seven Havens 7dfef5c (`BendPose.flame`: a flame held in the right palm). San Francisco 4a54b3a (the triple jump's flip, `RigInput.flip`; the skydive, `skydive` / `diveDown`; the double jump's arms, `jump` / `jumpT`; props placed in the world, `placeProp` / `propOut` / `propNames` / `propBase`; `handFrame`; one body taking over from another mid-motion, `carry(from, pos)`). Drake ad04935 (`RigInput.groove`; `SeatPose.knees` and `feetK`; the walking clock hurried by a planted foot left far behind; seated feet never under the floor; `HeroRig.breath`; holds anchored to a bone, `HeroRig.anchor`; the forearm's whole turn held to ~100° and eased to ~117°, after the Solarium's 053d1bd; chain constraints' added velocity capped, `MAX_KICK`; `armContinuity` on by default) |
| `math` | Boulder `hero/math.ts` | weft's vector functions inlined (no runtime dependency) |
| `asset` | Boulder `hero/asset.ts` | Drake's `MAX_BONES` 220 (a robe's chains after the body's bones); `loadHero(url, { fetch, maxBones })` and `parseHero(bytes)` in place of each project's fetch |
| `garment` | Boulder `hero/garment.ts` | the Solarium's `sleeveFit` (e516ec6) |
| `hands` | Boulder `town/hands.ts` (identical in Drake and Codevember) | — |
| `face`, `speech`, `sip` | Boulder `cast/` (identical in Codevember, the Solarium and Seven Havens' face and speech) | — (Drake's and San Francisco's faces were this one with speech cut out; `face.speech` is `null` unless set) |
| `body/*` | Boulder `body/solve.ts`, `anatomy.ts`, `measure.ts`, `acts/yoga.ts` (Codevember's identical) | — (Seven Havens' and San Francisco's solvers are older: no `BodyGoal.ease`, four tries a step instead of eight) |
| `strands`, `track` | Boulder 01f163a (identical to Codevember's) | — |
| `strike` | Codevember d2b5de4 (newer than Boulder's 01f163a) | the lay a 64·q³(1−q)³ bump (no jolt as the downswing begins); the forearm's lean back 0.13·wr in [0.2, 1.0] |
| `actor`, `groove` | Drake (from Gong Bong) | `Actor` takes any mesh with `asset` and `update(rig, jaw)` (`ActorMesh`) |
| `pose` | Boulder `aang/rig.ts` (6a634da) | the Solarium e516ec6: forearm and wrist limits, props held from the hand as posed (`holds`, `held`, `hands`), a braid hung from the head |
| `piano` | Boulder `hero/perform.ts` | its `Performer` is `Pianist` (alias `Performer`); `Score`, `PianoGeometry` and `PianoSound` are the shapes it needs, so Boulder's own types fit them |
| `perform` | Aether `src/band/perform.ts`, `luna.ts`; Drake `src/flute/hold.ts` | see Aether below |

## Every project

1. Add `"@ericrius1/cast": "git+https://github.com/ericrius1/weft.git#dist/cast"` to `dependencies` and `npm install`
   (if npm writes it back as `github:ericrius1/weft#dist/cast`, put the `git+https` spec back and install again).
2. Add `'@ericrius1/cast'` to the list in the project's `tools/engine-latest.mjs` (`for (const name of [...])`), as
   weft's canonical copy now has it, so dev and builds stay on the tip.
3. Replace the files listed for the project below. Either delete them and point the imports at `@ericrius1/cast/<module>`,
   or (the smaller diff, as Drake did) leave each as a one-line re-export: `export * from '@ericrius1/cast/rig';`.
4. `loadHero(url)` still works; a project with its own fetch passes it: `loadHero(url, { fetch: fetchUrl })`.
5. `MAX_BONES` is 220 here (the rig's CPU arrays). Projects upload `dq.subarray(0, nBones * 8)` and their `DQ` is a
   runtime-sized storage array, so a buffer sized from it is just a little larger; keep a local constant if a project
   wants its own limit, and pass it as `loadHero(url, { maxBones })`.
6. `HeroRig.armContinuity` is `true` here (it was `false` in Boulder, Codevember, Seven Havens and San Francisco, which
   didn't have it at all). To keep the arms settling exactly as before, set `HeroRig.armContinuity = false` once at
   startup; to take the improvement, do nothing.
7. Check: typecheck, a build, and a look at the hero walking, sitting, holding and in the air.

What every project's bodies will do differently with nothing else changed (all of them improvements made in one of the
copies): hair and cloth chains can't be flung by a constraint's correction in a tiny step (`MAX_KICK`); a hand asked to
turn its forearm past ~100° faces as far as it goes instead of wringing the wrist; walking (not only running), a planted
foot left far behind lifts sooner instead of the hips sinking to keep it; seated feet are never put under the floor; the
elbows slide rather than flip (`armContinuity`). The new inputs (`groove`, `breath`, `anchor`, `knees`, `feetK`, `flip`,
`skydive`, `jump`, `glider`, `carry`, `leaned`, `flame`) are all opt-in.

## Boulder (`web/src`)

Replaces: `hero/rig.ts`, `hero/math.ts`, `hero/asset.ts`, `hero/garment.ts`, `hero/strands.ts`, `hero/strike.ts`,
`hero/track.ts`, `hero/perform.ts` (→ `piano`), `cast/face.ts`, `cast/speech.ts`, `cast/sip.ts`, `body/solve.ts`,
`body/anatomy.ts`, `body/measure.ts`, `body/acts/yoga.ts` (→ `body/yoga`), `town/hands.ts`, `aang/rig.ts` (→ `pose`).

Stays: `hero/hero.ts` and `hero.wgsl` (the mesh and its shader), `player.ts`, `camera.ts`, `katara.ts`, `npc.ts`,
`table.ts`, `teaseat.ts`, `desk.ts`, `use.ts`, `world.ts`, `body/api.ts` (it knows the app), `cast/talk.ts` and the
voices, `flutes/hands.ts` and `bonfire/hands.ts` (an instrument's hold; their `Fingers` could become `SprungFingers`).

API: `loadHero(url, { fetch: fetchUrl })` (it imported `fetchUrl` from `../util/assets`). `body/api.ts` sets
`HeroRig.bodyKit = solve` with `import * as solve from '@ericrius1/cast/body/solve'`. `Performer` and `pianoPlayable`
are in `@ericrius1/cast/piano` (the alias keeps the name; `pianoPlayable(m, piano)` takes the `PianoModel` and
`GrandPiano` as they are). `aang/rig.ts`'s `AangRig` is `@ericrius1/cast/pose`'s; it is the Solarium's newer one: its
forearms held to a forearm's range (`PRO`, `SUP`) and its wrists to their bend, which changes the yoga poses' hands a
little.

Differences it will see beyond the common ones: Drake's walking hurry and seated-feet clamp; the newer strike (lay
bump). Nothing else: Boulder's own changes are all in.

## Seven Havens (`src`)

Replaces: `hero/rig.ts`, `hero/math.ts`, `hero/asset.ts`, `hero/garment.ts`, `cast/face.ts`, `cast/speech.ts`,
`cast/sip.ts` (its stub: the package's is the whole of Boulder's, `SipShape` the same), `body/solve.ts`,
`body/anatomy.ts`, `body/measure.ts`, `town/hands.ts`.

Stays: `hero/hero.ts`, `hero.wgsl`, `player.ts`, `camera.ts`, `cast.ts`, `companion.ts`, `world.ts`, `bend/*`.

API: none beyond the common steps; `BendPose.flame` is here. Its copy forked from Boulder on 2026-10-29 (ab725a4), so it
gains Boulder's later work too: a seat let go walks on, setting off at speed, steps never off an edge, `HoldPose.leaned`,
`RigInput.carry` and `glider`, the arm fit's torso, and the body solver's `ease`.

## San Francisco (`sanfrancisco-characters` / `sanfrancisco`, `web/src/cast`)

Replaces: `rig.ts`, `math.ts`, `asset.ts`, `garment.ts`, `hands.ts`, `face.ts`, `body/solve.ts`, `body/anatomy.ts`,
`body/measure.ts`.

Stays: `hero.ts`, `hero.wgsl`, `player.ts`, `camera.ts`, `cast.ts`, `ensemble.ts`, `pose.ts` (its own goals for the
painting's figures), `peers.ts`, `things.ts`, `wisps.ts`, `clearance.ts`, `aang.ts`, `iroh.ts`, `world.ts`.

API: `ensemble.ts`'s `HeroRig.bodyKit ??= await import('./body/solve')` becomes `await import('@ericrius1/cast/body/solve')`.
`carry(from, pos)`, `placeProp`, `handFrame`, `flip` / `skydive` / `jump` are all here. `carry` now also carries the
gait's catch-up, the elbow spring's speed and the breath. Its rig forked from Seven Havens (7dfef5c): it gains the same
Boulder work as Seven Havens, plus Codevember's and Drake's.

## Codevember (`src/rig`)

Replaces: all of it but `README.md` — `hero/rig.ts`, `hero/math.ts`, `hero/asset.ts`, `hero/garment.ts`, `strands.ts`,
`strike.ts`, `track.ts`, `cast/face.ts`, `cast/speech.ts`, `cast/sip.ts`, `body/*`, `town/hands.ts`. Its strike and
armSpring are the package's.

API: `hero/asset.ts`'s plain `fetch` is the default. Day 09's `HeroRig.armContinuity = true; HeroRig.armSpring = 30;`
stay as they are; the other days now get `armContinuity` on (set it `false` there to keep them exactly).

## Tapestry (`packages/cast`, `@tapestry/cast`)

Replaces: `rig.ts`, `math.ts`, `asset.ts`, `garment.ts`, `hands.ts`, `face.ts`, `body/*` — an earlier snapshot of San
Francisco's (no `carry`). Its `index.ts` re-exports them; point it at `@ericrius1/cast/...` and keep `hero.ts`,
`hero.wgsl`, `figure.ts`, `assets.ts`, `aang.ts`, `iroh.ts`.

## The Solarium (`web/src`)

Replaces: `aang/rig.ts` (→ `pose`, identical), `hero/rig.ts` (its stub of `NECK`, `carryUp`, `legUps`, `matToDQ`,
`FaceExpr`: all exported from `@ericrius1/cast/rig`), `hero/garment.ts` (with `sleeveFit`), `hero/math.ts`,
`hero/asset.ts`, `cast/face.ts`, `cast/speech.ts`, `cast/sip.ts`, `town/hands.ts`.

## Aether (`src/band`)

Its band poses glTF skeletons with its own maths library, so the skeleton, the IK (`Skeleton.reach`, `turnWorld`,
`orientWorld`) and `Performer.handRot` / `turnHand` / `handAt` stay in Aether. What the package takes is the
articulation, as free functions and small classes in `@ericrius1/cast/perform`:

| Aether | package |
| --- | --- |
| `Performer.notes(inp, early)` and `HoloSynthesist`'s prev / next | `notesAt(evs, now, early)` → `{ active, last, prev, next }` |
| `Performer.warm` (`heat`) | `new Heat().update(dt, active, last, now)` |
| `Performer.groove` | `beatGroove(beat, time, { amt, nod, playing, seed })` → `rock` (the spine's lean), `roll` (the chest's sway), `nod` (the neck): bend those joints by them |
| `Performer.gaze`'s glance | `glance(time, seed, toward)` |
| `Keyboardist`'s split and finger picks | `splitHands(notes, 5, 66)`, `fingersFor(notes, side, 4)` |
| `Violinist`'s string, stop, shift, finger, vibrato | `stringFor(note, OPEN)`, `stopAt`, `shiftFor`, `fingerFor`, `vibrato` |
| `Violinist`'s bow | `new Bow(0.36, 0.82).update(dt, now, last, singing)` → `u`, `v`, `dir`, `lift` |
| `Guitarist`'s strum and chord change | `strum(beat, amp)`, `chordAt(beat, chord, next)` |
| `HoloSynthesist`'s finger from node to node and its strike | `travel(A, B, tA, tB, now, back, { arc })` → `{ at, press }` |
| `Performer.reachFinger`, `solve3` | `reachFinger3(tip, target, fr.x, { lo, hi, relax, scale })` with `tip = (x) => { setFinger(fr, ...x); return tipW(fr); }`; `THUMB3`, `FINGER3` are its ranges |

Steps: add the dependency; in `perform.ts` replace the bodies of `notes`, `warm`, `groove` (keep the bends, take the
numbers from `beatGroove`), the glance in `gaze`, and `reachFinger`'s solver with the calls above; in the performers
use `Bow`, `stringFor` and the rest in place of their inline versions. The renders shouldn't change (the numbers are the
same); check the jam film.

## Drake (done)

`src/cast/{math,asset,garment,hands,face,rig,actor,groove}.ts` are one-line re-exports of the package (`actor.ts` binds
`Actor` to its `HeroMesh`); `mesh.ts`, `hero.wgsl`, `rider.ts`, `robe.ts`, `looks.ts`, `props.ts` and `harness.ts`
stay. `src/flute/hold.ts`'s `Fingers` is the package's `SprungFingers` with `FLUTE_FINGERS`, and its `mixGoal` and
`handSize` are the package's too; it can take them when nobody else is working in it.

## Not covered

Gong Bong (Drake's rig came through it; left alone). Waterbending's `src/hero/rig.ts` is the older ancestor Boulder's
was rebuilt from (its locomotion predates the gait clock) and isn't a copy of this one.
