import { cloneGraphDocument, createId, parseGraphDocument } from '../graph/model';
import { compileGraph, GraphCompileError, tryCompileGraph } from '../graph/compiler';
import { PRESETS } from '../graph/presets';
import type { GraphDocument } from '../graph/types';
import { branchGeometry, expandGrammar } from '../instruments/geometry';
import { GraphDocumentError } from '@brain/control/graph/validation';
import { exactKeys, object, string } from './validation';
import type { PresetAssessment, PresetDefinition } from './types';

const TOPOLOGIES = ['chain', 'tree', 'dag', 'bipartite', 'ring', 'smallworld', 'hub', 'mesh', 'modular', 'random'];
export function assessFamily(familyId: string): PresetAssessment {
  if (familyId === 'l-system-grammars') return { ready: true, requirements: ['Rebuilds the original grammar and geometry inside an AudioBrain notes instrument. The source page’s separate synth, drums, microphone and mix settings are not part of a grammar preset.'], description: 'Original grammar, iteration count, turning and drawing rules; generated graph and performance layout.' };
  if (familyId === 'graph-topologies') return { ready: true, requirements: ['Rebuilds the topology component with explicit seed, density and node count. AudioBrain supplies the preview voice and timing; this is not a complete Graph Delay, Synth or Drums patch.'], description: 'Original graph generator, connected to an AudioBrain traversal, voice and performance view.' };
  if (familyId === 'graph-instrument-patches' || familyId === 'graph-delay-patches') return { ready: false, requirements: ['The complete source patch needs its saved edge timing, propagation, feedback, tuning and sound engine. Every original setting remains preserved; a generic graph is not substituted.'], description: 'Complete original patch archived for reconstruction when its required engines are available.' };
  if (familyId === 'shapes-defaults') return { ready: false, requirements: ['The full Shapes state includes higher dimensions, per-mode memories and the Rattlesnake bank. Current Shapes examples cover only the implemented parts.'], description: 'Original complete Shapes default state, including inactive dimension and sound settings.' };
  return { ready: false, requirements: ['This source component or instrument needs a validated adapter and its matching operators. Its settings can be exported intact now.'], description: 'Original settings preserved independently of the page.' };
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new GraphDocumentError(`${label} must be a finite number.`);
  return value;
}
function textOrDefault(value: unknown, fallback: string, label: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new GraphDocumentError(`${label} must be a string.`);
  return value;
}
function freshInstance(graph: GraphDocument): GraphDocument {
  const ids = new Map(graph.nodes.map(node => [node.id, createId('node')]));
  graph.id = createId('project');
  for (const node of graph.nodes) {
    node.id = ids.get(node.id)!;
    for (const binding of Object.values(node.viewBindings ?? {})) binding.nodePath = [ids.get(binding.nodePath[0])!];
  }
  for (const edge of graph.edges) { edge.id = createId('edge'); edge.source.nodeId = ids.get(edge.source.nodeId)!; edge.target.nodeId = ids.get(edge.target.nodeId)!; }
  for (const widget of graph.performance.widgets) { widget.id = createId('widget'); widget.target.nodePath = [ids.get(widget.target.nodePath[0])!]; }
  return graph;
}

