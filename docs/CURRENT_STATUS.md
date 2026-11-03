# Current status: planned vs. implemented

Snapshot of AudioBrain **0.3.0** (`package.json`), compiled from the README, the planning docs and the machine-readable ledgers in `contracts/`. Counts come from `contracts/feature-parity.json` and `contracts/operator-catalog.json`. Anything marked *(per docs)* was taken from the README and not re-measured. I did not run the test suite or the app. Where a document says "done", read it as "claimed done".

## Summary

- **Working app:** graph editor, three instrument families with seven playable presets, performance surface, native Web Audio runtime, project import/export, local OSC gateway and VideoBrain scalar pairing.
- **Not yet at parity:** against the original Morphazoid source, only **9 of 51** preservation requirements are `ported`. 27 are `partial` and 15 are `missing`. `check-feature-parity --require-complete all` fails by design.
- **Deployment and CI are out of scope.** The AWS, GitHub workflow and CI publishing material was deprecated and removed from the project.

## Implemented

| Area | What exists |
| --- | --- |
| Shell and graph | Vite/React/TS app, React Flow editor, typed ports, cycle rejection, Zustand store with undo/redo and debounced autosave. Limits: 128 nodes, 512 cables, 64 widgets, 1 MiB import. |
| Operators | 34 registered operators: Shapes (3), L-Systems (4), Graphs (3), voice banks (3), transport/control (4), audio and analysis (8), views (3), and MIDI/OSC/Brain adapters (6). |
| Instruments | Morphazoid Shapes (up to 12 readers; point, line and radar playheads; Synth/Notes/Drums modes), L-Systems and Graphs. Each is an editable top-level graph with source-derived geometry and musical mapping. |
| Presets | 7 playable presets plus a searchable library of 1,479 original Morphazoid records in 126 collections *(per docs)*. All 11 original L-System grammars and 10 graph topologies are "Graph ready". Load/Add/export/import of presets. |
| Performance | Arrange / Perform / fullscreen, pinned parameters and views, independent layout. |
| Audio runtime | Native rack with a 25 ms timer and 100 ms lookahead. Caps of 96 voices globally and 32 per bank. Oscillator, filter, delay, stereo pan, mic input, MIDI input and selected MIDI output, RMS level. |
| Integrations | `brain.control.v1` scalar pairing with VideoBrain, plus a local OSC gateway (`brain-relay` Docker service from the shared `../brain-control` package). |
| Tests | Vitest unit tests (graph, store, runtime, presets, adapters, instruments), Node tests (OSC, parity, presets) and Playwright specs, including offline audio rendering. |
| Docs and tooling | Parity ledger and checker, preset extraction/validation scripts, design survey, Storybook stories. |

## Planned but not implemented

### Source-instrument parity (from the ledger)

| Family | ported | partial | missing | Notable missing items |
| --- | --- | --- | --- | --- |
| Common | 1 | 3 | 0 | |
| Shapes | 8 | 11 | 2 | Solid-form and hyper-form (3D/4D) |
| L-Systems | 0 | 8 | 4 | Envelope, drums, original mic processor, mix |
| Graphs | 0 | 5 | 9 | Patch bank, vertex-switch gestures, attack lanes, motion, **Graph Drums**, **Graph Delay** (topology, input, processing, motion) |

Voice engines do not claim timbral parity with the originals. Many source presets stay marked **Needs features**.

### Platform roadmap (IMPLEMENTATION_PLAN / NODE_CATALOG)

| Planned item | Status |
| --- | --- |
| Nested reusable instrument modules, per-instance vs. shared editing | Not started. Only top-level expanded graphs exist. |
| Arbitrary graph vertex/edge authoring | Not started |
| Additional readers/dimensions, generic XY/action widgets, overlapping-gesture policy | Not started |
| More effects and analyzers (compressor, reverb, EQ, FFT, waveform, onset) | Not started. Only RMS level exists. |
| MIDI learn and MIDI clock | Not started |
| Audio files and recording | Not started |
| Discrete surround (5.1/7.1) and speaker mapping | Not started. Stereo pan only. |
| VideoBrain graph "Control Out" demand root, clock/event sync | Not started. Pairing is limited to scalar literals/controls. |
| Public read-only graph inspection service | Not started |
| Audio over WebRTC, general feedback, third-party plugins | Out of scope for 0.x. Needs a separate contract review. |

### Verification

| Item | Status |
| --- | --- |
| Listening review, physical device/MIDI/mic checks, and surround verification | Not done. Automated checks are hardware-free. |

## Gaps and inconsistencies found

AWS deployment, GitHub workflow and CI material was removed as deprecated. See the changelog at the end.

1. **Stale version text (fixed).** `docs/IMPLEMENTATION_PLAN.md` and `docs/NODE_CATALOG.md` said 0.1 while `package.json` and the README say 0.3.0. Both now say 0.3.
2. **README start instructions are incomplete.** The "Play an instrument" section has no run command. It reads "Runs in Docker", which matches the Docker-only workflow, but the compose command is not stated. `docker-compose.yml` has a `dev` profile (`docker compose --profile dev up audiobrain-dev`).
3. **Parity docs track a newer source commit than the code was ported from.** The ledger audits Morphazoid `769b348`, while the README cites `81d3530`. The ledger notes that the target source files still match the original audit.
4. **Operator catalog shape.** `contracts/operator-catalog.json` has no per-operator `id` or `status` under `operators`. I counted 34 entries but could not confirm names from the JSON alone. The names come from `docs/NODE_CATALOG.md`.

## Suggested next steps

1. Pick the parity families to close next. Graph Drums and Graph Delay (9 missing) and the L-System mic/drums/mix are the largest gaps.
2. Reconcile the remaining commit references across the docs (`769b348` vs. `81d3530`).
3. Run `npm run verify` and the Playwright suite in Docker to confirm the claims above.

## Changelog

- Removed the deprecated AWS deployment, CI and publishing material: `infra/`, the AWS, CloudFront and smoke-test scripts in `scripts/`, `tests/aws-deployment.test.ts` and `docs/DEPLOYMENT.md`. A second pass removed `build:deploy`, `check:storybook-dist` and `scripts/check-storybook-artifact.mjs`, the `build.json` release-identity file, `e2e/storybook.spec.ts` (it tested the published `/storybook/` path), the CI and public-URL settings in `playwright.config.ts`, and the `https://audiobrain.org` origin from the OSC gateway defaults. `Dockerfile.web` now just runs `npm run build` for the local nginx container. Storybook itself (`npm run storybook`, `build:storybook`) stays. The project is a local Docker app, not a remotely deployed web application. References were removed from the README, the architecture, implementation plan, provenance, contracts and integration docs, and the agent instructions.
