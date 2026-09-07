import type { Database } from "better-sqlite3";

/**
 * Схемы реплик Артефактора и признак проклятого предмета.
 *
 * «Реплики магических предметов» — умение Артефактора 2-го уровня: он знает
 * несколько схем и после долгого отдыха создаёт по ним предметы. Чего можно
 * знать, зависит от уровня класса.
 *
 * Где живёт список (решение R1). В данных самой записи «Артефактор», полем
 * `replicate_schemes: [{ entryId, minLevel }]`, а не отдельной группой
 * справочника: это правило класса, и переезжать оно должно вместе с ним —
 * при переустановке модуля список приезжает целиком, а не собирается заново.
 *
 * Как собран список. По уже существующим полям магических предметов
 * (`rarity`, `item_type`), без единой новой записи:
 *
 *   - **2 уровень** — любой Обычный предмет (54 штуки);
 *   - **10** — Необычный Чудесный (63);
 *   - **14** — Редкий Чудесный (40);
 *   - плюс «Оружие +1», «Доспех +1», «Щит +1», «Боеприпас +1» — они
 *     Необычные и Редкие, но не Чудесные, а без них умение теряет главный
 *     свой смысл; поставлены на 10 уровень, вместе с прочими Необычными.
 *
 * Проклятые исключаются. Признака в данных не было — заводится флаг
 * `cursed`, и он проставляется тем восьми записям, где о проклятии сказано
 * в описании. Дальше это поле правится в Справочнике руками: гадать по
 * тексту у остальных четырёхсот записей — значит однажды не дать создать
 * то, что создавать можно.
 */

const MIGRATION_KEY = "dnd_replica_schemes_seeded";
// Колонки «Известные схемы» / «Магические предметы» приехали импортом как
// «показатель по уровню» (role: "stat"), а лист ищет их строго по ролям
// replica_schemes / replica_items (replicaLimits). Первый запуск сидинга
// типизировал колонки только вместе со списком схем — у баз, где список уже
// был (владелец разметил руками или повторный импорт), роли так и остались
// "stat", и блок реплик на листе не рендерился. Поэтому типизация колонок —
// отдельная миграция с собственным ключом: чинит и живые базы, и будущие.
const COLUMNS_MIGRATION_KEY = "dnd_replica_columns_typed";

/** Прибавка к оружию и доспеху — их создают чаще всего, а по редкости и
 *  типу они в общий отбор не попадают. */
const EXTRA_SCHEMES: { name: string; minLevel: number }[] = [
  { name: "Оружие +1", minLevel: 10 },
  { name: "Доспех +1", minLevel: 10 },
  { name: "Щит +1", minLevel: 10 },
  { name: "Боеприпас +1", minLevel: 10 },
];

const WONDROUS = "Чудесные предметы";

/** Ставит колонкам «Известные схемы» / «Магические предметы» роли пределов
 *  реплик. Возвращает true, если хоть одна роль изменилась. Чистая функция
 *  над распарсенным data — запись в БД делает вызывающий код. */
function typeReplicaColumns(artData: Record<string, unknown>): boolean {
  // Колонки приехали импортом как «показатель по уровню» — просто числа.
  // Для реплик это пределы, с которыми лист работает, поэтому им ставятся
  // свои роли; иначе искать их пришлось бы по названию колонки в коде.
  const progression = artData.progression as { columns?: { key: string; label: string; role?: string }[] } | undefined;
  let changed = false;
  for (const col of progression?.columns ?? []) {
    const label = (col.label ?? "").trim().toLowerCase();
    const role = label.startsWith("известные схемы")
      ? "replica_schemes"
      : label.startsWith("магические предметы")
        ? "replica_items"
        : "";
    if (role && col.role !== role) {
      col.role = role;
      changed = true;
    }
  }
  return changed;
}

