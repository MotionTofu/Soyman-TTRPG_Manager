import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog, repairSpellLevels } from '../app/catalog.mjs';
const fixture = () => ({ system: { id: 7, name: 'D&D 5.5', folder_path: 'private/path' }, sections: [{ id: 2, name: 'Классы', kind: 'class' }], entries: [{ id: 10, section_id: 2, parent_id: null, name: 'Тестовый класс', kind: 'class', data: { hit_die: 'к10' }, folder_path: 'private/entry' }] });
test('spell circles survive export and legacy repair leaves pinned mechanics intact', () => {
  const raw = fixture();
  raw.entries = [0, 1, 3, 9].map(level => ({ ...raw.entries[0], id: 100 + level, name: `Spell ${level}`, kind: 'spell', level }));
  const current = parseCatalog(raw);
  assert.deepEqual(current.entries.map(e => e.level), [0, 1, 3, 9]);
  const old = structuredClone(current); old.entries.forEach(e => { delete e.level; e.data = { pinned: true }; });
  const repaired = repairSpellLevels(old, current);
  assert.deepEqual(repaired.entries.map(e => e.level), [0, 1, 3, 9]);
  assert.deepEqual(repaired.entries[0].data, { pinned: true });
  assert.equal(old.entries[0].level, undefined);
});
test('catalog keeps mechanical ids and data, strips top-level filesystem metadata', () => {
  const source = fixture(); const result = parseCatalog(source);
  assert.equal(result.system.id, 1); assert.equal(result.entries[0].id, 10); assert.equal(result.entries[0].data.hit_die, 'к10');
  assert.equal(result.system.folder_path, undefined); assert.equal(result.entries[0].folder_path, undefined);
  result.entries[0].data.hit_die = 'к6'; assert.equal(source.entries[0].data.hit_die, 'к10');
});
test('catalog rejects duplicated ids and broken parent references before import', () => {
  const duplicate = fixture(); duplicate.entries.push({ ...duplicate.entries[0] }); assert.throws(() => parseCatalog(duplicate));
  const missing = fixture(); missing.entries[0].parent_id = 999; assert.throws(() => parseCatalog(missing));
  assert.throws(() => parseCatalog({ system: { name: 'Other' }, sections: [], entries: [] }));
});
test('catalog keeps a preview when a large embedded card is omitted later', () => {
  const source = fixture();
  source.entries[0].avatar_preview_data = { mime: 'image/webp', base64: 'cHJldmlldw==' };
  source.entries[0].avatar_data = { mime: 'image/webp', base64: 'bGFyZ2U=' };
  const result = parseCatalog(source);
  assert.match(result.entries[0].avatar_preview_url, /^data:image\/webp;base64,/);
  assert.match(result.entries[0].avatar_large_url, /^data:image\/webp;base64,/);
  delete result.entries[0].avatar_large_url;
  assert.match(result.entries[0].avatar_preview_url, /^data:image\/webp;base64,/);
});
