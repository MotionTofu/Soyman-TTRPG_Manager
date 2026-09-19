const payload = JSON.parse(document.getElementById('oneshot-payload')!.textContent!);
export const snapshot = payload;
export const getAuthToken = () => null;
export const setAuthToken = () => {};
export const setUnauthorizedHandler = () => {};
const unavailable = async (): Promise<any> => { throw Error('Это действие доступно только в подключённом чарнике.'); };
export const deleteFileWithChoice = unavailable;
const presentEntry = (entry: any, full = false) => entry ? { ...entry, avatar_image_url: (full ? entry.avatar_large_url : null) || entry.avatar_preview_url || null } : entry;
async function get<T>(path: string): Promise<T> {
  const u = new URL(path, 'https://local.invalid');
  const c = snapshot.catalog;
  let result: unknown;
  if (u.pathname === '/systems') result = c.system ? [c.system] : [];
  else if (/\/sections$/.test(u.pathname)) result = c.sections;
  else if (u.pathname === '/systems/entries/batch') {
    const ids = (u.searchParams.get('ids') || '').split(',').map(Number);
    result = c.entries.filter((e: any) => ids.includes(e.id)).map((e: any) => presentEntry(e));
  } else if (/\/entries\/\d+$/.test(u.pathname)) {
    result = presentEntry(c.entries.find((e: any) => e.id === Number(u.pathname.split('/').pop())), true);
    if (!result) throw Error('Эта запись не включена в автономную копию.');
  } else if (/\/entries$/.test(u.pathname)) {
    result = c.entries.filter((e: any) => (!u.searchParams.has('section_id') || e.section_id === Number(u.searchParams.get('section_id'))) && (!u.searchParams.has('parent_id') || e.parent_id === Number(u.searchParams.get('parent_id')))).map((e: any) => presentEntry(e));
  } else if (/^\/systems\/\d+$/.test(u.pathname)) result = c.system;
  else if (u.pathname === '/search' || u.pathname === '/statblocks' || u.pathname.endsWith('/inbox')) result = [];
  else return unavailable();
  return structuredClone(result) as T;
}
export const api = { get, post: unavailable, put: unavailable, del: unavailable };
