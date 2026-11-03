import { describe, expect, it } from 'vitest';
import { PRESETS, cloneGraphDocument, createNode } from '../graph';
import { createProjectStore } from '../store/projectStore';
import { createControlActions, eventsFor, parseControlAction, type ControlAction, type TransportControl } from './actions';
import { UnsupportedActionError } from '@brain/control/mapping';

function fixture() {
  const document = cloneGraphDocument(PRESETS[0]!);
  document.nodes.push({ ...createNode('audio.gain'), id: 'ctl-gain' }, { ...createNode('audio.filter'), id: 'ctl-filter' });
  const store = createProjectStore({ storage: null, initialDocument: document });
  let playing = false;
  const transport: TransportControl & { calls: string[] } = {
    calls: [],
    setPlaying: (value) => { playing = value; transport.calls.push(`play:${value}`); },
    isPlaying: () => playing,
    reset: () => { transport.calls.push('reset'); },
    panic: () => { transport.calls.push('panic'); },
  };
  const actions = createControlActions(store, () => transport);
  const db: ControlAction = { type: 'parameter', nodeId: 'ctl-gain', paramId: 'db', mode: 'absolute', low: -60, high: 0 };
  const value = (nodeId = 'ctl-gain', paramId = 'db') => store.getState().document.nodes.find((node) => node.id === nodeId)?.params[paramId];
  return { store, actions, transport, db, value };
}

describe('AudioBrain controller actions', () => {
  it('scales absolute values onto the parameter range, snapping to its step', () => {
    const { actions, db, value } = fixture();
    actions.execute('knob', db, { type: 'value', value: 0.5 });
    expect(value()).toBe(-30);
    actions.execute('knob', db, { type: 'value', value: 0.3333 });
    expect(value()).toBe(-40);
    actions.execute('knob', db, { type: 'value', value: 1 });
    expect(value()).toBe(0);
  });
  it('supports a reversed range and clamps to the parameter bounds', () => {
    const { actions, value } = fixture();
    actions.execute('knob', { type: 'parameter', nodeId: 'ctl-gain', paramId: 'db', mode: 'absolute', low: 0, high: -60 }, { type: 'value', value: 1 });
    expect(value()).toBe(-60);
  });
  it('rejects non-finite or out-of-range values and out-of-range endpoints', () => {
    const { actions, db } = fixture();
    expect(() => actions.execute('knob', db, { type: 'value', value: Number.NaN })).toThrow('between 0 and 1');
    expect(() => actions.execute('knob', db, { type: 'value', value: 2 })).toThrow('between 0 and 1');
    expect(() => actions.execute('knob', { ...db, high: 12 }, { type: 'value', value: 1 })).toThrow('outside the parameter range');
  });
  it('sets an enum on press, toggles between two choices, and ignores releases for non-momentary modes', () => {
    const { actions, value } = fixture();
    const toggle: ControlAction = { type: 'parameter', nodeId: 'ctl-filter', paramId: 'type', mode: 'toggle', low: 'lowpass', high: 'highpass' };
    expect(value('ctl-filter', 'type')).toBe('lowpass');
    actions.execute('key', toggle, { type: 'press' });
    expect(value('ctl-filter', 'type')).toBe('highpass');
    actions.execute('key', toggle, { type: 'release' });
    actions.execute('key', toggle, { type: 'press' });
    expect(value('ctl-filter', 'type')).toBe('lowpass');
    expect(() => actions.execute('other', { ...toggle, high: 'notch' }, { type: 'press' })).toThrow('valid parameter option');
  });
  it('holds a momentary value and restores it on release, but not over a manual edit', () => {
    const { store, actions, value } = fixture();
    const momentary: ControlAction = { type: 'parameter', nodeId: 'ctl-gain', paramId: 'db', mode: 'momentary', low: -60, high: 0 };
    const original = value();
    actions.execute('key', momentary, { type: 'press' });
    expect(value()).toBe(0);
    actions.release('key');
    expect(value()).toBe(original);
    actions.execute('key', momentary, { type: 'press' });
    store.getState().setParameter('ctl-gain', 'db', -12);
    actions.releaseAll();
    expect(value()).toBe(-12);
  });
  it('refuses a second hold of the same parameter', () => {
    const { actions } = fixture();
    const momentary: ControlAction = { type: 'parameter', nodeId: 'ctl-gain', paramId: 'db', mode: 'momentary', low: -60, high: 0 };
    actions.execute('a', momentary, { type: 'press' });
    expect(() => actions.execute('b', momentary, { type: 'press' })).toThrow('already held');
  });
  it('refuses missing nodes, unknown and text parameters, and parameters driven by a cable', () => {
    const { store, actions, db } = fixture();
    expect(() => actions.execute('k', { ...db, nodeId: 'nope' }, { type: 'value', value: 1 })).toThrow('node is missing');
    expect(() => actions.execute('k', { ...db, paramId: 'nope' }, { type: 'value', value: 1 })).toThrow('cannot be controlled');
    const document = cloneGraphDocument(store.getState().document);
    document.nodes.push({ ...createNode('control.constant'), id: 'lfo' });
    document.edges.push({ id: 'edge-wired', source: { nodeId: 'lfo', portId: 'value' }, target: { nodeId: 'ctl-gain', portId: 'db' } });
    store.getState().loadProject(document);
    expect(() => actions.execute('k', db, { type: 'value', value: 1 })).toThrow('Disconnect the graph input');
  });
  it('drives the transport on press only and treats toggle against the current state', () => {
    const { actions, transport } = fixture();
    for (const command of ['play', 'pause', 'toggle', 'toggle', 'reset', 'panic'] as const) {
      actions.execute(command, { type: 'transport', command }, { type: 'press' });
      actions.execute(command, { type: 'transport', command }, { type: 'release' });
    }
    expect(transport.calls).toEqual(['play:true', 'play:false', 'play:true', 'play:false', 'reset', 'panic']);
  });
  it('does not repeat a held press until it is released', () => {
    const { actions, transport } = fixture();
    const reset: ControlAction = { type: 'transport', command: 'reset' };
    actions.execute('k', reset, { type: 'press' });
    actions.execute('k', reset, { type: 'press' });
    actions.execute('k', reset, { type: 'release' });
    actions.execute('k', reset, { type: 'press' });
    expect(transport.calls).toEqual(['reset', 'reset']);
  });
  it('gestures: absolute bursts are one undo step through the store', () => {
    const { store, actions, db, value } = fixture();
    const original = value();
    store.getState().beginGesture();
    for (const v of [0.2, 0.6, 1]) actions.execute('knob', db, { type: 'value', value: v });
    store.getState().endGesture();
    expect(store.getState().undoCount).toBe(1);
    store.getState().undo();
    expect(value()).toBe(original);
  });
});

