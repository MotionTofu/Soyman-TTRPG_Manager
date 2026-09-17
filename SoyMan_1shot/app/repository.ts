import type { DndCharacterData } from '@shared/dnd/types';
import { normalizeDndCharacter } from '@shared/dnd/normalize';
import { parseCatalog, repairSpellLevels } from './catalog.mjs';
export interface Catalog { system: any; sections: any[]; entries: any[] }
export interface Character { id: number; name: string; content: DndCharacterData | null; portrait: string | null; catalogKey: string | null; revision: number }
let opening: Promise<IDBDatabase>;
function database() {
  return opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('soyman-1shot-characters', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('characters', { keyPath: 'id', autoIncrement: true }); request.result.createObjectStore('catalogs'); request.result.createObjectStore('settings'); };
    request.onerror = () => reject(request.error); request.onblocked = () => reject(Error('Закройте другие окна OneShot и повторите'));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
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
export async function getCatalog(key: string): Promise<Catalog> {
  const catalog = await operation<Catalog>('catalogs', 'readonly', s => s.get(key));
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
export async function saveCatalog(catalog: Catalog) {
  const key = crypto.randomUUID();
  await operation('catalogs', 'readwrite', s => s.put(catalog, key));
  await operation('settings', 'readwrite', s => s.put(key, 'catalog'));
  return key;
}
export async function createCharacter(name: string, catalogKey: string | null) {
  const id = await operation<number>('characters', 'readwrite', s => s.add({ name, content: null, portrait: null, catalogKey, revision: 0 }));
  return (await getCharacter(id))!;
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
    tx.oncomplete = () => resolve(next); tx.onerror = tx.onabort = () => reject(error || tx.error || Error('Не удалось сохранить'));
  });
}
export function parseCharacterContent(raw: unknown) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || !Array.isArray(value.classes) || !value.abilities) throw Error('Некорректный лист D&D');
  return normalizeDndCharacter(value);
}
