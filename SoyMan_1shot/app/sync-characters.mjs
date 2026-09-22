// Character sync data plane (phases D1.2 + D1.3).
//
// Pure, framework-free so node:test covers the semantics without IndexedDB
// or network: snapshot bundle building, structural validation and the sync
// planner. Transport (fetch) and persistence (IndexedDB) live in main.tsx;
// the server re-validates everything on its side.
//
// D1.3 splits the mutable character document from immutable content-
// addressed artifacts (catalog slice, portrait). An HP change re-sends only
// the small document; unchanged artifacts are referenced by SHA-256 and
// never re-uploaded. Artifacts are immutable: no revisions, no rollback,
// orphans are future housekeeping — never a distributed transaction.
//
// Transport note: sync JSON and portable HTML stay separate formats. The
// catalog *slice* logic is shared via candidateCatalog (portable.mjs) —
// one slice computation, two transports.
import { candidateCatalog } from './portable.mjs';
import { isCharacterUid, isSupportedPortrait } from './portable-import.mjs';

export const SYNC_CHARACTER_FORMAT = 'soyman-sync-character';
// v1 (D1.2): embedded catalog slice + portrait. Read-supported, never
// written by new pushes. v2 (D1.3): document + artifact hashes.
export const SYNC_CHARACTER_VERSION = 1;
export const SYNC_CHARACTER_VERSION_V2 = 2;

export function syncBundleError(code, message) {
  const error = Error(message || code);
  error.code = code;
  return error;
}

// Pure-JS SHA-256. Deliberate: devices sync over plain-http LAN, which is
// not a secure context, so crypto.subtle may be unavailable. Same input
// bytes always give the same hex here, in node and in every browser; the
// server re-hashes with Node crypto and rejects any mismatch, so this is
// never trusted blindly.
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256HexText(text) {
  const data = new TextEncoder().encode(text);
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(data.length / 0x20000000));
  view.setUint32(padded.length - 4, (data.length << 3) >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[i] + w[i]) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

export function utf8ByteLength(text) {
  return new TextEncoder().encode(text).length;
}

