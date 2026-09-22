import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseCatalog } from '../app/catalog.mjs';
import {
  buildCatalogCore, buildCatalogPreviews, buildCatalogManifest,
  makeCatalogId, coreFileName, previewsFileName,
  serializeArtifact, hashArtifact, validateCatalogVersion,
} from '../app/catalog-release.mjs';

const IMG = 'data:image/webp;base64,AAA';
const BIG = 'data:image/webp;base64,BBB';
function source() {
  return {
    system: { id: 1, name: 'D&D 5.5', code: 'dnd55', description: 'test' },
    sections: [{ id: 1, system_id: 1, name: 'Классы', kind: 'class', position: 0 }],
    entries: [
      { id: 1, system_id: 1, section_id: 1, parent_id: null, name: 'Воин', name_original: 'Fighter', aliases: ['файтер'], kind: 'class', level: null, position: 0, data: { hit_die: 'к10' }, description: 'Класс', avatar_preview_url: IMG, avatar_large_url: BIG },
      { id: 2, system_id: 1, section_id: 1, parent_id: 1, name: 'Чемпион', name_original: 'Champion', aliases: [], kind: 'subclass', level: null, position: 1, data: {}, description: '', avatar_preview_url: IMG, avatar_large_url: BIG },
      { id: 3, system_id: 1, section_id: 1, parent_id: null, name: 'Огненный шар', name_original: 'Fireball', aliases: [], kind: 'spell', level: 3, position: 2, data: { school: 'Воплощение' }, description: 'Взрыв', avatar_preview_url: IMG, avatar_large_url: null },
      { id: 4, system_id: 1, section_id: 1, parent_id: 1, name: 'Особенность', name_original: '', aliases: [], kind: 'feature', level: null, position: 3, data: {}, description: '', avatar_preview_url: null, avatar_large_url: null },
    ],
  };
}
const OPTS = { catalogId: 'dnd55-ru-2026.09', catalogVersion: '2026.09', system: 'dnd55', language: 'ru', releasedAt: '2026-09-21T00:00:00.000Z' };

test('core keeps game content, nulls image payloads', () => {
  const core = buildCatalogCore(parseCatalog(source()), OPTS);
  assert.equal(core.format, 'soyman-catalog-core');
  assert.equal(core.entries.length, 4);
  for (const e of core.entries) {
    assert.equal(e.avatar_large_url, null);
    assert.equal(e.avatar_preview_url, null);
  }
  assert.ok(!JSON.stringify(core.entries).includes('base64'));
  const byId = new Map(core.entries.map(e => [e.id, e]));
  assert.deepEqual(byId.get(1), { id: 1, system_id: 1, section_id: 1, parent_id: null, name: 'Воин', name_original: 'Fighter', aliases: ['файтер'], kind: 'class', level: null, position: 0, data: { hit_die: 'к10' }, description: 'Класс', avatar_large_url: null, avatar_preview_url: null });
  assert.equal(byId.get(2).parent_id, 1);
  assert.equal(byId.get(3).level, 3);
  assert.deepEqual(core.system, source().system);
  assert.deepEqual(core.sections, source().sections);
  assert.equal(core.metadata.schemaVersion, 2);
  assert.equal(core.metadata.catalogVersion, '2026.09');
});

test('core content revalidates with the legacy parseCatalog', () => {
  const core = buildCatalogCore(parseCatalog(source()), OPTS);
  const back = parseCatalog({ system: core.system, sections: core.sections, entries: core.entries });
  assert.equal(back.entries.length, 4);
});

test('previews map only entries that have one', () => {
  const previews = buildCatalogPreviews(parseCatalog(source()), { catalogId: OPTS.catalogId });
  assert.equal(previews.format, 'soyman-catalog-previews');
  assert.deepEqual(previews.images, { 1: IMG, 2: IMG, 3: IMG });
  assert.ok(!JSON.stringify(previews).includes('BBB'));
});

test('manifest references files with matching bytes and hashes', () => {
  const core = buildCatalogCore(parseCatalog(source()), OPTS);
  const previews = buildCatalogPreviews(parseCatalog(source()), { catalogId: OPTS.catalogId });
  const coreBytes = Buffer.from(serializeArtifact(core), 'utf8');
  const previewsBytes = Buffer.from(serializeArtifact(previews), 'utf8');
  const manifest = buildCatalogManifest({
    catalogId: OPTS.catalogId, metadata: core.metadata,
    coreFile: coreFileName(OPTS.catalogId), coreHash: hashArtifact(coreBytes), coreBytes: coreBytes.length,
    previewsFile: previewsFileName(OPTS.catalogId), previewsHash: hashArtifact(previewsBytes), previewsBytes: previewsBytes.length,
  });
  assert.equal(manifest.format, 'soyman-catalog-manifest');
  assert.equal(manifest.current, 'dnd55-ru-2026.09');
  const entry = manifest.catalogs['dnd55-ru-2026.09'];
  assert.equal(entry.core.url, './dnd55-ru-2026.09.core.json');
  assert.equal(entry.previews.url, './dnd55-ru-2026.09.previews.json');
  assert.equal(entry.core.bytes, coreBytes.length);
  assert.equal(entry.previews.bytes, previewsBytes.length);
  assert.equal(entry.core.sha256, createHash('sha256').update(coreBytes).digest('hex'));
  assert.equal(entry.previews.sha256, createHash('sha256').update(previewsBytes).digest('hex'));
});

test('determinism: same input gives same content hash and previews', () => {
  const a = buildCatalogCore(parseCatalog(source()), OPTS);
  const b = buildCatalogCore(parseCatalog(source()), { ...OPTS, releasedAt: '2030-01-01T00:00:00.000Z' });
  assert.equal(a.metadata.contentHash, b.metadata.contentHash);
  assert.equal(serializeArtifact({ system: a.system, sections: a.sections, entries: a.entries }),
    serializeArtifact({ system: b.system, sections: b.sections, entries: b.entries }));
  assert.equal(serializeArtifact(buildCatalogPreviews(parseCatalog(source()), { catalogId: OPTS.catalogId })),
    serializeArtifact(buildCatalogPreviews(parseCatalog(source()), { catalogId: OPTS.catalogId })));
});

test('catalog id and version validation', () => {
  assert.equal(makeCatalogId({ catalogVersion: '2026.09' }), 'dnd55-ru-2026.09');
  assert.throws(() => validateCatalogVersion('../evil'), /Некорректная версия/);
  assert.throws(() => validateCatalogVersion(''), /Некорректная версия/);
});
