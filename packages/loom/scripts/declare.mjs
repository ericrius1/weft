// writes src/shaders/*.d.wgsl.ts (typed struct fields and binding names) with weft's compiler
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileWgsl, writeDeclaration } from '@ericrius1/weft/wgsl';
import { weftShaders } from '@ericrius1/weft/vite';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'src/shaders');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.wgsl'))) {
  const file = resolve(dir, f);
  writeDeclaration(file, compileWgsl(file, { root, libs: { weft: weftShaders, loom: dir } }), '@ericrius1/weft');
}
