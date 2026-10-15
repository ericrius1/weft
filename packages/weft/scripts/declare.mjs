// writes shaders/*.d.wgsl.ts (typed struct fields and binding names for each shader) with the freshly built compiler
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileWgsl, writeDeclaration } from '../dist/plugin/wgsl.js';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'shaders');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.wgsl'))) {
  const file = resolve(dir, f);
  writeDeclaration(file, compileWgsl(file, { root, libs: { weft: dir } }), '@ericrius1/weft');
}
