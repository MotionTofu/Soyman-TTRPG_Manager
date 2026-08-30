import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { LitmThemeBookBody, LitmTreasureBody, LitmMagicWayBody, LitmThemeKitBody } from "./litm/LitmCompendiumBodies";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { addToBag } from "../bag";
import { StatblockList } from "./StatblockList";
import { StatblockIcon, statblockBadgeTitle } from "./StatblockIcon";
import { NavIcon } from "./NavIcons";
import { EffectList } from "./dnd/EffectList";
import { ProgressionEditor, ProgressionView } from "./dnd/ProgressionEditor";
import { StartingEquipmentPicker, type StartingEquipmentPick } from "./dnd/StartingEquipmentPicker";
import { EMPTY_PROGRESSION, type ClassProgression } from "./dnd/progression";
import { EMPTY_COST, type DndCheck, type DndCost, type DndEffect } from "./dnd/effects";
import {
  ABILITY_SCORES,
  ARMOR_TYPES,
  CREATURE_SIZES,
  VEHICLE_CATEGORIES,
  EQUIPMENT_CATEGORIES,
  FEAT_CATEGORIES,
  KIND_DEFS,
  kindLabel,
  visibleMonsterFields,
  MAGIC_ITEM_RARITIES,
  MAGIC_ITEM_TYPES,
  MECHANICS_TOOL_GROUP,
  type FieldDef,
} from "../compendium";
import { EMPTY_MECHANICS_OPTIONS, loadMechanicsOptions, type MechanicsOptions } from "../compendiumMechanics";
import { ALL_SKILLS } from "./dnd/AbilityScores";
import type { CompendiumEntry, SearchResult, SystemSection } from "../types";

interface Props {
  systemId: number;
  section: SystemSection;
  focusEntryId?: number;
}

interface MechanicsOption {
  id: number;
  name: string;
}

interface MechanicsPick extends MechanicsOption {
  distance: string;
}

// A pick can go stale if the mechanics-list item it points to gets deleted
// and recreated under the same name (new id) — the old pick then lingers
// invisibly in the picker (its id no longer matches any current option) but
// stays in `data`, producing visible "Ходьба, Ходьба" duplicates. Dedupe by
// name everywhere picks are read or written so this can't accumulate, and
// keep the LAST occurrence (the freshest pick, since a stale one is always
// the one appended earliest historically).
function dedupeByName<T extends { name: string }>(list: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of list) map.set(item.name, item);
  return [...map.values()];
}

// Groups "Обретаемые заклинания" by the level they're granted at (species:
// total character level; subclass: that class's own level — the character
// sheet decides which) for the read-only summary, e.g. "Ур. 1: A, B; Ур. 3: C".
function formatGrantedSpellsByLevel(spells: { name: string; grantLevel?: number }[]): string {
  const byLevel = new Map<number, string[]>();
  for (const s of spells) {
    const level = typeof s.grantLevel === "number" && s.grantLevel > 0 ? s.grantLevel : 1;
    const names = byLevel.get(level) ?? [];
    names.push(s.name);
    byLevel.set(level, names);
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, names]) => `ур. ${level}: ${names.join(", ")}`)
    .join("; ");
}

// Best-effort migration for class entries saved before requirement 11
// (checkboxes): "Основная характеристика"/"Спасброски" used to be free text
// like "Интеллект и Мудрость" — matched against the known ability names so
// that data isn't silently dropped the first time an old class is opened.
function parseLegacyAbilityText(text: string | undefined): string[] {
  if (!text) return [];
  return ABILITY_SCORES.filter((a) => text.includes(a));
}

// Same idea for a background's "Владения навыками" free-text field
// (requirement 5/7): matched against the known skill list.
function parseLegacySkillText(text: string | undefined): string[] {
  if (!text) return [];
  return ALL_SKILLS.filter((s) => text.includes(s));
}

// Best-effort migration for a spell's old free-text "Компоненты" field
// (e.g. "В, С, М (свеча)") into the В/С/М checkboxes + material description
// (requirement 3).
function parseLegacyComponents(text: string | undefined): {
  v: boolean;
  s: boolean;
  m: boolean;
  material: string;
} {
  if (!text) return { v: false, s: false, m: false, material: "" };
  const materialMatch = /\(([^)]+)\)/.exec(text);
  return {
    v: /(^|[^А-Яа-я])В([^А-Яа-я]|$)/.test(text),
    s: /(^|[^А-Яа-я])С([^А-Яа-я]|$)/.test(text),
    m: /(^|[^А-Яа-я])М([^А-Яа-я]|$)/.test(text),
    material: materialMatch ? materialMatch[1] : "",
  };
}

// Best-effort migration for a spell's old free-text "Школа" field into a
// pick from the new "Школы магии" mechanics list (requirement 6) — matches
// by exact name (case-insensitive) so existing data isn't lost on upgrade.
function resolveLegacySchool(raw: unknown, schools: MechanicsOption[]): MechanicsOption | null {
  if (raw && typeof raw === "object" && "id" in raw && "name" in raw) return raw as MechanicsOption;
  if (typeof raw === "string" && raw.trim()) {
    const lower = raw.trim().toLowerCase();
    return schools.find((s) => s.name.toLowerCase() === lower) ?? null;
  }
  return null;
}

// Distances that are almost always the same value in practice — pre-filled
// when a pick is checked, still freely editable afterwards.
const DEFAULT_DISTANCE_BY_NAME: Record<string, string> = {
  "Ходьба": "30",
  "Тёмное зрение": "60",
};

interface EditDraft {
  id: number;
  name: string;
  level: string;
  data: Record<string, string>;
  description: string;
  // Species-only structured picks, sourced from the system's "Механики" lists.
  creatureType: MechanicsOption | null;
  senses: MechanicsPick[];
  speeds: MechanicsPick[];
  // Shared by everything that can be *applied* — spells, class/species
  // features, class options, magic items. Deliberately not spell-only: the
  // old attack_save/damage/healing fields were, and that's why a paladin's
  // Lay on Hands had nowhere to say it heals. See effects.ts.
  checks: DndCheck[];
  effects: DndEffect[];
  cost: DndCost;
  // Spell-only.
  ritual: boolean;
  concentration: boolean;
  spellClasses: MechanicsOption[];
  spellSchool: MechanicsOption | null;
  componentV: boolean;
  componentS: boolean;
  componentM: boolean;
  materialComponent: string;
  // Background-only.
  abilities: string[];
  originFeat: MechanicsOption | null;
  equipmentA: string;
  // Ссылки на записи снаряжения для наборов А и Б; текст выше остаётся
  // читаемым описанием и хранит то, чего в компендиуме ещё нет.
  equipmentAItems: StartingEquipmentPick[];
  equipmentBItems: StartingEquipmentPick[];
  equipmentAGold: string;
  equipmentBGold: string;
  equipmentB: string;
  backgroundSkills: string[];
  // Class-only.
  primaryAbilities: string[];
  spellcastingAbility: string;
  savingThrows: string[];
  weaponProfs: MechanicsPick[];
  armorProfs: MechanicsPick[];
  toolProfs: MechanicsPick[];
  skillChoiceCount: string;
  skillChoiceOptions: string[];
  progressionTable: string;
  // Структурная таблица развития (см. dnd/progression.ts). progressionTable
  // выше — исходный markdown, оставленный как читаемый дубликат и источник
  // для повторного разбора.
  progression: ClassProgression;
  // Species/subclass-only: spells granted when this species/subclass is
  // picked on a character sheet, always shown there as "prepared".
  // grantLevel is the character sheet level (species: total character
  // level; subclass: that class's own level) at which the spell is
  // obtained — not the spell's own circle/level.
  grantedSpells: { id: number; name: string; grantLevel: number }[];
  // Species/subclass/class_option-only: when checked, the granted spells
  // aren't limited (e.g. a warlock invocation that grants at-will casting
  // rather than a once-per-rest use) — purely informational, doesn't change
  // how the character sheet auto-fills the spell.
  unlimitedGrantedSpells: boolean;
  // Magic item-only. Empty itemClasses means "available to every class".
  itemAttunement: boolean;
  itemClasses: MechanicsOption[];
  // Equipment/magic_item-only, shown when category/item_type is "Оружие" or
  // "Доспехи" — see getExtraFields below for the plain-text/select fields
  // (damage, ac, …) which go through the generic `data` map instead.
  weaponProperties: MechanicsPick[];
  weaponMastery: MechanicsOption | null;
  attackMelee: boolean;
  attackRanged: boolean;
  armorDexBonus: boolean;
  armorStealthDisadvantage: boolean;
}

// Extra structured fields injected into an entry's field list beyond its
// KIND_DEFS base — scoped by category/item_type (weapon/armor/tool) or, for
// mechanic_item, by which mechanics group it lives directly under (tool
// proficiencies only). Kept out of KIND_DEFS itself since these only apply
// to a subset of entries of that kind, not the kind as a whole.
const TOOL_ABILITY_FIELD: FieldDef = {
  key: "ability",
  label: "Характеристика",
  type: "select",
  options: [...ABILITY_SCORES],
};
const TOOL_USAGE_FIELD: FieldDef = { key: "usage", label: "Использование", type: "textarea" };
const TOOL_CRAFT_EXAMPLE_FIELD: FieldDef = { key: "craft_example", label: "Пример крафта", type: "textarea" };
const WEAPON_DAMAGE_FIELD: FieldDef = { key: "damage", label: "Урон", type: "text" };
const ARMOR_TYPE_FIELD: FieldDef = { key: "armor_type", label: "Тип доспеха", type: "select", options: [...ARMOR_TYPES] };
const ARMOR_AC_FIELD: FieldDef = { key: "ac", label: "Класс Защиты", type: "text" };
const ARMOR_MAX_DEX_FIELD: FieldDef = { key: "max_dex_bonus", label: "Максимальный бонус от Ловкости", type: "text" };
const ARMOR_STR_REQ_FIELD: FieldDef = { key: "str_requirement", label: "Требование Силы", type: "text" };
// Flat КЗ bonus that stacks on top of the base КЗ formula — shields, rings
// of protection, etc. Separate from ARMOR_AC_FIELD (which replaces the base
// КЗ for actual armor); this one just adds.
const AC_BONUS_FIELD: FieldDef = { key: "ac_bonus", label: "Бонус к КЗ", type: "text" };

function getExtraFields(entry: CompendiumEntry, parentGroupName?: string): FieldDef[] {
  if (entry.kind === "mechanic_item") {
    if (parentGroupName === "Могущество и Темы") {
      if (!entry.data?.level) return [];
      return [
        { key: "default_theme_types", label: "Типы тем (через запятую)", type: "textarea" },
        { key: "scale_tags", label: "Примеры ключей силы (через запятую)", type: "textarea" },
        { key: "weight", label: "Вес ступени (1/2/3)", type: "text" },
        { key: "level", label: "ключ:", type: "select", options: ["origin", "adventure", "greatness", "variable"] },
      ];
    }
    return parentGroupName === MECHANICS_TOOL_GROUP ? [TOOL_ABILITY_FIELD] : [];
  }
  const category =
    entry.kind === "equipment"
      ? (entry.data.category as string | undefined)
      : entry.kind === "magic_item"
      ? (entry.data.item_type as string | undefined)
      : undefined;
  if (category === "Оружие") return [WEAPON_DAMAGE_FIELD];
  if (category === "Доспехи") return [ARMOR_TYPE_FIELD, ARMOR_AC_FIELD, ARMOR_MAX_DEX_FIELD, ARMOR_STR_REQ_FIELD, AC_BONUS_FIELD];
  if (entry.kind === "equipment" && (category === "Инструменты" || category === "Ремесленные инструменты")) {
    return category === "Ремесленные инструменты"
      ? [TOOL_ABILITY_FIELD, TOOL_USAGE_FIELD, TOOL_CRAFT_EXAMPLE_FIELD]
      : [TOOL_ABILITY_FIELD, TOOL_USAGE_FIELD];
  }
  if (entry.kind === "magic_item") return [AC_BONUS_FIELD];
  return [];
}

// A class the spell-availability picker can offer, with its subclasses kept
// separate (collapsed by default — requirement 8) rather than flattened.
type SortMode = "manual" | "alpha" | "level" | "school" | "type" | "rarity";
type SortDir = "asc" | "desc";

interface ClassGroupOption {
  id: number;
  name: string;
  // storedName carries the "Класс — Подкласс" label persisted on the pick
  // (kept for requirement 10's Классы:/Подклассы: split of old data);
  // displayName is the bare subclass name shown once nested under its class.
  subclasses: { id: number; displayName: string; storedName: string }[];
}

// Loads the classes+subclasses a spell can be tagged with, grouped by class
// (requirement 8: classes listed alphabetically, subclasses collapsed under
// an expand toggle instead of always-visible in one long flat list).
async function loadClassOptions(systemId: number): Promise<ClassGroupOption[]> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const classSection = sections.find((s) => s.kind === "class");
  if (!classSection) return [];
  const entries = await api.get<CompendiumEntry[]>(
    `/systems/${systemId}/entries?section_id=${classSection.id}`
  );
  const classes = entries
    .filter((e) => e.kind === "class" && e.parent_id === null)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return classes.map((c) => ({
    id: c.id,
    name: c.name,
    subclasses: entries
      .filter((e) => e.kind === "subclass" && e.parent_id === c.id)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((s) => ({ id: s.id, displayName: s.name, storedName: `${c.name} — ${s.name}` })),
  }));
}

