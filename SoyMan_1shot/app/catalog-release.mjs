// Catalog Delivery v2 — release builder (phase 1).
//
// Pure functions only: validated catalog in, release artifacts out.
// - `core` keeps the full game content (system/sections/entries) with image
//   payloads nulled. Nulls (not deleted keys) are intentional: the legacy
//   `private/catalog.json` already stores nulls for imageless entries, so every
//   existing consumer (transport presentEntry, parseCatalog, export-audit)
//   handles this shape today.
// - `previews` carries only entryId -> avatar_preview_url for entries that
//   actually have one. avatar_large_url is excluded from the release entirely.
// - Determinism: same input + same options => byte-identical core/previews and
//   identical contentHash. `releasedAt` is metadata only and never hashed.
//   Serialization rule: plain JSON.stringify on freshly constructed objects
//   with fixed key order; entry order is preserved from the input catalog.
//   No randomness anywhere in this module.
//
// Reading SQLite stays in prepare-catalog.mjs; file packaging stays in the
// CLI (build-catalog-release.mjs) and package-server.mjs.
//
// NODE-ONLY WARNING: hashArtifact/hashCatalogContent use node:crypto and must
// never run in the browser bundle. The runtime manager (catalog-manager.mjs)
// recomputes content hashes through the injected digestSha256 (WebCrypto) and
// takes the shared serializeArtifact from catalog.mjs — never from here, so
// no browser module graph can reach node:crypto (vite dev serves the file
// raw and crashes, while production merely tree-shakes it away).
import { createHash } from 'node:crypto';
import { serializeArtifact } from './catalog.mjs';

export { serializeArtifact };

export const RELEASE_SCHEMA_VERSION = 2;
export const CORE_FORMAT = 'soyman-catalog-core';
export const PREVIEWS_FORMAT = 'soyman-catalog-previews';
export const MANIFEST_FORMAT = 'soyman-catalog-manifest';
export const CORE_VERSION = 1;
export const PREVIEWS_VERSION = 1;
export const MANIFEST_VERSION = 1;

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validateCatalogVersion(value) {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    throw Error(`Некорректная версия каталога: ${String(value)}. Ожидается вида 2026.09 (латиница, цифры, . _ -).`);
  }
  return value;
}

export function makeCatalogId({ system = 'dnd55', language = 'ru', catalogVersion }) {
  validateCatalogVersion(catalogVersion);
  if (typeof system !== 'string' || !VERSION_PATTERN.test(system)) throw Error(`Некорректный system: ${String(system)}`);
  if (typeof language !== 'string' || !VERSION_PATTERN.test(language)) throw Error(`Некорректный language: ${String(language)}`);
  return `${system}-${language}-${catalogVersion}`;
}

export function coreFileName(catalogId) {
  return `${catalogId}.core.json`;
}

export function previewsFileName(catalogId) {
  return `${catalogId}.previews.json`;
}

function isDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

// Game content without image payloads. Keys stay present as null.
export function stripEntryMedia(entry) {
  const { avatar_large_url, avatar_preview_url, ...rest } = entry;
  void avatar_large_url;
  void avatar_preview_url;
  return { ...rest, avatar_large_url: null, avatar_preview_url: null };
}

export function hashArtifact(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Hash covers content only: system + sections + entries. Metadata
// (releasedAt, filenames, file hashes) is deliberately outside the hash.
export function hashCatalogContent({ system, sections, entries }) {
  return hashArtifact(serializeArtifact({ system, sections, entries }));
}

export function buildCatalogCore(catalog, { catalogId, catalogVersion, system = 'dnd55', language = 'ru', releasedAt }) {
  validateCatalogVersion(catalogVersion);
  if (!catalog || typeof catalog !== 'object') throw Error('Нужен валидный каталог (system/sections/entries)');
  const content = {
    system: structuredClone(catalog.system),
    sections: structuredClone(catalog.sections),
    entries: catalog.entries.map(stripEntryMedia),
  };
  const metadata = {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    id: catalogId,
    system,
    language,
    catalogVersion,
    releasedAt,
    contentHash: hashCatalogContent(content),
  };
  return { format: CORE_FORMAT, version: CORE_VERSION, catalogId, metadata, ...content };
}

export function buildCatalogPreviews(catalog, { catalogId }) {
  if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.entries)) throw Error('Нужен валидный каталог');
  const images = {};
  for (const entry of catalog.entries) {
    if (isDataUrl(entry.avatar_preview_url)) images[String(entry.id)] = entry.avatar_preview_url;
  }
  return { format: PREVIEWS_FORMAT, version: PREVIEWS_VERSION, catalogId, images };
}

export function buildCatalogManifest({ catalogId, metadata, coreFile, coreHash, coreBytes, previewsFile, previewsHash, previewsBytes }) {
  if (!catalogId || !metadata) throw Error('Нужны catalogId и metadata ядра');
  for (const [name, value] of [['coreFile', coreFile], ['coreHash', coreHash], ['previewsFile', previewsFile], ['previewsHash', previewsHash]]) {
    if (typeof value !== 'string' || !value) throw Error(`Нужен ${name}`);
  }
  for (const [name, value] of [['coreBytes', coreBytes], ['previewsBytes', previewsBytes]]) {
    if (!Number.isSafeInteger(value) || value < 0) throw Error(`Нужен ${name}`);
  }
  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    current: catalogId,
    catalogs: {
      [catalogId]: {
        schemaVersion: metadata.schemaVersion,
        system: metadata.system,
        language: metadata.language,
        catalogVersion: metadata.catalogVersion,
        releasedAt: metadata.releasedAt,
        core: { url: `./${coreFile}`, sha256: coreHash, bytes: coreBytes },
        previews: { url: `./${previewsFile}`, sha256: previewsHash, bytes: previewsBytes },
      },
    },
  };
}
