import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creatureCardPayload, parseCatalog, repairSpellLevels, searchEntries } from '../app/catalog.mjs';
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
test('bestiary creature card survives parsing without foreign fields', () => {
  const raw = fixture();
  raw.sections.push({ id: 3, name: 'Бестиарий', kind: 'monster' });
  raw.entries.push({ id: 20, section_id: 3, name: 'Волк', kind: 'monster', data: {}, creature: { tactics: ['Стая'], combat_roles: [1, 'Громила'], secret: 'только Мастеру', statblock: { id: 5, kind: 'full', format: 'dnd_creature', content: '{"name":"Волк"}', avatar_image_path: 'C:/vault/wolf.png' } } });
  const wolf = parseCatalog(raw).entries.find(e => e.id === 20);
  assert.deepEqual(wolf.creature, { combat_roles: ['Громила'], tactics: ['Стая'], statblock: { id: 5, kind: 'full', format: 'dnd_creature', content: '{"name":"Волк"}', theme: null, density: null } });
  assert.equal('creature' in parseCatalog(fixture()).entries[0], false);
  const card = creatureCardPayload(wolf, 'data:image/webp;base64,AA==');
  assert.equal(card.secret, '');
  assert.equal(card.statblock.content, '{"name":"Волк"}');
  assert.equal(card.avatar_image_url, 'data:image/webp;base64,AA==');
  assert.equal(creatureCardPayload({ id: 1, name: 'Без карточки' }, null).statblock, null);
});
test('search folds case and ё, filters kinds and puts prefix matches first', () => {
  const entries = [
    { id: 1, name: 'Скот', kind: 'monster', aliases: [], name_original: '' },
    { id: 2, name: 'Кот', kind: 'monster', aliases: [], name_original: 'Cat' },
    { id: 3, name: 'Котёл', kind: 'equipment', aliases: [], name_original: '' },
    { id: 4, name: 'Ёж', kind: 'monster', aliases: ['колючка'], name_original: '' },
  ];
  assert.deepEqual(searchEntries(entries, 'КОТ', ['monster']).map(r => r.id), [2, 1]);
  assert.deepEqual(searchEntries(entries, 'cat', null).map(r => r.id), [2]);
  assert.deepEqual(searchEntries(entries, 'еж', ['monster']).map(r => r.id), [4]);
  assert.deepEqual(searchEntries(entries, 'колюч', ['monster']).map(r => r.title), ['Ёж']);
  assert.deepEqual(searchEntries(entries, '  ', null), []);
  assert.equal(searchEntries(entries, 'кот', ['monster'])[0].type, 'compendium_entry');
});
