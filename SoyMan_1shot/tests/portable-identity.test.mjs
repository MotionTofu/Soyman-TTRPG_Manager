import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { portablePayload, renderPortable } from '../app/portable.mjs';
import {
  parsePortableHtml,
  validatePortablePayload,
  decidePortableImport,
  shouldReuseCatalogSlice,
  buildCharacterUpdate,
} from '../app/portable-import.mjs';

const doc = (json) => `<!doctype html><html><body><script id="oneshot-payload" type="application/json">${json}</script></body></html>`;
const slice = () => ({
  system: { id: 1, name: 'D&D 5.5' },
  sections: [{ id: 1, kind: 'spell', name: 'Заклинания' }],
  entries: [{ id: 7, section_id: 1, kind: 'spell', level: 2, name: 'Призыв', data: {} }],
});
const content = (overrides = {}) => ({
  characterName: 'Мордекай', classes: [], abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  hitPointsCurrent: '21', ...overrides,
});
const v2 = (overrides = {}) => ({
  format: 'soyman-1shot-portable', version: 2, exportedAt: '2026-09-21T00:00:00.000Z',
  identity: { characterUid: 'uid-abc' },
  character: { name: 'Мордекай', content: content(), portrait: null },
  catalog: slice(), ...overrides,
});

test('stable round-trip: v2 export -> standalone re-save -> parse keeps the UID and takes new state', async () => {
  const template = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '../generated/standalone-template.html'), 'utf8');
  const payload = portablePayload({ characterUid: 'uid-abc', content: content(), portrait: null }, slice());
  assert.equal(payload.version, 2);
  assert.equal(payload.identity.characterUid, 'uid-abc');
  // Standalone "download updated copy": only content is swapped, identity untouched.
  const replayed = { ...payload, character: { ...payload.character, content: content({ hitPointsCurrent: '3' }) } };
  const parsed = parsePortableHtml(renderPortable(template, replayed));
  assert.equal(parsed.characterUid, 'uid-abc');
  assert.equal(parsed.content.hitPointsCurrent, '3');
  // UID-less payloads stay v1 and parse without identity.
  const legacy = portablePayload({ content: content(), portrait: null }, slice());
  assert.equal(legacy.version, 1);
  assert.ok(!('identity' in legacy));
  assert.equal(parsePortableHtml(doc(JSON.stringify(legacy))).characterUid, null);
});

test('v1 and unknown v2 UIDs import as new characters', () => {
  const locals = [{ id: 14, name: 'Мордекай', characterUid: 'uid-abc' }];
  const fromV1 = parsePortableHtml(doc(JSON.stringify({ ...v2(), version: 1, identity: undefined })));
  assert.equal(fromV1.characterUid, null);
  assert.deepEqual(decidePortableImport({ characterUid: fromV1.characterUid, characters: locals }), { action: 'create' });
  const unknown = validatePortablePayload(v2({ identity: { characterUid: 'uid-nope' } }));
  assert.equal(unknown.characterUid, 'uid-nope');
  assert.deepEqual(decidePortableImport({ characterUid: unknown.characterUid, characters: locals }), { action: 'create' });
});

test('known UID asks to update; replace keeps id and UID and applies file state', () => {
  const local = { id: 14, name: 'Мордекай', content: content({ hitPointsCurrent: '21' }), portrait: null, catalogKey: 'slice-old', revision: 5, characterUid: 'uid-abc' };
  const decision = decidePortableImport({ characterUid: 'uid-abc', characters: [local] });
  assert.equal(decision.action, 'confirm');
  assert.equal(decision.match.id, 14);
  const updated = buildCharacterUpdate(local, {
    name: 'Мордекай', content: content({ hitPointsCurrent: '3' }),
    portrait: 'data:image/png;base64,iVBORw0KGgo=', catalogKey: 'slice-new',
  });
  assert.equal(updated.id, 14);
  assert.equal(updated.characterUid, 'uid-abc');
  assert.equal(updated.revision, 6);
  assert.equal(updated.content.hitPointsCurrent, '3');
  assert.equal(updated.portrait, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(updated.catalogKey, 'slice-new');
});

test('duplicate local UIDs never silently pick a record', () => {
  const dupes = [
    { id: 14, name: 'Мордекай', characterUid: 'uid-abc' },
    { id: 15, name: 'Мордекай', characterUid: 'uid-abc' },
  ];
  const decision = decidePortableImport({ characterUid: 'uid-abc', characters: dupes });
  assert.equal(decision.action, 'conflict');
  assert.equal(decision.matches.length, 2);
});

test('private portable slices are reused; shared, current and managed ones are not', () => {
  const privateSlice = { catalogKey: 's1', catalog: slice(), referencedByCount: 1, isCurrent: false };
  assert.equal(shouldReuseCatalogSlice(privateSlice), true);
  assert.equal(shouldReuseCatalogSlice({ ...privateSlice, referencedByCount: 2 }), false);
  assert.equal(shouldReuseCatalogSlice({ ...privateSlice, isCurrent: true }), false);
  assert.equal(shouldReuseCatalogSlice({ ...privateSlice, catalog: { ...slice(), metadata: { id: 'dnd55-ru-1' } } }), false);
  assert.equal(shouldReuseCatalogSlice({ ...privateSlice, catalogKey: '' }), false);
});
