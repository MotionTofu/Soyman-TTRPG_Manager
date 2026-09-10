/**
 * Характеристики, модификаторы и бонус мастерства — чистая часть, вынутая из
 * `client/src/components/dnd/AbilityScores.tsx` 2026-09-10.
 *
 * Вынута не ради порядка: `effects.ts` импортировал `abilityModifier` из
 * `.tsx`, и это была единственная ниточка, которой чистые правила D&D были
 * привязаны к React. Пока она была, ни один из этих модулей не мог переехать
 * в общий с сервером пакет.
 */
import type { DndAbilityKey, DndClassEntry, DndSkillProfLevel } from "./types";
import { SKILL_CATALOG } from "./skillCatalog";

/** Полные русские имена характеристик — в таком виде их пишет компендиум. */
export const ABILITY_NAMES = ["Сила", "Ловкость", "Телосложение", "Интеллект", "Мудрость", "Харизма"] as const;

export function emptySkillProfs(): Record<string, DndSkillProfLevel> {
  const profs: Record<string, DndSkillProfLevel> = {};
  for (const def of SKILL_CATALOG) profs[def.original] = 0;
  return profs;
}

// Parses "+2" / "2" / "-1" style strings into a number, defaulting to 0 for
// anything unparseable — the proficiency bonus field is free text so a
// character can type "+2" or just "2".
export function parseBonus(text: string): number {
  const n = parseInt(text.replace(/[^-\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

// Union of every class row's skill-choice pool (a multiclassed character can
// have picked more than one class with its own choices).
export function classSkillPool(classes: DndClassEntry[]): string[] {
  const set = new Set<string>();
  for (const c of classes) for (const s of c.skillChoiceOptions ?? []) set.add(s);
  return Array.from(set);
}

// Total skills the player still gets to pick across all classes.
export function classSkillChoiceTotal(classes: DndClassEntry[]): number {
  return classes.reduce((sum, c) => sum + (c.skillChoiceCount || 0), 0);
}

// Maps the full Russian ability names stored on compendium class entries
// (data.saving_throws, data.spellcasting_ability — either an array of these
// names or, for older/legacy entries, a comma-separated string) to the
// short ability keys the character sheet uses everywhere else.
export const ABILITY_NAME_TO_KEY: Record<string, DndAbilityKey> = {
  "Сила": "str",
  "Ловкость": "dex",
  "Телосложение": "con",
  "Интеллект": "int",
  "Мудрость": "wis",
  "Харизма": "cha",
};

export function parseAbilityNames(raw: unknown): DndAbilityKey[] {
  const names = Array.isArray(raw)
    ? (raw as unknown[]).filter((v): v is string => typeof v === "string")
    : typeof raw === "string"
      ? raw.split(/[,;]+/).map((s) => s.trim())
      : [];
  const keys: DndAbilityKey[] = [];
  for (const name of names) {
    const key = ABILITY_NAME_TO_KEY[name];
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

// Total character level = sum of every class row's level. Used both for the
// proficiency bonus and for filtering species "Обретаемые заклинания" (which
// key off total character level, as opposed to subclass grants, which key
// off that one class's own level).
export function totalCharacterLevel(classes: DndClassEntry[]): number {
  return classes.reduce((sum, c) => sum + (c.level || 0), 0);
}

// 1-4 => +2, 5-8 => +3, 9-12 => +4, 13-16 => +5, 17-20 => +6. Min level 1,
// since an empty class list still means "a 1st-level character" for this
// purpose.
export function computeProficiencyBonus(classes: DndClassEntry[]): string {
  const totalLevel = Math.max(1, totalCharacterLevel(classes));
  const bonus = Math.min(6, 2 + Math.floor((totalLevel - 1) / 4));
  return formatModifier(bonus);
}

// The character's spellcasting ability, taken from the first class row that
// has one set (compendium class entries carry data.spellcasting_ability as
// a single Russian ability name, e.g. "Харизма").
export function characterSpellcastingAbility(classes: DndClassEntry[]): DndAbilityKey | null {
  for (const c of classes) {
    if (c.spellcastingAbility) {
      const key = ABILITY_NAME_TO_KEY[c.spellcastingAbility];
      if (key) return key;
    }
  }
  return null;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}
