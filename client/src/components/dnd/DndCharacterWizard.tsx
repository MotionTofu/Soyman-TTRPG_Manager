import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { CompendiumEntry, DndAbilityScores, DndFeature } from "../../types";
import { emptyDndCharacter, recomputeGrantedSpells } from "./DndCharacterForm";
import {
  ABILITY_LABELS,
  abilityModifier,
  computeProficiencyBonus,
  emptyAbilities,
  emptySavingThrowProfs,
  formatModifier,
  parseAbilityNames,
} from "./AbilityScores";
import {
  findDndSystemId,
  loadDndBackgroundOptions,
  loadDndClassFeatures,
  loadDndClassHierarchy,
  loadDndSpeciesFeatures,
  loadDndSpeciesOptions,
  type DndBackgroundOption,
  type DndClassHierarchy,
  type DndSpeciesOption,
} from "./dndCompendium";

const STEPS = ["Личность", "Класс", "Вид", "Предыстория", "Характеристики", "Навыки", "Обзор"] as const;
type Step = (typeof STEPS)[number];

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const POINT_BUY_BUDGET = 27;
type AbilityMethod = "standard" | "pointbuy" | "roll" | "manual";

function rollAbilityScore(): number {
  const rolls = Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6));
  rolls.sort((a, b) => a - b);
  return rolls[1] + rolls[2] + rolls[3];
}

function featuresFromEntries(entries: CompendiumEntry[], sourceParentId: number, level: number): DndFeature[] {
  return entries
    .filter((e) => (e.level ?? 0) <= level)
    .map((e) => ({ name: e.name, description: e.description, sourceParentId, level: e.level ?? undefined }));
}

interface Props {
  ownerType: "character" | "being";
  ownerId: number;
  ownerName?: string;
  ownerPlayerName?: string;
  onDone: () => void;
  onCancel: () => void;
}

