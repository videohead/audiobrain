import { UnsupportedActionError } from '@brain/control/mapping';
import type { RemoteEventKind } from '@brain/control/mapping/interop';
import type { ControlEvent } from '@brain/control/protocol/events';
import { getOperatorDefinition, getParameter, type OperatorParamDefinition, type GraphParamValue } from '../graph';
import type { ProjectStoreApi } from '../store/projectStore';

/**
 * AudioBrain's controller actions: set a node parameter (the saved literal, one undo step per gesture) or drive the
 * transport. Parameter actions share their shape with VideoBrain's, so a file with those loads in either app.
 */
export type ControlAction =
  | { type: 'parameter'; nodeId: string; paramId: string; mode: 'absolute' | 'set' | 'toggle' | 'momentary'; low: GraphParamValue; high: GraphParamValue }
  | { type: 'transport'; command: 'play' | 'pause' | 'toggle' | 'reset' | 'panic' };
export type { ControlEvent };

export interface TransportControl { setPlaying: (playing: boolean) => void; isPlaying: () => boolean; reset: () => void; panic: () => void }

const TRANSPORT_COMMANDS = ['play', 'pause', 'toggle', 'reset', 'panic'] as const;
const KNOWN_TYPES = ['parameter', 'transport'];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isScalar = (value: unknown): value is GraphParamValue =>
  typeof value === 'boolean' || typeof value === 'string' && value.length <= 128 || typeof value === 'number' && Number.isFinite(value);

/** Validates an action from untrusted input (saved settings or an imported file). Actions of other apps are "unsupported", not invalid. */
export function parseControlAction(input: unknown): ControlAction {
  if (!isRecord(input)) throw new Error('Invalid action.');
  if (typeof input.type !== 'string' || !KNOWN_TYPES.includes(input.type)) throw new UnsupportedActionError(`AudioBrain has no "${String(input.type).slice(0, 32)}" action.`);
  if (input.type === 'transport') {
    if (typeof input.command !== 'string' || !(TRANSPORT_COMMANDS as readonly string[]).includes(input.command)) {
      throw new UnsupportedActionError(`AudioBrain has no "${String(input.command).slice(0, 32)}" transport command.`);
    }
    return { type: 'transport', command: input.command as typeof TRANSPORT_COMMANDS[number] };
  }
  if (typeof input.nodeId === 'string' && input.nodeId.length <= 128 && typeof input.paramId === 'string' && input.paramId.length <= 128 &&
    ['absolute', 'set', 'toggle', 'momentary'].includes(String(input.mode)) && isScalar(input.low) && isScalar(input.high)) {
    return { type: 'parameter', nodeId: input.nodeId, paramId: input.paramId, mode: input.mode as 'absolute' | 'set' | 'toggle' | 'momentary', low: input.low, high: input.high };
  }
  throw new Error('Invalid action.');
}

export function eventsFor(action: ControlAction): RemoteEventKind[] {
  if (action.type === 'parameter') {
    if (action.mode === 'absolute') return ['value'];
    return action.mode === 'momentary' ? ['press', 'release'] : ['press'];
  }
  return ['press'];
}

interface HeldParameter { nodeId: string; paramId: string; previous: GraphParamValue; applied: GraphParamValue }

export function createControlActions(store: ProjectStoreApi, transport: () => TransportControl) {
  /** Sets a parameter, turning the store's recorded failure into an error for the controller to report. */
  const apply = (nodeId: string, paramId: string, value: GraphParamValue) => {
    if (store.getState().setNodeParam(nodeId, paramId, value)) return;
    const message = store.getState().error ?? 'The parameter could not be changed.';
    store.getState().clearError();
    throw new Error(message);
  };
  const held = new Map<string, HeldParameter>();
  const pressed = new Set<string>();

  const target = (nodeId: string, paramId: string) => {
    const document = store.getState().document;
    const node = document.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error('The mapped node is missing.');
    const parameter = getParameter(getOperatorDefinition(node.kind), paramId);
    if (!parameter || parameter.type === 'string') throw new Error('This parameter cannot be controlled.');
    if (document.edges.some(({ target: end }) => end.nodeId === nodeId && end.portId === paramId)) {
      throw new Error('Disconnect the graph input before controlling this parameter.');
    }
    return { node, parameter };
  };

  const validateValue = (parameter: OperatorParamDefinition, value: GraphParamValue) => {
    if (parameter.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < parameter.min || value > parameter.max) throw new Error('Value is outside the parameter range.');
      if (parameter.integer && !Number.isSafeInteger(value)) throw new Error('Value must be a whole number.');
    } else if (parameter.type === 'select') {
      if (typeof value !== 'string' || !parameter.options.some((option) => option.value === value)) throw new Error('Choose a valid parameter option.');
    } else if (parameter.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error('A boolean value is required.');
    }
  };

  const release = (id: string) => {
    pressed.delete(id);
    const entry = held.get(id);
    held.delete(id);
    if (!entry) return;
    const node = store.getState().document.nodes.find((candidate) => candidate.id === entry.nodeId);
    if (node && Object.is(node.params[entry.paramId], entry.applied)) apply(entry.nodeId, entry.paramId, entry.previous);
  };

  const execute = (id: string, action: ControlAction, event: ControlEvent) => {
    if (event.type === 'release') { release(id); return; }
    if (event.type === 'value' && (!Number.isFinite(event.value) || event.value < 0 || event.value > 1)) throw new Error('Control values must be between 0 and 1.');
    if (event.type === 'press' && pressed.has(id)) return;
    if (action.type === 'transport') {
      if (event.type !== 'press') return;
      const control = transport();
      if (action.command === 'reset') control.reset();
      else if (action.command === 'panic') control.panic();
      else if (action.command === 'toggle') control.setPlaying(!control.isPlaying());
      else control.setPlaying(action.command === 'play');
    } else {
      const { node, parameter } = target(action.nodeId, action.paramId);
      validateValue(parameter, action.high);
      validateValue(parameter, action.low);
      let value = action.high;
      if (action.mode === 'absolute') {
        if (event.type !== 'value') return;
        if (parameter.type !== 'number' || typeof action.low !== 'number' || typeof action.high !== 'number') throw new Error('Absolute mappings require a numeric parameter.');
        const scaled = action.low + (action.high - action.low) * event.value;
        const snapped = Number((parameter.min + Math.round((scaled - parameter.min) / parameter.step) * parameter.step).toFixed(10));
        value = Math.max(parameter.min, Math.min(parameter.max, snapped));
      } else {
        if (event.type !== 'press') return;
        if (action.mode === 'toggle') value = Object.is(node.params[action.paramId], action.high) ? action.low : action.high;
        if (action.mode === 'momentary') {
          if ([...held.values()].some((entry) => entry.nodeId === node.id && entry.paramId === action.paramId)) throw new Error('This parameter is already held by another mapping.');
          held.set(id, { nodeId: node.id, paramId: action.paramId, previous: node.params[action.paramId] ?? parameter.defaultValue, applied: value });
        }
      }
      apply(node.id, action.paramId, value);
    }
    if (event.type === 'press') pressed.add(id);
  };

  return {
    execute,
    release,
    releaseAll: () => { for (const id of [...pressed, ...held.keys()]) release(id); },
  };
}
