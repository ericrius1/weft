# @ericrius1/cast

The cast's character runtime, one copy for every project: a procedural **hero rig** that walks, runs, jumps, flies,
swims, sits at an instrument or astride a dragon, holds things, dances and breathes; the **garments** and **strands**
that hang off it; a **stroke planner** for anything swung; **keyed tracks**; the **whole-body solver**; a second rig for
bodies posed whole; and the **articulation** of a body playing an instrument. CPU only: it poses bones and hands you
dual quaternions. The mesh, the shader (`hero.wgsl`), the looks and the asset URLs stay in each project.

It is Boulder's hero rig (after the waterbending game's) with every project's later work merged back into it: Boulder,
Codevember, Seven Havens, San Francisco, the Solarium, Drake, and Aether's band. `MIGRATION.md` says, per project,
which local files it replaces and how to switch.

## Install

Like weft and loom, it is built on every push to weft's `main` and committed to its own branch:

```json
"@ericrius1/cast": "git+https://github.com/ericrius1/weft.git#dist/cast"
```

`npm update @ericrius1/cast` takes the latest (the lockfile holds the commit until then); a project's
`tools/engine-latest.mjs` keeps it at the branch's tip with weft and loom. No runtime dependencies, no peer
dependencies: its vectors are plain `[x, y, z]` tuples, the same as weft's `V3`.

## Modules

Each module is its own entry (`@ericrius1/cast/rig`, `@ericrius1/cast/body/solve`, ...); `@ericrius1/cast` is all of
them at once.

| entry | what's in it |
| --- | --- |
| `rig` | `HeroRig` (`update(RigInput)` each frame, then `bones` / `dq` / `nBones`, `faceState`, `skinPoint`, `joint`, `handFrame`, `placeProp`, `carry`), the poses it takes (`HandGoal`, `SeatPose`, `HoldPose`, `BendPose`, `Groove`; a `HandGoal`'s `neck` gives a fretting or stopping hand a guitar's or violin's neck to keep off, `elbowW` how firmly its `elbow` way holds, 100 or more as given; `ref` a whole reference pose its fingers are drawn to, `neck.restAt` where along the index's base the neck rests, `stopRest`/`stopW` a stopping finger's square rests), `HeroRig.SQUARE`, `HeroRig.neckHand`, `HeroRig.keysHand`, `matToDQ`, `MAX_KICK`, `NECK`, `carryUp`, `legUps` |
| `math` | weft's vector maths, `rotateAxis`, `damp`, `ease`, `minJerk`, `cdSpring`, `Spring3`; `dsin`, `dcos`, `dexp`, `datan`, `datan2`, `drotateAxis`, `ddamp`, `q30`: the same bits in every JavaScript engine (the hand's solve uses them) |
| `asset` | `HeroAsset` and the DNC1 reader: `loadHero(url, { fetch, maxBones })`, `parseHero(bytes)`, `MAX_BONES`, `VBYTES`, `CORE` |
| `garment` | the hips' hanging frame for skirts and tunic panels (`fitGarments`, `poseHang`, `hang`), `sleeveFit` |
| `hands` | `fitHands` (a hand's skin given to its finger bones so a grip shows; a file whose header has `hand`, a hand built and weighted as one, is left as it is), `mirrorChinRest` |
| `fingers` | the hand as a hand: `HandModel` (a body's bind hand, its joints' ranges; `built` for a hand built into the file, with the opposing thumb), `solveHand`, `HandSolve`, `handAsk`: several fingertips placed at once with the palm free, optionally under a prior on the hand's posture; the rig uses it for every `HandGoal` with fingertip targets |
| `grasp` | grasps: `grasp(model, kind, size)` (a glass wrapped, a handle, a drumstick, a bow, a pick, a pen, a stem, a plate, a rim, a clasp, a cloth) solved by contact in the hand's space, `graspGoal` to place it in the world as a `HandGoal` (`pose`), `heldWorld`, `heldSd`, `GRASPS`; a violin's bow hold is `'bow'` (its spreads `BOW.spread`), a guitar pick `'pinch'` |
| `face`, `speech`, `sip` | `Face`: blinks, saccades, gaze, moods, visemes on a line's clock, a sip; `lineOf` (a line's timeline from its text) and `lineFromWords` (from a recording's word times); a modelled face (`header.faceRig`) moved as far as a real one |
| `actor` | `Actor`: a body on a stage with its hands' goals eased in and out, fists round handles (`fistGoal`, `fist`) |
| `groove` | `groove(bar, k, feel)`, `mixGroove`: a one-drop riddim in the body, as the rig's `Groove` |
| `strands` | `Strands`: verlet chains on points the rig carries (locks, cords, a sash's tails) that can never be flung |
| `strike` | `Stroke`, `Strokes`, `gripGoal`: a beater, a mallet, a hammer swung through a whip into contact and out |
| `track` | `Track`: quintic Hermite keyed tracks (and `hermite5`, `hermite5v`) |
| `perform` | articulation: `notesAt`, `Heat`, `beatGroove`, `glance`, `splitHands`, `fingersFor`, `stringFor`, `stopAt`, `Bow`, `strum`, `travel`, `SprungFingers`, `reachFinger3`, `mixGoal`, `handSize` |
| `piano` | `Pianist` (alias `Performer`) and `Playable`: a pianist's mind for a `HeroRig`'s seat; `forHand(len)` for a built hand (`prior`, `reach`, `pitch`, `hover`, `idleHover`, `fingerIn`, `blackIn`, `idleW`, `idleLift`, `idleClear`, `idleRelease`) |
| `pose` | `AangRig` (alias `PoseRig`): a body posed whole from a `Pose` |
| `body/solve`, `body/anatomy`, `body/measure`, `body/yoga`, `body/handprior` | the whole-body solver (`HeroRig.bodyKit`), joints' ranges, reading a posed body, yoga's poses as goals, real pianists' hands as a prior (`KEYS_PRIOR`, held with `HandGoal.prior`) |

## Using it

```ts
import { HeroRig, type RigInput } from '@ericrius1/cast/rig';
import { loadHero } from '@ericrius1/cast/asset';

const asset = await loadHero('/assets/cast/katara_hi.bin.gz');
const rig = new HeroRig(asset);
// each frame
rig.update({ dt, time, pos, yaw, vel, speed, running, onGround, wade: 0, landImpact: 0,
  pose: { mode: 'idle', target: [0, 0, 0], intensity: 0, t: 0 }, look: null, wind: [0, 0, 0], ground } satisfies RigInput);
skinBuffer.write(rig.dq.subarray(0, rig.nBones * 8)); // your shader's dual quaternions
```

Settings that are the project's to choose:

- `HeroRig.armContinuity` (default `true`): the arm fit follows its own minimum frame on frame, so an elbow slides and
  never flips. `false` is how Boulder, Seven Havens and San Francisco's arms settled before.
- `HeroRig.armSpring` (default `0`): with continuity, the elbow's swivel as a critically damped spring of this
  frequency (Codevember's day 9: `30`).
- `HeroRig.bodyKit` (default `null`): set it to `@ericrius1/cast/body/solve` to let `RigInput.body` goals pose the body.
- `MAX_BONES` (220) is what the rig's arrays hold; a project's GPU buffer may hold fewer — upload
  `dq.subarray(0, nBones * 8)` and pass `loadHero(url, { maxBones })` to check its own limit.

## Building

`npm run build -w @ericrius1/cast` (tsc to `dist/`). MIT.
