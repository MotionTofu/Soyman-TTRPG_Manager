// Catalog Delivery v2 — runtime manager (phase A1.1).
//
// Orchestration layer between HTTP release files, repository (persistence)
// and main.tsx (UI). Installs the managed CORE only; previews are validated
// as types but never fetched (phase A1.3).
//
// Purity/testing: all side effects (fetch, digest, store) come through the
// injected `deps`, so this module runs in node tests as well as the browser.
// repository.ts stays persistence-only; no network code enters it.
import { parseCatalog, serializeArtifact } from './catalog.mjs';

export const MANIFEST_URL = 'catalog/manifest.json';
export const MANIFEST_FORMAT = 'soyman-catalog-manifest';
export const MANIFEST_VERSION = 1;
export const CORE_FORMAT = 'soyman-catalog-core';
export const CORE_VERSION = 1;
export const PREVIEWS_FORMAT = 'soyman-catalog-previews';
export const PREVIEWS_VERSION = 1;
export const RELEASE_SCHEMA_VERSION = 2;

export function catalogError(code, detail) {
  const error = Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}

// --- validation (pure) ---

export function validateManifest(data) {
  if (!data || typeof data !== 'object') throw catalogError('manifest-invalid', 'not an object');
  if (data.format !== MANIFEST_FORMAT) throw catalogError('manifest-invalid', `format ${String(data.format)}`);
  if (data.version !== MANIFEST_VERSION) throw catalogError('manifest-invalid', `version ${String(data.version)}`);
  if (typeof data.current !== 'string' || !data.current) throw catalogError('manifest-invalid', 'current missing');
  const catalogs = data.catalogs;
  if (!catalogs || typeof catalogs !== 'object') throw catalogError('manifest-invalid', 'catalogs missing');
  const entry = catalogs[data.current];
  if (!entry || typeof entry !== 'object') throw catalogError('manifest-invalid', `current ${data.current} not in catalogs`);
  for (const field of ['schemaVersion', 'system', 'language', 'catalogVersion']) {
    if (entry[field] === undefined || entry[field] === null || entry[field] === '') {
      throw catalogError('manifest-invalid', `catalogs.${data.current}.${field} missing`);
    }
  }
  if (entry.schemaVersion !== RELEASE_SCHEMA_VERSION) throw catalogError('manifest-invalid', `schemaVersion ${String(entry.schemaVersion)}`);
  for (const part of ['core', 'previews']) {
    const ref = entry[part];
    // previews metadata is read for validation only; never fetched in this phase.
    if (!ref || typeof ref !== 'object' || typeof ref.url !== 'string' || !ref.url
      || typeof ref.sha256 !== 'string' || !ref.sha256
      || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) {
      throw catalogError('manifest-invalid', `catalogs.${data.current}.${part} incomplete`);
    }
  }
  return { catalogId: data.current, entry };
}

export async function validateCoreRelease(core, catalogId, entry, digestSha256) {
  if (!core || typeof core !== 'object') throw catalogError('core-invalid', 'not an object');
  if (core.format !== CORE_FORMAT) throw catalogError('core-invalid', `format ${String(core.format)}`);
  if (core.version !== CORE_VERSION) throw catalogError('core-invalid', `version ${String(core.version)}`);
  if (core.catalogId !== catalogId) throw catalogError('core-invalid', 'catalogId mismatch');
  const meta = core.metadata;
  if (!meta || typeof meta !== 'object') throw catalogError('core-invalid', 'metadata missing');
  if (meta.id !== catalogId) throw catalogError('core-invalid', 'metadata.id mismatch');
  if (meta.schemaVersion !== RELEASE_SCHEMA_VERSION) throw catalogError('core-invalid', 'schemaVersion mismatch');
  for (const field of ['system', 'language', 'catalogVersion']) {
    if (meta[field] !== entry[field]) throw catalogError('core-invalid', `metadata.${field} mismatch`);
  }
  if (typeof meta.contentHash !== 'string' || !meta.contentHash) throw catalogError('core-invalid', 'contentHash missing');
  const content = { system: core.system, sections: core.sections, entries: core.entries };
  // Recomputed with the injected digest (WebCrypto in browser and node):
  // catalog-release.mjs hashing is node-only (node:crypto) and must not run here.
  const recomputed = await digestSha256(new TextEncoder().encode(serializeArtifact(content)));
  if (recomputed.toLowerCase() !== meta.contentHash.toLowerCase()) throw catalogError('core-invalid', 'contentHash mismatch');
  // Reuse the single legacy validator for system/sections/entries shape.
  const catalog = parseCatalog(content);
  return { catalog, metadata: meta };
}