// Loads feat entries (from anywhere in the system) tagged with the "Черта
// происхождения" category — the pickable pool for a background's origin feat.
async function loadOriginFeatOptions(systemId: number): Promise<MechanicsOption[]> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const featSections = sections.filter((s) => s.kind === "feat");
  const results: MechanicsOption[] = [];
  for (const section of featSections) {
    const entries = await api.get<CompendiumEntry[]>(
      `/systems/${systemId}/entries?section_id=${section.id}`
    );
    for (const e of entries) {
      if (e.kind === "feat" && e.data.category === "Черта происхождения") {
        results.push({ id: e.id, name: e.name });
      }
    }
  }
  return results;
}

interface ClassHierarchy {
  classes: MechanicsOption[];
  subclassesByClass: Record<number, MechanicsOption[]>;
}
const EMPTY_CLASS_HIERARCHY: ClassHierarchy = { classes: [], subclassesByClass: {} };

// Same source data as loadClassOptions, but kept as a class -> subclasses tree
// instead of a flattened list, for the cascading class/subclass filter.
async function loadClassHierarchy(systemId: number): Promise<ClassHierarchy> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const classSection = sections.find((s) => s.kind === "class");
  if (!classSection) return EMPTY_CLASS_HIERARCHY;
  const entries = await api.get<CompendiumEntry[]>(
    `/systems/${systemId}/entries?section_id=${classSection.id}`
  );
  const classes = entries
    .filter((e) => e.kind === "class" && e.parent_id === null)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }));
  const subclassesByClass: Record<number, MechanicsOption[]> = {};
  for (const c of classes) {
    subclassesByClass[c.id] = entries
      .filter((e) => e.kind === "subclass" && e.parent_id === c.id)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, name: s.name }));
  }
  return { classes, subclassesByClass };
}

function spellLevelLabel(level: number): string {
  return level === 0 ? "Заговоры" : `${level} уровень`;
}

// Entry kinds that carry checks/effects/cost. Spells are the obvious one,
// but a fighter's Second Wind and a paladin's Lay on Hands are the same
// shape — an effect plus a cost — and so are magic items with charges.
const EFFECT_KINDS = new Set(["spell", "feature", "class_option", "magic_item", "equipment"]);

function groupByLevel(list: CompendiumEntry[], dir: SortDir = "asc"): [number, CompendiumEntry[]][] {
  const map = new Map<number, CompendiumEntry[]>();
  for (const e of list) {
    const lvl = e.level ?? 0;
    if (!map.has(lvl)) map.set(lvl, []);
    map.get(lvl)!.push(e);
  }
  const entries = [...map.entries()].sort((a, b) => (dir === "asc" ? a[0] - b[0] : b[0] - a[0]));
  return entries;
}

const NO_SCHOOL_LABEL = "Без школы";

function groupBySchool(list: CompendiumEntry[], dir: SortDir = "asc"): [string, CompendiumEntry[]][] {
  const map = new Map<string, CompendiumEntry[]>();
  for (const e of list) {
    const name = (e.data.school as MechanicsOption | undefined)?.name || NO_SCHOOL_LABEL;
    if (!map.has(name)) map.set(name, []);
    map.get(name)!.push(e);
  }
  const keys = [...map.keys()].sort((a, b) => {
    if (a === NO_SCHOOL_LABEL) return 1;
    if (b === NO_SCHOOL_LABEL) return -1;
    const cmp = a.localeCompare(b, "ru");
    return dir === "asc" ? cmp : -cmp;
  });
  return keys.map((k) => [k, map.get(k)!]);
}

const NO_CATEGORY_LABEL = "Без категории";

// Groups entries by a `data.<field>` value, ordered per the given fixed
// category list (feat/equipment categories), with anything unset or outside
// that list collected into a trailing "Без категории" bucket.
function groupByCategory(
  list: CompendiumEntry[],
  field: string,
  categories: readonly string[],
  dir: SortDir = "asc"
): [string, CompendiumEntry[]][] {
  const map = new Map<string, CompendiumEntry[]>();
  for (const e of list) {
    const cat = (e.data[field] as string | undefined) || NO_CATEGORY_LABEL;
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(e);
  }
  const order = dir === "asc" ? [...categories, NO_CATEGORY_LABEL] : [...[...categories].reverse(), NO_CATEGORY_LABEL];
  return order.filter((c) => map.has(c)).map((c) => [c, map.get(c)!]);
}

