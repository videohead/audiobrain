# AudioBrain Agent Instructions

AudioBrain is a browser-native audio signal studio, and sibling to the VideoBrain and Morphazoid projects. 
Morphazoid is standalone experimentation.
VideoBrain is a node-based video processing graph tool.
AudioBrain is centered around audio, but should retain some feature parity and cross functionality with VideoBrain. Users should be able to use VideoBrain and AudioBrain without relearning the interface.

Its **Signal Graph**
combines renderer and a browser audio runtime in
one static web application — no account, backend, or device permission needed
to open a working composition. It includes demand-rooted graph compilation
with cycle rejection, procedural sources and effects, audio mixing/FFT/
trigger envelopes, transport and beat clocks, undo/redo, versioned autosave
with JSON import/export, and a Storybook component catalog.

## Tool execution rule

All tool calls that invoke `python`, `node`, `vite`, or `php` MUST run inside
Docker — never on the host. The host has no project runtimes installed.

- Repository scripts (dev server, Storybook, builds, verification) run via a
  bind-mounted Node container, e.g.
  
- Python tooling runs in the `AudioBrain-mcp` container or via
  
- Compose stacks live in `docker-compose.web.yml`,
  and `docker-compose.control.yml`.

The repository-root `AGENTS.md` points here; this file is the primary agent
guide.

## Working guidance

- Read the existing contracts before changing behavior
- Do not maintain a second graph model in UI, Storybook, tests, or an adapter.
  The production registry and compiler are the source of truth.
- Use **AudioBrain** for the product
- Keep the default experience browser-native, local-first, useful without an
  account, and permission-free. Patches and configurations are saved and restored as JSON.
- Preserve unrelated user changes in a dirty worktree; no destructive Git
  commands or history rewrites unless explicitly requested.

# AudioBrain agent guide

Read `README.md`, `docs/PROVENANCE.md` and the relevant implementation before changing behavior. `docs/INTEGRATION.md` defines the current Brain/OSC boundary . Other design documents retain planned extensions, so distinguish their targets from shipped behavior.

## Ownership and contracts

- `contracts/operator-catalog.json` is the authoritative operator registry. The graph parser/compiler, editor, parameter controls, presets and runtime use that registry; do not create a parallel graph model or catalog in a view, adapter or test.
- `GraphDocument` is serializable project data. Store commands own edits and undo history; the compiler validates types and plans upstream demand; the runtime owns clocks, voices, native audio resources and snapshots. Renderers observe snapshots and issue explicit validated gestures.
- Preserve stable node kinds, node/port/parameter/view IDs, port ordering and schema discriminators. Append compatible optional ports; make a migration decision for incompatible changes. Connected controls override resolved values while preserving saved literals.
- Graph documents and performance layout are bounded. Reject ordinary cable cycles and incompatible signal families. Keep invalid author edits observable; incomplete destructive edits must not leave removed audio routes sounding.
- Performance coordinates are independent of graph coordinates. Pinned controls use existing parameter bindings. Do not store duplicated values, runtime objects, device handles, sockets or credentials in project JSON.

## Implementation and verification

A node needs a contract, registry/compiler support, actual bounded runtime behavior, accessible metadata-driven controls and meaningful tests. Add a complete example when the node needs a teaching path. Availability and session readiness are separate; a planned capability must not appear as an implemented operator.

Storybook imports production components, styles and graph data. Do not reconstruct the application appearance or graph rules inside stories. Inject deterministic runtime/device fixtures; stories must not request real permissions, connect to networks or emit sound.

Microphone, MIDI, audio activation and network connections require their explicit session actions. Preserve source/channel note ownership, matching releases, output-device selection, teardown and stale asynchronous request cancellation. Keep timer/control, transport and audio clocks distinct. Bridge changes must preserve exact-origin pairing, bounds, explicit mappings and session-owned endpoints.

Record copied or adapted code in `docs/PROVENANCE.md`, retain required licenses and source hashes, and use fixed source links. Keep actual implementation limits and roadmap status accurate. Production code must not depend on sibling checkouts.

## Preserve imported instrument functionality

The user's explicit requirement is to preserve existing Morphazoid functionality. Read `docs/FEATURE_PARITY.md` before changing an imported instrument. `contracts/morphazoid-parity-baseline.json` freezes the source audit; `contracts/feature-parity.json` records each capability's implementation, discoverability, evidence and remaining work.

- Preserve sound engines and mappings, readers/modes, control choices/ranges/defaults, gestures, visible contact identity, state continuity, presets, saved states and routes. Sharing infrastructure or changing the shell does not authorize silent omission, approximation or substitution. Identify differences explicitly.
- Missing or partial capabilities remain tracked requirements until implemented and verified, or a specific departure is explicitly authorized by the user. Keep the original requirement even when recording an approved departure and quote the actual user instruction. Do not interpret a first-slice release, preset rename or design-system change as approval to lose unrelated behavior.
- Preserve stable capability IDs. Do not regenerate the source inventory from AudioBrain's currently available controls. Advancing the frozen source inventory requires a documented source re-audit that retains prior requirements and adds newly discovered ones. Promote verified capabilities into the preservation floor; do not downgrade a restored capability to make verification pass. A specific user-approved departure must retain the original requirement and record the explicit baseline change.
- For each control distinguish unavailable behavior from an implemented control that is merely unpinned. Document its Graph/Inspector and Perform location; expose essential instrument controls in the default performance layout. Both views edit the same state.
- A ported status needs implementation and named behavioral test evidence, including relevant defaults, phase/direction continuity, geometry/contact identity, actual audio changes, release and saved-state round trips. Presence of metadata, an operator name, or a green structural ledger does not prove behavioral or timbral equivalence. Record listening, touch and physical-device acceptance separately.
- Run `npm run check:parity` for changes to instrument behavior, presets, controls or the ledger. Before claiming any source instrument is fully imported, run `node scripts/check-feature-parity.mjs --require-complete shapes` (or `lsystems`, `graphs`, `all`) and the referenced behavioral suites. A partial port may ship with an accurate partial scope; it must not be described as full source parity.

New Shapes defaults use zero curvature as explicitly requested. Preserve curvature values in existing saved user projects; do not silently rewrite authored patches to the new default.

## Preserve source presets

Read `docs/PRESET_ARCHIVE.md` and `docs/PRESETS.md` before changing presets or their adapters. `contracts/morphazoid-presets.json` retains original committed factory records; its compact index powers the library and its frozen baseline prevents loss or mutation. Preserve original names, IDs, raw settings, expressions, source hashes and licenses independently of current operator availability. Extending a source audit must retain previous records and document changes; do not regenerate the baseline to hide a regression.

Reconstruction adapters must map supported records explicitly and reject unknown settings or capacity overflow. Keep unsupported presets visible and exportable with accurate missing-feature requirements. A restored grammar or topology does not establish parity for a whole instrument's timing, mappings or sound. Preserve `presetOrigins` through edits, duplication, Add, undo and project/preset round trips; instance node IDs must remain independent. Run `npm run check:presets` and the behavioral adapter tests when changing presets, graph metadata or source preservation.

Use Node.js 22 or newer. For a release-sized change run:

```sh
npm run verify
npm run test:e2e
git diff --check
```

Run focused tests while developing; use real offline audio/browser coverage when sound, graph routing or lifecycle changes. Physical-device and listening checks supplement deterministic tests and must not be implied by a fake-device test.

Preserve unrelated user changes. Do not commit generated `dist`, test output, credentials or runtime/device data. Use the user's authorized task scope without adding an extra approval workflow.

