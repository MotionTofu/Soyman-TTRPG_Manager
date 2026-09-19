import { getCharacter, saveCharacter, parseCharacterContent, getCatalog, currentCatalog, type Catalog } from './repository';
// Vite sees this file both as the shell's direct import and as the replacement
// for client/api/client.ts. Some builds keep those as two module instances;
// globalThis makes the selected character/catalog one state for both.
const transportState = ((globalThis as typeof globalThis & { __oneShotTransportState?: { activeId: number | null; catalog: Catalog | null } }).__oneShotTransportState ??= { activeId: null, catalog: null });
export async function selectCharacter(id: number) {
  const c = await getCharacter(id); if (!c) throw Error('Персонаж не найден');
  const catalogKey = c.catalogKey ?? await currentCatalog() ?? null;
  transportState.activeId = id; transportState.catalog = catalogKey ? await getCatalog(catalogKey) : null;
}
export const getAuthToken = () => null;
export const setAuthToken = (_value: unknown) => {};
export const setUnauthorizedHandler = (_value: unknown) => {};
export async function deleteFileWithChoice() { throw Error('Удаление файлов SoyMan недоступно в OneShot'); }
const statblock = (c: any) => ({ id: c.id, owner_id: c.id, owner_type: 'character', format: 'dnd_character', kind: 'full', content: JSON.stringify(c.content), updated_at: String(c.revision) });
const presentEntry = (entry: any, full = false) => entry ? { ...entry, avatar_image_url: (full ? entry.avatar_large_url : null) || entry.avatar_preview_url || null } : entry;
async function request<T>(path: string, method = 'GET', body?: any, options?: RequestInit): Promise<T> {
  if (options?.signal?.aborted) throw new DOMException('Отменено', 'AbortError');
  const url = new URL(path, 'https://oneshot.invalid'); const route = url.pathname;
  let result: unknown;
  if (method === 'GET') {
    if (route === '/systems') result = transportState.catalog ? [transportState.catalog.system] : [];
    else if (/^\/systems\/\d+\/sections$/.test(route)) result = transportState.catalog?.sections ?? [];
    else if (/^\/systems\/\d+\/entries$/.test(route)) {
      result = (transportState.catalog?.entries ?? []).filter(e => (!url.searchParams.has('section_id') || e.section_id === Number(url.searchParams.get('section_id'))) && (!url.searchParams.has('parent_id') || e.parent_id === Number(url.searchParams.get('parent_id')))).map(e => presentEntry(e));
    } else if (route === '/systems/entries/batch') {
      const ids = new Set((url.searchParams.get('ids') || '').split(',').map(Number)); result = (transportState.catalog?.entries ?? []).filter(e => ids.has(e.id)).map(e => presentEntry(e));
    } else if (/^\/systems\/entries\/\d+$/.test(route)) {
      result = presentEntry(transportState.catalog?.entries.find(e => e.id === Number(route.split('/').pop())), true); if (!result) throw Error('Запись отсутствует в подключённом справочнике');
    } else if (route === '/statblocks') {
      const c = await getCharacter(transportState.activeId!); result = c?.content ? [statblock(c)] : [];
    } else if (route === '/search') result = [];
    else if (/^\/player\/characters\/\d+\/inbox$/.test(route)) result = [];
    else if (/^\/systems\/\d+$/.test(route)) result = transportState.catalog?.system;
    else throw Error(`В OneShot пока недоступно: ${route}`);
  } else if (method === 'POST' && route === '/statblocks') {
    if (body.owner_id !== transportState.activeId || body.owner_type !== 'character' || body.format !== 'dnd_character') throw Error('Неверный владелец листа');
    const c = await getCharacter(transportState.activeId!); if (!c) throw Error('Персонаж не найден');
    if (c.content) throw Error('Лист уже создан. Откройте его из списка персонажей.');
    const content = parseCharacterContent(body.content);
    result = statblock(await saveCharacter({ ...c, content, name: content.characterName || c.name }));
  } else if (method === 'POST' && route === `/characters/${transportState.activeId}/avatar`) {
    const file = body instanceof FormData ? body.get('file') : null;
    if (!(file instanceof File) || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) throw Error('Нужна картинка PNG, JPEG или WebP до 15 МБ');
    const portrait = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });
    const c = await getCharacter(transportState.activeId!); if (!c) throw Error('Персонаж не найден');
    result = await saveCharacter({ ...c, portrait });
  } else throw Error(`Действие пока недоступно в OneShot: ${method} ${route}`);
  return structuredClone(result) as T;
}
export const api = {
  get: <T>(path: string, options?: RequestInit) => request<T>(path, 'GET', undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestInit) => request<T>(path, 'POST', body, options),
  put: <T>(path: string, body?: unknown, options?: RequestInit) => request<T>(path, 'PUT', body, options),
  del: <T>(path: string, options?: RequestInit) => request<T>(path, 'DELETE', undefined, options),
};
