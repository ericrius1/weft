export const LAYOUT = {};
export const LOOM_GRADE = {};
export class HeroMesh {
  look: any; hide = 0; visible = true; change: any = null; sway: any = [0, 0, 0]; expo: any; grade: any;
  constructor(readonly kit: any, readonly asset: any, look: any, readonly iris: any) { this.look = look; }
  update() {} draw() {} drawShadow() {} uniforms() {}
}
