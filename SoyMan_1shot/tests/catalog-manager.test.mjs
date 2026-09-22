import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog } from '../app/catalog.mjs';
import {
  buildCatalogCore, buildCatalogPreviews, serializeArtifact, hashArtifact,
} from '../app/catalog-release.mjs';
import {
  validateManifest, validateCoreRelease, ensureCurrentCatalog, ensureCatalogPreviews,
  validatePreviewsPackage, mergePreviews, splitManagedPreviews, selectGarbageCatalogKeys, garbageCollectCatalogs,
  isManagedRecord, MANIFEST_URL,
} from '../app/catalog-manager.mjs';

const IMG = 'data:image/webp;base64,AAA';
const BIG = 'data:image/webp;base64,BBB';
function source() {
  return {
    system: { id: 1, name: 'D&D 5.5', code: 'dnd55', description: '' },
    sections: [{ id: 1, system_id: 1, name: 'Классы', kind: 'class', position: 0 }],
    entries: [
      { id: 1, system_id: 1, section_id: 1, parent_id: null, name: 'Воин', name_original: 'Fighter', aliases: [], kind: 'class', level: null, position: 0, data: {}, description: '', avatar_preview_url: IMG, avatar_large_url: BIG },
      { id: 2, system_id: 1, section_id: 1, parent_id: 1, name: 'Чемпион', name_original: 'Champion', aliases: [], kind: 'subclass', level: null, position: 0, data: {}, description: '', avatar_preview_url: null, avatar_large_url: null },
    ],
  };
}
const ID = 'dnd55-ru-2026.09';
const OPTS = { catalogId: ID, catalogVersion: '2026.09', system: 'dnd55', language: 'ru', releasedAt: '2026-09-21T00:00:00.000Z' };

function release() {
  const core = buildCatalogCore(parseCatalog(source()), OPTS);
  const coreBytes = Buffer.from(serializeArtifact(core), 'utf8');
  const entry = {
    schemaVersion: 2, system: 'dnd55', language: 'ru', catalogVersion: '2026.09',
    core: { url: `./${ID}.core.json`, sha256: hashArtifact(coreBytes), bytes: coreBytes.length },
    previews: { url: `./${ID}.previews.json`, sha256: '0'.repeat(64), bytes: 1 },
  };
  const manifest = { format: 'soyman-catalog-manifest', version: 1, current: ID, catalogs: { [ID]: entry } };
  return { core, coreBytes, entry, manifest };
}

function makeStore() {
  const catalogs = new Map();
  const previews = new Map();
  let current;
  return {
    catalogs,
    previews,
    get: async k => catalogs.get(k),
    has: async k => catalogs.has(k),
    install: async (record, key, makeCurrent) => { catalogs.set(key, structuredClone(record)); if (makeCurrent) current = key; },
    getPreviews: async k => previews.get(k),
    savePreviews: async record => { previews.set(record.catalogId, structuredClone(record)); },
    listRecords: async () => [...catalogs.entries()].map(([key, catalog]) => ({ key, catalog })),
    deleteCatalog: async k => { catalogs.delete(k); previews.delete(k); },
    getCurrent: async () => current,
    setCurrent: async k => { current = k; },
  };
}

