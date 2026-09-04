import type { Database } from "better-sqlite3";

/**
 * Разметка выдач у черт происхождения, вида «Человек» и класса «Артефактор».
 *
 * Зачем. До этого выдавать что-либо умела только предыстория: у видов в
 * данных нет ни навыков, ни черты происхождения (у «Человека» лежат три
 * текстовые особенности — «Находчивость», «Умелость», «Универсальность» — и
 * всё), а у черт поля выдачи нет вовсе. Визард поэтому не мог ни дать
 * человеку навык, ни спросить черту, ни учесть, что «Одарённый» добавляет
 * к выбору ещё три навыка.
 *
 * Что размечено (решение F2, гриллинг 2026-09-04): **13 черт происхождения**
 * — ровно те, что визард показывает на новом шаге. Остальные 116 черт берут
 * на 4, 8, 12 уровне по одной, и Мастер там читает текст; размечать их
 * вслепую — та же цена и тот же риск, что и заполнять `name_original` по
 * памяти.
 *
 * Граница разметки — та же, что у структуры выдач: **выдача** ложится в
 * поля, **изменение правила** остаётся текстом. Поэтому «Бдительный»
 * (инициатива), «Крепкий» (хиты), «Дикий атакующий» (переброс урона) и
 * «Лекарь» здесь не размечены вовсе: они ничего не выдают, они меняют
 * правило, и приложение за игрока его не применяет. «Драчун» не размечен по
 * той же причине с оговоркой: владение импровизированным оружием — выдача,
 * но владений **оружием** структура пока не несёт, и заводить их ради одной
 * черты значит завести седьмой вид выдачи под один случай.
 *
 * Миграция дописывает только пустые поля: если владелец уже разметил
 * запись сам, она проходит мимо.
 */

const MIGRATION_KEY = "dnd_origin_grants_seeded";

interface Seed {
  /** Имя записи — по нему она и находится. */
  name: string;
  /** Что дописать в `data`. Ключ пишется, только если его там ещё нет. */
  data: Record<string, unknown>;
}

/**
 * Черты происхождения. Пулы задаются именем «prof_bonus», а не числом:
 * у «Везунчика» очков везения по бонусу мастерства, то есть значение растёт
 * с уровнем (решение F3 — числа и два имени, формул нет).
 */
const FEAT_SEEDS: Seed[] = [
  {
    name: "Везунчик",
    data: {
      resource_pools: [
        { key: "luck", label: "Очки везения", max: "prof_bonus", recharge: "long" },
      ],
    },
  },
  {
    name: "Одарённый",
    // Три навыка ИЛИ инструмента на выбор. Список пуст — значит любой:
    // сузить его было бы враньём, черта не ограничивает.
    data: { skill_choice_count: 3, skill_choice_options: [] },
  },
  {
    name: "Музыкант",
    data: { tool_choice: { count: 3, group: "Музыкальный инструмент" } },
  },
  {
    name: "Ремесленник",
    data: { tool_choice: { count: 3, group: "Ремесленные инструменты" } },
  },
  {
    name: "Посвящённый в магию",
    // Два заговора и одно заклинание 1 круга из списка Жреца, Друида или
    // Волшебника. `classIds` проставляются ниже по именам классов — id
    // записей у разных установок разные, зашивать их в код нельзя.
    data: {
      spell_choices: [
        { count: 2, level: 0, classNames: ["Жрец", "Друид", "Волшебник"], outsideLimit: true },
        { count: 1, level: 1, classNames: ["Жрец", "Друид", "Волшебник"], outsideLimit: true },
      ],
    },
  },
  {
    name: "Вампирская игрушка",
    data: {
      resource_pools: [
        { key: "hasty_retreat", label: "Поспешное отступление", max: "prof_bonus", recharge: "long" },
      ],
    },
  },
  {
    name: "Неутомимый гуляка",
    data: {
      resource_pools: [
        { key: "reveler", label: "Героическое вдохновение от союзника", max: "prof_bonus", recharge: "short" },
      ],
    },
  },
  {
    name: "Охотник на вампиров",
    data: {
      resource_pools: [
        { key: "vitality_ward", label: "Оберег жизненной силы", max: 1, recharge: "short" },
      ],
    },
  },
];