describe('parseControlAction and eventsFor', () => {
  it('rebuilds known actions from known fields only', () => {
    expect(parseControlAction({ type: 'transport', command: 'panic', extra: 1 })).toEqual({ type: 'transport', command: 'panic' });
    expect(parseControlAction({ type: 'parameter', nodeId: 'a', paramId: 'b', mode: 'set', low: 0, high: 1, token: 'x' })).toEqual({ type: 'parameter', nodeId: 'a', paramId: 'b', mode: 'set', low: 0, high: 1 });
  });
  it('marks other apps\' actions unsupported and malformed known actions invalid', () => {
    expect(() => parseControlAction({ type: 'source', nodeId: 'r', mode: 'advance', index: 0 })).toThrow(UnsupportedActionError);
    expect(() => parseControlAction({ type: 'transport', command: 'rewind' })).toThrow(UnsupportedActionError);
    expect(() => parseControlAction({ type: 'parameter', nodeId: 'a' })).not.toThrow(UnsupportedActionError);
    expect(() => parseControlAction({ type: 'parameter', nodeId: 'a' })).toThrow('Invalid action.');
    expect(() => parseControlAction('nope')).toThrow('Invalid action.');
  });
  it('lists the relay events each action responds to', () => {
    expect(eventsFor({ type: 'parameter', nodeId: 'a', paramId: 'b', mode: 'absolute', low: 0, high: 1 })).toEqual(['value']);
    expect(eventsFor({ type: 'parameter', nodeId: 'a', paramId: 'b', mode: 'momentary', low: 0, high: 1 })).toEqual(['press', 'release']);
    expect(eventsFor({ type: 'transport', command: 'play' })).toEqual(['press']);
  });
});
