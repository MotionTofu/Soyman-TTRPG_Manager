import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { CompendiumEntry, DndAbilityScores } from "../../types";
import { emptyDndCharacter, recomputeGrantedSpells } from "./DndCharacterForm";
import {
  EMPTY_EQUIPMENT_ITEM,
  fetchEquipmentMeta,
  startingSetsFrom,
  type StartingSet,
} from "./dndEquipment";
import { featuresFromEntries } from "./dndFeatures";
import { useDndSkills } from "./useDndSkills";
import { grantsFromEntry } from "./dndGrants";
import {
  ABILITY_LABELS,
  ABILITY_NAME_TO_KEY,
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
  loadDndOriginFeats,
  loadDndClassFeatures,
  loadDndClassHierarchy,
  loadDndSpeciesFeatures,
  loadDndSpeciesOptions,
  type DndFeatOption,
  type DndBackgroundOption,
  type DndClassHierarchy,
  type DndSpeciesOption,
  errorMessage,
  isAbortError,
} from "./dndCompendium";

// Черта происхождения стоит ПЕРЕД навыками, и это не косметика: «Одарённый»
// добавляет к выбору три навыка, а сама черта приходит из двух мест —
// предыстории и вида (у Человека это «Универсальность»). Спроси навыки
// раньше — и три из них будет негде взять (решение W3, гриллинг 2026-09-04).
// Снаряжение — предпоследним шагом: набор зависит и от класса, и от
// предыстории, а до сих пор его приходилось брать вручную уже после
// создания, кнопкой во вкладке «Инвентарь» (решение Q5).
const STEPS = [
  "Личность",
  "Класс",
  "Вид",
  "Предыстория",
  "Черта",
  "Характеристики",
  "Навыки",
  "Снаряжение",
  "Обзор",
] as const;
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

interface Props {
  ownerType: "character" | "being";
  ownerId: number;
  ownerName?: string;
  ownerPlayerName?: string;
  onDone: () => void;
  onCancel: () => void;
  // Система, выбранная шагом раньше (таббар чарников на десктопе): тогда
  // автоопределение не запускаем — выбор уже сделан.
  initialSystemId?: number | null;
}

