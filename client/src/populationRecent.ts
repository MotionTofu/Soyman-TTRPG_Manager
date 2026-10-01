// Пять последних открытых существ сеттинга — правая колонка «Населения»,
// когда ничего не выбрано (разбор «Населения» Q13). Личное удобство одного
// Мастера на одном устройстве, поэтому localStorage, а не база; пропажа
// списка ничего не ломает.

export interface RecentBeing {
  id: number;
  name: string;
}

const LIMIT = 5;
const key = (settingId: number) => `population-recent-${settingId}`;

export function readRecentBeings(settingId: number): RecentBeing[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(settingId)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((r): r is RecentBeing => typeof r?.id === "number" && typeof r?.name === "string").slice(0, LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function rememberOpenedBeing(settingId: number, id: number, name: string): void {
  try {
    const next = [{ id, name }, ...readRecentBeings(settingId).filter((r) => r.id !== id)].slice(0, LIMIT);
    localStorage.setItem(key(settingId), JSON.stringify(next));
  } catch {
    /* хранилище недоступно — список просто не запомнится */
  }
}
