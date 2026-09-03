import type { Database } from "better-sqlite3";

/**
 * Разовое приведение группы «Навыки» справочника D&D 5.5 к общему словарю.
 *
 * Зачем. Лист персонажа сверял владения по русскому имени, а имён у навыка
 * оказалось два: свой захардкоженный список листа и записи справочника,
 * откуда имена приходят с классами и предысториями. По базе владельца из
 * 72 выдач предысторий молча терялись 15, из 103 имён в
 * `skill_choice_options` классов не совпадали 19, а у одного листа в
 * `skillProfs` лежало владение «Тайная магия», которого на листе не видно
 * вовсе — такой строки в списке нет.
 *
 * Решение (гриллинг 2026-09-04): ключом владения становится `name_original`
 * — английское имя. Оно стабильно между переводами, переизданиями и базами;
 * `id` для этого не годится (модули каталога ставятся с новыми id, и лист,
 * приехавший с чужой машины, потерял бы все владения), русское имя — тоже
 * (переименовали навык в справочнике — сломались все листы).
 *
 * Миграция трогает минимум:
 * - `name_original` и `data.ability` пишутся, только если пусты;
 * - три имени переименовываются, ТОЛЬКО если запись до сих пор называется
 *   ровно так, как мы ожидаем. Если владелец уже переименовал её сам —
 *   миграция проходит мимо, а расхождение достаётся экрану сверки;
 * - алиасы дописываются к существующим, ничего не вычёркивая.
 *
 * Характеристика пишется русским именем — так же, как её пишут
 * `saving_throws` и `spellcasting_ability` записей классов (35 из 35
 * значений в базе владельца разбираются `ABILITY_NAME_TO_KEY`).
 * Источником правды для восемнадцати книжных навыков она всё равно
 * остаётся в коде клиента: привязка навыка к характеристике — правило
 * системы, а не перевод. В справочник она пишется, чтобы её было видно
 * там же, где сам навык, и чтобы навык, заведённый мастером, мог принести
 * свою.
 */

interface SkillSeed {
  /** Как запись называется сейчас — по нему миграция её и находит. */
  current: string;
  /** Новое имя. Пусто — переименования нет. */
  rename?: string;
  original: string;
  ability: string;
  aliases: string[];
}

/**
 * Восемнадцать навыков книги. Английские имена — те же, которыми оперирует
 * импортёр Long Story Short (`services/lssImport.ts`), так что импорт и
 * справочник сходятся на одном ключе.
 *
 * Клиентский двойник этого списка — `client/src/components/dnd/skillCatalog.ts`.
 * Списка два, потому что общего разделяемого модуля между `client/` и
 * `server/` в проекте нет, а заводить его ради восемнадцати строк — отдельная
 * работа. Правки вносить в оба.
 */
const SKILL_SEEDS: SkillSeed[] = [
  { current: "Акробатика", original: "Acrobatics", ability: "Ловкость", aliases: [] },
  {
    current: "Уход за животными",
    original: "Animal Handling",
    ability: "Мудрость",
    // «Обращение с животными» встречается в сохранённых листах,
    // «Дрессировка» — в других переводах (владелец, 2026-09-04).
    aliases: ["Обращение с животными", "Дрессировка"],
  },
  {
    current: "Аркана",
    rename: "Арканная магия",
    original: "Arcana",
    ability: "Интеллект",
    // «Аркана» пишут все записи компендиума, «Магия» стояла на листах.
    aliases: ["Аркана", "Магия", "Тайная магия"],
  },
  { current: "Атлетика", original: "Athletics", ability: "Сила", aliases: [] },
  { current: "Обман", original: "Deception", ability: "Харизма", aliases: [] },
  { current: "История", original: "History", ability: "Интеллект", aliases: [] },
  { current: "Проницательность", original: "Insight", ability: "Мудрость", aliases: [] },
  { current: "Запугивание", original: "Intimidation", ability: "Харизма", aliases: [] },
  {
    current: "Анализ",
    rename: "Анализ/расследование",
    original: "Investigation",
    ability: "Интеллект",
    aliases: ["Анализ", "Расследование"],
  },
  { current: "Медицина", original: "Medicine", ability: "Мудрость", aliases: [] },
  { current: "Природа", original: "Nature", ability: "Интеллект", aliases: [] },
  {
    current: "Внимательность",
    rename: "Внимание/восприятие",
    original: "Perception",
    ability: "Мудрость",
    aliases: ["Внимательность", "Восприятие"],
  },
  { current: "Выступление", original: "Performance", ability: "Харизма", aliases: [] },
  { current: "Убеждение", original: "Persuasion", ability: "Харизма", aliases: [] },
  { current: "Религия", original: "Religion", ability: "Интеллект", aliases: [] },
  { current: "Ловкость рук", original: "Sleight of Hand", ability: "Ловкость", aliases: [] },
  { current: "Скрытность", original: "Stealth", ability: "Ловкость", aliases: [] },
  { current: "Выживание", original: "Survival", ability: "Мудрость", aliases: [] },
];

const MIGRATION_KEY = "dnd_skill_names_migrated";

function parseAliases(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function parseData(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function migrateDndSkillNames(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;

  // Группа «Навыки» ищется под разделом вида `mechanics` системы D&D 5.5 —
  // так же, как её находит клиент (`loadDndMechanicsGroup`). Систему берём по
  // коду, а не по имени: имя владелец может поменять.
  const groups = database
    .prepare(
      `SELECT e.id FROM compendium_entries e
         JOIN system_sections s ON s.id = e.section_id
         JOIN systems sys ON sys.id = e.system_id
        WHERE s.kind = 'mechanics'
          AND e.parent_id IS NULL
          AND e.name = 'Навыки'
          AND (sys.code IN ('phb', 'dnd55') OR sys.name = 'D&D 5.5')`
    )
    .all() as { id: number }[];

  const update = database.prepare(
    "UPDATE compendium_entries SET name = ?, name_original = ?, aliases = ?, data = ? WHERE id = ?"
  );
  let touched = 0;
  let renamed = 0;
  let skipped = 0;

  const run = database.transaction(() => {
    for (const group of groups) {
      const rows = database
        .prepare("SELECT id, name, name_original, aliases, data FROM compendium_entries WHERE parent_id = ?")
        .all(group.id) as {
        id: number;
        name: string;
        name_original: string;
        aliases: string;
        data: string;
      }[];

      for (const seed of SKILL_SEEDS) {
        const row = rows.find((r) => r.name === seed.current);
        // Записи с таким именем нет — либо владелец её уже переименовал, либо
        // группа собрана иначе. Это не ошибка: расхождение увидит экран сверки.
        if (!row) {
          skipped++;
          continue;
        }
        const nextName = seed.rename ?? row.name;
        const nextOriginal = row.name_original || seed.original;
        const nextAliases = [...new Set([...parseAliases(row.aliases), ...seed.aliases])];
        const data = parseData(row.data);
        if (!data.ability) data.ability = seed.ability;

        update.run(nextName, nextOriginal, JSON.stringify(nextAliases), JSON.stringify(data), row.id);
        touched++;
        if (seed.rename) renamed++;
      }
    }
    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(MIGRATION_KEY);
  });

  run();
  if (touched > 0 || skipped > 0) {
    console.log(
      `[db] Навыки D&D: обновлено ${touched}, переименовано ${renamed}, пропущено ${skipped} (имя записи не совпало с ожидаемым — правилось руками либо миграция уже проходила)`
    );
  }
}
