import { readdirSync, statSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
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
                for (const inc of s.includes) {
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
//# sourceMappingURL=vite.js.map