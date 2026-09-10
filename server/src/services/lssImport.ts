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
  aliases: string;
  name_original: string | null;
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

function entryMatchesName(row: CompendiumEntryRow, target: string, targetBase: string): boolean {
  if (normalizeForMatch(row.name) === target) return true;
  if (targetBase !== target && normalizeForMatch(row.name) === targetBase) return true;
  return false;
}

// Алиасы и оригинальное имя — второй круг, после прямых имён: алиас
// никогда не перебивает запись, чьё имя совпало напрямую (тикет 03 —
// «Изобретатель» у Артефактора против LSS-названий).
function entryMatchesAlias(row: CompendiumEntryRow, target: string, targetBase: string): boolean {
  const candidates: string[] = [];
  if (row.name_original) candidates.push(row.name_original);
  try {
    const parsed: unknown = JSON.parse(row.aliases || "[]");
    if (Array.isArray(parsed)) {
      for (const a of parsed) if (typeof a === "string" && a) candidates.push(a);
    }
  } catch {
    // Битые aliases — игнор, имя всё равно уже проверено выше.
  }
  return candidates.some((n) => {
    const norm = normalizeForMatch(n);
    return norm === target || (targetBase !== target && norm === targetBase);
  });
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
  const pool: CompendiumEntryRow[] = [];
  for (const section of sections) {
    const entries = db
      .prepare(
        parentId === null
          ? "SELECT id, parent_id, kind, name, data, aliases, name_original FROM compendium_entries WHERE section_id = ? AND kind = ? AND parent_id IS NULL"
          : "SELECT id, parent_id, kind, name, data, aliases, name_original FROM compendium_entries WHERE section_id = ? AND kind = ? AND parent_id = ?"
      )
      .all(...(parentId === null ? [section.id, entryKind] : [section.id, entryKind, parentId])) as CompendiumEntryRow[];
    pool.push(...entries);
  }
  return pool.find((e) => entryMatchesName(e, target, targetBase))
    ?? pool.find((e) => entryMatchesAlias(e, target, targetBase))
    ?? null;
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

// Сколько link-marks в ProseMirror-доке: ссылки (next.dnd.su) не
// переносятся, но молчать об их потере нельзя (тикет 02).
function countLinkMarks(node: ProseNode | undefined): number {
  if (!node) return 0;
  let n = 0;
  if (Array.isArray(node.marks)) {
    for (const m of node.marks) {
      if ((m as { type?: unknown } | null)?.type === "link") n++;
    }
  }
  for (const c of node.content ?? []) n += countLinkMarks(c);
  return n;
}

// Заготовка LSS, а не оружие: placebo-строки вида {name:"",dmg:""} с
// timestamp-id отсекаются на месте (тикет 01): пустые дают "" и уходят
// фильтром ниже — иначе пустой лист хвастается «Оружие:\n- » в shortText.

// Подпись раздела: исходный customLabel LSS честнее нашего словаря —
// «Предметы, которые могу сделать:» не должны ложиться под «Союзники».
function blockLabel(key: string, block: unknown): string {
  const custom = (block as Record<string, unknown> | undefined)?.customLabel;
  if (typeof custom === "string" && custom) return custom;
  return SECTION_LABELS[key] ?? key;
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

// Владения inner-блока `data.prof` (НЕ путать с `data.text.prof` — та идёт в
// notes текстом). LSS-ключи → русские имена записей листа (тикет 02).
const PROF_LABELS: Record<string, string> = {
  "armor-light": "Лёгкие доспехи",
  "armor-medium": "Средние доспехи",
  "armor-heavy": "Тяжёлые доспехи",
  shield: "Щиты",
  "weapon-simple": "Простое оружие",
  "weapon-martial": "Воинское оружие",
};

// Подписи структурированной внешности `subInfo` (тикет 02).
const SUBINFO_LABELS: Record<string, string> = {
  age: "Возраст",
  height: "Рост",
  weight: "Вес",
  eyes: "Глаза",
  skin: "Кожа",
  hair: "Волосы",
};

export interface LssRawExtras {
  /** Неразобранные монеты / Prepare-ID / слоты — визард показывает сырьём, не гадает. */
  coinsRaw: unknown;
  preparedIds: string[];
  edition: string;
  proficiencySource: "inner" | "outer" | "explicit" | "calculated";
  slotsRaw: unknown;
  spellsInfo: { baseCode: string; availableClasses: string[] };
  sizeRaw: string;
  avatarJpeg: string;
  avatarWebp: string;
  bonusesRaw: Record<string, unknown>;
  /** Кастомные разделы без структурного дома (notes-*) — визард предлагает disposition. */
  homelessSections: { key: string; label: string; body: string }[];
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
  rawExtras: LssRawExtras;
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
  const rawProfBlock = (data.prof && typeof data.prof === "object" ? data.prof : {}) as Record<string, unknown>;
  const rawAttunements = Array.isArray(data.attunementsList) ? (data.attunementsList as unknown[]) : [];
  const rawCoinsInner = (data.coins && typeof data.coins === "object" ? data.coins : {}) as Record<string, unknown>;
  const rawCoinsOuter = (outerCoins && typeof outerCoins === "object" ? outerCoins : {}) as Record<string, unknown>;
  const subInfo = (data.subInfo && typeof data.subInfo === "object" ? data.subInfo : {}) as Record<string, unknown>;
  const spellsInfoBlock = (data.spellsInfo && typeof data.spellsInfo === "object" ? data.spellsInfo : {}) as Record<string, unknown>;
  const avatarBlock = (outerRec.avatar && typeof outerRec.avatar === "object" ? outerRec.avatar : {}) as Record<string, unknown>;
  // Аватар живёт то снаружи, то внутри data (Фридрих — внутри).
  const avatarInner = (
    (data as Record<string, unknown>).avatar && typeof (data as Record<string, unknown>).avatar === "object"
      ? (data as Record<string, unknown>).avatar
      : {}
  ) as Record<string, unknown>;
  const avatarStr = (b: Record<string, unknown>, k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");

  // Настроенные предметы: checked==true; плейсхолдеры (unchecked+пусто) мимо.
  const attunedNames = rawAttunements
    .map((a) => {
      const rec = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
      const checked = rec.checked === true;
      const value = typeof rec.value === "string" ? rec.value.trim() : "";
      return checked ? value : "";
    })
    .filter(Boolean);
  const attunementCount = rawAttunements.filter((a) => {
    const rec = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    return rec.checked === true;
  }).length;

  // Структурированная внешность довеском к text.appearance (тикет 02).
  const subInfoBody = Object.entries(SUBINFO_LABELS)
    .map(([k, label]) => {
      const v = getValue(subInfo, k);
      return v ? `${label}: ${v}` : "";
    })
    .filter(Boolean)
    .join("\n");

  // Helpers to read .value safely without `any`
  const infoRace = getValue(info, "race");
  const infoClass = getValue(info, "charClass");
  const infoSubclass = getValue(info, "charSubclass");
  const infoLevel = getValue(info, "level");
  const infoBackground = getValue(info, "background");
  const infoAlignment = getValue(info, "alignment");
  const infoPlayerName = getValue(info, "playerName");
  const infoSize = getValue(info, "size");
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
    getVitalValue("ac") ? `КЗ ${getVitalValue("ac")}` : "",
    getVitalValue("hp-max")
      ? `ХП ${getVitalValue("hp-current") || getVitalValue("hp-max")}/${getVitalValue("hp-max")}`
      : "",
    getVitalValue("speed") ? `Скорость ${getVitalValue("speed")} фт` : "",
    getVitalValue("hit-die") ? `Кость хитов ${getVitalValue("hit-die")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const weaponLines = weapons
    .map((w) => {
      const rec = w as Record<string, unknown>;
      const bits = [getValue(rec, "name"), getValue(rec, "mod"), getValue(rec, "dmg")].filter(Boolean);
      return bits.length ? "- " + bits.join(" ") : "";
    })
    .filter(Boolean);

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
      return `## ${blockLabel(key, block)}\n${body}`;
    })
    .filter(Boolean);

  // Бесхозные разделы для шага 7 визарда: есть тело, нет структурного поля.
  // Пятёрка из notes (appearance/quests/background/prof/allies) — не
  // бесхозные: они уже сложены в notes выше, повторное «→ в Заметки» дало бы дубль.
  const NOTED_KEYS = new Set(["appearance", "quests", "background", "prof", "allies"]);
  const homelessSections = restKeys
    .filter((key) => !NOTED_KEYS.has(key))
    .map((key) => {
      const block = text[key] as Record<string, unknown> | undefined;
      if (!block) return null;
      const body = textBlockValue(block);
      return body ? { key, label: blockLabel(key, block), body } : null;
    })
    .filter((s): s is { key: string; label: string; body: string } => s !== null);

  const fullText = [
    shortText,
    proficientSkills ? `Владение навыками: ${proficientSkills}` : "",
    "",
    sections.join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n");

  // Ссылки в тексте (обычно next.dnd.su): имена сохранились, кликабельность нет.
  const totalLinks = (Object.values(text) as unknown[]).reduce<number>((sum, block) => {
    const doc = (block as Record<string, unknown> | undefined)?.value as Record<string, unknown> | undefined;
    const pm = doc?.data;
    return sum + (pm && typeof pm === "object" ? countLinkMarks(pm as ProseNode) : 0);
  }, 0);
  if (totalLinks > 0) {
    warn("links", `В тексте ${totalLinks} ссылок (следы next.dnd.su) — переносятся имена без ссылок, проверьте названия.`);
  }

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
    return body ? [{ name: blockLabel(key, text[key]), description: body }] : [];
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
  // Внешность склеивается из text.appearance + subInfo; настройка — из attunementsList.
  const notesBodies: Record<string, string> = {};
  for (const key of ["appearance", "quests", "background", "prof", "allies"]) {
    notesBodies[key] = textBlockValue(text[key]);
  }
  if (subInfoBody) {
    notesBodies.appearance = [notesBodies.appearance, subInfoBody].filter(Boolean).join("\n");
  }
  const notesSections = Object.entries(notesBodies)
    .map(([key, body]) => (body ? `## ${blockLabel(key, text[key])}\n${body}` : ""))
    .filter(Boolean);
  if (attunedNames.length > 0) {
    notesSections.push(`## Настройка (${attunedNames.length})\n${attunedNames.map((n) => `- ${n}`).join("\n")}`);
  }
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
  let proficiencySource: LssRawExtras["proficiencySource"] = "calculated";
  const innerProficiency = (data as Record<string, unknown>).proficiency;
  const profNum =
    typeof innerProficiency === "number"
      ? innerProficiency
      : typeof outerProficiency === "number"
        ? outerProficiency
        : null;
  if (typeof profNum === "number" && profNum > 0) {
    proficiencyBonusStr = `+${profNum}`;
    proficiencySource = typeof innerProficiency === "number" ? "inner" : "outer";
  } else {
    const explicitBonusRaw =
      getValue(info, "proficiencyBonus") ||
      getValue(data as unknown as Record<string, unknown>, "proficiencyBonus") ||
      "";
    if (explicitBonusRaw) {
      const n = Number(String(explicitBonusRaw).replace(/[^\d-]/g, ""));
      proficiencyBonusStr = Number.isFinite(n) && n !== 0 ? (n > 0 ? `+${n}` : String(n)) : `+${proficiencyBonusForLevel(level)}`;
      if (Number.isFinite(n) && n !== 0) proficiencySource = "explicit";
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
  // Нулевые временные хиты — это «нет», а не «0»: лист показывал бы «0».
  const hitPointsTempRaw = getVitalValue("hp-temp") || getVitalValue("tempHp") || "";
  const hitPointsTempStr = hitPointsTempRaw && hitPointsTempRaw !== "0" ? hitPointsTempRaw : "";
  const armorClassStr = getVitalValue("ac");
  const speedStr = getVitalValue("speed");

  // Владения доспехами/оружием из inner-блока data.prof (тикет 02).
  const proficiencies: { entryId: null; name: string; abilityKey: null }[] = [];
  for (const [k, v] of Object.entries(rawProfBlock)) {
    const rec = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    if (!isProfTrue(rec.value)) continue;
    const label = PROF_LABELS[k];
    if (label) {
      proficiencies.push({ entryId: null, name: label, abilityKey: null });
    } else {
      proficiencies.push({ entryId: null, name: k, abilityKey: null });
      warn("prof", `Неизвестное владение «${k}» сохранено сырьём — проверьте и переименуйте.`);
    }
  }

  // Монеты: inner авторитетнее, outer — запасной (тикет 02, 156 ЗМ Фридриха).
  function coinStr(key: string): string {
    return getValue(rawCoinsInner, key) || getValue(rawCoinsOuter, key);
  }
  const coins = { cp: coinStr("cp"), sp: coinStr("sp"), ep: coinStr("ep"), gp: coinStr("gp"), pp: coinStr("pp") };

  const darkvisionNum = Number(getVitalValue("darkvision"));
  const sensesList =
    Number.isFinite(darkvisionNum) && darkvisionNum > 0
      ? [{ name: "Тёмное зрение", distance: `${darkvisionNum} фт.` }]
      : [];

  // Израсходованные кости хитов: уровень минус остаток (одна кость; нули опускаем).
  const hpDiceCurrentNum = Number(getVitalValue("hp-dice-current"));
  const hitDiceUsed: Record<string, number> =
    hitDieDigits && Number.isFinite(hpDiceCurrentNum) && hpDiceCurrentNum >= 0 && hpDiceCurrentNum < level
      ? { [`к${hitDieDigits}`]: level - hpDiceCurrentNum }
      : {};

  const spellcastingText = getValue(spellsInfoBlock, "base");
  const spellDcMiscText = getValue(spellsInfoBlock, "save");
  const spellAttackMiscText = getValue(spellsInfoBlock, "mod");
  const spellBaseRec = (
    spellsInfoBlock.base && typeof spellsInfoBlock.base === "object" ? spellsInfoBlock.base : {}
  ) as Record<string, unknown>;
  const spellAvailableRec = (
    spellsInfoBlock.available && typeof spellsInfoBlock.available === "object" ? spellsInfoBlock.available : {}
  ) as Record<string, unknown>;

  const rawExtras: LssRawExtras = {
    coinsRaw: (data as Record<string, unknown>).coins ?? outerCoins ?? null,
    preparedIds: (outerPrepared ?? []).map((s) => String(s)),
    edition: outerEdition,
    proficiencySource,
    slotsRaw: rawSpells && typeof rawSpells === "object" ? rawSpells : null,
    spellsInfo: {
      baseCode: typeof spellBaseRec.code === "string" ? spellBaseRec.code : "",
      availableClasses: Array.isArray(spellAvailableRec.classes)
        ? (spellAvailableRec.classes as unknown[]).filter((c): c is string => typeof c === "string")
        : [],
    },
    sizeRaw: infoSize,
    avatarJpeg: avatarStr(avatarBlock, "jpeg") || avatarStr(avatarInner, "jpeg"),
    avatarWebp: avatarStr(avatarBlock, "webp") || avatarStr(avatarInner, "webp"),
    homelessSections,
    bonusesRaw: {
      bonuses: (data as Record<string, unknown>).bonuses ?? null,
      bonusesSkills: (data as Record<string, unknown>).bonusesSkills ?? null,
      bonusesStats: (data as Record<string, unknown>).bonusesStats ?? null,
      resources: (data as Record<string, unknown>).resources ?? null,
      conditions: (data as Record<string, unknown>).conditions ?? null,
      wizardStep: (data as Record<string, unknown>).wizardStep ?? null,
      isDefault: (data as Record<string, unknown>).isDefault ?? null,
    },
  };

  const characterData = {
    systemId: dndSystemId,
    characterName: name,
    playerName: infoPlayerName,
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
    // Брошенного числа у импортированного листа быть не может — его называют
    // за столом. Ручная поправка к бонусу пустая: бонус считается сам.
    initiative: null,
    initiativeMisc: "",
    speed: speedStr,
    sensesList,
    hitPointMax: hitPointMaxStr,
    hitPointsCurrent: hitPointCurrentStr || hitPointMaxStr,
    hitPointsTemp: hitPointsTempStr,
    hitPointMaxTemp: "",
    hitDice: hitDieDigits ? `${level}к${hitDieDigits}` : "",
    hitDiceUsed,
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    attacks,
    equipmentSections: equipmentItems.length ? [{ name: "Снаряжение", items: equipmentItems }] : [],
    attunementCount,
    coins,
    speciesFeatures: featureBlock("features"),
    classFeatures: featureBlock("traits"),
    feats: featureBlock("feats"),
    specialAbilities: [],
    proficiencies,
    personalityTraits: textBlockValue(text.personality),
    ideals: textBlockValue(text.ideals),
    bonds: textBlockValue(text.bonds),
    flaws: textBlockValue(text.flaws),
    spellcasting: spellcastingText,
    spellDcMisc: spellDcMiscText,
    spellAttackMisc: spellAttackMiscText,
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

  return { characterName: name, shortText, fullText, characterData, rawExtras, warnings };
}
