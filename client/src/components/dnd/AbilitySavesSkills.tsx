import { memo, useState } from "react";
import { DndDie } from "./DndDie";
import type { DndAbilityKey, DndAbilityScores, DndSkillProfLevel } from "../../types";
import { ABILITY_LABELS, abilityModifier, formatModifier, parseBonus } from "./AbilityScores";
import { useDndPrefs } from "../../hooks/useDndPrefs";
import type { DndAbilityPrimary } from "../../dndPrefs";

interface CommonProps {
  abilities: DndAbilityScores;
  proficiencyBonus: string;
  savingThrowProfs: Record<DndAbilityKey, boolean>;
  skillProfs: Record<string, DndSkillProfLevel>;
  // Skills in the picked class(es)' choice pool are highlighted regardless of
  // whether they're actually checked (proficient) — the tint just marks
  // "this skill can/did come from your class", independent of the checkbox.
  // "From background" is whatever the picked background granted, tracked the
  // same way.
  classSkillPool: string[];
  backgroundSkillNames: string[];
}

// level is a proficiency multiplier: 0 = none, 1 = proficient, 2 = expertise
// (double proficiency bonus) — saving throws only ever use 0/1.
// `penalty` — штраф истощения (5.5: −2 за уровень к любому броску к20).
// Показанное число должно быть тем, которое бросают: иначе лист говорит
// «+5», а верно «+1». На КЗ и на сложность заклинаний истощение не влияет —
// это не броски к20, и туда штраф не передаётся.
export function computed(mod: number, level: number, profBonus: number, penalty = 0): string {
  return formatModifier(mod + profBonus * level - penalty);
}

export const SKILL_DOTS = ["○", "●", "◎"];
export const SKILL_TITLES = ["Не владеет", "Владение", "Экспертиза (бонус ×2)"];

