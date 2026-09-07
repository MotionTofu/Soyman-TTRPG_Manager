import type { Database } from "better-sqlite3";
import { randomUUID } from "crypto";

/**
 * Подкласс Реаниматор (6-й у Артефактора, из «Кузни Артефактора»).
 *
 * Схема как у остальных подклассов: запись kind=subclass под Артефактором +
 * дети-умения с уровнями (визард и лист подбирают их сами по parent_id/level,
 * отдельных веток кода не нужно). Механика — существующими средствами:
 * INT-пул оживляющего разряда (levelDice 11/17), пул+слот спутника, тело по
 * data.companion, строка замаха, бесплатное воскрешение 1/долгий.
 * Заклинания привязаны по оригиналам (переводы в книге и базе расходятся:
 * Поднятие мертвеца = Оживление мертвецов/Animate Dead, Возвращение к жизни
 * = Низшее воскрешение/Revivify).
 */

const MIGRATION_KEY = "artificer_reanimator_v1";

const ARTIFICER_ID = 12812;

const ELECTRIC = { id: 12489, name: "Электрический" };
const NECROTIC = { id: 12549, name: "Некротическая энергия" };

const GRANTS: { id: number; name: string; grantLevel: number }[] = [
  { id: 13238, name: "Ведьмин снаряд", grantLevel: 3 },
  { id: 13535, name: "Псевдожизнь", grantLevel: 3 },
  { id: 13031, name: "Уход за умирающим", grantLevel: 3 },
  { id: 13696, name: "Глухота/слепота", grantLevel: 5 },
  { id: 13908, name: "Улучшение характеристики", grantLevel: 5 },
  { id: 14000, name: "Молния", grantLevel: 9 },
  { id: 14020, name: "Оживление мертвецов", grantLevel: 9 },
  { id: 14168, name: "Защита от смерти", grantLevel: 13 },
  { id: 14284, name: "Усыхание", grantLevel: 13 },
  { id: 14008, name: "Низшее воскрешение", grantLevel: 17 },
];

interface Child {
  name: string;
  level: number;
  data: Record<string, unknown>;
  description: string;
}

