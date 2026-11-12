# Changelog

## Unreleased (draft: world/hands-look 915f3b8..2db18aa on 0.6.1)

- **`BOW` and `BOWREST` change value** (exported constants): the bow hold refitted from hand-marked frog photographs with
  the right hand's chirality — rests 34/66/5, 55/54/10, 60/52/20, 45/51/25 deg, spreads +3/-2/-12/-27. New export
  `BOWSTICK` (the stick in hand space, its contact points per finger); the grasp's held centre is the stick over the hair's
  end at the frog. A caller placing `grasp('bow')` at the old 2 cm along / tangent roll sees the hand move (World:
  BOWHOLD.along 0, roll -1.35 rad as an angle).
- **Leftovers of 0.6.1**: a NaN `curl` or `grip` never enters the rig's smoothed state; a NaN `tipW` is taken as 1; `ref: {}`
  (no `x`) is skipped instead of throwing; `termPulls(S)` per hand solve (`HeroRig.handSolve(i)`), a copy, empty once the
  watch is off.
- **The Pianist's hands** (built hands with `prior` only; every other hand bit for bit as before — checked with World
  `tools/hands/crossguard.mjs` on the guitarist's and the fiddler's hands): new `HandGoal.keyTop` (a thumb's rests eased by
  its key's top, not swapped at its target's height); rests at the keys eased in with the goal's weight; a finger's
  approach from rest by its distance, its release eased toward its idle place; rise and travel share the time to the fall;
  the idle levers weighted by their neighbours' weights; the key surface's clearance faded by the knuckles' height (only
  with `prior`), off at once and on eased; per-finger playing rests (`keysHand.tipBuilt`, new `keysHand.wTipBuilt` 8);
  `Pianist.strokeLift`; after a clocked piece the hands rest on its plan; under a prior the solve tries 8 dampings (5
  otherwise). The duet: joint steps over 10 deg in a frame 592 -> 31 at 60 fps (worst 18.7 deg), contacts 109/109 at
  50, 60 and 144 fps.

## 0.6.1

- **Malformed asks no longer break a hand**: a `ref.x`, `pose` or `stopRest` number that is missing or not finite (too
  short, sparse, NaN, ±Infinity, a string, null) is left out and the others still hold; a non-finite rest or weight is
  dropped from the solve; a solver state that is not finite starts again from the rests. In 0.6.0 such an entry froze
  the fingers of a hand with targets and left NaN bones on a hand without. Still unguarded: `ref` with no `x` at all
  throws (as before), a NaN `curl` leaves the rig's curl NaN for good, a NaN `tipW` holds that finger still.
- **`HandGoal.neck.restAt` clamped to 0..1** (a non-finite one taken as 0). In range: as before.
- **`BOW` and `HeroRig.SQUARE` frozen**, typed read-only (`readonly number[]`); assigning to them now throws. New export
  `BOWREST`, frozen. Their doc comments are back on their declarations.
- **A term readout** (`fingers.ts` `setTermWatch(indices | null)`, `termPulls()`): each term's share of the gradient on
  chosen hand numbers at the last pass, for tuning. Off by default; on or off, the solve's results are bit for bit the
  same. `termPulls()` keeps the last reading after it is turned off, and it is shared by every hand in the process.
- **What changes in behaviour** (on purpose):
  1. **The bow grasp** (`grasp(M, 'bow', …)`): its rests from 14 real bow holds; the held hand's knuckles go from 5/19/19/-3
     to 21/43/44/20° (index..little), numbers by up to 25-31° (the thumb's MCP most), fingertips by up to 30 mm; the held
     stick turns 10.5° and moves 15-18 mm in the hand's space. A caller that places the palm from the grasp
     (`graspGoal`) moves the arm: World's fiddler's bow arm hangs differently (the elbow about 38 cm lower in the
     count-in, the arm 2-8 cm through the song; bow 29/29 as before). Every other grasp is bit for bit as 0.6.0's.
  2. **The Pianist's built hands** (`forHand`, the only caller of `prior`): a finger at the keys with a weak target
     (`tipW` below 1, with `prior`) now takes the lever rest's weights too, and the ring finger lands 12 mm further in on a
     black key and on a white key among black ones (`Pianist.blackExtra`). Idle fingers seen from the side: middle joints
     31 -> 21° (real 18), end 15 -> 9° (real 8), knuckles 22 -> 25° (real 19); the duet's 13.43 s black chord: left ring
     middle joint 45 -> 26°. The whole duet differs from 0.6.0 (both changes; arms by up to 5-7 cm); contacts 109/109 at
     50, 60 and 144 fps as before.
  3. **A `ref` hand with no fingertip targets** keeps the reference pose's arch (it took the grip's): up to 4° at the arch,
     2 mm at the fingers.
  4. Nothing else.
