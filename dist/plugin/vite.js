import { readdirSync, statSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compileWgsl, writeDeclaration } from './wgsl.js';
export const PACKAGE = '@ericrius1/weft';
/** this package's own shader library (dist/plugin/vite.js → shaders/) */
export const weftShaders = resolve(dirname(fileURLToPath(import.meta.url)), '../../shaders');
/** a lib given as a package name → its shader directory */
export function shaderDir(spec, root) {
    if (isAbsolute(spec))
        return spec;
    const req = createRequire(join(root, 'package.json'));
    const pkgJson = req.resolve(`${spec}/package.json`);
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'));
    return resolve(dirname(pkgJson), pkg.weft?.shaders ?? 'shaders');
}
const SKIP = new Set(['node_modules', 'dist', '.git', '.vercel', 'public', 'shots', '.data']);
function* walk(dir) {
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name) || name.startsWith('.'))
            continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory())
            yield* walk(p);
        else if (name.endsWith('.wgsl'))
            yield p;
    }
}
export function weft(opts = {}) {
    let root = process.cwd();
    let isBuild = false;
    let libs = { weft: weftShaders };
    const includers = new Map();
    // (every shader file loaded, and its modification time then: a rebuilt package's dist — files deleted and written
    // again, or renamed into place — can drop the watcher's hold on them, so a page load checks them itself)
    const seen = new Map();
    const mtime = (f) => { try {
        return statSync(f).mtimeMs;
    }
    catch {
        return -1;
    } };
    const typesFrom = opts.typesFrom ?? PACKAGE;
    const runtime = opts.runtime ?? `${PACKAGE}/runtime`;
    const compile = (file) => compileWgsl(file, { root, libs });
    const declare = (file, s) => {
        if (opts.types === false || file.includes('/node_modules/'))
            return;
        writeDeclaration(file, s, typesFrom);
    };
    const moduleCode = (s) => `import { defineShader } from ${JSON.stringify(runtime)};\n` +
        `export default defineShader(${JSON.stringify(s)});\n` +
        `if (import.meta.hot) import.meta.hot.accept();\n`;
    return {
        name: 'weft-wgsl',
        enforce: 'pre',
        // the packages import .wgsl files, which only this plugin understands: keep them out of the dependency pre-bundle
        // (and box3d.js, whose wasm sits beside its module: `new URL('box3d.wasm', import.meta.url)`)
        config: () => ({ optimizeDeps: { exclude: [PACKAGE, '@ericrius1/loom', 'box3d.js'] } }),
        configResolved(c) {
            root = c.root;
            isBuild = c.command === 'build';
            libs = { weft: weftShaders };
            for (const [k, v] of Object.entries(opts.libs ?? {}))
                libs[k] = shaderDir(v, root);
        },
        buildStart() {
            if (opts.types === false)
                return;
            for (const f of walk(root)) {
                try {
                    declare(f, compile(f));
                }
                catch { /* reported when imported */ }
            }
        },
        load(id) {
            const [file, query] = id.split('?');
            if (!file.endsWith('.wgsl') || (query && /raw|url/.test(query)))
                return null;
            try {
                const s = compile(file);
                seen.set(file, mtime(file));
                for (const inc of s.includes) {
                    seen.set(inc, mtime(inc));
                    this.addWatchFile(inc);
                    let set = includers.get(inc);
                    if (!set)
                        includers.set(inc, (set = new Set()));
                    set.add(file);
                }
                declare(file, s);
                const { includes: _i, ...rest } = s;
                return moduleCode(rest);
            }
            catch (e) {
                const msg = e.message;
                if (isBuild)
                    this.error(msg);
                this.warn(msg);
                const id0 = file.startsWith(root) ? file.slice(root.length + 1) : file;
                return moduleCode({ id: id0, label: id0.split('/').pop(), code: '', files: [id0], runs: [], error: msg,
                    reflect: { structs: {}, bindings: {}, entries: [], overrides: {} } });
            }
        },
        configureServer(server) {
            server.middlewares.use((req, _res, next) => {
                // (a page load: any shader changed on disk since it was loaded is loaded again, it and what includes it)
                if (req.headers.accept?.includes('text/html')) {
                    for (const [f, t] of seen) {
                        const now = mtime(f);
                        if (now === t)
                            continue;
                        seen.set(f, now);
                        for (const file of [f, ...(includers.get(f) ?? [])]) {
                            for (const m of server.moduleGraph.getModulesByFile(file) ?? [])
                                server.moduleGraph.invalidateModule(m);
                        }
                    }
                }
                next();
            });
        },
        handleHotUpdate(ctx) {
            if (!ctx.file.endsWith('.wgsl'))
                return;
            const mods = new Set(ctx.modules);
            for (const entry of includers.get(ctx.file) ?? []) {
                for (const m of ctx.server.moduleGraph.getModulesByFile(entry) ?? [])
                    mods.add(m);
            }
            return [...mods];
        },
    };
}
/** Where a page's film frames land: the dev (and preview) server takes POSTs from a page rendering a film frame by
 *  frame (see Capture) and writes them under `dir`/<name>/ — `/__film/frame?name=&i=` a JPEG as frames/f00012.jpg,
 *  `/__film/audio?name=` a WAV as audio.wav, `/__film/meta?name=` JSON as meta.json. Use a preview server for long
 *  films: a dev server reloads the page when a source file is saved.
 *
 *    plugins: [weft(), filmSink({ dir: resolve(__dirname, '../film') })]
 */