// --- orchestration ---

function resolveUrl(url, base) {
  if (/^(https?:)?\/\//.test(url) || url.startsWith('/')) return url;
  const trimmed = String(base || '').replace(/\/[^/]*$/, '/');
  return trimmed + url.replace(/^\.\//, '');
}

export async function loadManifest(deps, url = MANIFEST_URL) {
  let response;
  try {
    response = await deps.fetchJson(url);
  } catch (e) {
    throw catalogError('manifest-unavailable', e instanceof Error ? e.message : String(e));
  }
  return validateManifest(response);
}

export async function fetchVerifiedCore(deps, catalogId, entry, manifestBase) {
  const url = resolveUrl(entry.core.url, manifestBase);
  let bytes;
  try {
    bytes = await deps.fetchBytes(url);
  } catch (e) {
    throw catalogError('core-fetch-failed', e instanceof Error ? e.message : String(e));
  }
  if (bytes.length !== entry.core.bytes) throw catalogError('bytes-mismatch', `got ${bytes.length}, manifest ${entry.core.bytes}`);
  const hex = await deps.digestSha256(bytes);
  if (hex.toLowerCase() !== entry.core.sha256.toLowerCase()) throw catalogError('sha-mismatch', url);
  let core;
  try {
    core = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw catalogError('core-invalid', 'not JSON');
  }
  return validateCoreRelease(core, catalogId, entry, deps.digestSha256);
}

// The managed id is immutable: same id + different content is a release error,
// never a silent overwrite. That check runs after download (contentHash is
// only known then); here is just the no-download fast path.
export function decideInstall(installed, catalogId, entry) {
  const meta = installed ? installed.metadata : undefined;
  if (installed && meta && meta.id === catalogId && meta.catalogVersion === entry.catalogVersion) return 'up-to-date';
  return 'install';
}

export async function ensureCurrentCatalog(deps, manifestUrl = MANIFEST_URL) {
  let manifest;
  try {
    manifest = await loadManifest(deps, manifestUrl);
  } catch (e) {
    if (e && e.code === 'manifest-unavailable') {
      // Offline/server without release: an already-configured local catalog
      // keeps working. Network is needed for a new catalog, not for the right
      // to use the installed one.
      const localKey = await deps.store.getCurrent();
      if (localKey && await deps.store.has(localKey)) return { status: 'local', catalogId: localKey };
      throw catalogError('no-catalog-offline', 'manifest unreachable and no local catalog');
    }
    throw e;
  }
  const { catalogId, entry } = manifest;
  const installed = await deps.store.get(catalogId);
  if (decideInstall(installed, catalogId, entry) === 'up-to-date') {
    if ((await deps.store.getCurrent()) !== catalogId) await deps.store.setCurrent(catalogId);
    return { status: 'ready', catalogId };
  }
  const { catalog, metadata } = await fetchVerifiedCore(deps, catalogId, entry, manifestUrl);
  const priorHash = installed && installed.metadata ? installed.metadata.contentHash : undefined;
  if (priorHash && priorHash !== metadata.contentHash) {
    throw catalogError('release-changed', `${catalogId} content differs from installed copy`);
  }
  await deps.store.install({ ...catalog, metadata }, catalogId, true);
  return { status: 'installed', catalogId };
}

// --- previews (phase A1.3, storage split in A2.2) ---
//
// Preview media lives in a separate catalogPreviews record keyed by catalogId.
// Core entries stay free of base64. Source of truth for "installed" is the
// preview record's sha256 versus the manifest (variant B): metadata.previews
// is a legacy marker from A1.3, written no more and never read by runtime.

// Pure split for the v1 -> v2 upgrade (also unit-tested): managed records with
// an installed-previews marker move their embedded images out; everything
// else (legacy, ambiguous, sha-less) returns null and stays untouched.
export function splitManagedPreviews(key, catalog) {
  const meta = catalog ? catalog.metadata : undefined;
  if (!meta || typeof meta !== 'object') return null;
  if (meta.id !== key || meta.schemaVersion !== RELEASE_SCHEMA_VERSION) return null;
  if (!meta.previews || meta.previews.installed !== true) return null;
  if (typeof meta.previews.sha256 !== 'string' || !meta.previews.sha256) return null;
  const images = {};
  let found = false;
  for (const entry of catalog.entries || []) {
    if (isPreviewUrl(entry.avatar_preview_url)) {
      images[String(entry.id)] = entry.avatar_preview_url;
      found = true;
    }
  }
  if (!found) return null;
  return {
    core: { ...catalog, entries: catalog.entries.map(e => ({ ...e, avatar_preview_url: null })) },
    previews: { catalogId: key, sha256: meta.previews.sha256, images },
  };
}

function isPreviewUrl(value) {
  return typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/.test(value);
}

export function validatePreviewsPackage(pkg, catalogId, installed) {
  if (!pkg || typeof pkg !== 'object') throw catalogError('preview-invalid', 'not an object');
  if (pkg.format !== PREVIEWS_FORMAT) throw catalogError('preview-invalid', `format ${String(pkg.format)}`);
  if (pkg.version !== PREVIEWS_VERSION) throw catalogError('preview-invalid', `version ${String(pkg.version)}`);
  if (pkg.catalogId !== catalogId) throw catalogError('preview-catalog-mismatch', `${String(pkg.catalogId)} !== ${catalogId}`);
  if (!pkg.images || typeof pkg.images !== 'object' || Array.isArray(pkg.images)) throw catalogError('preview-invalid', 'images missing');
  const known = new Set(installed.entries.map(e => e.id));
  for (const [rawId, url] of Object.entries(pkg.images)) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0 || !known.has(id)) throw catalogError('preview-invalid', `unknown entry ${rawId}`);
    if (!isPreviewUrl(url)) throw catalogError('preview-invalid', `entry ${rawId} is not a self-contained image`);
  }
  return pkg.images;
}

