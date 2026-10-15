// the shaders ship beside the compiled modules (dist/shaders), with their declarations
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
cpSync(resolve(root, 'src/shaders'), resolve(root, 'dist/shaders'), { recursive: true });
