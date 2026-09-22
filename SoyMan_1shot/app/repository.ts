import type { DndCharacterData } from '@shared/dnd/types';
import { normalizeDndCharacter } from '@shared/dnd/normalize';
import { parseCatalog, repairSpellLevels } from './catalog.mjs';
import { splitManagedPreviews } from './catalog-manager.mjs';
import { shouldReuseCatalogSlice, buildCharacterUpdate } from './portable-import.mjs';
import { buildDuplicatePayload, copyNameFor, displayName, wizardDraftKey } from './library.mjs';
import { createTabSync, characterUpdated, characterDeleted } from './tab-sync.mjs';
// Cross-tab invalidation (phase C3): a module-level publisher, one channel
// per tab, created lazily. Published ONLY after a durable commit succeeds —
// never on enqueue, never on failure. Unsupported browsers get a no-op.
let sync: ReturnType<typeof createTabSync> | null = null;
function tabSync() {
  return (sync ??= createTabSync());
}
export interface Catalog { system: any; sections: any[]; entries: any[]; metadata?: CatalogMetadata }
export interface CatalogMetadata {
  schemaVersion: number;
  id: string;
  system: string;
  language: string;
  catalogVersion: string;
  releasedAt: string;
  contentHash: string;
  // Legacy marker from phase A1.3 (kept for old records, never written since
  // A2.2 and never read by runtime): source of truth for installed previews
  // is the catalogPreviews record's sha256 versus the manifest.
  previews?: {
    installed: boolean;
    sha256?: string;
  };
}
export interface CatalogPreviewRecord {
  catalogId: string;
  sha256: string;
  images: Record<string, string>;
}
export interface Character {
  id: number; name: string; content: DndCharacterData | null; portrait: string | null; catalogKey: string | null; revision: number;
  // Stable logical identity (phase B1.2), independent of the local IDB key:
  // id differs per device, characterUid travels through portable HTML.
  // Optional so pre-B1.2 records stay valid without a DB migration.
  characterUid?: string | null;
  // Local library (no DB migration: optional record field, no index needed).
  // Set => hidden from the active list, shown under Archive; nothing else
  // (catalog pin, portrait, runtime state) is touched by archiving.
  archivedAt?: string | null;
}
let opening: Promise<IDBDatabase>;
function database() {
  return opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('soyman-1shot-characters', 3);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('catalogs')) db.createObjectStore('catalogs');
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('catalogPreviews')) db.createObjectStore('catalogPreviews');
      // v2 -> v3: sync metadata lives in its own store (phase D1.2), keyed by
      // characterUid — never inside Character (would leak into backup,
      // portable and duplicate) and never one big settings blob.
      if (!db.objectStoreNames.contains('characterSync')) db.createObjectStore('characterSync', { keyPath: 'characterUid' });
      // v1 -> v2: split embedded managed previews into the new store, atomically
      // per record inside the versionchange transaction. Legacy records and any
      // ambiguous shape are left untouched; migration errors never abort upgrade.
      if (event.oldVersion < 2) migratePreviewsV2(request.transaction!);
    };
    request.onerror = () => reject(request.error); request.onblocked = () => reject(Error('Закройте другие окна OneShot и повторите'));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
