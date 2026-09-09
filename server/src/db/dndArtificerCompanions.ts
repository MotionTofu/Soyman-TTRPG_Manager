import type { Database } from "better-sqlite3";
import { randomUUID } from "crypto";

/** Три опции Магического мастерового (6 ур.) отдельными строками — у каждой
 *  своя цена и действие, одному cost их не выразить (прецедент: режимы пушки).
 *  Родитель (12537) остаётся текстовой справкой без тайминга, чтобы не
 *  двоить строки в «Действиях». Ключ свой: первая миграция файла уже отработала. */
const MASTERWORK_KEY = "artificer_masterworker_v1";
const MASTERWORK_TOUCH = "Коснитесь созданного репликами магического предмета в пределах 5 футов от вас. ";

/**
 * Боевые спутники Артефактора: кидаемые строки и чертежи тел (аудит, 2026-09-07).
 *
 * Фаза A (этот файл — только данные, кода не требует: движок проверок,
 * эффектов и цен уже есть): пушка тремя строками, детонация, разрыв и
 * починка защитника, встряска с INT-пулом, гигантский размер отдельной
 * строкой с INT-пулом. Апгрейды 9/15 (+1к8, 4к6) строками не размножаем —
 * игрок правит куб вручную, описание подсказывает.
 *
 * Чертежи тел (data.companion) кладутся рядом — их читает карточка спутника
 * (Фаза B): { name, ac, hp, maxCount, extraCount?, mending?, detonateFeature?,
 * coverFeature?, dismissable? }. dismissable (пушку можно развеять досрочно)
 * заодно отличает временные тела (на долгом отдыхе исчезают) от постоянных
 * (защитник собирается заново).
 * Формулы ac/hp — мини-язык «12+int», «5+5*level»: числа, level (уровень
 * класса), int (мод INT), операции + - * и скобки. Имён классов и id записей
 * в коде нет: extraCount/coverFeature ссылаются именем умения.
 */

const MIGRATION_KEY = "artificer_companion_actions_v1";

// Подклассы: Артиллерист, Боевой кузнец, Бронник.
const ARTILLERIST = 12870;
const BATTLE_SMITH = 12895;
const ARMORER = 12919;

const FIRE = { id: 12273, name: "Огненный" };
const FORCE = { id: 12391, name: "Силовое поле" };

interface Row {
  id: number;
  data: string;
}

