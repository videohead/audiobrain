# I/O contracts and extension design

Status: version 0.1 uses the [authoritative production catalog](../contracts/operator-catalog.json), with 34 operators and ten signal families. The type table and public payload sketches below retain the broader design, including families not yet in that catalog. Implemented runtime records live in `src/runtime/types.ts`; [provenance](PROVENANCE.md) and [integration](INTEGRATION.md) describe current lifecycle and bridge behavior. Nested modules, general tempo maps, spectrum/trigger/vector families and surround layouts remain planned.

## Boundary rules

1. Data describes the instrument, not its DOM. A geometry node must be evaluable without Canvas, React, MIDI, or an AudioContext.
2. Ports carry one declared signal family and descriptor version. Units, domains, cardinality and optional-input fallbacks are contracts. Connect identical descriptors; use a converter for anything else.
3. Parameters have stable IDs, type, unit, default, limits, step, modulation policy and optional semantic UI layout. Render all control surfaces from this metadata.
4. Authoring state, sampled runtime state and events are different things. A moving meter never becomes a saved parameter by accident.
5. Every stateful node declares start, pause, reset, seek, disconnect, deactivation and disposal behavior. Every output owns explicit routing and capability requirements.

## Signal families

These are semantic wire contracts. AudioNode connections and immutable buffers can implement them without constructing a JSON object on every audio block. None of the runtime payloads or handles belongs inside a saved graph.

| Type | Proposed contract | Example boundary |
| --- | --- | --- |
| `control.f32` | Finite scalar; port declares unit and range; sampled/control-rate, never implicitly audio-rate | Level to visual brightness; CC mapping to cutoff |
| `control.bool` | Sustained boolean state, distinct from a pulse | Mute, gate state |
| `control.vec2` / `control.vec3` | Fixed coordinate vector with declared space and units | XY input; source position |
| `text.utf8` | Bounded text with encoding and maximum bytes; no code evaluation | Grammar expansion to turtle interpreter |
| `transport.state` | Epoch, playing, beat, bpm, tempo-map revision, and corresponding host-clock time | Host transport to reader/frontier/walker |
| `geometry.path` | Immutable revision; bounded points/segments, stable segment and branch IDs, dimension, space/units, parent relationships, lengths and cumulative turn | Polygon/grammar math to reader, mapping and renderer |
| `geometry.graph` | Immutable revision; stable vertices and directed edges, positions, weights, enabled flags; explicit caps | Topology generator/editor to graph walker |
| `geometry.features` | Timestamped bounded batch keyed by reader/voice ID; position, normalized height, curvature, phase, gain share and validity | Continuous Shapes reader to mapping |
| `event.feature` | Timestamped discrete contact/branch/node event with stable source, event ID, geometry revision, branch/voice key and bounded named geometric measurements | Frontier/walker to musical mapping |
| `music.voices` | Timestamped continuous voice targets: voice ID, active, frequency Hz, amplitude, pan, timbre; bounded polyphony and interpolation policy | Shape mapping to sustained voice bank |
| `event.trigger` | Event ID, source, epoch, timestamp, normalized strength; no implied duration or note | Clock, threshold, manual strike |
| `event.note` | Tagged on/off/expression event; source ID, note ID, timestamp, frequency Hz, velocity, channel/expression metadata | Mapping/keyboard to polyphonic synth |
| `event.midi` | Validated raw MIDI message bytes plus selected logical device/source, timestamp and supported protocol version | Device transport to MIDI parser/formatter |
| `event.osc` | Address plus typed arguments and bundle/timetag metadata; bounded address/packet size | OSC gateway to map/select |
| `audio.block` | Float32 planar stream; sample rate, frame count, start frame/context epoch, channel labels/layout, silence and ownership rules | Voice/filter/input to audio processors/output |
| `audio.spectrum` | Bounded bins, FFT/window/hop sizes, sample rate, timestamp and magnitude scale | FFT to band energy/spectrum view |
| `data.json` | Bounded schema-declared record; not a bypass around all other types | External integration/configuration adapter |
| `frame.rgba` | VideoBrain-aligned frame descriptor; local resource ownership stays explicit | Optional visual rendering/stream export |

Payload record schemas have their own versions. A `geometry.path` with different coordinate semantics is not made compatible merely by keeping the type string. For the production presets, declared wire descriptors use version 1 and fixed catalog-defined units. The compiler compares signal family and descriptor version. Explicit layout/rate/unit negotiation must be added before supporting multiple audio layouts or incompatible descriptors under one family.

`event.feature` is a reusable geometric event, not a hidden note. Each producer advertises available fields; each mapping declares fields it requires. Path features can carry position/height; branch features add depth, path distance, cumulative turn and power share; graph features add edge/node identity and travel time. Missing required fields produce a diagnostic, never an assumed pitch of zero. Schema negotiation or separate concrete types may replace this shared envelope if those fields do not stay coherent during extraction.

### Example runtime records

