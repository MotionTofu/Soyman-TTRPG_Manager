import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSyncBundle,
  validateSyncSnapshot,
  decideCharacterSync,
  SYNC_CHARACTER_FORMAT,
  SYNC_CHARACTER_VERSION,
} from '../app/sync-characters.mjs';

const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const content = (overrides = {}) => ({
  characterName: 'Мордекай', classes: [], abilities, hitPointsCurrent: '21',
  equipmentSections: [{ items: [{ entryId: 7 }] }], ...overrides,
});
const local = (overrides = {}) => ({
  id: 1, name: 'Мордекай', content: content(), portrait: 'data:image/png;base64,iVBORw0KGgo=',
  catalogKey: 'slice-1', revision: 4, characterUid: 'uid-1', archivedAt: null, ...overrides,
});
const catalog = () => ({
  system: { id: 1, name: 'D&D 5.5' },
  sections: [{ id: 1, kind: 'spell', name: 'Заклинания' }],
  entries: [{ id: 7, section_id: 1, kind: 'spell', level: 2, name: 'Призыв', data: {}, avatar_preview_url: 'data:image/webp;base64,eA==', avatar_large_url: null }],
});
const meta = (overrides = {}) => ({
  characterUid: 'uid-1', remoteRevision: 4, lastSyncedLocalRevision: 4, deletedLocally: false, syncedAt: 'x', ...overrides,
});
const remote = (overrides = {}) => ({ revision: 4, deleted: false, ...overrides });

test('planner covers the sync matrix', () => {
  const d = (options) => decideCharacterSync(options);
  const action = (options) => d(options).action;
  // Local only -> push fresh; remote only -> pull; both calm -> noop.
  assert.equal(action({ local: local(), sync: null, remote: null }), 'push');
  assert.deepEqual(d({ local: local(), sync: null, remote: null }), { action: 'push', base: 0 });
  assert.equal(action({ local: null, sync: null, remote: remote() }), 'pull');
  assert.equal(action({ local: local(), sync: meta(), remote: remote() }), 'noop');
  // Only local changed -> push CAS; only remote changed -> pull.
  assert.deepEqual(
    d({ local: local({ revision: 5 }), sync: meta(), remote: remote() }),
    { action: 'push', base: 4 },
  );
  assert.equal(action({ local: local(), sync: meta(), remote: remote({ revision: 5 }) }), 'pull');
  // Both changed, first contact, duplicates -> conflict family.
  assert.deepEqual(
    d({ local: local({ revision: 5 }), sync: meta(), remote: remote({ revision: 5 }) }),
    { action: 'conflict', kind: 'both-changed' },
  );
  assert.deepEqual(
    d({ local: local(), sync: null, remote: remote() }),
    { action: 'conflict', kind: 'both-changed' },
  );
  assert.equal(action({ local: local(), sync: meta(), remote: remote(), duplicateCount: 2 }), 'error-duplicate');
  // Deletes: local delete + calm remote -> push-delete; clean local + tombstone -> pull-delete.
  assert.deepEqual(
    d({ local: null, sync: meta({ deletedLocally: true }), remote: remote() }),
    { action: 'push-delete', base: 4 },
  );
  assert.equal(action({ local: local(), sync: meta(), remote: remote({ deleted: true, revision: 5 }) }), 'pull-delete');
  // Delete-vs-update both ways -> explicit conflicts, never silent.
  assert.deepEqual(
    d({ local: null, sync: meta({ deletedLocally: true }), remote: remote({ revision: 5 }) }),
    { action: 'conflict', kind: 'local-deleted-remote-changed' },
  );
  assert.deepEqual(
    d({ local: local({ revision: 5 }), sync: meta(), remote: remote({ deleted: true, revision: 5 }) }),
    { action: 'conflict', kind: 'remote-deleted-local-changed' },
  );
  // Tombstones converge quietly; drafts never sync.
  assert.equal(action({ local: null, sync: meta({ deletedLocally: true }), remote: remote({ deleted: true, revision: 5 }) }), 'ack-tombstone');
  assert.equal(action({ local: local({ content: null }), sync: null, remote: null }), 'noop');
});

test('bundle round-trips through structural validation with a usable slice', () => {
  const bundle = buildSyncBundle(local(), catalog(), 'uid-1');
  assert.equal(bundle.format, SYNC_CHARACTER_FORMAT);
  assert.equal(bundle.version, SYNC_CHARACTER_VERSION);
  assert.equal(bundle.characterUid, 'uid-1');
  assert.equal(bundle.character.content.hitPointsCurrent, '21');
  assert.equal(bundle.character.portrait, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(bundle.character.archivedAt, null);
  assert.ok(!('id' in bundle) && !('revision' in bundle) && !('catalogKey' in bundle));
  assert.deepEqual(bundle.catalog.entries.map((e) => e.id), [7]);
  // Images never travel; the slice still validates as a catalog.
  assert.equal(bundle.catalog.entries[0].avatar_preview_url, undefined);
  const back = validateSyncSnapshot(JSON.parse(JSON.stringify(bundle)));
  assert.equal(back.characterUid, 'uid-1');
  assert.deepEqual(back.content, bundle.character.content);
  assert.equal(back.catalog.entries.length, 1);
  // Damaged shapes reject without touching storage (pure module).
  assert.throws(() => validateSyncSnapshot({ ...bundle, version: 99 }), /версия/);
  assert.throws(() => validateSyncSnapshot({ ...bundle, characterUid: '' }), /identity/);
  assert.throws(() => buildSyncBundle(local({ content: null }), catalog(), 'uid-1'), /Черновик/);
});

test('representation version is not a change: clean v1 baseline stays NOOP', () => {
  // Remote row still holds a D1.2 v1 payload at rev 5; the local baseline
  // was confirmed against it — possibly via a v1 pull, hence no hashes in
  // meta. Planning is version-blind (index carries revision/deleted only),
  // so no push may fire merely to modernize the representation: the remote
  // stays at rev 5 and no character PUT happens.
  const v1meta = meta({ remoteRevision: 5, lastSyncedLocalRevision: 4 });
  assert.deepEqual(
    decideCharacterSync({ local: local(), sync: v1meta, remote: remote({ revision: 5 }) }),
    { action: 'noop' },
  );
  // Identical answer with v2 hashes: only revisions decide, never versions.
  const v2meta = meta({ remoteRevision: 5, lastSyncedLocalRevision: 4, catalogHash: 'h', portraitHash: null });
  assert.deepEqual(
    decideCharacterSync({ local: local(), sync: v2meta, remote: remote({ revision: 5 }) }),
    { action: 'noop' },
  );
  // The natural transition: a real local change pushes v2 on the same base,
  // and only then does the revision justifiably move 5 -> 6.
  assert.deepEqual(
    decideCharacterSync({ local: local({ revision: 5 }), sync: v1meta, remote: remote({ revision: 5 }) }),
    { action: 'push', base: 5 },
  );
});
