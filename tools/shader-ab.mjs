// Every shader of some projects compiled as the browser is given it (the plugin's lean code) against two copies of
// weft's shader library: which entry modules' code changes. A release that adds to the library (a Frame field, a new
// include) should change none but the ones that use the addition.
//   OLD=<dir of the old weft shaders> node tools/shader-ab.mjs <project root>...      (NEW: this tree's, by default)
// The old library: `git archive origin/main packages/weft/shaders | tar -x -C <dir>`. loom's library is this tree's.
import { readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const { compileWgsl } = await import(pathToFileURL(resolve(here, '../packages/weft/dist/plugin/wgsl.js')).href);
const NEW = process.env.NEW ?? resolve(here, '../packages/weft/shaders');
const OLD = process.env.OLD;
if (!OLD) { console.error('OLD=<old weft shaders dir>'); process.exit(1); }
const LOOM = process.env.LOOM ?? resolve(here, '../packages/loom/src/shaders');
const SKIP = new Set(['node_modules', 'dist', '.git', 'public', 'shots', '.data', 'film']);
function* walk(dir) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n) || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* walk(p); else if (n.endsWith('.wgsl')) yield p;
  }
}
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
let total = 0, same = 0, changed = [], failed = [];
for (const root of process.argv.slice(2)) {
  let n = 0, ns = 0;
  for (const f of walk(root)) {
    let a, b;
    try { a = compileWgsl(f, { root, libs: { weft: OLD, loom: LOOM } }); } catch (e) { a = { code: 'ERR ' + e.message, reflect: { entries: [] } }; }
    try { b = compileWgsl(f, { root, libs: { weft: NEW, loom: LOOM } }); } catch (e) { b = { code: 'ERR ' + e.message, reflect: { entries: [] } }; }
    n++;
    if (a.code.startsWith('ERR') && b.code.startsWith('ERR')) { failed.push(f); continue; }
    if (!b.reflect.entries.length) { /* a library include: not given to the browser on its own */ }
    if (a.code === b.code) { ns++; continue; }
    changed.push(`${f}  ${h(a.code)} -> ${h(b.code)}  entries: ${b.reflect.entries.map((e) => e.name).join(',') || '(none: an include)'}`);
  }
  console.log(`${root}: ${ns}/${n} identical`);
  total += n; same += ns;
}
console.log(`all: ${same}/${total} identical; ${failed.length} fail to compile on both (not shaders on their own)`);
for (const c of changed) console.log('  changed', c);