// Deterministic merge: order, ids, game fields untouched; only
// avatar_preview_url is filled, avatar_large_url is never restored.
export function mergePreviews(catalog, images) {
  return {
    ...catalog,
    entries: catalog.entries.map(e => ({ ...e, avatar_preview_url: images[String(e.id)] ?? null })),
  };
}

async function fetchVerifiedPreviews(deps, catalogId, entry, manifestBase, installed) {
  const url = resolveUrl(entry.previews.url, manifestBase);
  let bytes;
  try {
    bytes = await deps.fetchBytes(url);
  } catch (e) {
    throw catalogError('preview-unavailable', e instanceof Error ? e.message : String(e));
  }
  if (bytes.length !== entry.previews.bytes) throw catalogError('preview-bytes-mismatch', `got ${bytes.length}, manifest ${entry.previews.bytes}`);
  const hex = await deps.digestSha256(bytes);
  if (hex.toLowerCase() !== entry.previews.sha256.toLowerCase()) throw catalogError('preview-sha-mismatch', url);
  let pkg;
  try {
    pkg = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw catalogError('preview-invalid', 'not JSON');
  }
  return validatePreviewsPackage(pkg, catalogId, installed);
}

// Non-fatal by contract: any preview-* error leaves the installed core
// untouched; callers treat failure as "run without images".
export async function ensureCatalogPreviews(deps, catalogId, manifestUrl = MANIFEST_URL) {
  const installed = await deps.store.get(catalogId);
  if (!installed) return { status: 'skipped', reason: 'no-catalog', catalogId };
  // Managed-only: legacy/custom records have no release metadata and are
  // never touched by the preview pipeline.
  if (!installed.metadata || installed.metadata.id !== catalogId) return { status: 'skipped', reason: 'legacy', catalogId };
  let manifest;
  try {
    manifest = await loadManifest(deps, manifestUrl);
  } catch (e) {
    throw catalogError('preview-unavailable', e instanceof Error ? e.message : String(e));
  }
  if (manifest.catalogId !== catalogId) return { status: 'skipped', reason: 'superseded', catalogId };
  const { entry } = manifest;
  const existing = await deps.store.getPreviews(catalogId);
  if (existing && existing.catalogId === catalogId) {
    if (existing.sha256 === entry.previews.sha256) return { status: 'ready', catalogId };
    // Immutable release: same id must never change content. Keep serving the
    // old images until an operator fixes the release; never overwrite blindly.
    throw catalogError('preview-release-changed', `${catalogId} previews differ from installed copy`);
  }
  const images = await fetchVerifiedPreviews(deps, catalogId, entry, manifestUrl, installed);
  await deps.store.savePreviews({ catalogId, sha256: entry.previews.sha256, images });
  return { status: 'installed', catalogId, count: Object.keys(images).length };
}

