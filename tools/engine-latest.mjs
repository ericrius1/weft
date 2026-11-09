#!/usr/bin/env node
// engine-latest: put this project's weft, loom and cast at the tips of their dist branches (dist/weft, dist/loom,
// dist/cast on github.com/ericrius1/weft), so no build or dev server runs on an engine older than the latest push to
// weft's main (a project without one of them skips it).
// The canonical copy is weft/tools/engine-latest.mjs; every project has the same file in its tools/ and calls it
//   "predev":   "node tools/engine-latest.mjs"            (soft: offline, it says so and the dev server starts anyway)
//   "prebuild": "node tools/engine-latest.mjs --strict"   (a build that can't confirm the tip fails)
// and wherever a deploy builds without `npm run build` (a Dockerfile, a vercel.json buildCommand, a deploy script).
//
// What it does: reads the tips over HTTPS (git's ref advertisement: no git, no API rate limit), compares them with
// the commits installed (node_modules/.package-lock.json) and locked (package-lock.json), and when either is behind:
//   with git:    npm update <the stale ones>   (node_modules and the lockfile move; package.json keeps its #dist spec)
//   without git: npm install --no-save <name>@git+https://...#<sha>  (a slim Docker image: npm fetches the commit's
//                tarball from GitHub; node_modules moves, the lockfile doesn't, which a one-off build doesn't need)
// then checks again. Commit the lockfile it moves. ENGINE_LATEST=0 skips it (an offline build, on purpose).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const strict = process.argv.includes('--strict');
const root = process.cwd();
const say = (m) => console.log(`engine-latest: ${m}`);
const fail = (m) => {
  if (strict) { console.error(`engine-latest: ${m}`); process.exit(1); }
  say(`${m} (carrying on with what's installed)`);
  process.exit(0);
};
if (process.env.ENGINE_LATEST === '0') { say('skipped (ENGINE_LATEST=0)'); process.exit(0); }

const readJson = (f) => { try { return JSON.parse(readFileSync(join(root, f), 'utf8')); } catch { return null; } };
const pkg = readJson('package.json');
if (!pkg) fail(`no package.json in ${root}`);

// the engine deps this project takes from a dist branch: { name, repo: 'ericrius1/weft', branch: 'dist/weft' }
const deps = [];
for (const name of ['@ericrius1/weft', '@ericrius1/loom', '@ericrius1/cast']) {
  const spec = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (!spec) continue;
  const m = /github(?:\.com[/:]|:)([\w.-]+\/[\w.-]+?)(?:\.git)?#(.+)$/.exec(spec);
  if (!m) { say(`${name} is "${spec}", not a dist branch: left as it is (use git+https://github.com/ericrius1/weft.git#dist/${name.split('/')[1]})`); continue; }
  deps.push({ name, repo: m[1], branch: m[2] });
}
if (!deps.length) process.exit(0);

const shaOf = (lock, name) => /#([0-9a-f]{40})$/.exec(lock?.packages?.[`node_modules/${name}`]?.resolved ?? '')?.[1];
const installed = (name) => shaOf(readJson('node_modules/.package-lock.json'), name);
const locked = (name) => shaOf(readJson('package-lock.json'), name);
const hasGit = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;

async function tips(repo) {
  const refs = new Map();
  try {
    const r = await fetch(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`, {
      headers: { 'user-agent': 'git/2 engine-latest' }, signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    for (const m of (await r.text()).matchAll(/([0-9a-f]{40}) refs\/heads\/(\S+)/g)) refs.set(m[2], m[1]);
  } catch (e) {
    if (!hasGit) throw e;
    const out = spawnSync('git', ['ls-remote', '--heads', `https://github.com/${repo}.git`], {
      encoding: 'utf8', timeout: 15000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    if (out.status !== 0) throw e;
    for (const m of out.stdout.matchAll(/([0-9a-f]{40})\trefs\/heads\/(\S+)/g)) refs.set(m[2], m[1]);
  }
  return refs;
}

function npm(args) {
  // npm's own CLI when run from an npm script (no shell, on any OS); else whichever npm is on PATH
  const cli = process.env.npm_execpath;
  const r = cli && /npm-cli\.js$/.test(cli)
    ? spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', cwd: root })
    : spawnSync('npm', args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });
  return r.status === 0;
}

const byRepo = new Map();
for (const d of deps) {
  try {
    if (!byRepo.has(d.repo)) byRepo.set(d.repo, await tips(d.repo));
  } catch (e) { fail(`couldn't reach github.com/${d.repo} for the tip of ${d.branch} (${e.message})`); }
  d.tip = byRepo.get(d.repo).get(d.branch);
  if (!d.tip) fail(`github.com/${d.repo} has no branch ${d.branch}`);
}

const short = (s) => s?.slice(0, 7) ?? 'none';
const stale = () => deps.filter((d) => installed(d.name) !== d.tip || (hasGit && locked(d.name) !== d.tip));
let behind = stale();
if (behind.length) {
  say(behind.map((d) => `${d.name.split('/')[1]} ${short(installed(d.name))} -> ${short(d.tip)}`).join(', '));
  const flags = ['--no-audit', '--no-fund'];
  if (hasGit) npm(['update', ...behind.map((d) => d.name), ...flags]);
  behind = deps.filter((d) => installed(d.name) !== d.tip);
  if (behind.length) npm(['install', '--no-save', ...flags, ...behind.map((d) => `${d.name}@git+https://github.com/${d.repo}.git#${d.tip}`)]);
  behind = deps.filter((d) => installed(d.name) !== d.tip);
  if (behind.length) fail(`still behind after updating: ${behind.map((d) => `${d.name} ${short(installed(d.name))}, tip ${short(d.tip)}`).join('; ')}`);
  if (deps.some((d) => locked(d.name) !== d.tip)) say('installed the tips; package-lock.json still has the old commits (no git here to move it)');
  else say('package-lock.json moved to the tips: commit it');
}
say(deps.map((d) => `${d.name.split('/')[1]} ${short(d.tip)}`).join(', ') + ` (tip of ${deps.map((d) => d.branch).join(', ')})`);
