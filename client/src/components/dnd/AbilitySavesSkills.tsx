import { memo, useState } from "react";
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

// Blueish = from class, greenish = from background, reddish = both — tone
// comes from color-mix against the theme's own paper/ink, so it adapts per
// theme (see .skill-source-* rules in index.css). Exported — the standalone
// "Навыки" tab in DndCharacterForm.tsx uses the same tinting.
export function skillSourceClass(
  skill: string,
  classSkillPool: string[],
  backgroundSkillNames: string[]
): string {
  const fromClass = classSkillPool.includes(skill);
  const fromBackground = backgroundSkillNames.includes(skill);
  if (fromClass && fromBackground) return " skill-source-both";
  if (fromClass) return " skill-source-class";
  if (fromBackground) return " skill-source-background";
  return "";
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

// Plain rectangular tile (same .dnd-ability-box frame the edit view uses) —
// an earlier version showed this as two overlapping d20 dice you'd flip
// between, but at a glance it read as a jumbled pile rather than a score, so
// it's back to a flat box. The flip behavior itself stayed: click toggles
// between showing the ability score+modifier and its saving throw, without
// eating a separate row/column for the save. Toggle state is per-ability and
// local to this view (not persisted — it's just "which face am I looking at
// right now", not character data).
function AbilityBox({
  label,
  score,
  mod,
  save,
  isSaveProficient,
  primary,
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
}) {
  const [showSave, setShowSave] = useState(false);
  return (
    <div className="dnd-ability-col">
      <div
        className="dnd-ability-box dnd-ability-box-clickable"
        onClick={() => setShowSave((v) => !v)}
        title="Клик — переключить характеристику/спасбросок"
      >
        <span className="dnd-ability-label">{label}</span>
        {showSave ? (
          <>
            <span className={`dnd-ability-score${isSaveProficient ? " is-proficient" : ""}`}>{save}</span>
            <span className="dnd-ability-label">спас</span>
          </>
        ) : (
          <>
            <span className="dnd-ability-score">
              {primary === "score" ? score : formatModifier(mod)}
            </span>
            <span className="dnd-ability-mod">{primary === "score" ? formatModifier(mod) : score}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function AbilitySavesSkillsView({
  abilities,
  proficiencyBonus,
  savingThrowProfs,
  exhaustionPenalty = 0,
}: CommonProps & { exhaustionPenalty?: number }) {
  const profBonus = parseBonus(proficiencyBonus);
  const prefs = useDndPrefs();

  return (
    <div className="dnd-abilities-block">
      <div className="sb-section" style={{ margin: 0 }}>
        Характеристики и спасброски
      </div>
      <div className="dnd-abilities-row">
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
            />
          );
        })}
      </div>
    </div>
  );
}
