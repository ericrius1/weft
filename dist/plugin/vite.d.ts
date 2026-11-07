import type { Plugin } from 'vite';
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
export declare const PACKAGE = "@ericrius1/weft";
/** this package's own shader library (dist/plugin/vite.js → shaders/) */
export declare const weftShaders: string;
/** a lib given as a package name → its shader directory */
export declare function shaderDir(spec: string, root: string): string;
export declare function weft(opts?: WeftOptions): Plugin;
/** Where a page's film frames land: the dev (and preview) server takes POSTs from a page rendering a film frame by
 *  frame (see Capture) and writes them under `dir`/<name>/ — `/__film/frame?name=&i=` a JPEG as frames/f00012.jpg,
 *  `/__film/audio?name=` a WAV as audio.wav, `/__film/meta?name=` JSON as meta.json. Use a preview server for long
 *  films: a dev server reloads the page when a source file is saved.
 *
 *    plugins: [weft(), filmSink({ dir: resolve(__dirname, '../film') })]
 */
export declare function filmSink(opts: {
    dir: string;
    route?: string;
}): Plugin;
/** The big assets on R2 (San Francisco's and Boulder's): an app's /assets beside it in development, its big files
 *  content-addressed on R2 once published (tools/publish-assets.mjs) and listed in a map, path under /assets → URL.
 *  - dev and preview: an asset that isn't on this disk is redirected to its R2 copy, so a worktree or a fresh clone works
 *    without every file (one that is here is always served from here: edit away). The map is re-read when it changes.
 *  - a build: the map shipped as dist/assets/remote.json (Assets.init reads it), and the files that live only on R2
 *    (`omit`) left out of dist.
 *
 *    plugins: [weft(), remoteAssets({ omit: /^tiles\/.*\.pack$/ })]
 */
export declare function remoteAssets(opts?: {
    /** the assets folder (default public/assets, under the Vite root) */
    assets?: string;
    /** the map (default remote-assets.json beside the Vite config's root) */
    map?: string;
    /** the URL prefix the assets are served under (default '/assets/'; anywhere in the path: a page under a base) */
    prefix?: string;
    /** what a build leaves out of dist (paths under assets): R2 serves it */
    omit?: RegExp | ((rel: string) => boolean);
    /** the shipped map's name under dist/<assets> (default remote.json; null: not shipped) */
    ship?: string | null;
}): Plugin;
/** Where shot() posts its pictures (dev and preview): `/__shot?name=` a JPEG (or PNG, WebP: by its type) written to
 *  `dir`/<name>.jpg.
 *
 *    plugins: [weft(), shotSink({ dir: resolve(__dirname, '../shots') })]
 */
export declare function shotSink(opts: {
    dir: string;
    route?: string;
}): Plugin;
/** Where perfBeacon() reports land on a dev or preview server (Boulder's): `/__beacon` JSON, each a line of
 *  `dir`/beacon.jsonl with the time, the user agent and the build (git describe). A report past 1 MB isn't kept.
 *
 *    plugins: [weft(), beaconSink({ dir: resolve(__dirname, '../shots/perf') })]
 */
export declare function beaconSink(opts: {
    dir: string;
    route?: string;
    file?: string;
}): Plugin;
/** A build's early start (Boulder's idea, San Francisco's plugin): index.html itself asks for the files the first view
 *  needs — the R2 map, packs' indexes, the small binaries — before the bundle's even fetched, each kept as its fetch's
 *  promise in window[`global`] (Assets' `early` takes each once), and connects at once to the hosts the R2 map points at
 *  (preconnect), for the first tiles. Dev servers are left alone.
 *
 *    plugins: [weft(), earlyFetch({ files: (has) => ['remote.json', ...has('tiles', /\.json$/), 'trees.bin'] })]
 */
export declare function earlyFetch(opts: {
    /** the files under assets to fetch early: a list, or a function given `has(dir, re)` (the files in a folder under
     *  assets matching re, as paths) that returns one. remote.json is always asked for fresh (no-cache) */
    files: string[] | ((has: (dir: string, re?: RegExp) => string[]) => string[]);
    /** the assets folder (default public/assets) and the URL path they're served at, relative to the page (default
     *  'assets/') */
    assets?: string;
    prefix?: string;
    /** the R2 map whose hosts are preconnected to (default remote-assets.json; null: none) */
    map?: string | null;
    /** the global the fetches are kept in (default '__early') */
    global?: string;
}): Plugin;
//# sourceMappingURL=vite.d.ts.map