function parse(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function migrateDndArtificerCompanionActions(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;

  let updated = 0;
  let inserted = 0;

  const run = database.transaction(() => {
    const get = database.prepare("SELECT id, data FROM compendium_entries WHERE id = ?");
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");

    // Слияние в существующую запись: дописываем только недостающие ключи,
    // ручные правки Мастера (непустые checks/effects/cost) не трогаем.
    const mergeInto = (id: number, patch: Record<string, unknown>): boolean => {
      const row = get.get(id) as Row | undefined;
      if (!row) return false;
      const data = parse(row.data);
      if (!data) return false;
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        const cur = data[k];
        const empty =
          cur == null || (Array.isArray(cur) && cur.length === 0) || (typeof cur === "object" && !Array.isArray(cur) && Object.keys(cur as object).length === 0);
        if (empty) {
          data[k] = v;
          changed = true;
        }
      }
      // cost сливаем глубже: maxAbility дописывается в существующий cost.
      if (patch.cost && typeof patch.cost === "object" && !Array.isArray(patch.cost)) {
        const prev =
          data.cost && typeof data.cost === "object" && !Array.isArray(data.cost)
            ? (data.cost as Record<string, unknown>)
            : null;
        if (prev) {
          for (const [k, v] of Object.entries(patch.cost as Record<string, unknown>)) {
            if (prev[k] == null) {
              prev[k] = v;
              changed = true;
            }
          }
        }
      }
      if (changed) {
        update.run(JSON.stringify(data), id);
        updated++;
      }
      return changed;
    };

    // Чертежи тел (Фаза B) — рядом с умениями-хозяевами.
    mergeInto(12244, {
      companion: {
        name: "Мистическая пушка",
        ac: "18",
        hp: "5*level",
        maxCount: 1,
        extraCount: { feature: "Укреплённая позиция", count: 2 },
        mending: "2к6",
        detonateFeature: "Взрывная пушка",
        coverFeature: "Укреплённая позиция",
        dismissable: true,
      },
    });
    mergeInto(12371, {
      companion: {
        name: "Стальной защитник",
        ac: "12+int",
        hp: "5+5*level",
        maxCount: 1,
        mending: null,
      },
    });

    // Детонация (9 ур., реакция): спас Лов, 3к10 силой, полов.
    mergeInto(12473, {
      checks: [{ id: "save1", type: "save", saveAbility: "Ловкость" }],
      effects: [
        {
          id: "i1",
          type: "damage",
          when: "save_fail",
          checkId: "save1",
          dice: "3к10",
          damageType: FORCE,
          halfOnSuccess: true,
        },
      ],
    });

    // Встряска (9 ур.): наездник без действия (раз в ход) — «Иное»;
    // пул мод INT (минимум 1); урон 2к6 или лечение 2к6 (с 15 ур. 4к6 —
    // правится вручную, описание подсказывает).
    mergeInto(12540, {
      casting_timing: "Иное",
      casting_timing_other: "Без действия: на попадание, раз в ход",
      checks: [],
      effects: [
        { id: "i1", type: "damage", when: "always", dice: "2к6", damageType: FORCE },
        { id: "i2", type: "heal", when: "always", dice: "2к6" },
      ],
      cost: { maxAbility: "int" },
    });

    // Новые строки: режимы пушки, разрыв, починка, гигантский размер.
    const exists = database.prepare(
      "SELECT id FROM compendium_entries WHERE parent_id = ? AND name = ?"
    );
    const maxPos = database.prepare(
      "SELECT COALESCE(MAX(position), -1) AS m FROM compendium_entries WHERE parent_id = ?"
    );
    const insert = database.prepare(
      `INSERT INTO compendium_entries
        (system_id, section_id, parent_id, kind, name, level, data, description, position, uid)
       VALUES (?, ?, ?, 'feature', ?, 3, ?, ?, ?, ?)`
    );
    const add = (
      parentId: number,
      name: string,
      data: Record<string, unknown>,
      description: string
    ): void => {
      if (exists.get(parentId, name)) return;
      // Родителя-подкласса может не быть (тестовые базы, частичные системы) —
      // тогда вставлять некуда, молча пропускаем, а не роняем миграцию.
      // section_id берём у родителя: хардкод id раздела роняет чужую базу
      // с FOREIGN KEY constraint failed, если раздела с таким id там нет.
      const parent = database.prepare("SELECT system_id, section_id FROM compendium_entries WHERE id = ?").get(parentId) as
        | { system_id: number; section_id: number }
        | undefined;
      if (!parent) return;
      const pos = (maxPos.get(parentId) as { m: number }).m + 1;
      insert.run(parent.system_id, parent.section_id, parentId, name, JSON.stringify(data), description, pos, randomUUID());
      inserted++;
    };

    add(
      ARTILLERIST,
      "Огнемёт (пушка)",
      {
        casting_timing: "Бонусное действие",
        checks: [{ id: "save1", type: "save", saveAbility: "Ловкость" }],
        effects: [
          { id: "i1", type: "damage", when: "save_fail", checkId: "save1", dice: "2к8", damageType: FIRE, halfOnSuccess: true },
        ],
      },
      "Пушка выпускает огонь 15-футовым конусом. Спасбросок Ловкости против СЛ ваших заклинаний: 2к8 урона огнём при провале, половина при успехе. С 9 уровня (Взрывная пушка) урон +1к8 — поправьте куб вручную."
    );
    add(
      ARTILLERIST,
      "Силовая баллиста (пушка)",
      {
        casting_timing: "Бонусное действие",
        checks: [{ id: "attack1", type: "attack", attackRange: "ranged" }],
        effects: [
          { id: "i1", type: "damage", when: "hit", checkId: "attack1", dice: "2к8", damageType: FORCE },
          { id: "i2", type: "movement", when: "hit", checkId: "attack1", movementKind: "push", distance: "5 футов" },
        ],
      },
      "Дальнобойная атака заклинанием от пушки, 120 футов. При попадании: 2к8 урона силовым полем, существо отталкивается до 5 футов. С 9 уровня (Взрывная пушка) урон +1к8 — поправьте куб вручную."
    );
    add(
      ARTILLERIST,
      "Защитник (пушка)",
      {
        casting_timing: "Бонусное действие",
        checks: [],
        effects: [
          { id: "i1", type: "temp_hp", when: "always", dice: "1к8 + ваш модификатор Интеллекта (мин. +1)" },
        ],
      },
      "Пушка и выбранные существа в пределах 10 футов от неё получают временные хиты 1к8 + мод INT (мин. +1). С 9 уровня +1к8 — поправьте куб вручную."
    );
    add(
      BATTLE_SMITH,
      "Силовой разрыв",
      {
        casting_timing: "Бонусное действие",
        checks: [{ id: "attack1", type: "attack", attackRange: "melee" }],
        effects: [
          { id: "i1", type: "damage", when: "hit", checkId: "attack1", dice: "1к8 + 2 + ваш модификатор Интеллекта", damageType: FORCE },
        ],
      },
      "По вашей команде бонусным действием защитник бьёт: рукопашная атака заклинанием (бонус равен вашему), досягаемость 5 футов. При попадании: 1к8 + 2 + мод INT урона силовым полем."
    );
    add(
      BATTLE_SMITH,
      "Починка защитника",
      {
        casting_timing: "Действие",
        checks: [],
        effects: [
          { id: "i1", type: "heal", when: "always", dice: "2к8 + ваш модификатор Интеллекта" },
        ],
        cost: { kind: "uses", amount: 3, per: "day", ownResource: true },
      },
      "Защитник чинит себя либо видимый конструкт/предмет в пределах 5 футов: 2к8 + мод INT хитов. 3 раза в день (тратит своё действие)."
    );
    add(
      ARMORER,
      "Гигантский размер",
      {
        casting_timing: "Бонусное действие",
        checks: [],
        effects: [],
        cost: { kind: "uses", amount: 1, per: "long_rest", ownResource: true, maxAbility: "int" },
      },
      "Дредноут: бонусным действием на 1 минуту увеличиваете доспех (досягаемость +5, размер до Большого). Мод INT раз за долгий отдых (мин. 1)."
    );

    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(MIGRATION_KEY);
  });

  run();
  if (updated > 0 || inserted > 0) {
    console.log(`[db] Спутники Артефактора: обновлено записей: ${updated}; новых строк: ${inserted}`);
  }
}