// Deterministic serialization for sync hashing: recursive key sort with
// JSON undefined-semantics (skipped in objects, null in arrays). The catalog
// shape is known and small — no universal canonical-JSON framework.
export function stableStringify(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v) ?? 'null').join(',')}]`;
  const keys = Object.keys(value).filter((k) => {
    const v = value[k];
    return v !== undefined && typeof v !== 'function' && typeof v !== 'symbol';
  }).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

const SYNC_MEDIA_KEYS = [
  'avatar_preview_url', 'avatar_large_url', 'avatar_image_url',
  'avatar_preview_data', 'avatar_data',
];

function stripSyncEntryMedia(entry) {
  const copy = { ...entry };
  for (const key of SYNC_MEDIA_KEYS) delete copy[key];
  return copy;
}

// The character-specific catalog slice shared by both transports (v1 bundle
// and v2 artifact): candidateCatalog computation, images stripped. Never
// previews/media (§3).
export function characterSlicePayload(character, catalog) {
  const audit = candidateCatalog({ content: character.content, portrait: character.portrait }, catalog);
  return {
    system: audit.candidate.system,
    sections: audit.candidate.sections,
    entries: structuredClone(audit.candidate.entries).map(stripSyncEntryMedia),
  };
}

const byNumericId = (a, b) => (Number(a?.id) || 0) - (Number(b?.id) || 0);

function sortDeepObject(value) {
  if (Array.isArray(value)) return value.map(sortDeepObject);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeepObject(value[k]);
    return out;
  }
  return value;
}

// Canonical catalog slice: same logical slice always hashes the same, on any
// device. Sections/entries sorted by numeric id (display order travels in
// the `position` fields, which parseCatalog preserves), every object
// key-sorted. Wire payload IS this canonical form, so the server stores it
// verbatim and any device recomputes the identical hash.
export function canonicalCatalogSlice(slice) {
  const sections = Array.isArray(slice?.sections) ? slice.sections : [];
  const entries = Array.isArray(slice?.entries) ? slice.entries : [];
  return {
    system: sortDeepObject(slice?.system ?? null),
    sections: [...sections].map(sortDeepObject).sort(byNumericId),
    entries: [...entries].map(sortDeepObject).sort(byNumericId),
  };
}

export function catalogArtifactHash(canonicalSlice) {
  return sha256HexText(stableStringify(canonicalCatalogSlice(canonicalSlice)) ?? 'null');
}

const PORTRAIT_MIME = new Set(['png', 'jpeg', 'webp']);

// Canonical portrait: normalized data URL. Decision (§6): the app stores
// portraits as FileReader data URLs verbatim, so the same file is already
// the same string on any device; hashing the normalized representation
// (lowercased mime, stripped base64 whitespace) is deterministic without
// re-encoding image bytes. Null stays null — no artifact.
export function canonicalPortrait(portrait) {
  if (portrait === null || portrait === undefined) return null;
  if (typeof portrait !== 'string') return undefined;
  const match = /^\s*data:image\/([^;,]+);base64,([\s\S]+?)\s*$/i.exec(portrait);
  if (!match) return undefined;
  const mime = match[1].toLowerCase();
  if (!PORTRAIT_MIME.has(mime)) return undefined;
  const base64 = match[2].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return undefined;
  return `data:image/${mime};base64,${base64}`;
}

export function portraitArtifactHash(canonical) {
  return sha256HexText(canonical);
}

export function isArtifactHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

// Portable transferable snapshot of one finished character. Carries only:
// name, content (current runtime state included), portrait, archivedAt, plus
// a sufficient catalog slice (images stripped, like portable). Never: local
// id, local revision, catalogKey, drafts, sync metadata, credentials.
export function buildSyncBundle(character, catalog, characterUid) {
  if (!character?.content) {
    throw syncBundleError('draft', 'Черновик не синхронизируется — завершите создание персонажа');
  }
  if (!isCharacterUid(characterUid)) {
    throw syncBundleError('no-identity', 'У персонажа нет stable identity для синхронизации');
  }
  if (!catalog) {
    throw syncBundleError('no-catalog', `Нет справочника для персонажа «${character.content.characterName || character.name}»`);
  }
  // Best-effort slice: problems/external media never reject a sync, the
  // pulled sheet simply degrades the same way portable does.
  const slice = characterSlicePayload(character, catalog);
  return {
    format: SYNC_CHARACTER_FORMAT,
    version: SYNC_CHARACTER_VERSION,
    characterUid,
    character: {
      name: typeof character.content.characterName === 'string' && character.content.characterName
        ? character.content.characterName
        : character.name,
      content: structuredClone(character.content),
      portrait: character.portrait ?? null,
      archivedAt: character.archivedAt ?? null,
    },
    catalog: slice,
  };
}

// v2 sync parts (D1.3): small mutable document plus immutable artifact
// payloads with their hashes. One call so document refs and payloads can
// never disagree. Throws the same 'draft'/'no-identity'/'no-catalog' errors
// as the v1 builder.
export function buildSyncV2Parts(character, catalog, characterUid) {
  if (!character?.content) {
    throw syncBundleError('draft', 'Черновик не синхронизируется — завершите создание персонажа');
  }
  if (!isCharacterUid(characterUid)) {
    throw syncBundleError('no-identity', 'У персонажа нет stable identity для синхронизации');
  }
  if (!catalog) {
    throw syncBundleError('no-catalog', `Нет справочника для персонажа «${character.content.characterName || character.name}»`);
  }
  const catalogPayload = canonicalCatalogSlice(characterSlicePayload(character, catalog));
  const catalogHash = catalogArtifactHash(catalogPayload);
  const portraitPayload = canonicalPortrait(character.portrait ?? null);
  if (portraitPayload === undefined) {
    throw syncBundleError('invalid-character', 'Не удалось восстановить персонажа из снимка');
  }
  const portraitHash = portraitPayload === null ? null : portraitArtifactHash(portraitPayload);
  return {
    document: {
      format: SYNC_CHARACTER_FORMAT,
      version: SYNC_CHARACTER_VERSION_V2,
      characterUid,
      character: {
        name: typeof character.content.characterName === 'string' && character.content.characterName
          ? character.content.characterName
          : character.name,
        content: structuredClone(character.content),
        archivedAt: character.archivedAt ?? null,
      },
      artifacts: { catalogHash, portraitHash },
    },
    catalogPayload,
    portraitPayload,
    catalogHash,
    portraitHash,
  };
}

// Structural validation of an incoming snapshot (both directions use it:
// engine before pull-apply, tests for round-trips). Deep checks
// (normalizeDndCharacter, parseCatalog) stay with the caller, next to the
// existing portable validation.
export function validateSyncSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw syncBundleError('damaged', 'Повреждённый снимок персонажа');
  }
  if (snapshot.format !== SYNC_CHARACTER_FORMAT) {
    throw syncBundleError('not-sync', 'Это не снимок синхронизации SoyMan');
  }
  if (snapshot.version !== SYNC_CHARACTER_VERSION && snapshot.version !== SYNC_CHARACTER_VERSION_V2) {
    throw syncBundleError('unsupported-version', 'Неподдерживаемая версия снимка персонажа');
  }
  if (!isCharacterUid(snapshot.characterUid)) {
    throw syncBundleError('no-identity', 'В снимке нет stable identity персонажа');
  }
  const c = snapshot.character;
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw syncBundleError('damaged', 'Повреждённый снимок персонажа');
  if (!c.content || typeof c.content !== 'object' || Array.isArray(c.content)) {
    throw syncBundleError('invalid-character', 'Не удалось восстановить персонажа из снимка');
  }
  const base = {
    version: snapshot.version,
    characterUid: snapshot.characterUid,
    name: typeof c.name === 'string' && c.name ? c.name : 'Импортированный персонаж',
    content: c.content,
    archivedAt: typeof c.archivedAt === 'string' ? c.archivedAt : null,
  };
  // v1: embedded bytes (D1.2). v2: content-addressed refs resolved by the
  // engine via the artifact API; catalog/portrait stay null here on purpose.
  if (snapshot.version === SYNC_CHARACTER_VERSION_V2) {
    const a = snapshot.artifacts;
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw syncBundleError('damaged', 'Повреждённый снимок персонажа');
    if (!isArtifactHash(a.catalogHash)) throw syncBundleError('invalid-catalog', 'Не удалось восстановить справочник из снимка');
    if (a.portraitHash !== null && !isArtifactHash(a.portraitHash)) {
      throw syncBundleError('invalid-character', 'Не удалось восстановить персонажа из снимка');
    }
    return { ...base, catalog: null, portrait: null, catalogHash: a.catalogHash, portraitHash: a.portraitHash ?? null };
  }
  if (c.portrait !== null && c.portrait !== undefined && !isSupportedPortrait(c.portrait)) {
    throw syncBundleError('invalid-character', 'Не удалось восстановить персонажа из снимка');
  }
  const catalog = snapshot.catalog;
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)
    || !Array.isArray(catalog.sections) || !Array.isArray(catalog.entries)) {
    throw syncBundleError('invalid-catalog', 'Не удалось восстановить справочник из снимка');
  }
  return {
    ...base,
    catalog,
    portrait: c.portrait ?? null,
    catalogHash: null,
    portraitHash: null,
  };
}

// v2 push orchestration (D1.3): ensure missing artifacts first, then the
// character CAS. Transport is injected ({headArtifact, putArtifact,
// putCharacter}) so node:test records uploads without network.
//
// Artifact upload never implies a successful character sync: if the CAS
// loses afterwards, the orphan immutable artifact simply stays — no
// cross-resource rollback, ever (§11). Known hashes (confirmed uploaded by
// an earlier sync and stored in meta) skip even the existence check:
// artifacts are immutable, so a known hash exists by definition.
export async function pushCharacterV2(transport, { uid, base, parts, meta }) {
  let uploadedBytes = 0;
  const ensure = async (hash, kind, payload, knownHash) => {
    if (payload === null || payload === undefined) return;
    if (knownHash === hash) return;
    if (await transport.headArtifact(hash)) return;
    const stored = await transport.putArtifact(hash, kind, payload);
    uploadedBytes += stored && Number.isSafeInteger(stored.bytes) ? stored.bytes : 0;
  };
  await ensure(parts.catalogHash, 'catalog', parts.catalogPayload, meta?.catalogHash);
  await ensure(parts.portraitHash, 'portrait', parts.portraitPayload, meta?.portraitHash);
  const body = { baseRevision: base, payload: parts.document };
  uploadedBytes += utf8ByteLength(JSON.stringify(body));
  const res = await transport.putCharacter(uid, body);
  return {
    revision: res.revision,
    uploadedBytes,
    catalogHash: parts.catalogHash,
    portraitHash: parts.portraitHash,
  };
}

// Pure sync planner. Inputs: local record (or null), local sync metadata (or
// null), remote index entry (or null), count of local records sharing the
// UID. Output actions: push {base} / pull / noop / conflict {kind} /
// push-delete {base} / pull-delete / ack-tombstone / error-duplicate.
// No network, no DOM — table-driven tests cover the matrix.
export function decideCharacterSync({ local, sync, remote, duplicateCount }) {
  if ((duplicateCount ?? 1) > 1) return { action: 'error-duplicate' };
  // No local record.
  if (!local) {
    if (sync?.deletedLocally) {
      if (!remote) return { action: 'noop' };
      if (remote.revision === sync.remoteRevision) return { action: 'push-delete', base: remote.revision };
      if (remote.deleted) return { action: 'ack-tombstone' };
      return { action: 'conflict', kind: 'local-deleted-remote-changed' };
    }
    if (!remote) return { action: 'noop' };
    if (remote.deleted) return { action: 'noop' };
    return { action: 'pull' };
  }
  // Draft shells never sync: the creation wizard state is elsewhere.
  if (!local.content) return { action: 'noop' };
  if (!remote) return { action: 'push', base: 0 };
  // First contact with an existing remote row is never auto-merged.
  if (!sync) {
    return { action: 'conflict', kind: remote.deleted ? 'remote-deleted-unmatched' : 'both-changed' };
  }
  const localDirty = sync.lastSyncedLocalRevision == null || local.revision !== sync.lastSyncedLocalRevision;
  const remoteChanged = remote.revision !== sync.remoteRevision;
  if (remote.deleted) {
    if (!localDirty && !remoteChanged) return { action: 'noop' };
    if (!localDirty) return { action: 'pull-delete' };
    return { action: 'conflict', kind: 'remote-deleted-local-changed' };
  }
  if (!localDirty && !remoteChanged) return { action: 'noop' };
  if (localDirty && !remoteChanged) return { action: 'push', base: sync.remoteRevision };
  if (!localDirty && remoteChanged) return { action: 'pull' };
  return { action: 'conflict', kind: 'both-changed' };
}