- **Identical**: every bone, fingers included, in all 85 rows of Drake's acts (tools/release-ab against 0.6.0). World's
  built bodies (katara, raker) at 30, 60 and 144 fps, bit for bit as 0.6.0's: tips on every finger, `palmFree`, `neck`
  with `rest`, `restAt`, `square`, `stopRest`, `stopW` and hovering fingers, `square` alone, `ref` with tips, keys with
  `prior` and every `tipW` 1, a weak `tipW` without `prior`, a weak thumb, a finger with no target, `grip`, no tips, and
  `pose` from the wrap, power, pinch, tripod, stick and clasp grasps. The band's singer (both hands) and fiddler's left
  hand bit for bit over the whole song at 30, 60 and 144 fps. Node 22 and Chrome 157 give identical hands for the
  pianist (1,458 frames) and the band (2,420 frames). No export removed; `BOW` and `HeroRig.SQUARE` narrowed to read-only.
- **Cost**: unchanged (a warm hand solve 45 µs against 44, within noise; the readout off).

## 0.6.0

- **A reference pose** (`HandGoal.ref`: `{ x, w? }`, built hands only): `x` is a whole hand's numbers (fingers.ts's,
  `HAND_N` of them; the palm's six are ignored). Every finger number is drawn to it with weight `w` (default 6, where a
  fingertip's target counts 1 per mm), eased in with the goal's weight. The caller places the palm (`exact`), and the
  solve only closes the fingertips onto their targets. Give all `HAND_N` numbers, every one finite: a shorter or
  poisoned `x` holds the fingers still on a hand with targets and leaves NaN bones on one without (as `pose` does).
- **A neck rested along the index's base bone** (`HandGoal.neck.restAt`, 0..1, default 0): where along the bone, from
  its knuckle (0) to its middle joint (1), the neck's `rest` draws the index onto the wood. A violinist's neck lies
  against the side of the bone, with the knuckle below the board's level. For tools: `HandAsk.neck[18]` (optional; an
  18-number neck is read as before).
- **A stopping finger's own square rests** (`HandGoal.stopRest`, per finger, thumb first: knuckle, middle and end, rad;
  default `HeroRig.SQUARE`, `[0.75, 1.35, 0.75]`, as before) and how firmly they're held (`HandGoal.stopW`, default
  1.5 as before). They act where `square` does.
- **The bow hold's fingers drawn in toward the middle** (`grasp(M, 'bow', …)`; the spreads are now `BOW.spread`,
  exported: index..little `[-0.04, 0, 0.08, 0.14]` rad, was `[0.12, 0, -0.04, -0.06]`). The index-to-little fan seen
  from above goes from 46° to 27° (real bowing hands ~25°), and neighbouring fingertips sit 29-39 mm apart (was
  35-44). The pads touch the stick as before (worst 0.4 mm off, was 0.2; 0.3 mm into it, was 0.2).
- **What changes in behaviour**: (1) Callers passing `ref`, `restAt`, `stopRest` or `stopW`: as above. (2) **Every
  user of the bow grasp**: the held hand's spreads move by up to 0.2 rad (11°), its fingers by up to 13 mm (World's
  fiddler's bow hand). Every other grasp is bit for bit as 0.5.0's, on five built bodies and both hands. (3) Nothing
  else.
- **Identical**: every bone, fingers included, in all 85 rows of Drake's acts (tools/release-ab against 0.5.0). World's
  built pianist at the duet (the whole score at 50, 60 and 144 fps) is bit for bit as 0.5.0's, gate 109/109. Built
  hands with tips, `palmFree`, `neck` (with `rest`, and with `restAt: 0`), `square` (with `stopRest` set to the default)
  and `pose` from a grasp other than the bow are bit for bit as 0.5.0's at 30, 60 and 144 fps. The hand's solve is
  the same in Node 22 and Chrome 157 for the pianist (1,458 frames) and for the band's guitarist and fiddler, who use
  `ref`, `restAt`, `stopRest` and the bow (2,420 frames). As in 0.5.0, some bones outside the hands differ in the last
  bit. No export was removed or changed in type: the additions are optional fields, `HeroRig.SQUARE` and `BOW`.
