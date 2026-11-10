// Fallback typing for .wgsl imports whose generated .d.wgsl.ts doesn't exist yet (run the dev server or a build once).
// Add to a tsconfig's "types": ["@ericrius1/weft/client"].
declare module '*.wgsl' {
  import type { Shader } from '@ericrius1/weft';
  const shader: Shader<Record<string, any>, string>;
  export default shader;
}
