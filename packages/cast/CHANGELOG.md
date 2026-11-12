# Changelog

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
