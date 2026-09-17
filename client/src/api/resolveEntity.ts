import { isEntityKind } from "../data/entities";
import { readEntity } from "../data/imperative";
import { write } from "../data/hooks";

// Карточки читаются через слой данных под ключом `useEntity`: подпись связи
// берётся из того же кэша, что открытая карточка, и обновляется её правкой.
// Раньше здесь жил свой кэш подписей навсегда — переименованная сущность
// подписывалась старым именем до перезагрузки окна.

// Same endpoint resolveEntityLabel below already hits for the full detail
// payload — that function just reduces it to a label string and throws the
// rest away. This returns the raw object instead, for callers (e.g. an
// entity preview) that want more than the label.
export async function fetchEntityDetail(type: string, id: number): Promise<Record<string, unknown> | null> {
  if (!isEntityKind(type)) return null;
  try {
    return await readEntity<Record<string, unknown>>(type, id);
  } catch {
    return null;
  }
}

// Same lookup as resolveEntityLabel, but for the entity types that can carry
// an optional short_name (used to keep map-pin labels compact) — prefers it
// over the full name when set, otherwise falls back identically. Запись
// компендиума здесь потому, что карта принимает перетаскиванием любой
// результат поиска: существо бестиария на неё ставится наравне с существом
// сеттинга, и подписываться должно так же коротко.
const SHORT_NAME_TYPES = new Set([
  "being",
  "character",
  "location",
  "artifact",
  "compendium_entry",
]);
export async function resolveEntityMapLabel(type: string, id: number): Promise<string> {
  if (!SHORT_NAME_TYPES.has(type)) return resolveEntityLabel(type, id);
  if (!isEntityKind(type)) return `${type} #${id}`;
  try {
    const entity = await readEntity<Record<string, unknown>>(type, id);
    if (entity.short_name) return String(entity.short_name);
    if (type === "character") return String(entity.character_name ?? id);
    return String(entity.name ?? id);
  } catch {
    return `${type} #${id} (не найдено)`;
  }
}

export type ResolvedLabelResult = { target_type: string; target_id: number; label: string };

export async function resolveEntityMapLabels(
  pins: { target_type: string; target_id: number }[]
): Promise<ResolvedLabelResult[]> {
  if (pins.length === 0) return [];
  try {
    // Это чтение, хоть и POST (список пинов не влезает в адрес). Без
    // `broadcast: false` транспорт счёл бы его правкой: пометил бы кэш слоя
    // устаревшим, карточка локации перечиталась бы с новым массивом пинов — и
    // карта снова спросила бы подписи. Цикл.
    const { labels } = await write.post<{ labels: ResolvedLabelResult[] }>("/setting-locations/resolve-labels", { pins });
    return labels ?? [];
  } catch {
    // Fallback: resolve individually via GET requests
    return Promise.all(
      pins.map(async (p) => ({
        target_type: p.target_type,
        target_id: p.target_id,
        label: await resolveEntityMapLabel(p.target_type, p.target_id),
      }))
    );
  }
}

/** Подпись сущности по её карточке — для тех, кто карточку уже прочитал. */
export function entityLabel(type: string, id: number, entity: Record<string, unknown>): string {
  if (type === "mastering" || type === "setting_event") return String(entity.title ?? id);
  if (type === "session") return `${entity.campaign_name ?? "Сессия"} — ${entity.date ?? id}`;
  if (type === "character") return String(entity.character_name ?? id);
  return String(entity.name ?? id);
}

export async function resolveEntityLabel(type: string, id: number): Promise<string> {
  if (type === "preproduction") {
    try {
      const campaign = await readEntity<Record<string, unknown>>("campaign", id);
      return `${campaign.name ?? id} — Препродакшен`;
    } catch {
      return `Препродакшен #${id} (не найдено)`;
    }
  }
  if (!isEntityKind(type)) return `${type} #${id}`;
  try {
    return entityLabel(type, id, await readEntity<Record<string, unknown>>(type, id));
  } catch {
    return `${type} #${id} (не найдено)`;
  }
}
