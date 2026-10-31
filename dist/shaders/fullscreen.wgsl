// one triangle that covers the screen: draw with count 3 (RenderPass.fullscreen does it for you)
struct FullscreenOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs_fullscreen(@builtin(vertex_index) vi: u32) -> FullscreenOut {
  var o: FullscreenOut;
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
