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
//
// Кэш — ключи слоя данных (docs/adr/0001, группа «системы», часть 2): каждая
// запись лежит под `["entity", "compendium_entry", id]`, тем же, что читает
// страница записи. Правка записи в этом окне, в соседнем окне и сигнал сервера
// о правке компендиума помечают ключ устаревшим — и лист перечитывает свои
// записи одной пачкой. Раньше сбросить этот кэш могла только правка в разделе
// компендиума и только в этом же окне.

import { api } from "../../api/client";
import { dataKeys } from "../../data/entities";
import { queryClient } from "../../data/queryClient";
import type { CompendiumEntry } from "../../types";

const ENTRY_KEY = ["entity", "compendium_entry"] as const;
const keyOf = (id: number) => dataKeys.entity("compendium_entry", id);

// Кэш на сессию, как и был: лист держит записи без подписчика-запроса, и
// сборщик слоя (10 минут без наблюдателей) иначе выбрасывал бы их из-под него.
queryClient.setQueryDefaults(ENTRY_KEY, { gcTime: Infinity });

// Незавершённые запросы по id — чтобы два компонента, открывшиеся
// одновременно, не запросили одно и то же дважды.
const inflight = new Map<number, Promise<void>>();

// Записи, за которыми сходить не вышло. Раньше ошибка сети глоталась молча
// и не повторялась никогда: лист навсегда оставался на сохранённых именах и
// ничего об этом не говорил. Теперь неудача запоминается, повторные попытки
// не долбят сеть на каждый рендер, а показать и повторить можно осознанно.
const failed = new Set<number>();

// Мёртвые ссылки (этап 8): сервер ответил, но этих id в ответе нет — запись
// удалили из компендиума уже после того, как её вписали в лист. В отличие от
// сетевой неудачи это окончательно: повторный запрос не воскресит, поэтому
// повторять не надо (исключены из missing ниже), а показать надо — сводкой
// внизу листа. Лимит 900 — см. ensureEntries.
const dead = new Set<number>();

/** Id, которых сервер не вернул (этап 8). Кэш общий на сессию — вызывающий
 *  сам пересекает со своим списком запрошенных. */
export function deadEntryIds(): number[] {
  return [...dead];
}

const listeners = new Set<() => void>();

export function subscribeEntryCache(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Пачка событий кэша (уборка справочника помечает сотни записей разом) —
// одно оповещение, а не сотня перерисовок листа.
let notifyScheduled = false;
function notify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const fn of listeners) fn();
  });
}

function entryIdOf(queryKey: readonly unknown[]): number | null {
  const [scope, kind, id] = queryKey;
  return scope === ENTRY_KEY[0] && kind === ENTRY_KEY[1] && typeof id === "number" ? id : null;
}

// Запись помечена устаревшей — правкой здесь, в соседнем окне или сигналом
// сервера. Пометки неудачи и мёртвости снимаются: правка — повод сходить
// заново, запись могли пересоздать. Подписчики просыпаются и перечитывают
// свои записи (useCompendiumEntries).
queryClient.getQueryCache().subscribe((event) => {
  const id = entryIdOf(event.query.queryKey);
  if (id == null) return;
  if (event.type === "updated" && event.action.type === "invalidate") {
    failed.delete(id);
    dead.delete(id);
    notify();
  }
});

export function getCachedEntry(id: number | null | undefined): CompendiumEntry | undefined {
  return id == null ? undefined : (queryClient.getQueryData<CompendiumEntry | null>(keyOf(id)) ?? undefined);
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

/** Нет в кэше или помечено устаревшим. Пока идёт перечитывание, лист видит прежнее. */
function needsFetch(id: number): boolean {
  const state = queryClient.getQueryState<CompendiumEntry | null>(keyOf(id));
  return !state || state.data === undefined || state.isInvalidated;
}

export async function ensureEntries(ids: (number | null | undefined)[]): Promise<void> {
  const missing = [...new Set(ids.filter((id): id is number => typeof id === "number" && !failed.has(id) && !dead.has(id) && needsFetch(id)))];
  const toFetch = missing.filter((id) => !inflight.has(id));
  const waits = missing.filter((id) => inflight.has(id)).map((id) => inflight.get(id)!);

  if (toFetch.length > 0) {
    const request = api
      .get<CompendiumEntry[]>(`/systems/entries/batch?ids=${toFetch.join(",")}`)
      .then((entries) => {
        for (const e of entries) queryClient.setQueryData(keyOf(e.id), e);
        // Сервер молча обрезает запрос на 900 id (лимит переменных SQLite):
        // при обрезке мёртвых не отмечаем вовсе, иначе получится ложная
        // тревога по записям, которых просто не спросили.
        if (toFetch.length <= 900) {
          const found = new Set(entries.map((e) => e.id));
          for (const id of toFetch) {
            if (!found.has(id)) {
              dead.add(id);
              // Пустая запись под ключом, а не удалённый ключ: пометка «устарело»
              // (запись пересоздали, уборка справочника) должна его найти и снять
              // мёртвость — на отсутствующий ключ пометке опереться не на что.
              queryClient.setQueryData(keyOf(id), null);
            }
          }
        }
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
