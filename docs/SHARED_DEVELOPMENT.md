# Shared development with VideoBrain

Where AudioBrain and VideoBrain (`../videobrain`) overlap in code and features, and how to unify them. This is an initial assessment. File sizes and diffs were checked, but the graph and store code were **not** read line by line, so the split between generic and domain-specific code below is still a hypothesis.

## Where to look first

[PROVENANCE.md](PROVENANCE.md) is the best starting point. It is the only record of what AudioBrain adapted from VideoBrain and at which commit (`b7af64b1c1615eb521209b480856bff95b33a71f`). A direct diff of those files against current VideoBrain (0.9.0; AudioBrain is 0.3.0) is the most effective way to find real overlap and drift.

## Overlap by layer

| Layer | Evidence | Overlap |
| --- | --- | --- |
| **Tooling and config** | **Conformed** (see [Tooling status](#tooling-status)). Both use React 19, React Flow 12, Zustand 5, Vitest, Storybook, Vite 8.2.2 and Node 22. | Done by making the files match. A shared toolchain package is still possible but no longer urgent. |
| **Graph core** | `src/graph/{model,compiler,types}.ts`: `model` / `compiler` / `types` now 152 / 63 / 62 lines in AudioBrain and 194 / 308 / 212 in VideoBrain, after stages 1 and 4. PROVENANCE says AudioBrain's was adapted from VideoBrain's. | **Read in full: they are independent implementations, not drifted copies.** The pure algorithms, parameter vocabulary, issue codes, validation primitives and error wording are now shared (`@brain/control/graph/*`). Different document formats, parameter vocabularies, issue codes and error messages. Only a few pure algorithms are shared as-is (topological order, reachability, cycle test). Alignment is a design task. See [GRAPH_STORE_ALIGNMENT.md](GRAPH_STORE_ALIGNMENT.md). |
| **Project store** | `src/store/projectStore.ts`: 225 lines vs. 421 (plus VideoBrain's 98-line `persistence.ts`), after stages 2 and 3. Now built on the shared history and autosave engines, with AudioBrain using VideoBrain's command names. Covers undo/redo, gesture grouping, debounced autosave and transactional commands. | **Same pattern, now sharing code.** The history engine and autosave scheduler are shared. The parameter vocabulary and issue codes are shared too (stage 4). See [GRAPH_STORE_ALIGNMENT.md](GRAPH_STORE_ALIGNMENT.md). |
| **Control and remote interfaces** | VideoBrain has MIDI input, a Bitfocus Companion bridge and a project-replace bridge (`src/control/`, `src/controlBridge.ts`, `server/`). AudioBrain has `brain.control.v1` window pairing, an OSC gateway and graph-level MIDI. The VideoBrain side of `brain.control.v1` is not in the VideoBrain checkout. | Being extracted into the shared `../brain-control` package. See [CONTROL_EXTRACTION.md](CONTROL_EXTRACTION.md). |

### Other candidates

- **UI components and design tokens.** The node card, parameter control and panels, and the colors and spacing. AudioBrain's `styles.css` is 34 lines and VideoBrain's is 3,726, so AudioBrain must pull its tokens in some other way. Confirm how before extracting anything.
- **CI and deployment: out of scope.** both projects are Docker-only.

### Not to unify

- **Operator catalogs and runtimes.** These are domain-specific: shaders, 3D, video and MCP on one side, audio and instruments on the other.
- **Project document formats.** AudioBrain deliberately keeps them non-interchangeable, with separate `documentType` discriminators. A shared graph core must not change this.

## Recommended order

1. **Tooling.** Done. See [Tooling status](#tooling-status).
2. **Separate the generic code from the domain-specific code.** Done as a full read of both. All four alignment stages and the follow-up decisions (unified gesture and no-op semantics, one command return and error model, shared preset-validation wording) are built. See [GRAPH_STORE_ALIGNMENT.md](GRAPH_STORE_ALIGNMENT.md).
3. **Extract shared code** for the generic graph and store logic, with each app keeping its own operator registry and document type. Done for algorithms and store engines, inside `brain-control` by decision.
4. **Move the `brain.control.v1` schema** into the shared package and have both bridges consume it.
5. **Share UI components and tokens** last, once the package boundary is proven.

## Tooling status

The shared configs were conformed so a change to one can be copied to the other. What remains different is deliberate.

| File | Result |
| --- | --- |
| `tsconfig.json`, `tsconfig.app.json`, `tsconfig.storybook.json`, `.storybook/main.ts` | Already identical. |
| `eslint.config.js` | Identical. AudioBrain's extra `server/**/*.ts` glob matched no files (its server code is `.mjs` and has moved to `brain-control`), so it was dropped. |
| `tsconfig.node.json` | Identical. Both now declare `"types": ["node"]` explicitly. |
| `playwright.config.ts` | Identical except `const port` (AudioBrain 5178, VideoBrain 4173, so both can run at once). Both use `npm run preview`, `reuseExistingServer: false` and the same structure. VideoBrain's `preview` script is now pinned to `--host 127.0.0.1 --port 4173 --strictPort`, as AudioBrain's already was. |
| `vite.config.ts` | Same plugins, `server.fs.allow` and `build` options. VideoBrain's explicit `minify: 'esbuild'` (which relied on a package neither app declares) and its no-op `rollupOptions.external: []` were removed, so both use Vite's built-in minifier. VideoBrain's JavaScript bundle went from 3,640,539 to 3,563,046 bytes. **Still different on purpose:** AudioBrain defines `__APP_VERSION__` and `__COMMIT_SHA__` because its UI shows them. VideoBrain's does not. |
| `.dockerignore` | VideoBrain had none. It now has AudioBrain's list plus Python cache files. Before this, `COPY . .` in `Dockerfile.web` copied the host's `node_modules` and `.env` (which holds `VIDEOBRAIN_CONTROL_API_KEY`) into the build stage. A check of the rebuilt image finds no `.env`. |
| `.gitignore` | AudioBrain gained `.vitest/`. The rest differs because VideoBrain has a Python `mcp/` directory. |
| `Dockerfile.web` | **Different on purpose.** VideoBrain builds with `--base=/videobrain/` and a control-bridge build argument for its Traefik routing at `videohead.duckdns.org`. |
| `.storybook/preview.tsx` | **Different on purpose.** App-specific wrapper class names and VideoBrain's `preview.css`. |
| Dev server port | **Different on purpose.** AudioBrain pins `dev` to 5178; VideoBrain's `dev` is Vite's default. |

**Checked after the change (Docker).** AudioBrain: typecheck, lint, 140 tests and the build pass, and the Playwright config loads (19 tests listed). VideoBrain: typecheck passes; lint (29 problems) and tests (1,205 pass, 1 fail) are identical to before, the build passes, and the Playwright config loads (76 tests listed). **Not run:** the Playwright e2e suites themselves, so the port and preview changes are untested end to end.

## Open questions

- Package mechanism: npm workspace, a separate repo with a published package, or vendored copies with a sync script? There is no monorepo today.
- Versioning: how to version the shared graph core independently of each app's project schema and operator catalog.
- Docker: all builds and tests should run in Docker, so the shared package must work in both apps' images.
- Drift policy: what to do about code that is already forked, and who owns changes to the shared code.

## Next step

Run the diff in step 2 and write the findings to this document as an overlap report.
