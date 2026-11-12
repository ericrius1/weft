# release-ab: a cast release checked against a project's real use, bone for bone

A push to `main` rebuilds `dist/cast`, and every project takes it on its next build. This drives two builds of cast
(the one the projects have now and the candidate) through the same scripted acts, using **the project's own code**
(Drake's `Rider` and `Flute`, bundled read-only from its `src/`, its own body files from `public/assets/cast`), and
compares every bone every frame. It runs in Node, no GPU, no browser, no sound; nothing is written into the project.

## Run it

All output goes in a scratch directory (`COPIES`); delete it when done.

```sh
# 1. the two copies, each built and packed as CI's dist job does (tsc, npm pack)
COPIES=/tmp/ab OLD=origin/main NEW=HEAD node tools/release-ab/prepare.mjs     # NEW=WORKTREE: the working tree
# 2. the project's code bundled once on each (the GPU modules stubbed: stubs/)
COPIES=/tmp/ab DRAKE=C:/Users/ericr/codeprojects/drake node tools/release-ab/build.mjs
# 3. the bone-for-bone comparison (~3 min for every body and act), the fingertips, the cost
COPIES=/tmp/ab node tools/release-ab/compare.mjs     # WHO=drake,katara LODS=hi ACTS=ride,foot to narrow it
COPIES=/tmp/ab node tools/release-ab/tips.mjs        # WHO=drake: each fingertip against its target, playing
COPIES=/tmp/ab node tools/release-ab/cost.mjs        # NS=1,4,12 ROUNDS=3
```

Check first that the old copy is what the projects have: `git fetch origin dist/cast` and diff its `dist/` against
`COPIES/old/dist` (byte-identical for 0.2.0).

## What it drives (acts.ts)

Every rider (`drake marley katara aang iroh kvothe andrew yashua lyra`, hi and lo), the flute attached as Drake
always has it (its right fist carries it when not played), each act from a fresh load, `Math.random` seeded per
bundle so both builds see the same idle glances:

| act | what |
| --- | --- |
| `ride` | 14 s flying a banking curve: calm, brace, fire, whoop (the fist pumped), the watch spell (wrist up, crown, raise) |
| `ride-horn` | 9 s on Naga's horns (`Saddle.gripUp`), the flute raised and played from 1 s, put away at 6 s |
| `foot` | 40 s: in the saddle, the dismount, walk, run, stand, a jump and landing, walk back, the mount, riding |
| `flute-foot` | 26 s on foot: raised and played walking and standing, held up as a staff, aimed at a gate, put away |
| `flute-ride` | 16 s flying, the flute played from 1 s, put away at 13 s |

A new act goes in `acts.ts` as another branch of `act()`; anything the project does that reaches the rig should be
in one (read the project's `src` for what reaches `rig.update`, holds, seats, hand goals with `tips`).

## How to read it

`compare.mjs` prints, per act and body: the largest move of any bone's head or tail between the builds (m) outside the
fingers ("body dT", and "dR" the largest rotation-matrix element difference) and inside them ("fingers dT"), with the
bone and the second it happened, then the same per segment of the act. `0` is bit-identical. Anything above float
rounding (1e-6 m) is either a change the release meant or a regression: find the frames with the bone and second given
and look (`probe.mjs`: one bone over a stretch of an act in both builds, against its target). Where goals have fingertip
targets it also gives the fingertips' miss while playing (median and p95, mm) for both builds; `tips.mjs` splits that
per finger (median/p95/max). `cost.mjs` gives µs per body per frame (Drake's Rider and Flute and the rig, all of a
body's CPU) for each thing the bodies are doing, old and new, the median of alternating rounds with their min-max as
the noise.

The skinning matrices' own translations are not positions (a matrix is pose times the inverse bind), so compare
`skinPoint`s, as `compare.mjs` does, not raw matrix entries.

## Limits

Drake's robe (its own verlet cloth, `src/cast/robe.ts`) is stubbed: it reads the rig's bones, so identical bones mean
an identical robe. Hi and lo body files share skeletons today, so their rows match. The fingertip "targets" are the
goals as handed to the rig plus the flute's lip anchor; the rig's own riding lean (`unlean`) is not undone, which
offsets both builds alike.