Illustrative TypeScript, not a library implementation:

```ts
type Stamp = {
  epoch: number;
  clock: 'host-monotonic';
  seconds: number; // session monotonic time; not beats or AudioContext time
};

type NoteEvent = {
  schema: 'event.note.v1';
  eventId: string;
  sourceId: string;
  noteId: string; // source-scoped ownership, retained through note-off
  at: Stamp;
} & (
  | { type: 'on'; frequencyHz: number; velocity: number; pan: number }
  | { type: 'off'; releaseVelocity: number }
  | { type: 'expression'; pressure?: number; pitchCents?: number }
);

type ParameterTarget = { nodePath: string[]; paramId: string };
type SetParameter = {
  type: 'setNodeParam';
  requestId: string;
  expectedRevision: number;
  gestureId?: string;
  target: ParameterTarget;
  value: number | string | boolean;
};
```

Internally schedule note-offs explicitly. A note with a duration in beats is a score item compiled into matching on/off events, not a second incompatible note lifecycle. Sustain owns pending releases per source/channel. Panic releases all owned notes, clears pending attacks, ramps the local master to silence, and sends supported outbound all-notes-off only on explicitly selected routes.

Graph events and timestamped control/feature snapshots share host-monotonic time. The session defines that basis from a monotonic browser clock, including a known offset if it uses an origin of zero. The audio sink converts into context seconds; a MIDI adapter converts into performance milliseconds. Each bridge retains its clock-map revision. Raw source timestamps cannot be relabeled without conversion. `audio.block` timestamps remain sample frames in the context epoch because audio buffers have a different owning clock.

## Parameters, live inputs and performance controls

**MIDI should not click a UI control to reach the math.** Normalize it, choose the semantic target, and invoke the same parameter/event binding that a UI gesture invokes. Existing Morphazoid label/DOM discovery can remain a compatibility shim during extraction; new nodes must not depend on label text or slider order.

| Input | Route | Stored/undo behavior |
| --- | --- | --- |
| Edit-view slider or pinned performance slider | Validated `setNodeParam` gesture | One saved literal change/undo item per gesture |
| Shape drag changing curvature/rotation | View intent → declared public parameter commands | Same values as Inspector; grouped gesture |
| Graph vertex drag | Validated topology edit, stable vertex ID | One geometry revision and undo gesture; no coordinate-to-note guessing |
| MIDI CC/OSC stream wired into a control port | Explicit parser/select/map/smooth → compatible parameter input | Live override, saved literal retained; record only on explicit automation capture |
| MIDI key, sustain, manual strike | Timestamped musical event | Transient; separate recording if requested |
| Meter/phase feedback | Read-only runtime subscription | Never mutates the project |

Precedence: an active compatible wire supplies the resolved value; otherwise the literal supplies it. Disconnection restores the literal. Invalid/non-finite live values use the node's documented last-good/default policy and a diagnostic. Clamp at the runtime boundary and smooth audio parameters there.

Pinned controls display literal and resolved values when different. A wired control identifies its source and can offer an explicit disconnect or edit-source action; dragging its literal must not pretend to override an active wire. Multiple incoming writers require a visible selector/mixer/macro node. A macro's fanout and mapping belong to graph data, not hidden widget code. Bidirectional MIDI/OSC feedback is opt-in, deduplicated, rate-limited, and source-tagged; no automatic echo.

External API mutations eventually use the same command validation, revision precondition, request IDs and atomic transactions. Read-only inspect/catalog comes first. Network adapters must not expose JavaScript evaluation, shell commands, arbitrary fetch, or object patches into the store.

## Clock and queue contract

| Domain | Owner | Boundary policy |
| --- | --- | --- |
| Transport beats | One chosen host/clock leader | Tempo map converts beat events into host-monotonic seconds; tempo edits invalidate affected queued events |
| Host-monotonic seconds | Session transport/scheduler | Runs for control/MIDI-only graphs with audio off; maps future events into audio time when armed, without replay or reset |
| Audio context/sample frames | Host audio session | Native scheduled nodes/AudioParam automation/worklets consume it |
| Performance time | Browser input/MIDI | Convert to/from host seconds with documented origin/unit mapping; audio sink separately maps to context time |
| Visual frame | View renderer | Read latest complete snapshot; drop obsolete snapshots rather than audio events |
| Network/OSC time | Adapter | Estimate offset/jitter; timetag mapping and stale-event handling explicit |

Implemented limits: 128 graph nodes, 512 edges, 64 performance widgets and 1 MiB JSON imports; 96 simultaneous voices globally and 32 per bank; eight Shapes heads; 12,000 L-System symbols and 1,024 segments; 64 generated graph vertices; and 256 events per evaluation batch. The scheduler wakes every 25 ms with 100 ms lookahead and bounds each callback to eight short evaluation slices. MIDI input queues admit at most 128 attacks, reserve capacity for releases up to 256 entries, and panic on release overflow. Oversized/nonfinite geometry fails with a diagnostic while preserving the last valid non-destructive evaluation.

