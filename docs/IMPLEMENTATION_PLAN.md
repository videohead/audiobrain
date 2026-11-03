# Implementation status and plan

Status: AudioBrain 0.3.0 implements the first three instrument flows and a working application. The sequence below is the retained design baseline, with broader acceptance targets that are not all shipped. [README](../README.md) is the current user-facing scope; [provenance](PROVENANCE.md) records actual behavior and limits.

| Slice | Current implementation | Remaining work |
| --- | --- | --- |
| Contract baseline and shell | Production catalog, bounded project schema/compiler, React Flow editor, Zustand history/persistence and shared controls | Public read-only inspection service; broader descriptor negotiation |
| Shapes and Performance | Actual geometry/reader/mapping, native continuous voices, pinning, Arrange/Perform/fullscreen and meter/output | Nested instrument wrapper, additional readers/dimensions, generic XY/action widgets and overlapping-gesture policy |
| L-Systems and Graphs | Source-derived grammar/branches and seeded graph traversal, separate musical mapping/voices, playable presets | Original microphone processor, graph vertex/edge authoring, drums/delay variants and full timbral parity |
| Standard audio and I/O | Oscillator/filter/delay/pan, microphone, MIDI input and selected output, scalar Brain/OSC transport and local OSC gateway | More effects/analyzers, MIDI learn/clock, files/recording, graph runtime outputs in VideoBrain and clock/media transport |
| Modules and surround | Top-level expanded graph documents; stereo panning/output | Nested reusable module schema/editor and discrete speaker/channel mapping |

