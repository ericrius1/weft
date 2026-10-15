// the shader library ships beside the compiled modules (dist/shaders), with its declarations
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
cpSync(resolve(root, 'shaders'), resolve(root, 'dist/shaders'), { recursive: true });
