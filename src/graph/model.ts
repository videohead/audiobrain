import { normalizeParamValue, normalizeParams } from '@brain/control/graph/params';
import {
  GraphDocumentError,
  assertJsonSize,
  assertOnlyKeys,
  assertRequiredKeys,
  assertUniqueIds,
  requireArray,
  requireRecord,
  requireString,
} from '@brain/control/graph/validation';
import { GRAPH_LIMITS, getDefaultParams, getOperatorDefinition, getParameter, intentAccepts } from './operators';
import type { GraphDocument, GraphNode, GraphPosition, GraphParams, PerformanceWidget, WidgetLayout } from './types';
import { parsePresetOrigins } from '../presets/validation';

export { GraphDocumentError, normalizeParamValue };

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new GraphDocumentError(message); }
/** An object with exactly these fields: every required one present, and nothing unlisted. */
function strictRecord(value: unknown, path: string, required: string[], optional: string[] = []): Record<string, unknown> {
  const object = requireRecord(value, path);
  assertRequiredKeys(object, required, path);
  assertOnlyKeys(object, [...required, ...optional], path);
  return object;
}
function stableId(value: unknown, path: string): string {
  const result = requireString(value, path, 96);
  check(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(result), `${path} must be a stable identifier.`);
  return result;
}
/** A finite number within [min, max], optionally a whole number. */
function bounded(value: unknown, path: string, min: number, max: number, integer = false): number {
  return normalizeParamValue({ type: 'number', label: path, defaultValue: min, min, max, step: 1, ...(integer ? { integer } : {}) }, value, path) as number;
}