function migratePreviewsV2(tx: IDBTransaction) {
  const swallow = (e: Event) => e.preventDefault();
  try {
    const catalogs = tx.objectStore('catalogs');
    const previews = tx.objectStore('catalogPreviews');
    const keysRequest = catalogs.getAllKeys();
    keysRequest.onsuccess = () => {
      for (const key of keysRequest.result as string[]) {
        const getRequest = catalogs.get(key);
        getRequest.onsuccess = () => {
          try {
            const split = splitManagedPreviews(String(key), getRequest.result as Catalog | undefined);
            if (split) {
              const putCore = catalogs.put(split.core, key);
              putCore.onerror = swallow;
              const putPreviews = previews.put(split.previews, key);
              putPreviews.onerror = swallow;
            }
          } catch {
            // Conservative: leave the record exactly as it was.
          }
        };
        getRequest.onerror = swallow;
      }
    };
    keysRequest.onerror = swallow;
  } catch {
    // If even enumeration fails, the database still upgrades; records stay v1-shaped.
  }
}
async function operation<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode); const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(tx.error || Error('Локальное сохранение прервано'));
  });
}
export const listCharacters = () => operation<Character[]>('characters', 'readonly', s => s.getAll());
export const getCharacter = (id: number) => operation<Character | undefined>('characters', 'readonly', s => s.get(id));
export async function getCatalog(key: string): Promise<Catalog | undefined> {
  const catalog = await operation<Catalog | undefined>('catalogs', 'readonly', s => s.get(key));
  // Repair only the field omitted by the initial local export. Keep pinned rules intact.
  if (import.meta.env.DEV && catalog?.entries.some(e => e.kind === 'spell' && e.level == null)) {
    const response = await fetch('/__local/catalog');
    if (!response.ok) throw Error('Для восстановления кругов заклинаний подготовьте локальный справочник SoyMan.');
    const repaired = repairSpellLevels(catalog, parseCatalog(await response.json()));
    if (repaired.entries.some((e, i) => e !== catalog.entries[i])) await operation('catalogs', 'readwrite', s => s.put(repaired, key));
    return repaired;
  }
  return catalog;
}
export const currentCatalog = () => operation<string | undefined>('settings', 'readonly', s => s.get('catalog'));
export const setCurrentCatalog = (key: string) => operation('settings', 'readwrite', s => s.put(key, 'catalog'));
export interface SyncCredential {
  version: 1;
  apiBase: string;
  spaceId: string;
  deviceId: string;
  deviceToken: string;
  linkedAt: string;
}
// Optional device-sync credential (phase D1.1), same settings store as the
// catalog pointer. Never serialized into character backups, portable HTML,
// BroadcastChannel or logs — only this key and the sync API ever see it.
export const getSyncCredential = () =>
  operation<SyncCredential | undefined>('settings', 'readonly', s => s.get('sync'));
export const saveSyncCredential = (credential: SyncCredential) =>
  operation('settings', 'readwrite', s => s.put(credential, 'sync'));
export const clearSyncCredential = () =>
  operation('settings', 'readwrite', s => s.delete('sync'));
export interface CharacterSyncMeta {
  characterUid: string;
  remoteRevision: number;
  lastSyncedLocalRevision: number | null;
  deletedLocally: boolean;
  syncedAt: string;
  // D1.3 artifact hashes: cache/optimization only (§14), never source of
  // truth. A hash stored here was confirmed uploaded — artifacts are
  // immutable, so pushes skip even the existence check for it.
  catalogHash?: string;
  portraitHash?: string | null;
}
// Sync bookkeeping (phase D1.2): which remote revision this local character
// was last confirmed against. Separate store by design (see DB v3 note).
export const getSyncMeta = (characterUid: string) =>
  operation<CharacterSyncMeta | undefined>('characterSync', 'readonly', s => s.get(characterUid));
export const listSyncMeta = () =>
  operation<CharacterSyncMeta[]>('characterSync', 'readonly', s => s.getAll());
export const saveSyncMeta = (meta: CharacterSyncMeta) =>
  operation('characterSync', 'readwrite', s => s.put(meta));
