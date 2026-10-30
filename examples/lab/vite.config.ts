import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { weft } from '@ericrius1/weft/vite';

// WEFT_SRC=1 runs the pages on the kit's source instead of its build (engine work without a rebuild per edit)
const src = resolve(__dirname, '../../packages/weft/src');
const alias = process.env.WEFT_SRC
  ? [{ find: /^@ericrius1\/weft$/, replacement: `${src}/index.ts` }, { find: /^@ericrius1\/weft\/runtime$/, replacement: `${src}/shader.ts` }]
  : [];

export default defineConfig({
  plugins: [weft()],
  resolve: { alias },
  build: { target: 'esnext', rollupOptions: { input: ['index.html', 'bench.html', 'checks.html'].map((f) => resolve(__dirname, f)) } },
});
