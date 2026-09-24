import type { Database } from "better-sqlite3";

/**
 * Выдачи черт (гриллинг черт 2026-09-24, Q1–Q27).
 *
 * До этого из 160 черт что-то выдавали 25. У остальных числа и владения
 * жили только в тексте: +1 к характеристике у ~90 черт, владения доспехами,
 * спасбросок «Устойчивого», скорость, сопротивления, заклинания «Затронутых»
 * и меток. «Крепкий» считался листом по имени.
 *
 * Поля (читает client/src/components/dnd/dndGrants.ts):
 * - `ability_increase` {options, amount, max} — +1 (у даров потолок 30);
 * - `save_from_ability` — спасбросок той же характеристики («Устойчивый»);
 * - `armor_profs`, `weapon_profs` — владения строками; `tool_profs` — {id,name};
 * - `skill_or_expertise`, `expertise_choice`, `all_skills`, `mastery_choice`;
 * - `spell_list_choice` — список «Посвящённого»; `spell_list_from` — список
 *   берётся у другой черты («Знаток магии»);
 * - `spell_ability_choice` — Инт/Мдр/Хар на выбор; `spell_ability_from_increase` —
 *   та, что получила +1 («Затронутые»);
 * - `granted_spells[]` c `freeCast`, `grantLevel` (уровень персонажа),
 *   `slotCircle` («Адепты»: когда есть ячейки круга);
 * - `spell_choices[]` c `freeCast`, `ritual`, `countFrom: "pb"`;
 * - эффекты `hit_points`, `resistance`, скорость (`movement`/`speed` c `flat`),
 *   кость безоружного, урон тяжёлым оружием;
 * - у предыстории — `origin_feat_list` (Послушник → Жрец и т. п.).
 *
 * Дописывается только пустое: поле, которое уже заполнено (руками в
 * справочнике или прошлой миграцией), не трогается. Заклинания и классы
 * ищутся по имени при прогоне — id в разных базах разные.
 */

const MIGRATION_KEY = "dnd_feat_data_seeded";

type Json = Record<string, unknown>;
type Key = "str" | "dex" | "con" | "int" | "wis" | "cha";

const ANY: Key[] = ["str", "dex", "con", "int", "wis", "cha"];
const MENTAL: Key[] = ["int", "wis", "cha"];
const SD: Key[] = ["str", "dex"];

export interface FeatDataChange {
  id: number;
  name: string;
  what: string[];
}

/** Заклинание по английскому имени: русские переводы расходятся с текстом черт. */
interface SpellRef {
  en: string;
  freeCast?: boolean;
  grantLevel?: number;
  slotCircle?: number;
}

interface Choice {
  count?: number;
  level: number;
  classes?: string[];
  schools?: string[];
  freeCast?: boolean;
  ritual?: boolean;
  countFrom?: "pb";
  ability?: Key;
}

interface Spec {
  asi?: Key[];
  asiMax?: number;
  saveFromAbility?: boolean;
  armor?: string[];
  weapons?: string[];
  tools?: string[];
  skillOrExpertise?: { count: number; options: string[] };
  skillChoice?: number;
  expertise?: number;
  allSkills?: boolean;
  mastery?: number;
  spellListChoice?: string[];
  spellListFrom?: string;
  spellAbilityChoice?: boolean;
  spellAbilityFromIncrease?: boolean;
  grants?: SpellRef[];
  choices?: Choice[];
  /** Заменить уже лежащие spell_choices («Посвящённый»: список выбирается отдельно). */
  replaceChoices?: boolean;
  hpPerLevel?: number;
  hpFlat?: number;
  speed?: number;
  resist?: string[];
  resistOptions?: { options: string[]; count: number };
  unarmedDie?: string;
  heavyDamagePb?: boolean;
  senses?: { name: string; distance: string }[];
  pools?: { key: string; label: string; max: string | number; recharge: "long" | "short" }[];
}

const ADEPT = (spells: string[]): Spec => ({
  asi: MENTAL,
  grants: spells.map((en, i) => ({ en, slotCircle: i + 1 })),
});

const MARK = (spells: SpellRef[], extra: Spec = {}): Spec => ({ spellAbilityChoice: true, grants: spells, ...extra });

