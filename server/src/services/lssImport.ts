// Parses a character sheet exported from Long Story Short (next.dnd.su sheet
// builder). Their export nests a JSON-encoded string ("data") containing the
// actual sheet, with long-form text fields stored as ProseMirror documents
// rather than plain strings — most of this file is about flattening those
// into readable text for a statblock card.

interface ProseNode {
  type?: string;
  text?: string;
  content?: ProseNode[];
}

function proseToText(node: ProseNode | undefined, listPrefix = ""): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  const children = (node.content ?? []).map((c) =>
    proseToText(c, node.type === "bulletList" || node.type === "orderedList" ? "- " : listPrefix)
  );
  if (node.type === "paragraph") return children.join("") + "\n";
  if (node.type === "listItem") return "- " + children.join("").trimStart();
  if (node.type === "bulletList" || node.type === "orderedList") return children.join("");
  return children.join("");
}

function textBlockValue(block: any): string {
  const doc = block?.value?.data;
  if (!doc) return typeof block?.value === "string" ? block.value : "";
  return proseToText(doc).trim();
}

const SECTION_LABELS: Record<string, string> = {
  traits: "Умения класса",
  prof: "Владения и языки",
  feats: "Черты",
  attacks: "Атаки",
  equipment: "Снаряжение",
  appearance: "Внешность",
  quests: "Цели",
  background: "Предыстория",
  features: "Особенности вида",
  personality: "Черты характера",
  ideals: "Идеалы",
  bonds: "Привязанности",
  flaws: "Слабости",
};

const STAT_LABELS: Record<string, string> = {
  str: "Сила",
  dex: "Ловкость",
  con: "Телосложение",
  int: "Интеллект",
  wis: "Мудрость",
  cha: "Харизма",
};

const SKILL_LABELS: Record<string, string> = {
  acrobatics: "Акробатика",
  "animal handling": "Уход за животными",
  arcana: "Магия",
  athletics: "Атлетика",
  deception: "Обман",
  history: "История",
  insight: "Проницательность",
  intimidation: "Запугивание",
  investigation: "Расследование",
  medicine: "Медицина",
  nature: "Природа",
  perception: "Восприятие",
  performance: "Выступление",
  persuasion: "Убеждение",
  religion: "Религия",
  "sleight of hand": "Ловкость рук",
  stealth: "Скрытность",
  survival: "Выживание",
};

export interface LssImportResult {
  characterName: string;
  shortText: string;
  fullText: string;
  // Structured dnd_character statblock content (JSON-stringified DndCharacterData
  // shape, see client/src/types.ts) — best-effort mapping of whatever LSS gives
  // us. Free-text sections that have no structured home (appearance, quests,
  // background prose) are concatenated into `notes` instead of being dropped.
  characterData: Record<string, unknown>;
}

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;

function emptyAbilities() {
  return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
}

function proficiencyBonusForLevel(level: number): number {
  return 2 + Math.floor(Math.max(0, level - 1) / 4);
}

