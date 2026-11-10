# Agents in this repo

**Using weft, loom or cast from a project?** Read [`packages/weft/AGENTS.md`](packages/weft/AGENTS.md). It ships in
the package as `node_modules/@ericrius1/weft/AGENTS.md`.

**Working on the engine itself:**

- `packages/weft` is the kit (`src/`), its shader library (`shaders/`) and the Vite plugin and WGSL compiler
  (`plugin/`). `packages/loom` is the renderer (`src/`, with its shaders in `src/shaders/`). `packages/cast` is the
  character runtime. `examples/lab` holds the pages that exercise them (`npm run dev`; `WEFT_SRC=1` runs them on the
  kit's source).
- Build with `npm run build`. Test with `npm test -w @ericrius1/weft` and `npm test -w @ericrius1/cast`. CI runs both
  before it writes the dist branches.
- A change ships when it's pushed to `main`. `.github/workflows/dist.yml` commits each package to `dist/weft`,
  `dist/loom` and `dist/cast`, and every project's `tools/engine-latest.mjs` picks the change up on its next dev
  server or build. So test what you push, bump the package's `version`, and add an entry to its `CHANGELOG.md`.
- Something several projects carry their own copy of belongs in a package, with nothing project-specific in it (the
  READMEs name no projects).
- When you change the API, update `packages/weft/AGENTS.md` in the same commit.
- Keep files LF. On this Windows checkout, `core.autocrlf` is on, and a file written with CRLF has slipped through
  before.
