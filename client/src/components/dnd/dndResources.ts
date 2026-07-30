import type { DndAbilityScores, DndClassEntry } from "../../types";
import { abilityModifier } from "./AbilityScores";

// Ресурсы tab: per-class resource pools, PHB 2024 ("5.5") rules. Matched by
// class/subclass display name against a character's `classes` rows — a
// resource only shows up if the character actually has that class/subclass.
// Each pool's max is computed, never stored; only the used count and an
// external bonus (items/feats that increase the pool) are persisted.
export interface DndResourceDef {
  key: string;
  label: string;
  appliesTo(classes: DndClassEntry[]): boolean;
  computeMax(classes: DndClassEntry[], abilities: DndAbilityScores): number;
}

// Class/subclass names are stored as "Русское [English]" (e.g. "Чародей
// [Sorcerer]"), picked from the compendium — an exact-equals match against
// the bare Russian name never matches, so a name is only required to start
// with the given prefix.
function nameMatches(stored: string, name: string): boolean {
  return stored === name || stored.startsWith(`${name} [`) || stored.startsWith(`${name} (`);
}

function classLevel(classes: DndClassEntry[], name: string): number {
  const c = classes.find((c) => nameMatches(c.className, name));
  return c ? c.level : 0;
}

function hasSubclass(classes: DndClassEntry[], className: string, subclassName: string): DndClassEntry | undefined {
  return classes.find((c) => nameMatches(c.className, className) && nameMatches(c.subclassName, subclassName));
}

function byThresholds(level: number, thresholds: [number, number][]): number {
  let value = 0;
  for (const [atLevel, amount] of thresholds) {
    if (level >= atLevel) value = amount;
  }
  return value;
}

function proficiencyBonusNumber(classes: DndClassEntry[]): number {
  const totalLevel = Math.max(1, classes.reduce((sum, c) => sum + (c.level || 0), 0));
  return Math.min(6, 2 + Math.floor((totalLevel - 1) / 4));
}

export const DND_RESOURCE_DEFS: DndResourceDef[] = [
  {
    key: "sorcery_points",
    label: "Очки метамагии",
    appliesTo: (classes) => classLevel(classes, "Чародей") >= 2,
    computeMax: (classes) => classLevel(classes, "Чародей"),
  },
  {
    key: "bardic_inspiration",
    label: "Кости вдохновения",
    appliesTo: (classes) => classLevel(classes, "Бард") >= 1,
    computeMax: (_classes, abilities) => Math.max(1, abilityModifier(abilities.cha)),
  },
  {
    key: "rage",
    label: "Ярость",
    appliesTo: (classes) => classLevel(classes, "Варвар") >= 1,
    computeMax: (classes) =>
      byThresholds(classLevel(classes, "Варвар"), [
        [1, 2],
        [3, 3],
        [6, 4],
        [12, 5],
        [17, 6],
        [20, 99],
      ]),
  },
  {
    key: "superiority_dice",
    label: "Кости превосходства",
    appliesTo: (classes) => !!hasSubclass(classes, "Воин", "Мастер оружия"),
    computeMax: (classes) => {
      const c = hasSubclass(classes, "Воин", "Мастер оружия");
      const level = c ? c.level : 0;
      return byThresholds(level, [
        [1, 4],
        [7, 5],
        [15, 6],
      ]);
    },
  },
  {
    key: "channel_divinity_cleric",
    label: "Проведение божественности",
    appliesTo: (classes) => classLevel(classes, "Жрец") >= 2,
    computeMax: (classes) =>
      byThresholds(classLevel(classes, "Жрец"), [
        [2, 2],
        [6, 3],
        [18, 4],
      ]),
  },
  {
    key: "focus_points",
    label: "Очки сосредоточенности",
    appliesTo: (classes) => classLevel(classes, "Монах") >= 2,
    computeMax: (classes) => classLevel(classes, "Монах"),
  },
  {
    key: "channel_divinity_paladin",
    label: "Проведение божественности",
    appliesTo: (classes) => classLevel(classes, "Паладин") >= 5,
    computeMax: (classes) =>
      byThresholds(classLevel(classes, "Паладин"), [
        [5, 1],
        [11, 2],
      ]),
  },
  {
    key: "lay_on_hands",
    label: "Возложение рук",
    appliesTo: (classes) => classLevel(classes, "Паладин") >= 1,
    computeMax: (classes) => classLevel(classes, "Паладин") * 5,
  },
  {
    key: "favored_enemy",
    label: "Избранный враг",
    appliesTo: (classes) => classLevel(classes, "Следопыт") >= 1,
    computeMax: (classes) => proficiencyBonusNumber(classes),
  },
];

export function applicableResources(classes: DndClassEntry[]): DndResourceDef[] {
  return DND_RESOURCE_DEFS.filter((r) => r.appliesTo(classes));
}
