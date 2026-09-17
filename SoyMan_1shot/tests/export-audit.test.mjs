import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditExport } from '../app/export-audit.mjs';
const entry = (id, kind = 'spell', parent_id = null) => ({ id, kind, parent_id, section_id: 1, name: `Entry ${id}`, level: 1, data: {} });
const catalog = { system: { name: 'D&D 5.5' }, sections: [{ id: 1 }], entries: [entry(1, 'class'), entry(2, 'feature', 1), entry(3), entry(4)] };
test('collects selected records and ancestors without copying other spells', () => {
  const character = { content: { classes: [{ classId: 1 }], features: [{ entryId: 2 }], spells: [{ entryId: 3 }, { entryId: 3 }], manual: [{ name: 'Custom' }] } };
  const before = JSON.stringify(catalog);
  const result = auditExport(character, catalog);
  assert.deepEqual(result.candidate.entries.map(e => e.id), [1, 2, 3]);
  assert.equal(result.entryCount, 3); assert.deepEqual(result.problems, []);
  result.candidate.entries[0].data.changed = true;
  assert.equal(JSON.stringify(catalog), before);
});
test('does not mistake local item or transfer ids for compendium entries', () => {
  const result = auditExport({ content: { items: [{ id: 'local-item', transferIn: { id: 999, fromCharacterId: 123 } }] } }, catalog);
  assert.equal(result.entryCount, 0); assert.deepEqual(result.problems, []);
});
test('reports unresolved references, companions and missing spell circles', () => {
  const source = structuredClone(catalog); source.entries[2].level = null;
  const result = auditExport({ content: { spells: [{ entryId: 3 }, { entryId: 99 }], companions: [{ statblockId: 7 }] } }, source);
  assert.equal(result.problems.length, 3);
});
test('reports external media and handles cyclic ancestry without hanging', () => {
  const source = structuredClone(catalog); source.entries[0].parent_id = 2;
  const result = auditExport({ portrait: '/portrait.png', content: { entryId: 2, notes: '<img src="https://example.test/image.png">' } }, source);
  assert.equal(result.problems.length, 1); assert.equal(result.externalAssets.length, 2);
});