export function filmSink(opts) {
    const route = opts.route ?? '/__film';
    const mount = (use) => use(route, (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const name = (url.searchParams.get('name') ?? 'film').replace(/[^\w.-]/g, '');
        const dir = resolve(opts.dir, name);
        if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            const i = Number(url.searchParams.get('i') ?? 0);
            if (url.pathname === '/frame') {
                mkdirSync(join(dir, 'frames'), { recursive: true });
                writeFileSync(join(dir, 'frames', `f${String(i).padStart(5, '0')}.jpg`), body);
            }
            else if (url.pathname === '/audio') {
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, 'audio.wav'), body);
            }
            else if (url.pathname === '/meta') {
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, 'meta.json'), body);
            }
            else {
                res.statusCode = 404;
                res.end();
                return;
            }
            res.end('ok');
        });
    });
    return {
        name: 'weft-film-sink',
        configureServer(server) { mount((p, fn) => server.middlewares.use(p, fn)); },
        configurePreviewServer(server) { mount((p, fn) => server.middlewares.use(p, fn)); },
    };
}
const both = (name, use, apply) => ({
    name, ...(apply ? { apply } : {}),
    configureServer(server) { server.middlewares.use(use); },
    configurePreviewServer(server) { server.middlewares.use(use); },
});
/** The big assets on R2 (San Francisco's and Boulder's): an app's /assets beside it in development, its big files
 *  content-addressed on R2 once published (tools/publish-assets.mjs) and listed in a map, path under /assets → URL.
 *  - dev and preview: an asset that isn't on this disk is redirected to its R2 copy, so a worktree or a fresh clone works
 *    without every file (one that is here is always served from here: edit away). The map is re-read when it changes.
 *  - a build: the map shipped as dist/assets/remote.json (Assets.init reads it), and the files that live only on R2
 *    (`omit`) left out of dist.
 *
 *    plugins: [weft(), remoteAssets({ omit: /^tiles\/.*\.pack$/ })]
 */
export function remoteAssets(opts = {}) {
    let root = process.cwd(), outDir = 'dist';
    const prefix = opts.prefix ?? '/assets/';
    const assetsDir = () => resolve(root, opts.assets ?? 'public/assets');
    const mapPath = () => resolve(root, opts.map ?? 'remote-assets.json');
    let map = {}, at = -1;
    const lookup = (rel) => {
        try {
            const t = statSync(mapPath()).mtimeMs;
            if (t !== at) {
                map = JSON.parse(readFileSync(mapPath(), 'utf8'));
                at = t;
            }
        }
        catch {
            return undefined;
        }
        return map[rel];
    };
    const use = (req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const i = path.indexOf(prefix);
        if (i < 0)
            return next();
        let rel;
        try {
            rel = decodeURIComponent(path.slice(i + prefix.length));
        }
        catch {
            return next();
        }
        if (!rel || rel.includes('..') || existsSync(resolve(assetsDir(), rel)))
            return next();
        const url = lookup(rel);
        if (!url)
            return next();
        res.statusCode = 302;
        res.setHeader('location', url);
        res.setHeader('cache-control', 'no-store');
        res.end();
    };
    const omitted = (rel) => (opts.omit instanceof RegExp ? opts.omit.test(rel) : opts.omit ? opts.omit(rel) : false);
    return {
        name: 'weft-remote-assets',
        configResolved(c) { root = c.root; outDir = resolve(c.root, c.build.outDir); },
        configureServer(server) { server.middlewares.use(use); },
        configurePreviewServer(server) { server.middlewares.use(use); },
        closeBundle() {
            if (!existsSync(outDir))
                return;
            const dist = resolve(outDir, (opts.assets ?? 'public/assets').replace(/^public\/?/, '') || '.');
            const ship = opts.ship === undefined ? 'remote.json' : opts.ship;
            if (ship) {
                mkdirSync(dist, { recursive: true });
                writeFileSync(join(dist, ship), existsSync(mapPath()) ? readFileSync(mapPath(), 'utf8') : '{}');
            }
            if (!opts.omit || !existsSync(dist))
                return;
            const drop = (dir) => {
                for (const name of readdirSync(dir)) {
                    const p = join(dir, name);
                    if (statSync(p).isDirectory())
                        drop(p);
                    else if (omitted(relative(dist, p).split(sep).join('/')))
                        rmSync(p);
                }
            };
            drop(dist);
        },
    };
}
/** Where shot() posts its pictures (dev and preview): `/__shot?name=` a JPEG (or PNG, WebP: by its type) written to
 *  `dir`/<name>.jpg.
 *
 *    plugins: [weft(), shotSink({ dir: resolve(__dirname, '../shots') })]
 */
