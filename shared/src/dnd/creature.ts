/**
 * Пустые значения для полей статблока существа. Вынесены из
 * `client/src/components/dnd/DndCreatureForm.tsx`: `emptyDndCharacter`
 * пользуется `emptySpeed`, а тянуть ради этого React-файл в общий пакет
 * нельзя.
 */
import type {
  DndCreatureAction,
  DndCreatureArmorClass,
  DndCreatureData,
  DndCreatureHitPoints,
  DndCreatureLegendary,
  DndCreatureLoot,
  DndCreatureSpeed,
  DndCreatureSpellcasting,
  DndLegendaryActionEntry,
} from "./types";
import { ABILITY_NAME_TO_KEY, emptyAbilities, emptySavingThrowProfs } from "./abilities";
import { resolveSkillOriginal, skillByOriginal } from "./skillCatalog";
import { capitalize, parseCreatureMeta } from "./creatureMeta";

export function emptySpeed(): DndCreatureSpeed {
  return { walk: null, fly: null, swim: null, climb: null, burrow: null, hover: false, note: "" };
}

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

/**
 * Класс опасности к каноническому виду. Старые снапшоты и легаси-импорты
 * пишут дробь десятичной («0.5» вместо «1/2»), а фильтр раздела и группы
 * «По КО» сверяются с каноническим списком CHALLENGE_RATINGS — сравнивать
 * надо нормализованное значение, а не исходную строку. Заодно срезается
 * хвост «(100 опыта)», который проскакивал из книги.
 */
export function normaliseCr(raw: unknown): string {
  let s = String(raw ?? "").trim().replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (s === "0.5") return "1/2";
  if (s === "0.25") return "1/4";
  if (s === "0.125") return "1/8";
  return s;
}

export function crToNumber(cr: string): number {
  const c = normaliseCr(cr);
  if (c === "1/8") return 0.125;
  if (c === "1/4") return 0.25;
  if (c === "1/2") return 0.5;
  const n = Number(c);
  return Number.isFinite(n) ? n : 0;
}

// Standard 5e challenge-rating -> proficiency-bonus table.
export function computeProficiencyBonusForCR(cr: string): number {
  const n = crToNumber(cr);
  if (n <= 4) return 2;
  if (n <= 8) return 3;
  if (n <= 12) return 4;
  if (n <= 16) return 5;
  if (n <= 20) return 6;
  if (n <= 24) return 7;
  if (n <= 28) return 8;
  return 9;
}

export function emptyHitPoints(): DndCreatureHitPoints {
  return { diceCount: null, dieSize: null, bonus: null, formula: "" };
}

export function emptyArmorClass(): DndCreatureArmorClass {
  return { value: null, note: "" };
}

export function emptySpellcasting(): DndCreatureSpellcasting {
  return { enabled: false, ability: "", slots: [], spells: [] };
}

export function emptyLegendary(): DndCreatureLegendary {
  return {
    resistanceEnabled: false,
    resistanceCount: null,
    actionsEnabled: false,
    actionPoints: null,
    actions: [],
    lairEnabled: false,
    lairActions: [],
  };
}

export function emptyCreature(): DndCreatureData {
  return {
    name: "",
    size: "Средний",
    creatureType: "",
    creatureTags: "",
    alignment: "",
    armorClass: emptyArmorClass(),
    hitPoints: emptyHitPoints(),
    speed: emptySpeed(),
    initiativeBonus: null,
    challenge: { rating: "", proficiencyBonus: null },
    abilities: emptyAbilities(),
    savingThrowProfs: emptySavingThrowProfs(),
    skillProfs: {},
    damageVulnerabilities: [],
    damageResistances: [],
    damageImmunities: [],
    conditionImmunities: [],
    saveAdvantageConditions: [],
    saveAdvantageMagic: false,
    defenseNotes: "",
    sensesList: [],
    perceptionNote: "",
    passivePerception: null,
    languages: "",
    spellcasting: emptySpellcasting(),
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendary: emptyLegendary(),
    habitat: "",
    treasure: "",
    equipment: [],
    loot: { items: [], currency: [] },
    notes: "",
  };
}

function toLegacyList(current: unknown, legacyRaw: unknown): string[] {
  if (Array.isArray(current) && current.length > 0) return current as string[];
  const list = typeof legacyRaw === "string" && legacyRaw.trim() ? legacyRaw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean) : [];
  if (list.length > 0) return list;
  return Array.isArray(current) ? (current as string[]) : [];
}