// Guided step-by-step creation for a brand-new D&D 5.5 character statblock —
// used only when adding a fresh dnd_character (see StatblockList's addStatblock).
// Leveling up / editing an existing character stays in the regular
// DndCharacterEdit form; this wizard is a one-time onboarding path only.
export function DndCharacterWizard({ ownerType, ownerId, ownerName, ownerPlayerName, onDone, onCancel }: Props) {
  const [step, setStep] = useState<Step>("Личность");
  const [systemId, setSystemId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [characterName, setCharacterName] = useState(ownerName ?? "");
  const [playerName, setPlayerName] = useState(ownerType === "character" ? ownerPlayerName ?? "" : "");

  const [hierarchy, setHierarchy] = useState<DndClassHierarchy>({ classes: [], subclassesByClass: {} });
  const [classId, setClassId] = useState<number | null>(null);
  const [subclassId, setSubclassId] = useState<number | null>(null);
  const [level, setLevel] = useState(1);
  // Lets the field sit empty mid-edit instead of every keystroke snapping
  // it back to "1" — the default only applies once, on blur, if left empty.
  const [levelText, setLevelText] = useState<string | null>(null);
  function commitLevel(raw: string) {
    setLevel(Math.min(20, Math.max(1, Math.round(Number(raw)) || 1)));
    setLevelText(null);
  }
  function stepLevel(delta: number) {
    setLevel((l) => Math.min(20, Math.max(1, l + delta)));
  }
  const [classEntry, setClassEntry] = useState<CompendiumEntry | null>(null);

  const [speciesOptions, setSpeciesOptions] = useState<DndSpeciesOption[]>([]);
  const [speciesId, setSpeciesId] = useState<number | null>(null);

  const [backgroundOptions, setBackgroundOptions] = useState<DndBackgroundOption[]>([]);
  const [backgroundId, setBackgroundId] = useState<number | null>(null);
  const [backgroundEntry, setBackgroundEntry] = useState<CompendiumEntry | null>(null);

  const [method, setMethod] = useState<AbilityMethod>("standard");
  const [abilities, setAbilities] = useState<DndAbilityScores>(() => {
    const a = emptyAbilities();
    (Object.keys(a) as (keyof DndAbilityScores)[]).forEach((k, i) => (a[k] = STANDARD_ARRAY[i]));
    return a;
  });
  const [rolledPool, setRolledPool] = useState<number[]>(STANDARD_ARRAY);
  const [chosenSkills, setChosenSkills] = useState<string[]>([]);

  useEffect(() => {
    findDndSystemId().then(setSystemId);
  }, []);

  useEffect(() => {
    if (!systemId) return;
    loadDndClassHierarchy(systemId).then(setHierarchy);
    loadDndSpeciesOptions(systemId).then(setSpeciesOptions);
    loadDndBackgroundOptions(systemId).then(setBackgroundOptions);
  }, [systemId]);

  useEffect(() => {
    if (!classId) {
      setClassEntry(null);
      return;
    }
    api.get<CompendiumEntry>(`/systems/entries/${classId}`).then(setClassEntry);
  }, [classId]);

  useEffect(() => {
    if (!backgroundId) {
      setBackgroundEntry(null);
      return;
    }
    api.get<CompendiumEntry>(`/systems/entries/${backgroundId}`).then(setBackgroundEntry);
  }, [backgroundId]);

  // Standard array/roll assignment is a permutation of a fixed pool — picking
  // a value already used elsewhere swaps the two abilities instead of
  // duplicating it, so the assignment is always valid.
  function assignFromPool(key: keyof DndAbilityScores, newValue: number) {
    const holder = (Object.keys(abilities) as (keyof DndAbilityScores)[]).find((k) => abilities[k] === newValue);
    const next = { ...abilities, [key]: newValue };
    if (holder && holder !== key) next[holder] = abilities[key];
    setAbilities(next);
  }

  function applyMethod(next: AbilityMethod) {
    setMethod(next);
    if (next === "standard") {
      setRolledPool(STANDARD_ARRAY);
      const keys = Object.keys(abilities) as (keyof DndAbilityScores)[];
      const a = emptyAbilities();
      keys.forEach((k, i) => (a[k] = STANDARD_ARRAY[i]));
      setAbilities(a);
    } else if (next === "roll") {
      const pool = Array.from({ length: 6 }, rollAbilityScore).sort((a, b) => b - a);
      setRolledPool(pool);
      const keys = Object.keys(abilities) as (keyof DndAbilityScores)[];
      const a = emptyAbilities();
      keys.forEach((k, i) => (a[k] = pool[i]));
      setAbilities(a);
    } else if (next === "pointbuy") {
      setAbilities({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
    }
    // "manual" keeps whatever is currently set — free typing.
  }

  function reroll() {
    const pool = Array.from({ length: 6 }, rollAbilityScore).sort((a, b) => b - a);
    setRolledPool(pool);
    const keys = Object.keys(abilities) as (keyof DndAbilityScores)[];
    const a = emptyAbilities();
    keys.forEach((k, i) => (a[k] = pool[i]));
    setAbilities(a);
  }

  const pointBuySpent = Object.values(abilities).reduce((sum, v) => sum + (POINT_BUY_COST[v] ?? 0), 0);
  const pointBuyRemaining = POINT_BUY_BUDGET - pointBuySpent;

  function adjustPointBuy(key: keyof DndAbilityScores, delta: number) {
    const nextVal = abilities[key] + delta;
    if (nextVal < 8 || nextVal > 15) return;
    const cost = (POINT_BUY_COST[nextVal] ?? 0) - (POINT_BUY_COST[abilities[key]] ?? 0);
    if (pointBuyRemaining - cost < 0) return;
    setAbilities({ ...abilities, [key]: nextVal });
  }

  const classOption = hierarchy.classes.find((c) => c.id === classId);
  const subclassOptions = classId ? hierarchy.subclassesByClass[classId] ?? [] : [];
  const skillChoiceOptions: string[] = Array.isArray(classEntry?.data.skill_choice_options)
    ? (classEntry!.data.skill_choice_options as string[])
    : [];
  const skillChoiceCount = typeof classEntry?.data.skill_choice_count === "number" ? classEntry!.data.skill_choice_count : 0;
  const backgroundSkills: string[] = Array.isArray(backgroundEntry?.data.skills)
    ? (backgroundEntry!.data.skills as string[])
    : [];

  function toggleSkill(name: string) {
    setChosenSkills((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : prev.length < skillChoiceCount ? [...prev, name] : prev
    );
  }

  async function finish() {
    setSaving(true);
    const character = emptyDndCharacter();
    character.systemId = systemId;
    character.characterName = characterName;
    character.playerName = playerName;
    character.abilities = abilities;

    if (classId && classOption) {
      const subclassOpt = subclassOptions.find((s) => s.id === subclassId);
      character.classes = [
        {
          classId,
          className: classOption.name,
          subclassId: subclassId,
          subclassName: subclassOpt?.name ?? "",
          level,
          skillChoiceOptions,
          skillChoiceCount,
          spellcastingAbility:
            typeof classEntry?.data.spellcasting_ability === "string" ? (classEntry!.data.spellcasting_ability as string) : "",
        },
      ];
      character.proficiencyBonus = computeProficiencyBonus(character.classes);
      const hitDieMatch = /\d+/.exec(classOption.hitDie);
      if (hitDieMatch) character.hitDice = `${level}к${hitDieMatch[0]}`;

      if (classEntry) {
        const savingThrowKeys = parseAbilityNames(classEntry.data.saving_throws);
        if (savingThrowKeys.length > 0) {
          character.savingThrowProfs = { ...emptySavingThrowProfs() };
          for (const k of savingThrowKeys) character.savingThrowProfs[k] = true;
        }
        const toolPicks = Array.isArray(classEntry.data.tool_profs)
          ? (classEntry.data.tool_profs as { id: number; name: string }[])
          : [];
        character.proficiencies = toolPicks.map((t) => ({ entryId: t.id, name: t.name, abilityKey: null }));
      }
      try {
        const classFeatureEntries = await loadDndClassFeatures(systemId!, classId);
        let classFeatures = featuresFromEntries(classFeatureEntries, classId, level);
        if (subclassId) {
          const subclassFeatureEntries = await loadDndClassFeatures(systemId!, subclassId);
          classFeatures = [...classFeatures, ...featuresFromEntries(subclassFeatureEntries, subclassId, level)];
        }
        character.classFeatures = classFeatures;
      } catch {
        // compendium unreachable — leave classFeatures empty, editable later
      }
    }

    if (speciesId) {
      const species = speciesOptions.find((s) => s.id === speciesId);
      character.raceId = speciesId;
      character.raceName = species?.name ?? "";
      character.raceTypeName = species?.creatureTypeName ?? "";
      if (species?.walkSpeed) character.speed = `${species.walkSpeed} фт.`;
      try {
        const speciesFeatureEntries = await loadDndSpeciesFeatures(systemId!, speciesId);
        character.speciesFeatures = featuresFromEntries(speciesFeatureEntries, speciesId, level);
      } catch {
        // ignore — editable later
      }
    }

    if (backgroundId) {
      const bg = backgroundOptions.find((b) => b.id === backgroundId);
      character.backgroundId = backgroundId;
      character.backgroundName = bg?.name ?? "";
      character.backgroundSkillNames = backgroundSkills;
      try {
        const entry = await api.get<CompendiumEntry>(`/systems/entries/${backgroundId}`);
        const tools = typeof entry.data.tools === "string" ? entry.data.tools : "";
        if (tools) character.proficiencies = [...character.proficiencies, { entryId: null, name: tools, abilityKey: null }];
        const originFeat = entry.data.origin_feat as { id: number; name: string } | undefined;
        if (originFeat) {
          let description = "";
          try {
            const featEntry = await api.get<CompendiumEntry>(`/systems/entries/${originFeat.id}`);
            description = featEntry.description || "";
          } catch {
            /* feat entry missing — leave description blank */
          }
          character.feats = [...character.feats, { name: originFeat.name, description }];
        }
      } catch {
        /* background has no compendium entry (freehand) — nothing to fill */
      }
    }

    character.skillProfs = { ...character.skillProfs };
    for (const s of chosenSkills) character.skillProfs[s] = 1;
    for (const s of backgroundSkills) character.skillProfs[s] = 1;

    // Same resync edit mode runs after picking a species/subclass/level —
    // without it, a fresh character's subclass-granted spells (e.g. an
    // Artificer subclass's bonus spells) only appeared after the level was
    // changed away and back in the editor, since that was the only place
    // this ran.
    try {
      const { cantrips, spellsByLevel, spellSlotLevels } = await recomputeGrantedSpells(character);
      character.cantrips = cantrips;
      character.spellsByLevel = spellsByLevel;
      character.spellSlotLevels = spellSlotLevels;
    } catch {
      /* compendium unreachable — leave spells empty, editable later */
    }

    await api.post("/statblocks", {
      owner_type: ownerType,
      owner_id: ownerId,
      format: "dnd_character",
      kind: "full",
      content: JSON.stringify(character),
    });
    setSaving(false);
    onDone();
  }

  const stepIndex = STEPS.indexOf(step);
  function next() {
    setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]);
  }
  function back() {
    setStep(STEPS[Math.max(0, stepIndex - 1)]);
  }

  return (
    <div className="card stack">
      <div className="tabs">
        {STEPS.map((s, i) => (
          <button key={s} className={step === s ? "active" : ""} disabled={i > stepIndex} onClick={() => setStep(s)}>
            {s}
          </button>
        ))}
      </div>

      {step === "Личность" && (
        <div className="stack">
          <label>
            Имя персонажа
            <input value={characterName} onChange={(e) => setCharacterName(e.target.value)} />
          </label>
          <label>
            Имя игрока
            <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
          </label>
        </div>
      )}

      {step === "Класс" && (
        <div className="stack">
          {!systemId && <span className="muted">У кампании не указана система — выбор класса недоступен, можно будет добавить позже.</span>}
          <div className="row">
            <select value={classId ?? ""} onChange={(e) => { setClassId(e.target.value ? Number(e.target.value) : null); setSubclassId(null); }}>
              <option value="">— класс —</option>
              {hierarchy.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {subclassOptions.length > 0 && (
              <select value={subclassId ?? ""} onChange={(e) => setSubclassId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— подкласс —</option>
                {subclassOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <label className="row">
              Уровень
              <span className="dnd-class-level-stepper">
                <button
                  type="button"
                  className="dnd-level-step-btn"
                  aria-label="Уровень −1"
                  disabled={level <= 1}
                  onClick={() => stepLevel(-1)}
                >
                  ▾
                </button>
                <button
                  type="button"
                  className="dnd-level-step-btn"
                  aria-label="Уровень +1"
                  disabled={level >= 20}
                  onClick={() => stepLevel(1)}
                >
                  ▴
                </button>
              </span>
              <input
                type="number"
                min={1}
                max={20}
                style={{ width: 60 }}
                value={levelText ?? level}
                onChange={(e) => setLevelText(e.target.value)}
                onBlur={(e) => commitLevel(e.target.value)}
              />
            </label>
          </div>
        </div>
      )}

      {step === "Вид" && (
        <div className="stack">
          <select value={speciesId ?? ""} onChange={(e) => setSpeciesId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— вид —</option>
            {speciesOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {step === "Предыстория" && (
        <div className="stack">
          <select value={backgroundId ?? ""} onChange={(e) => setBackgroundId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— предыстория —</option>
            {backgroundOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {step === "Характеристики" && (
        <div className="stack">
          <div className="row">
            <label className="row">
              <input type="radio" checked={method === "standard"} onChange={() => applyMethod("standard")} />
              Стандартный массив
            </label>
            <label className="row">
              <input type="radio" checked={method === "pointbuy"} onChange={() => applyMethod("pointbuy")} />
              Point-buy
            </label>
            <label className="row">
              <input type="radio" checked={method === "roll"} onChange={() => applyMethod("roll")} />
              Бросок костей
            </label>
            <label className="row">
              <input type="radio" checked={method === "manual"} onChange={() => applyMethod("manual")} />
              Вручную
            </label>
          </div>

          {method === "pointbuy" && <div className="muted">Осталось очков: {pointBuyRemaining} из {POINT_BUY_BUDGET}</div>}
          {method === "roll" && (
            <div className="row">
              <span className="muted">Пул: {rolledPool.join(", ")}</span>
              <button type="button" onClick={reroll}>
                Перебросить
              </button>
            </div>
          )}

          <div className="dnd-abilities-row">
            {ABILITY_LABELS.map(({ key, label }) => (
              <div key={key} className="dnd-ability-box">
                <span className="dnd-ability-label">{label}</span>
                {method === "standard" || method === "roll" ? (
                  <select value={abilities[key]} onChange={(e) => assignFromPool(key, Number(e.target.value))}>
                    {rolledPool.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : method === "pointbuy" ? (
                  <div className="row" style={{ gap: 4 }}>
                    <button type="button" onClick={() => adjustPointBuy(key, -1)}>
                      −
                    </button>
                    <span className="dnd-ability-score">{abilities[key]}</span>
                    <button type="button" onClick={() => adjustPointBuy(key, 1)}>
                      +
                    </button>
                  </div>
                ) : (
                  <input
                    type="number"
                    className="dnd-ability-input"
                    value={abilities[key]}
                    onChange={(e) => setAbilities({ ...abilities, [key]: Number(e.target.value) || 0 })}
                  />
                )}
                <span className="dnd-ability-mod">{formatModifier(abilityModifier(abilities[key]))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === "Навыки" && (
        <div className="stack">
          {skillChoiceOptions.length > 0 ? (
            <>
              <span className="muted">
                Выберите {skillChoiceCount} из списка класса ({chosenSkills.length}/{skillChoiceCount})
              </span>
              <div className="stack" style={{ gap: 4 }}>
                {skillChoiceOptions.map((s) => (
                  <label key={s} className="row">
                    <input type="checkbox" checked={chosenSkills.includes(s)} onChange={() => toggleSkill(s)} />
                    {s}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <span className="muted">У выбранного класса нет владений навыками на выбор (или класс не выбран).</span>
          )}
          {backgroundSkills.length > 0 && (
            <span className="muted">От предыстории автоматически: {backgroundSkills.join(", ")}</span>
          )}
        </div>
      )}

      {step === "Обзор" && (
        <div className="stack">
          <div>
            <strong>{characterName || "Без имени"}</strong>
            {playerName && <span className="muted"> — {playerName}</span>}
          </div>
          <div className="muted">
            {classOption?.name ?? "—"} {level} · {speciesOptions.find((s) => s.id === speciesId)?.name ?? "—"} ·{" "}
            {backgroundOptions.find((b) => b.id === backgroundId)?.name ?? "—"}
          </div>
          <div className="dnd-abilities-row">
            {ABILITY_LABELS.map(({ key, label }) => (
              <div key={key} className="dnd-ability-box">
                <span className="dnd-ability-label">{label}</span>
                <span className="dnd-ability-score">{abilities[key]}</span>
                <span className="dnd-ability-mod">{formatModifier(abilityModifier(abilities[key]))}</span>
              </div>
            ))}
          </div>
          <span className="muted">
            Снаряжение и заклинания добавляются после создания, в обычном режиме редактирования персонажа.
          </span>
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <button onClick={onCancel}>Отмена</button>
          {stepIndex > 0 && <button onClick={back}>Назад</button>}
        </div>
        {step === "Обзор" ? (
          <button className="primary" onClick={finish} disabled={saving || !characterName}>
            {saving ? "Создаю…" : "Создать персонажа"}
          </button>
        ) : (
          <button className="primary" onClick={next} disabled={step === "Личность" && !characterName}>
            Далее
          </button>
        )}
      </div>
    </div>
  );
}