// The ability row collapses to just score+modifier tiles by default (compact,
// avoids a giant-circle layout eating the page) and expands
// — via the button next to the section title — into a per-ability column
// showing just its saving throw (skills live in their own "Навыки" tab, see
// DndCharacterForm.tsx's DndSkillsView/Edit — pulled out so a skill list
// isn't nested three levels deep under a "Развернуть" toggle).
// Memoized for the same reason as FeatureListEdit/DndSpellsEdit — this sheet
// re-renders on every keystroke elsewhere in the form, and without memo this
// block (6 ability columns, plus saving-throw rows when expanded) re-diffs
// along with it.
export const AbilitySavesSkillsEdit = memo(function AbilitySavesSkillsEdit({
  abilities,
  proficiencyBonus,
  savingThrowProfs,
  skillProfs,
  classSkillPool,
  classSkillChoiceCount,
  backgroundSkillNames,
  onAbilitiesChange,
  onSavingThrowProfsChange,
}: CommonProps & {
  classSkillChoiceCount: number;
  onAbilitiesChange: (v: DndAbilityScores) => void;
  onSavingThrowProfsChange: (v: Record<DndAbilityKey, boolean>) => void;
  onSkillProfsChange: (v: Record<string, DndSkillProfLevel>) => void;
}) {
  const profBonus = parseBonus(proficiencyBonus);
  // A skill both in the class pool and granted by the background doesn't
  // consume a class pick — the background already covers it "for free".
  const chosenFromPool = classSkillPool.filter(
    (s) => (skillProfs[s] ?? 0) > 0 && !backgroundSkillNames.includes(s)
  ).length;
  const remaining = Math.max(0, classSkillChoiceCount - chosenFromPool);

  return (
    <div className="dnd-abilities-block">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="sb-section" style={{ margin: 0 }}>
          Характеристики и спасброски
        </div>
        {remaining > 0 && <span className="dnd-skill-remaining">Осталось выбрать навыков: {remaining}</span>}
      </div>
      <div className="dnd-abilities-row">
        {ABILITY_LABELS.map(({ key, label }) => {
          const mod = abilityModifier(abilities[key]);
          return (
            <div key={key} className="dnd-ability-col">
              <div className="dnd-ability-box">
                <span className="dnd-ability-label">{label}</span>
                <input
                  type="number"
                  className="dnd-ability-input"
                  value={abilities[key]}
                  onChange={(e) => onAbilitiesChange({ ...abilities, [key]: Number(e.target.value) || 0 })}
                />
                <span className="dnd-ability-mod">
                  {formatModifier(mod)}
                  <button
                    type="button"
                    className={`dnd-ability-save-toggle${savingThrowProfs[key] ? " is-proficient" : ""}`}
                    title="Владение спасброском (клик — переключить)"
                    onClick={() => onSavingThrowProfsChange({ ...savingThrowProfs, [key]: !savingThrowProfs[key] })}
                  >
                    /{computed(mod, savingThrowProfs[key] ? 1 : 0, profBonus)}
                  </button>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// Число внутри силуэта кости — приём дизайн-системы §6.5, взятый с макета
// карты персонажа (гриллинг 2026-09-04).
//
// Кость рисуется здесь, а не берётся из общего components/Dice.tsx: тот
// компонент владелец забраковал дважды. Разница не в идее, а в отделке —
// внутренние рёбра и точки по углам превращали ряд характеристик в груду.
// Здесь силуэт голый, число моноширинное, а владение спасброском показано
// цветом класса на верхних рёбрах, а не галочкой сбоку.
//
// Пропорция — правильный шестиугольник: при высоте 53 полуширина равна
// R·√3/2, то есть 46 в ширину. Кость, растянутая под ширину колонки,
// перестаёт читаться как та же форма, что на карте.
function AbilityBox({
  label,
  score,
  mod,
  save,
  isSaveProficient,
  primary,
  accentColor,
}: {
  label: string;
  score: number;
  mod: number;
  save: string;
  isSaveProficient: boolean;
  // Какое число крупное — модификатор или само значение. Настройка сквозная
  // (dndPrefs), общая со статблоком существа: «+3» здесь при «16» там было бы
  // расхождением, а не гибкостью.
  primary: DndAbilityPrimary;
  // Цвет класса. Владение спасброском красится им, а не «акцентом» темы: на
  // монохромном «Соевом нуаре» акцент равен чернилам, и владение было бы
  // неотличимо от обычной кости.
  accentColor?: string;
}) {
  // Переворот прежний: клик показывает спасбросок вместо значения, не отнимая
  // под него отдельную строку. Состояние своё у каждой характеристики и живёт
  // только в этом виде: это «какой стороной смотрю сейчас», а не данные.
  const [showSave, setShowSave] = useState(false);
  return (
    <div
      className={`dnd-ability-col dnd-ability-die${isSaveProficient ? " is-save-prof" : ""}`}
      onClick={() => setShowSave((v) => !v)}
      title="Клик — переключить характеристику/спасбросок"
    >
      <DndDie size="sm" edge={isSaveProficient} accentColor={accentColor}>
        <span className="dnd-die-value">
          {showSave ? save : primary === "score" ? score : formatModifier(mod)}
        </span>
        <span className="dnd-die-sub">
          {showSave ? "спас" : primary === "score" ? formatModifier(mod) : score}
        </span>
      </DndDie>
      <span className="dnd-ability-label">{label}</span>
    </div>
  );
}

export function AbilitySavesSkillsView({
  abilities,
  proficiencyBonus,
  savingThrowProfs,
  exhaustionPenalty = 0,
  accentColor,
}: CommonProps & { exhaustionPenalty?: number; accentColor?: string }) {
  const profBonus = parseBonus(proficiencyBonus);
  const prefs = useDndPrefs();

  return (
    <div className="dnd-abilities-block">
      {/* Заголовка нет: шесть костей с подписями СИЛ…ХАР не нуждаются в
          объяснении, а строка занимала высоту на самой тесной карте.
          В правке он остаётся — там рядом счётчик оставшихся навыков. */}
      <div className="dnd-abilities-row dnd-abilities-row-dice">
        {ABILITY_LABELS.map(({ key, label }) => {
          const mod = abilityModifier(abilities[key]);
          return (
            <AbilityBox
              key={key}
              label={label}
              score={abilities[key]}
              mod={mod}
              save={computed(mod, savingThrowProfs[key] ? 1 : 0, profBonus, exhaustionPenalty)}
              isSaveProficient={savingThrowProfs[key]}
              primary={prefs.abilityPrimary}
              accentColor={accentColor}
            />
          );
        })}
      </div>
    </div>
  );
}
