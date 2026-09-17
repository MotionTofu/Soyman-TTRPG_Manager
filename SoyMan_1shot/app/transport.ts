import { getCharacter, saveCharacter, parseCharacterContent, getCatalog, type Catalog } from './repository';
let activeId: number | null = null;
let catalog: Catalog | null = null;
export async function selectCharacter(id: number) {
  const c = await getCharacter(id); if (!c) throw Error('Персонаж не найден');
  activeId = id; catalog = c.catalogKey ? await getCatalog(c.catalogKey) : null;
}
export const getAuthToken = () => null;
export const setAuthToken = (_value: unknown) => {};
export const setUnauthorizedHandler = (_value: unknown) => {};
export async function deleteFileWithChoice() { throw Error('Удаление файлов SoyMan недоступно в OneShot'); }
const statblock = (c: any) => ({ id: c.id, owner_id: c.id, owner_type: 'character', format: 'dnd_character', kind: 'full', content: JSON.stringify(c.content), updated_at: String(c.revision) });
async function request<T>(path: string, method = 'GET', body?: any, options?: RequestInit): Promise<T> {
  if (options?.signal?.aborted) throw new DOMException('Отменено', 'AbortError');
  const url = new URL(path, 'https://oneshot.invalid'); const route = url.pathname;
  let result: unknown;
  if (method === 'GET') {
    if (route === '/systems') result = catalog ? [catalog.system] : [];
    else if (/^\/systems\/\d+\/sections$/.test(route)) result = catalog?.sections ?? [];
    else if (/^\/systems\/\d+\/entries$/.test(route)) {
      result = (catalog?.entries ?? []).filter(e => (!url.searchParams.has('section_id') || e.section_id === Number(url.searchParams.get('section_id'))) && (!url.searchParams.has('parent_id') || e.parent_id === Number(url.searchParams.get('parent_id'))));
    } else if (route === '/systems/entries/batch') {
      const ids = new Set((url.searchParams.get('ids') || '').split(',').map(Number)); result = (catalog?.entries ?? []).filter(e => ids.has(e.id));
    } else if (/^\/systems\/entries\/\d+$/.test(route)) {
      result = catalog?.entries.find(e => e.id === Number(route.split('/').pop())); if (!result) throw Error('Запись отсутствует в подключённом справочнике');
    } else if (route === '/statblocks') {
      const c = await getCharacter(activeId!); result = c?.content ? [statblock(c)] : [];
    } else if (route === '/search') result = [];
    else if (/^\/player\/characters\/\d+\/inbox$/.test(route)) result = [];
    else if (/^\/systems\/\d+$/.test(route)) result = catalog?.system;
    else throw Error(`В OneShot пока недоступно: ${route}`);
  } else if (method === 'POST' && route === '/statblocks') {
    if (body.owner_id !== activeId || body.owner_type !== 'character' || body.format !== 'dnd_character') throw Error('Неверный владелец листа');
    const c = await getCharacter(activeId!); if (!c) throw Error('Персонаж не найден');
    if (c.content) throw Error('Лист уже создан. Откройте его из списка персонажей.');
    const content = parseCharacterContent(body.content);
    result = statblock(await saveCharacter({ ...c, content, name: content.characterName || c.name }));
  } else if (method === 'POST' && route === `/characters/${activeId}/avatar`) {
    const file = body instanceof FormData ? body.get('file') : null;
    if (!(file instanceof File) || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) throw Error('Нужна картинка PNG, JPEG или WebP до 15 МБ');
    const portrait = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });
    const c = await getCharacter(activeId!); if (!c) throw Error('Персонаж не найден');
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
