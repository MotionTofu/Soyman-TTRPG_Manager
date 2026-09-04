// Parses a character sheet exported from Long Story Short (longstoryshort.app sheet
// builder). Their export nests a JSON-encoded string ("data") containing the
// actual sheet, with long-form text fields stored as ProseMirror documents
// rather than plain strings — most of this file is about flattening those
// into readable text for a statblock card.

import { db } from "../db/db";

interface CompendiumEntryRow {
  id: number;
  parent_id: number | null;
  kind: string;
  name: string;
  data: string;
}

// Best-effort name match against the D&D 5.5 compendium, so imported
// race/class/subclass/background become real links (clickable/expandable
// like a manually-picked character) instead of free text with null ids.
// Mirrors the manual pickers in dndCompendium.ts, but done directly against
// the DB (this parser runs server-side and has no HTTP round-trip to make).
function findDndSystemIdSync(): number | null {
  const row = db.prepare("SELECT id FROM systems WHERE name = ?").get("D&D 5.5") as { id: number } | undefined;
  return row?.id ?? null;
}

function normalizeForMatch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»„“"']/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findEntryByName(
  systemId: number,
  sectionKind: string,
  entryKind: string,
  name: string,
  parentId: number | null = null
): CompendiumEntryRow | null {
  if (!name.trim()) return null;
  const target = normalizeForMatch(name);
  // For "Человек (вариант)" try also base name without parenthetical — how LSS exports variant humans vs compendium "Человек"
  const targetBase = normalizeForMatch(name.replace(/\s*\(.*\)\s*$/, ""));
  const sections = db
    .prepare("SELECT id FROM system_sections WHERE system_id = ? AND kind = ?")
    .all(systemId, sectionKind) as { id: number }[];
  for (const section of sections) {
    const entries = db
      .prepare(
        parentId === null
          ? "SELECT id, parent_id, kind, name, data FROM compendium_entries WHERE section_id = ? AND kind = ? AND parent_id IS NULL"
          : "SELECT id, parent_id, kind, name, data FROM compendium_entries WHERE section_id = ? AND kind = ? AND parent_id = ?"
      )
      .all(...(parentId === null ? [section.id, entryKind] : [section.id, entryKind, parentId])) as CompendiumEntryRow[];
    let match = entries.find((e) => normalizeForMatch(e.name) === target);
    if (!match && targetBase !== target) match = entries.find((e) => normalizeForMatch(e.name) === targetBase);
    if (match) return match;
  }
  return null;
}

interface ProseNode {
  type?: string;
  text?: string;
  content?: ProseNode[];
  marks?: unknown[];
}

function proseToText(node: ProseNode | undefined, listPrefix = ""): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const children = (node.content ?? []).map((c) =>
    proseToText(c, node.type === "bulletList" || node.type === "orderedList" ? "- " : listPrefix)
  );
  if (node.type === "paragraph") return children.join("") + "\n";
  if (node.type === "heading") return children.join("") + "\n";
  if (node.type === "blockquote") return children.join("") + "\n";
  if (node.type === "listItem") return "- " + children.join("").trimStart() + "\n";
  if (node.type === "bulletList" || node.type === "orderedList") return children.join("");
  // doc / other wrappers
  return children.join("");
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function textBlockValue(block: unknown): string {
  if (!block || typeof block !== "object") return "";
  const b = block as Record<string, unknown>;
  const doc = (b.value as Record<string, unknown> | undefined)?.data;
  if (doc && typeof doc === "object") return proseToText(doc as ProseNode).trim();
  const direct = (b as Record<string, unknown>).value;
  if (typeof direct === "string") return direct.trim();
  // Some LSS versions store plain string directly in block
  if (typeof b.value === "string") return (b.value as string).trim();
  return "";
}