// Guided step-by-step creation for a brand-new D&D 5.5 character statblock —
// used only when adding a fresh dnd_character (see StatblockList's addStatblock).
// Leveling up / editing an existing character stays in the regular
// DndCharacterEdit form; this wizard is a one-time onboarding path only.
export function DndCharacterWizard({ ownerType, ownerId, ownerName, ownerPlayerName, onDone, onCancel, initialSystemId }: Props) {
  const [step, setStep] = useState<Step>("Личность");
  const [systemId, setSystemId] = useState<number | null>(initialSystemId ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Справочник не загрузился. Отдельно от saveError: одно про сохранение,
  // другое про то, что выбирать не из чего и почему.
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const [speciesEntry, setSpeciesEntry] = useState<CompendiumEntry | null>(null);

  const [backgroundOptions, setBackgroundOptions] = useState<DndBackgroundOption[]>([]);
  const [backgroundId, setBackgroundId] = useState<number | null>(null);
  const [backgroundEntry, setBackgroundEntry] = useState<CompendiumEntry | null>(null);

  const [originFeats, setOriginFeats] = useState<DndFeatOption[]>([]);
  // null — черта ещё не выбиралась: тогда берётся подставленная предысторией.
  // Значение живёт отдельно от предыстории, потому что Мастер вправе
  // разрешить другую, а у Человека она выбирается с нуля.
  const [featId, setFeatId] = useState<number | null>(null);
  const [featTouched, setFeatTouched] = useState(false);
  const [featEntry, setFeatEntry] = useState<CompendiumEntry | null>(null);

  // Прибавка от предыстории: либо +2 одной и +1 другой, либо +1 каждой из
  // трёх (решение W5).
  const [awardMode, setAwardMode] = useState<"2+1" | "1+1+1">("2+1");
  const [awardPrimary, setAwardPrimary] = useState<string | null>(null);
  const [awardSecondary, setAwardSecondary] = useState<string | null>(null);

  // Наборы берутся по умолчанию: персонаж без снаряжения — это почти всегда
  // забытый шаг, а не решение. Отказаться можно галочкой.
  const [takenSets, setTakenSets] = useState<Record<string, boolean>>({});

  const [method, setMethod] = useState<AbilityMethod>("standard");
  const [abilities, setAbilities] = useState<DndAbilityScores>(() => {
    const a = emptyAbilities();
    (Object.keys(a) as (keyof DndAbilityScores)[]).forEach((k, i) => (a[k] = STANDARD_ARRAY[i]));
    return a;
  });
  const [rolledPool, setRolledPool] = useState<number[]>(STANDARD_ARRAY);
  const [chosenSkills, setChosenSkills] = useState<string[]>([]);
  // Имена навыков и их сведение к ключам — из справочника, как на листе.
  const skills = useDndSkills(systemId);

  useEffect(() => {
    if (initialSystemId != null) return;
    let alive = true;
    findDndSystemId()
      .then((sid) => alive && setSystemId(sid))
      .catch((e) => alive && !isAbortError(e) && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [initialSystemId]);

  // Визард — мастер создания, и он листается быстро: шаг «Класс» может
  // смениться раньше, чем доедет ответ. Без отмены доехавший ответ дописывал
  // уже закрытую форму, а любая ошибка уходила в unhandled rejection и на
  // экране выглядела пустым списком.
  useEffect(() => {
    if (!systemId) return;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all([
      loadDndClassHierarchy(systemId, opts).then(setHierarchy),
      loadDndSpeciesOptions(systemId, opts).then(setSpeciesOptions),
      loadDndBackgroundOptions(systemId, opts).then(setBackgroundOptions),
      loadDndOriginFeats(systemId, opts).then(setOriginFeats),
    ]).catch((e) => {
      if (!isAbortError(e)) setLoadError(errorMessage(e));
    });
    return () => ac.abort();
  }, [systemId]);

  useEffect(() => {
    if (!classId) {
      setClassEntry(null);
      return;
    }
    const ac = new AbortController();
    api
      .get<CompendiumEntry>(`/systems/entries/${classId}`, { signal: ac.signal })
      .then(setClassEntry)
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [classId]);

  useEffect(() => {
    if (!backgroundId) {
      setBackgroundEntry(null);
      return;
    }
    const ac = new AbortController();
    api
      .get<CompendiumEntry>(`/systems/entries/${backgroundId}`, { signal: ac.signal })
      .then(setBackgroundEntry)
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [backgroundId]);

  // Запись вида целиком, а не только строка списка: выдачи (навык на выбор у
  // Человека, обретаемые заклинания) лежат в её `data`.
  useEffect(() => {
    if (!speciesId) {
      setSpeciesEntry(null);
      return;
    }
    const ac = new AbortController();
    api
      .get<CompendiumEntry>(`/systems/entries/${speciesId}`, { signal: ac.signal })
      .then(setSpeciesEntry)
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [speciesId]);

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
  // Ключами (английский `original`), а не именами из компендиума: в
  // `skillProfs` листа теперь ключ, и визард, выдающий имя, оставлял бы
  // персонажу владение, которого на листе не видно (гриллинг 2026-09-04).
  // Выдачи всех источников разбираются одним читателем (dndGrants.ts): до
  // него визард читал поля класса и предыстории вручную, а вид и черту не
  // читал вовсе — оттого Человек не получал навыка, а «Одарённый» не
  // добавлял трёх.
  const resolveSkill = skills.resolve;
  // Наборы класса и предыстории. Набор «B» — только золото, и это верно по
  // правилам: он и есть «возьми деньгами».
  const startingSets: StartingSet[] = [
    ...startingSetsFrom(classEntry ?? undefined, classOption?.name ?? "Класс"),
    ...startingSetsFrom(backgroundEntry ?? undefined, backgroundEntry?.name ?? "Предыстория"),
  ];
  const setTaken = (label: string) => takenSets[label] ?? label.endsWith("набор A");
  // Класс или предыстория выбраны, а их запись ещё не приехала — набора
  // просто ещё нет, и это не то же самое, что «набора нет в справочнике».
  const setsStillLoading = (!!classId && !classEntry) || (!!backgroundId && !backgroundEntry);
  const takenSummary = startingSets
    .filter((s) => setTaken(s.label))
    .reduce(
      (acc, s) => ({
        items: acc.items + s.items.length + s.manual.length,
        gold: acc.gold + (Number.parseInt((s.gold ?? "").trim(), 10) || 0),
      }),
      { items: 0, gold: 0 }
    );

  const classGrants = grantsFromEntry(classEntry ?? undefined, resolveSkill);
  const speciesGrants = grantsFromEntry(speciesEntry ?? undefined, resolveSkill);
  const backgroundGrants = grantsFromEntry(backgroundEntry ?? undefined, resolveSkill);
  const featGrants = grantsFromEntry(featEntry ?? undefined, resolveSkill);

  // Черта берётся подставленной из предыстории, пока её не сменили руками.
  // Вид, дающий выбор (Человек), подставленной черты не несёт — там пусто и
  // выбирать надо самому.
  const suggestedFeatId = backgroundGrants.originFeat?.id ?? null;
  const effectiveFeatId = featTouched ? featId : featId ?? suggestedFeatId;
  const featNeeded = !!backgroundId || speciesGrants.originFeatChoice;

  useEffect(() => {
    if (!effectiveFeatId) {
      setFeatEntry(null);
      return;
    }
    const ac = new AbortController();
    api
      .get<CompendiumEntry>(`/systems/entries/${effectiveFeatId}`, { signal: ac.signal })
      .then(setFeatEntry)
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [effectiveFeatId]);

  // Выборы навыков — по одному на источник, а не один общий: у класса свой
  // список из книги, у Человека любой, у «Одарённого» любые три. Сложить их
  // в одну кучу значило бы разрешить взять четыре из списка класса.
  interface SkillChoiceGroup {
    key: string;
    label: string;
    count: number;
    options: string[];
  }
  const skillGroups: SkillChoiceGroup[] = [];
  if (classGrants.skillChoice) {
    skillGroups.push({
      key: "class",
      label: `Из списка класса${classOption ? ` (${classOption.name})` : ""}`,
      count: classGrants.skillChoice.count,
      options: classGrants.skillChoice.options,
    });
  }
  if (speciesGrants.skillChoice) {
    skillGroups.push({
      key: "species",
      label: `От вида${speciesEntry ? ` (${speciesEntry.name})` : ""}`,
      count: speciesGrants.skillChoice.count,
      options: speciesGrants.skillChoice.options,
    });
  }
  if (featGrants.skillChoice) {
    skillGroups.push({
      key: "feat",
      label: `От черты${featEntry ? ` (${featEntry.name})` : ""}`,
      count: featGrants.skillChoice.count,
      options: featGrants.skillChoice.options,
    });
  }
  // Пустой список вариантов значит «любой навык», а не «ни одного»:
  // «Одарённый» и «Умелость» Человека ничем не ограничены.
  const allSkillKeys = skills.rows.map((r) => r.original);
  function optionsFor(group: SkillChoiceGroup): string[] {
    return group.options.length > 0 ? group.options : allSkillKeys;
  }

  const backgroundSkills: string[] = backgroundGrants.skills;
  // Что уже выдано без выбора — эти навыки в выборе не показываются: взять
  // владение дважды нельзя, а место в выборе оно бы съело.
  const grantedSkills = new Set([...backgroundSkills, ...classGrants.skills, ...speciesGrants.skills, ...featGrants.skills]);

  // Ключ выбора — «источник:навык», чтобы один навык, выбранный по двум
  // источникам, не схлопнулся в одну отметку и не сбил счётчики.
  function toggleSkill(groupKey: string, name: string, limit: number) {
    const token = `${groupKey}:${name}`;
    setChosenSkills((prev) => {
      if (prev.includes(token)) return prev.filter((s) => s !== token);
      const used = prev.filter((s) => s.startsWith(`${groupKey}:`)).length;
      return used < limit ? [...prev, token] : prev;
    });
  }
  const chosenIn = (groupKey: string) => chosenSkills.filter((s) => s.startsWith(`${groupKey}:`));
  /** Выбранные навыки без пометки источника — то, что реально ляжет на лист. */
  const chosenSkillKeys = [...new Set(chosenSkills.map((s) => s.slice(s.indexOf(":") + 1)))];

  // Прибавка от предыстории. Три характеристики предлагает сама предыстория
  // (`abilities`), а как их разложить — выбор игрока.
  const awardOptions = backgroundGrants.abilityOptions;
  const abilityAward: Partial<Record<keyof DndAbilityScores, number>> = {};
  if (awardOptions.length > 0) {
    if (awardMode === "1+1+1") {
      for (const name of awardOptions) {
        const key = ABILITY_NAME_TO_KEY[name];
        if (key) abilityAward[key] = (abilityAward[key] ?? 0) + 1;
      }
    } else {
      const primary = awardPrimary ?? awardOptions[0];
      const secondary = awardSecondary ?? awardOptions.find((a) => a !== primary) ?? null;
      const pk = ABILITY_NAME_TO_KEY[primary];
      if (pk) abilityAward[pk] = (abilityAward[pk] ?? 0) + 2;
      const sk = secondary ? ABILITY_NAME_TO_KEY[secondary] : null;
      if (sk) abilityAward[sk] = (abilityAward[sk] ?? 0) + 1;
    }
  }
  const awardedAbilities: DndAbilityScores = { ...abilities };
  for (const [k, v] of Object.entries(abilityAward)) {
    const key = k as keyof DndAbilityScores;
    awardedAbilities[key] = abilities[key] + (v ?? 0);
  }

  async function finish() {
    setSaving(true);
    setSaveError(null);
    const character = emptyDndCharacter();
    character.systemId = systemId;
    character.characterName = characterName;
    character.playerName = playerName;
    character.abilities = awardedAbilities;

    if (classId && classOption) {
      const subclassOpt = subclassOptions.find((s) => s.id === subclassId);
      character.classes = [
        {
          classId,
          className: classOption.name,
          subclassId: subclassId,
          subclassName: subclassOpt?.name ?? "",
          level,
          skillChoiceOptions: classGrants.skillChoice?.options ?? [],
          skillChoiceCount: classGrants.skillChoice?.count ?? 0,
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
      if (species?.walkSpeed) {
        character.speed = `${species.walkSpeed} фт.`;
        // Кость скорости читает структуру, а не строку (иначе «—» в кости).
        // walkSpeed вида — строка, в структуру ложится числом.
        const walk = Number(species.walkSpeed);
        if (Number.isFinite(walk)) character.speeds = { ...character.speeds, walk };
      }
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
      } catch {
        /* background has no compendium entry (freehand) — nothing to fill */
      }
    }

    // Черта — та, что выбрана на своём шаге, а не жёстко предысторийная:
    // Мастер мог разрешить другую, а у Человека она выбирается с нуля.
    if (effectiveFeatId) {
      const chosenFeat =
        originFeats.find((f) => f.id === effectiveFeatId) ??
        (featEntry ? { id: featEntry.id, name: featEntry.name } : null);
      if (chosenFeat) {
        character.feats = [...character.feats, { name: chosenFeat.name, description: featEntry?.description ?? "" }];
      }
      // Владения от черты («Музыкант», «Ремесленник») — строкой: конкретные
      // инструменты игрок выбирает сам, а приложение за него не решает.
      if (featGrants.toolChoice) {
        const { count, group } = featGrants.toolChoice;
        character.proficiencies = [
          ...character.proficiencies,
          { entryId: null, name: `${group} — выбрать ${count}`, abilityKey: null },
        ];
      }
    }

    character.skillProfs = { ...character.skillProfs };
    for (const s of chosenSkillKeys) character.skillProfs[s] = 1;
    for (const s of grantedSkills) character.skillProfs[s] = 1;

    // Стартовые наборы. Метаданные предмета (вес, КЗ, свойства) тянутся из
    // справочника здесь же: лист их не пересчитывает, а хранит снимком, как
    // и при добавлении предмета руками.
    const takenSets2 = startingSets.filter((s) => setTaken(s.label));
    if (takenSets2.length > 0) {
      const addedItems: typeof character.equipmentSections[number]["items"] = [];
      let goldToAdd = 0;
      for (const set of takenSets2) {
        const metas = await Promise.all(set.items.map((it) => fetchEquipmentMeta(it.entryId).catch(() => ({}))));
        set.items.forEach((item, idx) => {
          addedItems.push({
            ...EMPTY_EQUIPMENT_ITEM,
            name: item.name,
            qty: item.qty > 1 ? String(item.qty) : "",
            entryId: item.entryId,
            ...metas[idx],
          });
        });
        // Выборные позиции кладутся строкой: выбрать за игрока приложение не
        // вправе, а потерять их из набора тем более.
        for (const text of set.manual) {
          addedItems.push({ ...EMPTY_EQUIPMENT_ITEM, name: text, notes: "выбрать самому" });
        }
        const gold = Number.parseInt((set.gold ?? "").trim(), 10);
        if (Number.isFinite(gold)) goldToAdd += gold;
      }
      if (addedItems.length > 0) {
        const sections = character.equipmentSections.length > 0 ? character.equipmentSections : [{ name: "Общее", items: [] }];
        character.equipmentSections = sections.map((sec, i) =>
          i === 0 ? { ...sec, items: [...sec.items, ...addedItems] } : sec
        );
      }
      if (goldToAdd !== 0) {
        const curGp = Number.parseInt(character.coins.gp || "0", 10) || 0;
        character.coins = { ...character.coins, gp: String(curGp + goldToAdd) };
      }
    }

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

    // Раньше здесь стоял голый `await api.post(...)`, а `setSaving(false)` и
    // `onDone()` — за ним: отвал сети на последнем шаге навсегда оставлял
    // кнопку в «Создаю…», а семь заполненных шагов выбрасывались без следа.
    try {
      await api.post("/statblocks", {
        owner_type: ownerType,
        owner_id: ownerId,
        format: "dnd_character",
        kind: "full",
        content: JSON.stringify(character),
      });
    } catch (e) {
      setSaveError(
        e instanceof Error && e.message
          ? `Не удалось создать персонажа: ${e.message}`
          : "Не удалось создать персонажа — проверьте связь и попробуйте ещё раз."
      );
      return;
    } finally {
      setSaving(false);
    }
    onDone();
  }

  // Что принесло создание, по источникам. Считается на обзоре, но собирается
  // здесь, чтобы разметка осталась разметкой.
  const overviewSources: { label: string; lines: string[] }[] = [];
  {
    const named = (keys: string[]) => keys.map((k) => skills.nameOf(k));
    const classLines: string[] = [];
    if (classOption) {
      classLines.push(`${classOption.name} ${level}`);
      const sub = subclassOptions.find((x) => x.id === subclassId);
      if (sub) classLines.push(sub.name);
      if (classGrants.savingThrows.length > 0) {
        classLines.push(
          `спасброски: ${classGrants.savingThrows.map((k) => ABILITY_LABELS.find((a) => a.key === k)?.label ?? k).join(", ")}`
        );
      }
      if (classGrants.toolNames.length > 0) classLines.push(`владения: ${classGrants.toolNames.join(", ")}`);
      const classPicked = named(chosenIn("class").map((t) => t.slice(t.indexOf(":") + 1)));
      if (classPicked.length > 0) classLines.push(`навыки: ${classPicked.join(", ")}`);
      if (classGrants.spells.length > 0) {
        classLines.push(
          `заклинания: ${classGrants.spells.map((sp) => sp.name + (sp.outsideLimit ? " (вне лимита)" : "")).join(", ")}`
        );
      }
    }
    overviewSources.push({ label: "Класс", lines: classLines });

    const speciesLines: string[] = [];
    const speciesOpt = speciesOptions.find((x) => x.id === speciesId);
    if (speciesOpt) {
      speciesLines.push(speciesOpt.name);
      const picked = named(chosenIn("species").map((t) => t.slice(t.indexOf(":") + 1)));
      if (picked.length > 0) speciesLines.push(`навыки: ${picked.join(", ")}`);
      if (speciesGrants.originFeatChoice) speciesLines.push("черта происхождения на выбор");
      if (speciesGrants.spells.length > 0) {
        speciesLines.push(`заклинания: ${speciesGrants.spells.map((sp) => sp.name).join(", ")}`);
      }
      if (speciesOpt.walkSpeed) speciesLines.push(`скорость ${speciesOpt.walkSpeed} фт.`);
    }
    overviewSources.push({ label: "Вид", lines: speciesLines });

    const bgLines: string[] = [];
    const bgOpt = backgroundOptions.find((x) => x.id === backgroundId);
    if (bgOpt) {
      bgLines.push(bgOpt.name);
      if (backgroundGrants.skills.length > 0) bgLines.push(`навыки: ${named(backgroundGrants.skills).join(", ")}`);
      if (backgroundGrants.toolNames.length > 0) bgLines.push(`владения: ${backgroundGrants.toolNames.join(", ")}`);
      const award = ABILITY_LABELS.filter(({ key }) => awardedAbilities[key] !== abilities[key])
        .map(({ key, label }) => `${label} +${awardedAbilities[key] - abilities[key]}`)
        .join(", ");
      if (award) bgLines.push(`характеристики: ${award}`);
    }
    overviewSources.push({ label: "Предыстория", lines: bgLines });

    const featLines: string[] = [];
    if (featEntry) {
      featLines.push(featEntry.name);
      const picked = named(chosenIn("feat").map((t) => t.slice(t.indexOf(":") + 1)));
      if (picked.length > 0) featLines.push(`навыки: ${picked.join(", ")}`);
      if (featGrants.toolChoice) featLines.push(`владения: ${featGrants.toolChoice.group} — выбрать ${featGrants.toolChoice.count}`);
      if (featGrants.resources.length > 0) featLines.push(`ресурсы: ${featGrants.resources.map((r) => r.label).join(", ")}`);
      if (featGrants.spellChoices.length > 0) {
        featLines.push(
          `заклинания на выбор: ${featGrants.spellChoices
            .map((c) => (c.level === 0 ? `${c.count} заговора` : `${c.count} ${c.level} круга`))
            .join(", ")}`
        );
      }
    }
    overviewSources.push({ label: "Черта происхождения", lines: featLines });
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

      {step === "Черта" && (
        <div className="stack">
          {!featNeeded ? (
            <span className="muted">Черта происхождения приходит от предыстории или вида — выберите их на прошлых шагах.</span>
          ) : (
            <>
              <span className="muted">
                {suggestedFeatId
                  ? "Предыстория предлагает эту черту. Согласиться — просто идите дальше; Мастер может разрешить другую."
                  : "Вид даёт выбрать черту происхождения самому."}
              </span>
              <select
                value={effectiveFeatId ?? ""}
                onChange={(e) => {
                  setFeatTouched(true);
                  setFeatId(e.target.value ? Number(e.target.value) : null);
                }}
              >
                <option value="">— черта —</option>
                {originFeats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              {featTouched && suggestedFeatId && effectiveFeatId !== suggestedFeatId && (
                <button
                  type="button"
                  onClick={() => {
                    setFeatTouched(false);
                    setFeatId(null);
                  }}
                >
                  Вернуть черту предыстории
                </button>
              )}
              {featEntry?.description && (
                <div className="muted" style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflowY: "auto" }}>
                  {featEntry.description}
                </div>
              )}
            </>
          )}
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

          {awardOptions.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="muted">Прибавка от предыстории: {awardOptions.join(", ")}</span>
              <div className="row" role="group" aria-label="Как распределить прибавку">
                <label className="row">
                  <input type="radio" name="dnd-award-mode" checked={awardMode === "2+1"} onChange={() => setAwardMode("2+1")} />
                  +2 и +1
                </label>
                <label className="row">
                  <input type="radio" name="dnd-award-mode" checked={awardMode === "1+1+1"} onChange={() => setAwardMode("1+1+1")} />
                  +1 каждой
                </label>
              </div>
              {awardMode === "2+1" && (
                <div className="row">
                  <label className="row">
                    +2
                    <select value={awardPrimary ?? awardOptions[0]} onChange={(e) => setAwardPrimary(e.target.value)}>
                      {awardOptions.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="row">
                    +1
                    <select
                      value={awardSecondary ?? awardOptions.find((a) => a !== (awardPrimary ?? awardOptions[0])) ?? ""}
                      onChange={(e) => setAwardSecondary(e.target.value)}
                    >
                      {awardOptions
                        .filter((a) => a !== (awardPrimary ?? awardOptions[0]))
                        .map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              )}
              <span className="muted">
                Итог:{" "}
                {ABILITY_LABELS.filter(({ key }) => awardedAbilities[key] !== abilities[key])
                  .map(({ key, label }) => `${label} ${abilities[key]} → ${awardedAbilities[key]}`)
                  .join(" · ") || "—"}
              </span>
            </div>
          )}
        </div>
      )}

      {step === "Навыки" && (
        <div className="stack">
          {skillGroups.length === 0 && (
            <span className="muted">Ни класс, ни вид, ни черта не дают навыков на выбор.</span>
          )}
          {skillGroups.map((group) => {
            const picked = chosenIn(group.key);
            return (
              <div key={group.key} className="stack" style={{ gap: 4 }}>
                <span className="muted">
                  {group.label}: выберите {group.count} ({picked.length}/{group.count})
                </span>
                <div className="stack" style={{ gap: 4 }}>
                  {/* В списке ключ, на экране — имя из справочника. */}
                  {optionsFor(group)
                    .filter((key) => !grantedSkills.has(key))
                    .map((key) => (
                      <label key={key} className="row">
                        <input
                          type="checkbox"
                          checked={chosenSkills.includes(`${group.key}:${key}`)}
                          onChange={() => toggleSkill(group.key, key, group.count)}
                        />
                        {skills.nameOf(key)}
                      </label>
                    ))}
                </div>
              </div>
            );
          })}
          {[...grantedSkills].length > 0 && (
            <span className="muted">
              Уже выдано без выбора: {[...grantedSkills].map((k) => skills.nameOf(k)).join(", ")}
            </span>
          )}
        </div>
      )}

      {step === "Снаряжение" && (
        <div className="stack">
          {/* Три разных «ничего» вместо одного. Раньше строка была одна — «в
              справочнике набора нет», — и она же показывалась, когда запись
              класса просто ещё не догрузилась. Персонаж в этом случае
              создавался без снаряжения и без золота, и понять, почему, было
              неоткуда. */}
          {startingSets.length === 0 && setsStillLoading && (
            <span className="muted">Справочник ещё грузится — подождите секунду.</span>
          )}
          {startingSets.length === 0 && !setsStillLoading && (
            <span className="muted">
              {classId || backgroundId
                ? "У выбранных класса и предыстории набора в справочнике нет — снаряжение добавите вручную во вкладке «Инвентарь»."
                : "Класс и предыстория не выбраны — набор брать неоткуда."}
            </span>
          )}
          {startingSets.length > 0 && (
            startingSets.map((set) => (
              <label key={set.label} className="row" style={{ alignItems: "flex-start", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={setTaken(set.label)}
                  onChange={(e) => setTakenSets({ ...takenSets, [set.label]: e.target.checked })}
                />
                <span className="stack" style={{ gap: 2 }}>
                  <strong>
                    {set.label}
                    {set.gold && ` — ${set.gold} ЗМ`}
                  </strong>
                  {set.items.length > 0 && (
                    <span className="muted">
                      {set.items.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(", ")}
                    </span>
                  )}
                  {set.manual.map((text) => (
                    <span key={text} className="muted">
                      {text} — выбрать самому
                    </span>
                  ))}
                </span>
              </label>
            ))
          )}
          {/* Итог прямо здесь: сколько предметов и сколько золота ляжет на
              лист. Проверить это после создания дороже, чем увидеть до. */}
          {startingSets.length > 0 && (
            <span>
              <strong>Итого:</strong> {takenSummary.items} предметов
              {takenSummary.gold > 0 && `, ${takenSummary.gold} ЗМ`}
              {takenSummary.items === 0 && takenSummary.gold === 0 && " — ничего не отмечено"}
            </span>
          )}
          <span className="muted">
            Наборы «A» и «B» — это «взять снаряжением» или «взять деньгами»; брать оба правила не
            предполагают, но приложение не мешает — Мастер вправе разрешить.
          </span>
        </div>
      )}

      {step === "Обзор" && (
        <div className="stack">
          <div>
            <strong>{characterName || "Без имени"}</strong>
            {playerName && <span className="muted"> — {playerName}</span>}
          </div>
          <div className="dnd-abilities-row">
            {ABILITY_LABELS.map(({ key, label }) => (
              <div key={key} className="dnd-ability-box">
                <span className="dnd-ability-label">{label}</span>
                <span className="dnd-ability-score">{awardedAbilities[key]}</span>
                <span className="dnd-ability-mod">{formatModifier(abilityModifier(awardedAbilities[key]))}</span>
              </div>
            ))}
          </div>

          {/* Разбивка по источнику, а не общий список: в плоском перечне не
              видно, что чего-то НЕ пришло, а пустая строка «Вид: ничего»
              видна сразу (решение W4). */}
          <div className="stack" style={{ gap: 6 }}>
            {overviewSources.map((src) => (
              <div key={src.label}>
                <strong>{src.label}:</strong>{" "}
                {src.lines.length > 0 ? (
                  <span>{src.lines.join(" · ")}</span>
                ) : (
                  <span className="muted">ничего</span>
                )}
              </div>
            ))}
          </div>

          {(() => {
            const taken = startingSets.filter((s) => setTaken(s.label));
            return taken.length === 0 ? (
              <div>
                <strong>Снаряжение:</strong> <span className="muted">не берётся</span>
              </div>
            ) : (
              <div>
                <strong>Снаряжение:</strong> {taken.map((s) => s.label).join(" · ")} ·{" "}
                {takenSummary.items} предметов
                {takenSummary.gold > 0 && ` · ${takenSummary.gold} ЗМ`}
              </div>
            );
          })()}
        </div>
      )}

      {loadError && (
        <div className="sb-save-status is-error" role="alert">
          Справочник не загрузился: {loadError}. Выбор класса, вида и предыстории
          будет пустым — закройте визард и попробуйте ещё раз.
        </div>
      )}

      {saveError && (
        <div className="sb-save-status is-error" role="alert">
          {saveError}
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <button onClick={onCancel}>Отмена</button>
          {stepIndex > 0 && <button onClick={back}>Назад</button>}
        </div>
        {step === "Обзор" ? (
          <button className="primary" onClick={finish} disabled={saving || !characterName}>
            {saving ? "Создаю…" : saveError ? "Попробовать ещё раз" : "Создать персонажа"}
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
