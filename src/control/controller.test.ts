import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESETS, cloneGraphDocument, createNode } from '../graph';
import { projectStore } from '../store';
import { controller, type ControlMapping } from './controller';

class FakeInput {
  onmidimessage: ((event: { data: Uint8Array }) => void) | null = null;
  state = 'connected';
  constructor(readonly id: string, readonly name: string) {}
  close() { return Promise.resolve(this); }
  send(...bytes: number[]) { this.onmidimessage?.({ data: Uint8Array.from(bytes) }); }
}
class FakeAccess {
  onstatechange: (() => void) | null = null;
  readonly map = new Map<string, FakeInput>();
  get inputs() { return { forEach: (callback: (input: FakeInput) => void) => this.map.forEach(callback), get: (id: string) => this.map.get(id) }; }
}

const volume: ControlMapping = {
  id: 'volume', name: 'Volume', action: { type: 'parameter', nodeId: 'ctl-gain', paramId: 'db', mode: 'absolute', low: -60, high: 0 },
  midi: { deviceId: 'dev1', deviceName: 'Launch X', channel: 1, type: 'cc', number: 7 },
};
const panic: ControlMapping = { id: 'panic', name: 'Panic', action: { type: 'transport', command: 'panic' }, midi: { deviceId: 'dev1', deviceName: 'Launch X', channel: 1, type: 'note', number: 36 } };
const db = () => projectStore.getState().document.nodes.find((node) => node.id === 'ctl-gain')?.params.db;

let access: FakeAccess;
let input: FakeInput;
let playing: boolean;
let calls: string[];
let cleanup: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  access = new FakeAccess();
  input = new FakeInput('dev1', 'Launch X');
  access.map.set('dev1', input);
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: vi.fn(() => Promise.resolve(access)) });
  const document = cloneGraphDocument(PRESETS[0]!);
  document.nodes.push({ ...createNode('audio.gain'), id: 'ctl-gain' });
  expect(projectStore.getState().importProject(document).ok).toBe(true);
  playing = false; calls = [];
  cleanup = controller.initialize({
    setPlaying: (value) => { playing = value; calls.push(`play:${value}`); },
    getSnapshot: () => ({ playing }) as never,
    reset: () => { calls.push('reset'); },
    panic: () => { calls.push('panic'); },
  });
});
afterEach(() => {
  cleanup();
  for (const { id } of controller.snapshot().mappings) controller.remove(id);
  vi.useRealTimers();
  delete (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess;
});
const enable = async () => { await controller.enableMidi(); await vi.advanceTimersByTimeAsync(0); };

describe('AudioBrain controller', () => {
  it('maps a MIDI CC onto a node parameter as one undo step, only while armed', async () => {
    controller.save(volume);
    await enable();
    input.send(0xb0, 7, 127);
    await vi.advanceTimersByTimeAsync(40);
    expect(db()).not.toBe(0);
    expect(controller.snapshot().error).toBe('Controllers are disarmed.');
    controller.arm(true);
    const before = projectStore.getState().undoCount;
    for (const value of [30, 90, 127]) { input.send(0xb0, 7, value); await vi.advanceTimersByTimeAsync(33); }
    await vi.advanceTimersByTimeAsync(300);
    expect(db()).toBe(0);
    expect(projectStore.getState().undoCount).toBe(before + 1);
  });
  it('fires a transport panic from a MIDI note', async () => {
    controller.save(panic); controller.arm(true);
    await enable();
    input.send(0x90, 36, 100);
    expect(calls).toEqual(['panic']);
  });
  it('disarms when the graph structure changes', () => {
    controller.save(volume); controller.arm(true);
    projectStore.getState().addNode('audio.pan');
    expect(controller.snapshot().armed).toBe(false);
  });
  it('exports brain.mappings with the device name and re-imports it', () => {
    controller.save(volume); controller.save(panic);
    const text = controller.exportMappings('0.3.0');
    expect(JSON.parse(text)).toMatchObject({ format: 'brain.mappings', version: 1, exportedBy: { app: 'audiobrain', version: '0.3.0' } });
    for (const { id } of controller.snapshot().mappings) controller.remove(id);
    expect(controller.importMappings(text)).toEqual({ imported: 2, warnings: [] });
    expect(controller.snapshot().mappings).toEqual(expect.arrayContaining([volume, panic]));
  });
  it('persists mappings across a reload', () => {
    controller.save(volume);
    cleanup();
    cleanup = controller.initialize({ setPlaying: () => undefined, getSnapshot: () => ({ playing: false }) as never, reset: () => undefined, panic: () => undefined });
    expect(controller.snapshot().mappings).toEqual([volume]);
  });
});

describe('files shared with VideoBrain', () => {
  // Written by VideoBrain's exporter, not by this app.
  const fromVideoBrain = JSON.stringify({
    format: 'brain.mappings', version: 1, exportedBy: { app: 'videobrain', version: '0.9.0' },
    mappings: [
      { id: 'level', name: 'Level', action: { type: 'parameter', nodeId: 'ctl-gain', paramId: 'db', mode: 'absolute', low: -60, high: 0 },
        bindings: [{ kind: 'midi', channel: 3, type: 'cc', number: 21, device: { id: 'vb-browser-id', name: 'Launch X' } }, { kind: 'osc', address: '/level', range: [0, 127] }] },
      { id: 'next', name: 'Next source', action: { type: 'source', nodeId: 'router', mode: 'advance', index: 0 }, bindings: [] },
      { id: 'pause', name: 'Pause', action: { type: 'transport', command: 'pause' }, bindings: [] },
    ],
  });
  it('imports the shared actions, skips VideoBrain-only ones with a warning, and keeps MIDI and OSC bindings', () => {
    const result = controller.importMappings(fromVideoBrain);
    expect(result).toEqual({ imported: 2, warnings: ['Mapping "next": skipped. AudioBrain has no "source" action.'] });
    const level = controller.snapshot().mappings.find(({ id }) => id === 'level');
    expect(level?.midi).toEqual({ deviceId: 'vb-browser-id', deviceName: 'Launch X', channel: 3, type: 'cc', number: 21 });
    expect(level?.osc).toEqual({ address: '/level', range: [0, 127] });
  });
  it('adopts a connected controller with the same name and then responds to it', async () => {
    await enable();
    controller.importMappings(fromVideoBrain);
    expect(controller.snapshot().mappings.find(({ id }) => id === 'level')?.midi?.deviceId).toBe('dev1');
    controller.arm(true);
    input.send(0xb0 | 2, 21, 127);
    await vi.advanceTimersByTimeAsync(40);
    expect(db()).toBe(0);
  });
  it('exports a file whose shared actions VideoBrain would accept (same field names and ranges)', () => {
    controller.save(volume);
    const file = JSON.parse(controller.exportMappings()) as { mappings: { action: object; bindings: { kind: string; channel: number; type: string; number: number }[] }[] };
    expect(file.mappings[0]?.action).toEqual(volume.action);
    expect(file.mappings[0]?.bindings[0]).toMatchObject({ kind: 'midi', channel: 1, type: 'cc', number: 7 });
  });
});
