import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { api } from "../../api/client";
import type {
  CompendiumEntry,
  DndAbilityKey,
  DndActionTiming,
  DndCharacterData,
  DndCoins,
  DndCompanion,
  DndCreatureSpeed,
  DndElixir,
  DndPinnedAction,
  DndReplicaItem,
  Statblock,
  DndReplicaScheme,
  DndClassEntry,
  DndEquipmentItem,
  DndEquipmentSection,
  DndFeature,
  DndManualAttack,
  DndMasteredWeapon,
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
import { formatDistance, formatWeight, LB_PER_KG, loadDndPrefs, saveDndPrefs, type DndDistanceUnit } from "../../dndPrefs";
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
  resolveLevelDice,
  type DcExtra,
  type DndCheck,
  type DndCost,
  type DndEffect,
} from "./effects";
import { useCompendiumEntries } from "./useCompendiumEntries";
import { sheetClassColor, textOnClassColor } from "./dndClassColors";
import { DEFAULT_PORTRAIT_FOCUS, useFrameDrag } from "./portraitFrame";
import { DndDie } from "./DndDie";
import { TofuPips } from "./TofuPips";
import { CreatureTypeBadge, creatureTypeName } from "./creatureTypeIcons";
import {
  blueprintFromEntryData,
  companionClassId,
  companionMaxCount,
  companionStats,
  companionsAfterLongRest,
  liveCompanionsOf,
  liveSummonOf,
  resolveBlueprintVariant,
  type CompanionBlueprint,
} from "./companionFormula";
import { rollDiceFormula } from "./diceRoll";
import { DndCardBack } from "./DndCardBack";
import { DndLevelUpWizard } from "./DndLevelUpWizard";
import { PosterButtons } from "./PosterButtons";
import type { PosterData } from "./CharacterPoster";
import { DndTransferBox } from "./DndTransferBox";
import {
  fetchCharacterInbox,
  markInboxMessageRead,
  saveInboxMessageAsNote,
  type CharacterInboxMessage,
} from "./characterInbox";
import {
  fetchTransfers,
  offerItemTransfer,
  offerMoneyTransfer,
  transferAction,
  type CharacterTransfer,
} from "./characterTransfers";
import { armorProfNames, carryCapacityLb, EMPTY_EQUIPMENT_ITEM, ensureEquipmentIds, entryRequiresAttunement, fetchEquipmentMeta, findCarryDoublings, isArmorProficient, isRationRow, isStackableEquipmentEntry, makeEquipmentId } from "./dndEquipment";
import { DndCoinCalculator } from "./DndCoinCalculator";
import { deadEntryIds, ensureEntries, getCachedEntry, hasFailedEntries, retryFailedEntries } from "./entryCache";
import { deadLinkNames } from "./deadLinks";
import { ARCANUM_UNLOCKS, arcanumCountByCircle, arcanumTopCircle, arcanumUnlockedCircles, computeSpellSlots, effectiveCasterLevel, highestCircle, isRoundUpCaster, sourceCasterKind } from "./dndSlots";
import { cantripsAtLevel, classPreparedFormula, formulaPreparedLimit, preparedAtLevel, PROGRESSION_RECHARGE_LABELS, type ClassProgression } from "./progression";
import { AutoFeatureListEdit, FeatureListEdit } from "./FeatureList";
import { PipTrack } from "../litm/PipTrack";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { MentionText } from "../mentions/MentionText";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { useBag } from "../../bag";
import { computeArmorClass, unarmoredDefenseBonus } from "./armorClass";
import {
  isItemMonkWeapon,
  resolveMartialArts,
  unarmoredMovementBonus,
  upgradeDamageDie,
} from "./dndMonk";
import { EMPTY_GRANTS, grantsFromEntry, mergeGrants, type SourceGrants } from "./dndGrants";
import {
  allResources,
  applicableStats,
  featurePoolKey,
  featurePools,
  nameMatches,
  replicaLimits,
  showClassSuffix,
  type ClassResourceSource,
  type DndResourceDef,
  type ReplicaBonus,
  type ReplicaGeneric,
  type ReplicaLimits,
  type ReplicateScheme,
} from "./dndResources";
import { Modal } from "../Modal";
import { EntityPreviewModal } from "../EntityPreviewModal";
import { useConfirm } from "../../hooks/useConfirm";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useDndPrefs } from "../../hooks/useDndPrefs";
import { useEvent, useLatest } from "../../hooks/useEvent";
import { choicesFromEntries, featuresFromEntries, inferTimingFromLegacyText, spellTimingFromData, sumEntrySlots, TIMING_KEY_TO_LABEL, type ChoiceDef } from "./dndFeatures";
import { WeaponMasteryPicker, isMasterableWeapon } from "./StartingEquipmentPicker";
import { ChecklistEditor, emptySpeed, formatSpeed, SensesEditor, SpeedEditor } from "./DndCreatureForm";
import { errorMessage, findDndSystemId, isAbortError, loadDndMechanicsGroup, loadDndMechanicsGroupEntries, type DndMechanicsOption } from "./dndCompendium";
import { useSearchParams } from "react-router-dom";
import { useTabState } from "../../hooks/useTabState";
import { CompendiumEntryPicker } from "../MonsterTemplatePicker";
import { classAndLevelSummary } from "./dndSummary";
import { deriveSheet } from "@shared/dnd/derive";
import { NavIcon } from "../NavIcons";

const SPELL_LEVELS = 9;
const MAX_SPELL_SLOTS = 6;

// Нормализация листа и «пустой лист» переехали в общий с сервером пакет:
// разбор старых форматов нужен и серверу, а внутри React-файла он ему был
// недоступен. Реэкспорт оставлен — их зовут визарды, превью и импорт.
export { emptyDndCharacter, normalizeDndCharacter } from "@shared/dnd/normalize";

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

function stripLatin(name: string): string {
  return name.replace(/\s*\[[^\]]*\]/g, "").trim();
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

// Счётчик черт боевого стиля (тикет 03): положено — 1 за Воина + 1 за
// Чемпиона 7+; есть — строки с entryId из категории «Боевой Стиль».
// Пик — дропом черты в «Черты» выше (с entryId строка живёт связанной);
// замена черты при уровне — тикет 08.
function FightingStyleCounter({
  classes,
  feats,
  getEntry,
}: {
  classes: DndClassEntry[];
  feats: DndFeature[];
  getEntry: (id: number | null | undefined) => CompendiumEntry | undefined;
}) {
  const owed = classes.reduce(
    (n, c) =>
      n +
      // classId не требуем: freehand-строка «Воин» без ссылки — тоже воин.
      (nameMatches(c.className, "Воин") ? 1 : 0) +
      (c.subclassName && nameMatches(c.subclassName, "Чемпион") && c.level >= 7 ? 1 : 0),
    0
  );
  if (owed === 0) return null;
  const have = feats.filter(
    (f) =>
      typeof f.entryId === "number" &&
      (getEntry(f.entryId)?.data.category as string | undefined) === "Боевой Стиль"
  ).length;
  return (
    <span className="muted">
      Боевой стиль: {have} из {owed}
      {have < owed ? " — перетяни черту из поиска в «Черты» выше" : ""}
      {have > owed ? " — лишние убери руками" : ""}
    </span>
  );
}