export function shotSink(opts) {
    const route = opts.route ?? '/__shot';
    return both('weft-shot-sink', (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname !== route)
            return next();
        if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
        }
        const name = (url.searchParams.get('name') ?? 'shot').replace(/[^\w.-]/g, '') || 'shot';
        const type = String(req.headers['content-type'] ?? '');
        const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg';
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            mkdirSync(opts.dir, { recursive: true });
            writeFileSync(join(opts.dir, `${name}.${ext}`), Buffer.concat(chunks));
            res.end('ok');
        });
    });
}
/** Where perfBeacon() reports land on a dev or preview server (Boulder's): `/__beacon` JSON, each a line of
 *  `dir`/beacon.jsonl with the time, the user agent and the build (git describe). A report past 1 MB isn't kept.
 *
 *    plugins: [weft(), beaconSink({ dir: resolve(__dirname, '../shots/perf') })]
 */
export function beaconSink(opts) {
    const route = opts.route ?? '/__beacon';
    let build;
    const describe = () => { try {
        return execSync('git describe --always --dirty', { cwd: opts.dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    }
    catch {
        return '';
    } };
    return both('weft-beacon-sink', (req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== route)
            return next();
        if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
        }
        const chunks = [];
        let size = 0;
        req.on('data', (c) => { size += c.length; if (size <= 1 << 20)
            chunks.push(c); });
        req.on('end', () => {
            if (size > 1 << 20) {
                res.statusCode = 413;
                res.end();
                return;
            }
            mkdirSync(opts.dir, { recursive: true });
            const text = Buffer.concat(chunks).toString('utf8');
            let body;
            try {
                body = JSON.parse(text);
            }
            catch {
                body = text.slice(0, 4000);
            }
            build ??= describe();
            appendFileSync(join(opts.dir, opts.file ?? 'beacon.jsonl'), JSON.stringify({ at: new Date().toISOString(), build, ua: req.headers['user-agent'], body }) + '\n');
            res.end('ok');
        });
    });
}
/** A build's early start (Boulder's idea, San Francisco's plugin): index.html itself asks for the files the first view
 *  needs — the R2 map, packs' indexes, the small binaries — before the bundle's even fetched, each kept as its fetch's
 *  promise in window[`global`] (Assets' `early` takes each once), and connects at once to the hosts the R2 map points at
 *  (preconnect), for the first tiles. Dev servers are left alone.
 *
 *    plugins: [weft(), earlyFetch({ files: (has) => ['remote.json', ...has('tiles', /\.json$/), 'trees.bin'] })]
 */
export function earlyFetch(opts) {
    let build = false, root = process.cwd();
    return {
        name: 'weft-early-fetch',
        configResolved(c) { build = c.command === 'build'; root = c.root; },
        transformIndexHtml(html) {
            if (!build)
                return html;
            const assets = resolve(root, opts.assets ?? 'public/assets');
            const has = (dir, re) => {
                const d = resolve(assets, dir);
                return existsSync(d) ? readdirSync(d).filter((f) => !re || re.test(f)).map((f) => `${dir}/${f}`) : [];
            };
            const listed = typeof opts.files === 'function' ? opts.files(has) : opts.files;
            const files = listed.filter((f) => f === 'remote.json' || existsSync(resolve(assets, f)));
            let hosts = [];
            const map = opts.map === undefined ? 'remote-assets.json' : opts.map;
            if (map) {
                try {
                    hosts = [...new Set(Object.values(JSON.parse(readFileSync(resolve(root, map), 'utf8'))).map((u) => new URL(u).origin))];
                }
                catch { /* none */ }
            }
            const g = JSON.stringify(opts.global ?? '__early'), pre = JSON.stringify(opts.prefix ?? 'assets/');
            const code = `(function(){var e=window[${g}]={},f=${JSON.stringify(files)};for(var i=0;i<f.length;i++){e[f[i]]=fetch(${pre}+f[i],f[i]==='remote.json'?{cache:'no-cache'}:{}).catch(function(){return null;});}})();`;
            const tags = [...hosts.map((h) => `<link rel="preconnect" href="${h}" crossorigin />`), `<script>${code}</script>`].join('\n  ');
            return /<meta charset[^>]*>/i.test(html) ? html.replace(/(<meta charset[^>]*>)/i, `$1\n  ${tags}`) : html.replace(/<head>/i, `<head>\n  ${tags}`);
        },
    };
}
//# sourceMappingURL=vite.js.map