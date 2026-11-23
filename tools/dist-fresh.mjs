// A package's tests run against its built `dist/`, and a `dist/` older than the source tests yesterday's code and
// passes. This is each package's `pretest`: when anything in the source folders named is newer than the newest file
// in `dist/` (or there's no `dist/`), it builds the package first and says so. Run from the package's folder:
//   node ../../tools/dist-fresh.mjs src plugin shaders
// After a build (CI builds before it tests) nothing is newer, and it does nothing. `DIST_FRESH=0` skips the check.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** the newest modification time under `dir` (0 with nothing there), and the file it belongs to */
function newest(dir, skip = () => false, best = { t: 0, file: '' }) {
  if (!existsSync(dir)) return best;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') newest(p, skip, best); continue; }
    if (skip(e.name)) continue;
    const t = statSync(p).mtimeMs;
    if (t > best.t) { best.t = t; best.file = p; }
  }
  return best;
}

if (process.env.DIST_FRESH !== '0') {
  const dirs = process.argv.slice(2);
  // (the build writes the shaders' *.d.wgsl.ts itself: not source)
  const src = dirs.reduce((b, d) => newest(d, (n) => n.endsWith('.d.wgsl.ts'), b), { t: 0, file: '' });
  const dist = newest('dist');
  if (src.t > dist.t) {
    console.log(`[dist-fresh] ${dist.t ? `${src.file} is newer than dist/` : 'no dist/'}: building before the tests`);
    const r = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}
