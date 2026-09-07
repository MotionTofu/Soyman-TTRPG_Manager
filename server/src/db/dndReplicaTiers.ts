import type { Database } from "better-sqlite3";

/**
 * Тиры схем реплик по книге (аудит 2026-09-07, next.dnd.su 5e24).
 *
 * Старый сидинг (dndReplicaSchemes) раскладывал по эвристике редкость+тип:
 * обычные→2, необычные чудесные→10, редкие чудесные→14. Книга даёт ЯВНЫЕ
 * таблицы 2/6/10/14 — эвристика системно мимо: именные необычные 2-го
 * (палочки, Сумка хранения) сидели запертыми до 10-го, таблицы 6+ не было
 * вовсе, именные редкие (оружие/доспехи/кольца 10/14) — не схемы вообще.
 *
 * Эта миграция переставляет minLevel поименно по таблицам книги, чистит
 * обычные от зелий/свитков/проклятых (книга их исключает явно) и добавляет
 * недостающие именные. Остальное не трогает: необычные/редкие чудесные
 * покрыты generic-строками книги («любой ... кроме проклятых»), а
 * «Боеприпас +1» — осознанный довесок владельца (в книге его нет).
 * Generic-строки («любой обычный...», выбор = отдельная схема) моделью
 * записей не выражаются — остаются ручным уговором за столом.
 */

const MIGRATION_KEY = "dnd_replica_tiers_v1";
const GENERICS_KEY = "dnd_replica_generics_v1";

/** Общие строки книги: любой подходящий предмет — отдельная схема.
 *  Формат — ReplicaGeneric листа (id/label/minLevel/rarity/types/
 *  excludeTypes/excludeCursed). */
const GENERICS: { id: string; label: string; minLevel: number; rarity: string; types?: string[]; excludeTypes?: string[]; excludeCursed?: boolean }[] = [
  {
    id: "common",
    label: "Любой обычный (кроме зелий, свитков, проклятых)",
    minLevel: 2,
    rarity: "Обычный",
    excludeTypes: ["Зелья", "Свитки"],
    excludeCursed: true,
  },
  {
    id: "uncommon-wondrous",
    label: "Любой необычный чудесный (кроме проклятых)",
    minLevel: 10,
    rarity: "Необычный",
    types: ["Чудесные предметы"],
    excludeCursed: true,
  },
  {
    id: "rare-wondrous",
    label: "Любой редкий чудесный (кроме проклятых)",
    minLevel: 14,
    rarity: "Редкий",
    types: ["Чудесные предметы"],
    excludeCursed: true,
  },
];

