import { useCallback, useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Statblock } from "../types";
import { topLevelPatch } from "../components/statblockPatch";
import { notifyDataChanged } from "../dataSync";
import { pathHasPrefix, invalidateAffects, type Affect } from "./entities";
import { errorText, write } from "./hooks";
import { dismissNotice, showSaveError } from "./notices";
import { useQueuedSave } from "./queuedSave";

/**
 * Статблоки владельца в слое данных (docs/adr/0001, группа «лист персонажа»).
 *
 * Список статблоков владельца — один ключ кэша на всё приложение: его читают и
 * лист, и вкладка «Имущество» профиля, и после правки в одном месте другое не
 * перезапрашивает его заново.
 */

export function statblockListPath(ownerType: string, ownerId: number): string {
  return `/statblocks?owner_type=${ownerType}&owner_id=${ownerId}`;
}

export function archivedStatblockListPath(ownerType: string, ownerId: number): string {
  return `${statblockListPath(ownerType, ownerId)}&archived=1`;
}

/**
 * Что задевает правка статблока: списки владельца (и корзина — по тому же
 * префиксу), а у персонажа ещё и его лист глазами игрока.
 */
export function statblockAffects(ownerType: string, ownerId: number): Affect[] {
  const affects: Affect[] = [{ path: statblockListPath(ownerType, ownerId) }];
  if (ownerType === "character") affects.push({ path: `/player/characters/${ownerId}` });
  return affects;
}

/**
 * Положить сохранённую строку статблока в кэш списков владельца — без
 * перечитывания. Корзина не трогается: сохраняют только живые статблоки.
 */
export function applySavedStatblock(client: QueryClient, row: Statblock): void {
  const listPath = statblockListPath(row.owner_type, row.owner_id);
  client.setQueriesData<Statblock[]>(
    {
      predicate: (query) => {
        const [scope, path] = query.queryKey as readonly unknown[];
        return scope === "resource" && typeof path === "string" && pathHasPrefix(path, listPath) && !path.includes("archived=1");
      },
    },
    (list) => list?.map((s) => (s.id === row.id ? { ...s, ...row } : s))
  );
}

/**
 * Очередь быстрых правок одного статблока: дебаунс, один запрос в полёте,
 * патч изменённых полей (см. useQueuedSave и statblockPatch.ts).
 *
 * Сверх прежнего поведения:
 * - сохранённое кладётся в кэш списка (с новым `updated_at` — полная форма
 *   после быстрых правок больше не считает свой снимок устаревшим), а другим
 *   окнам уходит адресный сигнал;
 * - сбой — плашка «Не сохранилось — Повторить». Серия сбоев одной очереди
 *   держит одну плашку, удачная отправка снимает её сама.
 */
export function useStatblockQueue(statblock: Statblock, isJsonFormat: boolean, delayMs?: number) {
  const client = useQueryClient();
  // Что лежит на сервере — точка отсчёта для патча. Обновляется только по
  // факту записи (и при приёме чужого обновления), а не при каждой правке:
  // иначе следующая правка сравнивалась бы сама с собой.
  const savedRef = useRef(statblock.content);
  const noticeRef = useRef<number | null>(null);
  const queueRef = useRef<{ flush: () => Promise<void>; hasPending: () => boolean } | null>(null);

  const { id, owner_type: ownerType, owner_id: ownerId } = statblock;

  const save = useCallback(
    async (json: string) => {
      // Патч изменённых полей вместо снимка целиком: правка соседнего поля
      // из другого окна больше не пропадает. Разобрать не вышло (или формат
      // не JSON) — уходит снимок, как раньше.
      const patch = isJsonFormat ? topLevelPatch(savedRef.current, json) : null;
      if (patch && Object.keys(patch).length === 0) return;
      const body = patch ? { contentPatch: patch } : { content: json };
      const row = await write.put<Statblock>(`/statblocks/${id}`, body);
      savedRef.current = json;
      // В кэш — набранное, а не склеенное сервером: по смыслу это одно и то
      // же, но другая строка заставила бы открытую карточку заново разбирать
      // лист после каждой собственной правки.
      applySavedStatblock(client, { ...row, content: json });
      const affects = statblockAffects(ownerType, ownerId);
      void invalidateAffects(client, affects.filter((a) => "path" in a && !a.path.startsWith("/statblocks")));
      notifyDataChanged(affects);
    },
    [client, id, ownerType, ownerId, isJsonFormat]
  );

  const queue = useQueuedSave(save, {
    delayMs,
    onError: (error) => {
      const previous = noticeRef.current;
      noticeRef.current = showSaveError(errorText(error), async () => {
        const current = queueRef.current;
        if (!current) return;
        await current.flush();
        if (current.hasPending()) throw new Error("Снова не сохранилось");
      });
      if (previous != null && previous !== noticeRef.current) dismissNotice(previous);
    },
    onIdle: () => {
      if (noticeRef.current == null) return;
      dismissNotice(noticeRef.current);
      noticeRef.current = null;
    },
  });

  useEffect(() => {
    queueRef.current = { flush: queue.flush, hasPending: queue.hasPending };
  });

  /** Принято внешнее обновление или сохранено полной формой: новая точка отсчёта. */
  const markSaved = useCallback((json: string) => {
    savedRef.current = json;
  }, []);

  return { status: queue.status, schedule: queue.schedule, flush: queue.flush, hasPending: queue.hasPending, markSaved } as const;
}
