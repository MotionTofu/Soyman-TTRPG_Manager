// Схема формата system-import/1 — см. docs/system-import/format.md.
//
// Здесь только форма: типы полей, допустимые значения перечислений, префиксы
// ключей. Смысловые проверки (ссылки в никуда, дубли ключей, эффект без
// своего броска) живут в systemValidate.ts — им нужен файл целиком.
//
// Всё, кроме `format`, `system` и ключей, необязательно: модель, которая не
// нашла поле в источнике, должна его пропустить, а не выдумывать, и один
// пропуск не должен ронять импорт целой главы.

import { z } from "zod";

const text = z.string().default("");
const optionalText = z.string().optional();

/**
 * Оригинальное название и синонимы записи компендиума. По ним ищут поиск
 * (`search.ts`) и главы бестиария при записи в справочник системы
 * (`compendium.ts`). Раньше оригинал вклеивался прямо в имя
 * («Нимблрайт [Nimblewright]») — теперь он живёт отдельной колонкой.
 */
const nameOriginal = optionalText;
// Без значения по умолчанию: «поля нет» и «поле пусто» — разное. Первое
// значит «не трогай прежнее» при повторном импорте главы, второе — «синонимов
// нет» (очистить список).
const aliases = z.array(z.string()).optional();

const key = (prefix: string) =>
  z
    .string()
    .min(prefix.length + 1, `ключ должен быть длиннее префикса «${prefix}»`)
    .refine((k) => k.startsWith(prefix), `ключ должен начинаться с «${prefix}»`);

/** Ссылка на чужой ключ. Существование проверяется в systemValidate.ts. */
const ref = z.string().min(1);

// Промпт просит незаполненное не писать, но модели прилежно пишут "" в
// значении «нет ссылки» — и целая глава отвергалась из-за пустой строки.
const optionalRef = z.preprocess(
  (v) => (typeof v === "string" && !v.trim() ? undefined : v),
  ref.nullish()
);
const refs = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((x) => typeof x !== "string" || x.trim()) : v),
  z.array(ref).default([])
);

/** Ссылка с количеством — содержимое набора, стартовое снаряжение. */
const refWithQty = z.object({
  ref,
  qty: z.number().int().positive().default(1),
});

/** Ссылка с дистанцией — чувства и скорости вида. */
const refWithDistance = z.object({
  ref,
  distance: optionalText,
});

export const ABILITY_NAMES = [
  "Сила",
  "Ловкость",
  "Телосложение",
  "Интеллект",
  "Мудрость",
  "Харизма",
] as const;

export const CASTING_TIMINGS = ["Действие", "Бонусное действие", "Реакция", "Иное"] as const;

export const EFFECT_TYPES = [
  "damage",
  "heal",
  "temp_hp",
  "condition",
  "condition_remove",
  "movement",
  "zone",
  "summon",
  "transform",
  "create_object",
  "roll_modifier",
  "defense",
  "special",
] as const;

export const EFFECT_WHEN = ["always", "hit", "miss", "save_fail", "save_success"] as const;

export const PROGRESSION_ROLES = [
  "",
  "level",
  "prof_bonus",
  "features",
  "cantrips",
  "prepared",
  "slot1",
  "slot2",
  "slot3",
  "slot4",
  "slot5",
  "slot6",
  "slot7",
  "slot8",
  "slot9",
  "slots_packed",
  "pact_slots",
  "pact_level",
  "resource",
  "stat",
] as const;

const checkSchema = z.object({
  /** Локален внутри одной записи; на него ссылаются её эффекты. */
  id: z.string().min(1),
  type: z.enum(["attack", "save"]),
  attack_range: z.enum(["melee", "ranged"]).optional(),
  save_ability: z.enum(ABILITY_NAMES).optional(),
  dc_override: z.number().int().optional(),
});

const effectSchema = z.object({
  type: z.enum(EFFECT_TYPES),
  when: z.enum(EFFECT_WHEN).default("always"),
  /** Ссылка на `id` броска этой же записи. */
  check: optionalText,
  dice: optionalText,
  // Ссылка на mech.-запись типа урона либо строка "choice", когда тип
  // выбирается при накладывании (Хроматический шар).
  damage_type: optionalText,
  half_on_success: z.boolean().optional(),
  upcast_per_level: optionalText,
  cantrip_scaling: optionalText,
  condition: optionalRef,
  movement_kind: z.enum(["push", "pull", "teleport", "speed"]).optional(),
  distance: optionalText,
  zone_shape: optionalText,
  zone_size: optionalText,
  modifier: optionalText,
  text: optionalText,
});

