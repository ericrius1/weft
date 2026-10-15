import { defineConfig } from 'vite';
import { weft } from '@ericrius1/weft/vite';

export default defineConfig({ plugins: [weft()], build: { target: 'esnext' } });
