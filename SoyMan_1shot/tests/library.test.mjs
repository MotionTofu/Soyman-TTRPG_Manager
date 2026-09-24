import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeCharacters,
  archivedCharacters,
  buildDuplicatePayload,
  canDuplicate,
  chainSaveOperation,
  copyNameFor,
  displayName,
  isArchived,
  isDraft,
  wizardDraftKey,
} from '../app/library.mjs';
import { selectGarbageCatalogKeys } from '../app/catalog-manager.mjs';

const char = (overrides = {}) => ({
  id: 1, name: 'Мордекай', content: { characterName: 'Мордекай', hitPointsCurrent: '21' },
  portrait: null, catalogKey: 'slice-1', revision: 3, characterUid: 'uid-1', archivedAt: null, ...overrides,
});

test('archive hides from the active list; restore brings back', () => {
  const list = [char(), char({ id: 2, name: 'Архивный', archivedAt: '2026-09-22T00:00:00.000Z' })];
  assert.deepEqual(activeCharacters(list).map((c) => c.id), [1]);
  assert.deepEqual(archivedCharacters(list).map((c) => c.id), [2]);
  assert.equal(isArchived(list[0]), false);
  assert.equal(isArchived(list[1]), true);
  // Restored record is the same character, only the flag cleared.
  const restored = { ...list[1], archivedAt: null };
  assert.deepEqual(activeCharacters([restored]).map((c) => c.id), [2]);
  assert.equal(displayName(list[0]), 'Мордекай');
});

test('duplicate payload is independent: fresh UID, initial revision, same sheet', () => {
  const original = char();
  const payload = buildDuplicatePayload(original, 'Мордекай — копия', 'uid-2');
  assert.equal(payload.name, 'Мордекай — копия');
  assert.equal(payload.characterUid, 'uid-2');
  assert.equal(payload.revision, 0);
  assert.equal(payload.archivedAt, null);
  assert.equal(payload.catalogKey, 'slice-1');
  assert.deepEqual(payload.content, original.content);
  assert.notEqual(payload.content, original.content);
  payload.content.hitPointsCurrent = '9';
  assert.equal(original.content.hitPointsCurrent, '21');
  assert.equal(original.characterUid, 'uid-1');
  assert.equal(original.revision, 3);
});

test('copy names avoid twins and fall back on empty input', () => {
  const list = [char()];
  assert.equal(copyNameFor('Мордекай', list), 'Мордекай — копия');
  assert.equal(copyNameFor('Мордекай', [...list, char({ id: 2, name: 'Мордекай — копия', content: { characterName: 'Мордекай — копия' } })]), 'Мордекай — копия 2');
  assert.equal(copyNameFor('  ', list), 'Персонаж — копия');
});

test('drafts cannot duplicate; wizard draft keys are scoped by character', () => {
  assert.equal(isDraft(char({ content: null })), true);
  assert.equal(canDuplicate(char({ content: null })), false);
  assert.equal(canDuplicate(char()), true);
  assert.equal(wizardDraftKey(7), 'dnd-wizard-draft:character:7');
});

test('durable level-up: rejected commit keeps the draft, queue stays healthy', async () => {
  const order = [];
  let chain = Promise.resolve();
  const edit = chainSaveOperation(chain, async () => { order.push('edit'); return 'edit-ok'; });
  chain = edit.chain;
  // Level-up finish: the repository CAS rejects (another tab wrote first).
  const casError = Error('Персонаж изменён в другом окне. Скачайте текущую копию перед перезагрузкой.');
  const levelup = chainSaveOperation(chain, async () => { order.push('levelup'); throw casError; });
  chain = levelup.chain;
  // A later sheet edit still runs: the shared queue is not poisoned.
  const after = chainSaveOperation(chain, async () => { order.push('after'); return 'after-ok'; });
  chain = after.chain;
  assert.equal(await edit.outcome, 'edit-ok');
  // Exact wizard finish sequencing: clear only after durable success.
  let cleared = false;
  try { await levelup.outcome; cleared = true; }
  catch (e) { assert.equal(e, casError); }
  assert.equal(cleared, false);
  assert.equal(await after.outcome, 'after-ok');
  assert.deepEqual(order, ['edit', 'levelup', 'after']);
  await chain;
});

test('durable level-up: resolved commit clears the draft', async () => {
  const levelup = chainSaveOperation(Promise.resolve(), async () => 'rev-5');
  let cleared = false;
  try { await levelup.outcome; cleared = true; }
  catch { cleared = false; }
  assert.equal(cleared, true);
  await levelup.chain;
});

test('delete safety: shared catalogs stay, orphaned managed slices collect', () => {
  const managed = (key) => ({ key, catalog: { metadata: { id: key, schemaVersion: 2 } } });
  const custom = { key: 'custom-1', catalog: { system: {}, sections: [], entries: [] } };
  const records = [managed('slice-1'), custom];
  const both = [{ catalogKey: 'slice-1' }, { catalogKey: 'custom-1' }];
  // Both pinned: nothing collectable.
  assert.deepEqual(selectGarbageCatalogKeys({ records, characters: both, currentKey: null }), []);
  // After deleting the only slice-1 user, the managed slice is garbage but
  // the custom record is still kept by rule.
  assert.deepEqual(
    selectGarbageCatalogKeys({ records, characters: [{ catalogKey: 'custom-1' }], currentKey: null }),
    ['slice-1'],
  );
});

test('card art: subclass, class, species — most specific first', async () => {
  const { cardArtIds } = await import('../app/library.mjs');
  const content = { classes: [{ classId: 5, subclassId: 51 }, { classId: 7, subclassId: null }], raceId: 9 };
  assert.deepEqual(cardArtIds(content, null), [51, 5, 7, 9]);
  assert.deepEqual(cardArtIds(null, { classId: 5, subclassId: null, speciesId: 9 }), [5, 9]);
  assert.deepEqual(cardArtIds(null, null), []);
  assert.deepEqual(cardArtIds({ classes: [], raceId: null }, null), []);
});

test('card caption: every class with level, species last', async () => {
  const { cardCaption, draftCaption, parseWizardDraft } = await import('../app/library.mjs');
  assert.equal(cardCaption({ classes: [{ className: 'Воин', level: 3 }, { className: 'Плут', level: 2 }], raceName: 'Эльф' }), 'Воин 3 · Плут 2 · Эльф');
  assert.equal(cardCaption({ classes: [], raceName: '' }), '');
  assert.equal(draftCaption({ classId: 1, speciesId: 2 }, (id) => ({ 1: 'Волшебник', 2: 'Человек' })[id]), 'Волшебник · Человек');
  assert.equal(parseWizardDraft('{"step":"Черта"}').step, 'Черта');
  assert.equal(parseWizardDraft('oops'), null);
  assert.equal(parseWizardDraft('[1]'), null);
});
