// Прогон импортёра книг правил на игрушечном файле — проверяет ровно то, ради
// чего он и делался: повторный импорт того же ключа правит запись, а не
// заводит вторую, а откат возвращает прежнее.
//
//   DB_DIR=<пустая папка> npx tsx src/scripts/testSystemImport.ts
//
// Пишет в базу, поэтому запускать только на отдельной папке, не на рабочей.

import { db } from "../db/db";
import { validateSystemImport } from "../import/systemValidate";
import { applySystemImport, knownSystemKeys, rollbackSystemBatch } from "../import/systemApply";

const file = {
  format: "system-import/1",
  language: "ru",
  system: { key: "dnd-5.5-test", name: "Тестовая система", description: "" },
  source: { title: "Книга игрока", part: "проба" },
  mechanics: [
    { key: "mech.damage.fire", group: "Типы урона", name: "Огонь", description: "" },
    { key: "mech.cond.prone", group: "Состояния", name: "Сбитый с ног", description: "" },
    { key: "mech.school.evocation", group: "Школы магии", name: "Воплощение", description: "" },
    { key: "mech.wprof.simple", group: "Владения оружием", name: "Простое оружие", description: "" },
  ],
  equipment: [
    { key: "eq.dagger", name: "Кинжал", category: "Оружие", cost: "2 зм", damage: "1к4 колющего", attack_melee: true },
  ],
  spells: [
    {
      key: "spell.burning-hands",
      name: "Горящие руки",
      level: 1,
      school: "mech.school.evocation",
      range: "Конус 15 футов",
      duration: "Мгновенная",
      casting_timing: "Действие",
      classes: [{ ref: "class.wizard" }, { ref: "sub.wizard.evocation", grant_level: 3 }],
      checks: [{ id: "s1", type: "save", save_ability: "Ловкость" }],
      effects: [
        {
          type: "damage",
          when: "save_fail",
          check: "s1",
          dice: "3к6",
          damage_type: "mech.damage.fire",
          half_on_success: true,
          upcast_per_level: "1к6",
        },
      ],
      cost: { kind: "spell_slot" },
      description: "Из пальцев вырывается пламя.",
    },
  ],
  classes: [
    {
      key: "class.wizard",
      name: "Волшебник",
      hit_die: "к6",
      primary_abilities: ["Интеллект"],
      spellcasting_ability: "Интеллект",
      saving_throws: ["Интеллект", "Мудрость"],
      subclass_level: 3,
      weapon_profs: ["mech.wprof.simple"],
      starting_equipment: { a: { items: [{ ref: "eq.dagger", qty: 2 }], gold: "5", text: "2 кинжала и 5 ЗМ" } },
      progression: {
        columns: [
          { label: "Уровень", role: "level" },
          { label: "Бонус владения", role: "prof_bonus" },
          { label: "Заговоры", role: "cantrips" },
          { label: "1", role: "slot1" },
        ],
        rows: [
          ["1", "+2", "3", "2"],
          ["2", "+2", "3", "3"],
        ],
      },
      features: [
        {
          key: "feature.wizard.arcane-recovery",
          name: "Магическое восстановление",
          level: 1,
          casting_timing: "Иное",
          casting_timing_other: "короткий отдых",
          effects: [{ type: "special", when: "always", text: "Возвращает ячейки" }],
          description: "Восстанавливает ячейки, потраченные на [[spell.burning-hands|Горящие руки]] и [[spell.unknown|Неведомое]].",
        },
      ],
      subclasses: [{ key: "sub.wizard.evocation", name: "Воплотитель", description: "", features: [] }],
      description: "",
    },
  ],
  species: [],
  backgrounds: [],
  feats: [],
  magic_items: [],
  monsters: [],
};

function show(title: string): void {
  console.log(`\n=== ${title} ===`);
}

const first = validateSystemImport(file);
show("проверка");
console.log("ok:", first.ok, "ошибок:", first.errors.length, "предупреждений:", first.warnings.length);
for (const e of first.errors) console.log("  ошибка:", e.path, "—", e.message);
for (const w of first.warnings) console.log("  предупреждение:", w.path, "—", w.message);
if (!first.ok || !first.data) process.exit(1);

show("первый импорт");
const applied = applySystemImport(first.data, { systemId: null, fileName: "проба.json" });
console.log(applied.counts, "система:", applied.systemId);

const systemId = applied.systemId;
const countEntries = () =>
  (db.prepare("SELECT COUNT(*) c FROM compendium_entries WHERE system_id = ?").get(systemId) as { c: number }).c;
console.log("записей в компендиуме:", countEntries());

const spell = db
  .prepare(
    `SELECT e.name, e.level, e.data, e.description FROM compendium_entries e
     JOIN system_import_keys k ON k.entry_id = e.id WHERE k.key = 'spell.burning-hands'`
  )
  .get() as { name: string; level: number; data: string; description: string };
