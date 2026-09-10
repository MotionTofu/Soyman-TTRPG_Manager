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



// Только для листа персонажа — и потому по английскому ключу. У существа
// `skillProfs` другого вида (булев словарь по имени) и своим путём.
// Чистая часть (модификаторы, бонус мастерства, разбор имён характеристик)
// переехала в общий с сервером пакет — см. @shared/dnd/abilities. Реэкспорт
// оставлен: этот модуль импортируют десятки файлов листа.
export {
  emptySkillProfs,
  emptyAbilities,
  emptySavingThrowProfs,
  parseBonus,
  classSkillPool,
  classSkillChoiceTotal,
  ABILITY_NAME_TO_KEY,
  parseAbilityNames,
  totalCharacterLevel,
  computeProficiencyBonus,
  characterSpellcastingAbility,
  abilityModifier,
  formatModifier,
} from "@shared/dnd/abilities";
// Реэкспорт не вводит имена в область видимости самого модуля — а он ими
// пользуется в разметке ниже.
import { abilityModifier, formatModifier } from "@shared/dnd/abilities";

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