export const hasCatalog = async (key: string) => (await operation<unknown>('catalogs', 'readonly', s => s.get(key))) !== undefined;
export interface CatalogRecord {
  key: string;
  catalog: Catalog;
}
// Keys are out-of-line in the catalogs store, so keys and values are read in
// one transaction and zipped by position.
export async function listCatalogRecords(): Promise<CatalogRecord[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('catalogs', 'readonly');
    const store = tx.objectStore('catalogs');
    const keysRequest = store.getAllKeys();
    const valuesRequest = store.getAll();
    tx.oncomplete = () => resolve((valuesRequest.result as Catalog[]).map((catalog, i) => ({
      key: String(keysRequest.result[i]),
      catalog,
    })));
    tx.onerror = tx.onabort = () => reject(tx.error || Error('Не удалось прочитать каталоги'));
  });
}
export const deleteCatalogRecord = (key: string) => operation('catalogs', 'readwrite', s => s.delete(key));
export const getCatalogPreviews = (catalogId: string) => operation<CatalogPreviewRecord | undefined>('catalogPreviews', 'readonly', s => s.get(catalogId));
export const saveCatalogPreviews = (record: CatalogPreviewRecord) => operation('catalogPreviews', 'readwrite', s => s.put(record, record.catalogId));
export const deleteCatalogPreviews = (catalogId: string) => operation('catalogPreviews', 'readwrite', s => s.delete(catalogId));
// GC dual delete: catalog + its preview media commit in one transaction.
export function deleteCatalogAndPreviews(key: string): Promise<void> {
  return database().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['catalogs', 'catalogPreviews'], 'readwrite');
        tx.objectStore('catalogs').delete(key);
        tx.objectStore('catalogPreviews').delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || Error('Не удалось удалить каталог'));
      }),
  );
}
// Atomic install: catalog record + current pointer commit in one transaction.
// Either both land or neither does; a failed settings write rolls the catalog back.
export async function installCatalogRecord(catalog: Catalog, key: string, makeCurrent: boolean): Promise<string> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['catalogs', 'settings'], 'readwrite');
    tx.objectStore('catalogs').put(catalog, key);
    if (makeCurrent) tx.objectStore('settings').put(key, 'catalog');
    tx.oncomplete = () => resolve(key);
    tx.onerror = tx.onabort = () => reject(tx.error || Error('Не удалось установить каталог'));
  });
}
export async function saveCatalog(catalog: Catalog) {
  const key = crypto.randomUUID();
  await operation('catalogs', 'readwrite', s => s.put(catalog, key));
  await operation('settings', 'readwrite', s => s.put(key, 'catalog'));
  return key;
}
export interface PortableImportRecord {
  catalog: Catalog;
  name: string;
  content: DndCharacterData;
  portrait: string | null;
  // Phase B1.2: a valid v2 UID is preserved across devices; null (v1 import,
  // explicit copy) mints a fresh logical identity.
  characterUid?: string | null;
}
// Portable HTML import (phase B1.1): the character-specific catalog slice gets
// its own UUID identity — never a managed release id — and the character is
// pinned to it. One transaction over both stores: either the slice and the
// character land together or neither does, so a failed import leaves no
// orphan catalog. The settings current pointer is untouched: future creations
// keep using the managed catalog, not this slice. Every import mints a new
// local Character.id; no source id is ever reused as an IDB key.
export async function importPortableRecord(record: PortableImportRecord): Promise<Character> {
  const db = await database();
  const key = crypto.randomUUID();
  const characterUid = typeof record.characterUid === 'string' && record.characterUid ? record.characterUid : crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['catalogs', 'characters'], 'readwrite');
    tx.objectStore('catalogs').put(record.catalog, key);
    const add = tx.objectStore('characters').add({
      name: record.name, content: record.content, portrait: record.portrait, catalogKey: key, revision: 0, characterUid,
    });
    let id = 0;
    add.onsuccess = () => { id = add.result as number; };
    tx.oncomplete = () => {
      tabSync().publish(characterUpdated(id, 0));
      resolve({
        id, name: record.name, content: record.content, portrait: record.portrait, catalogKey: key, revision: 0, characterUid,
      });
    };
    tx.onerror = tx.onabort = () => reject(tx.error || Error('Не удалось импортировать персонажа'));
  });
}
export interface PortableUpdateRecord {
  id: number;
  name: string;
  content: DndCharacterData;
  portrait: string | null;
  catalog: Catalog;
}
// Portable update existing (phase B1.2): wholesale replace of the file state
// over the local record — never a field merge. Keeps local id + characterUid,
// bumps the CAS revision from the stored record (no revision is ever copied
// from another device). The new slice reuses the old key when it is provably
// this character's private portable slice (see shouldReuseCatalogSlice);
// otherwise a fresh key is minted and the old record is left untouched —
// shared, current or managed catalogs are never deleted here.
export async function updatePortableCharacter(record: PortableUpdateRecord): Promise<Character> {
  const db = await database();
  const previous = await getCharacter(record.id);
  if (!previous?.content) throw Error('Персонаж не найден');
  const siblings = await listCharacters();
  const current = await currentCatalog();
  const oldKey = previous.catalogKey;
  const oldCatalog = oldKey ? await getCatalog(oldKey) : undefined;
  const reuse = shouldReuseCatalogSlice({
    catalogKey: oldKey,
    catalog: oldCatalog,
    referencedByCount: oldKey ? siblings.filter((c) => c.catalogKey === oldKey).length : 0,
    isCurrent: !!oldKey && current === oldKey,
  });
  const sliceKey = reuse && oldKey ? oldKey : crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['catalogs', 'characters'], 'readwrite');
    const store = tx.objectStore('characters');
    let next: Character, error: Error | undefined;
    const request = store.get(record.id);
    request.onsuccess = () => {
      const stored = request.result as Character | undefined;
      if (!stored || stored.revision !== previous.revision) {
        error = Error('Персонаж изменён в другом окне. Скачайте текущую копию перед перезагрузкой.');
        tx.abort();
        return;
      }
      tx.objectStore('catalogs').put(record.catalog, sliceKey);
      next = buildCharacterUpdate(stored, { name: record.name, content: record.content, portrait: record.portrait, catalogKey: sliceKey });
      store.put(next);
    };
    tx.oncomplete = () => { tabSync().publish(characterUpdated(next.id, next.revision)); resolve(next); };
    tx.onerror = tx.onabort = () => reject(error || tx.error || Error('Не удалось обновить персонажа'));
  });
}
export async function createCharacter(name: string, catalogKey: string | null) {
  // Every new record mints its logical identity at creation; it is never
  // regenerated on save.
  const id = await operation<number>('characters', 'readwrite', s => s.add({ name, content: null, portrait: null, catalogKey, revision: 0, characterUid: crypto.randomUUID() }));
  const created = (await getCharacter(id))!;
  tabSync().publish(characterUpdated(id, created.revision ?? 0));
  return created;
}
// Read-check-write in one transaction prevents silent overwrites from another tab.
export async function saveCharacter(character: Character): Promise<Character> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('characters', 'readwrite'); const store = tx.objectStore('characters');
    let next: Character, error: Error | undefined;
    const request = store.get(character.id);
    request.onsuccess = () => {
      if (!request.result || request.result.revision !== character.revision) { error = Error('Персонаж изменён в другом окне. Скачайте текущую копию перед перезагрузкой.'); tx.abort(); return; }
      next = { ...character, revision: character.revision + 1 }; store.put(next);
    };
    tx.oncomplete = () => { tabSync().publish(characterUpdated(next.id, next.revision)); resolve(next); }; tx.onerror = tx.onabort = () => reject(error || tx.error || Error('Не удалось сохранить'));
  });
}
export function parseCharacterContent(raw: unknown) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || !Array.isArray(value.classes) || !value.abilities) throw Error('Некорректный лист D&D');
  return normalizeDndCharacter(value);
}
// Local library lifecycle. Archive/restore go through the CAS saveCharacter,
// so a concurrent edit in another tab surfaces the existing conflict error
// instead of silently winning. Catalog pins, portraits and runtime state are
// never touched by archiving.
export async function archiveCharacter(id: number): Promise<Character> {
  const c = await getCharacter(id);
  if (!c) throw Error('Персонаж не найден');
  return saveCharacter({ ...c, archivedAt: new Date().toISOString() });
}
export async function restoreCharacter(id: number): Promise<Character> {
  const c = await getCharacter(id);
  if (!c) throw Error('Персонаж не найден');
  return saveCharacter({ ...c, archivedAt: null });
}
// Permanent delete of the character row only. Catalog cleanup is NOT done
// here: the caller runs the existing garbageCollectCatalogs afterwards, which
// removes a managed slice exactly when it is unreferenced and non-current
// and always keeps legacy/custom/shared records. The caller's UI also drops
// this character's own wizard draft key (wizardDraftKey) — nothing else.
export async function deleteCharacter(id: number): Promise<Character> {
  const c = await getCharacter(id);
  if (!c) throw Error('Персонаж не найден');
  // A locally deleted character that ever synced keeps a deletion marker so
  // the next sync pushes a tombstone instead of resurrecting it. Never
  // synced (no meta) → nothing to remember. Atomic with the row delete.
  const meta = c.characterUid ? await getSyncMeta(c.characterUid).catch(() => undefined) : undefined;
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['characters', 'characterSync'], 'readwrite');
    tx.objectStore('characters').delete(id);
    if (meta) {
      tx.objectStore('characterSync').put({ ...meta, deletedLocally: true, syncedAt: new Date().toISOString() });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || Error('Не удалось удалить персонажа'));
  });
  tabSync().publish(characterDeleted(id));
  return c;
}
// Independent copy: same sheet/portrait/catalog pin, new local id, fresh
// characterUid, initial revision, never archived. Draft shells are refused —
// the UI hides the action for them (see canDuplicate).
export async function duplicateCharacter(id: number): Promise<Character> {
  const original = await getCharacter(id);
  if (!original?.content) throw Error('Черновик нельзя дублировать — завершите создание персонажа');
  const siblings = await listCharacters();
  const name = copyNameFor(displayName(original), siblings);
  const payload = buildDuplicatePayload(original, name, crypto.randomUUID());
  payload.content = { ...payload.content, characterName: name };
  const db = await database();
  const newId = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction('characters', 'readwrite');
    const request = tx.objectStore('characters').add(payload);
    let created = 0;
    request.onsuccess = () => { created = request.result as number; };
    tx.oncomplete = () => resolve(created);
    tx.onerror = tx.onabort = () => reject(tx.error || Error('Не удалось создать копию'));
  });
  const copy = (await getCharacter(newId))!;
  tabSync().publish(characterUpdated(newId, copy.revision ?? 0));
  return copy;
}
export { wizardDraftKey };
