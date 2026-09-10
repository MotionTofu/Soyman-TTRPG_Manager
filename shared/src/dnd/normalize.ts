/**
 * Нормализация сохранённого листа персонажа — барьер совместимости форматов.
 *
 * Переехала из `client/src/components/dnd/DndCharacterForm.tsx` 2026-09-10.
 * Пока она жила внутри React-файла на 11 751 строку, сервер физически не мог
 * её позвать — и СЕМЬ серверных мест разбирали тот же JSON сырым, без единой
 * из перечисленных ниже миграций.
 *
 * Что чинится при чтении: `classAndLevel` строкой → строка класса; булев
 * `skillProfs` → 0/1/2 и русские имена навыков → английские ключи; свободный
 * текст снаряжения → позиции; `race`/`background` → `raceName`/`backgroundName`;
 * `featuresTraits` → `specialAbilities`; `proficienciesLanguages` строкой →
 * список; `alwaysPrepared: boolean` → `prepared: 0|2`; legacy `speed: "30 фт."`
 * → `speeds.walk`.
 */
import type {
  DndCharacterData,
  DndClassEntry,
  DndSkillProfLevel,
  DndSpellEntry,
  DndEquipmentItem,
  DndEquipmentSection,
  DndFeature,
  DndProficiencyEntry,
  DndManualAttack,
  DndMasteredWeapon,
  DndPinnedAction,
  DndCompanion,
} from "./types";
import { emptyAbilities, emptySavingThrowProfs, emptySkillProfs } from "./abilities";
import { resolveSkillOriginal } from "./skillCatalog";
import { emptySpeed } from "./creature";
import { ensureEquipmentIds, makeEquipmentId } from "./equipment";

export const SPELL_LEVELS = 9;

export function emptyDndCharacter(): DndCharacterData {
  return {
    systemId: null,
    characterName: "",
    playerName: "",
    classes: [],
    raceId: null,
    raceName: "",
    raceTypeName: "",
    backgroundId: null,
    backgroundName: "",
    backgroundSkillNames: [],
    alignment: "",
    experiencePoints: "",
    abilities: emptyAbilities(),
    proficiencyBonus: "+2",
    inspiration: false,
    savingThrowProfs: emptySavingThrowProfs(),
    skillProfs: emptySkillProfs(),
    armorClass: "",
    initiative: "",
    speed: "",
    speeds: emptySpeed(),
    sensesList: [],
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    conditions: [],
    hitPointMax: "",
    hitPointsCurrent: "",
    hitPointsTemp: "",
    hitPointMaxTemp: "",
    hitDice: "",
    hitDiceUsed: {},
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    exhaustion: 0,
    concentration: "",
    attacks: [],
    equipmentSections: [{ name: "Общее", items: [] }],
    attunementCount: 0,
    attunementExtra: 0,
    coins: { cp: "", sp: "", ep: "", gp: "", pp: "" },
    speciesFeatures: [],
    classFeatures: [],
    feats: [],
    specialAbilities: [],
    masteredWeapons: [],
    proficiencies: [],
    personalityTraits: "",
    ideals: "",
    bonds: "",
    flaws: "",
    spellcasting: "",
    spellDcMisc: "",
    spellAttackMisc: "",
    cantrips: [],
    spellSlotLevels: 0,
    spellSlotPips: Array(SPELL_LEVELS).fill(0),
    spellSlotsUsed: Array(SPELL_LEVELS).fill(0),
    spellsByLevel: Array.from({ length: SPELL_LEVELS }, () => []),
    notes: "",
    manualAcBonus: "",
    resourceUsed: {},
    resourceBonus: {},
    replicaSchemes: [],
    replicaItems: [],
    pinnedActions: [],
    companions: [],
  };
}

// Bridges old saved statblocks (single `classAndLevel`/`race`/`background`
// strings, free-text `savingThrows`/`skills`) into the new structured shape,
// so existing data keeps displaying instead of going blank after this change.
// Список имён навыков → список ключей, без дублей и без потерь: имя, которое
// не свелось, остаётся как есть и попадёт в строку «нет в справочнике».
function toSkillKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !v.trim()) continue;
    const key = resolveSkillOriginal(v) ?? v.trim();
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

