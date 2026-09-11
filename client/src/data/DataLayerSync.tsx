import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onDataChangedElsewhere } from "../dataSync";
import { invalidateAffects } from "./entities";
import { affectsForWindowEvent } from "./syncAffects";

/**
 * Сигналы «данные изменились» → обновление данных слоя (docs/adr/0001, п. 4).
 *
 * - Другое окно этой машины (BroadcastChannel в dataSync.ts): сигнал несёт, что
 *   задето, и здесь перечитывается ровно это. Старый сигнал без адресата
 *   (правка со страницы, ещё не переведённой на слой) перечитывает всё.
 * - Игроки с других устройств (сокет → RealtimeListener → событие окна): каждое
 *   событие переводится в то, что оно задевает.
 *
 * Старые слушатели этих событий на непереведённых страницах продолжают
 * работать: здесь события только читаются. Монтируется один раз в корне.
 */

const DATA_EVENTS = ["character-updated", "initiative-updated", "hunter-mark"] as const;

export function DataLayerSync() {
  const client = useQueryClient();

  useEffect(
    () => onDataChangedElsewhere((payload) => void invalidateAffects(client, payload?.affects ?? [])),
    [client]
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const affects = affectsForWindowEvent(event.type, (event as CustomEvent).detail);
      if (affects) void invalidateAffects(client, affects);
    };
    for (const type of DATA_EVENTS) window.addEventListener(type, handler);
    return () => {
      for (const type of DATA_EVENTS) window.removeEventListener(type, handler);
    };
  }, [client]);

  return null;
}
