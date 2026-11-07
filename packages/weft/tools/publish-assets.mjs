#!/usr/bin/env node
// Publish an app's big assets to R2, content-addressed (San Francisco's tools/publish-assets.mjs, made general): each
// file matched under the assets folder goes up as objects/<sha256>/<name> — immutable, never overwritten, so a deploy
// can't break the one before it and a client may keep it forever (Assets' `keep`) — and the map, path under the assets
// folder → its URL, is written (remote-assets.json) for the dev server's fallback and the build to ship (plugin/vite.ts
// remoteAssets). The files themselves stay out of git. Uploads go through Wrangler, as you're logged in there; a file
// already there (same key, same size) isn't sent again.
//
//   node node_modules/@ericrius1/weft/tools/publish-assets.mjs --bucket my-assets --origin https://assets.example.dev \
//     [--dir public/assets] [--match 'tiles/*.pack' --match 'big/**'] [--map remote-assets.json] [--jobs 2] [--dry]
//
// Paths are the project's (the directory it's run from). --match is a glob under --dir (* within a folder, ** across
// folders); without one, every file over 5 MB.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const all = (k) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []));
const bucket = opt('bucket'), origin = opt('origin')?.replace(/\/$/, '');
if (!bucket || !origin) { console.error('publish-assets: --bucket and --origin are needed'); process.exit(2); }
const DIR = resolve(opt('dir', 'public/assets'));
const MAP = resolve(opt('map', 'remote-assets.json'));
const jobsAtOnce = Number(opt('jobs', 2));
const dry = args.includes('--dry');
const globs = all('match');
const toRe = (g) => new RegExp(`^${g.split('**').map((p) => p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`);
const wanted = globs.length ? globs.map(toRe) : null;

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const rel = (abs) => relative(DIR, abs).split(sep).join('/');
const files = walk(DIR).filter((abs) => (wanted ? wanted.some((re) => re.test(rel(abs))) : statSync(abs).size > 5e6));
const map = existsSync(MAP) ? JSON.parse(readFileSync(MAP, 'utf8')) : {};

const hashOf = (p) => new Promise((ok, fail) => {
  const h = createHash('sha256');
  createReadStream(p).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', fail);
});
const TYPES = { json: 'application/json', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', ktx2: 'image/ktx2', mp3: 'audio/mpeg', wav: 'audio/wav', glb: 'model/gltf-binary' };
const typeOf = (name) => TYPES[name.split('.').pop()?.toLowerCase()] ?? 'application/octet-stream';

async function upload(abs, key, size) {
  const head = await fetch(`${origin}/${key}`, { method: 'HEAD' }).catch(() => null);
  if (head?.ok && Number(head.headers.get('content-length')) === size) return false;
  if (size > 300e6) throw new Error(`${key}: ${(size / 1e6).toFixed(0)} MB is past Wrangler's 300 MB upload`);
  if (dry) return true;
  await new Promise((ok, fail) => {
    const p = spawn('npx', ['-y', 'wrangler@4', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', abs, '--content-type', typeOf(abs),
      '--cache-control', 'public, max-age=31536000, immutable', '--remote'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => (c === 0 ? ok() : fail(new Error(`wrangler couldn't upload ${key}: ${err.trim().split('\n').slice(-3).join(' ')}`))));
  });
  return true;
}

const jobs = await Promise.all(files.map(async (abs) => ({ abs, rel: rel(abs), size: statSync(abs).size, key: `objects/${await hashOf(abs)}/${basename(abs)}` })));
let next = 0;
await Promise.all(Array.from({ length: Math.max(1, jobsAtOnce) }, async () => {
  while (next < jobs.length) {
    const j = jobs[next++];
    const sent = await upload(j.abs, j.key, j.size);
    map[j.rel] = `${origin}/${j.key}`;
    console.log(`${sent ? (dry ? 'would upload' : 'uploaded') : 'there already'}  ${j.rel}  ${(j.size / 1e6).toFixed(1)} MB`);
  }
}));
if (!dry) writeFileSync(MAP, JSON.stringify(Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]])), null, 1) + '\n');
console.log(`${jobs.length} files${dry ? ' (dry run: nothing sent, the map unchanged)' : `; ${relative(process.cwd(), MAP)} written`}`);
