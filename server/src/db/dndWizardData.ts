import type { Database } from "better-sqlite3";

/**
 * Данные для мобильного визарда (гриллинг 2026-09-24, Q7, Q10, Q26).
 *
 * - `standard_array` у класса — раскладка стандартного массива из PHB 2024:
 *   визард кладёт её сразу при выборе класса, а не СИЛ→ХАР по порядку.
 * - Воин: набор B лежал только текстом (визард показывал «11 ЗМ» без вещей),
 *   варианта C (155 ЗМ) не было вовсе.
 * - Инструменты «на ваш выбор» — моделью, а не строкой «добрать на листе»:
 *   `tool_kind` у предметов, `tool_choice` у класса и предыстории,
 *   `equipment_<x>_choices` у наборов. Строки, которые модель заменяет,
 *   убираются: иначе выбор лёг бы на лист дважды — числом и текстом.
 *
 * Дописывается только пустое, кроме явно заменяемых строк выше.
 */

const MIGRATION_KEY = "dnd_wizard_data_seeded";

type Json = Record<string, unknown>;

export interface WizardDataChange {
  id: number;
  name: string;
  what: string[];
}

const MUSICAL = "Музыкальный инструмент";
const GAMING = "Игровой набор";
const ARTISAN = "Ремесленные инструменты";

// PHB 2024, «Стандартный массив» в описании каждого класса: СИЛ ЛОВ ТЕЛ ИНТ МДР ХАР.
const STANDARD_ARRAYS: Record<string, number[]> = {
  Варвар: [15, 13, 14, 10, 12, 8],
  Бард: [8, 14, 12, 13, 10, 15],
  Жрец: [14, 8, 13, 10, 15, 12],
  Друид: [8, 12, 14, 13, 15, 10],
  Воин: [15, 14, 13, 8, 10, 12],
  Монах: [12, 15, 13, 10, 14, 8],
  Паладин: [15, 10, 13, 8, 12, 14],
  Следопыт: [12, 15, 13, 8, 14, 10],
  Плут: [12, 15, 13, 14, 10, 8],
  Чародей: [10, 13, 14, 8, 12, 15],
  Колдун: [8, 14, 13, 12, 10, 15],
  Волшебник: [8, 12, 13, 15, 14, 10],
};
const KEYS = ["str", "dex", "con", "int", "wis", "cha"];

const TOOL_KINDS: Record<string, string[]> = {
  [MUSICAL]: ["Барабан", "Виола да гамба", "Волынка", "Дульцимер", "Лира", "Лютня", "Рожок", "Флейта", "Флейта Пана", "Шалмей", "Бандура", "Цистра", "Яртинг"],
  [GAMING]: ["Драконьи шахматы", "Игральные карты", "Кости", "Ставка трёх драконов"],
};

// Строка владения предыстории → выбор.
const BACKGROUND_TOOLS: Record<string, string> = {
  "1 игровой набор на ваш выбор": GAMING,
  "Игровой набор (по выбору)": GAMING,
  "Ремесленные инструменты (по выбору)": ARTISAN,
  "1 из инструментов ремесленника на ваш выбор": ARTISAN,
  "1 музыкальный инструмент на ваш выбор": MUSICAL,
  "Музыкальный инструмент (по выбору)": MUSICAL,
};

// Строка набора → выбор. `fromProficiency` — «тот, владение которым выбрали».
const MANUAL_CHOICES: Record<string, Json> = {
  "музыкальный инструмент по вашему выбору": { count: 1, group: MUSICAL },
  "Ремесленные инструменты (выбранные)": { count: 1, group: ARTISAN, fromProficiency: true },
  "Инструменты ремесленника (выбранные вами)": { count: 1, group: ARTISAN, fromProficiency: true },
  "инструменты ремесленника или музыкальный инструмент, владение которыми вы выбрали ранее": {
    count: 1,
    group: `${ARTISAN}|${MUSICAL}`,
    fromProficiency: true,
  },
};

// Классы: владение «на выбор» строкой в tool_profs → выбор.
const CLASS_TOOL_CHOICES: Record<string, { drop: string; choice: Json }> = {
  Бард: { drop: "", choice: { count: 3, group: MUSICAL } },
  Монах: { drop: "Ремесленные или музыкальные инструменты", choice: { count: 1, group: `${ARTISAN}|${MUSICAL}` } },
  Артефактор: { drop: "Ремесленные инструменты", choice: { count: 1, group: ARTISAN } },
  Кулачник: { drop: "Игровой набор", choice: { count: 1, group: GAMING } },
};

const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function parse(raw: string | null): Json {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Json) : {};
  } catch {
    return {};
  }
}