export function parseLongStoryShort(raw: string): LssImportResult {
  const outer = JSON.parse(raw);
  const data = typeof outer.data === "string" ? JSON.parse(outer.data) : outer.data ?? outer;

  const name = data.name?.value ?? "";
  const info = data.info ?? {};
  const stats = data.stats ?? {};
  const saves = data.saves ?? {};
  const skills = data.skills ?? {};
  const vitality = data.vitality ?? {};
  const weapons = data.weaponsList ?? [];
  const text = data.text ?? {};

  const headerParts = [
    [info.race?.value, info.charClass?.value, info.charSubclass?.value].filter(Boolean).join(" "),
    info.level?.value ? `Уровень ${info.level.value}` : "",
    info.background?.value ? `Предыстория: ${info.background.value}` : "",
    info.alignment?.value,
  ].filter(Boolean);

  const abilityLine = Object.entries(stats)
    .map(([k, v]: [string, any]) => `${STAT_LABELS[k] ?? k} ${v.score}`)
    .join(" · ");

  const savingThrows = Object.entries(saves)
    .filter(([, v]: [string, any]) => v.isProf)
    .map(([k]) => STAT_LABELS[k] ?? k)
    .join(", ");

  const proficientSkills = Object.values(skills)
    .filter((s: any) => s.isProf)
    .map((s: any) => SKILL_LABELS[s.name] ?? s.name)
    .join(", ");

  const vitalsLine = [
    vitality["ac"]?.value != null ? `КД ${vitality["ac"].value}` : "",
    vitality["hp-max"]?.value != null
      ? `ХП ${vitality["hp-current"]?.value ?? vitality["hp-max"].value}/${vitality["hp-max"].value}`
      : "",
    vitality["speed"]?.value != null ? `Скорость ${vitality["speed"].value} фт` : "",
    vitality["hit-die"]?.value ? `Кость хитов ${vitality["hit-die"].value}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const weaponLines = weapons.map((w: any) => {
    const bits = [w.name?.value, w.mod?.value, w.dmg?.value].filter(Boolean);
    return "- " + bits.join(" ");
  });

  const shortText = [
    name,
    headerParts.join(" · "),
    abilityLine,
    vitalsLine,
    savingThrows ? `Спасброски: ${savingThrows}` : "",
    weaponLines.length ? "Оружие:\n" + weaponLines.join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");

  const sectionOrder = [
    "features",
    "traits",
    "prof",
    "feats",
    "attacks",
    "equipment",
    "appearance",
    "personality",
    "ideals",
    "bonds",
    "flaws",
    "quests",
    "background",
  ];
  const seen = new Set(sectionOrder);
  const restKeys = Object.keys(text).filter((k) => !seen.has(k));
  const allKeys = [...sectionOrder, ...restKeys];

  const sections = allKeys
    .map((key) => {
      const block = text[key];
      if (!block) return "";
      const body = textBlockValue(block);
      if (!body) return "";
      const label = block.customLabel || SECTION_LABELS[key] || key;
      return `## ${label}\n${body}`;
    })
    .filter(Boolean);

  const fullText = [
    shortText,
    proficientSkills ? `Владение навыками: ${proficientSkills}` : "",
    "",
    sections.join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n");

  const level = Number(info.level?.value) || 1;
  const hitDieDigits = typeof vitality["hit-die"]?.value === "string" ? vitality["hit-die"].value.replace(/\D/g, "") : "";

  const abilities = emptyAbilities();
  for (const k of ABILITY_KEYS) {
    const score = stats[k]?.score;
    if (typeof score === "number") abilities[k] = score;
  }

  const savingThrowProfs = { str: false, dex: false, con: false, int: false, wis: false, cha: false };
  for (const [k, v] of Object.entries(saves) as [string, any][]) {
    if (v?.isProf && (ABILITY_KEYS as readonly string[]).includes(k)) savingThrowProfs[k as (typeof ABILITY_KEYS)[number]] = true;
  }

  const skillProfs: Record<string, number> = {};
  for (const s of Object.values(skills) as any[]) {
    if (s?.isProf) skillProfs[SKILL_LABELS[s.name] ?? s.name] = 1;
  }

  const attacks = weapons
    .map((w: any) => ({
      name: w.name?.value ?? "",
      description: [w.mod?.value, w.dmg?.value].filter(Boolean).join(" "),
    }))
    .filter((a: any) => a.name || a.description);

  const featureBlock = (key: string) => {
    const body = textBlockValue(text[key]);
    return body ? [{ name: SECTION_LABELS[key], description: body }] : [];
  };
  const equipmentBody = textBlockValue(text.equipment);

  // Free-text sections with no structured field of their own get folded into
  // notes (headed) rather than silently dropped.
  const notesSections = ["appearance", "quests", "background", "prof"]
    .map((key) => {
      const body = textBlockValue(text[key]);
      return body ? `## ${SECTION_LABELS[key] ?? key}\n${body}` : "";
    })
    .filter(Boolean);

  const characterData = {
    systemId: null,
    characterName: name,
    playerName: "",
    classes: [
      {
        classId: null,
        className: info.charClass?.value ?? "",
        subclassId: null,
        subclassName: info.charSubclass?.value ?? "",
        level,
        skillChoiceOptions: [],
        skillChoiceCount: 0,
        spellcastingAbility: "",
      },
    ],
    raceId: null,
    raceName: info.race?.value ?? "",
    raceTypeName: "",
    backgroundId: null,
    backgroundName: info.background?.value ?? "",
    backgroundSkillNames: [],
    alignment: info.alignment?.value ?? "",
    experiencePoints: "",
    abilities,
    proficiencyBonus: String(proficiencyBonusForLevel(level)),
    inspiration: false,
    savingThrowProfs,
    skillProfs,
    armorClass: vitality.ac?.value != null ? String(vitality.ac.value) : "",
    initiative: "",
    speed: vitality.speed?.value != null ? String(vitality.speed.value) : "",
    hitPointMax: vitality["hp-max"]?.value != null ? String(vitality["hp-max"].value) : "",
    hitPointsCurrent:
      vitality["hp-current"]?.value != null
        ? String(vitality["hp-current"].value)
        : vitality["hp-max"]?.value != null
          ? String(vitality["hp-max"].value)
          : "",
    hitPointsTemp: "",
    hitPointMaxTemp: "",
    hitDice: hitDieDigits ? `${level}к${hitDieDigits}` : "",
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    attacks,
    equipmentSections: equipmentBody ? [{ name: "Снаряжение", items: [{ name: equipmentBody, qty: "", weight: "", notes: "" }] }] : [],
    attunementCount: 0,
    speciesFeatures: featureBlock("features"),
    classFeatures: featureBlock("traits"),
    feats: featureBlock("feats"),
    specialAbilities: [],
    proficiencies: [],
    personalityTraits: textBlockValue(text.personality),
    ideals: textBlockValue(text.ideals),
    bonds: textBlockValue(text.bonds),
    flaws: textBlockValue(text.flaws),
    spellcasting: "",
    spellDcMisc: "",
    spellAttackMisc: "",
    cantrips: [],
    spellSlotLevels: 0,
    spellSlotPips: new Array(9).fill(0),
    spellSlotsUsed: new Array(9).fill(0),
    spellsByLevel: new Array(9).fill(null).map(() => []),
    notes: notesSections.join("\n\n"),
    manualAcBonus: "",
    resourceUsed: {},
    resourceBonus: {},
  };

  return { characterName: name, shortText, fullText, characterData };
}
