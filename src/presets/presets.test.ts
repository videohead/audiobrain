import { describe, expect, it } from 'vitest';
import { PRESET_LIBRARY_ENTRIES, buildPresetGraph, exportPresetDefinition, getPresetDefinition, graphPresetDefinition, parsePresetDefinition, reconstructPreset, serializePresetDefinition } from './index';
import { compileGraph } from '../graph/compiler';
import { parseGraphDocument, serializeGraphDocument } from '../graph/model';
import { createProjectStore } from '../store/projectStore';
import { GraphEvaluator } from '../runtime/GraphEvaluator';

describe('page-independent source presets', () => {
  it('keeps every archived entry exportable without treating unavailable engines as ready', async () => {
    const sources = PRESET_LIBRARY_ENTRIES.filter(entry => entry.origin === 'morphazoid');
    expect(sources.length).toBeGreaterThan(1200);
    expect(new Set(PRESET_LIBRARY_ENTRIES.map(entry => entry.id)).size).toBe(PRESET_LIBRARY_ENTRIES.length);
    expect(sources.filter(entry => entry.status === 'ready')).toHaveLength(21);
    for (const entry of sources) {
      const definition = await getPresetDefinition(entry.id);
      expect(parsePresetDefinition(serializePresetDefinition(definition))).toEqual(definition);
      expect(definition.id).toBe(entry.id);
      expect(definition.title).toBe(entry.title);
    }
    const blocked = 'graph-instrument-patches:clearSteps';
    await expect(buildPresetGraph(blocked)).rejects.toThrow('saved edge timing');
    const preserved = parsePresetDefinition(await exportPresetDefinition(blocked));
    expect(preserved.recipe.kind === 'morphazoid' && preserved.recipe.settings).toMatchObject({ topology: 'chain', baseDelay: 55, pulseBeats: .5, drums: { percussionStyle: 'circuit' } });
    expect(preserved.recipe.kind === 'morphazoid' && preserved.recipe.source.notices?.map(notice => notice.path)).toEqual(['LICENSE', 'THIRD_PARTY_NOTICES.md']);
  });

  it('reconstitutes every ready original component into a valid graph and performance layout with source settings intact', async () => {
    for (const entry of PRESET_LIBRARY_ENTRIES.filter(entry => entry.origin === 'morphazoid' && entry.status === 'ready')) {
      const definition = await getPresetDefinition(entry.id);
      const graph = reconstructPreset(definition);
      const compiled = compileGraph(graph);
      expect(compiled.reachableNodeIds.size).toBe(graph.nodes.length);
      expect(graph.performance.widgets.length).toBeGreaterThan(0);
      expect(graph.presetOrigins?.[0]?.recipe).toEqual(definition.recipe);
      expect(parseGraphDocument(serializeGraphDocument(graph))).toEqual(graph);
      const evaluated = new GraphEvaluator(compiled).evaluate({ time: .1, start: 0, end: .2, levels: {}, controls: new Map(), midiNotes: new Map() });
      const view = graph.nodes.find(node => node.kind.startsWith('view.'))!;
      expect(evaluated.snapshots[view.id]?.geometry?.segments.length).toBeGreaterThan(0);
      expect(evaluated.audio.some(node => node.kind === 'audio.output')).toBe(true);
    }
  });

  it('keeps source identity separate from fresh object identities, edits and custom performance layouts', async () => {
    const definition = await getPresetDefinition('l-system-grammars:dragon');
    const first = reconstructPreset(definition), second = reconstructPreset(definition);
    expect(new Set([...first.nodes, ...second.nodes].map(node => node.id)).size).toBe(first.nodes.length + second.nodes.length);
    expect(first.presetOrigins![0]!.presetId).toBe(second.presetOrigins![0]!.presetId);
    expect(first.presetOrigins![0]!.instanceId).not.toBe(second.presetOrigins![0]!.instanceId);
    const store = createProjectStore({ storage: null, initialDocument: first });
    try {
      expect(store.getState().addInstrument(second)).toBe(true);
      const combined = store.getState().document;
      expect(combined.presetOrigins).toHaveLength(2);
      expect(new Set(combined.presetOrigins!.map(origin => origin.instanceId)).size).toBe(2);
      for (const origin of combined.presetOrigins!) expect(origin.nodeIds.every(id => combined.nodes.some(node => node.id === id))).toBe(true);
      const geometry = combined.nodes.find(node => node.kind === 'lsystem.geometry')!;
      store.getState().setNodeParam(geometry.id, 'angleDeg', 73);
      const widget = combined.performance.widgets[0]!;
      store.getState().moveWidget(widget.id, { ...widget.layout, x: 1 });
      const saved = parsePresetDefinition(serializePresetDefinition(graphPresetDefinition(store.getState().document)));
      const rebuilt = reconstructPreset(saved);
      expect(rebuilt).toEqual(store.getState().document);
      expect(rebuilt.presetOrigins?.[0]?.recipe).toEqual(definition.recipe);
      store.getState().deleteNode(geometry.id);
      expect(store.getState().document.presetOrigins?.[0]?.nodeIds).not.toContain(geometry.id);
      store.getState().undo(); expect(store.getState().document).toEqual(rebuilt);
    } finally { store.dispose(); }
  });

  it('rejects lossy reconstructions and corrupted source associations transactionally', async () => {
    const definition = await getPresetDefinition('l-system-grammars:pythagorean');
    const unsupported = structuredClone(definition);
    if (unsupported.recipe.kind !== 'morphazoid') throw new Error('Expected source preset');
    unsupported.recipe.settings = { ...unsupported.recipe.settings as object, unknownSound: 'secret' };
    expect(() => reconstructPreset(unsupported)).toThrow('is not supported.');
    const whitespace = structuredClone(definition);
    if (whitespace.recipe.kind !== 'morphazoid') throw new Error('Expected source preset');
    whitespace.recipe.settings = { ...whitespace.recipe.settings as object, rules: { X: ' F ' }, drawSymbols: ' F' };
    expect(() => reconstructPreset(whitespace)).toThrow('cannot be represented losslessly');
    const tooLarge = structuredClone(definition);
    if (tooLarge.recipe.kind !== 'morphazoid') throw new Error('Expected source preset');
    tooLarge.recipe.settings = { ...tooLarge.recipe.settings as object, iterations: 15 };
    expect(() => reconstructPreset(tooLarge)).toThrow(/exceeds/);
    const graph = reconstructPreset(definition), store = createProjectStore({ storage: null, initialDocument: graph });
    try {
      const broken = structuredClone(graph);
      broken.presetOrigins![0]!.nodeIds.push('missing');
      expect(store.getState().importProject(broken).ok).toBe(false);
      expect(store.getState().document).toEqual(graph);
      const original = graph.presetOrigins![0]!.recipe;
      expect(() => parsePresetDefinition({ ...definition, recipe: { ...original, source: { ...original.source, sha256: 'unverified' } } })).toThrow('fingerprint');
    } finally { store.dispose(); }
  });

  it('bounds UTF-8 source metadata before accepting edits that could not be saved and restored', async () => {
    const graph = await buildPresetGraph('l-system-grammars:pythagorean');
    graph.presetOrigins![0]!.recipe.settings = { note: '音'.repeat(70_000) };
    const store = createProjectStore({ storage: null, initialDocument: graph });
    try {
      for (let instance = 1; instance < 4; instance++) expect(store.getState().addInstrument(graph)).toBe(true);
      const accepted = store.getState().document;
      const json = serializeGraphDocument(accepted);
      expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(1_048_576);
      expect(parseGraphDocument(json)).toEqual(accepted);
      expect(store.getState().addInstrument(graph)).toBe(false);
      expect(store.getState().error).toContain('byte limit');
      expect(store.getState().document).toEqual(accepted);
      const oversized = await getPresetDefinition('l-system-grammars:pythagorean');
      if (oversized.recipe.kind !== 'morphazoid') throw new Error('Expected source preset');
      oversized.recipe.settings = { note: '音'.repeat(100_000) };
      expect(() => serializePresetDefinition(oversized)).toThrow('262144-byte limit');
    } finally { store.dispose(); }
  });

  it('restores unfinished authored presets with their diagnostics while rejecting corrupt cables', async () => {
    const graph = await buildPresetGraph('l-system-grammars:pythagorean');
    const store = createProjectStore({ storage: null, initialDocument: graph });
    try {
      const output = graph.nodes.find(node => node.kind === 'audio.output')!;
      store.getState().disconnect(graph.edges.find(edge => edge.target.nodeId === output.id)!.id);
      const draft = store.getState().document;
      expect(store.getState().error).toContain('connect');
      const saved = parsePresetDefinition(serializePresetDefinition(graphPresetDefinition(draft)));
      expect(reconstructPreset(saved)).toEqual(draft);
      expect(store.getState().importProject(reconstructPreset(saved)).ok).toBe(true);
      expect(store.getState().error).toContain('connect');
      const corrupt = graphPresetDefinition(graph);
      if (corrupt.recipe.kind !== 'graph') throw new Error('Expected graph recipe');
      corrupt.recipe.graph.edges.push({ ...structuredClone(graph.edges[0]!), id: 'duplicate-route' });
      expect(() => reconstructPreset(corrupt)).toThrow('is already connected by edge');
    } finally { store.dispose(); }
  });
});
