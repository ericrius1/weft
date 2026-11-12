// The two cast copies a release is checked between, each built and packed exactly as CI's dist job does (tsc, then
// `npm pack`: the package's `files`), into COPIES/old and COPIES/new:
//   COPIES=<scratch dir> OLD=origin/main NEW=HEAD node tools/release-ab/prepare.mjs
// OLD and NEW are any git refs of this repo (NEW=WORKTREE packs the working tree's packages/cast as it is).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..'), C = process.env.COPIES;
if (!C) throw new Error('COPIES=<scratch dir>');
const OLD = process.env.OLD ?? 'origin/main', NEW = process.env.NEW ?? 'HEAD';
const tsc = resolve(root, 'node_modules/typescript/bin/tsc');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' && cmd === 'npm' }).toString();
for (const [which, ref] of [['old', OLD], ['new', NEW]]) {
  const src = resolve(C, `src-${which}`), out = resolve(C, which);
  rmSync(src, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true });
  mkdirSync(src, { recursive: true }); mkdirSync(out, { recursive: true });
  let pkg;
  if (ref === 'WORKTREE') pkg = resolve(root, 'packages/cast');
  else {
    execFileSync('sh', ['-c', `git archive ${ref} packages/cast tsconfig.base.json | tar -x -C "${src.replace(/\\/g, '/')}"`], { cwd: root, stdio: 'inherit' });
    pkg = resolve(src, 'packages/cast');
  }
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: pkg, stdio: 'inherit' });
  const tgz = run('npm', ['pack', '--silent', '--pack-destination', src], pkg).trim().split('\n').pop();
  // (relative paths: GNU tar reads "C:/..." as a remote host)
  execFileSync('tar', ['-xzf', `../src-${which}/${tgz}`, '--strip-components=1'], { cwd: out, stdio: 'inherit' });
  console.log(`${which}: ${ref} -> ${out} (${readdirSync(resolve(out, 'dist')).length} files in dist)`);
}
