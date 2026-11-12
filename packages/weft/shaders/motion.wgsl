// Motion vectors for what moves by itself (a creature, a car, a skinned body, grass in the wind), for the TAAU's
// `motion` target (taau.ts). A draw that moves writes, at its own colour location in the scene pass, what
// `motionOf(cur, prev)` gives from its clip position this frame and last; a draw that writes nothing leaves the
// target's clear (0: "the camera's motion"), and the TAAU reprojects it by the camera as before. So nothing else in the
// scene pass changes, and a static draw in front of a moving one needs no motion of its own: the TAAU takes a texel's
// motion only where the distance written with it is the distance in the depth buffer there.
//
// The target: rgba16float at the render size (multisampled like the scene, or not; the TAAU reads its first sample,
// as it reads the depth's), cleared to 0. Its texel:
//   xy  the point's screen uv now minus its uv last frame (uv: 0..1, y down), both without their frame's jitter
//   z   its view distance last frame, from last frame's eye (clip w; an orthographic camera's depth instead)
//   w   its view distance now (the same measure): 0 is "nothing written here"
//
// Where the positions come from (every case gives a world position now and the same point's last frame):
//   rigid      model · local and lastModel · local
//   skinned    the bones' pose now and last frame's (two buffers, swapped as the pose is written)
//   instanced  each instance's frame now and last frame's
//   displaced  the displacement evaluated at frame.time and again at frame.time − frame.dt (wind, waves)
// and are projected through clipAt / prevClipAt (or clipRel / prevClipRel for eye-relative positions: weft/frame).
// For a draw that's the camera's subject, write it everywhere: it's what stays still on the screen while the world
// streams past, the case the camera's motion alone gets most wrong.
#include "weft/frame"

/** the motion texel of a point from its clip position now (as the vertex wrote @builtin(position): with this frame's
 *  jitter) and last frame (through prevClipAt/prevClipRel: with last frame's), both interpolated to the pixel
 *  unchanged (pass them as two vec4f varyings). Write it to the motion target */
fn motionOf(cur: vec4f, prev: vec4f) -> vec4f {
  let ortho = frame.proj[3][3] > 0.5;
  let a = cur.xy / cur.w - frame.jitterNdc.xy;
  let b = prev.xy / prev.w - frame.jitterNdc.zw;
  let d = a - b;
  let dNow = select(cur.w, cur.z / cur.w, ortho);
  let dWas = select(prev.w, prev.z / prev.w, ortho);
  return vec4f(0.5 * d.x, -0.5 * d.y, dWas, max(dNow, 1e-6));
}

/** the same for a point that doesn't move by itself (a static draw that must still write the target: one drawn over a
 *  moving one with the same depth, a decal) — the camera's motion at it */
fn motionStill(cur: vec4f, worldPos: vec3f) -> vec4f { return motionOf(cur, prevClipAt(worldPos)); }
