// Живые данные записей компендиума для листа персонажа.
//
// Раньше лист хранил у себя копию полей заклинания на момент добавления. Это
// работало ровно до первой правки в компендиуме: лист о ней не узнавал
// никогда, и на одном экране рядом оказывались устаревшая мета-строка и
// свежее описание, подгружаемое отдельно. Переход заклинаний на структурные
// эффекты сделал расхождение массовым — все листы остались с доперестроечными
// данными.
//
// Теперь лист хранит только entryId + имя + свою пометку подготовки, а всё
// остальное берётся отсюда: одна пачка на вкладку вместо запроса на каждую
// запись, с общим кэшем на сессию.

import { api } from "../../api/client";
import type { CompendiumEntry } from "../../types";

const cache = new Map<number, CompendiumEntry>();
// Незавершённые запросы по id — чтобы два компонента, открывшиеся
// одновременно, не запросили одно и то же дважды.
const inflight = new Map<number, Promise<void>>();

// Записи, за которыми сходить не вышло. Раньше ошибка сети глоталась молча
// и не повторялась никогда: лист навсегда оставался на сохранённых именах и
// ничего об этом не говорил. Теперь неудача запоминается, повторные попытки
// не долбят сеть на каждый рендер, а показать и повторить можно осознанно.
const failed = new Set<number>();

const listeners = new Set<() => void>();

export function subscribeEntryCache(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function getCachedEntry(id: number | null | undefined): CompendiumEntry | undefined {
  return id == null ? undefined : cache.get(id);
}

// Догружает то, чего ещё нет. Возвращает промис, но вызывающему обычно
// достаточно подписки: как только пачка приходит, слушатели перерисовываются.
export function hasFailedEntries(): boolean {
  return failed.size > 0;
}

/** Повторить то, что не загрузилось: снимает пометку и будит подписчиков. */
export function retryFailedEntries(): void {
  if (failed.size === 0) return;
  failed.clear();
  notify();
}

export async function ensureEntries(ids: (number | null | undefined)[]): Promise<void> {
  const missing = [...new Set(ids.filter((id): id is number => typeof id === "number" && !cache.has(id) && !failed.has(id)))];
  const toFetch = missing.filter((id) => !inflight.has(id));
  const waits = missing.filter((id) => inflight.has(id)).map((id) => inflight.get(id)!);

  if (toFetch.length > 0) {
    const request = api
      .get<CompendiumEntry[]>(`/systems/entries/batch?ids=${toFetch.join(",")}`)
      .then((entries) => {
        for (const e of entries) cache.set(e.id, e);
        notify();
      })
      .catch(() => {
        // Сеть отвалилась — лист покажет записи по сохранённым именам и
        // скажет об этом строкой с «Повторить», а не промолчит.
        for (const id of toFetch) failed.add(id);
        notify();
      })
      .finally(() => {
        for (const id of toFetch) inflight.delete(id);
      });
    for (const id of toFetch) inflight.set(id, request);
    waits.push(request);
  }
  await Promise.all(waits);
}

// Сбрасывает кэш после правки компендиума, чтобы открытый рядом лист увидел
// изменение без перезагрузки страницы.
export function invalidateEntry(id: number): void {
  cache.delete(id);
  // Снимаем и пометку неудачи: правка в компендиуме — повод сходить заново.
  failed.delete(id);
  notify();
}

export function invalidateAllEntries(): void {
  cache.clear();
  failed.clear();
  notify();
}