const SPEED_KEYWORDS: { re: RegExp; key: "walk" | "fly" | "swim" | "climb" | "burrow" }[] = [
  { re: /пол[её]т|летит|fly/i, key: "fly" },
  { re: /плавани|плывёт|swim/i, key: "swim" },
  { re: /лазани|climb/i, key: "climb" },
  { re: /копани|рыть|burrow/i, key: "burrow" },
  { re: /ходьб|walk/i, key: "walk" },
];

function parseLegacySpeed(text: string): DndCreatureSpeed {
  const speed = emptySpeed();
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const leftovers: string[] = [];
  parts.forEach((part, i) => {
    const numMatch = /(\d+)/.exec(part);
    const value = numMatch ? Number(numMatch[1]) : null;
    const matched = SPEED_KEYWORDS.find((k) => k.re.test(part));
    if (matched && value !== null) {
      speed[matched.key] = value;
      if (/паря|hover/i.test(part)) speed.hover = true;
    } else if (value !== null && i === 0 && speed.walk === null) {
      // A bare leading number with no keyword is almost always walking speed
      // (legacy "30 фт., полёт 60 фт." style entries).
      speed.walk = value;
    } else {
      leftovers.push(part);
    }
  });
  speed.note = leftovers.join(", ");
  return speed;
}

const AC_RE = /^(\d+)\s*\(?([^)]*)\)?/;
// Минус книги — типографский («1к4 − 1»), не дефис.
const HIT_DICE_RE = /(\d+)\s*[кdD](\d+)\s*([+\-−–]\s*\d+)?/;