export function migrateDndReplicaGenerics(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(GENERICS_KEY);
  if (done) return;
  let fixed = 0;
  const run = database.transaction(() => {
    const rows = database
      .prepare(
        `SELECT e.id, e.data FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Артефактор'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      if (data.replicate_generics != null) continue;
      data.replicate_generics = GENERICS;
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(GENERICS_KEY);
  });
  run();
  if (fixed > 0) console.log(`[db] Общие строки схем: записей: ${fixed}`);
}

const TIER_BY_NAME: Record<string, 2 | 6 | 10 | 14> = {
  // 2-й уровень и выше.
  "Алхимический сосуд": 2,
  "Верёвка лазания": 2,
  "Возвращающееся оружие": 2,
  "Волшебная палочка боевого мага +1": 2,
  "Волшебная палочка обнаружения магии": 2,
  "Волшебная палочка секретов": 2,
  "Камни послания": 2,
  "Многообразный инструмент": 2,
  "Ночные очки": 2,
  "Обмотки безоружной мощи +1": 2,
  "Оружие +1": 2,
  "Оружие повторного выстрела": 2,
  "Сумка хранения": 2,
  "Шапка подводного дыхания": 2,
  "Щит +1": 2,
  // 6-й уровень и выше.
  "Палочка паутины": 6,
  "Палочка стрел": 6,
  "Доспех +1": 6,
  "Кольцо восстановления заклинаний": 6,
  "Кольцо плавания": 6,
  "Кольцо хождения по воде": 6,
  "Ожерелье адаптации": 6,
  "Ослепительное оружие": 6,
  "Оружие предупреждения": 6,
  "Отталкивающий щит": 6,
  "Очки детального зрения": 6,
  "Очки очарования": 6,
  "Перчатки воровства": 6,
  "Плащ ската": 6,
  "Сапоги извилистого пути": 6,
  "Свирель ужаса": 6,
  "Усилитель разума": 6,
  "Фонарь обнаружения": 6,
  "Шлем осведомлённости": 6,
  "Щит часового": 6,
  "Эльфийский плащ": 6,
  "Эльфийские сапоги": 6,
  // 10-й уровень и выше.
  "Палочка боевого мага +2": 10,
  "Доспех сопротивления": 10,
  "Кинжал яда": 10,
  "Кольцо падения пёрышком": 10,
  "Кольцо прыжков": 10,
  "Кольцо защиты разума": 10,
  "Обмотки +2": 10,
  "Оружие +2": 10,
  "Щит +2": 10,
  "Эльфийская кольчуга": 10,
  // 14-й уровень и выше.
  "Доспех +2": 14,
  "Кольцо барана": 14,
  "Кольцо защиты": 14,
  "Кольцо свободных действий": 14,
  "Ловящий стрелы щит": 14,
  "Язык пламени": 14,
};

// Типы, исключённые из обычных (книга: «кроме Зелий/Свитков/проклятых»).
const EXCLUDED_COMMON_TYPES = new Set(["Зелья", "Свитки"]);

/** Догоняющее добавление именных схем — без флага, каждый старт. Только
 *  добавляет отсутствующие (предметы, заведённые позже по книге), ничего не
 *  переставляет и не чистит: ручные правки тиров в безопасности. Так шесть
 *  недостающих предметов подтянутся сами, когда их заведут в справочнике. */
export function ensureNamedReplicaSchemes(database: Database): void {
  const artificers = database
    .prepare(
      `SELECT e.id, e.system_id, e.data
         FROM compendium_entries e
         JOIN system_sections s ON s.id = e.section_id
        WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Артефактор'`
    )
    .all() as { id: number; system_id: number; data: string }[];
  let added = 0;
  const addedNames: string[] = [];
  const run = database.transaction(() => {
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    for (const artificer of artificers) {
      let artData: Record<string, unknown>;
      try {
        const v: unknown = JSON.parse(artificer.data || "{}");
        if (!v || typeof v !== "object" || Array.isArray(v)) continue;
        artData = v as Record<string, unknown>;
      } catch {
        continue;
      }
      const list = Array.isArray(artData.replicate_schemes)
        ? (artData.replicate_schemes as { entryId: number; minLevel: number }[])
        : [];
      if (list.length === 0) continue;
      const have = new Set(list.map((s) => s.entryId));
      const items = database
        .prepare(
          `SELECT e.id, e.name FROM compendium_entries e
             JOIN system_sections s ON s.id = e.section_id
            WHERE s.kind = 'magic_item' AND e.system_id = ?`
        )
        .all(artificer.system_id) as { id: number; name: string }[];
      const byName = new Map(items.map((i) => [i.name, i]));
      let changed = false;
      for (const [name, tier] of Object.entries(TIER_BY_NAME)) {
        const item = byName.get(name);
        if (!item || have.has(item.id)) continue;
        list.push({ entryId: item.id, minLevel: tier });
        have.add(item.id);
        added++;
        changed = true;
        if (!addedNames.includes(name)) addedNames.push(name);
      }
      if (changed) {
        artData.replicate_schemes = list;
        update.run(JSON.stringify(artData), artificer.id);
      }
    }
  });
  run();
  if (added > 0) console.log(`[db] Именные схемы подтянуты: ${added}: ${addedNames.join(", ")}`);
}

export function migrateDndReplicaTiers(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;

  let retiered = 0;
  let added = 0;
  let pruned = 0;
  const missing: string[] = [];

  const run = database.transaction(() => {
    const artificers = database
      .prepare(
        `SELECT e.id, e.system_id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Артефактор'`
      )
      .all() as { id: number; system_id: number; data: string }[];
    if (artificers.length === 0) {
      database.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))").run(MIGRATION_KEY);
      return;
    }
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    const parse = (raw: string): Record<string, unknown> => {
      try {
        const v = JSON.parse(raw || "{}");
        return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    };

    for (const artificer of artificers) {
      const artData = parse(artificer.data);
      const list = Array.isArray(artData.replicate_schemes)
        ? (artData.replicate_schemes as { entryId: number; minLevel: number }[])
        : [];
      if (list.length === 0) continue;

      const items = database
        .prepare(
          `SELECT e.id, e.name, e.data
             FROM compendium_entries e
             JOIN system_sections s ON s.id = e.section_id
            WHERE s.kind = 'magic_item' AND e.system_id = ?`
        )
        .all(artificer.system_id) as { id: number; name: string; data: string }[];
      const byId = new Map(items.map((i) => [i.id, i]));
      const byName = new Map(items.map((i) => [i.name, i]));
      const byEntryId = new Map(list.map((s) => [s.entryId, s]));

      let changed = false;
      // 1) Именные тиры книги — поверх эвристики (она была машинной, не ручной).
      for (const [name, tier] of Object.entries(TIER_BY_NAME)) {
        const item = byName.get(name);
        if (!item) {
          if (!missing.includes(name)) missing.push(name);
          continue;
        }
        const cur = byEntryId.get(item.id);
        if (cur) {
          if (cur.minLevel !== tier) {
            cur.minLevel = tier;
            retiered++;
            changed = true;
          }
        } else {
          const rec = { entryId: item.id, minLevel: tier };
          list.push(rec);
          byEntryId.set(item.id, rec);
          added++;
          changed = true;
        }
      }
      // 2) Обычные без зелий/свитков/проклятых.
      for (const [entryId, rec] of [...byEntryId]) {
        const item = byId.get(entryId);
        if (!item) continue;
        if (TIER_BY_NAME[item.name] != null) continue;
        const d = parse(item.data);
        if (
          (d.rarity === "Обычный" && EXCLUDED_COMMON_TYPES.has(String(d.item_type ?? ""))) ||
          d.cursed === true
        ) {
          const at = list.indexOf(rec);
          if (at >= 0) list.splice(at, 1);
          byEntryId.delete(entryId);
          pruned++;
          changed = true;
        }
      }

      if (changed) {
        artData.replicate_schemes = list;
        update.run(JSON.stringify(artData), artificer.id);
      }
    }

    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(MIGRATION_KEY);
  });

  run();
  console.log(
    `[db] Тиры схем: переставлено: ${retiered}; добавлено: ${added}; вычищено: ${pruned}` +
      (missing.length > 0 ? `; нет записей: ${missing.join(", ")}` : "")
  );
}
