// group 0: the frame every pass sees. The kit fills `frame` from the view's camera at the start of each run;
// binding 1 is the app's own globals struct (declare it in an app include as
// `@group(0) @binding(1) var<uniform> globals: MyGlobals;` and hand the buffer to kit.setGlobals).
struct Frame {
  viewProj: mat4x4f,
  view: mat4x4f,
  proj: mat4x4f,
  invViewProj: mat4x4f,
  invProj: mat4x4f,
  invView: mat4x4f,
  prevViewProj: mat4x4f,
  camPos: vec3f, time: f32,
  camFwd: vec3f, dt: f32,
  camRight: vec3f, near: f32,
  camUp: vec3f, frame: u32,
  res: vec2f, invRes: vec2f,
  jitter: vec2f, fovY: f32, aspect: f32,
  mouse: vec4f,
  user: vec4f,          // per-view values the app sets (View.user): e.g. a reflection view's clip plane
  // camera-relative (Camera.viewRel): the same projection with the eye at the origin, for positions given relative to
  // the eye. camPos + camLo is the eye in full: camLo is what a float32 loses of it
  viewProjRel: mat4x4f,
  invViewProjRel: mat4x4f,
  prevViewProjRel: mat4x4f,   // last frame's, about this frame's eye
  camLo: vec3f, _relPad: f32,
}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(2) var samp_linear: sampler;
@group(0) @binding(3) var samp_repeat: sampler;
@group(0) @binding(4) var samp_nearest: sampler;
@group(0) @binding(5) var samp_shadow: sampler_comparison;

// a world position relative to the eye: the difference of two nearby floats is exact (or rounded once, at the size of
// the difference, not of the coordinates), and the eye's low bits that a float32 camPos lost are taken off after
fn fromEye(p: vec3f) -> vec3f { return (p - frame.camPos) - frame.camLo; }
// clip position of a world position, through the camera-relative matrix (as viewProj * p, without a large translation
// rounded into the product)
fn clipAt(p: vec3f) -> vec4f { return frame.viewProjRel * vec4f(fromEye(p), 1.0); }
// clip position of a position already relative to the eye (an origin − camera from the CPU in doubles, plus local)
fn clipRel(r: vec3f) -> vec4f { return frame.viewProjRel * vec4f(r, 1.0); }
// last frame's clip position of a world position (motion vectors)
fn prevClipAt(p: vec3f) -> vec4f { return frame.prevViewProjRel * vec4f(fromEye(p), 1.0); }
// last frame's clip position of a position relative to this frame's eye
fn prevClipRel(r: vec3f) -> vec4f { return frame.prevViewProjRel * vec4f(r, 1.0); }
// a position relative to the eye from a screen uv (0..1, y down) and a depth-buffer value: worldFromDepth without the
// world's large coordinates in it (precise as far from the origin as near it)
fn relFromDepth(uv: vec2f, d: f32) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
  let w = frame.invViewProjRel * ndc;
  return w.xyz / w.w;
}

// reversed-Z, infinite far plane: view distance along the view axis from a depth-buffer value
fn linearDepth(d: f32) -> f32 { return frame.near / max(d, 1e-7); }

// world position from a screen uv (0..1, y down) and a depth-buffer value
fn worldFromDepth(uv: vec2f, d: f32) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
  let w = frame.invViewProj * ndc;
  return w.xyz / w.w;
}

// view ray (world, normalised) through a screen uv
fn viewRay(uv: vec2f) -> vec3f {
  // (in the camera's basis: unprojecting a near-plane point and subtracting a far-from-origin camera loses precision;
  // proj[2].xy is the frustum's off-axis part, the TAA's jitter and Camera.shift: ndc = proj[0][0] * x / -z - proj[2][0])
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return normalize(frame.camFwd + frame.camRight * ((ndc.x + frame.proj[2][0]) / frame.proj[0][0]) + frame.camUp * ((ndc.y + frame.proj[2][1]) / frame.proj[1][1]));
}
