import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type {
  CompendiumEntry,
  DndAbilityKey,
  DndActionTiming,
  DndCharacterData,
  DndCoins,
  DndCompanion,
  DndCreatureSpeed,
  DndPinnedAction,
  DndReplicaItem,
  Statblock,
  DndReplicaScheme,
  DndClassEntry,
  DndEquipmentItem,
  DndEquipmentSection,
  DndFeature,
  DndManualAttack,
  DndProficiencyEntry,
  DndSkillProfLevel,
  DndSpellEntry,
  DndSpellPreparedState,
  SearchResult,
  System,
} from "../../types";
import {
  ABILITY_LABELS,
  ABILITY_NAME_TO_KEY,
  abilityModifier,
  characterSpellcastingAbility,
  classSkillChoiceTotal,
  classSkillPool,
  computeProficiencyBonus,
  emptyAbilities,
  emptySavingThrowProfs,
  emptySkillProfs,
  formatModifier,
  parseAbilityNames,
  parseBonus,
  SKILLS_BY_ABILITY,
  totalCharacterLevel,
} from "./AbilityScores";
import {
  AbilitySavesSkillsEdit,
  AbilitySavesSkillsView,
  computed as computeSkillValue,
  SKILL_DOTS,
  SKILL_TITLES,
} from "./AbilitySavesSkills";
import { skillSourceClass, skillSourceWord } from "./skillSource";
import { resolveSkillOriginal } from "./skillCatalog";
import { useDndSkills, type DndSkills, type SkillRow } from "./useDndSkills";
import { formatDistance, loadDndPrefs, saveDndPrefs, type DndDistanceUnit } from "../../dndPrefs";
import {
  loadDndBackgroundOptions,
  loadDndClassFeatures,
  loadDndClassHierarchy,
  loadDndClassProgressions,
  loadDndEquipmentEntries,
  loadDndSpeciesFeatures,
  loadDndSpeciesOptions,
  loadDndSpellsByLevel,
  loadDndSpellIndex,
  type DndBackgroundOption,
  type DndClassHierarchy,
  type DndSpeciesOption,
  type DndSpellOption,
} from "./dndCompendium";
import {
  checkLabel,
  checksLabel,
  costSummary,
  effectsLabel,
  hasResolvableEffect,
  type DndCheck,
  type DndCost,
  type DndEffect,
} from "./effects";
import { useCompendiumEntries } from "./useCompendiumEntries";
import { sheetClassColor, textOnClassColor } from "./dndClassColors";
import { DndDie } from "./DndDie";
import { EMPTY_EQUIPMENT_ITEM, fetchEquipmentMeta } from "./dndEquipment";
import { ensureEntries, getCachedEntry, hasFailedEntries, retryFailedEntries } from "./entryCache";
import { casterKind, computeSpellSlots, effectiveCasterLevel, highestCircle } from "./dndSlots";
import { cantripsAtLevel, preparedAtLevel, type ClassProgression } from "./progression";
import { AutoFeatureListEdit, FeatureListEdit } from "./FeatureList";
import { PipTrack } from "../litm/PipTrack";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { MentionText } from "../mentions/MentionText";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { useBag } from "../../bag";
import { computeArmorClass } from "./armorClass";
import { EMPTY_GRANTS, grantsFromEntry, mergeGrants, type SourceGrants } from "./dndGrants";
import {
  allResources,
  applicableStats,
  replicaLimits,
  type ClassResourceSource,
  type DndResourceDef,
  type ReplicaLimits,
  type ReplicateScheme,
} from "./dndResources";
import { Modal } from "../Modal";
import { useConfirm } from "../../hooks/useConfirm";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useDndPrefs } from "../../hooks/useDndPrefs";
import { useEvent, useLatest } from "../../hooks/useEvent";
import { featuresFromEntries, inferTimingFromLegacyText, spellTimingFromData, TIMING_KEY_TO_LABEL } from "./dndFeatures";
import { ChecklistEditor, emptySpeed, formatSpeed, SensesEditor, SpeedEditor } from "./DndCreatureForm";
import { errorMessage, findDndSystemId, isAbortError, loadDndMechanicsGroup, type DndMechanicsOption } from "./dndCompendium";
import { useTabState } from "../../hooks/useTabState";
import { classAndLevelSummary } from "./dndSummary";
import { NavIcon } from "../NavIcons";

const SPELL_LEVELS = 9;
const MAX_SPELL_SLOTS = 6;

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
    coins: { cp: "", sp: "", ep: "", gp: "", pp: "" },
    speciesFeatures: [],
    classFeatures: [],
    feats: [],
    specialAbilities: [],
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
  if (!Array.isArray(merged.equipmentSections) || merged.equipmentSections.length === 0) {
    const legacy = typeof r.equipment === "string" ? r.equipment : "";
    const items: DndEquipmentItem[] = legacy
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({ name, qty: "", weight: "", notes: "" }));
    merged.equipmentSections = [{ name: "Общее", items }];
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

function hitDieNumber(hitDie: string): number {
  const n = parseInt(hitDie.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

// "Воин 3 к10 + Волшебник 4 к6" style summary, used both to auto-fill the
// hit dice field (requirement 8) and for the header/meta line.
// Пулы костей хитов по кубам. При мультиклассе они независимы (5к10 + 3к6):
// тратятся по отдельности, и подпись куба игроку нужна перед тратой — иначе
// он не знает, что именно бросает.
interface HitDicePool {
  die: string; // «к10»
  total: number;
  used: number;
}

// Разбирается сохранённая строка костей («5к10 + 3к6»), а не кэш иерархии
// классов: кэш наполняется только когда открыта панель правки происхождения,
// а дорожки нужны на листе, который просто читают.
function hitDicePools(hitDice: string, used: Record<string, number>): HitDicePool[] {
  const byDie = new Map<string, number>();
  for (const part of (hitDice || "").split("+")) {
    const m = /^\s*(\d+)\s*[ккдkd]\s*(\d+)\s*$/i.exec(part);
    if (!m) continue;
    const count = Number(m[1]);
    if (!count) continue;
    const die = "к" + m[2];
    byDie.set(die, (byDie.get(die) ?? 0) + count);
  }
  return [...byDie.entries()].map(([die, total]) => ({
    die,
    total,
    used: Math.min(Math.max(used[die] ?? 0, 0), total),
  }));
}

// Длинный отдых возвращает половину общего числа костей, минимум одну
// (PHB 2024). Считается от всего запаса, а не по каждому пулу отдельно, и
// возвращается сначала тем пулам, где потрачено больше.
function restoreHitDiceOnLongRest(pools: HitDicePool[]): Record<string, number> {
  const total = pools.reduce((n, p) => n + p.total, 0);
  let back = Math.max(1, Math.floor(total / 2));
  const next: Record<string, number> = {};
  for (const p of pools) next[p.die] = p.used;
  const order = [...pools].sort((a, b) => b.used - a.used);
  let moved = true;
  while (back > 0 && moved) {
    moved = false;
    for (const p of order) {
      if (back <= 0) break;
      if (next[p.die] > 0) {
        next[p.die] -= 1;
        back -= 1;
        moved = true;
      }
    }
  }
  return next;
}

function computeHitDice(classes: DndClassEntry[]): string {
  return classes
    .filter((c) => c.level > 0)
    .map((c) => {
      const hierarchyDie = classHitDieCache.get(c.classId ?? -1);
      const die = hierarchyDie ? hitDieNumber(hierarchyDie) : 0;
      return die ? `${c.level}к${die}` : "";
    })
    .filter(Boolean)
    .join(" + ");
}

// Populated as class hierarchies load, so computeHitDice (called from onChange
// handlers without async access) can look up a class's hit die synchronously.
const classHitDieCache = new Map<number, string>();

// Поле, чей справочник не загрузился. Остаётся списком — нерабочим, но
// списком, и с кнопкой «Повторить». Свободный ввод на этом месте читается
// как «так и задумано»: мастер вписывает класс руками и теряет связь с
// компендиумом навсегда, а причина (сеть, права, упавший сервер) так и не
// названа (P1-Р8).
function CompendiumFieldError({
  current,
  error,
  onRetry,
}: {
  current: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <select disabled value="" style={{ flex: 1 }} title={`Справочник не загрузился: ${error}`}>
        <option value="">{current || "Справочник не загрузился"}</option>
      </select>
      <button type="button" className="comp-mini" onClick={onRetry} title={error}>
        Повторить
      </button>
    </span>
  );
}

// Picking a class also writes its "Владения навыками"/"Снаряжение А"/
// "Снаряжение Б" fields into the character's free-text Заметки (labeled, so
// the player can see where they came from), and removing the class removes
// that same block again. The block always starts with a "[Класс: Имя]"
// marker line so it can be found/removed later without touching the rest of
// the player's own notes.
const CLASS_NOTES_LABELS = ["Владения навыками:", "Снаряжение А:", "Снаряжение Б:"];

function classNotesMarker(className: string): string {
  return `[Класс: ${className}]`;
}

function buildClassNotesBlock(className: string, data: Record<string, unknown>): string {
  const skillChoice = Array.isArray(data.skill_choice_options) ? (data.skill_choice_options as string[]) : [];
  const equipmentA = typeof data.equipment_a === "string" ? data.equipment_a : "";
  const equipmentB = typeof data.equipment_b === "string" ? data.equipment_b : "";
  return [
    classNotesMarker(className),
    `Владения навыками: ${skillChoice.join(", ")}`,
    `Снаряжение А: ${equipmentA}`,
    `Снаряжение Б: ${equipmentB}`,
  ].join("\n");
}

function removeClassNotesBlock(notes: string, className: string): string {
  const marker = classNotesMarker(className);
  const lines = notes.split("\n");
  const idx = lines.findIndex((l) => l.trim() === marker);
  if (idx === -1) return notes;
  let end = idx + 1;
  while (end < lines.length && CLASS_NOTES_LABELS.some((label) => lines[end].startsWith(label))) end++;
  lines.splice(idx, end - idx);
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function upsertClassNotesBlock(notes: string, className: string, block: string): string {
  const cleaned = removeClassNotesBlock(notes, className).trim();
  return cleaned ? `${cleaned}\n\n${block}` : block;
}

// Removes any auto-filled features tagged with the given source id(s),
// keeping hand-added features (sourceParentId is unset) and features from
// other sources (other classes, in a multiclass character) untouched.
function removeFeaturesBySource(features: DndFeature[], ...sourceParentIds: (number | null | undefined)[]): DndFeature[] {
  const ids = new Set(sourceParentIds.filter((id): id is number => id != null));
  if (ids.size === 0) return features;
  return features.filter((f) => f.sourceParentId == null || !ids.has(f.sourceParentId));
}

// ---------------------------------------------------------------------------
// Снятие выданного при смене источника.
//
// Класс, подкласс и предыстория не только дают (особенности, спасброски,
// инструменты, навыки, черту происхождения) — их ещё и меняют. Раньше
// снимались только особенности (removeFeaturesBySource); всё остальное
// оставалось навсегда: три смены предыстории давали три черты в списке, а
// Волшебник, побывавший Воином, навсегда сохранял владение спасбросками Силы
// и Телосложения. Ниже — общий разбор «что дал этот источник», чтобы при
// смене снять ровно это и ровно тогда, когда того же не даёт никто другой.
/**
 * Снимает то, что давал ушедший источник, оставляя всё, что подтверждает
 * хоть один из оставшихся (`kept`) — иначе у мультикласса смена одного класса
 * забрала бы спасбросок, положенный по второму.
 *
 * Экспертизу (уровень 2) не трогаем: её ставит не предыстория, а игрок.
 */
function revokeGrants(
  value: DndCharacterData,
  revoked: SourceGrants,
  kept: SourceGrants[]
): Pick<DndCharacterData, "savingThrowProfs" | "proficiencies" | "skillProfs" | "feats"> {
  const keep = mergeGrants(kept);
  const savingThrowProfs = { ...value.savingThrowProfs };
  for (const k of revoked.savingThrows) {
    if (!keep.savingThrows.includes(k)) savingThrowProfs[k] = false;
  }
  const skillProfs = { ...value.skillProfs };
  for (const skill of revoked.skills) {
    if (keep.skills.includes(skill)) continue;
    if ((skillProfs[skill] ?? 0) === 1) skillProfs[skill] = 0;
  }
  const proficiencies = value.proficiencies.filter((p) => {
    const byId = p.entryId != null && revoked.toolIds.includes(p.entryId);
    const byName = !!p.name && revoked.toolNames.includes(p.name);
    if (!byId && !byName) return true;
    const keptById = p.entryId != null && keep.toolIds.includes(p.entryId);
    const keptByName = !!p.name && keep.toolNames.includes(p.name);
    return keptById || keptByName;
  });
  const feats = value.feats.filter(
    (f) => !revoked.featNames.includes(f.name) || keep.featNames.includes(f.name)
  );
  return { savingThrowProfs, proficiencies, skillProfs, feats };
}

// Записи всех источников, кроме уходящего: по ним решается, что оставить.
async function loadGrants(
  ids: (number | null | undefined)[],
  resolve: (raw: string) => string | null
): Promise<SourceGrants[]> {
  const real = ids.filter((id): id is number => typeof id === "number");
  if (real.length === 0) return [];
  await ensureEntries(real);
  return real.map((id) => grantsFromEntry(getCachedEntry(id), resolve));
}


const NARRATIVE_FIELDS: { key: keyof DndCharacterData; label: string }[] = [
  { key: "personalityTraits", label: "Черты характера" },
  { key: "ideals", label: "Идеалы" },
  { key: "bonds", label: "Привязанности" },
  { key: "flaws", label: "Слабости" },
];

const SPELL_PREPARED_TITLES = ["Не подготовлено", "Подготовлено", "Всегда подготовлено"];

// Prepared spells float to the top of their level's list, always-prepared
// ones above merely-prepared ones (stable within each group, so drag/search
// order otherwise stays put).
function sortSpells(spells: DndSpellEntry[]): DndSpellEntry[] {
  return [...spells].sort(
    (a, b) => b.prepared - a.prepared || a.name.localeCompare(b.name, "ru")
  );
}

// Requirement 7: Класс/Подкласс/Вид/Предыстория in view mode link to their
// compendium article when picked from a compendium (id known); freehand
// entries with no id just render as plain text.
function CompendiumLink({ id, children }: { id: number | null; children: ReactNode }) {
  if (!id) return <>{children}</>;
  return (
    <Link className="sb-compendium-link" to={`/compendium/${id}`}>
      {children}
    </Link>
  );
}

function readSearchDrop(e: DragEvent): SearchResult | null {
  const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SearchResult;
  } catch {
    return null;
  }
}

// Requirement 10: a droppable list for proficiencies/languages. Anything
// dragged from search (a compendium item, a mechanics-list tool/language
// entry, …) lands as a row; an ability can be assigned per row to compute
// its bonus (score modifier + proficiency bonus) — left unset, the row is
// just a plain proficiency/language name with no value (matching how
// languages don't have a "check").
function DndProficienciesView({
  value,
  onChange,
}: {
  value: DndProficiencyEntry[];
  onChange?: (v: DndProficiencyEntry[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  function commitAdd() {
    if (draft.trim()) onChange?.([...value, { entryId: null, name: draft.trim(), abilityKey: null }]);
    setDraft("");
    setAdding(false);
  }
  function remove(i: number) {
    onChange?.(value.filter((_, idx) => idx !== i));
  }
  if (value.length === 0 && !onChange) return null;
  return (
    <div className="sb-entry">
      <span className="sb-prop-label">Владения и языки</span>
      <div className="dnd-proficiency-chips">
        {value.map((p, i) => (
          <span key={i} className="dnd-proficiency-chip">
            {p.name}
            {onChange && (
              <button type="button" className="comp-mini" onClick={() => remove(i)} title="Убрать" aria-label="Убрать владение">
                <NavIcon name="close" />
              </button>
            )}
          </span>
        ))}
        {onChange &&
          (adding ? (
            <span className="row dnd-proficiency-chip-add">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitAdd();
                  if (e.key === "Escape") setAdding(false);
                }}
                onBlur={commitAdd}
                placeholder="Название…"
              />
            </span>
          ) : (
            <button type="button" className="comp-mini" onClick={() => setAdding(true)}>
              + добавить владение
            </button>
          ))}
      </div>
    </div>
  );
}

// One spell-level section: slot pips (requirement 11), a droppable/searchable
// spell list, and the always-prepared toggle (requirement 12).
// Builds the В/С/М component letters (only the ones that apply), with a
// tooltip on "М" showing the material component text (requirement 3).
function spellComponentLetters(
  s: Pick<DndSpellEntry, "componentV" | "componentS" | "componentM" | "materialComponent">
): ReactNode {
  if (!s.componentV && !s.componentS && !s.componentM) return null;
  return (
    <>
      {s.componentV && "В"}
      {s.componentS && "С"}
      {s.componentM && (
        <span title={s.materialComponent || undefined}>М</span>
      )}
    </>
  );
}

// "Школа | Время накладывания | компоненты | Концентрация | Ритуал" — only
// the pieces that apply, matching how the compendium editor shows spell
// flags (requirement 2 moves school/casting time into this same line).
function SpellMetaLine({ s }: { s: DndSpellEntry }) {
  const letters = spellComponentLetters(s);
  const parts: ReactNode[] = [];
  if (s.school) parts.push(s.school);
  const timingLabel = spellTimingLabel(s);
  if (timingLabel) parts.push(timingLabel);
  if (letters) parts.push(letters);
  if (s.ritual) parts.push("Ритуал");
  if (s.concentration) parts.push("Концентрация");
  // Броски и эффекты — из структуры; старые attackSave/damage/healing
  // остаются только как запасной путь для листов, сохранённых до перехода.
  if (s.checks && s.checks.length > 0) parts.push(s.checks.map((c) => checkLabel(c)).join(" / "));
  else if (s.attackSave) parts.push(s.attackSave);
  if (s.effects && s.effects.length > 0) {
    parts.push(<span title={s.upcast || undefined}>{effectsLabel(s.effects)}</span>);
  } else if (s.damage || s.healing) {
    parts.push(<span title={s.upcast || undefined}>{s.damage || `Лечение ${s.healing}`}</span>);
  }
  if (parts.length === 0) return null;
  return (
    <span className="dnd-spell-meta">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " | "}
          {p}
        </span>
      ))}
    </span>
  );
}

type DndSpellSnapshot = Pick<
  DndSpellEntry,
  | "concentration"
  | "ritual"
  | "school"
  | "castingTime"
  | "castingTiming"
  | "castingTimingOther"
  | "range"
  | "duration"
  | "componentV"
  | "componentS"
  | "componentM"
  | "materialComponent"
  | "checks"
  | "effects"
  | "category"
  | "attackSave"
  | "damage"
  | "healing"
  | "upcast"
>;

// Спелл's "Школа" is a pick from the compendium's "Школы магии" mechanics
// list (an { id, name } object), but older data may still have the plain
// text this field used before — read either shape.
function spellSchoolName(raw: unknown): string | undefined {
  if (raw && typeof raw === "object" && "name" in raw) return String((raw as { name: unknown }).name) || undefined;
  return typeof raw === "string" ? raw : undefined;
}

// Display label for a spell's casting timing — prefers the new structured
// field, falls back to the legacy free-text castingTime for rows added
// before this existed and never re-fetched.
function spellTimingLabel(s: Pick<DndSpellEntry, "castingTiming" | "castingTimingOther" | "castingTime">): string | undefined {
  if (s.castingTiming) {
    return s.castingTiming === "other" ? s.castingTimingOther || "Иное" : TIMING_KEY_TO_LABEL[s.castingTiming];
  }
  return s.castingTime;
}

const TIMING_OPTIONS: DndActionTiming[] = ["action", "bonus", "reaction", "other"];

// Hand-typed "Атаки" rows (requirement: split "Бой" into Действия/Бонусные/
// Реакции/Особое) — a small dedicated editor rather than reusing
// FeatureListEdit, since the timing select only makes sense here and
// FeatureListEdit's DndFeature shape is shared by five other, unrelated lists.
const AttackListEdit = memo(function AttackListEdit({
  values,
  onChange,
}: {
  values: DndManualAttack[];
  onChange: (v: DndManualAttack[]) => void;
}) {
  const [confirmDialog, confirm] = useConfirm();
  function update(i: number, patch: Partial<DndManualAttack>) {
    const next = values.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  async function remove(i: number) {
    const name = values[i]?.name?.trim();
    if (!(await confirm({
      message: name ? `Удалить атаку «${name}»?` : "Удалить эту атаку?",
      confirmLabel: "Удалить",
      danger: true,
    }))) return;
    onChange(values.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...values, { name: "", description: "", timing: "action" }]);
  }
  return (
    <div className="dnd-feature-section">
      {confirmDialog}
      <div className="dnd-feature-header dnd-header-actions">Атаки</div>
      <div className="stack">
        {values.map((a, i) => (
          <div key={i} className="dnd-feature-row">
            <div className="row">
              <input
                placeholder="Название"
                value={a.name}
                onChange={(e) => update(i, { name: e.target.value })}
                style={{ flex: 1 }}
              />
              <select value={a.timing} onChange={(e) => update(i, { timing: e.target.value as DndActionTiming })}>
                {TIMING_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {TIMING_KEY_TO_LABEL[t]}
                  </option>
                ))}
              </select>
              <button type="button" className="comp-mini" onClick={() => remove(i)} aria-label="Убрать строку">
                <NavIcon name="close" />
              </button>
            </div>
            {a.timing === "other" && (
              <input
                placeholder="Сколько занимает (напр. «10 минут», «Не требует действия»)"
                value={a.timingOther ?? ""}
                onChange={(e) => update(i, { timingOther: e.target.value })}
              />
            )}
            <MentionTextarea value={a.description} onChange={(v) => update(i, { description: v })} rows={2} />
          </div>
        ))}
        <button type="button" onClick={add} style={{ alignSelf: "flex-start" }}>
          + Добавить
        </button>
      </div>
    </div>
  );
});

function spellSnapshotFromEntry(entry: CompendiumEntry): DndSpellSnapshot {
  return {
    concentration: !!entry.data.concentration,
    ritual: !!entry.data.ritual,
    school: spellSchoolName(entry.data.school),
    castingTime: typeof entry.data.casting_time === "string" ? entry.data.casting_time : undefined,
    ...spellTimingFromData(entry.data),
    range: typeof entry.data.range === "string" ? entry.data.range : undefined,
    duration: typeof entry.data.duration === "string" ? entry.data.duration : undefined,
    componentV: !!entry.data.component_v,
    componentS: !!entry.data.component_s,
    componentM: !!entry.data.component_m,
    materialComponent: typeof entry.data.material_component === "string" ? entry.data.material_component : undefined,
    checks: (entry.data.checks as DndCheck[] | undefined) ?? [],
    effects: (entry.data.effects as DndEffect[] | undefined) ?? [],
    category: typeof entry.data.category === "string" ? entry.data.category : undefined,
    attackSave: typeof entry.data.attack_save === "string" ? entry.data.attack_save : undefined,
    damage: typeof entry.data.damage === "string" ? entry.data.damage : undefined,
    healing: typeof entry.data.healing === "string" ? entry.data.healing : undefined,
    upcast: typeof entry.data.upcast === "string" ? entry.data.upcast : undefined,
  };
}

// Renders the cached armor/weapon fields (snapshotted by fetchEquipmentMeta)
// as a compact tag line above the item's compendium description, so the
// "what does this do" info shows even though the fields live outside the
// free-text description.
function equipmentTagsLine(item: DndEquipmentItem): string {
  const parts: string[] = [];
  if (item.armorType) {
    parts.push(item.armorType);
    // У щита в поле `ac` лежит не базовое значение, а прибавка — подписываем
    // её плюсом, чтобы строка не читалась как «КЗ 2».
    const shield = item.armorType.trim().toLowerCase().startsWith("щит");
    if (item.ac) parts.push(shield ? `+${item.ac} КЗ` : `КЗ ${item.ac}`);
    if (!shield) {
      // У щита `dex_bonus: false` значит «щит сам Ловкость не добавляет», а не
      // «Ловкость не считается» — подпись только для доспехов.
      if (item.maxDexBonus) parts.push(`Макс. бонус Лов ${item.maxDexBonus}`);
      else if (item.dexBonus === false || item.armorType.trim().toLowerCase().startsWith("тяж"))
        parts.push("Ловкость не применяется");
    }
  }
  if (item.acBonus) parts.push(`+${item.acBonus} КЗ`);
  if (item.magical) parts.push("магический");
  if (item.weaponDamage) {
    const type = item.weaponAttackMelee && item.weaponAttackRanged ? "Ближняя/дальняя атака" : item.weaponAttackRanged ? "Дальняя атака" : "Ближняя атака";
    parts.push(type, item.weaponDamage);
  }
  if (item.weaponProperties) parts.push(item.weaponProperties);
  if (item.weaponMastery) parts.push(`Мастерство: ${item.weaponMastery}`);
  return parts.join(" · ");
}

// One pick in a species/subclass's "Обретаемые заклинания" list — grantLevel
// is the character (species) or class (subclass) level at which it's
// obtained, not the spell's own circle/level.
interface GrantedSpellDef {
  id: number;
  name: string;
  /** Английское имя заклинания — запасной ключ, когда `id` не сходится. */
  original: string;
  grantLevel: number;
  /** «Не в счёт лимита» — «Починка» Артефактора и заклинания подкласса. */
  outsideLimit: boolean;
}

// Имена в списке приезжают из импорта в виде «Лечащее слово [Healing Word]»,
// поэтому оригинал достаётся прямо из имени, даже когда отдельного поля нет.
function splitGrantedName(raw: string): { name: string; original: string } {
  const m = /^(.*?)\s*\[(.+)\]\s*$/.exec(raw ?? "");
  return m ? { name: m[1].trim(), original: m[2].trim() } : { name: (raw ?? "").trim(), original: "" };
}

function parseGrantedSpellDefs(entry: CompendiumEntry): GrantedSpellDef[] {
  const raw = Array.isArray(entry.data.granted_spells)
    ? (entry.data.granted_spells as {
        id: number;
        name: string;
        grantLevel?: number;
        original?: string;
        outsideLimit?: boolean;
      }[])
    : [];
  // Заклинания подкласса по правилам 5.5 всегда подготовлены и не занимают
  // мест среди подготовленных, поэтому «вне лимита» здесь — умолчание, а не
  // исключение; снять его можно только явным `outsideLimit: false`.
  return raw.map((s) => {
    const split = splitGrantedName(s.name);
    return {
      id: s.id,
      name: split.name,
      original: (s.original ?? "").trim() || split.original,
      grantLevel: typeof s.grantLevel === "number" && s.grantLevel > 0 ? s.grantLevel : 1,
      outsideLimit: s.outsideLimit !== false,
    };
  });
}

// Resolves granted-spell picks to full spell entries (for circle/level + the
// same meta snapshot other spells carry), tagged with sourceParentId +
// always-prepared, ready to slot into cantrips or spellsByLevel[level-1].
//
// `id` — быстрый путь, но не единственный: он не переживает переустановку
// модуля справочника (в базе владельца все 288 ссылок вели в пустоту, и
// подкласс молча не приносил ни одного заклинания). Когда id промахнулся,
// ссылка сводится по `name_original`, как и владения навыками. Индекс
// заклинаний тянется лениво — только если промах случился.
async function fetchGrantedSpells(
  grantedSpells: GrantedSpellDef[],
  sourceParentId: number,
  systemId: number | null
): Promise<{ level: number; entry: DndSpellEntry }[]> {
  const results: { level: number; entry: DndSpellEntry }[] = [];
  let index: Map<string, CompendiumEntry> | null = null;

  async function byName(g: GrantedSpellDef): Promise<CompendiumEntry | undefined> {
    if (!systemId) return undefined;
    if (!index) {
      index = new Map();
      for (const e of await loadDndSpellIndex(systemId)) {
        if (e.name_original) index.set(e.name_original.trim().toLowerCase(), e);
        const key = e.name.trim().toLowerCase();
        if (!index.has(key)) index.set(key, e);
      }
    }
    return (
      (g.original ? index.get(g.original.toLowerCase()) : undefined) ?? index.get(g.name.toLowerCase())
    );
  }

  for (const g of grantedSpells) {
    let full: CompendiumEntry | undefined;
    try {
      full = await api.get<CompendiumEntry>(`/systems/entries/${g.id}`);
    } catch {
      full = undefined;
    }
    if (!full || full.kind !== "spell") full = await byName(g);
    if (!full) continue;
    results.push({
      level: full.level ?? 0,
      entry: {
        entryId: full.id,
        name: full.name,
        prepared: 2,
        sourceParentId,
        outsideLimit: g.outsideLimit,
        ...spellSnapshotFromEntry(full),
      },
    });
  }
  return results;
}

// Strips every granted spell (any sourceParentId) from cantrips and every
// spell-level array, keeping hand-added spells (no sourceParentId)
// untouched. Used as the first step of a full recompute — see
// recomputeGrantedSpells below.
function stripGrantedSpells(
  cantrips: DndSpellEntry[],
  spellsByLevel: DndSpellEntry[][]
): { cantrips: DndSpellEntry[]; spellsByLevel: DndSpellEntry[][] } {
  const strip = (spells: DndSpellEntry[]) => spells.filter((s) => s.sourceParentId == null);
  return { cantrips: strip(cantrips), spellsByLevel: spellsByLevel.map(strip) };
}

