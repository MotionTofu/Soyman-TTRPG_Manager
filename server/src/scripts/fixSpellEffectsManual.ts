// Точечные правки после migrateSpellEffects: те два десятка заклинаний, где
// старые поля были заполнены не тем, чем назывались, и автоматический разбор
// честно сдался. Каждая правка описана явно и печатается при выполнении.
//
//   npx tsx src/scripts/fixSpellEffectsManual.ts          — отчёт
//   npx tsx src/scripts/fixSpellEffectsManual.ts --apply  — записать
//
// Повторный запуск безопасен: правка ищет заклинание по имени и переписывает
// его effects целиком, а не дописывает.

import { db } from "../db/db";

const APPLY = process.argv.includes("--apply");

type Json = Record<string, unknown>;

interface Fix {
  /** Начало названия записи — полные имена несут английский хвост в скобках. */
  name: string;
  why: string;
  apply(data: Json): void;
}

const COND_PRONE = { id: 1813, name: "Опрокинут" };
const DMG_COLD = { id: 4437, name: "Холодный" };
const DMG_NECROTIC = { id: 4439, name: "Некротический" };

let counter = 0;
const id = (p: string) => `${p}f${(counter += 1).toString(36)}`;

const FIXES: Fix[] = [
  {
    name: "Намасливание",
    why: "в поле урона лежало состояние, а не урон",
    apply(d) {
      const checkId = (d.checks as { id: string }[])[0]?.id ?? null;
      d.effects = [{ id: id("e"), type: "condition", when: "save_fail", checkId, condition: COND_PRONE }];
    },
  },
  {
    name: "Доспех Агатиса",
    why: "урон без броска, равен временным хитам заклинания",
    apply(d) {
      d.effects = [
        { id: id("e"), type: "temp_hp", when: "always", checkId: null, dice: "5", upcastPerLevel: "5" },
        {
          id: id("e"),
          type: "damage",
          when: "always",
          checkId: null,
          dice: "5",
          damageType: DMG_COLD,
          upcastPerLevel: "5",
          text: "атакующему в ближнем бою, пока держатся временные хиты",
        },
      ];
    },
  },
  {
    name: "Шилейла",
    why: "«к8» — потеряно количество костей; рост идёт по кости оружия, не прибавкой",
    apply(d) {
      const checkId = (d.checks as { id: string }[])[0]?.id ?? null;
      d.effects = [
        {
          id: id("e"),
          type: "damage",
          when: "hit",
          checkId,
          dice: "1к8",
          text: "кость оружия становится 1к10 на 5-м, 1к12 на 11-м и 2к6 на 17-м уровне",
        },
      ];
    },
  },
  {
    name: "Погребальный звон",
    why: "1к8 и 1к12 — альтернативы, а не два урона подряд",
    apply(d) {
      const checkId = (d.checks as { id: string }[])[0]?.id ?? null;
      d.effects = [
        {
          id: id("e"),
          type: "damage",
          when: "save_fail",
          checkId,
          dice: "1к8",
          damageType: DMG_NECROTIC,
          text: "если у цели все хиты целы",
          cantripScaling: "1к8",
        },
        {
          id: id("e"),
          type: "damage",
          when: "save_fail",
          checkId,
          dice: "1к12",
          damageType: DMG_NECROTIC,
          text: "если цель уже ранена",
          cantripScaling: "1к12",
        },
      ];
    },
  },
  {
    name: "Благословение",
    why: "«1к4 к спасброскам и атакам» — модификатор броска, не лечение",
    apply(d) {
      d.effects = [
        {
          id: id("e"),
          type: "roll_modifier",
          when: "always",
          checkId: null,
          modifier: "+1к4",
          text: "к спасброскам и броскам атаки",
        },
      ];
    },
  },
  {
    name: "Щит веры",
    why: "«+2 к КЗ» — защита, не лечение",
    apply(d) {
      d.effects = [{ id: id("e"), type: "defense", when: "always", checkId: null, text: "+2 к КЗ" }];
    },
  },
  {
    name: "Добряника",
    why: "«1 хп» — это лечение, просто без костей",
    apply(d) {
      d.effects = [
        { id: id("e"), type: "heal", when: "always", checkId: null, dice: "1", text: "за одну ягоду" },
      ];
    },
  },
  {
    name: "Вспышка мечей",
    why: "шаг заговора не вычленился из текста",
    apply(d) {
      const effects = d.effects as Json[];
      if (effects[0]) effects[0].cantripScaling = "1к6";
    },
  },
  {
    name: "Маскировка",
    why: "по правилам 5.5 концентрации не требует — флаг стоял ошибочно",
    apply(d) {
      d.concentration = false;
    },
  },
  {
    name: "Языки",
    why: "по правилам 5.5 концентрации не требует — флаг стоял ошибочно",
    apply(d) {
      d.concentration = false;
    },
  },
];

function run(): void {
  const rows = db
    .prepare("SELECT id, name, data FROM compendium_entries WHERE kind = 'spell'")
    .all() as { id: number; name: string; data: string }[];

  const updates: { id: number; data: string }[] = [];
  for (const fix of FIXES) {
    const row = rows.find((r) => r.name.startsWith(fix.name));
    if (!row) {
      console.log(`  ПРОПУЩЕНО  ${fix.name} — запись не найдена`);
      continue;
    }
    const data = JSON.parse(row.data || "{}") as Json;
    fix.apply(data);
    updates.push({ id: row.id, data: JSON.stringify(data) });
    console.log(`  ${row.name}\n      ${fix.why}`);
  }

  if (!APPLY) {
    console.log(`\nСухой прогон: ${updates.length} правок готовы, база не изменена. Для записи — --apply.`);
    return;
  }
  const stmt = db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
  db.transaction((list: typeof updates) => {
    for (const u of list) stmt.run(u.data, u.id);
  })(updates);
  console.log(`\nЗаписано: ${updates.length}.`);
}

run();