/** Пакет строк с пулами (аудит 2026-09-07): Огонь фей картографа, полёт и
 *  притяжка идеального доспеха, Поиск пути атласа, распил мастерства алхимика
 *  (извержение 1/ход — без пула, котёл 1/долгий — отдельной строкой).
 *  Ключ свой, идемпотентно по (parent_id, name). */
const ROWS_KEY = "artificer_pool_rows_v1";

/** Мелочи текстов (аудит 2026-09-07): приписка жертвы атаки в разрыв (5 ур.),
 *  приписка апгрейда 15 ур. в гигантский размер, фикс шапки строки 6 таблицы
 *  («Мастер магических предметов» → «Магический мастеровой»). Только тексты,
 *  механика не затрагивается. Ключ свой. */
const TOUCHUPS_KEY = "artificer_touchups_v1";

export function migrateDndArtificerPoolRows(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(ROWS_KEY);
  if (done) return;

  let inserted = 0;
  let updated = 0;

  const run = database.transaction(() => {
    const get = database.prepare("SELECT id, data FROM compendium_entries WHERE id = ?");
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    const parse = (raw: string): Record<string, unknown> | null => {
      try {
        const v: unknown = JSON.parse(raw || "{}");
        return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    };
    const exists = database.prepare("SELECT id FROM compendium_entries WHERE parent_id = ? AND name = ?");
    const maxPos = database.prepare(
      "SELECT COALESCE(MAX(position), -1) AS m FROM compendium_entries WHERE parent_id = ?"
    );
    const insert = database.prepare(
      `INSERT INTO compendium_entries
        (system_id, section_id, parent_id, kind, name, level, data, description, position, uid)
       VALUES (?, ?, ?, 'feature', ?, ?, ?, ?, ?, ?)`
    );
    const sysOf = (parentId: number): { system_id: number; section_id: number } | null => {
      const r = database.prepare("SELECT system_id, section_id FROM compendium_entries WHERE id = ?").get(parentId) as
        | { system_id: number; section_id: number }
        | undefined;
      return r ?? null;
    };
    const add = (
      parentId: number,
      level: number,
      name: string,
      data: Record<string, unknown>,
      description: string
    ): void => {
      if (exists.get(parentId, name)) return;
      const sys = sysOf(parentId);
      if (sys == null) return;
      const pos = (maxPos.get(parentId) as { m: number }).m + 1;
      insert.run(sys.system_id, sys.section_id, parentId, name, level, JSON.stringify(data), description, pos, randomUUID());
      inserted++;
    };
    const setCost = (id: number, cost: Record<string, unknown> | null): void => {
      const row = get.get(id) as { id: number; data: string } | undefined;
      if (!row) return;
      const data = parse(row.data);
      if (!data) return;
      const prev =
        data.cost && typeof data.cost === "object" && !Array.isArray(data.cost)
          ? (data.cost as Record<string, unknown>)
          : null;
      // Пул уже размечен (владельцем или прошлой миграцией) — не трогаем.
      if (prev && (prev.maxAbility != null || prev.levelSteps != null)) return;
      if (cost == null) {
        if (data.cost == null) return;
        delete data.cost;
      } else {
        data.cost = { ...(prev ?? {}), ...cost };
      }
      update.run(JSON.stringify(data), id);
      updated++;
    };

    // Огонь фей без ячейки (INT/долгий). Был cost null.
    setCost(12373, { kind: "uses", amount: 1, per: "long_rest", ownResource: true, maxAbility: "int" });
    // Распил мастерства алхимика: общий пул 1/долгий неверен (извержение —
    // 1/ход без пула). Снимаем пул с родителя, котёл — отдельной строкой.
    setCost(12538, null);

    // Подклассы: Алхимик 12843, Бронник 12919, Картограф 12942.
    add(
      12843,
      15,
      "Бурлящий котёл",
      {
        casting_timing: "Действие",
        checks: [],
        effects: [],
        cost: { kind: "uses", amount: 1, per: "long_rest", ownResource: true },
      },
      "Сотворяете Бурлящий котёл Таши без ячейки, подготовки и материальных компонентов (фокус — инструменты алхимика). Раз в долгий отдых."
    );
    add(
      12919,
      15,
      "Полёт лазутчика",
      {
        casting_timing: "Бонусное действие",
        checks: [],
        effects: [],
        cost: { kind: "uses", amount: 1, per: "long_rest", ownResource: true, maxAbility: "int" },
      },
      "Бонусным действием до конца хода: скорость полёта = удвоенной скорости. Мод INT раз за долгий отдых (мин. 1)."
    );
    add(
      12919,
      15,
      "Притяжка стража",
      {
        casting_timing: "Реакция",
        casting_timing_other: "существо Огромное или меньше заканчивает ход в 30 футах",
        checks: [{ id: "save1", type: "save", saveAbility: "Сила" }],
        effects: [
          { id: "i1", type: "movement", when: "save_fail", checkId: "save1", movementKind: "pull", distance: "25 футов" },
        ],
        cost: { kind: "uses", amount: 1, per: "long_rest", ownResource: true, maxAbility: "int" },
      },
      "Реакция: видимое существо Огромное или меньше в 30 футах заканчивает ход — спас Силы против вашей СЛ; провал: притянуть до 25 футов по прямой в свободное пространство, в 5 футах — свободная рукопашная атака той же Реакцией. Мод INT раз за долгий отдых (мин. 1)."
    );
    add(
      12942,
      15,
      "Безошибочный путь",
      {
        casting_timing: "Иное",
        casting_timing_other: "сотворение без ячейки и компонентов",
        checks: [],
        effects: [],
        cost: { kind: "uses", amount: 1, per: "long_rest", ownResource: true },
      },
      "Вы — держатель карты атласа: сотворяете Поиск пути без ячейки, подготовки и компонентов. Раз в долгий отдых."
    );

    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(ROWS_KEY);
  });

  run();
  if (inserted > 0 || updated > 0) {
    console.log(`[db] Строки с пулами: новых: ${inserted}; цен проставлено: ${updated}`);
  }
}

/** Кубы от уровня класса (аудит, апгрейды урона): пушка +1к8 на 9-м, встряска
 *  2к6→4к6 на 15-м. Механизм levelDice в эффектах (effects.ts), сюда — только
 *  пороги + замена ручных приписок «поправьте куб вручную» на авто-подсчёт.
 *  Ключ свой, идемпотентно (шаги не дублируем, приписки правим один раз). */
const LEVEL_DICE_KEY = "artificer_level_dice_v1";

export function migrateDndArtificerLevelDice(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(LEVEL_DICE_KEY);
  if (done) return;

  let touched = 0;
  const run = database.transaction(() => {
    const get = database.prepare("SELECT id, data, description FROM compendium_entries WHERE id = ?");
    const setData = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    const setBoth = database.prepare("UPDATE compendium_entries SET data = ?, description = ? WHERE id = ?");
    const parse = (raw: string): Record<string, unknown> | null => {
      try {
        const v: unknown = JSON.parse(raw || "{}");
        return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    };
    type Fx = { id?: unknown; dice?: unknown; levelDice?: { level: number; dice: string }[] };
    // Один read-modify-write: шаги дописываются в эффект, дублей нет.
    const applySteps = (id: number, effectId: string, steps: { level: number; dice: string }[]): boolean => {
      const row = get.get(id) as { id: number; data: string; description: string | null } | undefined;
      if (!row) return false;
      const data = parse(row.data);
      const effects = data && Array.isArray(data.effects) ? (data.effects as Fx[]) : null;
      const fx = effects?.find((e) => e.id === effectId);
      if (!data || !fx || typeof fx.dice !== "string") return false;
      const have = Array.isArray(fx.levelDice) ? fx.levelDice : [];
      let changed = false;
      for (const s of steps) {
        if (!have.some((h) => h.level === s.level && h.dice === s.dice)) {
          have.push({ ...s });
          changed = true;
        }
      }
      if (!changed) return false;
      fx.levelDice = [...have].sort((a, b) => a.level - b.level);
      setData.run(JSON.stringify(data), id);
      return true;
    };
    const unmanual = (id: number, from: string, to: string): boolean => {
      const row = get.get(id) as { id: number; data: string; description: string | null } | undefined;
      if (!row || !(row.description ?? "").includes(from)) return false;
      const data = parse(row.data);
      if (!data) return false;
      setBoth.run(JSON.stringify(data), (row.description ?? "").replace(from, to), id);
      return true;
    };
    const steps: [number, string, { level: number; dice: string }[]][] = [
      [15791, "i1", [{ level: 9, dice: "3к8" }]],
      [15792, "i1", [{ level: 9, dice: "3к8" }]],
      [15793, "i1", [{ level: 9, dice: "2к8 + ваш модификатор Интеллекта (мин. +1)" }]],
      [12540, "i1", [{ level: 15, dice: "4к6" }]],
      [12540, "i2", [{ level: 15, dice: "4к6" }]],
    ];
    for (const [id, fx, st] of steps) {
      if (applySteps(id, fx, st)) touched++;
    }
    const notes: [number, string, string][] = [
      [15791, "С 9 уровня (Взрывная пушка) урон +1к8 — поправьте куб вручную.", "С 9 уровня (Взрывная пушка) урон 3к8 — считается сам."],
      [15792, "С 9 уровня (Взрывная пушка) урон +1к8 — поправьте куб вручную.", "С 9 уровня (Взрывная пушка) урон 3к8 — считается сам."],
      [15793, "С 9 уровня +1к8 — поправьте куб вручную.", "С 9 уровня +1к8 — считается сам."],
    ];
    for (const [id, from, to] of notes) {
      if (unmanual(id, from, to)) touched++;
    }

    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(LEVEL_DICE_KEY);
  });
  run();
  if (touched > 0) console.log(`[db] Кубы от уровня: записей: ${touched}`);
}

export function migrateDndArtificerTouchups(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(TOUCHUPS_KEY);
  if (done) return;

  let touched = 0;
  const run = database.transaction(() => {
    const get = database.prepare("SELECT id, description FROM compendium_entries WHERE id = ?");
    const setDesc = database.prepare("UPDATE compendium_entries SET description = ? WHERE id = ?");
    const append = (id: number, tail: string): void => {
      const row = get.get(id) as { id: number; description: string | null } | undefined;
      if (!row || (row.description ?? "").includes(tail)) return;
      setDesc.run(`${row.description ?? ""}\n\n${tail}`, id);
      touched++;
    };
    // Разрыв жертвой атаки (Боевая готовность / Дополнительная атака 5 ур.).
    append(
      15794,
      "С 5 уровня: вместо одной из атак действием Атака можно приказать защитнику совершить Силовой разрыв (без бонусного действия)."
    );
    // Апгрейд гиганта 15 ур. (Идеальный доспех, дредноут).
    append(
      15796,
      "С 15 уровня (дредноут): урон разрушителя 2к6, досягаемость стана +10, размер до Огромного, Преимущество на проверки и спасброски Силы — поправьте вручную."
    );
    // Шапка строки 6 таблицы умений.
    const art = database.prepare("SELECT id, data FROM compendium_entries WHERE id = 12812").get() as
      | { id: number; data: string }
      | undefined;
    if (art) {
      try {
        const data = JSON.parse(art.data || "{}") as {
          progression?: { rows?: Record<string, string>[] };
        };
        const rows = data.progression?.rows;
        const r6 = Array.isArray(rows) ? rows.find((r) => r.c1 === "6") : undefined;
        if (r6 && r6.c3 !== "Магический мастеровой") {
          r6.c3 = "Магический мастеровой";
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = 12812").run(JSON.stringify(data));
          touched++;
        }
      } catch {
        // Битый JSON — не наша авария.
      }
    }
    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(TOUCHUPS_KEY);
  });
  run();
  if (touched > 0) console.log(`[db] Мелочи текстов артефактора: ${touched}`);
}

export function migrateDndArtificerMasterworker(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MASTERWORK_KEY);
  if (done) return;

  let inserted = 0;

  const run = database.transaction(() => {
    const exists = database.prepare("SELECT id FROM compendium_entries WHERE parent_id = ? AND name = ?");
    const art = database
      .prepare(
        `SELECT e.id, e.system_id, e.section_id FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Артефактор'`
      )
      .all() as { id: number; system_id: number; section_id: number }[];
    const maxPos = database.prepare(
      "SELECT COALESCE(MAX(position), -1) AS m FROM compendium_entries WHERE parent_id = ?"
    );
    const insert = database.prepare(
      `INSERT INTO compendium_entries
        (system_id, section_id, parent_id, kind, name, level, data, description, position, uid)
       VALUES (?, ?, ?, 'feature', ?, 6, ?, ?, ?, ?)`
    );
    const add = (
      parentId: number,
      systemId: number,
      sectionId: number,
      name: string,
      data: Record<string, unknown>,
      description: string
    ): void => {
      if (exists.get(parentId, name)) return;
      const pos = (maxPos.get(parentId) as { m: number }).m + 1;
      insert.run(systemId, sectionId, parentId, name, JSON.stringify(data), description, pos, randomUUID());
      inserted++;
    };

    for (const a of art) {
      const classRow = database.prepare("SELECT id FROM compendium_entries WHERE id = ?").get(a.id) as
        | { id: number }
        | undefined;
      if (!classRow) continue;
      add(
        a.id,
        a.system_id,
        a.section_id,
        "Зарядка магического предмета",
        {
          casting_timing: "Бонусное действие",
          checks: [],
          effects: [],
          cost: { kind: "none", slotSpend: true },
        },
        "Бонусным действием коснитесь созданной репликами заряжаемой вещи в пределах 5 футов и потратьте ячейку 1+ круга: предмет восстанавливает зарядов по уровню ячейки. Тратьте ячейку кнопкой ниже, заряды правьте в строке предмета."
      );
      add(
        a.id,
        a.system_id,
        a.section_id,
        "Поглощение магического предмета",
        {
          casting_timing: "Бонусное действие",
          checks: [],
          effects: [],
          cost: { kind: "uses", amount: 1, per: "long_rest", ownResource: true, slotReturn: true },
        },
        "Бонусным действием коснитесь созданной репликами вещи в пределах 5 футов и развейте её (уберите строку из инвентаря): верните ячейку 1 круга за обычную, 2 круга за необычную/редкую. Раз в долгий отдых."
      );
      add(
        a.id,
        a.system_id,
        a.section_id,
        "Преобразование магического предмета",
        {
          casting_timing: "Действие",
          checks: [],
          effects: [],
          cost: { kind: "uses", amount: 1, per: "long_rest", ownResource: true },
        },
        "Действием Магия коснитесь созданной репликами вещи в пределах 5 футов: станет другим предметом по известной схеме. Раз в долгий отдых. Сам обмен — через блок реплик (создать новый, убрать старый)."
      );
    }

    // Родитель — текстовая справка: тайминг снимаем, чтобы «Действия» не
    // двоили бонусную строку (текст остаётся в списке особенностей).
    const parent = database.prepare("SELECT id, data FROM compendium_entries WHERE id = 12537").get() as
      | { id: number; data: string }
      | undefined;
    if (parent) {
      try {
        const d = JSON.parse(parent.data || "{}") as Record<string, unknown>;
        if (d.casting_timing != null) {
          delete d.casting_timing;
          delete d.casting_timing_other;
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = 12537").run(JSON.stringify(d));
        }
      } catch {
        // Битый JSON — не наша авария.
      }
    }

    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(MASTERWORK_KEY);
  });

  run();
  if (inserted > 0) console.log(`[db] Мастеровой-6: новых строк: ${inserted}`);
}