export function normalizeNodeParams(kind: string, value: unknown, path = `${kind}.params`): GraphParams {
  const input = requireRecord(value, path);
  const params = kind === 'shapes.mapping' && !Object.hasOwn(input, 'pitchMapping') ? { ...input, pitchMapping: 'centered' } : input;
  return normalizeParams(getOperatorDefinition(kind).params, params, path);
}
export function parseWidgetLayout(value: unknown, columns: number): WidgetLayout {
  const layout = strictRecord(value, 'widget.layout', ['x', 'y', 'w', 'h']);
  const x = bounded(layout.x, 'widget.layout.x', 0, columns - 1, true);
  const y = bounded(layout.y, 'widget.layout.y', 0, GRAPH_LIMITS.maxRows - 1, true);
  const w = bounded(layout.w, 'widget.layout.w', 1, columns, true);
  const h = bounded(layout.h, 'widget.layout.h', 1, GRAPH_LIMITS.maxRows, true);
  check(x + w <= columns && y + h <= GRAPH_LIMITS.maxRows, 'widget.layout exceeds the performance surface bounds.');
  return { x, y, w, h };
}
export function parseGraphDocument(input: unknown): GraphDocument {
  let value = input;
  if (typeof value === 'string') {
    assertJsonSize(value, GRAPH_LIMITS.maxJsonBytes);
    try { value = JSON.parse(value); } catch (error) { throw new GraphDocumentError(`Project JSON is invalid.${error instanceof Error ? ` ${error.message}` : ''}`); }
  }
  const d = strictRecord(value, 'project', ['documentType', 'schemaVersion', 'id', 'title', 'nodes', 'edges', 'performance'], ['description', 'learningGoal', 'capabilityNotes', 'presetOrigins']);
  check(d.documentType === 'audiobrain.project', 'project.documentType must be "audiobrain.project".');
  check(d.schemaVersion === 1, `Unsupported schema version "${String(d.schemaVersion)}".`);
  const nodes: GraphNode[] = requireArray(d.nodes, 'project.nodes', GRAPH_LIMITS.maxNodes, 'node').map((entry, index) => {
    const path = `nodes[${index}]`;
    const n = strictRecord(entry, path, ['id', 'kind', 'position', 'params'], ['viewBindings', 'label']);
    const kind = stableId(n.kind, `${path}.kind`);
    check(getOperatorDefinitionOrNull(kind), `${path}.kind is not a registered node kind.`);
    const definition = getOperatorDefinition(kind);
    const position = strictRecord(n.position, `${path}.position`, ['x', 'y']);
    const node: GraphNode = {
      id: stableId(n.id, `${path}.id`), kind,
      position: { x: bounded(position.x, `${path}.position.x`, -100000, 100000), y: bounded(position.y, `${path}.position.y`, -100000, 100000) },
      params: normalizeNodeParams(kind, n.params, `${path}.params`),
    };
    if (n.label !== undefined) node.label = requireString(n.label, `${path}.label`, 96);
    if (n.viewBindings !== undefined) {
      const bindings = requireRecord(n.viewBindings, `${path}.viewBindings`);
      assertOnlyKeys(bindings, definition.views.flatMap(view => view.intents.map(intent => intent.id)), `${path}.viewBindings`);
      node.viewBindings = Object.fromEntries(Object.entries(bindings).map(([key, entry]) => {
        const bindingPath = `${path}.viewBindings.${key}`;
        const b = strictRecord(entry, bindingPath, ['nodePath', 'paramId']);
        const nodePath = requireArray(b.nodePath, `${bindingPath}.nodePath`, 1);
        check(nodePath.length === 1, `${bindingPath}.nodePath must contain one top-level node ID.`);
        return [key, { nodePath: [stableId(nodePath[0], `${bindingPath}.nodePath[0]`)], paramId: stableId(b.paramId, `${bindingPath}.paramId`) }];
      }));
    }
    return node;
  });
  assertUniqueIds(nodes, 'project.nodes');
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    for (const [intentId, binding] of Object.entries(node.viewBindings ?? {})) {
      const target = nodesById.get(binding.nodePath[0]);
      check(target, `View ${node.id} references missing target node "${binding.nodePath[0]}".`);
      const parameter = getParameter(getOperatorDefinition(target.kind), binding.paramId);
      const intent = getOperatorDefinition(node.kind).views.flatMap(view => view.intents).find(candidate => candidate.id === intentId);
      check(parameter && intent && intentAccepts(intent, parameter), `View ${node.id} has an incompatible parameter binding "${intentId}".`);
    }
  }
  const edges = requireArray(d.edges, 'project.edges', GRAPH_LIMITS.maxEdges, 'edge').map((entry, index) => {
    const path = `edges[${index}]`;
    const e = strictRecord(entry, path, ['id', 'source', 'target']);
    const endpoint = (raw: unknown, endpointPath: string) => {
      const p = strictRecord(raw, endpointPath, ['nodeId', 'portId']);
      return { nodeId: stableId(p.nodeId, `${endpointPath}.nodeId`), portId: stableId(p.portId, `${endpointPath}.portId`) };
    };
    return { id: stableId(e.id, `${path}.id`), source: endpoint(e.source, `${path}.source`), target: endpoint(e.target, `${path}.target`) };
  });
  assertUniqueIds(edges, 'project.edges');
  // Upgrade older Shapes views from their explicit graph connections. Authored
  // bindings always win; IDs and saved parameter values remain untouched.
  for (const node of nodes.filter(node => node.kind === 'view.shapes')) {
    const connected = (port: string, kind: string) => nodesById.get(edges.find(edge => edge.target.nodeId === node.id && edge.target.portId === port)?.source.nodeId ?? '')?.kind === kind
      ? edges.find(edge => edge.target.nodeId === node.id && edge.target.portId === port)?.source.nodeId : undefined;
    const geometry = connected('path', 'shapes.geometry');
    const reader = connected('features', 'shapes.reader');
    for (const [intent, targetId, paramId] of [['rotation', geometry, 'rotationDeg'], ['moveX', geometry, 'positionX'], ['moveY', geometry, 'positionY'], ['scrub', reader, 'phaseOffset']]) {
      if (intent && targetId && paramId) { node.viewBindings ??= {}; node.viewBindings[intent] ??= { nodePath: [targetId], paramId }; }
    }
  }
  const surface = strictRecord(d.performance, 'project.performance', ['version', 'columns', 'widgets']);
  check(surface.version === 1, 'project.performance.version must be 1.');
  const columns = bounded(surface.columns, 'project.performance.columns', 1, GRAPH_LIMITS.maxColumns, true);
  const widgets: PerformanceWidget[] = requireArray(surface.widgets, 'project.performance.widgets', GRAPH_LIMITS.maxWidgets, 'widget').map((entry, index) => {
    const path = `widgets[${index}]`;
    const w = strictRecord(entry, path, ['id', 'kind', 'target', 'layout']);
    check(w.kind === 'param' || w.kind === 'view' || w.kind === 'meter', `${path}.kind must be "param", "view" or "meter".`);
    const field = w.kind === 'param' ? 'paramId' : w.kind === 'view' ? 'viewId' : 'portId';
    const target = strictRecord(w.target, `${path}.target`, ['nodePath', field]);
    const nodePath = requireArray(target.nodePath, `${path}.target.nodePath`, 1);
    check(nodePath.length === 1, `${path}.target.nodePath must contain one top-level node ID.`);
    const nodeId = stableId(nodePath[0], `${path}.target.nodePath[0]`);
    const node = nodesById.get(nodeId);
    check(node, `${path} references missing node "${nodeId}".`);
    const operator = getOperatorDefinition(node.kind);
    const targetId = stableId(target[field], `${path}.target.${field}`);
    check(w.kind === 'param' ? Object.hasOwn(operator.params, targetId) : w.kind === 'view' ? operator.views.some(v => v.id === targetId) : operator.outputs.some(p => p.id === targetId && p.type === 'control.f32'), `${path} references ${field} "${targetId}", which "${node.id}" does not have.`);
    return { id: stableId(w.id, `${path}.id`), kind: w.kind, target: { nodePath: [nodeId], [field]: targetId }, layout: parseWidgetLayout(w.layout, columns) };
  });
  assertUniqueIds(widgets, 'project.performance.widgets');
  const document: GraphDocument = { documentType: 'audiobrain.project', schemaVersion: 1, id: stableId(d.id, 'project.id'), title: requireString(d.title, 'project.title', 96), nodes, edges, performance: { version: 1, columns, widgets } };
  if (d.description !== undefined) document.description = requireString(d.description, 'project.description', 4096);
  if (d.learningGoal !== undefined) document.learningGoal = requireString(d.learningGoal, 'project.learningGoal', 4096);
  if (d.capabilityNotes !== undefined) document.capabilityNotes = requireArray(d.capabilityNotes, 'project.capabilityNotes', 16, 'note').map((note, index) => requireString(note, `project.capabilityNotes[${index}]`, 2048));
  if (d.presetOrigins !== undefined) document.presetOrigins = parsePresetOrigins(d.presetOrigins, new Set(nodes.map(node => node.id)));
  if (document.presetOrigins?.length) assertJsonSize(JSON.stringify(document, null, 2), GRAPH_LIMITS.maxJsonBytes);
  return document;
}
function getOperatorDefinitionOrNull(kind: string): boolean {
  try { getOperatorDefinition(kind); return true; } catch { return false; }
}
let generated = 0;
export function createId(prefix: string): string { return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${++generated}`}`; }
export function createNode(kind: string, position: GraphPosition = { x: 80, y: 80 }): GraphNode { return { id: createId(kind), kind, position: { ...position }, params: getDefaultParams(kind) }; }
export function cloneGraphDocument(document: GraphDocument): GraphDocument { return structuredClone(document); }
export function serializeGraphDocument(document: GraphDocument): string { return JSON.stringify(parseGraphDocument(document), null, 2); }
