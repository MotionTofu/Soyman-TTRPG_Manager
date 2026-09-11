import type { Affect } from "./entities";

/**
 * Событие сокета (RealtimeListener → событие окна) → что оно задевает в кэше
 * слоя данных. Отдельным файлом, а не в DataLayerSync.tsx: файл с компонентом
 * должен экспортировать только компоненты, иначе горячая перезагрузка Vite
 * перезапускает весь модуль.
 */
export function affectsForWindowEvent(type: string, detail: unknown): Affect[] | null {
  const d = (detail ?? {}) as { characterId?: number; sessionId?: number; scope?: string };
  switch (type) {
    case "character-updated": {
      if (d.characterId == null) return [{ kind: "character" }, { path: "/statblocks" }];
      const sheet: Affect[] = [
        { path: `/statblocks?owner_type=character&owner_id=${d.characterId}` },
        { path: `/player/characters/${d.characterId}` },
      ];
      // Сохранён только лист (server/src/services/realtime.ts): карточку
      // персонажа не перечитываем — иначе каждая быстрая правка хитов тянула бы
      // лишний запрос. Старый сервер поля не шлёт — тогда задето всё.
      return d.scope === "sheet" ? sheet : [{ kind: "character", id: d.characterId }, ...sheet];
    }
    case "initiative-updated":
      return [{ path: d.sessionId != null ? `/initiative-entries?session_id=${d.sessionId}` : "/initiative-entries" }];
    case "hunter-mark":
      // Метка охотника кладёт напоминалку кампании и отмечает цель в очереди.
      return [{ path: "/campaigns" }, { path: "/players" }, { path: "/initiative-entries" }];
    default:
      return null;
  }
}