const CHILDREN: Child[] = [
  {
    name: "Заклинания Реаниматора",
    level: 3,
    data: {},
    description:
      "Когда вы достигаете уровня Артефактора, указанного в таблице «Заклинания Реаниматора», у вас всегда будут подготовлены следующие заклинания: 3-й уровень — Ведьмин снаряд, Псевдожизнь, Уход за умирающим; 5-й уровень — Глухота/слепота, Улучшение характеристики; 9-й уровень — Молния, Поднятие мертвеца; 13-й уровень — Защита от смерти, Усыхание; 17-й уровень — Возвращение к жизни, Преграда жизни.",
  },
  {
    name: "Навыки реаниматора",
    level: 3,
    data: {
      casting_timing: "Иное",
      casting_timing_other: "на Уход за умирающим",
      checks: [{ id: "save1", type: "save", saveAbility: "Ловкость" }],
      effects: [
        { id: "i1", type: "heal", when: "always", dice: "ваш уровень Артефактора" },
        {
          id: "i2",
          type: "damage",
          when: "save_fail",
          checkId: "save1",
          dice: "2к4",
          damageType: ELECTRIC,
          halfOnSuccess: true,
          levelDice: [
            { level: 11, dice: "3к4" },
            { level: 17, dice: "4к4" },
          ],
        },
      ],
      cost: { kind: "uses", amount: 1, per: "long_rest", ownResource: true, maxAbility: "int" },
    },
    description:
      "**Оживляющий разряд.** Когда вы сотворяете Уход за умирающим, вы можете изменить его: цель восстанавливает Хиты в количестве, равном вашему уровню Артефактора, а каждое существо в исходящей от цели 10-футовой эманации совершает спасбросок Ловкости против СЛ ваших заклинаний: 2к4 урона Электричеством при провале, половина при успехе (11-й ур.: 3к4, 17-й ур.: 4к4). Мод INT раз за долгий отдых (мин. 1).\n\n**Инструменты реаниматора.** Вы получаете владение Инструментами алхимика (или другим ремесленным инструментом, если уже владеете).",
  },
  {
    name: "Реанимированный спутник",
    level: 3,
    data: {
      casting_timing: "Действие",
      checks: [],
      effects: [],
      cost: { kind: "uses", amount: 1, per: "long_rest", ownResource: true, slotSpend: true },
      companion: {
        name: "Реанимированный спутник",
        ac: "10+int",
        hp: "5+5*level",
        maxCount: 1,
        dismissable: true,
        actions: [
          { name: "Ужасающий замах", note: "атака заклинанием, 5 фт, 1к4 + INT некротическим; цель без провоцированных до её следующего хода" },
          { name: "Взрыв смерти", note: "при смерти: спас Лов, эманация 10 фт, 2к4 некротическим (9 ур.: 4к4)" },
          { name: "Поглощение электричества", note: "урон электричеством лечит вместо урона" },
        ],
      },
    },
    description:
      "Инструментами ремонтника (или ремесленными) действием Магия создайте спутника в свободном пространстве в 5 футах. Дружелюбен, подчиняется. Существует до долгого отдыха или отпустите действием Магия; смерть хозяина — смерть спутника (хиты в 0) со Взрывом смерти. Создав раз — повторно только за ячейку; одновременно один.\n\nВ бою ходит своим ходом? Нет: перемещается и реакция сам, действие — только Уклонение, пока бонусом не прикажете иное. Недееспособны вы — действует сам.",
  },
  {
    name: "Ужасающий замах",
    level: 3,
    data: {
      casting_timing: "Бонусное действие",
      checks: [{ id: "attack1", type: "attack", attackRange: "melee" }],
      effects: [
        {
          id: "i1",
          type: "damage",
          when: "hit",
          checkId: "attack1",
          dice: "1к4 + ваш модификатор Интеллекта",
          damageType: NECROTIC,
        },
      ],
    },
    description:
      "По вашей команде бонусным действием спутник бьёт: рукопашная атака заклинанием (бонус равен вашему), 5 футов. При попадании: 1к4 + мод INT некротического урона, цель не совершает провоцированные атаки до начала её следующего хода.",
  },
  {
    name: "Чуждые модификации",
    level: 5,
    data: {},
    description:
      "При каждом создании спутник получает ОДИН вариант на ваш выбор. **Магический проводник:** творите как из пространства спутника (своими чувствами); раз в ход +INT к одному броску урона заклинания Артефактора школ Воплощения/Некромантии, если спутник в 120 футах. **Свирепость:** кость Ужасающего замаха — 1к6.",
  },
  {
    name: "Улучшенная реанимация",
    level: 9,
    data: {},
    description:
      "Урон Взрыва смерти — 4к4. Наносимый спутником некротический урон игнорирует сопротивление.",
  },
  {
    name: "Ужасные модификации",
    level: 9,
    data: {},
    description:
      "При создании спутник получает ДВА варианта (вместо одного), выбирать можно и из новых. **Раздутый:** Большой размер; попадание замахом по существу Большому или меньше — толчок до 10 футов; +INT к урону Взрыва смерти. **Тощий:** скорость 45, лазание = скорости (включая потолки); существо по вашему выбору, начинающее ход в эманации 10 фт — спас Мудрости против вашей СЛ, иначе Испуганный до начала своего следующего хода. **Влажный:** плавание = скорости, протискивается в 1 дюйм; атакующий в пределах 10 футов при попадании получает урон Кислотой = ваш INT.",
  },
  {
    name: "Отточенная реанимация",
    level: 15,
    data: {},
    description:
      "**Облегчённое воскрешение** — отдельной строкой ниже. **Перекачивание жизни:** когда получаете урон, Реакцией восстановите хитов = текущим хитам спутника; спутник умирает (0 хитов) со Взрывом смерти. **Совершенные модификации:** при создании спутник получает ТРИ варианта.",
  },
  {
    name: "Облегчённое воскрешение",
    level: 15,
    data: {
      casting_timing: "Действие",
      checks: [],
      effects: [],
      cost: { kind: "uses", amount: 1, per: "long_rest", ownResource: true },
    },
    description:
      "Сотворите Возвращение к жизни без ячейки и материальных компонентов (фокус — инструменты ремонтника/ремесленные). Раз в долгий отдых.",
  },
];