// Adds newly-fetched granted spells into cantrips/spellsByLevel, growing
// spellSlotLevels if a granted spell's level would otherwise be hidden.
function addGrantedSpells(
  base: { cantrips: DndSpellEntry[]; spellsByLevel: DndSpellEntry[][]; spellSlotLevels: number },
  granted: { level: number; entry: DndSpellEntry }[]
): { cantrips: DndSpellEntry[]; spellsByLevel: DndSpellEntry[][]; spellSlotLevels: number } {
  let cantrips = base.cantrips;
  const spellsByLevel = base.spellsByLevel.map((lvl) => lvl.slice());
  let spellSlotLevels = base.spellSlotLevels;
  for (const { level, entry } of granted) {
    if (level <= 0) {
      cantrips = [...cantrips, entry];
    } else if (level <= SPELL_LEVELS) {
      spellsByLevel[level - 1] = [...spellsByLevel[level - 1], entry];
      spellSlotLevels = Math.max(spellSlotLevels, level);
    }
  }
  return { cantrips, spellsByLevel, spellSlotLevels };
}

// Recomputes every species/subclass "Обретаемые заклинания" grant against
// the character's current levels: species grants use the character's total
// level (sum of every class row), subclass grants use that class row's own
// level. Strips all previously-granted spells first, then re-adds only the
// ones currently qualified for — so this one function handles picking a new
// species/subclass, leveling up (newly unlocked grants appear) and leveling
// down (grants above the new level disappear) uniformly. Called after any
// change to raceId, a class's subclassId, or a class's level.
export async function recomputeGrantedSpells(
  value: Pick<DndCharacterData, "raceId" | "classes" | "cantrips" | "spellsByLevel" | "spellSlotLevels" | "systemId">
): Promise<{ cantrips: DndSpellEntry[]; spellsByLevel: DndSpellEntry[][]; spellSlotLevels: number }> {
  let { cantrips, spellsByLevel } = stripGrantedSpells(value.cantrips, value.spellsByLevel);
  let spellSlotLevels = value.spellSlotLevels;

  async function grantFrom(entryId: number, characterLevel: number) {
    try {
      const entry = await api.get<CompendiumEntry>(`/systems/entries/${entryId}`);
      const eligible = parseGrantedSpellDefs(entry).filter((d) => d.grantLevel <= characterLevel);
      if (eligible.length === 0) return;
      const granted = await fetchGrantedSpells(eligible, entryId, value.systemId);
      ({ cantrips, spellsByLevel, spellSlotLevels } = addGrantedSpells(
        { cantrips, spellsByLevel, spellSlotLevels },
        granted
      ));
    } catch {
      /* entry missing — nothing to grant */
    }
  }

  const totalLevel = totalCharacterLevel(value.classes);
  if (value.raceId) await grantFrom(value.raceId, totalLevel);
  for (const c of value.classes) {
    // Класс участвует в переборе наравне с подклассом: «Починку» Артефактор
    // знает сам, а не через подкласс, и до этого она не приходила никак —
    // сколько её ни вписывай в запись класса, перебор до неё не доходил.
    if (c.classId != null) await grantFrom(c.classId, c.level || 0);
    if (c.subclassId != null) await grantFrom(c.subclassId, c.level || 0);
  }

  return { cantrips, spellsByLevel, spellSlotLevels };
}

// Хранимая запись + живые поля из компендиума. Лист держит только entryId,
// имя и свою пометку подготовки; всё остальное — школа, время, компоненты,
// броски, эффекты — берётся из компендиума при отрисовке. Сохранённый ранее
// снапшот остаётся запасным путём: он используется, когда записи нет в кэше
// (её ещё не догрузили, она удалена или заклинание вписано руками без ссылки).
function resolveSpell(
  s: DndSpellEntry,
  get: (id: number | null | undefined) => CompendiumEntry | undefined
): DndSpellEntry {
  const entry = get(s.entryId);
  return entry ? { ...s, ...spellSnapshotFromEntry(entry) } : s;
}

function resolveFeature(
  f: DndFeature,
  get: (id: number | null | undefined) => CompendiumEntry | undefined
): DndFeature {
  const entry = get(f.entryId);
  if (!entry) return f;
  return {
    ...f,
    ...spellTimingFromData(entry.data),
    checks: (entry.data.checks as DndCheck[] | undefined) ?? [],
    effects: (entry.data.effects as DndEffect[] | undefined) ?? [],
    cost: entry.data.cost as DndCost | undefined,
  };
}

// Все id, которые листу нужно догрузить одной пачкой.
function sheetEntryIds(value: DndCharacterData): (number | null | undefined)[] {
  const spells = [...value.cantrips, ...value.spellsByLevel.flat()].map((s) => s.entryId);
  const features = [
    ...value.classFeatures,
    ...value.speciesFeatures,
    ...value.feats,
    ...value.specialAbilities,
  ].map((f) => f.entryId);
  // Записи классов нужны ради таблиц развития (по ним считаются ячейки) и
  // стартовых наборов; предыстория — только ради набора.
  const classes = value.classes.map((c) => c.classId);
  return [...spells, ...features, ...classes, value.backgroundId];
}

// Full field set shown when a spell name is clicked (requirement 2).
interface SpellDetail {
  school?: string;
  castingTime?: string;
  range?: string;
  duration?: string;
  componentsText?: ReactNode;
  description: string;
}

// Раскрытое описание заклинания — под строкой списка, тем же блоком, что и
// у предмета инвентаря. Раньше было модалкой; она закрывала лист целиком,
// и чтобы сравнить два заклинания, приходилось открывать и закрывать её
// дважды (решение владельца 2026-09-04).
function SpellDescription({ detail }: { detail: SpellDetail | undefined }) {
  if (!detail) return <div className="dnd-spell-description muted">Загрузка…</div>;
  const fields: [string, ReactNode][] = (
    [
      ["Школа", detail.school],
      ["Время накладывания", detail.castingTime],
      ["Дистанция", detail.range],
      ["Компоненты", detail.componentsText],
      ["Длительность", detail.duration],
    ] as [string, ReactNode][]
  ).filter(([, v]) => !!v);
  return (
    <div className="dnd-spell-description">
      {fields.length > 0 && (
        <div className="comp-fields">
          {fields.map(([label, value]) => (
            <div key={label} className="muted">
              <strong>{label}:</strong> {value}
            </div>
          ))}
        </div>
      )}
      <MentionText text={detail.description} />
    </div>
  );
}

function buildSpellDetail(entry: CompendiumEntry): SpellDetail {
  const materialComponent =
    typeof entry.data.material_component === "string" ? entry.data.material_component : undefined;
  const letters = spellComponentLetters({
    componentV: !!entry.data.component_v,
    componentS: !!entry.data.component_s,
    componentM: !!entry.data.component_m,
    materialComponent,
  });
  // Unlike the compact meta line (tooltip-only, to save space), the full
  // "Компоненты" field spells the material component text out inline —
  // it's the whole point of expanding a spell's details.
  const componentsText = letters && (
    <>
      {letters}
      {entry.data.component_m && materialComponent && ` (${materialComponent})`}
    </>
  );
  const timing = spellTimingFromData(entry.data);
  return {
    school: spellSchoolName(entry.data.school),
    castingTime:
      timing.castingTiming === "other"
        ? timing.castingTimingOther || "Иное"
        : timing.castingTiming
        ? TIMING_KEY_TO_LABEL[timing.castingTiming]
        : typeof entry.data.casting_time === "string"
        ? entry.data.casting_time
        : undefined,
    range: typeof entry.data.range === "string" ? entry.data.range : undefined,
    duration: typeof entry.data.duration === "string" ? entry.data.duration : undefined,
    componentsText,
    description: entry.description || "Нет описания.",
  };
}