/**
 * Догоняющая миграция ролей колонок (см. COLUMNS_MIGRATION_KEY). Основная
 * migrateDndReplicaSchemes уже отработала на живых базах и больше не
 * запускается (флаг MIGRATION_KEY выставлен), а колонки у них так и остались
 * role: "stat" — блок реплик на листе из-за этого не рендерится. Проходит по
 * всем записям «Артефактор» во всех системах и правит только роли, ничего
 * больше не трогая: схемы, ручные правки и чужие колонки не задеваются.
 */
export function migrateDndReplicaColumnRoles(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(COLUMNS_MIGRATION_KEY);
  if (done) return;

  let typed = 0;
  const run = database.transaction(() => {
    const rows = database
      .prepare(
        `SELECT e.id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Артефактор'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        const v: unknown = JSON.parse(row.data || "{}");
        if (!v || typeof v !== "object" || Array.isArray(v)) continue;
        data = v as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeReplicaColumns(data)) {
        update.run(JSON.stringify(data), row.id);
        typed++;
      }
    }
    database.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))").run(COLUMNS_MIGRATION_KEY);
  });

  run();
  if (typed > 0) console.log(`[db] Роли колонок реплик Артефактора: исправлено записей: ${typed}`);
}

export function migrateDndReplicaSchemes(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;

  let cursedMarked = 0;
  let schemes = 0;
  let columnsTyped = 0;

  const run = database.transaction(() => {
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    const parse = (raw: string): Record<string, unknown> => {
      try {
        const v = JSON.parse(raw || "{}");
        return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    };

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

    const itemsOf = database.prepare(
      `SELECT e.id, e.name, e.data, e.description
         FROM compendium_entries e
         JOIN system_sections s ON s.id = e.section_id
        WHERE s.kind = 'magic_item' AND e.system_id = ?`
    );

    for (const artificer of artificers) {
      const artData = parse(artificer.data);
      // Роли колонок — всегда: список схем мог уже существовать, а роли —
      // нет (см. COLUMNS_MIGRATION_KEY). Перетипизация идемпотентна.
      if (typeReplicaColumns(artData)) {
        columnsTyped++;
        update.run(JSON.stringify(artData), artificer.id);
      }
      // Уже размечено (владельцем или прошлым запуском) — список не трогаем.
      if (Array.isArray(artData.replicate_schemes) && artData.replicate_schemes.length > 0) continue;

      const items = itemsOf.all(artificer.system_id) as {
        id: number;
        name: string;
        data: string;
        description: string | null;
      }[];

      const list: { entryId: number; minLevel: number }[] = [];
      for (const item of items) {
        const d = parse(item.data);
        // Проклятие названо в описании — ставим флаг и исключаем из схем.
        if (d.cursed === undefined && /прокля/i.test(`${item.name} ${item.description ?? ""}`)) {
          d.cursed = true;
          update.run(JSON.stringify(d), item.id);
          cursedMarked++;
        }
        if (d.cursed === true) continue;

        const rarity = typeof d.rarity === "string" ? d.rarity : "";
        const type = typeof d.item_type === "string" ? d.item_type : "";
        const extra = EXTRA_SCHEMES.find((e) => e.name === item.name);
        let minLevel = 0;
        if (extra) minLevel = extra.minLevel;
        else if (rarity === "Обычный") minLevel = 2;
        else if (rarity === "Необычный" && type === WONDROUS) minLevel = 10;
        else if (rarity === "Редкий" && type === WONDROUS) minLevel = 14;
        if (minLevel > 0) list.push({ entryId: item.id, minLevel });
      }

      if (list.length === 0) continue;
      artData.replicate_schemes = list;
      update.run(JSON.stringify(artData), artificer.id);
      schemes += list.length;
    }

    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(MIGRATION_KEY);
  });

  run();
  if (schemes > 0 || cursedMarked > 0 || columnsTyped > 0) {
    console.log(
      `[db] Схемы реплик Артефактора: ${schemes}; помечено проклятыми: ${cursedMarked}; колонок таблицы размечено: ${columnsTyped}`
    );
  }
}
