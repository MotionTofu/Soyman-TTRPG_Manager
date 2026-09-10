import type { Database } from "better-sqlite3";
import { db as appDb } from "../db/db";
import { kindOf } from "../db/entityKinds";

/**
 * Человеческое имя сущности по её виду и id.
 *
 * До этого модуля имя резолвилось шестью способами: `resolveName` в
 * `routes/entityRelations.ts`, `linkTargetName` в `story/cast.ts`,
 * `NODE_NAME_TABLES` в `routes/story.ts`, `SHORT_NAME_MAP` в
 * `routes/settingLocations.ts`, `SATELLITE_OWNERS` в `routes/search.ts` и
 * `nodeName` в `routes/links.ts`. Каждый нёс свою карту «вид → таблица и
 * колонка имени», и карты разошлись: в `SHORT_NAME_MAP` запись компендиума
 * читалась по колонке `title`, которой у неё нет вовсе, — то есть первый же
 * пин на запись компендиума свалился бы с ошибкой SQL.
 *
 * Имена таблиц и колонок приходят из реестра фиксированными литералами
 * (никогда из запроса), поэтому подстановка в `${}` безопасна.
 */

/** Ключ пары «вид + id» в результате пакетного запроса. */
export function refKey(kind: string, id: number): string {
  return `${kind}:${id}`;
}

/** Имя одной сущности, либо `null` — вида нет, имени нет, запись исчезла. */
export function entityName(kind: string, id: number, db: Database = appDb): string | null {
  const k = kindOf(kind);
  if (!k?.nameCol) return null;
  try {
    const row = db
      .prepare(`SELECT ${k.nameCol} AS name FROM ${k.table} WHERE id = ?`)
      .get(id) as { name: string | null } | undefined;
    return row?.name ?? null;
  } catch {
    return null;
  }
}

// SQLite держит не больше 999 параметров в одном запросе; состав сцены и
// граф связей запрашивают имена сотнями, поэтому режем на части, а не на
// отдельные запросы по строке.
const CHUNK = 500;

/**
 * Имена пачкой: один запрос на вид вместо одного на строку.
 *
 * Ради этого модуль и заводился. `story/cast.ts` и `routes/story.ts`
 * резолвили состав сцены построчно — а это экран, который Мастер открывает
 * прямо за столом.
 */
export interface NameOptions {
  /**
   * Предпочитать короткое имя, если у вида есть колонка `short_name` и она
   * заполнена. Так подписаны метки на карте локации и состав сцены: Мастер
   * пишет туда «Мирт» вместо «Мирт Мошнохват, глава гильдии».
   */
  preferShort?: boolean;
  db?: Database;
}

export function entityNames(
  refs: Iterable<{ kind: string; id: number }>,
  opts: NameOptions = {}
): Map<string, string> {
  const db = opts.db ?? appDb;
  const byKind = new Map<string, Set<number>>();
  for (const { kind, id } of refs) {
    if (!Number.isInteger(id) || id <= 0) continue;
    if (!kindOf(kind)?.nameCol) continue;
    let set = byKind.get(kind);
    if (!set) byKind.set(kind, (set = new Set()));
    set.add(id);
  }

  const out = new Map<string, string>();
  for (const [kind, ids] of byKind) {
    const k = kindOf(kind)!;
    const short = opts.preferShort && k.hasShortName;
    const all = [...ids];
    for (let i = 0; i < all.length; i += CHUNK) {
      const part = all.slice(i, i + CHUNK);
      const placeholders = part.map(() => "?").join(",");
      try {
        const rows = db
          .prepare(
            `SELECT id, ${k.nameCol} AS name${short ? ", short_name" : ""} FROM ${k.table} WHERE id IN (${placeholders})`
          )
          .all(...part) as { id: number; name: string | null; short_name?: string | null }[];
        for (const r of rows) {
          const label = (short ? r.short_name : null) || r.name;
          if (label) out.set(refKey(kind, r.id), label);
        }
      } catch {
        // Таблицы может не быть на старой базе — имя просто не найдётся.
      }
    }
  }
  return out;
}
