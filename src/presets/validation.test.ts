import { describe, expect, it } from 'vitest';
import { GraphDocumentError } from '@brain/control/graph/validation';
import { exactKeys, identifier, jsonValue, object, parsePresetOrigins, parseSourceRecipe, string } from './validation';

const message = (run: () => unknown) => { try { run(); } catch (error) { expect(error).toBeInstanceOf(GraphDocumentError); return (error as Error).message; } return null; };
const hex40 = 'a'.repeat(40);
const hex64 = 'b'.repeat(64);
const source = { repository: 'https://example.test/repo', revision: hex40, path: 'src/a.js', exportName: 'presets', sha256: hex64 };
const recipe = { kind: 'morphazoid', familyId: 'l-systems', sourceId: 'tree', category: 'plants', settings: { angle: 25 }, source };
const origin = { instanceId: 'instance-1', presetId: 'preset-1', title: 'Tree', adapterVersion: 1, nodeIds: ['a', 'b'], recipe };

describe('preset records use the shared validation wording', () => {
  it('describes the primitive checks the same way the graph document does', () => {
    expect(message(() => object([], 'preset'))).toBe('preset must be an object.');
    expect(message(() => string('', 'preset title'))).toBe('preset title must be a non-empty string.');
    expect(message(() => string('x'.repeat(300), 'repository'))).toBe('repository must be at most 256 characters.');
    expect(message(() => identifier('has space', 'preset ID'))).toBe('preset ID must be a stable identifier.');
    expect(message(() => exactKeys({ a: 1, b: 2 }, ['a'], 'preset'))).toBe('preset.b is not supported.');
  });
  it('bounds settings with the same byte-limit wording', () => {
    expect(message(() => jsonValue({ a: Number.NaN }))).toBe('Preset settings must contain finite JSON data.');
    expect(message(() => jsonValue({ big: 'x'.repeat(262_200) }))).toBe('Preset settings exceed the 262144-byte limit.');
    expect(message(() => jsonValue(JSON.parse('{"a":'.repeat(40) + '1' + '}'.repeat(40))))).toBe('Preset settings exceed the structural limit.');
  });
  it('rejects a malformed source and recipe with named fields', () => {
    expect(message(() => parseSourceRecipe({ ...recipe, kind: 'other' }))).toBe('source recipe.kind must be "morphazoid".');
    expect(message(() => parseSourceRecipe({ ...recipe, extra: 1 }))).toBe('source recipe.extra is not supported.');
    expect(message(() => parseSourceRecipe({ ...recipe, source: { ...source, revision: 'abc' } }))).toBe('Preset source requires an exact revision and SHA-256 fingerprint.');
    expect(message(() => parseSourceRecipe({ ...recipe, source: { ...source, notices: Array(9).fill({ path: 'p', sha256: hex64, text: 't' }) } }))).toBe('preset source.notices exceeds the 8-notice limit.');
    expect(message(() => parseSourceRecipe({ ...recipe, source: { ...source, notices: [{ path: 'p', sha256: 'bad', text: 't' }] } }))).toBe('source notice.sha256 must be a SHA-256 fingerprint.');
  });
  it('accepts a valid origin and explains each way one can be wrong', () => {
    const nodes = new Set(['a', 'b']);
    expect(parsePresetOrigins([origin], nodes)).toHaveLength(1);
    expect(message(() => parsePresetOrigins('x', nodes))).toBe('preset origins must be an array.');
    expect(message(() => parsePresetOrigins(Array(129).fill(origin), nodes))).toBe('preset origins exceeds the 128-origin limit.');
    expect(message(() => parsePresetOrigins([{ ...origin, adapterVersion: 2 }], nodes))).toBe('preset origin.adapterVersion must be 1.');
    expect(message(() => parsePresetOrigins([{ ...origin, nodeIds: ['a', 'a'] }], nodes))).toBe('preset origin.nodeIds contains a duplicate or missing node.');
    expect(message(() => parsePresetOrigins([{ ...origin, nodeIds: ['a', 'zzz'] }], nodes))).toBe('preset origin.nodeIds contains a duplicate or missing node.');
    expect(message(() => parsePresetOrigins([origin, origin], nodes))).toBe('preset origins contain duplicate instance IDs.');
  });
});