const costSchema = z.object({
  kind: z.enum(["none", "spell_slot", "resource", "uses", "hit_dice"]).default("none"),
  amount: z.number().int().optional(),
  per: z.enum(["short_rest", "long_rest", "day"]).optional(),
});

/** Общая часть всего, что можно «применить»: заклинание, умение, черта. */
const activatable = {
  casting_timing: z.enum(CASTING_TIMINGS).optional(),
  casting_timing_other: optionalText,
  checks: z.array(checkSchema).default([]),
  effects: z.array(effectSchema).default([]),
  cost: costSchema.optional(),
};

export const mechanicSchema = z.object({
  key: key("mech."),
  group: z.string().min(1),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  description: text,
});

export const spellSchema = z.object({
  key: key("spell."),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  // Круг необязателен: глава со списками заклинаний класса дописывает
  // доступность к тому, что в компендиуме уже есть, и повторять там уровень
  // каждого из ста заклинаний незачем. Пустой круг ничего не затирает.
  level: z.number().int().min(0).max(9).optional(),
  school: optionalRef,
  range: optionalText,
  duration: optionalText,
  // Без значения по умолчанию: «поля нет» и «поле false» — разное. Первое
  // значит «не трогай прежнее», второе — «ритуалом не является».
  ritual: z.boolean().optional(),
  concentration: z.boolean().optional(),
  components: z
    .object({ v: z.boolean().default(false), s: z.boolean().default(false), m: optionalText })
    .optional(),
  // Ссылка на класс — «есть в списке класса»; ссылка на подкласс с
  // grant_level — «выдаётся всегда подготовленным с этого уровня».
  classes: z
    .array(z.object({ ref, grant_level: z.number().int().positive().optional() }))
    .default([]),
  description: text,
  ...activatable,
});

const featureSchema = z.object({
  key: key("feature."),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  level: z.number().int().min(0).max(20).optional(),
  description: text,
  ...activatable,
});

const progressionSchema = z.object({
  columns: z.array(z.object({ label: text, role: z.enum(PROGRESSION_ROLES).default("") })).default([]),
  /** Строка — значения по порядку колонок. */
  rows: z.array(z.array(z.string())).default([]),
});

const equipmentSetSchema = z.object({
  items: z.array(refWithQty).default([]),
  gold: optionalText,
  /** Исходный текст набора: в нём живёт то, чего нет в компендиуме. */
  text: optionalText,
});

const startingEquipmentSchema = z.object({
  a: equipmentSetSchema.optional(),
  b: equipmentSetSchema.optional(),
});

const subclassSchema = z.object({
  key: key("sub."),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  description: text,
  features: z.array(featureSchema).default([]),
});

export const classSchema = z.object({
  key: key("class."),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  short_description: optionalText,
  hit_die: optionalText,
  primary_abilities: z.array(z.enum(ABILITY_NAMES)).default([]),
  spellcasting_ability: z.enum(ABILITY_NAMES).optional(),
  saving_throws: z.array(z.enum(ABILITY_NAMES)).default([]),
  subclass_level: z.number().int().min(1).max(20).optional(),
  weapon_profs: refs,
  armor_profs: refs,
  tool_profs: refs,
  skill_choice_count: z.number().int().min(0).optional(),
  skill_choice_options: z.array(z.string()).default([]),
  starting_equipment: startingEquipmentSchema.optional(),
  progression: progressionSchema.optional(),
  features: z.array(featureSchema).default([]),
  subclasses: z.array(subclassSchema).default([]),
  options: z
    .object({ title: text, entries: z.array(featureSchema).default([]) })
    .optional(),
  description: text,
});

export const speciesSchema = z.object({
  key: key("species."),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  size: z.enum(["Крошечный", "Маленький", "Средний", "Большой", "Огромный", "Громадный"]).optional(),
  size_choice: z.boolean().default(false),
  creature_type: optionalRef,
  senses: z.array(refWithDistance).default([]),
  speeds: z.array(refWithDistance).default([]),
  granted_spells: z
    .array(z.object({ ref, grant_level: z.number().int().positive().default(1) }))
    .default([]),
  features: z.array(featureSchema).default([]),
  description: text,
});

