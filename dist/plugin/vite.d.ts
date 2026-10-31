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
//# sourceMappingURL=vite.d.ts.map