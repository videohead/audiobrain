# Shared development with VideoBrain

Where AudioBrain and VideoBrain (`../videobrain`) overlap in code and features, and how to unify them. This is an initial assessment. File sizes and diffs were checked, but the graph and store code were **not** read line by line, so the split between generic and domain-specific code below is still a hypothesis.

## Where to look first

[PROVENANCE.md](PROVENANCE.md) is the best starting point. It is the only record of what AudioBrain adapted from VideoBrain and at which commit (`b7af64b1c1615eb521209b480856bff95b33a71f`). A direct diff of those files against current VideoBrain (0.9.0; AudioBrain is 0.3.0) is the most effective way to find real overlap and drift.

## Overlap by layer

| Layer | Evidence | Overlap |
| --- | --- | --- |
| **Tooling and config** | `tsconfig.app.json` and `.storybook/main.ts` are byte-identical. `eslint.config.js`, `playwright.config.ts`, `vite.config.ts` and `Dockerfile.web` differ by 6–32 lines. Both use React 19, React Flow 12, Zustand 5, Vitest, Storybook and Node 22. | Highest and cheapest to unify. A shared config or toolchain package. |
| **Graph core** | `src/graph/{model,compiler,types}.ts`: 136 / 79 / 59 lines in AudioBrain, 317 / 622 / 244 in VideoBrain. PROVENANCE says AudioBrain's was adapted from VideoBrain's. | Strong, but it is a fork and VideoBrain has since grown. The domain-neutral parts (registry-derived validation, bounded imports, typed cables, topological plan, stable IDs) should extract cleanly. |
| **Project store** | `src/store/projectStore.ts`: 234 lines vs. 476. Covers undo/redo, gesture grouping, versioned autosave and transactional commands. | Same pattern as the graph core. |
| **Control and remote interfaces** | VideoBrain has MIDI input, a Bitfocus Companion bridge and a project-replace bridge (`src/control/`, `src/controlBridge.ts`, `server/`). AudioBrain has `brain.control.v1` window pairing, an OSC gateway and graph-level MIDI. The VideoBrain side of `brain.control.v1` is not in the VideoBrain checkout. | Being extracted into the shared `../brain-control` package. See [CONTROL_EXTRACTION.md](CONTROL_EXTRACTION.md). |

### Other candidates

- **UI components and design tokens.** The node card, parameter control and panels, and the colors and spacing. AudioBrain's `styles.css` is 34 lines and VideoBrain's is 3,726, so AudioBrain must pull its tokens in some other way. Confirm how before extracting anything.
- **CI and deployment: out of scope.** both projects are Docker-only.

### Not to unify

- **Operator catalogs and runtimes.** These are domain-specific: shaders, 3D, video and MCP on one side, audio and instruments on the other.
- **Project document formats.** AudioBrain deliberately keeps them non-interchangeable, with separate `documentType` discriminators. A shared graph core must not change this.

## Recommended order

1. **Tooling.** Low risk. Align the shared configs (`tsconfig`, `eslint`, `vite`, `playwright`, Storybook).
2. **Diff the graph core and store against `b7af64b`.** Separate the generic code from the domain-specific code.
3. **Extract a shared package** for the generic graph and store code, with each app keeping its own operator registry and document type.
4. **Move the `brain.control.v1` schema** into the shared package and have both bridges consume it.
5. **Share UI components and tokens** last, once the package boundary is proven.

## Open questions

- Package mechanism: npm workspace, a separate repo with a published package, or vendored copies with a sync script? There is no monorepo today.
- Versioning: how to version the shared graph core independently of each app's project schema and operator catalog.
- Docker: all builds and tests should run in Docker, so the shared package must work in both apps' images.
- Drift policy: what to do about code that is already forked, and who owns changes to the shared code.

## Next step

Run the diff in step 2 and write the findings to this document as an overlap report.