export function migrateDndArtificerReanimator(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;

  let created = 0;
  const run = database.transaction(() => {
    const art = database.prepare(
      `SELECT e.id, e.system_id FROM compendium_entries e
         JOIN system_sections s ON s.id = e.section_id
        WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Артефактор'`
    ).all() as { id: number; system_id: number }[];
    if (art.length === 0) {
      database.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))").run(MIGRATION_KEY);
      return;
    }
    const findSub = database.prepare(
      "SELECT id FROM compendium_entries WHERE parent_id = ? AND kind = 'subclass' AND name = 'Реаниматор'"
    );
    const findChild = database.prepare("SELECT id FROM compendium_entries WHERE parent_id = ? AND name = ?");
    const maxPos = database.prepare(
      "SELECT COALESCE(MAX(position), -1) AS m FROM compendium_entries WHERE parent_id = ?"
    );
    const insert = database.prepare(
      `INSERT INTO compendium_entries
        (system_id, section_id, parent_id, kind, name, name_original, level, data, description, position, uid)
       VALUES (?, 97, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const a of art) {
      let sub = findSub.get(a.id) as { id: number } | undefined;
      let subId: number;
      if (sub) {
        subId = sub.id;
      } else {
        const pos = (maxPos.get(a.id) as { m: number }).m + 1;
        const info = insert.run(
          a.system_id, a.id, "subclass", "Реаниматор", "", null,
          JSON.stringify({ granted_spells: GRANTS }), "", pos, randomUUID()
        );
        subId = Number(info.lastInsertRowid);
        created++;
      }
      // Гранты — слиянием: недостающие дописываем, существующие не трогаем.
      const subRow = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(subId) as { data: string };
      const subData = JSON.parse(subRow.data || "{}") as { granted_spells?: { id: number }[] };
      const have = new Set((subData.granted_spells ?? []).map((g) => g.id));
      const missingGrants = GRANTS.filter((g) => !have.has(g.id));
      // Описания подкласса нет в источнике отдельно — короткий flavour.
      const subDesc = database.prepare("SELECT description FROM compendium_entries WHERE id = ?").get(subId) as { description: string | null };
      if (!subDesc.description) {
        database.prepare("UPDATE compendium_entries SET description = ? WHERE id = ?").run(
          "Пересобирайте трупы и поднимайте мёртвых. Реаниматоры сшивают слуг из разрозненных тел и превращают некромантию в пугающую науку.",
          subId
        );
      }
      if (missingGrants.length > 0) {
        // Проверяем, что заклинания существуют (иначе grant висит в пустоту).
        const live = missingGrants.filter(
          (g) => (database.prepare("SELECT id FROM compendium_entries WHERE id = ?").get(g.id) as unknown) != null
        );
        if (live.length > 0) {
          subData.granted_spells = [...(subData.granted_spells ?? []), ...live];
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(subData), subId);
        }
      }
      for (const [i, c] of CHILDREN.entries()) {
        if (findChild.get(subId, c.name)) continue;
        insert.run(a.system_id, subId, "feature", c.name, "", c.level, JSON.stringify(c.data), c.description, i, randomUUID());
        created++;
      }
    }
    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(MIGRATION_KEY);
  });
  run();
  if (created > 0) console.log(`[db] Реаниматор: создано записей: ${created}`);
}
