// Two bundles of the project's own code (Drake's Rider and Flute, read-only) with acts.ts, one on each cast copy:
//   COPIES=<dir holding old/ and new/ (prepare.mjs)> DRAKE=<the project> node build.mjs
import { build } from 'esbuild';
import { resolve } from 'node:path';
const here = import.meta.dirname;
const DRAKE = (process.env.DRAKE ?? 'C:/Users/ericr/codeprojects/drake').replace(/\\/g, '/'), COPIES = process.env.COPIES;
if (!COPIES) throw new Error('COPIES=<dir with old/ and new/> (node prepare.mjs makes them)');
const STUB = { 'src/cast/mesh': 'mesh', 'src/cast/robe': 'robe', 'src/cast/props': 'props', 'src/flute/ether': 'ether', 'src/flute/sound': 'sound', 'src/flute/samples': 'samples', 'src/flute/ui': 'ui' };
const fwd = (p) => p.replace(/\\/g, '/');
for (const which of ['old', 'new']) {
  const cast = resolve(COPIES, which, 'dist');
  await build({
    entryPoints: [resolve(here, 'acts.ts')], bundle: true, platform: 'node', format: 'esm', outfile: resolve(COPIES, `acts-${which}.mjs`),
    define: { 'Math.random': '__rand', 'import.meta.env.BASE_URL': '"/"', __DRAKE__: JSON.stringify(DRAKE) }, inject: [resolve(here, 'rand.ts')], logLevel: 'warning',
    loader: { '.wgsl': 'text' },
    plugins: [{ name: 'ab', setup(b) {
      b.onResolve({ filter: /^DRAKE\// }, (a) => ({ path: resolve(DRAKE, a.path.slice(6)) + '.ts' }));
      b.onResolve({ filter: /^@ericrius1\/cast(\/.*)?$/ }, (a) => ({ path: resolve(cast, (a.path.slice('@ericrius1/cast/'.length) || 'index') + '.js') }));
      b.onResolve({ filter: /^@ericrius1\/weft$/ }, () => ({ path: resolve(here, 'stubs/weft.ts') }));
      b.onResolve({ filter: /^@ericrius1\/loom/ }, () => ({ path: resolve(here, 'stubs/loom.ts') }));
      b.onResolve({ filter: /^\.\.?\// }, (a) => {
        if (!fwd(a.importer).startsWith(DRAKE)) return;
        const p = fwd(resolve(a.resolveDir, a.path)).replace(/\.ts$/, '');
        for (const [k, v] of Object.entries(STUB)) if (p === `${DRAKE}/${k}`) return { path: resolve(here, `stubs/${v}.ts`) };
      });
    } }],
  });
  console.log('built', which);
}
