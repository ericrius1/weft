export class Robe {
  dq = new Float32Array(0); bones = 0; flutter: any = [0, 0, 0]; mount: any = { neck: { a: [0, 0, 0], b: [0, 0, 1], r: 0.1 }, back: { a: [0, 0, 0], b: [0, 0, 1], r: 0.1 } };
  mesh: any = { look: { cel: [], shade: [] }, robe: [0, 0, 0], visible: true, uniforms() {}, draw() {}, drawShadow() {}, change: null, sway: [0, 0, 0] };
  constructor(..._a: any[]) {}
  update() { return 0; } style() {}
}
