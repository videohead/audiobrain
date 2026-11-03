import { reachableUpstream, topologicalOrder } from '@brain/control/graph/algorithms';
import {
  GraphCompileError as BaseGraphCompileError,
  checkConnection,
  cycleIssue,
  validateEdges,
  type CommonIssueCode,
  type ConnectionValidation as BaseConnectionValidation,
  type GraphIssue as BaseGraphIssue,
  type PortLookup,
} from '@brain/control/graph/issues';
import { parseGraphDocument } from './model';
import { GRAPH_LIMITS, getOperatorDefinition } from './operators';
import type { GraphDocument, GraphEndpoint, GraphNode, OperatorDefinition, PortDefinition, SignalType } from './types';

export type GraphIssueCode = CommonIssueCode | 'required-input' | 'invalid-document';
export type GraphIssue = BaseGraphIssue<GraphIssueCode>;
export type ConnectionValidation = BaseConnectionValidation<GraphIssueCode>;
export interface CompiledInputBinding { edgeId: string; sourceNodeId: string; sourcePortId: string; type: SignalType }
export interface CompiledNode { node: GraphNode; definition: OperatorDefinition; inputs: Record<string, CompiledInputBinding> }
export interface CompiledGraph { document: GraphDocument; nodes: CompiledNode[]; reachableNodeIds: Set<string> }
export class GraphCompileError extends BaseGraphCompileError<GraphIssue> {}

const PORTS: PortLookup<GraphNode, PortDefinition> = {
  output: (node, portId) => getOperatorDefinition(node.kind).outputs.find(port => port.id === portId),
  input: (node, portId) => getOperatorDefinition(node.kind).inputs.find(port => port.id === portId),
};
const invalid = (error: unknown): GraphIssue[] => [{ code: 'invalid-document', message: error instanceof Error ? error.message : 'Invalid project.' }];

export function compileGraph(input: GraphDocument): CompiledGraph {
  let document: GraphDocument;
  try { document = parseGraphDocument(input); } catch (error) { throw new GraphCompileError(invalid(error)); }
  const issues: GraphIssue[] = [];
  const nodeById = new Map(document.nodes.map(node => [node.id, node]));
  const nodes = new Map<string, CompiledNode>(document.nodes.map(node => [node.id, { node, definition: getOperatorDefinition(node.kind), inputs: Object.create(null) as Record<string, CompiledInputBinding> }]));
  const valid = validateEdges(document.edges, nodeById, PORTS, issues);
  for (const { edge, sourcePort } of valid) {
    (nodes.get(edge.target.nodeId) as CompiledNode).inputs[edge.target.portId] = { edgeId: edge.id, sourceNodeId: edge.source.nodeId, sourcePortId: sourcePort.id, type: sourcePort.type };
  }
  const accepted = valid.map(({ edge }) => edge);
  const { order: ordered, cycleNodeIds } = topologicalOrder(nodes.keys(), accepted);
  if (cycleNodeIds.length) issues.push(cycleIssue(cycleNodeIds));
  const roots = [...nodes.values()].filter(node => node.definition.demandRoot !== null).map(node => node.node.id);
  // Pinning a scalar output also creates demand for that producer.
  for (const widget of document.performance.widgets) if (widget.kind === 'meter' || widget.kind === 'view') roots.push(widget.target.nodePath[0]);
  const reachableNodeIds = reachableUpstream(nodes.keys(), accepted, roots);
  for (const id of reachableNodeIds) {
    const node = nodes.get(id) as CompiledNode;
    for (const port of node.definition.inputs) {
      if (port.required && !node.inputs[port.id]) issues.push({ code: 'required-input', nodeId: id, message: `${node.definition.title}: connect the ${port.label} input.` });
    }
  }
  if (issues.length) throw new GraphCompileError(issues);
  return { document, nodes: ordered.filter(id => reachableNodeIds.has(id)).map(id => nodes.get(id) as CompiledNode), reachableNodeIds };
}
export function tryCompileGraph(document: GraphDocument): { ok: true; graph: CompiledGraph } | { ok: false; issues: readonly GraphIssue[] } {
  try { return { ok: true, graph: compileGraph(document) }; }
  catch (error) { return { ok: false, issues: error instanceof GraphCompileError ? error.issues : invalid(error) }; }
}
/** Whether a cable may be added. A cable into a graph that is merely unfinished (a missing required input) is fine. */
export function validateConnection(document: GraphDocument, source: GraphEndpoint, target: GraphEndpoint): ConnectionValidation {
  return checkConnection({ nodes: document.nodes, edges: document.edges, source, target, ports: PORTS, maxEdges: GRAPH_LIMITS.maxEdges }) ?? { valid: true };
}
