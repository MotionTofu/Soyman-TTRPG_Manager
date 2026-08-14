// Config that drives the per-system compendium. The unit of customization is
// the content *kind* (class / spell / item / …), not the system — so adding a
// new system reuses these same kinds without new code.

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "select";
  options?: string[]; // required when type === "select"
}

export interface KindDef {
  label: string; // singular label for one entry of this kind
  hasLevel?: boolean; // entries carry a `level` (features, spells)
  fields: FieldDef[]; // structured data.* fields shown in the editor
  // What child kinds can be added under an entry of this kind, with the verb
  // shown on the "+ добавить X" button.
  childKinds?: { kind: string; label: string }[];
}

// Kinds a *section* (tab) can be. Determines the kind of its top-level entries.
export const SECTION_KINDS: { value: string; label: string }[] = [
  { value: "wiki", label: "Текст (свободные записи)" },
  { value: "class", label: "Классы" },
  { value: "spell", label: "Заклинания" },
  { value: "item", label: "Предметы" },
  { value: "species", label: "Виды" },
  { value: "feat", label: "Черты" },
  { value: "background", label: "Предыстории" },
  { value: "monster", label: "Бестиарий" },
  { value: "mechanics", label: "Справочник" },
  { value: "equipment", label: "Базовое снаряжение" },
  { value: "magic_item", label: "Магические предметы" },
];

// The fixed reference lists auto-seeded into a section's "Общее"
// subsection when that section is set to kind "mechanics". Species entries
// pick their creature type / senses / speeds from three of these lists.
export const MECHANICS_GROUPS = [
  "Типы существ и их особенности",
  "Особое восприятие",
  "Скорости передвижения и их особенности",
  "Типы урона",
  "Языки",
  "Владения инструментами",
  "Владения доспехами",
  "Владения оружием",
  "Особые владения",
  "Школы магии",
  "Свойства оружия",
  "Мастерство оружия",
  "Мировоззрение",
] as const;

export const MECHANICS_CREATURE_TYPE_GROUP = MECHANICS_GROUPS[0];
export const MECHANICS_SENSES_GROUP = MECHANICS_GROUPS[1];
export const MECHANICS_SPEED_GROUP = MECHANICS_GROUPS[2];
export const MECHANICS_TOOL_GROUP = MECHANICS_GROUPS[5];
export const MECHANICS_ARMOR_GROUP = MECHANICS_GROUPS[6];
export const MECHANICS_WEAPON_GROUP = MECHANICS_GROUPS[7];
export const MECHANICS_SCHOOL_GROUP = MECHANICS_GROUPS[9];
export const MECHANICS_WEAPON_PROPERTIES_GROUP = MECHANICS_GROUPS[10];
export const MECHANICS_WEAPON_MASTERY_GROUP = MECHANICS_GROUPS[11];
export const MECHANICS_ALIGNMENT_GROUP = MECHANICS_GROUPS[12];

export const FEAT_CATEGORIES = [
  "Черта происхождения",
  "Универсальная Черта",
  "Тёмный Дар",
  "Боевой Стиль",
  "Эпический дар",
] as const;

export const ABILITY_SCORES = ["Сила", "Ловкость", "Телосложение", "Интеллект", "Мудрость", "Харизма"] as const;

export const EQUIPMENT_CATEGORIES = [
  "Оружие",
  "Доспехи",
  "Наборы снаряжения",
  "Фокусировка",
  "Инструменты",
  "Ремесленные инструменты",
  "Материалы",
  "Расходники",
  "Безделушки",
  "Прочие предметы",
] as const;

// Безделушка — не магический предмет, а раздел снаряжения, поэтому она живёт
// в EQUIPMENT_CATEGORIES, а не здесь.
export const MAGIC_ITEM_TYPES = [
  "Доспехи",
  "Жезлы",
  "Зелья",
  "Кольца",
  "Оружие",
  "Палочки",
  "Посохи",
  "Чудесные предметы",
  "Щиты",
] as const;

