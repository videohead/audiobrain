# AudioBrain

> **Fork notice:** this repository is a fork of [blechdom/audiobrain](https://github.com/blechdom/audiobrain). The original project and its history belong to blechdom; changes here (Dockerized development, shared control layer via [videohead/brain-control](https://github.com/videohead/brain-control)) are maintained separately.

AudioBrain 0.3.0 turns Morphazoid instruments into an editable audio graph and a graphical performance surface. It uses VideoBrain's React, TypeScript, Vite, React Flow and Zustand foundation, with an independent audio runtime and project format.

The application includes **seven playable examples, 34 registered operators and a preserved Morphazoid source preset library**.

## Play an instrument

Use Node.js 22 or newer:
Runs in Docker

Open `http://127.0.0.1:5178`, choose an instrument, enable audio, and press Play. Audio activation and transport are separate controls. Space plays or pauses when focus is outside a control; Escape stops sounding voices. Built-in instruments need no microphone, MIDI device, account or network service.

| Preset | Editable flow | Performance gesture |
| --- | --- | --- |
| **Morphazoid Shapes** | Polygon → phase heads → musical voice targets → continuous sine/FM voices | Point, line and radar playheads; drag heads, scrub, rotate or move the shape; switch Synth / Notes / Drums |
| **Morphazoid L-Systems** | Grammar → branch geometry → frontier encounters → note mapping → polyphonic voices | Drag branch angle; edit grammar, iterations, length, speed and pitch mapping |
| **Morphazoid Graphs** | Seeded topology → route traversal → musical mapping → decaying graph voices | Drag edge timing; change layers, nodes per layer, seed, pitch and decay |

All instrument families reuse gain, output, analysis and performance bindings. They adapt actual Morphazoid geometry and musical mapping; the native AudioBrain voice engine does not claim full timbral parity with the original applications. [Preset details](docs/PRESETS.md) and [source provenance](docs/PROVENANCE.md) explain the boundaries.

The **Presets** button opens all examples, including **Morphazoid Shapes Synth**, **Shapes Notes**, **Shapes Triggers**, and **Shapes Drums**. Load replaces the current project; Add inserts an independent instrument with its own graph, identities, cables and performance controls. Both actions can be undone. New presets start at −6 dB output gain (Notes −3 dB; Drums −9 dB); existing saved gain values are retained.

The same library searches **1,479 original records across 126 collections**: complete patches, grammar/topology components, sound banks, scenes and page defaults. All retain their original names, IDs, source settings and provenance. **Graph ready** currently includes all 11 original L-System grammars and 10 graph topology components, rebuilt into editable nodes and a performance layout. Their preview voices are AudioBrain's; full original instrument patches remain marked **Needs features** until their engines and mappings exist. Every original record can be exported, including those awaiting an adapter.

Use **Presets → Export current as preset** to save your edited graph and performance layout as a portable recipe; **Import preset or project** opens it again. Added instances get fresh object IDs while retaining the original preset identity and source record. See [preset preservation and reconstruction](docs/PRESETS.md).

In Shapes, **Sound mode** switches Synth, Notes and Drums / triggers without rewiring. **Playheads** exposes up to twelve readers, independent directions and positions, line axes, mixed reader types, loop and ping-pong motion. The graphic defaults to direct playhead manipulation: drag inside to scrub or outside to rotate. Move, Rotate and Curvature tools make each action explicit. New curvature defaults to zero.

## Build and perform

Graph mode exposes every instrument's domain nodes. Choose **New instrument** for an empty graph or **Rename instrument** to name the current one; both changes are undoable. Add nodes from the library, connect matching port types, edit inline parameters, and replace a mapping or voice bank. Ordinary cable cycles are rejected; the Delay node contains its own bounded feedback. A connected numeric control overrides the live value while retaining the saved literal, which returns when the cable is removed.

Select a node to name or duplicate it in the Inspector. Its stable ID survives renaming, edits, undo, export and import. A node duplicate has independent parameter values and starts without copied cables; the Presets Add action copies a complete connected instrument.

Pin a parameter or instrument view into Performance. Arrange mode moves and resizes those widgets independently of the graph; Perform locks the layout and can fullscreen the entire control surface. Graphics observe the runtime and send explicit parameter gestures. Hiding or resizing a view does not own the audio clock.

Undo/redo, project naming, JSON import/export and debounced local autosave operate on the same project document. The save indicator reports pending or failed storage writes. Exports include graph, performance layout and any source preset associations, without audio resources, sockets or device permissions. Import accepts schema version 1 of `audiobrain.project` and `audiobrain.instrument-preset`; VideoBrain documents are not interchangeable. A source preset that needs unavailable features is rejected without replacing the current project.

The [authoritative operator catalog](contracts/operator-catalog.json) supplies all parameter and port definitions:

- Morphazoid geometry, traversal and musical mapping nodes; continuous, polyphonic and graph voice banks; three instrument views.
- Transport, Value, Range Map and LFO controls.
- Oscillator, gain, low/high/band-pass filter, delay, stereo pan, microphone input, audio output and RMS level analysis.
- MIDI In/Out, OSC In/Out and Brain Control In/Out adapters.

Microphone and MIDI each require explicit session activation; MIDI output additionally requires a selected output device. OSC uses the optional shared relay in `../brain-control` (`docker compose up brain-relay`). VideoBrain pairing exchanges selected scalar controls: AudioBrain exports evaluated graph controls, while the VideoBrain companion sends and receives selected saved numeric parameter literals. See [integration setup and limitations](docs/INTEGRATION.md).

## Current scope

The three instrument families are editable top-level graphs; full source feature parity remains incomplete. The [feature parity ledger](docs/FEATURE_PARITY.md) inventories original controls and records implemented, partial and missing capabilities with evidence. `npm run check:parity` prevents silently dropping inventory or claiming full parity; `node scripts/check-feature-parity.mjs --require-complete all` intentionally fails until every required capability is restored. Nested reusable modules, arbitrary vertex/edge authoring, Graph Drums, the original L-System microphone processor, audio files/recording, broader analyzers, MIDI learn/clock, discrete surround and cross-app audio streams remain planned. Stereo panning is implemented; it is not a discrete 5.1/7.1 output system. Third-party executable plugin loading is also outside this version.

The native audio rack admits up to 96 simultaneous voices globally and 32 per voice bank. Shapes has at most twelve heads. L-System expansion is limited to 32,768 symbols and 4,096 segments; event batches are limited to 256. All original grammar defaults fit; larger expansions fail explicitly. A 25 ms host timer schedules a 100 ms lookahead onto Web Audio. Views do not schedule sound, but browser background throttling remains a timer-scheduler limitation. Graph documents are bounded to 128 nodes, 512 cables, 64 performance widgets and a 1 MiB JSON import.

## Develop

```sh
npm run verify
npx playwright install chromium
npm run test:e2e
```

`verify` runs lint, type checking, unit/gateway tests, feature and source-preset preservation checks, production preset validation and the app build. Browser coverage includes source preset reconstruction, independent instance identities, export/import, real `OfflineAudioContext` rendering of all three instruments, finite audio, gain response and silence after output disconnection. These checks complement listening and physical-device testing.

Run `npm run storybook` for the production component catalog on port 6006.  `npm run build:storybook` produces a static copy.

## Architecture and source inventory

The [module review table](design_docs/MODULE_LIST.md) lists shipped and candidate modules with descriptions, I/O, controls and sources. The [design docs](design_docs/README.md) collect the full Morphazoid abstraction atlas, page-by-page survey, source registries, current node inventory and adapter design options.

| Document | Contents |
| --- | --- |
| [Morphazoid boundary inventory](docs/MORPHAZOID_BOUNDARIES.md) | Source evidence and proposed UI/math/mapping/audio/device boundaries for all three flows |
| [Architecture](docs/ARCHITECTURE.md) | Current ownership/execution model and planned module/media extensions |
| [I/O contracts](docs/CONTRACTS.md) | Implemented signal subset, parameter arbitration and broader contract design |
| [Performance UI](docs/PERFORMANCE_UI.md) | Current surface behavior and remaining authoring/accessibility design |
| [Node catalog and roadmap](docs/NODE_CATALOG.md) | Implemented inventory plus remaining standard audio/toolkit work |
| [Implementation status and plan](docs/IMPLEMENTATION_PLAN.md) | Delivery status and the original ordered implementation sequence |
| [Live integrations](docs/INTEGRATION.md) | VideoBrain pairing, direction/authority and local OSC gateway |
| [Provenance](docs/PROVENANCE.md) | Source commits, adapted code, retained licenses and parity limits |

Source baselines: VideoBrain `b7af64b1c1615eb521209b480856bff95b33a71f` and Morphazoid `81d3530e80403976880f7161555820496c4e382e`. Source-audit links point to those fixed GitHub revisions. Runtime dependencies are contained in this repository.
