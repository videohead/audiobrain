# Node catalog and delivery waves

Version 0.3 implements **34 operators** from the [production catalog](../contracts/operator-catalog.json). The library only exposes those registered implementations. Hardware/gateway nodes can still be disabled, unavailable or disconnected in a session; that readiness state is different from a node with no runtime.

| Implemented area | Stable node kinds |
| --- | --- |
| Shapes | `shapes.geometry`, `shapes.reader`, `shapes.mapping` |
| L-Systems | `lsystem.grammar`, `lsystem.geometry`, `lsystem.frontier`, `mapping.branchNotes` |
| Graphs | `graph.topology`, `graph.walk`, `mapping.graphNotes` |
| Voice banks | `voice.continuous`, `voice.poly`, `voice.graph` |
| Clock and controls | `transport`, `control.constant`, `control.map`, `control.lfo` |
| Audio and analysis | `audio.oscillator`, `audio.gain`, `audio.filter`, `audio.delay`, `audio.pan`, `audio.input`, `audio.output`, `analysis.level` |
| Performance views | `view.shapes`, `view.path`, `view.graph` |
| Device and cross-app adapters | `io.midi.in`, `io.midi.out`, `io.osc.in`, `io.osc.out`, `io.brain.in`, `io.brain.out` |

The three presets teach the Morphazoid paths and their shared output/view nodes. Additional standard nodes are available to compose in the editor. [Integration](INTEGRATION.md) defines the scalar Brain/OSC scope and explicit session activation; [provenance](PROVENANCE.md) defines the native voice and source-parity limits.

## Broader delivery roadmap

The table below retains the approved target catalog and delivery waves. It includes implemented foundations and future additions; it is not a list of currently available nodes. In particular, nested instrument modules, recording, richer analysis, MIDI learn/clock, graph model editing and discrete surround remain planned.

Wave A proves the Shapes instrument and performance model. Wave B completes the three requested flows. Wave C supplies standard device/integration breadth and the live VideoBrain bridge. Wave D expands spatial audio, recording and advanced module authoring. Each wave ships complete executable paths, stories and tests.

| Category | Nodes | I/O boundary | Wave / dependency |
| --- | --- | --- | --- |
| Transport | Transport, beat clock, divider, swing, event delay, reset | Transport state / timestamped triggers | A basic transport; B subdivisions; explicit state rules |
| Control/math | Constant, arithmetic, map range, clamp, curve, smoothing, selector | Scalars with declared units/ranges | A; reuse pure VideoBrain helpers where independent of visual time |
| Performance controls | Slider, knob, toggle, XY, trigger, keyboard/pads, parameter group | Shared parameter bindings or event outputs | A core slider/XY/trigger; B keyboard/groups; layout widgets do not secretly add audio nodes |
| Musical mapping | Hz/note conversion, scale/quantizer, transpose, velocity curve, gate/envelope timing, event merge/filter | Geometric/control/event inputs → musical events or continuous voice targets | A geometry mapping; B note mapping; source-scoped note ownership |
| Shapes | Geometry, reader, features-to-voices, Shapes instrument module | Path → continuous features → voice targets; contact event variant | A 2D; B notes/triggers; D 3D/4D adapters after continuity QA |
| L-Systems | Grammar, turtle geometry, frontier, turn/depth mapping, L-System instrument | Text → branched path → feature events → notes | B; bounded growth and off-visual event scheduling |
| Graphs | Topology, edge editor, traversal, turn/pitch mapping, Graph instrument | Graph data → traversal events → notes/audio | B Graph Synth; C drums/delay variants |
| Synths | Sine/subtractive poly synth, FM/PM voice, drum bank, continuous voice bank | Notes/triggers/voice targets → audio | A continuous sine/FM; B poly/Graph voice; C drums/PM; preserve source identity |
| Audio primitives | Oscillator, noise, envelope/VCA | Audio plus control/gate | B standard shapes/ADSR; custom DSP later |
| Levels/mixing | Gain, mute, mixer, stereo pan, channel splitter/merger, crossfade | Audio buses with layout metadata | A gain/stereo out; B mix/pan; C explicit channel tools |
| Filters/effects | Low/high/band-pass, shelf/EQ, delay, compressor, saturation, reverb | Audio → audio; explicit tails and bypass | B filter/delay; C remaining effects; feedback stays internal initially |
| Audio I/O | Audio Out, Mic/Device In, audio file, recorder | Host/device/file ↔ audio | A output; B opt-in mic for L-System variant; C file/recording |
| MIDI | MIDI In, MIDI Out, note parser/formatter, CC select/map, learn, clock in/out, monitor/panic | Raw MIDI ↔ musical events/controls | C devices and full routes; B computer-keyboard fallback; SysEx deferred |
| OSC/data | OSC In/Out, address select/map, data monitor, bounded WSS adapter | Gateway events ↔ typed controls | C; external gateway required and separately versioned |
| Analysis | Peak/RMS level, waveform, spectrum/FFT, band energy, envelope follower, onset | Audio → spectrum/controls/events | A level; B waveform; C remaining analysis |
| Spatial/surround | Stereo panner, spatial panner, channel matrix, discrete 5.1/7.1 output map, stereo downmix | Position/control + audio → explicit channel bus | B stereo; D discrete surround with real-interface QA; no fake guarantee from channel count |
| Views | Path/shape, tree/frontier, graph/traversal, meters, scope, spectrum | Read-only snapshots plus declared editing intents | A shape/meter; B tree/graph; C scope/spectrum |
| Interop | Brain Control In/Out, transport sync, media audio bridge | Selected controls/events; separate audio media transport | C controls with paired VideoBrain change; D media |
| Modules | Instrument module, public parameter/port/view, module browser | Versioned public boundary around a real subgraph | A fixed module packaging; B inspect internals; D general authoring/expand/version migrations |

## Completion contract for each node

Copy the discipline of [VideoBrain's node definition of done](https://github.com/blechdom/videobrain/blob/b7af64b1c1615eb521209b480856bff95b33a71f/AGENTS.md), adapted for audio: contract → registry/compiler → runtime → inline controls → reachable teaching preset → production Storybook story → help → tests. Every standard category must have a runnable teaching graph by its delivery wave. Audio-specific checks include silence/non-silence, onset/release, finite output, control sensitivity, bounded voices/tails, stale-event handling, cleanup, and resource accounting.

Availability is separate from readiness. A shipped MIDI node can be unsupported in one browser, permission-blocked in another, or disconnected from a device. A planned node has no runtime at all. Those states must be distinguished in catalog, UI and inspection APIs.

## Deliberate first-release limits

The three-flow milestone is implemented as editable top-level graphs with shared gain/output, meters, musical events and performance controls. Standard oscillator/filter/delay/pan, microphone, MIDI and scalar OSC/Brain paths are implemented. Remaining standard-toolkit breadth and discrete surround continue on the roadmap; general module instances are not implied by loading a complete instrument preset.

Do not add Gen-like arbitrary DSP code editing, native VST hosting, arbitrary web scripts, remote collaboration, or a hosted cloud audio engine as dependencies for these milestones. Those are separate possible products/extensions, not prerequisites for a browser instrument graph.
