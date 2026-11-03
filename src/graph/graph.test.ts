import { describe, expect, it } from 'vitest';
import { normalizeParamValue } from '@brain/control/graph/params';
import { PRESETS, OPERATOR_DEFINITIONS, getParameter, intentAccepts, parameterList, cloneGraphDocument, compileGraph, createNode, getOperatorDefinition, parseGraphDocument, serializeGraphDocument, tryCompileGraph, validateConnection } from './index';

const shapes = () => cloneGraphDocument(PRESETS[0]!);
describe('production catalog and presets', () => {
  it('runs all three Morphazoid examples with complete upstream demand', () => {
    expect(PRESETS.map(preset => preset.title)).toEqual(['Morphazoid Shapes', 'Morphazoid L-Systems', 'Morphazoid Graphs', 'Morphazoid Shapes Synth', 'Morphazoid Shapes Notes', 'Morphazoid Shapes Triggers', 'Morphazoid Shapes Drums']);
    for (const preset of PRESETS) {
      const graph = compileGraph(preset);
      expect(graph.reachableNodeIds.size).toBe(preset.nodes.length);
      expect(parseGraphDocument(serializeGraphDocument(preset))).toEqual(preset);
      const cooked = new Set();
      for (const node of graph.nodes) { for (const input of Object.values(node.inputs)) expect(cooked.has(input.sourceNodeId)).toBe(true); cooked.add(node.node.id); }
    }
  });
  it('has unique stable kinds, ports and exact numeric modulation inputs', () => {
    expect(new Set(OPERATOR_DEFINITIONS.map(operator => operator.kind)).size).toBe(OPERATOR_DEFINITIONS.length);
    for (const definition of OPERATOR_DEFINITIONS) {
      for (const direction of ['inputs', 'outputs'] as const) expect(new Set(definition[direction].map(port => port.id)).size).toBe(definition[direction].length);
      const document = shapes();
      const node = createNode(definition.kind);
      document.nodes.push(node);
      expect(parseGraphDocument(document).nodes.at(-1)?.params).toEqual(node.params);
      for (const [id, parameter] of Object.entries(definition.params)) if (parameter.type === 'number') expect(definition.inputs).toContainEqual(expect.objectContaining({ id, type: 'control.f32', required: false }));
    }
  });
});
describe('document boundary', () => {
  it('rejects foreign documents, unknown fields, invalid numbers and oversized imports', () => {
    expect(() => parseGraphDocument({ ...shapes(), documentType: 'videobrain.project' })).toThrow();
    expect(() => parseGraphDocument({ ...shapes(), runtime: {} })).toThrow('project.runtime is not supported.');
    expect(() => parseGraphDocument(' '.repeat(1024 * 1024 + 1))).toThrow('Project JSON exceeds the 1048576-byte limit.');
    const document = shapes(); document.nodes[0]!.params.sides = NaN;
    expect(() => parseGraphDocument(document)).toThrow('nodes[0].params.sides must be a finite number.');
    document.nodes[0]!.params.sides = 3.5;
    expect(() => parseGraphDocument(document)).toThrow('nodes[0].params.sides must be an integer.');
    document.nodes[0]!.params.sides = 99;
    expect(() => parseGraphDocument(document)).toThrow('nodes[0].params.sides must be between 1 and 32.');
  });
  it('rejects duplicate identities and stale performance or gesture references', () => {
    const document = shapes(); document.nodes.push(cloneGraphDocument(document).nodes[0]!);
    expect(() => parseGraphDocument(document)).toThrow('duplicate');
    const stale = shapes(); stale.performance.widgets[0]!.target.nodePath = ['gone'];
    expect(() => parseGraphDocument(stale)).toThrow('missing node');
    const binding = shapes(); binding.nodes.find(node => node.id === 'view')!.viewBindings!.curvature!.paramId = 'sides';
    expect(() => parseGraphDocument(binding)).toThrow('incompatible');
  });
  it('normalizes omitted literals while rejecting undeclared parameters', () => {
    const document = shapes(); document.nodes[0]!.params = {};
    expect(parseGraphDocument(document).nodes[0]!.params.sides).toBe(5);
    document.nodes[0]!.params.unregistered = 1;
    expect(() => parseGraphDocument(document)).toThrow('nodes[0].params.unregistered is not supported.');
  });
});
describe('compiler', () => {
  it('is independent of node position and author array order', () => {
    const document = shapes(); const ids = compileGraph(document).nodes.map(node => node.node.id);
    document.nodes.reverse(); document.edges.reverse(); document.nodes.forEach(node => { node.position = { x: -400, y: 1800 }; });
    expect(compileGraph(document).nodes.map(node => node.node.id)).toEqual(ids);
  });
  it('retains disconnected author branches without cooking them', () => {
    const document = shapes(); const filter = createNode('audio.filter'); document.nodes.push(filter);
    const graph = compileGraph(document);
    expect(graph.document.nodes).toHaveLength(10);
    expect(graph.reachableNodeIds.has(filter.id)).toBe(false);
  });
  it('reports required reachable inputs while the author document remains importable', () => {
    const document = shapes(); document.edges = document.edges.filter(edge => edge.target.nodeId !== 'out');
    expect(parseGraphDocument(document).edges).toHaveLength(shapes().edges.length - 1);
    const result = tryCompileGraph(document);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some(issue => issue.code === 'required-input' && issue.nodeId === 'out')).toBe(true);
  });
  it('rejects implicit coercion, duplicate inputs, missing endpoints and ordinary cycles', () => {
    const document = shapes();
    expect(validateConnection(document, { nodeId: 'geometry', portId: 'path' }, { nodeId: 'gain', portId: 'db' })).toMatchObject({ valid: false, code: 'port-type-mismatch' });
    expect(validateConnection(document, { nodeId: 'voices', portId: 'audio' }, { nodeId: 'gain', portId: 'audio' })).toMatchObject({ valid: false, code: 'input-occupied' });
    expect(validateConnection(document, { nodeId: 'missing', portId: 'audio' }, { nodeId: 'gain', portId: 'audio' })).toMatchObject({ valid: false, code: 'source-node-missing' });
    const a = createNode('control.constant'); const b = createNode('control.constant'); document.nodes.push(a, b);
    document.edges.push({ id: 'a-b', source: { nodeId: a.id, portId: 'value' }, target: { nodeId: b.id, portId: 'value' } });
    expect(validateConnection(document, { nodeId: b.id, portId: 'value' }, { nodeId: a.id, portId: 'value' })).toMatchObject({ valid: false, code: 'cycle' });
  });
  it('keeps saved literals below explicit connected controls', () => {
    const document = shapes(); const source = createNode('control.constant'); document.nodes.push(source);
    document.nodes.find(node => node.id === 'gain')!.params.db = -18;
    document.edges.push({ id: 'modulation', source: { nodeId: source.id, portId: 'value' }, target: { nodeId: 'gain', portId: 'db' } });
    const gain = compileGraph(document).nodes.find(node => node.node.id === 'gain')!;
    expect(gain.inputs.db!.sourceNodeId).toBe(source.id);
    expect(gain.node.params.db).toBe(-18);
  });
  it('makes external outputs demand roots and preserves port ordering', () => {
    expect(getOperatorDefinition('io.midi.out').demandRoot).toBe('external-output');
    expect(getOperatorDefinition('shapes.reader').inputs.slice(0, 2).map(port => port.id)).toEqual(['path', 'transport']);
  });
});

