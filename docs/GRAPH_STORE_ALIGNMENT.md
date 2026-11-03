# Graph core and project store: alignment analysis

Status: **all four stages and the follow-up decisions are done in code.** Stage 4 (common vocabulary) was done without a backward-compatibility constraint, as the project owner directed. See [Progress](#progress). This began as step 2 of the plan in [SHARED_DEVELOPMENT.md](SHARED_DEVELOPMENT.md): separate what is generic from what is domain-specific. It was done by reading both implementations in full, not by diffing against the old VideoBrain commit. The earlier statement that the graph core is "a fork that should extract cleanly" was a hypothesis, and **the reading below corrects it**.

## Headline finding

AudioBrain's graph core and store are **not drifted copies of VideoBrain's. They are independent implementations of the same ideas**, written in different styles, with different document formats, parameter vocabularies, error models and APIs. They share a *pattern* (and about a dozen small algorithms), not much *code*. Aligning them is a design task with API consequences for both apps, not a mechanical extraction. The genuinely shareable part is real but small.

## Graph core

| Concern | AudioBrain (`src/graph/`) | VideoBrain (`src/graph/`) |
| --- | --- | --- |
| Size | `model.ts` 136, `compiler.ts` 79, `types.ts` 59 (dense, long lines) | `model.ts` 317, `compiler.ts` 622, `types.ts` 244, plus `limits.ts` |
| Document | `documentType: 'audiobrain.project'`, `schemaVersion`, `id`, `title`, optional description, learning goal, capability notes, **preset origins**, nodes, edges, **performance layout** | `schemaVersion`, `nodes`, `edges` only (output layouts are stored separately by the store) |
| Parameter types | `number`, `integer`, `text`, `enum` (`choices: string[]`) | `number`, `text`, `boolean`, `select` (`options: {value, label}[]`) |
| Operator registry | JSON catalog in `contracts/operator-catalog.json` | Code (`operators.ts` and per-domain operator files) with `NODE_KINDS` |
| Node extras | `label`, `viewBindings` | none |
| Parse style | One 90-line function; unknown fields rejected by a `record()` helper | Small helpers (`requireRecord`, `assertOnlyKeys`, `requireString`) and one function per entity |
| Error messages | `label: expected an object`, `nodes: duplicate identifiers` | `path must be an object.`, `project.nodes contains duplicate id "x".` |
| Domain-specific validation inside the parser | Upgrade of old Shapes views from their cables | SVG artwork, font assets, cue schedules |
| Issue codes | Free strings: `missing-node`, `missing-port`, `port-type-mismatch`, `input-occupied`, `cycle`, `required-input` | A typed union of 13, including `source-node-missing`, `target-port-missing`, `node-limit`, `frame-pass-limit`, `gpu-resource-limit` |
| Demand roots | Any operator with a `demandRoot`, plus pinned meters and views | `display`, `audioOutput`, `dataInspect`, signal-test nodes |
| Required inputs | Checked for reachable nodes (`required-input`) | Not part of the compile step |
| Compiled output | `nodes` plus `reachableNodeIds` | Separate lists for control, frame, audio, audio-output and display nodes, plus visual pass and render-target counts |
| `validateConnection` | Compiles the whole graph with a candidate cable and reports the first non-`required-input` issue | Direct checks (edge limit, missing node and port, type match) and a `hasPath` cycle test, with no recompile |
| Port compatibility | Type **and** `schemaVersion` must match | Type must match |

### What is genuinely shareable

These are pure, behavior-equivalent algorithms. Both compilers contain their own copy:

1. **Deterministic topological order** (Kahn's algorithm, lexicographically smallest ready node first). AudioBrain re-sorts the queue after each push; VideoBrain does a sorted insert. Both yield the same order. VideoBrain also returns the nodes left in a cycle, which AudioBrain only needs as a boolean.
2. **Upstream reachability from a set of root nodes.**
3. **Cycle test for a candidate cable** (VideoBrain's `hasPath` approach is cheaper than AudioBrain's full recompile).
4. **Unique candidate IDs** for generated nodes and edges.

### What needs a design decision before it can be shared

- **The document envelope.** Whether a shared core defines the envelope (`documentType`, `schemaVersion`, title and so on) or only the nodes-and-edges body. AudioBrain deliberately keeps non-interchangeable `documentType` values.
- **A common parameter vocabulary.** *(Resolved in stage 4.)* `integer` and `enum` against `boolean` and `select` was a real model difference touching the operator catalog, the inspector UI and saved projects. It is now one vocabulary: `number` (with an `integer` flag), `boolean`, `string` and `select`.
- **A common issue-code set.** Codes surface in tests and in UI messages. A shared union plus app-specific extensions is possible but changes AudioBrain's strings (`missing-node` becomes `source-node-missing` or `target-node-missing`).
- **Error message wording.** Tests in both apps assert some messages.
- **Who owns domain validation.** The parser would need an extension hook for app-specific node checks.

### What must stay separate

Operator registries and catalogs, demand-root rules, the preset-origin and performance-layout parts of AudioBrain's document, VideoBrain's frame, GPU and audio categories and limits, and any app-specific upgrade code.

## Project store

| Concern | AudioBrain (`src/store/projectStore.ts`, 234 lines) | VideoBrain (`src/store/projectStore.ts` 476 lines, `persistence.ts` 98) |
| --- | --- | --- |
| Pattern | Zustand vanilla store, `past` and `future` stacks, history limit 100, gesture grouping, debounced autosave, `flushPersistence`, `dispose` | **Same pattern** |
| Autosave delay | 300 ms | 250 ms |
| Flush on page hide | Yes (`pagehide`, `visibilitychange`) | No |
| Stored format | The serialized document directly | A wrapper with its own `storageVersion`, validated on load, with a size check |
| Gesture API | `beginGesture(id?)`, `endGesture(id?)`. Every commit inside a gesture joins it | `beginGesture()`, `endGesture()`. A commit joins only when asked (`coalesceGesture`) |
| No-op commits | Skipped when the document is identical | Always recorded |
| Undo and selection | Selection cleared | Selection kept if the node still exists |
| State fields | `selection`, `revision`, `undoCount`, `redoCount`, `error` | `selectedNodeId`, `playing`, `outputLayouts` |
| Command names | `setParameter`, `removeNode`, `loadProject` (returns boolean), `connect` (returns boolean) | `setNodeParam`, `deleteNode`, `importProject` (returns `{ok}`), `connect` (returns a validation object) |
| Errors | Stored in `error` and not thrown | Mixed: some commands throw (`addNode`), others return |
| Document cloning | `structuredClone` | A hand-written `cloneGraphDocument` |
| Extras | Instruments (`addInstrument`), duplicate and rename nodes, performance widgets and layout, preset origins | Playback, output layouts, `exportProject` |

### What is genuinely shareable

Two **generic engines** that do not care what the document is:

1. **A history engine**: `commit`, `undo`, `redo`, gesture grouping, a size limit, and optional no-op detection, generic over the document type and a clone function.
2. **An autosave scheduler**: debounce, `saved / pending / failed` state, flush on demand and on page hide, `dispose`.

Each app's store would be built on them and keep its own commands and state. This reconciles the behavioral differences above, which need an explicit choice:

- Which gesture semantics: always join, or opt in.
- Whether undo keeps or clears the selection (VideoBrain's keep-if-present is friendlier).
- Whether no-op commits are recorded (skipping them is better).
- The autosave delay, and flush on page hide (adopting it in VideoBrain is a small behavior change).
- Whether the stored format is wrapped and versioned (VideoBrain's is safer for migrations).

### What must stay separate

The commands and their names, the state shape, and anything touching presets, performance layout, playback or output layouts.

### Pre-existing problem (resolved)

VideoBrain's `projectStore.test.ts` had one failing test at HEAD ("round-trips only the graph document"). It was removed at the owner's direction as not important, so VideoBrain's suite now has no failures.

## Safety net

| Area | Tests that protect a refactor |
| --- | --- |
| AudioBrain graph | `graph.test.ts` (94 lines), `presets.test.ts`, the store and runtime tests |
| AudioBrain store | `projectStore.test.ts` (144 lines) |
| VideoBrain graph | `compiler.test.ts` (552), `model.test.ts` (324), `operators.test.ts`, `presets.test.ts`, and others |
| VideoBrain store | `projectStore.test.ts` (491, with the one existing failure) |

VideoBrain's coverage is strong. AudioBrain's graph coverage is thin for the compiler (94 lines for model and compiler together), so characterization tests should be written first, as was done for the controller.

## Decisions (made)

1. **Where shared graph and store code lives: inside `brain-control`.** It is named for control, so these modules are a known mismatch. Renaming the package later is possible. No new package or Docker plumbing was needed.
2. **How far alignment goes: the largest option.** Shared engines, a common vocabulary, and one set of store API names.
3. **Whose names win: VideoBrain's,** because it is the larger surface and AudioBrain's design goal is that users do not relearn the interface.
4. **Behavior differences were reconciled toward the safer behavior where tests allowed it:** see the table under Progress.

## Progress

### Stage 1: shared algorithms (done)

`@brain/control/graph/algorithms`: `topologicalOrder`, `reachableUpstream`, `hasPath`. Both compilers use them. The code is behavior-identical, so no existing test changed.

| | Before | After |
| --- | --- | --- |
| VideoBrain `compiler.ts` | 622 lines | 500 lines (453 graph tests pass unchanged) |
| AudioBrain `compiler.ts` | 79 lines | 61 lines (all tests pass unchanged) |

AudioBrain's compiler keeps its own cycle message and does not yet use `hasPath`, because its `validateConnection` recompiles the graph with a candidate cable and its tests depend on the messages that produces.

### Stage 2: shared store engines (done)

`@brain/control/store/history` (`createHistory`) and `@brain/control/store/autosave` (`createAutosave`). Both stores use them. `PersistenceState` is now defined once, in the autosave module, and re-exported by both stores.

| Difference | Outcome |
| --- | --- |
| Gesture semantics | **Unified.** Every edit inside an open gesture joins it, whatever kind of edit it is (AudioBrain's rule, the simpler one). The `coalesce` option was removed from the engine. VideoBrain used to close a gesture on a structural edit. |
| No-op commits | **Unified.** A commit that changes nothing is never recorded, so it adds no undo step and does not discard the redo history. Documents are compared by their JSON (key-order sensitive), or by a custom `equals`. VideoBrain used to record them. |
| Flush on page hide | **Now in both.** VideoBrain gained it. |
| Final save on dispose | **Now in both.** VideoBrain gained it. |
| Gesture IDs | The shared engine supports them (AudioBrain's behavior). VideoBrain uses the default ID. |
| Stored format | **Not changed.** AudioBrain stores the document directly. VideoBrain stores a versioned wrapper. |
| Autosave delay | **Not changed.** 300 ms in AudioBrain, 250 ms in VideoBrain. |
| Undo and selection | **Not changed.** AudioBrain clears the selection; VideoBrain keeps it if the node still exists. |

Store sizes: AudioBrain 234 to 225 lines, VideoBrain 476 to 421. The smaller change in AudioBrain reflects that its store was already compact; the value is that the logic is now shared and tested once (17 engine tests).

### Stage 3: unified store API names (done in AudioBrain)

AudioBrain's store now uses VideoBrain's names. VideoBrain did not change.

| AudioBrain before | Now |
| --- | --- |
| `setParameter` | `setNodeParam` |
| `removeNode` | `deleteNode` |
| `selection` | `selectedNodeId` |
| `loadProject(value): boolean` | `importProject(value): { ok: true } \| { ok: false; error }` |
| (none) | `exportProject(): string` |

Every caller was updated: `App.tsx`, `GraphEditor`, `InstrumentView`, `PerformanceSurface`, `ShapesPlayheadControls`, the controller actions, the stories and all tests. **A trap worth knowing:** `importProject` now returns an object, so any caller that still treats the result as a boolean would silently see `{ ok: false }` as truthy. The type checker does not catch this. Three such call sites were fixed by hand and tests were added for the failure result and for `exportProject`.

**Names that matched but behaved differently** (`connect`, `addNode`, `setNodeParam`) are unified too; see Follow-up decisions.

### Stage 4: common vocabulary (done)

Parameter types, issue codes and error wording are now one definition, in `@brain/control/graph/{params,validation,issues}`, used by both apps. No backward compatibility was kept.

**Parameter vocabulary.** Four types, named as JavaScript names them: `number` (with optional `integer` and `unit`), `boolean`, `string` and `select` (a string restricted to `options: { value, label }`). An operator's `params` is a record keyed by parameter ID, and each definition uses `defaultValue`. These are VideoBrain's shapes, extended with `integer` and `unit`.

| AudioBrain before | Now |
| --- | --- |
| `params` as an array of definitions with an `id` | `params` as a record keyed by ID |
| `default` | `defaultValue` |
| `integer` | `number` with `integer: true` |
| `enum` with `choices: string[]` | `select` with `options: [{ value, label }]` (labels equal values, so nothing looks different) |
| `text` (both apps) | `string`, the JavaScript and TypeScript name, matching the `number \| string \| boolean` value type. VideoBrain's `parameterLayout: { type: 'text' }`, a tag for the text node's layout, is a different concept and keeps its name. |
| No `boolean` | `boolean`, with support added to the controller actions and panel |
| `ParameterValue`, `ParameterDefinition` | `GraphParamValue`, `OperatorParamDefinition` (VideoBrain's names) |

**The contract file changed.** `contracts/operator-catalog.json` was converted by script and every one of its 121 parameters was checked against the original (ID, label, default, unit, options, integer flag). Its `schemaVersion` went from 1 to 2 and `OPERATOR_CATALOG_VERSION` from 3 to 4. Saved projects are unaffected, because they store values, not definitions.

**Issue codes.** One shared set: `duplicate-node-id`, `duplicate-edge-id`, `source-node-missing`, `target-node-missing`, `source-port-missing`, `target-port-missing`, `port-type-mismatch`, `input-occupied`, `cycle`, `node-limit`, `edge-limit`. Each app adds its own: VideoBrain `frame-pass-limit` and `gpu-resource-limit`; AudioBrain `required-input` and `invalid-document`. AudioBrain's old `missing-node` and `missing-port` are gone.

**Error wording.** One set of sentences, taken from VideoBrain's, for parse errors (`nodes[0].position.y is required.`, `project.runtime is not supported.`, `params.sides must be an integer.`, `Project JSON exceeds the 1048576-byte limit.`), compile issues (`Edge "e" references missing source node "n".`, a cycle message that names the nodes) and rejected cables (`Cannot connect audio to control.`). A port schema-version mismatch is named only when it is what differs (`control@v2 to control@v1`). Preset-record validation in AudioBrain is domain-specific and kept its own wording.

**Shared code.** `validateEdges`, `checkConnection`, `addDuplicateIssues`, `cycleIssue`, `GraphCompileError`, `normalizeParams`, `normalizeParamValue` and the validation primitives.

| | Start of alignment | Now |
| --- | --- | --- |
| VideoBrain `compiler.ts` | 622 lines | 308 |
| VideoBrain `model.ts` | 317 | 194 |
| VideoBrain `types.ts` | 244 | 212 |
| AudioBrain `compiler.ts` | 79 | 63 |

**One rule was kept on purpose.** With `integer` as a flag, a whole-number parameter would have become bindable to a continuous view gesture, because its type is now `number`. A test caught this. `intentAccepts` keeps the old rule, so gestures still skip whole-number parameters.

**Safety.** Parameter lookups use own properties only, so an ID such as `constructor` or `__proto__` from a document finds nothing. This is tested.

**Tests.** `brain-control` 153 (new: wording of every shared message, parameter rules, edge and connection checks, schema-version naming). AudioBrain 151 (new: every catalog parameter valid under the shared rules, the integer flag, unsafe IDs, ordering, the gesture rule, and the shared sentences end to end). VideoBrain is unchanged and identical to its baseline.

**Not unified.** The document envelope, deliberately: AudioBrain's `documentType`, `title` and `performance` are part of its identity.

## Follow-up decisions (done)

Decided by the project owner on 2026-11-03, with no backward-compatibility constraint.

**1. Gesture and no-op semantics: unified.** See the Stage 2 table. A gesture joins every edit made inside it; a commit that changes nothing is not recorded. VideoBrain's `commitDocument` lost its `coalesceGesture` argument, and a no-op commit still applies a changed selection.

**2. One return and error model for store commands: unified.** Commands never throw. A command returns its result and, when it fails, also records the reason in the store's `error` (cleared with `clearError`). Both stores now have `error` and `clearError`.

| Command | Both apps now return |
| --- | --- |
| `addNode(kind, position?, params?)` | the new node's ID, or `null` on failure |
| `setNodeParam(nodeId, paramId, value)` | `true` when applied or unchanged, `false` on failure |
| `connect(source, target)` | the `ConnectionValidation`; a rejection is also recorded in `error` |
| `importProject(value)` | `{ ok: true }` or `{ ok: false, error }`; a failure is also recorded in `error` |
| `moveNode` and the other commands | nothing; a failure is recorded in `error` |

VideoBrain's `addNode`, `moveNode` and `setNodeParam` used to throw `TypeError` and `RangeError`. Its app now shows a recorded error once, through a store subscription, and no longer shows a rejected connection twice. The controller actions in both apps turn a failed `setNodeParam` into an error the controller reports, then clear the store's copy so it is not also shown as a toast. AudioBrain's `addNode` gained the optional `params` argument.

**3. AudioBrain's preset-record validation uses the shared wording.** `presets/validation.ts`, `definitions.ts` and `adapters.ts` now build on the shared primitives, so preset errors read like every other error (`preset source.extra is not supported.`, `preset origins exceeds the 128-origin limit.`, `Preset settings exceed the 262144-byte limit.`) and are `GraphDocumentError`s. New tests cover the wording.

**4. The failing VideoBrain test was removed.**

**Results.** `brain-control` 155 Vitest tests and 3 Node tests. AudioBrain 160 tests, with lint, typecheck, parity, preset and design validators, and the build passing. VideoBrain 1,206 tests with **no failures**, typecheck clean, lint at the same 29 existing problems, and the web and control images building. Not run: the Playwright suites. The `text` to `string` rename also required regenerating VideoBrain's MCP knowledge file, which changed only 42 parameter types and its timestamp.

## Still open

*All four questions below were decided on 2026-11-03. See the Follow-up decisions section.*

- ~~Whether gesture and no-op semantics should be unified (see Stage 2).~~ Yes: done.
- ~~Whether `connect` and `addNode` should converge on one return and error model.~~ Yes: done.
- ~~Whether AudioBrain's preset-record validation should adopt the shared wording.~~ Yes: done.
- ~~The one failing VideoBrain test~~ Removed at the owner's direction.

## Proposed staged approach (original plan, for reference)

1. **Decide the package boundary and how far to go** (see the open questions).
2. **Characterization tests** for AudioBrain's compiler and store, mirroring what VideoBrain already has, and a decision on the one failing VideoBrain test.
3. **Extract the pure algorithms** (topological order, reachability, cycle test) and adopt them in both compilers. Behavior-identical, so both test suites must pass unchanged.
4. **Extract the history engine and autosave scheduler**, reconciling the behavior differences above on purpose, with a test per difference.
5. **Only then, and only if wanted,** consider a shared parameter vocabulary, issue-code set and document envelope. These change saved projects and UI, so each needs its own migration and version bump.

## Open questions (original, now answered: see Decisions)

1. **Where does shared graph and store code live?** A new sibling package (for example `brain-graph`, with the same `file:` and BuildKit `additional_contexts` plumbing as `brain-control`), inside `brain-control`, or a rename of `brain-control` to something broader. `brain-control` is named for control, so graph code there would be misplaced.
2. **How far should alignment go?** Shared engines only (steps 3 and 4), or also a common parameter vocabulary, issue codes and document envelope (step 5).
3. **Which store behavior wins** for each of the differences in the table above?
4. **Which app's API names win,** if command names are to converge (`setParameter` or `setNodeParam`, `removeNode` or `deleteNode`)? Renaming touches every caller and test.