// Счётчик выборов из каталога (приёмы/выстрелы, тикет 05): лимит — сумма
// count открытых уровнем дефов kind entry на умениях классов, подклассов
// и черт (черты — бонусные пики вроде воззваний, тикет 02 warlock); есть —
// строки «Особых умений» с entryId из группы дефа. Пик — дропом из поиска
// (с entryId строка живёт связанной); замена — тикет 08.
function EntryChoiceCounter({
  classes,
  abilities,
  feats,
  systemId,
}: {
  classes: DndClassEntry[];
  abilities: DndFeature[];
  feats: DndFeature[];
  systemId: number | null;
}) {
  const [defsBySub, setDefsBySub] = useState<Record<number, ChoiceDef[]>>({});
  const [defsByClass, setDefsByClass] = useState<Record<number, ChoiceDef[]>>({});
  const [featDefs, setFeatDefs] = useState<ChoiceDef[]>([]);
  const [catalogs, setCatalogs] = useState<Record<string, CompendiumEntry[]>>({});
  const subKey = classes.map((c) => `${c.subclassId ?? ""}:${c.level}`).join(",");
  useEffect(() => {
    if (!systemId) return;
    const ids = [...new Set(classes.map((c) => c.subclassId).filter((id): id is number => typeof id === "number"))];
    if (ids.length === 0) return;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all(
      ids.map((id) => loadDndClassFeatures(systemId, id, opts).then((es) => [id, choicesFromEntries(es, false)] as const))
    )
      .then((pairs) => {
        setDefsBySub((prev) => {
          const next = { ...prev };
          for (const [id, defs] of pairs) next[id] = defs.filter((d) => d.kind === "entry" && d.group);
          return next;
        });
      })
      .catch(() => {
        /* тихий пропуск: без дефов счётчика нет, лист работает */
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, subKey]);
  // Дефы классов (воззвания колдуна живут на классовом умении, а не на
  // подклассе, как приёмы БМ) — тем же приёмом, ключом classId.
  const classKey = classes.map((c) => `${c.classId ?? ""}:${c.level}`).join(",");
  useEffect(() => {
    if (!systemId) return;
    const ids = [...new Set(classes.map((c) => c.classId).filter((id): id is number => typeof id === "number"))];
    if (ids.length === 0) return;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all(
      ids.map((id) => loadDndClassFeatures(systemId, id, opts).then((es) => [id, choicesFromEntries(es, true)] as const))
    )
      .then((pairs) => {
        setDefsByClass((prev) => {
          const next = { ...prev };
          for (const [id, defs] of pairs) next[id] = defs.filter((d) => d.kind === "entry" && d.group);
          return next;
        });
      })
      .catch(() => {
        /* тихий пропуск */
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, classKey]);
  // Дефы черт (бонусные пики): уровень гейта — суммарный уровень персонажа,
  // черты ни к какому классу не привязаны.
  const featKey = feats.map((f) => f.entryId ?? "").join(",");
  useEffect(() => {
    if (!systemId) return;
    const ids = [...new Set(feats.map((f) => f.entryId).filter((id): id is number => typeof id === "number"))];
    if (ids.length === 0) {
      setFeatDefs([]);
      return;
    }
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all(
      ids.map((id) =>
        api
          .get<CompendiumEntry>(`/systems/entries/${id}`, opts)
          .then((e) => choicesFromEntries([e], false))
          .catch(() => [] as ChoiceDef[])
      )
    )
      .then((lists) => {
        setFeatDefs(lists.flat().filter((d) => d.kind === "entry" && d.group));
      })
      .catch(() => {
        /* тихий пропуск */
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, featKey]);
  const groupsKey = [...Object.values(defsBySub), ...Object.values(defsByClass), featDefs]
    .flat()
    .map((d) => d.group ?? "")
    .filter(Boolean)
    .sort()
    .join("|");
  useEffect(() => {
    if (!systemId || !groupsKey) return;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all(
      groupsKey.split("|").map((g) => loadDndMechanicsGroupEntries(systemId, g, opts).then((es) => [g, es] as const))
    )
      .then((pairs) => {
        setCatalogs((prev) => {
          const next = { ...prev };
          for (const [g, es] of pairs) if (!(g in next)) next[g] = es;
          return next;
        });
      })
      .catch(() => {
        /* тихий пропуск */
      });
    return () => ac.abort();
  }, [systemId, groupsKey]);
  // Лимиты — общим хелпером sumEntrySlots (он же у визарда): классовые и
  // подклассовые дефы открываются уровнем своего класса, дефы черт —
  // суммарным уровнем персонажа.
  const slotSources = [
    ...classes.flatMap((c) => [
      ...(defsByClass[c.classId ?? -1] ?? []).map((def) => ({ def, level: c.level })),
      ...(c.subclassId != null ? (defsBySub[c.subclassId] ?? []) : []).map((def) => ({ def, level: c.level })),
    ]),
    ...featDefs.map((def) => ({ def, level: totalCharacterLevel(classes) })),
  ];
  const rows: { key: string; group: string; picked: number; total: number }[] = [];
  {
    const slots = sumEntrySlots(slotSources);
    const pickIds = new Set(
      abilities.map((f) => f.entryId).filter((id): id is number => typeof id === "number")
    );
    for (const g of slots) {
      const inGroup = new Set((catalogs[g.group] ?? []).map((e) => e.id));
      // Каталог ещё грузится — строку не показываем, чтобы не врать нулями.
      if (!(g.group in catalogs)) continue;
      const picked = [...pickIds].filter((id) => inGroup.has(id)).length;
      rows.push({ key: g.key, group: g.group, picked, total: g.total });
    }
  }
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((r) => (
        <span key={r.key} className="muted">
          {r.group}: {r.picked} из {r.total}
          {r.picked < r.total ? " — добери дропом из поиска в «Особые умения»" : ""}
          {r.picked > r.total ? " — лишние убери руками" : ""}
        </span>
      ))}
    </>
  );
}

// Правка освоенного оружия (тикет 06): лимит — сумма count открытых
// уровнем дефов kind weapon на умениях классов; пик — общим пикером.
// Смена оружия на долгом отдыхе — напоминанием в 08, здесь поле и пик.
function WeaponMasteryEdit({
  classes,
  mastered,
  systemId,
  onChange,
}: {
  classes: DndClassEntry[];
  mastered: DndMasteredWeapon[];
  systemId: number | null;
  onChange?: (v: DndMasteredWeapon[]) => void;
}) {
  const [defs, setDefs] = useState<{ level: number; def: ChoiceDef }[]>([]);
  const [catalog, setCatalog] = useState<CompendiumEntry[] | null>(null);
  const classKey = classes.map((c) => `${c.classId ?? ""}:${c.level}`).join(",");
  useEffect(() => {
    if (!systemId) return;
    const rows = classes.filter((c) => c.classId != null) as { classId: number; level: number }[];
    if (rows.length === 0) return;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all(
      rows.map((c) =>
        loadDndClassFeatures(systemId, c.classId, opts).then(
          (es) => ({ level: c.level, defs: choicesFromEntries(es, true) }) as const
        )
      )
    )
      .then((lists) => {
        setDefs(lists.flatMap((l) => l.defs.filter((d) => d.kind === "weapon").map((def) => ({ level: l.level, def }))));
      })
      .catch(() => {
        /* тихий пропуск: без дефов правки нет, лист работает */
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, classKey]);
  useEffect(() => {
    if (!systemId || defs.length === 0) return;
    const ac = new AbortController();
    loadDndEquipmentEntries(systemId, { signal: ac.signal })
      .then((rows) => setCatalog(rows.filter(isMasterableWeapon)))
      .catch(() => {
        setCatalog([]);
      });
    return () => ac.abort();
  }, [systemId, defs.length > 0]);
  if (defs.length === 0) return null;
  const limit = defs.reduce((n, { level, def }) => n + (def.minLevel <= level ? def.count : 0), 0);
  if (limit <= 0) return null;
  const pickedIds = mastered.map((w) => w.entryId).filter((id): id is number => typeof id === "number");
  function toggle(entry: CompendiumEntry) {
    if (!onChange) return;
    if (pickedIds.includes(entry.id)) {
      onChange(mastered.filter((w) => w.entryId !== entry.id));
      return;
    }
    if (pickedIds.length >= limit) return;
    onChange([...mastered, { entryId: entry.id, name: entry.name }]);
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      {catalog === null ? (
        <span className="muted">Загружаю оружие…</span>
      ) : (
        <WeaponMasteryPicker
          title="Оружейные приёмы"
          entries={catalog}
          pickedIds={pickedIds}
          limit={limit}
          onToggle={toggle}
        />
      )}
    </div>
  );
}

// Requirement 10: a droppable list for proficiencies/languages. Anything
// dragged from search (a compendium item, a mechanics-list tool/language
// entry, …) lands as a row; an ability can be assigned per row to compute
// its bonus (score modifier + proficiency bonus) — left unset, the row is
// just a plain proficiency/language name with no value (matching how
// languages don't have a "check").
function DndProficienciesView({
  value,
  systemId,
  onChange,
}: {
  value: DndProficiencyEntry[];
  systemId: number | null;
  onChange?: (v: DndProficiencyEntry[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [tools, setTools] = useState<CompendiumEntry[] | null>(null);
  function commitAdd() {
    if (draft.trim()) onChange?.([...value, { entryId: null, name: draft.trim(), abilityKey: null }]);
    setDraft("");
    setAdding(false);
  }
  function remove(i: number) {
    onChange?.(value.filter((_, idx) => idx !== i));
  }
  // Список инструментов, которыми можно овладеть, — из справочника
  // (снаряжение категорий «Инструменты»/«Ремесленные инструменты»).
  // Грузим по открытию добавления, а не заранее: нужно не каждому листу.
  function openAdd() {
    setAdding(true);
    setDraft("");
    if (tools !== null || !systemId) return;
    loadDndEquipmentEntries(systemId)
      .then((rows) =>
        setTools(
          rows.filter(
            (e) =>
              e.kind === "equipment" &&
              (e.data.category === "Инструменты" || e.data.category === "Ремесленные инструменты") &&
              !value.some((p) => p.entryId === e.id)
          )
        )
      )
      .catch(() => setTools([]));
  }
  function addTool(e: CompendiumEntry) {
    onChange?.([
      ...value,
      {
        entryId: e.id,
        name: e.name,
        abilityKey: typeof e.data.ability === "string" ? (ABILITY_NAME_TO_KEY[e.data.ability] ?? null) : null,
      },
    ]);
    setTools((prev) => prev?.filter((t) => t.id !== e.id) ?? prev);
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
            <span className="stack dnd-proficiency-chip-add" style={{ gap: 4 }}>
              {tools !== null && tools.length > 0 ? (
                <span className="stack" style={{ gap: 4 }}>
                  {tools.map((t) => (
                    <button key={t.id} type="button" className="dnd-chip" onClick={() => addTool(t)} style={{ alignSelf: "flex-start" }}>
                      + {t.name}
                    </button>
                  ))}
                </span>
              ) : (
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
                    placeholder={tools === null ? "Загрузка…" : "Название…"}
                    disabled={tools === null}
                  />
                </span>
              )}
              <button type="button" className="dnd-chip" onClick={() => setAdding(false)} style={{ alignSelf: "flex-start" }}>
                Готово
              </button>
            </span>
          ) : (
            <button type="button" className="dnd-chip" onClick={openAdd}>
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
    parts.push(<span title={s.upcast || undefined}>{effectsLabel(s.effects, s.checks ?? [])}</span>);
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
  if (item.itemType) parts.push(item.itemType);
  if (item.rarity) parts.push(item.rarity);
  if (item.requiresAttunement) parts.push("требует настройки");
  if (item.cursed) parts.push("проклят");
  if (item.attuned) parts.push("настроен");
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
  // стартовых наборов; предыстория — только ради набора. Подклассы — ради
  // их прогрессий (кости превосходства, ячейки Мистического рыцаря) и
  // заклинательной характеристики.
  const classes = value.classes.map((c) => c.classId);
  const subclasses = value.classes.map((c) => c.subclassId);
  // Спутники: их записи не запрашивались вовсе, хотя жетон рисует портрет из
  // бестиария (`entry.avatar_image_url`) и теперь ещё знак типа. Без запроса
  // `getEntry` всегда пуст — жетон навсегда оставался черепом-заглушкой.
  // Что это было упущение, а не решение, видно по `deadLinkNames`: спутников
  // она уже считает (найдено 09.09 при подключении знаков типов).
  const companions = (value.companions ?? []).map((c) => c.entryId);
  return [...spells, ...features, ...classes, ...subclasses, ...companions, value.backgroundId];
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
  title,
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
  onCast,
  slotsLocked,
}: {
  level: number;
  /** Переименование секции (арканум): по умолчанию «Заговоры»/«N круг». */
  title?: string;
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
  /** Тап по названию — модалка использования (трата ячейки). */
  onCast?: (row: AttackRow) => void;
  /** Пипсы деривационные (считаются из строк, не из хранилища): редактор
   *  числа прячем, иначе задвоим счётчик. */
  slotsLocked?: boolean;
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
  // Дубль в том же круге не добавляем (тикет 08: замена не должна плодить
  // дубли): сверяем ссылку, без неё — имя.
  function addSpell(entryId: number | null, name: string) {
    setAdding(false);
    setQuery("");
    if (spells.some((s) => (entryId != null && s.entryId === entryId) || s.name === name)) return;
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
    if (spells.some((s) => s.entryId === result.id || s.name === result.title)) return;
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
  const label = title ?? (level === 0 ? "Заговоры" : `${level} круг`);
  // Счётчик считает по всему кругу, а не по видимому: фильтр «только
  // подготовленные» не должен занижать «сколько у меня всего в круге».
  const preparedCount = ordered.filter((sp) => sp.prepared > 0).length;

  // Круг, в котором что-то есть, открыт с самого начала. Раскрытие ставится
  // ровно один раз при монтировании и дальше не трогается: заклинатель 9
  // уровня открывал «Магию» и видел шесть пустых заголовков, но управлять
  // раскрытием после этого — его дело, и повторный `open` из рендера отменял
  // бы каждое его сворачивание. Памяти между уходами с карты не заводим —
  // вкладка размонтируется, и восстанавливать нечего.
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const openedOnce = useRef(false);
  useEffect(() => {
    if (openedOnce.current) return;
    openedOnce.current = true;
    if (detailsRef.current && ordered.length > 0) detailsRef.current.open = true;
  }, [ordered.length]);

  return (
    <details className="dnd-spell-level-card" ref={detailsRef}>
      {confirmDialog}
      <summary className="row dnd-spell-level-summary" style={{ justifyContent: "space-between" }}>
        <span className="dnd-spell-level-label">
          {label}
          {/* §1.11: кругу, в котором ничего нет, счётчик показывать нечем. */}
          {ordered.length > 0 && (
            <span className="dnd-spell-level-count">
              {ordered.length}
              {/* «подг. N» — только когда оно отличается от общего числа.
                  У колдуна с пятью заклинаниями, все из которых подготовлены,
                  приписка «· подг. 5» повторяет соседнее число и ничего не
                  добавляет; вопрос, ради которого счётчик заводился, — это
                  «12 известно, 6 подготовлено». */}
              {preparedCount > 0 && preparedCount < ordered.length && ` · подг. ${preparedCount}`}
            </span>
          )}
        </span>
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
            {/* Один трек вместо двух: максимум виден числом кругов, а ячейки —
                тофу (есть голова — цела, потратили — съели). Дубль «макс + исп»
                сбивал с толку. Без правки — только показ. */}
            {!edit && slots > 0 && (
              <span className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
                исп.
                <TofuPips
                  max={slots}
                  left={Math.max(0, slots - (used ?? 0))}
                  label={`Потрачено ячеек, ${label}`}
                  onSetLeft={onUsedChange ? (next) => onUsedChange(slots - next) : undefined}
                />
              </span>
            )}
            {edit && !slotsLocked && (
              <PipTrack value={slots} max={MAX_SPELL_SLOTS} onChange={onSlotsChange} label={`Ячейки, ${label}`} />
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
                {s.entryId && onCast ? (
                  <button
                    type="button"
                    className="comp-name dnd-spell-name dnd-spell-name-link"
                    aria-label={`${s.name} — использовать (трата ячейки)`}
                    onClick={() =>
                      onCast({
                        name: s.name,
                        bonus: "",
                        damage: "",
                        range: "",
                        timing: "action",
                        source: { kind: "spell", spell: s, level },
                      })
                    }
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
                {s.entryId ? (
                  <button
                    type="button"
                    className="dnd-spell-meta-link"
                    aria-expanded={expandedIndex === realIndex}
                    aria-label={`${s.name} — открыть описание`}
                    onClick={() => toggleDescription(realIndex, s.entryId!)}
                  >
                    <SpellMetaLine s={s} />
                  </button>
                ) : (
                  <SpellMetaLine s={s} />
                )}
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
  onCast,
  levelTitles,
  slotsLockedCircles,
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
  /** Тап по названию — модалка использования (трата ячейки). */
  onCast?: (row: AttackRow) => void;
  /** Переименование секций (арканум колдуна): круг → подпись. */
  levelTitles?: Record<number, string>;
  /** Круги с деривационными пипсами (арканум): ручную правку числа прячем,
   *  чтобы не задвоить счётчик. */
  slotsLockedCircles?: ReadonlySet<number>;
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
          onCast={onCast}
        />
      )}
      {activeLevels.map((i) => (
        <DndSpellLevelSection
          key={i}
          level={i + 1}
          title={levelTitles?.[i + 1]}
          systemId={edit ? systemId ?? null : null}
          slots={spellSlotPips[i]}
          spells={spellsByLevel[i]}
          used={spellSlotsUsed?.[i]}
          onUsedChange={onUsedChange ? (v) => onUsedChange(i, v) : undefined}
          edit={!!edit}
          preparedOnly={preparedOnly}
          showSlots
          slotsLocked={slotsLockedCircles?.has(i + 1) ?? false}
          onSlotsChange={edit && onSlotsChange ? (v) => onSlotsChange(i, v) : () => {}}
          onSpellsChange={edit && onSpellsChange ? (v) => onSpellsChange(i, v) : () => {}}
          onCast={onCast}
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
        // Требования мультикласса — подсказкой у второго и следующих классов.
        // Гейта нет сознательно: домашние правила сплошь и рядом, а лист не
        // вправе запрещать. Первый класс требований не имеет по определению.
        const prereq =
          i > 0 && c.classId != null
            ? (hierarchy.classes.find((cl) => cl.id === c.classId)?.multiclassPrereq ?? "")
            : "";
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
                    ? `«${c.className}» уйдёт из листа вместе со своими особенностями, спасбросками, навыками и инструментами.`
                    : "Строка класса будет убрана.",
                  confirmLabel: "Убрать",
                  danger: true,
                });
                if (ok) onRemoveClass(i);
              }}
            >
              <NavIcon name="close" />
            </button>
            {prereq && (
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }} title="Требования мультикласса (PHB 2024): домашние правила могут отменять">
                нужно: {prereq}
              </span>
            )}
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
  onMoveUp,
  onMoveDown,
}: {
  item: DndEquipmentItem;
  onChangeName: (v: string) => void;
  onChangeQty: (v: string) => void;
  onChangeWeight: (v: string) => void;
  onChangeNotes: (v: string) => void;
  onToggleEquipped: () => void;
  onRemove: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
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
      <span className="row" style={{ gap: 2, flex: "0 0 auto" }} role="group" aria-label={`${item.name || "Предмет"}: порядок`}>
        <button type="button" className="comp-mini" onClick={onMoveUp ?? undefined} disabled={!onMoveUp} aria-label="Выше" title="Переместить выше">
          ↑
        </button>
        <button type="button" className="comp-mini" onClick={onMoveDown ?? undefined} disabled={!onMoveDown} aria-label="Ниже" title="Переместить ниже">
          ↓
        </button>
      </span>
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
    onItemsChange([...section.items, { id: makeEquipmentId(), name: "", qty: "", weight: "", notes: "" }]);
  }
  // Порядок внутри секции — кнопками: drag между секциями есть, а внутри
  // moveItem молча выходил (fromSi === toSi). На таче кнопки — единственный путь.
  const moveItem = useEvent((ii: number, delta: -1 | 1) => {
    const jj = ii + delta;
    if (jj < 0 || jj >= section.items.length) return;
    const next = section.items.slice();
    [next[ii], next[jj]] = [next[jj], next[ii]];
    onItemsChange(next);
  });

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
  const moveUpCallbacks = useMemo(
    () => items.map((_, ii) => (ii > 0 ? () => moveItem(ii, -1) : null)),
    [items.length, moveItem]
  );
  const moveDownCallbacks = useMemo(
    () => items.map((_, ii) => (ii < items.length - 1 ? () => moveItem(ii, 1) : null)),
    [items.length, moveItem]
  );
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
            key={item.id ?? ii}
            item={item}
            onChangeName={nameCallbacks[ii]}
            onChangeQty={qtyCallbacks[ii]}
            onChangeWeight={weightCallbacks[ii]}
            onChangeNotes={notesCallbacks[ii]}
            onToggleEquipped={equippedCallbacks[ii]}
            onRemove={removeCallbacks[ii]}
            onDragStart={dragStartCallbacks[ii]}
            onMoveUp={moveUpCallbacks[ii]}
            onMoveDown={moveDownCallbacks[ii]}
          />
        ))}
        {items.length === 0 && (
          <span className="muted">Пусто — перетащите предмет из поиска или добавьте в быстром виде.</span>
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
  // Свежий список после await: handleDrop ждёт мету из сети, а пишет поверх
  // того, что было на момент дропа. useEvent свеж только на входе.
  const sectionsRef = useLatest(sections);

  function addSection() {
    onChange([...sections, { name: "Новый раздел", items: [] }]);
  }
  // Шаблон разделов: новичок валит всё в «Общее», а спрашивают за столом
  // «где зелья». Добавляет только недостающие — существующие не тронет.
  function addTemplateSections() {
    const template = ["Оружие", "Броня", "Расходники", "Магия", "Прочее"];
    const have = new Set(sections.map((s) => s.name.trim().toLowerCase()));
    const missing = template.filter((t) => !have.has(t.toLowerCase()));
    if (missing.length === 0) return;
    onChange([...sections, ...missing.map((name) => ({ name, items: [] }))]);
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
    // Чужой/битый JSON в dataTransfer раньше ронял splice на undefined.
    if (!Number.isInteger(fromSi) || !Number.isInteger(fromIi) || !Number.isInteger(toSi)) return;
    if (fromSi === toSi) return;
    const src = sections[fromSi];
    if (!src || !sections[toSi]) return;
    if (fromIi < 0 || fromIi >= src.items.length) return;
    const next = sections.map((s) => ({ ...s, items: s.items.slice() }));
    const [item] = next[fromSi].items.splice(fromIi, 1);
    if (!item) return;
    next[toSi].items.push(item);
    onChange(next);
  });
  const handleDrop = useEvent(async (e: DragEvent<HTMLDivElement>, si: number) => {
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
    // Дроп из поиска в режиме полной правки: ссылку на запись не теряем —
    // иначе предмет станет «ручным». Мета догружается, магпредметы с флагом.
    if (result.type === "compendium_entry" && (result.kind === "equipment" || result.kind === "magic_item")) {
      const meta = await fetchEquipmentMeta(result.id).catch(() => ({} as Partial<DndEquipmentItem>));
      const { entryId: _eid, magical: _mag, ...restMeta } = meta;
      const next = sectionsRef.current.map((s, idx) =>
        idx === si
          ? {
              ...s,
              items: [
                ...s.items,
                {
                  id: makeEquipmentId(),
                  name: result.title,
                  qty: "",
                  weight: "",
                  notes: "",
                  ...restMeta,
                  entryId: result.id,
                  ...(result.kind === "magic_item" ? { magical: true } : null),
                },
              ],
            }
          : s
      );
      onChange(next);
      return;
    }
    const next = sectionsRef.current.map((s, idx) =>
      idx === si
        ? { ...s, items: [...s.items, { id: makeEquipmentId(), name: `${result.title}${suffix}`, qty: "", weight: "", notes: "" }] }
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
      <div className="dnd-equipment-head" style={{ margin: 0 }}>
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
      <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
        <button type="button" onClick={addSection} style={{ alignSelf: "flex-start" }}>
          + Добавить раздел
        </button>
        <button type="button" className="dnd-chip" onClick={addTemplateSections} title="Оружие, Броня, Расходники, Магия, Прочее — только недостающие">
          + Шаблон разделов
        </button>
      </div>
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
          {sections.length > 1 &&   <div className="dnd-section-title">{section.name}</div>}
          <ul className="dnd-equipment-view-list">
              {section.items.map((item, ii) => (
                <li key={ii}>
                  {item.name}
                  {item.qty && ` ×${item.qty}`}
                  {item.weight && ` (${item.weight})`}
                  {item.chargesMax && ` · заряды ${item.chargesLeft ?? "?"} из ${item.chargesMax}`}
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
  // Кол-во — пусто или целое ≥0: дробные стрелы и «-2 зелья» не существуют.
  if (!v.trim()) return true;
  return /^\d+$/.test(v.trim());
}
function parseQty(v: string): number {
  const t = v.trim();
  if (!t) return 1;
  if (!/^\d+$/.test(t)) return 1;
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}
function isValidWeight(v: string): boolean {
  // Вес — пусто или число ≥0 с необязательной единицей.
  if (!v.trim()) return true;
  return /^\d+([.,]\d+)?\s*(фунт(ов|а|ы)?|фнт\.?|lb|lbs|кг|kg)?$/i.test(v.trim());
}
function parseWeight(v: string): number | null {
  // Возвращает фунты: «5 кг» → ~11.02, без единицы — фунты, как раньше.
  // Мусор после числа («5xyz») больше не считается пятёркой — это невалид,
  // его подсвечивает чип в строке, а сводка пропускает.
  const m = /^(\d+(?:[.,]\d+)?)\s*(фунт(?:ов|а|ы)?|фнт\.?|lb|lbs|кг|kg)?$/i.exec(v.trim());
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = (m[2] ?? "").toLowerCase();
  return unit === "кг" || unit === "kg" ? n * LB_PER_KG : n;
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
        title={qtyOk ? undefined : "Целое ≥ 0, напр. 2"}
      />
      <input
        placeholder="Вес"
        value={draft.weight}
        onChange={(e) => onChange({ ...draft, weight: e.target.value })}
          style={{ flex: "1 1 60px", borderColor: wOk ? undefined : "var(--accent)" }}
          title={wOk ? "Число ≥ 0 с единицей, напр. 5 кг" : "Число ≥ 0 с единицей, напр. 5 кг"}
      />
      <input
        placeholder="Заметка"
        value={draft.notes}
        onChange={(e) => onChange({ ...draft, notes: e.target.value })}
        style={{ flex: "2 1 120px" }}
      />
      {draft.chargesMax && (
        <input
          placeholder={`Заряды (макс ${draft.chargesMax})`}
          title="Остаток зарядов — числом"
          value={draft.chargesLeft ?? ""}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange({ ...draft, chargesLeft: v === "" ? null : Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : draft.chargesLeft ?? null });
          }}
          style={{ flex: "1 1 70px" }}
        />
      )}
      <label className="row" style={{ gap: 4, flex: "0 0 auto" }}>
        <input
          type="checkbox"
          checked={!!draft.equipped}
          onChange={(e) => onChange({ ...draft, equipped: e.target.checked })}
        />
        Надето
      </label>
      {(draft.requiresAttunement || draft.attuned) && (
        <label className="row" style={{ gap: 4, flex: "0 0 auto" }} title="Настройка занимает слот (максимум 3)">
          <input
            type="checkbox"
            checked={!!draft.attuned}
            onChange={(e) => onChange({ ...draft, attuned: e.target.checked })}
          />
          Настроено
        </label>
      )}
      <label className="row" style={{ gap: 4, flex: "0 0 auto" }} title="Проклятый предмет: снятие — с подтверждением">
        <input
          type="checkbox"
          checked={!!draft.cursed}
          onChange={(e) => onChange({ ...draft, cursed: e.target.checked })}
        />
        Проклят
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

/** Весь кошелёк в медяках (курс книги: см=10, эм=50, зм=100, пм=1000). */
function coinsTotalCp(c: DndCoins): number {
  const num = (v: string | undefined) => {
    const n = parseInt(String(v ?? "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return num(c.cp) + num(c.sp) * 10 + num(c.ep) * 50 + num(c.gp) * 100 + num(c.pp) * 1000;
}

function DndEquipmentQuickView({
  sections,
  systemId,
  coins,
  accentColor,
  strength,
  carryDoublingNames,
  armorProfs,
  calcCampaignId,
  calcSenderId,
  calcSenderName,
  onCalcChanged,
  attunementMax,
  onQuickUpdate,
}: {
  sections: DndEquipmentSection[];
  systemId: number | null;
  coins?: DndCoins;
  /** Цвет класса — кромка магических предметов, единственная краска. */
  accentColor?: string;
  /** Значение СИЛ — для грузоподъёмности. */
  strength: number;
  /** Удвоения грузоподъёмности, каждое ×2. */
  carryDoublingNames?: string[];
  /** Имена владений доспехами — надетое без владения помечается в тегах. */
  armorProfs?: readonly string[];
  /** Калькулятор монет: кампания и свой персонаж для дележа/рассылки. */
  calcCampaignId?: number | null;
  calcSenderId?: number | null;
  calcSenderName?: string;
  /** После рассылки долей: дотянуть передачи/входящие. */
  onCalcChanged?: () => void;
  /** Лимит слотов настройки (3 + extra): счёт и подтверждение сверх лимита
   *  живут там, где настраивают, а не только во вкладке магии. */
  attunementMax?: number;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const [editing, setEditing] = useState<{ si: number; ii: number } | null>(null);
  const [addingSection, setAddingSection] = useState<number | null>(null);
  const [addMode, setAddMode] = useState<"bag" | null>(null);
  const [draft, setDraft] = useState<DndEquipmentItem>(EMPTY_EQUIPMENT_ITEM);
  // Полноэкранный подбор из компендиума (этап 6): секция, для которой
  // открыта модалка. Пачка добавляется одним сохранением (appendItems).
  const [pickingSection, setPickingSection] = useState<number | null>(null);
  const [descOpen, setDescOpen] = useState<{ si: number; ii: number } | null>(null);
  const [descriptions, setDescriptions] = useState<Record<number, string>>({});
  const [dragOverSection, setDragOverSection] = useState<number | null>(null);
  const { items: bagItems } = useBag();
  const [confirmDialog, confirm] = useConfirm();
  // Действия принятой передачи (вернуть/сделать своим) идут сервером, а не
  // локальным commit: строки живут в двух листах, и сводит их посредник.
  // Обновление листа после успеха приходит realtime-рассылкой сервера
  // (broadcastCharacterUpdate) — ждать его здесь не надо, только ошибку.
  const [transferBusy, setTransferBusy] = useState<number | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  // Хуки — все до раннего return (rules-of-hooks): prefs, поиск/фильтр,
  // калькулятор, цель перемещения, ошибки описаний и их контроллеры.
  const prefs = useDndPrefs();
  const [equipQuery, setEquipQuery] = useState("");
  const [equipFilter, setEquipFilter] = useState<"all" | "equipped" | "magical">("all");
  const [calcOpen, setCalcOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<number | null>(null);
  const [descErrors, setDescErrors] = useState<Record<number, true>>({});
  const descControllers = useRef(new Map<number, AbortController>());
  // Свежий список после await: saveEdit/removeItem ждут диалог, мешок/пикер —
  // сеть, а пишут поверх того, что было на клик. useEvent свеж только на
  // входе — чтение после await идёт через реф (см. доку useLatest).
  const sectionsRef = useLatest(sections);
  async function transferAction(id: number, action: "return" | "claim") {
    setTransferBusy(id);
    setTransferError(null);
    try {
      await api.post(`/player/transfers/${id}/${action}`);
    } catch (e) {
      setTransferError(`Не вышло: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTransferBusy(null);
    }
  }

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
    setMoveTarget(si);
    setAddingSection(null);
    setDraft({ ...sections[si].items[ii] });
  }
  function startAdd(si: number, mode: "bag" | null) {
    setAddingSection(si);
    setAddMode(mode);
    setEditing(null);
    setDraft(EMPTY_EQUIPMENT_ITEM);
  }
  function cancel() {
    setEditing(null);
    setMoveTarget(null);
    setAddingSection(null);
    setAddMode(null);
  }
  function saveEdit() {
    if (!editing || !draft.name.trim()) return;
    void (async () => {
      // Снятие проклятия — с подтверждением: замком, а не флажком.
      const original = sections[editing.si]?.items[editing.ii];
      if (original?.cursed && !draft.cursed) {
        const ok = await confirm({
          title: "Снять проклятие?",
          message: `«${original.name || "Предмет"}» перестанет быть проклятым.`,
          confirmLabel: "Снять",
        });
        if (!ok) return;
      }
      // Настройка сверх лимита из формы — тем же подтверждением, что на строке.
      if (draft.attuned && !original?.attuned) {
        const have = sectionsRef.current.flatMap((s) => s.items).filter((it) => it.attuned && !it.transferOut).length;
        if (have >= attuneMax) {
          const ok = await confirm({
            title: "Нет свободных слотов",
            message: `Настроено уже ${have} из ${attuneMax}. Настроить «${draft.name || "предмет"}» всё равно?`,
            confirmLabel: "Настроить",
          });
          if (!ok) return;
        }
      }
      // Перемещение в другой раздел — здесь же, без drag-drop.
      // id строки едет вместе с ней, чтобы ключи не прыгали.
      // Пишем поверх свежего списка: диалог мог висеть, а лист — уехать.
      const fresh = sectionsRef.current;
      if (moveTarget != null && moveTarget !== editing.si && fresh[moveTarget] && fresh[editing.si]?.items[editing.ii]) {
        const next = fresh.map((s) => ({ ...s, items: s.items.slice() }));
        const [moved] = next[editing.si].items.splice(editing.ii, 1);
        next[moveTarget].items.push({ ...draft, id: moved?.id ?? draft.id ?? makeEquipmentId() });
        commit({ equipmentSections: next });
        setEditing(null);
        setMoveTarget(null);
        return;
      }
      const next = fresh.map((s, si) =>
        si !== editing.si ? s : { ...s, items: s.items.map((it, ii) => (ii === editing.ii ? draft : it)) }
      );
      commit({ equipmentSections: next });
      setEditing(null);
    })();
  }
  function appendItem(si: number, item: DndEquipmentItem) {
    const withId = item.id ? item : { ...item, id: makeEquipmentId() };
    const next = sectionsRef.current.map((s, idx) => (idx !== si ? s : { ...s, items: [...s.items, withId] }));
    commit({ equipmentSections: next });
    setAddingSection(null);
    setAddMode(null);
  }
  function appendItems(si: number, items: DndEquipmentItem[]) {
    if (items.length === 0) return;
    const withIds = items.map((it) => (it.id ? it : { ...it, id: makeEquipmentId() }));
    const next = sectionsRef.current.map((s, idx) => (idx !== si ? s : { ...s, items: [...s.items, ...withIds] }));
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

  // Повтор расходника — +1 в строку с тем же entryId, а не вторая строка.
  // Едино для пикера, мешка и дропа: было только в пикере.
  function bumpStackRow(entryId: number): boolean {
    const fresh = sectionsRef.current;
    for (let bi = 0; bi < fresh.length; bi++) {
      const ii = fresh[bi].items.findIndex((it) => it.entryId === entryId);
      if (ii >= 0) {
        const next = fresh.map((s, sIdx) =>
          sIdx !== bi
            ? s
            : {
                ...s,
                items: s.items.map((it, iIdx) =>
                  iIdx !== ii ? it : { ...it, qty: String(parseQty(String(it.qty ?? "")) + 1) }
                ),
              }
        );
        commit({ equipmentSections: next });
        return true;
      }
    }
    return false;
  }
  async function addFromBag(si: number, result: SearchResult) {
    if (result.type === "compendium_entry" && (result.kind === "equipment" || result.kind === "magic_item")) {
      const meta = await fetchEquipmentMeta(result.id);
      if (meta.stackable && bumpStackRow(result.id)) return;
      // Магпредмет из мешка/поиска — сразу с флагом и ссылкой, иначе
      // выглядит обычным и теряет описание.
      appendItem(si, {
        name: result.title,
        qty: "",
        weight: "",
        notes: "",
        ...meta,
        entryId: result.id,
        ...(result.kind === "magic_item" ? { magical: true } : null),
      });
    } else {
      const suffix = result.kind === "spell" ? " (свиток)" : "";
      appendItem(si, { name: `${result.title}${suffix}`, qty: "", weight: "", notes: "" });
    }
  }
  async function removeItem(si: number, ii: number) {
    const name = sections[si]?.items[ii]?.name || "предмет";
    const ok = await confirm({ title: "Удалить предмет?", message: `Удалить «${name}»?`, confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    // Удаляем по id, а не по индексу: пока висел диалог, список мог
    // переупорядочиться — иначе снесём соседа.
    const targetId = sections[si]?.items[ii]?.id;
    const fresh = sectionsRef.current;
    const next = fresh.map((s, sIdx) =>
      sIdx !== si
        ? s
        : {
            ...s,
            items: s.items.filter((it, iIdx) => (targetId ? it.id !== targetId : iIdx !== ii)),
          }
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
  // Порядок внутри секции кнопками — то же, что в полной правке, но за
  // столом: drag в быстром виде нет, а на таче кнопки — единственный путь.
  function reorderItem(si: number, ii: number, delta: -1 | 1) {
    const items = sectionsRef.current[si]?.items;
    if (!items) return;
    const jj = ii + delta;
    if (jj < 0 || jj >= items.length) return;
    const next = sectionsRef.current.map((s, sIdx) =>
      sIdx !== si ? s : { ...s, items: s.items.slice() }
    );
    const row = next[si].items;
    [row[ii], row[jj]] = [row[jj], row[ii]];
    commit({ equipmentSections: next });
  }
  // Степпер расходника: зелье тратится одним тапом, а не через ✎. Виден там,
  // где есть счёт (qty задано). В ноль — можно, удаление — руками.
  function bumpQty(si: number, ii: number, delta: number) {
    const next = sections.map((s, sIdx) =>
      sIdx !== si
        ? s
        : {
            ...s,
            items: s.items.map((it, iIdx) =>
              iIdx === ii ? { ...it, qty: String(Math.max(0, parseQty(String(it.qty ?? "")) + delta)) } : it
            ),
          }
    );
    commit({ equipmentSections: next });
  }
  // Настройка на строке: пипс ↔ конкретный предмет. Счётчик внизу вкладки
  // синхронизируется сюда же, чтобы не было двух правд.
  // Сверх лимита — только с подтверждением: раньше 4-й настраивался молча,
  // а ругань висела в другой вкладке.
  async function toggleAttuned(si: number, ii: number) {
    const target = sectionsRef.current[si]?.items[ii];
    if (!target) return;
    if (!target.attuned) {
      const have = sectionsRef.current.flatMap((s) => s.items).filter((it) => it.attuned && !it.transferOut).length;
      if (have >= attuneMax) {
        const ok = await confirm({
          title: "Нет свободных слотов",
          message: `Настроено уже ${have} из ${attuneMax}. Настроить «${target.name || "предмет"}» всё равно?`,
          confirmLabel: "Настроить",
        });
        if (!ok) return;
      }
    }
    const next = sectionsRef.current.map((s, sIdx) =>
      sIdx !== si ? s : { ...s, items: s.items.map((it, iIdx) => (iIdx === ii ? { ...it, attuned: !it.attuned } : it)) }
    );
    const counted = next.flatMap((s) => s.items).filter((it) => it.attuned && !it.transferOut).length;
    commit({ equipmentSections: next, attunementCount: counted });
  }
  // Заряды предмета в инвентаре: степпер −/+ в строке. Максимум-кубик
  // («1к8+1») верхней границей не является — работает только пол (0).
  function bumpCharges(si: number, ii: number, delta: number) {
    const next = sections.map((s, sIdx) =>
      sIdx !== si
        ? s
        : {
            ...s,
            items: s.items.map((it, iIdx) => {
              if (iIdx !== ii || !it.chargesMax) return it;
              const maxNum = /^\d+$/.test(it.chargesMax.trim()) ? Number(it.chargesMax.trim()) : null;
              const cur = typeof it.chargesLeft === "number" ? it.chargesLeft : (delta > 0 ? (maxNum ?? 0) : 0);
              const raw = cur + delta;
              const left = Math.max(0, maxNum != null ? Math.min(maxNum, raw) : raw);
              return { ...it, chargesLeft: left };
            }),
          }
    );
    commit({ equipmentSections: next });
  }
  async function toggleDescription(si: number, ii: number, entryId?: number | null) {
    if (!entryId) return;
    if (descOpen && descOpen.si === si && descOpen.ii === ii) {
      descControllers.current.get(entryId)?.abort();
      descControllers.current.delete(entryId);
      setDescOpen(null);
      return;
    }
    setDescOpen({ si, ii });
    if (entryId in descriptions) return;
    await loadDescription(entryId);
  }
  // Догрузка описания с ретраем: «не загрузилось» — строка с кнопкой повтора,
  // а не тупик. Повторный тап бьёт прошлый запрос, протухший ответ игнится.
  async function loadDescription(entryId: number) {
    descControllers.current.get(entryId)?.abort();
    const controller = new AbortController();
    descControllers.current.set(entryId, controller);
    setDescErrors((d) => {
      if (!(entryId in d)) return d;
      const next = { ...d };
      delete next[entryId];
      return next;
    });
    try {
      const entry = await api.get<CompendiumEntry>(`/systems/entries/${entryId}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setDescriptions((d) => ({ ...d, [entryId]: entry.description || "Нет описания." }));
    } catch (e) {
      if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      setDescErrors((d) => ({ ...d, [entryId]: true }));
    } finally {
      if (descControllers.current.get(entryId) === controller) descControllers.current.delete(entryId);
    }
  }
  async function handleDrop(e: DragEvent<HTMLDivElement>, si: number) {
    e.preventDefault();
    setDragOverSection(null);
    const result = readSearchDrop(e);
    if (!result) return;
    await addFromBag(si, result);
  }

  // S-17: сводка веса/кол-ва над инвентарём. Отданное (transferOut) исключено:
  // физически его уже нет. Невалидные qty/вес пропускаются (та же математика,
  // что валидация; строка помечается чипом «счёт?»/«вес?»). Вес хранится
  // в фунтах, показывается в единице из настроек. Монеты весят по правилу
  // книги: 50 монет = 1 фунт.
  const doublings = carryDoublingNames ?? [];
  const capacityLb = carryCapacityLb(strength, doublings.length);
  const summary = (() => {
    const all = sections.flatMap((s) => s.items).filter((i) => !i.transferOut);
    const totalItems = all.length;
    const equipped = all.filter((i) => i.equipped).length;
    const attuned = all.filter((i) => i.attuned).length;
    let totalWeight = coinsTotalCp(coins ?? EMPTY_COINS) / 50;
    let hasWeight = totalWeight > 0;
    for (const it of all) {
      const w = parseWeight(String(it.weight ?? ""));
      if (w != null) {
        totalWeight += w * parseQty(String(it.qty ?? ""));
        hasWeight = true;
      }
    }
    return { totalItems, equipped, attuned, totalWeight, hasWeight, overloaded: hasWeight && totalWeight > capacityLb };
  })();
  const attuneMax = attunementMax ?? 3;
  // Видимые строки под поиском/фильтром: порядок — ручной, как лежит в
  // секциях. Автосортировки «надетое вверх» нет: она прыгала под пальцем при
  // каждом тоггле; вопрос «что надето» закрывает фильтр. Индексы исходные.
  const equipQ = equipQuery.trim().toLowerCase();
  const filtering = equipQ !== "" || equipFilter !== "all";
  const visibleSections = sections
    .map((section, si) => ({
      section,
      si,
      rows: section.items
        .map((item, ii) => ({ item, ii }))
        .filter(
          ({ item }) =>
            (!equipQ || `${item.name} ${item.notes}`.toLowerCase().includes(equipQ)) &&
            (equipFilter === "all" || (equipFilter === "equipped" ? !!item.equipped : !!item.magical))
        ),
    }))
    .filter(({ section, rows }) => rows.length > 0 || (!filtering && section.items.length === 0));
  return (
    <>
      {confirmDialog}
      <div className="dnd-equipment-head">Снаряжение</div>
      <div className="row muted" style={{ gap: 8, flexWrap: "wrap", fontSize: "var(--fs-meta)" }}>
        <span>Предметов: <span className="dnd-summary-num">{summary.totalItems}</span></span>
        {summary.equipped > 0 && <><span>·</span><span>Надето: <span className="dnd-summary-num">{summary.equipped}</span></span></>}
        {summary.attuned > 0 && (
          <>
            <span>·</span>
            <span
              className={summary.attuned > attuneMax ? "dnd-limit-over" : undefined}
              title={summary.attuned > attuneMax ? "Лимит настройки превышен" : `Настроено ${summary.attuned} из ${attuneMax}`}
            >
              Настройка: <span className="dnd-summary-num">{summary.attuned}/{attuneMax}</span>
            </span>
          </>
        )}
        {summary.hasWeight && <><span>·</span><span>Вес: <span className="dnd-summary-num">{formatWeight(summary.totalWeight, prefs.weightUnit)}</span></span></>}
        {summary.hasWeight && (
          <>
            <span>·</span>
            <span title={doublings.length > 0 ? `СИЛ × 15 × 2^${doublings.length} (${doublings.join(", ")})` : "СИЛ × 15"}>
              Нести: <span className="dnd-summary-num">{formatWeight(capacityLb, prefs.weightUnit)}</span>
            </span>
          </>
        )}
        {summary.overloaded && <><span>·</span><span className="dnd-limit-over">Перегруз!</span></>}
      </div>
      {/* Поиск по снаряжению: имя и заметка. Фильтр надето/магия — те же два
          вопроса за столом. */}
      <div className="row dnd-equipment-search" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        <input
          placeholder="Поиск по снаряжению…"
          value={equipQuery}
          onChange={(e) => setEquipQuery(e.target.value)}
          aria-label="Поиск по снаряжению"
          style={{ flex: "1 1 160px" }}
        />
        {(["all", "equipped", "magical"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`dnd-chip${equipFilter === f ? " is-on" : ""}`}
            aria-pressed={equipFilter === f}
            onClick={() => setEquipFilter(f)}
          >
            {f === "all" ? "Все" : f === "equipped" ? "Надето" : "Магия"}
          </button>
        ))}
      </div>
      {/* Монеты — в самом низу вкладки, все в одну строку: добычу делят
          после боя, когда список уже пролистан. Порядок — от медной к
          платиновой, как в кошельке. */}
      {transferError && (
        <p className="sb-save-error" role="status">
          {transferError}
        </p>
      )}
      {filtering && visibleSections.length === 0 && (
        <p className="muted">Ничего не нашлось — ослабьте поиск или фильтр.</p>
      )}
      {/* Пустая вкладка (§1.11): не «пустоту», а приглашение с действием. */}
      {!filtering && summary.totalItems === 0 && sections.length > 0 ? (
        <div className="sb-entry">
          <p className="muted" style={{ margin: "0 0 8px" }}>
            Имущества пока нет — возьмите из компендиума или запишите своё.
          </p>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            <button type="button" className="primary" onClick={() => setPickingSection(0)}>
              + Из компендиума
            </button>
            <button type="button" onClick={() => startAdd(0, null)}>
              + Свой
            </button>
          </div>
        </div>
      ) : (
      visibleSections.map(({ section, si, rows }) => (
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
          {sections.length > 1 &&   <div className="dnd-section-title">{section.name}</div>}
          <ul className="dnd-equipment-view-list">
            {/* Порядок ручной — см. visibleSections выше. */}
            {rows
              .map(({ item, ii }) =>
              editing && editing.si === si && editing.ii === ii ? (
                <li key={item.id ?? ii}>
                  {sections.length > 1 && (
                    <label className="row muted" style={{ gap: 6, margin: "4px 0", fontSize: "var(--fs-meta)" }}>
                      Раздел:
                      <select
                        value={moveTarget ?? si}
                        onChange={(e) => setMoveTarget(Number(e.target.value))}
                        aria-label="Переместить в раздел"
                      >
                        {sections.map((sec, idx) => (
                          <option key={idx} value={idx}>
                            {sec.name || `Раздел ${idx + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <EquipmentInlineForm
                    draft={draft}
                    onChange={setDraft}
                    onSave={saveEdit}
                    onCancel={cancel}
                    onRemove={() => removeItem(si, ii)}
                  />
                </li>
              ) : (
                <li
                  key={item.id ?? ii}
                  className={[
                    item.transferOut
                      ? "is-transfer-out"
                      : item.transferIn
                        ? item.transferIn.kind === "replica"
                          ? "is-transfer-created"
                          : "is-transfer-in"
                        : "",
                    item.magical ? "is-magical" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined}
                  style={item.magical && accentColor ? { borderLeftColor: accentColor } : undefined}
                >
                  <div className="row dnd-equipment-quick-row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className={`comp-mini dnd-equip-toggle${item.equipped ? " is-equipped" : ""}`}
                      title={item.transferOut ? "Передано — надеть нельзя" : item.equipped ? "Надето" : "Не надето"}
                      aria-label={`${item.name || "Предмет"}: ${item.equipped ? "надето" : "не надето"}`}
                      aria-pressed={!!item.equipped}
                      disabled={!!item.transferOut}
                      onClick={() => toggleEquipped(si, ii)}
                    >
                      {item.equipped ? "●" : "○"}
                    </button>
                    {/* Строка — только имя (счёт/вес/заметка). Характеристика —
                        в карточке по тапу, иначе строки втрое выше. */}
                    <div className="dnd-equipment-name" style={{ flex: 1, minWidth: 0 }}>
                      {item.entryId ? (
                        <button
                          type="button"
                          className="dnd-equipment-name-link"
                          aria-label={`${item.name} — открыть описание`}
                          onClick={() => toggleDescription(si, ii, item.entryId!)}
                        >
                          {item.name}
                          {item.qty && ` ×${item.qty}`}
                          {item.weight && ` (${item.weight})`}
                          {item.cost && ` · ${item.cost}`}
                          {item.notes && ` — ${item.notes}`}
                        </button>
                      ) : (
                        <span>
                          {item.name}
                          {item.qty && ` ×${item.qty}`}
                          {item.weight && ` (${item.weight})`}
                          {item.cost && ` · ${item.cost}`}
                          {item.notes && ` — ${item.notes}`}
                        </span>
                      )}
                    </div>
                    {/* Мало — только у рационов (1–3). */}
                    {(() => {
                      const q = String(item.qty ?? "").trim();
                      return (
                        isRationRow(item) && q !== "" && isValidQty(item.qty) && parseQty(q) >= 1 && parseQty(q) <= 3
                      );
                    })() && (
                      <span className="dnd-mark-chip" title="Рационы заканчиваются">
                        мало
                      </span>
                    )}
                    {/* Метки строки: проклятие, реплика, доспех без владения. */}
                    {item.cursed && (
                      <span className="dnd-mark-chip" title="Проклят: снять можно только в правке с подтверждением">
                        проклят
                      </span>
                    )}
                    {item.replicaId && (
                      <span className="dnd-mark-chip" title="Создано умением: исчезнет вместе с ним">
                        реплика
                      </span>
                    )}
                    {item.equipped && item.armorType && armorProfs && !isArmorProficient(item.armorType, armorProfs) && (
                      <span className="dnd-mark-chip" title="Нет владения этим доспехом: мешает заклинаниям">
                        без владения
                      </span>
                    )}
                    {/* Ручная строка: ни тегов, ни механики из справочника —
                        лист её не считает, честно так и пишет. */}
                    {!item.entryId && (
                      <span className="dnd-mark-chip" title="Вписано вручную: КЗ, вес и цена из справочника не подтянуты">
                        без механики
                      </span>
                    )}
                    {/* Невалид счёта/веса: сводка его пропускает, строка — нет. */}
                    {String(item.qty ?? "").trim() !== "" && !isValidQty(String(item.qty ?? "")) && (
                      <span className="dnd-mark-chip" title="Счёт — целое ≥ 0, напр. 2; иначе в вес не считается">
                        счёт?
                      </span>
                    )}
                    {String(item.weight ?? "").trim() !== "" && !isValidWeight(String(item.weight ?? "")) && (
                      <span className="dnd-mark-chip" title="Вес — число ≥ 0 с единицей, напр. 5 кг; иначе в вес не считается">
                        вес?
                      </span>
                    )}
                    {/* Порядок: drag в быстром виде нет — только кнопки. */}
                    <span className="row" style={{ gap: 2, flex: "0 0 auto" }} role="group" aria-label={`${item.name || "Предмет"}: порядок`}>
                      <button
                        type="button"
                        className="comp-mini"
                        aria-label="Переместить выше"
                        title="Переместить выше"
                        disabled={ii === 0}
                        onClick={() => reorderItem(si, ii, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="comp-mini"
                        aria-label="Переместить ниже"
                        title="Переместить ниже"
                        disabled={ii >= (section.items.length - 1)}
                        onClick={() => reorderItem(si, ii, 1)}
                      >
                        ↓
                      </button>
                    </span>
                    {/* Использование: явное действие вместо криптознака «−».
                        Связи с хитом/эффектом нет — это просто −1 к счёту
                        (эффект зелья — позже, нужна модель эффектов). */}
                    {String(item.qty ?? "").trim() !== "" && (
                      <span className="row" style={{ gap: 2, flex: "0 0 auto" }} role="group" aria-label={`${item.name || "Предмет"}: количество`}>
                        <button
                          type="button"
                          className="comp-mini dnd-qty-step"
                          aria-label={`${item.name || "Предмет"}: использовать, потратить один`}
                          title="Использовать — потратить 1 шт."
                          onClick={() => bumpQty(si, ii, -1)}
                        >
                          Использовать
                        </button>
                        <button
                          type="button"
                          className="comp-mini dnd-qty-step"
                          aria-label="Добавить один"
                          title="Добавить +1"
                          onClick={() => bumpQty(si, ii, 1)}
                        >
                          +
                        </button>
                      </span>
                    )}
                    {/* Настройка: только у требующих её (или уже настроенных). */}
                    {(item.requiresAttunement || item.attuned) && (
                      <button
                        type="button"
                        className={`comp-mini dnd-attune-toggle${item.attuned ? " is-attuned" : ""}`}
                        title={item.attuned ? "Настроено — тап чтобы снять" : "Настроить (занимает слот)"}
                        aria-label={`${item.name || "Предмет"}: настроено`}
                        aria-pressed={!!item.attuned}
                        onClick={() => toggleAttuned(si, ii)}
                      >
                        {item.attuned ? "◆" : "◇"}
                      </button>
                    )}
                    {item.chargesMax && (
                      <span className="row" style={{ gap: 4, alignItems: "center" }} title="Заряды предмета">
                        <button
                          type="button"
                          className="comp-mini"
                          aria-label={`${item.name}: потратить заряд`}
                          disabled={(item.chargesLeft ?? 0) <= 0}
                          onClick={() => bumpCharges(si, ii, -1)}
                        >
                          −
                        </button>
                        <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                          {item.chargesLeft ?? "?"} из {item.chargesMax}
                        </span>
                        <button
                          type="button"
                          className="comp-mini"
                          aria-label={`${item.name}: вернуть заряд`}
                          disabled={
                            item.chargesLeft != null &&
                            /^\d+$/.test(item.chargesMax.trim()) &&
                            item.chargesLeft >= Number(item.chargesMax.trim())
                          }
                          onClick={() => bumpCharges(si, ii, 1)}
                        >
                          +
                        </button>
                      </span>
                    )}
                    {/* Переданное чужой репликой: пока не принято, строка
                        стоит с пометкой — это и есть всё «уведомление»,
                        которого в приложении нет (R2/W8). Действия свернуты
                        под ···: строка не разъезжается на три ряда. */}
                    {item.pendingFrom && (
                      <details className="dnd-transfer-fold">
                        <summary className="dnd-transfer-chip" title="Передача требует решения">
                          не принято ···
                        </summary>
                        <span className="row" style={{ gap: 4 }}>
                          <button type="button" className="comp-mini" onClick={() => acceptItem(si, ii)}>
                            Принять
                          </button>
                          <button type="button" className="comp-mini" onClick={() => removeItem(si, ii)}>
                            Вернуть
                          </button>
                        </span>
                      </details>
                    )}
                    {/* Этап 4б: отданная строка серая («передано → имя») —
                        только сведения; принятая/created — с кнопками под ···. */}
                    {item.transferOut && (
                      <span className="dnd-transfer-chip">передано → {item.transferOut.toName}</span>
                    )}
                    {item.transferIn && (
                      <details className="dnd-transfer-fold">
                        <summary className="dnd-transfer-chip" title="Передача требует решения">
                          {item.transferIn.kind === "replica"
                            ? `создал ${item.transferIn.fromName} ···`
                            : `принято ← ${item.transferIn.fromName} ···`}
                        </summary>
                        <span className="row" style={{ gap: 4 }}>
                          <button
                            type="button"
                            className="comp-mini"
                            disabled={transferBusy === item.transferIn.id}
                            onClick={() => void transferAction(item.transferIn!.id, "return")}
                          >
                            Вернуть
                          </button>
                          <button
                            type="button"
                            className="comp-mini"
                            disabled={transferBusy === item.transferIn.id}
                            onClick={() => void transferAction(item.transferIn!.id, "claim")}
                          >
                            Сделать своим
                          </button>
                        </span>
                      </details>
                    )}
                    <button type="button" className="comp-mini dnd-row-edit" title="Редактировать" aria-label="Редактировать предмет" onClick={() => startEdit(si, ii)}>
                      <NavIcon name="edit" />
                    </button>
                  </div>
                  {descOpen && descOpen.si === si && descOpen.ii === ii && item.entryId && (
                    <div className="dnd-spell-description">
                      {equipmentTagsLine(item) && <div className="dnd-equipment-tags">{equipmentTagsLine(item)}</div>}
                      {descErrors[item.entryId] ? (
                        <span className="row" style={{ gap: 6, alignItems: "center" }}>
                          <span className="muted">Описание не загрузилось.</span>
                          <button type="button" className="comp-mini" onClick={() => void loadDescription(item.entryId!)}>
                            Повторить
                          </button>
                        </span>
                      ) : (
                        <MentionText text={descriptions[item.entryId] ?? "Загрузка…"} />
                      )}
                    </div>
                  )}
                </li>
              )
            )}
          </ul>
          {addingSection === si ? (
            addMode === "bag" ? (
              <div className="stack" style={{ gap: 4 }}>
                {bagItems.length === 0 && <span className="muted">В мешке ничего нет.</span>}
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
              <button type="button" className="dnd-chip" onClick={() => startAdd(si, null)}>
                + Свой
              </button>
              <button type="button" className="dnd-chip" onClick={() => setPickingSection(si)}>
                + Из компендиума
              </button>
              <button type="button" className="dnd-chip" onClick={() => startAdd(si, "bag")}>
                + Из мешка
              </button>
            </div>
          )}
        </div>
      ))
      )}
      {pickingSection != null && (
        <DndEquipmentPickerModal
          systemId={systemId}
          ownedIds={
            new Set(
              sections
                .flatMap((s) => s.items.map((i) => i.entryId))
                .filter((id): id is number => typeof id === "number")
            )
          }
          onPick={(entries) => {
            const si = pickingSection;
            setPickingSection(null);
            if (entries.length === 0) return;
            // Пачка одним сохранением: мета догружается, строки ложатся разом.
            // Повтор расходника — +1 в его строку, а не вторая строка.
            void (async () => {
              const items: DndEquipmentItem[] = [];
              let bumped = false;
              // База — свежая на момент догрузки меты, а не на момент открытия
              // пикера: мета едет по сети, лист за это время мог измениться.
              const base = sectionsRef.current.map((s) => ({ ...s, items: s.items.map((it) => ({ ...it })) }));
              const findRow = (entryId: number) => {
                for (let bi = 0; bi < base.length; bi++) {
                  const ii = base[bi].items.findIndex((it) => it.entryId === entryId);
                  if (ii >= 0) return { si: bi, ii };
                }
                return null;
              };
              for (const e of entries) {
                const at = findRow(e.id);
                if (at && isStackableEquipmentEntry(e)) {
                  const row = base[at.si].items[at.ii];
                  row.qty = String(parseQty(String(row.qty ?? "")) + 1);
                  bumped = true;
                  continue;
                }
                const meta = await fetchEquipmentMeta(e.id);
                items.push({
                  name: e.name,
                  qty: "",
                  weight: "",
                  notes: "",
                  ...meta,
                  // Ссылку и флаг магии держим явно поверх спреда.
                  entryId: e.id,
                  ...(e.kind === "magic_item" ? { magical: true } : null),
                });
              }
              if (bumped) commit({ equipmentSections: base.map((s) => ({ ...s })) });
              if (items.length > 0) {
                const next = base.map((s, idx) =>
                  idx !== si
                    ? s
                    : {
                        ...s,
                        items: [
                          ...s.items,
                          ...items.map((it) => (it.id ? it : { ...it, id: makeEquipmentId() })),
                        ],
                      }
                );
                commit({ equipmentSections: next });
              }
              setAddingSection(null);
              setAddMode(null);
            })();
          }}
          onClose={() => setPickingSection(null)}
        />
      )}
      {/* Монеты — в самом низу вкладки, в своей рамке отдельно от настройки.
          Порядок — от медной к платиновой. Подписи столбиком (М над М), иначе
          пятая монета не влезает. */}
      <div className="dnd-frame">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <span className="sb-prop-label">Монеты</span>
          {(() => {
            const totalCp = coinsTotalCp(coins ?? EMPTY_COINS);
            const totalGp = Math.floor(totalCp / 100) + ((totalCp % 100) / 100);
            return (
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                Итого ≈ {String(Math.round(totalGp * 10) / 10).replace(".", ",")} ЗМ
              </span>
            );
          })()}
        </div>
        <div className="row dnd-coins-bottom">
          {COIN_FIELDS.map(({ key, label, title }) => (
            <label key={key} className="dnd-coin" title={title}>
              <input
                inputMode="numeric"
                value={coins?.[key] ?? ""}
                aria-label={title}
                onChange={(e) =>
                  commit({
                    // Монеты не бывают отрицательными: только цифры, до 6 знаков.
                    coins: { ...(coins ?? EMPTY_COINS), [key]: e.target.value.replace(/[^\d]/g, "").slice(0, 6) },
                  })
                }
              />
              <span className="muted dnd-coin-letters" aria-hidden="true">
                <span>{label[0]}</span>
                <span>{label[1]}</span>
              </span>
            </label>
          ))}
        </div>
        {/* Калькулятор монет: курс, добыча пулом, делёж с рассылкой. */}
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="dnd-chip" onClick={() => setCalcOpen(true)}>
            Калькулятор монет
          </button>
        </div>
      </div>
      {calcOpen && (
        <DndCoinCalculator
          campaignId={calcCampaignId}
          senderId={calcSenderId}
          senderName={calcSenderName ?? ""}
          ownCoins={coins ?? EMPTY_COINS}
          onCommitCoins={(c) => commit({ coins: c })}
          onChanged={() => onCalcChanged?.()}
          onClose={() => setCalcOpen(false)}
        />
      )}
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
      // Выдачи подкласса (навыки и инструменты — напр. Орудия милосердия):
      // уходящий подкласс забирает своё, кроме того, что подтверждает
      // оставшееся (класс строки, остальные строки, предыстория). Тем же
      // приёмом, что смена класса и предыстории выше.
      const revoked = mergeGrants(await loadGrants([oldClass?.subclassId], skillsRef.current.resolve));
      const kept = await loadGrants(
        [
          ...value.classes.filter((_, idx) => idx !== i).flatMap((c) => [c.classId, c.subclassId]),
          oldClass?.classId,
          value.backgroundId,
        ],
        skillsRef.current.resolve
      );
      const cleared = revokeGrants(value, revoked, kept);
      let skillProfs = cleared.skillProfs;
      let proficiencies = cleared.proficiencies;
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
        // Выдача нового подкласса: навыки — владением (не затирая экспертизу
        // и ручные), инструменты — строками (способность подтягивается с
        // записи, как при смене класса).
        try {
          const entry = await api.get<CompendiumEntry>(`/systems/entries/${subclassId}`);
          const grantedSkills = (Array.isArray(entry.data.skills) ? (entry.data.skills as unknown[]) : [])
            .filter((s): s is string => typeof s === "string" && !!s.trim())
            .map((s) => skillsRef.current.resolve(s) ?? s.trim());
          if (grantedSkills.length > 0) {
            const nextSkillProfs = { ...skillProfs };
            for (const s of grantedSkills) if (!nextSkillProfs[s]) nextSkillProfs[s] = 1;
            skillProfs = nextSkillProfs;
          }
          const toolPicks = Array.isArray(entry.data.tool_profs)
            ? (entry.data.tool_profs as { id: number; name: string }[])
            : [];
          const newTools = toolPicks.filter((t) => !proficiencies.some((p) => p.name === t.name));
          if (newTools.length > 0) {
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
          /* subclass has no compendium entry — nothing to grant */
        }
      }
      const nextValue = { ...valueRef.current, classes: nextClasses, classFeatures, skillProfs, proficiencies };
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
      // Кость скорости читает структуру, а не строку: без этого ходьба вида
      // уходила подписью, а в кости оставался прочерк. walkSpeed вида —
      // строка, в структуру ложится числом.
      speeds: opt?.walkSpeed && Number.isFinite(Number(opt.walkSpeed))
        ? { ...value.speeds, walk: Number(opt.walkSpeed) }
        : value.speeds,
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
      speeds: nextValue.speeds,
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
  // им нечего, а описание ручной атаки и так стоит в строке. У оружия зато
  // есть entryId записи снаряжения — по нему окно показывает описание.
  source?:
    | { kind: "spell"; spell: DndSpellEntry; level: number }
    | { kind: "feature"; feature: DndFeature };
  entryId?: number | null;
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
  exhaustionPenalty = 0,
  // Боевые искусства монаха: кость для замены и классификатор строк.
  // Без него (немонах, умение погашено) — всё как было.
  martial?: { die: string; isMonkWeapon: (item: DndEquipmentItem) => boolean } | null,
  // Освоенные типы оружия («Оружейные приёмы» Воина, тикет 06): свойство
  // мастерства применимо только к освоенному. null/пусто — воин без выбора,
  // не-воин или старый лист: показ как раньше, без пометок.
  mastered?: { ids: Set<number>; names: Set<string> } | null
): AttackRow[] {
  const str = abilityModifier(abilities.str);
  const dex = abilityModifier(abilities.dex);
  return sections
    .flatMap((s) => s.items)
    // Отданная вещь из боя исключена вместе с КЗ (этап 4б): ею не бьют.
    .filter((i) => i.equipped && !i.transferOut && i.weaponDamage)
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
      // Ловкие атаки монаха: монашеское оружие бьёт Ловкостью (фехтовальное —
      // как было, max, чтобы умение не занижало готовую строку).
      const monkWeapon = !!martial && martial.isMonkWeapon(i);
      const mod = monkWeapon ? (finesse ? Math.max(str, dex) : dex) : finesse ? Math.max(str, dex) : rangedOnly ? dex : str;
      const range = i.weaponAttackMelee && i.weaponAttackRanged ? "Ближний/Дальний" : i.weaponAttackRanged ? "Дальний" : "Ближний";
      // Кость боевых искусств вместо своей, если больше («1к4 колющий» кинжала
      // на 1к8 с 5 уровня). Тип урона и хвост сохраняются в upgradeDamageDie.
      const upgraded = monkWeapon ? upgradeDamageDie(i.weaponDamage ?? "", martial.die) : null;
      const baseDamage = upgraded ?? i.weaponDamage;
      // Урон печатался как есть — «1к8» без модификатора, который игрок
      // прибавлял в уме каждый бросок. Теперь формула полная: «1к8 +3».
      const damageWithMod = baseDamage
        ? `${baseDamage}${mod !== 0 ? ` ${formatModifier(mod)}` : ""}`
        : "";
      // Мастерство применимо, только если оружие освоено. Список пуст —
      // старый лист или не-воин: показываем как раньше, без пометок.
      const masteryKnown = mastered == null || (mastered.ids.size === 0 && mastered.names.size === 0);
      const isMastered =
        masteryKnown ||
        (i.entryId != null && mastered.ids.has(i.entryId)) ||
        mastered.names.has(i.name.trim().toLowerCase());
      const masteryText =
        i.weaponMastery && isMastered
          ? `Мастерство: ${i.weaponMastery}`
          : i.weaponMastery && !masteryKnown
            ? "Мастерство: не освоено"
            : "";
      const damage = [
        damageWithMod,
        i.weaponProperties,
        masteryText,
        upgraded || (monkWeapon && !finesse && !rangedOnly) ? "кость боевых искусств" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        name: i.name,
        bonus: formatModifier(mod + profBonus - exhaustionPenalty),
        damage,
        range,
        timing: "action" as const,
        entryId: i.entryId ?? null,
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
        damage: structured ? effectsLabel(s.effects ?? [], s.checks ?? []) : s.damage || s.healing || "—",
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
// classLevelOf — уровень класса-хозяина по sourceParentId (строка класса или
// подкласса): им резолвятся кубы levelDice (пушка +1к8 на 9-м). Без него —
// базовые кубы.
function featureActionRows(
  groups: DndFeature[][],
  spellAttackBonus: number,
  spellDc: number,
  classLevelOf?: (sourceParentId: number | null | undefined) => number | null,
  // СЛ сейвов не от заклинательной характеристики (Ошеломляющий удар — Муд):
  // без неё чистый монах видел СЛ 8 + 0 + БМ.
  dcExtra?: DcExtra
): AttackRow[] {
  return groups
    .flat()
    .filter((f) => !!f.castingTiming)
    .map((f) => ({
      name: f.name,
      bonus: checksLabel(f.checks ?? [], spellAttackBonus, spellDc, dcExtra),
      damage: effectsLabel(
        resolveLevelDice(f.effects ?? [], classLevelOf?.(f.sourceParentId) ?? null),
        f.checks ?? []
      ),
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
    .filter((i) => i.equipped && !i.transferOut && i.weaponDamage)
    .map((i) => {
      const type = i.weaponAttackMelee && i.weaponAttackRanged ? "Ближняя/дальняя атака" : i.weaponAttackRanged ? "Дальняя атака" : "Ближняя атака";
      const parts = [type, i.weaponDamage, i.weaponProperties, i.weaponMastery && `Мастерство: ${i.weaponMastery}`].filter(Boolean);
      return { name: i.name, description: parts.join(" · ") };
    });
}

/**
 * Закладки первой карты — до трёх строк «Действий», вынесенных на портрет.
 *
 * Пока игрок ничего не закрепил, лист предлагает сам: лучшее оружие и
 * атакующее заклинание высшего круга. Это ответ на вопрос «чем я обычно
 * бью», который за столом задают каждый ход, — и он не должен требовать
 * настройки: Мастер и игрок заняты игрой, а не листом. Как только игрок
 * закрепил хоть одну строку, показывается только его выбор.
 */
/**
 * Жетон спутника — ссылка на запись бестиария.
 *
 * Ссылка хранит и id, и имя: по id открывается статблок, а имя остаётся
 * читаемым, если запись переехала или компендиум не загрузился (правило
 * «глобальные ключи ссылок», гриллинг 2026-09-03). Портрет берётся из самой
 * записи — своего у спутника нет и не заводится.
 */
/**
 * Состояния персонажа — плашка на карте и выбор из компендиума системы.
 *
 * Список берётся из механик («Состояния»), а не из константы в коде:
 * состояния — часть системы, и у самодельной или импортированной системы
 * они свои. Пока список не загрузился (или его в системе нет), уже
 * проставленные состояния всё равно показываются: они хранятся именами.
 */
/**
 * Плашка живого ряда — состояния, концентрация, истощение.
 *
 * Кнопкой целиком, а не только числом внутри: за столом по ней попадают
 * пальцем не глядя, и подпись «КОНЦЕНТРАЦИЯ» — такая же часть мишени, как
 * значение. Вложить кнопку в кнопку нельзя, поэтому подпись и значение
 * здесь — простые span'ы.
 */
function LiveChip({
  label,
  value,
  active,
  title,
  ariaLabel,
  onClick,
  onUndo,
  undoLabel,
}: {
  label: string;
  value: ReactNode;
  active?: boolean;
  title?: string;
  ariaLabel: string;
  onClick?: () => void;
  /** Откат на шаг назад. Истощение ходит только вверх по кругу 0…6→0, и
   *  промах пальцем за столом стоил шести нажатий через «смерть», причём
   *  каждое — сохранение (аудит 09.09, В7). Кнопка появляется, только когда
   *  откатывать есть что: пустой орган управления на карте — шум (§1.11). */
  onUndo?: () => void;
  undoLabel?: string;
}) {
  const cls = `dnd-live-chip${active ? " is-on" : ""}`;
  const body = (
    <>
      <span className="sb-label">{label}</span>
      <span className="sb-value">{value}</span>
    </>
  );
  if (!onClick) {
    return (
      <div className={cls} title={title}>
        {body}
      </div>
    );
  }
  const main = (
    <button type="button" className={cls} title={title} aria-label={ariaLabel} aria-pressed={active} onClick={onClick}>
      {body}
    </button>
  );
  if (!onUndo) return main;
  return (
    <span className="dnd-live-chip-pair">
      {main}
      <button
        type="button"
        className="dnd-live-chip-undo"
        title={undoLabel}
        aria-label={undoLabel ?? "Шаг назад"}
        onClick={onUndo}
      >
        −
      </button>
    </span>
  );
}

// Морда тофу для спасбросков от смерти. Тот же слепок маскота, что у пипсов
// пулов (TofuPips): куб, контур, глаза — плюс рот, потому что здесь он и есть
// смысл. Цвета канонные, вне темы: дорожка обязана читаться и на портрете, и
// на бумаге. Отдельной графики не заводится.
function TofuFace({ mood }: { mood: "good" | "bad" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" className="dnd-tofu-body" />
      <circle cx="8.6" cy="10" r="2.1" className="dnd-tofu-eye" />
      <circle cx="15.4" cy="10" r="2.1" className="dnd-tofu-eye" />
      <path
        className="dnd-tofu-mouth"
        d={mood === "good" ? "M8.2 15.4c1.5 2 6.1 2 7.6 0" : "M8.2 17.6c1.5-2 6.1-2 7.6 0"}
      />
    </svg>
  );
}

// Спасброски от смерти — поверх портрета, крупно (решение владельца 09.09).
// Раньше дорожки жили только на карте «Ресурсы», а урон вводится с «Карты»:
// упавший на нуле игрок оказывался за шесть карт от того, чем этот ноль
// отыгрывается (аудит 09.09, В3).
//
// Лист считает, но ничего не решает: три успеха — «Стабилизирован» (оверлей
// сжимается в полоску и освобождает портрет), три провала — «Смерть» словом,
// без единой правки данных. Судьбу персонажа объявляет стол, а не приложение
// — тот же принцип, что у концентрации и мгновенной смерти.
//
// «Стабилизирован» хранится самими тремя успехами: отдельного поля в данных
// не заводится, иначе его пришлось бы гасить в каждом месте, где меняются
// хиты. Любое лечение с нуля обнуляет обе дорожки (см. applyHeal).
function DeathSaveOverlay({
  successes,
  failures,
  onQuickUpdate,
}: {
  successes: number;
  failures: number;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const stabilized = successes >= 3 && failures < 3;
  const dead = failures >= 3;
  function row(field: "deathSaveSuccesses" | "deathSaveFailures", filled: number, mood: "good" | "bad", label: string) {
    return (
      <div className="dnd-death-row" role="group" aria-label={label}>
        {[0, 1, 2].map((i) => {
          const on = i < filled;
          return (
            <button
              key={i}
              type="button"
              className={`dnd-death-cell${on ? " is-on" : ""}`}
              aria-pressed={on}
              aria-label={`${label}: ${i + 1} из 3`}
              disabled={!onQuickUpdate}
              // Повторный тап по крайней снимает — тот же приём, что у
              // PipTrack и TofuPips по всему листу: ошибочная отметка
              // откатывается одним движением, учиться нечему.
              onClick={onQuickUpdate ? () => onQuickUpdate({ [field]: i + 1 === filled ? i : i + 1 }) : undefined}
            >
              {on && <TofuFace mood={mood} />}
            </button>
          );
        })}
      </div>
    );
  }
  if (stabilized) {
    return (
      <div className="dnd-death-strip" role="status">
        <span className="sb-label">Стабилизирован</span>
        <button
          type="button"
          className="comp-mini"
          title="Вернуть дорожки спасбросков"
          disabled={!onQuickUpdate}
          onClick={onQuickUpdate ? () => onQuickUpdate({ deathSaveSuccesses: 2 }) : undefined}
        >
          Спасброски
        </button>
      </div>
    );
  }
  return (
    <div className="dnd-death-overlay" role="group" aria-label="Спасброски от смерти">
      <span className="dnd-death-title">{dead ? "Смерть" : "Спасброски от смерти"}</span>
      {row("deathSaveSuccesses", successes, "good", "Успехи")}
      {row("deathSaveFailures", failures, "bad", "Провалы")}
    </div>
  );
}

function ConditionsBox({
  conditions,
  systemId,
  onQuickUpdate,
}: {
  conditions: string[];
  systemId: number | null;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<DndMechanicsOption[]>([]);
  useEffect(() => {
    if (!open || !systemId) return;
    let alive = true;
    loadDndMechanicsGroup(systemId, "Состояния").then((v) => {
      if (alive) setOptions(v);
    });
    return () => {
      alive = false;
    };
  }, [open, systemId]);

  function toggle(name: string) {
    if (!onQuickUpdate) return;
    onQuickUpdate({
      conditions: conditions.includes(name)
        ? conditions.filter((c) => c !== name)
        : [...conditions, name],
    });
  }

  return (
    <>
      {/* Число, а не перечисление: три состояния подряд не влезают в плашку
          и рвут живой ряд на две строки. Какие именно — видно в окне,
          которое эта же плашка и открывает. */}
      <LiveChip
        label="Состояния"
        value={conditions.length > 0 ? conditions.length : "нет"}
        active={conditions.length > 0}
        ariaLabel="Состояния — изменить"
        onClick={onQuickUpdate ? () => setOpen(true) : undefined}
      />
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="stack" style={{ minWidth: 240 }}>
            <h3 style={{ margin: 0, fontFamily: "var(--font-display)", textTransform: "uppercase" }}>Состояния</h3>
            {options.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                В системе не нашлось раздела механик «Состояния».
              </p>
            )}
            <div className="stack" style={{ gap: 2 }}>
              {options.map((o) => (
                <label key={o.id} className="row" style={{ gap: 6, justifyContent: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={conditions.includes(o.name)}
                    onChange={() => toggle(o.name)}
                  />
                  {o.name}
                </label>
              ))}
              {/* Состояние, проставленное до того, как система обзавелась
                  списком, не должно пропасть из окна — иначе снять его будет
                  нечем. */}
              {conditions
                .filter((c) => !options.some((o) => o.name === c))
                .map((c) => (
                  <label key={c} className="row" style={{ gap: 6, justifyContent: "flex-start" }}>
                    <input type="checkbox" checked onChange={() => toggle(c)} />
                    {c}
                  </label>
                ))}
            </div>
            <button type="button" className="primary" onClick={() => setOpen(false)} style={{ alignSelf: "flex-end" }}>
              Готово
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function CompanionToken({
  companion,
  getEntry,
  onRemove,
}: {
  companion: DndCompanion;
  getEntry: (id: number | null | undefined) => CompendiumEntry | undefined;
  onRemove?: () => void;
}) {
  const entry = getEntry(companion.entryId);
  const avatar = entry?.avatar_image_url;
  const [open, setOpen] = useState(false);
  const body = (
    <>
      {/* Знак типа существа — бейджем поверх лица (полотно «Подвал
          спутников»). Лицо режет содержимое по кругу (overflow), поэтому
          бейдж — сосед лица, а не его потомок. Нет типа — нет бейджа. */}
      <span className="dnd-companion-portrait">
        <span className="dnd-companion-face">
          {avatar ? <img src={avatar} alt="" /> : <NavIcon name="skull" />}
        </span>
        <CreatureTypeBadge type={creatureTypeName(entry)} />
      </span>
      <span className="dnd-companion-name">{stripLatin(entry?.name || companion.name)}</span>
    </>
  );
  return (
    <span className="dnd-companion">
      {/* Окно со статблоком, а не переход в бестиарий: за столом спрашивают
          КЗ и хиты фамильяра посреди боя, и уход со страницы стоит потери
          места на листе — вернуться придётся заново и не туда. */}
      {companion.entryId ? (
        <button type="button" className="dnd-companion-link" onClick={() => setOpen(true)}>
          {body}
        </button>
      ) : (
        <span className="dnd-companion-link">{body}</span>
      )}
      {open && companion.entryId && (
        <EntityPreviewModal type="compendium_entry" id={companion.entryId} onClose={() => setOpen(false)} />
      )}
      {onRemove && (
        <button
          type="button"
          className="comp-mini dnd-companion-remove"
          title="Убрать спутника"
          aria-label={`Убрать спутника: ${companion.name}`}
          onClick={onRemove}
        >
          <NavIcon name="close" />
        </button>
      )}
    </span>
  );
}

// Тело спутника по чертежу (Фаза B): пушка и защитник Артефактора. Жетон
// отвечает «кто это», тело — «сколько хитов и что с ним»: пипсы хитов, КЗ,
// развеивание/возврат, Починка, детонация, укрытие. Максимум хитов и КЗ
// считаются из уровня класса и INT при каждом рендере — ап уровня сам
// поднимает тело; хранится только израсходованное (как у пулов ресурсов).
function CompanionBody({
  companion,
  blueprint,
  maxHp,
  ac,
  ownerFeatureName,
  ownsDetonate,
  ownsCover,
  previewEntryId,
  variants,
  activeVariant,
  onVariant,
  onPatch,
  onRemove,
}: {
  companion: DndCompanion;
  blueprint: CompanionBlueprint;
  maxHp: number;
  ac: number | null;
  /** Умение-хозяин — подсказка, где пересоздавать мёртвое тело. */
  ownerFeatureName: string;
  ownsDetonate: boolean;
  ownsCover: boolean;
  /** Запись для окна-превью по клику на имя (фича-чертёж или заклинание). */
  previewEntryId?: number | null;
  /** Виды тела из variants чертежа (звери Повелителя зверей). */
  variants?: string[];
  activeVariant?: string;
  onVariant?: (name: string) => void;
  onPatch: (patch: Partial<DndCompanion>) => void;
  onRemove: () => void;
}) {
  const [hurt, setHurt] = useState("");
  const [lastMend, setLastMend] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const used = Math.min(companion.hpUsed ?? 0, maxHp);
  const left = maxHp - used;
  // Знак типа и у тел по чертежу: тип берётся из самого чертежа
  // (`companion.type` записи компендиума). Не проставлен — знака нет.
  const typeBadge = <CreatureTypeBadge type={blueprint.type} size={17} />;
  const nameNode = previewEntryId ? (
    <>
      {typeBadge}
      <button type="button" className="dnd-spell-name-link" onClick={() => setPreviewOpen(true)}>
        {companion.name}
      </button>
      {previewOpen && (
        <EntityPreviewModal type="compendium_entry" id={previewEntryId} onClose={() => setPreviewOpen(false)} />
      )}
    </>
  ) : (
    <strong className="row" style={{ gap: 5, alignItems: "center" }}>
      {typeBadge}
      {companion.name}
    </strong>
  );
  if (companion.dead) {
    return (
      <div className="dnd-companion-body is-dead">
        <div className="row" style={{ justifyContent: "space-between" }}>
          {nameNode}
          <button type="button" className="comp-mini danger" onClick={onRemove} aria-label={`Убрать тело: ${companion.name}`}>
            <NavIcon name="close" />
          </button>
        </div>
        <span className="muted">Уничтожен — пересоздание через «{ownerFeatureName}».</span>
      </div>
    );
  }
  if (companion.dismissed) {
    return (
      <div className="dnd-companion-body is-dismissed">
        <div className="row" style={{ justifyContent: "space-between" }}>
          {nameNode}
          <button type="button" className="comp-mini danger" onClick={onRemove} aria-label={`Убрать тело: ${companion.name}`}>
            <NavIcon name="close" />
          </button>
        </div>
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <span className="muted">Развеян.</span>
          <button type="button" className="comp-mini" onClick={() => onPatch({ dismissed: false })}>
            Вернуть
          </button>
        </div>
      </div>
    );
  }
  const applyHurt = () => {
    const n = Math.floor(Number(hurt));
    if (!Number.isFinite(n) || n <= 0) return;
    const next = used + n;
    onPatch({ hpUsed: next, ...(next >= maxHp ? { dead: true } : {}) });
    setHurt("");
  };
  // Числовое лечение (починка защитника, отдых у костра и т.п.): пипсами
  // тридцать хитов не натыкать, а кнопки Починки есть только у пушки.
  const applyHeal = () => {
    const n = Math.floor(Number(hurt));
    if (!Number.isFinite(n) || n <= 0) return;
    onPatch({ hpUsed: Math.max(0, used - n) });
    setHurt("");
  };
  const mend = () => {
    if (!blueprint.mending) return;
    const rolled = rollDiceFormula(blueprint.mending) ?? 0;
    onPatch({ hpUsed: Math.max(0, used - rolled) });
    setLastMend(rolled);
  };
  return (
    <div className="dnd-companion-body">
      <div className="row" style={{ justifyContent: "space-between" }}>
        {nameNode}
        <span className="row" style={{ gap: 6, alignItems: "center" }}>
          {companion.spellEntryId != null && companion.spellLevel != null && (
            <span className="muted">круг {companion.spellLevel}</span>
          )}
          {ac != null && <span className="muted">КЗ {ac}</span>}
          <button type="button" className="comp-mini danger" onClick={onRemove} aria-label={`Убрать тело: ${companion.name}`}>
            <NavIcon name="close" />
          </button>
        </span>
      </div>
      <TofuPips
        max={maxHp}
        left={left}
        label={`${companion.name}: хиты`}
        onSetLeft={(next) => onPatch({ hpUsed: maxHp - next, ...(maxHp - next >= maxHp ? { dead: true } : {}) })}
      />
      <span className="dnd-pool-count">
        {left} из {maxHp}
      </span>
      {/* Виды тела (звери Повелителя зверей): смена вида — новое тело. */}
      {(variants ?? []).length > 1 && onVariant && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {(variants ?? []).map((v) => (
            <button
              key={v}
              type="button"
              className="comp-mini"
              disabled={v === activeVariant}
              title={v === activeVariant ? "Текущий вид" : `Сменить вид: ${v} (новое тело, полные хиты)`}
              aria-pressed={v === activeVariant}
              onClick={() => onVariant(v)}
            >
              {v}
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="number"
          value={hurt}
          onChange={(e) => setHurt(e.target.value)}
          placeholder="число"
          aria-label={`Урон или лечение: ${companion.name}`}
          style={{ width: 64 }}
        />
        <button type="button" className="comp-mini" onClick={applyHurt}>
          Ударить
        </button>
        <button type="button" className="comp-mini" onClick={applyHeal}>
          Вылечить
        </button>
        {blueprint.mending && (
          <button type="button" className="comp-mini" title={`Починка: ${blueprint.mending}`} onClick={mend}>
            Починка {blueprint.mending}
            {lastMend != null ? ` (${lastMend})` : ""}
          </button>
        )}
        {blueprint.dismissable && (
          <button type="button" className="comp-mini" onClick={() => onPatch({ dismissed: true })}>
            Развеять
          </button>
        )}
        {ownsDetonate && (
          <button
            type="button"
            className="comp-mini danger"
            title="Пушка уничтожается; спасбросок — строкой «Взрывная пушка» в Действиях"
            onClick={() => onPatch({ dead: true })}
          >
            Детонировать
          </button>
        )}
        <button type="button" className="comp-mini" onClick={() => onPatch({ dead: true })}>
          Мёртв
        </button>
      </div>
      {ownsCover && (
        <span className="muted">Укрытие на половину в радиусе 10 футов от пушки.</span>
      )}
      {blueprint.actions && blueprint.actions.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          {blueprint.actions.map((a, k) => (
            <span key={k} className="muted">
              {a.name && <strong>{a.name}. </strong>}
              {a.note}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Обман смерти («Душа творения», 20 ур.): на нуле хитов разрушить N созданных
// реплик указанных редкостей → хиты = hpPer × N. Редкость читается из записи
// схемы; какие именно разрушать — решает игрок, лист снимает старейшие
// (порядок массива = порядок создания). Кроме мгновенной смерти — на
// честности стола, лист её не объявляет (как и весь урон).
function SoulCheat({
  rarities,
  hpPer,
  items,
  getEntry,
  onCheat,
}: {
  rarities: string[];
  hpPer: number;
  items: DndReplicaItem[];
  getEntry: (id: number | null | undefined) => CompendiumEntry | undefined;
  onCheat: (count: number, destroyIds: string[]) => void;
}) {
  const [n, setN] = useState("1");
  const eligible = items.filter((it) => {
    const data = getEntry(it.schemeEntryId)?.data as { rarity?: unknown } | undefined;
    return typeof data?.rarity === "string" && rarities.includes(data.rarity);
  });
  if (eligible.length === 0) return null;
  const count = Math.min(Math.max(1, Math.floor(Number(n) || 1)), eligible.length);
  return (
    <div className="stack sb-death-saves" style={{ gap: 4 }}>
      <span className="muted">
        Обман смерти: разрушьте реплики ({eligible.length} подходят) — хиты станут {hpPer} за каждую.
        Кроме мгновенной смерти; разрушаются старейшие.
      </span>
      <div className="row" style={{ gap: 6, alignItems: "center" }}>
        <input
          type="number"
          value={n}
          min={1}
          max={eligible.length}
          onChange={(e) => setN(e.target.value)}
          style={{ width: 56 }}
          aria-label="Реплик разрушить"
        />
        <button
          type="button"
          className="comp-mini danger"
          onClick={() => {
            onCheat(count, eligible.slice(0, count).map((e) => e.id));
            setN("1");
          }}
        >
          Разрушить → {hpPer * count} хитов
        </button>
      </div>
    </div>
  );
}

// Эликсиры алхимика на руках (таблица 1к6 — в данных умения, elixirTable).
// За столом кубики кидают сами: бросок снаружи → ткнуть эффект в пикер;
// [🎲] — для тех, кто кидает приложухой (6 = «выбери сам», как в книге).
// Пул созданий живёт отдельно (тратится кнопками выше); здесь — что за
// эликсиры фактически на руках. На долгом отдыхе сгорают (чистит отдых).
function ElixirBox({
  table,
  elixirs,
  onChange,
}: {
  table: { key: string; name: string; short: string }[];
  elixirs: DndElixir[];
  onChange: (next: DndElixir[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const add = (effect: string) => {
    onChange([
      ...elixirs,
      { id: `elixir-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, effect },
    ]);
  };
  const roll = () => {
    const d = 1 + Math.floor(Math.random() * 6);
    if (d >= table.length) {
      // Последний ряд таблицы — «на выбор»: кубик его не даёт, открываем список.
      setPicking(true);
      return;
    }
    add(table[d - 1].key);
  };
  const nameOf = (effect: string) => table.find((t) => t.key === effect)?.name ?? effect;
  return (
    <div className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
      <strong>Эликсиры на руках ({elixirs.length})</strong>
      {elixirs.length === 0 && <span className="muted">Пусто — создайте на долгом отдыхе.</span>}
      {elixirs.map((e) => (
        <div key={e.id} className="row" style={{ gap: 6, alignItems: "center" }}>
          <span style={{ flex: "1 1 auto" }}>{nameOf(e.effect)}</span>
          <button
            type="button"
            className="comp-mini"
            title="Выпито или вылито — флакон исчезает"
            onClick={() => onChange(elixirs.filter((x) => x.id !== e.id))}
          >
            Выпито
          </button>
        </div>
      ))}
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="comp-mini" onClick={() => setPicking((v) => !v)}>
          {picking ? "Скрыть список" : "Выбрать эффект"}
        </button>
        <button type="button" className="comp-mini" title="Бросок 1к6 по таблице (6 — выбираете сами)" onClick={roll}>
          🎲 Случайный
        </button>
      </div>
      {picking && (
        <div className="stack" style={{ gap: 2 }}>
          {table.map((t) => (
            <button
              key={t.key}
              type="button"
              className="comp-mini"
              style={{ textAlign: "left", alignSelf: "stretch" }}
              title={t.short}
              onClick={() => {
                add(t.key);
                setPicking(false);
              }}
            >
              {t.name} <span className="muted">— {t.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function pickBookmarks(rows: AttackRow[], pinned: DndPinnedAction[] | undefined): AttackRow[] {
  if (pinned && pinned.length > 0) {
    // По имени, а не по id: у оружия и ручных атак записи компендиума нет
    // вовсе, а имя строки — то, что игрок видел, когда закреплял.
    return pinned
      .map((p) => rows.find((r) => r.name === p.name))
      .filter((r): r is AttackRow => !!r)
      .slice(0, 3);
  }
  // Числа, а не прочерки: строка «Сотворение заклинаний — — —» на карте
  // занимает место закладки и не отвечает ни на один вопрос за столом.
  const hasNumbers = (r: AttackRow) => {
    const num = (v: string) => !!v && v !== "—";
    return num(r.bonus) || num(r.damage);
  };
  const out: AttackRow[] = [];
  const weapon = rows.find((r) => !r.source && hasNumbers(r));
  if (weapon) out.push(weapon);
  const spells = rows.filter((r) => r.source?.kind === "spell" && hasNumbers(r));
  const topSpell = spells.reduce<AttackRow | null>((best, r) => {
    const level = r.source?.kind === "spell" ? r.source.level : 0;
    const bestLevel = best?.source?.kind === "spell" ? best.source.level : -1;
    return level > bestLevel ? r : best;
  }, null);
  if (topSpell) out.push(topSpell);
  // Третьей — первая же строка обычного действия, ещё не попавшая в список:
  // у персонажа без оружия и без магии закладки иначе пустуют совсем.
  const filler = rows.find((r) => r.timing === "action" && hasNumbers(r) && !out.includes(r));
  if (filler && out.length < 3) out.push(filler);
  return out;
}

function AttacksTable({
  title,
  rows,
  onOpen,
  pinnedNames,
  onPin,
  resourceLabels,
  color,
}: {
  title: string;
  rows: AttackRow[];
  /** Имена строк, вынесенных закладкой на первую карту. */
  pinnedNames?: string[];
  onPin?: (row: AttackRow) => void;
  // Строка со источником кликабельна: раньше вкладка показывала имя,
  // бонус и урон, а прочитать, что способность делает, было нельзя — только
  // уйти на другую вкладку и искать её там заново.
  onOpen?: (row: AttackRow) => void;
  /** Подписи пулов по resourceKey — для бейджей цен («−2 Очки чародейства»). */
  resourceLabels?: Record<string, string>;
  /** Цвет класса — кромка тратящих строк, единственная краска. */
  color?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="cs-list">
      <div className="dnd-section-title">{title}</div>
      <div className="stack dnd-action-cards" style={{ gap: 0 }}>
        {rows.map((r, i) => {
          // Строка, из-за которой всплывает лента пулов, подсвечена и несёт
          // цену прямо на себе (канвас Actions) — за столом видно, чем платишь,
          // не открывая окно.
          const cost = r.source?.kind === "feature" ? r.source.feature.cost : undefined;
          const poolKey = cost?.kind === "resource" ? (cost.resourceKey ?? null) : null;
          const spending = poolKey != null;
          const amount = cost?.amount && cost.amount > 0 ? cost.amount : 1;
          const badge =
            spending && poolKey
              ? `−${amount} ${resourceLabels?.[poolKey] ?? "ресурс"}`
              : null;
          // Вторая строка подписи: у заклинания — круг и дальность, у умения —
          // уже собранная цена («1 за долгий отдых»), у оружия — дальность.
          const meta =
            r.source?.kind === "spell"
              ? [`${r.source.level === 0 ? "Заговор" : `${r.source.level} круг`}`, r.range !== "—" ? r.range : ""]
                  .filter(Boolean)
                  .join(" · ")
              : r.range !== "—" && r.range !== ""
                ? r.range
                : "";
          const pinned = pinnedNames?.includes(r.name) ?? false;
          return (
            <div
              key={i}
              className={`dnd-action-card${spending ? " is-spending" : ""}`}
              style={spending && color ? { borderLeftColor: color } : undefined}
              role={r.source && onOpen ? "button" : undefined}
              tabIndex={r.source && onOpen ? 0 : undefined}
              aria-label={r.source && onOpen ? `${r.name} — открыть описание` : undefined}
              onClick={r.source && onOpen ? () => onOpen(r) : undefined}
              onKeyDown={
                r.source && onOpen
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(r);
                      }
                    }
                  : undefined
              }
            >
              <span className="dnd-action-main">
                <span className="dnd-action-name">
                  {/* Булавка выносит строку закладкой на первую карту. Мишень
                      своя: щелчок по строке открывает описание, и закрепление
                      по промаху было бы худшим из двух исходов. */}
                  {onPin && (
                    <button
                      type="button"
                      className={`comp-mini dnd-pin-toggle${pinned ? " is-on" : ""}`}
                      title={pinned ? "Убрать с карты" : "Вынести на карту"}
                      aria-pressed={pinned}
                      aria-label={`${r.name} — ${pinned ? "убрать с карты" : "вынести на карту"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPin(r);
                      }}
                    >
                      <NavIcon name="navPin" />
                    </button>
                  )}
                  {r.name}
                </span>
                {r.description !== undefined ? (
                  <span className="muted dnd-action-meta">
                    <MentionText text={r.description} />
                  </span>
                ) : (
                  meta && <span className="dnd-action-meta">{meta}</span>
                )}
              </span>
              {r.description === undefined && (
                <span className="dnd-action-nums">
                  <span className="dnd-action-bonus">{r.bonus}</span>
                  {r.damage && r.damage !== "—" && <span className="dnd-action-damage">{r.damage}</span>}
                </span>
              )}
              {badge && (
                <span
                  className="dnd-action-cost"
                  title={badge}
                  style={color ? { background: color, color: textOnClassColor(color) } : undefined}
                >
                  {badge}
                </span>
              )}
            </div>
          );
        })}
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
  systemId,
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
  /** Система — для списка инструментов (добавить владение). */
  systemId: number | null;
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
        systemId={systemId}
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
// Метка охотника и Сглаз: заявление столу с выбором «с тратой /
// перевесить». Механика та же у обоих: первое наложение тратит ресурс
// (у следопыта — использование Избранного врага, иначе ячейка; у Сглаза
// только ячейка), перевешивание на новую цель после смерти старой —
// бонусным действием без траты. Обе кнопки ставят концентрацию и шлют
// сигнал мастеру (напоминалка + живое событие), цель выбирает мастер.
const MARK_SPELLS = ["Метка охотника", "Сглаз"];

function SpendAction({
  row,
  value,
  slots,
  pact,
  resources,
  characterId,
  onQuickUpdate,
  onDone,
}: {
  row: AttackRow;
  value: DndCharacterData;
  slots: number[];
  /** Договор магии колдуна: отдельная дорожка, в slots её нет вовсе. */
  pact: { count: number; circle: number } | null;
  resources: DndResourceDef[];
  /** Id персонажа — для сигнала мастеру (метка/сглаз). Без него кнопок нет. */
  characterId?: number | null;
  onQuickUpdate: (patch: Partial<DndCharacterData>) => void;
  onDone: () => void;
}) {
  if (row.source?.kind === "spell") {
    const level = row.source.level;
    if (level === 0) return <span className="muted">Заговор — тратить нечего.</span>;
    // Арканум колдуна (тикет 03 warlock): ячейки нет, есть 1 использование
    // на долгий отдых — трек тот же (пипсы круга), подпись честная.
    const isArcanum = row.source.spell.arcanum === true;
    // Договор магии колдуна в slots не входит вовсе (своя дорожка, свой
    // счётчик, возврат коротким отдыхом). Для траты он равен ячейке круга
    // pact.circle: колдун всегда кастует своим кругом. У чистого колдуна
    // это единственный источник — без этой ветки лист говорил «свободных
    // ячеек нет» при полном треке договора.
    const pactUsed = value.pactSlotsUsed ?? 0;
    const pactFree = pact != null && pact.count > pactUsed && pact.circle >= level;
    // Ищем ближайший круг с непотраченной ячейкой, начиная со своего.
    let use = -1;
    for (let i = level - 1; i < slots.length; i++) {
      if ((slots[i] ?? 0) > (value.spellSlotsUsed[i] ?? 0)) {
        use = i;
        break;
      }
    }
    // Основная кнопка — самый дешёвый круг; при равном круге выигрывает
    // договор (возвращается коротким отдыхом, а обычная ячейка — долгим).
    const usePact = pactFree && (use < 0 || pact!.circle <= use + 1);
    if (use < 0 && !pactFree)
      return (
        <span className="muted">
          {isArcanum
            ? "Арканум уже использован — вернётся долгим отдыхом."
            : pact != null && pact.circle >= level && !slots.some((n, i) => i >= level - 1 && n > 0)
              ? // Чистый колдун: обычных ячеек у него нет вовсе, и говорить
                // про их круги бессмысленно — кончился именно договор. У
                // мультикласса ячейки есть, и там честнее общая формулировка.
                "Ячейки договора кончились — вернутся коротким отдыхом."
              : `Свободных ячеек ${level} круга и выше нет.`}
        </span>
      );
    // Вниз кастовать нельзя (только вверх), поэтому другие круги — тоже
    // от своего и выше. Основная кнопка — ближайший свободный (обычный
    // случай за столом), остальные — мелкими: выбор круга не должен стоить
    // второго окна. Усиление от высокого круга лист пока не считает —
    // см. «на будущее» в Charnik_dodelat.md.
    const spend = (circle: number) => {
      const next = value.spellSlotsUsed.slice();
      next[circle] = (next[circle] ?? 0) + 1;
      onQuickUpdate({ spellSlotsUsed: next });
      onDone();
    };
    const spendPact = () => {
      onQuickUpdate({ pactSlotsUsed: pactUsed + 1 });
      onDone();
    };
    const spendPrimary = () => (usePact ? spendPact() : spend(use));
    const others: number[] = [];
    for (let i = level - 1; i < slots.length; i++) {
      if ((usePact || i !== use) && (slots[i] ?? 0) > (value.spellSlotsUsed[i] ?? 0)) others.push(i);
    }
    // Договор во втором ряду — когда основной кнопкой стала обычная ячейка.
    const pactOther = pactFree && !usePact;
    // Сигнал мастеру о метке/сглазе (и «вешаю», и «перевешиваю»): стол
    // устный, а кнопка — фиксация. Тихо при офлайне: игра идёт словами.
    const notifyMark = (spell: string, mode: "spend" | "move") => {
      if (characterId == null) return;
      api
        .post(`/player/characters/${characterId}/mark`, { spell, mode })
        .catch(() => {
          /* офлайн — мастер услышал вслух */
        });
    };
    const markSpell =
      row.source.spell.name && MARK_SPELLS.includes(row.source.spell.name)
        ? row.source.spell.name
        : null;
    // Пул бесплатных использований — только у Метки (Избранный враг
    // следопыта): трата идёт из него, пока есть остаток, иначе — ячейка.
    const markPool =
      markSpell === "Метка охотника"
        ? resources.find((r) => r.label === "Избранный враг")
        : undefined;
    const markPoolLeft = markPool
      ? markPool.max + (value.resourceBonus[markPool.key] ?? 0) - (value.resourceUsed[markPool.key] ?? 0)
      : 0;
    const hangMark = (mode: "spend" | "move") => {
      if (!markSpell) return;
      if (mode === "spend") {
        if (markPool && markPoolLeft > 0) {
          onQuickUpdate({
            resourceUsed: { ...value.resourceUsed, [markPool.key]: (value.resourceUsed[markPool.key] ?? 0) + 1 },
            concentration: markSpell,
          });
        } else {
          spendPrimary();
          onQuickUpdate({ concentration: markSpell });
        }
      } else {
        onQuickUpdate({ concentration: markSpell });
      }
      notifyMark(markSpell, mode);
      // Окно закрывает spend() сам в ветке ячейки; в остальных — здесь.
      if (!(mode === "spend" && !(markPool && markPoolLeft > 0))) onDone();
    };
    return (
      <div className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
        <button
          type="button"
          className="primary"
          style={{ alignSelf: "flex-start" }}
          onClick={spendPrimary}
        >
          {isArcanum
            ? "Использовать арканум"
            : usePact
              ? `Потратить ячейку договора (${pact!.circle} круг)`
              : `Потратить ячейку ${use + 1} круга`}
        </button>
        {markSpell && characterId != null && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="comp-mini"
              title="Первое наложение: трата использования или ячейки, мастеру уйдёт уведомление"
              onClick={() => hangMark("spend")}
            >
              Вешаю{markPool && markPoolLeft > 0 ? " (из Избранного врага)" : ""} — заявить столу
            </button>
            <button
              type="button"
              className="comp-mini"
              title="Цель упала — переношу метку бонусным действием, без траты"
              onClick={() => hangMark("move")}
            >
              Перевесить — заявить столу
            </button>
          </div>
        )}
        {(others.length > 0 || pactOther) && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted">другой круг:</span>
            {others.map((i) => (
              <button key={i} type="button" className="comp-mini" onClick={() => spend(i)}>
                {i + 1}й
              </button>
            ))}
            {pactOther && (
              <button type="button" className="comp-mini" onClick={spendPact}>
                договор ({pact!.circle}й)
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  const feature = row.source?.kind === "feature" ? row.source.feature : undefined;
  const cost = feature?.cost;
  // Ключ пула: классовый — по resourceKey, свой — по записи умения
  // (featurePools). Третий путь — по названию: у классовых пулов в ключ
  // зашит id записи класса, и из справочника на них ссылаются названием
  // («Очки чародейства»). Дублироваться им не с чего: пул классовый.
  // Без флага uses остаётся текстом: механики нет.
  const poolKey =
    cost?.kind === "resource"
      ? (cost.resourceKey ?? null)
      : cost?.kind === "uses" && cost.ownResource && typeof feature?.entryId === "number"
        ? featurePoolKey(feature.entryId)
        : null;
  if (!cost) return null;
  const blocks: ReactNode[] = [];
  // 1) Трата из пула — как было. Кнопки может не быть (пул неизвестен или
  // пуст), а слотовая ниже — быть: источники независимы.
  const res =
    poolKey != null
      ? resources.find((r) => r.key === poolKey)
      : cost.kind === "resource" && cost.resourceLabel
        ? resources.find((r) => r.label.toLowerCase() === cost.resourceLabel!.toLowerCase())
        : undefined;
  // Состояние пула считаем один раз: нужно и кнопке траты, и возврату ячейки
  // (поглощение идёт в счёт пула 1/долгий — без заряда только плашка).
  const bonus = res ? (value.resourceBonus[res.key] ?? 0) : 0;
  const max = res ? res.max + bonus : 0;
  const used = res ? (value.resourceUsed[res.key] ?? 0) : 0;
  // uses-пул: amount — размер запаса («2 за долгий отдых»), а не цена нажатия.
  // Одно применение = один заряд (Врождённое чародейство и пр.). У resource
  // наоборот: amount — цена одного применения в очках (Бастион закона ×5).
  const amount = cost.kind === "uses" ? 1 : cost.amount && cost.amount > 0 ? cost.amount : 1;
  const poolDepleted = !!res && used + amount > max;
  if (res) {
    if (poolDepleted) {
      blocks.push(<span key="pool-empty" className="muted">«{res.label}» — не осталось.</span>);
    } else {
      blocks.push(
        <button
          key="pool"
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
  }
  // 2.5) Возврат потраченной ячейки (поглощение реплики). Круги, в которых
  // есть потраченные, — кнопками; пусто — плашкой. Редкость развеянного
  // (обычный→1, необычный/редкий→2) — на честности игрока: лист видит
  // только ячейки, а какой предмет развеян — выбирается руками в инвентаре.
  // Возврат идёт в счёт пула одним нажатием (лимит 1/долгий): без заряда
  // поглощать нечего, плашка «не осталось» уже показана веткой пула выше.
  if (cost.slotReturn && !poolDepleted) {
    const spent: number[] = [];
    for (let i = 0; i < slots.length; i++) {
      if ((value.spellSlotsUsed[i] ?? 0) > 0) spent.push(i);
    }
    if (spent.length === 0) {
      blocks.push(<span key="slotback-empty" className="muted">Потраченных ячеек нет.</span>);
    } else {
      const unspend = (circle: number) => {
        const next = value.spellSlotsUsed.slice();
        next[circle] = Math.max(0, (next[circle] ?? 0) - 1);
        onQuickUpdate({
          spellSlotsUsed: next,
          // Пул тоже тратим (если он есть): поглощение — одно действие целиком.
          ...(res ? { resourceUsed: { ...value.resourceUsed, [res.key]: used + amount } } : {}),
        });
        onDone();
      };
      blocks.push(
        <div key="slotback" className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
          <span className="muted">Вернуть ячейку (развейте предмет в инвентаре):</span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {spent.map((i) => (
              <button key={i} type="button" className="comp-mini" onClick={() => unspend(i)}>
                {i + 1}й круг
              </button>
            ))}
          </div>
        </div>
      );
    }
  }
  // 2) Активация тратой ячейки (пушка/эликсир/защитник: повторное создание
  // за слот). Круг не важен — берём самую дешёвую свободную, остальные
  // мелкими, тем же рядом, что у заклинаний.
  if (cost.slotSpend) {
    let first = -1;
    const rest: number[] = [];
    for (let i = 0; i < slots.length; i++) {
      if ((slots[i] ?? 0) > (value.spellSlotsUsed[i] ?? 0)) {
        if (first < 0) first = i;
        else rest.push(i);
      }
    }
    // Договор магии тут тоже годится: для умения важно, что ячейка есть, а
    // не какого она круга. Кнопкой он идёт последним — круг у него высокий.
    const pactUsed = value.pactSlotsUsed ?? 0;
    const pactFree = pact != null && pact.count > pactUsed;
    const spendPact = () => {
      onQuickUpdate({ pactSlotsUsed: pactUsed + 1 });
      onDone();
    };
    if (first < 0 && pactFree) {
      blocks.push(
        <button
          key="slot-pact"
          type="button"
          style={{ alignSelf: "flex-start" }}
          onClick={spendPact}
        >
          Потратить ячейку договора ({pact!.circle} круг)
        </button>
      );
    } else if (first < 0) {
      blocks.push(<span key="slot-empty" className="muted">Свободных ячеек нет.</span>);
    } else {
      const spendSlot = (circle: number) => {
        const next = value.spellSlotsUsed.slice();
        next[circle] = (next[circle] ?? 0) + 1;
        onQuickUpdate({ spellSlotsUsed: next });
        onDone();
      };
      blocks.push(
        <div key="slot" className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
          <button type="button" style={{ alignSelf: "flex-start" }} onClick={() => spendSlot(first)}>
            Потратить ячейку {first + 1} круга
          </button>
          {(rest.length > 0 || pactFree) && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="muted">другой круг:</span>
              {rest.map((i) => (
                <button key={i} type="button" className="comp-mini" onClick={() => spendSlot(i)}>
                  {i + 1}й
                </button>
              ))}
              {pactFree && (
                <button type="button" className="comp-mini" onClick={spendPact}>
                  договор ({pact!.circle}й)
                </button>
              )}
            </div>
          )}
        </div>
      );
    }
  }
  if (blocks.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
      {blocks}
    </div>
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
  unit: DndDistanceUnit,
  // Движение без доспехов монаха — прибавка к базе ходьбы. Ноль по умолчанию:
  // у существ и немонахов кости без бонуса, как было.
  bonus = 0
): { value: string; sub: string } {
  if (speeds.walk === null) return { value: "—", sub: "" };
  const penalty = Math.max(0, exhaustion) * 5;
  const reduced = Math.max(0, speeds.walk + Math.max(0, bonus) - penalty);
  const split = (feet: number) => {
    const text = formatDistance(feet, unit);
    const i = text.lastIndexOf(" ");
    return i < 0 ? { value: text, sub: "" } : { value: text.slice(0, i), sub: text.slice(i + 1) };
  };
  // Прежняя скорость зачёркнутым рядом больше не печатается: строка
  // появлялась и исчезала вместе с истощением и дёргала весь ряд. Насколько
  // отняли, говорит пометка над именем.
  return split(reduced);
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
  maxCircle,
  titleLine,
  color,
  onPick,
  onClose,
}: {
  systemId: number | null;
  /** Класс и подкласс персонажа: по их id и отбираются заклинания. */
  sources: { id: number; name: string }[];
  cantrips: DndSpellEntry[];
  spellsByLevel: DndSpellEntry[][];
  /** Старший доступный круг: выкладка по умолчанию — заговоры и круги не
      выше него («что обычно берут на этом уровне», этап 6). */
  maxCircle: number;
  /** «Имя · Класс N» в шапку (канвас SpellPicker). */
  titleLine: string;
  /** Цвет класса — заливка выбранных галочек и кнопки. */
  color: string;
  /** Пачка: отметить несколько и добавить разом, одним сохранением. */
  onPick: (items: { level: number; entry: CompendiumEntry }[]) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<CompendiumEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [myClass, setMyClass] = useState(true);
  const [myCircle, setMyCircle] = useState(true);
  const [circleSel, setCircleSel] = useState<number | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
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

  // Escape закрывает полноэкранный подборщик (крестик — для пальца).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sourceIds = new Set(sources.map((s) => s.id));
  // Уже в листе — по entryId: показывать «взять» у того, что уже взято,
  // значит собирать двойники руками пользователя.
  const owned = new Set(
    [...cantrips, ...spellsByLevel.flat()].map((s) => s.entryId).filter((id): id is number => typeof id === "number")
  );

  const classSpells = (all ?? []).filter((e) => {
    const refs = Array.isArray(e.data?.classes) ? (e.data.classes as { id?: number }[]) : [];
    return refs.some((r) => typeof r.id === "number" && sourceIds.has(r.id));
  });
  // Круги в чипах — только те, что есть у класса (пустых кнопок не надо).
  const presentCircles = [...new Set(classSpells.map((e) => e.level ?? 0))].sort((a, b) => a - b);

  const q = query.trim().toLowerCase();
  // Сначала фильтр класса (свой список), потом круга, поиск — последним:
  // пустое поле показывает выкладку, а не пустой экран. Конкретный круг
  // перекрывает «мой круг», «Все» сбрасывает оба ограничения.
  const base = myClass ? classSpells : (all ?? []);
  const matching = base.filter((e) => {
    const lvl = e.level ?? 0;
    if (q) return e.name.toLowerCase().includes(q);
    if (circleSel != null) return lvl === circleSel;
    if (myCircle) return lvl <= Math.max(0, maxCircle);
    return true;
  });
  const byLevel = new Map<number, CompendiumEntry[]>();
  for (const e of matching) {
    const lvl = e.level ?? 0;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(e);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Короткое действие для подписи строки (канвас: «действие», «реакция»).
  const actionWord = (e: CompendiumEntry): string | undefined => {
    const t = spellTimingFromData(e.data).castingTiming;
    if (t === "action") return "действие";
    if (t === "bonus") return "бонусное";
    if (t === "reaction") return "реакция";
    return undefined;
  };
  const spellMeta = (e: CompendiumEntry): string =>
    [
      spellSchoolName(e.data?.school),
      actionWord(e),
      typeof e.data?.range === "string" ? e.data.range : undefined,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="dnd-spell-picker" role="dialog" aria-modal="true" aria-label="Взять заклинания">
      <div className="dnd-spell-picker-head">
        <div className="dnd-spell-picker-title-row">
          <div>
            <div className="dnd-spell-picker-title">Взять заклинания</div>
            <div className="dnd-spell-picker-sub">
              {titleLine} · известно {owned.size} из {classSpells.length}
            </div>
          </div>
          <button type="button" className="dnd-spell-picker-close" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        <div className="dnd-spell-picker-search">
          <input
            placeholder="Искать, если уже знаете название"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Поиск заклинаний по названию"
          />
        </div>
        <div className="dnd-spell-picker-chips" role="group" aria-label="Фильтры">
          <button
            type="button"
            className={`dnd-pick-chip${myClass ? " is-on" : ""}`}
            aria-pressed={myClass}
            onClick={() => setMyClass((v) => !v)}
          >
            Мой класс
          </button>
          <button
            type="button"
            className={`dnd-pick-chip${myCircle && circleSel == null ? " is-on" : ""}`}
            aria-pressed={myCircle && circleSel == null}
            onClick={() => {
              setMyCircle((v) => !v);
              setCircleSel(null);
            }}
          >
            Мой круг
          </button>
          {presentCircles
            .filter((lvl) => lvl > 0)
            .map((lvl) => (
              <button
                key={lvl}
                type="button"
                className={`dnd-pick-chip${circleSel === lvl ? " is-on" : ""}`}
                aria-pressed={circleSel === lvl}
                onClick={() => setCircleSel((prev) => (prev === lvl ? null : lvl))}
              >
                {lvl} круг
              </button>
            ))}
          <button
            type="button"
            className={`dnd-pick-chip${!myClass && !myCircle && circleSel == null ? " is-on" : ""}`}
            aria-pressed={!myClass && !myCircle && circleSel == null}
            onClick={() => {
              setMyClass(false);
              setMyCircle(false);
              setCircleSel(null);
            }}
          >
            Все
          </button>
        </div>
      </div>
      <div className="dnd-spell-picker-list">
        {failed && <p className="muted">Не удалось загрузить справочник заклинаний.</p>}
        {!failed && all === null && <p className="muted">Загрузка…</p>}
        {all !== null && levels.length === 0 && (
          <p className="muted">
            {sources.length === 0 && myClass
              ? "Сначала выберите класс — список строится по нему."
              : "Ничего не нашлось: у класса нет заклинаний в справочнике либо не подходит поиск."}
          </p>
        )}
        {levels.map((lvl) => (
          <div key={lvl}>
            <div className="dnd-spell-picker-group">
              <span>{lvl === 0 ? "Заговоры" : `${lvl} круг`}</span>
            </div>
            {byLevel.get(lvl)!.map((e) => {
              const isOwned = owned.has(e.id);
              const isPicked = picked.has(e.id);
              // Круга ещё нет (выше ячеек): брать нельзя — готовить такое
              // заклинание правила запрещают. «Мой круг» их и так прячет;
              // запрет нужен режиму «Все», где их видно. Заговоры (0) — всегда.
              const overCircle = (e.level ?? 0) > maxCircle;
              const meta = spellMeta(e);
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`dnd-spell-pick-row${isPicked ? " is-picked" : ""}`}
                  disabled={isOwned || overCircle}
                  title={overCircle ? `Нужен ${e.level} круг — у вас пока ${maxCircle}` : undefined}
                  aria-pressed={isPicked}
                  onClick={() => toggle(e.id)}
                >
                  <span
                    className="dnd-pick-box"
                    style={isPicked ? { background: color, borderColor: color } : undefined}
                    aria-hidden="true"
                  >
                    {isPicked && (
                      <svg viewBox="0 0 18 18">
                        <path d="M3 9 L7 13 L15 4" fill="none" stroke="#e8e4da" strokeWidth="2.6" />
                      </svg>
                    )}
                  </span>
                  <span className="dnd-spell-pick-main">
                    <span className="dnd-spell-pick-name">{e.name}</span>
                    {meta && <span className="dnd-spell-pick-meta">{meta}</span>}
                  </span>
                  <span className="dnd-spell-pick-circle">{lvl === 0 ? "Заговор" : `${lvl} круг`}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="dnd-spell-picker-foot">
        <span className="muted dnd-spell-picker-count">
          Отмечено <strong>{picked.size}</strong>
        </span>
        <button type="button" className="comp-mini" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>
          Снять
        </button>
        <button
          type="button"
          className="primary"
          style={{ background: color, borderColor: color }}
          disabled={picked.size === 0}
          onClick={() => {
            const byId = new Map((all ?? []).map((e) => [e.id, e]));
            onPick(
              [...picked]
                .map((id) => byId.get(id))
                .filter((e): e is CompendiumEntry => !!e)
                .map((e) => ({ level: e.level ?? 0, entry: e }))
            );
          }}
        >
          Добавить{picked.size > 0 ? ` ${picked.size}` : ""}
        </button>
      </div>
    </div>
  );
}

/**
 * Пикер Таинственного арканума (тикет 03 warlock): отдельная модалка,
 * открывается кнопкой «Арканум» при уровне колдуна 11+. Четыре секции
 * 6/7/8/9: закрытые — серым «с N ур.», в открытой — текущий выбор и замена
 * на месте (1 в круге, только список колдуна). Удаления нет: по книге
 * арканум только заменяется.
 */
function DndArcanumPicker({
  systemId,
  warlockClassId,
  warlockLevel,
  spellsByLevel,
  color,
  onPick,
  onClose,
}: {
  systemId: number | null;
  warlockClassId: number | null;
  warlockLevel: number;
  spellsByLevel: DndSpellEntry[][];
  color: string;
  /** Замена арканума круга целиком; чужие строки круга не трогаем. */
  onPick: (circleIdx0: number, entry: CompendiumEntry) => void;
  onClose: () => void;
}) {
  const [pickCircle, setPickCircle] = useState<number | null>(null);
  const [all, setAll] = useState<CompendiumEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<number | null>(null);
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

  // Escape закрывает (крестик — для пальца), как у списка заклинаний.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pickCircle != null) setPickCircle(null);
        else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pickCircle]);

  const unlocked = arcanumUnlockedCircles(warlockLevel);
  const current = (circle: number) => spellsByLevel[circle - 1].find((s) => s.arcanum);
  const options =
    pickCircle == null || warlockClassId == null
      ? []
      : (all ?? []).filter((e) => {
          const refs = Array.isArray(e.data?.classes) ? (e.data.classes as { id?: number }[]) : [];
          return (e.level ?? 0) === pickCircle && refs.some((r) => r.id === warlockClassId);
        });
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((e) => e.name.toLowerCase().includes(q)) : options;
  const chosenEntry = chosen != null ? (all ?? []).find((e) => e.id === chosen) : undefined;

  return (
    <div className="dnd-spell-picker" role="dialog" aria-modal="true" aria-label="Таинственный арканум">
      <div className="dnd-spell-picker-head">
        <div className="dnd-spell-picker-title-row">
          <div>
            <div className="dnd-spell-picker-title">Таинственный арканум</div>
            <div className="dnd-spell-picker-sub">По одному заклинанию круга, 1/долгий отдых без ячейки</div>
          </div>
          <button type="button" className="dnd-spell-picker-close" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        {pickCircle != null && (
          <div className="dnd-spell-picker-search">
            <input
              placeholder="Искать, если уже знаете название"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Поиск заклинаний по названию"
            />
          </div>
        )}
      </div>
      {pickCircle == null ? (
        <div className="dnd-spell-picker-list">
          {ARCANUM_UNLOCKS.map(({ circle, warlockLevel: need }) => {
            const open = unlocked.includes(circle);
            const cur = current(circle);
            return (
              <div key={circle} className="row sb-entry" style={{ justifyContent: "space-between" }}>
                <span>
                  {circle} круг · {cur ? cur.name : <span className="muted">—</span>}
                </span>
                {open ? (
                  <button
                    type="button"
                    className="comp-mini"
                    onClick={() => {
                      setChosen(cur?.entryId ?? null);
                      setQuery("");
                      setPickCircle(circle);
                    }}
                  >
                    {cur ? "Заменить" : "Выбрать"}
                  </button>
                ) : (
                  <span className="muted">с {need} ур.</span>
                )}
              </div>
            );
          })}
          {warlockClassId == null && (
            <p className="muted">Класс без записи справочника — список колдуна не собрать.</p>
          )}
        </div>
      ) : (
        <>
          <div className="dnd-spell-picker-list">
            {failed && <p className="muted">Не удалось загрузить справочник заклинаний.</p>}
            {!failed && all === null && <p className="muted">Загрузка…</p>}
            {!failed && all !== null && shown.length === 0 && (
              <p className="muted">В списке колдуна нет заклинаний этого круга.</p>
            )}
            {shown.map((e) => (
              <button
                key={e.id}
                type="button"
                className={`dnd-spell-pick-row${chosen === e.id ? " is-picked" : ""}`}
                aria-pressed={chosen === e.id}
                onClick={() => setChosen((prev) => (prev === e.id ? null : e.id))}
              >
                <span
                  className="dnd-pick-box"
                  style={chosen === e.id ? { background: color, borderColor: color } : undefined}
                  aria-hidden="true"
                >
                  {chosen === e.id && (
                    <svg viewBox="0 0 18 18">
                      <path d="M3 9 L7 13 L15 4" fill="none" stroke="#e8e4da" strokeWidth="2.6" />
                    </svg>
                  )}
                </span>
                <span className="dnd-spell-pick-main">
                  <span className="dnd-spell-pick-name">{e.name}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="dnd-spell-picker-foot">
            <button type="button" className="comp-mini" onClick={() => setPickCircle(null)}>
              Назад
            </button>
            <button
              type="button"
              className="primary"
              style={{ background: color, borderColor: color }}
              disabled={chosenEntry == null}
              onClick={() => {
                if (chosenEntry) {
                  onPick(pickCircle - 1, chosenEntry);
                  setPickCircle(null);
                  setQuery("");
                }
              }}
            >
              Взять в арканум
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Подбор снаряжения пачкой (этап 6): та же механика, что у заклинаний, —
 * выкладка каталогом вместо пустого поля, поиск вторым эшелоном, отметить
 * несколько и добавить разом. Группы — по виду записи: магические предметы
 * отдельно от обычного снаряжения.
 */
function DndEquipmentPickerModal({
  systemId,
  ownedIds,
  onPick,
  onClose,
}: {
  systemId: number | null;
  ownedIds: ReadonlySet<number>;
  onPick: (entries: CompendiumEntry[]) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<CompendiumEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [failed, setFailed] = useState(false);
  // Фильтры пикера: тип, редкость, «требует настройки», сортировка.
  // До добавления видна характеристика строки.
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [rarityFilter, setRarityFilter] = useState<string>("any");
  const [attuneOnly, setAttuneOnly] = useState(false);
  const [sortMode, setSortMode] = useState<"name" | "ac" | "cost">("name");

  useEffect(() => {
    if (!systemId) {
      setAll([]);
      return;
    }
    let alive = true;
    loadDndEquipmentEntries(systemId)
      .then((rows) => {
        if (alive) setAll(rows);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [systemId]);

  const q = query.trim().toLowerCase();
  // Тип записи для фильтра: категория снаряжения или тип магпредмета,
  // оружие/броня — ещё и по полям урона/КЗ.
  function entryTypeKey(e: CompendiumEntry): string {
    const data = (e.data ?? {}) as Record<string, unknown>;
    const cat = typeof data.category === "string" ? data.category : "";
    const type = typeof data.item_type === "string" ? data.item_type : "";
    if (typeof data.damage === "string" && data.damage) return "Оружие";
    if (typeof data.armor_type === "string" && data.armor_type) return "Доспехи";
    if (/доспех|щит/i.test(`${cat} ${type}`)) return "Доспехи";
    if (/оружие/i.test(`${cat} ${type}`)) return "Оружие";
    if (/инструмент/i.test(cat)) return "Инструменты";
    if (cat === "Расходники" || isStackableEquipmentEntry(e)) return "Расходники";
    return type || cat || "Прочее";
  }
  // Характеристика записи до добавления: КЗ/урон/тип/редкость/цена.
  function entrySpecLine(e: CompendiumEntry): string {
    const data = (e.data ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const ac = str(data.ac);
    if (ac) parts.push(`КЗ ${ac}`);
    const dmg = str(data.damage);
    if (dmg) parts.push(dmg);
    const t = str(data.item_type) || str(data.category);
    if (t) parts.push(t);
    const rarity = str(data.rarity);
    if (rarity) parts.push(rarity);
    if (entryRequiresAttunement(data)) parts.push("настройка");
    const cost = str(data.cost);
    if (cost) parts.push(cost);
    return parts.join(" · ");
  }
  // Цена в медяки: «200 мм» дешевле «100 зм», голое число без единицы —
  // золотые (так пишет справочник). Раньше сравнивались голые числа.
  function costToCp(raw: unknown): number | null {
    const text = String(raw ?? "").toLowerCase().replace(",", ".");
    const re = /(\d+(?:\.\d+)?)\s*(мм|см|эм|зм|пм|cp|sp|ep|gp|pp|медн\w*|серебр\w*|электрум\w*|золот\w*|платин\w*)?/g;
    let total = 0;
    let found = false;
    for (let m; (m = re.exec(text)) !== null; ) {
      const n = parseFloat(m[1]);
      if (!Number.isFinite(n)) continue;
      const u = m[2] ?? "";
      const mult =
        u.startsWith("мм") || u.startsWith("медн") || u === "cp" ? 1
        : u.startsWith("см") || u.startsWith("серебр") || u === "sp" ? 10
        : u.startsWith("эм") || u.startsWith("электрум") || u === "ep" ? 50
        : u.startsWith("пм") || u.startsWith("платин") || u === "pp" ? 1000
        : 100;
      total += n * mult;
      found = true;
    }
    return found ? total : null;
  }
  function entrySortVal(e: CompendiumEntry): number {
    const data = (e.data ?? {}) as Record<string, unknown>;
    if (sortMode === "ac") {
      const m = /^[\d.,]+/.exec(String(data.ac ?? ""));
      return m ? -parseFloat(m[0].replace(",", ".")) : Number.POSITIVE_INFINITY;
    }
    const cp = costToCp(data.cost);
    return cp != null ? -cp : Number.POSITIVE_INFINITY;
  }
  const rarities = useMemo(() => {
    const set = new Set<string>();
    for (const e of all ?? []) {
      const r = (e.data as Record<string, unknown> | undefined)?.rarity;
      if (typeof r === "string" && r.trim()) set.add(r.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [all]);
  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of all ?? []) set.add(entryTypeKey(e));
    const preferred = ["Оружие", "Доспехи", "Инструменты", "Расходники", "Зелья", "Свитки", "Кольца", "Чудесные предметы"];
    const rest = [...set].filter((t) => !preferred.includes(t)).sort((a, b) => a.localeCompare(b, "ru"));
    return [...preferred.filter((t) => set.has(t)), ...rest];
  }, [all]);
  const matching = (all ?? [])
    // Поиск — по имени и по характеристике (тип, редкость, цена, КЗ/урон):
    // «кольчуга» находится и как «средний доспех», и как «необычный».
    .filter((e) => !q || e.name.toLowerCase().includes(q) || entrySpecLine(e).toLowerCase().includes(q))
    .filter((e) => typeFilter === "all" || entryTypeKey(e) === typeFilter)
    .filter((e) => {
      if (rarityFilter === "any") return true;
      const r = (e.data as Record<string, unknown> | undefined)?.rarity;
      return r === rarityFilter;
    })
    .filter((e) => !attuneOnly || entryRequiresAttunement((e.data ?? {}) as Record<string, unknown>))
    .sort((a, b) =>
      sortMode === "name" ? a.name.localeCompare(b.name, "ru") : entrySortVal(a) - entrySortVal(b) || a.name.localeCompare(b.name, "ru")
    );
  const groups = [
    { title: "Магические предметы", entries: matching.filter((e) => e.kind === "magic_item") },
    { title: "Снаряжение", entries: matching.filter((e) => e.kind !== "magic_item") },
  ].filter((g) => g.entries.length > 0);

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal wide onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Снаряжение из компендиума</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        <input
          placeholder="Поиск: название, тип, редкость, цена"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }} role="group" aria-label="Фильтр по типу">
          {["all", ...typeOptions].map((t) => (
            <button
              key={t}
              type="button"
              className={`dnd-chip${typeFilter === t ? " is-on" : ""}`}
              aria-pressed={typeFilter === t}
              onClick={() => setTypeFilter(t)}
            >
              {t === "all" ? "Все" : t}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
            Редкость:
            <select value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)} aria-label="Фильтр по редкости">
              <option value="any">любая</option>
              {rarities.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
            <input type="checkbox" checked={attuneOnly} onChange={(e) => setAttuneOnly(e.target.checked)} />
            требует настройки
          </label>
          <label className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
            Сорт:
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as "name" | "ac" | "cost")}
              aria-label="Сортировка"
            >
              <option value="name">по имени</option>
              <option value="ac">по КЗ</option>
              <option value="cost">по цене</option>
            </select>
          </label>
        </div>
        {failed && <p className="muted">Не удалось загрузить справочник снаряжения.</p>}
        {!failed && all === null && <p className="muted">Загрузка…</p>}
        {all !== null && groups.length === 0 && <p className="muted">Ничего не нашлось.</p>}
        {/* Список: только вертикальный скролл — панорама вбок мешала вести
            пальцем и список «плавал». */}
        <div className="stack picker-list" style={{ gap: 8, overflowX: "hidden", touchAction: "pan-y" }}>
          {groups.map((g) => (
            <div key={g.title} className="stack" style={{ gap: 4 }}>
              <div className="sb-prop-label">{g.title}</div>
              {g.entries.map((e) => {
                const isOwned = ownedIds.has(e.id);
                // Расходник берут повторно как +1 в ту же строку,
                // нерасходуемое — второй строкой: два одинаковых меча
                // для двуручки/партии больше не запрещены.
                const stackable = isStackableEquipmentEntry(e);
                const isPicked = picked.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={`dnd-picker-row${isPicked ? " is-picked" : ""}`}
                    aria-pressed={isPicked}
                    onClick={() => toggle(e.id)}
                  >
                    <span className="dnd-picker-check" aria-hidden="true">
                      {isPicked ? "●" : "○"}
                    </span>
                    <span style={{ flex: "1 1 auto", minWidth: 0, textAlign: "left" }}>
                      <span style={{ display: "block" }}>{e.name}</span>
                      {entrySpecLine(e) && (
                        <span style={{ display: "block", opacity: 0.7, fontSize: "var(--fs-meta)" }}>
                          {entrySpecLine(e)}
                        </span>
                      )}
                    </span>
                    {isOwned && (
                      <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                        {stackable ? "есть — будет +1" : "есть — второй строкой"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="row picker-footer" style={{ gap: 8 }}>
          <button
            type="button"
            className="primary"
            disabled={picked.size === 0}
            onClick={() => {
              const byId = new Map((all ?? []).map((e) => [e.id, e]));
              onPick([...picked].map((id) => byId.get(id)).filter((e): e is CompendiumEntry => !!e));
            }}
          >
            Добавить{picked.size > 0 ? ` (${picked.size})` : ""}
          </button>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
        </div>
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
      <summary className="dnd-section-title">{title}</summary>
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
  // КЗ собирает общий модуль: сборка «формула + защита без доспехов» была
  // здесь, в основном виде листа и в шпаргалках — тремя посимвольно
  // одинаковыми копиями.
  const computedAc = deriveSheet(value).armorClass.value;
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
// Щелчок открывает HpEditModal — и на телефоне, и на десктопе. Раньше
// десктоп правил два числа прямо в строке и модалку не открывал вовсе, а
// значит урон, лечение, временные хиты и временный максимум были доступны
// только с телефона: за ноутбуком их приходилось считать в уме и вписывать
// в «текущие» руками.
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
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <div style={{ flex: 1.2 }}>
      <div className="sb-label">Хиты</div>
      <SbQuickValue
        className="dnd-die-quick"
        onClick={onQuickUpdate ? () => setModalOpen(true) : undefined}
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
      {modalOpen && onQuickUpdate && (
        <HpEditModal value={value} onQuickUpdate={onQuickUpdate} onClose={() => setModalOpen(false)} />
      )}
    </div>
  );
}

const HP_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function HpBackspaceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M9 5h11v14H9L3 12z" />
      <path d="M13 9.5l5 5M18 9.5l-5 5" />
    </svg>
  );
}

// Порядок блоков отвечает частоте: за столом окно открывают, чтобы записать
// урон или лечение, а не чтобы поправить максимум — максимум меняет визард
// повышения уровня. Поэтому пад и две кнопки стоят в середине, а четыре поля
// живут под свёрткой.
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
  const [manualOpen, setManualOpen] = useState(false);
  // Свёртка открывается ниже видимой части окна: содержимое с четырьмя полями
  // выше 85vh, и без подтяжки нажатие выглядело так, будто ничего не
  // произошло.
  const fieldsRef = useRef<HTMLDivElement>(null);
  // Последнее применение — для отмены. Хранятся оба поля: урон сначала съедает
  // временные хиты, и откат, вернувший только текущие, потерял бы их.
  const [last, setLast] = useState<{ current: string; temp: string; text: string } | null>(null);
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

  useEffect(() => {
    if (manualOpen) fieldsRef.current?.scrollIntoView({ block: "nearest" });
  }, [manualOpen]);

  const curNum = Number(value.hitPointsCurrent) || 0;
  const maxNum = Number(value.hitPointMax) || 0;
  const tempNum = Number(value.hitPointsTemp) || 0;
  const atZero = maxNum > 0 && curNum <= 0;
  // Полоса: сплошное — текущие хиты, штриховка — временные, и штриховка стоит
  // справа намеренно. Урон снимает её первой, так что полоса заодно
  // показывает правило, а не просто заполняется.
  const barTotal = Math.max(1, maxNum + tempNum);
  const curPct = Math.max(0, Math.min(100, (curNum / barTotal) * 100));
  const tempPct = Math.max(0, Math.min(100 - curPct, (tempNum / barTotal) * 100));

  // Пад вместо клавиатуры: на телефоне системная клавиатура закрывала
  // половину окна, включая кнопки «Урон» и «Лечение», ради которых его и
  // открывали. Три цифры — потолок в 999, больше одним ударом не наносят.
  function pressKey(d: number) {
    setAmount((a) => {
      const next = (a + String(d)).replace(/^0+(?=\d)/, "");
      return next.length > 3 ? a : next;
    });
  }

  function applyDamage() {
    const n = Number(amount) || 0;
    if (n <= 0) return;
    const fromTemp = Math.min(n, Math.max(0, tempNum));
    const rest = n - fromTemp;
    // Хиты не уходят в минус: по правилам они останавливаются на нуле, а
    // «-7 хитов» на листе — это ещё и потерянный признак того, что персонаж
    // при смерти. Мгновенная смерть от превышения максимума за одно
    // попадание — решение стола, лист её не объявляет.
    const patch = {
      hitPointsTemp: String(tempNum - fromTemp),
      hitPointsCurrent: String(Math.max(0, curNum - rest)),
    };
    onQuickUpdate(patch);
    setDraft((d) => ({ ...d, ...patch }));
    setLast({
      current: value.hitPointsCurrent,
      temp: value.hitPointsTemp,
      text: `−${n} · ${curNum} → ${patch.hitPointsCurrent}`,
    });
    // Урон по концентрирующемуся требует спасброска Телосложения, СЛ 10 или
    // половина урона — что больше. Лист считает СЛ, но не решает за игрока:
    // спасбросок чаще проходит, чем нет, и снимать концентрацию самому было
    // бы враньём. Исключение — Неустанный охотник следопыта (13 ур.): урон не
    // прерывает концентрацию на Метке охотника, и СЛ тогда не показываем.
    const relentlessHunter = [...value.classFeatures, ...value.speciesFeatures, ...value.feats, ...value.specialAbilities].some(
      (f) => f.name === "Неустанный охотник"
    );
    const huntersMarkConc = /метка охотника/i.test(value.concentration ?? "");
    if (value.concentration && !(relentlessHunter && huntersMarkConc)) {
      setConcentrationDc(Math.max(10, Math.floor(n / 2)));
    }
    setAmount("");
  }
  function applyHeal() {
    const n = Number(amount) || 0;
    if (n <= 0) return;
    const cap = maxNum + (Number(value.hitPointMaxTemp) || 0);
    const healed = cap > 0 ? Math.min(curNum + n, cap) : curNum + n;
    // Любое лечение с нуля поднимает на ноги: накопленные спасброски от
    // смерти сбрасываются, иначе они переживут исцеление и убьют персонажа
    // в следующем бою.
    const revived = curNum <= 0 && healed > 0;
    onQuickUpdate({
      hitPointsCurrent: String(healed),
      ...(revived ? { deathSaveSuccesses: 0, deathSaveFailures: 0 } : {}),
    });
    setDraft((d) => ({ ...d, hitPointsCurrent: String(healed) }));
    setLast({
      current: value.hitPointsCurrent,
      temp: value.hitPointsTemp,
      text: `+${n} · ${curNum} → ${healed}`,
    });
    setConcentrationDc(null);
    setAmount("");
  }
  // Отмена возвращает ровно то, что было до применения. Спасброски от смерти,
  // сброшенные лечением с нуля, она не восстанавливает: их значение — итог
  // бросков за столом, и «вернуть как было» тут угадыванием не заменишь.
  function undoLast() {
    if (!last) return;
    onQuickUpdate({ hitPointsCurrent: last.current, hitPointsTemp: last.temp });
    setDraft((d) => ({ ...d, hitPointsCurrent: last.current, hitPointsTemp: last.temp }));
    setLast(null);
    setConcentrationDc(null);
  }

  return (
    <Modal onClose={onClose} ariaLabel="Хиты" autoFocus={false}>
      <div className="dnd-hp-modal">
        <div className="dnd-hp-plate">
          <span className="dnd-hp-plate-title">Хиты</span>
          <button type="button" className="dnd-hp-close" aria-label="Закрыть" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        <div className="dnd-hp-state">
          <div className="dnd-hp-readout">
            <span className={atZero ? "dnd-hp-cur is-down" : "dnd-hp-cur"}>{value.hitPointsCurrent || "—"}</span>
            <span className="dnd-hp-max">/ {value.hitPointMax || "—"}</span>
            {/* §1.11: блоку, которому нечего показать, показывать нечего. */}
            {tempNum > 0 && <span className="dnd-hp-temp-chip">+{tempNum} врем</span>}
          </div>
          <div className="dnd-hp-bar">
            <div className="dnd-hp-bar-cur" style={{ width: `${curPct}%` }} />
            <div className="dnd-hp-bar-temp" style={{ width: `${tempPct}%` }} />
          </div>
        </div>

        {last && (
          <div className="dnd-hp-undo">
            <span className="dnd-hp-undo-text">{last.text}</span>
            <button type="button" onClick={undoLast}>
              Отменить
            </button>
          </div>
        )}

        {concentrationDc !== null && value.concentration && (
          <div className="dnd-hp-conc">
            <div className="dnd-hp-conc-text">
              <span className="dnd-hp-caps">Концентрация</span>
              <br />«{value.concentration}» — спасбросок Телосложения, СЛ{" "}
              <span className="dnd-hp-conc-dc">{concentrationDc}</span>
            </div>
            {/* Две кнопки, а не одна: раньше лист предлагал только «Сорвалась»,
                и после удачного спасброска подсказка висела до закрытия окна. */}
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  onQuickUpdate({ concentration: "" });
                  setConcentrationDc(null);
                }}
              >
                Сорвалась
              </button>
              <button type="button" onClick={() => setConcentrationDc(null)}>
                Устояла
              </button>
            </div>
          </div>
        )}

        {atZero && (
          <div className="dnd-hp-down">
            Без сознания. Спасброски от смерти — на портрете. Любое лечение поднимает на ноги и сбрасывает их.
          </div>
        )}

        <div className="dnd-hp-apply">
          <div className="dnd-hp-amount">
            <span className="dnd-hp-caps">Сколько</span>
            <span className={amount === "" ? "dnd-hp-amount-value is-empty" : "dnd-hp-amount-value"}>
              {amount === "" ? "0" : amount}
            </span>
          </div>
          <div className="dnd-hp-pad">
            {HP_KEYS.map((d) => (
              <button type="button" key={d} className="dnd-hp-key" onClick={() => pressKey(d)}>
                {d}
              </button>
            ))}
            <button
              type="button"
              className="dnd-hp-key is-aux"
              aria-label="Стереть цифру"
              onClick={() => setAmount((a) => a.slice(0, -1))}
            >
              <HpBackspaceIcon />
            </button>
            <button type="button" className="dnd-hp-key" onClick={() => pressKey(0)}>
              0
            </button>
            <button type="button" className="dnd-hp-key is-aux is-word" onClick={() => setAmount("")}>
              Сброс
            </button>
          </div>
          <div className="dnd-hp-actions">
            <button type="button" className="danger" onClick={applyDamage} disabled={!Number(amount)}>
              Урон
            </button>
            <button type="button" className="primary" onClick={applyHeal} disabled={!Number(amount)}>
              Лечение
            </button>
          </div>
        </div>

        <button
          type="button"
          className={manualOpen ? "dnd-hp-manual is-open" : "dnd-hp-manual"}
          aria-expanded={manualOpen}
          onClick={() => setManualOpen((v) => !v)}
        >
          <span className="dnd-hp-caps">Поправить вручную</span>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d={manualOpen ? "M12 10L8 6l-4 4" : "M4 6l4 4 4-4"} />
          </svg>
        </button>

        {manualOpen && (
          <>
            <div className="dnd-hp-fields" ref={fieldsRef}>
              <label>
                <span className="dnd-hp-caps">Текущие</span>
                <input {...hpFieldProps("hitPointsCurrent")} />
              </label>
              <label>
                <span className="dnd-hp-caps">Максимум</span>
                <input {...hpFieldProps("hitPointMax")} />
              </label>
              <label>
                <span className="dnd-hp-caps">Временные</span>
                <input {...hpFieldProps("hitPointsTemp")} />
              </label>
              <label>
                <span className="dnd-hp-caps">Врем. максимум</span>
                <input {...hpFieldProps("hitPointMaxTemp")} />
              </label>
            </div>
            <p className="dnd-hp-hint">
              Максимум обычно меняет визард повышения уровня — здесь он на случай эффектов, которых лист не знает.
            </p>
          </>
        )}
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
  // Кнопка по центру: выше и уже обычного поля, клик по любой области
  // открывает правку (а не только по числу — мимо числа на телефоне
  // попадают чаще, чем в него).
  if (editing) {
    return (
      <div className="dnd-initiative-edit">
        <div className="sb-label">{label}</div>
        <input
          autoFocus
          style={{ width }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      className="dnd-initiative-btn dnd-tab-mid"
      aria-label={`${label} ${value || "—"} — изменить`}
      onClick={
        onQuickUpdate
          ? () => {
              setDraft(value);
              setEditing(true);
            }
          : undefined
      }
      disabled={!onQuickUpdate}
    >
      <span className="sb-label">{label}</span>
      <span className="dnd-initiative-value">{value || "—"}</span>
    </button>
  );
}

// КЗ is always computed (10/armor + Ловкость, capped per equipped armor,
// plus flat bonuses from equipped items, plus Защита без доспехов when its
// feature is on the sheet and no armor — and no shield for a monk — is worn)
// — the only thing a click here edits is the small manual bonus for effects
// not captured by inventory (Shield/Mage Armor spells, …), same click-to-edit
// shell as TextQuickBox.
function AcQuickBox({
  computed,
  manualBonus,
  hint,
  onQuickUpdate,
}: {
  computed: number;
  manualBonus: string;
  hint?: string | null;
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
      {hint && (
        <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          {hint}
        </div>
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
      className="comp-mini dnd-tab-edit-toggle dnd-tab-btn"
      title={editing ? "Сохранить" : "Редактировать"}
      aria-label={editing ? "Сохранить" : "Редактировать"}
      onClick={onToggle}
    >
      <NavIcon name={editing ? "check" : "edit"} />
    </button>
  );
}

// Подписанный карандаш для шапок вкладок: иконка + текст («Свойства»,
// «умения»). Тот же размер, что веер.
function LabeledEditButton({
  label,
  editing,
  onToggle,
}: {
  label: string;
  editing?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="dnd-chip dnd-edit-labeled"
      title={editing ? "Сохранить" : `Редактировать: ${label}`}
      onClick={onToggle}
    >
      <NavIcon name={editing ? "check" : "edit"} />
      {label}
    </button>
  );
}

// Кнопка веера: миниатюра колоды — 8 квадратиков (4 ряда по 2, по числу карт).
// Один размер со всеми инструментальными кнопками вкладок (dnd-tab-btn):
// предсказуемость важнее экономии пикселей.
function DndFanButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="dnd-tab-btn dnd-fan-btn" title="Колода карт" aria-label="Открыть колоду карт" onClick={onOpen}>
      <span className="dnd-fan-btn-grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} />
        ))}
      </span>
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
function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function DndReplicaBlock({
  limits,
  value,
  systemId,
  campaignId,
  ownerCharacterId,
  replicaBonus,
  onQuickUpdate,
}: {
  limits: ReplicaLimits;
  value: DndCharacterData;
  systemId: number | null;
  campaignId?: number | null;
  ownerCharacterId?: number | null;
  /** Бонус сверх таблицы (Лучший бронник) — строкой, не форсингом. */
  replicaBonus?: ReplicaBonus | null;
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
          id: makeEquipmentId(),
          name: bonus ? `${base.name} +${bonus}` : base.name,
          entryId: base.entryId,
          magical: true,
          magicBonus: bonus || undefined,
          notes: `реплика: ${scheme.name}`,
          replicaId: id,
        }
      : {
          ...EMPTY_EQUIPMENT_ITEM,
          id: makeEquipmentId(),
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
      {replicaBonus && (replicaBonus.schemes > 0 || replicaBonus.items > 0) && (
        <span className="muted">
          {[
            replicaBonus.schemes > 0
              ? `+${replicaBonus.schemes} ${pluralRu(replicaBonus.schemes, "схема", "схемы", "схем")}`
              : "",
            replicaBonus.items > 0
              ? `+${replicaBonus.items} ${pluralRu(replicaBonus.items, "предмет", "предмета", "предметов")}`
              : "",
            ...replicaBonus.notes,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}
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
          systemId={systemId}
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
        id: makeEquipmentId(),
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
/** Подходит ли предмет под общую строку («любой обычный…»). */
function genericMatches(g: ReplicaGeneric, e: CompendiumEntry): boolean {
  const d = e.data as { rarity?: unknown; item_type?: unknown; cursed?: unknown } | undefined;
  if (g.rarity && d?.rarity !== g.rarity) return false;
  if (g.types && g.types.length > 0 && !g.types.includes(String(d?.item_type ?? ""))) return false;
  if (g.excludeTypes && g.excludeTypes.includes(String(d?.item_type ?? ""))) return false;
  if (g.excludeCursed && d?.cursed === true) return false;
  return true;
}

function DndReplicaSchemePicker({
  limits,
  chosen,
  systemId,
  onChange,
  onClose,
}: {
  limits: ReplicaLimits;
  chosen: DndReplicaScheme[];
  systemId: number | null;
  onChange: (next: DndReplicaScheme[]) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Map<number, CompendiumEntry> | null>(null);
  const [query, setQuery] = useState("");
  // Раскрытый общий шаблон + кандидаты-предметы под него.
  const [genericOpen, setGenericOpen] = useState<string | null>(null);
  const [genericItems, setGenericItems] = useState<CompendiumEntry[] | null>(null);

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
    // Именные схемы — без genericId: выбор из общего шаблона того же предмета
    // считается отдельной схемой (по книге) и чекбоксом не снимается.
    const has = chosen.some((c) => c.entryId === entryId && (c.genericId ?? null) === null);
    onChange(
      has
        ? chosen.filter((c) => !(c.entryId === entryId && (c.genericId ?? null) === null))
        : [...chosen, { entryId, name, classId: limits.classId }]
    );
  }

  function openGeneric(g: ReplicaGeneric) {
    if (genericOpen === g.id) {
      setGenericOpen(null);
      return;
    }
    setGenericOpen(g.id);
    setGenericItems(null);
    if (!systemId) {
      setGenericItems([]);
      return;
    }
    loadDndEquipmentEntries(systemId)
      .then((all) => {
        setGenericItems(
          all
            .filter((e) => e.kind === "magic_item" && genericMatches(g, e))
            .sort((a, b) => a.name.localeCompare(b.name, "ru"))
        );
      })
      .catch(() => setGenericItems([]));
  }

  function addGeneric(g: ReplicaGeneric, entry: CompendiumEntry) {
    // Каждый выбор по общему шаблону — отдельная схема: дубли разрешены.
    onChange([...chosen, { entryId: entry.id, name: entry.name, classId: limits.classId, genericId: g.id }]);
  }

  function removeGenericPick(genericId: string, occurrence: number) {
    let seen = -1;
    onChange(
      chosen.filter((c) => {
        if ((c.genericId ?? null) !== genericId) return true;
        seen++;
        return seen !== occurrence;
      })
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
              checked={chosen.some((c) => c.entryId === scheme.entryId && (c.genericId ?? null) === null)}
              onChange={() => toggle(scheme.entryId, entry!.name)}
            />
            <span style={{ flex: "1 1 12ch", minWidth: 0 }}>{entry!.name}</span>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              с {scheme.minLevel} ур.
            </span>
          </label>
        ))}
        {limits.generics.length > 0 && (
          <>
            <h4 style={{ margin: "8px 0 0" }}>Общие схемы</h4>
            <p className="muted" style={{ margin: 0, fontSize: "var(--fs-meta)" }}>
              Любой подходящий предмет — отдельная схема за каждый выбор.
            </p>
            {limits.generics.map((g) => {
              const picked = chosen.filter((c) => (c.genericId ?? null) === g.id);
              const open = genericOpen === g.id;
              return (
                <div key={g.id} className="stack" style={{ gap: 4 }}>
                  <div className="row dnd-replica-row" style={{ justifyContent: "space-between" }}>
                    <span style={{ flex: "1 1 12ch", minWidth: 0 }}>
                      {g.label} <span className="muted">с {g.minLevel} ур.</span>
                    </span>
                    <button type="button" className="comp-mini" onClick={() => openGeneric(g)}>
                      {open ? "Скрыть" : `Выбрать (${picked.length})`}
                    </button>
                  </div>
                  {picked.map((p, k) => (
                    <div key={`${p.entryId}-${k}`} className="row" style={{ gap: 6, alignItems: "center" }}>
                      <span className="muted" style={{ flex: "1 1 12ch", minWidth: 0 }}>
                        ↳ {p.name}
                      </span>
                      <button
                        type="button"
                        className="comp-mini danger"
                        aria-label={`Убрать выбор: ${p.name}`}
                        onClick={() => removeGenericPick(g.id, k)}
                      >
                        <NavIcon name="close" />
                      </button>
                    </div>
                  ))}
                  {open && (
                    <div className="stack" style={{ gap: 2 }}>
                      {genericItems === null && <p className="muted">Загрузка…</p>}
                      {genericItems !== null && genericItems.length === 0 && (
                        <p className="muted">Ничего не подошло.</p>
                      )}
                      {genericItems !== null &&
                        genericItems
                          .filter((e) => !q || e.name.toLowerCase().includes(q))
                          .slice(0, 60)
                          .map((e) => (
                            <div key={e.id} className="row dnd-replica-row" style={{ justifyContent: "space-between" }}>
                              <span style={{ flex: "1 1 12ch", minWidth: 0 }}>{e.name}</span>
                              <button type="button" className="comp-mini" onClick={() => addGeneric(g, e)}>
                                ＋ схема
                              </button>
                            </div>
                          ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
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

/**
 * Лента пулов сверху «Действий» (этап 5, вид — по канвасу Actions): чёрная
 * плашка-инверсия. Пипсы — головы тофу (съеденные блеклые), «3 из 5»
 * читается как «осталось», это боевое число. Ячейки — текстом, трата
 * остаётся в окнах строк. Показывается только то, что тратит хоть одна
 * строка этой карты; пусто — компоненты нет вовсе.
 */
function DndActionPools({
  actionRows,
  resourceSources,
  abilities,
  resourceUsed,
  resourceBonus,
  shownSlotPips,
  spellSlotsUsed,
  pact,
  pactUsed,
  ownPools,
  onQuickUpdate,
}: {
  actionRows: AttackRow[];
  resourceSources: ClassResourceSource[];
  abilities: DndCharacterData["abilities"];
  resourceUsed: Record<string, number>;
  resourceBonus: Record<string, number>;
  shownSlotPips: number[];
  spellSlotsUsed: number[];
  pact: { count: number; circle: number } | null;
  pactUsed: number;
  /** Свои пулы умений — в ту же ленту, что классовые. */
  ownPools: DndResourceDef[];
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  // Боевые заклинания — строки-заклинания кругов ≥1. Заговоры ячеек не
  // тратят, и ради них ленту не поднимаем.
  const hasCombatSpells = actionRows.some((r) => r.source?.kind === "spell" && r.source.level > 0);
  // Пулы, задетые стоимостями строк. Ключ — тот же, по которому окно строки
  // ищет свой пул для кнопки «Потратить»: классовый по resourceKey, свой —
  // по записи умения.
  const spentKeys = new Set(
    actionRows.flatMap((r) => {
      if (r.source?.kind !== "feature") return [];
      const cost = r.source.feature.cost;
      if (cost?.kind === "resource" && cost.resourceKey) return [cost.resourceKey];
      if (cost?.kind === "uses" && cost.ownResource && typeof r.source.feature.entryId === "number") {
        return [featurePoolKey(r.source.feature.entryId)];
      }
      return [];
    })
  );
  const pools = [...allResources(resourceSources, abilities), ...ownPools].filter(
    (r) => spentKeys.has(r.key) && r.max + (resourceBonus[r.key] ?? 0) > 0
  );
  const slotLeft = shownSlotPips.map((max, i) => max - (spellSlotsUsed[i] ?? 0));
  const showSlots = hasCombatSpells && shownSlotPips.some((max) => max > 0);
  const showPact = hasCombatSpells && pact != null && pact.count > 0;
  // Класс подписываем только многоклассовым — как на «Ресурсах».
  const showClass = showClassSuffix(resourceSources);
  if (!showSlots && !showPact && pools.length === 0) return null;
  return (
    <div className="dnd-pool-band" role="status" aria-label="Остаток боевых ресурсов">
      {showSlots && (
        <span className="dnd-pool-slots">
          <span className="dnd-pool-band-label">Ячейки</span>{" "}
          {shownSlotPips.map((max, i) =>
            max > 0 ? (
              <span key={i} className="dnd-pool-slot">
                {i + 1}й ×{Math.max(0, slotLeft[i])}
              </span>
            ) : null
          )}
        </span>
      )}
      {showPact && pact != null && (
        <span className="dnd-pool-slots">
          <span className="dnd-pool-band-label">Договор</span>{" "}
          <span className="dnd-pool-slot">
            {pact.circle} круг ×{Math.max(0, pact.count - pactUsed)}
          </span>
        </span>
      )}
      {pools.map((r) => {
        const max = r.max + (resourceBonus[r.key] ?? 0);
        const used = Math.min(resourceUsed[r.key] ?? 0, max);
        const left = max - used;
        return (
          <span key={r.key} className="dnd-pool-resource">
            <span className="dnd-pool-band-label">
              {r.label}
              {showClass && <span className="dnd-pool-band-muted"> · {r.className}</span>}
            </span>
            <TofuPips
              max={max}
              left={left}
              label={r.label}
              onSetLeft={onQuickUpdate ? (next) => onQuickUpdate({ resourceUsed: { ...resourceUsed, [r.key]: max - next } }) : undefined}
            />
            <span className="dnd-pool-count">
              {left} из {max}
            </span>
            <span className="dnd-pool-band-muted">{PROGRESSION_RECHARGE_LABELS[r.recharge]}</span>
          </span>
        );
      })}
    </div>
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
  ownPools,
  replicaBonus,
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
  /** Свои пулы умений — теми же строками, что классовые. */
  ownPools: DndResourceDef[];
  /** Бонус к пределам реплик (Лучший бронник) — показом в блоке реплик. */
  replicaBonus?: ReplicaBonus | null;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const resources = [...allResources(sources, abilities), ...ownPools];
  const stats = applicableStats(sources);
  const replicas = replicaLimits(sources);
  if (resources.length === 0 && stats.length === 0 && replicas.length === 0)
    return <p className="muted">Нет доступных ресурсов для текущих классов.</p>;
  // Класс подписываем только у многоклассовых персонажей: у одноклассового
  // это шум, а «Проведение божественности» бывает и у Жреца, и у Паладина
  // сразу, и различить их иначе нечем. У своих пулов класса нет — суффикса нет.
  // Подкласс корнем не считается (showClassSuffix): иначе одноклассовый
  // Воин/Мастер боевых искусств выглядел бы многоклассовым.
  const showClass = showClassSuffix(sources);
  return (
    <div className="stack dnd-pools">
      {resources.map((r) => {
        const bonus = resourceBonus[r.key] ?? 0;
        const max = r.max + bonus;
        const used = Math.min(resourceUsed[r.key] ?? 0, max);
        return (
          <div key={r.key} className="sb-entry dnd-pool-row">
            <span className="sb-prop-label">
              {r.label}
              {showClass && r.className && <span className="muted"> · {r.className}</span>}
            </span>
            <label className="row muted dnd-pool-bonus" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
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
            <TofuPips
              max={max}
              left={max - used}
              label={r.label}
              onSetLeft={
                onQuickUpdate ? (next) => onQuickUpdate({ resourceUsed: { ...resourceUsed, [r.key]: max - next } }) : undefined
              }
            />
            {/* Восстановление чужой ценой («Крылья»: пополнить за 3 очка
                чародейства): одним сохранением обнуляет свой и списывает
                с донора. Видна, только когда есть что чинить и чем платить. */}
            {(() => {
              if (!r.restore || !onQuickUpdate || used <= 0) return null;
              const donor = resources.find(
                (d) => d.key !== r.key && d.label.toLowerCase() === r.restore!.pool.toLowerCase()
              );
              if (!donor) return null;
              const donorMax = donor.max + (resourceBonus[donor.key] ?? 0);
              const donorUsed = Math.min(resourceUsed[donor.key] ?? 0, donorMax);
              const price = r.restore.amount;
              if (donorMax - donorUsed < price) return null;
              return (
                <button
                  type="button"
                  className="comp-mini"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() =>
                    onQuickUpdate({
                      resourceUsed: { ...resourceUsed, [r.key]: 0, [donor.key]: donorUsed + price },
                    })
                  }
                >
                  Восстановить ({price} {donor.label})
                </button>
              );
            })()}
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
          replicaBonus={replicaBonus}
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
  companionsAfterRest,
  shortGrants,
  tireless,
  onQuickUpdate,
  onClose,
}: {
  value: DndCharacterData;
  resources: DndResourceDef[];
  pools: HitDicePool[];
  /** Тела спутников после долгого отдыха (пушки развеяны, защитник пересобран)
   *  — null, когда менять нечего. Считает родитель: модалке компендиум не виден. */
  companionsAfterRest?: DndCompanion[] | null;
  /** Гранты короткого отдыха чужим пулам («Проблеск +1») — считает родитель
   *  из живых особенностей; модалка только применяет. */
  shortGrants?: { key: string; label: string; amount: number | "full" }[];
  /** Неутомимый следопыта (10 ур.): короткий отдых снижает истощение на 1.
   *  Считает родитель из живых особенностей; модалка только применяет. */
  tireless?: boolean;
  onQuickUpdate: (patch: Partial<DndCharacterData>) => void;
  onClose: () => void;
}) {
  const [confirmDialog, confirm] = useConfirm();
  const shortNames = resources.filter((r) => r.recharge === "short").map((r) => r.label);
  const longNames = resources.filter((r) => r.recharge === "long").map((r) => r.label);
  const neverNames = resources.filter((r) => r.recharge === "none").map((r) => r.label);
  // Предметы с зарядами «на рассвете» и числовым максимумом — длинный отдых
  // вернёт их до максимума (см. longRest ниже).
  const restoredPreviewCharges = value.equipmentSections.some((sec) =>
    sec.items.some(
      (it) =>
        it.chargesRecharge === "dawn" &&
        !!it.chargesMax &&
        /^\d+$/.test(it.chargesMax.trim()) &&
        it.chargesLeft !== Number(it.chargesMax.trim())
    )
  );
  const spentDice = pools.reduce((n, p) => n + p.used, 0);
  const totalDice = pools.reduce((n, p) => n + p.total, 0);
  // Рационы: долгий отдых предлагает съесть один. Считаем только своё
  // (не отданное), строка без счёта — это 1 шт.
  const rationRows = value.equipmentSections.flatMap((s, si) =>
    s.items.map((it, ii) => ({ it, si, ii })).filter(({ it }) => !it.transferOut && isRationRow(it))
  );
  const rationTotal = rationRows.reduce((n, { it }) => n + parseQty(String(it.qty ?? "")), 0);
  const [eatRation, setEatRation] = useState(true);

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

  // Подписи грантов короткого отдыха: «Проблеск гениальности (+1)».
  // Только неполные пулы — полный обещать «восстановить» враньё.
  const grantLabels = (shortGrants ?? [])
    .filter((g) => (value.resourceUsed[g.key] ?? 0) > 0)
    .map((g) => `${g.label} (${g.amount === "full" ? "полностью" : `+${g.amount}`})`);
  async function shortRest() {
    // Неутомимый следопыта: каждый короткий отдых −1 истощение.
    const tirelessDrain = tireless && value.exhaustion > 0 ? 1 : 0;
    const ok = await confirm({
      title: "Короткий отдых?",
      message: [
        shortNames.length > 0
          ? `Восстановятся ячейки договора магии и ресурсы: ${shortNames.join(", ")}.`
          : "Восстановятся ячейки договора магии. Ресурсов короткого отдыха у этого персонажа нет.",
        ...(grantLabels.length > 0 ? [`Частично восстановятся: ${grantLabels.join(", ")}.`] : []),
        ...(tirelessDrain > 0 ? [`Истощение: ${value.exhaustion} → ${value.exhaustion - 1} (Неутомимый).`] : []),
        "Кости хитов тратятся вручную дорожкой в виталах: сколько потратили, столько и вылечили.",
      ].join("\n\n"),
      confirmLabel: "Отдохнуть",
    });
    if (!ok) return;
    const used = resetResources("short");
    for (const g of shortGrants ?? []) {
      const cur = used[g.key] ?? value.resourceUsed[g.key] ?? 0;
      used[g.key] = g.amount === "full" ? 0 : Math.max(0, cur - g.amount);
    }
    onQuickUpdate({
      pactSlotsUsed: 0,
      resourceUsed: used,
      ...(tirelessDrain > 0 ? { exhaustion: Math.max(0, value.exhaustion - 1) } : {}),
    });
    onClose();
  }

  async function longRest() {
    const back = pools.length > 0 ? Math.max(1, Math.floor(totalDice / 2)) : 0;
    // Заряды предметов «на рассвете» — до числового максимума из снапшота.
    // Кубический максимум и «не восстанавливаются» не трогаем.
    const restoredSections = value.equipmentSections.map((sec) => ({
      ...sec,
      items: sec.items.map((it) => {
        if (it.chargesRecharge !== "dawn" || !it.chargesMax || !/^\d+$/.test(it.chargesMax.trim())) return it;
        const max = Number(it.chargesMax.trim());
        return it.chargesLeft === max ? it : { ...it, chargesLeft: max };
      }),
    }));
    const restoredCharges = restoredSections
      .flatMap((s) => s.items)
      .filter((it) => it.chargesMax)
      .map((it) => it.name)
      .filter((n) => n);
    // Рацион списываем с первой непустой строки.
    const rationAt = eatRation ? rationRows.find(({ it }) => parseQty(String(it.qty ?? "")) > 0) : undefined;
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
        companionsAfterRest ? `

Тела спутников: временные исчезают (час пушки истёк), защитник собирается заново.` : "",
        (value.elixirs ?? []).length > 0 ? `

Эликсиры: старые сгорают вместе с флаконами — создайте новые.` : "",
        restoredCharges.length > 0 ? `

Заряды предметов восстановлены до максимума: ${restoredCharges.join(", ")}.` : "",
        rationAt ? `

Съеден рацион (−1).` : "",
        swapNotes.length > 0 ? `

Можно сменить: ${swapNotes.join("; ")}.` : "",
      ].join(""),
      confirmLabel: "Отдохнуть",
    });
    if (!ok) return;
    const finalSections = rationAt
      ? restoredSections.map((s, si) =>
          si !== rationAt.si
            ? s
            : {
                ...s,
                items: s.items.map((it, ii) =>
                  ii !== rationAt.ii ? it : { ...it, qty: String(Math.max(0, parseQty(String(it.qty ?? "")) - 1)) }
                ),
              }
        )
      : restoredSections;
    onQuickUpdate({
      spellSlotsUsed: value.spellSlotsUsed.map(() => 0),
      pactSlotsUsed: 0,
      resourceUsed: resetResources("long"),
      ...(companionsAfterRest ? { companions: companionsAfterRest } : {}),
      // Эликсиры сгорают вместе с флаконами — чистим, новые создаёт игрок.
      ...((value.elixirs ?? []).length > 0 ? { elixirs: [] } : {}),
      equipmentSections: finalSections,
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

  // Напоминания о сменах на долгом отдыхе (тикет 08): книга разрешает
  // сменить 1 освоенное оружие (Воин), оба оружейных приёма (Следопыт) и
  // язык полиглота (Баннерет). Показываем только тем, кого касается; сами
  // правки — руками.
  const hasMasteredWeapons = value.masteredWeapons.length > 0;
  const hasRangerMastery = value.classes.some((c) => nameMatches(c.className, "Следопыт"));
  const hasBanneret = value.classes.some(
    (c) => c.subclassName && nameMatches(c.subclassName, "Баннерет")
  );
  const swapNotes: string[] = [
    // Следопыт меняет оба приёма целиком, а не 1 оружие, как Воин.
    ...(hasRangerMastery
      ? ["можно сменить оружейные приёмы (правка — в особенностях)"]
      : hasMasteredWeapons
        ? ["можно сменить 1 освоенное оружие (правка — в особенностях)"]
        : []),
    ...(hasBanneret ? ["можно сменить язык полиглота (владения)"] : []),
  ];
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
            {grantLabels.length > 0 && ` Частично: ${grantLabels.join(", ")}.`}
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
            {restoredPreviewCharges ? ", заряды предметов" : ""}
            {pools.length > 0 ? `, вернёт половину костей хитов (${Math.max(1, Math.floor(totalDice / 2))})` : ""}.
            {companionsAfterRest && " Временные тела исчезнут, защитник соберётся заново."}
            {(value.elixirs ?? []).length > 0 && " Эликсиры сгорят."}
            {neverNames.length > 0 && ` Не восстановится: ${neverNames.join(", ")}.`}
            {swapNotes.length > 0 && ` Можно сменить: ${swapNotes.join("; ")}.`}
          </p>
          {rationTotal > 0 && (
            <label className="row" style={{ gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={eatRation} onChange={(e) => setEatRation(e.target.checked)} />
              Съесть рацион (−1, осталось: {rationTotal})
            </label>
          )}
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
  current,
  color,
  pendingItems,
  subtitle,
  details,
  onPick,
  onClose,
}: {
  current: DndViewTab;
  color: string;
  pendingItems: number;
  /** «Имя · класс уровень» в шапку (канвас DeckFan). */
  subtitle: string;
  /** Строки-счётчики миниатюр: каждая своей строкой, вместо декоративных
   *  глифов. Строит родитель — у него все данные листа под рукой. */
  details: Record<DndViewTab, string[]>;
  onPick: (tab: DndViewTab) => void;
  onClose: () => void;
}) {
  // Дабл-тап, открывший веер, кончается кликом по тому же пальцу — а веер
  // уже под ним, и клик уходил в первую попавшуюся миниатюру. Первые 600мс
  // жизни клики глотаются: это хвост открывающего жеста, а не выбор.
  const openedAt = useRef(Date.now());
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="dnd-deck-fan-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Колода карт"
      onClickCapture={(e) => {
        if (Date.now() - openedAt.current < 600) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="dnd-deck-fan-head">
        <div className="dnd-deck-fan-title-row">
          <span className="dnd-deck-fan-title">Колода</span>
          <span className="dnd-deck-fan-sub">{subtitle}</span>
          <button type="button" className="dnd-deck-fan-close" onClick={onClose} aria-label="Закрыть колоду">
            <NavIcon name="close" />
          </button>
        </div>
        <div className="dnd-deck-fan-hint">Дабл-тап по портрету развернул колоду · тап переносит</div>
      </div>
      <div className="dnd-deck-fan-grid">
        {DND_VIEW_TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`dnd-deck-fan-card${t === current ? " is-current" : ""}${t === "Ресурсы" ? " is-muted" : ""}`}
            style={
              t === current
                ? { background: color, borderColor: "#e8e4da" }
                : { borderLeftColor: color, borderRightColor: color }
            }
            onClick={() => {
              onPick(t);
              onClose();
            }}
          >
            <span className="dnd-deck-fan-name">
              {t}
              {t === "Снаряжение" && pendingItems > 0 && <span className="dnd-fan-dot" aria-label="есть непринятое" />}
            </span>
            <span className="dnd-deck-fan-rule" aria-hidden="true" />
            <span className="dnd-fan-lines">
              {details[t].length > 0 ? (
                details[t].map((line, i) => (
                  <span key={i} className="dnd-fan-line">
                    {line}
                  </span>
                ))
              ) : (
                <span className="dnd-fan-line is-dim">Пусто</span>
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="dnd-deck-fan-foot">
        <span className="dnd-deck-fan-grabber" aria-hidden="true" />
        <span className="dnd-deck-fan-hint">Тап по карте переносит</span>
      </div>
    </div>
  );
}

/**
 * Правка основной информации карты: имя, игрок, классы, вид, предыстория,
 * мировоззрение, система. Поля сохраняются мгновенно (тот же onQuickUpdate,
 * что у всего листа), поэтому кнопки «сохранить данные» здесь нет: внешний
 * «Сохранить» лишь закрывает панель. Одна на два входа — ?edit=1 и
 * десктопную раскрывашку в правой колонке, чтобы не разъехались.
 */
function DndOriginEditForm({
  origin,
  value,
  onQuickUpdate,
}: {
  origin: ReturnType<typeof useDndOrigin>;
  value: DndCharacterData;
  onQuickUpdate: (patch: Partial<DndCharacterData>) => void;
}) {
  // Собранным считается лист, у которого выбрана система И есть хоть один
  // источник из компендиума: дальше смена системы оборвёт ссылки. А листа,
  // у которого система не выбрана вовсе, замок не касается — выбрать её
  // впервые ничего оборвать не может, наоборот, чинит (было наоборот:
  // персонаж с классом, но без системы запирался навсегда).
  const systemKnown = origin.systems.some((sy) => sy.id === value.systemId);
  const hasCompendiumSources =
    value.raceId != null || value.backgroundId != null || value.classes.some((c) => c.classId != null);
  const isSystemLocked = value.systemId != null && systemKnown && hasCompendiumSources;
  return (
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
  );
}

export function DndCharacterView({
  value,
  portraitUrl,
  compact,
  onQuickUpdate,
  syncTabToUrl,
  campaignId,
  ownerCharacterId,
  onSheetBack,
  onPortraitRefresh,
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
  // Жест «назад» с первой карты (свайп вправо, решение владельца 2026-09-06):
  // уводит с полноэкранной страницы чарника обратно в профиль. Встроенному
  // листу возвращаться некуда — без пропса жест молчит.
  onSheetBack?: () => void;
  // Портрет протух (подпись URL живёт 60 секунд): перезагрузить персонажа,
  // чтобы приехал свежий avatar_image_url. Без пропса — просто плейсхолдер.
  onPortraitRefresh?: () => void;
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
  // Полоска карт шире экрана (на 390px — 474 против 362), а сама к активной
  // не подтягивалась: свайп на «Досье» или «Ресурсы» уводил подчёркнутый
  // язычок за кадр, и единственный индикатор «на какой я карте» пропадал
  // (аудит 09.09, В2). `inline: nearest` не дёргает полоску, когда язычок и
  // так виден; `block: nearest` не даёт утащить страницу по вертикали.
  const deckStripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const active = deckStripRef.current?.querySelector<HTMLElement>("button.active");
    active?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [tab]);
  // Живые данные компендиума для всех заклинаний и умений листа — одной
  // пачкой на весь лист, а не запросом на запись (см. entryCache.ts).
  const wantedIds = sheetEntryIds(value);
  const getEntry = useCompendiumEntries(wantedIds);
  // Мёртвые ссылки этого листа (этап 8): запросили пачкой, сервер промолчал —
  // запись снесли из компендиума уже после вписки. Кэш общий на сессию,
  // поэтому пересекаем с запрошенным именно этим листом.
  const deadIds = deadEntryIds().filter((id) => wantedIds.includes(id));
  const deadNames = deadIds.length > 0 ? deadLinkNames(value, new Set(deadIds)) : [];
  // Цвет класса — единственная краска на карте. Боковые кромки рамки,
  // подчёркивание текущей карты в полоске, заливка хитов. При мультиклассе
  // берётся класс с наибольшим уровнем (dndClassColors.ts).
  const cardColor = sheetClassColor(value.classes, getEntry);
  const [fanOpen, setFanOpen] = useState(false);
  // Модалка передачи из Снаряжения: то же меню, что оборот карты.
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  // Раскрывашка мёртвых ссылок (вид — канвас Actions): имена нужны для
  // починки, но не каждый раз.
  const [deadOpen, setDeadOpen] = useState(false);
  // Раскрывашка правки в десктопной правой колонке (под оборотом).
  const [rightEditOpen, setRightEditOpen] = useState(false);
  // Десктопный сплит (этап 7): лицевая карта всегда стоит слева в натуральную
  // величину, содержимое активной вкладки — справа. Тот же порог 700px, что
  // у useIsMobile и мобильной CSS. На телефоне лицевая видна только на своей
  // вкладке, как было.
  const showDesktopFace = !useIsMobile();
  // Оборот первой карты — входящие игрока (этап 4). Угол виден всегда:
  // серый без входящих, цвета класса при непрочитанных. Мастеру игроцкий
  // роут отвечает 404 — тогда оборот открывается с пояснением, а не
  // пустотой: угол одинаково доступен, содержимое только владельцу.
  // Загрузка ленивая: угол-индикатор нужен только на первой карте.
  const [cardFlipped, setCardFlipped] = useState(false);
  // Оракул класса: счётчик переворотов — по нему рубашка тянет новую цитату.
  // Десктоп-панель («Карта» без переворота) счётчик не трогает: цитата там
  // стоит, пока карту не перевернут на телефоне/мобильной вёрстке.
  const [flipCount, setFlipCount] = useState(0);
  const prevFlipped = useRef(cardFlipped);
  useEffect(() => {
    if (cardFlipped && !prevFlipped.current) setFlipCount((c) => c + 1);
    prevFlipped.current = cardFlipped;
  }, [cardFlipped]);
  // Пул оракула — из записи класса с наибольшим уровнем (то же правило, что
  // цвет карты выше). Пусто/нет записи — рубашка без листка.
  const oracleQuotes = (() => {
    let best: DndClassEntry | null = null;
    for (const c of value.classes) {
      if (!c.className?.trim()) continue;
      if (!best || (c.level || 0) > (best.level || 0)) best = c;
    }
    if (!best) return [];
    const raw = getEntry(best.classId)?.data.oracle_quotes;
    return Array.isArray(raw) ? raw.filter((q): q is string => typeof q === "string") : [];
  })();
  // Визард левелапа с оборота карты (игрок своего, мастер любого): модалка
  // живёт здесь же, применение — тем же мгновенным сохранением, что значения.
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [inbox, setInbox] = useState<CharacterInboxMessage[] | null>(null);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  // Сервер отказал (403 чужому токену, 404 не-владельцу): это Мастер смотрит
  // чужой лист, а не сломанная сеть. Показываем пояснение вместо ошибки —
  // содержимое входящих видит только владелец персонажа.
  const [inboxDenied, setInboxDenied] = useState(false);
  const [inboxNotice, setInboxNotice] = useState<string | null>(null);
  const [inboxBusyId, setInboxBusyId] = useState<number | null>(null);
  const [savedNoteIds, setSavedNoteIds] = useState<ReadonlySet<number>>(new Set());
  const [cornerGlint, setCornerGlint] = useState(false);
  const inboxTried = useRef(false);
  // Протухшая подпись URL портрета: скрываем битую картинку, один раз зовём
  // родителя за свежей ссылкой. Сбрасывается новым URL и сменой карты.
  const [portraitStale, setPortraitStale] = useState(false);
  const portraitRefreshCalled = useRef<string | null>(null);
  useEffect(() => {
    setPortraitStale(false);
  }, [portraitUrl, tab]);
  function handlePortraitError() {
    setPortraitStale(true);
    if (portraitRefreshCalled.current !== portraitUrl) {
      portraitRefreshCalled.current = portraitUrl ?? null;
      onPortraitRefresh?.();
    }
  }
  // Данные уже приезжали: следующие тики тихие, без скелетона и ошибок.
  const inboxReady = useRef(false);
  const canUseInbox = ownerCharacterId != null;
  const unreadInbox = (inbox ?? []).filter((m) => !m.read_at).length;
  // Передачи 4б живут рядом с входящими: тот же оборот, тот же угол (плюс
  // входящие офферы к непрочитанным), тот же опрос на открытом обороте.
  const [transfers, setTransfers] = useState<{ incoming: CharacterTransfer[]; outgoing: CharacterTransfer[] } | null>(null);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [transfersError, setTransfersError] = useState<string | null>(null);
  const [transferNotice, setTransferNotice] = useState<string | null>(null);
  const [transferBusyId, setTransferBusyId] = useState<number | null>(null);
  const transfersTried = useRef(false);
  const transfersReady = useRef(false);
  const incomingOffered = (transfers?.incoming ?? []).filter((t) => t.state === "offered").length;
  const unreadTotal = unreadInbox + incomingOffered;
  // Свайп между соседними картами (влево/вправо). Доминантная вертикаль
  // глотается молча: она принадлежит прокрутке, а веер колоды теперь
  // открывается долгим нажатием на портрет (см. ниже), не свайпом вниз.
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
    if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.5) return;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // Оборот — не карта колоды: свайпы на нём ничего не переключают.
    if (cardFlipped) return;
    const i = DND_VIEW_TABS.indexOf(tab);
    if (i === 0 && dx > 0) {
      // Первая карта, жест «назад» (свайп вправо свободен: левее первой карты
      // ничего нет). На остальных картах вправо — предыдущая карта, как было.
      if (onSheetBack) onSheetBack();
      return;
    }
    const next = dx < 0 ? i + 1 : i - 1;
    if (next >= 0 && next < DND_VIEW_TABS.length) setTab(DND_VIEW_TABS[next]);
  }
  // Веер колоды — двойной тап по портрету (решение владельца 2026-09-06).
  // Начинали с долгого нажатия, но оно не жилец: веер появляется под уже
  // лежащим пальцем, и touchend тут же нажимает кнопку под ним либо тянет
  // выделение текста из открывшегося меню. Дабл-тап свободен от этого —
  // палец к моменту открытия уже поднят. Картуш с именем исключён: дабл-тап
  // по тексту — выделение слова. iOS-зум по дабл-тапу гасится touch-action
  // в CSS (dnd-sheet.css). Окно 350мс и сдвиг до 30px — обычные значения.
  const lastPortraitTap = useRef<{ t: number; x: number; y: number } | null>(null);
  function onPortraitTouchEnd(e: React.TouchEvent) {
    const el = e.target as HTMLElement;
    // Картуш — текст (дабл-тап выделяет слово), спасброски — свои кнопки:
    // ни то, ни другое веер колоды открывать не должно.
    if (el.closest(".dnd-card-cartouche, .dnd-death-overlay, .dnd-death-strip")) {
      lastPortraitTap.current = null;
      return;
    }
    // Перетаскивание кадра — не тап: веер по окончании драга не открываем.
    if (frame.draggedRef.current) {
      frame.draggedRef.current = false;
      lastPortraitTap.current = null;
      return;
    }
    const t = e.changedTouches[0];
    const now = Date.now();
    const prev = lastPortraitTap.current;
    lastPortraitTap.current = { t: now, x: t.clientX, y: t.clientY };
    if (prev && now - prev.t < 350 && Math.hypot(t.clientX - prev.x, t.clientY - prev.y) < 30) {
      lastPortraitTap.current = null;
      setFanOpen(true);
    }
  }
  // Подгрузка входящих: один раз при первом показе лицевой стороны.
  // Ошибка (включая 404 для Мастера) гасит только оборот: лицевая карта
  // обязана работать и без входящих.
  const refreshInbox = useCallback(() => {
    if (ownerCharacterId == null) return;
    const id = ownerCharacterId;
    // Тихий тик не должен мигать «Загрузкой»: скелетон — только пока данных
    // нет вовсе, ошибка на фоне — тоже молча, старое лучше пустоты.
    if (!inboxReady.current) setInboxLoading(true);
    fetchCharacterInbox(id).then(
      (rows) => {
        inboxReady.current = true;
        setInbox(rows);
        setInboxError(null);
        setInboxDenied(false);
        setInboxLoading(false);
      },
      (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (/forbidden|not found|403|404/i.test(msg)) setInboxDenied(true);
        else if (!inboxReady.current) setInboxError(msg);
        setInboxLoading(false);
      }
    );
  }, [ownerCharacterId]);
  useEffect(() => {
    if (!canUseInbox || tab !== "Карта" || inbox !== null || inboxTried.current) return;
    inboxTried.current = true;
    refreshInbox();
  }, [canUseInbox, tab, inbox, refreshInbox]);
  const refreshTransfers = useCallback(() => {
    if (ownerCharacterId == null) return;
    const id = ownerCharacterId;
    if (!transfersReady.current) setTransfersLoading(true);
    fetchTransfers(id).then(
      (rows) => {
        transfersReady.current = true;
        setTransfers(rows);
        setTransfersError(null);
        setTransfersLoading(false);
      },
      (e) => {
        // Мастеру список недоступен, как и входящие: оборот объясняет, а не
        // сыплет ошибкой. Различать нечего — quiet null вместо шума.
        if (/forbidden|not found|403|404/i.test(e instanceof Error ? e.message : String(e))) {
          transfersReady.current = true;
          setTransfers({ incoming: [], outgoing: [] });
          setTransfersError(null);
        } else if (!transfersReady.current) {
          setTransfersError(e instanceof Error ? e.message : String(e));
        }
        setTransfersLoading(false);
      }
    );
  }, [ownerCharacterId]);
  useEffect(() => {
    if (!canUseInbox || tab !== "Карта" || transfers !== null || transfersTried.current) return;
    transfersTried.current = true;
    refreshTransfers();
  }, [canUseInbox, tab, transfers, refreshTransfers]);
  // Уход с первой карты возвращает оборот лицом: перевёрнутая карта,
  // оставшаяся за спиной у соседней, — это потерянный жест.
  useEffect(() => {
    setCardFlipped(false);
  }, [tab]);
  // Живой оборот: пока он открыт, список дотягивается каждые 10 секунд —
  // иначе послание, пришедшее в открытый оборот, видно только после
  // закрытия-открытия. Только на видимой вкладке и вне полёта собственной
  // правки (busy), чтобы тихий тик не перетирал строку под пальцем.
  // Передачи едут тем же тиком: оффер тоже должен приходить сам.
  useEffect(() => {
    if (!cardFlipped || tab !== "Карта") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || inboxBusyId != null || transferBusyId != null) return;
      refreshInbox();
      refreshTransfers();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [cardFlipped, tab, inboxBusyId, transferBusyId, refreshInbox, refreshTransfers]);
  // Действие по передаче: после успеха оба списка дотягиваются сразу, а не
  // следующим тиком — за столом десять секунд решают.
  async function handleTransferAction(id: number, action: "accept" | "decline" | "return" | "claim") {
    setTransferBusyId(id);
    setTransferNotice(null);
    try {
      await transferAction(id, action);
      refreshTransfers();
      refreshInbox();
    } catch (e) {
      setTransferNotice(`Не вышло: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTransferBusyId(null);
    }
  }
  async function handleTransferSend(args: { recipientId: number; itemId: string | null; section: number; index: number; name: string; qty: number; kind: "item" | "replica" }) {
    if (ownerCharacterId == null) return;
    setTransferBusyId(-1);
    setTransferNotice(null);
    try {
      await offerItemTransfer({ senderId: ownerCharacterId, ...args });
      refreshTransfers();
    } catch (e) {
      setTransferNotice(`Не отправилось: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTransferBusyId(null);
    }
  }
  async function handleMoneySend(args: { recipientId: number; coins: { cp: number; sp: number; ep: number; gp: number; pp: number } }) {
    if (ownerCharacterId == null) return;
    setTransferBusyId(-1);
    setTransferNotice(null);
    try {
      await offerMoneyTransfer({ senderId: ownerCharacterId, ...args });
      refreshTransfers();
      refreshInbox();
    } catch (e) {
      setTransferNotice(`Не отправилось: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTransferBusyId(null);
    }
  }
  // Оборот рисуется дважды (слева при перевороте, справа на десктопной
  // «Карте»), но никогда разом: условия исключают друг друга. Одна функция,
  // чтобы две копии не разъехались.
  function renderCardBack() {
    // Данные постера — снимком в момент нажатия (кнопки зовут колбэк).
    function cardPosterData(): PosterData {
      const classLine = value.classes.map((c) => `${c.className} ${c.level}`).join(" + ");
      return {
        name: value.characterName || "Без имени",
        subtitle: [classLine, value.raceName].filter(Boolean).join(" · "),
        hp: value.hitPointMax || "—",
        ac: value.armorClass || "—",
        pb: value.proficiencyBonus || "—",
        extra: value.speed.trim() ? { label: "СКОР", value: value.speed.trim() } : undefined,
        abilities: ABILITY_LABELS.map(({ key, label }) => ({ label, value: value.abilities[key] })),
        portraitSrc: portraitUrl ?? null,
        accent: cardColor,
      };
    }
    return (
      <DndCardBack
        characterName={value.characterName || "Без имени"}
        color={cardColor}
        messages={inbox ?? []}
        loading={inboxLoading}
        loadError={inboxError}
        denied={!canUseInbox || inboxDenied}
        notice={inboxNotice}
        busyId={inboxBusyId}
        savedIds={savedNoteIds}
        oracleQuotes={oracleQuotes}
        flipKey={flipCount}
        onRetry={refreshInbox}
        onRead={(id) => void handleInboxRead(id)}
        onSave={(id) => void handleInboxSave(id)}
        onClose={() => setCardFlipped(false)}
      >
        {/* Инструмент передач — только владельцу: Мастеру игроцкие роуты
            отвечают forbidden, и вместо формы он видел бы ошибку загрузки
            партии. Пояснение уже показывает оборот (denied). */}
        {canUseInbox && !inboxDenied && ownerCharacterId != null && (
          <DndTransferBox
            color={cardColor}
            campaignId={campaignId}
            characterId={ownerCharacterId}
            characterName={value.characterName}
            equipment={value.equipmentSections}
            ownCoins={value.coins}
            incoming={transfers?.incoming ?? []}
            outgoing={transfers?.outgoing ?? []}
            loading={transfersLoading}
            loadError={transfersError}
            notice={transferNotice}
            busyId={transferBusyId}
            onAction={(id, action) => void handleTransferAction(id, action)}
            onSendItem={(args) => void handleTransferSend(args)}
            onSendMoney={(args) => void handleMoneySend(args)}
            onCommitCoins={(c) => onQuickUpdate?.({ coins: c })}
            onCalcChanged={() => {
              refreshTransfers();
              refreshInbox();
            }}
            onRetry={refreshTransfers}
          />
        )}
        {/* Постер — снимок персонажа для чата партии. Левелап отсюда убран:
            вход в него — цифра уровня в картуше на лицевой стороне. Здесь он
            висел под отказом «оборот читает владелец персонажа», то есть
            мастеру предлагался ровно там, где ему только что отказали. */}
        <PosterButtons
          getData={cardPosterData}
          fileBase={value.characterName.trim() || "personazh"}
        />
      </DndCardBack>
    );
  }
  // Блик загнутого угла раз в 30 секунд, пока есть непрочитанное и вкладка
  // видна. При prefers-reduced-motion блика нет вовсе (спецификация карты).
  useEffect(() => {
    if (unreadTotal === 0) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setCornerGlint(true);
      window.setTimeout(() => setCornerGlint(false), 1200);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [unreadTotal]);
  // Пометка прочтения — действием адресата, оптимистично: список уже
  // отсортирован сервером, строка просто гаснет. Ошибка — строкой notice,
  // не молча: иначе «нажал — ничего» читается как прочитанное.
  async function handleInboxRead(id: number) {
    setInboxBusyId(id);
    setInboxNotice(null);
    try {
      const updated = await markInboxMessageRead(id);
      setInbox((prev) => prev?.map((m) => (m.id === id ? updated : m)) ?? prev);
    } catch (e) {
      setInboxNotice(`Не отметилось: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInboxBusyId(null);
    }
  }
  // Сохранение статьёй в путевые заметки персонажа. Повторный тап по той же
  // строке блокируется флагом savedNoteIds: серверного флага «сохранено»
  // нет, а дубль заметки — это мусор в дневнике.
  async function handleInboxSave(id: number) {
    const msg = inbox?.find((m) => m.id === id);
    if (!msg || campaignId == null || ownerCharacterId == null) return;
    setInboxBusyId(id);
    setInboxNotice(null);
    try {
      await saveInboxMessageAsNote({ campaignId, characterId: ownerCharacterId, message: msg.message });
      setSavedNoteIds((prev) => new Set(prev).add(id));
    } catch (e) {
      setInboxNotice(`Не сохранилось: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInboxBusyId(null);
    }
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
  // Уход с карты закрывает правку «Досье» и «Особенностей» — и **сохраняет**
  // набранное, а не выбрасывает. Черновики этих двух вкладок жили дольше
  // самой вкладки: вернувшись, попадаешь сразу в форму там, где ждал показ.
  // Просто обнулить их нельзя — они, в отличие от всего остального листа,
  // фиксируются не на каждое нажатие, а кнопкой, и сброс молча съел бы
  // набранный текст. Поэтому уход равен нажатию «готово»; «Отмена» остаётся
  // на самой вкладке.
  const prevTab = useRef(tab);
  useEffect(() => {
    if (prevTab.current === tab) return;
    prevTab.current = tab;
    if (draftFeatures) {
      onQuickUpdate?.(draftFeatures);
      setDraftFeatures(null);
    }
    if (draftDossier) {
      onQuickUpdate?.(draftDossier);
      setDraftDossier(null);
    }
  }, [tab, draftFeatures, draftDossier, onQuickUpdate]);
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

  const [editingActions, setEditingActions] = useState(false);
  // Подсветка строки, на которую увёл поиск, — для того, у чего нет карточки
  // (навык, свободно вписанный предмет, владение). Гаснет по следующему
  // касанию листа.
  const [highlight, setHighlight] = useState<string | null>(null);
  const [openAction, setOpenAction] = useState<AttackRow | null>(null);
  const [addingCompanion, setAddingCompanion] = useState(false);
  // Призыв заклинанием — двухшаговый: сначала «Призвать», потом круг ячейки
  // (мощь тела зависит от круга, а ритуал ячейки не тратит — форсить трату
  // выбором круга нельзя).
  const [summonSpell, setSummonSpell] = useState<number | null>(null);
  const [restOpen, setRestOpen] = useState(false);
  // Происхождение правится адресом ?edit=1 (карандаш на плашке чарника в
  // профиле): кнопки-карандаша в шапке больше нет (решение владельца
  // 2026-09-06). На самой карте органов правки нет — за столом лист читают.
  const [searchParams, setSearchParams] = useSearchParams();
  const editFromUrl = syncTabToUrl && searchParams.get("edit") === "1";
  function leaveEdit() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("edit");
      return next;
    });
  }
  // Кадрирование портрета перетаскиванием (этап 9): только в ?edit=1 — за
  // столом портрет не тянут, там жест принадлежит вееру и прокрутке.
  // Точка в долях, по умолчанию чуть выше центра: на портретах в полный
  // рост лицо сидит в верхней трети, и обрезка ровно по центру
  // промахивается по нему. Черновик в полёте, коммит по отпусканию.
  const frame = useFrameDrag(!!editFromUrl && !!onQuickUpdate, value.portraitFocus, (f) =>
    onQuickUpdate?.({ portraitFocus: f })
  );
  const canFrame = !!editFromUrl && !!onQuickUpdate;
  const portraitPosition = `${frame.shown.x * 100}% ${frame.shown.y * 100}%`;
  // Запасные таблицы подгружаются лениво и только когда без них не обойтись
  // (многоклассье без полного заклинателя) — обычному персонажу лишний
  // запрос ни к чему.
  const [fallbackProgressions, setFallbackProgressions] = useState<(ClassProgression | undefined)[]>([]);
  // Здесь, а не рядом с местом использования: ниже по функции стоит ранний
  // возврат для compact-вида, и хук за ним вызывался бы не в каждом рендере.
  const [spellListOpen, setSpellListOpen] = useState(false);
  const [arcanumOpen, setArcanumOpen] = useState(false);
  // Справочники грузятся только когда панель открыта — см. флаг в useDndOrigin.
  // Справочники нужны обеим панелям правки: происхождению — иерархия классов,
  // виды и предыстории, свойствам — типы урона и состояния. Грузим, когда
  // открыта любая из них, и не грузим, пока лист просто читают.
  const originEditing = editFromUrl;
  const origin = useDndOrigin(value, (v) => onQuickUpdate?.(v), originEditing || editingTraits);
  // Считается до раннего выхода: ниже стоят хуки, а компактная карточка
  // возвращается раньше.
  const slotSources = value.classes
    .filter((c) => c.classId != null && c.level > 0)
    .map((c) => ({
      classId: c.classId,
      level: c.level,
      progression: getEntry(c.classId)?.data.progression as ClassProgression | undefined,
      subProgression:
        c.subclassId != null
          ? (getEntry(c.subclassId)?.data.progression as ClassProgression | undefined)
          : undefined,
      roundUp: isRoundUpCaster(getEntry(c.classId)?.data as Record<string, unknown> | undefined),
    }));
  // Запасная таблица нужна ровно в одном случае: заклинательных классов
  // несколько и ни один из них не полный (Паладин + Следопыт). Тогда таблицу
  // многоклассья брать неоткуда, кроме как у полного заклинателя системы.
  const needsFallbackTable =
    slotSources.filter((s) => sourceCasterKind(s) !== "none").length > 1 &&
    !slotSources.some((s) => sourceCasterKind(s) === "full");
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
      // Классовая и подклассовая (Мистический рыцарь) таблицы складываются:
      // лимиты у подкласса свои, у класса их нет — дубля взяться неоткуда.
      for (const prog of [src.progression, src.subProgression]) {
        const c = cantripsAtLevel(prog, src.level);
        if (c != null) cantrips = (cantrips ?? 0) + c;
      }
      // Формульный лимит (Артефактор: мод + пол-уровня) главнее табличного:
      // статика колонки при нештатном INT врёт тихо. Характеристика берётся
      // из записи самого класса; не разобралась — откат к таблице, а не
      // пропавший лимит.
      const classData = (src.classId != null ? getEntry(src.classId)?.data : undefined) as
        | { prepared_formula?: unknown; spellcasting_ability?: unknown }
        | undefined;
      if (classPreparedFormula(classData as Record<string, unknown> | undefined)) {
        const key = parseAbilityNames(classData?.spellcasting_ability)[0];
        if (key) {
          prepared =
            (prepared ?? 0) +
            formulaPreparedLimit("mod_plus_half_level", src.level, abilityModifier(value.abilities[key]));
          continue;
        }
      }
      const p = preparedAtLevel(src.progression, src.level);
      if (p != null) prepared = (prepared ?? 0) + p;
      const subP = preparedAtLevel(src.subProgression, src.level);
      if (subP != null) prepared = (prepared ?? 0) + subP;
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
  // Плюс источники подклассов: их прогрессии (кости превосходства, кости
  // пси-энергии) читаются тем же кодом по уровню базового класса.
  const resourceSources: ClassResourceSource[] = value.classes.flatMap((c) => {
    const own: ClassResourceSource = {
      entry: c,
      progression: getEntry(c.classId)?.data.progression as ClassProgression | undefined,
      // Схемы реплик лежат у записи класса (решение R1) — сюда попадают,
      // потому что вкладка «Ресурсы» и есть место, где ими пользуются.
      replicateSchemes: (getEntry(c.classId)?.data.replicate_schemes as ReplicateScheme[] | undefined) ?? [],
      replicateGenerics: (getEntry(c.classId)?.data.replicate_generics as ReplicaGeneric[] | undefined) ?? [],
    };
    if (c.subclassId == null) return [own];
    const sub: ClassResourceSource = {
      entry: {
        classId: c.subclassId,
        className: c.subclassName || "Подкласс",
        subclassId: null,
        subclassName: "",
        level: c.level,
        skillChoiceOptions: [],
        skillChoiceCount: 0,
        spellcastingAbility: "",
      },
      progression: getEntry(c.subclassId)?.data.progression as ClassProgression | undefined,
      replicateSchemes: [],
      subOf: c.classId,
    };
    return [own, sub];
  });
  // Боевые искусства монаха: категория оружия — снимком инвентаря, а у старых
  // строк — живым резолвом по entryId (снимка тогда не было).
  const weaponCategoryOf = (entryId: number | null | undefined): string | undefined => {
    if (entryId == null) return undefined;
    const cat = getEntry(entryId)?.data.category;
    return typeof cat === "string" ? cat : undefined;
  };
  // Состояние целиком: активно ли умение, какая кость. Живой резолв — те же
  // записи, что карточка уже догрузила для таблиц развития и особенностей.
  const martial = resolveMartialArts(
    value.classFeatures,
    value.equipmentSections,
    resourceSources,
    weaponCategoryOf
  );
  const monkWeaponOf = (item: DndEquipmentItem) => isItemMonkWeapon(item, weaponCategoryOf);
  // Движение без доспехов — из той же таблицы развития, что и пулы.
  const moveBonus = unarmoredMovementBonus(resourceSources, value.equipmentSections);
  // Ручная правка выигрывает всегда: у самодельного класса таблицы может не
  // быть вовсе, и обнулять ему ячейки расчётом нельзя.
  const autoSlots = !value.spellSlotsManual && computedSlots.basis !== "none";
  const shownSlotPips = autoSlots ? computedSlots.slots : value.spellSlotPips;
  const shownSlotLevels = autoSlots
    ? Math.max(highestCircle(computedSlots.slots), value.spellSlotLevels)
    : value.spellSlotLevels;
  // Таинственный арканум (тикет 03 warlock): уровень КОЛДУНА (не суммарный),
  // пики — строки с меткой arcanum в кругах 6–9. Пипсы кругов с арканумом
  // выводятся из самих пиков (1 заклинание = 1 использование) поверх обычных
  // — тратятся и сбрасываются на долгом отдыхе общим механизмом.
  const warlockLevel = Math.max(
    0,
    ...value.classes.filter((c) => nameMatches(c.className, "Колдун")).map((c) => c.level)
  );
  const arcanumCount = arcanumCountByCircle(value.spellsByLevel);
  const magicPips = shownSlotPips.map((p, i) => (i >= 5 ? p + arcanumCount[i] : p));
  const arcanumTop = arcanumTopCircle(value.spellsByLevel);
  // Круги договора магии тоже разворачиваются: у чистого колдуна обычных
  // ячеек нет вовсе, и без этого раздел «Магия» не показывал бы ни одной
  // секции — заклинаниям негде было бы лежать.
  const magicLevels = Math.max(shownSlotLevels, arcanumTop, computedSlots.pact?.circle ?? 0);
  // Подпись «Арканум» — только кругам, где ВСЕ строки арканумные: у
  // мультикласса в 6–9 могут лежать и настоящие ячейки с обычными
  // заклинаниями, и путать их с арканумом нельзя.
  const arcanumTitles: Record<number, string> = {};
  for (let i = 5; i < 9; i += 1) {
    const rows = value.spellsByLevel[i];
    if (rows.length > 0 && rows.every((s) => s.arcanum)) arcanumTitles[i + 1] = `Арканум (${i + 1} круг)`;
  }
  const arcanumLocked = new Set(Object.keys(arcanumTitles).map(Number));
  const liveFeatureGroups = [
    value.classFeatures,
    value.speciesFeatures,
    value.feats,
    value.specialAbilities,
  ].map((g) => g.map((f) => resolveFeature(f, getEntry)));
  // Свои ресурсы умений (структурность): пулы из cost {uses, ownResource}
  // живых (разрешённых) особенностей. Дальше едут одним списком с
  // классовыми: трата, лента, «Ресурсы», сброс на отдыхе.
  // Уровень класса-хозяина умения (для levelSteps): вверх по родителям записи
  // до строки классов листа (фича → подкласс → класс). Чужие (виды, черты)
  // ни к чему не привяжутся — там откат к amount.
  const featureClassLevel = (entryId: number): number | null => {
    let cur: number | null | undefined = entryId;
    const seen = new Set<number>();
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      const hit = value.classes.find((c) => c.classId === cur || c.subclassId === cur);
      if (hit) return hit.level;
      cur = getEntry(cur)?.parent_id ?? null;
    }
    return null;
  };
  const ownPools = featurePools(liveFeatureGroups.flat(), value.abilities, featureClassLevel);
  // Тела спутников (Фаза B): чертежи из живых особенностей с data.companion.
  // Именами не ищем никого — чертёж привязан к записи фичи, лимит — к нему же.
  const entryParentId = (id: number | null | undefined) => getEntry(id)?.parent_id ?? null;
  const ownedFeatureNames = liveFeatureGroups.flat().map((f) => f.name);
  // Неутомимый следопыта (10 ур.) — модалке отдыха: короткий отдых снижает
  // истощение на 1. Именем, как и остальные именные проверки в этом файле.
  const tireless = liveFeatureGroups.flat().some((f) => f.name === "Неутомимость");
  const summonOptions = liveFeatureGroups
    .flat()
    .filter((f): f is DndFeature & { entryId: number } => typeof f.entryId === "number")
    .map((f) => ({
      feature: f,
      blueprint: blueprintFromEntryData(
        getEntry(f.entryId)?.data as Record<string, unknown> | undefined
      ),
    }))
    .filter(
      (o): o is { feature: DndFeature & { entryId: number }; blueprint: CompanionBlueprint } =>
        o.blueprint != null
    );
  const blueprintOfInstance = (c: DndCompanion) => {
    const id = c.featureEntryId ?? c.spellEntryId;
    return id != null
      ? blueprintFromEntryData(getEntry(id)?.data as Record<string, unknown> | undefined)
      : null;
  };
  // Призывы заклинаниями (data.summon): те же тела, хозяин — запись спелла.
  // Круг выбирается при призыве (мощь от круга, а ритуал ячейки не тратит),
  // поэтому кнопка двухшаговая через summonSpell, а не мгновенная.
  const spellSummonOptions = (() => {
    const seen = new Set<number>();
    const out: { spell: DndSpellEntry & { entryId: number }; blueprint: CompanionBlueprint }[] = [];
    for (const sp of [...liveCantrips, ...liveSpellsByLevel.flat()]) {
      if (typeof sp.entryId !== "number" || seen.has(sp.entryId)) continue;
      seen.add(sp.entryId);
      const withId = sp as DndSpellEntry & { entryId: number };
      const blueprint = blueprintFromEntryData(
        getEntry(withId.entryId)?.data as Record<string, unknown> | undefined
      );
      if (blueprint?.hp) out.push({ spell: withId, blueprint });
    }
    return out;
  })();
  const companionsRest = companionsAfterLongRest(value.companions, blueprintOfInstance);
  const allPools = [...allResources(resourceSources, value.abilities), ...ownPools];
  // Бонус к пределам реплик (Лучший бронник: +схема/+предмет только доспехи):
  // суммируем маркеры replicaBonus живых особенностей. Показ, не enforcement.
  const replicaBonus: ReplicaBonus | null = (() => {
    const out: ReplicaBonus = { schemes: 0, items: 0, notes: [] };
    for (const f of liveFeatureGroups.flat()) {
      if (typeof f.entryId !== "number") continue;
      const b = (
        getEntry(f.entryId)?.data as
          | { replicaBonus?: { schemes?: number; items?: number; note?: string } }
          | undefined
      )?.replicaBonus;
      if (!b) continue;
      out.schemes += b.schemes ?? 0;
      out.items += b.items ?? 0;
      if (b.note && !out.notes.includes(b.note)) out.notes.push(b.note);
    }
    return out.schemes > 0 || out.items > 0 ? out : null;
  })();
  // Гранты короткого отдыха чужим пулам (Отдохнувший гений, Магическое
  // наставление): собираются с живых особенностей, пул ищется названием
  // (прецедент: restore.pool). Модалке отдыха едут готовыми парами.
  const shortRestGrants = (() => {
    const out: { key: string; label: string; amount: number | "full" }[] = [];
    for (const f of liveFeatureGroups.flat()) {
      const g = f.cost?.shortRest;
      if (!g?.pool) continue;
      if (g.needsAttuned && !(value.attunementCount > 0)) continue;
      const pool = allPools.find((r) => r.label.toLowerCase() === g.pool.toLowerCase());
      if (!pool || out.some((o) => o.key === pool.key)) continue;
      out.push({ key: pool.key, label: pool.label, amount: g.amount ?? 1 });
    }
    return out;
  })();
  // Индекс поиска. Порядок групп особенностей здесь и в liveFeatureGroups
  // должен совпадать — подписи результата берутся по индексу группы.
  const searchHits = collectSheetHits(value, liveCantrips, liveSpellsByLevel, liveFeatureGroups);
  const spellAbilityKey = characterSpellcastingAbility(value.classes) ?? subclassSpellcastingAbility();
  function subclassSpellcastingAbility(): DndAbilityKey | null {
    // Заклинатель через подкласс (Мистический рыцарь — Интеллект): у строки
    // Воина своей характеристики нет, берём из записи подкласса. Динамически,
    // а не записью в строку — тогда работает и у старых персонажей, и у
    // пришедших визардом, без миграций строк.
    for (const c of value.classes) {
      if (c.spellcastingAbility) continue;
      const sub =
        c.subclassId != null ? getEntry(c.subclassId)?.data.spellcasting_ability : undefined;
      if (typeof sub === "string" && sub) {
        const key = ABILITY_NAME_TO_KEY[sub] ?? null;
        if (key) return key;
      }
    }
    return null;
  }
  // Производные числа листа считает общий модуль (@shared/dnd/derive): здесь
  // они были константами в теле компонента, вызвать их было нельзя, а бонус
  // мастерства читался из сохранённой строки — и устаревал молча при любой
  // правке класса или уровня.
  const derived = deriveSheet(value);
  const spellAbilityMod = spellAbilityKey ? abilityModifier(value.abilities[spellAbilityKey]) : 0;
  const spellProfBonus = derived.proficiencyBonus.value;
  const spellAttackBonus = derived.spellcasting
    ? derived.spellcasting.attackBonus.value
    : spellAbilityMod + spellProfBonus + parseBonus(value.spellAttackMisc) - value.exhaustion * 2;
  const spellDc = derived.spellcasting
    ? derived.spellcasting.saveDc.value
    : 8 + spellAbilityMod + spellProfBonus + parseBonus(value.spellDcMisc);
  const passivePerception = derived.passivePerception.value;
  // Картуш на портрете: то же, что в шапке листа, но своими строками и без
  // ссылок — на карте это подпись под именем, а не список источников.
  const totalLevel = value.classes.reduce((sum, c) => sum + (c.level || 0), 0);
  const classLine = value.classes
    .filter((c) => c.className)
    .map((c) => [stripLatin(c.className), stripLatin(c.subclassName)].filter(Boolean).join(" · "))
    .join(" / ");
  const originLine = [
    stripLatin(value.raceName),
    stripLatin(value.backgroundName),
    value.proficiencyBonus && `БМ ${value.proficiencyBonus}`,
  ]
    .filter(Boolean)
    .join(" · ");
  // Истощение видно на самом портрете: каждый уровень отнимает 17% цвета,
  // на шестом от лица остаётся чёрно-белое. Число в живом ряду называет
  // уровень, а карта показывает состояние — за столом на неё смотрят
  // урывками и цифру можно не заметить.
  const portraitDrain = `${Math.min(100, value.exhaustion * 17)}%`;
  const pools = hitDicePools(value.hitDice, value.hitDiceUsed);
  // 5.5: каждый уровень истощения — −2 к любому броску к20. Штраф уходит
  // в значения навыков, спасбросков, бонусы атак и пассивное восприятие, но
  // НЕ в КЗ и не в сложность заклинаний: это не броски к20.
  const exhaustionPenalty = value.exhaustion * 2;

  // Всё, что персонаж может применить, из всех источников сразу: оружие,
  // заклинания, умения классов, видов, черт и вручную вписанные атаки.
  // Считается здесь, а не на карте «Действия»: те же строки нужны закладкам
  // на первой карте, а собирать их дважды значит однажды разойтись.
  // Безоружный удар монаха — первой строкой: им бьют и вместо атаки, и Шквалом.
  const dexModForMartial = abilityModifier(value.abilities.dex);
  const unarmedRows =
    martial.active && martial.die
      ? [
          {
            name: "Безоружный удар",
            bonus: formatModifier(dexModForMartial + parseBonus(value.proficiencyBonus) - exhaustionPenalty),
            damage: `${martial.die}${dexModForMartial !== 0 ? ` ${formatModifier(dexModForMartial)}` : ""}`,
            range: "Ближний",
            timing: "action" as const,
            entryId: null,
          },
        ]
      : [];
  const actionRows = [
    ...unarmedRows,
    ...weaponAttackRows(
      value.equipmentSections,
      value.abilities,
      parseBonus(value.proficiencyBonus),
      exhaustionPenalty,
      martial.active && martial.die
        ? { die: martial.die, isMonkWeapon: monkWeaponOf }
        : null,
      value.masteredWeapons.length > 0
        ? {
            ids: new Set(
              value.masteredWeapons.map((w) => w.entryId).filter((id): id is number => typeof id === "number")
            ),
            names: new Set(value.masteredWeapons.map((w) => w.name.trim().toLowerCase()).filter(Boolean)),
          }
        : null
    ),
    ...combatSpellRows(liveCantrips, liveSpellsByLevel, spellAttackBonus, spellDc),
    // Уровень класса-хозяина для кубов levelDice: строка класса/подкласса
    // по sourceParentId особенности. Ручные (без sourceParentId) — без скейла.
    ...featureActionRows(liveFeatureGroups, spellAttackBonus, spellDc, (pid) => {
      if (pid == null) return null;
      const hit = value.classes.find((c) => c.classId === pid || c.subclassId === pid);
      return hit ? hit.level : null;
    },
    {
      abilities: value.abilities,
      profBonus: parseBonus(value.proficiencyBonus),
      misc: parseBonus(value.spellDcMisc),
    }),
    ...manualAttackRows(value.attacks),
  ];
  const pinnedNames = (value.pinnedActions ?? []).map((p) => p.name);
  const bookmarkRows = pickBookmarks(actionRows, value.pinnedActions);
  function togglePinned(row: AttackRow) {
    if (!onQuickUpdate) return;
    const current = value.pinnedActions ?? [];
    const already = current.some((p) => p.name === row.name);
    // Снятая последняя закладка возвращает лист к своему предложению — это
    // и есть «сброс», отдельной кнопки для него не нужно.
    if (already) {
      onQuickUpdate({ pinnedActions: current.filter((p) => p.name !== row.name) });
      return;
    }
    const entry: DndPinnedAction = {
      entryId: row.source?.kind === "spell" ? (row.source.spell.entryId ?? null) : null,
      name: row.name,
      kind: row.source?.kind === "spell" ? "spell" : row.source?.kind === "feature" ? "feature" : "weapon",
    };
    // Четвёртая вытесняет самую старую молча: диалог «какую убрать?» посреди
    // боя дороже, чем повторное нажатие.
    onQuickUpdate({ pinnedActions: [...current, entry].slice(-3) });
  }

  // И −5 футов скорости за уровень. Считается только от структурной ходьбы:
  // в свободном тексте («9 клеток, лазание 3») отнимать нечего, и он
  // остаётся примечанием под итогом. Движение без доспехов монаха — плюсом к
  // базе до штрафа: бонус — часть скорости, а не освобождение от истощения.
  const walkDie = walkDieParts(value.speeds, value.exhaustion, prefs.distanceUnit, moveBonus.bonus);
  // Остальные способы передвижения на кость не лезут и туда не нужны: кость
  // отвечает на вопрос «сколько я прохожу», а полёт и лазание есть не у всех
  // и спрашиваются реже. Они уходят подписью под рядом — вместе со старой
  // свободной строкой скорости, если она заполнена.
  const otherSpeeds = formatSpeed({ ...value.speeds, walk: null }, prefs.distanceUnit);
  // Свободная строка скорости печатается, только если добавляет что-то сверх
  // кости: «30 фт.» при walk = 30 — дубль, а не примечание. Проверка строгая
  // (голое число равно ходьбе), чтобы «полёт 60 фт.» и прочие не гасли.
  const legacySpeedNote = (() => {
    const text = (value.speed || "").trim();
    if (!text) return "";
    const num = /(\d+)/.exec(text);
    const hasKind = /пол[её]т|летит|плавани|плывёт|лазани|копани|рыть|ходьб|fly|swim|climb|burrow|walk/i.test(text);
    if (num && !hasKind && value.speeds.walk != null && Number(num[1]) === value.speeds.walk) return "";
    return text;
  })();
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
  // Защита без доспехов — плюсом поверх computeArmorClass (та же схема, что в
  // мини-карте выше): базовая формула про умение не знает.
  const unarmored = unarmoredDefenseBonus(
    value.classFeatures,
    value.classes,
    abilityModifier(value.abilities.wis),
    abilityModifier(value.abilities.con),
    value.equipmentSections
  );
  // Число берём из общего модуля; `unarmored` рядом остаётся ради подписи
  // «откуда прибавка» — это уже разметка, а не расчёт.
  const computedAc = derived.armorClass.value;
  // Подпись под костью КЗ — откуда прибавка, если защита без доспехов активна.
  const unarmoredHint = unarmored.source;
  return (
    <div className="sb-scope" onClickCapture={() => highlight && setHighlight(null)}>
      <div className="sb-card">
        {/* Шапки над картами нет нигде: на лицевой имя стоит в картуше, отдых —
            жетоном в углу карты, а правка уехала на плашку чарника в профиле
            (решение владельца 2026-09-06). Верх страницы — поиск, потом
            полоска карт. Отдых — жетоном с лицевой, происхождение правится
            адресом ?edit=1. */}
        {openAction?.source && (
          <DndCardModal
            title={openAction.name}
            spell={openAction.source.kind === "spell" ? openAction.source.spell : null}
            feature={openAction.source.kind === "feature" ? openAction.source.feature : null}
            getEntry={getEntry}
            onClose={() => setOpenAction(null)}
            extra={
              onQuickUpdate ? (
                <div className="stack" style={{ gap: 10, alignItems: "stretch" }}>
                  <SpendAction
                    row={openAction}
                    value={value}
                    slots={magicPips}
                    pact={computedSlots.pact}
                    resources={allPools}
                    characterId={ownerCharacterId}
                    onQuickUpdate={onQuickUpdate}
                    onDone={() => setOpenAction(null)}
                  />
                  {(() => {
                    // Коробка эликсиров — только у умения с таблицей (алхимик):
                    // что за эффекты на руках после бросков/выбора.
                    const f =
                      openAction.source.kind === "feature" ? openAction.source.feature : null;
                    const table =
                      f?.entryId != null
                        ? (
                            getEntry(f.entryId)?.data as
                              | { elixirTable?: { key: string; name: string; short: string }[] }
                              | undefined
                          )?.elixirTable
                        : null;
                    if (!table || table.length === 0) return null;
                    return (
                      <ElixirBox
                        table={table}
                        elixirs={value.elixirs ?? []}
                        onChange={(elixirs) => onQuickUpdate({ elixirs })}
                      />
                    );
                  })()}
                </div>
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
            maxCircle={shownSlotLevels}
            titleLine={`${value.characterName || "Без имени"} · ${stripLatin(
              value.classes.find((c) => c.className)?.className ?? "Без класса"
            )} ${totalLevel}`}
            color={cardColor}
            onPick={(items) => {
              if (!onQuickUpdate || items.length === 0) return;
              // Берутся неподготовленными: взять в книгу и подготовить на день
              // — разные действия, и приложение не вправе решать второе за
              // игрока. Снапшот не пишем — его подставит resolveSpell из
              // кэша справочника, как и у заклинаний, добавленных поиском.
              // Пачка уходит одним сохранением, а не N подряд.
              const make = (entry: CompendiumEntry): DndSpellEntry => ({
                entryId: entry.id,
                name: entry.name,
                prepared: 0,
              });
              const newCantrips = items.filter((i) => i.level <= 0).map((i) => make(i.entry));
              const topLevel = Math.max(0, ...items.map((i) => i.level));
              const next = value.spellsByLevel.map((lvl, i) => [
                ...lvl,
                ...items.filter((it) => it.level === i + 1).map((it) => make(it.entry)),
              ]);
              onQuickUpdate({
                cantrips: [...value.cantrips, ...newCantrips],
                spellsByLevel: next,
                // Круг, которого лист ещё не показывал, иначе взятое просто
                // не появится на экране.
                spellSlotLevels: Math.max(value.spellSlotLevels, topLevel),
              });
              setSpellListOpen(false);
            }}
            onClose={() => setSpellListOpen(false)}
          />
        )}
        {arcanumOpen && onQuickUpdate && (
          <DndArcanumPicker
            systemId={value.systemId}
            warlockClassId={value.classes.find((c) => nameMatches(c.className, "Колдун"))?.classId ?? null}
            warlockLevel={warlockLevel}
            spellsByLevel={value.spellsByLevel}
            color={cardColor}
            onPick={(idx, entry) => {
              // Замена арканума круга целиком: свои строки уходят, чужие
              // (настоящие ячейки мультикласса) остаются. Арканум всегда
              // подготовлен и вне лимита — иначе съест бюджет подготовки.
              // Модалка не закрывается: на 17 уровне брать четыре штуки.
              const next = value.spellsByLevel.map((lvl, i) =>
                i === idx
                  ? [
                      ...lvl.filter((s) => !s.arcanum),
                      { entryId: entry.id, name: entry.name, prepared: 2, outsideLimit: true, arcanum: true } as DndSpellEntry,
                    ]
                  : lvl
              );
              onQuickUpdate({ spellsByLevel: next });
            }}
            onClose={() => setArcanumOpen(false)}
          />
        )}
        {originEditing && onQuickUpdate && (
          <DndOriginEditForm origin={origin} value={value} onQuickUpdate={onQuickUpdate} />
        )}
        {fanOpen && (
          <DndDeckFan
            current={tab}
            color={cardColor}
            pendingItems={pendingItems}
            subtitle={`${value.characterName || "Без имени"} · ${stripLatin(
              value.classes.find((c) => c.className)?.className ?? "Без класса"
            )} ${totalLevel}`}
            details={(() => {
              const plural = (n: number, one: string, few: string, many: string) =>
                n % 10 === 1 && n % 100 !== 11
                  ? one
                  : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)
                    ? few
                    : many;
              const short = (s: string, n: number) => {
                const clean = s.replace(/\s+/g, " ").trim();
                return clean.length > n ? `${clean.slice(0, n)}…` : clean;
              };
              const spellCount = value.cantrips.length + value.spellsByLevel.reduce((n, l) => n + l.length, 0);
              const itemCount = value.equipmentSections.reduce((n, s) => n + s.items.length, 0);
              const coinsTotal = (Object.values(value.coins ?? {}) as unknown[]).reduce<number>(
                (sum, v) => sum + (parseInt(String(v ?? ""), 10) || 0),
                0
              );
              const slotLeft = shownSlotPips.map((max, i) => max - (value.spellSlotsUsed[i] ?? 0));
              const slotCircles = shownSlotPips
                .map((max, i) => ({ max, left: Math.max(0, slotLeft[i]) }))
                .filter((c) => c.max > 0);
              const subclassIds = value.classes
                .map((c) => c.subclassId)
                .filter((id): id is number => typeof id === "number");
              const subclassFeats = value.classFeatures.filter(
                (f) => f.sourceParentId != null && subclassIds.includes(f.sourceParentId)
              ).length;
              const dossier: string[] = [];
              for (const { key, label } of NARRATIVE_FIELDS) {
                const text = String(value[key] ?? "").trim();
                if (text) dossier.push(`${label}: ${short(text, 60)}`);
              }
              const pools = allResources(resourceSources, value.abilities).map((r) => {
                const max = r.max + (value.resourceBonus[r.key] ?? 0);
                return `${r.label}: ${Math.max(0, max - Math.min(value.resourceUsed[r.key] ?? 0, max))} из ${max}`;
              });
              if (value.hitDice) pools.push(`Кости хитов: ${value.hitDice}`);
              const byTiming = (t: DndActionTiming) => actionRows.filter((r) => r.timing === t).length;
              return {
                "Карта": [
                  `КЗ ${computedAc}`,
                  `${value.hitPointsCurrent || "—"}/${value.hitPointMax || "—"} хитов`,
                  ...(value.concentration ? [`концентрация: ${short(value.concentration, 30)}`] : []),
                ],
                "Действия": [
                  `действий: ${byTiming("action")}`,
                  `бонусных: ${byTiming("bonus")}`,
                  `реакций: ${byTiming("reaction")}`,
                  ...(byTiming("other") > 0 ? [`особых: ${byTiming("other")}`] : []),
                ],
                "Магия": [
                  ...(spellAbilityKey ? [`АТК ${formatModifier(spellAttackBonus)} · СЛ ${spellDc}`] : []),
                  ...(spellCount > 0
                    ? [`${spellCount} ${plural(spellCount, "заклинание", "заклинания", "заклинаний")}`]
                    : []),
                  ...(slotCircles.length > 0 ? [`ячейки ${slotCircles.map((c) => c.left).join(" / ")}`] : []),
                ],
                "Снаряжение": [
                  `${itemCount} ${plural(itemCount, "предмет", "предмета", "предметов")}`,
                  `настроено: ${value.attunementCount ?? 0}`,
                  `монет: ${coinsTotal}`,
                ],
                "Навыки": [
                  `БМ ${value.proficiencyBonus}`,
                  (() => {
                    const n = Object.values(value.skillProfs).filter((v) => (v as number) > 0).length;
                    return `${n} ${plural(n, "владение", "владения", "владений")}`;
                  })(),
                  (() => {
                    const n = value.proficiencies.length;
                    return `${n} ${plural(n, "инструмент", "инструмента", "инструментов")}`;
                  })(),
                ],
                "Особенности": [
                  ...(value.speciesFeatures.length > 0 ? [`вида: ${value.speciesFeatures.length}`] : []),
                  ...(value.classFeatures.length - subclassFeats > 0
                    ? [`класса: ${value.classFeatures.length - subclassFeats}`]
                    : []),
                  ...(subclassFeats > 0 ? [`подкласса: ${subclassFeats}`] : []),
                  ...(value.feats.length > 0 ? [`черты: ${value.feats.length}`] : []),
                  ...(value.specialAbilities.length > 0 ? [`иное: ${value.specialAbilities.length}`] : []),
                ],
                "Досье": dossier,
                "Ресурсы": pools,
              } as Record<DndViewTab, string[]>;
            })()}
            onPick={setTab}
            onClose={() => setFanOpen(false)}
          />
        )}
        {restOpen && (
          <DndRestModal
            value={value}
            resources={allPools}
            pools={pools}
            companionsAfterRest={companionsRest}
            shortGrants={shortRestGrants}
            tireless={tireless}
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
          {/* Поиск живёт внизу карт (решение владельца): верх отдан карте,
              а поиск нужен после просмотра, не до. На лицевой его нет вовсе:
              она и так отвечает на «кто я и чем бью», а строка ввода поверх
              портрета читалась как часть карты. */}
          {/* Полоска названий колоды — одна на телефон и на десктоп (Q29).
              Раньше телефон получал выпадающий список, а десктоп — ряд
              кнопок: два разных языка навигации на одном листе. Полоска
              прокручивается вбок, текущая карта подчёркнута цветом класса, и
              Мастеру, впервые открывшему чужой лист, видно, куда нажать —
              свайпов он не знает. */}
          <div className="dnd-deck-strip" role="tablist" aria-label="Карты листа" ref={deckStripRef}>
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

          {/* Десктопный сплит (этап 7): лицевая/оборот слева в натуральную
              величину, вкладка справа. На телефоне обёртка прозрачна
              (display: contents) — поток как был. */}
          <div className="dnd-desktop-split">
          {/* КАРТА ПЕРСОНАЖА — первая карта колоды (гриллинг 2026-09-04).
              Раньше этот блок висел несворачиваемой шапкой над всеми
              вкладками: чтобы дойти до содержимого любой из них, надо было
              пролистать характеристики и весь список навыков. Теперь это
              своя карта, и она же — то место, куда Мастер заглядывает за
              одним числом. */}
          {(tab === "Карта" || showDesktopFace) && !cardFlipped && (
            <div
              className="stack dnd-card-face"
              style={{ borderLeftColor: cardColor, borderRightColor: cardColor, borderBottomColor: cardColor }}
            >
              {/* Полоса правки видна только когда лист открыт карандашом с
                  плашки: «Готово» убирает параметр из адреса и возвращает
                  карту к чтению. */}
              {editFromUrl && onQuickUpdate && (
                <div className="row dnd-card-editbar">
                  <span className="sb-label">Правка карты</span>
                  {canFrame && portraitUrl && !portraitStale && (
                    <>
                      <span className="muted">Тяните портрет — кадрируется</span>
                      <button
                        type="button"
                        className="comp-mini"
                        title="Вернуть кадр по умолчанию"
                        onClick={() => onQuickUpdate({ portraitFocus: { ...DEFAULT_PORTRAIT_FOCUS } })}
                      >
                        Сброс кадра
                      </button>
                    </>
                  )}
                  <button type="button" className="primary" onClick={leaveEdit}>
                    Готово
                  </button>
                </div>
              )}
              {/* Портрет владеет верхом карты и уходит в бумагу, а под ним
                  лежит он же, отражённый по обеим осям и почти невидимый, —
                  как на фигурных картах. Шва не видно, потому что верхний
                  гаснет не в ноль, а до силы нижнего. Текста поверх нет: имя
                  и класс уже стоят в шапке листа, и дублировать их значило бы
                  написать одно и то же дважды на одном экране. */}
              {/* Двойник — сосед портретной зоны, а не её потомок: он тянется
                  до низа карты, а зона высотой ровно с лицо. Портрет и
                  отражение вдвоём и есть подложка карточки. */}
              {portraitUrl && !portraitStale && (
                <span className="dnd-card-portrait-ghost" aria-hidden="true">
                  <img
                    src={portraitUrl}
                    alt=""
                    style={{ objectPosition: portraitPosition, filter: `grayscale(${portraitDrain})` }}
                  />
                </span>
              )}
              {/* Зона рисуется и без портрета: картуш с именем — часть карты,
                  а не подпись под фотографией, и шапки листа на этой карте
                  больше нет. Без портрета зона схлопывается по содержимому.
                  Двойной тап по портрету разворачивает колоду веером, а в
                  ?edit=1 портрет тянется для кадрирования (см. useFrameDrag). */}
              <div
                className={`dnd-card-portrait-zone${portraitUrl ? "" : " is-empty"}${canFrame ? " is-framing" : ""}${frame.dragging ? " is-dragging" : ""}${atZeroHp ? " has-death" : ""}`}
                onTouchEnd={onPortraitTouchEnd}
                onPointerDown={frame.handlers.onPointerDown}
                onPointerMove={frame.handlers.onPointerMove}
                onPointerUp={frame.handlers.onPointerUp}
                onPointerCancel={frame.handlers.onPointerCancel}
                onClickCapture={frame.handlers.onClickCapture}
              >
                  {portraitUrl && !portraitStale && (
                  <div className="dnd-card-portrait">
                    <img
                      src={portraitUrl}
                      alt=""
                      style={{ objectPosition: portraitPosition, filter: `var(--portrait-tone) grayscale(${portraitDrain})` }}
                      // Подписанные URL файлов живут 60 секунд: посидев на
                      // другой карте дольше, возвращаемся к протухшей ссылке.
                      // Прячем битую картинку и один раз просим свежий URL —
                      // родитель перезагружает персонажа, ссылка приезжает
                      // новой, стейт сбрасывается по смене portraitUrl.
                      onError={handlePortraitError}
                    />
                    <span className="dnd-card-portrait-grain" aria-hidden="true" />
                    <span className="dnd-card-portrait-fade" aria-hidden="true" />
                  </div>
                  )}
                  {/* Спасброски от смерти (В3): поверх портрета, потому что
                      ноль хитов — это ровно то, на что смотрят, и вводится он
                      здесь же, модалкой хитов. Появляются сами и сами уходят:
                      на здоровом персонаже их нет. */}
                  {atZeroHp && (
                    <DeathSaveOverlay
                      successes={value.deathSaveSuccesses}
                      failures={value.deathSaveFailures}
                      onQuickUpdate={onQuickUpdate}
                    />
                  )}
                  {/* КАРТУШ — имя стоит у нижнего края портретной половины,
                      как на макете: карта должна называть персонажа сама, а
                      не полагаться на шапку листа над ней (её на этой карте
                      теперь и нет — см. sb-head ниже). Уровень числом в
                      картуше цвета класса, под ним вид, предыстория и бонус
                      мастерства — то, что спрашивают редко, но глазами
                      ищут именно здесь. */}
                  <div className="dnd-card-cartouche">
                    {/* Пометка истощения стоит над именем, а не под костями:
                        внизу она вклинивалась между рядами и двигала половину
                        карты, стоило уровню измениться. */}
                    {value.exhaustion > 0 && (
                      <div className="dnd-card-cartouche-warning">
                        Истощение {value.exhaustion}: −{exhaustionPenalty} ко всем броскам к20, −{value.exhaustion * 5} фт
                        скорости
                      </div>
                    )}
                    <div className="dnd-card-cartouche-name">{value.characterName || "Без имени"}</div>
                    <div className="dnd-card-cartouche-class">
                      {/* Цифра уровня — вход в визард повышения. Она уже стоит
                          на лицевой стороне и означает ровно то, что визард
                          меняет; отдельной кнопки для этого заводить не нужно.
                          Раньше единственным входом был тап по неподписанному
                          загнутому уголку — то есть повышение уровня нельзя
                          было найти, не зная про жест. */}
                      {totalLevel > 0 &&
                        (onQuickUpdate ? (
                          <button
                            type="button"
                            className="dnd-card-level"
                            style={{ background: cardColor, color: textOnClassColor(cardColor) }}
                            aria-label={`Уровень ${totalLevel} — повысить`}
                            onClick={() => setShowLevelUp(true)}
                          >
                            {totalLevel}
                          </button>
                        ) : (
                          <span className="dnd-card-level" style={{ background: cardColor, color: textOnClassColor(cardColor) }}>
                            {totalLevel}
                          </span>
                        ))}
                      <span className="dnd-card-cartouche-classline">{classLine}</span>
                    </div>
                    {originLine && <div className="dnd-card-cartouche-origin">{originLine}</div>}
                  </div>
              </div>
              {/* ВДОХНОВЕНИЕ — жетон-звезда в углу карты, а не плашка в ряду
                  (гриллинг 2026-09-04). Оно тратится ровно в тот момент, когда
                  на карту смотрят, поэтому нажимается прямо здесь; а держать
                  его в общей сетке нельзя — оно там двигало соседей. */}
              {/* ОТДЫХ — жетон в левом углу, зеркально вдохновению: обе
                  кнопки, которые нажимают прямо с карты, стоят по краям
                  портрета, а не полосой над ним. */}
              {onQuickUpdate && (
                <button
                  type="button"
                  className={`dnd-rest-token${portraitUrl ? " on-portrait" : ""}`}
                  title="Отдых"
                  aria-label="Отдых"
                  onClick={() => setRestOpen(true)}
                >
                  <NavIcon name="moon" />
                </button>
              )}
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
              <AcQuickBox computed={computedAc} manualBonus={value.manualAcBonus} hint={unarmoredHint} onQuickUpdate={onQuickUpdate} />
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
              </div>
            </div>
            {(otherSpeeds || legacySpeedNote || (moveBonus.bonus > 0 && value.speeds.walk != null)) && (
              <div className="muted dnd-triad-note">
                {[
                  otherSpeeds,
                  legacySpeedNote,
                  // Расшифровка бонуса — чтобы игрок, вбивший +10 руками в базу,
                  // увидел двойной учёт, а не молчаливую сумму.
                  moveBonus.bonus > 0 && value.speeds.walk != null
                    ? `ходьба ${value.speeds.walk} + ${moveBonus.bonus} (без доспехов)`
                    : "",
                ].filter(Boolean).join(" · ")}
              </div>
            )}

            {/* Живой ряд: инициатива, концентрация, истощение — то, что
                меняется в бою, строкой плашек, как на макете. */}
            <div className="dnd-live-row">
              {/* СОСТОЯНИЯ — первыми в живом ряду: «отравлен» и «испуган»
                  меняют каждый бросок, а держались до сих пор в голове
                  Мастера. Пустая плашка не исчезает: место постоянное. */}
              <ConditionsBox
                conditions={value.conditions}
                systemId={value.systemId}
                onQuickUpdate={onQuickUpdate}
              />
              {/* Концентрация — там, куда игрок и так смотрит каждый ход.
                  Ставится из окна заклинания, снимается кликом и длинным отдыхом. */}
              {/* Переключатель, а не только «снять»: концентрация бывает и от
                  эффекта, который лист не знает, — Мастер называет её словами,
                  а игроку надо чем-то её отметить. Поставленная из окна
                  заклинания несёт его имя, руками — просто «есть». */}
              <LiveChip
                label="Концентрация"
                value={value.concentration || "—"}
                active={!!value.concentration}
                title={value.concentration ? "Снять концентрацию" : "Отметить концентрацию"}
                ariaLabel={`Концентрация: ${value.concentration || "нет"} — переключить`}
                onClick={
                  onQuickUpdate
                    ? () => onQuickUpdate({ concentration: value.concentration ? "" : "есть" })
                    : undefined
                }
              />
              {/* Истощение — числом, как на макете, а не дорожкой из шести
                  кружков: за столом называют уровень («у тебя два»), а
                  дорожка занимала треть ряда, чтобы сказать то же самое.
                  Клик прибавляет, седьмой — смерть, о чём сказано прямо.
                  Место постоянное, даже когда истощения нет: переезжающая
                  плашка читается как другая. */}
              {/* По кругу 0…6→0: правого клика на телефоне нет, а уровень
                  почти всегда растёт — снимает его длинный отдых сам. */}
              <LiveChip
                label="Истощение"
                value={value.exhaustion >= 6 ? "смерть" : value.exhaustion}
                active={value.exhaustion > 0}
                title={onQuickUpdate ? "Клик — следующий уровень истощения" : undefined}
                ariaLabel={`Истощение ${value.exhaustion} — сменить уровень`}
                onClick={onQuickUpdate ? () => onQuickUpdate({ exhaustion: (value.exhaustion + 1) % 7 }) : undefined}
                onUndo={
                  onQuickUpdate && value.exhaustion > 0
                    ? () => onQuickUpdate({ exhaustion: value.exhaustion - 1 })
                    : undefined
                }
                undoLabel={`Истощение ${value.exhaustion} → ${value.exhaustion - 1}`}
              />
            </div>

            {/* Характеристики. Карандаша над ними больше нет: он тянулся
                полосой во всю ширину и резал карту пополам. Правка уехала на
                плашку чарника в профиле — там ей и место, лист за столом
                читают, а не заполняют. */}
            {editFromUrl && onQuickUpdate ? (
              <AbilitySavesSkillsEdit
                abilities={value.abilities}
                proficiencyBonus={formatModifier(derived.proficiencyBonus.value)}
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
                proficiencyBonus={formatModifier(derived.proficiencyBonus.value)}
                savingThrowProfs={value.savingThrowProfs}
                skillProfs={value.skillProfs}
                classSkillPool={classSkillPool(value.classes)}
                backgroundSkillNames={value.backgroundSkillNames}
              />
            )}

            {/* ЗАКЛАДКИ — до трёх строк «Действий» прямо на карте: ответ на
                «чем я обычно бью», который за столом задают каждый ход.
                Строка кликается так же, как в таблице действий, и открывает
                то же описание. */}
            {bookmarkRows.length > 0 && (
              <div className="stack dnd-bookmarks">
                {bookmarkRows.map((row) => (
                  <button
                    key={row.name}
                    type="button"
                    className="dnd-bookmark"
                    style={{ borderLeftColor: cardColor }}
                    onClick={row.source ? () => setOpenAction(row) : undefined}
                    disabled={!row.source}
                  >
                    <span className="dnd-bookmark-main">
                      {/* Как и в картуше: оригинал в скобках нужен поиску по
                          книге, а на карте съедает половину строки. */}
                      <span className="dnd-bookmark-name">{stripLatin(row.name)}</span>
                      {/* Числа стоят под именем, а не справа от него: в одну
                          строку на телефоне не влезают ни «5к6 Огненный
                          (полов.) + 5к6 Излучение», ни само название — имя
                          обрезалось до «Небесн…». Прочерки не печатаются:
                          колонок здесь нет, ровнять нечего. */}
                      <span className="dnd-bookmark-meta">
                        {[row.bonus, row.damage, row.range || row.description]
                          .filter((v) => v && v !== "—")
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* ЖЕТОНЫ СПУТНИКОВ — нижняя лента карты. Каждый жетон ведёт на
                статблок существа: за столом спрашивают КЗ фамильяра, а не
                его имя, и лист должен уметь ответить, не заставляя искать
                зверя в бестиарии. */}
            {((value.companions ?? []).length > 0 || onQuickUpdate) && (
              <div className="dnd-companions">
                {(value.companions ?? []).map((c, i) => {
                  const remove = onQuickUpdate
                    ? () =>
                        onQuickUpdate({
                          companions: (value.companions ?? []).filter((_, j) => j !== i),
                        })
                    : undefined;
                  // Тело по чертежу вместо жетона: пушка/защитник/призыв с хитами.
                  // Чертёж не разобрался (запись уехала) — падаем назад на
                  // жетон, а не в пустоту: имя и так сохранено рядом с id.
                  const bodyBlueprint =
                    c.featureEntryId != null || c.spellEntryId != null ? blueprintOfInstance(c) : null;
                  const bodyView = resolveBlueprintVariant(bodyBlueprint, c.variant);
                  const bodyStats =
                    bodyBlueprint != null && bodyView?.hp != null
                      ? companionStats(bodyBlueprint, value.classes, c.classId, value.abilities, c.spellLevel ?? 0, c.variant)
                      : null;
                  if (bodyBlueprint != null && bodyStats != null && onQuickUpdate) {
                    const ownerName =
                      (c.featureEntryId != null
                        ? summonOptions.find((o) => o.feature.entryId === c.featureEntryId)?.feature.name
                        : spellSummonOptions.find((o) => o.spell.entryId === c.spellEntryId)?.spell.name) ??
                      bodyBlueprint.name ??
                      c.name;
                    return (
                      <CompanionBody
                        key={`body-${c.featureEntryId ?? c.spellEntryId}-${i}`}
                        companion={c}
                        blueprint={{ ...bodyBlueprint, actions: bodyView?.actions ?? bodyBlueprint.actions }}
                        maxHp={bodyStats.maxHp}
                        ac={bodyStats.ac}
                        ownerFeatureName={ownerName}
                        variants={(bodyBlueprint.variants ?? []).map((v) => v.name ?? "").filter(Boolean)}
                        activeVariant={bodyView?.name ?? ""}
                        onVariant={(name) =>
                          onQuickUpdate({
                            companions: (value.companions ?? []).map((x, j) =>
                              j === i
                                ? { ...x, variant: name, name, hpUsed: 0, dead: false, dismissed: false }
                                : x
                            ),
                          })
                        }
                        previewEntryId={c.featureEntryId ?? c.spellEntryId ?? c.entryId}
                        ownsDetonate={
                          !!bodyBlueprint.detonateFeature &&
                          ownedFeatureNames.includes(bodyBlueprint.detonateFeature)
                        }
                        ownsCover={
                          !!bodyBlueprint.coverFeature &&
                          ownedFeatureNames.includes(bodyBlueprint.coverFeature)
                        }
                        onPatch={(patch) =>
                          onQuickUpdate({
                            companions: (value.companions ?? []).map((x, j) =>
                              j === i ? { ...x, ...patch } : x
                            ),
                          })
                        }
                        onRemove={remove ?? (() => {})}
                      />
                    );
                  }
                  return (
                    <CompanionToken
                      key={`${c.entryId ?? "manual"}-${i}`}
                      companion={c}
                      getEntry={getEntry}
                      onRemove={remove}
                    />
                  );
                })}
                {/* Вывод тел по чертежам: кнопка только пока живых меньше
                    лимита (вторая пушка — за «Укреплённую позицию»). */}
                {onQuickUpdate &&
                  summonOptions
                    .filter(
                      (o) =>
                        liveCompanionsOf(value.companions, o.feature.entryId).length <
                        companionMaxCount(o.blueprint, ownedFeatureNames)
                    )
                    .map((o) => (
                      <button
                        key={`summon-${o.feature.entryId}`}
                        type="button"
                        className="comp-mini"
                        title={`Вывести: ${o.blueprint.name ?? o.feature.name}`}
                        onClick={() =>
                          onQuickUpdate({
                            // Развеянное/мёртвое тело того же чертежа уходит:
                            // новый вызов — новое тело, а не второе рядом.
                            companions: [
                              ...(value.companions ?? []).filter(
                                (x) =>
                                  x.featureEntryId !== o.feature.entryId || (!x.dead && !x.dismissed)
                              ),
                              {
                                entryId: null,
                                name: o.blueprint.name ?? o.feature.name,
                                featureEntryId: o.feature.entryId,
                                classId: companionClassId(o.feature.entryId, value.classes, entryParentId),
                              },
                            ],
                          })
                        }
                      >
                        Вывести: {o.blueprint.name ?? o.feature.name}
                      </button>
                    ))}
                {/* Призыв заклинанием (data.summon): двухшаговый — сначала
                    «Призвать», потом круг (мощь от круга, ритуал ячейки не
                    тратит). Живого сверх лимита заменяем, мёртвого — тоже. */}
                {onQuickUpdate &&
                  spellSummonOptions.map((o) => {
                    const live = liveSummonOf(value.companions, o.spell.entryId);
                    const max = companionMaxCount(o.blueprint, ownedFeatureNames);
                    const name = o.blueprint.name ?? o.spell.name;
                    const picking = summonSpell === o.spell.entryId;
                    const circles: number[] = [];
                    for (let ci = 0; ci < shownSlotPips.length; ci++) {
                      if ((shownSlotPips[ci] ?? 0) > 0) circles.push(ci + 1);
                    }
                    if (circles.length === 0) circles.push(1);
                    return (
                      <span key={`spell-summon-${o.spell.entryId}`} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <button
                          type="button"
                          className="comp-mini"
                          title={live.length >= max ? `Пересоздать (заменит живого): ${name}` : `Призвать: ${name}`}
                          onClick={() => setSummonSpell(picking ? null : o.spell.entryId)}
                        >
                          {live.length >= max ? `Пересоздать: ${name}` : `Призвать: ${name}`}
                        </button>
                        {picking &&
                          circles.map((circle) => (
                            <button
                              key={circle}
                              type="button"
                              className="comp-mini"
                              title={`Круг ${circle}: хиты по формуле чертежа`}
                              onClick={() => {
                                const next = [...(value.companions ?? [])];
                                if (live.length >= max && live.length > 0) {
                                  const idx = live[0].index;
                                  next[idx] = {
                                    ...next[idx],
                                    spellLevel: circle,
                                    hpUsed: 0,
                                    dead: false,
                                    dismissed: false,
                                  };
                                } else {
                                  const kept = next.filter(
                                    (x) => x.spellEntryId !== o.spell.entryId || (!x.dead && !x.dismissed)
                                  );
                                  kept.push({
                                    entryId: null,
                                    name,
                                    spellEntryId: o.spell.entryId,
                                    spellLevel: circle,
                                  });
                                  next.length = 0;
                                  next.push(...kept);
                                }
                                onQuickUpdate({ companions: next });
                                setSummonSpell(null);
                              }}
                            >
                              {circle}й
                            </button>
                          ))}
                      </span>
                    );
                  })}
                {/* Поле поиска не стоит на карте постоянно: спутника заводят
                    раз в кампанию, а орган управления виден каждый ход.
                    Пока он не нужен — на его месте «+». */}
                {onQuickUpdate &&
                  (addingCompanion ? (
                    <CompendiumEntryPicker
                      value={null}
                      kind="monster"
                      dropUp
                      placeholder="Спутник из бестиария…"
                      selectedLabel="Спутник"
                      onChange={(entry) => {
                        if (!entry) return;
                        onQuickUpdate({
                          companions: [...(value.companions ?? []), { entryId: entry.id, name: entry.title }],
                        });
                        setAddingCompanion(false);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="comp-mini dnd-companion-add"
                      title="Добавить спутника"
                      aria-label="Добавить спутника"
                      onClick={() => setAddingCompanion(true)}
                    >
                      <NavIcon name="plus" />
                    </button>
                  ))}
              </div>
            )}
              {/* Загнутый угол — индикатор «пришло послание» и (только на
                  телефоне) жест переворота тапом. Всегда справа внизу: серый
                  без входящих, цвета класса при непрочитанных, без текста —
                  карту показывают соседям по столу. На десктопе оборот и так
                  стоит в правой колонке, поэтому угол там не кликается. */}
              {showDesktopFace ? (
                <span
                  className={`dnd-card-corner${unreadTotal > 0 ? " has-unread" : ""}${cornerGlint ? " glint" : ""}`}
                  style={unreadTotal > 0 ? { background: cardColor } : undefined}
                  role="img"
                  aria-label={unreadTotal > 0 ? `${unreadTotal} новых входящих` : "Входящих нет"}
                />
              ) : (
                <button
                  type="button"
                  className={`dnd-card-corner${unreadTotal > 0 ? " has-unread" : ""}${cornerGlint ? " glint" : ""}`}
                  style={unreadTotal > 0 ? { background: cardColor } : undefined}
                  onClick={() => {
                    setCardFlipped(true);
                    if (canUseInbox) {
                      refreshInbox();
                      refreshTransfers();
                    }
                  }}
                  aria-label={
                    unreadTotal > 0
                      ? `Перевернуть карту: входящие, передачи, постер; ${unreadTotal} новых входящих`
                      : "Перевернуть карту: входящие, передачи, постер"
                  }
                />
              )}
            </div>
          )}
          {/* Оборот первой карты — входящие игрока. Отдельная сторона, а не
              модалка (разбор): возврат — уголком и уходом с карты. На десктопе
              при перевороте оборот встаёт в левую колонку вместо лицевой. */}
          {tab === "Карта" && cardFlipped && renderCardBack()}

          <div className="dnd-desktop-tab">
          {/* Десктопная правая колонка на «Карте» (этап 7): оборот + вход в
              правку основной информации. На телефоне тут пусто — оборот
              открывается переворотом, правка адресом с плашки профиля. */}
          {showDesktopFace && tab === "Карта" && !cardFlipped && (
            <div className="stack dnd-desktop-back">
              {renderCardBack()}
              {/* Правка основной информации — раскрывашкой под оборотом
                  (решение владельца): поля сохраняются мгновенно, как везде
                  на листе, «Сохранить» лишь закрывает панель. */}
              {syncTabToUrl && onQuickUpdate && (
                <div className="stack dnd-face-edit">
                  <button
                    type="button"
                    className="dnd-face-edit-head"
                    aria-expanded={rightEditOpen}
                    onClick={() => setRightEditOpen((v) => !v)}
                  >
                    <span>Редактировать</span>
                    <span aria-hidden="true">{rightEditOpen ? "−" : "+"}</span>
                  </button>
                  {rightEditOpen && (
                    <>
                      <DndOriginEditForm origin={origin} value={value} onQuickUpdate={onQuickUpdate} />
                      <button type="button" className="primary" onClick={() => setRightEditOpen(false)}>
                        Сохранить
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {tab === "Действия" && (
            <div className="stack">
              {/* Инициатива — кнопкой по центру строки: слева правка раздела,
                  справа веер (решение владельца). Кнопки одного размера. */}
              <div className="dnd-tab-tools">
                {onQuickUpdate ? (
                  <TabEditToggle editing={editingActions} onToggle={() => setEditingActions((v) => !v)} />
                ) : (
                  <span className="dnd-tab-btn" aria-hidden="true" />
                )}
                <TextQuickBox label="Инициатива" value={value.initiative} field="initiative" onQuickUpdate={onQuickUpdate} />
                <DndFanButton onOpen={() => setFanOpen(true)} />
              </div>
              {/* Лента пулов (этап 5): только то, что тратит хоть одна строка
                  этой карты, — ячейки, если тут есть боевые заклинания, и
                  классовые пулы по resourceKey их стоимостей. Остальные пулы
                  живут на «Ресурсах», постоянно все не показываем. Траты —
                  там же, где были (окна строк и дорожки ниже); лента только
                  показывает остаток и пересчитывается после траты. */}
              <DndActionPools
                actionRows={actionRows}
                resourceSources={resourceSources}
                abilities={value.abilities}
                resourceUsed={value.resourceUsed}
                resourceBonus={value.resourceBonus}
                shownSlotPips={magicPips}
                spellSlotsUsed={value.spellSlotsUsed}
                pact={computedSlots.pact}
                pactUsed={value.pactSlotsUsed ?? 0}
                ownPools={ownPools}
                onQuickUpdate={onQuickUpdate}
              />
              {/* Вручную вписанные атаки (то, чего нет ни в оружии, ни в
                  заклинаниях) правились только в форме. Теперь — там же, где
                  показываются. Правка раздела — карандашом в строке выше. */}
              {editingActions && onQuickUpdate && (
                <AttackListEdit values={value.attacks} onChange={(v) => onQuickUpdate({ attacks: v })} />
              )}
              {(() => {
                const byTiming = (t: DndActionTiming) => actionRows.filter((r) => r.timing === t);
                const poolLabels = Object.fromEntries(
                  allResources(resourceSources, value.abilities).map((r) => [r.key, r.label])
                );
                const tableProps = { onOpen: setOpenAction, pinnedNames, onPin: onQuickUpdate ? togglePinned : undefined, resourceLabels: poolLabels, color: cardColor };
                return (
                  <>
                    <AttacksTable title="Действия" rows={byTiming("action")} {...tableProps} />
                    <AttacksTable title="Бонусные действия" rows={byTiming("bonus")} {...tableProps} />
                    <AttacksTable title="Реакции" rows={byTiming("reaction")} {...tableProps} />
                    <AttacksTable title="Особое" rows={byTiming("other")} {...tableProps} />
                  </>
                );
              })()}
            </div>
          )}

          {tab === "Магия" && (
            <div>
              {/* Шапка вкладки: правка слева, веер справа, по центру СЛ и АТК —
                  то, зачем сюда заглядывают. Полные подписи убраны: строка
                  принадлежит числам, а не словам. */}
              <div className="dnd-tab-tools">
                {onQuickUpdate ? (
                  <TabEditToggle editing={editingSpells} onToggle={() => setEditingSpells((v) => !v)} />
                ) : (
                  <span className="dnd-tab-btn" aria-hidden="true" />
                )}
                <div className="dnd-tab-center dnd-tab-mid">
                  {spellAbilityKey ? (
                    <span>
                      СЛ: {spellDc} · АТК: {formatModifier(spellAttackBonus)}
                    </span>
                  ) : (
                    <span className="muted">Нет заклинательной характеристики</span>
                  )}
                </div>
                <DndFanButton onOpen={() => setFanOpen(true)} />
              </div>
              {(value.spellcasting || spellAbilityKey) && (
                <>
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
              <div className="row sb-entry dnd-prepared-filter" style={{ gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`dnd-chip${prefs.spellsPreparedOnly ? " is-on" : ""}`}
                  aria-pressed={prefs.spellsPreparedOnly}
                  onClick={() => saveDndPrefs({ ...prefs, spellsPreparedOnly: !prefs.spellsPreparedOnly })}
                >
                  Подготовленные/Доступные
                </button>
                {onQuickUpdate && (
                  <button type="button" className="dnd-chip" onClick={() => setSpellListOpen(true)}>
                    Добавить
                  </button>
                )}
                {onQuickUpdate && warlockLevel >= 11 && (
                  <button type="button" className="dnd-chip" onClick={() => setArcanumOpen(true)}>
                    Арканум
                  </button>
                )}
                {prefs.spellsPreparedOnly && editingSpells && (
                  <span className="muted">в правке показаны все — подготовить можно только видимое</span>
                )}
              </div>
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
              {/* Расчёт ячеек — под меню редактирования: пользуются ячейками,
                  а настраивают расчёт. Вне правки здесь только то, что тратят. */}
              {editingSpells && computedSlots.basis !== "none" && (
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
                spellSlotLevels={magicLevels}
                spellSlotPips={magicPips}
                spellSlotsUsed={value.spellSlotsUsed}
                spellsByLevel={liveSpellsByLevel}
                edit={editingSpells}
                systemId={value.systemId}
                levelTitles={arcanumTitles}
                slotsLockedCircles={arcanumLocked}
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
                onCast={(row) => setOpenAction(row)}
              />
            </div>
          )}

          {tab === "Навыки" && (
            <>
              {/* Шапка вкладки: слева крупно БМ, справа веер. Карандаша нет —
                  навыки правятся прямо в строках, владение добавляется
                  списком инструментов ниже. */}
              <div className="dnd-tab-tools">
                <span className="dnd-tab-bm">БМ {value.proficiencyBonus}</span>
                <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
                <DndFanButton onOpen={() => setFanOpen(true)} />
              </div>
              <DndSkillsView
              exhaustionPenalty={exhaustionPenalty}
              highlight={highlight}
              abilities={value.abilities}
              proficiencyBonus={formatModifier(derived.proficiencyBonus.value)}
              skillProfs={value.skillProfs}
              classSkillPool={classSkillPool(value.classes)}
              backgroundSkillNames={value.backgroundSkillNames}
              proficiencies={value.proficiencies}
              skills={skills}
              systemId={value.systemId}
              onQuickUpdate={onQuickUpdate}
            />
            </>
          )}

          {tab === "Снаряжение" && (
            <div className="stack">
              {/* Шапка вкладки: правка слева, передача по центру, веер справа.
                  Передача открывает то же меню, что оборот карты. */}
              <div className="dnd-tab-tools">
                {onQuickUpdate ? (
                  <TabEditToggle editing={editingInventory} onToggle={() => setEditingInventory((v) => !v)} />
                ) : (
                  <span className="dnd-tab-btn" aria-hidden="true" />
                )}
                <div className="dnd-tab-center dnd-tab-mid">
                  {canUseInbox && ownerCharacterId != null && (
                    <button type="button" className="dnd-transfer-btn" onClick={() => setTransferModalOpen(true)}>
                      Передать предмет
                    </button>
                  )}
                </div>
                <DndFanButton onOpen={() => setFanOpen(true)} />
              </div>
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
                    accentColor={cardColor}
                    armorProfs={armorProfNames(value.proficiencies)}
                    strength={value.abilities.str}
                    carryDoublingNames={findCarryDoublings([
                      ...value.speciesFeatures,
                      ...value.classFeatures,
                      ...value.feats,
                      ...value.specialAbilities,
                    ])}
                    calcCampaignId={campaignId}
                    calcSenderId={ownerCharacterId}
                    calcSenderName={value.characterName}
                    onCalcChanged={() => {
                      refreshTransfers();
                      refreshInbox();
                    }}
                    attunementMax={3 + (value.attunementExtra ?? 0)}
                    onQuickUpdate={onQuickUpdate}
                  />
                </>
              )}
              {/* Настройка предметов: ромбы вместо точек, слоты сверх трёх.
                  Счёт — по строкам с ◆: ручное число осталось только для
                  старых листов, где строк с флагом ещё нет. */}
              {(() => {
                const rows = value.equipmentSections.flatMap((s) => s.items).filter((it) => !it.transferOut);
                const rowsAreSource = rows.some((it) => "attuned" in it);
                const counted = rows.filter((it) => it.attuned).length;
                const shown = rowsAreSource ? counted : (value.attunementCount ?? 0);
                const over = counted > 3 + (value.attunementExtra ?? 0);
                return (shown > 0 || onQuickUpdate) ? (
                <div className="dnd-frame">
                  <div className="row" style={{ gap: 6, alignItems: "center" }}>
                    <span className="sb-prop-label">Настроено предметов</span>{" "}
                    {over && (
                      <span className="dnd-limit-over" title="Лимит настройки превышен">
                        сверх лимита!
                      </span>
                    )}
                  </div>
                  {/* Кнопки слотов — в строке с ячейками, у правого края. */}
                  <div className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                    <PipTrack
                      diamondFrom={4}
                      value={shown}
                      label="Настроено предметов"
                      max={3 + (value.attunementExtra ?? 0)}
                      onChange={
                        !rowsAreSource && onQuickUpdate ? (n) => onQuickUpdate({ attunementCount: n }) : undefined
                      }
                    />
                    {onQuickUpdate && (
                      <span className="row" style={{ gap: 4 }}>
                        <button
                          type="button"
                          className="comp-mini"
                          title="Добавить слот настройки"
                          aria-label="Добавить слот настройки"
                          onClick={() => onQuickUpdate({ attunementExtra: (value.attunementExtra ?? 0) + 1 })}
                        >
                          +
                        </button>
                        {(value.attunementExtra ?? 0) > 0 && (
                          <button
                            type="button"
                            className="comp-mini"
                            title="Убрать слот настройки"
                            aria-label="Убрать слот настройки"
                            onClick={() =>
                              onQuickUpdate({
                                attunementExtra: (value.attunementExtra ?? 0) - 1,
                                attunementCount: Math.min(shown, 3 + (value.attunementExtra ?? 0) - 1),
                              })
                            }
                          >
                            −
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                ) : null;
              })()}
              {transferModalOpen && canUseInbox && ownerCharacterId != null && (
                <Modal onClose={() => setTransferModalOpen(false)}>
                  <DndTransferBox
                    color={cardColor}
                    campaignId={campaignId}
                    characterId={ownerCharacterId}
                    characterName={value.characterName}
                    equipment={value.equipmentSections}
                    ownCoins={value.coins}
                    incoming={transfers?.incoming ?? []}
                    outgoing={transfers?.outgoing ?? []}
                    loading={transfersLoading}
                    loadError={transfersError}
                    notice={transferNotice}
                    busyId={transferBusyId}
                    onAction={(id, action) => void handleTransferAction(id, action)}
                    onSendItem={(args) => void handleTransferSend(args)}
                    onSendMoney={(args) => void handleMoneySend(args)}
                    onCommitCoins={(c) => onQuickUpdate?.({ coins: c })}
                    onCalcChanged={() => {
                      refreshTransfers();
                      refreshInbox();
                    }}
                    onRetry={refreshTransfers}
                  />
                </Modal>
              )}
            </div>
          )}

          {tab === "Ресурсы" && (
            <>
            {/* Кости хитов — в одной строке с веером, высотой как веер
                (решение владельца): это первое, что ищут на «Ресурсах».
                Спасброски ниже — они нужны только при нуле хитов. */}
            <div className="dnd-tab-tools">
              {pools.length > 0 ? (
                <div className="dnd-tab-mid dnd-hitdice-row">
                  <span className="sb-label">Кости хитов</span>
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
              ) : (
                <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
              )}
              <DndFanButton onOpen={() => setFanOpen(true)} />
            </div>
            {atZeroHp && (
              <div>
                <div className="sb-label">Спас от смерти</div>
                {(() => {
                  const cheat = liveFeatureGroups.flat().find((f) => f.cost?.deathCheat)?.cost?.deathCheat;
                  if (!cheat || !onQuickUpdate) return null;
                  return (
                    <SoulCheat
                      rarities={cheat.rarities}
                      hpPer={cheat.hpPer}
                      items={value.replicaItems ?? []}
                      getEntry={getEntry}
                      onCheat={(count, ids) => {
                        const gone = new Set(ids);
                        onQuickUpdate({
                          hitPointsCurrent: String(cheat.hpPer * count),
                          deathSaveSuccesses: 0,
                          deathSaveFailures: 0,
                          replicaItems: (value.replicaItems ?? []).filter((it) => !gone.has(it.id)),
                          equipmentSections: value.equipmentSections.map((sec) => ({
                            ...sec,
                            items: sec.items.filter((row) => !gone.has(row.replicaId ?? "")),
                          })),
                        });
                      }}
                    />
                  );
                })()}
                {/* Дорожек здесь больше нет: спасброски отмечаются поверх
                    портрета на «Карте» (В3). Одно состояние — одно место,
                    иначе это два места, где искать, и два, где промахиваться.
                    Чит смерти остаётся тут: он привязан к репликам, а они
                    живут на «Ресурсах». */}
                <span className="muted">
                  Успехи {value.deathSaveSuccesses} · провалы {value.deathSaveFailures} — отмечаются на карте
                  «Карта», поверх портрета.
                </span>
              </div>
            )}
            {/* Кости хитов и спасброски от смерти стоят здесь, а не на карте:
                гриллинг 2026-09-04 оставил на лицевой стороне только КЗ,
                хиты, пассивное восприятие, скорость, характеристики, живой
                ряд, закладки и спутников. Кости хитов тратят на коротком
                отдыхе, а не каждый ход, и их место — среди ресурсов. */}
            <DndResourcesView
              sources={resourceSources}
              abilities={value.abilities}
              resourceUsed={value.resourceUsed}
              resourceBonus={value.resourceBonus}
              value={value}
              systemId={value.systemId}
              campaignId={campaignId}
              ownerCharacterId={ownerCharacterId}
              ownPools={ownPools}
              replicaBonus={replicaBonus}
              onQuickUpdate={onQuickUpdate}
            />
            </>
          )}

          {tab === "Особенности" && (
            <div>
              {/* Шапка вкладки: обе правки наверху — «Свойства» (скорость,
                  чувства, защиты) и «умения» (видовые/классовые/черты/особые),
                  справа веер. Сохранение умений — строкой внизу, как было. */}
              <div className="dnd-tab-tools">
                <div className="row dnd-tab-mid" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-start" }}>
                  {onQuickUpdate && (
                    <LabeledEditButton
                      label="Свойства"
                      editing={editingTraits}
                      onToggle={() => setEditingTraits((v) => !v)}
                    />
                  )}
                  {onQuickUpdate && !draftFeatures && (
                    <LabeledEditButton
                      label="умения"
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
                </div>
                <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
                <DndFanButton onOpen={() => setFanOpen(true)} />
              </div>
              {/* Чувства, скорости, защиты и заметки класса жили только внутри
                  формы правки и в просмотре не показывались вовсе — то есть
                  введённое было не увидеть, не открыв форму. После её роспуска
                  им дом здесь: сопротивление огню по природе ничем не
                  отличается от видовой особенности (гриллинг 2026-09-03).
                  Правка — на месте, значения сохраняются сразу. Карандаш —
                  в шапке вкладки. */}
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
                  <FightingStyleCounter classes={value.classes} feats={draftFeatures.feats} getEntry={getEntry} />
                  <FeatureListEdit
                    title="Особые умения"
                    values={draftFeatures.specialAbilities}
                    onChange={(v) => setDraftFeatures({ ...draftFeatures, specialAbilities: v })}
                    allowSearchDrop
                  />
                  <EntryChoiceCounter
                    classes={value.classes}
                    abilities={draftFeatures.specialAbilities}
                    feats={draftFeatures.feats}
                    systemId={value.systemId}
                  />
                  <WeaponMasteryEdit
                    classes={value.classes}
                    mastered={value.masteredWeapons}
                    systemId={value.systemId}
                    onChange={onQuickUpdate ? (v) => onQuickUpdate({ masteredWeapons: v }) : undefined}
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
              <div className="dnd-tab-tools" style={{ gridColumn: "1 / -1" }}>
                {onQuickUpdate ? (
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
                ) : (
                  <span className="dnd-tab-btn" aria-hidden="true" />
                )}
                <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
                <DndFanButton onOpen={() => setFanOpen(true)} />
              </div>
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
          {/* Низ карты: поиск и возврат в профиль (решение владельца). Поиск
              после просмотра, а не до; возврат — тем же жестом, что свайп
              «назад» с лицевой (onSheetBack задаёт полноэкранная страница). */}
          {tab !== "Карта" && (
            <div className="stack dnd-sheet-foot">
              <DndSheetSearch
                hits={searchHits}
                getEntry={getEntry}
                onGo={(hit) => {
                  setTab(hit.tab);
                  setHighlight(hit.highlight ?? null);
                }}
              />
              {onSheetBack && (
                <button type="button" className="dnd-sheet-back" onClick={onSheetBack}>
                  ← Профиль персонажа
                </button>
              )}
            </div>
          )}
          {/* Сводка мёртвых ссылок (этап 8, вид — канвас Actions): запросили
              пачкой, сервер не вернул — записи больше нет в компендиуме
              (снесли или переустановили модуль). Значок-треугольник и кнопка
              «Показать»: имена нужны для починки, но не каждый раз.
              Значками по строкам и оборотом не показываем (разбор): оборот —
              личное игроку, а значок у каждой строки — шум. */}
          {deadIds.length > 0 && (
            <div className="dnd-dead-links" role="status">
              <span className="muted" aria-hidden="true" style={{ flex: "none", display: "inline-flex" }}>
                <NavIcon name="warning" />
              </span>
              <span className="sb-prop-label" style={{ flex: "1 1 auto" }}>
                {(() => {
                  const n = deadIds.length;
                  const noun =
                    n % 10 === 1 && n % 100 !== 11 ? "ссылка" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "ссылки" : "ссылок";
                  return `${n} ${noun} на справочник ${n === 1 ? "потеряна" : "потеряны"}`;
                })()}
              </span>
              <button
                type="button"
                className="comp-mini"
                aria-expanded={deadOpen}
                onClick={() => setDeadOpen((v) => !v)}
              >
                {deadOpen ? "Скрыть" : "Показать"}
              </button>
              {deadOpen && (
                <span className="muted dnd-dead-names">
                  {deadNames.length > 0 ? deadNames.join(" · ") : "имена не опознаны"}
                </span>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
    {/* Визард повышения уровня — на верхнем уровне листа, а не внутри
        оборота карты: вход в него теперь цифра уровня в картуше, и открыт он
        должен быть с любой карты, а не только пока карта перевёрнута. */}
    {showLevelUp && onQuickUpdate && (
      <DndLevelUpWizard
        value={value}
        onApply={(p) => onQuickUpdate(p)}
        onClose={() => setShowLevelUp(false)}
      />
    )}
  </div>
  );
}
