import { GraphDocumentError, assertOnlyKeys, requireArray, requireRecord, requireString } from '@brain/control/graph/validation';
import type { JsonValue, PresetSource, SourceRecipe, PresetOrigin } from './types';

/** Preset records use the same validation primitives and sentences as the graph document. `label` names the field in the message. */

export function object(value: unknown, label: string): Record<string, unknown> {
  return requireRecord(value, label);
}
export function string(value: unknown, label: string, max = 256): string {
  return requireString(value, label, max);
}
export function identifier(value: unknown, label: string): string {
  const result = requireString(value, label, 96);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(result)) throw new GraphDocumentError(`${label} must be a stable identifier.`);
  return result;
}
export function exactKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  assertOnlyKeys(value, allowed, label);
}
export function jsonValue(value: unknown): JsonValue {
  let count = 0;
  const visit = (input: unknown, depth: number): JsonValue => {
    if (depth > 32 || ++count > 20_000) throw new GraphDocumentError('Preset settings exceed the structural limit.');
    if (input === null || typeof input === 'boolean' || typeof input === 'string') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (Array.isArray(input)) return input.map(item => visit(item, depth + 1));
    if (input && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype) return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, visit(item, depth + 1)]));
    throw new GraphDocumentError('Preset settings must contain finite JSON data.');
  };
  const result = visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 262_144) throw new GraphDocumentError('Preset settings exceed the 262144-byte limit.');
  return result;
}
export function parseSource(value: unknown): PresetSource {
  const s = object(value, 'preset source');
  exactKeys(s, ['repository', 'revision', 'path', 'exportName', 'sha256', 'notices'], 'preset source');
  const source: PresetSource = { repository: string(s.repository, 'repository', 512), revision: string(s.revision, 'revision'), path: string(s.path, 'source path', 512), exportName: string(s.exportName, 'source export'), sha256: string(s.sha256, 'source fingerprint') };
  if (!/^[a-f0-9]{40}$/.test(source.revision) || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new GraphDocumentError('Preset source requires an exact revision and SHA-256 fingerprint.');
  if (s.notices !== undefined) {
    source.notices = requireArray(s.notices, 'preset source.notices', 8, 'notice').map(entry => {
      const n = object(entry, 'source notice');
      exactKeys(n, ['path', 'sha256', 'text'], 'source notice');
      const notice = { path: string(n.path, 'notice path', 512), sha256: string(n.sha256, 'notice fingerprint', 64), text: string(n.text, 'notice text', 65_536) };
      if (!/^[a-f0-9]{64}$/.test(notice.sha256)) throw new GraphDocumentError('source notice.sha256 must be a SHA-256 fingerprint.');
      return notice;
    });
  }
  return source;
}
export function parseSourceRecipe(value: unknown): SourceRecipe {
  const r = object(value, 'source recipe');
  exactKeys(r, ['kind', 'familyId', 'sourceId', 'category', 'settings', 'source'], 'source recipe');
  if (r.kind !== 'morphazoid') throw new GraphDocumentError('source recipe.kind must be "morphazoid".');
  return { kind: 'morphazoid', familyId: identifier(r.familyId, 'preset family'), sourceId: string(r.sourceId, 'source preset ID'), category: string(r.category, 'preset category'), settings: jsonValue(r.settings), source: parseSource(r.source) };
}
export function parsePresetOrigins(value: unknown, nodeIds: Set<string>): PresetOrigin[] {
  const origins = requireArray(value, 'preset origins', 128, 'origin').map(entry => {
    const o = object(entry, 'preset origin');
    exactKeys(o, ['instanceId', 'presetId', 'title', 'adapterVersion', 'nodeIds', 'recipe'], 'preset origin');
    if (o.adapterVersion !== 1) throw new GraphDocumentError('preset origin.adapterVersion must be 1.');
    const ids = requireArray(o.nodeIds, 'preset origin.nodeIds', 128, 'node').map(value => identifier(value, 'preset node'));
    if (new Set(ids).size !== ids.length || ids.some(id => !nodeIds.has(id))) throw new GraphDocumentError('preset origin.nodeIds contains a duplicate or missing node.');
    return { instanceId: identifier(o.instanceId, 'preset instance'), presetId: identifier(o.presetId, 'preset ID'), title: string(o.title, 'preset title', 96), adapterVersion: 1 as const, nodeIds: ids, recipe: parseSourceRecipe(o.recipe) };
  });
  if (new Set(origins.map(origin => origin.instanceId)).size !== origins.length) throw new GraphDocumentError('preset origins contain duplicate instance IDs.');
  return origins;
}