export const backgroundSchema = z.object({
  key: key("bg."),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  abilities: z.array(z.enum(ABILITY_NAMES)).default([]),
  origin_feat: optionalRef,
  skills: z.array(z.string()).default([]),
  // Инструменты предыстории книга пишет то строкой, то списком («Набор для
  // грима»); в компендиуме это одно текстовое поле.
  tools: z.preprocess((v) => (Array.isArray(v) ? v.join(", ") : v), optionalText),
  starting_equipment: startingEquipmentSchema.optional(),
  description: text,
});

export const featSchema = z.object({
  key: key("feat."),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  category: optionalText,
  prerequisite: optionalText,
  description: text,
  ...activatable,
});

export const equipmentSchema = z.object({
  key: key("eq."),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  category: optionalText,
  cost: optionalText,
  weight: optionalText,
  damage: optionalText,
  properties: refs,
  mastery: optionalRef,
  attack_melee: z.boolean().optional(),
  attack_ranged: z.boolean().optional(),
  armor_type: optionalText,
  ac: optionalText,
  max_dex_bonus: optionalText,
  str_requirement: optionalText,
  stealth_disadvantage: z.boolean().optional(),
  /** Прибавляется ли к КД модификатор Ловкости (лёгкий и средний доспех). */
  dex_bonus: z.boolean().optional(),
  ability: optionalText,
  usage: optionalText,
  /** Содержимое набора снаряжения. */
  contents: z.array(refWithQty).default([]),
  description: text,
});

export const magicItemSchema = z.object({
  key: key("item."),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  item_type: optionalText,
  rarity: optionalText,
  // «Настройка заклинателем» — тоже настройка: в компендиуме это флажок, а
  // кем именно, сказано в описании предмета.
  attunement: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().length > 0 : v),
    z.boolean().default(false)
  ),
  // Цена предмета — не то же, что `cost` из activatable (чем оплачивается
  // применение), поэтому названа иначе: иначе одно поле затирало другое.
  price: optionalText,
  classes: refs,
  ac_bonus: optionalText,
  description: text,
  ...activatable,
});

export const monsterSchema = z.object({
  key: key("mon."),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  description: text,
  /** Статблок формы dnd_creature — та же, что в adventure-import/1. */
  statblock: z.record(z.string(), z.unknown()).optional(),
});

export const systemImportFileSchema = z.object({
  format: z.literal("system-import/1"),
  language: z.string().default("ru"),
  system: z.object({
    /** Долговечный ключ системы: по нему повторный импорт находит цель. */
    key: z.string().min(1),
    name: z.string().min(1),
    description: text,
  }),
  source: z.object({ title: optionalText, part: optionalText }).optional(),
  mechanics: z.array(mechanicSchema).default([]),
  spells: z.array(spellSchema).default([]),
  classes: z.array(classSchema).default([]),
  species: z.array(speciesSchema).default([]),
  backgrounds: z.array(backgroundSchema).default([]),
  feats: z.array(featSchema).default([]),
  equipment: z.array(equipmentSchema).default([]),
  magic_items: z.array(magicItemSchema).default([]),
  monsters: z.array(monsterSchema).default([]),
});

export type SystemImportFile = z.infer<typeof systemImportFileSchema>;
export type ImportSpell = z.infer<typeof spellSchema>;
export type ImportClass = z.infer<typeof classSchema>;
export type ImportFeature = z.infer<typeof featureSchema>;
export type ImportEquipment = z.infer<typeof equipmentSchema>;

/** Префикс ключа → раздел компендиума, в который он превратится. */
export const SYSTEM_KEY_PREFIX_TO_KIND: Record<string, string> = {
  "mech.": "mechanic_item",
  "spell.": "spell",
  "class.": "class",
  "sub.": "subclass",
  "feature.": "feature",
  "species.": "species",
  "bg.": "background",
  "feat.": "feat",
  "eq.": "equipment",
  "item.": "magic_item",
  "mon.": "monster",
};

export function systemPrefixOf(entryKey: string): string | null {
  const prefix = Object.keys(SYSTEM_KEY_PREFIX_TO_KIND).find((p) => entryKey.startsWith(p));
  return prefix ?? null;
}