export function planDndWizardData(database: Database, opts: { dryRun: boolean }): WizardDataChange[] {
  const changes: WizardDataChange[] = [];
  const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
  const byKind = database.prepare("SELECT id, name, data FROM compendium_entries WHERE kind = ?");
  const equipmentId = (name: string) =>
    (database.prepare("SELECT id FROM compendium_entries WHERE kind = 'equipment' AND name = ?").get(name) as { id: number } | undefined)?.id ??
    null;

  const each = (kind: string, fn: (name: string, data: Json) => string[]) => {
    for (const row of byKind.all(kind) as { id: number; name: string; data: string }[]) {
      const data = parse(row.data);
      const what = fn(row.name, data);
      if (!what.length) continue;
      changes.push({ id: row.id, name: row.name, what });
      if (!opts.dryRun) update.run(JSON.stringify(data), row.id);
    }
  };

  const manualToChoices = (data: Json, what: string[]) => {
    for (const slot of ["a", "b", "c"]) {
      // Обобщённый предмет «Музыкальный инструмент» / «Игровой набор» в наборе
      // предыстории — по PHB 2024 тот же, владение которым выбрано.
      const items = data[`equipment_${slot}_items`];
      if (Array.isArray(items) && empty(data[`equipment_${slot}_choices`])) {
        const generic = (items as { name?: string }[]).filter((it) => it?.name === MUSICAL || it?.name === GAMING);
        if (generic.length) {
          data[`equipment_${slot}_items`] = (items as { name?: string }[]).filter((it) => !generic.includes(it));
          data[`equipment_${slot}_choices`] = generic.map((it) => ({ count: 1, group: it.name, fromProficiency: true }));
          what.push(`набор ${slot.toUpperCase()}: «${generic.map((g) => g.name).join("», «")}» → выбор`);
        }
      }
      const manual = data[`equipment_${slot}_manual`];
      if (!Array.isArray(manual)) continue;
      const choices = manual.filter((m): m is string => typeof m === "string" && m in MANUAL_CHOICES);
      if (!choices.length || !empty(data[`equipment_${slot}_choices`])) continue;
      data[`equipment_${slot}_choices`] = choices.map((m) => MANUAL_CHOICES[m]);
      data[`equipment_${slot}_manual`] = manual.filter((m) => !choices.includes(m as string));
      what.push(`набор ${slot.toUpperCase()}: «${choices.join("», «")}» → выбор`);
    }
  };

  each("class", (name, data) => {
    const what: string[] = [];
    const arr = STANDARD_ARRAYS[name];
    if (arr && empty(data.standard_array)) {
      data.standard_array = Object.fromEntries(KEYS.map((k, i) => [k, arr[i]]));
      what.push(`standard_array: ${arr.join(" ")}`);
    }
    const tools = CLASS_TOOL_CHOICES[name];
    if (tools && empty(data.tool_choice)) {
      data.tool_choice = tools.choice;
      if (tools.drop && Array.isArray(data.tool_profs)) {
        data.tool_profs = (data.tool_profs as { name?: string }[]).filter((t) => t?.name !== tools.drop);
      }
      what.push(`tool_choice: ${JSON.stringify(tools.choice)}${tools.drop ? `, без «${tools.drop}»` : ""}`);
    }
    if (name === "Воин") {
      if (empty(data.equipment_b_items)) {
        const want: [string, number][] = [
          ["Проклёпанная кожа", 1],
          ["Скимитар", 1],
          ["Короткий меч", 1],
          ["Длинный лук", 1],
          ["Стрелы", 20],
          ["Колчан", 1],
          ["Набор исследователя подземелий", 1],
        ];
        const items = want.flatMap(([n, qty]) => {
          const id = equipmentId(n);
          return id == null ? [] : [{ entryId: id, name: n, qty }];
        });
        if (items.length) {
          data.equipment_b_items = items;
          what.push(`equipment_b_items: ${items.length} предметов`);
        }
      }
      if (empty(data.equipment_c_gold)) {
        data.equipment_c_gold = "155";
        what.push("equipment_c_gold: 155");
      }
    }
    manualToChoices(data, what);
    return what;
  });

  each("background", (_name, data) => {
    const what: string[] = [];
    const group = typeof data.tools === "string" ? BACKGROUND_TOOLS[data.tools] : undefined;
    if (group && empty(data.tool_choice)) {
      what.push(`tools «${data.tools}» → tool_choice ${group}`);
      data.tool_choice = { count: 1, group };
      data.tools = "";
    }
    manualToChoices(data, what);
    return what;
  });

  each("equipment", (name, data) => {
    if (!empty(data.tool_kind)) return [];
    const kind =
      Object.entries(TOOL_KINDS).find(([, names]) => names.includes(name))?.[0] ??
      (data.category === ARTISAN ? ARTISAN : undefined);
    if (!kind) return [];
    data.tool_kind = kind;
    return [`tool_kind: ${kind}`];
  });

  return changes;
}

export function migrateDndWizardData(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;
  database.transaction(() => {
    planDndWizardData(database, { dryRun: false });
    database.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))").run(MIGRATION_KEY);
  })();
}