The initial Brain and OSC transports use 4 KiB messages and 60 messages/second per direction, with further channel/client bounds described in [Integration](INTEGRATION.md). These replace the larger exploratory queue and geometry budgets in the original proposal; they are finite implementation caps, not universal performance guarantees.

For queue overflow, coalesce replaceable controls by target, reject new attacks with diagnostics, and reserve a release path so note-offs/panic cannot disappear behind a full queue. When late, skip obsolete generated attacks and advance deterministically; never dump a backlog of notes into the present. Pause stops new generated attacks and releases sustained/gated notes; effect tails drain to a configured bound. Audio Off ramps the gate and suspends/closes according to host lifecycle; Play alone never arms audio. Device loss transitions to silence and a recoverable unavailable state. Returning to a visible tab reconciles epoch/time and releases stale keyboard notes.

The implementation must measure underruns and latency; the design does not assert sample accuracy for JavaScript timer, graphics, MIDI, or network sources. Web Audio provides scheduling and automation in its own clock domain. [Web Audio Recommendation](https://www.w3.org/TR/2021/REC-webaudio-20210617/).

## Audio, microphones and surround

`audio.block` describes a stream even when the compiler realizes it as an `AudioNode.connect` edge. Standard nodes use native Web Audio; custom processing runs in an AudioWorklet. A worklet processes buffers owned by the audio runtime; it must not round-trip through React state. Worklet failure mutes its branch and reports status.

The current audio rack implements a stereo output path and stereo panning. Discrete surround routing and channel-matrix/downmix nodes are not implemented. For that future extension, mono, stereo and surround layouts must carry channel labels as well as count. Stereo uses `L,R`; an initial discrete 5.1 proposal uses `L,R,C,LFE,Ls,Rs`. Declare an explicit matrix to reorder, upmix or downmix; do not infer a physical interface's wiring from its channel count. Query available output capacity and require the performer to select/map channels. Unsupported surround output offers a visible stereo downmix node, never a silent remapping. Hardware/browser verification is a separate acceptance gate; a generic spatial panner is not proof of discrete multichannel playback.

Voice processors expose audio ports; only Audio Out connects to the host destination. Default project audio is off, initial gain is conservative, and a persistent panic/stop control remains reachable in fullscreen. Gains use dB in the UI and an explicit conversion to linear amplitude internally; silence/mute is a dedicated state rather than treating -60 dB as digital zero. The output host uses a smooth gate and a final protective dynamics stage; thresholds and behavior must be measured and documented, not described as a universal guarantee.

Mic In requests permission only from its own explicit enable action. Monitoring is off until routed. L-System Mic uses the same geometry contract but a dedicated audio processor path; changing its graphic or selecting a preset never implicitly starts capture. Session teardown stops owned tracks, cancels pending permissions by generation identity, disposes processors/listeners, and clears routes.

## Devices and extensibility

MIDI In/Out are adapters around events, not audio. Select logical routes, match available devices during the session, show disconnected/denied/unsupported states, and provide a computer-keyboard teaching fallback. Keep SysEx outside the first implementation. Source-scoped notes and timestamp conversion are mandatory. Browser support and permission behavior must be feature-detected. [Web MIDI specification](https://www.w3.org/TR/webmidi/).

Browser OSC requires a transport adapter to a compatible gateway for conventional UDP OSC. The gateway owns its allowlisted UDP destination; the browser owns a bounded authenticated WSS session. Specify address patterns, typed arguments, bundle/timetag conversion, reconnect, and input/output loop suppression. The static web build does not itself supply that gateway. No endpoint credentials, MIDI handles, sockets or permission grants are saved in presets.

Planned extension registration will require a stable kind/version with ports, parameter metadata, views, runtime factory, lifecycle/cost/capability declarations and conformance fixtures. Start with bundled trusted modules. Saved JSON references registered kinds and assets; it never contains executable plugin source. User-authored module graphs can be portable without becoming arbitrary-code plugins. Third-party code loading, sandboxing, signing and distribution require a later explicit design.

Audio-runtime factory sketch (instantiated only after the audio host is armed; pure geometry, control and device adapters do not require an AudioContext):

```ts
type RuntimeFactory = (host: {
  audioContext: AudioContext;
  eventScheduler: EventScheduler;
  capabilities: CapabilityBroker;
  snapshots: SnapshotPublisher;
}) => {
  prepare(plan: NodePlan): Promise<void>;
  applyParameters(update: ResolvedParameters): void;
  receive(events: readonly TimedEvent[]): void;
  reset(epoch: number): void;
  dispose(): Promise<void>;
};
```

`EventScheduler`, `NodePlan`, and the other host interfaces are design placeholders. They must be defined and exercised by a real vertical slice before becoming public API. Views are registered by stable `viewId`; their renderer receives snapshots and a constrained command dispatcher, not an engine instance to mutate.