export function normalizeDndCharacter(raw: unknown): DndCharacterData {
  const base = emptyDndCharacter();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const merged: DndCharacterData = { ...base, ...(r as Partial<DndCharacterData>) };
  // Листы, сохранённые до появления полей, приходят без них — а спред кладёт
  // undefined поверх умолчания, и дорожка костей падает на первом же чтении.
  if (!merged.hitDiceUsed || typeof merged.hitDiceUsed !== "object") merged.hitDiceUsed = {};
  if (typeof merged.concentration !== "string") merged.concentration = "";
  merged.exhaustion = Math.min(6, Math.max(0, Number(merged.exhaustion) || 0));

  if (!Array.isArray(merged.classes) || merged.classes.length === 0) {
    const legacy = typeof r.classAndLevel === "string" ? r.classAndLevel : "";
    merged.classes = legacy
      ? [{ classId: null, className: legacy, subclassId: null, subclassName: "", level: 1, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: "" }]
      : [];
  }
  // Older saved characters' class rows predate skillChoiceOptions/Count/spellcastingAbility.
  merged.classes = merged.classes.map((c) => ({
    ...c,
    skillChoiceOptions: toSkillKeys(c.skillChoiceOptions),
    skillChoiceCount: c.skillChoiceCount ?? 0,
    spellcastingAbility: c.spellcastingAbility ?? "",
  }));
  merged.backgroundSkillNames = toSkillKeys(merged.backgroundSkillNames);
  // Pre-existing attacks predate the timing field (Действие/Бонусное/Реакция/
  // Иное) — default them to "Действие" so they still show up in the "Бой"
  // tab's new sectioned layout instead of silently dropping out.
  merged.attacks = Array.isArray(merged.attacks)
    ? merged.attacks.map((a) => ({
        name: a.name,
        description: a.description,
        timing: (a as DndManualAttack).timing ?? "action",
        timingOther: (a as DndManualAttack).timingOther,
      }))
    : [];
  if (!merged.raceName && typeof r.race === "string") merged.raceName = r.race;
  if (!merged.backgroundName && typeof r.background === "string") merged.backgroundName = r.background;
  merged.abilities = { ...emptyAbilities(), ...(r.abilities as object | undefined) };
  merged.savingThrowProfs = { ...emptySavingThrowProfs(), ...(r.savingThrowProfs as object | undefined) };
  // skillProfs used to be a plain boolean map (proficient or not) — old
  // `true`/`false` values become 1/0 so they still work with the new
  // 0/1/2 (none/proficient/expertise) scale.
  //
  // И ключ: раньше это было русское имя, теперь английский `original`
  // (гриллинг 2026-09-04). Несводимое имя сохраняется как есть — лист
  // покажет его отдельной строкой с пометкой, а не потеряет молча.
  const rawSkillProfs = { ...emptySkillProfs(), ...(r.skillProfs as object | undefined) };
  const skillProfs: Record<string, DndSkillProfLevel> = {};
  for (const [rawKey, rawLevel] of Object.entries(rawSkillProfs)) {
    const key = resolveSkillOriginal(rawKey) ?? rawKey;
    const level = (typeof rawLevel === "boolean" ? (rawLevel ? 1 : 0) : rawLevel) as DndSkillProfLevel;
    // Два имени могли свестись в один ключ (например «Аркана» и «Магия» на
    // одном листе) — выигрывает большее владение, а не последнее прочитанное.
    skillProfs[key] = Math.max(skillProfs[key] ?? 0, level || 0) as DndSkillProfLevel;
  }
  merged.skillProfs = skillProfs;

  // Old saved statblocks kept Снаряжение as one free-text field — split it
  // into one item per non-empty line inside a single "Общее" section, so a
  // structured list appears immediately instead of losing the data.
  // Условие было «секций нет вовсе» — и не срабатывало НИКОГДА: пустой лист
  // отдаёт одну секцию «Общее», спред кладёт её поверх, длина всегда 1. То
  // есть перенос свободного текста был мёртвым кодом, и снаряжение старого
  // листа терялось молча. Найдено первым же тестом нормализации (2026-09-10);
  // на живой базе таких листов ноль, поэтому починка ничего не меняет на
  // экране — но перестаёт быть бомбой для чужой базы.
  const hasStructuredItems =
    Array.isArray(merged.equipmentSections) &&
    merged.equipmentSections.some((s) => Array.isArray(s?.items) && s.items.length > 0);
  if (!hasStructuredItems && typeof r.equipment === "string" && r.equipment.trim()) {
    const legacy = typeof r.equipment === "string" ? r.equipment : "";
    const items: DndEquipmentItem[] = legacy
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({ id: makeEquipmentId(), name, qty: "", weight: "", notes: "" }));
    merged.equipmentSections = [{ name: "Общее", items }];
  } else {
    // Старым строкам добить id, иначе ключи снова индексные. Секции могли
    // прийти не массивом — тогда берём пустой список, а не падаем.
    const sections = Array.isArray(merged.equipmentSections) ? merged.equipmentSections : [];
    merged.equipmentSections = sections.map((sec) => ({
      ...sec,
      items: ensureEquipmentIds(Array.isArray(sec.items) ? sec.items : []),
    }));
  }

  // Old saved statblocks kept one combined "featuresTraits" list — since we
  // can't know which of the 4 new categories each entry belongs to, they all
  // land in "Особые умения" (the catch-all 4th list) rather than being lost.
  if (
    (!Array.isArray(merged.specialAbilities) || merged.specialAbilities.length === 0) &&
    Array.isArray(r.featuresTraits) &&
    r.featuresTraits.length > 0
  ) {
    merged.specialAbilities = r.featuresTraits as DndFeature[];
  }
  merged.speciesFeatures = Array.isArray(merged.speciesFeatures) ? merged.speciesFeatures : [];
  merged.classFeatures = Array.isArray(merged.classFeatures) ? merged.classFeatures : [];
  merged.feats = Array.isArray(merged.feats) ? merged.feats : [];
  merged.specialAbilities = Array.isArray(merged.specialAbilities) ? merged.specialAbilities : [];
  merged.masteredWeapons = Array.isArray(merged.masteredWeapons)
    ? (merged.masteredWeapons as unknown[]).filter(
        (w): w is DndMasteredWeapon =>
          !!w && typeof w === "object" && typeof (w as { name?: unknown }).name === "string"
      )
    : [];

  if (!Array.isArray(merged.proficiencies) || merged.proficiencies.length === 0) {
    const legacy = typeof r.proficienciesLanguages === "string" ? r.proficienciesLanguages : "";
    merged.proficiencies = legacy ? [{ entryId: null, name: legacy, abilityKey: null }] : [];
  }
  const pips = Array.isArray(r.spellSlotPips) ? (r.spellSlotPips as number[]) : [];
  merged.spellSlotPips = Array.from({ length: SPELL_LEVELS }, (_, i) => pips[i] ?? 0);
  const used = Array.isArray(r.spellSlotsUsed) ? (r.spellSlotsUsed as number[]) : [];
  merged.spellSlotsUsed = Array.from({ length: SPELL_LEVELS }, (_, i) =>
    Math.min(used[i] ?? 0, merged.spellSlotPips[i])
  );
  const byLevel = Array.isArray(r.spellsByLevel) ? (r.spellsByLevel as DndSpellEntry[][]) : [];
  merged.spellsByLevel = Array.from({ length: SPELL_LEVELS }, (_, i) => (byLevel[i] ?? []).map(normalizeSpellEntry));
  merged.spellSlotLevels = Math.min(SPELL_LEVELS, Math.max(0, Number(r.spellSlotLevels) || 0));
  merged.cantrips = Array.isArray(r.cantrips) ? (r.cantrips as DndSpellEntry[]).map(normalizeSpellEntry) : [];
  merged.manualAcBonus = typeof merged.manualAcBonus === "string" ? merged.manualAcBonus : "";
  merged.hitPointMaxTemp = typeof merged.hitPointMaxTemp === "string" ? merged.hitPointMaxTemp : "";
  merged.resourceUsed = merged.resourceUsed && typeof merged.resourceUsed === "object" ? merged.resourceUsed : {};
  merged.resourceBonus = merged.resourceBonus && typeof merged.resourceBonus === "object" ? merged.resourceBonus : {};
  merged.replicaSchemes = Array.isArray(merged.replicaSchemes) ? merged.replicaSchemes : [];
  merged.replicaItems = Array.isArray(merged.replicaItems) ? merged.replicaItems : [];
  // Карта персонажа (2026-09-04). Всё три поля необязательны и у старых
  // листов отсутствуют — их отсутствие и есть рабочее состояние: закладки
  // лист предложит сам, спутников нет, портрет кадрируется по центру.
  merged.pinnedActions = Array.isArray(merged.pinnedActions)
    ? (merged.pinnedActions as DndPinnedAction[])
        .filter((p) => p && typeof p.name === "string" && p.name.trim())
        .slice(0, 3)
    : [];
  merged.companions = Array.isArray(merged.companions)
    ? (merged.companions as DndCompanion[]).filter((c) => c && typeof c.name === "string" && c.name.trim())
    : [];
  const focus = merged.portraitFocus as { x?: unknown; y?: unknown } | undefined;
  merged.portraitFocus =
    focus && typeof focus.x === "number" && typeof focus.y === "number"
      ? { x: Math.min(1, Math.max(0, focus.x)), y: Math.min(1, Math.max(0, focus.y)) }
      : undefined;
  // Монеты — отдельное поле (S-08). Старые листы его не имели — дефолт пустые строки.
  const rawCoins = r.coins as Record<string, unknown> | undefined;
  if (rawCoins && typeof rawCoins === "object") {
    merged.coins = {
      cp: typeof rawCoins.cp === "string" ? rawCoins.cp : "",
      sp: typeof rawCoins.sp === "string" ? rawCoins.sp : "",
      ep: typeof rawCoins.ep === "string" ? rawCoins.ep : "",
      gp: typeof rawCoins.gp === "string" ? rawCoins.gp : "",
      pp: typeof rawCoins.pp === "string" ? rawCoins.pp : "",
    };
  } else {
    merged.coins = { cp: "", sp: "", ep: "", gp: "", pp: "" };
  }
  merged.speeds = merged.speeds && typeof merged.speeds === "object" ? { ...emptySpeed(), ...merged.speeds } : emptySpeed();
  // Визард и смена вида раньше писали скорость только строкой speed
  // («30 фт.»), а кость читает speeds.walk — такие листы показывали «—»
  // в кости и число подписью. Подбираем ведущее число как ходьбу, но только
  // когда в строке нет вида скорости (та же эвристика, что у
  // parseLegacySpeed для существ): «полёт 60 фт.» ходьбой не станет.
  // Строку не трогаем — она остаётся данными, правит показ подпись ниже.
  if (merged.speeds.walk == null && typeof merged.speed === "string") {
    const num = /(\d+)/.exec(merged.speed);
    const hasKind = /пол[её]т|летит|плавани|плывёт|лазани|копани|рыть|ходьб|fly|swim|climb|burrow|walk/i.test(merged.speed);
    if (num && !hasKind) merged.speeds = { ...merged.speeds, walk: Number(num[1]) };
  }
  merged.sensesList = Array.isArray(merged.sensesList) ? merged.sensesList : [];
  merged.damageResistances = Array.isArray(merged.damageResistances) ? merged.damageResistances : [];
  merged.damageImmunities = Array.isArray(merged.damageImmunities) ? merged.damageImmunities : [];
  merged.damageVulnerabilities = Array.isArray(merged.damageVulnerabilities) ? merged.damageVulnerabilities : [];
  merged.conditionImmunities = Array.isArray(merged.conditionImmunities) ? merged.conditionImmunities : [];
  merged.conditions = Array.isArray(merged.conditions) ? merged.conditions : [];
  return merged;
}

// `alwaysPrepared: boolean` used to be the only prepared state — old `true`
// becomes "always prepared" (2), old `false`/missing becomes "not prepared" (0).
function normalizeSpellEntry(raw: DndSpellEntry & { alwaysPrepared?: boolean }): DndSpellEntry {
  if (typeof raw.prepared === "number") return raw;
  const { alwaysPrepared, ...rest } = raw;
  return { ...rest, prepared: alwaysPrepared ? 2 : 0 };
}

