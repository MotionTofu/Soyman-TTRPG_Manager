import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type {
  CompendiumEntry,
  DndAbilityKey,
  DndActionTiming,
  DndCharacterData,
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
  skillSourceClass,
} from "./AbilitySavesSkills";
import { loadDndPrefs } from "../../dndPrefs";
import {
  loadDndBackgroundOptions,
  loadDndClassFeatures,
  loadDndClassHierarchy,
  loadDndClassProgressions,
  loadDndEquipmentEntries,
  loadDndSpeciesFeatures,
  loadDndSpeciesOptions,
  loadDndSpellsByLevel,
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
import { ensureEntries, getCachedEntry } from "./entryCache";
import { casterKind, computeSpellSlots, effectiveCasterLevel, highestCircle } from "./dndSlots";
import type { ClassProgression } from "./progression";
import { AutoFeatureListEdit, FeatureListEdit } from "./FeatureList";
import { PipTrack } from "../litm/PipTrack";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { MentionText } from "../mentions/MentionText";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { useBag } from "../../bag";
import { computeArmorClass } from "./armorClass";
import { allResources, applicableStats, type ClassResourceSource } from "./dndResources";
import { Modal } from "../Modal";
import { useIsMobile } from "../../hooks/useIsMobile";
import { ChecklistEditor, emptySpeed, formatSpeed, SensesEditor, SpeedEditor } from "./DndCreatureForm";
import { findDndSystemId, loadDndMechanicsGroup, type DndMechanicsOption } from "./dndCompendium";
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
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    attacks: [],
    equipmentSections: [{ name: "Общее", items: [] }],
    attunementCount: 0,
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
  };
}