describe('shared parameter vocabulary', () => {
  it('defines every catalog parameter with one of four types and a default that passes its own rules', () => {
    for (const definition of OPERATOR_DEFINITIONS) {
      for (const [id, parameter] of Object.entries(definition.params)) {
        const where = `${definition.kind}.${id}`;
        expect(['number', 'boolean', 'select', 'string'], where).toContain(parameter.type);
        expect(parameter.label, where).toBeTruthy();
        expect(() => normalizeParamValue(parameter, parameter.defaultValue, where), where).not.toThrow();
        if (parameter.type === 'number') { expect(parameter.min, where).toBeLessThanOrEqual(parameter.max); expect(parameter.step, where).toBeGreaterThan(0); }
        if (parameter.type === 'select') { expect(parameter.options.length, where).toBeGreaterThan(0); expect(new Set(parameter.options.map(option => option.value)).size, where).toBe(parameter.options.length); }
      }
    }
  });
  it('keeps the whole-number parameters as numbers with an integer flag', () => {
    const sides = getParameter(getOperatorDefinition('shapes.geometry'), 'sides');
    expect(sides).toMatchObject({ id: 'sides', type: 'number', integer: true });
    const curvature = getParameter(getOperatorDefinition('shapes.geometry'), 'curvature');
    expect(curvature?.type === 'number' && curvature.integer).toBeFalsy();
  });
  it('looks parameters up only by their own IDs, so a hostile ID finds nothing', () => {
    const definition = getOperatorDefinition('shapes.geometry');
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'nope', undefined]) expect(getParameter(definition, id), String(id)).toBeUndefined();
  });
  it('lists parameters in catalog order with their IDs', () => {
    const list = parameterList(getOperatorDefinition('audio.filter'));
    expect(list.map(parameter => parameter.id)).toEqual(['frequency', 'q', 'type']);
    expect(list[2]).toMatchObject({ type: 'select', defaultValue: 'lowpass', options: [{ value: 'lowpass', label: 'lowpass' }, { value: 'highpass', label: 'highpass' }, { value: 'bandpass', label: 'bandpass' }] });
  });
  it('keeps whole-number parameters out of continuous view gestures', () => {
    const intent = { paramType: 'number' as const };
    expect(intentAccepts(intent, getParameter(getOperatorDefinition('shapes.geometry'), 'curvature')!)).toBe(true);
    expect(intentAccepts(intent, getParameter(getOperatorDefinition('shapes.geometry'), 'sides')!)).toBe(false);
    expect(intentAccepts(intent, getParameter(getOperatorDefinition('audio.filter'), 'type')!)).toBe(false);
  });
});