// --- garbage collection (phase A1.4): conservative, managed-only ---
//
// A catalog is managed only when its own metadata says so:
// metadata.id === storage key and schemaVersion === 2. Anything else
// (legacy UUID records, malformed metadata) is KEPT, never deleted.

// TODO: pinned older managed catalogs whose previews never installed stay
// imageless once manifest.current moves on (ensureCatalogPreviews only serves
// the current id; see phase A1.3 report). Referenced ones are still KEPT here.
// A future micro-improvement: serve previews for any id listed in
// manifest.catalogs (today the manifest carries a single current entry).

export function isManagedRecord(key, catalog) {
  const meta = catalog ? catalog.metadata : undefined;
  return !!meta && typeof meta === 'object' && meta.id === key && meta.schemaVersion === RELEASE_SCHEMA_VERSION;
}

// Pure decision: which keys to delete. Characters include drafts
// (content === null already carries a catalogKey).
export function selectGarbageCatalogKeys({ records, characters, currentKey }) {
  const referenced = new Set(
    (characters || []).map(c => c && c.catalogKey).filter(k => typeof k === 'string' && k),
  );
  const garbage = [];
  for (const { key, catalog } of records || []) {
    if (!isManagedRecord(key, catalog)) continue; // legacy/custom/malformed: KEEP
    if (key === currentKey) continue; // current is always protected
    if (referenced.has(key)) continue; // any character or draft pins it
    garbage.push(key);
  }
  return garbage;
}

// Runs only after a usable catalog is established (see main.tsx ordering).
// Never throws: housekeeping must not break startup; at most one console
// warning for debuggability. Never touches characters or settings.
export async function garbageCollectCatalogs(deps) {
  try {
    const [records, characters, currentKey] = await Promise.all([
      deps.store.listRecords(),
      deps.listCharacters(),
      deps.store.getCurrent(),
    ]);
    const garbage = selectGarbageCatalogKeys({ records, characters, currentKey });
    for (const key of garbage) {
      // Dual delete: the core and its preview media go in one transaction.
      await deps.store.deleteCatalog(key);
    }
    return { deleted: garbage };
  } catch (e) {
    console.warn('catalog GC skipped:', e instanceof Error ? e.message : String(e));
    return { deleted: [] };
  }
}