// Bridges old saved statblocks (single `classAndLevel`/`race`/`background`
// strings, free-text `savingThrows`/`skills`) into the new structured shape,
// so existing data keeps displaying instead of going blank after this change.
export function normalizeDndCharacter(raw: unknown): DndCharacterData {
  const base = emptyDndCharacter();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const merged: DndCharacterData = { ...base, ...(r as Partial<DndCharacterData>) };

  if (!Array.isArray(merged.classes) || merged.classes.length === 0) {
    const legacy = typeof r.classAndLevel === "string" ? r.classAndLevel : "";
    merged.classes = legacy
      ? [{ classId: null, className: legacy, subclassId: null, subclassName: "", level: 1, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: "" }]
      : [];
  }
  // Older saved characters' class rows predate skillChoiceOptions/Count/spellcastingAbility.
  merged.classes = merged.classes.map((c) => ({
    ...c,
    skillChoiceOptions: c.skillChoiceOptions ?? [],
    skillChoiceCount: c.skillChoiceCount ?? 0,
    spellcastingAbility: c.spellcastingAbility ?? "",
  }));
  merged.backgroundSkillNames = Array.isArray(merged.backgroundSkillNames) ? merged.backgroundSkillNames : [];
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
  const rawSkillProfs = { ...emptySkillProfs(), ...(r.skillProfs as object | undefined) };
  merged.skillProfs = Object.fromEntries(
    Object.entries(rawSkillProfs).map(([k, v]) => [k, typeof v === "boolean" ? (v ? 1 : 0) : v])
  ) as DndCharacterData["skillProfs"];

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

// Converts class/subclass/species feature entries into DndFeature rows,
// tagged with sourceParentId so a later pick can find-and-replace just
// these (requirement: features stay in sync with the picked class/species).
// maxLevel filters to features unlocked at or below the class's current
// level; omit it (species has no level) to include everything.
function featuresFromEntries(entries: CompendiumEntry[], parentId: number, maxLevel?: number): DndFeature[] {
  return entries
    .filter((e) => maxLevel == null || (e.level ?? 0) <= maxLevel)
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.position - b.position)
    .map((e) => ({
      name: e.name,
      description: e.description,
      entryId: e.id,
      sourceParentId: parentId,
      level: e.level,
      // Снимаем то же, что и у заклинаний: без времени накладывания умение не
      // попадёт во вкладку «Действия», а без эффектов там нечего показать.
      ...spellTimingFromData(e.data),
      checks: (e.data.checks as DndCheck[] | undefined) ?? [],
      effects: (e.data.effects as DndEffect[] | undefined) ?? [],
      cost: e.data.cost as DndCost | undefined,
    }));
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
interface SourceGrants {
  savingThrows: DndAbilityKey[];
  toolIds: number[];
  toolNames: string[];
  skills: string[];
  featNames: string[];
}

const EMPTY_GRANTS: SourceGrants = {
  savingThrows: [],
  toolIds: [],
  toolNames: [],
  skills: [],
  featNames: [],
};

// Поля не пересекаются: у класса — спасброски и инструменты, у предыстории —
// навыки, инструмент и черта происхождения. Поэтому разбор один на оба.
function grantsFromEntry(entry: CompendiumEntry | undefined): SourceGrants {
  if (!entry) return EMPTY_GRANTS;
  const data = entry.data;
  const toolPicks = Array.isArray(data.tool_profs)
    ? (data.tool_profs as { id: number; name: string }[])
    : [];
  const bgTool = typeof data.tools === "string" && data.tools ? [data.tools] : [];
  const originFeat = data.origin_feat as { id: number; name: string } | undefined;
  return {
    savingThrows: parseAbilityNames(data.saving_throws),
    toolIds: toolPicks.map((t) => t.id).filter((id) => typeof id === "number"),
    toolNames: [...toolPicks.map((t) => t.name).filter(Boolean), ...bgTool],
    skills: Array.isArray(data.skills) ? (data.skills as string[]) : [],
    featNames: originFeat?.name ? [originFeat.name] : [],
  };
}

function mergeGrants(list: SourceGrants[]): SourceGrants {
  return {
    savingThrows: list.flatMap((g) => g.savingThrows),
    toolIds: list.flatMap((g) => g.toolIds),
    toolNames: list.flatMap((g) => g.toolNames),
    skills: list.flatMap((g) => g.skills),
    featNames: list.flatMap((g) => g.featNames),
  };
}

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
async function loadGrants(ids: (number | null | undefined)[]): Promise<SourceGrants[]> {
  const real = ids.filter((id): id is number => typeof id === "number");
  if (real.length === 0) return [];
  await ensureEntries(real);
  return real.map((id) => grantsFromEntry(getCachedEntry(id)));
}

function classAndLevelSummary(classes: DndClassEntry[]): string {
  return classes
    .filter((c) => c.className)
    .map((c) => {
      const parts = [c.className, c.subclassName].filter(Boolean).join(" — ");
      return `${parts} ${c.level}`;
    })
    .join(" / ");
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
const DndProficienciesEdit = memo(function DndProficienciesEdit({
  value,
  proficiencyBonus,
  abilities,
  onChange,
}: {
  value: DndProficiencyEntry[];
  proficiencyBonus: string;
  abilities: DndCharacterData["abilities"];
  onChange: (v: DndProficiencyEntry[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [manualName, setManualName] = useState("");
  const profBonus = parseBonus(proficiencyBonus);

  function update(i: number, patch: Partial<DndProficiencyEntry>) {
    const next = value.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function remove(i: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    onChange(value.filter((_, idx) => idx !== i));
  }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const result = readSearchDrop(e);
    if (!result) return;
    // Tool proficiencies carry their governing ability on the compendium
    // entry itself (see CompendiumSection's TOOL_ABILITY_FIELD) — use it so
    // the user doesn't have to pick the same ability manually every time.
    const abilityKey = result.ability ? ABILITY_NAME_TO_KEY[result.ability] ?? null : null;
    onChange([...value, { entryId: result.id, name: result.title, abilityKey }]);
  }
  function addManual() {
    if (!manualName.trim()) return;
    onChange([...value, { entryId: null, name: manualName.trim(), abilityKey: null }]);
    setManualName("");
  }

  return (
    <div className="stack">
      <div className="sb-section" style={{ margin: 0 }}>
        Владения и языки
      </div>
      <div
        className={`dnd-proficiency-dropzone${dragOver ? " drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {value.length === 0 && (
          <span className="muted">Перетащите сюда результат поиска — предмет, владение, язык…</span>
        )}
        <div className="stack" style={{ gap: 4 }}>
          {value.map((p, i) => (
            <div key={i} className="row dnd-proficiency-row">
              <span className="dnd-proficiency-name">{p.name}</span>
              <select
                value={p.abilityKey ?? ""}
                onChange={(e) => update(i, { abilityKey: (e.target.value || null) as DndAbilityKey | null })}
              >
                <option value="">— без бонуса —</option>
                {ABILITY_LABELS.map(({ key, label }) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              {p.abilityKey && (
                <span className="dnd-proficiency-value">
                  {formatModifier(abilityModifier(abilities[p.abilityKey]) + profBonus)}
                </span>
              )}
              <button type="button" className="comp-mini" onClick={() => remove(i)}>
                <NavIcon name="close" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="row">
        <input
          placeholder="Добавить вручную"
          value={manualName}
          onChange={(e) => setManualName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addManual()}
        />
        <button type="button" onClick={addManual}>
          + Добавить
        </button>
      </div>
    </div>
  );
});

// onChange is optional: passed by DndSkillsView (which already has
// onQuickUpdate) so a proficiency/language can be added or removed right
// here, without opening the full DndCharacterEdit form just for that — the
// same "Manage" button used to require. Ability-linked proficiencies (tools
// with a governing stat) still need the full edit form; this quick-add only
// covers plain name entries, matching DndProficienciesEdit's own manual-add.
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
              <button type="button" className="comp-mini" onClick={() => remove(i)} title="Убрать">
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

const TIMING_LABEL_TO_KEY: Record<string, DndActionTiming> = {
  "Действие": "action",
  "Бонусное действие": "bonus",
  "Реакция": "reaction",
  "Иное": "other",
};
export const TIMING_KEY_TO_LABEL: Record<DndActionTiming, string> = {
  action: "Действие",
  bonus: "Бонусное действие",
  reaction: "Реакция",
  other: "Иное",
};

// Best-effort classification for spells that predate casting_timing (only
// the free-text casting_time field exists) — matched by keyword so old
// compendium content still buckets sensibly into the new Бой tab sections
// instead of silently disappearing.
function inferTimingFromLegacyText(text: string): { timing: DndActionTiming; other?: string } {
  const t = text.toLowerCase();
  if (t.includes("бонус")) return { timing: "bonus" };
  if (t.includes("реакц")) return { timing: "reaction" };
  if (t.includes("действ")) return { timing: "action" };
  return { timing: "other", other: text };
}

function spellTimingFromData(data: Record<string, unknown>): { castingTiming?: DndActionTiming; castingTimingOther?: string } {
  const label = typeof data.casting_timing === "string" ? data.casting_timing : "";
  if (label && TIMING_LABEL_TO_KEY[label]) {
    return {
      castingTiming: TIMING_LABEL_TO_KEY[label],
      castingTimingOther: typeof data.casting_timing_other === "string" ? data.casting_timing_other : undefined,
    };
  }
  const legacy = typeof data.casting_time === "string" ? data.casting_time : "";
  if (legacy) {
    const inferred = inferTimingFromLegacyText(legacy);
    return { castingTiming: inferred.timing, castingTimingOther: inferred.other };
  }
  return {};
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
  function update(i: number, patch: Partial<DndManualAttack>) {
    const next = values.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function remove(i: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    onChange(values.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...values, { name: "", description: "", timing: "action" }]);
  }
  return (
    <div className="dnd-feature-section">
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
              <button type="button" className="comp-mini" onClick={() => remove(i)}>
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

// Snapshots an equipment/magic_item compendium entry's armor/АС fields at
// add time — computeArmorClass() then reads these cached fields without a
// live lookup. Заклинания от снапшота отказались (см. resolveSpell), но у
// снаряжения он пока остаётся: КЗ считается вне рендера, где кэша нет.
async function fetchEquipmentMeta(entryId: number): Promise<Partial<DndEquipmentItem>> {
  try {
    const entry = await api.get<CompendiumEntry>(`/systems/entries/${entryId}`);
    const weaponProperties = Array.isArray(entry.data.weapon_properties)
      ? (entry.data.weapon_properties as { name: string }[]).map((p) => p.name).join(", ")
      : undefined;
    const weaponMastery =
      entry.data.weapon_mastery && typeof entry.data.weapon_mastery === "object"
        ? (entry.data.weapon_mastery as { name?: string }).name
        : undefined;
    return {
      entryId,
      armorType: typeof entry.data.armor_type === "string" ? entry.data.armor_type : undefined,
      ac: typeof entry.data.ac === "string" ? entry.data.ac : undefined,
      maxDexBonus: typeof entry.data.max_dex_bonus === "string" ? entry.data.max_dex_bonus : undefined,
      acBonus: typeof entry.data.ac_bonus === "string" ? entry.data.ac_bonus : undefined,
      weaponDamage: typeof entry.data.damage === "string" && entry.data.damage ? entry.data.damage : undefined,
      weaponAttackMelee: !!entry.data.attack_melee,
      weaponAttackRanged: !!entry.data.attack_ranged,
      weaponProperties: weaponProperties || undefined,
      weaponMastery: weaponMastery || undefined,
    };
  } catch {
    return { entryId };
  }
}

// Renders the cached armor/weapon fields (snapshotted by fetchEquipmentMeta)
// as a compact tag line above the item's compendium description, so the
// "what does this do" info shows even though the fields live outside the
// free-text description.
function equipmentTagsLine(item: DndEquipmentItem): string {
  const parts: string[] = [];
  if (item.armorType) {
    parts.push(item.armorType);
    if (item.ac) parts.push(`КЗ ${item.ac}`);
    if (item.maxDexBonus) parts.push(`Макс. бонус Лов ${item.maxDexBonus}`);
  }
  if (item.acBonus) parts.push(`+${item.acBonus} КЗ`);
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
  grantLevel: number;
}

function parseGrantedSpellDefs(entry: CompendiumEntry): GrantedSpellDef[] {
  const raw = Array.isArray(entry.data.granted_spells)
    ? (entry.data.granted_spells as { id: number; name: string; grantLevel?: number }[])
    : [];
  return raw.map((s) => ({
    id: s.id,
    name: s.name,
    grantLevel: typeof s.grantLevel === "number" && s.grantLevel > 0 ? s.grantLevel : 1,
  }));
}

// Resolves granted-spell picks to full spell entries (for circle/level + the
// same meta snapshot other spells carry), tagged with sourceParentId +
// always-prepared, ready to slot into cantrips or spellsByLevel[level-1].
async function fetchGrantedSpells(
  grantedSpells: GrantedSpellDef[],
  sourceParentId: number
): Promise<{ level: number; entry: DndSpellEntry }[]> {
  const results: { level: number; entry: DndSpellEntry }[] = [];
  for (const g of grantedSpells) {
    try {
      const full = await api.get<CompendiumEntry>(`/systems/entries/${g.id}`);
      results.push({
        level: full.level ?? 0,
        entry: { entryId: g.id, name: g.name, prepared: 2, sourceParentId, ...spellSnapshotFromEntry(full) },
      });
    } catch {
      /* spell entry missing — skip */
    }
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
  value: Pick<DndCharacterData, "raceId" | "classes" | "cantrips" | "spellsByLevel" | "spellSlotLevels">
): Promise<{ cantrips: DndSpellEntry[]; spellsByLevel: DndSpellEntry[][]; spellSlotLevels: number }> {
  let { cantrips, spellsByLevel } = stripGrantedSpells(value.cantrips, value.spellsByLevel);
  let spellSlotLevels = value.spellSlotLevels;

  async function grantFrom(entryId: number, characterLevel: number) {
    try {
      const entry = await api.get<CompendiumEntry>(`/systems/entries/${entryId}`);
      const eligible = parseGrantedSpellDefs(entry).filter((d) => d.grantLevel <= characterLevel);
      if (eligible.length === 0) return;
      const granted = await fetchGrantedSpells(eligible, entryId);
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
}) {
  const [dragOver, setDragOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<DndSpellOption[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, SpellDetail>>({});

  useEffect(() => {
    if (!adding || !systemId) return;
    loadDndSpellsByLevel(systemId, level).then(setOptions);
  }, [adding, systemId, level]);

  // Requirement 15 (and requirement 2's expanded fields): clicking a spell's
  // name reveals its full compendium fields + description inline, fetched
  // on demand and cached per entry.
  async function toggleDescription(realIndex: number, entryId: number | null) {
    if (!entryId) return;
    if (expandedIndex === realIndex) {
      setExpandedIndex(null);
      return;
    }
    setExpandedIndex(realIndex);
    if (!(entryId in details)) {
      try {
        const entry = await api.get<CompendiumEntry>(`/systems/entries/${entryId}`);
        setDetails((d) => ({ ...d, [entryId]: buildSpellDetail(entry) }));
      } catch {
        setDetails((d) => ({ ...d, [entryId]: { description: "Нет описания." } }));
      }
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
  function remove(i: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
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
  const sorted = edit ? spells : sortSpells(spells);
  const label = level === 0 ? "Заговоры" : `${level} круг`;

  return (
    <details className="dnd-spell-level-card">
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
            <PipTrack value={slots} max={MAX_SPELL_SLOTS} onChange={edit ? onSlotsChange : undefined} />
            {!edit && onUsedChange && slots > 0 && (
              <span className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
                исп.
                <PipTrack value={used ?? 0} max={slots} onChange={onUsedChange} size={13} />
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
        {sorted.length === 0 && <span className="muted">Пусто</span>}
        {sorted.map((s) => {
          const realIndex = spells.indexOf(s);
          return (
            <div key={realIndex}>
              <div
                className={`comp-row dnd-spell-row${s.prepared === 2 ? " is-prepared" : ""}${s.prepared === 1 ? " is-prepared-once" : ""}`}
              >
                <span
                  className={`comp-name dnd-spell-name${s.entryId ? " dnd-spell-name-link" : ""}`}
                  onClick={s.entryId ? () => toggleDescription(realIndex, s.entryId) : undefined}
                >
                  {s.name}
                </span>
                <SpellMetaLine s={s} />
                {edit ? (
                  <span className="comp-actions dnd-spell-actions">
                    <button
                      type="button"
                      className="comp-mini"
                      title={SPELL_PREPARED_TITLES[s.prepared]}
                      onClick={() => togglePrepared(realIndex)}
                    >
                      <NavIcon name="star" filled={s.prepared !== 0} />
                    </button>
                    <button type="button" className="comp-mini danger" onClick={() => remove(realIndex)}>
                      <NavIcon name="close" />
                    </button>
                  </span>
                ) : (
                  s.prepared > 0 && (
                    <span className="dnd-prepared-badge" title={SPELL_PREPARED_TITLES[s.prepared]}>
                      <NavIcon name="star" filled />
                    </span>
                  )
                )}
              </div>
            </div>
          );
        })}
        {expandedIndex !== null && spells[expandedIndex]?.entryId && (
          <Modal onClose={() => setExpandedIndex(null)}>
            <div className="stack dnd-spell-modal">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>{spells[expandedIndex].name}</h3>
                <button type="button" className="comp-mini" onClick={() => setExpandedIndex(null)}>
                  <NavIcon name="close" />
                </button>
              </div>
              {(() => {
                const entryId = spells[expandedIndex].entryId as number;
                const d = details[entryId];
                if (!d) return <span className="muted">Загрузка…</span>;
                const fields: [string, ReactNode][] = [
                  ["Школа", d.school],
                  ["Время накладывания", d.castingTime],
                  ["Дистанция", d.range],
                  ["Компоненты", d.componentsText],
                  ["Длительность", d.duration],
                ].filter(([, v]) => !!v) as [string, ReactNode][];
                return (
                  <>
                    {fields.length > 0 && (
                      <div className="comp-fields">
                        {fields.map(([label, value]) => (
                          <div key={label} className="muted">
                            <strong>{label}:</strong> {value}
                          </div>
                        ))}
                      </div>
                    )}
                    <MentionText text={d.description} />
                  </>
                );
              })()}
            </div>
          </Modal>
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
const DndSpellsEdit = memo(function DndSpellsEdit({
  systemId,
  cantrips,
  spellSlotLevels,
  spellSlotPips,
  spellsByLevel,
  onChange,
}: {
  systemId: number | null;
  cantrips: DndSpellEntry[];
  spellSlotLevels: number;
  spellSlotPips: number[];
  spellsByLevel: DndSpellEntry[][];
  onChange: (
    patch: Partial<Pick<DndCharacterData, "cantrips" | "spellSlotLevels" | "spellSlotPips" | "spellsByLevel">>
  ) => void;
}) {
  return (
    <div className="stack">
      <label>
        Кругов заклинаний
        <select
          value={spellSlotLevels}
          onChange={(e) => onChange({ spellSlotLevels: Number(e.target.value) })}
        >
          {Array.from({ length: SPELL_LEVELS + 1 }, (_, n) => (
            <option key={n} value={n}>
              {n === 0 ? "Нет" : n}
            </option>
          ))}
        </select>
      </label>
      <DndSpellLevelSection
        level={0}
        systemId={systemId}
        slots={0}
        spells={cantrips}
        edit
        showSlots={false}
        onSlotsChange={() => {}}
        onSpellsChange={(v) => onChange({ cantrips: v })}
      />
      {Array.from({ length: spellSlotLevels }, (_, i) => (
        <DndSpellLevelSection
          key={i}
          level={i + 1}
          systemId={systemId}
          slots={spellSlotPips[i]}
          spells={spellsByLevel[i]}
          edit
          showSlots
          onSlotsChange={(v) => {
            const next = spellSlotPips.slice();
            next[i] = v;
            onChange({ spellSlotPips: next });
          }}
          onSpellsChange={(v) => {
            const next = spellsByLevel.slice();
            next[i] = v;
            onChange({ spellsByLevel: next });
          }}
        />
      ))}
    </div>
  );
});

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
}) {
  const hasCompendiumClasses = hierarchy.classes.length > 0;
  // Lets the level input sit empty mid-edit (so the user can clear it and
  // type a fresh number) without every keystroke snapping back to "1" —
  // that only happens once, on blur, if the field was left empty.
  const [levelText, setLevelText] = useState<Record<number, string>>({});

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
    update(i, { level: n });
    onLevelChange(i, n);
  }
  function stepLevel(i: number, delta: number) {
    const n = Math.min(20, Math.max(1, classes[i].level + delta));
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
        onClick={onToggleEquipped}
      >
        {item.equipped ? "●" : "○"}
      </button>
      <input placeholder="Название" value={item.name} onChange={(e) => onChangeName(e.target.value)} style={{ flex: 2 }} />
      <input placeholder="Кол-во" value={item.qty} onChange={(e) => onChangeQty(e.target.value)} style={{ flex: 1 }} />
      <input placeholder="Вес" value={item.weight} onChange={(e) => onChangeWeight(e.target.value)} style={{ flex: 1 }} />
      <input placeholder="Заметка" value={item.notes} onChange={(e) => onChangeNotes(e.target.value)} style={{ flex: 2 }} />
      <button type="button" className="comp-mini" onClick={onRemove}>
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
  const itemsRef = useRef(section.items);
  itemsRef.current = section.items;
  const onItemsChangeRef = useRef(onItemsChange);
  onItemsChangeRef.current = onItemsChange;

  const updateItem = useCallback((ii: number, patch: Partial<DndEquipmentItem>) => {
    const next = itemsRef.current.slice();
    next[ii] = { ...next[ii], ...patch };
    onItemsChangeRef.current(next);
  }, []);
  const removeItem = useCallback((ii: number) => {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    onItemsChangeRef.current(itemsRef.current.filter((_, idx) => idx !== ii));
  }, []);
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
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  function addSection() {
    onChange([...sections, { name: "Новый раздел", items: [] }]);
  }
  const updateSectionName = useCallback((si: number, name: string) => {
    const next = sectionsRef.current.slice();
    next[si] = { ...next[si], name };
    onChangeRef.current(next);
  }, []);
  const removeSection = useCallback((si: number) => {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    onChangeRef.current(sectionsRef.current.filter((_, idx) => idx !== si));
  }, []);
  const setSectionItems = useCallback((si: number, items: DndEquipmentItem[]) => {
    const next = sectionsRef.current.slice();
    next[si] = { ...next[si], items };
    onChangeRef.current(next);
  }, []);
  const moveItem = useCallback((fromSi: number, fromIi: number, toSi: number) => {
    if (fromSi === toSi) return;
    const next = sectionsRef.current.map((s) => ({ ...s, items: s.items.slice() }));
    const [item] = next[fromSi].items.splice(fromIi, 1);
    next[toSi].items.push(item);
    onChangeRef.current(next);
  }, []);
  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, si: number) => {
      e.preventDefault();
      setDragOverSection(null);
      const movePayload = e.dataTransfer.getData(EQUIPMENT_DRAG_MIME);
      if (movePayload) {
        const { sectionIndex, itemIndex } = JSON.parse(movePayload);
        moveItem(sectionIndex, itemIndex, si);
        return;
      }
      const result = readSearchDrop(e);
      if (!result) return;
      const suffix = result.kind === "spell" ? " (свиток)" : "";
      const next = sectionsRef.current.map((s, idx) =>
        idx === si
          ? { ...s, items: [...s.items, { name: `${result.title}${suffix}`, qty: "", weight: "", notes: "" }] }
          : s
      );
      onChangeRef.current(next);
    },
    [moveItem]
  );

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

const EMPTY_EQUIPMENT_ITEM: DndEquipmentItem = { name: "", qty: "", weight: "", notes: "" };

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
        style={{ flex: "1 1 60px" }}
      />
      <input
        placeholder="Вес"
        value={draft.weight}
        onChange={(e) => onChange({ ...draft, weight: e.target.value })}
        style={{ flex: "1 1 60px" }}
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
interface StartingSet {
  label: string;
  gold: string;
  items: { entryId: number; name: string; qty: number }[];
}

function startingSetsFrom(entry: CompendiumEntry | undefined, ownerLabel: string): StartingSet[] {
  if (!entry) return [];
  const sets: StartingSet[] = [];
  for (const slot of ["a", "b"] as const) {
    const items = (entry.data[`equipment_${slot}_items`] as StartingSet["items"] | undefined) ?? [];
    const gold = (entry.data[`equipment_${slot}_gold`] as string | undefined) ?? "";
    if (items.length === 0 && !gold) continue;
    sets.push({ label: `${ownerLabel} — набор ${slot.toUpperCase()}`, gold, items });
  }
  return sets;
}

function DndEquipmentQuickView({
  sections,
  systemId,
  startingSets,
  onQuickUpdate,
}: {
  sections: DndEquipmentSection[];
  systemId: number | null;
  startingSets?: StartingSet[];
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

  useEffect(() => {
    if (addMode !== "compendium" || !systemId) return;
    loadDndEquipmentEntries(systemId).then(setOptions);
  }, [addMode, systemId]);

  // Nested function declarations below don't retain the `if (!onQuickUpdate)
  // return` narrowing above (TS control-flow narrowing doesn't cross
  // function boundaries) — capture a definitely-non-optional reference once
  // the guard has passed instead of re-checking `onQuickUpdate` at each call.
  if (!onQuickUpdate) return <DndEquipmentView sections={sections} />;
  if (sections.length === 0) return null;
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
  // Кладёт весь набор в первую секцию инвентаря одним нажатием. Мета
  // (урон, КЗ) снимается так же, как при добавлении вручную, поэтому
  // надетый доспех из набора сразу участвует в расчёте КЗ.
  async function takeStartingSet(set: StartingSet) {
    const added: DndEquipmentItem[] = [];
    for (const item of set.items) {
      const meta = await fetchEquipmentMeta(item.entryId);
      added.push({
        name: item.name,
        qty: item.qty > 1 ? String(item.qty) : "",
        weight: "",
        notes: "",
        entryId: item.entryId,
        ...meta,
      });
    }
    const next = sections.map((sec, idx) => (idx !== 0 ? sec : { ...sec, items: [...sec.items, ...added] }));
    commit({ equipmentSections: next });
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
  function removeItem(si: number, ii: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
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

  return (
    <>
      <div className="sb-section cs-mt">Снаряжение</div>
      {(startingSets ?? []).length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {(startingSets ?? []).map((set) => (
            <button key={set.label} type="button" className="comp-mini" onClick={() => takeStartingSet(set)}>
              взять: {set.label}
              {set.gold && ` (+${set.gold} ЗМ)`}
            </button>
          ))}
        </div>
      )}
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
                      onClick={() => toggleEquipped(si, ii)}
                    >
                      {item.equipped ? "●" : "○"}
                    </button>
                    <span
                      className={item.entryId ? "dnd-equipment-name-link" : undefined}
                      onClick={item.entryId ? () => toggleDescription(si, ii, item.entryId) : undefined}
                      style={{ flex: 1 }}
                    >
                      {item.name}
                      {item.qty && ` ×${item.qty}`}
                      {item.weight && ` (${item.weight})`}
                      {item.notes && ` — ${item.notes}`}
                    </span>
                    <button type="button" className="comp-mini" title="Редактировать" onClick={() => startEdit(si, ii)}>
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
function useDndOrigin(value: DndCharacterData, onChange: (v: DndCharacterData) => void) {
  const [systems, setSystems] = useState<System[]>([]);
  const [hierarchy, setHierarchy] = useState<DndClassHierarchy>({ classes: [], subclassesByClass: {} });
  const [species, setSpecies] = useState<DndSpeciesOption[]>([]);
  const [backgrounds, setBackgrounds] = useState<DndBackgroundOption[]>([]);
  const [damageTypes, setDamageTypes] = useState<DndMechanicsOption[]>([]);
  const [conditionOptions, setConditionOptions] = useState<DndMechanicsOption[]>([]);
  const [senseOptions, setSenseOptions] = useState<DndMechanicsOption[]>([]);

  // Kept in sync every render (cheap) so the field-setter callbacks below
  // can have a permanently stable identity (empty deps) while still always
  // acting on the latest value/onChange — required for React.memo on the
  // heavy child sections (FeatureListEdit ×4, DndEquipmentEdit, DndSpellsEdit,
  // DndProficienciesEdit) to actually skip re-rendering them when an
  // unrelated field on the sheet changes. Without this, a fresh inline
  // arrow function as `onChange` on every render would defeat memo just as
  // much as a fresh `value` object would.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const hierarchyRef = useRef(hierarchy);
  hierarchyRef.current = hierarchy;
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
      const revoked = mergeGrants(await loadGrants([oldClass?.classId, oldClass?.subclassId]));
      const kept = await loadGrants([
        ...value.classes.filter((_, idx) => idx !== i).flatMap((c) => [c.classId, c.subclassId]),
        value.backgroundId,
      ]);
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
            skillChoiceOptions: Array.isArray(entry.data.skill_choice_options)
              ? (entry.data.skill_choice_options as string[])
              : [],
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
      const revoked = mergeGrants(await loadGrants([removed?.classId, removed?.subclassId]));
      const kept = await loadGrants([
        ...nextClasses.flatMap((c) => [c.classId, c.subclassId]),
        value.backgroundId,
      ]);
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

  useEffect(() => {
    api.get<System[]>("/systems").then(setSystems);
  }, []);

  useEffect(() => {
    findDndSystemId().then((sid) => {
      if (!sid) return;
      loadDndMechanicsGroup(sid, "Типы урона").then(setDamageTypes);
      loadDndMechanicsGroup(sid, "Состояния").then(setConditionOptions);
      loadDndMechanicsGroup(sid, "Особое восприятие").then(setSenseOptions);
    });
  }, []);

  useEffect(() => {
    if (!value.systemId) {
      setHierarchy({ classes: [], subclassesByClass: {} });
      setSpecies([]);
      setBackgrounds([]);
      return;
    }
    loadDndClassHierarchy(value.systemId).then((h) => {
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
    });
    loadDndSpeciesOptions(value.systemId).then(setSpecies);
    loadDndBackgroundOptions(value.systemId).then(setBackgrounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.systemId]);

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
    const previous = mergeGrants(await loadGrants([value.backgroundId]));
    const revoked: SourceGrants = {
      ...previous,
      // backgroundSkillNames — то, что реально было применено к листу;
      // запись компендиума могла с тех пор измениться.
      skills: [...new Set([...previous.skills, ...value.backgroundSkillNames])],
    };
    const kept = await loadGrants(value.classes.flatMap((c) => [c.classId, c.subclassId]));
    const cleared = revokeGrants(value, revoked, kept);
    const base: DndCharacterData = { ...value, ...cleared };

    const patch: Partial<DndCharacterData> = { backgroundId: id, backgroundName: opt?.name ?? "", backgroundSkillNames: [] };
    if (id) {
      try {
        const entry = await api.get<CompendiumEntry>(`/systems/entries/${id}`);
        const grantedSkills = Array.isArray(entry.data.skills) ? (entry.data.skills as string[]) : [];
        patch.backgroundSkillNames = grantedSkills;
        if (grantedSkills.length > 0) {
          const nextSkillProfs = { ...value.skillProfs };
          for (const s of grantedSkills) if (s in nextSkillProfs && !nextSkillProfs[s]) nextSkillProfs[s] = 1;
          patch.skillProfs = nextSkillProfs;
        }
        const tools = typeof entry.data.tools === "string" ? entry.data.tools : "";
        if (tools && !value.proficiencies.some((p) => p.name === tools)) {
          patch.proficiencies = [...value.proficiencies, { entryId: null, name: tools, abilityKey: null }];
        }
        const originFeat = entry.data.origin_feat as { id: number; name: string } | undefined;
        if (originFeat && !value.feats.some((f) => f.name === originFeat.name)) {
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

export function DndCharacterEdit({
  value,
  onChange,
}: {
  value: DndCharacterData;
  onChange: (v: DndCharacterData) => void;
}) {
  const {
    systems,
    hierarchy,
    species,
    backgrounds,
    damageTypes,
    conditionOptions,
    senseOptions,
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
  } = useDndOrigin(value, onChange);

  const spellAbilityKey = characterSpellcastingAbility(value.classes);
  const spellAbilityMod = spellAbilityKey ? abilityModifier(value.abilities[spellAbilityKey]) : 0;
  const spellProfBonus = parseBonus(value.proficiencyBonus);
  const spellAttackBonus = spellAbilityMod + spellProfBonus + parseBonus(value.spellAttackMisc);
  const spellDc = 8 + spellAbilityMod + spellProfBonus + parseBonus(value.spellDcMisc);

  // Stable per-field callbacks (NARRATIVE_FIELDS never changes) so the
  // memoized MentionTextarea for one narrative field doesn't re-render just
  // because a keystroke landed in a different field or elsewhere on the sheet.
  const narrativeCallbacks = useMemo(
    () => NARRATIVE_FIELDS.map(({ key }) => (v: string) => setNarrativeField(key, v)),
    [setNarrativeField]
  );

  return (
    <div className="stack dnd-card">
      <div className="row">
        <label style={{ flex: 1 }}>
          Система (для подсказок класса/расы/предыстории)
          <select
            value={value.systemId ?? ""}
            onChange={(e) => onChange({ ...value, systemId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Не выбрана</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row">
        <input
          placeholder="Имя персонажа"
          value={value.characterName}
          onChange={(e) => onChange({ ...value, characterName: e.target.value })}
          style={{ flex: 1 }}
        />
        <input
          placeholder="Игрок"
          value={value.playerName}
          onChange={(e) => onChange({ ...value, playerName: e.target.value })}
        />
      </div>

      <DndClassesEdit
        classes={value.classes}
        hierarchy={hierarchy}
        onChange={setClasses}
        onPickClass={pickClass}
        onPickSubclass={pickSubclass}
        onLevelChange={changeClassLevel}
        onRemoveClass={removeClass}
      />

      <div className="row">
        <label style={{ flex: 1 }}>
          Вид
          {species.length > 0 ? (
            <select value={value.raceId ?? ""} onChange={(e) => pickRace(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Выбрать вид…</option>
              {species.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.creatureTypeName ? `${s.name}, ${s.creatureTypeName}` : s.name}
                </option>
              ))}
            </select>
          ) : (
            <input value={value.raceName} onChange={(e) => onChange({ ...value, raceName: e.target.value })} />
          )}
        </label>
        <label style={{ flex: 1 }}>
          Предыстория
          {backgrounds.length > 0 ? (
            <select
              value={value.backgroundId ?? ""}
              onChange={(e) => pickBackground(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Выбрать предысторию…</option>
              {backgrounds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={value.backgroundName}
              onChange={(e) => onChange({ ...value, backgroundName: e.target.value })}
            />
          )}
        </label>
      </div>

      <div className="row">
        <label>
          Бонус мастерства
          <div className="dnd-computed-field">{value.proficiencyBonus}</div>
        </label>
      </div>

      <AbilitySavesSkillsEdit
        abilities={value.abilities}
        proficiencyBonus={value.proficiencyBonus}
        savingThrowProfs={value.savingThrowProfs}
        skillProfs={value.skillProfs}
        classSkillPool={classSkillPool(value.classes)}
        classSkillChoiceCount={classSkillChoiceTotal(value.classes)}
        backgroundSkillNames={value.backgroundSkillNames}
        onAbilitiesChange={setAbilities}
        onSavingThrowProfsChange={setSavingThrowProfs}
        onSkillProfsChange={setSkillProfs}
      />

      <div className="row">
        <label>
          КЗ (вычисляется: 10/КЗ доспеха + Лов, надетые предметы, ниже)
          <input
            value={computeArmorClass(
              abilityModifier(value.abilities.dex),
              value.equipmentSections,
              parseBonus(value.manualAcBonus)
            )}
            disabled
            style={{ width: 48 }}
          />
        </label>
        <label>
          Доп. бонус к КЗ
          <input
            value={value.manualAcBonus}
            onChange={(e) => onChange({ ...value, manualAcBonus: e.target.value })}
            style={{ width: 48 }}
          />
        </label>
        <label>
          Инициатива
          <input value={value.initiative} onChange={(e) => onChange({ ...value, initiative: e.target.value })} />
        </label>
        <label>
          Скорость
          <input value={value.speed} onChange={(e) => onChange({ ...value, speed: e.target.value })} />
        </label>
        <label className="row dnd-inline-field">
          <input
            type="checkbox"
            checked={value.inspiration}
            onChange={(e) => onChange({ ...value, inspiration: e.target.checked })}
          />
          Вдохновение
        </label>
      </div>

      <SpeedEditor value={value.speeds} onChange={(v) => onChange({ ...value, speeds: v })} />
      <SensesEditor
        value={value.sensesList}
        onChange={(v) => onChange({ ...value, sensesList: v })}
        options={senseOptions}
      />
      <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
        <ChecklistEditor
          label="Уязвимости к урону"
          value={value.damageVulnerabilities}
          onChange={(v) => onChange({ ...value, damageVulnerabilities: v })}
          options={damageTypes}
        />
        <ChecklistEditor
          label="Сопротивления урону"
          value={value.damageResistances}
          onChange={(v) => onChange({ ...value, damageResistances: v })}
          options={damageTypes}
        />
        <ChecklistEditor
          label="Иммунитет к урону"
          value={value.damageImmunities}
          onChange={(v) => onChange({ ...value, damageImmunities: v })}
          options={damageTypes}
        />
        <ChecklistEditor
          label="Иммунитет к состояниям"
          value={value.conditionImmunities}
          onChange={(v) => onChange({ ...value, conditionImmunities: v })}
          options={conditionOptions}
        />
      </div>

      <div className="row">
        <label>
          ХП максимум
          <input value={value.hitPointMax} onChange={(e) => onChange({ ...value, hitPointMax: e.target.value })} />
        </label>
        <label>
          ХП текущие
          <input
            value={value.hitPointsCurrent}
            onChange={(e) => onChange({ ...value, hitPointsCurrent: e.target.value })}
          />
        </label>
        <label>
          Временные ХП
          <input
            value={value.hitPointsTemp}
            onChange={(e) => onChange({ ...value, hitPointsTemp: e.target.value })}
          />
        </label>
        <label>
          Временный макс. ХП
          <input
            value={value.hitPointMaxTemp}
            onChange={(e) => onChange({ ...value, hitPointMaxTemp: e.target.value })}
          />
        </label>
        <label>
          Кости хитов
          <input value={value.hitDice} onChange={(e) => onChange({ ...value, hitDice: e.target.value })} />
        </label>
      </div>

      <AttackListEdit values={value.attacks} onChange={setAttacks} />

      <DndEquipmentEdit sections={value.equipmentSections} onChange={setEquipmentSections} />
      <label className="row">
        Настроено предметов
        <PipTrack
          value={value.attunementCount}
          max={3}
          onChange={(n) => onChange({ ...value, attunementCount: n })}
        />
      </label>

      <AutoFeatureListEdit title="Видовые особенности" values={value.speciesFeatures} onChange={setSpeciesFeatures} />
      <AutoFeatureListEdit title="Классовые особенности" values={value.classFeatures} onChange={setClassFeatures} />
      <AutoFeatureListEdit title="Черты" values={value.feats} onChange={setFeats} allowSearchDrop />
      <FeatureListEdit title="Особые умения" values={value.specialAbilities} onChange={setSpecialAbilities} />

      <DndProficienciesEdit
        value={value.proficiencies}
        proficiencyBonus={value.proficiencyBonus}
        abilities={value.abilities}
        onChange={setProficiencies}
      />

      <details className="card">
        <summary className="sb-section" style={{ margin: 0 }}>
          Личностные качества
        </summary>
        <div className="dnd-personality-grid">
          {NARRATIVE_FIELDS.map(({ key, label }, i) => (
            <label key={key}>
              {label}
              <MentionTextarea value={value[key] as string} onChange={narrativeCallbacks[i]} rows={3} />
            </label>
          ))}
        </div>
      </details>

      <div className="sb-section" style={{ margin: 0 }}>
        Магия
      </div>
      <div className="row">
        <label>
          Сложность заклинаний
          <div className="dnd-computed-field">{spellDc}</div>
        </label>
        <label>
          Прочие бонусы к сложности
          <input
            style={{ width: 70 }}
            value={value.spellDcMisc}
            onChange={(e) => onChange({ ...value, spellDcMisc: e.target.value })}
          />
        </label>
        <label>
          Бонус к атаке заклинаниями
          <div className="dnd-computed-field">{formatModifier(spellAttackBonus)}</div>
        </label>
        <label>
          Прочие бонусы к атаке
          <input
            style={{ width: 70 }}
            value={value.spellAttackMisc}
            onChange={(e) => onChange({ ...value, spellAttackMisc: e.target.value })}
          />
        </label>
      </div>
      <label>
        Заклинания — общая информация
        <MentionTextarea value={value.spellcasting} onChange={setSpellcasting} rows={3} />
      </label>
      <DndSpellsEdit
        systemId={value.systemId}
        cantrips={value.cantrips}
        spellSlotLevels={value.spellSlotLevels}
        spellSlotPips={value.spellSlotPips}
        spellsByLevel={value.spellsByLevel}
        onChange={setSpellsPatch}
      />
    </div>
  );
}

// Requirement: features auto-filled from a class/subclass/species pick show
// like the compendium's own feature entries — a collapsible article per
// feature, collapsed by default, rather than always-visible text.

// One row of the "Бой" tab's unified Атаки table — either a structured
// weapon/spell (bonus/damage/range each their own column) or a hand-written
// freeform attack (no structured fields, so its description spans the rest
// of the row instead of forcing three empty cells).
interface AttackRow {
  name: string;
  bonus: string;
  damage: string;
  range: string;
  description?: string;
  timing: DndActionTiming;
}

// Equipped weapons show up as attack rows automatically — no need to
// duplicate a weapon's damage/properties into a separate hand-written entry
// once it's marked "надето". Attack bonus assumes proficiency (this app
// doesn't track weapon-proficiency booleans separately) and picks the
// higher of STR/DEX for finesse weapons, DEX for ranged-only, STR otherwise.
function weaponAttackRows(
  sections: DndEquipmentSection[],
  abilities: DndCharacterData["abilities"],
  profBonus: number
): AttackRow[] {
  const str = abilityModifier(abilities.str);
  const dex = abilityModifier(abilities.dex);
  return sections
    .flatMap((s) => s.items)
    .filter((i) => i.equipped && i.weaponDamage)
    .map((i) => {
      const finesse = (i.weaponProperties ?? "").includes("Фехтовальное");
      const mod = finesse ? Math.max(str, dex) : i.weaponAttackRanged && !i.weaponAttackMelee ? dex : str;
      const range = i.weaponAttackMelee && i.weaponAttackRanged ? "Ближний/Дальний" : i.weaponAttackRanged ? "Дальний" : "Ближний";
      const damage = [i.weaponDamage, i.weaponProperties, i.weaponMastery && `Мастерство: ${i.weaponMastery}`]
        .filter(Boolean)
        .join(" · ");
      return { name: i.name, bonus: formatModifier(mod + profBonus), damage, range, timing: "action" as const };
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
  const preparedCantrips = cantrips.filter((s) => s.prepared > 0);
  const prepared = spellsByLevel.flat().filter((s) => s.prepared > 0);
  return [...preparedCantrips, ...prepared]
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

function AttacksTable({ title, rows }: { title: string; rows: AttackRow[] }) {
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
            <tr key={i}>
              <td data-label="Название">{r.name}</td>
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

const DND_VIEW_TABS = ["Действия", "Навыки", "Заклинания", "Инвентарь", "Ресурсы", "Особенности", "Досье"] as const;
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
  onQuickUpdate,
}: {
  abilities: DndCharacterData["abilities"];
  proficiencyBonus: string;
  skillProfs: Record<string, DndSkillProfLevel>;
  classSkillPool: string[];
  backgroundSkillNames: string[];
  proficiencies: DndProficiencyEntry[];
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const profBonus = parseBonus(proficiencyBonus);
  const rows = useMemo(() => {
    const all: { skill: string; abilityKey: DndAbilityKey; abilityLabel: string }[] = [];
    for (const { key, label } of ABILITY_LABELS) {
      for (const skill of SKILLS_BY_ABILITY[key]) all.push({ skill, abilityKey: key, abilityLabel: label });
    }
    const prefs = loadDndPrefs();
    if (prefs.skillSortMode === "alphabet") {
      return [...all].sort((a, b) => a.skill.localeCompare(b.skill, "ru"));
    }
    return all;
  }, []);

  return (
    <div className="stack">
      <div className="dnd-save-skill-col dnd-skills-tab">
        {rows.map(({ skill, abilityKey, abilityLabel }) => {
          const mod = abilityModifier(abilities[abilityKey]);
          const level = skillProfs[skill] ?? 0;
          return (
            <div
              key={skill}
              className={`dnd-save-row${level > 0 ? " is-proficient" : ""}${level === 2 ? " is-expertise" : ""}${skillSourceClass(skill, pool, backgroundSkillNames)}`}
            >
              <button
                type="button"
                className="dnd-save-dot-btn"
                title={SKILL_TITLES[level]}
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
                {skill} <span className="muted">({abilityLabel})</span>
              </span>
              <span className="dnd-save-value">{computeSkillValue(mod, level, profBonus)}</span>
            </div>
          );
        })}
      </div>
      <DndProficienciesView
        value={proficiencies}
        onChange={onQuickUpdate ? (v) => onQuickUpdate({ proficiencies: v }) : undefined}
      />
    </div>
  );
}

function SbFeatureGroup({ title, values }: { title: string; values: DndFeature[] }) {
  // Same popup-on-click treatment as spells (DndSpellLevelSection) — a
  // feature's full text opens in a modal instead of expanding inline, so a
  // long description doesn't push everything else on the tab down/off-screen
  // on a phone.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (values.length === 0) return null;
  return (
    <details className="cs-list" open>
      <summary className="sb-section">{title}</summary>
      {values.map((f, i) => (
        <div key={i} className="dnd-feature-row" onClick={() => setOpenIndex(i)}>
          {f.name || "Без названия"}
          {f.level ? <span className="muted"> (ур. {f.level})</span> : null}
        </div>
      ))}
      {openIndex !== null && (
        <Modal onClose={() => setOpenIndex(null)}>
          <div className="stack dnd-spell-modal">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>
                {values[openIndex].name || "Без названия"}
                {values[openIndex].level ? <span className="muted"> (ур. {values[openIndex].level})</span> : null}
              </h3>
              <button type="button" className="comp-mini" onClick={() => setOpenIndex(null)}>
                <NavIcon name="close" />
              </button>
            </div>
            <MentionText text={values[openIndex].description} />
          </div>
        </Modal>
      )}
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
            {classLine && <div style={{ fontSize: 12.5, opacity: 0.8 }}>{classLine}</div>}
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
}: {
  value: DndCharacterData;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
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
        <div
          className="sb-value"
          style={onQuickUpdate ? { cursor: "pointer" } : undefined}
          onClick={onQuickUpdate ? openEditor : undefined}
        >
          {value.hitPointsCurrent || "—"} / {value.hitPointMax || "—"}
          {value.hitPointsTemp ? ` (+${value.hitPointsTemp})` : ""}
        </div>
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
    const patch = { hitPointsTemp: String(tempNow - fromTemp), hitPointsCurrent: String(curNow - rest) };
    onQuickUpdate(patch);
    setDraft((d) => ({ ...d, ...patch }));
    setAmount("");
  }
  function applyHeal() {
    const n = Number(amount) || 0;
    if (n <= 0) return;
    const curNow = Number(value.hitPointsCurrent) || 0;
    const cap = (Number(value.hitPointMax) || 0) + (Number(value.hitPointMaxTemp) || 0);
    const healed = cap > 0 ? Math.min(curNow + n, cap) : curNow + n;
    onQuickUpdate({ hitPointsCurrent: String(healed) });
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
        <div
          className="sb-value"
          style={onQuickUpdate ? { cursor: "pointer" } : undefined}
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
        </div>
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
        <div
          className="sb-value"
          style={onQuickUpdate ? { cursor: "pointer" } : undefined}
          title={onQuickUpdate ? "Нажмите, чтобы задать доп. бонус к КЗ" : undefined}
          onClick={
            onQuickUpdate
              ? () => {
                  setDraft(manualBonus);
                  setEditing(true);
                }
              : undefined
          }
        >
          {computed}
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
      className="comp-mini dnd-tab-edit-toggle"
      title={editing ? "Сохранить" : "Редактировать"}
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
function DndResourcesView({
  sources,
  abilities,
  resourceUsed,
  resourceBonus,
  onQuickUpdate,
}: {
  sources: ClassResourceSource[];
  abilities: DndCharacterData["abilities"];
  resourceUsed: Record<string, number>;
  resourceBonus: Record<string, number>;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const resources = allResources(sources, abilities);
  const stats = applicableStats(sources);
  if (resources.length === 0 && stats.length === 0)
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
              <label className="row muted" style={{ gap: 4, fontSize: 12 }}>
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
              max={max}
              onChange={
                onQuickUpdate ? (v) => onQuickUpdate({ resourceUsed: { ...resourceUsed, [r.key]: v } }) : undefined
              }
            />
          </div>
        );
      })}
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
  onQuickUpdate,
  onClose,
}: {
  value: DndCharacterData;
  onQuickUpdate: (patch: Partial<DndCharacterData>) => void;
  onClose: () => void;
}) {
  function longRest() {
    if (!confirm("Провести длинный отдых? Слоты заклинаний, очки ресурсов и хиты будут восстановлены.")) return;
    const resetResourceUsed: Record<string, number> = {};
    for (const key of Object.keys(value.resourceUsed)) resetResourceUsed[key] = 0;
    onQuickUpdate({
      spellSlotsUsed: value.spellSlotsUsed.map(() => 0),
      // Договор магии восстанавливается и на коротком отдыхе, но короткий
      // отдых здесь чисто справочный, так что сбрасываем хотя бы тут.
      pactSlotsUsed: 0,
      resourceUsed: resetResourceUsed,
      hitPointsCurrent: value.hitPointMax,
      hitPointsTemp: "0",
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
    });
    onClose();
  }
  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-spell-modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Отдых</h3>
          <button type="button" className="comp-mini" onClick={onClose}>
            <NavIcon name="close" />
          </button>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <strong>Короткий отдых</strong>
          {value.hitDice ? (
            <p className="muted" style={{ margin: 0 }}>
              Доступные кости хитов: {value.hitDice}. Потратьте их, чтобы восстановить хиты — трекер расхода костей
              хитов на этом листе не ведётся, отмечайте расход самостоятельно.
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Кость хитов не указана в чарнике.
            </p>
          )}
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <strong>Длинный отдых</strong>
          <p className="muted" style={{ margin: 0 }}>
            {/* Перечислять ресурсы поимённо больше не выходит: их состав
                теперь зависит от таблиц развития, а диалог отдыха о записях
                компендиума ничего не знает. Сбрасываются всё равно все. */}
            Восстановит хиты до максимума, сбросит спасброски от смерти, все слоты заклинаний и
            ресурсы классов.
          </p>
          <button type="button" className="primary" onClick={longRest} style={{ alignSelf: "flex-start" }}>
            Провести длинный отдых
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function DndCharacterView({
  value,
  compact,
  onQuickUpdate,
  headerExtra,
}: {
  value: DndCharacterData;
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
}) {
  // Hook must run unconditionally (before the compact early-return) per the
  // Rules of Hooks — each DndCharacterView instance keeps its own tab state
  // locally (not URL-synced) since a page can render several statblocks at
  // once (e.g. a bestiary list), which would collide on a shared query param.
  const [tab, setTab] = useState<DndViewTab>("Действия");
  // Живые данные компендиума для всех заклинаний и умений листа — одной
  // пачкой на весь лист, а не запросом на запись (см. entryCache.ts).
  const getEntry = useCompendiumEntries(sheetEntryIds(value));
  const systemIdForSlots = value.systemId;
  // Per-section edit toggles for "Особенности" (only "Особые умения" is
  // user-authored — species/class/feats are inherited compendium content and
  // stay read-only) and "Досье" — separate from StatblockList's whole-card
  // editMode, which swaps in the entire DndCharacterEdit form. Draft state is
  // local (not saved on every keystroke, unlike the single-click quick edits
  // elsewhere on this sheet) — an explicit "Сохранить" commits via
  // onQuickUpdate, "Отмена" discards.
  const [draftSpecial, setDraftSpecial] = useState<DndFeature[] | null>(null);
  const [draftDossier, setDraftDossier] = useState<Pick<
    DndCharacterData,
    "personalityTraits" | "ideals" | "bonds" | "flaws"
  > | null>(null);
  // Same idea as draftSpecial/draftDossier above, but these two commit on
  // every keystroke like the rest of the sheet (no local draft to lose) —
  // the pencil just toggles between the compact quick-view and the fuller
  // structural editor for that one tab, without touching StatblockList's
  // whole-card editMode.
  const [editingInventory, setEditingInventory] = useState(false);
  const [editingSpells, setEditingSpells] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  // Запасные таблицы подгружаются лениво и только когда без них не обойтись
  // (многоклассье без полного заклинателя) — обычному персонажу лишний
  // запрос ни к чему.
  const [fallbackProgressions, setFallbackProgressions] = useState<(ClassProgression | undefined)[]>([]);
  const isMobile = useIsMobile();
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
  // Стартовые наборы: у каждого класса персонажа и у предыстории.
  const startingSets = [
    ...value.classes.flatMap((c) => startingSetsFrom(getEntry(c.classId), c.className)),
    ...startingSetsFrom(getEntry(value.backgroundId), value.backgroundName || "Предыстория"),
  ];
  const resourceSources: ClassResourceSource[] = value.classes.map((c) => ({
    entry: c,
    progression: getEntry(c.classId)?.data.progression as ClassProgression | undefined,
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
  const spellAttackBonus = spellAbilityMod + spellProfBonus + parseBonus(value.spellAttackMisc);
  const spellDc = 8 + spellAbilityMod + spellProfBonus + parseBonus(value.spellDcMisc);
  const perceptionProf = value.skillProfs["Внимание/восприятие"] ?? 0;
  const passivePerception =
    10 + abilityModifier(value.abilities.wis) + parseBonus(value.proficiencyBonus) * perceptionProf;
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
    <div className="sb-scope">
      <div className="sb-card">
        <div className="sb-head">
          <div className="sb-head-row">
            <div>
              <div className="sb-name">{value.characterName || "Без имени"}</div>
              {metaChunks.length > 0 && (
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
                <button type="button" className="comp-mini" title="Отдых" onClick={() => setRestOpen(true)}>
                  <NavIcon name="moon" /> Отдых
                </button>
              )}
              {headerExtra}
            </span>
          </div>
        </div>
        {restOpen && (
          <DndRestModal
            value={value}
            onQuickUpdate={onQuickUpdate!}
            onClose={() => setRestOpen(false)}
          />
        )}
        <div className="sb-body">
          {/* §1.11: постоянные ячейки — то, на что игрок смотрит каждый ход.
              Условные показываются, только когда им есть что сказать:
              спасброски от смерти на здоровом персонаже были шумом в самом
              плотном месте листа. Пассивное восприятие и бонус мастерства
              нужны часто, но не каждый ход — они ушли строкой-подписью под
              ячейками, где не отнимают ширину у хитов и КЗ. */}
          <div className="sb-vitals">
            <AcQuickBox computed={computedAc} manualBonus={value.manualAcBonus} onQuickUpdate={onQuickUpdate} />
            <HpQuickBox value={value} onQuickUpdate={onQuickUpdate} />
            <TextQuickBox label="Инициатива" value={value.initiative} field="initiative" onQuickUpdate={onQuickUpdate} />
            {(value.speed || formatSpeed(value.speeds)) && (
              <div>
                <div className="sb-label">Скорость</div>
                <div className="sb-value">{value.speed || formatSpeed(value.speeds)}</div>
              </div>
            )}
            {value.hitDice && (
              <div>
                <div className="sb-label">Кость хитов</div>
                <div className="sb-value">{value.hitDice}</div>
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
                      max={3}
                      size={12}
                      onChange={onQuickUpdate ? (v) => onQuickUpdate({ deathSaveSuccesses: v }) : undefined}
                    />
                  </span>
                  <span className="row muted">
                    −
                    <PipTrack
                      value={value.deathSaveFailures}
                      max={3}
                      size={12}
                      onChange={onQuickUpdate ? (v) => onQuickUpdate({ deathSaveFailures: v }) : undefined}
                    />
                  </span>
                </div>
              </div>
            )}
            {(value.inspiration || onQuickUpdate) && (
              <div>
                <div className="sb-label">Вдохновение</div>
                <div
                  className="sb-value sb-inspiration"
                  role={onQuickUpdate ? "button" : undefined}
                  tabIndex={onQuickUpdate ? 0 : undefined}
                  aria-pressed={onQuickUpdate ? value.inspiration : undefined}
                  onClick={onQuickUpdate ? () => onQuickUpdate({ inspiration: !value.inspiration }) : undefined}
                  onKeyDown={
                    onQuickUpdate
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onQuickUpdate({ inspiration: !value.inspiration });
                          }
                        }
                      : undefined
                  }
                >
                  {value.inspiration ? <NavIcon name="star" filled /> : "—"}
                </div>
              </div>
            )}
          </div>

          <div className="sb-vitals-caption">
            <span>
              <span className="sb-prop-label">Пасс. восприятие</span> {passivePerception}
            </span>
            {value.proficiencyBonus && (
              <span>
                <span className="sb-prop-label">Бонус мастерства</span> {value.proficiencyBonus}
              </span>
            )}
          </div>

          <AbilitySavesSkillsView
            abilities={value.abilities}
            proficiencyBonus={value.proficiencyBonus}
            savingThrowProfs={value.savingThrowProfs}
            skillProfs={value.skillProfs}
            classSkillPool={classSkillPool(value.classes)}
            backgroundSkillNames={value.backgroundSkillNames}
          />

          {isMobile ? (
            // Same 6+1 sections as the desktop tab row, but a 7-button strip
            // wraps onto 2-3 cramped rows on a phone — a dropdown picker
            // keeps the current section's name always visible and gets the
            // rest of the list out of the way until tapped.
            <select
              className="dnd-section-picker"
              value={tab}
              onChange={(e) => setTab(e.target.value as DndViewTab)}
            >
              {DND_VIEW_TABS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : (
            <div className="tabs">
              {DND_VIEW_TABS.map((t) => (
                <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}

          {tab === "Действия" && (
            <div className="stack">
              {(() => {
                // Вкладка собирает всё, что персонаж может применить, из
                // всех источников сразу: оружие, заклинания, умения классов,
                // видов, черт и вручную вписанные атаки. Раньше она звалась
                // «Бой» и знала только про первые три.
                const allRows = [
                  ...weaponAttackRows(value.equipmentSections, value.abilities, parseBonus(value.proficiencyBonus)),
                  ...combatSpellRows(liveCantrips, liveSpellsByLevel, spellAttackBonus, spellDc),
                  ...featureActionRows(liveFeatureGroups, spellAttackBonus, spellDc),
                  ...manualAttackRows(value.attacks),
                ];
                const byTiming = (t: DndActionTiming) => allRows.filter((r) => r.timing === t);
                return (
                  <>
                    <AttacksTable title="Действия" rows={byTiming("action")} />
                    <AttacksTable title="Бонусные действия" rows={byTiming("bonus")} />
                    <AttacksTable title="Реакции" rows={byTiming("reaction")} />
                    <AttacksTable title="Особое" rows={byTiming("other")} />
                  </>
                );
              })()}
            </div>
          )}

          {tab === "Заклинания" && (
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
                  {value.spellcasting && (
                    <div className="sb-entry" style={{ whiteSpace: "pre-wrap" }}>
                      <MentionText text={value.spellcasting} />
                    </div>
                  )}
                </>
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
                      max={computedSlots.pact.count}
                      onChange={onQuickUpdate ? (v) => onQuickUpdate({ pactSlotsUsed: v }) : undefined}
                      size={13}
                    />
                  </span>
                </div>
              )}
              <DndSpellsView
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
              abilities={value.abilities}
              proficiencyBonus={value.proficiencyBonus}
              skillProfs={value.skillProfs}
              classSkillPool={classSkillPool(value.classes)}
              backgroundSkillNames={value.backgroundSkillNames}
              proficiencies={value.proficiencies}
              onQuickUpdate={onQuickUpdate}
            />
          )}

          {tab === "Инвентарь" && (
            <div>
              {onQuickUpdate && (
                <TabEditToggle editing={editingInventory} onToggle={() => setEditingInventory((v) => !v)} />
              )}
              {editingInventory ? (
                <DndEquipmentEdit
                  sections={value.equipmentSections}
                  onChange={(next) => onQuickUpdate?.({ equipmentSections: next })}
                />
              ) : (
                <DndEquipmentQuickView
                  sections={value.equipmentSections}
                  systemId={value.systemId}
                  startingSets={startingSets}
                  onQuickUpdate={onQuickUpdate}
                />
              )}
              {value.attunementCount > 0 && (
                <div className="sb-entry">
                  <span className="sb-prop-label">Настроено предметов</span>{" "}
                  <PipTrack value={value.attunementCount} max={3} />
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
              onQuickUpdate={onQuickUpdate}
            />
          )}

          {tab === "Особенности" && (
            <div>
              <SbFeatureGroup title="Видовые особенности" values={value.speciesFeatures} />
              <SbFeatureGroup title="Классовые особенности" values={value.classFeatures} />
              <SbFeatureGroup title="Черты" values={value.feats} />
              {draftSpecial ? (
                <>
                  <FeatureListEdit title="Особые умения" values={draftSpecial} onChange={setDraftSpecial} />
                  <div className="row" style={{ marginTop: 6, alignItems: "center" }}>
                    <TabEditToggle
                      editing
                      onToggle={() => {
                        onQuickUpdate?.({ specialAbilities: draftSpecial });
                        setDraftSpecial(null);
                      }}
                    />
                    <button type="button" onClick={() => setDraftSpecial(null)}>
                      Отмена
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <SbFeatureGroup title="Особые умения" values={value.specialAbilities} />
                  {onQuickUpdate && (
                    <TabEditToggle editing={false} onToggle={() => setDraftSpecial([...value.specialAbilities])} />
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
                      onChange={(v) => setDraftDossier({ ...draftDossier, [dossierKey]: v })}
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
