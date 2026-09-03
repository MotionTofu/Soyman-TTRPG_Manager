import type { DndAbilityKey, DndAbilityScores, DndClassEntry, DndSkillProfLevel } from "../../types";
import { SKILL_CATALOG } from "./skillCatalog";

const LABELS: { key: keyof DndAbilityScores; label: string }[] = [
  { key: "str", label: "СИЛ" },
  { key: "dex", label: "ЛОВ" },
  { key: "con", label: "ТЕЛ" },
  { key: "int", label: "ИНТ" },
  { key: "wis", label: "МДР" },
  { key: "cha", label: "ХАР" },
];

// Навыки по характеристикам — ИМЕНАМИ. Отдельно от ключей: лист персонажа
// перешёл на английский `original` (см. skillCatalog.ts), а статблок существа
// и редактор компендиума по-прежнему держат в `skillProfs` русское имя. Здесь
// список один, выведенный из каталога, чтобы имя навыка во всём приложении
// было одно и то же.
export const SKILLS_BY_ABILITY: Record<DndAbilityKey, string[]> = {
  str: [],
  dex: [],
  con: [],
  int: [],
  wis: [],
  cha: [],
};
for (const def of SKILL_CATALOG) SKILLS_BY_ABILITY[def.ability].push(def.name);

export const ALL_SKILLS: string[] = Object.values(SKILLS_BY_ABILITY).flat();

export function emptyAbilities(): DndAbilityScores {
  return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
}

export function emptySavingThrowProfs(): Record<DndAbilityKey, boolean> {
  return { str: false, dex: false, con: false, int: false, wis: false, cha: false };
}

// Только для листа персонажа — и потому по английскому ключу. У существа
// `skillProfs` другого вида (булев словарь по имени) и своим путём.
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

export const ABILITY_LABELS = LABELS;

export function AbilityScoresEdit({
  value,
  onChange,
}: {
  value: DndAbilityScores;
  onChange: (v: DndAbilityScores) => void;
}) {
  return (
    <div className="dnd-abilities-row">
      {LABELS.map(({ key, label }) => (
        <div key={key} className="dnd-ability-box">
          <span className="dnd-ability-label">{label}</span>
          <input
            type="number"
            className="dnd-ability-input"
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) || 0 })}
          />
          <span className="dnd-ability-mod">{formatModifier(abilityModifier(value[key]))}</span>
        </div>
      ))}
    </div>
  );
}

export function AbilityScoresView({ value }: { value: DndAbilityScores }) {
  return (
    <div className="dnd-abilities-row">
      {LABELS.map(({ key, label }) => (
        <div key={key} className="dnd-ability-box">
          <span className="dnd-ability-label">{label}</span>
          <span className="dnd-ability-score">{value[key]}</span>
          <span className="dnd-ability-mod">{formatModifier(abilityModifier(value[key]))}</span>
        </div>
      ))}
    </div>
  );
}