export const ARMOR_TYPES = ["Лёгкий", "Средний", "Тяжёлый"] as const;

export const CREATURE_SIZES = [
  "Крошечный",
  "Маленький",
  "Средний",
  "Большой",
  "Огромный",
  "Громадный",
] as const;

export const CHALLENGE_RATINGS = [
  "0", "1/8", "1/4", "1/2",
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
] as const;

export const MAGIC_ITEM_RARITIES = [
  "Обычный",
  "Необычный",
  "Редкий",
  "Очень редкий",
  "Легендарный",
  "Артефакт",
  "Варьируется",
] as const;

// Предмет сокровищницы бывает двух родов: магический (у него есть редкость и
// настройка) и обычное снаряжение (у него их нет). От выбора зависит список
// типов — те же списки, что и в одноимённых разделах компендиума.
export const ITEM_CLASSES = [
  { value: "magic_item", label: "Магический предмет" },
  { value: "equipment", label: "Обычное снаряжение" },
] as const;

/**
 * Типы предмета для выбранного рода. Пока род не выбран (и у старых записей,
 * заведённых до разделения) отдаётся объединённый список — иначе уже
 * проставленный тип пропал бы из выпадающего списка.
 */
export function itemTypeOptions(itemClass: string | null | undefined): string[] {
  if (itemClass === "magic_item") return [...MAGIC_ITEM_TYPES];
  if (itemClass === "equipment") return [...EQUIPMENT_CATEGORIES];
  return [...new Set([...MAGIC_ITEM_TYPES, ...EQUIPMENT_CATEGORIES])];
}

