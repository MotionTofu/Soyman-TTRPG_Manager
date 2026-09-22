// Sync artifacts v2 (phase D1.3): canonical hashes, HP-only push dedup,
// v1 grace read. Pure data plane — no IndexedDB, no network: the transport
// is an in-memory recorder standing in for headArtifact/putArtifact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sha256HexText,
  stableStringify,
  canonicalCatalogSlice,
  catalogArtifactHash,
  canonicalPortrait,
  portraitArtifactHash,
  buildSyncV2Parts,
  validateSyncSnapshot,
  pushCharacterV2,
  utf8ByteLength,
  SYNC_CHARACTER_VERSION_V2,
} from '../app/sync-characters.mjs';

// Shared fixture vectors pinning the client/server canonical mirror: the
// same logical slice with shuffled keys and unsorted entries MUST hash the
// same on both sides. Change either implementation and these fail.
const SHUFFLED_SLICE = {
  entries: [
    { name: 'Trait B', section_id: 2, id: 7, kind: 'feature', position: 1, data: { text: 'b' } },
    { id: 3, section_id: 1, kind: 'feature', name: 'Trait A', position: 0, data: { text: 'a' } },
  ],
  system: { name: 'D&D 5.5', code: 'dnd55' },
  sections: [{ name: 'S2', id: 2, kind: 'traits' }, { kind: 'traits', id: 1, name: 'S1' }],
};
const EXPECTED_CATALOG_HASH = '6737f312e658798bf80e395b35da0d16359ba558f12488804dddf38ae46f35cd';
const PORTRAIT = 'data:image/png;base64,iVBORw0KGgo=';
const EXPECTED_PORTRAIT_HASH = 'e1e10747c2374f621aa59fefede6ef99dc6acdb41b267ab4af408d5529f89ea8';

test('canonical mirror vectors: sha, key order, portrait normalization', () => {
  assert.equal(sha256HexText('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(catalogArtifactHash(SHUFFLED_SLICE), EXPECTED_CATALOG_HASH);
  // Canonical form sorts entries/sections by id for the wire.
  const canonical = canonicalCatalogSlice(SHUFFLED_SLICE);
  assert.deepEqual(canonical.entries.map((e) => e.id), [3, 7]);
  assert.deepEqual(canonical.sections.map((s) => s.id), [1, 2]);
  assert.equal(canonicalPortrait('DATA:IMAGE/PNG;BASE64, iVBORw0KGgo= '), PORTRAIT);
  assert.equal(portraitArtifactHash(PORTRAIT), EXPECTED_PORTRAIT_HASH);
  assert.equal(canonicalPortrait(null), null);
  assert.equal(canonicalPortrait('data:image/gif;base64,eA=='), undefined);
});

const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const content = (overrides = {}) => ({
  characterName: 'Мордекай', classes: [], abilities, hitPointsCurrent: '21',
  equipmentSections: [{ items: [{ entryId: 7 }] }], ...overrides,
});
const local = (overrides = {}) => ({
  id: 1, name: 'Мордекай', content: content(), portrait: PORTRAIT,
  catalogKey: 'slice-1', revision: 4, characterUid: 'uid-1', archivedAt: null, ...overrides,
});
const catalog = () => ({
  system: { id: 1, name: 'D&D 5.5' },
  sections: [{ id: 1, kind: 'spell', name: 'Заклинания' }],
  entries: [{ id: 7, section_id: 1, kind: 'spell', level: 2, name: 'Огненный шар', data: {} }],
});

// In-memory artifact store + call recorder standing in for the server.
function recordingTransport() {
  const store = new Map();
  const calls = { heads: [], puts: [], docs: [] };
  let revision = 0;
  return {
    calls,
    transport: {
      headArtifact: async (hash) => { calls.heads.push(hash); return store.has(hash); },
      putArtifact: async (hash, kind, payload) => {
        calls.puts.push({ hash, kind });
        store.set(hash, { kind, payload });
        return { bytes: utf8ByteLength(JSON.stringify(payload)) };
      },
      putCharacter: async (uid, body) => { calls.docs.push(body); revision += 1; return { revision }; },
    },
  };
}

test('HP-only second sync uploads zero artifacts, only the document', async () => {
  const { calls, transport } = recordingTransport();
  // First sync: catalog artifact upload + v2 document (portrait included).
  const parts1 = buildSyncV2Parts(local(), catalog(), 'uid-1');
  assert.equal(parts1.document.version, SYNC_CHARACTER_VERSION_V2);
  assert.ok(!('portrait' in parts1.document.character) && !('catalog' in parts1.document));
  const first = await pushCharacterV2(transport, { uid: 'uid-1', base: 0, parts: parts1, meta: null });
  assert.equal(first.revision, 1);
  assert.deepEqual(calls.puts.map((p) => p.kind).sort(), ['catalog', 'portrait']);
  const firstDocBytes = utf8ByteLength(JSON.stringify({ baseRevision: 0, payload: parts1.document }));
  assert.ok(first.uploadedBytes > firstDocBytes);
  assert.ok(first.uploadedBytes < firstDocBytes + 2000);

  // HP 21 -> 20: same catalog, same portrait.
  const meta = { catalogHash: first.catalogHash, portraitHash: first.portraitHash };
  const parts2 = buildSyncV2Parts(local({ content: content({ hitPointsCurrent: '20' }), revision: 5 }), catalog(), 'uid-1');
  assert.equal(parts2.catalogHash, first.catalogHash);
  assert.equal(parts2.portraitHash, first.portraitHash);
  const putsBefore = calls.puts.length;
  const headsBefore = calls.heads.length;
  const second = await pushCharacterV2(transport, { uid: 'uid-1', base: 1, parts: parts2, meta });
  assert.equal(second.revision, 2);
  // No artifact PUTs, no existence probes: meta-known immutable hashes skip
  // the network entirely. Only the small document travels.
  assert.equal(calls.puts.length, putsBefore);
  assert.equal(calls.heads.length, headsBefore);
  assert.equal(second.uploadedBytes, utf8ByteLength(JSON.stringify({ baseRevision: 1, payload: parts2.document })));
  assert.ok(second.uploadedBytes < 3000);
  // The two documents differ only in the HP field.
  assert.equal(calls.docs[1].payload.character.content.hitPointsCurrent, '20');
  assert.deepEqual(calls.docs[1].payload.artifacts, calls.docs[0].payload.artifacts);
});

test('v1 remote still reads; the same data builds v2 refs', () => {
  const v1 = {
    format: 'soyman-sync-character', version: 1, characterUid: 'uid-1',
    character: { name: 'Мордекай', content: content(), portrait: PORTRAIT, archivedAt: null },
    catalog: catalog(),
  };
  const parsedV1 = validateSyncSnapshot(v1);
  assert.equal(parsedV1.version, 1);
  assert.equal(parsedV1.catalog.entries.length, 1);
  // Same local data converts to v2 without touching logical content.
  const parts = buildSyncV2Parts(local(), catalog(), 'uid-1');
  const parsedV2 = validateSyncSnapshot(parts.document);
  assert.equal(parsedV2.version, 2);
  assert.equal(parsedV2.catalogHash, parts.catalogHash);
  assert.equal(parsedV2.portraitHash, parts.portraitHash);
  assert.deepEqual(parsedV2.content, parsedV1.content);
});