/** An adapter maps domain settings onto the existing graph model, never a second runtime. */
export function reconstructPreset(definition: PresetDefinition): GraphDocument {
  if (definition.recipe.kind === 'graph') {
    const graph = parseGraphDocument(definition.recipe.graph);
    const result = tryCompileGraph(graph);
    if (!result.ok) {
      // Authored drafts can keep disconnected inputs, as ordinary projects do.
      // Invalid cables and cycles still cannot replace the current instrument.
      const fatal = result.issues.filter(issue => issue.code !== 'required-input');
      if (fatal.length) throw new GraphCompileError(fatal);
    }
    return graph;
  }
  const recipe = definition.recipe;
  const assessment = assessFamily(recipe.familyId);
  if (!assessment.ready) throw new Error(`Cannot rebuild ${definition.title} yet. ${assessment.requirements.join(' ')}`);
  const raw = object(recipe.settings, 'source settings');
  let graph: GraphDocument;
  if (recipe.familyId === 'l-system-grammars') {
    exactKeys(raw, ['id', 'name', 'axiom', 'rules', 'iterations', 'maxIterations', 'angle', 'lengthScale', 'drawSymbols', 'moveSymbols', 'turnAsymmetry'], 'L-System grammar preset');
    const rules = Object.entries(object(raw.rules, 'grammar rules')).map(([symbol, replacement]) => {
      if (symbol.length !== 1 || /[\s;=]/.test(symbol) || typeof replacement !== 'string' || /[\n;]/.test(replacement) || replacement.trim() !== replacement) throw new Error('The grammar has a production that cannot be represented losslessly');
      return `${symbol} -> ${replacement}`;
    }).join('\n');
    graph = cloneGraphDocument(PRESETS[1]!);
    const grammar = graph.nodes.find(node => node.kind === 'lsystem.grammar')!;
    const geometry = graph.nodes.find(node => node.kind === 'lsystem.geometry')!;
    grammar.params = { ...grammar.params, axiom: string(raw.axiom, 'axiom', 128), rules, iterations: number(raw.iterations, 'iterations') };
    geometry.params = { ...geometry.params, angleDeg: number(raw.angle, 'angle'), lengthScale: number(raw.lengthScale, 'length scale'), drawSymbols: textOrDefault(raw.drawSymbols, 'F', 'draw symbols'), moveSymbols: textOrDefault(raw.moveSymbols, '', 'move symbols'), turnAsymmetry: raw.turnAsymmetry === undefined ? 0 : number(raw.turnAsymmetry, 'turn asymmetry') };
    // Validate bounds first, then require the complete trace. No iteration
    // reduction, geometry truncation, or default grammar fallback is allowed.
    graph = parseGraphDocument(graph);
    branchGeometry(expandGrammar(String(grammar.params.axiom), rules, Number(grammar.params.iterations)), Number(geometry.params.angleDeg), Number(geometry.params.lengthScale), { drawSymbols: String(geometry.params.drawSymbols), moveSymbols: String(geometry.params.moveSymbols), turnAsymmetry: Number(geometry.params.turnAsymmetry) });
  } else {
    exactKeys(raw, ['label', 'family', 'description', 'cyclic'], 'Graph topology component');
    if (!TOPOLOGIES.includes(recipe.sourceId)) throw new GraphDocumentError('Graph topology component.sourceId is not a known original topology.');
    graph = cloneGraphDocument(PRESETS[2]!);
    const topology = graph.nodes.find(node => node.kind === 'graph.topology')!;
    topology.params = { ...topology.params, topology: recipe.sourceId, nodeCount: 12, density: .36, seed: 17 };
    graph.performance.widgets = graph.performance.widgets.filter(widget => !['layers', 'nodesPerLayer'].includes(widget.target.paramId ?? ''));
    graph.performance.widgets.push(
      { id: 'source-topology', kind: 'param', target: { nodePath: [topology.id], paramId: 'topology' }, layout: { x: 0, y: 7, w: 4, h: 1 } },
      { id: 'source-node-count', kind: 'param', target: { nodePath: [topology.id], paramId: 'nodeCount' }, layout: { x: 4, y: 7, w: 4, h: 1 } },
      { id: 'source-density', kind: 'param', target: { nodePath: [topology.id], paramId: 'density' }, layout: { x: 8, y: 7, w: 4, h: 1 } },
    );
  }
  freshInstance(graph);
  graph.title = definition.title;
  graph.description = `${definition.description ?? assessment.description} ${assessment.requirements.join(' ')}`;
  graph.capabilityNotes = [...graph.capabilityNotes ?? [], ...assessment.requirements, 'The original preset record remains in this project’s presetOrigins. Live edits belong to node parameters.'];
  graph.presetOrigins = [{ instanceId: createId('preset-instance'), presetId: definition.id, title: definition.title, adapterVersion: 1, nodeIds: graph.nodes.map(node => node.id), recipe: structuredClone(recipe) }];
  const result = parseGraphDocument(graph);
  compileGraph(result);
  return result;
}
