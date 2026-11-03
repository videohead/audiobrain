# Control extraction plan: shared MIDI, Companion and WebSocket control

**Status (2026-11-03):** steps 1 to 6 are done in code, plus mapping-file import/export. **The controller UI is incomplete** and step 7 (shared UI) is deferred, because centralized control and remote learn need research first. See [`brain-control/docs/CENTRAL_CONTROL.md`](../../brain-control/docs/CENTRAL_CONTROL.md). See [Progress](#progress).

Plan for extracting VideoBrain's controller code into a reusable package that AudioBrain can also use. **Nothing has been moved yet.** This document fixes the interfaces and the order of work first. It is based on reading the code in both repos, but no extracted code has been run.

## Goals and non-goals

**Goals**
- One implementation of MIDI input, learn, Companion/WebSocket control and the relay server, used by both apps.
- Each app keeps its own meaning for a control event (VideoBrain parameter mappings, AudioBrain graph nodes and runtime).
- Everything builds and runs in Docker.

**Non-goals**
- A third user-facing application sitting between the two apps.
- Merging the two apps' project formats or operator catalogs (see [SHARED_DEVELOPMENT.md](SHARED_DEVELOPMENT.md)).
- Moving VideoBrain's whole-project replace/read bridge (`/api/graph`, `request-state` / `apply`). It is VideoBrain-specific.

## What exists today

### VideoBrain (`../videobrain`)

| File | Role | Coupling |
| --- | --- | --- |
| `src/control/controller.ts` (266 lines) | Singleton: mapping persistence, arm/disarm, MIDI enable/learn/dispatch, Companion WebSocket client, 30 Hz value coalescing, gesture grouping, 10 s press leases | Imports `projectStore`. Generic logic and store calls are interleaved. |
| `src/control/actions.ts` (111) | Executes `parameter` / `source` / `transport` actions with validation, held-parameter restore on release | Imports `OPERATOR_REGISTRY` and the store type. **Host-specific.** |
| `src/components/ControllerDialog.tsx` (102) | UI for mappings, learn, arm, Companion connect | Reads `controller.snapshot()`. |
| `server/companion-control.mjs` (109) | Authenticated WebSocket at `/control-ws` plus `POST /api/control`: API key, origin allowlist, 60 req/s limit, request-ID idempotency, ack with timeout, heartbeat | Not coupled to VideoBrain. **Generic.** |
| `server/control-server.mjs` (184) | HTTP host that attaches the Companion handler and the legacy `/api/graph` project bridge | Graph bridge is VideoBrain-specific. |
| `src/controlBridge.ts` (77) | Browser client for the legacy project bridge (`request-state`, `apply`) | **VideoBrain-specific. Out of scope.** |

### AudioBrain (this repo)

| File | Role |
| --- | --- |
| `src/adapters/brainBridge.ts` | `brain.control.v1`: `postMessage` pairing between two windows, with handshake, nonce, sequence numbers and limits. Its VideoBrain counterpart is **not in the VideoBrain checkout**. |
| `src/adapters/oscGateway.ts`, `server/osc-gateway.mjs` | `audiobrain.osc.v1`: JSON over WebSocket to a local UDP gateway. Scalar float only. |
| `src/adapters/runtimeControls.ts` | Binds `io.brain.*` / `io.osc.*` graph nodes to a runtime. |
| `src/runtime/AudioBrainRuntime.ts` | Owns Web MIDI input and output, held-note ownership and per-device control ownership. MIDI is a graph node, not a mapping layer. |

### Four separate protocols

These are easy to conflate, so they are listed separately.

| Name | Transport | Used for |
| --- | --- | --- |
| `brain.control.v1` | `window.postMessage`, exact origin, nonce | App-to-app scalar control between two open windows |
| Companion control (unnamed) | WebSocket `/control-ws` plus HTTP `/api/control` | Bitfocus Companion and other external controllers driving a browser tab |
| `audiobrain.osc.v1` | JSON over WSS to a local gateway | OSC in and out |
| VideoBrain graph bridge (unnamed) | WebSocket `/ws` plus `/api/graph` | Reading and replacing a whole project |

## Proposed design

### Package: `brain-control`

A new sibling directory `/home/videohead/www/brain-control/`, a TypeScript package with Node-side modules, both apps consuming it. Layout:

```text
brain-control/
  src/
    protocol/       event and message types, limits, validators (no DOM, no Node APIs)
      events.ts       ControlEvent, ControlTarget IDs
      companion.ts    authenticate / ready / control / ack / heartbeat messages
      brain.ts        brain.control.v1 messages (moved from AudioBrain)
      osc.ts          OSC JSON contract (moved from AudioBrain)
    midi/           decodeMidi, MidiInputManager (enable, devices, learn, teardown)
    transport/      CompanionClient (WS), validateBridgeUrl, BrainWindowBridge, OscGatewayClient
    mapping/        mapping-envelope schema, persistence helpers, limits (128 mappings, unique IDs)
    host.ts         the ControlHost interface (below)
    controller.ts   createController(host, options): arm, learn, coalescing, leases, gestures
  server/           relay: companion control, OSC gateway (UDP), shared auth/rate-limit
  test/
```

### The host interface

The controller owns everything generic. The app supplies only what is specific:

```ts
interface ControlHost<Action> {
  /** Throw if the action is invalid for the current project. */
  validate(action: Action): void;
  /** Apply one event. `id` is stable per mapping + origin, for held state. */
  execute(id: string, action: Action, event: ControlEvent): void;
  /** Release anything held for `id` (momentary controls, notes). */
  release(id: string): void;
  releaseAll(): void;
  /** Undo grouping for continuous gestures. */
  beginGesture(): void;
  endGesture(): void;
  /** Fires when the project structurally changes, so mappings disarm. */
  onTargetsChanged(listener: () => void): () => void;
  parseAction(value: unknown): Action;
}
```

- **VideoBrain** implements `ControlHost<VideoControlAction>` by wrapping `createControlActions` and `projectStore`. `actions.ts` stays in VideoBrain.
- **AudioBrain** implements it against `AudioBrainRuntime` and its graph. Its actions would be parameter and transport actions at first, plus triggers and notes later. Whether AudioBrain should add a mapping layer on top of its existing `io.midi.*` nodes is an open question (below).

`ControlEvent` stays `value` (0..1), `press` or `release`, as it is today.

### Relay server

- `companion-control` moves unchanged, with its tests, into `brain-control/server/`.
- AudioBrain's OSC gateway moves in next to it so both share auth, origin and rate-limit code.
- VideoBrain's `control-server.mjs` keeps the legacy `/api/graph` bridge and imports `attachCompanionControl` from the package.
- A single Docker image runs the relay for both apps, with one set of ports and one `CONTROL_API_KEY`.

### Protocol naming

- Keep `brain.control.v1` as the name for the app-to-app window protocol and move its code unchanged.
- Give the Companion messages a name so they can be versioned: for example `brain.remote.v1`. Today they are unversioned `type` strings. Naming them is a protocol change, so it needs its own decision.

## Order of work

Each step leaves both apps working and their tests green.

1. **Codecs and validators.** Create the package skeleton. Move `decodeMidi`, `validateBridgeUrl`, the Companion message validators and the OSC and Brain message validators. Both apps import them. Behavior is unchanged.
2. **Relay server.** Move `companion-control.mjs` and its tests, then the OSC gateway. Add the shared Docker image and compose file. VideoBrain and AudioBrain point at it.
3. **MIDI manager.** Extract the enable, device refresh, generation guard and teardown logic out of `controller.ts` into `MidiInputManager`. VideoBrain uses it first. AudioBrain's runtime can adopt it later for input only.
4. **Companion client.** Extract the WebSocket client with authenticate, heartbeat and ack out of `controller.ts`.
5. **Controller core and `ControlHost`.** Extract mapping persistence, arm/disarm, learn, 30 Hz coalescing, leases and gestures. VideoBrain's `controller.ts` shrinks to a host adapter, and `actions.ts` is unchanged.
6. **AudioBrain adoption.** Implement `ControlHost` for AudioBrain, add a Controllers dialog (reusing the shared UI state shape), and decide how it relates to `io.midi.*` nodes.
7. **Shared UI.** Only after step 6, consider sharing the `ControllerDialog` component. It depends on both apps' design systems, so it comes last.

VideoBrain behavior must be checked against its current tests (`controller.test.ts`, `actions.test.ts`, `companion-control.test.mjs`) after each step.

## Docker and packaging

Both apps build with `context: .` (their own directory), so a sibling package is **not visible** inside their image builds. The options:

| Option | Notes |
| --- | --- |
| **BuildKit additional contexts** (recommended) | `additional_contexts: brain-control: ../brain-control` in each compose file, then `COPY --from=brain-control . /brain-control` and a `file:` dependency. Needs no change to the build contexts. |
| Move the build context to `/home/videohead/www` | Works, but changes every Dockerfile and `.dockerignore`. |
| Vendor copies with a sync script | Simple, but reintroduces the drift this work is meant to remove. |

Development containers would also mount `../brain-control` as a volume so edits show up in both apps. No installs on the host.

## Risks and open questions

- **Behavior drift in VideoBrain.** `controller.ts` interleaves generic and store-specific logic, so the step 5 split needs care. The existing tests are small (24 lines for `controller.ts`), so I'd add tests for coalescing, leases and gesture grouping before moving them.
- **Release on disconnect semantics.** VideoBrain releases held controls on blur, device removal and graph change. The shared controller must keep those hooks, and AudioBrain must provide equivalents.
- **AudioBrain MIDI model.** AudioBrain treats MIDI as graph nodes (`io.midi.in` and `out`), with its own held-note and per-device ownership. Should a mapping layer sit on top of it, or should only the input manager be shared? My view: share the input manager, and add mappings only for parameters and transport, leaving MIDI nodes as they are.
- **`brain.control.v1` counterpart.** The VideoBrain side of the window pairing is missing from this checkout. Confirm whether it exists on another branch before planning how both sides share one implementation.
- **Companion protocol versioning.** Whether to name and version it (see above) before extracting it.
- **TypeScript on the server.** The relay is plain `.mjs` today. The package can compile to JS, or keep the server modules as `.mjs` with `.d.ts` files.
- **Security.** The Companion path has an API key, origin allowlist, rate limit and request-ID idempotency. These must move intact, with their tests. The shared relay should also stay loopback-bound by default, matching the current OSC gateway.
- **OSC scope.** AudioBrain's gateway is scalar float only. VideoBrain's planned OSC needs may be wider. Settle this before moving it into a shared server.

## Decisions (made)

1. **Package:** `/home/videohead/www/brain-control/`, packaged with BuildKit `additional_contexts`.
2. **Companion protocol:** named and versioned now as `brain.remote.v1`.
3. **OSC gateway:** moves into the shared relay now, in step 2.

## Progress

### Done: steps 1 and 2

**Package `../brain-control` (`@brain/control` 0.1.0)**

| Path | Contents |
| --- | --- |
| `src/protocol/brain.ts` | `brain.control.v1`, moved unchanged from AudioBrain |
| `src/protocol/osc.ts` | OSC JSON contract and browser client, moved unchanged from AudioBrain |
| `src/protocol/remote.ts` | **New:** `brain.remote.v1` message types, `encodeRemote` / `parseRemote`, limits |
| `src/protocol/events.ts` | **New:** host-neutral `ControlEvent` and `isControlEvent` |
| `src/midi/decode.ts` | `decodeMidi`, moved from VideoBrain |
| `src/transport/url.ts` | `validateBridgeUrl`, moved from VideoBrain |
| `server/companion-control.mjs` | Companion relay, moved from VideoBrain, now speaks `brain.remote.v1` |
| `server/osc-gateway.mjs` | OSC gateway, moved from AudioBrain, default origins loopback only |
| `server/relay.mjs` | **New:** one process: OSC gateway always, Companion control when `CONTROL_API_KEY` is set |
| `Dockerfile.relay`, `docker-compose.yml` | Service `brain-relay` (ports 8787, 9001/udp and 8934 for Companion, all loopback) and a `test` profile |

**`brain.remote.v1` rules.** Senders stamp `protocol: "brain.remote.v1"` on every message. Receivers accept a missing `protocol` field, so existing Companion HTTP actions keep working, and reject any other value (WebSocket closes with 1008, HTTP returns 400). Server responses now include `protocol`.

**AudioBrain.** `src/adapters/brainBridge.ts` and `oscGateway.ts` are now one-line re-exports of the package, so no call site changed. `server/osc-gateway.mjs`, `Dockerfile.osc` and the `osc:gateway` script are gone. Its compose file `include`s the relay. The unused `ws` dependency was removed, and `tests/tsconfig.json` was deleted because no `.ts` tests remained there.

**VideoBrain.** `controller.ts` imports `decodeMidi`, `validateBridgeUrl` and `encodeRemote` from the package and still re-exports the first two, so its tests are unchanged. `actions.ts` takes `ControlEvent` from the package. `control-server.mjs` imports the Companion server from the package. `server/companion-control.mjs` and its test were deleted (moved).

**Packaging.** Each app depends on `"@brain/control": "file:../brain-control"`. Dockerfiles `COPY --from=brain-control . /brain-control` before `npm ci`, and the compose files declare `additional_contexts: brain-control: ../brain-control`. Dev services also mount `../brain-control:/brain-control`. Vite's `server.fs.allow` includes the linked path. `Dockerfile.control` also runs `npm ci --omit=dev` inside `/brain-control` so the relay finds `ws`.

**Verified, all in Docker**

| Check | Result |
| --- | --- |
| `brain-control`: typecheck, 16 Vitest tests, 3 Node tests | Pass |
| AudioBrain: lint, typecheck, 114 Vitest tests, feature-parity check, production build | Pass |
| VideoBrain: 1,157 tests pass, 1 fails (`projectStore.test.ts`); lint reports 29 problems | **Identical on a clean checkout of HEAD**, so not caused by this change |
| VideoBrain control image: status endpoint, unsupported version returns 400, legacy message accepted | Pass |
| Shared relay image: starts OSC gateway and Companion endpoint | Pass |

**Not verified:** the Playwright e2e suites, a live Companion install, a real browser tab connecting through the relay, and real UDP/OSC against an instrument.

**Moved with the code:** AudioBrain's `brainBridge` and `oscGateway` Vitest tests, AudioBrain's OSC gateway Node test and VideoBrain's Companion Node test now live in `brain-control`. The Companion test gained protocol assertions.

### Done: steps 3 and 4

Each extraction was preceded by characterization tests written against VideoBrain's *existing* `controller.ts`, run green first and kept unchanged through the refactor.

| New test file (VideoBrain) | Tests | Pins down |
| --- | --- | --- |
| `src/control/controller.midi.test.ts` | 15 | Enable/disable, unavailable Web MIDI, generation guard, hot-plug, learn and persistence, disarmed rejection, device/channel/number filtering, 33 ms CC coalescing, one undo step per burst, momentary hold/release, release on device loss, disarm and disable, 10 s press lease, disarm on structural graph change |
| `src/control/controller.companion.test.ts` | 14 | URL and key validation, versioned authenticate, Connecting/Connected, 3 s heartbeat, connection error and server close, replacing a connection and ignoring the stale socket, execute-and-ack, disarmed / unknown mapping / out-of-range failures, malformed input, release on close, 10 s lease |

**Step 3, MIDI manager.** `brain-control/src/midi/manager.ts` (`createMidiInputManager`) owns permission, device refresh, per-input listeners, the generation guard and teardown. It reports through callbacks (`onMessage`, `onDevices`, `onState`, `onDeviceLost`, `onError`) and never asks for SysEx. 11 package tests.

**Step 4, Companion client.** `brain-control/src/transport/companion-client.ts` (`createCompanionClient`) owns URL and key validation, authenticate, heartbeat, parsing, acknowledgement and stale-socket handling, speaking `brain.remote.v1`. The host supplies `onControl` and throws to reject. 9 package tests.

`controller.ts` in VideoBrain now builds both with small host callbacks and went from 266 to 196 lines. Its public API is unchanged.

**One deliberate behavior difference:** incoming Companion messages are now parsed with the shared `parseRemote`, which also enforces the 4 KiB limit in UTF-8 bytes and valid request/mapping IDs. A control message with a valid request ID but an invalid event is still acknowledged as failed, so the relay never waits for its timeout. A message with an invalid request ID is now ignored. The relay already validates these before forwarding, so this should not be reachable in practice.

**Also verified:** the VideoBrain web and control images build end to end (including `vite build`) with the linked package. After the mapping-file work: VideoBrain 1,204 tests pass and 1 fails (the old `projectStore.test.ts` failure), typecheck and lint of the changed files are clean; `brain-control` 66 Vitest tests and 3 Node tests pass; AudioBrain lint, typecheck and 114 tests still pass.

### Done: mapping files (JSON import and export)

Added at the request that MIDI, OSC and Bitfocus mappings be importable and exportable as JSON in a format other programs and hardware can work with. The full specification is [`../../brain-control/docs/MAPPING_FORMAT.md`](../../brain-control/docs/MAPPING_FORMAT.md).

**Honest scope of "interchangeable".** No common mapping standard exists for MIDI or OSC, and Companion's export is a whole-installation config. So the deliverable is one documented format (`brain.mappings` v1, published JSON Schema, standard protocol vocabulary) plus one-way exports to interfaces that do exist: an OSCQuery namespace and an HTTP request list for Companion. MIDI hardware itself does not import JSON.

| Piece | Where |
| --- | --- |
| Document types, parser, serializer, JSON Schema | `brain-control/src/mapping/document.ts`, `schema/brain.mappings.v1.schema.json` |
| OSCQuery and request-list exports | `brain-control/src/mapping/interop.ts` |
| VideoBrain conversion, validation and device-name resolution | `videobrain/src/control/mappingFile.ts` |
| VideoBrain API | `controller.exportMappings()`, `controller.importMappings(text)`, `controller.exportRemoteRequests(baseUrl)` |
| VideoBrain UI | Export mappings, Import mappings and Companion requests buttons in the Controllers dialog |

Behavior changes in VideoBrain: a learned MIDI binding now also records the device **name** (`deviceName`), a binding may carry an OSC address (saved, shown and exported, but not yet received), and a binding with a name and no ID matches any connected input of that name.

**Tests added:** 30 in `brain-control` (round trip, 20 rejection cases, schema agreement, OSCQuery, request list, prototype-pollution guard), 13 in `controller.mappings.test.ts` (round trip, merge, atomic failure, 128 cap, device-name resolution including a device plugged in after import, persistence) and 5 in `ControllerDialog.test.tsx` (download, import, errors, oversize file, OSC display).

**Not verified:** consumption by any third-party program, an OSCQuery client, a Companion install, or real hardware.

**Not done:** AudioBrain has no mappings layer yet, so it neither imports nor exports these files (planned with step 6), and VideoBrain does not receive OSC.

### Done: step 5, controller core

`@brain/control/controller` exports `createController(host, options)`. It owns state and persistence (versioned, 128 mappings, 128 KiB cap), arm/disarm, learn, MIDI and Companion wiring, 33 ms value coalescing, undo-gesture bracketing, 10 s press leases, release on device loss, blur and disarm, name-based device matching, and mapping-file import and export.

**The `ControlHost` interface as built** (it differs from the sketch earlier in this document, which is superseded):

| Member | Purpose |
| --- | --- |
| `parseAction(value)` | Validate and rebuild an action from saved settings or a file. |
| `execute(key, action, event)`, `release(key)`, `releaseAll()` | Apply an event, or release a hold. `key` is `origin:mappingId`. |
| `takesValue(action)` | Whether continuous values set the target directly. If not, a CC becomes press/release at 0.5. |
| `beginGesture()`, `endGesture()` | Bracket a burst of values as one undo step. |
| `onTargetsChanged(listener)` | Tell the controller the graph structure changed, so it disarms. |
| `eventsFor(action)` | Which relay events an action responds to, for request lists. |

Options: `storageKey`, `app` (written into exported files) and an optional `storage`.

**VideoBrain.** `controller.ts` is now a 39-line host adapter (down from 266 at the start of this work). `mappingFile.ts` keeps only `parseControlAction` and `eventsFor`; the generic conversion code moved to `brain-control/src/controller/mapping.ts`. The public API (`controller`, `parseMapping`, `decodeMidi`, `validateBridgeUrl`, the types) is unchanged.

**Evidence.** The 54 VideoBrain control and dialog tests, written before the extraction, pass unchanged against the new structure. `brain-control` gained 16 tests that run the core against a fake host with no VideoBrain code. The whole VideoBrain suite is identical to the baseline at HEAD (1,204 pass; the one old `projectStore.test.ts` failure and 29 lint problems are unchanged), and the web and control images build.

**Pinned, not built:** generic MIDI/OSC import and export through an adapter registry and a CSV binding table, Stream Deck specifics, and the test plan: [`brain-control/docs/INTEROP_ROADMAP.md`](../../brain-control/docs/INTEROP_ROADMAP.md). **Stream Deck is confirmed as a target**; other controllers and OSC details are to be determined.

### Done in code, UI incomplete: step 6, AudioBrain adoption

| Piece | Where |
| --- | --- |
| Actions: `parameter` (absolute, set, toggle, momentary) and `transport` (play, pause, toggle, reset, panic) | `src/control/actions.ts` |
| `ControlHost` adapter over the project store and runtime transport | `src/control/controller.ts` (`controller.initialize(runtime)`) |
| Provisional Controllers panel, opened from a new top-bar button | `src/components/ControllersPanel.tsx` |
| Companion default: relay on loopback port 8934 | `../brain-control/docker-compose.yml` (`CONTROL_API_KEY` enables it) |

**Behavior.** Parameter actions set the saved literal through the store, so a gesture is one undo step. A parameter driven by a cable, a text parameter, a missing node and a second hold of the same parameter are all rejected. Like VideoBrain, every action needs the controller armed, including `panic`. Controller MIDI is separate from MIDI In nodes, so one input can both fire a mapping and feed a node.

**Cross-app files.** Added `UnsupportedActionError` to `@brain/control/mapping`. An action that is well-formed in another app but unknown here (VideoBrain's `source`, AudioBrain's `panic`) is **skipped with a warning** and the rest of the file loads. A malformed action still rejects the whole file. VideoBrain applies the same rule. This delivers the "cross-app" item from the pinned test plan for MIDI/OSC bindings and the shared parameter and transport actions.

**UI is marked incomplete** in the panel itself ("Incomplete" note, and a tooltip on the top-bar button), and in `brain-control/docs/CENTRAL_CONTROL.md`, which lists the open research questions. Nothing about the UI should be treated as the final design.

**Tests added:** 13 in `actions.test.ts` (scaling and snapping, reversed ranges, enum toggle, momentary hold and restore, double-hold refusal, cable and missing-node refusal, transport, repeat suppression, one undo step per gesture, action parsing), 8 in `controller.test.ts` (MIDI CC to parameter as one undo step and only when armed, transport panic from a note, disarm on structural change, export and re-import, persistence, and **importing a file written by VideoBrain**, including a connected controller adopted by name), 5 in `ControllersPanel.test.tsx`. In `brain-control`: 4 for unsupported actions. In VideoBrain: 1 for skipped actions. AudioBrain now has 140 tests (was 114) with lint, typecheck, the parity check and the production build all passing.

**Not verified:** the panel in a real browser (no screenshot or e2e run), real MIDI hardware, a Companion or Stream Deck connection to AudioBrain, and the Playwright suites. The `source` action is the only VideoBrain-only action; any others added later will also skip.

### Deferred

Step 7, the shared UI component, until the centralized-control research is done.