const FEATS: Record<string, Spec> = {
  // ── Черты происхождения ─────────────────────────────────────────────
  "Посвящённый в магию": {
    spellListChoice: ["Жрец", "Друид", "Волшебник"],
    spellAbilityChoice: true,
    replaceChoices: true,
    choices: [
      { count: 2, level: 0 },
      { count: 1, level: 1, freeCast: true },
    ],
  },
  Крепкий: { hpPerLevel: 2 },
  Драчун: { unarmedDie: "1к4" },
  "Мистическая перегрузка": {
    spellAbilityChoice: true,
    grants: [{ en: "Fire Bolt" }],
    pools: [{ key: "surge", label: "Всплеск мощи", max: 1, recharge: "long" }],
  },
  "Мистические знамения": {
    spellAbilityChoice: true,
    grants: [{ en: "Guidance" }],
    pools: [{ key: "omen", label: "Благоприятное предчувствие", max: "prof_bonus", recharge: "long" }],
  },
  "Мистический гробовщик": {
    spellAbilityChoice: true,
    choices: [{ count: 1, level: 0, classes: ["Жрец", "Волшебник"], schools: ["Некромантия"] }],
    pools: [{ key: "death", label: "Понимание смерти", max: 1, recharge: "long" }],
  },
  "Мистический лазутчик": {
    spellAbilityChoice: true,
    grants: [{ en: "Friends" }],
    pools: [{ key: "dodge", label: "Хитрое отвлечение", max: "prof_bonus", recharge: "long" }],
  },
  "Мистический оберег": {
    spellAbilityChoice: true,
    grants: [{ en: "Resistance" }],
    pools: [{ key: "resist", label: "Сопротивление бонусным действием", max: "prof_bonus", recharge: "long" }],
  },
  "Мистический художник": {
    spellAbilityChoice: true,
    grants: [{ en: "Minor Illusion" }],
    pools: [{ key: "inspire", label: "Вдохновляющая магия", max: 1, recharge: "long" }],
  },
  "Мистическое красноречие": { spellAbilityChoice: true, grants: [{ en: "Vicious Mockery" }] },
  "Портальный странник": {
    resistOptions: { options: ["Некротическая энергия", "Психическая энергия", "Излучение"], count: 1 },
    pools: [{ key: "step", label: "Портальный шаг", max: "prof_bonus", recharge: "long" }],
  },
  "Преобразованная анатомия": {
    speed: 5,
    pools: [{ key: "hardy", label: "Стойкая анатомия", max: "prof_bonus", recharge: "long" }],
  },
  "Фамильяр-друг": {
    spellAbilityChoice: true,
    grants: [{ en: "Find Familiar", freeCast: true }],
    pools: [{ key: "helper", label: "Друг-помощник", max: "prof_bonus", recharge: "long" }],
  },

  // ── Универсальные черты ─────────────────────────────────────────────
  "Адепт Воплощения": ADEPT(["Chromatic Orb", "Shatter", "Fireball", "Vitriolic Sphere", "Wall of Force"]),
  "Адепт Иллюзии": ADEPT(["Silent Image", "Phantasmal Force", "Major Image", "Hallucinatory Terrain", "Seeming"]),
  "Адепт Некромантии": ADEPT(["Inflict Wounds", "Ray of Enfeeblement", "Vampiric Touch", "Blight", "Raise Dead"]),
  "Адепт Ограждения": ADEPT(["Shield", "Lesser Restoration", "Protection from Energy", "Banishment", "Mass Cure Wounds"]),
  "Адепт Очарования": ADEPT(["Dissonant Whispers", "Enthrall", "Hold Person", "Dominate Beast", "Modify Memory"]),
  "Адепт Преобразования": ADEPT(["Jump", "Spider Climb", "Slow", "Polymorph", "Animate Objects"]),
  "Адепт Призыва": ADEPT(["Entangle", "Misty Step", "Conjure Animals", "Dimension Door", "Conjure Elemental"]),
  "Адепт Прорицания": ADEPT(["Detect Evil and Good", "Mind Spike", "Clairvoyance", "Divination", "Scrying"]),
  "Адепт стихий": { asi: MENTAL },
  Актёр: { asi: ["cha"] },
  Атлет: { asi: SD },
  "Благодатный фамильяр": { asi: ANY },
  "Боевой заклинатель": { asi: MENTAL },
  "Большая аберрантная метка": { asi: ["con"] },
  "Большая метка гостеприимства": { asi: ANY },
  "Большая метка исцеления": { asi: ANY },
  "Большая метка обнаружения": { asi: ANY },
  "Большая метка охраны": {
    asi: ANY,
    pools: [{ key: "ward", label: "Улучшенная охрана", max: "prof_bonus", recharge: "long" }],
  },
  "Большая метка письма": { asi: ANY },
  "Большая метка поиска": { asi: ANY },
  "Большая метка пути": { asi: ANY },
  "Большая метка стража": { asi: ANY },
  "Большая метка творения": { asi: ANY },
  "Большая метка тени": { asi: ANY },
  "Большая метка ухода": {
    asi: ANY,
    pools: [{ key: "tame", label: "Укрощение животного", max: "prof_bonus", recharge: "long" }],
  },
  "Большая метка шторма": { asi: ANY },
  Бомбардир: { asi: ["dex"] },
  Борец: { asi: SD },
  "Верховой боец": { asi: ["str", "dex", "wis"] },
  "Владение воинским оружием": { asi: SD, weapons: ["Воинское оружие"] },
  Возмездие: { asi: ANY, pools: [{ key: "smite", label: "Сияющий удар", max: 1, recharge: "short" }] },
  "Воинственный фамильяр": { asi: ANY },
  "Воодушевляющий лидер": { asi: ["wis", "cha"] },
  "Восхитительная боль": { asi: ANY, pools: [{ key: "flesh", label: "Огрубевшая плоть", max: 1, recharge: "short" }] },
  Гниение: { asi: ANY, pools: [{ key: "rot", label: "Некроз", max: 1, recharge: "short" }] },
  "Затронутый тенью": {
    asi: MENTAL,
    spellAbilityFromIncrease: true,
    grants: [{ en: "Invisibility", freeCast: true }],
    choices: [{ count: 1, level: 1, schools: ["Иллюзия", "Некромантия"], freeCast: true }],
  },
  "Затронутый феями": {
    asi: MENTAL,
    spellAbilityFromIncrease: true,
    grants: [{ en: "Misty Step", freeCast: true }],
    choices: [{ count: 1, level: 1, schools: ["Прорицание", "Очарование"], freeCast: true }],
  },
  "Знаток лёгких доспехов": { asi: SD, armor: ["Лёгкие доспехи", "Щиты"] },
  "Знаток магии": {
    asi: MENTAL,
    spellListFrom: "Посвящённый в магию",
    choices: [
      { count: 1, level: 1, freeCast: true },
      { count: 1, level: 2, freeCast: true },
    ],
  },
  "Знаток средних доспехов": { asi: SD, armor: ["Средние доспехи"] },
  "Знаток тяжёлых доспехов": { asi: ["con", "str"], armor: ["Тяжёлые доспехи"] },
  "Использование двух оружий": { asi: SD },
  "Коварное обаяние": {
    asi: MENTAL,
    spellAbilityFromIncrease: true,
    grants: [{ en: "Charm Person", freeCast: true }],
  },
  Кровожадность: {
    asi: ["str", "dex", "con"],
    pools: [{ key: "feast", label: "Кровавый пир", max: "prof_bonus", recharge: "long" }],
  },
  Крушитель: { asi: ["str", "con"] },
  "Магическая уловка": { asi: MENTAL },
  "Мастер большого оружия": { asi: ["str"], heavyDamagePb: true },
  "Мастер древкового оружия": { asi: SD },
  "Мастер оружия": { asi: SD, mastery: 1 },
  "Мастер средних доспехов": { asi: SD },
  "Мастер тяжёлых доспехов": { asi: ["con", "str"] },
  "Мастер щитов": { asi: ["str"] },
  "Меткий заклинатель": { asi: MENTAL },
  "Меткий стрелок": { asi: ["dex"] },
  "Могущественная драконья метка": { asi: MENTAL },
  Наблюдательный: { asi: ["int", "wis"], skillOrExpertise: { count: 1, options: ["Проницательность", "Анализ", "Внимательность"] } },
  Налётчик: { asi: SD },
  "Оборонительный дуэлянт": { asi: ["dex"] },
  "Острый ум": { asi: ["int"], skillOrExpertise: { count: 1, options: ["Аркана", "История", "Анализ", "Природа", "Религия"] } },
  "Отмеченный вампиром": {
    asi: MENTAL,
    spellAbilityFromIncrease: true,
    grants: [{ en: "Spider Climb", freeCast: true }],
    choices: [{ count: 1, level: 1, schools: ["Иллюзия", "Очарование"], freeCast: true }],
  },
  Отравитель: { asi: ["dex", "int"], tools: ["Набор отравителя"] },
  Подвижный: { asi: ["dex", "con"], speed: 10 },
  "Потусторонний фамильяр": { asi: ANY },
  "Приторные туманы": {
    asi: MENTAL,
    spellAbilityFromIncrease: true,
    grants: [{ en: "Fog Cloud", freeCast: true }],
  },
  Пронзатель: { asi: SD },
  Проныра: { asi: ["dex"], senses: [{ name: "Слепое зрение", distance: "10" }] },
  "Ритуальный заклинатель": {
    asi: MENTAL,
    spellAbilityFromIncrease: true,
    choices: [{ level: 1, ritual: true, countFrom: "pb" }],
    pools: [{ key: "quick", label: "Быстрый ритуал", max: 1, recharge: "long" }],
  },
  Рубака: { asi: SD },
  Светоносец: { asi: MENTAL, spellAbilityFromIncrease: true, grants: [{ en: "Light" }] },
  "Сопротивление заклинаниям": {
    asi: ["dex", "con"],
    resistOptions: { options: ["Некротическая энергия", "Психическая энергия", "Излучение", "Звуковой"], count: 1 },
    pools: [{ key: "magic", label: "Сопротивление магии", max: "prof_bonus", recharge: "long" }],
  },
  "Стихийный фамильяр": { asi: ANY },
  Стойкий: { asi: ["con"] },
  Страж: { asi: SD },
  Телекинетик: { asi: MENTAL, spellAbilityFromIncrease: true, grants: [{ en: "Mage Hand" }] },
  Телепат: {
    asi: MENTAL,
    spellAbilityFromIncrease: true,
    grants: [{ en: "Detect Thoughts", freeCast: true }],
  },
  "Убийца магов": { asi: SD, pools: [{ key: "mind", label: "Защищённый разум", max: 1, recharge: "short" }] },
  "Укус любовника": { asi: ANY, pools: [{ key: "bite", label: "Чарующая боль", max: 1, recharge: "short" }] },
  Устойчивый: { asi: ANY, saveFromAbility: true },
  "Шеф-повар": { asi: ["con", "wis"], tools: ["Инструменты повара"] },
  "Эксперт в арбалетах": { asi: ["dex"] },
  "Эксперт в навыке": { asi: ANY, skillChoice: 1, expertise: 1 },

  // ── Эпические черты и дары (потолок 30) ─────────────────────────────
  "Дар взрывной мощи заклинаний": { asi: MENTAL, asiMax: 30 },
  "Дар железного разума": { asi: ANY, asiMax: 30 },
  "Дар надвигающихся теней": { asi: ANY, asiMax: 30 },
  "Дар пылающей зари": { asi: ANY, asiMax: 30 },
  "Дар совершенного владения школой магии": { asi: MENTAL, asiMax: 30 },
  "Дар туманного бегства": { asi: MENTAL, asiMax: 30 },
  "Дар Сибериса": { asi: ANY, asiMax: 30 },
  "Дар боевой доблести": { asi: ANY, asiMax: 30 },
  "Дар восстановления": { asi: ANY, asiMax: 30 },
  "Дар восстановления чар": { asi: MENTAL, asiMax: 30 },
  "Дар духа ночи": { asi: ANY, asiMax: 30 },
  "Дар истинного зрения": { asi: ANY, asiMax: 30, senses: [{ name: "Истинное зрение", distance: "60" }] },
  "Дар межпространственного перемещения": { asi: ANY, asiMax: 30 },
  "Дар навыка": { asi: ANY, asiMax: 30, allSkills: true, expertise: 1 },
  "Дар непреодолимого нападения": { asi: ["dex", "str"], asiMax: 30 },
  "Дар скорости": { asi: ANY, asiMax: 30, speed: 30 },
  "Дар стойкости": { asi: ANY, asiMax: 30, hpFlat: 40 },
  "Дар судьбы": { asi: ANY, asiMax: 30 },
  "Дар устойчивости к энергиям": {
    asi: ANY,
    asiMax: 30,
    resistOptions: {
      options: ["Кислотный", "Холодный", "Огненный", "Электрический", "Некротическая энергия", "Ядовитый", "Психическая энергия", "Излучение", "Звуковой"],
      count: 2,
    },
  },

  // ── Драконьи метки (Эберрон) ────────────────────────────────────────
  "Аберрантная драконья метка": {
    choices: [
      { count: 1, level: 0, classes: ["Чародей"], ability: "con" },
      { count: 1, level: 1, classes: ["Чародей"], ability: "con", freeCast: true },
    ],
    pools: [{ key: "hardy", label: "Аберрантная стойкость", max: 1, recharge: "long" }],
  },
  "Метка гостеприимства": MARK([
    { en: "Purify Food and Drink", freeCast: true },
    { en: "Unseen Servant", freeCast: true },
    { en: "Calm Emotions", freeCast: true, grantLevel: 3 },
  ]),
  "Метка исцеления": MARK([
    { en: "Cure Wounds", freeCast: true },
    { en: "Lesser Restoration", freeCast: true, grantLevel: 3 },
  ]),
  "Метка обнаружения": MARK([
    { en: "Detect Magic", freeCast: true },
    { en: "Detect Poison and Disease", freeCast: true },
    { en: "See Invisibility", freeCast: true, grantLevel: 3 },
  ]),
  "Метка охраны": MARK([
    { en: "Alarm", freeCast: true },
    { en: "Mage Armor", freeCast: true },
    { en: "Arcane Lock", freeCast: true, grantLevel: 3 },
  ]),
  "Метка письма": MARK([
    { en: "Message" },
    { en: "Comprehend Languages", freeCast: true },
    { en: "Magic Mouth", freeCast: true, grantLevel: 3 },
  ]),
  "Метка поиска": MARK([
    { en: "Hunter's Mark", freeCast: true },
    { en: "Locate Object", freeCast: true, grantLevel: 3 },
  ]),
  "Метка пути": MARK([{ en: "Misty Step", freeCast: true }], { speed: 5 }),
  "Метка стража": MARK([{ en: "Shield", freeCast: true }], {
    pools: [{ key: "sentinel", label: "Бдительный страж", max: "prof_bonus", recharge: "long" }],
  }),
  "Метка творения": MARK([{ en: "Mending" }, { en: "Magic Weapon", freeCast: true }]),
  "Метка тени": MARK([{ en: "Minor Illusion" }, { en: "Invisibility", freeCast: true }]),
  "Метка ухода": MARK([
    { en: "Animal Friendship", freeCast: true },
    { en: "Speak with Animals", freeCast: true },
  ]),
  "Метка шторма": MARK([{ en: "Thunderclap" }, { en: "Gust of Wind", freeCast: true, grantLevel: 3 }], {
    resist: ["Электрический"],
  }),
};