function DndSpellLevelSection({
  level,
  systemId,
  slots,
  spells,
  edit,
  showSlots,
  onSlotsChange,
  onSpellsChange,
  used,
  onUsedChange,
  preparedOnly,
}: {
  level: number;
  systemId: number | null;
  slots: number;
  spells: DndSpellEntry[];
  edit: boolean;
  showSlots: boolean;
  onSlotsChange: (v: number) => void;
  onSpellsChange: (v: DndSpellEntry[]) => void;
  // View-mode-only: tracks slots expended this rest, separate from `slots`
  // (the max, only editable via onSlotsChange in edit mode).
  used?: number;
  onUsedChange?: (v: number) => void;
  preparedOnly?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<DndSpellOption[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, SpellDetail>>({});
  const [confirmDialog, confirm] = useConfirm();

  useEffect(() => {
    if (!adding || !systemId) return;
    loadDndSpellsByLevel(systemId, level).then(setOptions);
  }, [adding, systemId, level]);

  // Клик по названию раскрывает полные поля заклинания. Запись берётся из
  // общего кэша листа (entryCache), а не отдельным GET на каждое открытие:
  // тот же кэш уже вытянул её пачкой ради мета-строки, и поштучный запрос
  // был ровно тем, что entryCache и заводился устранить. Заодно правка в
  // компендиуме теперь доходит и сюда — кэш сбрасывается на сохранении.
  async function toggleDescription(realIndex: number, entryId: number | null) {
    if (!entryId) return;
    if (expandedIndex === realIndex) {
      setExpandedIndex(null);
      return;
    }
    setExpandedIndex(realIndex);
    if (!(entryId in details)) {
      await ensureEntries([entryId]);
      const entry = getCachedEntry(entryId);
      setDetails((d) => ({
        ...d,
        [entryId]: entry ? buildSpellDetail(entry) : { description: "Описание не загрузилось." },
      }));
    }
  }

  // Ни запроса за метой, ни снапшота: всё, кроме ссылки и имени, лист берёт
  // из компендиума при отрисовке (см. resolveSpell). Раньше здесь был GET на
  // каждое добавляемое заклинание, и он же был источником устаревания.
  function addSpell(entryId: number | null, name: string) {
    setAdding(false);
    setQuery("");
    onSpellsChange([...spells, { entryId, name, prepared: 0 }]);
  }
  // Cycles the same star through not prepared → prepared → always prepared.
  function togglePrepared(i: number) {
    const next = spells.slice();
    next[i] = { ...next[i], prepared: ((next[i].prepared + 1) % 3) as DndSpellPreparedState };
    onSpellsChange(next);
  }
  function toggleOutsideLimit(i: number) {
    const next = spells.slice();
    next[i] = { ...next[i], outsideLimit: !next[i].outsideLimit };
    onSpellsChange(next);
  }
  async function remove(i: number) {
    const name = spells[i]?.name?.trim();
    if (!(await confirm({
      message: name ? `Убрать «${name}» из списка заклинаний?` : "Убрать это заклинание?",
      confirmLabel: "Убрать",
      danger: true,
    }))) return;
    onSpellsChange(spells.filter((_, idx) => idx !== i));
  }
  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const result = readSearchDrop(e);
    if (!result || result.kind !== "spell") return;
    onSpellsChange([...spells, { entryId: result.id, name: result.title, prepared: 0 }]);
  }

  const filtered = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options;
  const ordered = edit ? spells : sortSpells(spells);
  // В режиме правки фильтр не применяется: подготовить нельзя то, чего не
  // видно. Круг при этом не прячется целиком даже когда всё скрыто — в его
  // заголовке живут ячейки, и они нужны независимо от подготовки.
  const sorted = preparedOnly && !edit ? ordered.filter((sp) => sp.prepared > 0) : ordered;
  const hiddenCount = ordered.length - sorted.length;
  const label = level === 0 ? "Заговоры" : `${level} круг`;

  return (
    <details className="dnd-spell-level-card">
      {confirmDialog}
      <summary className="row dnd-spell-level-summary" style={{ justifyContent: "space-between" }}>
        <span>{label}</span>
        {showSlots && (
          // Clicking a pip must not also toggle the <details> open/closed.
          // stopPropagation alone doesn't suppress that — <summary>'s toggle
          // is the click event's default action, not a bubbled listener, so
          // preventDefault is required too.
          <span
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="row"
            style={{ gap: 10 }}
          >
            <PipTrack value={slots} max={MAX_SPELL_SLOTS} onChange={edit ? onSlotsChange : undefined} label={`Ячейки, ${label}`} />
            {!edit && onUsedChange && slots > 0 && (
              <span className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
                исп.
                <PipTrack value={used ?? 0} max={slots} onChange={onUsedChange} size={13} label={`Потрачено ячеек, ${label}`} />
              </span>
            )}
          </span>
        )}
      </summary>
      <div
        className={`dnd-spell-list${dragOver ? " drag-over" : ""}`}
        style={{ marginTop: 6 }}
        onDragOver={edit ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
        onDragLeave={edit ? () => setDragOver(false) : undefined}
        onDrop={edit ? handleDrop : undefined}
      >
        {sorted.length === 0 && (
          <span className="muted">{hiddenCount > 0 ? "Ничего не подготовлено" : "Пусто"}</span>
        )}
        {sorted.map((s) => {
          const realIndex = spells.indexOf(s);
          return (
            <div key={realIndex}>
              <div
                className={`comp-row dnd-spell-row${s.prepared === 2 ? " is-prepared" : ""}${s.prepared === 1 ? " is-prepared-once" : ""}`}
              >
                {s.entryId ? (
                  <button
                    type="button"
                    className="comp-name dnd-spell-name dnd-spell-name-link"
                    aria-expanded={expandedIndex === realIndex}
                    onClick={() => toggleDescription(realIndex, s.entryId!)}
                  >
                    {s.name}
                    {s.outsideLimit && <span className="dnd-outside-mark" title="Не в счёт подготовленных">∞</span>}
                  </button>
                ) : (
                  <span className="comp-name dnd-spell-name">
                    {s.name}
                    {s.outsideLimit && <span className="dnd-outside-mark" title="Не в счёт подготовленных">∞</span>}
                  </span>
                )}
                <SpellMetaLine s={s} />
                {edit ? (
                  <span className="comp-actions dnd-spell-actions">
                    {/* Звёздочка ходит по кругу «не подготовлено → подготовлено
                        → всегда подготовлено», поэтому не aria-pressed (у него
                        два состояния, а тут три) — состояние называется прямо
                        в подписи. */}
                    <button
                      type="button"
                      className="comp-mini"
                      title={SPELL_PREPARED_TITLES[s.prepared]}
                      aria-label={`${s.name}: ${SPELL_PREPARED_TITLES[s.prepared]} — сменить`}
                      onClick={() => togglePrepared(realIndex)}
                    >
                      <NavIcon name="star" filled={s.prepared !== 0} />
                    </button>
                    {/* «Вне лимита» ставится и руками: выдач в D&D много —
                        предмет, черта, благословение Мастера, — и все они
                        приходят по-своему. Пометка от источника (вид, класс,
                        подкласс) приезжает сама, эта галочка — для всего
                        остального. */}
                    <button
                      type="button"
                      className="comp-mini"
                      title="Не в счёт подготовленных"
                      aria-pressed={!!s.outsideLimit}
                      aria-label={`${s.name}: не в счёт подготовленных`}
                      onClick={() => toggleOutsideLimit(realIndex)}
                    >
                      ∞
                    </button>
                    <button
                      type="button"
                      className="comp-mini danger"
                      aria-label={`Убрать «${s.name}» из списка`}
                      onClick={() => remove(realIndex)}
                    >
                      <NavIcon name="close" />
                    </button>
                  </span>
                ) : (
                  s.prepared > 0 && (
                    <span
                      className="dnd-prepared-badge"
                      title={SPELL_PREPARED_TITLES[s.prepared]}
                      aria-label={SPELL_PREPARED_TITLES[s.prepared]}
                      role="img"
                    >
                      <NavIcon name="star" filled />
                    </span>
                  )
                )}
              </div>
              {expandedIndex === realIndex && s.entryId && (
                <SpellDescription detail={details[s.entryId]} />
              )}
            </div>
          );
        })}
        {hiddenCount > 0 && sorted.length > 0 && (
          <span className="muted dnd-spell-hidden-note">Скрыто неподготовленных: {hiddenCount}</span>
        )}
        {edit && (
          <div>
            {adding ? (
              <div className="dnd-spell-add">
                <input
                  autoFocus
                  placeholder="Название заклинания…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && query.trim()) addSpell(null, query.trim());
                    if (e.key === "Escape") setAdding(false);
                  }}
                />
                {filtered.length > 0 && (
                  <div className="mention-dropdown">
                    {filtered.slice(0, 8).map((o) => (
                      <div
                        key={o.id}
                        className="mention-dropdown-item"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addSpell(o.id, o.name);
                        }}
                      >
                        {o.name}
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => setAdding(false)}>
                  Отмена
                </button>
              </div>
            ) : (
              <button type="button" className="comp-mini" onClick={() => setAdding(true)} style={{ alignSelf: "flex-start" }}>
                + Добавить заклинание
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

// Memoized: with up to 10 level sections (each its own search/drop UI), this
// is one of the largest subtrees on the sheet — without memo it fully
// re-renders on every keystroke anywhere else in the form.
function DndSpellsView({
  cantrips,
  spellSlotLevels,
  spellSlotPips,
  spellSlotsUsed,
  spellsByLevel,
  onUsedChange,
  edit,
  systemId,
  onCantripsChange,
  onSlotsChange,
  onSpellsChange,
  preparedOnly,
}: {
  cantrips: DndSpellEntry[];
  spellSlotLevels: number;
  spellSlotPips: number[];
  spellSlotsUsed?: number[];
  spellsByLevel: DndSpellEntry[][];
  onUsedChange?: (level0idx: number, v: number) => void;
  // Local per-tab edit toggle (see TabEditToggle/editingSpells in
  // DndCharacterView) — when set, this is otherwise the same view but with
  // add-spell/drag-drop/slot-count editing turned on directly, no need for
  // the full DndCharacterEdit form just to add a spell from the bag.
  edit?: boolean;
  systemId?: number | null;
  onCantripsChange?: (v: DndSpellEntry[]) => void;
  onSlotsChange?: (level0idx: number, v: number) => void;
  onSpellsChange?: (level0idx: number, v: DndSpellEntry[]) => void;
  preparedOnly?: boolean;
}) {
  const activeLevels = Array.from({ length: spellSlotLevels }, (_, i) => i).filter(
    (i) => edit || spellSlotPips[i] > 0 || spellsByLevel[i].length > 0
  );
  if (!edit && activeLevels.length === 0 && cantrips.length === 0) return null;
  return (
    <div className="stack">
      {(edit || cantrips.length > 0) && (
        <DndSpellLevelSection
          level={0}
          systemId={edit ? systemId ?? null : null}
          slots={0}
          spells={cantrips}
          edit={!!edit}
          preparedOnly={preparedOnly}
          showSlots={false}
          onSlotsChange={() => {}}
          onSpellsChange={edit && onCantripsChange ? onCantripsChange : () => {}}
        />
      )}
      {activeLevels.map((i) => (
        <DndSpellLevelSection
          key={i}
          level={i + 1}
          systemId={edit ? systemId ?? null : null}
          slots={spellSlotPips[i]}
          spells={spellsByLevel[i]}
          used={spellSlotsUsed?.[i]}
          onUsedChange={onUsedChange ? (v) => onUsedChange(i, v) : undefined}
          edit={!!edit}
          preparedOnly={preparedOnly}
          showSlots
          onSlotsChange={edit && onSlotsChange ? (v) => onSlotsChange(i, v) : () => {}}
          onSpellsChange={edit && onSpellsChange ? (v) => onSpellsChange(i, v) : () => {}}
        />
      ))}
    </div>
  );
}

// Memoized for the same reason as the other heavy sub-sections — needs all
// callback props to be stable-identity (see the ref-backed useMemo block in
// DndCharacterEdit) or the memo is defeated.
const DndClassesEdit = memo(function DndClassesEdit({
  classes,
  hierarchy,
  onChange,
  onPickClass,
  onPickSubclass,
  onLevelChange,
  onRemoveClass,
  loadError,
  onRetryLoad,
}: {
  classes: DndClassEntry[];
  hierarchy: DndClassHierarchy;
  onChange: (v: DndClassEntry[]) => void;
  // Picking/removing a class or subclass, or changing a row's level, also
  // needs to sync the character's Заметки and Классовые особенности, which
  // need the full character value/onChange this sub-component doesn't
  // otherwise have — the parent supplies these handlers for just those
  // interactions.
  onPickClass: (i: number, classId: number | null) => void;
  onPickSubclass: (i: number, subclassId: number | null) => void;
  onLevelChange: (i: number, level: number) => void;
  onRemoveClass: (i: number) => void;
  // Справочник классов не загрузился — поле остаётся списком с причиной,
  // а не подменяется свободным вводом (P1-Р8).
  loadError?: string | null;
  onRetryLoad?: () => void;
}) {
  const [confirmDialog, confirm] = useConfirm();
  const hasCompendiumClasses = hierarchy.classes.length > 0;
  // Lets the level input sit empty mid-edit (so the user can clear it and
  // type a fresh number) without every keystroke snapping back to "1" —
  // that only happens once, on blur, if the field was left empty.
  const [levelText, setLevelText] = useState<Record<number, string>>({});
  // Уровень, который у этой строки уже запрошен, но ещё не вернулся пропом.
  // Уровень — controlled-значение сверху, и несколько щелчков «+» в одном
  // такте видят один и тот же `classes[i].level`: пять щелчков давали 2
  // вместо 6. Считаем от последнего запрошенного, а на приходе нового
  // `classes` (то есть после коммита) память сбрасываем — дальше
  // авторитетен проп.
  const pendingLevels = useRef<Record<number, number>>({});
  useEffect(() => {
    pendingLevels.current = {};
  }, [classes]);

  function update(i: number, patch: Partial<DndClassEntry>) {
    const next = classes.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function commitLevel(i: number, raw: string) {
    const n = Math.min(20, Math.max(1, Math.round(Number(raw)) || 1));
    setLevelText((prev) => {
      const next = { ...prev };
      delete next[i];
      return next;
    });
    pendingLevels.current[i] = n;
    update(i, { level: n });
    onLevelChange(i, n);
  }
  function stepLevel(i: number, delta: number) {
    const base = pendingLevels.current[i] ?? classes[i].level;
    const n = Math.min(20, Math.max(1, base + delta));
    if (n === base) return;
    pendingLevels.current[i] = n;
    update(i, { level: n });
    onLevelChange(i, n);
  }
  function add() {
    onChange([
      ...classes,
      { classId: null, className: "", subclassId: null, subclassName: "", level: 1, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: "" },
    ]);
  }

  return (
    <div className="stack dnd-classes-block">
      <div className="sb-section" style={{ margin: 0 }}>
        Класс и уровень
      </div>
      {classes.map((c, i) => {
        const subclasses = c.classId != null ? hierarchy.subclassesByClass[c.classId] ?? [] : [];
        const subclassLevelFor = (row: DndClassEntry) =>
          hierarchy.classes.find((cl) => cl.id === row.classId)?.subclassLevel ?? 0;
        return (
          <div key={i} className="row dnd-class-row">
            {hasCompendiumClasses ? (
              <select
                value={c.classId ?? ""}
                onChange={(e) => onPickClass(i, e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Выбрать класс…</option>
                {hierarchy.classes.map((cl) => (
                  <option key={cl.id} value={cl.id}>
                    {cl.name}
                  </option>
                ))}
              </select>
            ) : loadError && onRetryLoad ? (
              <CompendiumFieldError current={c.className} error={loadError} onRetry={onRetryLoad} />
            ) : (
              <input
                placeholder="Класс"
                value={c.className}
                onChange={(e) => update(i, { className: e.target.value })}
              />
            )}
            {c.classId != null &&
              subclasses.length > 0 &&
              // Подкласс доступен не с первого уровня. Раньше выпадающий
              // список стоял всегда, и ничто не мешало выбрать подкласс
              // Варвару 1 уровня; теперь до нужного уровня вместо списка
              // стоит подсказка, а уже выбранный подкласс не прячем — иначе
              // персонаж с понижённым уровнем потерял бы его молча.
              (subclassLevelFor(c) > c.level && c.subclassId == null ? (
                <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                  подкласс с {subclassLevelFor(c)} уровня
                </span>
              ) : (
                <select
                  value={c.subclassId ?? ""}
                  onChange={(e) => onPickSubclass(i, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Подкласс…</option>
                  {subclasses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ))}
            <span className="dnd-class-level-stepper">
              <button
                type="button"
                className="dnd-level-step-btn dnd-level-step-btn-down"
                aria-label="Уровень −1"
                disabled={c.level <= 1}
                onClick={() => stepLevel(i, -1)}
              >
                <NavIcon name="navDown" />
              </button>
              <input
                type="number"
                min={1}
                max={20}
                className="dnd-class-level-input"
                value={levelText[i] ?? c.level}
                // Keystrokes only update local text (instant, no network) —
                // the model level (and the feature/granted-spell resync, which
                // needs a compendium fetch) only commit on blur, so clearing
                // the field to type a fresh number doesn't get stomped by a
                // re-render forcing it back to "1" after every keystroke.
                onChange={(e) => setLevelText((prev) => ({ ...prev, [i]: e.target.value }))}
                onBlur={(e) => commitLevel(i, e.target.value)}
              />
              <button
                type="button"
                className="dnd-level-step-btn dnd-level-step-btn-up"
                aria-label="Уровень +1"
                disabled={c.level >= 20}
                onClick={() => stepLevel(i, 1)}
              >
                <NavIcon name="navUp" />
              </button>
            </span>
            <button
              type="button"
              className="comp-mini"
              title="Убрать класс"
              aria-label="Убрать класс"
              onClick={async () => {
                const ok = await confirm({
                  title: "Убрать класс?",
                  message: c.className
                    ? `«${c.className}» уйдёт из листа вместе со своими особенностями, спасбросками и инструментами.`
                    : "Строка класса будет убрана.",
                  confirmLabel: "Убрать",
                  danger: true,
                });
                if (ok) onRemoveClass(i);
              }}
            >
              <NavIcon name="close" />
            </button>
          </div>
        );
      })}
      <button type="button" onClick={add} style={{ alignSelf: "flex-start" }}>
        + Добавить класс
      </button>
      {confirmDialog}
    </div>
  );
});

// Requirement 14: Снаряжение as named sections of structured items,
// drag-and-droppable both within and between sections. A drag payload of
// `{ sectionIndex, itemIndex }` (JSON, custom MIME) identifies the item
// being moved; a search-result drop (compendium/etc.) adds a new item
// instead, marked "(свиток)" for spells — mirroring the old free-text
// behavior where a dropped spell became a scroll, not the spell itself.
const EQUIPMENT_DRAG_MIME = "application/x-rpg-equipment-item";

// One equipment item row. Memoized with stable per-row callbacks (built by
// EquipmentSectionBlock below) — a section can hold a dozen-plus items, and
// without this, editing one item's field re-rendered every other item row
// in the same section on every keystroke.
const EquipmentItemRow = memo(function EquipmentItemRow({
  item,
  onChangeName,
  onChangeQty,
  onChangeWeight,
  onChangeNotes,
  onToggleEquipped,
  onRemove,
  onDragStart,
}: {
  item: DndEquipmentItem;
  onChangeName: (v: string) => void;
  onChangeQty: (v: string) => void;
  onChangeWeight: (v: string) => void;
  onChangeNotes: (v: string) => void;
  onToggleEquipped: () => void;
  onRemove: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="row dnd-equipment-item-row" draggable onDragStart={onDragStart}>
      <button
        type="button"
        className={`comp-mini dnd-equip-toggle${item.equipped ? " is-equipped" : ""}`}
        title={item.equipped ? "Надето" : "Не надето"}
        aria-label={`${item.name || "Предмет"}: надето`}
        aria-pressed={!!item.equipped}
        onClick={onToggleEquipped}
      >
        {item.equipped ? "●" : "○"}
      </button>
      <input placeholder="Название" value={item.name} onChange={(e) => onChangeName(e.target.value)} style={{ flex: 2 }} />
      <input placeholder="Кол-во" value={item.qty} onChange={(e) => onChangeQty(e.target.value)} style={{ flex: 1 }} />
      <input placeholder="Вес" value={item.weight} onChange={(e) => onChangeWeight(e.target.value)} style={{ flex: 1 }} />
      <input placeholder="Заметка" value={item.notes} onChange={(e) => onChangeNotes(e.target.value)} style={{ flex: 2 }} />
      <button type="button" className="comp-mini" onClick={onRemove} aria-label="Удалить предмет">
        <NavIcon name="close" />
      </button>
    </div>
  );
});

// One named section. Memoized, and manages its own items' add/update/remove
// locally (mirroring FeatureListEdit) so a keystroke inside one section
// never touches the others — cross-section moves still go through the
// parent's onDrop, which is the only operation that needs to see every
// section at once.
const EquipmentSectionBlock = memo(function EquipmentSectionBlock({
  si,
  section,
  isDragOver,
  onNameChange,
  onRemoveSection,
  onItemsChange,
  onSectionDragOver,
  onSectionDragLeave,
  onSectionDrop,
}: {
  si: number;
  section: DndEquipmentSection;
  isDragOver: boolean;
  onNameChange: (v: string) => void;
  onRemoveSection: () => void;
  onItemsChange: (items: DndEquipmentItem[]) => void;
  onSectionDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onSectionDragLeave: () => void;
  onSectionDrop: (e: DragEvent<HTMLDivElement>) => void;
}) {
  const [confirmDialog, confirm] = useConfirm();

  const updateItem = useEvent((ii: number, patch: Partial<DndEquipmentItem>) => {
    const next = section.items.slice();
    next[ii] = { ...next[ii], ...patch };
    onItemsChange(next);
  });
  // Удаление вынесено во второй `useEvent`: после `await` замыкание держит
  // список на момент открытия диалога, а его нужно взять на момент ответа.
  const dropItemAt = useEvent((ii: number) => onItemsChange(section.items.filter((_, idx) => idx !== ii)));
  const removeItem = useEvent(async (ii: number) => {
    const name = section.items[ii]?.name || "предмет";
    const ok = await confirm({ title: "Удалить предмет?", message: `Удалить «${name}»?`, confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    dropItemAt(ii);
  });
  function addItem() {
    onItemsChange([...section.items, { name: "", qty: "", weight: "", notes: "" }]);
  }

  const items = section.items;
  const nameCallbacks = useMemo(
    () => items.map((_, ii) => (v: string) => updateItem(ii, { name: v })),
    [items.length, updateItem]
  );
  const qtyCallbacks = useMemo(
    () => items.map((_, ii) => (v: string) => updateItem(ii, { qty: v })),
    [items.length, updateItem]
  );
  const weightCallbacks = useMemo(
    () => items.map((_, ii) => (v: string) => updateItem(ii, { weight: v })),
    [items.length, updateItem]
  );
  const notesCallbacks = useMemo(
    () => items.map((_, ii) => (v: string) => updateItem(ii, { notes: v })),
    [items.length, updateItem]
  );
  const removeCallbacks = useMemo(() => items.map((_, ii) => () => removeItem(ii)), [items.length, removeItem]);
  const equippedCallbacks = useMemo(
    () => items.map((_, ii) => () => updateItem(ii, { equipped: !items[ii].equipped })),
    [items, updateItem]
  );
  const dragStartCallbacks = useMemo(
    () =>
      items.map(
        (_, ii) => (e: DragEvent<HTMLDivElement>) =>
          e.dataTransfer.setData(EQUIPMENT_DRAG_MIME, JSON.stringify({ sectionIndex: si, itemIndex: ii }))
      ),
    [items.length, si]
  );

  return (
    <>
      {confirmDialog}
      <div
        className={`dnd-equipment-section${isDragOver ? " drag-over" : ""}`}
        onDragOver={onSectionDragOver}
        onDragLeave={onSectionDragLeave}
        onDrop={onSectionDrop}
      >
        <div className="row">
          <input
            className="dnd-equipment-section-name"
            value={section.name}
            onChange={(e) => onNameChange(e.target.value)}
          />
          <button type="button" className="comp-mini" onClick={onRemoveSection}>
            <NavIcon name="delete" /> Раздел
          </button>
        </div>
      <div className="stack" style={{ gap: 4 }}>
        {items.map((item, ii) => (
          <EquipmentItemRow
            key={ii}
            item={item}
            onChangeName={nameCallbacks[ii]}
            onChangeQty={qtyCallbacks[ii]}
            onChangeWeight={weightCallbacks[ii]}
            onChangeNotes={notesCallbacks[ii]}
            onToggleEquipped={equippedCallbacks[ii]}
            onRemove={removeCallbacks[ii]}
            onDragStart={dragStartCallbacks[ii]}
          />
        ))}
        {items.length === 0 && (
          <span className="muted">Пусто — перетащите сюда предмет или добавьте вручную.</span>
        )}
        <button type="button" className="comp-mini" onClick={addItem} style={{ alignSelf: "flex-start" }}>
          + Добавить предмет
        </button>
      </div>
      </div>
    </>
  );
});

// Memoized for the same reason as DndSpellsEdit/FeatureListEdit — one of the
// larger subtrees on the sheet (drag-and-drop, multiple named sections).
const DndEquipmentEdit = memo(function DndEquipmentEdit({
  sections,
  onChange,
}: {
  sections: DndEquipmentSection[];
  onChange: (v: DndEquipmentSection[]) => void;
}) {
  const [dragOverSection, setDragOverSection] = useState<number | null>(null);
  const [confirmDialog, confirm] = useConfirm();

  function addSection() {
    onChange([...sections, { name: "Новый раздел", items: [] }]);
  }
  const updateSectionName = useEvent((si: number, name: string) => {
    const next = sections.slice();
    next[si] = { ...next[si], name };
    onChange(next);
  });
  // Как и с предметами: список берётся заново после ответа на диалог.
  const dropSectionAt = useEvent((si: number) => onChange(sections.filter((_, idx) => idx !== si)));
  const removeSection = useEvent(async (si: number) => {
    const name = sections[si]?.name || "раздел";
    const ok = await confirm({ title: "Удалить раздел?", message: `Удалить «${name}» и все предметы в нём?`, confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    dropSectionAt(si);
  });
  const setSectionItems = useEvent((si: number, items: DndEquipmentItem[]) => {
    const next = sections.slice();
    next[si] = { ...next[si], items };
    onChange(next);
  });
  const moveItem = useEvent((fromSi: number, fromIi: number, toSi: number) => {
    if (fromSi === toSi) return;
    const next = sections.map((s) => ({ ...s, items: s.items.slice() }));
    const [item] = next[fromSi].items.splice(fromIi, 1);
    next[toSi].items.push(item);
    onChange(next);
  });
  const handleDrop = useEvent((e: DragEvent<HTMLDivElement>, si: number) => {
    e.preventDefault();
    setDragOverSection(null);
    const movePayload = e.dataTransfer.getData(EQUIPMENT_DRAG_MIME);
    if (movePayload) {
      try {
        const { sectionIndex, itemIndex } = JSON.parse(movePayload);
        moveItem(sectionIndex, itemIndex, si);
      } catch {}
      return;
    }
    const result = readSearchDrop(e);
    if (!result) return;
    const suffix = result.kind === "spell" ? " (свиток)" : "";
    const next = sections.map((s, idx) =>
      idx === si
        ? { ...s, items: [...s.items, { name: `${result.title}${suffix}`, qty: "", weight: "", notes: "" }] }
        : s
    );
    onChange(next);
  });

  const nameChangeCallbacks = useMemo(
    () => sections.map((_, si) => (v: string) => updateSectionName(si, v)),
    [sections.length, updateSectionName]
  );
  const removeSectionCallbacks = useMemo(
    () => sections.map((_, si) => () => removeSection(si)),
    [sections.length, removeSection]
  );
  const itemsChangeCallbacks = useMemo(
    () => sections.map((_, si) => (items: DndEquipmentItem[]) => setSectionItems(si, items)),
    [sections.length, setSectionItems]
  );
  const dragOverCallbacks = useMemo(
    () =>
      sections.map((_, si) => (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOverSection(si);
      }),
    [sections.length]
  );
  const dragLeaveCallback = useCallback(() => setDragOverSection(null), []);
  const dropCallbacks = useMemo(
    () => sections.map((_, si) => (e: DragEvent<HTMLDivElement>) => handleDrop(e, si)),
    [sections.length, handleDrop]
  );

  return (
    <div className="stack">
      {confirmDialog}
      <div className="sb-section" style={{ margin: 0 }}>
        Снаряжение
      </div>
      {sections.map((section, si) => (
        <EquipmentSectionBlock
          key={si}
          si={si}
          section={section}
          isDragOver={dragOverSection === si}
          onNameChange={nameChangeCallbacks[si]}
          onRemoveSection={removeSectionCallbacks[si]}
          onItemsChange={itemsChangeCallbacks[si]}
          onSectionDragOver={dragOverCallbacks[si]}
          onSectionDragLeave={dragLeaveCallback}
          onSectionDrop={dropCallbacks[si]}
        />
      ))}
      <button type="button" onClick={addSection} style={{ alignSelf: "flex-start" }}>
        + Добавить раздел
      </button>
    </div>
  );
});

function DndEquipmentView({ sections }: { sections: DndEquipmentSection[] }) {
  const nonEmpty = sections.filter((s) => s.items.length > 0);
  if (nonEmpty.length === 0) return null;
  return (
    <>
      <div className="sb-section cs-mt">Снаряжение</div>
      {nonEmpty.map((section, si) => (
        <div key={si} className="sb-entry">
          {sections.length > 1 && <span className="sb-prop-label">{section.name}</span>}
          <ul className="dnd-equipment-view-list">
            {section.items.map((item, ii) => (
              <li key={ii}>
                {item.name}
                {item.qty && ` ×${item.qty}`}
                {item.weight && ` (${item.weight})`}
                {item.notes && ` — ${item.notes}`}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}


function isValidQty(v: string): boolean {
  if (!v.trim()) return true;
  return /^-?\d+([.,]\d+)?$/.test(v.trim());
}
function isValidWeight(v: string): boolean {
  if (!v.trim()) return true;
  return /^-?\d+([.,]\d+)?$/.test(v.trim().split(" ")[0]);
}
function EquipmentInlineForm({
  draft,
  onChange,
  onSave,
  onCancel,
  onRemove,
}: {
  draft: DndEquipmentItem;
  onChange: (v: DndEquipmentItem) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const qtyOk = isValidQty(draft.qty);
  const wOk = isValidWeight(draft.weight);
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "4px 0" }}>
      <input
        autoFocus
        placeholder="Название"
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        style={{ flex: "2 1 140px" }}
      />
      <input
        placeholder="Кол-во"
        value={draft.qty}
        onChange={(e) => onChange({ ...draft, qty: e.target.value })}
        style={{ flex: "1 1 60px", borderColor: qtyOk ? undefined : "var(--accent)" }}
        title={qtyOk ? undefined : "Число, напр. 2 или 1"}
      />
      <input
        placeholder="Вес"
        value={draft.weight}
        onChange={(e) => onChange({ ...draft, weight: e.target.value })}
        style={{ flex: "1 1 60px", borderColor: wOk ? undefined : "var(--accent)" }}
        title={wOk ? undefined : "Число, напр. 0.5"}
      />
      <input
        placeholder="Заметка"
        value={draft.notes}
        onChange={(e) => onChange({ ...draft, notes: e.target.value })}
        style={{ flex: "2 1 120px" }}
      />
      <label className="row" style={{ gap: 4, flex: "0 0 auto" }}>
        <input
          type="checkbox"
          checked={!!draft.equipped}
          onChange={(e) => onChange({ ...draft, equipped: e.target.checked })}
        />
        Надето
      </label>
      <button type="button" className="primary" onClick={onSave} disabled={!draft.name.trim()}>
        Сохранить
      </button>
      <button type="button" onClick={onCancel}>
        Отмена
      </button>
      {onRemove && (
        <button type="button" className="danger" onClick={onRemove}>
          Удалить
        </button>
      )}
    </div>
  );
}

// Same read-only rows as DndEquipmentView, but a row's ✎ opens inline
// editing, clicking the name (for compendium-linked items) shows the
// description instead, an equipped toggle sits on the left, and each
// section gets three add affordances (свой ввод / компендиум / мешок) plus
// drag-drop straight from the bag/search — no need to open the full
// DndCharacterEdit form for a quick inventory tweak at the table.
// Стартовые наборы класса и предыстории, связанные ссылками на записи
// снаряжения (data.equipment_a_items / equipment_b_items). Пока набор не
// размечен ссылками, здесь пусто — текстовое описание набора живёт в
// компендиуме и переносится вручную, как и раньше.
// Порядок и подписи монет — от медной к платиновой. Электрум стоит между
// серебром и золотом, как в книге, хотя пользуются им редко.
const COIN_FIELDS = [
  { key: "cp", label: "ММ", title: "Медные монеты" },
  { key: "sp", label: "СМ", title: "Серебряные монеты" },
  { key: "ep", label: "ЭМ", title: "Электрумовые монеты" },
  { key: "gp", label: "ЗМ", title: "Золотые монеты" },
  { key: "pp", label: "ПМ", title: "Платиновые монеты" },
] as const satisfies readonly { key: keyof DndCoins; label: string; title: string }[];

const EMPTY_COINS: DndCoins = { cp: "", sp: "", ep: "", gp: "", pp: "" };

function DndEquipmentQuickView({
  sections,
  systemId,
  coins,
  onQuickUpdate,
}: {
  sections: DndEquipmentSection[];
  systemId: number | null;
  coins?: DndCoins;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const [editing, setEditing] = useState<{ si: number; ii: number } | null>(null);
  const [addingSection, setAddingSection] = useState<number | null>(null);
  const [addMode, setAddMode] = useState<"compendium" | "bag" | null>(null);
  const [draft, setDraft] = useState<DndEquipmentItem>(EMPTY_EQUIPMENT_ITEM);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CompendiumEntry[]>([]);
  const [descOpen, setDescOpen] = useState<{ si: number; ii: number } | null>(null);
  const [descriptions, setDescriptions] = useState<Record<number, string>>({});
  const [dragOverSection, setDragOverSection] = useState<number | null>(null);
  const { items: bagItems } = useBag();
  const [confirmDialog, confirm] = useConfirm();

  useEffect(() => {
    if (addMode !== "compendium" || !systemId) return;
    loadDndEquipmentEntries(systemId).then(setOptions);
  }, [addMode, systemId]);

  // Nested function declarations below don't retain the `if (!onQuickUpdate)
  // return` narrowing above (TS control-flow narrowing doesn't cross
  // function boundaries) — capture a definitely-non-optional reference once
  // the guard has passed instead of re-checking `onQuickUpdate` at each call.
  if (!onQuickUpdate) return <DndEquipmentView sections={sections} />;
  // Пустой список разделов больше не прячет блок целиком: монеты живут здесь,
  // и у персонажа без единого предмета кошелёк всё равно есть.
  const commit = onQuickUpdate;

  function startEdit(si: number, ii: number) {
    setEditing({ si, ii });
    setAddingSection(null);
    setDraft({ ...sections[si].items[ii] });
  }
  function startAdd(si: number, mode: "compendium" | "bag" | null) {
    setAddingSection(si);
    setAddMode(mode);
    setEditing(null);
    setDraft(EMPTY_EQUIPMENT_ITEM);
    setQuery("");
  }
  function cancel() {
    setEditing(null);
    setAddingSection(null);
    setAddMode(null);
  }
  function saveEdit() {
    if (!editing || !draft.name.trim()) return;
    const next = sections.map((s, si) =>
      si !== editing.si ? s : { ...s, items: s.items.map((it, ii) => (ii === editing.ii ? draft : it)) }
    );
    commit({ equipmentSections: next });
    setEditing(null);
  }
  function appendItem(si: number, item: DndEquipmentItem) {
    const next = sections.map((s, idx) => (idx !== si ? s : { ...s, items: [...s.items, item] }));
    commit({ equipmentSections: next });
    setAddingSection(null);
    setAddMode(null);
  }
  function saveAdd() {
    if (addingSection == null || !draft.name.trim()) return;
    appendItem(addingSection, draft);
  }
  // «Принять» — снять пометку; больше ничего не меняется: предмет уже здесь.
  function acceptItem(si: number, ii: number) {
    commit({
      equipmentSections: sections.map((sec, idx) =>
        idx !== si
          ? sec
          : {
              ...sec,
              items: sec.items.map((it, jj) => {
                if (jj !== ii) return it;
                const { pendingFrom: _dropped, ...rest } = it;
                return rest;
              }),
            }
      ),
    });
  }

  async function addFromCompendium(si: number, entry: CompendiumEntry) {
    const meta = await fetchEquipmentMeta(entry.id);
    appendItem(si, { name: entry.name, qty: "", weight: "", notes: "", ...meta });
  }
  async function addFromBag(si: number, result: SearchResult) {
    if (result.type === "compendium_entry" && (result.kind === "equipment" || result.kind === "magic_item")) {
      const meta = await fetchEquipmentMeta(result.id);
      appendItem(si, { name: result.title, qty: "", weight: "", notes: "", ...meta });
    } else {
      const suffix = result.kind === "spell" ? " (свиток)" : "";
      appendItem(si, { name: `${result.title}${suffix}`, qty: "", weight: "", notes: "" });
    }
  }
  async function removeItem(si: number, ii: number) {
    const name = sections[si]?.items[ii]?.name || "предмет";
    const ok = await confirm({ title: "Удалить предмет?", message: `Удалить «${name}»?`, confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    const next = sections.map((s, sIdx) =>
      sIdx !== si ? s : { ...s, items: s.items.filter((_, iIdx) => iIdx !== ii) }
    );
    commit({ equipmentSections: next });
    setEditing(null);
  }
  function toggleEquipped(si: number, ii: number) {
    const next = sections.map((s, sIdx) =>
      sIdx !== si ? s : { ...s, items: s.items.map((it, iIdx) => (iIdx === ii ? { ...it, equipped: !it.equipped } : it)) }
    );
    commit({ equipmentSections: next });
  }
  async function toggleDescription(si: number, ii: number, entryId?: number | null) {
    if (!entryId) return;
    if (descOpen && descOpen.si === si && descOpen.ii === ii) {
      setDescOpen(null);
      return;
    }
    setDescOpen({ si, ii });
    if (!(entryId in descriptions)) {
      try {
        const entry = await api.get<CompendiumEntry>(`/systems/entries/${entryId}`);
        setDescriptions((d) => ({ ...d, [entryId]: entry.description || "Нет описания." }));
      } catch {
        setDescriptions((d) => ({ ...d, [entryId]: "Нет описания." }));
      }
    }
  }
  async function handleDrop(e: DragEvent<HTMLDivElement>, si: number) {
    e.preventDefault();
    setDragOverSection(null);
    const result = readSearchDrop(e);
    if (!result) return;
    await addFromBag(si, result);
  }

  const filteredOptions = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  // S-17: сводка веса/кол-ва/атюна над инвентарём
  const summary = (() => {
    const all = sections.flatMap((s) => s.items);
    const totalItems = all.length;
    const equipped = all.filter((i) => i.equipped).length;
    let totalWeight = 0;
    let hasWeight = false;
    for (const it of all) {
      const w = parseFloat(String(it.weight).replace(",", "."));
      if (Number.isFinite(w)) {
        const q = parseInt(String(it.qty).trim(), 10);
        const qty = Number.isFinite(q) && q > 0 ? q : 1;
        totalWeight += w * qty;
        hasWeight = true;
      }
    }
    return { totalItems, equipped, totalWeight, hasWeight };
  })();
  return (
    <>
      {confirmDialog}
      <div className="sb-section cs-mt">Снаряжение</div>
      <div className="row muted" style={{ gap: 8, flexWrap: "wrap", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
        <span>Предметов: {summary.totalItems}</span>
        {summary.equipped > 0 && <><span>·</span><span>Надето: {summary.equipped}</span></>}
        {summary.hasWeight && <><span>·</span><span>Вес: {summary.totalWeight.toFixed(1).replace(/\.0$/, "")}</span></>}
      </div>
      {/* Монеты правятся прямо здесь. Раньше они только показывались, и то
          лишь когда были непустыми: вписать добычу после боя было негде,
          хотя это ровно то, что за столом делают чаще всего остального в
          этой вкладке. Порядок — от медной к платиновой, как в кошельке. */}
      <div className="row dnd-coins">
        {COIN_FIELDS.map(({ key, label, title }) => (
          <label key={key} className="dnd-coin" title={title}>
            <input
              inputMode="numeric"
              value={coins?.[key] ?? ""}
              aria-label={title}
              onChange={(e) =>
                commit({
                  coins: { ...(coins ?? EMPTY_COINS), [key]: e.target.value.replace(/[^\d-]/g, "") },
                })
              }
            />
            <span className="muted">{label}</span>
          </label>
        ))}
      </div>
      {sections.map((section, si) => (
        <div
          key={si}
          className={`sb-entry${dragOverSection === si ? " drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverSection(si);
          }}
          onDragLeave={() => setDragOverSection(null)}
          onDrop={(e) => handleDrop(e, si)}
        >
          {sections.length > 1 && <span className="sb-prop-label">{section.name}</span>}
          <ul className="dnd-equipment-view-list">
            {section.items.map((item, ii) =>
              editing && editing.si === si && editing.ii === ii ? (
                <li key={ii}>
                  <EquipmentInlineForm
                    draft={draft}
                    onChange={setDraft}
                    onSave={saveEdit}
                    onCancel={cancel}
                    onRemove={() => removeItem(si, ii)}
                  />
                </li>
              ) : (
                <li key={ii}>
                  <div className="row dnd-equipment-quick-row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className={`comp-mini dnd-equip-toggle${item.equipped ? " is-equipped" : ""}`}
                      title={item.equipped ? "Надето" : "Не надето"}
                      aria-label={`${item.name || "Предмет"}: надето`}
                      aria-pressed={!!item.equipped}
                      onClick={() => toggleEquipped(si, ii)}
                    >
                      {item.equipped ? "●" : "○"}
                    </button>
                    {item.entryId ? (
                      <button
                        type="button"
                        className="dnd-equipment-name-link"
                        aria-label={`${item.name} — открыть описание`}
                        onClick={() => toggleDescription(si, ii, item.entryId!)}
                        style={{ flex: 1 }}
                      >
                        {item.name}
                        {item.qty && ` ×${item.qty}`}
                        {item.weight && ` (${item.weight})`}
                        {item.notes && ` — ${item.notes}`}
                      </button>
                    ) : (
                      <span style={{ flex: 1 }}>
                        {item.name}
                        {item.qty && ` ×${item.qty}`}
                        {item.weight && ` (${item.weight})`}
                        {item.notes && ` — ${item.notes}`}
                      </span>
                    )}
                    {/* Переданное чужой репликой: пока не принято, строка
                        стоит с пометкой и двумя кнопками — это и есть всё
                        «уведомление», которого в приложении нет (R2/W8). */}
                    {item.pendingFrom && (
                      <>
                        <span className="dnd-pending-mark">не принято</span>
                        <button type="button" className="comp-mini" onClick={() => acceptItem(si, ii)}>
                          Принять
                        </button>
                        <button type="button" className="comp-mini" onClick={() => removeItem(si, ii)}>
                          Вернуть
                        </button>
                      </>
                    )}
                    <button type="button" className="comp-mini" title="Редактировать" aria-label="Редактировать предмет" onClick={() => startEdit(si, ii)}>
                      <NavIcon name="edit" />
                    </button>
                  </div>
                  {descOpen && descOpen.si === si && descOpen.ii === ii && item.entryId && (
                    <div className="dnd-spell-description">
                      {equipmentTagsLine(item) && <div className="dnd-equipment-tags">{equipmentTagsLine(item)}</div>}
                      <MentionText text={descriptions[item.entryId] ?? "Загрузка…"} />
                    </div>
                  )}
                </li>
              )
            )}
          </ul>
          {addingSection === si ? (
            addMode === "compendium" ? (
              <div className="dnd-spell-add">
                <input
                  autoFocus
                  placeholder="Название предмета…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {filteredOptions.length > 0 && (
                  <div className="mention-dropdown">
                    {filteredOptions.slice(0, 8).map((o) => (
                      <div
                        key={o.id}
                        className="mention-dropdown-item"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addFromCompendium(si, o);
                        }}
                      >
                        {o.name}
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={cancel}>
                  Отмена
                </button>
              </div>
            ) : addMode === "bag" ? (
              <div className="stack" style={{ gap: 4 }}>
                {bagItems.length === 0 && <span className="muted">Мешок пуст.</span>}
                {bagItems.map((b, bi) => (
                  <button
                    key={bi}
                    type="button"
                    className="comp-mini"
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => addFromBag(si, b)}
                  >
                    {b.title}
                  </button>
                ))}
                <button type="button" onClick={cancel}>
                  Отмена
                </button>
              </div>
            ) : (
              <EquipmentInlineForm draft={draft} onChange={setDraft} onSave={saveAdd} onCancel={cancel} />
            )
          ) : (
            <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
              <button type="button" className="dnd-equipment-add-btn" onClick={() => startAdd(si, null)}>
                + Свой
              </button>
              <button type="button" className="dnd-equipment-add-btn" onClick={() => startAdd(si, "compendium")}>
                + Из компендиума
              </button>
              <button type="button" className="dnd-equipment-add-btn" onClick={() => startAdd(si, "bag")}>
                + Из мешка
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// Происхождение персонажа — классы, вид, предыстория — и всё, что они за
// собой тянут: справочники компендиума, выдача и снятие особенностей,
// спасбросков, владений и заклинаний, гашение гонок. Вынесено в хук, потому
// что после роспуска формы правки (гриллинг 2026-09-03) этим пользуется
// карандаш в плашке-шапке, а не только сама форма: происхождение правится
// там, где оно написано.
function useDndOrigin(
  value: DndCharacterData,
  onChange: (v: DndCharacterData) => void,
  // Справочники компендиума (системы, иерархия классов, виды, предыстории,
  // механики) нужны только когда происхождение действительно правят. Без
  // этого флага каждый открытый лист — включая список статблоков бестиария —
  // лез бы в сеть за пятью справочниками просто чтобы показаться.
  enabled = true
) {
  const [systems, setSystems] = useState<System[]>([]);
  const [hierarchy, setHierarchy] = useState<DndClassHierarchy>({ classes: [], subclassesByClass: {} });
  const [species, setSpecies] = useState<DndSpeciesOption[]>([]);
  const [backgrounds, setBackgrounds] = useState<DndBackgroundOption[]>([]);
  const [damageTypes, setDamageTypes] = useState<DndMechanicsOption[]>([]);
  const [conditionOptions, setConditionOptions] = useState<DndMechanicsOption[]>([]);
  const [senseOptions, setSenseOptions] = useState<DndMechanicsOption[]>([]);
  // Справочник не загрузился. Раньше это было неотличимо от «в компендиуме
  // ничего нет»: пустой список подменял выпадающий список свободным вводом,
  // и мастер вписывал класс руками, теряя связь с компендиумом навсегда
  // (P1-Р8). Теперь поле остаётся списком и говорит, что случилось.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Бампается кнопкой «Повторить» — перезапускает эффекты загрузки.
  const [reloadKey, setReloadKey] = useState(0);
  const reloadOrigin = useCallback(() => {
    setLoadError(null);
    setReloadKey((n) => n + 1);
  }, []);

  // Kept in sync every commit so the field-setter callbacks below can have a
  // permanently stable identity (empty deps) while still always acting on the
  // latest value/onChange — required for React.memo on the heavy child
  // sections (FeatureListEdit ×4, DndEquipmentEdit, DndSpellsEdit,
  // DndProficienciesEdit) to actually skip re-rendering them when an
  // unrelated field on the sheet changes. Without this, a fresh inline
  // arrow function as `onChange` on every render would defeat memo just as
  // much as a fresh `value` object would.
  //
  // Именно `useLatest`, а не присваивание в теле компонента: сеттеры ниже
  // читают реф после `await`, а запись во время рендера отдаёт им значение
  // прохода, который React мог выбросить.
  const valueRef = useLatest(value);
  const onChangeRef = useLatest(onChange);
  const hierarchyRef = useLatest(hierarchy);
  // Сведение имён навыков: встроенные алиасы плюс те, что мастер добавил в
  // справочник. Через реф — сеттеры ниже читают его после `await`.
  const skillsRef = useLatest(useDndSkills(value.systemId));
  // Все пикеры ниже ходят в сеть, а потом пишут в лист. Раньше побеждал тот,
  // чей запрос доехал последним, а не тот, который нажали последним: щёлкнув
  // уровень 1→5 подряд, можно было получить набор особенностей от третьего
  // щелчка. Номер операции отсекает всё, что пришло после начала следующей.
  const opSeqRef = useRef(0);
  const {
    setAttacks,
    setEquipmentSections,
    setSpeciesFeatures,
    setClassFeatures,
    setFeats,
    setSpecialAbilities,
    setProficiencies,
    setSpellsPatch,
    setAbilities,
    setSavingThrowProfs,
    setSkillProfs,
    setNarrativeField,
    setSpellcasting,
    setClasses,
    pickClass,
    pickSubclass,
    changeClassLevel,
    removeClass,
  } = useMemo(() => {
    function set<K extends keyof DndCharacterData>(key: K, v: DndCharacterData[K]) {
      onChangeRef.current({ ...valueRef.current, [key]: v });
    }

    function setClasses(classes: DndClassEntry[]) {
      onChangeRef.current({
        ...valueRef.current,
        classes,
        hitDice: computeHitDice(classes),
        proficiencyBonus: computeProficiencyBonus(classes),
      });
    }

    // Picking a class from the dropdown also fills its Владения
    // навыками/Снаряжение А/Снаряжение Б into Заметки, and its features (up
    // to the row's current level) into Классовые особенности; switching away
    // from a class (or clearing the row) removes both again — including any
    // subclass features, since the subclass resets when the class changes.
    async function pickClass(i: number, classId: number | null) {
      const seq = ++opSeqRef.current;
      const value = valueRef.current;
      const hierarchy = hierarchyRef.current;
      const oldClass = value.classes[i];
      let notes = oldClass?.className ? removeClassNotesBlock(value.notes, oldClass.className) : value.notes;
      let classFeatures = removeFeaturesBySource(value.classFeatures, oldClass?.classId, oldClass?.subclassId);
      // Уходящий класс забирает свои спасброски и инструменты — но только те,
      // которых не даёт ни один из оставшихся источников.
      const revoked = mergeGrants(await loadGrants([oldClass?.classId, oldClass?.subclassId], skillsRef.current.resolve));
      const kept = await loadGrants([
        ...value.classes.filter((_, idx) => idx !== i).flatMap((c) => [c.classId, c.subclassId]),
        value.backgroundId,
      ], skillsRef.current.resolve);
      const cleared = revokeGrants(value, revoked, kept);
      let savingThrowProfs = cleared.savingThrowProfs;
      let proficiencies = cleared.proficiencies;
      const opt = hierarchy.classes.find((cl) => cl.id === classId);
      const nextClasses = value.classes.slice();
      nextClasses[i] = {
        ...nextClasses[i],
        classId,
        className: opt?.name ?? "",
        subclassId: null,
        subclassName: "",
        skillChoiceOptions: [],
        skillChoiceCount: 0,
        spellcastingAbility: "",
      };
      if (classId && opt && value.systemId) {
        try {
          const entry = await api.get<CompendiumEntry>(`/systems/entries/${classId}`);
          notes = upsertClassNotesBlock(notes, opt.name, buildClassNotesBlock(opt.name, entry.data));
          nextClasses[i] = {
            ...nextClasses[i],
            // Ключами: из 103 имён в `skill_choice_options` классов по базе
            // владельца 19 не совпадали с листом, и подсветка «от класса» у
            // этих навыков просто не загоралась.
            skillChoiceOptions: (Array.isArray(entry.data.skill_choice_options)
              ? (entry.data.skill_choice_options as string[])
              : []
            )
              .filter((s) => typeof s === "string" && s.trim())
              .map((s) => skillsRef.current.resolve(s) ?? s.trim()),
            skillChoiceCount: typeof entry.data.skill_choice_count === "number" ? entry.data.skill_choice_count : 0,
            spellcastingAbility:
              typeof entry.data.spellcasting_ability === "string" ? entry.data.spellcasting_ability : "",
          };
          const savingThrowKeys = parseAbilityNames(entry.data.saving_throws);
          if (savingThrowKeys.length > 0) {
            savingThrowProfs = { ...savingThrowProfs };
            for (const k of savingThrowKeys) savingThrowProfs[k] = true;
          }
          const toolPicks = Array.isArray(entry.data.tool_profs)
            ? (entry.data.tool_profs as { id: number; name: string }[])
            : [];
          const newTools = toolPicks.filter((t) => !proficiencies.some((p) => p.name === t.name));
          if (newTools.length > 0) {
            // Each tool's governing ability lives on its own compendium
            // entry (data.ability, see CompendiumSection's TOOL_ABILITY_FIELD),
            // not on the class's tool_profs pick — fetch it so the row
            // doesn't come in with the ability unset.
            const abilityKeys = await Promise.all(
              newTools.map(async (t) => {
                try {
                  const toolEntry = await api.get<CompendiumEntry>(`/systems/entries/${t.id}`);
                  const ability = typeof toolEntry.data.ability === "string" ? toolEntry.data.ability : "";
                  return ability ? ABILITY_NAME_TO_KEY[ability] ?? null : null;
                } catch {
                  return null;
                }
              })
            );
            proficiencies = [
              ...proficiencies,
              ...newTools.map((t, idx) => ({ entryId: t.id, name: t.name, abilityKey: abilityKeys[idx] })),
            ];
          }
        } catch {
          /* class has no compendium entry — nothing to fill */
        }
        const featureEntries = await loadDndClassFeatures(value.systemId, classId);
        classFeatures = [...classFeatures, ...featuresFromEntries(featureEntries, classId, nextClasses[i].level)];
      }
      const nextValue = {
        ...valueRef.current,
        classes: nextClasses,
        hitDice: computeHitDice(nextClasses),
        notes,
        classFeatures,
        savingThrowProfs,
        proficiencies,
        proficiencyBonus: computeProficiencyBonus(nextClasses),
      };
      // Clearing/reassigning the row's subclass above already dropped its
      // granted spells from nextClasses; recompute picks up that removal
      // (and any species grant that a level change made newly eligible).
      const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
      if (seq !== opSeqRef.current) return;
      onChangeRef.current({ ...nextValue, cantrips, spellsByLevel, spellSlotLevels });
    }

    // Same idea as pickClass, but subclasses don't affect Заметки — only
    // Классовые особенности (and any "Обретаемые заклинания", filtered to
    // this class row's own level).
    async function pickSubclass(i: number, subclassId: number | null) {
      const seq = ++opSeqRef.current;
      const value = valueRef.current;
      const hierarchy = hierarchyRef.current;
      const oldClass = value.classes[i];
      let classFeatures = removeFeaturesBySource(value.classFeatures, oldClass?.subclassId);
      const subclasses = oldClass?.classId != null ? hierarchy.subclassesByClass[oldClass.classId] ?? [] : [];
      const opt = subclasses.find((s) => s.id === subclassId);
      const nextClasses = value.classes.slice();
      nextClasses[i] = { ...nextClasses[i], subclassId, subclassName: opt?.name ?? "" };
      if (subclassId && value.systemId) {
        const featureEntries = await loadDndClassFeatures(value.systemId, subclassId);
        classFeatures = [
          ...classFeatures,
          ...featuresFromEntries(featureEntries, subclassId, nextClasses[i].level),
        ];
      }
      const nextValue = { ...valueRef.current, classes: nextClasses, classFeatures };
      const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
      if (seq !== opSeqRef.current) return;
      onChangeRef.current({ ...nextValue, cantrips, spellsByLevel, spellSlotLevels });
    }

    // Re-filters this row's class/subclass features against its new level —
    // raising the level can unlock more, lowering it can drop some. A level
    // change also shifts total character level (species grants) and this
    // row's own level (subclass grants), so granted spells get recomputed
    // in every branch below.
    async function changeClassLevel(i: number, level: number) {
      const seq = ++opSeqRef.current;
      const value = valueRef.current;
      const c = value.classes[i];
      const nextClasses = value.classes.slice();
      nextClasses[i] = { ...c, level };
      const proficiencyBonus = computeProficiencyBonus(nextClasses);
      if (!value.systemId || (c.classId == null && c.subclassId == null)) {
        const nextValue = {
          ...valueRef.current,
          classes: nextClasses,
          hitDice: computeHitDice(nextClasses),
          proficiencyBonus,
        };
        const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
        if (seq !== opSeqRef.current) return;
        onChangeRef.current({ ...nextValue, cantrips, spellsByLevel, spellSlotLevels });
        return;
      }
      let classFeatures = removeFeaturesBySource(value.classFeatures, c.classId, c.subclassId);
      if (c.classId != null) {
        const featureEntries = await loadDndClassFeatures(value.systemId, c.classId);
        classFeatures = [...classFeatures, ...featuresFromEntries(featureEntries, c.classId, level)];
      }
      if (c.subclassId != null) {
        const featureEntries = await loadDndClassFeatures(value.systemId, c.subclassId);
        classFeatures = [...classFeatures, ...featuresFromEntries(featureEntries, c.subclassId, level)];
      }
      const nextValue = {
        ...valueRef.current,
        classes: nextClasses,
        hitDice: computeHitDice(nextClasses),
        classFeatures,
        proficiencyBonus,
      };
      const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
      if (seq !== opSeqRef.current) return;
      onChangeRef.current({ ...nextValue, cantrips, spellsByLevel, spellSlotLevels });
    }

    // Подтверждение спрашивает вызывающая сторона (DndClassesEdit) — из
    // useMemo-фабрики модалку не показать, а `confirm("удалить ЭТО?")` здесь
    // и был тем самым системным окном, от которого уходим.
    async function removeClass(i: number) {
      const seq = ++opSeqRef.current;
      const value = valueRef.current;
      const removed = value.classes[i];
      const notes = removed?.className ? removeClassNotesBlock(value.notes, removed.className) : value.notes;
      const classFeatures = removeFeaturesBySource(value.classFeatures, removed?.classId, removed?.subclassId);
      const nextClasses = value.classes.filter((_, idx) => idx !== i);
      // Убранный класс забирает спасброски и инструменты с собой.
      const revoked = mergeGrants(await loadGrants([removed?.classId, removed?.subclassId], skillsRef.current.resolve));
      const kept = await loadGrants([
        ...nextClasses.flatMap((c) => [c.classId, c.subclassId]),
        value.backgroundId,
      ], skillsRef.current.resolve);
      const cleared = revokeGrants(value, revoked, kept);
      const nextValue = {
        ...valueRef.current,
        classes: nextClasses,
        hitDice: computeHitDice(nextClasses),
        notes,
        classFeatures,
        savingThrowProfs: cleared.savingThrowProfs,
        proficiencies: cleared.proficiencies,
        proficiencyBonus: computeProficiencyBonus(nextClasses),
      };
      const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
      if (seq !== opSeqRef.current) return;
      onChangeRef.current({ ...nextValue, cantrips, spellsByLevel, spellSlotLevels });
    }

    return {
      setAttacks: (v: DndManualAttack[]) => set("attacks", v),
      setEquipmentSections: (v: DndEquipmentSection[]) => set("equipmentSections", v),
      setSpeciesFeatures: (v: DndFeature[]) => set("speciesFeatures", v),
      setClassFeatures: (v: DndFeature[]) => set("classFeatures", v),
      setFeats: (v: DndFeature[]) => set("feats", v),
      setSpecialAbilities: (v: DndFeature[]) => set("specialAbilities", v),
      setProficiencies: (v: DndProficiencyEntry[]) => set("proficiencies", v),
      setSpellsPatch: (
        patch: Partial<Pick<DndCharacterData, "cantrips" | "spellSlotLevels" | "spellSlotPips" | "spellsByLevel">>
      ) => onChangeRef.current({ ...valueRef.current, ...patch }),
      setAbilities: (v: DndCharacterData["abilities"]) => set("abilities", v),
      setSavingThrowProfs: (v: DndCharacterData["savingThrowProfs"]) => set("savingThrowProfs", v),
      setSkillProfs: (v: DndCharacterData["skillProfs"]) => set("skillProfs", v),
      setNarrativeField: (key: keyof DndCharacterData, v: string) => set(key, v as DndCharacterData[typeof key]),
      setSpellcasting: (v: string) => set("spellcasting", v),
      setClasses,
      pickClass,
      pickSubclass,
      changeClassLevel,
      removeClass,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Все три эффекта ниже ходят в сеть и пишут в состояние. Без отмены запрос,
  // начатый до размонтирования или до смены системы, дописывал форму, которой
  // уже нет; без `catch` любая сетевая ошибка уходила в unhandled rejection и
  // на экране выглядела как «в компендиуме пусто».
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    api
      .get<System[]>("/systems", { signal: ac.signal })
      .then(setSystems)
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [enabled, reloadKey]);

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    findDndSystemId()
      .then((sid) => {
        if (!sid || ac.signal.aborted) return;
        const opts = { signal: ac.signal };
        return Promise.all([
          loadDndMechanicsGroup(sid, "Типы урона", opts).then(setDamageTypes),
          loadDndMechanicsGroup(sid, "Состояния", opts).then(setConditionOptions),
          loadDndMechanicsGroup(sid, "Особое восприятие", opts).then(setSenseOptions),
        ]);
      })
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [enabled, reloadKey]);

  useEffect(() => {
    if (!enabled) return;
    if (!value.systemId) {
      setHierarchy({ classes: [], subclassesByClass: {} });
      setSpecies([]);
      setBackgrounds([]);
      return;
    }
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    const systemId = value.systemId;
    Promise.all([
      loadDndClassHierarchy(systemId, opts).then((h) => {
        setHierarchy(h);
        for (const c of h.classes) classHitDieCache.set(c.id, c.hitDie);
        // Classes picked before the hierarchy finished loading (e.g. a saved
        // statblock reopened) had no hit die available yet — recompute now
        // that classHitDieCache is populated.
        // Через ref, а не через захваченный эффектом `value`: иерархия грузится
        // заметное время, и всё, что мастер успел набрать за это время,
        // затиралось устаревшим снимком.
        const fresh = valueRef.current;
        if (fresh.classes.some((c) => c.classId != null)) {
          onChangeRef.current({ ...fresh, hitDice: computeHitDice(fresh.classes) });
        }
      }),
      loadDndSpeciesOptions(systemId, opts).then(setSpecies),
      loadDndBackgroundOptions(systemId, opts).then(setBackgrounds),
    ]).catch((e) => {
      if (!isAbortError(e)) setLoadError(errorMessage(e));
    });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.systemId, enabled, reloadKey]);

  // Picking a species also fills its Видовые особенности and any
  // "Обретаемые заклинания" the character's total level already qualifies
  // for (always marked prepared); switching away removes the old species'
  // features and granted spells again.
  async function pickRace(id: number | null) {
    const seq = ++opSeqRef.current;
    const opt = species.find((s) => s.id === id);
    let speciesFeatures = removeFeaturesBySource(value.speciesFeatures, value.raceId);
    if (id && value.systemId) {
      const featureEntries = await loadDndSpeciesFeatures(value.systemId, id);
      speciesFeatures = [...speciesFeatures, ...featuresFromEntries(featureEntries, id)];
    }
    const nextValue = {
      ...value,
      speciesFeatures,
      raceId: id,
      raceName: opt?.name ?? "",
      raceTypeName: opt?.creatureTypeName ?? "",
      speed: opt?.walkSpeed ? `${opt.walkSpeed} фт.` : value.speed,
    };
    const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(nextValue);
    if (seq !== opSeqRef.current) return;
    // Снимок, от которого считали, устарел на время загрузки — накладываем
    // посчитанное на свежий лист, а не подменяем его целиком.
    onChange({
      ...valueRef.current,
      speciesFeatures: nextValue.speciesFeatures,
      raceId: nextValue.raceId,
      raceName: nextValue.raceName,
      raceTypeName: nextValue.raceTypeName,
      speed: nextValue.speed,
      cantrips,
      spellsByLevel,
      spellSlotLevels,
    });
  }

  // Requirement 5: picking a background also fills in what it grants —
  // skill proficiencies (checked), tool proficiencies (appended as a
  // proficiency row) and the origin feat (appended to Черты, with its full
  // description) — so the player doesn't have to re-enter them by hand.
  async function pickBackground(id: number | null) {
    const seq = ++opSeqRef.current;
    const opt = backgrounds.find((b) => b.id === id);
    // Прежняя предыстория забирает своё: навыки, инструмент и черту
    // происхождения. Раньше не снималось ничего — три смены предыстории
    // оставляли три черты и все накопленные навыки.
    const previous = mergeGrants(await loadGrants([value.backgroundId], skillsRef.current.resolve));
    const revoked: SourceGrants = {
      ...previous,
      // backgroundSkillNames — то, что реально было применено к листу;
      // запись компендиума могла с тех пор измениться.
      skills: [...new Set([...previous.skills, ...value.backgroundSkillNames])],
    };
    const kept = await loadGrants(value.classes.flatMap((c) => [c.classId, c.subclassId]), skillsRef.current.resolve);
    const cleared = revokeGrants(value, revoked, kept);
    const base: DndCharacterData = { ...value, ...cleared };

    const patch: Partial<DndCharacterData> = { backgroundId: id, backgroundName: opt?.name ?? "", backgroundSkillNames: [] };
    if (id) {
      try {
        const entry = await api.get<CompendiumEntry>(`/systems/entries/${id}`);
        // Ключами, а не именами. Здесь и жил дефект: владение ставилось
        // только `if (s in nextSkillProfs)`, то есть если имя из компендиума
        // дословно совпало с именем в листе. По базе владельца из 72 выдач
        // так молча терялись 15 — «Расследование», «Внимательность»,
        // «Аркана» и прочие написания того же навыка.
        const grantedSkills = (Array.isArray(entry.data.skills) ? (entry.data.skills as string[]) : [])
          .filter((s) => typeof s === "string" && s.trim())
          .map((s) => skillsRef.current.resolve(s) ?? s.trim());
        patch.backgroundSkillNames = grantedSkills;
        if (grantedSkills.length > 0) {
          const nextSkillProfs = { ...base.skillProfs };
          // Ставим владение и тому навыку, которого в листе ещё нет: иначе
          // навык, заведённый мастером, предысторией не выдавался бы.
          for (const s of grantedSkills) if (!nextSkillProfs[s]) nextSkillProfs[s] = 1;
          patch.skillProfs = nextSkillProfs;
        }
        const tools = typeof entry.data.tools === "string" ? entry.data.tools : "";
        if (tools && !base.proficiencies.some((p) => p.name === tools)) {
          patch.proficiencies = [...base.proficiencies, { entryId: null, name: tools, abilityKey: null }];
        }
        const originFeat = entry.data.origin_feat as { id: number; name: string } | undefined;
        if (originFeat && !base.feats.some((f) => f.name === originFeat.name)) {
          let description = "";
          try {
            const featEntry = await api.get<CompendiumEntry>(`/systems/entries/${originFeat.id}`);
            description = featEntry.description || "";
          } catch {
            /* feat entry missing — leave description blank */
          }
          patch.feats = [...base.feats, { name: originFeat.name, description }];
        }
      } catch {
        /* background has no compendium entry (freehand) — nothing to fill */
      }
    }
    if (seq !== opSeqRef.current) return;
    onChange({ ...valueRef.current, ...cleared, ...patch });
  }


  return {
    systems,
    hierarchy,
    species,
    backgrounds,
    damageTypes,
    conditionOptions,
    senseOptions,
    loadError,
    reloadOrigin,
    setAttacks,
    setEquipmentSections,
    setSpeciesFeatures,
    setClassFeatures,
    setFeats,
    setSpecialAbilities,
    setProficiencies,
    setSpellsPatch,
    setAbilities,
    setSavingThrowProfs,
    setSkillProfs,
    setNarrativeField,
    setSpellcasting,
    setClasses,
    pickClass,
    pickSubclass,
    changeClassLevel,
    removeClass,
    pickRace,
    pickBackground,
  };
}

interface AttackRow {
  name: string;
  bonus: string;
  damage: string;
  range: string;
  description?: string;
  timing: DndActionTiming;
  // Откуда строка пришла — чтобы клик открыл её карточку, а окно знало, что
  // именно тратить. У оружия и вручную вписанных атак источника нет: тратить
  // им нечего, а описание ручной атаки и так стоит в строке.
  source?:
    | { kind: "spell"; spell: DndSpellEntry; level: number }
    | { kind: "feature"; feature: DndFeature };
}

// Equipped weapons show up as attack rows automatically — no need to
// duplicate a weapon's damage/properties into a separate hand-written entry
// once it's marked "надето". Attack bonus assumes proficiency (this app
// doesn't track weapon-proficiency booleans separately) and picks the
// higher of STR/DEX for finesse weapons, DEX for ranged-only, STR otherwise.
function weaponAttackRows(
  sections: DndEquipmentSection[],
  abilities: DndCharacterData["abilities"],
  profBonus: number,
  exhaustionPenalty = 0
): AttackRow[] {
  const str = abilityModifier(abilities.str);
  const dex = abilityModifier(abilities.dex);
  return sections
    .flatMap((s) => s.items)
    .filter((i) => i.equipped && i.weaponDamage)
    .map((i) => {
      // Свойства оружия приходят строкой из компендиума, поэтому признаки
      // ищутся без учёта регистра: «Фехтовальное» и «фехтовальное» — одно и
      // то же, а раньше вторая форма молча меняла характеристику атаки.
      const props = (i.weaponProperties ?? "").toLowerCase();
      const finesse = props.includes("фехтовальн");
      const thrown = props.includes("метательн");
      // Метательное ближнее оружие бросают Силой, если оно не фехтовальное —
      // то есть выбор характеристики тот же, что и в ближнем бою.
      const rangedOnly = !!i.weaponAttackRanged && !i.weaponAttackMelee && !thrown;
      const mod = finesse ? Math.max(str, dex) : rangedOnly ? dex : str;
      const range = i.weaponAttackMelee && i.weaponAttackRanged ? "Ближний/Дальний" : i.weaponAttackRanged ? "Дальний" : "Ближний";
      // Урон печатался как есть — «1к8» без модификатора, который игрок
      // прибавлял в уме каждый бросок. Теперь формула полная: «1к8 +3».
      const damageWithMod = i.weaponDamage
        ? `${i.weaponDamage}${mod !== 0 ? ` ${formatModifier(mod)}` : ""}`
        : "";
      const damage = [damageWithMod, i.weaponProperties, i.weaponMastery && `Мастерство: ${i.weaponMastery}`]
        .filter(Boolean)
        .join(" · ");
      return {
        name: i.name,
        bonus: formatModifier(mod + profBonus - exhaustionPenalty),
        damage,
        range,
        timing: "action" as const,
      };
    });
}

// A spell's `attackSave` field holds one of SPELL_ATTACK_SAVE_OPTIONS —
// "Атака ближняя"/"Атака дальняя" or "Спасбросок <Ability>" — plain option
// text, not a number. Converts it into the same "АТК +N" / "СЛ <ABBR> N"
// shorthand the Атаки table shows for weapons, using the character's own
// spell-attack-bonus/spell-DC formulas (already computed by the caller).
function formatSpellAttackSave(attackSave: string | undefined, spellAttackBonus: number, spellDc: number): string {
  if (!attackSave) return "—";
  if (attackSave.startsWith("Атака")) return `АТК ${formatModifier(spellAttackBonus)}`;
  if (attackSave.startsWith("Спасбросок")) {
    const abilityName = attackSave.replace("Спасбросок", "").trim();
    const key = ABILITY_NAME_TO_KEY[abilityName];
    const abbr = key ? ABILITY_LABELS.find((a) => a.key === key)?.label : null;
    return `СЛ ${abbr ?? abilityName} ${spellDc}`;
  }
  return attackSave;
}

// Показываем в Бою только то, что реально подготовлено (звёздочка), иначе
// таблица Атак раздувается всем, что вообще есть в книге заклинаний —
// заговоры получают тот же звёздочный переключатель, что и заклинания по
// уровням (см. togglePrepared в DndSpellLevelSection), так что фильтр по
// prepared применяется к обоим одинаково.
function combatSpellRows(
  cantrips: DndSpellEntry[],
  spellsByLevel: DndSpellEntry[][],
  spellAttackBonus: number,
  spellDc: number
): AttackRow[] {
  // Круг нужен строке: по нему окно знает, какую ячейку тратить.
  const withLevel: { spell: DndSpellEntry; level: number }[] = [
    ...cantrips.filter((s) => s.prepared > 0).map((spell) => ({ spell, level: 0 })),
    ...spellsByLevel.flatMap((lvl, i) => lvl.filter((s) => s.prepared > 0).map((spell) => ({ spell, level: i + 1 }))),
  ];
  return withLevel
    .map(({ spell, level }) => ({ ...spell, __level: level }) as DndSpellEntry & { __level: number })
    .filter((s) => {
      // Раньше здесь стоял фильтр по полю `category`, которое заполнялось
      // у меньшинства записей и потому прятало большую часть книги. Теперь
      // критерий механический — есть бросок или числовой эффект; для листов
      // со старым снапшотом остаётся прежняя проверка.
      if (s.checks?.length || s.effects?.length) return hasResolvableEffect(s.checks ?? [], s.effects ?? []);
      return s.category === "Боевое" || s.category === "Лечащее";
    })
    .map((s) => {
      const timing = s.castingTiming ?? (s.castingTime ? inferTimingFromLegacyText(s.castingTime).timing : "action");
      const structured = !!(s.checks?.length || s.effects?.length);
      return {
        name: s.name,
        bonus: structured
          ? checksLabel(s.checks ?? [], spellAttackBonus, spellDc)
          : formatSpellAttackSave(s.attackSave, spellAttackBonus, spellDc),
        damage: structured ? effectsLabel(s.effects ?? []) : s.damage || s.healing || "—",
        range: s.range || "—",
        timing,
        source: { kind: "spell", spell: s, level: s.__level },
      };
    });
}

// Умения классов, видов, черт и прочего, у которых проставлено время
// накладывания — Второе дыхание, Наложение рук, Ярость. До появления
// эффектов такие способности во вкладку не попадали вовсе: она собиралась
// только из оружия, заклинаний и вручную вписанных атак.
function featureActionRows(
  groups: DndFeature[][],
  spellAttackBonus: number,
  spellDc: number
): AttackRow[] {
  return groups
    .flat()
    .filter((f) => !!f.castingTiming)
    .map((f) => ({
      name: f.name,
      bonus: checksLabel(f.checks ?? [], spellAttackBonus, spellDc),
      damage: effectsLabel(f.effects ?? []),
      // Время не дублируем — оно и есть заголовок секции таблицы; в этой
      // колонке у умения полезнее его стоимость («Ячейка», «1 за долгий
      // отдых»), и «Иное» показываем только когда оно что-то уточняет.
      range: [f.castingTiming === "other" ? f.castingTimingOther : "", costSummary(f.cost)]
        .filter(Boolean)
        .join(", ") || "—",
      timing: f.castingTiming as DndActionTiming,
      source: { kind: "feature", feature: f },
    }));
}

function manualAttackRows(attacks: DndManualAttack[]): AttackRow[] {
  return attacks.map((a) => ({
    name: a.name || "Без названия",
    bonus: "",
    damage: "",
    range: "",
    description: a.description,
    timing: a.timing,
  }));
}

// Same equipped-weapon source as weaponAttackRows, but as a single-line
// name+description pair for the compact mini card, which has no room for a
// table.
function equippedWeaponSummaries(sections: DndEquipmentSection[]): DndFeature[] {
  return sections
    .flatMap((s) => s.items)
    .filter((i) => i.equipped && i.weaponDamage)
    .map((i) => {
      const type = i.weaponAttackMelee && i.weaponAttackRanged ? "Ближняя/дальняя атака" : i.weaponAttackRanged ? "Дальняя атака" : "Ближняя атака";
      const parts = [type, i.weaponDamage, i.weaponProperties, i.weaponMastery && `Мастерство: ${i.weaponMastery}`].filter(Boolean);
      return { name: i.name, description: parts.join(" · ") };
    });
}

function AttacksTable({
  title,
  rows,
  onOpen,
}: {
  title: string;
  rows: AttackRow[];
  // Строка со источником кликабельна: раньше вкладка показывала имя,
  // бонус и урон, а прочитать, что способность делает, было нельзя — только
  // уйти на другую вкладку и искать её там заново.
  onOpen?: (row: AttackRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="cs-list">
      <div className="sb-section">{title}</div>
      <div className="dnd-attacks-table-wrap">
      <table className="dnd-attacks-table">
        <thead>
          <tr>
            <th>Название</th>
            <th>АТК/СЛ</th>
            <th>Эффект</th>
            <th>Дальность</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className={r.source && onOpen ? "is-clickable" : undefined}
              onClick={r.source && onOpen ? () => onOpen(r) : undefined}
            >
              {/* Кнопка внутри ячейки, а не `role="button"` на `<tr>`: роль
                  на строке ломает разметку таблицы для скринридера, а без
                  неё описание нельзя было открыть с клавиатуры вовсе.
                  Щелчок мышью по всей строке при этом сохраняется. */}
              <td data-label="Название">
                {r.source && onOpen ? (
                  <button
                    type="button"
                    className="dnd-attack-name-link"
                    aria-label={`${r.name} — открыть описание`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(r);
                    }}
                  >
                    {r.name}
                  </button>
                ) : (
                  r.name
                )}
              </td>
              {r.description !== undefined ? (
                <td colSpan={3} className="muted">
                  <MentionText text={r.description} />
                </td>
              ) : (
                <>
                  <td data-label="АТК/СЛ">{r.bonus}</td>
                  <td data-label="Эффект">{r.damage}</td>
                  <td data-label="Дальность">{r.range}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// Колода карт вместо ряда вкладок (гриллинг 2026-09-04). Порядок — порядок
// свайпа: сначала личность и живое состояние, потом то, чем ходят в бою,
// потом всё остальное. «Ресурсы» стоят последними и нужны редко: пулы
// всплывают над той картой, где их тратят, а здесь остаётся то, что не
// тратится ни на «Действиях», ни в «Магии» — реплики Артефактора и подобное.
const DND_VIEW_TABS = ["Карта", "Действия", "Магия", "Снаряжение", "Навыки", "Особенности", "Досье", "Ресурсы"] as const;
type DndViewTab = (typeof DND_VIEW_TABS)[number];

// Flat list of all skills — either grouped by governing ability (default,
// matches the old nested-under-ability order) or alphabetical, per the
// "ДнД 5.5" section in Настройки → Внешний вид (dndPrefs.ts).
function DndSkillsView({
  abilities,
  proficiencyBonus,
  skillProfs,
  classSkillPool: pool,
  backgroundSkillNames,
  proficiencies,
  skills,
  onQuickUpdate,
  highlight,
  exhaustionPenalty = 0,
}: {
  abilities: DndCharacterData["abilities"];
  proficiencyBonus: string;
  skillProfs: Record<string, DndSkillProfLevel>;
  classSkillPool: string[];
  backgroundSkillNames: string[];
  proficiencies: DndProficiencyEntry[];
  /** Встроенный каталог навыков, уточнённый справочником (useDndSkills). */
  skills: DndSkills;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
  /** Ключ строки, на которую увёл поиск (см. DndSheetSearch). */
  highlight?: string | null;
  /** Штраф истощения: −2 за уровень к любому броску к20 (5.5). */
  exhaustionPenalty?: number;
}) {
  const profBonus = parseBonus(proficiencyBonus);
  const rows = useMemo(() => {
    // Порядок — по характеристикам, как мастер ищет строку глазами; навык,
    // заведённый мастером, встроенного порядка не знает и идёт в конец своей
    // группы, а без характеристики — в самый конец (гриллинг 2026-09-04).
    const byAbility = new Map<DndAbilityKey, typeof skills.rows>();
    const tail: typeof skills.rows = [];
    for (const row of skills.rows) {
      if (!row.ability) {
        tail.push(row);
        continue;
      }
      const list = byAbility.get(row.ability) ?? [];
      list.push(row);
      byAbility.set(row.ability, list);
    }
    const all: { row: SkillRow; abilityLabel: string }[] = [];
    for (const { key, label } of ABILITY_LABELS) {
      for (const row of byAbility.get(key) ?? []) all.push({ row, abilityLabel: label });
    }
    for (const row of tail) all.push({ row, abilityLabel: "—" });
    const prefs = loadDndPrefs();
    if (prefs.skillSortMode === "alphabet") {
      return [...all].sort((a, b) => a.row.name.localeCompare(b.row.name, "ru"));
    }
    return all;
  }, [skills.rows]);

  // Владения, которые лист сохранил, но свести не смог — например навык из
  // чужого модуля. Раньше такие просто не показывались: строки с таким именем
  // в списке нет, и владение исчезало с глаз, оставаясь в данных.
  const unresolved = useMemo(() => {
    const known = new Set(skills.rows.map((r) => r.original));
    return Object.entries(skillProfs)
      .filter(([key, level]) => (level ?? 0) > 0 && !known.has(key))
      .map(([key, level]) => ({ key, level: level as DndSkillProfLevel }));
  }, [skillProfs, skills.rows]);

  return (
    <div className="stack">
      <div className="dnd-save-skill-col dnd-skills-tab">
        {rows.map(({ row, abilityLabel }) => {
          const skill = row.original;
          // Без характеристики (навык мастера, у которого её не задали)
          // модификатор считается только от бонуса мастерства: врать числом
          // хуже, чем показать меньшее.
          const mod = row.ability ? abilityModifier(abilities[row.ability]) : 0;
          const level = skillProfs[skill] ?? 0;
          return (
            <div
              key={skill}
              className={`dnd-save-row${level > 0 ? " is-proficient" : ""}${level === 2 ? " is-expertise" : ""}${skillSourceClass(skill, pool, backgroundSkillNames)}${highlight === `skill-${skill}` ? " is-search-hit" : ""}`}
            >
              <button
                type="button"
                className="dnd-save-dot-btn"
                title={SKILL_TITLES[level]}
                aria-label={`${row.name}: ${SKILL_TITLES[level]} — сменить`}
                disabled={!onQuickUpdate}
                onClick={() =>
                  onQuickUpdate?.({
                    skillProfs: { ...skillProfs, [skill]: ((level + 1) % 3) as DndSkillProfLevel },
                  })
                }
              >
                {SKILL_DOTS[level]}
              </button>
              <span className="dnd-save-name">
                {row.name} <span className="muted">({abilityLabel})</span>
                {/* Видно только на печати: там заливка источника гаснет. */}
                {skillSourceWord(skill, pool, backgroundSkillNames) && (
                  <span className="dnd-skill-source-word">
                    {skillSourceWord(skill, pool, backgroundSkillNames)}
                  </span>
                )}
              </span>
              <span className="dnd-save-value">{computeSkillValue(mod, level, profBonus, exhaustionPenalty)}</span>
            </div>
          );
        })}
      </div>
      {unresolved.length > 0 && (
        <div className="dnd-save-skill-col dnd-skills-unresolved">
          <div className="sb-label">Нет в справочнике</div>
          {unresolved.map(({ key, level }) => (
            <div
              key={key}
              className={`dnd-save-row${level > 0 ? " is-proficient" : ""}${level === 2 ? " is-expertise" : ""}`}
            >
              <button
                type="button"
                className="dnd-save-dot-btn"
                title={SKILL_TITLES[level]}
                aria-label={`${key}: ${SKILL_TITLES[level]} — сменить`}
                disabled={!onQuickUpdate}
                onClick={() =>
                  onQuickUpdate?.({
                    skillProfs: { ...skillProfs, [key]: ((level + 1) % 3) as DndSkillProfLevel },
                  })
                }
              >
                {SKILL_DOTS[level]}
              </button>
              <span className="dnd-save-name">{key}</span>
            </div>
          ))}
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
            Владение сохранено, но такого навыка в справочнике системы нет. Свести
            имена — Системы → D&D 5.5 → Справочник → Навыки.
          </span>
        </div>
      )}
      <DndProficienciesView
        value={proficiencies}
        onChange={onQuickUpdate ? (v) => onQuickUpdate({ proficiencies: v }) : undefined}
      />
    </div>
  );
}

// Пассивные свойства персонажа: скорости, чувства, защиты и заметки класса
// (владения и стартовое снаряжение, которые заполняет выбор класса). До
// роспуска формы правки всё это хранилось, но нигде не показывалось — лист
// молчал о том, что персонаж имеет сопротивление яду.
// Поиск по листу. Главный вопрос игрока за столом — «что оно делает», а не
// «на какой оно вкладке»: поэтому результат заклинания или умения открывает
// его карточку сразу, а не переключает раздел и оставляет искать глазами.
// У того, что карточки не имеет (навыки, свободно вписанные предметы),
// остаётся переход на вкладку с подсветкой строки.
interface SheetSearchHit {
  key: string;
  name: string;
  tab: DndViewTab;
  /** Заклинание или умение — открывается карточкой прямо из поиска. */
  card?: { kind: "spell"; spell: DndSpellEntry } | { kind: "feature"; feature: DndFeature };
  /** Всё остальное — подсветка строки на своей вкладке. */
  highlight?: string;
  meta?: string;
}

function collectSheetHits(
  value: DndCharacterData,
  liveCantrips: DndSpellEntry[],
  liveSpellsByLevel: DndSpellEntry[][],
  liveFeatureGroups: DndFeature[][]
): SheetSearchHit[] {
  const hits: SheetSearchHit[] = [];
  const spellLabel = (lvl: number) => (lvl === 0 ? "Заговор" : `${lvl} круг`);
  liveCantrips.forEach((sp, i) =>
    hits.push({ key: `spell-0-${i}`, name: sp.name, tab: "Магия", meta: spellLabel(0), card: { kind: "spell", spell: sp } })
  );
  liveSpellsByLevel.forEach((lvl, li) =>
    lvl.forEach((sp, i) =>
      hits.push({
        key: `spell-${li + 1}-${i}`,
        name: sp.name,
        tab: "Магия",
        meta: spellLabel(li + 1),
        card: { kind: "spell", spell: sp },
      })
    )
  );
  // Порядок строго как в liveFeatureGroups у вызывающего: классовые, видовые,
  // черты, особые умения.
  const groupNames = ["Классовая особенность", "Видовая особенность", "Черта", "Особое умение"];
  liveFeatureGroups.forEach((group, gi) =>
    group.forEach((f, i) =>
      hits.push({
        key: `feature-${gi}-${i}`,
        name: f.name || "Без названия",
        tab: "Особенности",
        meta: groupNames[gi],
        card: { kind: "feature", feature: f },
      })
    )
  );
  value.equipmentSections.forEach((sec, si) =>
    sec.items.forEach((it, i) => {
      if (!it.name) return;
      hits.push({
        key: `equip-${si}-${i}`,
        name: it.name,
        tab: "Снаряжение",
        meta: sec.name || "Снаряжение",
        highlight: `equip-${si}-${i}`,
      });
    })
  );
  for (const { key, label } of ABILITY_LABELS) {
    for (const skill of SKILLS_BY_ABILITY[key]) {
      hits.push({ key: `skill-${skill}`, name: skill, tab: "Навыки", meta: label, highlight: `skill-${skill}` });
    }
  }
  value.proficiencies.forEach((pr, i) => {
    if (!pr.name) return;
    hits.push({ key: `prof-${i}`, name: pr.name, tab: "Навыки", meta: "Владение", highlight: `prof-${i}` });
  });
  return hits;
}

// Карточка предмета листа — одна на поиск и на вкладку «Действия», чтобы у
// заклинания было ровно одно окно, откуда бы его ни открыли.
// Кнопка «Потратить» в карточке действия — только там, где источник траты
// однозначен: у заклинания это ячейка его круга (а если её нет — ближайшая
// доступная выше, повышение круга штатный приём 5.5), у умения — пул,
// заданный в его стоимости. Где источник неоднозначен, кнопки нет.
function SpendAction({
  row,
  value,
  slots,
  resources,
  onQuickUpdate,
  onDone,
}: {
  row: AttackRow;
  value: DndCharacterData;
  slots: number[];
  resources: DndResourceDef[];
  onQuickUpdate: (patch: Partial<DndCharacterData>) => void;
  onDone: () => void;
}) {
  if (row.source?.kind === "spell") {
    const level = row.source.level;
    if (level === 0) return <span className="muted">Заговор — тратить нечего.</span>;
    // Ищем ближайший круг с непотраченной ячейкой, начиная со своего.
    let use = -1;
    for (let i = level - 1; i < slots.length; i++) {
      if ((slots[i] ?? 0) > (value.spellSlotsUsed[i] ?? 0)) {
        use = i;
        break;
      }
    }
    if (use < 0) return <span className="muted">Свободных ячеек {level} круга и выше нет.</span>;
    return (
      <button
        type="button"
        className="primary"
        style={{ alignSelf: "flex-start" }}
        onClick={() => {
          const next = value.spellSlotsUsed.slice();
          next[use] = (next[use] ?? 0) + 1;
          onQuickUpdate({ spellSlotsUsed: next });
          onDone();
        }}
      >
        Потратить ячейку {use + 1} круга
      </button>
    );
  }
  const cost = row.source?.kind === "feature" ? row.source.feature.cost : undefined;
  if (!cost || cost.kind !== "resource" || !cost.resourceKey) return null;
  const res = resources.find((r) => r.key === cost.resourceKey);
  if (!res) return null;
  const bonus = value.resourceBonus[res.key] ?? 0;
  const max = res.max + bonus;
  const used = value.resourceUsed[res.key] ?? 0;
  const amount = cost.amount && cost.amount > 0 ? cost.amount : 1;
  if (used + amount > max) return <span className="muted">«{res.label}» — не осталось.</span>;
  return (
    <button
      type="button"
      className="primary"
      style={{ alignSelf: "flex-start" }}
      onClick={() => {
        onQuickUpdate({ resourceUsed: { ...value.resourceUsed, [res.key]: used + amount } });
        onDone();
      }}
    >
      Потратить: {res.label}
      {amount > 1 ? ` ×${amount}` : ""}
    </button>
  );
}

function DndCardModal({
  title,
  spell,
  feature,
  getEntry,
  extra,
  onClose,
}: {
  title: string;
  spell?: DndSpellEntry | null;
  feature?: DndFeature | null;
  getEntry: (id: number | null | undefined) => CompendiumEntry | undefined;
  /** Действие в подвале окна — например «Потратить ячейку». */
  extra?: ReactNode;
  onClose: () => void;
}) {
  const entry = spell?.entryId ? getEntry(spell.entryId) : undefined;
  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-spell-modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        {spell && entry && (() => {
          const d = buildSpellDetail(entry);
          const fields: [string, ReactNode][] = (
            [
              ["Школа", d.school],
              ["Время накладывания", d.castingTime],
              ["Дистанция", d.range],
              ["Компоненты", d.componentsText],
              ["Длительность", d.duration],
            ] as [string, ReactNode][]
          ).filter(([, v]) => !!v);
          return (
            <>
              {fields.length > 0 && (
                <div className="comp-fields">
                  {fields.map(([label, v]) => (
                    <div key={label} className="muted">
                      <strong>{label}:</strong> {v}
                    </div>
                  ))}
                </div>
              )}
              <MentionText text={d.description} />
            </>
          );
        })()}
        {spell && !entry && <span className="muted">Описание берётся из компендиума — запись не найдена.</span>}
        {feature && <MentionText text={feature.description} />}
        {extra}
      </div>
    </Modal>
  );
}

function DndSheetSearch({
  hits,
  onGo,
  getEntry,
}: {
  hits: SheetSearchHit[];
  onGo: (hit: SheetSearchHit) => void;
  getEntry: (id: number | null | undefined) => CompendiumEntry | undefined;
}) {
  const [query, setQuery] = useState("");
  const [openCard, setOpenCard] = useState<SheetSearchHit | null>(null);
  const q = query.trim().toLowerCase();
  const found = q ? hits.filter((h) => h.name.toLowerCase().includes(q)).slice(0, 12) : [];

  function pick(hit: SheetSearchHit) {
    setQuery("");
    if (hit.card) setOpenCard(hit);
    onGo(hit);
  }

  return (
    <div className="dnd-sheet-search">
      <input
        type="search"
        value={query}
        placeholder="Найти на листе: заклинание, умение, предмет, навык…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
          if (e.key === "Enter" && found.length > 0) pick(found[0]);
        }}
      />
      {q && (
        <div className="dnd-sheet-search-results">
          {found.length === 0 ? (
            <div className="dnd-sheet-search-empty muted">Ничего не нашлось</div>
          ) : (
            found.map((h) => (
              <button
                key={h.key}
                type="button"
                className="dnd-sheet-search-hit"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(h);
                }}
              >
                <span className="dnd-sheet-search-name">{h.name}</span>
                <span className="dnd-sheet-search-where">
                  {h.tab}
                  {h.meta ? ` · ${h.meta}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      )}
      {openCard?.card && (
        <DndCardModal
          title={openCard.name}
          spell={openCard.card.kind === "spell" ? openCard.card.spell : null}
          feature={openCard.card.kind === "feature" ? openCard.card.feature : null}
          getEntry={getEntry}
          onClose={() => setOpenCard(null)}
        />
      )}
    </div>
  );
}

/**
 * Скорость для кости: число и единица порознь.
 *
 * В шестиугольник «30 фт.» одной строкой не влезает и читается хуже соседних
 * КЗ и хитов — а ряд костей держится именно на том, что все четыре числа
 * одного размера. Единицу берём из той же formatDistance, а не собираем
 * заново: настройка «футы/клетки» одна на приложение, и второе место, где
 * она пишется руками, разъехалось бы с первым.
 */
function walkDieParts(
  speeds: DndCreatureSpeed,
  exhaustion: number,
  unit: DndDistanceUnit
): { value: string; sub: string; was: string } {
  if (speeds.walk === null) return { value: "—", sub: "", was: "" };
  const penalty = Math.max(0, exhaustion) * 5;
  const reduced = Math.max(0, speeds.walk - penalty);
  const split = (feet: number) => {
    const text = formatDistance(feet, unit);
    const i = text.lastIndexOf(" ");
    return i < 0 ? { value: text, sub: "" } : { value: text.slice(0, i), sub: text.slice(i + 1) };
  };
  const now = split(reduced);
  return { ...now, was: penalty > 0 ? split(speeds.walk).value : "" };
}

/**
 * «Список доступных заклинаний» — всё, что доступно классу и подклассу
 * персонажа, с возможностью взять оттуда в лист.
 *
 * Зачем отдельно от поиска в круге. Поиск по кругу отвечает на вопрос «как
 * называется это заклинание», а Мастеру и игроку нужен обратный: «что я
 * вообще могу взять». Раньше на него отвечала книга, а не приложение —
 * в справочнике 392 заклинания, и какие из них твои, там не написано.
 *
 * Отбор идёт по полю `classes` самой записи заклинания: ссылок 1324 и все
 * живые (в отличие от `granted_spells`, где не работала ни одна). Подкласс
 * учитывается наравне с классом — у Картографа 11 заклинаний сверх 80
 * артефакторских.
 */
function DndClassSpellListModal({
  systemId,
  sources,
  cantrips,
  spellsByLevel,
  onAdd,
  onClose,
}: {
  systemId: number | null;
  /** Класс и подкласс персонажа: по их id и отбираются заклинания. */
  sources: { id: number; name: string }[];
  cantrips: DndSpellEntry[];
  spellsByLevel: DndSpellEntry[][];
  onAdd: (level: number, entry: CompendiumEntry) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<CompendiumEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!systemId) {
      setAll([]);
      return;
    }
    const ac = new AbortController();
    loadDndSpellIndex(systemId, { signal: ac.signal })
      .then(setAll)
      .catch((e) => {
        if ((e as Error)?.name !== "AbortError") setFailed(true);
      });
    return () => ac.abort();
  }, [systemId]);

  const sourceIds = new Set(sources.map((s) => s.id));
  // Уже в листе — по entryId: показывать «взять» у того, что уже взято,
  // значит собирать двойники руками пользователя.
  const owned = new Set(
    [...cantrips, ...spellsByLevel.flat()].map((s) => s.entryId).filter((id): id is number => typeof id === "number")
  );

  const q = query.trim().toLowerCase();
  const matching = (all ?? []).filter((e) => {
    const refs = Array.isArray(e.data?.classes) ? (e.data.classes as { id?: number }[]) : [];
    if (!refs.some((r) => typeof r.id === "number" && sourceIds.has(r.id))) return false;
    return !q || e.name.toLowerCase().includes(q);
  });
  const byLevel = new Map<number, CompendiumEntry[]>();
  for (const e of matching) {
    const lvl = e.level ?? 0;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(e);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-spell-list-modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Доступные заклинания</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          {sources.map((s) => s.name).join(" · ") || "Класс не выбран"}
        </div>
        <input
          placeholder="Поиск по названию"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {failed && <p className="muted">Не удалось загрузить справочник заклинаний.</p>}
        {!failed && all === null && <p className="muted">Загрузка…</p>}
        {all !== null && levels.length === 0 && (
          <p className="muted">
            {sources.length === 0
              ? "Сначала выберите класс — список строится по нему."
              : "Ничего не нашлось: у класса нет заклинаний в справочнике либо не подходит поиск."}
          </p>
        )}
        {levels.map((lvl) => (
          <div key={lvl} className="stack" style={{ gap: 4 }}>
            <div className="sb-prop-label">{lvl === 0 ? "Заговоры" : `${lvl} круг`}</div>
            {byLevel.get(lvl)!.map((e) => (
              <div key={e.id} className="row dnd-spell-list-row">
                <span style={{ flex: "1 1 12ch", minWidth: 0 }}>{e.name}</span>
                {owned.has(e.id) ? (
                  <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>уже в листе</span>
                ) : (
                  <button type="button" className="comp-mini" onClick={() => onAdd(lvl, e)}>
                    Взять
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function DndTraitsView({ value }: { value: DndCharacterData }) {
  const prefs = useDndPrefs();
  const speeds = formatSpeed(value.speeds, prefs.distanceUnit);
  const senses = value.sensesList
    .map((sn) => [sn.name, sn.distance].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
  const defences: [string, string[]][] = [
    ["Уязвимости", value.damageVulnerabilities],
    ["Сопротивления", value.damageResistances],
    ["Иммунитет к урону", value.damageImmunities],
    ["Иммунитет к состояниям", value.conditionImmunities],
  ];
  const rows: [string, string][] = [];
  if (speeds) rows.push(["Скорости", speeds]);
  if (senses) rows.push(["Чувства", senses]);
  for (const [label, list] of defences) if (list.length > 0) rows.push([label, list.join(", ")]);
  const notes = value.notes?.trim();
  // §1.11: показывать нечего — блок не показывается.
  if (rows.length === 0 && !notes) return null;
  return (
    <div className="cs-list">
      {rows.length > 0 && (
        <>
          <div className="sb-section">Свойства</div>
          {rows.map(([label, text]) => (
            <div key={label} className="sb-entry">
              <span className="sb-prop-label">{label}</span> {text}
            </div>
          ))}
        </>
      )}
      {notes && (
        <>
          <div className="sb-section">Заметки класса</div>
          <div className="sb-entry" style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={notes} />
          </div>
        </>
      )}
    </div>
  );
}

function SbFeatureGroup({ title, values }: { title: string; values: DndFeature[] }) {
  // Описание раскрывается прямо под строкой, а не модалкой (решение владельца
  // 2026-09-04). Модалка перекрывала лист целиком и требовала закрытия, чтобы
  // сверить особенность с соседней; за столом это лишний шаг. Открыта всегда
  // одна — иначе список уезжает с экрана.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (values.length === 0) return null;
  return (
    <details className="cs-list" open>
      <summary className="sb-section">{title}</summary>
      {values.map((f, i) => (
        <div key={i}>
          <button
            type="button"
            className={`dnd-feature-row-link${openIndex === i ? " is-open" : ""}`}
            aria-expanded={openIndex === i}
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
          >
            {f.name || "Без названия"}
            {f.level ? <span className="muted"> (ур. {f.level})</span> : null}
          </button>
          {openIndex === i && (
            <div className="dnd-spell-description">
              <MentionText text={f.description} />
            </div>
          )}
        </div>
      ))}
    </details>
  );
}

// Compact GM/player summary card — same content, .card-mini layout.
function DndCharacterViewMini({ value }: { value: DndCharacterData }) {
  const classLine = classAndLevelSummary(value.classes);
  const computedAc = computeArmorClass(
    abilityModifier(value.abilities.dex),
    value.equipmentSections,
    parseBonus(value.manualAcBonus)
  );
  return (
    <div className="sb-scope">
      <div className="sb-card card-mini">
        <div className="sb-head">
          <div className="sb-head-row">
            <div className="sb-name">{value.characterName || "Без имени"}</div>
            {classLine && <div style={{ fontSize: "var(--fs-meta)", opacity: 0.8 }}>{classLine}</div>}
          </div>
        </div>
        <div className="sb-body">
          <div className="mini-vitals">
            <span>
              <b>КЗ</b> {computedAc}
            </span>
            {(value.hitPointMax || value.hitPointsCurrent) && (
              <span>
                <b>ХП</b> {value.hitPointsCurrent || "0"}/{value.hitPointMax || "0"}
              </span>
            )}
            {value.speed && (
              <span>
                <b>Ск.</b> {value.speed}
              </span>
            )}
          </div>
          <div className="mini-abilities">
            {ABILITY_LABELS.map(({ key, label }) => (
              <span key={key}>
                <b>{label[0]}</b> {formatModifier(abilityModifier(value.abilities[key]))}
              </span>
            ))}
          </div>
          {[
            ...value.attacks,
            ...equippedWeaponSummaries(value.equipmentSections),
            ...value.speciesFeatures,
            ...value.classFeatures,
            ...value.feats,
            ...value.specialAbilities,
          ].map((f, i) => (
            <div key={i} className="mini-action">
              {f.name && <b>{f.name}.</b>} <MentionText text={f.description} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Click-to-edit HP box — the one vitals field that changes almost every
// combat round, so it gets its own tiny local edit state instead of
// Значение виталов, по которому щёлкают, чтобы его поправить. Кнопка, а не
// `div` с `onClick`: щелчком мыши работало и так, но с клавиатуры значение не
// бралось табом вовсе, а скринридер читал его как обычный текст, не называя
// нажимаемым. Когда править нечем (нет `onQuickUpdate` — например, у чужого
// листа), это просто значение, и в фокус ему не нужно.
function SbQuickValue({
  onClick,
  title,
  ariaLabel,
  ariaPressed,
  className,
  children,
}: {
  onClick?: () => void;
  title?: string;
  ariaLabel: string;
  // Для значений-переключателей (вдохновение): скринридер должен называть не
  // только кнопку, но и её текущее состояние.
  ariaPressed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const cls = className ? `sb-value ${className}` : "sb-value";
  if (!onClick) {
    return (
      <div className={cls} title={title}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${cls} sb-value-button`}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// requiring the full DndCharacterEdit form for a single number. Always
// rendered (even when both fields are still unset — shows "— / —") so a
// fresh character always has a place to tap and fill these in, instead of
// the box only appearing once a value already exists somehow.
// On mobile, the two side-by-side number spinners are fiddly under a touch
// keyboard and have no room for temp HP — clicking there opens the fuller
// HpEditModal instead. Desktop keeps the original inline current/max box,
// which is faster for a GM with a mouse.
function HpQuickBox({
  value,
  onQuickUpdate,
  accentColor,
}: {
  value: DndCharacterData;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
  /** Цвет класса — заливка кости хитов. */
  accentColor?: string;
}) {
  const isMobile = useIsMobile();
  const [editing, setEditing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draftCurrent, setDraftCurrent] = useState(value.hitPointsCurrent);
  const [draftMax, setDraftMax] = useState(value.hitPointMax);
  function commit() {
    onQuickUpdate?.({ hitPointsCurrent: draftCurrent, hitPointMax: draftMax });
    setEditing(false);
  }
  function openEditor() {
    if (isMobile) {
      setModalOpen(true);
      return;
    }
    setDraftCurrent(value.hitPointsCurrent);
    setDraftMax(value.hitPointMax);
    setEditing(true);
  }
  return (
    <div style={{ flex: 1.2 }}>
      <div className="sb-label">Хиты</div>
      {editing ? (
        <span
          className="row"
          style={{ gap: 2, flexWrap: "nowrap" }}
          onBlur={(e) => {
            // relatedTarget is unreliable here — clicking the "/" separator
            // (plain text, not focusable) between the two inputs blurs the
            // current one with relatedTarget === null even though the user
            // is just about to focus the other input, which closed the whole
            // box before they could reach the max-HP field. Deferring the
            // check to the next frame lets the new focus land first, so we
            // only commit once focus has actually left both inputs.
            const container = e.currentTarget;
            requestAnimationFrame(() => {
              if (!container.contains(document.activeElement)) commit();
            });
          }}
        >
          <input
            autoFocus
            type="number"
            style={{ width: 48 }}
            value={draftCurrent}
            onChange={(e) => setDraftCurrent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit()}
          />
          /
          <input
            type="number"
            style={{ width: 48 }}
            value={draftMax}
            onChange={(e) => setDraftMax(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit()}
          />
        </span>
      ) : (
        <SbQuickValue
          className="dnd-die-quick"
          onClick={onQuickUpdate ? openEditor : undefined}
          ariaLabel="Хиты — изменить"
        >
          {/* Хиты — единственная залитая кость на карте: это то, что тратится,
              и по §6.5 заливка кодирует именно это, а не важность. */}
          <DndDie size="lg" filled accentColor={accentColor} style={accentColor ? { color: textOnClassColor(accentColor) } : undefined}>
            <span className="dnd-die-value">{value.hitPointsCurrent || "—"}</span>
            <span className="dnd-die-sub">
              из {value.hitPointMax || "—"}
              {/* Именно по числу, а не по «строка не пустая»: и урон, и длинный
                  отдых записывают сюда строку "0", а она истинна — после
                  первого же попадания лист навсегда показывал «(+0)». */}
              {Number(value.hitPointsTemp) > 0 ? ` +${value.hitPointsTemp}` : ""}
            </span>
          </DndDie>
        </SbQuickValue>
      )}
      {modalOpen && onQuickUpdate && (
        <HpEditModal value={value} onQuickUpdate={onQuickUpdate} onClose={() => setModalOpen(false)} />
      )}
    </div>
  );
}

function HpEditModal({
  value,
  onQuickUpdate,
  onClose,
}: {
  value: DndCharacterData;
  onQuickUpdate: (patch: Partial<DndCharacterData>) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [concentrationDc, setConcentrationDc] = useState<number | null>(null);
  // Черновик четырёх полей. Раньше каждое из них звало onQuickUpdate прямо из
  // onChange — то есть на каждое нажатие клавиши пересобирался весь чарник и
  // уходил PUT: набрать «15» стоило двух запросов, а промежуточное пустое
  // поле на секунду записывало «хитов нет». Теперь правка живёт локально до
  // blur или Enter.
  const [draft, setDraft] = useState({
    hitPointsCurrent: value.hitPointsCurrent,
    hitPointMax: value.hitPointMax,
    hitPointsTemp: value.hitPointsTemp,
    hitPointMaxTemp: value.hitPointMaxTemp,
  });
  type HpField = keyof typeof draft;
  // Урон и лечение считают от сохранённого значения, поэтому набранное в полях
  // надо сначала зафиксировать — иначе кнопка «Урон» вычтет из старых хитов.
  function commitField(field: HpField) {
    if (draft[field] === value[field]) return;
    onQuickUpdate({ [field]: draft[field] } as Partial<DndCharacterData>);
  }
  function hpFieldProps(field: HpField) {
    return {
      type: "number",
      value: draft[field],
      onChange: (e: ChangeEvent<HTMLInputElement>) =>
        setDraft((d) => ({ ...d, [field]: e.target.value })),
      onBlur: () => commitField(field),
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") commitField(field);
      },
    };
  }

  function applyDamage() {
    const n = Number(amount) || 0;
    if (n <= 0) return;
    const tempNow = Number(value.hitPointsTemp) || 0;
    const curNow = Number(value.hitPointsCurrent) || 0;
    const fromTemp = Math.min(n, Math.max(0, tempNow));
    const rest = n - fromTemp;
    // Хиты не уходят в минус: по правилам они останавливаются на нуле, а
    // «-7 хитов» на листе — это ещё и потерянный признак того, что персонаж
    // при смерти. Мгновенная смерть от превышения максимума за одно
    // попадание — решение стола, лист её не объявляет.
    const patch = {
      hitPointsTemp: String(tempNow - fromTemp),
      hitPointsCurrent: String(Math.max(0, curNow - rest)),
    };
    onQuickUpdate(patch);
    setDraft((d) => ({ ...d, ...patch }));
    // Урон по концентрирующемуся требует спасброска Телосложения, СЛ 10 или
    // половина урона — что больше. Лист считает СЛ, но не решает за игрока:
    // спасбросок чаще проходит, чем нет, и снимать концентрацию самому было
    // бы враньём.
    if (value.concentration) setConcentrationDc(Math.max(10, Math.floor(n / 2)));
    setAmount("");
  }
  function applyHeal() {
    const n = Number(amount) || 0;
    if (n <= 0) return;
    const curNow = Number(value.hitPointsCurrent) || 0;
    const cap = (Number(value.hitPointMax) || 0) + (Number(value.hitPointMaxTemp) || 0);
    const healed = cap > 0 ? Math.min(curNow + n, cap) : curNow + n;
    // Любое лечение с нуля поднимает на ноги: накопленные спасброски от
    // смерти сбрасываются, иначе они переживут исцеление и убьют персонажа
    // в следующем бою.
    const revived = curNow <= 0 && healed > 0;
    onQuickUpdate({
      hitPointsCurrent: String(healed),
      ...(revived ? { deathSaveSuccesses: 0, deathSaveFailures: 0 } : {}),
    });
    setDraft((d) => ({ ...d, hitPointsCurrent: String(healed) }));
    setAmount("");
  }

  return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Хиты</h3>
        <label>
          Текущие ХП
          <input {...hpFieldProps("hitPointsCurrent")} />
        </label>
        <label>
          Максимум ХП
          <input {...hpFieldProps("hitPointMax")} />
        </label>
        <label>
          Временные ХП
          <input {...hpFieldProps("hitPointsTemp")} />
        </label>
        <label>
          Временный максимум ХП
          <input {...hpFieldProps("hitPointMaxTemp")} />
        </label>
        {/* Урон first depletes temp HP, then current — standard 5e rule.
            Лечение caps at max + temp max, also per the rules. */}
        <div className="row" style={{ gap: 6 }}>
          <input
            type="number"
            placeholder="Количество"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" className="primary" onClick={applyHeal}>
            Лечение
          </button>
          <button type="button" className="danger" onClick={applyDamage}>
            Урон
          </button>
        </div>
        {concentrationDc !== null && value.concentration && (
          <div className="sb-entry dnd-concentration-check">
            <span className="sb-prop-label">Концентрация</span> «{value.concentration}» — спасбросок Телосложения,
            СЛ {concentrationDc}.{" "}
            <button
              type="button"
              className="comp-mini"
              onClick={() => {
                onQuickUpdate({ concentration: "" });
                setConcentrationDc(null);
              }}
            >
              Сорвалась
            </button>
          </div>
        )}
        <button type="button" onClick={onClose} style={{ alignSelf: "flex-end" }}>
          Готово
        </button>
      </div>
    </Modal>
  );
}

// Same click-to-edit pattern as HpQuickBox, for the other vitals that used
// to only render once a value existed (Инициатива) — always shown now,
// with "—" when unset, so there's always a tap target to fill them in.
function TextQuickBox({
  label,
  value,
  field,
  onQuickUpdate,
  width = 48,
}: {
  label: string;
  value: string;
  field: "initiative";
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
  width?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  function commit() {
    onQuickUpdate?.({ [field]: draft } as Partial<DndCharacterData>);
    setEditing(false);
  }
  return (
    <div>
      <div className="sb-label">{label}</div>
      {editing ? (
        <input
          autoFocus
          style={{ width }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      ) : (
        <SbQuickValue
          ariaLabel={`${label} — изменить`}
          onClick={
            onQuickUpdate
              ? () => {
                  setDraft(value);
                  setEditing(true);
                }
              : undefined
          }
        >
          {value || "—"}
        </SbQuickValue>
      )}
    </div>
  );
}

// КЗ is always computed (10/armor + Ловкость, capped per equipped armor,
// plus flat bonuses from equipped items) — the only thing a click here
// edits is the small manual bonus for effects not captured by inventory
// (Shield/Mage Armor spells, …), same click-to-edit shell as TextQuickBox.
function AcQuickBox({
  computed,
  manualBonus,
  onQuickUpdate,
}: {
  computed: number;
  manualBonus: string;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(manualBonus);
  function commit() {
    onQuickUpdate?.({ manualAcBonus: draft });
    setEditing(false);
  }
  return (
    <div>
      <div className="sb-label">КЗ</div>
      {editing ? (
        <input
          autoFocus
          type="number"
          style={{ width: 48 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          title="Доп. бонус к КЗ (не из инвентаря)"
        />
      ) : (
        <SbQuickValue
          className="dnd-die-quick"
          title={onQuickUpdate ? "Нажмите, чтобы задать доп. бонус к КЗ" : undefined}
          ariaLabel="Класс защиты — задать дополнительный бонус"
          onClick={
            onQuickUpdate
              ? () => {
                  setDraft(manualBonus);
                  setEditing(true);
                }
              : undefined
          }
        >
          {/* Кость только вокруг показываемого значения: правка открывается
              обычным полем, и силуэт в неё не лезет — иначе ввод пришлось бы
              вписывать в шестиугольник. */}
          <DndDie size="lg">
            <span className="dnd-die-value">{computed}</span>
          </DndDie>
        </SbQuickValue>
      )}
    </div>
  );
}

// Pencil-as-edit-toggle, used for every per-tab local edit affordance on
// this sheet — clicking it again (while editing) acts as "Сохранить" rather
// than requiring a separate button, since reaching for the same spot you
// just clicked to enter edit mode is the more intuitive place to leave it.
function TabEditToggle({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="comp-mini dnd-tab-edit-toggle"
      title={editing ? "Сохранить" : "Редактировать"}
      aria-label={editing ? "Сохранить" : "Редактировать"}
      onClick={onToggle}
    >
      <NavIcon name={editing ? "check" : "edit"} />
    </button>
  );
}

// Ресурсы tab: one pip track per applicable class resource pool (see
// dndResources.ts for the PHB 2024 formulas). Max is always computed from
// classes/abilities + the small per-resource "доп. бонус" field (external
// sources — items, feats); only the bonus and used-count are ever stored.
/**
 * Реплики Артефактора: известные схемы и созданное по ним.
 *
 * Правило класса устроено в два шага, и блок повторяет их буквально. Сперва
 * выбираются **схемы** — что вообще умеешь делать; их число растёт по
 * таблице развития («Известные схемы»). Потом по схеме **создаётся
 * предмет**, и таких одновременно можно держать столько, сколько написано в
 * колонке «Магические предметы».
 *
 * Пределы показываются числом «N из M», но не запирают (решение R4): у
 * Мастера за столом бывает причина разрешить лишнее, а приложение, которое
 * молча отказывает, вынуждает вести учёт на бумаге рядом.
 *
 * Созданный предмет ложится и сюда счётчиком, и строкой в инвентарь — там
 * его ищут. Строка помнит свою реплику (`replicaId`), поэтому исчезает
 * вместе с ней.
 */
function DndReplicaBlock({
  limits,
  value,
  systemId,
  campaignId,
  ownerCharacterId,
  onQuickUpdate,
}: {
  limits: ReplicaLimits;
  value: DndCharacterData;
  systemId: number | null;
  campaignId?: number | null;
  ownerCharacterId?: number | null;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [baseFor, setBaseFor] = useState<DndReplicaScheme | null>(null);
  const [giving, setGiving] = useState<DndReplicaItem | null>(null);
  const [given, setGiven] = useState("");

  const schemes = (value.replicaSchemes ?? []).filter((s) => s.classId === limits.classId);
  const items = (value.replicaItems ?? []).filter((i) => i.classId === limits.classId);
  const overSchemes = schemes.length > limits.schemes;
  const overItems = items.length > limits.items;

  function setSchemes(next: DndReplicaScheme[]) {
    const others = (value.replicaSchemes ?? []).filter((s) => s.classId !== limits.classId);
    onQuickUpdate?.({ replicaSchemes: [...others, ...next] });
  }

  // «Оружие +1» и «Доспех +1» — не предмет, а прибавка: чем именно она
  // станет, решает игрок, поэтому у таких схем спрашивается базовый предмет
  // (решение R3). Признак — прибавка в названии схемы.
  function needsBase(scheme: DndReplicaScheme): boolean {
    return /\+\s*\d/.test(scheme.name);
  }

  function createItem(
    scheme: DndReplicaScheme,
    base?: { name: string; entryId: number | null; meta: Partial<DndEquipmentItem> }
  ) {
    if (!onQuickUpdate) return;
    const id = `replica-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const bonusMatch = /\+\s*(\d)/.exec(scheme.name);
    const bonus = bonusMatch ? Number(bonusMatch[1]) : 0;
    const item: DndReplicaItem = {
      id,
      schemeEntryId: scheme.entryId,
      name: scheme.name,
      classId: limits.classId,
      baseName: base?.name,
      baseEntryId: base?.entryId ?? null,
    };
    // Одна строка инвентаря, а не две: базовый предмет со своими КЗ и уроном
    // плюс прибавка и пометка «магический».
    const row: DndEquipmentItem = base
      ? {
          ...EMPTY_EQUIPMENT_ITEM,
          ...base.meta,
          name: bonus ? `${base.name} +${bonus}` : base.name,
          entryId: base.entryId,
          magical: true,
          magicBonus: bonus || undefined,
          notes: `реплика: ${scheme.name}`,
          replicaId: id,
        }
      : {
          ...EMPTY_EQUIPMENT_ITEM,
          name: scheme.name,
          entryId: scheme.entryId,
          magical: true,
          notes: "реплика",
          replicaId: id,
        };
    const sections = value.equipmentSections.length > 0 ? value.equipmentSections : [{ name: "Общее", items: [] }];
    onQuickUpdate({
      replicaItems: [...(value.replicaItems ?? []), item],
      equipmentSections: sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, row] } : sec)),
    });
  }

  function removeItem(item: DndReplicaItem) {
    if (!onQuickUpdate) return;
    onQuickUpdate({
      replicaItems: (value.replicaItems ?? []).filter((i) => i.id !== item.id),
      equipmentSections: value.equipmentSections.map((sec) => ({
        ...sec,
        items: sec.items.filter((row) => row.replicaId !== item.id),
      })),
    });
  }

  return (
    <div className="sb-entry stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span className="sb-prop-label">Известные схемы</span>
        <span className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className={overSchemes ? "dnd-limit-over" : "muted"}>
            {schemes.length} из {limits.schemes}
          </span>
          {onQuickUpdate && (
            <button type="button" className="comp-mini" onClick={() => setPickerOpen(true)}>
              Выбрать
            </button>
          )}
        </span>
      </div>
      {schemes.length === 0 ? (
        <span className="muted">Схемы не выбраны — нажмите «Выбрать».</span>
      ) : (
        <ul className="dnd-replica-list">
          {schemes.map((scheme) => (
            <li key={scheme.entryId} className="row dnd-replica-row">
              <span style={{ flex: "1 1 12ch", minWidth: 0 }}>{scheme.name}</span>
              {onQuickUpdate && (
                <button
                  type="button"
                  className="comp-mini"
                  onClick={() => (needsBase(scheme) ? setBaseFor(scheme) : createItem(scheme))}
                >
                  Создать
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span className="sb-prop-label">Магические предметы</span>
        <span className={overItems ? "dnd-limit-over" : "muted"}>
          {items.length} из {limits.items}
        </span>
      </div>
      {items.length === 0 ? (
        <span className="muted">Ничего не создано.</span>
      ) : (
        <ul className="dnd-replica-list">
          {items.map((item) => (
            <li key={item.id} className="row dnd-replica-row">
              <span style={{ flex: "1 1 12ch", minWidth: 0 }}>
                {item.baseName ? `${item.baseName} — ${item.name}` : item.name}
              </span>
              {onQuickUpdate && (
                <>
                  <button type="button" className="comp-mini" onClick={() => setGiving(item)}>
                    Передать
                  </button>
                  <button type="button" className="comp-mini" onClick={() => removeItem(item)}>
                    Убрать
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {pickerOpen && (
        <DndReplicaSchemePicker
          limits={limits}
          chosen={schemes}
          onClose={() => setPickerOpen(false)}
          onChange={setSchemes}
        />
      )}
      {given && <span className="muted">{given}</span>}
      {giving && (
        <DndReplicaHandover
          item={giving}
          campaignId={campaignId}
          ownerCharacterId={ownerCharacterId}
          giverName={value.characterName || "Артефактор"}
          onClose={() => setGiving(null)}
          onDone={() => {
            setGiven(`Передано: ${giving.baseName ? `${giving.baseName} — ` : ""}${giving.name}`);
            setGiving(null);
          }}
        />
      )}
      {baseFor && (
        <DndReplicaBasePicker
          scheme={baseFor}
          systemId={systemId}
          onClose={() => setBaseFor(null)}
          onPick={(base) => {
            createItem(baseFor, base);
            setBaseFor(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Передать созданный предмет участнику кампании (решение R2/W8).
 *
 * Системы уведомлений в приложении нет вовсе — ни таблицы, ни экрана, — и
 * заводить её ради одной кнопки значит построить половину мессенджера.
 * Поэтому «уведомление» здесь и есть сама строка в инвентаре получателя:
 * она приходит с пометкой «не принято» и двумя кнопками, а на вкладке
 * «Инвентарь» появляется точка. Полноценные уведомления — отдельной задачей.
 *
 * Пишется чужой лист патчем одного поля (`contentPatch`), а не снимком: у
 * получателя лист может быть открыт в этот самый момент, и снимок стёр бы
 * его правку.
 */
function DndReplicaHandover({
  item,
  campaignId,
  ownerCharacterId,
  giverName,
  onDone,
  onClose,
}: {
  item: DndReplicaItem;
  campaignId?: number | null;
  ownerCharacterId?: number | null;
  giverName: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [targets, setTargets] = useState<{ id: number; character_name: string; player_name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!campaignId) {
      setTargets([]);
      return;
    }
    api
      .get<{ id: number; character_name: string; player_name: string }[]>(`/characters?campaign_id=${campaignId}`)
      .then((list) => setTargets(list.filter((c) => c.id !== ownerCharacterId)))
      .catch(() => setTargets([]));
  }, [campaignId, ownerCharacterId]);

  async function give(target: { id: number; character_name: string }) {
    setBusy(true);
    setError("");
    try {
      const sheets = await api.get<Statblock[]>(`/statblocks?owner_type=character&owner_id=${target.id}`);
      const sheet = sheets.find((s) => s.format === "dnd_character");
      if (!sheet) {
        setError(`У «${target.character_name}» нет чарника D&D — передать некуда.`);
        return;
      }
      const data = JSON.parse(sheet.content || "{}") as DndCharacterData;
      const sections =
        Array.isArray(data.equipmentSections) && data.equipmentSections.length > 0
          ? data.equipmentSections
          : [{ name: "Общее", items: [] }];
      const row: DndEquipmentItem = {
        ...EMPTY_EQUIPMENT_ITEM,
        name: item.baseName ? `${item.baseName} — ${item.name}` : item.name,
        entryId: item.baseEntryId ?? item.schemeEntryId,
        magical: true,
        notes: `реплика от «${giverName}»`,
        pendingFrom: giverName,
      };
      await api.put(`/statblocks/${sheet.id}`, {
        contentPatch: {
          equipmentSections: sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, row] } : sec)),
        },
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-replica-modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Передать: {item.baseName ? `${item.baseName} — ${item.name}` : item.name}</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          Предмет ляжет получателю в инвентарь строкой «не принято» — принять или вернуть он решит
          сам. У вас предмет останется в счёте созданных: исчезает он вместе с репликой, а не с
          передачей.
        </div>
        {error && <p className="sb-save-error">{error}</p>}
        {targets === null && <p className="muted">Загрузка…</p>}
        {targets !== null && targets.length === 0 && (
          <p className="muted">
            {campaignId ? "В кампании больше никого нет." : "Персонаж не в кампании — передавать некому."}
          </p>
        )}
        {(targets ?? []).map((t) => (
          <div key={t.id} className="row dnd-replica-row">
            <span style={{ flex: "1 1 12ch", minWidth: 0 }}>
              {t.character_name}
              {t.player_name && <span className="muted"> · {t.player_name}</span>}
            </span>
            <button type="button" className="comp-mini" disabled={busy} onClick={() => void give(t)}>
              Передать
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Выбор схем: список доступных на текущем уровне, с поиском. */
function DndReplicaSchemePicker({
  limits,
  chosen,
  onChange,
  onClose,
}: {
  limits: ReplicaLimits;
  chosen: DndReplicaScheme[];
  onChange: (next: DndReplicaScheme[]) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Map<number, CompendiumEntry> | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    ensureEntries(limits.available.map((s) => s.entryId))
      .then(() => {
        if (!alive) return;
        const map = new Map<number, CompendiumEntry>();
        for (const s of limits.available) {
          const e = getCachedEntry(s.entryId);
          if (e) map.set(s.entryId, e);
        }
        setEntries(map);
      })
      .catch(() => alive && setEntries(new Map()));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limits.classId, limits.level]);

  const q = query.trim().toLowerCase();
  const rows = (entries ? limits.available : [])
    .map((s) => ({ scheme: s, entry: entries!.get(s.entryId) }))
    .filter((r) => r.entry && (!q || r.entry.name.toLowerCase().includes(q)))
    .sort(
      (a, b) => a.scheme.minLevel - b.scheme.minLevel || a.entry!.name.localeCompare(b.entry!.name, "ru")
    );

  function toggle(entryId: number, name: string) {
    const has = chosen.some((c) => c.entryId === entryId);
    onChange(
      has ? chosen.filter((c) => c.entryId !== entryId) : [...chosen, { entryId, name, classId: limits.classId }]
    );
  }

  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-replica-modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Схемы реплик</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          {limits.className} {limits.level} · выбрано {chosen.length} из {limits.schemes} · доступно{" "}
          {limits.available.length}
        </div>
        <input placeholder="Поиск по названию" value={query} onChange={(e) => setQuery(e.target.value)} />
        {entries === null && <p className="muted">Загрузка…</p>}
        {entries !== null && rows.length === 0 && <p className="muted">Ничего не нашлось.</p>}
        {rows.map(({ scheme, entry }) => (
          <label key={scheme.entryId} className="row dnd-replica-row">
            <input
              type="checkbox"
              checked={chosen.some((c) => c.entryId === scheme.entryId)}
              onChange={() => toggle(scheme.entryId, entry!.name)}
            />
            <span style={{ flex: "1 1 12ch", minWidth: 0 }}>{entry!.name}</span>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              с {scheme.minLevel} ур.
            </span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

/** Какое именно оружие (доспех, щит) стало «+1» — решение R3. */
function DndReplicaBasePicker({
  scheme,
  systemId,
  onPick,
  onClose,
}: {
  scheme: DndReplicaScheme;
  systemId: number | null;
  onPick: (base: { name: string; entryId: number | null; meta: Partial<DndEquipmentItem> }) => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<CompendiumEntry[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!systemId) {
      setOptions([]);
      return;
    }
    loadDndEquipmentEntries(systemId)
      .then(setOptions)
      .catch(() => setOptions([]));
  }, [systemId]);

  // Отбор по тому же слову, что стоит в названии схемы: «Оружие +1» — оружие,
  // «Доспех +1» — доспехи, «Щит +1» — щиты.
  const wanted = /доспех/i.test(scheme.name) ? "armor" : /щит/i.test(scheme.name) ? "shield" : "weapon";
  const q = query.trim().toLowerCase();
  const rows = (options ?? []).filter((e) => {
    const armorType = typeof e.data.armor_type === "string" ? e.data.armor_type : "";
    const isShield = armorType.trim().toLowerCase().startsWith("щит");
    const kind = isShield ? "shield" : armorType ? "armor" : e.data.damage ? "weapon" : "";
    if (kind !== wanted) return false;
    return !q || e.name.toLowerCase().includes(q);
  });

  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-replica-modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{scheme.name}: что именно?</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          Прибавка ложится на базовый предмет — в инвентаре появится одна строка, помеченная
          магической.
        </div>
        <input placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
        {options === null && <p className="muted">Загрузка…</p>}
        {options !== null && rows.length === 0 && <p className="muted">Ничего не нашлось.</p>}
        {rows.map((entry) => (
          <div key={entry.id} className="row dnd-replica-row">
            <span style={{ flex: "1 1 12ch", minWidth: 0 }}>{entry.name}</span>
            <button
              type="button"
              className="comp-mini"
              onClick={async () => {
                const meta = await fetchEquipmentMeta(entry.id).catch(() => ({}));
                onPick({ name: entry.name, entryId: entry.id, meta });
              }}
            >
              Выбрать
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function DndResourcesView({
  sources,
  abilities,
  resourceUsed,
  resourceBonus,
  value,
  systemId,
  campaignId,
  ownerCharacterId,
  onQuickUpdate,
}: {
  sources: ClassResourceSource[];
  abilities: DndCharacterData["abilities"];
  resourceUsed: Record<string, number>;
  resourceBonus: Record<string, number>;
  value: DndCharacterData;
  systemId: number | null;
  campaignId?: number | null;
  ownerCharacterId?: number | null;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const resources = allResources(sources, abilities);
  const stats = applicableStats(sources);
  const replicas = replicaLimits(sources);
  if (resources.length === 0 && stats.length === 0 && replicas.length === 0)
    return <p className="muted">Нет доступных ресурсов для текущих классов.</p>;
  // Класс подписываем только у многоклассовых персонажей: у одноклассового
  // это шум, а «Проведение божественности» бывает и у Жреца, и у Паладина
  // сразу, и различить их иначе нечем.
  const showClass = sources.filter((s) => s.entry.level > 0).length > 1;
  return (
    <div className="stack">
      {resources.map((r) => {
        const bonus = resourceBonus[r.key] ?? 0;
        const max = r.max + bonus;
        const used = Math.min(resourceUsed[r.key] ?? 0, max);
        return (
          <div key={r.key} className="sb-entry">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span className="sb-prop-label">
                {r.label}
                {showClass && <span className="muted"> · {r.className}</span>}
              </span>
              <label className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
                доп. бонус
                <input
                  type="number"
                  style={{ width: 44 }}
                  disabled={!onQuickUpdate}
                  value={bonus || ""}
                  onChange={(e) =>
                    onQuickUpdate?.({ resourceBonus: { ...resourceBonus, [r.key]: Number(e.target.value) || 0 } })
                  }
                />
              </label>
            </div>
            <PipTrack
              value={used}
              label={`Потрачено, ${r.label}`}
              max={max}
              onChange={
                onQuickUpdate ? (v) => onQuickUpdate({ resourceUsed: { ...resourceUsed, [r.key]: v } }) : undefined
              }
            />
          </div>
        );
      })}
      {replicas.map((limits) => (
        <DndReplicaBlock
          key={`${limits.classId}`}
          limits={limits}
          value={value}
          systemId={systemId}
          campaignId={campaignId}
          ownerCharacterId={ownerCharacterId}
          onQuickUpdate={onQuickUpdate}
        />
      ))}
      {stats.length > 0 && (
        <div className="sb-entry">
          {/* Показатели по уровню — тратить нечего, поэтому без дорожек. */}
          {stats.map((st) => (
            <div key={st.key} className="row" style={{ justifyContent: "space-between" }}>
              <span className="sb-prop-label">
                {st.label}
                {showClass && <span className="muted"> · {st.className}</span>}
              </span>
              <span>{st.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Rest flow: short rest is purely informational (a reminder of the hit-dice
// pool — actually spending them to heal isn't tracked as a resource
// anywhere on this sheet, matching how the app leaves that up to the table).
// Long rest is the one with a mechanical effect: bulk-resets everything the
// rest of the sheet marks as "spent this rest" — spell slots used and every
// class-resource pool (Ресурсы tab) — plus the standard 5e full heal and
// clearing accumulated death saves, so the button does what a player
// actually expects "long rest" to do rather than just the two fields whose
// own comments mention resetting on one.
function DndRestModal({
  value,
  resources,
  pools,
  onQuickUpdate,
  onClose,
}: {
  value: DndCharacterData;
  resources: DndResourceDef[];
  pools: HitDicePool[];
  onQuickUpdate: (patch: Partial<DndCharacterData>) => void;
  onClose: () => void;
}) {
  const [confirmDialog, confirm] = useConfirm();
  const shortNames = resources.filter((r) => r.recharge === "short").map((r) => r.label);
  const longNames = resources.filter((r) => r.recharge === "long").map((r) => r.label);
  const neverNames = resources.filter((r) => r.recharge === "none").map((r) => r.label);
  const spentDice = pools.reduce((n, p) => n + p.used, 0);
  const totalDice = pools.reduce((n, p) => n + p.total, 0);

  function resetResources(which: "short" | "long"): Record<string, number> {
    const next = { ...value.resourceUsed };
    for (const r of resources) {
      // Короткий отдых чинит только своё; длинный — и своё, и короткое.
      // «Не восстанавливается отдыхом» не трогает ни один: раньше длинный
      // обнулял вообще все пулы подряд, включая заряды предметов.
      if (r.recharge === "none") continue;
      if (which === "long" || r.recharge === "short") next[r.key] = 0;
    }
    return next;
  }

  async function shortRest() {
    const ok = await confirm({
      title: "Короткий отдых?",
      message: [
        shortNames.length > 0
          ? `Восстановятся ячейки договора магии и ресурсы: ${shortNames.join(", ")}.`
          : "Восстановятся ячейки договора магии. Ресурсов короткого отдыха у этого персонажа нет.",
        "Кости хитов тратятся вручную дорожкой в виталах: сколько потратили, столько и вылечили.",
      ].join("\n\n"),
      confirmLabel: "Отдохнуть",
    });
    if (!ok) return;
    onQuickUpdate({ pactSlotsUsed: 0, resourceUsed: resetResources("short") });
    onClose();
  }

  async function longRest() {
    const back = pools.length > 0 ? Math.max(1, Math.floor(totalDice / 2)) : 0;
    const ok = await confirm({
      title: "Длинный отдых?",
      message: [
        "Хиты до максимума, спасброски от смерти сброшены, концентрация снята, все ячейки заклинаний восстановлены.",
        back > 0 ? `

Костей хитов вернётся: ${Math.min(back, spentDice)} из ${spentDice} потраченных.` : "",
        value.exhaustion > 0 ? `

Истощение: ${value.exhaustion} → ${value.exhaustion - 1}.` : "",
        neverNames.length > 0 ? `

Не восстановится: ${neverNames.join(", ")}.` : "",
      ].join(""),
      confirmLabel: "Отдохнуть",
    });
    if (!ok) return;
    onQuickUpdate({
      spellSlotsUsed: value.spellSlotsUsed.map(() => 0),
      pactSlotsUsed: 0,
      resourceUsed: resetResources("long"),
      hitDiceUsed: restoreHitDiceOnLongRest(pools),
      hitPointsCurrent: value.hitPointMax,
      hitPointsTemp: "0",
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      concentration: "",
      // 5.5: длинный отдых снимает один уровень истощения, а не всё сразу.
      exhaustion: Math.max(0, value.exhaustion - 1),
    });
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-spell-modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Отдых</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>

        <div className="stack" style={{ gap: 4 }}>
          <strong>Короткий отдых</strong>
          <p className="muted" style={{ margin: 0 }}>
            {shortNames.length > 0
              ? `Восстановит: ячейки договора магии, ${shortNames.join(", ")}.`
              : "Восстановит ячейки договора магии. Ресурсов короткого отдыха у этого персонажа нет."}
          </p>
          {pools.length > 0 && (
            <p className="muted" style={{ margin: 0 }}>
              Кости хитов тратятся дорожкой в виталах — потрачено {spentDice} из {totalDice}.
            </p>
          )}
          <button type="button" onClick={shortRest} style={{ alignSelf: "flex-start" }}>
            Провести короткий отдых
          </button>
        </div>

        <div className="stack" style={{ gap: 4 }}>
          <strong>Длинный отдых</strong>
          <p className="muted" style={{ margin: 0 }}>
            Восстановит хиты, снимет спасброски от смерти и концентрацию, вернёт все ячейки
            {longNames.length + shortNames.length > 0 ? " и ресурсы классов" : ""}
            {pools.length > 0 ? `, вернёт половину костей хитов (${Math.max(1, Math.floor(totalDice / 2))})` : ""}.
            {neverNames.length > 0 && ` Не восстановится: ${neverNames.join(", ")}.`}
          </p>
          <button type="button" className="primary" onClick={longRest} style={{ alignSelf: "flex-start" }}>
            Провести длинный отдых
          </button>
        </div>
        {confirmDialog}
      </div>
    </Modal>
  );
}

// Разворот колоды веером (гриллинг 2026-09-04, Q33). Свайпать через три
// карты до нужной — бред, а полоска названий на телефоне узкая: в неё влезает
// шесть названий из восьми. Свайп вниз раскладывает всю колоду миниатюрами, и
// он же объясняет устройство листа тому, кто открыл его впервые — Мастеру,
// заглянувшему в чужой чарник.
function DndDeckFan({
  value,
  current,
  color,
  pendingItems,
  onPick,
  onClose,
}: {
  value: DndCharacterData;
  current: DndViewTab;
  color: string;
  pendingItems: number;
  onPick: (tab: DndViewTab) => void;
  onClose: () => void;
}) {
  const spellCount = value.cantrips.length + value.spellsByLevel.reduce((n, l) => n + l.length, 0);
  const itemCount = value.equipmentSections.reduce((n, s) => n + s.items.length, 0);
  const profCount =
    Object.values(value.skillProfs).filter((v) => v > 0).length + value.proficiencies.length;
  const featureCount =
    value.speciesFeatures.length + value.classFeatures.length + value.feats.length + value.specialAbilities.length;
  const actionCount =
    value.attacks.length +
    value.classFeatures.length +
    value.speciesFeatures.length +
    value.equipmentSections.reduce((n, s) => n + s.items.filter((i) => i.equipped).length, 0);
  // Подпись под каждой миниатюрой — не украшение, а причина туда пойти:
  // «сколько там всего» отвечает на вопрос «есть ли мне туда».
  const meta: Record<DndViewTab, string> = {
    "Карта": `КЗ ${computeArmorClass(
      abilityModifier(value.abilities.dex),
      value.equipmentSections,
      parseBonus(value.manualAcBonus)
    )} · ${value.hitPointsCurrent || "—"}/${value.hitPointMax || "—"} хитов`,
    "Действия": actionCount ? `${actionCount} строк` : "Пусто",
    "Магия": spellCount ? `${spellCount} заклинаний` : "Заклинаний нет",
    "Снаряжение": `${itemCount} предметов${pendingItems ? ` · ${pendingItems} не принято` : ""}`,
    "Навыки": profCount ? `${profCount} владений` : "Владений нет",
    "Особенности": featureCount ? `${featureCount} умений` : "Умений нет",
    "Досье": "Характер, привязанности, заметки",
    "Ресурсы": value.hitDice || "Пулов нет",
  };
  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-deck-fan">
        <div className="row dnd-deck-fan-head">
          <h3>Колода</h3>
          <span className="muted">{value.characterName || "Без имени"}</span>
        </div>
        <div className="dnd-deck-fan-grid">
          {DND_VIEW_TABS.map((t) => (
            <button
              key={t}
              type="button"
              className={`dnd-deck-fan-card${t === current ? " is-current" : ""}`}
              style={t === current ? { background: color, borderColor: color } : { borderLeftColor: color, borderRightColor: color }}
              onClick={() => {
                onPick(t);
                onClose();
              }}
            >
              <span className="dnd-deck-fan-name">
                {t}
                {t === "Снаряжение" && pendingItems > 0 && <span className="dnd-tab-dot" aria-label="есть непринятое" />}
              </span>
              <span className="dnd-deck-fan-meta">{meta[t]}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function DndCharacterView({
  value,
  portraitUrl,
  compact,
  onQuickUpdate,
  headerExtra,
  syncTabToUrl,
  campaignId,
  ownerCharacterId,
}: {
  value: DndCharacterData;
  // Лицо первой карты. Отдельное поле под изображение заводить не пришлось —
  // у Персонажа уже есть avatar_image_path; сюда приходит готовый URL, а
  // кадрирование задаёт portraitFocus в самом листе (работает и у Существа,
  // у которого записи Персонажа нет).
  portraitUrl?: string | null;
  // Только для окна предпросмотра сущности (EntityPreviewModal): там лист
  // показывается мельком, поверх другой страницы, и полный лист туда не
  // помещается. Видом статблока (`kind`) это больше не управляется — краткого
  // чарника в списке статблоков нет, см. StatblockList.
  compact?: boolean;
  // Кнопки владельца карточки (сохранение, удаление) — в собственной плашке
  // листа. Внешней обёртки-аккордеона у листа больше нет: она давала вторую
  // шапку поверх этой (§1.4) и прятала лист, который за столом всегда нужен
  // раскрытым.
  headerExtra?: ReactNode;
  // View-mode quick edits (HP, inspiration, death saves, spell slots used)
  // save immediately without entering the full DndCharacterEdit form —
  // mirrors LitMCharacterView's onQuickUpdate for tag edits.
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
  // Держать активную вкладку в адресе (?sheet=). Включает вызывающая
  // сторона, и только когда лист на странице один: в бестиарии листов
  // несколько, и один параметр на всех им конфликтует (гриллинг 2026-09-03).
  // Параметр свой, не `tab`: у страницы, внутри которой живёт лист, вкладки
  // свои, и делить один параметр с ней нельзя.
  syncTabToUrl?: boolean;
  // Кампания и сам персонаж — чтобы было кому передать созданную реплику
  // (решение R2/W8). Без них кнопка «Передать» просто скажет, что некому.
  campaignId?: number | null;
  ownerCharacterId?: number | null;
}) {
  // Оба хука вызываются всегда — по правилам хуков ветвиться здесь нельзя,
  // да и незачем: неиспользуемый просто держит своё состояние вхолостую.
  const [localTab, setLocalTab] = useState<DndViewTab>("Карта");
  // Параметр называется `card`, а не `sheet`: на своём маршруте
  // (/characters/:id/sheet) «sheet?sheet=» читается как опечатка, а карта
  // внутри листа — это именно карта (гриллинг 2026-09-04).
  const [urlTab, setUrlTab] = useTabState<DndViewTab>(DND_VIEW_TABS, "Карта", undefined, "card");
  const tab = syncTabToUrl ? urlTab : localTab;
  const setTab = syncTabToUrl ? setUrlTab : setLocalTab;
  // Живые данные компендиума для всех заклинаний и умений листа — одной
  // пачкой на весь лист, а не запросом на запись (см. entryCache.ts).
  const getEntry = useCompendiumEntries(sheetEntryIds(value));
  // Цвет класса — единственная краска на карте. Боковые кромки рамки,
  // подчёркивание текущей карты в полоске, заливка хитов. При мультиклассе
  // берётся класс с наибольшим уровнем (dndClassColors.ts).
  const cardColor = sheetClassColor(value.classes, getEntry);
  const [fanOpen, setFanOpen] = useState(false);
  // Кадрирование портрета: точка фокуса в долях, по умолчанию чуть выше
  // центра — на портретах в полный рост лицо сидит в верхней трети, и
  // обрезка ровно по центру промахивается по нему.
  const portraitPosition = `${(value.portraitFocus?.x ?? 0.5) * 100}% ${(value.portraitFocus?.y ?? 0.35) * 100}%`;
  // Свайп между соседними картами и вниз — на разворот колоды (Q29/Q33).
  // Жест свободен: таблица «Атаки» на телефоне не прокручивается вбок, а
  // разбирается в стопку карточек (dnd-sheet.css). Но полоска названий, поля
  // ввода и всё, что прокручивается само, свайп перехватывать не должны —
  // иначе прокрутка полоски меняла бы карту под пальцем.
  const touchStart = useRef<{ x: number; y: number; ok: boolean } | null>(null);
  function onSheetTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    const el = e.target as HTMLElement;
    const ok = !el.closest(".dnd-deck-strip, input, textarea, select, [data-no-swipe], .modal, [contenteditable]");
    touchStart.current = { x: t.clientX, y: t.clientY, ok };
  }
  function onSheetTouchEnd(e: React.TouchEvent) {
    const from = touchStart.current;
    touchStart.current = null;
    if (!from || !from.ok) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - from.x;
    const dy = t.clientY - from.y;
    if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      if (dy > 0) setFanOpen(true);
      return;
    }
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const i = DND_VIEW_TABS.indexOf(tab);
    const next = dx < 0 ? i + 1 : i - 1;
    if (next >= 0 && next < DND_VIEW_TABS.length) setTab(DND_VIEW_TABS[next]);
  }
  // Навыки: встроенный каталог, уточнённый справочником системы. Без
  // справочника лист полон — имена берутся встроенные.
  const skills = useDndSkills(value.systemId);
  const systemIdForSlots = value.systemId;
  const pendingItems = value.equipmentSections.reduce(
    (sum, sec) => sum + sec.items.filter((i) => i.pendingFrom).length,
    0
  );
  // Per-section edit toggles for "Особенности" (only "Особые умения" is
  // user-authored — species/class/feats are inherited compendium content and
  // stay read-only) and "Досье" — separate from StatblockList's whole-card
  // editMode, which swaps in the entire DndCharacterEdit form. Draft state is
  // local (not saved on every keystroke, unlike the single-click quick edits
  // elsewhere on this sheet) — an explicit "Сохранить" commits via
  // onQuickUpdate, "Отмена" discards.
  // Все четыре списка особенностей — тексты, а тексты по общему правилу
  // правятся через черновик с явным сохранением: набранный абзац терять
  // нельзя (гриллинг 2026-09-03). Видовые и классовые приходят из
  // компендиума, но править их руками лист позволял и раньше — роспуск формы
  // не должен этого отнимать.
  const [draftFeatures, setDraftFeatures] = useState<Pick<
    DndCharacterData,
    "speciesFeatures" | "classFeatures" | "feats" | "specialAbilities"
  > | null>(null);
  const [draftDossier, setDraftDossier] = useState<Pick<
    DndCharacterData,
    "personalityTraits" | "ideals" | "bonds" | "flaws"
  > | null>(null);
  // `MentionTextarea` — memo, но пока onChange создавался заново на каждый
  // рендер, мемоизация не работала вовсе: нажатие клавиши в «Идеалах»
  // перерисовывало и «Черты характера», и «Привязанности», и «Слабости».
  // Колбэки берут прежнее состояние через функциональный сеттер, поэтому
  // зависимостей нет и ссылки стабильны на всю жизнь компонента.
  const narrativeCallbacks = useMemo(
    () =>
      Object.fromEntries(
        NARRATIVE_FIELDS.map(({ key }) => [
          key,
          (v: string) =>
            setDraftDossier((prev) => (prev ? { ...prev, [key]: v } : prev)),
        ])
      ) as Record<string, (v: string) => void>,
    []
  );
  // Same idea as draftSpecial/draftDossier above, but these two commit on
  // every keystroke like the rest of the sheet (no local draft to lose) —
  // the pencil just toggles between the compact quick-view and the fuller
  // structural editor for that one tab, without touching StatblockList's
  // whole-card editMode.
  const [editingInventory, setEditingInventory] = useState(false);
  const [editingSpells, setEditingSpells] = useState(false);
  const prefs = useDndPrefs();
  const [editingTraits, setEditingTraits] = useState(false);
  const [editingAbilities, setEditingAbilities] = useState(false);
  const [editingActions, setEditingActions] = useState(false);
  // Подсветка строки, на которую увёл поиск, — для того, у чего нет карточки
  // (навык, свободно вписанный предмет, владение). Гаснет по следующему
  // касанию листа.
  const [highlight, setHighlight] = useState<string | null>(null);
  const [openAction, setOpenAction] = useState<AttackRow | null>(null);
  const [restOpen, setRestOpen] = useState(false);
  // Происхождение правится карандашом в самой шапке — там, где класс, вид и
  // предыстория и написаны (гриллинг 2026-09-03). Клик по значению остаётся
  // переходом в статью компендиума: за столом он нужен чаще смены класса.
  const [editingOrigin, setEditingOrigin] = useState(false);
  // Собранным считается лист, у которого выбран хоть один источник из
  // компендиума: дальше система становится свойством листа, а не настройкой.
  const isSystemLocked =
    value.raceId != null || value.backgroundId != null || value.classes.some((c) => c.classId != null);
  // Запасные таблицы подгружаются лениво и только когда без них не обойтись
  // (многоклассье без полного заклинателя) — обычному персонажу лишний
  // запрос ни к чему.
  const [fallbackProgressions, setFallbackProgressions] = useState<(ClassProgression | undefined)[]>([]);
  // Здесь, а не рядом с местом использования: ниже по функции стоит ранний
  // возврат для compact-вида, и хук за ним вызывался бы не в каждом рендере.
  const [spellListOpen, setSpellListOpen] = useState(false);
  // Справочники грузятся только когда панель открыта — см. флаг в useDndOrigin.
  // Справочники нужны обеим панелям правки: происхождению — иерархия классов,
  // виды и предыстории, свойствам — типы урона и состояния. Грузим, когда
  // открыта любая из них, и не грузим, пока лист просто читают.
  const origin = useDndOrigin(value, (v) => onQuickUpdate?.(v), editingOrigin || editingTraits);
  // Считается до раннего выхода: ниже стоят хуки, а компактная карточка
  // возвращается раньше.
  const slotSources = value.classes
    .filter((c) => c.classId != null && c.level > 0)
    .map((c) => ({
      level: c.level,
      progression: getEntry(c.classId)?.data.progression as ClassProgression | undefined,
    }));
  // Запасная таблица нужна ровно в одном случае: заклинательных классов
  // несколько и ни один из них не полный (Паладин + Следопыт). Тогда таблицу
  // многоклассья брать неоткуда, кроме как у полного заклинателя системы.
  const needsFallbackTable =
    slotSources.filter((s) => casterKind(s.progression) !== "none").length > 1 &&
    !slotSources.some((s) => casterKind(s.progression) === "full");
  useEffect(() => {
    if (!needsFallbackTable || !systemIdForSlots || fallbackProgressions.length > 0) return;
    loadDndClassProgressions(systemIdForSlots).then((list) =>
      setFallbackProgressions(list as unknown as ClassProgression[])
    );
  }, [needsFallbackTable, systemIdForSlots, fallbackProgressions.length]);

  if (compact) return <DndCharacterViewMini value={value} />;
  const liveCantrips = value.cantrips.map((s) => resolveSpell(s, getEntry));
  const liveSpellsByLevel = value.spellsByLevel.map((lvl) => lvl.map((s) => resolveSpell(s, getEntry)));
  const computedSlots = computeSpellSlots(slotSources, fallbackProgressions);
  // Сколько заговоров и подготовленных положено — по таблице каждого класса,
  // при многоклассье суммой. Не в счёт идут заклинания «вне лимита»: и по
  // правилам 5.5, и по разметке справочника выдача вида, класса и подкласса
  // всегда подготовлена и мест не занимает.
  const spellLimits = (() => {
    let cantrips: number | null = null;
    let prepared: number | null = null;
    for (const src of slotSources) {
      const c = cantripsAtLevel(src.progression, src.level);
      if (c != null) cantrips = (cantrips ?? 0) + c;
      const p = preparedAtLevel(src.progression, src.level);
      if (p != null) prepared = (prepared ?? 0) + p;
    }
    const counts = (list: DndSpellEntry[]) => list.filter((sp) => !sp.outsideLimit).length;
    return {
      cantrips,
      prepared,
      cantripsUsed: counts(liveCantrips),
      preparedUsed: liveSpellsByLevel.reduce(
        (sum, lvl) => sum + lvl.filter((sp) => !sp.outsideLimit && sp.prepared > 0).length,
        0
      ),
      outside:
        liveCantrips.filter((sp) => sp.outsideLimit).length +
        liveSpellsByLevel.reduce((sum, lvl) => sum + lvl.filter((sp) => sp.outsideLimit).length, 0),
    };
  })();
  // Стартовые наборы: у каждого класса персонажа и у предыстории.
  const resourceSources: ClassResourceSource[] = value.classes.map((c) => ({
    entry: c,
    progression: getEntry(c.classId)?.data.progression as ClassProgression | undefined,
    // Схемы реплик лежат у записи класса (решение R1) — сюда попадают,
    // потому что вкладка «Ресурсы» и есть место, где ими пользуются.
    replicateSchemes: (getEntry(c.classId)?.data.replicate_schemes as ReplicateScheme[] | undefined) ?? [],
  }));
  // Ручная правка выигрывает всегда: у самодельного класса таблицы может не
  // быть вовсе, и обнулять ему ячейки расчётом нельзя.
  const autoSlots = !value.spellSlotsManual && computedSlots.basis !== "none";
  const shownSlotPips = autoSlots ? computedSlots.slots : value.spellSlotPips;
  const shownSlotLevels = autoSlots
    ? Math.max(highestCircle(computedSlots.slots), value.spellSlotLevels)
    : value.spellSlotLevels;
  const liveFeatureGroups = [
    value.classFeatures,
    value.speciesFeatures,
    value.feats,
    value.specialAbilities,
  ].map((g) => g.map((f) => resolveFeature(f, getEntry)));
  // Индекс поиска. Порядок групп особенностей здесь и в liveFeatureGroups
  // должен совпадать — подписи результата берутся по индексу группы.
  const searchHits = collectSheetHits(value, liveCantrips, liveSpellsByLevel, liveFeatureGroups);
  const metaChunks: ReactNode[] = [];
  const namedClasses = value.classes.filter((c) => c.className);
  if (namedClasses.length > 0) {
    metaChunks.push(
      <span key="classes">
        {namedClasses.map((c, i) => (
          <span key={i}>
            <CompendiumLink id={c.classId}>{c.className}</CompendiumLink>
            {c.subclassName && (
              <>
                {" "}
                — <CompendiumLink id={c.subclassId}>{c.subclassName}</CompendiumLink>
              </>
            )}{" "}
            {c.level}
            {i < namedClasses.length - 1 && " / "}
          </span>
        ))}
      </span>
    );
  }
  if (value.raceName) {
    metaChunks.push(
      <span key="race">
        <CompendiumLink id={value.raceId}>{value.raceName}</CompendiumLink>
        {value.raceTypeName && `, ${value.raceTypeName}`}
      </span>
    );
  }
  if (value.backgroundName) {
    metaChunks.push(
      <CompendiumLink key="bg" id={value.backgroundId}>
        {value.backgroundName}
      </CompendiumLink>
    );
  }
  if (value.alignment) metaChunks.push(<span key="align">{value.alignment}</span>);
  const spellAbilityKey = characterSpellcastingAbility(value.classes);
  const spellAbilityMod = spellAbilityKey ? abilityModifier(value.abilities[spellAbilityKey]) : 0;
  const spellProfBonus = parseBonus(value.proficiencyBonus);
  const spellAttackBonus =
    spellAbilityMod + spellProfBonus + parseBonus(value.spellAttackMisc) - value.exhaustion * 2;
  const spellDc = 8 + spellAbilityMod + spellProfBonus + parseBonus(value.spellDcMisc);
  const perceptionProf = value.skillProfs["Perception"] ?? 0;
  const passivePerception =
    10 +
    abilityModifier(value.abilities.wis) +
    parseBonus(value.proficiencyBonus) * perceptionProf -
    value.exhaustion * 2;
  // Картуш на портрете: то же, что в шапке листа, но своими строками и без
  // ссылок — на карте это подпись под именем, а не список источников.
  const totalLevel = value.classes.reduce((sum, c) => sum + (c.level || 0), 0);
  const classLine = value.classes
    .filter((c) => c.className)
    .map((c) => [c.className, c.subclassName].filter(Boolean).join(" · "))
    .join(" / ");
  const originLine = [
    value.raceName,
    value.backgroundName,
    value.proficiencyBonus && `Бонус мастерства ${value.proficiencyBonus}`,
  ]
    .filter(Boolean)
    .join(" · ");
  // Картуш есть только там, где есть портрет и открыта первая карта.
  const cartoucheShown = tab === "Карта" && !!portraitUrl;
  const pools = hitDicePools(value.hitDice, value.hitDiceUsed);
  // 5.5: каждый уровень истощения — −2 к любому броску к20. Штраф уходит
  // в значения навыков, спасбросков, бонусы атак и пассивное восприятие, но
  // НЕ в КЗ и не в сложность заклинаний: это не броски к20.
  const exhaustionPenalty = value.exhaustion * 2;
  // И −5 футов скорости за уровень. Считается только от структурной ходьбы:
  // в свободном тексте («9 клеток, лазание 3») отнимать нечего, и он
  // остаётся примечанием под итогом.
  const walkDie = walkDieParts(value.speeds, value.exhaustion, prefs.distanceUnit);
  // Остальные способы передвижения на кость не лезут и туда не нужны: кость
  // отвечает на вопрос «сколько я прохожу», а полёт и лазание есть не у всех
  // и спрашиваются реже. Они уходят подписью под рядом — вместе со старой
  // свободной строкой скорости, если она заполнена.
  const otherSpeeds = formatSpeed({ ...value.speeds, walk: null }, prefs.distanceUnit);
  // Класс и подкласс — источники списка. Многоклассовый персонаж видит
  // объединение: заклинание из любого своего списка он взять вправе.
  const spellListSources = value.classes.flatMap((c) => [
    ...(c.classId != null ? [{ id: c.classId, name: c.className || "Класс" }] : []),
    ...(c.subclassId != null ? [{ id: c.subclassId, name: c.subclassName || "Подкласс" }] : []),
  ]);
  // Считается на каждый рендер намеренно: подписка на кэш уже перерисовывает
  // лист при любой смене его состояния, включая появление и снятие неудач.
  const entriesFailed = hasFailedEntries() && sheetEntryIds(value).some((id) => typeof id === "number");
  // Спасброски от смерти появляются сами, когда становятся нужны. «Хитов нет»
  // — это ноль или меньше: урон уводит текущие хиты в минус (нижняя граница —
  // Этап 2), и лист обязан показать дорожки и в этом случае. Пустое поле
  // хитов у только что заведённого листа за смерть не считается.
  const atZeroHp =
    (value.hitPointsCurrent !== "" && (Number(value.hitPointsCurrent) || 0) <= 0) ||
    value.deathSaveSuccesses > 0 ||
    value.deathSaveFailures > 0;
  const computedAc = computeArmorClass(
    abilityModifier(value.abilities.dex),
    value.equipmentSections,
    parseBonus(value.manualAcBonus)
  );
  return (
    <div className="sb-scope" onClickCapture={() => highlight && setHighlight(null)}>
      <div className="sb-card">
        <div className={`sb-head${cartoucheShown ? " is-quiet" : ""}`}>
          <div className="sb-head-row">
            {/* Имя и происхождение уезжают в картуш на портрете, когда он
                виден: одно и то же имя дважды на одном экране — это шапка над
                шапкой, ровно та «рамка в рамке», от которой карту и уводили.
                Кнопки остаются: отдых и правка нужны на всех картах. */}
            <div>
              {!cartoucheShown && <div className="sb-name">{value.characterName || "Без имени"}</div>}
              {!cartoucheShown && metaChunks.length > 0 && (
                <div className="sb-meta">
                  {metaChunks.map((chunk, i) => (
                    <span key={i}>
                      {i > 0 && " · "}
                      {chunk}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <span className="sb-head-controls">
              {(value.playerName || value.experiencePoints) && (
                <div className="sb-head-player">
                  {[value.playerName, value.experiencePoints && `Опыт ${value.experiencePoints}`].filter(Boolean).join(" · ")}
                </div>
              )}
              {onQuickUpdate && (
                <button
                  type="button"
                  className="comp-mini"
                  title={editingOrigin ? "Готово" : "Правка происхождения"}
                  aria-label={editingOrigin ? "Готово" : "Правка происхождения"}
                  onClick={() => setEditingOrigin((v) => !v)}
                >
                  <NavIcon name={editingOrigin ? "check" : "edit"} />
                </button>
              )}
              {onQuickUpdate && (
                <button type="button" className="comp-mini" title="Отдых" onClick={() => setRestOpen(true)}>
                  <NavIcon name="moon" /> Отдых
                </button>
              )}
              {headerExtra}
            </span>
          </div>
        </div>
        {openAction?.source && (
          <DndCardModal
            title={openAction.name}
            spell={openAction.source.kind === "spell" ? openAction.source.spell : null}
            feature={openAction.source.kind === "feature" ? openAction.source.feature : null}
            getEntry={getEntry}
            onClose={() => setOpenAction(null)}
            extra={
              onQuickUpdate ? (
                <SpendAction
                  row={openAction}
                  value={value}
                  slots={shownSlotPips}
                  resources={allResources(resourceSources, value.abilities)}
                  onQuickUpdate={onQuickUpdate}
                  onDone={() => setOpenAction(null)}
                />
              ) : undefined
            }
          />
        )}
        {spellListOpen && (
          <DndClassSpellListModal
            systemId={value.systemId}
            sources={spellListSources}
            cantrips={value.cantrips}
            spellsByLevel={value.spellsByLevel}
            onClose={() => setSpellListOpen(false)}
            onAdd={(level, entry) => {
              if (!onQuickUpdate) return;
              // Берётся неподготовленным: взять в книгу и подготовить на день
              // — разные действия, и приложение не вправе решать второе за
              // игрока. Снапшот не пишем — его подставит resolveSpell из
              // кэша справочника, как и у заклинаний, добавленных поиском.
              const added: DndSpellEntry = { entryId: entry.id, name: entry.name, prepared: 0 };
              if (level <= 0) {
                onQuickUpdate({ cantrips: [...value.cantrips, added] });
                return;
              }
              if (level > SPELL_LEVELS) return;
              const next = value.spellsByLevel.map((lvl, i) => (i === level - 1 ? [...lvl, added] : lvl));
              onQuickUpdate({
                spellsByLevel: next,
                // Круг, которого лист ещё не показывал, иначе взятое просто
                // не появится на экране.
                spellSlotLevels: Math.max(value.spellSlotLevels, level),
              });
            }}
          />
        )}
        {editingOrigin && onQuickUpdate && (
          <div className="sb-origin-edit stack">
            <div className="row">
              <label style={{ flex: 1 }}>
                Имя персонажа
                <input
                  value={value.characterName}
                  onChange={(e) => onQuickUpdate({ characterName: e.target.value })}
                />
              </label>
              <label style={{ flex: 1 }}>
                Игрок
                <input value={value.playerName} onChange={(e) => onQuickUpdate({ playerName: e.target.value })} />
              </label>
            </div>

            <DndClassesEdit
              classes={value.classes}
              hierarchy={origin.hierarchy}
              onChange={origin.setClasses}
              onPickClass={origin.pickClass}
              onPickSubclass={origin.pickSubclass}
              onLevelChange={origin.changeClassLevel}
              onRemoveClass={origin.removeClass}
              loadError={origin.loadError}
              onRetryLoad={origin.reloadOrigin}
            />

            <div className="row">
              <label style={{ flex: 1 }}>
                Вид
                {origin.species.length > 0 ? (
                  <select
                    value={value.raceId ?? ""}
                    onChange={(e) => origin.pickRace(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Выбрать вид…</option>
                    {origin.species.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.creatureTypeName ? `${sp.name}, ${sp.creatureTypeName}` : sp.name}
                      </option>
                    ))}
                  </select>
                ) : origin.loadError ? (
                  <CompendiumFieldError
                    current={value.raceName}
                    error={origin.loadError}
                    onRetry={origin.reloadOrigin}
                  />
                ) : (
                  <input value={value.raceName} onChange={(e) => onQuickUpdate({ raceName: e.target.value })} />
                )}
              </label>
              <label style={{ flex: 1 }}>
                Предыстория
                {origin.backgrounds.length > 0 ? (
                  <select
                    value={value.backgroundId ?? ""}
                    onChange={(e) => origin.pickBackground(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Выбрать предысторию…</option>
                    {origin.backgrounds.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ) : origin.loadError ? (
                  <CompendiumFieldError
                    current={value.backgroundName}
                    error={origin.loadError}
                    onRetry={origin.reloadOrigin}
                  />
                ) : (
                  <input
                    value={value.backgroundName}
                    onChange={(e) => onQuickUpdate({ backgroundName: e.target.value })}
                  />
                )}
              </label>
              <label>
                Мировоззрение
                <input value={value.alignment} onChange={(e) => onQuickUpdate({ alignment: e.target.value })} />
              </label>
            </div>

            {/* Система выбирается один раз: смена обрывает все ссылки на
                компендиум — классы, вид, заклинания и умения остаются именами
                без записей. На собранном листе поле только показывается. */}
            {isSystemLocked ? (
              <div className="sb-entry muted">
                <span className="sb-prop-label">Система</span>{" "}
                {origin.systems.find((sy) => sy.id === value.systemId)?.name ?? "не выбрана"} — менять нельзя,
                иначе оборвутся ссылки на компендиум
              </div>
            ) : (
              <label>
                Система (для подсказок класса, вида и предыстории)
                <select
                  value={value.systemId ?? ""}
                  onChange={(e) => onQuickUpdate({ systemId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Не выбрана</option>
                  {origin.systems.map((sy) => (
                    <option key={sy.id} value={sy.id}>
                      {sy.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        {fanOpen && (
          <DndDeckFan
            value={value}
            current={tab}
            color={cardColor}
            pendingItems={pendingItems}
            onPick={setTab}
            onClose={() => setFanOpen(false)}
          />
        )}
        {restOpen && (
          <DndRestModal
            value={value}
            resources={allResources(resourceSources, value.abilities)}
            pools={pools}
            onQuickUpdate={onQuickUpdate!}
            onClose={() => setRestOpen(false)}
          />
        )}
        {/* Рамка карты: бока тонкие и цветные, верх и низ несут содержимое.
            Цвет — единственная краска на монохромной бумаге листа. */}
        <div
          className="sb-body dnd-card-frame"
          style={{ borderLeftColor: cardColor, borderRightColor: cardColor }}
          onTouchStart={onSheetTouchStart}
          onTouchEnd={onSheetTouchEnd}
        >

          {/* Данные компендиума не доехали: лист рисуется по сохранённым
              именам, но молчать об этом нельзя — иначе «у заклинания пропало
              описание» выглядит как потеря данных, а не как обрыв связи. */}
          {entriesFailed && (
            <div className="sb-entry dnd-entries-failed">
              <span className="sb-prop-label">Компендиум</span> данные не загрузились — показаны сохранённые имена.{" "}
              <button type="button" className="comp-mini" onClick={() => retryFailedEntries()}>
                Повторить
              </button>
            </div>
          )}
          {/* Поиск стоит над разделами и виден всегда: на телефоне пролистать
              девять кругов заклинаний дороже всего, и прятать вход в поиск за
              вторым касанием — экономия площади за счёт главного жеста. */}
          <DndSheetSearch
            hits={searchHits}
            getEntry={getEntry}
            onGo={(hit) => {
              setTab(hit.tab);
              setHighlight(hit.highlight ?? null);
            }}
          />

          {/* Полоска названий колоды — одна на телефон и на десктоп (Q29).
              Раньше телефон получал выпадающий список, а десктоп — ряд
              кнопок: два разных языка навигации на одном листе. Полоска
              прокручивается вбок, текущая карта подчёркнута цветом класса, и
              Мастеру, впервые открывшему чужой лист, видно, куда нажать —
              свайпов он не знает. */}
          <div className="dnd-deck-strip" role="tablist" aria-label="Карты листа">
            {DND_VIEW_TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "active" : ""}
                style={tab === t ? { borderBottomColor: cardColor } : undefined}
                onClick={() => setTab(t)}
              >
                {t}
                {/* Точка у «Снаряжения»: кто-то передал предмет, а системы
                    уведомлений в приложении нет — иначе о переданном
                    узнают, только заглянув на карту. */}
                {t === "Снаряжение" && pendingItems > 0 && <span className="dnd-tab-dot" aria-label="есть непринятое" />}
              </button>
            ))}
          </div>

          {/* КАРТА ПЕРСОНАЖА — первая карта колоды (гриллинг 2026-09-04).
              Раньше этот блок висел несворачиваемой шапкой над всеми
              вкладками: чтобы дойти до содержимого любой из них, надо было
              пролистать характеристики и весь список навыков. Теперь это
              своя карта, и она же — то место, куда Мастер заглядывает за
              одним числом. */}
          {tab === "Карта" && (
            <div className="stack dnd-card-face">
              {/* Портрет владеет верхом карты и уходит в бумагу, а под ним
                  лежит он же, отражённый по обеим осям и почти невидимый, —
                  как на фигурных картах. Шва не видно, потому что верхний
                  гаснет не в ноль, а до силы нижнего. Текста поверх нет: имя
                  и класс уже стоят в шапке листа, и дублировать их значило бы
                  написать одно и то же дважды на одном экране. */}
              {portraitUrl && (
                <div className="dnd-card-portrait-zone">
                  <div className="dnd-card-portrait">
                    <img src={portraitUrl} alt="" style={{ objectPosition: portraitPosition }} />
                    <span className="dnd-card-portrait-grain" aria-hidden="true" />
                    <span className="dnd-card-portrait-fade" aria-hidden="true" />
                  </div>
                  {/* Двойник — сосед портрета, а не его потомок: внутри он
                      обрезался бы тем же overflow, который держит кадр. */}
                  <span className="dnd-card-portrait-ghost" aria-hidden="true">
                    <img src={portraitUrl} alt="" style={{ objectPosition: portraitPosition }} />
                  </span>
                  {/* КАРТУШ — имя стоит у нижнего края портретной половины,
                      как на макете: карта должна называть персонажа сама, а
                      не полагаться на шапку листа над ней (её на этой карте
                      теперь и нет — см. sb-head ниже). Уровень числом в
                      картуше цвета класса, под ним вид, предыстория и бонус
                      мастерства — то, что спрашивают редко, но глазами
                      ищут именно здесь. */}
                  <div className="dnd-card-cartouche">
                    <div className="dnd-card-cartouche-name">{value.characterName || "Без имени"}</div>
                    <div className="dnd-card-cartouche-class">
                      {totalLevel > 0 && (
                        <span className="dnd-card-level" style={{ background: cardColor, color: textOnClassColor(cardColor) }}>
                          {totalLevel}
                        </span>
                      )}
                      <span className="dnd-card-cartouche-classline">{classLine}</span>
                    </div>
                    {originLine && <div className="dnd-card-cartouche-origin">{originLine}</div>}
                  </div>
                </div>
              )}
              {/* ВДОХНОВЕНИЕ — жетон-звезда в углу карты, а не плашка в ряду
                  (гриллинг 2026-09-04). Оно тратится ровно в тот момент, когда
                  на карту смотрят, поэтому нажимается прямо здесь; а держать
                  его в общей сетке нельзя — оно там двигало соседей. */}
              {(value.inspiration || onQuickUpdate) && (
                <button
                  type="button"
                  className={`dnd-inspiration-token${value.inspiration ? " is-on" : ""}${portraitUrl ? " on-portrait" : ""}`}
                  style={value.inspiration ? { background: cardColor, borderColor: cardColor } : undefined}
                  aria-pressed={value.inspiration}
                  aria-label={value.inspiration ? "Вдохновение есть — потратить" : "Вдохновения нет"}
                  title="Вдохновение"
                  disabled={!onQuickUpdate}
                  onClick={onQuickUpdate ? () => onQuickUpdate({ inspiration: !value.inspiration }) : undefined}
                >
                  <NavIcon name="star" filled={value.inspiration} />
                </button>
              )}
            {/* §1.11: постоянные ячейки — то, на что игрок смотрит каждый ход.
                Условные показываются, только когда им есть что сказать:
                спасброски от смерти на здоровом персонаже были шумом в самом
                плотном месте листа. Пассивное восприятие и бонус мастерства
                нужны часто, но не каждый ход — бонус мастерства ушёл
                строкой-подписью под ячейками, а пассивное восприятие поднялось
                на кость в ряд к КЗ и хитам. */}
            {/* Четыре кости в ряд: КЗ, хиты, пассивное восприятие, скорость.
                Это те числа, за которыми к чужому листу заглядывает Мастер и
                на которые чаще всего смотрит игрок; всё остальное из витальных
                ячеек — ниже, обычными плашками. */}
            <div className="dnd-triad">
              <AcQuickBox computed={computedAc} manualBonus={value.manualAcBonus} onQuickUpdate={onQuickUpdate} />
              <HpQuickBox value={value} onQuickUpdate={onQuickUpdate} accentColor={cardColor} />
              <div>
                <DndDie size="lg">
                  <span className="dnd-die-value">{passivePerception}</span>
                </DndDie>
                <div className="sb-label">Пасс. воспр.</div>
              </div>
              <div>
                <DndDie size="lg">
                  <span className="dnd-die-value">{walkDie.value}</span>
                  {walkDie.sub && <span className="dnd-die-sub">{walkDie.sub}</span>}
                </DndDie>
                <div className="sb-label">Скорость</div>
                {/* Исходное — зачёркнутым под костью: за столом надо видеть и
                    сколько осталось, и от чего отняли. */}
                {walkDie.was && (
                  <span
                    className="dnd-speed-was"
                    title={`Истощение ${value.exhaustion}: −${value.exhaustion * 5} фт.`}
                  >
                    {walkDie.was}
                  </span>
                )}
              </div>
            </div>
            {(otherSpeeds || value.speed) && (
              <div className="muted dnd-triad-note">{[otherSpeeds, value.speed].filter(Boolean).join(" · ")}</div>
            )}

            {/* Живой ряд: инициатива, концентрация, истощение — то, что
                меняется в бою, строкой плашек, как на макете. */}
            <div className="dnd-live-row">
              <TextQuickBox label="Инициатива" value={value.initiative} field="initiative" onQuickUpdate={onQuickUpdate} />
              {/* Концентрация — там, куда игрок и так смотрит каждый ход.
                  Ставится из окна заклинания, снимается кликом и длинным отдыхом. */}
              <div>
                <div className="sb-label">Концентрация</div>
                <SbQuickValue
                  className={`dnd-concentration${value.concentration ? " is-on" : ""}`}
                  title={value.concentration ? "Снять концентрацию" : undefined}
                  ariaLabel={`Концентрация: ${value.concentration || "нет"} — снять`}
                  onClick={onQuickUpdate && value.concentration ? () => onQuickUpdate({ concentration: "" }) : undefined}
                >
                  {value.concentration || "—"}
                </SbQuickValue>
              </div>
              {/* Истощение меняет каждый бросок к20 и скорость — знать о нём
                  надо не реже, чем о хитах. Дорожка на шесть, шестой уровень —
                  смерть, о чём сказано прямо. Место постоянное, даже когда
                  истощения нет: переезжающая плашка читается как другая. */}
              <div>
                <div className="sb-label">Истощение</div>
                <div className="stack dnd-exhaustion">
                  <PipTrack
                    value={value.exhaustion}
                    label="Истощение"
                    max={6}
                    size={12}
                    onChange={onQuickUpdate ? (n) => onQuickUpdate({ exhaustion: n }) : undefined}
                  />
                  {value.exhaustion >= 6 && <span className="dnd-exhaustion-dead">смерть</span>}
                </div>
              </div>
            </div>

            <div className="sb-vitals">
              {/* Дорожка на каждый пул, подписанная кубом: при мультиклассе они
                  независимы и тратятся по отдельности. Приложение не бросает
                  кубик — показывает формулу, лечение игрок вписывает сам. */}
              {pools.length > 0 && (
                <div>
                  <div className="sb-label">Кости хитов</div>
                  <div className="stack dnd-hitdice-pools">
                    {pools.map((pool) => (
                      <span key={pool.die} className="row dnd-hitdice-pool">
                        <span className="dnd-hitdice-die">{pool.die}</span>
                        <PipTrack
                          value={pool.used}
                          label={`Потрачено костей хитов ${pool.die}`}
                          max={pool.total}
                          size={12}
                          onChange={
                            onQuickUpdate
                              ? (n) => onQuickUpdate({ hitDiceUsed: { ...value.hitDiceUsed, [pool.die]: n } })
                              : undefined
                          }
                        />
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {atZeroHp && (
                <div>
                  <div className="sb-label">Спас от смерти</div>
                  <div className="stack sb-death-saves">
                    <span className="row muted">
                      +
                      <PipTrack
                        value={value.deathSaveSuccesses}
                        label="Успехи спасбросков от смерти"
                        max={3}
                        size={12}
                        onChange={onQuickUpdate ? (v) => onQuickUpdate({ deathSaveSuccesses: v }) : undefined}
                      />
                    </span>
                    <span className="row muted">
                      −
                      <PipTrack
                        value={value.deathSaveFailures}
                        label="Провалы спасбросков от смерти"
                        max={3}
                        size={12}
                        onChange={onQuickUpdate ? (v) => onQuickUpdate({ deathSaveFailures: v }) : undefined}
                      />
                    </span>
                  </div>
                </div>
              )}
              {/* Вдохновения здесь больше нет: оно уехало жетоном-звездой в
                  угол карты (гриллинг 2026-09-04). Его статус меняется чаще
                  всего, и в общей сетке оно двигало соседей — плашка, которая
                  переезжает, читается как другая плашка. */}
            </div>
  
            <div className="sb-vitals-caption">
              {/* Пометка причины: без неё упавшие навыки выглядят как поломка
                  листа, а не как истощение. */}
              {value.exhaustion > 0 && (
                <span className="dnd-exhaustion-note">
                  Истощение {value.exhaustion}: −{exhaustionPenalty} ко всем броскам к20, −{value.exhaustion * 5} фт
                  скорости
                </span>
              )}
              {/* Бонус мастерства стоит в картуше на портрете; здесь он
                  печатается только когда картуша нет — на листе без портрета
                  и на прочих картах. */}
              {value.proficiencyBonus && !cartoucheShown && (
                <span>
                  <span className="sb-prop-label">Бонус мастерства</span> {value.proficiencyBonus}
                </span>
              )}
            </div>
  
            {/* Характеристики меняются редко (повышение, предмет), но менять их
                было негде, кроме как открыв всю форму. Карандаш меняет тот же
                блок на редактируемый прямо на месте; значения сохраняются
                сразу — правило «значения мгновенно» (гриллинг 2026-09-03). */}
            {onQuickUpdate && (
              <TabEditToggle editing={editingAbilities} onToggle={() => setEditingAbilities((v) => !v)} />
            )}
            {editingAbilities && onQuickUpdate ? (
              <AbilitySavesSkillsEdit
                abilities={value.abilities}
                proficiencyBonus={value.proficiencyBonus}
                savingThrowProfs={value.savingThrowProfs}
                skillProfs={value.skillProfs}
                classSkillPool={classSkillPool(value.classes)}
                classSkillChoiceCount={classSkillChoiceTotal(value.classes)}
                backgroundSkillNames={value.backgroundSkillNames}
                onAbilitiesChange={(v) => onQuickUpdate({ abilities: v })}
                onSavingThrowProfsChange={(v) => onQuickUpdate({ savingThrowProfs: v })}
                onSkillProfsChange={(v) => onQuickUpdate({ skillProfs: v })}
              />
            ) : (
              <AbilitySavesSkillsView
                accentColor={cardColor}
                exhaustionPenalty={exhaustionPenalty}
                abilities={value.abilities}
                proficiencyBonus={value.proficiencyBonus}
                savingThrowProfs={value.savingThrowProfs}
                skillProfs={value.skillProfs}
                classSkillPool={classSkillPool(value.classes)}
                backgroundSkillNames={value.backgroundSkillNames}
              />
            )}
            </div>
          )}

          {tab === "Действия" && (
            <div className="stack">
              {/* Вручную вписанные атаки (то, чего нет ни в оружии, ни в
                  заклинаниях) правились только в форме. Теперь — там же, где
                  показываются. */}
              {onQuickUpdate && (
                <TabEditToggle editing={editingActions} onToggle={() => setEditingActions((v) => !v)} />
              )}
              {editingActions && onQuickUpdate && (
                <AttackListEdit values={value.attacks} onChange={(v) => onQuickUpdate({ attacks: v })} />
              )}
              {(() => {
                // Вкладка собирает всё, что персонаж может применить, из
                // всех источников сразу: оружие, заклинания, умения классов,
                // видов, черт и вручную вписанные атаки. Раньше она звалась
                // «Бой» и знала только про первые три.
                const allRows = [
                  ...weaponAttackRows(
                    value.equipmentSections,
                    value.abilities,
                    parseBonus(value.proficiencyBonus),
                    exhaustionPenalty
                  ),
                  ...combatSpellRows(liveCantrips, liveSpellsByLevel, spellAttackBonus, spellDc),
                  ...featureActionRows(liveFeatureGroups, spellAttackBonus, spellDc),
                  ...manualAttackRows(value.attacks),
                ];
                const byTiming = (t: DndActionTiming) => allRows.filter((r) => r.timing === t);
                return (
                  <>
                    <AttacksTable title="Действия" rows={byTiming("action")} onOpen={setOpenAction} />
                    <AttacksTable title="Бонусные действия" rows={byTiming("bonus")} onOpen={setOpenAction} />
                    <AttacksTable title="Реакции" rows={byTiming("reaction")} onOpen={setOpenAction} />
                    <AttacksTable title="Особое" rows={byTiming("other")} onOpen={setOpenAction} />
                  </>
                );
              })()}
            </div>
          )}

          {tab === "Магия" && (
            <div>
              {onQuickUpdate && (
                <TabEditToggle editing={editingSpells} onToggle={() => setEditingSpells((v) => !v)} />
              )}
              {(value.spellcasting || spellAbilityKey) && (
                <>
                  {spellAbilityKey && (
                    <div className="sb-entry">
                      <span className="sb-prop-label">Сложность заклинаний</span> {spellDc}
                      {"  ·  "}
                      <span className="sb-prop-label">Бонус к атаке заклинаниями</span>{" "}
                      {formatModifier(spellAttackBonus)}
                    </div>
                  )}
                  {value.spellcasting && !editingSpells && (
                    <div className="sb-entry" style={{ whiteSpace: "pre-wrap" }}>
                      <MentionText text={value.spellcasting} />
                    </div>
                  )}
                  {/* Прочие бонусы к СЛ и к атаке заклинаниями (предметы,
                      черты) и общий текст о магии правились только в форме.
                      Их место — под самими СЛ и бонусом, которые они меняют. */}
                  {editingSpells && onQuickUpdate && (
                    <div className="stack sb-entry">
                      <div className="row">
                        <label>
                          Прочие бонусы к сложности
                          <input
                            style={{ width: 70 }}
                            value={value.spellDcMisc}
                            onChange={(e) => onQuickUpdate({ spellDcMisc: e.target.value })}
                          />
                        </label>
                        <label>
                          Прочие бонусы к атаке
                          <input
                            style={{ width: 70 }}
                            value={value.spellAttackMisc}
                            onChange={(e) => onQuickUpdate({ spellAttackMisc: e.target.value })}
                          />
                        </label>
                      </div>
                      <label>
                        Заклинания — общая информация
                        <MentionTextarea
                          value={value.spellcasting}
                          onChange={(v) => onQuickUpdate({ spellcasting: v })}
                          rows={3}
                        />
                      </label>
                    </div>
                  )}
                </>
              )}
              {/* Тумблер живёт у самих заклинаний, а не во «Внешнем виде»:
                  утром его выключают, чтобы подготовиться, в бою включают,
                  чтобы не листать книгу. Скрытое всегда посчитано вслух —
                  иначе через сессию это выглядит как пропажа заклинаний. */}
              <div className="row sb-entry dnd-prepared-filter">
                <button
                  type="button"
                  className="comp-mini"
                  aria-pressed={prefs.spellsPreparedOnly}
                  onClick={() => saveDndPrefs({ ...prefs, spellsPreparedOnly: !prefs.spellsPreparedOnly })}
                >
                  <NavIcon name="star" filled={prefs.spellsPreparedOnly} />{" "}
                  {prefs.spellsPreparedOnly ? "Только подготовленные" : "Показаны все"}
                </button>
                {prefs.spellsPreparedOnly && editingSpells && (
                  <span className="muted">в правке показаны все — подготовить можно только видимое</span>
                )}
              </div>
              {onQuickUpdate && (
                <div className="row sb-entry">
                  <button type="button" className="comp-mini" onClick={() => setSpellListOpen(true)}>
                    Список доступных заклинаний
                  </button>
                </div>
              )}
              {(spellLimits.cantrips != null || spellLimits.prepared != null) && (
                <div className="row sb-entry" style={{ gap: 10, flexWrap: "wrap" }}>
                  {spellLimits.cantrips != null && (
                    <span className={spellLimits.cantripsUsed > spellLimits.cantrips ? "dnd-limit-over" : "muted"}>
                      Заговоры {spellLimits.cantripsUsed} из {spellLimits.cantrips}
                    </span>
                  )}
                  {spellLimits.prepared != null && (
                    <span className={spellLimits.preparedUsed > spellLimits.prepared ? "dnd-limit-over" : "muted"}>
                      Подготовлено {spellLimits.preparedUsed} из {spellLimits.prepared}
                    </span>
                  )}
                  {spellLimits.outside > 0 && (
                    <span className="muted">вне лимита {spellLimits.outside}</span>
                  )}
                </div>
              )}
              {computedSlots.basis !== "none" && (
                <div className="row sb-entry" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="muted">
                    {autoSlots
                      ? computedSlots.basis === "multiclass"
                        ? `Ячейки рассчитаны по таблице многоклассья (уровень заклинателя ${effectiveCasterLevel(slotSources)})`
                        : "Ячейки рассчитаны по таблице класса"
                      : "Ячейки заданы вручную"}
                  </span>
                  {onQuickUpdate && (
                    <button
                      type="button"
                      className="comp-mini"
                      onClick={() =>
                        onQuickUpdate(
                          autoSlots
                            ? // При переходе на ручной режим переносим
                              // рассчитанное в хранимое, иначе пипсы
                              // обнулятся у всех, кто их никогда не вбивал.
                              { spellSlotsManual: true, spellSlotPips: computedSlots.slots }
                            : { spellSlotsManual: false }
                        )
                      }
                    >
                      {autoSlots ? "задать вручную" : "считать по классам"}
                    </button>
                  )}
                </div>
              )}
              {computedSlots.pact && (
                <div className="row sb-entry" style={{ gap: 8 }}>
                  <span className="sb-prop-label">Договор магии</span>
                  <span>
                    {computedSlots.pact.count} × {computedSlots.pact.circle} круг
                  </span>
                  <span className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
                    исп.
                    <PipTrack
                      value={Math.min(value.pactSlotsUsed ?? 0, computedSlots.pact.count)}
                      label="Потрачено ячеек договора"
                      max={computedSlots.pact.count}
                      onChange={onQuickUpdate ? (v) => onQuickUpdate({ pactSlotsUsed: v }) : undefined}
                      size={13}
                    />
                  </span>
                </div>
              )}
              <DndSpellsView
                preparedOnly={prefs.spellsPreparedOnly}
                cantrips={liveCantrips}
                spellSlotLevels={shownSlotLevels}
                spellSlotPips={shownSlotPips}
                spellSlotsUsed={value.spellSlotsUsed}
                spellsByLevel={liveSpellsByLevel}
                edit={editingSpells}
                systemId={value.systemId}
                onUsedChange={
                  onQuickUpdate
                    ? (i, v) => {
                        const next = value.spellSlotsUsed.slice();
                        next[i] = v;
                        onQuickUpdate({ spellSlotsUsed: next });
                      }
                    : undefined
                }
                onCantripsChange={onQuickUpdate ? (v) => onQuickUpdate({ cantrips: v }) : undefined}
                onSlotsChange={
                  onQuickUpdate
                    ? (i, v) => {
                        const next = value.spellSlotPips.slice();
                        next[i] = v;
                        onQuickUpdate({ spellSlotPips: next });
                      }
                    : undefined
                }
                onSpellsChange={
                  onQuickUpdate
                    ? (i, v) => {
                        const next = value.spellsByLevel.map((lvl, idx) => (idx === i ? v : lvl));
                        onQuickUpdate({ spellsByLevel: next });
                      }
                    : undefined
                }
              />
            </div>
          )}

          {tab === "Навыки" && (
            <DndSkillsView
              exhaustionPenalty={exhaustionPenalty}
              highlight={highlight}
              abilities={value.abilities}
              proficiencyBonus={value.proficiencyBonus}
              skillProfs={value.skillProfs}
              classSkillPool={classSkillPool(value.classes)}
              backgroundSkillNames={value.backgroundSkillNames}
              proficiencies={value.proficiencies}
              skills={skills}
              onQuickUpdate={onQuickUpdate}
            />
          )}

          {tab === "Снаряжение" && (
            <div>
              {onQuickUpdate && (
                <TabEditToggle editing={editingInventory} onToggle={() => setEditingInventory((v) => !v)} />
              )}
              {editingInventory ? (
                <>
                  <DndEquipmentEdit
                    sections={value.equipmentSections}
                    onChange={(next) => onQuickUpdate?.({ equipmentSections: next })}
                  />
                  {/* Монеты хранились, но в просмотре их не было вовсе —
                      правились только в форме. */}
                </>
              ) : (
                <>
                  <DndEquipmentQuickView
                    sections={value.equipmentSections}
                    systemId={value.systemId}
                    coins={value.coins}
                    onQuickUpdate={onQuickUpdate}
                  />
                </>
              )}
              {/* Настройка предметов: дорожка кликабельна, а не просто
                  показывается — настроить предмет можно и посреди боя. */}
              {(value.attunementCount > 0 || onQuickUpdate) && (
                <div className="sb-entry">
                  <span className="sb-prop-label">Настроено предметов</span>{" "}
                  <PipTrack
                    value={value.attunementCount}
                    label="Настроено предметов"
                    max={3}
                    onChange={onQuickUpdate ? (n) => onQuickUpdate({ attunementCount: n }) : undefined}
                  />
                </div>
              )}
            </div>
          )}

          {tab === "Ресурсы" && (
            <DndResourcesView
              sources={resourceSources}
              abilities={value.abilities}
              resourceUsed={value.resourceUsed}
              resourceBonus={value.resourceBonus}
              value={value}
              systemId={value.systemId}
              campaignId={campaignId}
              ownerCharacterId={ownerCharacterId}
              onQuickUpdate={onQuickUpdate}
            />
          )}

          {tab === "Особенности" && (
            <div>
              {/* Чувства, скорости, защиты и заметки класса жили только внутри
                  формы правки и в просмотре не показывались вовсе — то есть
                  введённое было не увидеть, не открыв форму. После её роспуска
                  им дом здесь: сопротивление огню по природе ничем не
                  отличается от видовой особенности (гриллинг 2026-09-03).
                  Правка — на месте, значения сохраняются сразу. */}
              {onQuickUpdate && (
                <TabEditToggle editing={editingTraits} onToggle={() => setEditingTraits((v) => !v)} />
              )}
              {editingTraits && onQuickUpdate ? (
                <div className="stack">
                  <SpeedEditor value={value.speeds} onChange={(v) => onQuickUpdate({ speeds: v })} />
                  <SensesEditor
                    value={value.sensesList}
                    onChange={(v) => onQuickUpdate({ sensesList: v })}
                    options={origin.senseOptions}
                  />
                  <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
                    <ChecklistEditor
                      label="Уязвимости к урону"
                      value={value.damageVulnerabilities}
                      onChange={(v) => onQuickUpdate({ damageVulnerabilities: v })}
                      options={origin.damageTypes}
                    />
                    <ChecklistEditor
                      label="Сопротивления урону"
                      value={value.damageResistances}
                      onChange={(v) => onQuickUpdate({ damageResistances: v })}
                      options={origin.damageTypes}
                    />
                    <ChecklistEditor
                      label="Иммунитет к урону"
                      value={value.damageImmunities}
                      onChange={(v) => onQuickUpdate({ damageImmunities: v })}
                      options={origin.damageTypes}
                    />
                    <ChecklistEditor
                      label="Иммунитет к состояниям"
                      value={value.conditionImmunities}
                      onChange={(v) => onQuickUpdate({ conditionImmunities: v })}
                      options={origin.conditionOptions}
                    />
                  </div>
                </div>
              ) : (
                <DndTraitsView value={value} />
              )}
              {draftFeatures ? (
                <>
                  <AutoFeatureListEdit
                    title="Видовые особенности"
                    values={draftFeatures.speciesFeatures}
                    onChange={(v) => setDraftFeatures({ ...draftFeatures, speciesFeatures: v })}
                  />
                  <AutoFeatureListEdit
                    title="Классовые особенности"
                    values={draftFeatures.classFeatures}
                    onChange={(v) => setDraftFeatures({ ...draftFeatures, classFeatures: v })}
                  />
                  <AutoFeatureListEdit
                    title="Черты"
                    values={draftFeatures.feats}
                    onChange={(v) => setDraftFeatures({ ...draftFeatures, feats: v })}
                    allowSearchDrop
                  />
                  <FeatureListEdit
                    title="Особые умения"
                    values={draftFeatures.specialAbilities}
                    onChange={(v) => setDraftFeatures({ ...draftFeatures, specialAbilities: v })}
                  />
                  <div className="row" style={{ marginTop: 6, alignItems: "center" }}>
                    <TabEditToggle
                      editing
                      onToggle={() => {
                        onQuickUpdate?.(draftFeatures);
                        setDraftFeatures(null);
                      }}
                    />
                    <button type="button" onClick={() => setDraftFeatures(null)}>
                      Отмена
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <SbFeatureGroup title="Видовые особенности" values={value.speciesFeatures} />
                  <SbFeatureGroup title="Классовые особенности" values={value.classFeatures} />
                  <SbFeatureGroup title="Черты" values={value.feats} />
                  <SbFeatureGroup title="Особые умения" values={value.specialAbilities} />
                  {onQuickUpdate && (
                    <TabEditToggle
                      editing={false}
                      onToggle={() =>
                        setDraftFeatures({
                          speciesFeatures: [...value.speciesFeatures],
                          classFeatures: [...value.classFeatures],
                          feats: [...value.feats],
                          specialAbilities: [...value.specialAbilities],
                        })
                      }
                    />
                  )}
                </>
              )}
            </div>
          )}

          {tab === "Досье" && draftDossier && (
            <div className="dnd-personality-grid">
              {NARRATIVE_FIELDS.map(({ key, label }) => {
                const dossierKey = key as keyof typeof draftDossier;
                return (
                  <div key={key} className="sb-entry">
                    <span className="sb-prop-label">{label}</span>
                    <MentionTextarea
                      value={draftDossier[dossierKey] ?? ""}
                      onChange={narrativeCallbacks[key]}
                      rows={3}
                    />
                  </div>
                );
              })}
              <div className="row" style={{ marginTop: 6, alignItems: "center" }}>
                <TabEditToggle
                  editing
                  onToggle={() => {
                    onQuickUpdate?.(draftDossier);
                    setDraftDossier(null);
                  }}
                />
                <button type="button" onClick={() => setDraftDossier(null)}>
                  Отмена
                </button>
              </div>
            </div>
          )}

          {tab === "Досье" && !draftDossier && (
            <div className="dnd-personality-grid">
              {onQuickUpdate && (
                <TabEditToggle
                  editing={false}
                  onToggle={() =>
                    setDraftDossier({
                      personalityTraits: value.personalityTraits ?? "",
                      ideals: value.ideals ?? "",
                      bonds: value.bonds ?? "",
                      flaws: value.flaws ?? "",
                    })
                  }
                />
              )}
              {NARRATIVE_FIELDS.map(
                ({ key, label }) =>
                  value[key] && (
                    <div key={key} className="sb-entry">
                      <span className="sb-prop-label">{label}</span>{" "}
                      <span style={{ whiteSpace: "pre-wrap" }}>
                        <MentionText text={value[key] as string} />
                      </span>
                    </div>
                  )
              )}
              {NARRATIVE_FIELDS.every(({ key }) => !value[key]) && (
                <span className="muted">Пока ничего не заполнено.</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