describe('unified error and issue wording (same as VideoBrain)', () => {
  const message = (run: () => unknown) => { try { run(); } catch (error) { return error instanceof Error ? error.message : String(error); } return null; };
  it('names the path of a bad field', () => {
    const document = shapes();
    expect(message(() => parseGraphDocument({ ...document, nodes: [{ ...document.nodes[0], position: { x: 1 } }] }))).toBe('nodes[0].position.y is required.');
    expect(message(() => parseGraphDocument({ ...document, nodes: [{ ...document.nodes[0], kind: 'no.such.kind' }] }))).toBe('nodes[0].kind is not a registered node kind.');
    expect(message(() => parseGraphDocument({ ...document, schemaVersion: 2 }))).toBe('Unsupported schema version "2".');
    expect(message(() => parseGraphDocument('{nope'))).toMatch(/^Project JSON is invalid\./);
    expect(message(() => parseGraphDocument({ ...document, nodes: 'x' }))).toBe('project.nodes must be an array.');
  });
  it('reports compile issues with the shared codes and sentences', () => {
    const document = shapes();
    const a = createNode('control.constant'); const b = createNode('control.constant'); document.nodes.push(a, b);
    document.edges.push({ id: 'a-b', source: { nodeId: a.id, portId: 'value' }, target: { nodeId: b.id, portId: 'value' } }, { id: 'b-a', source: { nodeId: b.id, portId: 'value' }, target: { nodeId: a.id, portId: 'value' } });
    const result = tryCompileGraph(document);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const cycle = result.issues.find(issue => issue.code === 'cycle');
    expect(cycle?.message).toBe(`Graph contains a cycle involving: ${[a.id, b.id].sort().join(', ')}. Stateful effects keep their delay internal; ordinary edges must remain acyclic.`);
  });
  it('explains a rejected cable with the shared sentences', () => {
    const document = shapes();
    expect(validateConnection(document, { nodeId: 'geometry', portId: 'path' }, { nodeId: 'gain', portId: 'db' })).toEqual({ valid: false, code: 'port-type-mismatch', message: 'Cannot connect geometry.path to control.f32.' });
    expect(validateConnection(document, { nodeId: 'voices', portId: 'audio' }, { nodeId: 'gain', portId: 'audio' })).toEqual({ valid: false, code: 'input-occupied', message: 'Input "audio" is already connected.' });
    expect(validateConnection(document, { nodeId: 'missing', portId: 'audio' }, { nodeId: 'gain', portId: 'audio' })).toEqual({ valid: false, code: 'source-node-missing', message: 'Source node "missing" does not exist.' });
    expect(validateConnection(document, { nodeId: 'voices', portId: 'nope' }, { nodeId: 'gain', portId: 'audio' })).toMatchObject({ code: 'source-port-missing', message: 'Output "nope" does not exist on "voices".' });
  });
  it('reports an invalid document as a compile issue, not a crash', () => {
    const result = tryCompileGraph({ nope: true } as never);
    expect(result).toMatchObject({ ok: false, issues: [{ code: 'invalid-document' }] });
  });
});