- **Size**: `rig` bundled alone grows by 0.7 KB minified (0.3 KB gzipped), `fingers` by 0.5 KB and `grasp` by 90 bytes.
- **Cost**: unchanged where the new fields aren't given. The new work runs only with `ref` or with `restAt` above 0.

## 0.5.0

- **A neck held in the hand** (`HandGoal.neck`: `{ at, axis, up, half, depth, air?, w?, rest? }`, world): a guitar's or
  a violin's neck, given as a point on the fingerboard's surface over the neck's middle, the neck's way, the way out of
  the board toward the strings, the board's half width and the neck's depth under it (m). The hand's solve keeps the
  palm's skin `air` off the wood (default 12 mm), and the knuckles' and joints' centres a finger's half thickness off
  it, so the skin just touches. `rest` (0..1) draws the index's base onto the board's edge (the neck in the web between
  thumb and index), and a laid finger (`lay`, a barre) lies on the strings by its joints. A goal with `neck` is a
  player's hand, not a pianist's: its thumb rests wrapped round behind the neck (`HeroRig.neckHand.thumb`; the thumb's
  target is the caller's), and a finger with a light `tipW` (under 0.5) hovers lifted from the knuckle, loosely bent
  (`neckHand.hover`). For tools: `HandAsk.neck` (optional), `HandModel.palmPts`, `LAM0`.
- **`HandGoal.elbowW` of 100 or more** keeps the elbow the goal's `elbow` way whatever the arm's ease (a violinist's
  left elbow under the fiddle). Below 100 it is weighed against the arm's ease as before.
- **`Pianist.blackIn`** (m, default 0; `forHand` sets 3 cm scaled by the hand's length): on a black key a built hand's
  long fingers land further along it than its thumb and little finger, flatter rather than hooked onto its front.
- **A finger no longer freezes after one bad frame** (built hands only): the hand's solve carried its damping from the
  last frame, and one frame whose every trial step failed left it at its ceiling, so the next frames' steps were too
  small to move the finger for about a tenth of a second (the fiddle's first stop landed 7 mm across). A built hand's
  solve now starts each frame from no more than `LAM0` (0.1). The damping goes above that on about half of a pianist's
  frames, so this reaches every built hand with fingertip targets.
- **What changes in behaviour**: (1) Callers passing `neck` or `elbowW >= 100`: as above. (2) **A built hand at the
  keys** (`header.hand`, `forHand`; World's Katara at the duet): the fingertips land as well as before (playing miss
  median 0.29 → 0.22 mm, p95 1.21 → 1.03 mm, the duet's score at 60 fps), and the contact gate is 109 of 109 at 50,
  60 and 144 fps, worst 13.1-14.4 ms. The arm moves differently: the elbow up to 7 cm from 0.4.0 at moments and the
  hand up to 6 cm (median over the song 12 mm), from the damping (6 cm with `blackIn` 0) and from `blackIn`. No
  finger stuck off its key in 0.4.0's run either (none more than a frame), so at the piano the freeze fix shows as a
  different, equally accurate arm, not as a cure. (3) Nothing else: no change for bodies without `header.hand`.
- **Identical**: every bone, fingers included, in all 85 rows of Drake's acts (tools/release-ab against 0.4.0).
  Old-format bodies (no `header.hand`: Drake's Katara at the duet's piano for the whole score) are bit for bit as
  0.4.0's, at a piano as well as standing, walking, riding and gripping. The hand's solve is the same in Node 24 and
  Chrome 157 at the piano (the whole score, 1,458 frames) and for the band's guitarist; the fiddler's hand parts by
  4e-14 at frame 2,167 and stays about 1e-11 apart in its numbers to 70 s, the joints at most 16 nm: invisible, but a
  film checked bit for bit against a live run will not match there (the rest of the body already differed in the last
  bit on some frames). No export was removed or changed in type: the additions are optional fields, new members
  (`HandModel.palmPts`, `Pianist.blackIn`, `HeroRig.neckHand`) and `LAM0`.
- **Size**: a bundle with `HeroRig` grows from 121.2 to 124.3 KB minified (50.5 to 51.9 KB gzipped). `fingers` alone
  grows by 2.0 KB, `piano` by 131 bytes, `grasp` by 65; `speech` and `face` are unchanged.
- **Cost**: unchanged for bodies without `neck` (the new work runs only with a neck; the damping cap only on built
  hands). CPU per body per frame with 12 of Drake's bodies (tools/release-ab cost.mjs, 5 alternating rounds, Node 24,
  the PC shared): walking 89 → 83 µs, running 99 → 81, standing 82 → 79, riding calm 126 → 141, the flute carried
  141 → 127, playing 180 → 154. Every round-to-round spread is wider than its difference.
- **To use it**: a fretting or stopping hand's goal from the instrument as in 0.3.0, plus `neck` from the
  instrument's neck at the hand (`rest` 1 on open shapes, 0 through a barre), the thumb's tip given a target on the
  neck's back or over its edge, hovering fingers at `tipW` under 0.5. The bow hold and the pick are grasps (0.4.0's
  `grasp(M, 'bow' | 'pinch', size)` placed with `graspGoal`). All of it needs a built hand.

## 0.4.0

- **Grasps** (`@ericrius1/cast/grasp`, also in the index): `grasp(model, kind, size)` solves how a built hand holds a
  thing, in the hand's own space. The palm is placed on the thing by the kind of hold, then each finger and the thumb
  close onto its surface by contact: pads on its skin, nothing into it or into the palm, the thumb opposing, every
  joint in range. The kinds (`GRASPS`) are `wrap` (a glass), `power` (a hammer's handle), `stick` (a drumstick on its
  fulcrum), `bow`, `pinch` (a pick), `tripod` (a pen), `stem`, `flat` and `rim` (a plate, a tray), `clasp` and `cloth`.
  `size` is `{ r, len, thick }` in m. The result (`Grasp`) has the hand's numbers and how well it holds (each finger's
  worst pad miss, `into`, `palmInto`, the thumb's `opp`). `graspGoal(model, g, side, hl, { at, axis, from | near, w })`
  places it in the world as a `HandGoal`, and `heldWorld` gives the held shape there (to draw or test). `heldSd` and
  `STICK` (the drumstick grip's numbers) are for tools. Solve a grasp once per thing and size, and place it every frame.
- **New `HandGoal` options**: `pose` (a built hand's fingers posed as given: `HAND_N` numbers from `grasp`, blended
  in by the goal's weight; it is what `graspGoal` sets), `around` (`{ at, axis, r, len?, pad? }`, world: a cylinder,
  or a ball with `axis` [0,0,0]; with `grip`, a built hand's fingers close joint by joint from open until each meets
  the surface, the thumb's saddle swinging round first, nothing passing through) and `prior` (0..1: real pianists'
  hands shaping a built hand at the keys, see below). `around` is not closed when `pose` is set.
- **A built hand's thumb** (`header.hand`, or a hand with the `ring0`/`pinky0` metacarpals: `HandModel.built`): its
  saddle turns the pad round to the fingers (about 100° at full opposition, where it was about 36°: Kapandji's test 9
  of 10). The column flexes to 62° and the MCP to 75°. `body/anatomy`'s `JOINTS.cmc` and `JOINTS.thumbMcp` now hold
  the new ranges: flexion 55°, abduction 40° / adduction 25°, MCP 65°. A hand that isn't built keeps the old saddle
  and the old ranges, whatever `JOINTS` says.
- **Real pianists' hands as a prior** (`body/handprior.ts`: `KEYS_PRIOR`, a Gaussian over the hand's 21 numbers, from
  our built hand fitted to 431 tracked overhead hands of 13 pianists). With `HandGoal.prior` on a built hand at the
  keys, the fingertips with targets land on them and the rest of the hand takes the posture real hands have with
  those fingers down, not each finger's own rest. `Pianist.forHand(len)` now sets `prior: 1` and the other values for
  a built hand: fingers landing further in, the long ones between the black keys and the thumb about 2.5 cm in, all
  scaled by the hand's length; `reach` 0.25 L; `pitch` 0.12; `idleLift` (idle thumbs and little fingers ride highest);
  `idleClear` 18 mm (new: the floor's clearance for a finger with nothing to play, 6 mm otherwise); and `idleRelease`
  (new: a let-go finger eases to an idle finger's weight from the top of its lift). A built hand's idle finger at the
  keys is held off its key as a lever, lifted at the knuckle rather than curled into a hook (`HeroRig.keysHand.lever`,
  `tipBuilt`, `idleBuilt`, `thumbIdleBuilt`, `restThumb`). For tools: `priorLetGo`, `HAND_W` (the couplings' weights).
- **The hand's solve gives the same bits in every JavaScript engine**: `math` adds `dsin`, `dcos`, `dexp`, `datan`,
  `datan2`, `drotateAxis` and `ddamp` (fdlibm's kernels, + - * / only) and `q30` (a number held to a 2^-30 grid). The
  hand's paths use them, and the curl, grip and goal weight that enter the solve are held to the grid. Checked here:
  the duet's pianist (World's Katara) for 900 frames in Node 22 and Chrome 157, the hands' numbers identical every
  frame (0.3.0 differed on 869 of the 900). The rest of the body still uses `Math` and can differ in the last
  bit (at most 1e-16 m) on some frames, without carrying over.
- **A modelled face** (`header.faceRig`: lips, a jaw opening on teeth, brows and lids built, not drawn): its bones
  move as far as a real face's. The mouth's corners and lips follow the speech's shapes (spread, round, press, tuck,
  teeth, open) as well as the smile, frown and smirk, the brows move 1.6 times as far, and the jaw opens to `jaw` (rad,
  default 0.24). The fields are `gain`, `shapes` (each shape's own gain), `attend` (0..1: the saccades and the phrase's
  glances scaled down by up to 0.8; `Face.attend`) and `lidOpen` (0..1: the lids more open at rest).
- **Lip timing from a recording** (`speech.ts`: `lineFromWords(text, words, env?)`): each word's phonemes are fitted
  into the time it was actually said (`words`: one `[t0, t1]` per whitespace-separated word). Consonants keep their
  own lengths at the word's edges, squeezed if the word was quick, and the vowels hold the rest, stressed ones longer.
  Pauses close the mouth. The result is a `Timeline` for `rig.face.speech = { tl, t, w }`.
- **What changes in behaviour**: (1) Everything above, on built hands (`header.hand`), in every pose with fingers:
  the thumb's saddle, the keys' rests, the Pianist's placement. (2) **At the keys, on every body**: a hand goal with
  fingertip targets that is neither holding (`grip`) nor `loose` takes a pianist's thumb (`keysHand.thumbIdle` and
  `thumbTip` now `[-0.44, -0.35, 0.95, 0.8]`, the old values kept as `thumbHigh` for a thumb on a black key, and an
  idle thumb rests as one). The Pianist also lets a finger's last key go 0.2 s after release, not 0.6 s. An old-format
  body playing the duet's score therefore moves differently from its first strokes: the arm up to 17 cm apart from
  0.3.0 by 9 s, the fingers 8 cm (World's Augie, Drake's Katara and Iroh). With those two changes undone, the
  difference drops to 5e-7 m, so nothing else contributes. Drake's flute is `loose` and is not affected. (3)
  Elsewhere, fingers with targets move by float rounding only (at most 4.8e-7 m) from the grid and the
  engine-independent maths. (4) `HandAsk` has three new required fields (`priorMu`, `priorP`, `wp`): `handAsk()`
  fills them, but a hand-built literal no longer type-checks.
- **Identical**: every bone outside the fingers in all 85 rows of Drake's acts (tools/release-ab against 0.3.0), and
  the fingertips' misses to 0.1 mm. On old-format bodies (World's Augie hi and lo, Drake's Katara and Iroh),
  standing, walking, sitting at the bench and a two-handed grip are bit for bit as 0.3.0's, in Node 22 and in Chrome
  157. No export was removed or changed in type: the additions are new modules and functions, optional fields and new
  members.
- **Size**: a bundle with `HeroRig` grows from 108.2 to 121.2 KB minified (44.7 to 50.5 KB gzipped). The posture
  prior is 4.0 KB of that and comes with the rig, but is not in bundles that don't import the rig: `speech` alone is
  unchanged, `face` grows by 67 bytes, `piano` by 353. `grasp` and `graspGoal` add 12.7 KB to a bundle without the rig.
- **Cost**: CPU per body per frame with 12 of Drake's bodies (tools/release-ab cost.mjs, 9 alternating rounds, Node
  22): walking 98 → 93 µs, running 91 → 97, standing 95 → 94, riding calm 145 → 146, the flute carried 159 → 159,
  playing 184 → 195. The playing figure came out 4-8% higher in every run (the hand's own sine and cosine), inside
  each round-to-round spread. The others are noise.
- **To opt in with a body file**: `header.hand` (as in 0.3.0) gives the new thumb and the built-hand rests. Call
  `new Pianist().forHand(header.hand.len)` for the prior and the pianist's placement. Grasps (`pose`) and `around`
  need a built hand. `header.faceRig` needs the face bones the rig moves (`jaw`, `lipU`, `lipUL/R`, `lipD`,
  `lipDL/R`, `mouthL/R`, `cheekL/R`, `browInL/R`, `browOutL/R`). Without any of these a file loads and poses as it
  did, apart from the keys' thumb and the Pianist's release above.

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
