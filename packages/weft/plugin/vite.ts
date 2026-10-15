// Vite plugin: `import shader from './thing.wgsl'` → a weft Shader (code + reflection), with hot reload.
// Each shader module self-accepts; weft's runtime registry updates the shader object in place, and the kit rebuilds
// only the pipelines made from it, so simulations keep running through a shader edit. Editing an included file updates
// every shader that includes it.
//
//   import { weft } from '@ericrius1/weft/vite';
//   export default defineConfig({ plugins: [weft({ libs: { loom: '@ericrius1/loom' } })] });
//
// `#include "weft/…"` always resolves to this package's shader library; `libs` adds more prefixes, each a directory or
// a package name (its shader directory is the package.json's `weft.shaders` field, else `shaders/`).
import type { Plugin, ModuleNode } from 'vite';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compileWgsl, writeDeclaration, type CompiledShader } from './wgsl.js';

export interface WeftOptions {
  /** prefix → a directory, or a package whose shaders `#include "prefix/…"` reaches (e.g. { loom: '@ericrius1/loom' }) */
  libs?: Record<string, string>;
  /** the module the generated shader modules import `defineShader` from (default: this package's runtime) */
  runtime?: string;
  /** module specifier the generated .d.wgsl.ts files import types from (default '@ericrius1/weft') */
  typesFrom?: string;
  /** write .d.wgsl.ts declarations next to the app's shaders (default true; never inside node_modules) */
  types?: boolean;
}

export const PACKAGE = '@ericrius1/weft';
/** this package's own shader library (dist/plugin/vite.js → shaders/) */
export const weftShaders = resolve(dirname(fileURLToPath(import.meta.url)), '../../shaders');

/** a lib given as a package name → its shader directory */
export function shaderDir(spec: string, root: string): string {
  if (isAbsolute(spec)) return spec;
  const req = createRequire(join(root, 'package.json'));
  const pkgJson = req.resolve(`${spec}/package.json`);
  const pkg = JSON.parse(readFileSync(pkgJson, 'utf8')) as { weft?: { shaders?: string } };
  return resolve(dirname(pkgJson), pkg.weft?.shaders ?? 'shaders');
}

const SKIP = new Set(['node_modules', 'dist', '.git', '.vercel', 'public', 'shots', '.data']);
function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (name.endsWith('.wgsl')) yield p;
  }
}

export function weft(opts: WeftOptions = {}): Plugin {
  let root = process.cwd();
  let isBuild = false;
  let libs: Record<string, string> = { weft: weftShaders };
  const includers = new Map<string, Set<string>>();
  const typesFrom = opts.typesFrom ?? PACKAGE;
  const runtime = opts.runtime ?? `${PACKAGE}/runtime`;
  const compile = (file: string) => compileWgsl(file, { root, libs });
  const declare = (file: string, s: CompiledShader) => {
    if (opts.types === false || file.includes('/node_modules/')) return;
    writeDeclaration(file, s, typesFrom);
  };
  const moduleCode = (s: Omit<CompiledShader, 'includes'> & { error?: string }) =>
    `import { defineShader } from ${JSON.stringify(runtime)};\n` +
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
      for (const [k, v] of Object.entries(opts.libs ?? {})) libs[k] = shaderDir(v, root);
    },
    buildStart() {
      if (opts.types === false) return;
      for (const f of walk(root)) {
        try { declare(f, compile(f)); } catch { /* reported when imported */ }
      }
    },
    load(id) {
      const [file, query] = id.split('?');
      if (!file.endsWith('.wgsl') || (query && /raw|url/.test(query))) return null;
      try {
        const s = compile(file);
        for (const inc of s.includes) {
          this.addWatchFile(inc);
          let set = includers.get(inc);
          if (!set) includers.set(inc, (set = new Set()));
          set.add(file);
        }
        declare(file, s);
        const { includes: _i, ...rest } = s;
        return moduleCode(rest);
      } catch (e) {
        const msg = (e as Error).message;
        if (isBuild) this.error(msg);
        this.warn(msg);
        const id0 = file.startsWith(root) ? file.slice(root.length + 1) : file;
        return moduleCode({ id: id0, label: id0.split('/').pop()!, code: '', files: [id0], runs: [], error: msg,
          reflect: { structs: {}, bindings: {}, entries: [], overrides: {} } });
      }
    },
    handleHotUpdate(ctx) {
      if (!ctx.file.endsWith('.wgsl')) return;
      const mods = new Set<ModuleNode>(ctx.modules);
      for (const entry of includers.get(ctx.file) ?? []) {
        for (const m of ctx.server.moduleGraph.getModulesByFile(entry) ?? []) mods.add(m);
      }
      return [...mods];
    },
  };
}