function safeJsonParse(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${label}: ${(e as Error).message}`);
  }
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
  allies: "Союзники",
};

const STAT_LABELS: Record<string, string> = {
  str: "Сила",
  dex: "Ловкость",
  con: "Телосложение",
  int: "Интеллект",
  wis: "Мудрость",
  cha: "Харизма",
};

// Русские имена — только для человекочитаемой сводки импорта. В данные листа
// они больше не попадают: ключом владения стал английский `original`
// (см. db/dndSkillNames.ts). Прежние имена здесь были ещё и не теми, что
// показывает лист («Расследование» против «Анализ/расследование»,
// «Восприятие» против «Внимание/восприятие»), из-за чего каждый импорт из
// Long Story Short молча терял два самых ходовых владения.
const SKILL_LABELS: Record<string, string> = {
  acrobatics: "Акробатика",
  "animal handling": "Уход за животными",
  arcana: "Арканная магия",
  athletics: "Атлетика",
  deception: "Обман",
  history: "История",
  insight: "Проницательность",
  intimidation: "Запугивание",
  investigation: "Анализ/расследование",
  medicine: "Медицина",
  nature: "Природа",
  perception: "Внимание/восприятие",
  performance: "Выступление",
  persuasion: "Убеждение",
  religion: "Религия",
  "sleight of hand": "Ловкость рук",
  stealth: "Скрытность",
  survival: "Выживание",
};

// Ключ владения в `skillProfs` листа. LSS зовёт навыки теми же английскими
// именами, только строчными, — отсюда и соответствие один в один.
const SKILL_KEYS: Record<string, string> = {
  acrobatics: "Acrobatics",
  "animal handling": "Animal Handling",
  arcana: "Arcana",
  athletics: "Athletics",
  deception: "Deception",
  history: "History",
  insight: "Insight",
  intimidation: "Intimidation",
  investigation: "Investigation",
  medicine: "Medicine",
  nature: "Nature",
  perception: "Perception",
  performance: "Performance",
  persuasion: "Persuasion",
  religion: "Religion",
  "sleight of hand": "Sleight of Hand",
  stealth: "Stealth",
  survival: "Survival",
};

export interface LssImportWarnings {
  field: string;
  message: string;
}

export interface LssImportResult {
  characterName: string;
  shortText: string;
  fullText: string;
  // Structured dnd_character statblock content (JSON-stringified DndCharacterData
  // shape, see client/src/types.ts) — best-effort mapping of whatever LSS gives
  // us. Free-text sections that have no structured home (appearance, quests,
  // background prose) are concatenated into `notes` instead of being dropped.
  characterData: Record<string, unknown>;
  warnings: LssImportWarnings[];
}

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;

function emptyAbilities() {
  return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
}

function proficiencyBonusForLevel(level: number): number {
  return 2 + Math.floor(Math.max(0, level - 1) / 4);
}

export function parseLongStoryShort(raw: string): LssImportResult {
  if (!raw || !raw.trim()) throw new Error("Файл пустой");
  let outer: unknown;
  try {
    outer = JSON.parse(raw);
  } catch (e) {
    throw new Error("Не JSON: " + (e as Error).message);
  }
  if (!outer || typeof outer !== "object") throw new Error("Ожидался объект в корне JSON");
  const outerRec = outer as Record<string, unknown>;
  let data: Record<string, unknown>;
  if (typeof outerRec.data === "string") {
    const inner = safeJsonParse(outerRec.data as string, "поле data");
    if (!inner || typeof inner !== "object") throw new Error("Поле data не содержит объект персонажа");
    data = inner as Record<string, unknown>;
  } else if (outerRec.data && typeof outerRec.data === "object") {
    data = outerRec.data as Record<string, unknown>;
  } else {
    data = outerRec as Record<string, unknown>;
  }

  const warnings: LssImportWarnings[] = [];
  const warn = (field: string, message: string) => warnings.push({ field, message });

  function getValue(obj: unknown, key: string): string {
    if (!obj || typeof obj !== "object") return "";
    const rec = obj as Record<string, unknown>;
    const v = rec[key] as Record<string, unknown> | undefined;
    if (!v || typeof v !== "object") return "";
    const val = (v as Record<string, unknown>).value;
    return typeof val === "string" || typeof val === "number" ? String(val) : "";
  }

  function isProfTrue(v: unknown): boolean {
    if (v === true) return true;
    if (v === 1) return true;
    if (v === "1" || v === "true") return true;
    return false;
  }

  // Outer-level fields (LSS wraps inner `data` string, but spells/proficiency/inspiration live alongside it)
  const outerSpells = (outerRec.spells as Record<string, unknown> | undefined) ?? null;
  const outerSpellsPact = (outerRec.spellsPact as Record<string, unknown> | undefined) ?? null;
  const outerProficiency = outerRec.proficiency;
  const outerInspiration = outerRec.inspiration;
  const outerCoins = outerRec.coins;
  const outerEdition = typeof outerRec.edition === "string" ? outerRec.edition : typeof outerRec.sheetEdition === "string" ? outerRec.sheetEdition : "";

  const nameRaw = (data.name as Record<string, unknown> | undefined)?.value;
  const name = typeof nameRaw === "string" ? nameRaw : typeof nameRaw === "number" ? String(nameRaw) : "";
  const info = (data.info && typeof data.info === "object" ? data.info : {}) as Record<string, unknown>;
  const stats = (data.stats && typeof data.stats === "object" ? data.stats : {}) as Record<string, unknown>;
  const saves = (data.saves && typeof data.saves === "object" ? data.saves : {}) as Record<string, unknown>;
  const skills = (data.skills && typeof data.skills === "object" ? data.skills : {}) as Record<string, unknown>;
  const vitality = (data.vitality && typeof data.vitality === "object" ? data.vitality : {}) as Record<string, unknown>;
  const weapons = Array.isArray(data.weaponsList) ? (data.weaponsList as unknown[]) : [];
  const text = (data.text && typeof data.text === "object" ? data.text : {}) as Record<string, unknown>;
  // Optional LSS sections that some exports carry (used in fase 2 mapping — kept here for warnings even before full support)
  const rawSpells = (data as Record<string, unknown>).spells;
  const rawInventory = (data as Record<string, unknown>).inventory;

  // Helpers to read .value safely without `any`
  const infoRace = getValue(info, "race");
  const infoClass = getValue(info, "charClass");
  const infoSubclass = getValue(info, "charSubclass");
  const infoLevel = getValue(info, "level");
  const infoBackground = getValue(info, "background");
  const infoAlignment = getValue(info, "alignment");
  if (!infoRace && !infoClass && !infoBackground && !name) {
    warn("info", "Поля расы/класса/предыстории пусты — проверьте, что экспорт с longstoryshort.app не обрезан.");
  }

  const headerParts = [
    [infoRace, infoClass, infoSubclass].filter(Boolean).join(" "),
    infoLevel ? `Уровень ${infoLevel}` : "",
    infoBackground ? `Предыстория: ${infoBackground}` : "",
    infoAlignment,
  ].filter(Boolean);

  const abilityLine = Object.entries(stats)
    .map(([k, v]) => {
      const rec = v as Record<string, unknown> | undefined;
      const score = rec && typeof rec.score === "number" ? rec.score : undefined;
      return score != null ? `${STAT_LABELS[k] ?? k} ${score}` : "";
    })
    .filter(Boolean)
    .join(" · ");

  const savingThrows = Object.entries(saves)
    .filter(([, v]) => isProfTrue((v as Record<string, unknown>)?.isProf))
    .map(([k]) => STAT_LABELS[k] ?? k)
    .join(", ");

  const proficientSkills = Object.values(skills)
    .filter((s) => isProfTrue((s as Record<string, unknown>)?.isProf))
    .map((s) => {
      const rec = s as Record<string, unknown>;
      const rawName = typeof rec.name === "string" ? rec.name : "";
      return SKILL_LABELS[rawName] ?? rawName;
    })
    .join(", ");

  function getVitalValue(key: string): string {
    const rec = vitality[key] as Record<string, unknown> | undefined;
    if (!rec) return "";
    const val = (rec as Record<string, unknown>).value;
    return val != null ? String(val) : "";
  }

  const vitalsLine = [
    getVitalValue("ac") ? `КД ${getVitalValue("ac")}` : "",
    getVitalValue("hp-max")
      ? `ХП ${getVitalValue("hp-current") || getVitalValue("hp-max")}/${getVitalValue("hp-max")}`
      : "",
    getVitalValue("speed") ? `Скорость ${getVitalValue("speed")} фт` : "",
    getVitalValue("hit-die") ? `Кость хитов ${getVitalValue("hit-die")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const weaponLines = weapons.map((w) => {
    const rec = w as Record<string, unknown>;
    const bits = [getValue(rec, "name"), getValue(rec, "mod"), getValue(rec, "dmg")].filter(Boolean);
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
      const block = text[key] as Record<string, unknown> | undefined;
      if (!block) return "";
      const body = textBlockValue(block);
      if (!body) return "";
      const label =
        (typeof block.customLabel === "string" && block.customLabel) || SECTION_LABELS[key] || key;
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

  const level = Number(infoLevel) || 1;
  const hitDieDigits = getVitalValue("hit-die").replace(/\D/g, "");

  const abilities = emptyAbilities();
  for (const k of ABILITY_KEYS) {
    const rec = stats[k] as Record<string, unknown> | undefined;
    const score = rec && typeof rec.score === "number" ? rec.score : undefined;
    if (typeof score === "number") abilities[k] = score;
  }

  const savingThrowProfs: Record<string, boolean> = { str: false, dex: false, con: false, int: false, wis: false, cha: false };
  for (const [k, v] of Object.entries(saves)) {
    const rec = v as Record<string, unknown> | undefined;
    if (rec && isProfTrue(rec.isProf) && (ABILITY_KEYS as readonly string[]).includes(k)) {
      savingThrowProfs[k] = true;
    }
  }

  const skillProfs: Record<string, number> = {};
  for (const s of Object.values(skills)) {
    const rec = s as Record<string, unknown> | undefined;
    if (!rec || !isProfTrue(rec.isProf)) continue;
    const rawName = typeof rec.name === "string" ? rec.name : "";
    // Ключом, а не именем: имя лист бы не узнал, и владение осталось бы в
    // данных невидимым. Незнакомое имя сохраняем как есть — лист покажет его
    // строкой «нет в справочнике», а не потеряет.
    const key = SKILL_KEYS[rawName] ?? rawName;
    if (!key) continue;
    const lvl = typeof rec.level === "number" && (rec.level === 2 || rec.level === 1) ? rec.level : 1;
    const expertise = rec.isExpertise === true || rec.expertise === true || isProfTrue(rec.expertise);
    skillProfs[key] = expertise ? 2 : lvl;
  }

  const attacks = weapons
    .map((w) => {
      const rec = w as Record<string, unknown>;
      const name = getValue(rec, "name");
      const description = [getValue(rec, "mod"), getValue(rec, "dmg")].filter(Boolean).join(" ");
      return { name, description, timing: "action" as const };
    })
    .filter((a) => a.name || a.description);

  const featureBlock = (key: string) => {
    const body = textBlockValue(text[key]);
    return body ? [{ name: SECTION_LABELS[key] ?? key, description: body }] : [];
  };
  // Снаряжение: если LSS отдал ProseMirror bulletList, разбить по «- » строкам вместо одного кома
  const equipmentRawBody = textBlockValue(text.equipment);
  const equipmentItems = equipmentRawBody
    ? equipmentRawBody
        .split("\n")
        .map((l) => l.replace(/^-+\s*/, "").trim())
        .filter(Boolean)
        .map((name) => ({ name, qty: "", weight: "", notes: "" }))
    : [];
  // Fallback: некоторые экспорты кладут инвентарь в data.inventory / data.equipment как массив
  if (equipmentItems.length === 0 && Array.isArray(rawInventory)) {
    for (const it of rawInventory as unknown[]) {
      const rec = it as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name : typeof rec.title === "string" ? rec.title : "";
      if (name) equipmentItems.push({ name, qty: "", weight: "", notes: "" });
    }
  }

  // Warnings for sections that carry structured intent but aren't fully mappable yet
  // Inner data.spells is often {} in real exports — real spell list lives in outer `spells.prepared` (LSS IDs)
  const outerPrepared = outerSpells && Array.isArray((outerSpells as Record<string, unknown>).prepared)
    ? ((outerSpells as Record<string, unknown>).prepared as unknown[])
    : null;
  if (outerPrepared && outerPrepared.length > 0) {
    warn(
      "spells",
      `В листе ${outerPrepared.length} подготовленных заклинаний (LSS IDs) — ID не мапятся на справочник D&D 5.5 автоматически, перенесите вручную. Список: ${outerPrepared.slice(0, 5).join(", ")}${outerPrepared.length > 5 ? "…" : ""}`
    );
  } else if (rawSpells != null && !Array.isArray(rawSpells) && typeof rawSpells !== "object") {
    warn("spells", "Поле spells в экспорте имеет неожиданный формат — заклинания не импортированы.");
  } else if (rawSpells != null) {
    const count = Array.isArray(rawSpells) ? rawSpells.length : Object.keys(rawSpells as object).length;
    if (count > 0) warn("spells", `В листе есть заклинания (${count}), пока не импортируются — перенесите вручную.`);
  }
  if (outerEdition && outerEdition !== "2024" && outerEdition !== "2014") {
    warn("edition", `Экспорт помечен как edition=${outerEdition} — проверьте соответствие системе D&D 5.5.`);
  }
  if (!equipmentRawBody && Array.isArray(rawInventory) && (rawInventory as unknown[]).length === 0) {
    // empty inventory — no warning
  }

  // Free-text sections with no structured field of their own get folded into
  // notes (headed) rather than silently dropped. `allies` is a real LSS section (e.g. Эрвин — Альянс Лордов) — include it.
  const notesSections = ["appearance", "quests", "background", "prof", "allies"]
    .map((key) => {
      const body = textBlockValue(text[key]);
      if (body) return `## ${SECTION_LABELS[key] ?? key}\n${body}`;
      // allies may be stored as text.allies with same ProseMirror shape — already handled; fallback: outer allies?
      return "";
    })
    .filter(Boolean);
  // Outer inspiration/edition hints go to notes if not otherwise visible
  if (outerSpellsPact && typeof outerSpellsPact === "object") {
    const pactSlots = (outerSpellsPact as Record<string, unknown>)["slots-3"] as Record<string, unknown> | undefined;
    const pactVal = pactSlots?.value;
    if (pactVal != null && String(pactVal) !== "0") {
      notesSections.push(`## Договор (Pact slots)\nЯчеек договора (круг 3): ${String(pactVal)} — перенесено в Заметки, в листе заполните раздел «Заклинания → Договор».`);
    }
  }

  // Best-effort link-up against the compendium, so the imported class/
  // species/background aren't just inert free text — see findEntryByName.
  const dndSystemId = findDndSystemIdSync();
  let raceId: number | null = null;
  let raceTypeName = "";
  let classId: number | null = null;
  let subclassId: number | null = null;
  let skillChoiceOptions: string[] = [];
  let skillChoiceCount = 0;
  let spellcastingAbility = "";
  let backgroundId: number | null = null;
  let backgroundSkillNames: string[] = [];
  if (dndSystemId != null) {
    try {
      const raceEntry = findEntryByName(dndSystemId, "species", "species", infoRace);
      if (raceEntry) {
        raceId = raceEntry.id;
        try {
          const d = JSON.parse(raceEntry.data || "{}") as Record<string, unknown>;
          const ct = d.creature_type as Record<string, unknown> | undefined;
          raceTypeName = typeof ct?.name === "string" ? (ct.name as string) : "";
        } catch {
          warn("race", `Раса «${infoRace}» найдена, но её data повреждена — тип существа не извлечён.`);
        }
      } else if (infoRace) {
        warn("race", `Раса «${infoRace}» не найдена в справочнике D&D 5.5 — останется текстом.`);
      }
    } catch (e) {
      warn("race", `Ошибка поиска расы «${infoRace}»: ${(e as Error).message}`);
    }
    try {
      const classEntry = findEntryByName(dndSystemId, "class", "class", infoClass);
      if (classEntry) {
        classId = classEntry.id;
        try {
          const d = JSON.parse(classEntry.data || "{}") as Record<string, unknown>;
          skillChoiceOptions = Array.isArray(d.skill_choice_options) ? (d.skill_choice_options as string[]) : [];
          skillChoiceCount = typeof d.skill_choice_count === "number" ? (d.skill_choice_count as number) : 0;
          spellcastingAbility = typeof d.spellcasting_ability === "string" ? (d.spellcasting_ability as string) : "";
        } catch {
          warn("class", `Класс «${infoClass}» найден, но его data повреждена.`);
        }
        if (infoSubclass) {
          try {
            const subclassEntry = findEntryByName(dndSystemId, "class", "subclass", infoSubclass, classId);
            if (subclassEntry) subclassId = subclassEntry.id;
            else warn("subclass", `Подкласс «${infoSubclass}» не найден у класса «${infoClass}» — останется текстом.`);
          } catch (e) {
            warn("subclass", `Ошибка поиска подкласса «${infoSubclass}»: ${(e as Error).message}`);
          }
        }
      } else if (infoClass) {
        warn("class", `Класс «${infoClass}» не найден в справочнике D&D 5.5 — останется текстом.`);
      }
    } catch (e) {
      warn("class", `Ошибка поиска класса «${infoClass}»: ${(e as Error).message}`);
    }
    try {
      const backgroundEntry = findEntryByName(dndSystemId, "background", "background", infoBackground);
      if (backgroundEntry) {
        backgroundId = backgroundEntry.id;
        try {
          const d = JSON.parse(backgroundEntry.data || "{}") as Record<string, unknown>;
          backgroundSkillNames = Array.isArray(d.skills) ? (d.skills as string[]) : [];
        } catch {
          warn("background", `Предыстория «${infoBackground}» найдена, но её data повреждена.`);
        }
      } else if (infoBackground) {
        warn("background", `Предыстория «${infoBackground}» не найдена в справочнике — останется текстом.`);
      }
    } catch (e) {
      warn("background", `Ошибка поиска предыстории «${infoBackground}»: ${(e as Error).message}`);
    }
  } else {
    warn("system", "Система D&D 5.5 не найдена в БД — линки расы/класса/предыстории не проставлены.");
  }

  // proficiencyBonus: preference explicit value from LSS if present
  // Priority: data.proficiency (inner top-level number) → outer `proficiency` → info.proficiencyBonus → calculated
  let proficiencyBonusStr: string;
  const innerProficiency = (data as Record<string, unknown>).proficiency;
  const profNum =
    typeof innerProficiency === "number"
      ? innerProficiency
      : typeof outerProficiency === "number"
        ? outerProficiency
        : null;
  if (typeof profNum === "number" && profNum > 0) {
    proficiencyBonusStr = `+${profNum}`;
  } else {
    const explicitBonusRaw =
      getValue(info, "proficiencyBonus") ||
      getValue(data as unknown as Record<string, unknown>, "proficiencyBonus") ||
      "";
    if (explicitBonusRaw) {
      const n = Number(String(explicitBonusRaw).replace(/[^\d-]/g, ""));
      proficiencyBonusStr = Number.isFinite(n) && n !== 0 ? (n > 0 ? `+${n}` : String(n)) : `+${proficiencyBonusForLevel(level)}`;
    } else {
      proficiencyBonusStr = `+${proficiencyBonusForLevel(level)}`;
    }
  }

  // Experience and inspiration — optional LSS fields
  // Inner `data.inspiration` boolean is authoritative in real exports (see Эрвин sample); fallback to outer/info/vitality
  const experiencePoints =
    getValue(info, "experiencePoints") || getValue(info, "experience") || getValue(info, "exp") || "";
  let inspiration: boolean;
  const innerInspiration = (data as Record<string, unknown>).inspiration;
  if (typeof innerInspiration === "boolean") inspiration = innerInspiration;
  else if (typeof innerInspiration === "number") inspiration = innerInspiration !== 0;
  else if (typeof outerInspiration === "boolean") inspiration = outerInspiration;
  else if (typeof outerInspiration === "number") inspiration = outerInspiration !== 0;
  else {
    const inspirationRaw = getValue(info, "inspiration") || getValue(vitality, "inspiration") || String(outerInspiration ?? innerInspiration ?? "");
    inspiration = inspirationRaw ? inspirationRaw === "1" || inspirationRaw.toLowerCase() === "true" : false;
  }

  const hitPointMaxStr = getVitalValue("hp-max");
  const hitPointCurrentStr = getVitalValue("hp-current");
  const hitPointsTempStr = getVitalValue("hp-temp") || getVitalValue("tempHp") || "";
  const armorClassStr = getVitalValue("ac");
  const speedStr = getVitalValue("speed");

  const characterData = {
    systemId: dndSystemId,
    characterName: name,
    playerName: "",
    classes: [
      {
        classId,
        className: infoClass,
        subclassId,
        subclassName: infoSubclass,
        level,
        skillChoiceOptions,
        skillChoiceCount,
        spellcastingAbility,
      },
    ],
    raceId,
    raceName: infoRace,
    raceTypeName,
    backgroundId,
    backgroundName: infoBackground,
    backgroundSkillNames,
    alignment: infoAlignment,
    experiencePoints,
    abilities,
    proficiencyBonus: proficiencyBonusStr,
    inspiration,
    savingThrowProfs,
    skillProfs,
    armorClass: armorClassStr,
    initiative: "",
    speed: speedStr,
    hitPointMax: hitPointMaxStr,
    hitPointsCurrent: hitPointCurrentStr || hitPointMaxStr,
    hitPointsTemp: hitPointsTempStr,
    hitPointMaxTemp: "",
    hitDice: hitDieDigits ? `${level}к${hitDieDigits}` : "",
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    attacks,
    equipmentSections: equipmentItems.length ? [{ name: "Снаряжение", items: equipmentItems }] : [],
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
    spellsByLevel: new Array(9).fill(null).map(() => [] as unknown[]),
    notes: notesSections.join("\n\n"),
    manualAcBonus: "",
    resourceUsed: {},
    resourceBonus: {},
  };

  return { characterName: name, shortText, fullText, characterData, warnings };
}
