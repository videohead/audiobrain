import { createController, type ControlMapping as SharedMapping } from '@brain/control/controller';
import { decodeMidi } from '@brain/control/midi';
import { validateBridgeUrl } from '@brain/control/transport/url';
import type { AudioBrainRuntime } from '../runtime/AudioBrainRuntime';
import { projectStore } from '../store';
import { createControlActions, eventsFor, parseControlAction, type ControlAction, type TransportControl } from './actions';

export { decodeMidi, validateBridgeUrl };
export type { MidiBinding, OscBinding } from '@brain/control/controller';
export type ControlMapping = SharedMapping<ControlAction>;

/**
 * AudioBrain's controller: the shared MIDI, Companion and mapping-file machinery from @brain/control, driving the
 * project store and the audio runtime. Controller MIDI is separate from MIDI In nodes: both can hear the same input.
 */
let transport: TransportControl | null = null;
const actions = createControlActions(projectStore, () => {
  if (!transport) throw new Error('Transport is unavailable.');
  return transport;
});

const structureKey = (nodes: readonly { id: string; kind: string }[]) => nodes.map((node) => `${node.id}:${node.kind}`).join('\n');

const core = createController<ControlAction>({
  parseAction: parseControlAction,
  execute: actions.execute,
  release: actions.release,
  releaseAll: actions.releaseAll,
  takesValue: (action) => action.type === 'parameter' && action.mode === 'absolute',
  beginGesture: () => projectStore.getState().beginGesture(),
  endGesture: () => projectStore.getState().endGesture(),
  onTargetsChanged: (listener) => projectStore.subscribe((next, previous) => {
    if (structureKey(next.document.nodes) !== structureKey(previous.document.nodes)) listener();
  }),
  eventsFor,
}, { storageKey: 'audiobrain.controllers.v1', app: 'audiobrain' });

export const parseMapping = core.parseMapping;
export const controller = {
  ...core,
  /** Connects the controller to the runtime's transport. Returns the cleanup function. */
  initialize: (runtime: Pick<AudioBrainRuntime, 'setPlaying' | 'getSnapshot' | 'reset' | 'panic'>) => {
    transport = {
      setPlaying: (playing) => runtime.setPlaying(playing),
      isPlaying: () => runtime.getSnapshot().playing,
      reset: () => runtime.reset(),
      panic: () => runtime.panic(),
    };
    const cleanup = core.initialize();
    return () => { cleanup(); transport = null; };
  },
};
