import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { portablePayload, renderPortable } from '../app/portable.mjs';
import {
  extractPortablePayload,
  validatePortablePayload,
  parsePortableHtml,
  portableError,
} from '../app/portable-import.mjs';

const doc = (json) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body><div id="root"></div><script id="oneshot-payload" type="application/json">${json}</script><script>var app=1;</script></body></html>`;
const v1 = (overrides = {}) => ({
  format: 'soyman-1shot-portable',
  version: 1,
  exportedAt: '2026-09-21T00:00:00.000Z',
  character: {
    name: 'Мордекай',
    content: { characterName: 'Мордекай', classes: [], abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
    portrait: null,
  },
  catalog: {
    system: { id: 1, name: 'D&D 5.5' },
    sections: [{ id: 1, kind: 'spell', name: 'Заклинания' }],
    entries: [{ id: 7, section_id: 1, kind: 'spell', level: 2, name: 'Призыв', data: {} }],
  },
  ...overrides,
});

test('round-trip: export -> HTML -> import recovers runtime state, slice, portrait and name', async () => {
  const template = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '../generated/standalone-template.html'), 'utf8');
  const content = {
    characterName: 'HTML test </script><script>window.injected=true</script>',
    classes: [],
    abilities: { str: 12, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
    inspiration: true,
    companions: [{ entryId: null, name: 'Тестовый спутник', spellEntryId: 7, spellLevel: 2, hpUsed: 4 }],
  };
  const catalog = { system: { id: 1, name: 'D&D 5.5' }, sections: [{ id: 1, kind: 'spell', name: 'Заклинания' }], entries: [{ id: 7, section_id: 1, kind: 'spell', level: 2, name: 'Призыв', data: { summon: { name: 'Тестовый спутник', hp: '5+5*spell', ac: '14', dismissable: true, actions: [{ name: 'Удар', note: 'Тест' }] } } }] };
  const payload = portablePayload({ content, portrait: 'data:image/png;base64,iVBORw0KGgo=' }, catalog);
  const parsed = parsePortableHtml(renderPortable(template, payload));
  // Current runtime state, not the export-time snapshot.
  assert.deepEqual(parsed.content, content);
  assert.equal(parsed.content.inspiration, true);
  assert.equal(parsed.content.companions[0].hpUsed, 4);
  // Script-breaking name survives escaped and unescaped without execution.
  assert.equal(parsed.content.characterName, content.characterName);
  assert.equal(parsed.name, content.characterName);
  assert.deepEqual(parsed.catalog.entries.map((e) => e.id), [7]);
  assert.equal(parsed.portrait, 'data:image/png;base64,iVBORw0KGgo=');
});

test('plain HTML without the exporter container is rejected', () => {
  assert.throws(() => parsePortableHtml('<html><body>hello</body></html>'), (e) => e.code === 'unsupported-file');
  assert.throws(() => parsePortableHtml(JSON.stringify({ format: 'soyman-1shot-backup', version: 1 })), (e) => e.code === 'unsupported-file');
  assert.throws(() => extractPortablePayload(42), (e) => e.code === 'unsupported-file');
});

test('damaged payloads are rejected with codes and save nothing', () => {
  assert.throws(() => parsePortableHtml(doc('{"format":"soyman-1shot-portable","version":1,')), (e) => e.code === 'damaged-payload');
  assert.throws(() => validatePortablePayload(v1({ version: 99 })), (e) => e.code === 'unsupported-version');
  assert.throws(() => validatePortablePayload(v1({ version: 2 })), (e) => e.code === 'damaged-payload');
  assert.throws(() => validatePortablePayload(v1({ format: 'other' })), (e) => e.code === 'unsupported-file');
  assert.throws(() => validatePortablePayload(v1({ character: { name: 'Без контента' } })), (e) => e.code === 'invalid-character');
  assert.throws(() => validatePortablePayload(v1({ character: { name: 'X', content: {}, portrait: 'https://evil.test/a.png' } })), (e) => e.code === 'invalid-character');
  const orphan = v1();
  orphan.catalog.entries[0].parent_id = 999;
  assert.throws(() => validatePortablePayload(orphan), (e) => e.code === 'invalid-catalog');
  assert.equal(portableError('damaged-payload').code, 'damaged-payload');
});

test('import data carries no local identity; sheet name wins over container name', () => {
  const parsed = parsePortableHtml(doc(JSON.stringify(v1())));
  assert.ok(!('id' in parsed) && !('catalogKey' in parsed));
  assert.equal(parsed.name, 'Мордекай');
  const renamed = v1({ character: { name: 'Контейнер', content: { characterName: 'Лист', classes: [], abilities: {} }, portrait: null } });
  assert.equal(validatePortablePayload(renamed).name, 'Лист');
  const unnamed = v1({ character: { name: '', content: { classes: [], abilities: {} }, portrait: null } });
  assert.equal(validatePortablePayload(unnamed).name, 'Импортированный персонаж');
});

test('hand-built old v1 HTML without new fields still imports', () => {
  const { exportedAt, ...old } = v1();
  const parsed = parsePortableHtml(doc(JSON.stringify(old)));
  assert.equal(parsed.catalog.system.code, 'dnd55');
  assert.equal(parsed.catalog.entries.length, 1);
  assert.equal(parsed.portrait, null);
});