// Bridges old saved creature statblocks (free-text АС/ХП/скорость/размер-
// тип-мировоззрение/КО/чувства/урон-состояния) into the new structured
// shape, so existing data keeps displaying instead of going blank — mirrors
// normalizeDndCharacter's approach in this same directory.
export function normalizeDndCreature(raw: unknown): DndCreatureData {
  const base = emptyCreature();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const merged: DndCreatureData = { ...base, ...(r as Partial<DndCreatureData>) };

  if (typeof r.armorClass === "string") {
    const m = AC_RE.exec(r.armorClass.trim());
    merged.armorClass = m ? { value: Number(m[1]) || null, note: (m[2] || "").trim() } : { value: null, note: r.armorClass };
  } else {
    merged.armorClass = { ...base.armorClass, ...((r.armorClass as object) ?? {}) };
  }

  if (typeof r.hitPoints === "string") {
    const m = HIT_DICE_RE.exec(r.hitPoints);
    merged.hitPoints = m
      ? {
          diceCount: Number(m[1]) || null,
          dieSize: Number(m[2]) || null,
          bonus: m[3] ? Number(m[3].replace(/\s/g, "").replace(/[−–]/, "-")) : null,
          formula: r.hitPoints,
        }
      : { diceCount: null, dieSize: null, bonus: null, formula: r.hitPoints };
  } else {
    merged.hitPoints = { ...base.hitPoints, ...((r.hitPoints as object) ?? {}) };
  }

  if (typeof r.speed === "string") {
    merged.speed = r.speed ? parseLegacySpeed(r.speed) : base.speed;
  } else {
    merged.speed = { ...base.speed, ...((r.speed as object) ?? {}) };
  }

  // r.size/creatureType/alignment being absent (rather than merged.size,
  // which is already non-empty from emptyCreature()'s "Средний" default) is
  // what actually distinguishes "never set" from "explicitly set" here.
  if (!r.size && !r.creatureType && !r.alignment && typeof r.sizeTypeAlignment === "string" && r.sizeTypeAlignment) {
    // Тот же разбор, что у импортёра: запятая внутри скобок («(человек,
    // перевёртыш)») не отделяет мировоззрение, размер узнаётся в любом роде.
    const meta = parseCreatureMeta(r.sizeTypeAlignment);
    const head = r.sizeTypeAlignment.split(/,(?![^(]*\))/)[0];
    merged.size = meta.size || "Средний";
    merged.creatureType = meta.type || capitalize(meta.unknownType);
    merged.creatureTags = /\(([^)]*)\)/.exec(head)?.[1]?.trim() ?? "";
    merged.alignment = capitalize(meta.alignment);
  }
  if (!merged.size) merged.size = "Средний";

  if ((!merged.challenge || !merged.challenge.rating) && typeof r.challengeRating === "string" && r.challengeRating) {
    merged.challenge = { rating: r.challengeRating, proficiencyBonus: computeProficiencyBonusForCR(r.challengeRating) };
  } else {
    merged.challenge = { ...base.challenge, ...((r.challenge as object) ?? {}) };
  }

  if ((!Array.isArray(merged.sensesList) || merged.sensesList.length === 0) && typeof r.senses === "string" && r.senses) {
    merged.sensesList = r.senses
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((part) => {
        const m = /^(.*?)(\d+)\s*фт\.?$/.exec(part);
        return m ? { name: m[1].trim(), distance: m[2] } : { name: part, distance: "" };
      });
  } else {
    merged.sensesList = Array.isArray(merged.sensesList) ? merged.sensesList : [];
  }

  merged.damageVulnerabilities = toLegacyList(merged.damageVulnerabilities, r.damageVulnerabilities);
  merged.damageResistances = toLegacyList(merged.damageResistances, r.damageResistances);
  merged.damageImmunities = toLegacyList(merged.damageImmunities, r.damageImmunities);
  merged.conditionImmunities = toLegacyList(merged.conditionImmunities, r.conditionImmunities);
  merged.saveAdvantageConditions = Array.isArray(merged.saveAdvantageConditions) ? merged.saveAdvantageConditions : [];

  merged.savingThrowProfs = { ...emptySavingThrowProfs(), ...((r.savingThrowProfs as object) ?? {}) };
  // Ключ у существа остаётся именем навыка (в отличие от листа персонажа, где
  // он стал английским `original`), но само имя могло смениться: «Магия» →
  // «Арканная магия», «Анализ» → «Анализ/расследование» (гриллинг 2026-09-04).
  // Сводим через каталог, иначе отметка остаётся в данных и пропадает с глаз.
  const rawCreatureSkills =
    typeof r.skillProfs === "object" && r.skillProfs ? (r.skillProfs as Record<string, boolean>) : {};
  merged.skillProfs = {};
  for (const [rawName, on] of Object.entries(rawCreatureSkills)) {
    const original = resolveSkillOriginal(rawName);
    const name = original ? skillByOriginal(original)?.name ?? rawName : rawName;
    merged.skillProfs[name] = merged.skillProfs[name] || !!on;
  }

  // Импортированные записи бестиария несут владения списками полных русских
  // названий (`savingThrowProficiencies: ["Ловкость", "Мудрость"]`,
  // `skillProficiencies`), а структурных `savingThrowProfs`/`skillProfs` у них
  // нет. Без этого разбора у всего импортированного бестиария не залита ни
  // одна кость характеристики и пуста строка навыков, хотя данные лежат
  // рядом. Своё значение всегда сильнее: разбор идёт, только если структурного
  // владения ещё нет.
  const legacySaveProfs = Array.isArray(r.savingThrowProficiencies) ? r.savingThrowProficiencies : null;
  if (legacySaveProfs && !Object.values(merged.savingThrowProfs).some(Boolean)) {
    for (const raw of legacySaveProfs) {
      if (typeof raw !== "string") continue;
      const key = ABILITY_NAME_TO_KEY[raw.trim()];
      if (key) merged.savingThrowProfs[key] = true;
    }
  }
  const legacySkillProfs = Array.isArray(r.skillProficiencies) ? r.skillProficiencies : null;
  if (legacySkillProfs && Object.keys(merged.skillProfs).length === 0) {
    // Навыки в импорте написаны в своём регистре («Внимание/Восприятие»
    // против «Внимание/восприятие» в справочнике), поэтому сверяем без него.
    // Через каталог: он знает не только регистр, но и другие написания —
    // «Восприятие», «Аркана», «Обращение с животными» и прочие переводы.
    for (const raw of legacySkillProfs) {
      if (typeof raw !== "string") continue;
      const original = resolveSkillOriginal(raw);
      const skill = original ? skillByOriginal(original)?.name : undefined;
      if (skill) merged.skillProfs[skill] = true;
    }
  }

  // Текстовые «старые данные» дописываются в примечание, ТОЛЬКО пока владение
  // не разобрано структурно: иначе те же спасброски печатались бы дважды —
  // залитой костью и строкой под ней.
  let defenseNotes = typeof merged.defenseNotes === "string" ? merged.defenseNotes : "";
  if (
    typeof r.skills === "string" && r.skills &&
    Object.keys(merged.skillProfs).length === 0 &&
    !defenseNotes.includes(r.skills)
  ) {
    defenseNotes = [defenseNotes, `Навыки (старые данные): ${r.skills}`].filter(Boolean).join("\n");
  }
  if (
    typeof r.savingThrows === "string" && r.savingThrows &&
    !Object.values(merged.savingThrowProfs).some(Boolean) &&
    !defenseNotes.includes(r.savingThrows)
  ) {
    defenseNotes = [defenseNotes, `Спасброски (старые данные): ${r.savingThrows}`].filter(Boolean).join("\n");
  }
  // Те же две строки могли быть дописаны прежней нормализацией и УЖЕ лежать
  // в сохранённом примечании. Раз владение теперь разобрано структурно, они
  // повторяют залитую кость и строку навыков — снимаем их при чтении (в базе
  // ничего не переписывается, пока Мастер сам не сохранит запись).
  if (Object.values(merged.savingThrowProfs).some(Boolean) || Object.keys(merged.skillProfs).length > 0) {
    defenseNotes = defenseNotes
      .split(/\r?\n/)
      .filter((line) => !/^(Навыки|Спасброски) \(старые данные\):/.test(line.trim()))
      .join("\n")
      .trim();
  }
  merged.defenseNotes = defenseNotes;

  merged.spellcasting =
    merged.spellcasting && typeof merged.spellcasting === "object" && "enabled" in merged.spellcasting
      ? { ...base.spellcasting, ...(merged.spellcasting as object) }
      : base.spellcasting;

  merged.traits = Array.isArray(merged.traits) ? merged.traits : [];
  merged.actions = migrateLegacyActions(merged.actions);
  merged.bonusActions = migrateLegacyActions(merged.bonusActions);
  merged.reactions = migrateLegacyActions(merged.reactions);

  // Old saved creatures kept legendary actions as a flat DndFeature[] with
  // no point economy at all — migrate into the new `legendary.actions`
  // (cost defaults to 1, the most common 5e value) and flip actionsEnabled
  // on so the migrated rows are actually visible; everything else in
  // `legendary` (resistances/lair) simply defaults to disabled/empty.
  const legacyLegendaryActions = Array.isArray(r.legendaryActions) ? r.legendaryActions : null;
  if (legacyLegendaryActions && legacyLegendaryActions.length > 0 && (!merged.legendary || !Array.isArray(merged.legendary.actions) || merged.legendary.actions.length === 0)) {
    merged.legendary = {
      ...emptyLegendary(),
      actionsEnabled: true,
      actions: legacyLegendaryActions.map((f: unknown) => migrateLegacyAction(f, 1) as DndLegendaryActionEntry),
    };
  } else {
    const legacy = (merged.legendary as Partial<DndCreatureLegendary>) ?? {};
    merged.legendary = {
      ...emptyLegendary(),
      ...legacy,
      actions: Array.isArray(legacy.actions) ? legacy.actions : [],
      lairActions: migrateLegacyActions(legacy.lairActions),
    };
  }

  merged.equipment = Array.isArray(merged.equipment) ? merged.equipment : [];
  const legacyLoot = merged.loot as Partial<DndCreatureLoot> | undefined;
  merged.loot = {
    items: Array.isArray(legacyLoot?.items) ? legacyLoot!.items : [],
    currency: Array.isArray(legacyLoot?.currency) ? legacyLoot!.currency : [],
  };
  // Точка фокуса портрета (этап 9): та же нормализация, что у персонажа —
  // доли с зажимом в [0, 1], мусор превращается в отсутствие.
  const focus = merged.portraitFocus as { x?: unknown; y?: unknown } | undefined;
  merged.portraitFocus =
    focus && typeof focus.x === "number" && typeof focus.y === "number"
      ? { x: Math.min(1, Math.max(0, focus.x)), y: Math.min(1, Math.max(0, focus.y)) }
      : undefined;

  return merged;
}

// A legacy row is a plain {name, description} — anything already carrying
// `category` is assumed already-migrated and passed through untouched, so
// this is safe to re-run on already-current data too.
function migrateLegacyAction(raw: unknown, extraCost?: number): DndCreatureAction {
  const f = (raw && typeof raw === "object" ? raw : {}) as Partial<DndCreatureAction> & { name?: string; description?: string };
  if (f.category) return f as DndCreatureAction;
  // Остальные поля — как были: у старого действия без категории могут быть
  // запас (`uses`) и «накладывает» (`inflicts`) из разовых миграций.
  const base: DndCreatureAction = { ...f, name: f.name ?? "", category: "other", description: f.description ?? "" };
  return extraCost !== undefined ? ({ ...base, cost: extraCost } as DndLegendaryActionEntry) : base;
}

function migrateLegacyActions(list: unknown): DndCreatureAction[] {
  if (!Array.isArray(list)) return [];
  return list.map((f) => migrateLegacyAction(f));
}