export function migrateDndOriginGrants(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;

  let touched = 0;
  let skipped = 0;

  const run = database.transaction(() => {
    const parse = (raw: string): Record<string, unknown> => {
      try {
        const v = JSON.parse(raw || "{}");
        return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    };
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");

    // Классы нужны, чтобы «Посвящённый в магию» ссылался на списки заклинаний
    // по id, а не по имени: имя переводится, id — нет (в пределах установки).
    const classes = database
      .prepare("SELECT e.id, e.name FROM compendium_entries e JOIN system_sections s ON s.id = e.section_id WHERE s.kind = 'class' AND e.parent_id IS NULL")
      .all() as { id: number; name: string }[];
    const classIdByName = new Map(classes.map((c) => [c.name, c.id]));

    function apply(row: { id: number; data: string } | undefined, patch: Record<string, unknown>): void {
      if (!row) {
        skipped++;
        return;
      }
      const data = parse(row.data);
      let changed = false;
      for (const [key, value] of Object.entries(patch)) {
        // Уже размечено — не трогаем: владелец мог поправить руками.
        if (data[key] !== undefined && data[key] !== null && data[key] !== "") continue;
        data[key] = value;
        changed = true;
      }
      if (!changed) {
        skipped++;
        return;
      }
      update.run(JSON.stringify(data), row.id);
      touched++;
    }

    const featRow = database.prepare(
      "SELECT e.id, e.data FROM compendium_entries e JOIN system_sections s ON s.id = e.section_id WHERE s.kind = 'feat' AND e.name = ?"
    );
    for (const seed of FEAT_SEEDS) {
      const patch = { ...seed.data };
      const choices = patch.spell_choices as { classNames?: string[] }[] | undefined;
      if (Array.isArray(choices)) {
        patch.spell_choices = choices.map((c) => {
          const { classNames, ...rest } = c;
          const ids = (classNames ?? []).map((n) => classIdByName.get(n)).filter((id): id is number => typeof id === "number");
          return { ...rest, classIds: ids };
        });
      }
      apply(featRow.get(seed.name) as { id: number; data: string } | undefined, patch);
    }

    // Человек: «Умелость» — один навык на выбор, «Универсальность» — черта
    // происхождения на выбор. В данных вида этого не было ни в каком виде.
    const human = database
      .prepare("SELECT e.id, e.data FROM compendium_entries e JOIN system_sections s ON s.id = e.section_id WHERE s.kind = 'species' AND e.parent_id IS NULL AND e.name = ?")
      .get("Человек") as { id: number; data: string } | undefined;
    apply(human, { skill_choice_count: 1, skill_choice_options: [], origin_feat_choice: true });

    // Артефактор всегда знает «Починку», и она не идёт в счёт заговоров.
    // Перебор обретаемых заклинаний расширен на класс отдельно (решение W6);
    // до этого класс в нём не участвовал вовсе.
    const artificer = database
      .prepare("SELECT e.id, e.data FROM compendium_entries e JOIN system_sections s ON s.id = e.section_id WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = ?")
      .get("Артефактор") as { id: number; data: string } | undefined;
    const mending = database
      .prepare("SELECT e.id, e.name, e.name_original FROM compendium_entries e JOIN system_sections s ON s.id = e.section_id WHERE s.kind = 'spell' AND e.name_original = ?")
      .get("Mending") as { id: number; name: string; name_original: string } | undefined;
    if (artificer && mending) {
      apply(artificer, {
        granted_spells: [
          { id: mending.id, name: mending.name, original: mending.name_original, grantLevel: 1, outsideLimit: true },
        ],
      });
    } else if (artificer) {
      skipped++;
    }

    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(MIGRATION_KEY);
  });

  run();
  if (touched > 0 || skipped > 0) {
    console.log(`[db] Выдачи черт и видов: размечено ${touched}, пропущено ${skipped} (записи нет либо поле уже заполнено)`);
  }
}
