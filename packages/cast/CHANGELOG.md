# Changelog

## 0.3.0

- **The hand as a hand** (`@ericrius1/cast/fingers`, also in the index): `HandModel.of(asset, 'L' | 'R')` reads a
  body's bind hand (null unless every finger and the thumb are three bones each), and `solveHand(model, solve, ask)`
  places several fingertips at once, Levenberg–Marquardt over 27 numbers (the palm's move and turn, the palm's arch,
  four per finger, four for the thumb), warm from the last frame. Every joint stays in a person's range and is drawn
  to its comfortable band. Knuckles spread within the webs, the thumb's saddle opposes (its pad turns to face the
  fingers), the ring and little metacarpals arch the palm, and neighbouring fingers are enslaved (the ring finger
  lifts about 30° clear of its neighbours, not more). `body/anatomy` adds the thumb's joints (`cmc`, `thumbMcp`,
  `thumbIp`), `SPREAD` and `ENSLAVE`.
- **The rig solves every `HandGoal` with fingertip targets (`tips`) through it**, on any body whose fingers are three
  bones each. New `HandGoal` options: `palmFree` (0..1: the palm and fingers solved together, the arm then given the
  palm as solved), `tipW` (each target's weight), `square` (a stopping finger comes down arched on its tip), `lay` (a
  finger laid flat along what it presses, its middle joints held down too: a barre) and `floor` (a surface that
  fingertips without a target keep clear of). For tools and tests: `rig.handMiss(i)`, `rig.handIters(i)`,
  `rig.handX(i)`, `rig.handPalm(i)`, `rig.palmMiss`; to tune: `HeroRig.handIters` (iterations a frame) and
  `HeroRig.keysHand` (a hand at the keys: its rests and their weights).
- **A fingertip target out of a finger's reach is let go** (with `palmFree` 0): its pull fades out between 1.05 and
  1.5 finger lengths from the knuckle, and the finger keeps its own rest instead of straightening toward the target.
  This matters for a flute's hole while the flute is still coming up or going down.
- **The clocked pianist plays with all five fingers** (`piano.ts`): each chord is fingered by the rising run of
  fingers whose rests fit it best, thumb and little finger included. One hand spans up to an octave and a white key,
  and the thumb and little finger stay off black keys where they can. The palm is free to the fingers
  (`palmFree: 1`, `turn: 0`, the keys' tops as `floor`, resting fingers hovering at a low `tipW`). A finger lifts,
  goes over and falls in that order, with a whole lift's time to go to another key. The thumb plays a white key
  nearer its front, and a hand with a black key under it plays its white keys further in. New `Pianist` fields:
  `idleHover`, `hover`, `fingerIn` (how much further in each finger plays than the press line), `idleW`, `pitch` (the
  hand's slope from wrist to knuckles; its default -0.18 is the old fixed value). `forHand(len)` sets them, and
  `reach`, for a built hand of that length, the knuckles back and over the wrist as real players' are:
  `new Pianist().forHand(asset.header.hand.len)`.
- **A hand built into the body's file** (`HeroHeader.hand: { source, len, breadth }`: a modelled hand grafted on and
  weighted to its own bones) is kept as it is. `fitHands` leaves its weights alone (returns 0), and with no fingertip
  to place its fingers rest through the hand model, each bending about its own knuckle's axis, at a relaxed hand's
  curls (a fist's thumb across the fingers), instead of all turning about the hand's one axis. Where the body has
  them, the two optional metacarpal bones `ring0L/R` and `pinky0L/R` (parents of `ring1`/`pinky1`) turn with the
  palm's arch, and are held at the bind on the hand otherwise. cast reads only whether `header.hand` is there: the
  `v` World's graft writes (`v: 2`: the finger joints placed anatomically, the metacarpals added) is not read. The
  metacarpals are found by name, so a file with `header.hand` and no `ring0`/`pinky0` still works (no arch in the
  skin).
- **What changes in behaviour**: fingers with fingertip targets, on any body (the flute's holes, the pianist's keys,
  on the frames as well as on a clock). In Drake's acts the flute fingers land closer (fingertip miss while playing,
  median about 3 mm → under 1 mm, p95 about 50 → 20 mm), and on the way down the fingers let go of the holes a
  frame or two sooner. A clocked pianist's hands sit and finger differently. On the five older World bodies, the
  pressing fingers miss by a median 0.5-1.4 mm instead of about 5 mm (Aang's worst 5% miss by a little more than
  before: p95 20 mm against 17). The new solve settles to slightly different
  numbers in different JavaScript engines: at the piano, a few millimetres apart between Node 22 and Chrome 157.
- **Identical**: every bone of every body outside the fingers, in all 85 rows of Drake's acts (tools/release-ab: nine
  riders, hi and lo, riding, on Naga's horns, on foot, the flute on foot and riding), and the fingers in every act
  without the flute. Body files without `header.hand` load as before (`fitHands` re-fits their hands' weights as it
  did), and goals without fingertip targets pose them bit for bit as before, in Node and in Chrome. No export was
  removed or changed in type: the additions are optional fields, new members and the new module.
- **Size**: `rig` now imports the hand's solve. A bundle with `HeroRig` grows by about 21.7 KB minified (8.9 KB
  gzipped). Modules that don't import the rig are unchanged.
- **Cost**: unchanged within noise. CPU per body per frame with 12 of Drake's bodies (tools/release-ab cost.mjs, 7
  alternating rounds, Node 22): walking 98 → 100 µs, running 97 → 94, standing 95 → 96, riding calm 155 → 167,
  the flute carried 186 → 169, playing 238 → 204. Each round-to-round spread is wider than its difference.
- **To opt in with a body file**: write `header.hand` (`source`, `len` the wrist-to-middle-fingertip length in m,
  `breadth`) once the hand is modelled and weighted to its own finger bones, and optionally the `ring0`/`pinky0`
  bones. Nothing else is needed: fingertip goals use the solve on every body.

## 0.2.0

- **The pianist on a score's clock** (`Pianist.playScore(score, { clock })`, `piano.ts`): with `clock` (a function
  giving the score's second now: an audio transport's, a film's) the whole piece is planned once, after `sit()`: every
  note given a hand and a finger (a chord too wide for one hand shares its outer note with the other; a note neither
  can reach is still fingered and listed in `simplified`, never dropped), each hand travelling from the look-ahead so
  it's in place before its note, and each finger's stroke landing on its note's second, a repeated key let up and
  struck again. The pose is then a function of the clock's second alone, not of the frames before it, so a frame shows
  the finger on the key the audio clock is sounding. `struck` lists every planned stroke (hand, finger, landing,
  release) for scheduling the sound ahead; `active` says which fingers have a key this frame. `stopScore()` takes the
  hands off the clock. Without `clock`, `playScore(score)` plays on the frames' dt as before.
- **A score with pedalling no longer hangs without a pedal callback**: with `pedalSet` null, `stepScore` skipped the
  pedal index's increment inside the optional call and looped forever.
- **The rig's chain constraints in plain numbers** (`rig.ts`: `capPush` and the chains' distance pass): they made six
  arrays a call, for every capsule and every chain point, five times a frame: the cast's most garbage by far, and
  15-25% of a body's CPU. Same operations in the same order; lengths now `Math.sqrt` of the sum of squares instead of
  `Math.hypot`, so chain points move by float rounding only (under 1e-8 m over a 24 s scripted run of braids, hair
  loops, tails and tunic panels).
