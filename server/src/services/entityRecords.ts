// Запись о сущности в кампании (ADR-0006, спека .scratch/campaign-layer).
// Графы — словари по видам, а не колонки: каталог объектов сеттинга ещё не
// устоялся, и новая графа не должна требовать миграции. Сервер принимает
// только ключи словаря вида. Подписи граф — у клиента, как у FORCE_KEYS.
import { FORCE_KEYS } from "./beingForce";
import { CERTAINTY } from "./settingWorld";

export { CERTAINTY };

/** Графы по виду владельца; тот же набор видов, что в CHECK таблицы (db.ts). */
export const RECORD_ASPECTS: Readonly<Record<string, readonly string[]>> = {
  being: [...FORCE_KEYS, "note"],
  community: [...FORCE_KEYS, "note"],
  location: ["function", "affordances", "signs", "access", "cost_risk", "past_trace", "after", "unknown", "note"],
  character: ["player_interest", "hooks", "if_goal_reached", "note"],
  // unsorted — черновик без адреса: адрес выбирают при подтверждении.
  campaign: ["note", "resources", "intentions", "unsorted"],
};

/** Виды сеттинга: запись о них задействует сущность в кампании. */
export const SETTING_OWNER_TYPES: ReadonlySet<string> = new Set(["being", "community", "location"]);

/** Статус — уверенность Мастера: установлено · предположение · черновик · отброшено. */
export const RECORD_STATUSES = ["established", "assumption", "draft", "discarded"] as const;

/** Кому известно в мире: мастер · группа героев · все · некоторые. */
export const KNOWN_TO = ["gm", "table", "public", "some"] as const;

export function isAspectOf(ownerType: string, aspect: string): boolean {
  return RECORD_ASPECTS[ownerType]?.includes(aspect) ?? false;
}
