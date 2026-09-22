// Portable HTML import — 1shot layer (phase B2.1).
//
// The format contract (extract/validate/parse, codes, UID/portrait checks)
// lives in @soyman/shared and is used by both products — there is no second
// parser. This module adds only 1shot specifics on top:
//   - deep catalog validation via the existing parseCatalog;
//   - import decision / slice-reuse / replace-merge for the 1shot IndexedDB;
//   - the HTML size cap.
//
// The shared contract is imported from source (single truth for vite,
// tsc and node type-stripping); only 1shot specifics live here.
import {
  portableError,
  isCharacterUid,
  isSupportedPortrait,
  extractPortablePayload,
  validatePortablePayload as validateShared,
  PORTABLE_FORMAT,
  PORTABLE_VERSION,
} from '../../shared/src/portable/parse.ts';
import { parseCatalog } from './catalog.mjs';

export {
  portableError,
  isCharacterUid,
  isSupportedPortrait,
  extractPortablePayload,
  PORTABLE_FORMAT,
  PORTABLE_VERSION,
};
export const PORTABLE_MAX_HTML_BYTES = 64 * 1024 * 1024;

// Structural validation (shared) + catalog slice validation via the existing
// parseCatalog. Deep character normalization (parseCharacterContent) still
// runs on the caller side before any IndexedDB write.
export function validatePortablePayload(payload) {
  const base = validateShared(payload);
  let catalog;
  try {
    catalog = parseCatalog(base.catalog);
  } catch {
    throw portableError('invalid-catalog', 'Не удалось восстановить игровые данные персонажа.');
  }
  return { ...base, catalog };
}

// Full pipeline: HTML text -> validated import data.
export function parsePortableHtml(htmlText) {
  const raw = extractPortablePayload(htmlText);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw portableError('damaged-payload', 'Файл персонажа повреждён или имеет неподдерживаемую версию.');
  }
  return validatePortablePayload(payload);
}

// Import decision (phase B1.2), pure so node:test covers it. The UID is the
// only matching key — never a payload hash, never the name.
//   v1 (no UID), or v2 UID with zero local matches -> create a new record;
//   exactly one local match -> ask the player (update / copy / cancel);
//   several locals share one UID (old backups, broken states) -> conflict:
//   never pick a record silently, only a fresh-UID copy is allowed.
export function decidePortableImport({ characterUid, characters }) {
  if (!isCharacterUid(characterUid)) return { action: 'create' };
  const matches = (characters || []).filter((c) => c && c.characterUid === characterUid);
  if (matches.length === 0) return { action: 'create' };
  if (matches.length === 1) return { action: 'confirm', match: matches[0] };
  console.warn(`portable identity conflict: ${matches.length} local characters share UID ${characterUid}`);
  return { action: 'conflict', matches };
}

// Slice lifecycle (phase B1.2 §13): the old pinned catalog may be overwritten
// in place only when it is provably this character's private portable slice —
// referenced by nobody else, not the current pointer, and not a managed
// release (managed records carry metadata.id). Anything shared or of unknown
// provenance gets a fresh slice key and the old record is left untouched.
// No generic custom-catalog GC here.
export function shouldReuseCatalogSlice({ catalogKey, catalog, referencedByCount, isCurrent }) {
  if (typeof catalogKey !== 'string' || !catalogKey) return false;
  if (isCurrent) return false;
  if ((referencedByCount ?? 1) !== 1) return false;
  if (catalog && typeof catalog === 'object' && catalog.metadata && typeof catalog.metadata.id === 'string') return false;
  return true;
}

// Replace (not merge): the file state supersedes the local state wholesale.
// Keeps local id + UID, bumps the CAS revision from the stored record —
// never copies any revision from another device.
export function buildCharacterUpdate(local, { name, content, portrait, catalogKey }) {
  return {
    ...local,
    name,
    content,
    portrait,
    catalogKey,
    revision: local.revision + 1,
  };
}