// PHB 2024: у трёх предысторий «Посвящённый» со своим списком.
const BACKGROUND_LISTS: Record<string, string> = {
  Послушник: "Жрец",
  Мудрец: "Волшебник",
  Путешественник: "Друид",
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

export function planDndFeatData(database: Database, opts: { dryRun: boolean }): FeatDataChange[] {
  const changes: FeatDataChange[] = [];
  const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
  const spellByEn = database.prepare(
    // Апостроф в справочнике типографский («Hunter’s Mark»), в таблице — прямой.
    "SELECT id, name, name_original FROM compendium_entries WHERE kind = 'spell' AND replace(lower(name_original), '’', '''') = lower(?) ORDER BY id LIMIT 1"
  );
  const classByName = database.prepare("SELECT id FROM compendium_entries WHERE kind = 'class' AND name = ? ORDER BY id LIMIT 1");
  const featByName = database.prepare("SELECT id FROM compendium_entries WHERE kind = 'feat' AND name = ? ORDER BY id LIMIT 1");
  const equipmentByName = database.prepare(
    "SELECT id, name FROM compendium_entries WHERE kind = 'equipment' AND name = ? ORDER BY id LIMIT 1"
  );
  // Типы урона и чувства — пункты своих групп механик (как у редактора эффектов).
  const mechanic = database.prepare(
    `SELECT i.id, i.name FROM compendium_entries i JOIN compendium_entries g ON g.id = i.parent_id
      WHERE g.parent_id IS NULL AND g.name = ? AND i.name = ? ORDER BY i.id LIMIT 1`
  );
  const damageType = (name: string) => mechanic.get("Типы урона", name) as { id: number; name: string } | undefined;
  const sense = (name: string) =>
    (database
      .prepare("SELECT id, name FROM compendium_entries WHERE kind = 'mechanic_item' AND name = ? AND parent_id IS NOT NULL ORDER BY id LIMIT 1")
      .get(name) as { id: number; name: string } | undefined);
  const classId = (name: string) => (classByName.get(name) as { id: number } | undefined)?.id ?? null;

  const rows = database.prepare("SELECT id, kind, name, data FROM compendium_entries WHERE kind IN ('feat', 'background')").all() as {
    id: number;
    kind: string;
    name: string;
    data: string;
  }[];

  for (const row of rows) {
    const data = parse(row.data);
    const listWasEmpty = empty(data.spell_list_choice);
    const what: string[] = [];
    const set = (key: string, value: unknown, label = key) => {
      if (!empty(data[key])) return;
      data[key] = value;
      what.push(label);
    };

    if (row.kind === "background") {
      const list = BACKGROUND_LISTS[row.name];
      const id = list ? classId(list) : null;
      if (id != null) set("origin_feat_list", id, `origin_feat_list: ${list}`);
    } else {
      const spec = FEATS[row.name];
      if (!spec) continue;
      if (spec.asi) set("ability_increase", { options: spec.asi, amount: 1, max: spec.asiMax ?? 20 }, `+1 ${spec.asi.join("/")}`);
      if (spec.saveFromAbility) set("save_from_ability", true);
      if (spec.armor) set("armor_profs", spec.armor);
      if (spec.weapons) set("weapon_profs", spec.weapons);
      if (spec.tools) {
        const refs = spec.tools.map((n) => (equipmentByName.get(n) as { id: number; name: string } | undefined) ?? { id: null, name: n });
        set("tool_profs", refs, `tool_profs: ${spec.tools.join(", ")}`);
      }
      if (spec.skillOrExpertise) set("skill_or_expertise", spec.skillOrExpertise);
      if (spec.skillChoice) set("skill_choice_count", spec.skillChoice);
      if (spec.expertise) set("expertise_choice", spec.expertise);
      if (spec.allSkills) set("all_skills", true);
      if (spec.mastery) set("mastery_choice", spec.mastery);
      if (spec.spellListChoice) {
        const ids = spec.spellListChoice.map(classId).filter((id): id is number => id != null);
        if (ids.length) set("spell_list_choice", ids, `spell_list_choice: ${spec.spellListChoice.join("/")}`);
      }
      if (spec.spellListFrom) {
        const id = (featByName.get(spec.spellListFrom) as { id: number } | undefined)?.id;
        if (id != null) set("spell_list_from", id, `spell_list_from: ${spec.spellListFrom}`);
      }
      if (spec.spellAbilityChoice) set("spell_ability_choice", true);
      if (spec.spellAbilityFromIncrease) set("spell_ability_from_increase", true);

      if (spec.grants) {
        const refs = spec.grants.flatMap((g) => {
          const hit = spellByEn.get(g.en) as { id: number; name: string; name_original: string } | undefined;
          if (!hit) return [];
          return [
            {
              id: hit.id,
              name: hit.name,
              original: hit.name_original,
              outsideLimit: true,
              ...(g.freeCast ? { freeCast: true } : {}),
              ...(g.grantLevel ? { grantLevel: g.grantLevel } : {}),
              ...(g.slotCircle ? { slotCircle: g.slotCircle } : {}),
            },
          ];
        });
        const missing = spec.grants.length - refs.length;
        if (refs.length) set("granted_spells", refs, `granted_spells: ${refs.map((r) => r.name).join(", ")}${missing ? ` (не найдено: ${missing})` : ""}`);
      }
      if (spec.choices) {
        const choices = spec.choices.map((c) => ({
          count: c.count ?? 2,
          level: c.level,
          outsideLimit: true,
          classIds: (c.classes ?? []).map(classId).filter((id): id is number => id != null),
          schools: c.schools ?? [],
          ...(c.freeCast ? { freeCast: true } : {}),
          ...(c.ritual ? { ritual: true } : {}),
          ...(c.countFrom ? { countFrom: c.countFrom } : {}),
          ...(c.ability ? { ability: c.ability } : {}),
        }));
        // Старые варианты «Посвящённого» смешивали три списка — заменяются
        // один раз, вместе с появлением выбора списка.
        if (spec.replaceChoices && listWasEmpty) data.spell_choices = [];
        set("spell_choices", choices, `spell_choices: ${choices.length}`);
      }

      const effects = Array.isArray(data.effects) ? (data.effects as Json[]) : [];
      const addEffect = (id: string, effect: Json, label: string) => {
        if (effects.some((e) => e?.id === id)) return;
        effects.push({ id, when: "always", ...effect });
        what.push(label);
      };
      if (spec.hpPerLevel) addEffect("feat-hp", { type: "hit_points", perLevel: spec.hpPerLevel }, `хиты +${spec.hpPerLevel}/ур.`);
      if (spec.hpFlat) addEffect("feat-hp", { type: "hit_points", flat: spec.hpFlat }, `хиты +${spec.hpFlat}`);
      if (spec.speed) addEffect("feat-speed", { type: "movement", movementKind: "speed", flat: spec.speed }, `скорость +${spec.speed}`);
      for (const name of spec.resist ?? []) {
        const ref = damageType(name);
        if (ref) addEffect(`feat-resist-${ref.id}`, { type: "resistance", damageType: ref }, `сопротивление: ${name}`);
      }
      if (spec.resistOptions) {
        const options = spec.resistOptions.options.map(damageType).filter((r): r is { id: number; name: string } => !!r);
        addEffect(
          "feat-resist-choice",
          { type: "resistance", options, count: spec.resistOptions.count },
          `сопротивление на выбор: ${options.length}`
        );
      }
      if (spec.unarmedDie) {
        addEffect(
          "feat-unarmed",
          {
            type: "roll_modifier",
            modifier: spec.unarmedDie,
            appliesTo: "damage",
            weapon: "unarmed",
            dice: spec.unarmedDie,
            text: "1 на кости урона безоружного — перебросить",
          },
          `безоружный ${spec.unarmedDie}`
        );
      }
      if (spec.heavyDamagePb) {
        addEffect(
          "feat-heavy",
          {
            type: "roll_modifier",
            modifier: "бонус мастерства к урону",
            appliesTo: "damage",
            weapon: "heavy",
            proficiency: "full",
            toggleable: true,
            text: "частью действия Атака",
          },
          "урон тяжёлым +БМ"
        );
      }
      if (effects.length !== (Array.isArray(data.effects) ? data.effects.length : 0)) data.effects = effects;

      if (spec.senses) {
        const refs = spec.senses.flatMap((s) => {
          const ref = sense(s.name);
          return ref ? [{ id: ref.id, name: ref.name, distance: s.distance }] : [];
        });
        if (refs.length) set("senses", refs, `чувства: ${refs.map((r) => r.name).join(", ")}`);
      }
      if (spec.pools) set("resource_pools", spec.pools, `пулы: ${spec.pools.map((p) => p.label).join(", ")}`);
    }

    if (!what.length) continue;
    changes.push({ id: row.id, name: row.name, what });
    if (!opts.dryRun) update.run(JSON.stringify(data), row.id);
  }
  return changes;
}

export function migrateDndFeatData(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;
  database.transaction(() => {
    planDndFeatData(database, { dryRun: false });
    database.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))").run(MIGRATION_KEY);
  })();
}