export const KIND_DEFS: Record<string, KindDef> = {
  wiki: { label: "Запись", fields: [] },
  class: {
    label: "Класс",
    fields: [
      { key: "short_description", label: "Короткое описание", type: "text" },
      { key: "hit_die", label: "Кость хитов", type: "text" },
      // На каком уровне класса выбирается подкласс. В 5.5 это 3 у всех, но
      // держим полем, а не константой: в других системах и в самодельных
      // классах бывает иначе, а зашивать правило в код — ровно то, от чего
      // компендиум и уводит.
      { key: "subclass_level", label: "Подкласс выбирается на уровне", type: "text" },
      // When non-empty, the class gets a third collapsible child list (after
      // Умения/Подклассы) with this title — e.g. Колдун's "Таинственные
      // воззвания" or Артефактор's "Схемы магических предметов". Its entries
      // are kind "class_option".
      { key: "option_section_title", label: "Раздел опций класса (напр. «Таинственные воззвания»)", type: "text" },
    ],
    childKinds: [
      { kind: "subclass", label: "подкласс" },
      { kind: "feature", label: "умение" },
      { kind: "class_option", label: "опцию" },
    ],
  },
  subclass: {
    label: "Подкласс",
    fields: [],
    childKinds: [{ kind: "feature", label: "умение" }],
  },
  feature: {
    label: "Умение",
    hasLevel: true,
    fields: [
      // Умение может быть действием (Второе дыхание — бонусное действие,
      // Наложение рук — действие), и тогда оно попадает во вкладку
      // «Действия» листа наравне с заклинаниями и оружием.
      {
        key: "casting_timing",
        label: "Время накладывания",
        type: "select",
        options: ["Действие", "Бонусное действие", "Реакция", "Иное"],
      },
      { key: "casting_timing_other", label: "Если «Иное» — сколько/когда", type: "text" },
    ],
  },
  // An entry in a class's named options list (invocations, infusions,
  // metamagic, …) — like a feature, but kept out of Умения so it never
  // auto-fills character sheets' Классовые особенности.
  class_option: {
    label: "Опция",
    hasLevel: true,
    fields: [
      // Умение может быть действием (Второе дыхание — бонусное действие,
      // Наложение рук — действие), и тогда оно попадает во вкладку
      // «Действия» листа наравне с заклинаниями и оружием.
      {
        key: "casting_timing",
        label: "Время накладывания",
        type: "select",
        options: ["Действие", "Бонусное действие", "Реакция", "Иное"],
      },
      { key: "casting_timing_other", label: "Если «Иное» — сколько/когда", type: "text" },
    ],
  },
  spell: {
    label: "Заклинание",
    hasLevel: true,
    fields: [
      {
        key: "casting_timing",
        label: "Время накладывания",
        type: "select",
        options: ["Действие", "Бонусное действие", "Реакция", "Иное"],
      },
      { key: "casting_timing_other", label: "Если «Иное» — сколько (напр. «10 минут»)", type: "text" },
      { key: "range", label: "Дистанция", type: "text" },
      { key: "duration", label: "Длительность", type: "text" },
      // Категория / Атака-спасбросок / Урон / Лечение жили здесь до перехода
      // на структурные эффекты (data.checks + data.effects, см. effects.ts).
      // Категория была необязательной, а от неё зависело попадание во вкладку
      // Бой — 55 из 94 заклинаний туда не доходили. Теперь это выводится из
      // самих эффектов, а одно поле урона больше не ограничивает заклинание
      // одним броском и одним типом урона.
      { key: "upcast", label: "Усиление: примечание", type: "textarea" },
    ],
  },
  item: {
    label: "Предмет",
    fields: [
      { key: "item_type", label: "Тип", type: "text" },
      { key: "rarity", label: "Редкость", type: "text" },
      { key: "attunement", label: "Настройка", type: "text" },
    ],
  },
  // Настройка (attunement) and Классы are bespoke fields (checkbox + a
  // reused ClassSubclassMultiPicker) rather than generic ones — see the
  // isMagicItem branch in CompendiumSection.tsx.
  magic_item: {
    label: "Магический предмет",
    fields: [
      { key: "item_type", label: "Тип", type: "select", options: [...MAGIC_ITEM_TYPES] },
      { key: "rarity", label: "Редкость", type: "select", options: [...MAGIC_ITEM_RARITIES] },
      { key: "cost", label: "Стоимость", type: "text" },
    ],
  },
  species: {
    label: "Вид",
    fields: [{ key: "size", label: "Размер", type: "text" }],
    childKinds: [{ kind: "feature", label: "особенность вида" }],
  },
  feat: {
    label: "Черта",
    fields: [
      { key: "category", label: "Категория", type: "select", options: [...FEAT_CATEGORIES] },
      { key: "prerequisite", label: "Требование", type: "text" },
    ],
  },
  background: {
    label: "Предыстория",
    fields: [
      { key: "tools", label: "Владения инструментами", type: "text" },
      { key: "feature", label: "Умение предыстории", type: "text" },
    ],
  },
  monster: {
    label: "Существо",
    fields: [
      { key: "size", label: "Размер", type: "select", options: [...CREATURE_SIZES] },
      { key: "cr", label: "Класс опасности", type: "select", options: [...CHALLENGE_RATINGS] },
    ],
  },
  equipment: {
    label: "Снаряжение",
    fields: [
      { key: "category", label: "Категория", type: "select", options: [...EQUIPMENT_CATEGORIES] },
      { key: "cost", label: "Цена", type: "text" },
      { key: "weight", label: "Вес", type: "text" },
    ],
  },
  mechanic_group: {
    label: "Список",
    fields: [],
    childKinds: [{ kind: "mechanic_item", label: "пункт" }],
  },
  mechanic_item: {
    label: "Пункт",
    fields: [],
    childKinds: [{ kind: "mechanic_item", label: "подпункт" }],
  },
  skill_group: {
    label: "Список",
    fields: [],
    childKinds: [{ kind: "skill", label: "навык" }],
  },
  skill: {
    label: "Навык",
    fields: [{ key: "ability", label: "Характеристика", type: "select", options: [...ABILITY_SCORES] }],
  },
};

export function kindLabel(kind: string): string {
  return KIND_DEFS[kind]?.label ?? kind;
}