export function CompendiumSection({ systemId, section, focusEntryId }: Props) {
  const [entries, setEntries] = useState<CompendiumEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [mechanicsOptions, setMechanicsOptions] = useState<MechanicsOptions>(EMPTY_MECHANICS_OPTIONS);
  const [classOptions, setClassOptions] = useState<ClassGroupOption[]>([]);
  const [classHierarchy, setClassHierarchy] = useState<ClassHierarchy>(EMPTY_CLASS_HIERARCHY);
  const [originFeatOptions, setOriginFeatOptions] = useState<MechanicsOption[]>([]);
  const [filterLevel, setFilterLevel] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [filterSubclass, setFilterSubclass] = useState("");
  const [filterRitual, setFilterRitual] = useState("");
  const [filterSchool, setFilterSchool] = useState("");
  const [filterItemType, setFilterItemType] = useState("");
  const [filterRarity, setFilterRarity] = useState("");
  const [filterItemClass, setFilterItemClass] = useState("");
  const [filterAttunement, setFilterAttunement] = useState("");
  const [filterVehicleCategory, setFilterVehicleCategory] = useState("");
  const [filterSize, setFilterSize] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const raw = localStorage.getItem(`compendium-sort-${section.id}`);
    const stored = raw?.split(":")[0] as SortMode | null;
    const valid: SortMode[] = ["manual", "alpha", "level", "school", "type", "rarity"];
    return stored && valid.includes(stored) ? stored : (section.kind === "spell" ? "level" : "manual");
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const raw = localStorage.getItem(`compendium-sort-${section.id}`);
    const dir = raw?.split(":")[1] as SortDir | undefined;
    return dir === "desc" ? "desc" : "asc";
  });
  const [dragId, setDragId] = useState<number | null>(null);
  const [systemCode, setSystemCode] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ code: string | null }>(`/systems/${systemId}`).then((s) => setSystemCode(s.code)).catch(() => setSystemCode(null));
  }, [systemId]);

  const isSpellSection = section.kind === "spell";
  const isMagicItemSection = section.kind === "magic_item";
  const isEquipmentSection = section.kind === "equipment";
  const isVehicleSection = section.kind === "vehicle";

  function changeSortMode(mode: SortMode) {
    if (mode === "manual") {
      setSortMode(mode);
      setSortDir("asc");
      localStorage.setItem(`compendium-sort-${section.id}`, `${mode}:asc`);
      return;
    }
    if (mode === sortMode) {
      setSortDir((prev) => {
        const next = prev === "asc" ? "desc" : "asc";
        localStorage.setItem(`compendium-sort-${section.id}`, `${mode}:${next}`);
        return next;
      });
    } else {
      setSortMode(mode);
      setSortDir("asc");
      localStorage.setItem(`compendium-sort-${section.id}`, `${mode}:asc`);
    }
  }

  // useCallback — не украшение: `sortForDisplay` уходит в nodeProps и в мемо
  // плиток, новая функция на каждый рендер перерисовывала бы всё дерево.
  const sortForDisplay = useCallback(
    (list: CompendiumEntry[]): CompendiumEntry[] => {
      if (sortMode === "alpha") {
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, "ru"));
        return sortDir === "asc" ? sorted : sorted.reverse();
      }
      if (sortMode === "level") {
        // Для заклинаний уровень не используется в flat-сортировке, но
        // сохраняем единый путь: уровень уже группирует, здесь не сортируем.
        return list;
      }
      return list;
    },
    [sortMode, sortDir]
  );

  // Manual drag-n-drop reorder — only meaningful within one sibling group
  // (same parent_id/level), matching how `position` is scoped server-side.
  async function reorderWithinGroup(group: CompendiumEntry[], draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const ids = group.map((e) => e.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    setEntries((prev) => {
      const order = new Map(ids.map((id, i) => [id, i]));
      return prev.map((e) => (order.has(e.id) ? { ...e, position: order.get(e.id)! } : e));
    });
    await api.put(`/systems/${systemId}/entries/reorder`, { order: ids });
  }

  function refresh() {
    api
      .get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${section.id}`)
      .then(setEntries);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [systemId, section.id]);

  useEffect(() => {
    if (isSpellSection || isMagicItemSection) {
      loadClassOptions(systemId).then(setClassOptions);
      loadClassHierarchy(systemId).then(setClassHierarchy);
    }
    if (isSpellSection || isEquipmentSection || isMagicItemSection) {
      // Needed for the school/creature-type filter dropdowns above the list
      // and for the pickers inside each entry's edit form (weapon
      // properties/mastery for equipment and magic-item weapons/armor).
      loadMechanicsOptions(systemId).then(setMechanicsOptions);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, isSpellSection, isMagicItemSection, isEquipmentSection]);

  // Deep-link support: expand every ancestor of the mentioned entry and
  // scroll it into view once its data has loaded.
  useEffect(() => {
    if (!focusEntryId || entries.length === 0) return;
    const byId = new Map(entries.map((e) => [e.id, e]));
    const toExpand = new Set<number>();
    let cur = byId.get(focusEntryId);
    while (cur && cur.parent_id != null) {
      toExpand.add(cur.parent_id);
      cur = byId.get(cur.parent_id);
    }
    if (toExpand.size > 0) {
      setExpanded((prev) => new Set([...prev, ...toExpand]));
    }
    const el = document.getElementById(`comp-entry-${focusEntryId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEntryId, entries]);

  const childrenOf = useMemo(() => {
    const map = new Map<number | null, CompendiumEntry[]>();
    for (const e of entries) {
      const key = e.parent_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return (parentId: number | null) => map.get(parentId) ?? [];
  }, [entries]);

  // Free-text name filter across the whole tree, not just top level — the
  // main gap flagged for dense sections like Классы (654 buried features)
  // where drilling down manually to find one entry is impractical. Matches
  // and their ancestor chain stay visible; everything else is pruned out of
  // childrenOf below. Ancestors also get auto-expanded (same one-way
  // expand-on-match pattern as the focusEntryId deep-link effect above) so
  // a match isn't hidden behind a collapsed parent.
  const [searchQuery, setSearchQuery] = useState("");

  const searchVisible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const byId = new Map(entries.map((e) => [e.id, e]));
    const visible = new Set<number>();
    const toExpand = new Set<number>();
    for (const e of entries) {
      if (!e.name.toLowerCase().includes(q)) continue;
      visible.add(e.id);
      let cur = e;
      while (cur.parent_id != null) {
        if (visible.has(cur.parent_id)) break;
        visible.add(cur.parent_id);
        toExpand.add(cur.parent_id);
        const parent = byId.get(cur.parent_id);
        if (!parent) break;
        cur = parent;
      }
    }
    return { visible, toExpand };
  }, [searchQuery, entries]);

  useEffect(() => {
    if (!searchVisible || searchVisible.toExpand.size === 0) return;
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of searchVisible.toExpand) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [searchVisible]);

  const effectiveChildrenOf = searchVisible
    ? (parentId: number | null) => childrenOf(parentId).filter((e) => searchVisible.visible.has(e.id))
    : childrenOf;

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function addEntry(parentId: number | null, kind: string, levelOverride?: number) {
    const created = await api.post<CompendiumEntry>(`/systems/${systemId}/entries`, {
      section_id: section.id,
      parent_id: parentId,
      kind,
      name: "",
      level: levelOverride ?? (KIND_DEFS[kind]?.hasLevel ? 1 : null),
      data: {},
      description: "",
    });
    if (parentId != null) setExpanded((prev) => new Set(prev).add(parentId));
    refresh();
    startEdit(created);
  }

  function startEdit(entry: CompendiumEntry) {
    const parent = entries.find((e) => e.id === entry.parent_id);
    const data: Record<string, string> = {};
    const rawFields = [...(KIND_DEFS[entry.kind]?.fields ?? []), ...getExtraFields(entry, parent?.name)];
    const fields = entry.kind === "monster" ? visibleMonsterFields(rawFields, systemCode) : rawFields;
    for (const f of fields) {
      data[f.key] = entry.data[f.key] != null ? String(entry.data[f.key]) : "";
    }
    const legacyComponents = parseLegacyComponents(entry.data.components as string | undefined);
    setEditing({
      id: entry.id,
      name: entry.name,
      level: entry.level != null ? String(entry.level) : "",
      data,
      description: entry.description,
      creatureType: (entry.data.creature_type as MechanicsOption | undefined) ?? null,
      senses: dedupeByName((entry.data.senses as MechanicsPick[] | undefined) ?? []),
      speeds: dedupeByName((entry.data.speeds as MechanicsPick[] | undefined) ?? []),
      checks: (entry.data.checks as DndCheck[] | undefined) ?? [],
      effects: (entry.data.effects as DndEffect[] | undefined) ?? [],
      cost: (entry.data.cost as DndCost | undefined) ?? EMPTY_COST,
      ritual: !!entry.data.ritual,
      concentration: !!entry.data.concentration,
      spellClasses: (entry.data.classes as MechanicsOption[] | undefined) ?? [],
      spellSchool: resolveLegacySchool(entry.data.school, mechanicsOptions.schools),
      componentV: entry.data.component_v != null ? !!entry.data.component_v : legacyComponents.v,
      componentS: entry.data.component_s != null ? !!entry.data.component_s : legacyComponents.s,
      componentM: entry.data.component_m != null ? !!entry.data.component_m : legacyComponents.m,
      materialComponent:
        (entry.data.material_component as string | undefined) ?? legacyComponents.material,
      abilities: (entry.data.abilities as string[] | undefined) ?? [],
      originFeat: (entry.data.origin_feat as MechanicsOption | undefined) ?? null,
      equipmentA: (entry.data.equipment_a as string | undefined) ?? "",
      equipmentAItems: (entry.data.equipment_a_items as StartingEquipmentPick[] | undefined) ?? [],
      equipmentBItems: (entry.data.equipment_b_items as StartingEquipmentPick[] | undefined) ?? [],
      equipmentAGold: (entry.data.equipment_a_gold as string | undefined) ?? "",
      equipmentBGold: (entry.data.equipment_b_gold as string | undefined) ?? "",
      equipmentB: (entry.data.equipment_b as string | undefined) ?? "",
      backgroundSkills: Array.isArray(entry.data.skills)
        ? (entry.data.skills as string[])
        : parseLegacySkillText(entry.data.skills as string | undefined),
      primaryAbilities: Array.isArray(entry.data.primary_abilities)
        ? (entry.data.primary_abilities as string[])
        : parseLegacyAbilityText(entry.data.primary as string | undefined),
      savingThrows: Array.isArray(entry.data.saving_throws)
        ? (entry.data.saving_throws as string[])
        : parseLegacyAbilityText(entry.data.saves as string | undefined),
      weaponProfs: dedupeByName((entry.data.weapon_profs as MechanicsPick[] | undefined) ?? []),
      armorProfs: dedupeByName((entry.data.armor_profs as MechanicsPick[] | undefined) ?? []),
      toolProfs: dedupeByName((entry.data.tool_profs as MechanicsPick[] | undefined) ?? []),
      spellcastingAbility: (entry.data.spellcasting_ability as string | undefined) ?? "",
      skillChoiceCount: entry.data.skill_choice_count != null ? String(entry.data.skill_choice_count) : "",
      skillChoiceOptions: (entry.data.skill_choice_options as string[] | undefined) ?? [],
      progressionTable: (entry.data.progression_table as string | undefined) ?? "",
      progression: (entry.data.progression as ClassProgression | undefined) ?? EMPTY_PROGRESSION,
      grantedSpells: (
        (entry.data.granted_spells as { id: number; name: string; grantLevel?: number }[] | undefined) ?? []
      ).map((s) => ({ id: s.id, name: s.name, grantLevel: typeof s.grantLevel === "number" ? s.grantLevel : 1 })),
      unlimitedGrantedSpells: !!entry.data.unlimited,
      itemAttunement: !!entry.data.attunement,
      itemClasses: (entry.data.classes as MechanicsOption[] | undefined) ?? [],
      weaponProperties: dedupeByName((entry.data.weapon_properties as MechanicsPick[] | undefined) ?? []),
      weaponMastery: (entry.data.weapon_mastery as MechanicsOption | undefined) ?? null,
      attackMelee: !!entry.data.attack_melee,
      attackRanged: !!entry.data.attack_ranged,
      armorDexBonus: !!entry.data.dex_bonus,
      armorStealthDisadvantage: !!entry.data.stealth_disadvantage,
    });
    if (entry.kind === "magic_item" && classOptions.length === 0) {
      loadClassOptions(systemId).then(setClassOptions);
    }
    if (
      entry.kind === "species" ||
      entry.kind === "class" ||
      entry.kind === "monster" ||
      entry.kind === "equipment" ||
      entry.kind === "magic_item"
    ) {
      loadMechanicsOptions(systemId).then((opts) => {
        setMechanicsOptions(opts);
        // Prune picks whose id no longer matches any current option — these
        // are orphaned by a deleted-and-recreated (or renamed) mechanics
        // list item and have no checkbox to uncheck them by otherwise.
        const senseIds = new Set(opts.senses.map((o) => o.id));
        const speedIds = new Set(opts.speeds.map((o) => o.id));
        const typeIds = new Set(opts.creatureTypes.map((o) => o.id));
        const weaponIds = new Set(opts.weapons.map((o) => o.id));
        const armorIds = new Set(opts.armor.map((o) => o.id));
        const toolIds = new Set(opts.tools.map((o) => o.id));
        setEditing((prev) =>
          prev && prev.id === entry.id
            ? {
                ...prev,
                senses: prev.senses.filter((s) => senseIds.has(s.id)),
                speeds: prev.speeds.filter((s) => speedIds.has(s.id)),
                creatureType: prev.creatureType && typeIds.has(prev.creatureType.id) ? prev.creatureType : null,
                weaponProfs: prev.weaponProfs.filter((s) => weaponIds.has(s.id)),
                armorProfs: prev.armorProfs.filter((s) => armorIds.has(s.id)),
                toolProfs: prev.toolProfs.filter((s) => toolIds.has(s.id)),
              }
            : prev
        );
      });
    }
    if (entry.kind === "spell" && classOptions.length === 0) {
      loadClassOptions(systemId).then(setClassOptions);
    }
    if (entry.kind === "background") {
      loadOriginFeatOptions(systemId).then(setOriginFeatOptions);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const original = entries.find((e) => e.id === editing.id);
    if (original?.kind === "background" && editing.abilities.length > 0 && editing.abilities.length !== 3) {
      alert("Выберите ровно 3 характеристики (или ни одной).");
      return;
    }
    const data: Record<string, unknown> = { ...editing.data };
    if (original?.kind === "species") {
      data.creature_type = editing.creatureType;
      data.senses = editing.senses;
      data.speeds = editing.speeds;
      data.granted_spells = editing.grantedSpells;
      data.unlimited = editing.unlimitedGrantedSpells;
    }
    if (original?.kind === "subclass" || original?.kind === "class_option") {
      data.granted_spells = editing.grantedSpells;
      data.unlimited = editing.unlimitedGrantedSpells;
    }
    if (original?.kind === "monster") {
      data.creature_type = editing.creatureType;
    }
    if (original?.kind === "magic_item") {
      data.attunement = editing.itemAttunement;
      data.classes = editing.itemClasses;
    }
    if (original?.kind === "equipment" || original?.kind === "magic_item") {
      data.weapon_properties = editing.weaponProperties;
      data.weapon_mastery = editing.weaponMastery;
      data.attack_melee = editing.attackMelee;
      data.attack_ranged = editing.attackRanged;
      data.dex_bonus = editing.armorDexBonus;
      data.stealth_disadvantage = editing.armorStealthDisadvantage;
    }
    if (original && EFFECT_KINDS.has(original.kind)) {
      data.checks = editing.checks;
      data.effects = editing.effects;
      data.cost = editing.cost;
    }
    if (original?.kind === "spell") {
      data.ritual = editing.ritual;
      data.concentration = editing.concentration;
      data.classes = editing.spellClasses;
      data.school = editing.spellSchool;
      data.component_v = editing.componentV;
      data.component_s = editing.componentS;
      data.component_m = editing.componentM;
      data.material_component = editing.materialComponent;
    }
    if (original?.kind === "background") {
      data.abilities = editing.abilities;
      data.origin_feat = editing.originFeat;
      data.equipment_a = editing.equipmentA;
      data.equipment_a_items = editing.equipmentAItems;
      data.equipment_b_items = editing.equipmentBItems;
      data.equipment_a_gold = editing.equipmentAGold;
      data.equipment_b_gold = editing.equipmentBGold;
      data.equipment_b = editing.equipmentB;
      data.skills = editing.backgroundSkills;
    }
    if (original?.kind === "class") {
      data.primary_abilities = editing.primaryAbilities;
      data.spellcasting_ability = editing.spellcastingAbility;
      data.saving_throws = editing.savingThrows;
      data.weapon_profs = editing.weaponProfs;
      data.armor_profs = editing.armorProfs;
      data.tool_profs = editing.toolProfs;
      data.equipment_a = editing.equipmentA;
      data.equipment_a_items = editing.equipmentAItems;
      data.equipment_b_items = editing.equipmentBItems;
      data.equipment_a_gold = editing.equipmentAGold;
      data.equipment_b_gold = editing.equipmentBGold;
      data.equipment_b = editing.equipmentB;
      data.skill_choice_count = editing.skillChoiceCount ? Number(editing.skillChoiceCount) : 0;
      data.skill_choice_options = editing.skillChoiceOptions;
      data.progression_table = editing.progressionTable;
      data.progression = editing.progression;
    }
    await api.put(`/systems/entries/${editing.id}`, {
      name: editing.name || "Без названия",
      level: editing.level ? Number(editing.level) : null,
      data,
      description: editing.description,
    });
    await syncMentionLinks(
      "compendium_entry",
      editing.id,
      original?.description ?? "",
      editing.description
    );
    setEditing(null);
    refresh();
  }

  async function remove(entry: CompendiumEntry) {
    const kids = childrenOf(entry.id);
    const msg =
      kids.length > 0
        ? `Удалить «${entry.name}» и все вложенные записи (${kids.length})?`
        : `Удалить «${entry.name}»?`;
    if (!confirm(msg)) return;
    await api.del(`/systems/entries/${entry.id}`);
    refresh();
  }

  const topLevel = effectiveChildrenOf(null);
  const rootKind = section.kind === "wiki" ? "wiki" : section.kind;
  const categoryGroups: readonly string[] | null =
    section.kind === "feat" ? FEAT_CATEGORIES : section.kind === "equipment" ? EQUIPMENT_CATEGORIES : null;

  // Фильтры одни и те же на каждый ре-рендер, но результат обязан быть
  // стабильным по ссылке: дерево ниже кэширует группы через useMemo, и новый
  // массив каждый рендер сводил бы этот кэш к нулю.
  const filteredTopLevel = useMemo(() => {
    if (isSpellSection)
      return topLevel.filter((e) => {
        if (filterLevel !== "" && (e.level ?? 0) !== Number(filterLevel)) return false;
        if (filterClass !== "") {
          const classes = (e.data.classes as MechanicsOption[] | undefined) ?? [];
          const classId = Number(filterClass);
          if (filterSubclass !== "") {
            // Subclass narrows further, but a spell tagged at the whole-class
            // level (not any specific subclass) still counts as available.
            const subclassId = Number(filterSubclass);
            if (!classes.some((c) => c.id === subclassId || c.id === classId)) return false;
          } else {
            // Class only: match the class itself or any of its subclasses.
            const subclassIds = new Set((classHierarchy.subclassesByClass[classId] ?? []).map((s) => s.id));
            if (!classes.some((c) => c.id === classId || subclassIds.has(c.id))) return false;
          }
        }
        if (filterRitual === "yes" && !e.data.ritual) return false;
        if (filterRitual === "no" && e.data.ritual) return false;
        if (filterSchool !== "") {
          const school = e.data.school as MechanicsOption | undefined;
          if (school?.id !== Number(filterSchool)) return false;
        }
        return true;
      });
    if (isMagicItemSection)
      return topLevel.filter((e) => {
        if (filterItemType !== "" && e.data.item_type !== filterItemType) return false;
        if (filterRarity !== "" && e.data.rarity !== filterRarity) return false;
        if (filterItemClass !== "") {
          // Empty classes on the item means "available to every class", so
          // it always matches regardless of which class is filtered on.
          const classes = (e.data.classes as MechanicsOption[] | undefined) ?? [];
          if (classes.length > 0) {
            const classId = Number(filterItemClass);
            const subclassIds = new Set((classHierarchy.subclassesByClass[classId] ?? []).map((s) => s.id));
            if (!classes.some((c) => c.id === classId || subclassIds.has(c.id))) return false;
          }
        }
        if (filterAttunement === "yes" && !e.data.attunement) return false;
        if (filterAttunement === "no" && e.data.attunement) return false;
        return true;
      });
    if (isVehicleSection)
      return topLevel.filter((e) => {
        if (filterVehicleCategory !== "" && (e.data.category as string | undefined) !== filterVehicleCategory)
          return false;
        if (filterSize !== "" && (e.data.size as string | undefined) !== filterSize) return false;
        return true;
      });
    return topLevel;
  }, [
    topLevel,
    isSpellSection,
    isMagicItemSection,
    isVehicleSection,
    filterLevel,
    filterClass,
    filterSubclass,
    filterRitual,
    filterSchool,
    filterItemType,
    filterRarity,
    filterItemClass,
    filterAttunement,
    filterVehicleCategory,
    filterSize,
    classHierarchy,
  ]);

  const nodeProps = {
    expanded,
    editing,
    childrenOf: effectiveChildrenOf,
    mechanicsOptions,
    classOptions,
    originFeatOptions,
    onToggle: toggle,
    onEdit: startEdit,
    onDelete: remove,
    onAddChild: addEntry,
    onDraftChange: setEditing,
    onSave: saveEdit,
    onCancel: () => setEditing(null),
    focusEntryId,
    sortMode,
    dragId,
    onDragStartEntry: setDragId,
    onDropEntry: reorderWithinGroup,
    sortForDisplay,
    systemCode,
  };

  const magicItemGroups: [string, CompendiumEntry[]][] | null = !isMagicItemSection
    ? null
    : sortMode === "type"
    ? groupByCategory(sortForDisplay(filteredTopLevel), "item_type", MAGIC_ITEM_TYPES, sortDir)
    : sortMode === "rarity"
    ? groupByCategory(sortForDisplay(filteredTopLevel), "rarity", MAGIC_ITEM_RARITIES, sortDir)
    : null;

  return (
    <div className="card stack">
      {section.kind === "mechanics" && <h4 style={{ margin: 0 }}>Общее</h4>}
      <div className="row sort-toggle" style={{ gap: 4 }}>
        <span className="muted">Сортировка:</span>
        <button
          className={sortMode === "alpha" ? "active-sort" : ""}
          onClick={() => changeSortMode("alpha")}
          title={sortMode === "alpha" ? (sortDir === "asc" ? "А-Я (повтор — Я-А)" : "Я-А (повтор — А-Я)") : "А-Я"}
        >
          {sortMode === "alpha" ? (sortDir === "asc" ? "А-Я ↑" : "Я-А ↓") : "А-Я"}
        </button>
        <button
          className={sortMode === "manual" ? "active-sort" : ""}
          onClick={() => changeSortMode("manual")}
        >
          Вручную
        </button>
        {isSpellSection && (
          <>
            <button
              className={sortMode === "level" ? "active-sort" : ""}
              onClick={() => changeSortMode("level")}
            >
              По уровню{sortMode === "level" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
            </button>
            <button
              className={sortMode === "school" ? "active-sort" : ""}
              onClick={() => changeSortMode("school")}
            >
              По школе{sortMode === "school" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
            </button>
          </>
        )}
        {isMagicItemSection && (
          <>
            <button
              className={sortMode === "type" ? "active-sort" : ""}
              onClick={() => changeSortMode("type")}
            >
              По типу{sortMode === "type" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
            </button>
            <button
              className={sortMode === "rarity" ? "active-sort" : ""}
              onClick={() => changeSortMode("rarity")}
            >
              По редкости{sortMode === "rarity" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
            </button>
          </>
        )}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <input
          type="text"
          placeholder="Поиск по названию…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        {searchQuery !== "" && (
          <button type="button" className="comp-mini" title="Очистить поиск" onClick={() => setSearchQuery("")}>
            <NavIcon name="close" />
          </button>
        )}
      </div>
      {isMagicItemSection && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          <select value={filterItemType} onChange={(e) => setFilterItemType(e.target.value)}>
            <option value="">Все типы</option>
            {MAGIC_ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={filterRarity} onChange={(e) => setFilterRarity(e.target.value)}>
            <option value="">Все редкости</option>
            {MAGIC_ITEM_RARITIES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select value={filterItemClass} onChange={(e) => setFilterItemClass(e.target.value)}>
            <option value="">Все классы</option>
            {classHierarchy.classes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select value={filterAttunement} onChange={(e) => setFilterAttunement(e.target.value)}>
            <option value="">Настройка: неважно</option>
            <option value="yes">Требует настройки</option>
            <option value="no">Без настройки</option>
          </select>
        </div>
      )}
      {isSpellSection && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
            <option value="">Все уровни</option>
            {Array.from({ length: 10 }, (_, lvl) => (
              <option key={lvl} value={lvl}>
                {spellLevelLabel(lvl)}
              </option>
            ))}
          </select>
          <select value={filterSchool} onChange={(e) => setFilterSchool(e.target.value)}>
            <option value="">Все школы</option>
            {mechanicsOptions.schools.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select
            value={filterClass}
            onChange={(e) => {
              setFilterClass(e.target.value);
              setFilterSubclass("");
            }}
          >
            <option value="">Все классы</option>
            {classHierarchy.classes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {filterClass !== "" && (classHierarchy.subclassesByClass[Number(filterClass)]?.length ?? 0) > 0 && (
            <select value={filterSubclass} onChange={(e) => setFilterSubclass(e.target.value)}>
              <option value="">Любой подкласс</option>
              {classHierarchy.subclassesByClass[Number(filterClass)].map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <select value={filterRitual} onChange={(e) => setFilterRitual(e.target.value)}>
            <option value="">Ритуал: неважно</option>
            <option value="yes">Только ритуалы</option>
            <option value="no">Без ритуалов</option>
          </select>
        </div>
      )}
      {isVehicleSection && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          <select value={filterVehicleCategory} onChange={(e) => setFilterVehicleCategory(e.target.value)}>
            <option value="">Все категории</option>
            {VEHICLE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={filterSize} onChange={(e) => setFilterSize(e.target.value)}>
            <option value="">Все размеры</option>
            {CREATURE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="comp-list">
        {isSpellSection
          ? sortMode === "school"
            ? groupBySchool(sortForDisplay(filteredTopLevel), sortDir).map(
                ([label, list]) => [label, list] as [string, CompendiumEntry[]]
              ).map(([label, list]) => (
                <details key={label} className="comp-category">
                  <summary className="comp-level-label chevron-summary">
                    <NavIcon name="chevron" className="chevron-icon" />
                    {label} <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", fontWeight: 400 }}>· {list.length}</span>
                  </summary>
                  {list.map((e) => (
                    <SortableRow key={e.id} entry={e} group={list} sortMode={sortMode} dragId={dragId} onDragStartEntry={setDragId} onDropEntry={reorderWithinGroup}>
                      <EntryNode entry={e} depth={0} {...nodeProps} />
                    </SortableRow>
                  ))}
                </details>
              ))
            : sortMode === "level"
            ? groupByLevel(sortForDisplay(filteredTopLevel), sortDir).map(
                ([lvl, list]) => [spellLevelLabel(lvl), list, lvl] as [string, CompendiumEntry[], number | undefined]
              ).map(([label, list, level]) => (
                <details key={label} className="comp-category">
                  <summary className="comp-level-label chevron-summary">
                    <NavIcon name="chevron" className="chevron-icon" />
                    {label} <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", fontWeight: 400 }}>· {list.length}</span>
                  </summary>
                  {level !== undefined && (
                    <button
                      type="button"
                      className="comp-mini"
                      title={`Добавить заклинание — ${label.toLowerCase()}`}
                      onClick={() => addEntry(null, "spell", level)}
                      style={{ marginBottom: 6 }}
                    >
                      + Добавить заклинание
                    </button>
                  )}
                  {list.map((e) => (
                    <SortableRow key={e.id} entry={e} group={list} sortMode={sortMode} dragId={dragId} onDragStartEntry={setDragId} onDropEntry={reorderWithinGroup}>
                      <EntryNode entry={e} depth={0} {...nodeProps} />
                    </SortableRow>
                  ))}
                </details>
              ))
            : sortForDisplay(filteredTopLevel).map((e) => (
                <SortableRow key={e.id} entry={e} group={filteredTopLevel} sortMode={sortMode} dragId={dragId} onDragStartEntry={setDragId} onDropEntry={reorderWithinGroup}>
                  <EntryNode entry={e} depth={0} {...nodeProps} />
                </SortableRow>
              ))
          : categoryGroups
          ? groupByCategory(sortForDisplay(topLevel), "category", categoryGroups, sortDir).map(([cat, list]) => (
              <details key={cat} className="comp-category">
                <summary className="comp-level-label chevron-summary">
                  <NavIcon name="chevron" className="chevron-icon" />
                  {cat}
                </summary>
                {list.map((e) => (
                  <SortableRow key={e.id} entry={e} group={list} sortMode={sortMode} dragId={dragId} onDragStartEntry={setDragId} onDropEntry={reorderWithinGroup}>
                    <EntryNode entry={e} depth={0} {...nodeProps} />
                  </SortableRow>
                ))}
              </details>
            ))
          : isMagicItemSection && magicItemGroups
          ? magicItemGroups.map(([cat, list]) => (
              <details key={cat} className="comp-category" open>
                <summary className="comp-level-label chevron-summary">
                  <NavIcon name="chevron" className="chevron-icon" />
                  {cat}
                </summary>
                {list.map((e) => (
                  <SortableRow key={e.id} entry={e} group={list} sortMode={sortMode} dragId={dragId} onDragStartEntry={setDragId} onDropEntry={reorderWithinGroup}>
                    <EntryNode entry={e} depth={0} {...nodeProps} />
                  </SortableRow>
                ))}
              </details>
            ))
          : isMagicItemSection
          ? sortForDisplay(filteredTopLevel).map((e) => (
              <SortableRow key={e.id} entry={e} group={filteredTopLevel} sortMode={sortMode} dragId={dragId} onDragStartEntry={setDragId} onDropEntry={reorderWithinGroup}>
                <EntryNode entry={e} depth={0} {...nodeProps} />
              </SortableRow>
            ))
          : sortForDisplay(topLevel).map((e) => (
              <SortableRow key={e.id} entry={e} group={topLevel} sortMode={sortMode} dragId={dragId} onDragStartEntry={setDragId} onDropEntry={reorderWithinGroup}>
                <EntryNode entry={e} depth={0} {...nodeProps} />
              </SortableRow>
            ))}
        {topLevel.length === 0 && (
          <p className="muted">
            {searchQuery.trim() ? `Ничего не найдено по «${searchQuery.trim()}».` : "Пока пусто."}
          </p>
        )}
        {(isSpellSection || isMagicItemSection) && topLevel.length > 0 && filteredTopLevel.length === 0 && (
          <p className="muted">Ничего не найдено по фильтрам.</p>
        )}
      </div>
      {section.kind !== "mechanics" && (
        <button style={{ alignSelf: "flex-start" }} onClick={() => addEntry(null, rootKind)}>
          + Добавить {kindLabel(rootKind).toLowerCase()}
        </button>
      )}
    </div>
  );
}

interface NodeProps {
  entry: CompendiumEntry;
  depth: number;
  expanded: Set<number>;
  editing: EditDraft | null;
  childrenOf: (parentId: number | null) => CompendiumEntry[];
  mechanicsOptions: MechanicsOptions;
  classOptions: ClassGroupOption[];
  originFeatOptions: MechanicsOption[];
  onToggle: (id: number) => void;
  onEdit: (entry: CompendiumEntry) => void;
  onDelete: (entry: CompendiumEntry) => void;
  onAddChild: (parentId: number | null, kind: string) => void;
  onDraftChange: (draft: EditDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  focusEntryId?: number;
  sortMode: SortMode;
  dragId: number | null;
  onDragStartEntry: (id: number) => void;
  onDropEntry: (group: CompendiumEntry[], draggedId: number, targetId: number) => void;
  sortForDisplay: (list: CompendiumEntry[]) => CompendiumEntry[];
  parentGroupName?: string;
  systemCode?: string | null;
}

// Drop target for one row when the section is in manual sort mode — shared
// by the top-level list and by ChildGroups. The drag *source* is a small
// handle rendered inside EntryNode's row (see .comp-drag-handle below), not
// this wrapper: making the whole row draggable used to block native text
// selection anywhere in the entry (name, description, fields).
function SortableRow({
  entry,
  group,
  sortMode,
  dragId,
  onDropEntry,
  children,
}: {
  entry: CompendiumEntry;
  group: CompendiumEntry[];
  sortMode: SortMode;
  dragId: number | null;
  onDragStartEntry: (id: number) => void;
  onDropEntry: (group: CompendiumEntry[], draggedId: number, targetId: number) => void;
  children: ReactNode;
}) {
  return (
    <div
      onDragOver={(ev) => sortMode === "manual" && ev.preventDefault()}
      onDrop={(ev) => {
        if (sortMode !== "manual" || dragId == null) return;
        ev.preventDefault();
        onDropEntry(group, dragId, entry.id);
      }}
    >
      {children}
    </div>
  );
}

function EntryNode(props: NodeProps) {
  const { entry, expanded, editing, childrenOf, mechanicsOptions, classOptions, originFeatOptions } = props;
  // LitM: ступень Могущества темы — красит строку и даёт подпись-чип.
  const litmMight = (entry.data?.might ?? entry.data?.level ?? "") as string;
  const [linkCopied, setLinkCopied] = useState(false);
  async function copyLink() {
    const url = `${window.location.origin}/systems/${entry.system_id}?section=${entry.section_id}&entry=${entry.id}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  }
  const def = KIND_DEFS[entry.kind];
  const systemCode = props.systemCode;
  const isOpen = expanded.has(entry.id);
  const isEditing = editing?.id === entry.id;
  const isSpecies = entry.kind === "species";
  const isSubclass = entry.kind === "subclass";
  const isClassOption = entry.kind === "class_option";
  const isSpell = entry.kind === "spell";
  const isBackground = entry.kind === "background";
  const isClass = entry.kind === "class";
  const isMagicItem = entry.kind === "magic_item";
  const isMonster = entry.kind === "monster";
  // У транспорта и поста экипажа своя страница — как у существа: статблок
  // поста и список постов судна в развёрнутой строке раздела не помещаются.
  const isVehicle = entry.kind === "vehicle" || entry.kind === "vehicle_post";
  const hasOwnPage = isMonster || isVehicle;
  const isEquipment = entry.kind === "equipment";
  const equipCategory = isEquipment
    ? (entry.data.category as string | undefined)
    : isMagicItem
    ? (entry.data.item_type as string | undefined)
    : undefined;
  const isWeaponEntry = equipCategory === "Оружие";
  const isArmorEntry = equipCategory === "Доспехи";
  const grantedSpells = Array.isArray(entry.data.granted_spells)
    ? (entry.data.granted_spells as { id: number; name: string; grantLevel?: number }[])
    : [];
  const kids = childrenOf(entry.id);
  const rawFields = [...(def?.fields ?? []), ...getExtraFields(entry, props.parentGroupName)];
  const effectiveFields = entry.kind === "monster" ? visibleMonsterFields(rawFields, systemCode) : rawFields;
  const filledFields = effectiveFields.filter(
    // option_section_title is rendered as the options list's own header, so
    // repeating it in the fields summary would be noise.
    (f) => entry.data[f.key] && f.key !== "short_description" && f.key !== "option_section_title"
  );
  const speciesCreatureType = entry.data.creature_type as MechanicsOption | undefined;
  const speciesSenses = dedupeByName((entry.data.senses as MechanicsPick[] | undefined) ?? []);
  const speciesSpeeds = dedupeByName((entry.data.speeds as MechanicsPick[] | undefined) ?? []);
  const hasSpeciesSummary =
    isSpecies && (!!speciesCreatureType || speciesSenses.length > 0 || speciesSpeeds.length > 0 || grantedSpells.length > 0);
  const hasMonsterSummary = isMonster && !!speciesCreatureType;
  const hasSubclassSummary = isSubclass && grantedSpells.length > 0;
  const spellRitual = !!entry.data.ritual;
  const spellConcentration = !!entry.data.concentration;
  const spellClasses = (entry.data.classes as MechanicsOption[] | undefined) ?? [];
  const spellSchool = entry.data.school as MechanicsOption | undefined;
  const spellComponentV = !!entry.data.component_v;
  const spellComponentS = !!entry.data.component_s;
  const spellComponentM = !!entry.data.component_m;
  const spellMaterialComponent = (entry.data.material_component as string | undefined) ?? "";
  const hasSpellComponents = spellComponentV || spellComponentS || spellComponentM;
  const hasSpellSummary =
    isSpell && (!!spellSchool || spellRitual || spellConcentration || spellClasses.length > 0 || hasSpellComponents);
  const backgroundAbilities = (entry.data.abilities as string[] | undefined) ?? [];
  const backgroundOriginFeat = entry.data.origin_feat as MechanicsOption | undefined;
  const backgroundEquipmentA = (entry.data.equipment_a as string | undefined) ?? "";
  const backgroundEquipmentB = (entry.data.equipment_b as string | undefined) ?? "";
  const backgroundSkills = Array.isArray(entry.data.skills) ? (entry.data.skills as string[]) : [];
  const hasBackgroundSummary =
    isBackground &&
    (backgroundAbilities.length > 0 ||
      !!backgroundOriginFeat ||
      !!backgroundEquipmentA ||
      !!backgroundEquipmentB ||
      backgroundSkills.length > 0);
  const classPrimaryAbilities = Array.isArray(entry.data.primary_abilities)
    ? (entry.data.primary_abilities as string[])
    : [];
  const classSavingThrows = Array.isArray(entry.data.saving_throws) ? (entry.data.saving_throws as string[]) : [];
  const classSpellcastingAbility = (entry.data.spellcasting_ability as string | undefined) ?? "";
  const classWeaponProfs = (entry.data.weapon_profs as MechanicsOption[] | undefined) ?? [];
  const classArmorProfs = (entry.data.armor_profs as MechanicsOption[] | undefined) ?? [];
  const classToolProfs = (entry.data.tool_profs as MechanicsOption[] | undefined) ?? [];
  const classSkillChoiceCount = Number(entry.data.skill_choice_count) || 0;
  const classSkillChoiceOptions = Array.isArray(entry.data.skill_choice_options)
    ? (entry.data.skill_choice_options as string[])
    : [];
  const classEquipmentA = isClass ? (entry.data.equipment_a as string | undefined) ?? "" : "";
  const classEquipmentB = isClass ? (entry.data.equipment_b as string | undefined) ?? "" : "";
  const classProgressionTable = isClass ? (entry.data.progression_table as string | undefined) ?? "" : "";
  const classProgression = (isClass ? (entry.data.progression as ClassProgression | undefined) : undefined) ?? EMPTY_PROGRESSION;
  const hasClassSummary =
    isClass &&
    (classPrimaryAbilities.length > 0 ||
      !!classSpellcastingAbility ||
      classSavingThrows.length > 0 ||
      classWeaponProfs.length > 0 ||
      classArmorProfs.length > 0 ||
      classToolProfs.length > 0 ||
      classSkillChoiceOptions.length > 0 ||
      !!classEquipmentA ||
      !!classEquipmentB);
  const itemAttunement = !!entry.data.attunement;
  const itemClasses = (entry.data.classes as MechanicsOption[] | undefined) ?? [];
  // Always show Настройка/Классы for magic items (not just when non-default)
  // — they're two of the standard card fields the user asked for.
  const hasMagicItemSummary = isMagicItem;
  const weaponProperties = dedupeByName((entry.data.weapon_properties as MechanicsOption[] | undefined) ?? []);
  const weaponMastery = (entry.data.weapon_mastery as MechanicsOption | undefined) ?? null;
  const attackMelee = !!entry.data.attack_melee;
  const attackRanged = !!entry.data.attack_ranged;
  const hasWeaponSummary = isWeaponEntry && (weaponProperties.length > 0 || !!weaponMastery || attackMelee || attackRanged);
  const armorDexBonus = !!entry.data.dex_bonus;
  const armorStealthDisadvantage = !!entry.data.stealth_disadvantage;
  const hasArmorSummary = isArmorEntry && (armorDexBonus || armorStealthDisadvantage);
  // Броски и эффекты видны и в режиме просмотра: без них карточка молчала о
  // главном — что заклинание вообще делает, — и урон приходилось искать
  // глазами в тексте описания.
  const viewChecks = (entry.data.checks as DndCheck[] | undefined) ?? [];
  const viewEffects = (entry.data.effects as DndEffect[] | undefined) ?? [];
  const viewCost = (entry.data.cost as DndCost | undefined) ?? EMPTY_COST;
  const hasEffectSummary =
    EFFECT_KINDS.has(entry.kind) &&
    (viewChecks.length > 0 || viewEffects.length > 0 || viewCost.kind !== "none");
  const hasBody =
    entry.kind === 'themebook' || entry.kind === 'theme_kit' || entry.kind === 'treasure' || entry.kind === 'magic_way' || !!entry.description ||
    filledFields.length > 0 ||
    kids.length > 0 ||
    !!def?.childKinds ||
    hasSpeciesSummary ||
    hasSubclassSummary ||
    hasSpellSummary ||
    hasBackgroundSummary ||
    hasClassSummary ||
    hasMagicItemSummary ||
    hasWeaponSummary ||
    hasArmorSummary ||
    hasEffectSummary ||
    !!classProgressionTable ||
    classProgression.columns.length > 0 ||
    isMonster;

  const canToggle = hasBody || isEditing;

  return (
    <div className="comp-node" id={`comp-entry-${entry.id}`}>
      <div
        className={`comp-row${props.focusEntryId === entry.id ? " comp-row-focus" : ""}${litmMight ? ` litm-power-${litmMight}` : ""}`}
        onClick={() => canToggle && props.onToggle(entry.id)}
        style={{ cursor: canToggle ? "pointer" : "default" }}
      >
        <span className={`comp-toggle${canToggle ? "" : " comp-toggle-disabled"}`} aria-hidden="true">
          <NavIcon name="chevron" className={`chevron-icon${isOpen || isEditing ? " is-open" : ""}`} />
        </span>
        {props.sortMode === "manual" && (
          <span
            className="comp-drag-handle"
            title="Перетащить, чтобы изменить порядок"
            draggable
            onClick={(e) => e.stopPropagation()}
            onDragStart={(ev) => {
              ev.dataTransfer.setData("text/plain", String(entry.id));
              ev.dataTransfer.effectAllowed = "move";
              props.onDragStartEntry(entry.id);
            }}
          >
            ⠿
          </span>
        )}
        <span className="comp-name">{entry.name || <em className="muted">Без названия</em>}</span>
        {litmMight && (
          <span className="comp-badge litm-power-chip">
            {litmMight === "origin" ? "Происх." : litmMight === "adventure" ? "Приключ." : litmMight === "greatness" ? "Величие" : "Перем."}
          </span>
        )}
        {hasOwnPage && (entry.statblock_count ?? 0) > 0 && (
          <span className="comp-badge" title={statblockBadgeTitle(entry.statblock_count ?? 0)}>
            <StatblockIcon />
          </span>
        )}
        {isClass && !!entry.data.short_description && (
          <span className="comp-class-short-desc muted">{String(entry.data.short_description)}</span>
        )}
        {isSpell && spellRitual && (
          <span className="comp-level" title="Ритуал">
            Р
          </span>
        )}
        {isSpell && spellConcentration && (
          <span className="comp-level" title="Концентрация">
            К
          </span>
        )}
        {entry.level != null && !isSpell && <span className="comp-level">ур. {entry.level}</span>}
        <span className="comp-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="comp-mini"
            title="Отправить в мешок"
            onClick={() =>
              addToBag({
                type: "compendium_entry",
                id: entry.id,
                title: entry.name,
                kind: entry.kind,
                system_id: entry.system_id,
                section_id: entry.section_id,
              })
            }
          >
            <NavIcon name="bag" />
          </button>
          <button className="comp-mini" title="Скопировать ссылку на запись" onClick={copyLink}>
            <NavIcon name={linkCopied ? "check" : "link"} />
          </button>
          {hasOwnPage && (
            <Link
              className="comp-mini"
              to={`/compendium/${entry.id}`}
              title={isVehicle ? "Открыть страницу транспорта" : "Открыть страницу существа"}
            >
              <NavIcon name="arrowRight" />
            </Link>
          )}
          <button
            className={`comp-mini${isEditing ? " is-active" : ""}`}
            title={isEditing ? "Отменить редактирование" : "Редактировать"}
            onClick={() => (isEditing ? props.onCancel() : props.onEdit(entry))}
          >
            <NavIcon name={isEditing ? "close" : "edit"} />
          </button>
          <button className="comp-mini danger" title="Удалить" onClick={() => props.onDelete(entry)}>
            <NavIcon name="delete" />
          </button>
        </span>
      </div>

      {isEditing && editing && (
        <div className="comp-body">
          <div className="stack" style={{ gap: 6 }}>
            <div className="row">
              <input
                autoFocus
                placeholder="Название"
                value={editing.name}
                onChange={(e) => props.onDraftChange({ ...editing, name: e.target.value })}
                style={{ flex: 1 }}
              />
              {def?.hasLevel && (
                <input
                  type="number"
                  placeholder={isSpell ? "Ур. (0=заговор)" : "Ур."}
                  value={editing.level}
                  onChange={(e) => props.onDraftChange({ ...editing, level: e.target.value })}
                  style={{ width: 70 }}
                />
              )}
            </div>
            {effectiveFields
              .filter((f) => !(isBackground && (f.key === "tools" || f.key === "feature")))
              .map((f) =>
              f.type === "select" ? (
                <select
                  key={f.key}
                  value={editing.data[f.key] ?? ""}
                  onChange={(e) =>
                    props.onDraftChange({
                      ...editing,
                      data: { ...editing.data, [f.key]: e.target.value },
                    })
                  }
                >
                  <option value="">{f.label}</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  key={f.key}
                  placeholder={f.label}
                  value={editing.data[f.key] ?? ""}
                  onChange={(e) =>
                    props.onDraftChange({
                      ...editing,
                      data: { ...editing.data, [f.key]: e.target.value },
                    })
                  }
                />
              )
            )}
            {isSpecies && (
              <SpeciesPickers editing={editing} options={mechanicsOptions} onChange={props.onDraftChange} />
            )}
            {isMonster && (
              <CreatureTypeSelect
                value={editing.creatureType}
                options={mechanicsOptions.creatureTypes}
                onChange={(opt) => props.onDraftChange({ ...editing, creatureType: opt })}
              />
            )}
            {isSpell && (
              <div className="stack" style={{ gap: 8 }}>
                <div>
                  <span className="muted">Школа</span>
                  {mechanicsOptions.schools.length === 0 ? (
                    <div>
                      <span className="muted">
                        Список пуст — добавьте варианты в разделе «Справочник» → «Общее» → «Школы магии».
                      </span>
                    </div>
                  ) : (
                    <select
                      value={editing.spellSchool?.id ?? ""}
                      onChange={(e) => {
                        const opt = mechanicsOptions.schools.find((o) => o.id === Number(e.target.value));
                        props.onDraftChange({ ...editing, spellSchool: opt ?? null });
                      }}
                    >
                      <option value="">— не выбрана —</option>
                      {mechanicsOptions.schools.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="row" style={{ gap: 14 }}>
                  <span className="row" style={{ gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={editing.ritual}
                      onChange={(e) => props.onDraftChange({ ...editing, ritual: e.target.checked })}
                    />
                    Ритуал
                  </span>
                  <span className="row" style={{ gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={editing.concentration}
                      onChange={(e) => props.onDraftChange({ ...editing, concentration: e.target.checked })}
                    />
                    Концентрация
                  </span>
                </div>
                <div>
                  <span className="muted">Компоненты</span>
                  <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
                    <span className="row" style={{ gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={editing.componentV}
                        onChange={(e) => props.onDraftChange({ ...editing, componentV: e.target.checked })}
                      />
                      Вербальный
                    </span>
                    <span className="row" style={{ gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={editing.componentS}
                        onChange={(e) => props.onDraftChange({ ...editing, componentS: e.target.checked })}
                      />
                      Соматический
                    </span>
                    <span className="row" style={{ gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={editing.componentM}
                        onChange={(e) => props.onDraftChange({ ...editing, componentM: e.target.checked })}
                      />
                      Материальный
                    </span>
                  </div>
                  {editing.componentM && (
                    <input
                      type="text"
                      placeholder="Материальный компонент (например, свеча)"
                      value={editing.materialComponent}
                      onChange={(e) => props.onDraftChange({ ...editing, materialComponent: e.target.value })}
                    />
                  )}
                </div>
                <ClassSubclassMultiPicker
                  label="Доступно классам/подклассам"
                  emptyHint="сначала добавьте классы в разделе «Классы»"
                  picks={editing.spellClasses}
                  groups={classOptions}
                  onToggle={(opt, checked) =>
                    props.onDraftChange({
                      ...editing,
                      spellClasses: checked
                        ? [...editing.spellClasses, opt]
                        : editing.spellClasses.filter((c) => c.id !== opt.id),
                    })
                  }
                />
              </div>
            )}
            {EFFECT_KINDS.has(entry.kind) && (
              <div className="stack">
                <span className="muted">Броски и эффекты</span>
                <EffectList
                  systemId={entry.system_id}
                  checks={editing.checks}
                  effects={editing.effects}
                  cost={editing.cost}
                  isCantrip={editing.level === "0"}
                  edit
                  onChange={(patch) => props.onDraftChange({ ...editing, ...patch })}
                />
              </div>
            )}
            {isMagicItem && (
              <div className="stack" style={{ gap: 8 }}>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={editing.itemAttunement}
                    onChange={(e) => props.onDraftChange({ ...editing, itemAttunement: e.target.checked })}
                  />
                  Требует настройки
                </label>
                <ClassSubclassMultiPicker
                  label="Классы (если ни один не выбран — подходит всем)"
                  emptyHint="сначала добавьте классы в разделе «Классы»"
                  picks={editing.itemClasses}
                  groups={classOptions}
                  onToggle={(opt, checked) =>
                    props.onDraftChange({
                      ...editing,
                      itemClasses: checked
                        ? [...editing.itemClasses, opt]
                        : editing.itemClasses.filter((c) => c.id !== opt.id),
                    })
                  }
                />
              </div>
            )}
            {isWeaponEntry && (
              <div className="stack" style={{ gap: 8 }}>
                <MechanicsMultiPicker
                  label="Свойства оружия"
                  emptyHint="сначала добавьте записи в «Справочник» → «Свойства оружия»"
                  picks={editing.weaponProperties}
                  options={mechanicsOptions.weaponProperties}
                  showDistance={false}
                  onToggle={(opt, checked) =>
                    props.onDraftChange({
                      ...editing,
                      weaponProperties: checked
                        ? [...editing.weaponProperties, { ...opt, distance: "" }]
                        : editing.weaponProperties.filter((p) => p.id !== opt.id),
                    })
                  }
                  onDistance={() => {}}
                />
                <div>
                  <div className="muted" style={{ marginBottom: 2 }}>
                    Мастерство
                  </div>
                  {mechanicsOptions.weaponMastery.length === 0 ? (
                    <span className="muted">
                      Список пуст — добавьте варианты в «Справочник» → «Мастерство оружия».
                    </span>
                  ) : (
                    <select
                      value={editing.weaponMastery?.id ?? ""}
                      onChange={(e) => {
                        const opt = mechanicsOptions.weaponMastery.find((o) => o.id === Number(e.target.value));
                        props.onDraftChange({ ...editing, weaponMastery: opt ?? null });
                      }}
                    >
                      <option value="">— не выбрано —</option>
                      {mechanicsOptions.weaponMastery.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="row" style={{ gap: 14 }}>
                  <label className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={editing.attackMelee}
                      onChange={(e) => props.onDraftChange({ ...editing, attackMelee: e.target.checked })}
                    />
                    Рукопашная
                  </label>
                  <label className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={editing.attackRanged}
                      onChange={(e) => props.onDraftChange({ ...editing, attackRanged: e.target.checked })}
                    />
                    Дальнобойная
                  </label>
                </div>
              </div>
            )}
            {isArmorEntry && (
              <div className="row" style={{ gap: 14 }}>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={editing.armorDexBonus}
                    onChange={(e) => props.onDraftChange({ ...editing, armorDexBonus: e.target.checked })}
                  />
                  Бонус от Ловкости
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={editing.armorStealthDisadvantage}
                    onChange={(e) =>
                      props.onDraftChange({ ...editing, armorStealthDisadvantage: e.target.checked })
                    }
                  />
                  Помеха на Скрытность
                </label>
              </div>
            )}
            {isBackground && (
              <div className="stack" style={{ gap: 8 }}>
                <div>
                  <span className="muted">Характеристики (выберите ровно 3)</span>
                  <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                    {ABILITY_SCORES.map((a) => (
                      <label key={a} className="row" style={{ gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={editing.abilities.includes(a)}
                          onChange={(e) =>
                            props.onDraftChange({
                              ...editing,
                              abilities: e.target.checked
                                ? [...editing.abilities, a]
                                : editing.abilities.filter((x) => x !== a),
                            })
                          }
                        />
                        {a}
                      </label>
                    ))}
                  </div>
                </div>
                <select
                  value={editing.originFeat?.id ?? ""}
                  onChange={(e) => {
                    const opt = originFeatOptions.find((o) => o.id === Number(e.target.value)) ?? null;
                    props.onDraftChange({ ...editing, originFeat: opt });
                  }}
                >
                  <option value="">Черта происхождения — не выбрана</option>
                  {originFeatOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <div>
                  <span className="muted">Владения навыками</span>
                  <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                    {ALL_SKILLS.map((s) => (
                      <label key={s} className="row" style={{ gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={editing.backgroundSkills.includes(s)}
                          onChange={(e) =>
                            props.onDraftChange({
                              ...editing,
                              backgroundSkills: e.target.checked
                                ? [...editing.backgroundSkills, s]
                                : editing.backgroundSkills.filter((x) => x !== s),
                            })
                          }
                        />
                        {s}
                      </label>
                    ))}
                  </div>
                </div>
                <input
                  placeholder="Владения инструментами"
                  value={editing.data.tools ?? ""}
                  onChange={(e) =>
                    props.onDraftChange({
                      ...editing,
                      data: { ...editing.data, tools: e.target.value },
                    })
                  }
                />
                <input
                  placeholder="Умение предыстории"
                  value={editing.data.feature ?? ""}
                  onChange={(e) =>
                    props.onDraftChange({
                      ...editing,
                      data: { ...editing.data, feature: e.target.value },
                    })
                  }
                />
                <textarea
                  placeholder="Снаряжение А"
                  rows={2}
                  value={editing.equipmentA}
                  onChange={(e) => props.onDraftChange({ ...editing, equipmentA: e.target.value })}
                />
                <StartingEquipmentPicker
                  systemId={entry.system_id}
                  items={editing.equipmentAItems}
                  gold={editing.equipmentAGold}
                  onChange={(patch) =>
                    props.onDraftChange({
                      ...editing,
                      ...(patch.items ? { equipmentAItems: patch.items } : {}),
                      ...(patch.gold !== undefined ? { equipmentAGold: patch.gold } : {}),
                    })
                  }
                />
                <textarea
                  placeholder="Снаряжение Б"
                  rows={2}
                  value={editing.equipmentB}
                  onChange={(e) => props.onDraftChange({ ...editing, equipmentB: e.target.value })}
                />
                <StartingEquipmentPicker
                  systemId={entry.system_id}
                  items={editing.equipmentBItems}
                  gold={editing.equipmentBGold}
                  onChange={(patch) =>
                    props.onDraftChange({
                      ...editing,
                      ...(patch.items ? { equipmentBItems: patch.items } : {}),
                      ...(patch.gold !== undefined ? { equipmentBGold: patch.gold } : {}),
                    })
                  }
                />
              </div>
            )}
            {isClass && (
              <div className="stack" style={{ gap: 8 }}>
                <div>
                  <span className="muted">Основная характеристика</span>
                  <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                    {ABILITY_SCORES.map((a) => (
                      <label key={a} className="row" style={{ gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={editing.primaryAbilities.includes(a)}
                          onChange={(e) =>
                            props.onDraftChange({
                              ...editing,
                              primaryAbilities: e.target.checked
                                ? [...editing.primaryAbilities, a]
                                : editing.primaryAbilities.filter((x) => x !== a),
                            })
                          }
                        />
                        {a}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="muted">Заклинательная характеристика</span>
                  <div className="row">
                    <select
                      value={editing.spellcastingAbility}
                      onChange={(e) =>
                        props.onDraftChange({ ...editing, spellcastingAbility: e.target.value })
                      }
                    >
                      <option value="">— нет —</option>
                      {ABILITY_SCORES.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <span className="muted">Спасброски</span>
                  <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                    {ABILITY_SCORES.map((a) => (
                      <label key={a} className="row" style={{ gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={editing.savingThrows.includes(a)}
                          onChange={(e) =>
                            props.onDraftChange({
                              ...editing,
                              savingThrows: e.target.checked
                                ? [...editing.savingThrows, a]
                                : editing.savingThrows.filter((x) => x !== a),
                            })
                          }
                        />
                        {a}
                      </label>
                    ))}
                  </div>
                </div>
                <MechanicsMultiPicker
                  label="Владения оружием"
                  emptyHint="сначала добавьте записи в «Справочник» → «Владения оружием»"
                  picks={editing.weaponProfs}
                  options={mechanicsOptions.weapons}
                  showDistance={false}
                  onToggle={(opt, checked) =>
                    props.onDraftChange({
                      ...editing,
                      weaponProfs: checked
                        ? [...editing.weaponProfs, { ...opt, distance: "" }]
                        : editing.weaponProfs.filter((p) => p.id !== opt.id),
                    })
                  }
                  onDistance={() => {}}
                />
                <MechanicsMultiPicker
                  label="Тренированность с доспехами"
                  emptyHint="сначала добавьте записи в «Справочник» → «Владения доспехами»"
                  picks={editing.armorProfs}
                  options={mechanicsOptions.armor}
                  showDistance={false}
                  onToggle={(opt, checked) =>
                    props.onDraftChange({
                      ...editing,
                      armorProfs: checked
                        ? [...editing.armorProfs, { ...opt, distance: "" }]
                        : editing.armorProfs.filter((p) => p.id !== opt.id),
                    })
                  }
                  onDistance={() => {}}
                />
                <MechanicsMultiPicker
                  label="Владения инструментами"
                  emptyHint="сначала добавьте записи в «Справочник» → «Владения инструментами»"
                  picks={editing.toolProfs}
                  options={mechanicsOptions.tools}
                  showDistance={false}
                  onToggle={(opt, checked) =>
                    props.onDraftChange({
                      ...editing,
                      toolProfs: checked
                        ? [...editing.toolProfs, { ...opt, distance: "" }]
                        : editing.toolProfs.filter((p) => p.id !== opt.id),
                    })
                  }
                  onDistance={() => {}}
                />
                <div>
                  <label className="row" style={{ gap: 6 }}>
                    <span className="muted">Владения навыками — выбрать</span>
                    <input
                      type="number"
                      min={0}
                      style={{ width: 60 }}
                      value={editing.skillChoiceCount}
                      onChange={(e) => props.onDraftChange({ ...editing, skillChoiceCount: e.target.value })}
                    />
                    <span className="muted">из списка</span>
                  </label>
                  <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                    {ALL_SKILLS.map((s) => (
                      <label key={s} className="row" style={{ gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={editing.skillChoiceOptions.includes(s)}
                          onChange={(e) =>
                            props.onDraftChange({
                              ...editing,
                              skillChoiceOptions: e.target.checked
                                ? [...editing.skillChoiceOptions, s]
                                : editing.skillChoiceOptions.filter((x) => x !== s),
                            })
                          }
                        />
                        {s}
                      </label>
                    ))}
                  </div>
                </div>
                <textarea
                  placeholder="Начальное снаряжение — комплект А"
                  rows={2}
                  value={editing.equipmentA}
                  onChange={(e) => props.onDraftChange({ ...editing, equipmentA: e.target.value })}
                />
                <StartingEquipmentPicker
                  systemId={entry.system_id}
                  items={editing.equipmentAItems}
                  gold={editing.equipmentAGold}
                  onChange={(patch) =>
                    props.onDraftChange({
                      ...editing,
                      ...(patch.items ? { equipmentAItems: patch.items } : {}),
                      ...(patch.gold !== undefined ? { equipmentAGold: patch.gold } : {}),
                    })
                  }
                />
                <textarea
                  placeholder="Начальное снаряжение — комплект Б"
                  rows={2}
                  value={editing.equipmentB}
                  onChange={(e) => props.onDraftChange({ ...editing, equipmentB: e.target.value })}
                />
                <StartingEquipmentPicker
                  systemId={entry.system_id}
                  items={editing.equipmentBItems}
                  gold={editing.equipmentBGold}
                  onChange={(patch) =>
                    props.onDraftChange({
                      ...editing,
                      ...(patch.items ? { equipmentBItems: patch.items } : {}),
                      ...(patch.gold !== undefined ? { equipmentBGold: patch.gold } : {}),
                    })
                  }
                />
              </div>
            )}
            <MentionTextarea
              value={editing.description}
              onChange={(v) => props.onDraftChange({ ...editing, description: v })}
              rows={4}
              placeholder="Описание (можно @-упоминания)"
            />
            {(isSpecies || isSubclass || isClassOption) && (
              <>
                <GrantedSpellsPicker
                  spells={editing.grantedSpells}
                  onChange={(v) => props.onDraftChange({ ...editing, grantedSpells: v })}
                  levelLabel={isSpecies ? "Получено на суммарном уровне персонажа" : "Получено на уровне класса"}
                />
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={editing.unlimitedGrantedSpells}
                    onChange={(e) =>
                      props.onDraftChange({ ...editing, unlimitedGrantedSpells: e.target.checked })
                    }
                  />
                  Безгранично
                </label>
              </>
            )}
            {isClass && (
              <details className="card">
                <summary className="muted chevron-summary">
                  <NavIcon name="chevron" className="chevron-icon" />
                  Таблица развития
                </summary>
                <ProgressionEditor
                  value={editing.progression}
                  markdown={editing.progressionTable}
                  onChange={(v) => props.onDraftChange({ ...editing, progression: v })}
                />
                <details className="card">
                  <summary className="muted chevron-summary">
                    <NavIcon name="chevron" className="chevron-icon" />
                    Исходный текст таблицы
                  </summary>
                  <MentionTextarea
                    value={editing.progressionTable}
                    onChange={(v) => props.onDraftChange({ ...editing, progressionTable: v })}
                    rows={6}
                    placeholder="Вставьте таблицу кнопкой ▦ в панели форматирования и заполните по уровням"
                  />
                </details>
              </details>
            )}
            <div className="row">
              <button className="primary" onClick={props.onSave}>
                Сохранить
              </button>
              <button onClick={props.onCancel}>Отмена</button>
            </div>
          </div>
        </div>
        )}


      {isOpen && !isEditing && entry.kind === 'themebook' && (
          <div className="comp-body">
            <LitmThemeBookBody data={entry.data} />
          </div>
        )}
        {isOpen && !isEditing && entry.kind === 'theme_kit' && (
          <div className="comp-body">
            <LitmThemeKitBody data={entry.data} />
          </div>
        )}
        {isOpen && !isEditing && entry.kind === 'treasure' && (
          <div className="comp-body">
            <LitmTreasureBody data={entry.data} />
          </div>
        )}
        {isOpen && !isEditing && entry.kind === 'magic_way' && (
          <div className="comp-body">
            <LitmMagicWayBody entry={entry} />
          </div>
        )}
        {isOpen && !isEditing && !(entry.kind === 'themebook' || entry.kind === 'theme_kit' || entry.kind === 'treasure' || entry.kind === 'magic_way') && (
        <div className="comp-body">
          {isMonster && (
            <StatblockList
              ownerType="compendium_entry"
              ownerId={entry.id}
              ownerName={entry.name}
              ownerCreatureType={speciesCreatureType?.name}
              ownerCreatureSize={entry.data.size as string | undefined}
              ownerCreatureCR={entry.data.cr as string | undefined}
            />
          )}
          {filledFields.length > 0 && (
            <div className="comp-fields">
              {filledFields.map((f) => (
                <div key={f.key} className="muted">
                  <strong>{f.label}:</strong> {String(entry.data[f.key])}
                </div>
              ))}
            </div>
          )}
          {/* Сразу после времени и дистанции: «что оно делает» читается раньше
              школы и компонентов, а не после них. */}
          {hasEffectSummary && (
            <EffectList
              systemId={entry.system_id}
              checks={viewChecks}
              effects={viewEffects}
              cost={viewCost}
              edit={false}
              onChange={() => {}}
            />
          )}
          {hasMonsterSummary && (
            <div className="comp-fields">
              <div className="muted">
                <strong>Тип существа:</strong> {speciesCreatureType!.name}
              </div>
            </div>
          )}
          {hasSpeciesSummary && (
            <div className="comp-fields">
              {speciesCreatureType && (
                <div className="muted">
                  <strong>Тип существа:</strong> {speciesCreatureType.name}
                </div>
              )}
              {speciesSenses.length > 0 && (
                <div className="muted">
                  <strong>Восприятие:</strong>{" "}
                  {speciesSenses.map((s) => `${s.name}${s.distance ? ` ${s.distance}` : ""}`).join(", ")}
                </div>
              )}
              {speciesSpeeds.length > 0 && (
                <div className="muted">
                  <strong>Скорости:</strong>{" "}
                  {speciesSpeeds.map((s) => `${s.name}${s.distance ? ` ${s.distance}` : ""}`).join(", ")}
                </div>
              )}
              {grantedSpells.length > 0 && (
                <div className="muted">
                  <strong>Обретаемые заклинания:</strong> {formatGrantedSpellsByLevel(grantedSpells)}
                </div>
              )}
            </div>
          )}
          {hasSubclassSummary && (
            <div className="comp-fields">
              <div className="muted">
                <strong>Обретаемые заклинания:</strong> {formatGrantedSpellsByLevel(grantedSpells)}
              </div>
            </div>
          )}
          {hasSpellSummary && (
            <div className="comp-fields">
              {spellSchool && (
                <div className="muted">
                  <strong>Школа:</strong> {spellSchool.name}
                </div>
              )}
              {spellRitual && (
                <div className="muted">
                  <strong>Ритуал:</strong> да
                </div>
              )}
              {spellConcentration && (
                <div className="muted">
                  <strong>Концентрация:</strong> да
                </div>
              )}
              {hasSpellComponents && (
                <div className="muted">
                  <strong>Компоненты:</strong>{" "}
                  {[
                    spellComponentV && "В",
                    spellComponentS && "С",
                    spellComponentM && `М${spellMaterialComponent ? ` (${spellMaterialComponent})` : ""}`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </div>
              )}
              {spellClasses.filter((c) => !c.name.includes(" — ")).length > 0 && (
                <div className="muted">
                  <strong>Классы:</strong>{" "}
                  {spellClasses
                    .filter((c) => !c.name.includes(" — "))
                    .map((c) => c.name)
                    .join(", ")}
                </div>
              )}
              {spellClasses.filter((c) => c.name.includes(" — ")).length > 0 && (
                <div className="muted">
                  <strong>Подклассы:</strong>{" "}
                  {spellClasses
                    .filter((c) => c.name.includes(" — "))
                    .map((c) => c.name)
                    .join(", ")}
                </div>
              )}
            </div>
          )}
          {hasMagicItemSummary && (
            <div className="comp-fields">
              <div className="muted">
                <strong>Настройка:</strong> {itemAttunement ? "да" : "нет"}
              </div>
              {itemClasses.length > 0 ? (
                <div className="muted">
                  <strong>Классы:</strong> {itemClasses.map((c) => c.name).join(", ")}
                </div>
              ) : (
                <div className="muted">
                  <strong>Классы:</strong> подходит всем классам
                </div>
              )}
            </div>
          )}
          {hasWeaponSummary && (
            <div className="comp-fields">
              {(attackMelee || attackRanged) && (
                <div className="muted">
                  <strong>Атака:</strong>{" "}
                  {[attackMelee && "рукопашная", attackRanged && "дальнобойная"].filter(Boolean).join(", ")}
                </div>
              )}
              {weaponProperties.length > 0 && (
                <div className="muted">
                  <strong>Свойства:</strong> {weaponProperties.map((p) => p.name).join(", ")}
                </div>
              )}
              {weaponMastery && (
                <div className="muted">
                  <strong>Мастерство:</strong> {weaponMastery.name}
                </div>
              )}
            </div>
          )}
          {hasArmorSummary && (
            <div className="comp-fields">
              {armorDexBonus && <div className="muted">Даёт бонус от Ловкости</div>}
              {armorStealthDisadvantage && <div className="muted">Помеха на Скрытность</div>}
            </div>
          )}
          {hasBackgroundSummary && (
            <div className="comp-fields">
              {backgroundAbilities.length > 0 && (
                <div className="muted">
                  <strong>Характеристики:</strong> {backgroundAbilities.join(", ")}
                </div>
              )}
              {backgroundOriginFeat && (
                <div className="muted">
                  <strong>Черта происхождения:</strong> {backgroundOriginFeat.name}
                </div>
              )}
              {backgroundSkills.length > 0 && (
                <div className="muted">
                  <strong>Владения навыками:</strong> {backgroundSkills.join(", ")}
                </div>
              )}
              {backgroundEquipmentA && (
                <div className="muted">
                  <strong>Снаряжение А:</strong> {backgroundEquipmentA}
                </div>
              )}
              {backgroundEquipmentB && (
                <div className="muted">
                  <strong>Снаряжение Б:</strong> {backgroundEquipmentB}
                </div>
              )}
            </div>
          )}
          {hasClassSummary && (
            <div className="comp-fields">
              {classPrimaryAbilities.length > 0 && (
                <div className="muted">
                  <strong>Основная характеристика:</strong> {classPrimaryAbilities.join(", ")}
                </div>
              )}
              {classSpellcastingAbility && (
                <div className="muted">
                  <strong>Заклинательная характеристика:</strong> {classSpellcastingAbility}
                </div>
              )}
              {classSavingThrows.length > 0 && (
                <div className="muted">
                  <strong>Спасброски:</strong> {classSavingThrows.join(", ")}
                </div>
              )}
              {classWeaponProfs.length > 0 && (
                <div className="muted">
                  <strong>Владения оружием:</strong> {classWeaponProfs.map((w) => w.name).join(", ")}
                </div>
              )}
              {classArmorProfs.length > 0 && (
                <div className="muted">
                  <strong>Тренированность с доспехами:</strong> {classArmorProfs.map((a) => a.name).join(", ")}
                </div>
              )}
              {classToolProfs.length > 0 && (
                <div className="muted">
                  <strong>Владения инструментами:</strong> {classToolProfs.map((t) => t.name).join(", ")}
                </div>
              )}
              {classSkillChoiceOptions.length > 0 && (
                <div className="muted">
                  <strong>Владения навыками:</strong> выбрать {classSkillChoiceCount} из{" "}
                  {classSkillChoiceOptions.join(", ")}
                </div>
              )}
              {classEquipmentA && (
                <div className="muted">
                  <strong>Снаряжение А:</strong> {classEquipmentA}
                </div>
              )}
              {classEquipmentB && (
                <div className="muted">
                  <strong>Снаряжение Б:</strong> {classEquipmentB}
                </div>
              )}
            </div>
          )}
          {entry.description && (
            <div style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={entry.description} />
            </div>
          )}
          {(classProgression.columns.length > 0 || classProgressionTable) && (
            <details className="card">
              <summary className="muted chevron-summary">
                <NavIcon name="chevron" className="chevron-icon" />
                Таблица развития
              </summary>
              {/* Структура — источник истины; markdown показываем только
                  там, где структуры ещё нет (свой класс, ещё не разобранный). */}
              {classProgression.columns.length > 0 ? (
                <ProgressionView value={classProgression} />
              ) : (
                <MentionText text={classProgressionTable} />
              )}
            </details>
          )}
          {isClass
            ? <ChildGroups {...props} />
            : kids.length > 0 && <ChildGroups {...props} />}
          {!isClass && def?.childKinds && (
            <div className="row" style={{ marginTop: 6 }}>
              {def.childKinds.map((ck) => (
                <button key={ck.kind} className="comp-mini" onClick={() => props.onAddChild(entry.id, ck.kind)}>
                  + добавить {ck.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Single-select for creature type, sourced from the system's "Справочник" →
// "Общее" → "Типы существ и их особенности" list — shared by species and
// bestiary monster entries.
function CreatureTypeSelect({
  value,
  options,
  onChange,
}: {
  value: MechanicsOption | null;
  options: MechanicsOption[];
  onChange: (opt: MechanicsOption | null) => void;
}) {
  return (
    <div>
      <div className="muted" style={{ marginBottom: 2 }}>
        Тип существа
      </div>
      {options.length === 0 ? (
        <span className="muted">
          Список пуст — добавьте варианты в разделе «Справочник» → «Общее» → «Типы существ и их особенности».
        </span>
      ) : (
        <select
          value={value?.id ?? ""}
          onChange={(e) => {
            const opt = options.find((o) => o.id === Number(e.target.value));
            onChange(opt ?? null);
          }}
        >
          <option value="">— не выбран —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// Checkbox-driven multi-select for senses/speeds (each pick also carries a
// free-text distance), plus a single-select for creature type — all sourced
// from the system's "Механики" → "Общее" lists.
function SpeciesPickers({
  editing,
  options,
  onChange,
}: {
  editing: EditDraft;
  options: MechanicsOptions;
  onChange: (draft: EditDraft) => void;
}) {
  function toggleMulti(key: "senses" | "speeds", opt: MechanicsOption, checked: boolean) {
    // Drop any existing pick with the same name first (not just same id) —
    // guards against re-checking a re-created mechanics-list item leaving a
    // stale duplicate behind, see dedupeByName's doc comment.
    const withoutSameName = editing[key].filter((p) => p.name !== opt.name);
    onChange({
      ...editing,
      [key]: checked
        ? [...withoutSameName, { id: opt.id, name: opt.name, distance: DEFAULT_DISTANCE_BY_NAME[opt.name] ?? "" }]
        : withoutSameName,
    });
  }
  function setDistance(key: "senses" | "speeds", id: number, distance: string) {
    onChange({ ...editing, [key]: editing[key].map((p) => (p.id === id ? { ...p, distance } : p)) });
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <CreatureTypeSelect
        value={editing.creatureType}
        options={options.creatureTypes}
        onChange={(opt) => onChange({ ...editing, creatureType: opt })}
      />

      <MechanicsMultiPicker
        label="Особое восприятие"
        emptyHint="добавьте варианты в разделе «Справочник» → «Общее» → «Особое восприятие»"
        picks={editing.senses}
        options={options.senses}
        onToggle={(opt, checked) => toggleMulti("senses", opt, checked)}
        onDistance={(id, distance) => setDistance("senses", id, distance)}
      />
      <MechanicsMultiPicker
        label="Скорости передвижения"
        emptyHint="добавьте варианты в разделе «Справочник» → «Общее» → «Скорости передвижения и их особенности»"
        picks={editing.speeds}
        options={options.speeds}
        onToggle={(opt, checked) => toggleMulti("speeds", opt, checked)}
        onDistance={(id, distance) => setDistance("speeds", id, distance)}
      />
    </div>
  );
}

// Species/subclass editor: drag a spell in from the search sidebar to grant
// it, then set the level it's obtained at — these get copied onto the
// character sheet (always marked "prepared") once the character reaches
// that level, see recomputeGrantedSpells in DndCharacterForm.tsx.
function GrantedSpellsPicker({
  spells,
  onChange,
  levelLabel,
}: {
  spells: { id: number; name: string; grantLevel: number }[];
  onChange: (v: { id: number; name: string; grantLevel: number }[]) => void;
  levelLabel: string;
}) {
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    const result: SearchResult = JSON.parse(raw);
    if (result.kind !== "spell" || spells.some((s) => s.id === result.id)) return;
    onChange([...spells, { id: result.id, name: result.title, grantLevel: 1 }]);
  }

  function remove(id: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    onChange(spells.filter((s) => s.id !== id));
  }

  function setLevel(id: number, grantLevel: number) {
    onChange(spells.map((s) => (s.id === id ? { ...s, grantLevel } : s)));
  }

  return (
    <div>
      <div className="muted" style={{ marginBottom: 2 }}>
        Обретаемые заклинания
      </div>
      <div
        className={`drop-zone${dragOver ? " drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {spells.length === 0 ? (
          <span className="muted">Перетащите сюда заклинание из поиска.</span>
        ) : (
          <div className="stack" style={{ gap: 4 }}>
            {spells.map((s) => (
              <div key={s.id} className="row" style={{ gap: 6, alignItems: "center" }}>
                <span className="badge tag">{s.name}</span>
                <label className="muted row" style={{ gap: 4, alignItems: "center" }}>
                  {levelLabel}
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={s.grantLevel}
                    onChange={(e) => setLevel(s.id, Number(e.target.value) || 1)}
                    style={{ width: 48 }}
                  />
                </label>
                <button type="button" className="comp-mini danger" title="Убрать" onClick={() => remove(s.id)}>
                  <NavIcon name="delete" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MechanicsMultiPicker({
  label,
  emptyHint,
  picks,
  options,
  onToggle,
  onDistance,
  showDistance = true,
}: {
  label: string;
  emptyHint: string;
  picks: MechanicsPick[];
  options: MechanicsOption[];
  onToggle: (opt: MechanicsOption, checked: boolean) => void;
  onDistance: (id: number, distance: string) => void;
  showDistance?: boolean;
}) {
  return (
    <div>
      <div className="muted" style={{ marginBottom: 2 }}>
        {label}
      </div>
      {options.length === 0 ? (
        <span className="muted">Список пуст — {emptyHint}.</span>
      ) : (
        <div className="stack" style={{ gap: 2 }}>
          {options.map((opt) => {
            const pick = picks.find((p) => p.id === opt.id);
            return (
              <label key={opt.id} className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!pick}
                  onChange={(e) => onToggle(opt, e.target.checked)}
                />
                {opt.name}
                {showDistance && pick && (
                  <input
                    placeholder="дистанция"
                    value={pick.distance}
                    onChange={(e) => onDistance(opt.id, e.target.value)}
                    style={{ width: 100 }}
                  />
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Requirement 8: classes listed alphabetically (already sorted by
// loadClassOptions), subclasses collapsed under a per-class expand toggle
// instead of one long always-visible flat list.
function ClassSubclassMultiPicker({
  label,
  emptyHint,
  picks,
  groups,
  onToggle,
}: {
  label: string;
  emptyHint: string;
  picks: MechanicsOption[];
  groups: ClassGroupOption[];
  onToggle: (opt: MechanicsOption, checked: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  function toggleExpand(classId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  }
  return (
    <div>
      <div className="muted" style={{ marginBottom: 2 }}>
        {label}
      </div>
      {groups.length === 0 ? (
        <span className="muted">Список пуст — {emptyHint}.</span>
      ) : (
        <div className="stack" style={{ gap: 2 }}>
          {groups.map((g) => {
            const pick = picks.find((p) => p.id === g.id);
            return (
              <div key={g.id}>
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={!!pick}
                    onChange={(e) => onToggle({ id: g.id, name: g.name }, e.target.checked)}
                  />
                  <span>{g.name}</span>
                  {g.subclasses.length > 0 && (
                    <button type="button" className="comp-mini" onClick={() => toggleExpand(g.id)}>
                      {expanded.has(g.id) ? "Свернуть" : "Развернуть"}{" "}
                      <NavIcon name="chevron" className={`chevron-icon${expanded.has(g.id) ? " is-open" : ""}`} />
                    </button>
                  )}
                </div>
                {expanded.has(g.id) &&
                  g.subclasses.map((s) => {
                    const spick = picks.find((p) => p.id === s.id);
                    return (
                      <div key={s.id} className="row" style={{ gap: 6, alignItems: "center", marginLeft: 22 }}>
                        <input
                          type="checkbox"
                          checked={!!spick}
                          onChange={(e) => onToggle({ id: s.id, name: s.storedName }, e.target.checked)}
                        />
                        <span>{s.displayName}</span>
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Renders an entry's children: `feature` (and `class_option`) children
// grouped by level, other kinds (e.g. subclasses) listed as their own
// compact rows below.
function ChildGroups(props: NodeProps) {
  const kids = props.childrenOf(props.entry.id);
  const features = kids.filter((k) => k.kind === "feature");
  const options = kids.filter((k) => k.kind === "class_option");
  const others = kids.filter((k) => k.kind !== "feature" && k.kind !== "class_option");

  // Level-grouped rendering shared by Умения and the class options list.
  const levelGrouped = (list: CompendiumEntry[]) => {
    const byLevel = new Map<number, CompendiumEntry[]>();
    for (const f of list) {
      const lvl = f.level ?? 0;
      if (!byLevel.has(lvl)) byLevel.set(lvl, []);
      byLevel.get(lvl)!.push(f);
    }
    const levels = [...byLevel.keys()].sort((a, b) => a - b);
    if (levels.length === 0) return false;
    return (
      <div>
        {levels.map((lvl) => {
          const group = props.sortForDisplay(byLevel.get(lvl)!);
          return (
            <div key={`lvl-${lvl}`}>
              <div className="comp-level-label">{lvl > 0 ? `Уровень ${lvl}` : "Без уровня"}</div>
              {group.map((f) => (
                <SortableRow key={f.id} entry={f} group={group} sortMode={props.sortMode} dragId={props.dragId} onDragStartEntry={props.onDragStartEntry} onDropEntry={props.onDropEntry}>
                  <EntryNode {...props} entry={f} depth={props.depth + 1} />
                </SortableRow>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  // Requirement 15 (class entries only): умения and подклассы are separate
  // collapsible lists rather than one flat block, so a long class doesn't
  // force scrolling through both at once.
  const isClassParent = props.entry.kind === "class";
  const featuresBlock = levelGrouped(features);
  const sortedOthers = props.sortForDisplay(others);
  const othersBlock = sortedOthers.length > 0 && (
    <div>
      {sortedOthers.map((o) => (
        <SortableRow key={o.id} entry={o} group={sortedOthers} sortMode={props.sortMode} dragId={props.dragId} onDragStartEntry={props.onDragStartEntry} onDropEntry={props.onDropEntry}>
          <EntryNode
            {...props}
            entry={o}
            depth={props.depth + 1}
            parentGroupName={props.entry.kind === "mechanic_group" ? props.entry.name : undefined}
          />
        </SortableRow>
      ))}
    </div>
  );

  if (isClassParent) {
    // The class's named options list (Таинственные воззвания / Схемы
    // магических предметов / Метамагия …) — shown when the class has a
    // section title set, or already has orphaned options to surface.
    const optionSectionTitle =
      typeof props.entry.data.option_section_title === "string"
        ? props.entry.data.option_section_title.trim()
        : "";
    const showOptions = optionSectionTitle !== "" || options.length > 0;
    // Force the relevant list open when its "+ добавить X" button just
    // created a new entry now open in the edit form — otherwise the new
    // (still-unnamed) row would be created inside a closed <details> and
    // effectively disappear from view.
    const editingIsFeature = props.editing != null && features.some((f) => f.id === props.editing!.id);
    const editingIsOption = props.editing != null && options.some((o) => o.id === props.editing!.id);
    const editingIsOther = props.editing != null && others.some((o) => o.id === props.editing!.id);
    return (
      <div className="comp-children">
        <details className="card" open={editingIsFeature || undefined}>
          <summary className="comp-level-label row chevron-summary" style={{ justifyContent: "space-between" }}>
            <span className="row" style={{ gap: 6, alignItems: "center" }}>
              <NavIcon name="chevron" className="chevron-icon" />
              Умения класса
            </span>
            <button
              className="comp-mini"
              onClick={(e) => {
                e.preventDefault();
                props.onAddChild(props.entry.id, "feature");
              }}
            >
              + добавить умение
            </button>
          </summary>
          {featuresBlock}
        </details>
        <details className="card" open={editingIsOther || undefined}>
          <summary className="comp-level-label row chevron-summary" style={{ justifyContent: "space-between" }}>
            <span className="row" style={{ gap: 6, alignItems: "center" }}>
              <NavIcon name="chevron" className="chevron-icon" />
              Подклассы
            </span>
            <button
              className="comp-mini"
              onClick={(e) => {
                e.preventDefault();
                props.onAddChild(props.entry.id, "subclass");
              }}
            >
              + добавить подкласс
            </button>
          </summary>
          {othersBlock}
        </details>
        {showOptions && (
          <details className="card" open={editingIsOption || undefined}>
            <summary className="comp-level-label row chevron-summary" style={{ justifyContent: "space-between" }}>
              <span className="row" style={{ gap: 6, alignItems: "center" }}>
                <NavIcon name="chevron" className="chevron-icon" />
                {optionSectionTitle || "Опции класса"}
              </span>
              <button
                className="comp-mini"
                onClick={(e) => {
                  e.preventDefault();
                  props.onAddChild(props.entry.id, "class_option");
                }}
              >
                + добавить опцию
              </button>
            </summary>
            {levelGrouped(options)}
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="comp-children">
      {featuresBlock}
      {othersBlock}
    </div>
  );
}
