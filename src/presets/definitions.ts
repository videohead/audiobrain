import { parseGraphDocument } from '../graph/model';
import { GRAPH_LIMITS } from '../graph/operators';
import type { GraphDocument } from '../graph/types';
import type { PresetDefinition } from './types';
import { GraphDocumentError } from '@brain/control/graph/validation';
import { exactKeys, identifier, object, parseSourceRecipe, string } from './validation';

export function parsePresetDefinition(input: unknown): PresetDefinition {
  let value = input;
  if (typeof value === 'string') {
    if (value.length > GRAPH_LIMITS.maxJsonBytes || new TextEncoder().encode(value).byteLength > GRAPH_LIMITS.maxJsonBytes) throw new GraphDocumentError(`Preset exceeds the ${GRAPH_LIMITS.maxJsonBytes}-byte limit.`);
    value = JSON.parse(value) as unknown;
  }
  const d = object(value, 'preset');
  exactKeys(d, ['documentType', 'schemaVersion', 'id', 'title', 'description', 'recipe'], 'preset');
  if (d.documentType !== 'audiobrain.instrument-preset' || d.schemaVersion !== 1) throw new GraphDocumentError('preset.documentType must be "audiobrain.instrument-preset" and preset.schemaVersion must be 1.');
  const recipe = object(d.recipe, 'preset recipe');
  let parsed: PresetDefinition['recipe'];
  if (recipe.kind === 'graph') {
    exactKeys(recipe, ['kind', 'graph'], 'graph recipe');
    parsed = { kind: 'graph', graph: parseGraphDocument(recipe.graph) };
  } else parsed = parseSourceRecipe(recipe);
  const definition: PresetDefinition = { documentType: 'audiobrain.instrument-preset', schemaVersion: 1, id: identifier(d.id, 'preset ID'), title: string(d.title, 'preset title', 96), ...(d.description === undefined ? {} : { description: string(d.description, 'preset description', 4096) }), recipe: parsed };
  if (new TextEncoder().encode(JSON.stringify(definition, null, 2)).byteLength > GRAPH_LIMITS.maxJsonBytes) throw new GraphDocumentError(`Preset exceeds the ${GRAPH_LIMITS.maxJsonBytes}-byte limit.`);
  return definition;
}
export function serializePresetDefinition(definition: PresetDefinition): string {
  return JSON.stringify(parsePresetDefinition(definition), null, 2);
}
export function graphPresetDefinition(graph: GraphDocument): PresetDefinition {
  return { documentType: 'audiobrain.instrument-preset', schemaVersion: 1, id: graph.id, title: graph.title, ...(graph.description ? { description: graph.description } : {}), recipe: { kind: 'graph', graph: parseGraphDocument(graph) } };
}