async function digestSha256(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function depsFor(files, store, calls = {}) {
  return {
    fetchJson: async url => {
      calls.json = (calls.json || 0) + 1;
      if (!(url in files)) throw Error('HTTP 404');
      return structuredClone(files[url]);
    },
    fetchBytes: async url => {
      calls.bytes = (calls.bytes || 0) + 1;
      if (!(url in files)) throw Error('HTTP 404');
      return files[url];
    },
    digestSha256,
    store,
  };
}

// --- manifest validation ---

test('manifest: valid passes, broken ones rejected', () => {
  const { manifest, entry } = release();
  assert.deepEqual(validateManifest(manifest), { catalogId: ID, entry });
  assert.throws(() => validateManifest({ ...manifest, format: 'nope' }), /manifest-invalid/);
  assert.throws(() => validateManifest({ ...manifest, version: 2 }), /manifest-invalid/);
  assert.throws(() => validateManifest({ ...manifest, current: 'dnd55-ru-2099.01' }), /manifest-invalid/);
  assert.throws(() => validateManifest({ ...manifest, catalogs: {} }), /manifest-invalid/);
  const badSchema = structuredClone(manifest);
  badSchema.catalogs[ID].schemaVersion = 1;
  assert.throws(() => validateManifest(badSchema), /manifest-invalid/);
  const badCore = structuredClone(manifest);
  delete badCore.catalogs[ID].core.bytes;
  assert.throws(() => validateManifest(badCore), /manifest-invalid/);
});

// --- install ---

test('install: fresh browser downloads core once under the stable id', async () => {
  const { manifest, coreBytes } = release();
  const store = makeStore();
  const calls = {};
  const deps = depsFor({ [MANIFEST_URL]: manifest, [`catalog/${ID}.core.json`]: coreBytes }, store, calls);
  const result = await ensureCurrentCatalog(deps);
  assert.deepEqual(result, { status: 'installed', catalogId: ID });
  assert.equal(calls.bytes, 1);
  assert.ok(store.catalogs.has(ID));
  assert.equal(await store.getCurrent(), ID);
  const installed = await store.get(ID);
  assert.equal(installed.system.name, 'D&D 5.5');
  assert.equal(installed.entries.length, 2);
  assert.equal(installed.metadata.id, ID);
  assert.equal(installed.metadata.schemaVersion, 2);
  assert.equal(installed.metadata.catalogVersion, '2026.09');
  assert.ok(installed.metadata.contentHash);
});

test('existing: up-to-date managed catalog is not re-downloaded', async () => {
  const { manifest, coreBytes } = release();
  const store = makeStore();
  const first = depsFor({ [MANIFEST_URL]: manifest, [`catalog/${ID}.core.json`]: coreBytes }, store);
  await ensureCurrentCatalog(first);
  const calls = {};
  const again = depsFor({ [MANIFEST_URL]: manifest, [`catalog/${ID}.core.json`]: coreBytes }, store, calls);
  const result = await ensureCurrentCatalog(again);
  assert.deepEqual(result, { status: 'ready', catalogId: ID });
  assert.equal(calls.bytes || 0, 0);
});

test('existing: current pointer is repaired without download', async () => {
  const { manifest, coreBytes } = release();
  const store = makeStore();
  await ensureCurrentCatalog(depsFor({ [MANIFEST_URL]: manifest, [`catalog/${ID}.core.json`]: coreBytes }, store));
  await store.setCurrent('legacy-uuid');
  const calls = {};
  const result = await ensureCurrentCatalog(depsFor({ [MANIFEST_URL]: manifest, [`catalog/${ID}.core.json`]: coreBytes }, store, calls));
  assert.deepEqual(result, { status: 'ready', catalogId: ID });
  assert.equal(await store.getCurrent(), ID);
  assert.equal(calls.bytes || 0, 0);
});

// --- integrity ---

test('integrity: tampered bytes and bad hashes are rejected, nothing saved', async () => {
  const { manifest, coreBytes } = release();
  const store = makeStore();
  // short body -> bytes-mismatch
  await assert.rejects(
    ensureCurrentCatalog(depsFor({ [MANIFEST_URL]: manifest, [`catalog/${ID}.core.json`]: coreBytes.slice(0, 10) }, store)),
    /bytes-mismatch/,
  );
  // same length, wrong content -> sha-mismatch
  const sameLen = Buffer.from(coreBytes);
  sameLen[sameLen.length - 1] ^= 1;
  await assert.rejects(
    ensureCurrentCatalog(depsFor({ [MANIFEST_URL]: manifest, [`catalog/${ID}.core.json`]: sameLen }, store)),
    /sha-mismatch/,
  );
  assert.equal(store.catalogs.size, 0);
  assert.equal(await store.getCurrent(), undefined);
});

test('integrity: malformed core and id mismatch rejected after valid hashes', async () => {
  const { manifest } = release();
  const store = makeStore();
  const broken = Buffer.from(JSON.stringify({ format: 'soyman-catalog-core', version: 1 }), 'utf8');
  const hacked = structuredClone(manifest);
  hacked.catalogs[ID].core = { url: `./${ID}.core.json`, sha256: hashArtifact(broken), bytes: broken.length };
  await assert.rejects(
    ensureCurrentCatalog(depsFor({ [MANIFEST_URL]: hacked, [`catalog/${ID}.core.json`]: broken }, store)),
    /core-invalid/,
  );
  assert.equal(store.catalogs.size, 0);
});

test('integrity: same id with different content is a release error, not an overwrite', async () => {
  const { manifest, coreBytes } = release();
  const store = makeStore();
  // installed older content under the same managed id (pathological manifest:
  // same id claims a new version with different bytes)
  const oldCore = buildCatalogCore(parseCatalog(source()), OPTS);
  oldCore.entries = oldCore.entries.slice(0, 1);
  const oldMeta = { ...oldCore.metadata, catalogVersion: '2026.08', contentHash: 'dead' + '0'.repeat(60) };
  await store.install({ system: oldCore.system, sections: oldCore.sections, entries: oldCore.entries, metadata: oldMeta }, ID, true);
  // new release claims same id+version but different bytes
  await assert.rejects(
    ensureCurrentCatalog(depsFor({ [MANIFEST_URL]: manifest, [`catalog/${ID}.core.json`]: coreBytes }, store)),
    /release-changed/,
  );
  assert.equal((await store.get(ID)).entries.length, 1);
});

// --- offline / failure ---

test('offline: manifest unavailable + local catalog keeps working', async () => {
  const store = makeStore();
  await store.install({ system: { id: 1 }, sections: [], entries: [], }, 'legacy-uuid', true);
  const deps = depsFor({}, store);
  const result = await ensureCurrentCatalog(deps);
  assert.deepEqual(result, { status: 'local', catalogId: 'legacy-uuid' });
  assert.equal(await store.getCurrent(), 'legacy-uuid');
});

test('offline: manifest unavailable + no catalog fails only the creation path', async () => {
  const store = makeStore();
  await assert.rejects(ensureCurrentCatalog(depsFor({}, store)), /no-catalog-offline/);
});

test('failure: rejected new install keeps the old current', async () => {
  const { manifest, coreBytes } = release();
  const store = makeStore();
  await store.install({ system: { id: 1 }, sections: [], entries: [] }, 'legacy-uuid', true);
  const sameLen = Buffer.from(coreBytes);
  sameLen[0] ^= 1;
  await assert.rejects(
    ensureCurrentCatalog(depsFor({ [MANIFEST_URL]: manifest, [`catalog/${ID}.core.json`]: sameLen }, store)),
    /sha-mismatch/,
  );
  assert.equal(await store.getCurrent(), 'legacy-uuid');
  assert.ok(store.catalogs.has('legacy-uuid'));
});

// --- runtime contract: installed core feeds transport-style reads ---

test('contract: installed core serves /systems, sections, entries, batch, single', async () => {
  const { manifest, coreBytes } = release();
  const store = makeStore();
  await ensureCurrentCatalog(depsFor({ [MANIFEST_URL]: manifest, [`catalog/${ID}.core.json`]: coreBytes }, store));
  const catalog = await store.get(ID);
  // mirrors app/transport.ts route semantics without importing the TS module
  assert.deepEqual([catalog.system].length, 1); // GET /systems
  assert.ok(Array.isArray(catalog.sections)); // GET /systems/:id/sections
  const listed = catalog.entries.filter(e => e.section_id === 1 && e.parent_id === 1); // list w/ filters
  assert.equal(listed.length, 1);
  const batch = catalog.entries.filter(e => new Set([1, 2]).has(e.id)); // /entries/batch?ids=
  assert.equal(batch.length, 2);
  const single = catalog.entries.find(e => e.id === 1); // /entries/:id
  assert.equal(single.name, 'Воин');
  // presentEntry mapping stays null-safe without media
  const nulled = catalog.entries.find(e => e.id === 2);
  const imageUrl = (true ? nulled.avatar_large_url : null) || nulled.avatar_preview_url || null;
  assert.equal(imageUrl, null);
  // legacy shape (no metadata) still structurally identical
  const legacy = { system: catalog.system, sections: catalog.sections, entries: catalog.entries };
  parseCatalog(legacy);
});

// --- previews (phase A1.3) ---

function releaseWithPreviews() {
  const parsed = parseCatalog(source());
  const core = buildCatalogCore(parsed, OPTS);
  const coreBytes = Buffer.from(serializeArtifact(core), 'utf8');
  const previews = buildCatalogPreviews(parsed, { catalogId: ID });
  const previewsBytes = Buffer.from(serializeArtifact(previews), 'utf8');
  const entry = {
    schemaVersion: 2, system: 'dnd55', language: 'ru', catalogVersion: '2026.09',
    core: { url: `./${ID}.core.json`, sha256: hashArtifact(coreBytes), bytes: coreBytes.length },
    previews: { url: `./${ID}.previews.json`, sha256: hashArtifact(previewsBytes), bytes: previewsBytes.length },
  };
  const manifest = { format: 'soyman-catalog-manifest', version: 1, current: ID, catalogs: { [ID]: entry } };
  return { coreBytes, previewsBytes, manifest };
}

async function installCoreOnly() {
  const { manifest, coreBytes } = releaseWithPreviews();
  const store = makeStore();
  const files = { [MANIFEST_URL]: manifest, [`catalog/${ID}.core.json`]: coreBytes };
  await ensureCurrentCatalog(depsFor(files, store));
  return { store, files, manifest };
}

test('previews: download saves a separate record, core stays image-free', async () => {
  const { store, files, manifest } = await installCoreOnly();
  const { previewsBytes } = releaseWithPreviews();
  files[`catalog/${ID}.previews.json`] = previewsBytes;
  const calls = {};
  const deps = depsFor(files, store, calls);
  const result = await ensureCatalogPreviews(deps, ID);
  assert.deepEqual(result, { status: 'installed', catalogId: ID, count: 1 });
  assert.equal(calls.bytes, 1);
  // core untouched: entries still null, no metadata.previews written (variant B)
  const installed = await store.get(ID);
  assert.equal(installed.entries.find(e => e.id === 1).avatar_preview_url, null);
  assert.equal(installed.metadata.previews, undefined);
  // separate record holds the mapping
  const record = await store.getPreviews(ID);
  assert.deepEqual(record, {
    catalogId: ID,
    sha256: manifest.catalogs[ID].previews.sha256,
    images: { 1: IMG },
  });
});

test('previews: install never rewrites game fields', async () => {
  const { store, files } = await installCoreOnly();
  const { previewsBytes } = releaseWithPreviews();
  files[`catalog/${ID}.previews.json`] = previewsBytes;
  const before = structuredClone(await store.get(ID));
  await ensureCatalogPreviews(depsFor(files, store), ID);
  assert.deepEqual(await store.get(ID), before);
});

test('previews: matching sha means no re-download', async () => {
  const { store, files } = await installCoreOnly();
  const { previewsBytes } = releaseWithPreviews();
  files[`catalog/${ID}.previews.json`] = previewsBytes;
  await ensureCatalogPreviews(depsFor(files, store), ID);
  const calls = {};
  const result = await ensureCatalogPreviews(depsFor(files, store, calls), ID);
  assert.deepEqual(result, { status: 'ready', catalogId: ID });
  assert.equal(calls.bytes || 0, 0);
  assert.equal(calls.json || 0, 1); // manifest is still read to compare hashes
});

test('previews: failures leave core and preview store usable', async () => {
  const { store, files } = await installCoreOnly();
  const before = structuredClone(await store.get(ID));
  // network failure
  await assert.rejects(ensureCatalogPreviews(depsFor(files, store), ID), /preview-unavailable/);
  // wrong bytes
  const { previewsBytes } = releaseWithPreviews();
  const short = { ...files, [`catalog/${ID}.previews.json`]: previewsBytes.slice(0, 10) };
  await assert.rejects(ensureCatalogPreviews(depsFor(short, store), ID), /preview-bytes-mismatch/);
  // wrong sha, same length
  const sameLen = Buffer.from(previewsBytes);
  sameLen[sameLen.length - 1] ^= 1;
  await assert.rejects(
    ensureCatalogPreviews(depsFor({ ...files, [`catalog/${ID}.previews.json`]: sameLen }, store), ID),
    /preview-sha-mismatch/,
  );
  // invalid JSON with matching bytes+sha
  const notJson = Buffer.from('not json', 'utf8');
  const hackedFiles = { ...files };
  const hackedManifest = structuredClone(files[MANIFEST_URL]);
  hackedManifest.catalogs[ID].previews = {
    url: `./${ID}.previews.json`, sha256: hashArtifact(notJson), bytes: notJson.length,
  };
  hackedFiles[MANIFEST_URL] = hackedManifest;
  hackedFiles[`catalog/${ID}.previews.json`] = notJson;
  await assert.rejects(ensureCatalogPreviews(depsFor(hackedFiles, store), ID), /preview-invalid/);
  assert.deepEqual(await store.get(ID), before);
  assert.equal(await store.getPreviews(ID), undefined);
});

test('previews: same id with different sha is an integrity violation, old record kept', async () => {
  const { store, files } = await installCoreOnly();
  const { previewsBytes } = releaseWithPreviews();
  files[`catalog/${ID}.previews.json`] = previewsBytes;
  await ensureCatalogPreviews(depsFor(files, store), ID);
  const kept = structuredClone(await store.getPreviews(ID));
  const changed = structuredClone(files[MANIFEST_URL]);
  changed.catalogs[ID].previews.sha256 = 'f'.repeat(64);
  await assert.rejects(
    ensureCatalogPreviews(depsFor({ ...files, [MANIFEST_URL]: changed }, store), ID),
    /preview-release-changed/,
  );
  assert.deepEqual(await store.getPreviews(ID), kept);
});

test('previews: unknown entry id and wrong catalog id rejected', () => {
  const installed = { entries: [{ id: 1 }] };
  const badEntry = { format: 'soyman-catalog-previews', version: 1, catalogId: ID, images: { 999: IMG } };
  assert.throws(() => validatePreviewsPackage(badEntry, ID, installed), /preview-invalid/);
  const badUrl = { format: 'soyman-catalog-previews', version: 1, catalogId: ID, images: { 1: 'https://evil/x.webp' } };
  assert.throws(() => validatePreviewsPackage(badUrl, ID, installed), /preview-invalid/);
  const badId = { format: 'soyman-catalog-previews', version: 1, catalogId: 'dnd55-ru-2099.01', images: { 1: IMG } };
  assert.throws(() => validatePreviewsPackage(badId, ID, installed), /preview-catalog-mismatch/);
});

test('previews: legacy catalogs are never touched', async () => {
  const store = makeStore();
  const legacy = {
    system: { id: 1 }, sections: [],
    entries: [{ id: 1, avatar_preview_url: null, avatar_large_url: BIG }],
  };
  await store.install(legacy, 'legacy-uuid', true);
  const { manifest } = releaseWithPreviews();
  const calls = {};
  const result = await ensureCatalogPreviews(depsFor({ [MANIFEST_URL]: manifest }, store, calls), 'legacy-uuid');
  assert.deepEqual(result, { status: 'skipped', reason: 'legacy', catalogId: 'legacy-uuid' });
  assert.equal(calls.bytes || 0, 0);
  assert.deepEqual(await store.get('legacy-uuid'), legacy);
});

test('transport contract: lists serve preview, single falls back to preview when large is null', async () => {
  const { store, files } = await installCoreOnly();
  const { previewsBytes } = releaseWithPreviews();
  files[`catalog/${ID}.previews.json`] = previewsBytes;
  await ensureCatalogPreviews(depsFor(files, store), ID);
  const catalog = await store.get(ID);
  const previews = await store.getPreviews(ID);
  // mirrors presentEntry + previewOf in app/transport.ts
  const previewOf = (entry) => entry.avatar_preview_url ?? previews.images[String(entry.id)] ?? null;
  const present = (entry, full = false) => (full ? (entry.avatar_large_url ?? previewOf(entry)) : null) || previewOf(entry);
  const listed = catalog.entries.filter(e => e.section_id === 1); // GET /systems/:id/entries
  assert.equal(present(listed[0]), IMG);
  const single = catalog.entries.find(e => e.id === 1); // GET /systems/entries/:id
  assert.equal(single.avatar_large_url, null);
  assert.equal(single.avatar_preview_url, null);
  assert.equal(present(single, true), IMG);
  // legacy entry with large keeps serving large
  assert.equal(present({ avatar_large_url: BIG, avatar_preview_url: IMG }, true), BIG);
});

// --- garbage collection (phase A1.4) ---

function managedMeta(id, version = '2026.09') {
  return { schemaVersion: 2, id, system: 'dnd55', language: 'ru', catalogVersion: version, releasedAt: 't', contentHash: 'h' };
}
const rec = (key, catalog) => ({ key, catalog });
const sys = { id: 1 };

test('gc selection: only unreferenced non-current managed catalogs are garbage', () => {
  const records = [
    rec('dnd55-ru-2026.09', { system: sys, sections: [], entries: [], metadata: managedMeta('dnd55-ru-2026.09') }),
    rec('legacy-uuid', { system: sys, sections: [], entries: [] }),
  ];
  assert.deepEqual(
    selectGarbageCatalogKeys({ records, characters: [], currentKey: 'other' }),
    ['dnd55-ru-2026.09'],
  );
  // current is always protected, even unreferenced
  assert.deepEqual(
    selectGarbageCatalogKeys({ records, characters: [], currentKey: 'dnd55-ru-2026.09' }),
    [],
  );
  // any character pins it — including content === null drafts
  const chars = [{ catalogKey: 'dnd55-ru-2026.09', content: null }, { catalogKey: 'dnd55-ru-2026.09', content: {} }];
  assert.deepEqual(
    selectGarbageCatalogKeys({ records, characters: chars, currentKey: 'other' }),
    [],
  );
});

test('gc selection: legacy, manual and malformed records are always kept', () => {
  const records = [
    rec('uuid-1', { system: sys, sections: [], entries: [] }),
    rec('uuid-2', { system: sys, sections: [], entries: [], metadata: { id: 'uuid-2' } }),
    rec('dnd55-ru-2026.09', { system: sys, sections: [], entries: [], metadata: { id: 'other-id', schemaVersion: 2 } }),
    rec('dnd55-ru-2026.10', { system: sys, sections: [], entries: [], metadata: { id: 'dnd55-ru-2026.10', schemaVersion: 1 } }),
  ];
  assert.deepEqual(selectGarbageCatalogKeys({ records, characters: [], currentKey: 'nothing' }), []);
  assert.ok(!isManagedRecord('dnd55-ru-2026.10', records[3].catalog));
  assert.ok(isManagedRecord('dnd55-ru-2026.09', { metadata: managedMeta('dnd55-ru-2026.09') }));
});

test('gc selection: four-version contract (07 nobody, 08 character, 09 draft, 10 current)', () => {
  const v = id => rec(id, { system: sys, sections: [], entries: [], metadata: managedMeta(id, id.slice(-5)) });
  const records = [v('dnd55-ru-2026.07'), v('dnd55-ru-2026.08'), v('dnd55-ru-2026.09'), v('dnd55-ru-2026.10')];
  const characters = [
    { catalogKey: 'dnd55-ru-2026.08', content: { classes: [] } },
    { catalogKey: 'dnd55-ru-2026.09', content: null },
  ];
  assert.deepEqual(
    selectGarbageCatalogKeys({ records, characters, currentKey: 'dnd55-ru-2026.10' }),
    ['dnd55-ru-2026.07'],
  );
});

test('gc deletion: removes only selected records, keeps settings and characters', async () => {
  const v = id => rec(id, { system: sys, sections: [], entries: [], metadata: managedMeta(id, id.slice(-5)) });
  const catalogs = new Map([
    ['dnd55-ru-2026.07', v('dnd55-ru-2026.07').catalog],
    ['dnd55-ru-2026.10', v('dnd55-ru-2026.10').catalog],
    ['legacy-uuid', { system: sys, sections: [], entries: [] }],
  ]);
  const previewRecords = new Map([
    ['dnd55-ru-2026.07', { catalogId: 'dnd55-ru-2026.07', sha256: 'x', images: {} }],
    ['dnd55-ru-2026.10', { catalogId: 'dnd55-ru-2026.10', sha256: 'y', images: {} }],
  ]);
  let current = 'dnd55-ru-2026.10';
  const characters = [{ id: 1, catalogKey: 'legacy-uuid', content: { classes: [] } }];
  const deleted = [];
  const deps = {
    fetchJson: async () => { throw Error('unused'); },
    fetchBytes: async () => { throw Error('unused'); },
    digestSha256: async () => 'unused',
    store: {
      get: async k => catalogs.get(k),
      has: async k => catalogs.has(k),
      install: async () => { throw Error('unused'); },
      getPreviews: async k => previewRecords.get(k),
      savePreviews: async () => { throw Error('unused'); },
      listRecords: async () => [...catalogs.entries()].map(([key, catalog]) => ({ key, catalog })),
      deleteCatalog: async k => { deleted.push(k); catalogs.delete(k); previewRecords.delete(k); },
      getCurrent: async () => current,
      setCurrent: async k => { current = k; },
    },
    listCharacters: async () => characters,
  };
  const result = await garbageCollectCatalogs(deps);
  assert.deepEqual(result, { deleted: ['dnd55-ru-2026.07'] });
  assert.ok(!catalogs.has('dnd55-ru-2026.07'));
  assert.ok(!previewRecords.has('dnd55-ru-2026.07'));
  assert.ok(catalogs.has('dnd55-ru-2026.10'));
  assert.ok(previewRecords.has('dnd55-ru-2026.10'));
  assert.ok(catalogs.has('legacy-uuid'));
  assert.equal(current, 'dnd55-ru-2026.10');
  assert.deepEqual(characters, [{ id: 1, catalogKey: 'legacy-uuid', content: { classes: [] } }]);
});

test('gc failure safety: delete errors never break the flow', async () => {
  const deps = {
    fetchJson: async () => { throw Error('unused'); },
    fetchBytes: async () => { throw Error('unused'); },
    digestSha256: async () => 'unused',
    store: {
      get: async () => undefined,
      has: async () => false,
      install: async () => { throw Error('unused'); },
      getPreviews: async () => undefined,
      savePreviews: async () => { throw Error('unused'); },
      listRecords: async () => { throw Error('IDB locked'); },
      deleteCatalog: async () => { throw Error('IDB locked'); },
      getCurrent: async () => 'dnd55-ru-2026.10',
      setCurrent: async () => {},
    },
    listCharacters: async () => [],
  };
  const result = await garbageCollectCatalogs(deps);
  assert.deepEqual(result, { deleted: [] });
});

// --- v1 -> v2 migration split (phase A2.2) ---

function v1Managed(key) {
  return {
    system: { id: 1 }, sections: [],
    entries: [
      { id: 1, avatar_preview_url: IMG, avatar_large_url: null, data: {}, name: 'A' },
      { id: 2, avatar_preview_url: null, avatar_large_url: null, data: {}, name: 'B' },
    ],
    metadata: { schemaVersion: 2, id: key, system: 'dnd55', language: 'ru', catalogVersion: '2026.09', releasedAt: 't', contentHash: 'h', previews: { installed: true, sha256: 'abc' } },
  };
}

test('split: managed record with installed previews separates media', () => {
  const split = splitManagedPreviews('dnd55-ru-2026.09', v1Managed('dnd55-ru-2026.09'));
  assert.ok(split);
  assert.deepEqual(split.previews, { catalogId: 'dnd55-ru-2026.09', sha256: 'abc', images: { 1: IMG } });
  assert.equal(split.core.entries.find(e => e.id === 1).avatar_preview_url, null);
  assert.equal(split.core.entries.find(e => e.id === 2).avatar_preview_url, null);
  // game fields survive the split byte-identically
  assert.deepEqual(
    split.core.entries.map(({ avatar_preview_url, ...rest }) => rest),
    v1Managed('dnd55-ru-2026.09').entries.map(({ avatar_preview_url, ...rest }) => rest),
  );
  assert.deepEqual(split.core.system, { id: 1 });
});

test('split: legacy, unflagged and shaless records stay untouched', () => {
  const legacy = { system: {}, sections: [], entries: [{ id: 1, avatar_preview_url: IMG, avatar_large_url: BIG }] };
  assert.equal(splitManagedPreviews('uuid', legacy), null);
  const noFlag = v1Managed('dnd55-ru-2026.09');
  delete noFlag.metadata.previews;
  assert.equal(splitManagedPreviews('dnd55-ru-2026.09', noFlag), null);
  const noSha = v1Managed('dnd55-ru-2026.09');
  noSha.metadata.previews = { installed: true };
  assert.equal(splitManagedPreviews('dnd55-ru-2026.09', noSha), null);
  const idMismatch = v1Managed('dnd55-ru-2026.09');
  idMismatch.metadata.id = 'other';
  assert.equal(splitManagedPreviews('dnd55-ru-2026.09', idMismatch), null);
  const noImages = v1Managed('dnd55-ru-2026.09');
  noImages.entries = noImages.entries.map(e => ({ ...e, avatar_preview_url: null }));
  assert.equal(splitManagedPreviews('dnd55-ru-2026.09', noImages), null);
  assert.equal(splitManagedPreviews('dnd55-ru-2026.09', undefined), null);
});