The initial baseline budgets have been replaced by the actual limits in [Contracts](CONTRACTS.md#clock-and-queue-contract). Steps below remain the roadmap and acceptance design; a feature is complete only where the status table or current README explicitly says so.

## 0. Contract baseline — delivered foundation

Deliver the three flow inventories, types/lifecycles, performance binding design, and preset fixtures. Validate each fixture's declared ports, bounds, graph structure and widget references. Keep open engineering questions explicit: measured event/DSP budget, module extraction seam and cross-app pairing experience.

Exit: the boundaries can represent all three flows without DOM selectors, engine-owned destinations or hidden value coercion. A validated fixture proves design consistency only.

## 1. VideoBrain-derived shell and graph foundation

Create a Vite/React/TypeScript app with the VideoBrain Node 22+ toolchain, React Flow/Zustand, ESLint, Vitest, Playwright and Storybook. Reuse its actual dark tokens, node card and panel conventions. Start from reviewed source/config copies, rename product/storage/build identities, and retain source/provenance notes. Do not copy production role IDs or bulk-copy the full visual application.

Original suggested repository structure (the current layout shares pure helpers in `src/instruments/geometry.ts` and vendored functions in `src/instruments/morphazoid/`):

```text
src/
  graph/                 types, registry, parser, compiler, commands, inspection
  runtime/               host, transport, schedule, resource diff, snapshots
  audio/                 native node backends, worklets, voice adapters
  instruments/
    shapes/              pure math, reader, mapping, module, graphic
    lsystems/            grammar, geometry, frontier, mapping, module, graphic
    graphs/              topology, traversal, mapping, module, graphic
  adapters/              MIDI, OSC gateway, Brain control protocol
  components/            VideoBrain-derived shared production controls/panels
  performance/           bindings, layout editing, performer surface
  store/                 project commands and session store
stories/                 production components and complete teaching graphs
tests/                   compiler/contract/runtime/browser fixtures
public/worklets/          built/loadable worklet assets as appropriate to Vite
server/                  optional local read-only graph inspection adapter
```

The draft catalog has been promoted to the production registry. Future inspection/catalog exports must continue to derive from it. Version project schema independently from operator catalog and inspection API. Implement audio/event/geometry types in validation, compiler, UI, catalog and tests together. Add active audio/view/adapter output roots and budget accounting. Preserve the last valid plan on invalid edits.

Exit: graph import/export, undo/redo, typed connections, inactive branches, unknown-version rejection and catalog inspection work from one model. Stories use production components and no hardware permissions. A failing required input, illegal cycle or mismatched channel/type cannot enter the runtime.

## 2. Shapes vertical slice and performance surface

Extract normalized 2D geometry and reader/mapping helpers from the combined Shapes app. Adapt the voice bank to the host context and output bus. First preserve its continuous four-head behavior with a sine/FM voice; then expose discrete contact/trigger variants. Explicitly preserve head phase and dimension/mode continuity as later dimensions arrive.

Implement host transport, armed audio gate, lookahead scheduler, bounded voices and master panic. Add gain/out and level analysis. Build Morphazoid Shapes from real domain nodes; package the same graph as a fixed instrument module. Pin shape view, sides/curvature, head rate, character and master level into the performance frame.

Ship Graph / Arrange / Perform modes, independent layout coordinates, fullscreen of the complete control frame, stable binding targets and grouped gestures. Extract one reusable parameter renderer so Inspector, node and performance values stay consistent.

Exit: changing curvature visibly changes the shape and audibly changes the mapped voices; another compatible voice bank can replace the first one. Removing/hiding a graphic does not mute or reset sound. Switching edit/perform/fullscreen does not rebuild the context. One gesture creates one undo action; two simultaneous pointers work independently. Opening a preset requests no permission and starts no sound until armed.

## 3. L-Systems and Graphs prove reuse

L-Systems: extract grammar, turtle geometry and frontier; move event generation out of RAF. Retain cumulative-turn pitch, branch power sharing and meaningful growth modes. Host-context injection applies to mic processors as well as synths. Add Morphazoid L-Systems and an explicitly opt-in Mic variation after the synth path passes.

Graphs: use actual Graph Synth topology/traversal/mapping/audio behavior, not Composer's approximate preview under a familiar title. Keep graph data cycles distinct from patch cable cycles. Node/edge edits preserve stable identities. Add Morphazoid Graphs, then drums and Graph Delay as separate processor/voice variants.

Demonstrate cross-instrument reuse: send L-System note events to the Graph or generic poly voice; replace a Shapes contact instrument with a drum bank; attach the same meter and output to each. Module public contracts remain stable while internal implementations differ.

Exit: three presets pass equivalent host-lifecycle tests, event scheduling no longer depends on rendering, and each performance surface controls its actual instrument. Fixed-seed reset reproduces event order. A slow or hidden view does not induce a burst of stale attacks. Compare source and extracted mappings with golden geometry/event traces; perform listening review for timbre and transition identity.

## 4. Standard audio and I/O toolkit; live VideoBrain connection

Complete the Wave C nodes in [Node catalog](NODE_CATALOG.md), including the remaining standard effects, MIDI input/output/learn/clock, OSC gateway nodes, analyzers, files/recording, and channel routing. Each has a complete fallback teaching path and unavailable/error stories.

Version 0.1 implements `brain.control.v1` on both applications using explicitly paired top-level windows and selected scalar mappings. AudioBrain sends runtime graph controls; VideoBrain sends/receives selected saved numeric literals. The remaining extension is a VideoBrain graph Control Out demand root for resolved runtime exports, plus clock/event synchronization. Do not describe the current literal bridge as that runtime extension. Keep the existing framing policy; see [Integration](INTEGRATION.md).

Exit: actual hardware output is distinguishable from preview. Disconnect/reconnect does not hang notes or replay stale controls. Controller feedback does not loop. The browser remains useful without MIDI or a gateway. Two-site control round-trip works under production headers and retains no credentials in exported projects.

## 5. Modules, surround and advanced authoring

Complete public module ports/parameters/views, per-instance versus shared-definition editing, expand-to-nodes migrations and module presets. Add discrete surround routing and an explicit stereo downmix; validate real speaker/channel mapping on a supported interface. Expand remaining Morphazoid modes only with parity evidence. General feedback, audio-over-WebRTC and third-party executable plugins get their own contract review.

Exit: expanding and re-saving a module preserves sound/control behavior and every public performance binding. Multichannel acceptance records browser, interface, channel order and fallback behavior. A hardware-free CI result is not presented as listening or speaker verification.

## Verification strategy

| Layer | Evidence that matters |
| --- | --- |
| Pure math | Deterministic geometry/features; boundary inputs; finite values; dimension/mode continuity; grammar caps |
| Compiler | Required/optional ports, exact family/schema/layout match, roots, inactive nodes, cycles, stable order, resource limits |
| Audio/events | Offline rendering with finite samples and expected silence/onset/release; bounded polyphony; timely note-offs; smoothing; no leaked voices/contexts |
| Scheduler/lifecycle | Tempo changes, seek/reset, late/overflow queues, pause/resume, device loss, patch swap, stale generation cancellation |
| Editor/performance | Same literal/resolved values in all surfaces; pointer and keyboard access; grouped undo; multitouch; resize; fullscreen |
| Integrations | Denied/unsupported/disconnected MIDI/mic; gateway loss; origin/schema/rate rejection; feedback-loop suppression |
| Teaching/UI | Three full presets, reachable branches, saved layouts, help recipes, production Storybook; desktop/phone portrait/landscape |
| Human/device | Listening, controller feel, timbral parity, audible transition review, actual surround map |
| Release | Lint/types/unit/runtime checks, production+MCP+Storybook build, artifact checks, Chromium end-to-end |

Do not report a milestone as complete because a registry entry, mockup or JSON fixture exists. Keep the node implementation status visible until its runtime, teaching path and validation ship together.