console.log("заклинание:", spell.name, "круг", spell.level);
console.log("  data:", spell.data);

const subclass = db
  .prepare(
    `SELECT e.name, e.data FROM compendium_entries e
     JOIN system_import_keys k ON k.entry_id = e.id WHERE k.key = 'sub.wizard.evocation'`
  )
  .get() as { name: string; data: string };
console.log("подкласс:", subclass.name, "→", subclass.data);

const cls = db
  .prepare(
    `SELECT e.data FROM compendium_entries e
     JOIN system_import_keys k ON k.entry_id = e.id WHERE k.key = 'class.wizard'`
  )
  .get() as { data: string };
console.log("класс:", cls.data);

show("упоминания в тексте");
const feat = db
  .prepare(
    `SELECT e.description FROM compendium_entries e
     JOIN system_import_keys k ON k.entry_id = e.id WHERE k.key = 'feature.wizard.arcane-recovery'`
  )
  .get() as { description: string };
console.log(feat.description);
console.log(
  /\[\[compendium_entry:\d+\|Горящие руки\]\]/.test(feat.description) &&
    !feat.description.includes("[[spell.")
    ? "  ОК: ключ стал ссылкой, неизвестный — обычным текстом"
    : "  ПРОВАЛ: упоминание не разобрано"
);
console.log("предупреждения:", applied.warnings.map((w) => `${w.path}: ${w.message}`));

show("ручная правка между импортами");
const spellId = (
  db.prepare("SELECT entry_id FROM system_import_keys WHERE key = 'spell.burning-hands'").get() as {
    entry_id: number;
  }
).entry_id;
const handEdited = JSON.parse(spell.data);
handEdited.upcast = "дописано руками";
db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(handEdited), spellId);

show("повторный импорт того же файла");
const second = validateSystemImport(
  { ...file, spells: [{ ...file.spells[0], name: "Горящие руки [Burning Hands]", range: "Конус 5 метров" }] },
  knownSystemKeys(systemId)
);
console.log("ok:", second.ok, "ошибок:", second.errors.length);
const applied2 = applySystemImport(second.data!, { systemId, fileName: "проба-2.json" });
console.log(applied2.counts);
console.log("записей в компендиуме:", countEntries(), "(должно остаться столько же)");
const after = db.prepare("SELECT name, data FROM compendium_entries WHERE id = ?").get(spellId) as {
  name: string;
  data: string;
};
console.log("имя после правки:", after.name);
console.log("  дальность обновилась:", JSON.parse(after.data).range);
console.log("  ручное поле уцелело:", JSON.parse(after.data).upcast);

show("глава, упоминающая класс мельком");
// Так устроены настоящие книги: глава с подклассами повторяет класс одним
// ключом и именем. Раньше это стирало у класса кость хитов, владения и всё
// остальное, что заполнила первая глава.
const slim = validateSystemImport(
  {
    ...file,
    spells: [],
    equipment: [],
    mechanics: [],
    classes: [
      {
        key: "class.wizard",
        name: "Волшебник",
        description: "",
        features: [],
        subclasses: [{ key: "sub.wizard.abjuration", name: "Ограждающий", description: "", features: [] }],
      },
    ],
  },
  knownSystemKeys(systemId)
);
console.log("ok:", slim.ok, "ошибок:", slim.errors.length);
const applied3 = applySystemImport(slim.data!, { systemId, fileName: "проба-3.json" });
const clsAfter = JSON.parse(
  (
    db
      .prepare(
        `SELECT e.data FROM compendium_entries e
         JOIN system_import_keys k ON k.entry_id = e.id WHERE k.key = 'class.wizard'`
      )
      .get() as { data: string }
  ).data
);
console.log("кость хитов:", clsAfter.hit_die, "| спасброски:", clsAfter.saving_throws);
console.log("владения оружием:", clsAfter.weapon_profs?.length, "| строк в таблице:", clsAfter.progression?.rows?.length);
console.log(
  clsAfter.hit_die === "к6" && clsAfter.saving_throws?.length === 2 && clsAfter.progression?.rows?.length === 2
    ? "  ОК: мельком упомянутый класс ничего не стёр"
    : "  ПРОВАЛ: данные класса затёрты"
);
rollbackSystemBatch(applied3.batchId);

show("откат второго импорта");
console.log(rollbackSystemBatch(applied2.batchId));
const rolled = db.prepare("SELECT name, data FROM compendium_entries WHERE id = ?").get(spellId) as {
  name: string;
  data: string;
};
console.log("имя вернулось:", rolled.name, "| дальность:", JSON.parse(rolled.data).range);
console.log("записей в компендиуме:", countEntries());

show("откат первого импорта");
console.log(rollbackSystemBatch(applied.batchId));
console.log("записей в компендиуме:", countEntries(), "(должно стать 0)");
console.log(
  "система осталась:",
  db.prepare("SELECT COUNT(*) c FROM systems WHERE id = ?").get(systemId)
);
