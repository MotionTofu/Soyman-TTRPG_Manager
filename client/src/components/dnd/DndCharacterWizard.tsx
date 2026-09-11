import { useEffect, useRef, useState } from "react";
import { write } from "../../data/hooks";
import { afterWriteAnywhere, readResource } from "../../data/imperative";
import { Modal } from "../Modal";
import { NavIcon } from "../NavIcons";
import { useImageCrop } from "../../hooks/useImageCrop";
import type { CompendiumEntry, DndAbilityScores } from "../../types";
import { emptyDndCharacter, recomputeGrantedSpells } from "./DndCharacterForm";
import {
  EMPTY_EQUIPMENT_ITEM,
  fetchEquipmentMeta,
  makeEquipmentId,
  startingSetsFrom,
  type StartingSet,
} from "./dndEquipment";
import { WeaponMasteryPicker, isMasterableWeapon } from "./StartingEquipmentPicker";
import { PosterButtons } from "./PosterButtons";
import { renderPosterBlob, type PosterData } from "./CharacterPoster";
import { WizardMiniSheet, type MiniSheetProblem } from "./WizardMiniSheet";
import { choicesFromEntries, featuresFromEntries, sumEntrySlots, type ChoiceDef } from "./dndFeatures";
import { cantripsAtLevel, preparedAtLevel, spellSlotsAtLevel, type ClassProgression } from "./progression";
import { useDndSkills } from "./useDndSkills";
import { grantsFromEntry, mergeGrants } from "./dndGrants";
import type { GrantedSpellChoice } from "./dndGrants";
import { nameMatches } from "./dndResources";
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
  loadDndFeatsByCategory,
  loadDndClassFeatures,
  loadDndClassHierarchy,
  loadDndEquipmentEntries,
  loadDndMechanicsGroupEntries,
  loadDndSpeciesFeatures,
  loadDndSpeciesOptions,
  loadDndSpellIndex,
  loadDndMechanicsGroup,
  type DndMechanicsOption,
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
  "Портрет",
  "Класс",
  "Вид",
  "Предыстория",
  "Черта",
  "Характеристики",
  "Навыки",
  "Заклинания",
  "Досье",
  "Снаряжение",
  "Обзор",
] as const;
type Step = (typeof STEPS)[number];

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const POINT_BUY_BUDGET = 27;
type AbilityMethod = "standard" | "pointbuy" | "roll" | "manual";

// --- Фаза 0: черновик в localStorage ---
// Двенадцать шагов не должны сгорать от случайного закрытия вкладки или промаха
// по «Отмене». Ключ — на владельца: у разных персонажей черновики свои.
function wizardDraftKey(ownerType: string, ownerId: number) {
  return `dnd-wizard-draft:${ownerType}:${ownerId}`;
}
interface WizardDraftV1 {
  step?: unknown;
  characterName?: unknown;
  playerName?: unknown;
  classId?: unknown;
  subclassId?: unknown;
  level?: unknown;
  speciesId?: unknown;
  backgroundId?: unknown;
  speciesCustom?: unknown;
  backgroundCustom?: unknown;
  featId?: unknown;
  featTouched?: unknown;
  awardMode?: unknown;
  awardPrimary?: unknown;
  awardSecondary?: unknown;
  takenSets?: unknown;
  method?: unknown;
  abilities?: unknown;
  rolledPool?: unknown;
  chosenSkills?: unknown;
  chosenExpertise?: unknown;
  chosenSpells?: unknown;
  chosenStyle?: unknown;
  chosenEntries?: unknown;
  masteredWeapons?: unknown;
  alignment?: unknown;
  chosenLanguages?: unknown;
  personalityTraits?: unknown;
  ideals?: unknown;
  bonds?: unknown;
  flaws?: unknown;
  notes?: unknown;
}
function loadWizardDraft(key: string): WizardDraftV1 | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as WizardDraftV1) : null;
  } catch {
    // Битый черновик не чинится — удаляем, чтобы не парсить мусор каждый запуск.
    try {
      localStorage.removeItem(key);
    } catch {
      // хранилище недоступно — визард работает и без черновика
    }
    return null;
  }
}
function isWizardStep(v: unknown): v is Step {
  return typeof v === "string" && (STEPS as readonly string[]).includes(v);
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
// Ручной ввод характеристик: дикие значения (0, 99, NaN) на лист не пускаем —
// режем до игрового диапазона 1–30 прямо при вводе.
function clampAbilityScore(v: number): number {
  return Number.isFinite(v) ? Math.min(30, Math.max(1, Math.round(v))) : 1;
}
// Короткое описание записи компендиума под селектом: вид и предысторию
// вслепую не выбирают. Тот же приём, что уже был у черты на своём шаге.
// Экспортирован для визарда левелапа (описания черт).
export function EntryBlurb({ text }: { text?: string }) {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= 400) {
    return (
      <div className="muted wizard-blurb">
        {text}
      </div>
    );
  }
  return (
    <details className="muted wizard-blurb">
      <summary>{`${clean.split(" ").slice(0, 25).join(" ")}… Показать полностью`}</summary>
      <div className="wizard-blurb-more">{text}</div>
    </details>
  );
}

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
  // Портрет владельца (сущности/персонажа) для кнопки «Взять как у
  // владельца» (Хвосты 2.3). Необязателен: без него шага как было.
  ownerPortraitUrl?: string | null;
}

// Guided step-by-step creation for a brand-new D&D 5.5 character statblock —
// used only when adding a fresh dnd_character (see StatblockList's addStatblock).
// Leveling up / editing an existing character stays in the regular
// DndCharacterEdit form; this wizard is a one-time onboarding path only.
export function DndCharacterWizard({ ownerType, ownerId, ownerName, ownerPlayerName, onDone, onCancel, initialSystemId, ownerPortraitUrl }: Props) {
  const draftKey = wizardDraftKey(ownerType, ownerId);
  // Читается один раз при монтировании — поэтому сбросы протухших выборов
  // в обработчиках ниже не видят «смену» при восстановлении черновика.
  const [savedDraft] = useState<WizardDraftV1 | null>(() => loadWizardDraft(draftKey));
  const [hadDraft, setHadDraft] = useState(() => savedDraft !== null);
  const [step, setStep] = useState<Step>(() => (isWizardStep(savedDraft?.step) ? savedDraft.step : "Личность"));
  const [systemId, setSystemId] = useState<number | null>(initialSystemId ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Dogрузка описаний черт стиля без дедупа давала гонку при быстром
  // переключении слотов — держим in-flight множество.
  const styleInflight = useRef(new Set<number>());
  // Справочник не загрузился. Отдельно от saveError: одно про сохранение,
  // другое про то, что выбирать не из чего и почему.
  const [loadError, setLoadError] = useState<string | null>(null);

  const [characterName, setCharacterName] = useState(
    () => (typeof savedDraft?.characterName === "string" ? savedDraft.characterName : (ownerName ?? ""))
  );
  const [playerName, setPlayerName] = useState(() =>
    typeof savedDraft?.playerName === "string"
      ? savedDraft.playerName
      : ownerType === "character"
        ? (ownerPlayerName ?? "")
        : ""
  );

  const [hierarchy, setHierarchy] = useState<DndClassHierarchy>({ classes: [], subclassesByClass: {} });
  const [classId, setClassId] = useState<number | null>(() => numOrNull(savedDraft?.classId));
  const [subclassId, setSubclassId] = useState<number | null>(() => numOrNull(savedDraft?.subclassId));
  const [level, setLevel] = useState(() => {
    const l = numOrNull(savedDraft?.level);
    return l !== null ? Math.min(20, Math.max(1, Math.round(l))) : 1;
  });
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
  // Запись подкласса целиком: выдачи (навыки/инструменты Орудий милосердия,
  // обретаемые заговоры считает recomputeGrantedSpells на финише) лежат в её data.
  const [subclassEntry, setSubclassEntry] = useState<CompendiumEntry | null>(null);
  const [speciesOptions, setSpeciesOptions] = useState<DndSpeciesOption[]>([]);
  const [speciesId, setSpeciesId] = useState<number | null>(() => numOrNull(savedDraft?.speciesId));
  // Свой вариант: null — не выбран, строка — название хоумбрю-вида.
  // Записи в справочнике нет — значит нет и выдач: ни навыков, ни черты.
  const [speciesCustom, setSpeciesCustom] = useState<string | null>(() =>
    typeof savedDraft?.speciesCustom === "string" ? savedDraft.speciesCustom : null
  );

  const [speciesEntry, setSpeciesEntry] = useState<CompendiumEntry | null>(null);

  const [backgroundOptions, setBackgroundOptions] = useState<DndBackgroundOption[]>([]);
  const [backgroundId, setBackgroundId] = useState<number | null>(() => numOrNull(savedDraft?.backgroundId));
  // Свой вариант предыстории — те же правила, что у вида: имя без выдач.
  const [backgroundCustom, setBackgroundCustom] = useState<string | null>(() =>
    typeof savedDraft?.backgroundCustom === "string" ? savedDraft.backgroundCustom : null
  );
  // Портрет держится файлом до финиша (решение Q4): заливка — после создания
  // статблока, отмена — чисто. В черновик файл не пишется.
  const [portraitFile, setPortraitFile] = useState<File | null>(null);
  const [portraitPreview, setPortraitPreview] = useState<string | null>(null);
  const [portraitError, setPortraitError] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  // Статблок уже создан, повтор — только за фото: иначе повтор дублировал бы
  // персонажа.
  const createdRef = useRef(false);
  function takePortrait(file: File) {
    if (!file.type.startsWith("image/")) {
      setPortraitError("Можно загружать только изображения");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setPortraitError("Файл слишком большой — лимит 15 МБ");
      return;
    }
    setPortraitError(null);
    setPortraitFile(file);
    setPortraitPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }
  function clearPortrait() {
    setPortraitFile(null);
    setPortraitPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }
  const portraitCrop = useImageCrop("square", takePortrait);
  // Портрет владельца как основа (Хвосты 2.3): тот же кроп, что у файла.
  // Подписанный URL протухает за минуту — провал честно показывается,
  // лечится обновлением страницы (там же onPortraitRefresh).
  const [portraitFetching, setPortraitFetching] = useState(false);
  async function takeOwnerPortrait() {
    if (!ownerPortraitUrl || portraitFetching) return;
    setPortraitFetching(true);
    setPortraitError(null);
    try {
      const res = await fetch(ownerPortraitUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) throw new Error("По ссылке не изображение");
      portraitCrop.onSelect(new File([blob], "portrait", { type: blob.type }));
    } catch {
      setPortraitError("Не удалось взять портрет владельца — обновите страницу и попробуйте снова");
    } finally {
      setPortraitFetching(false);
    }
  }

  const [alignmentOptions, setAlignmentOptions] = useState<DndMechanicsOption[]>([]);
  const [languageOptions, setLanguageOptions] = useState<DndMechanicsOption[]>([]);
  const [alignment, setAlignment] = useState(() =>
    typeof savedDraft?.alignment === "string" ? savedDraft.alignment : ""
  );
  const [chosenLanguages, setChosenLanguages] = useState<string[]>(() =>
    Array.isArray(savedDraft?.chosenLanguages)
      ? (savedDraft.chosenLanguages as unknown[])
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.slice(0, 40))
          .slice(0, 30)
      : []
  );
  // Досье — характер персонажа (Хвосты 2.2): поля есть на листе, визард их
  // молча оставлял пустыми. Необязательные, в гейтах не участвуют.
  const [personalityTraits, setPersonalityTraits] = useState(() =>
    typeof savedDraft?.personalityTraits === "string" ? savedDraft.personalityTraits : ""
  );
  const [ideals, setIdeals] = useState(() =>
    typeof savedDraft?.ideals === "string" ? savedDraft.ideals : ""
  );
  const [bonds, setBonds] = useState(() =>
    typeof savedDraft?.bonds === "string" ? savedDraft.bonds : ""
  );
  const [flaws, setFlaws] = useState(() =>
    typeof savedDraft?.flaws === "string" ? savedDraft.flaws : ""
  );
  const [dossierNotes, setDossierNotes] = useState(() =>
    typeof savedDraft?.notes === "string" ? savedDraft.notes : ""
  );
  const [backgroundEntry, setBackgroundEntry] = useState<CompendiumEntry | null>(null);

  const [originFeats, setOriginFeats] = useState<DndFeatOption[]>([]);
  // Черты боевых стилей для выбора Воина (тикет 03). Грузятся всегда, как
  // черты происхождения: 10 записей, дешевле شرطа.
  const [styleFeats, setStyleFeats] = useState<DndFeatOption[]>([]);
  // Описания выбранных черт стиля (показ + запись на лист).
  const [styleFeatEntries, setStyleFeatEntries] = useState<Record<number, CompendiumEntry>>({});
  // Определения выборов из умений класса/подкласса (data.choices).
  // null — ещё не грузили (гейта нет, тупика при офлайне нет); [] — пусто.
  const [choiceDefs, setChoiceDefs] = useState<ChoiceDef[] | null>(null);
  // null — черта ещё не выбиралась: тогда берётся подставленная предысторией.
  // Значение живёт отдельно от предыстории, потому что Мастер вправе
  // разрешить другую, а у Человека она выбирается с нуля.
  const [featId, setFeatId] = useState<number | null>(() => numOrNull(savedDraft?.featId));
  const [featTouched, setFeatTouched] = useState(() => savedDraft?.featTouched === true);
  const [featEntry, setFeatEntry] = useState<CompendiumEntry | null>(null);

  // Прибавка от предыстории: либо +2 одной и +1 другой, либо +1 каждой из
  // трёх (решение W5).
  const [awardMode, setAwardMode] = useState<"2+1" | "1+1+1">(() =>
    savedDraft?.awardMode === "1+1+1" ? "1+1+1" : "2+1"
  );
  const [awardPrimary, setAwardPrimary] = useState<string | null>(() => strOrNull(savedDraft?.awardPrimary));
  const [awardSecondary, setAwardSecondary] = useState<string | null>(() => strOrNull(savedDraft?.awardSecondary));

  // Наборы берутся по умолчанию: персонаж без снаряжения — это почти всегда
  // забытый шаг, а не решение. Отказаться можно галочкой.
  const [takenSets, setTakenSets] = useState<Record<string, boolean>>(() => {
    const d = savedDraft?.takenSets;
    if (d && typeof d === "object") {
      const next: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
        if (typeof v === "boolean") next[k] = v;
      }
      return next;
    }
    return {};
  });

  const [method, setMethod] = useState<AbilityMethod>(() =>
    savedDraft?.method === "pointbuy" || savedDraft?.method === "roll" || savedDraft?.method === "manual"
      ? savedDraft.method
      : "standard"
  );
  const [abilities, setAbilities] = useState<DndAbilityScores>(() => {
    const d = savedDraft?.abilities;
    if (d && typeof d === "object") {
      const rec = d as Record<string, unknown>;
      const keys = Object.keys(emptyAbilities()) as (keyof DndAbilityScores)[];
      if (keys.every((k) => typeof rec[k] === "number")) {
        const a = emptyAbilities();
        for (const k of keys) a[k] = clampAbilityScore(rec[k] as number);
        return a;
      }
    }
    const a = emptyAbilities();
    (Object.keys(a) as (keyof DndAbilityScores)[]).forEach((k, i) => (a[k] = STANDARD_ARRAY[i]));
    return a;
  });
  const [rolledPool, setRolledPool] = useState<number[]>(() => {
    const d = savedDraft?.rolledPool;
    if (Array.isArray(d) && d.length === 6 && d.every((v) => typeof v === "number" && Number.isFinite(v))) {
      return (d as number[]).slice();
    }
    return STANDARD_ARRAY.slice();
  });
  const [chosenSkills, setChosenSkills] = useState<string[]>(() =>
    Array.isArray(savedDraft?.chosenSkills)
      ? (savedDraft.chosenSkills as unknown[]).filter((t): t is string => typeof t === "string")
      : []
  );
  // Выбранные заклинания — «источник:id записи», тем же приёмом, что навыки.
  const [chosenSpells, setChosenSpells] = useState<string[]>(() =>
    Array.isArray(savedDraft?.chosenSpells)
      ? (savedDraft.chosenSpells as unknown[]).filter((t): t is string => typeof t === "string")
      : []
  );
  // Экспертность из выборов умений (Искусный исследователь следопыта,
  // Экспертность 9 ур.): ключи навыков, ляжет уровнем владения 2.
  const [chosenExpertise, setChosenExpertise] = useState<string[]>(() =>
    Array.isArray(savedDraft?.chosenExpertise)
      ? (savedDraft.chosenExpertise as unknown[]).filter((t): t is string => typeof t === "string")
      : []
  );
  // Выборы записей каталога (приёмы/выстрелы, тикет 05): id записей по
  // ключу выбора (ключи делят дефы лесенки: "maneuvers", "arcane_shots").
  const [chosenEntries, setChosenEntries] = useState<Record<string, number[]>>(() => {
    const d = savedDraft?.chosenEntries;
    if (!d || typeof d !== "object") return {};
    const next: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        const ids = v.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
        if (ids.length > 0) next[k] = ids;
      }
    }
    return next;
  });
  // Выборы черт боевого стиля — id черт по слотам (слот = определение
  // выбора умения; у Чемпиона 7+ их два). Черновик переживает перезагрузку.
  const [chosenStyle, setChosenStyle] = useState<(number | null)[]>(() =>
    Array.isArray(savedDraft?.chosenStyle)
      ? (savedDraft.chosenStyle as unknown[])
          .slice(0, 4)
          .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
      : []
  );
  // Освоенное оружие (тикет 06): снимок {entryId, name} типа оружия.
  const [masteredWeapons, setMasteredWeapons] = useState<{ entryId: number; name: string }[]>(() => {
    const d = savedDraft?.masteredWeapons;
    if (!Array.isArray(d)) return [];
    return (d as unknown[])
      .filter(
        (w): w is { entryId: number; name: string } =>
          !!w && typeof w === "object" && typeof (w as { entryId?: unknown }).entryId === "number" && typeof (w as { name?: unknown }).name === "string"
      )
      .slice(0, 8);
  });
  // Живой поиск по шагу заклинаний — эфемерен, в черновик не пишется.
  const [spellSearch, setSpellSearch] = useState("");
  // Поиск по селектам класс/вид/предыстория/черта — тоже эфемерен:
  // голый скролл длинных справочников искать не даёт.
  const [classQ, setClassQ] = useState("");
  const [speciesQ, setSpeciesQ] = useState("");
  const [backgroundQ, setBackgroundQ] = useState("");
  const [featQ, setFeatQ] = useState("");
  const matchQ = (name: string, q: string) => {
    const needle = q.trim().toLowerCase();
    return needle === "" || name.toLowerCase().includes(needle);
  };
  // Полный индекс заклинаний системы: нужен, чтобы отфильтровать кандидатов
  // по списку классов и школе (короткий loadDndSpellsByLevel имён несёт
  // только id+name). 400 записей — терпимо одним запросом пачкой.
  const [spellIndex, setSpellIndex] = useState<CompendiumEntry[] | null>(null);
  // Имена навыков и их сведение к ключам — из справочника, как на листе.
  const skills = useDndSkills(systemId);

  // Есть что терять — для beforeunload и вопроса у «Отмены».
  const wizardDirty =
    step !== "Личность" ||
    characterName.trim() !== "" ||
    playerName.trim() !== "" ||
    classId !== null ||
    subclassId !== null ||
    level !== 1 ||
    method !== "standard" ||
    speciesId !== null ||
    speciesCustom !== null ||
    backgroundId !== null ||
    backgroundCustom !== null ||
    featId !== null ||
    portraitFile !== null ||
    chosenSkills.length > 0 ||
    chosenExpertise.length > 0 ||
    chosenSpells.length > 0 ||
    alignment.trim() !== "" ||
    chosenLanguages.length > 0 ||
    personalityTraits.trim() !== "" ||
    ideals.trim() !== "" ||
    bonds.trim() !== "" ||
    flaws.trim() !== "" ||
    dossierNotes.trim() !== "" ||
    chosenStyle.some((v) => v != null) ||
    Object.values(chosenEntries).some((a) => a.length > 0) ||
    masteredWeapons.length > 0 ||
    Object.keys(takenSets).length > 0;

  function clearWizardDraft() {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // хранилище недоступно — визард работает и без черновика
    }
  }

  // Черновик пишется на каждое изменение. Он маленький (десятки строк),
  // дебаунс не нужен; ошибка записи молча игнорируется.
  useEffect(() => {
    const state = {
      step,
      characterName,
      playerName,
      classId,
      subclassId,
      level,
      speciesId,
      speciesCustom,
      backgroundId,
      backgroundCustom,
      alignment,
      chosenLanguages,
      personalityTraits,
      ideals,
      bonds,
      flaws,
      notes: dossierNotes,
      featId,
      featTouched,
      awardMode,
      awardPrimary,
      awardSecondary,
      takenSets,
      method,
      abilities,
      rolledPool,
      chosenSkills,
      chosenExpertise,
      chosenSpells,
      chosenStyle,
      chosenEntries,
      masteredWeapons,
    };
    try {
      localStorage.setItem(draftKey, JSON.stringify(state));
    } catch {
      // переполнен/заблокирован — визард работает и без черновика
    }
  }, [
    draftKey,
    step,
    characterName,
    playerName,
    classId,
    subclassId,
    level,
    speciesId,
    speciesCustom,
    backgroundId,
    backgroundCustom,
    alignment,
    chosenLanguages,
    personalityTraits,
    ideals,
    bonds,
    flaws,
    dossierNotes,
    featId,
    featTouched,
    awardMode,
    awardPrimary,
    awardSecondary,
    takenSets,
    method,
    abilities,
    rolledPool,
    chosenSkills,
    chosenExpertise,
    chosenSpells,
    chosenStyle,
    chosenEntries,
    masteredWeapons,
  ]);

  // Уход со страницы с несобранным персонажем — подтверждение.
  // Приём как в CharacterDetailPage: черновик уже лежит в localStorage,
  // вопрос лишь страхует от потери контекста.
  useEffect(() => {
    if (!wizardDirty || saving) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [wizardDirty, saving]);

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
      loadDndFeatsByCategory(systemId, "Боевой Стиль", opts).then(setStyleFeats),
      loadDndMechanicsGroup(systemId, "Мировоззрение", opts).then(setAlignmentOptions),
      loadDndMechanicsGroup(systemId, "Языки", opts).then(setLanguageOptions),
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
    readResource<CompendiumEntry>(`/systems/entries/${classId}`)
      .then((entry) => {
        if (!ac.signal.aborted) setClassEntry(entry);
      })
      .catch((e) => {
        if (!ac.signal.aborted && !isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [classId]);

  useEffect(() => {
    if (!subclassId) {
      setSubclassEntry(null);
      return;
    }
    const ac = new AbortController();
    readResource<CompendiumEntry>(`/systems/entries/${subclassId}`)
      .then((entry) => {
        if (!ac.signal.aborted) setSubclassEntry(entry);
      })
      .catch((e) => {
        if (!ac.signal.aborted && !isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [subclassId]);

  useEffect(() => {
    if (!backgroundId) {
      setBackgroundEntry(null);
      return;
    }
    const ac = new AbortController();
    readResource<CompendiumEntry>(`/systems/entries/${backgroundId}`)
      .then((entry) => {
        if (!ac.signal.aborted) setBackgroundEntry(entry);
      })
      .catch((e) => {
        if (!ac.signal.aborted && !isAbortError(e)) setLoadError(errorMessage(e));
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
    readResource<CompendiumEntry>(`/systems/entries/${speciesId}`)
      .then((entry) => {
        if (!ac.signal.aborted) setSpeciesEntry(entry);
      })
      .catch((e) => {
        if (!ac.signal.aborted && !isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [speciesId]);

  // Standard array/roll assignment is a permutation of a fixed pool — picking
  // a value already used elsewhere swaps the two abilities instead of
  // duplicating it, so the assignment is always valid. The pool may hold
  // duplicates (two rolled 14s) — the swap preserves the multiset, and option
  // keys below carry the slot index so React doesn't collapse equal values.
  function assignFromPool(key: keyof DndAbilityScores, newValue: number) {
    const holder = (Object.keys(abilities) as (keyof DndAbilityScores)[]).find(
      (k) => k !== key && abilities[k] === newValue
    );
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
  // Бюджет обходился правкой черновика (вне 8–15 стоимость считалась 0):
  // значения вне диапазона или перерасход — гейт, а не молчаливое «валидно».
  const pointBuyValid =
    method !== "pointbuy" ||
    (Object.values(abilities).every((v) => v >= 8 && v <= 15) && pointBuyRemaining >= 0);

  function adjustPointBuy(key: keyof DndAbilityScores, delta: number) {
    // Функциональный сет: два быстрых клика видят свежий остаток,
    // оверспенд на шаг невозможен.
    setAbilities((prev) => {
      const nextVal = prev[key] + delta;
      if (nextVal < 8 || nextVal > 15) return prev;
      const spent = Object.values(prev).reduce((sum, v) => sum + (POINT_BUY_COST[v] ?? 0), 0);
      const cost = (POINT_BUY_COST[nextVal] ?? 0) - (POINT_BUY_COST[prev[key]] ?? 0);
      if (POINT_BUY_BUDGET - spent - cost < 0) return prev;
      return { ...prev, [key]: nextVal };
    });
  }

  const classOption = hierarchy.classes.find((c) => c.id === classId);
  const subclassOptions = classId ? hierarchy.subclassesByClass[classId] ?? [] : [];
  // Подкласс доступен с уровня класса (subclass_level, у монаха 3): карточка
  // этот порог знает, а визард раньше отдавал подкласс уже на 1–2 уровне.
  const subclassLocked = (classOption?.subclassLevel ?? 0) > level;
  useEffect(() => {
    if (subclassLocked) setSubclassId((prev) => (prev == null ? prev : null));
  }, [subclassLocked]);
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

  // Ключи takenSets — метки наборов текущего класса/предыстории. Смена
  // источника делает старые ключи мёртвыми: чистим, чтобы черновик не копил
  // мусор. Тот же возврат prev при чистоте — защита от петли рендеров.
  useEffect(() => {
    // Наборов ещё нет, потому что записи не приехали, — не то же самое,
    // что «наборов нет»: чистка до загрузки стирала бы черновик.
    if (setsStillLoading) return;
    const labels = startingSets.map((s) => s.label);
    setTakenSets((prev) => {
      const keys = Object.keys(prev);
      if (keys.every((k) => labels.includes(k))) return prev;
      const next: Record<string, boolean> = {};
      for (const k of keys) if (labels.includes(k)) next[k] = prev[k];
      return next;
    });
    // startingSets собирается каждый рендер — зависимость по источникам,
    // а не по ней самой.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classEntry, backgroundEntry, classId, backgroundId, hierarchy, setsStillLoading]);

  // Протухший id из черновика (переимпорт справочника): опция исчезла —
  // показываем «не выбрано», а не висячий id, иначе гейт пропускает,
  // а finish пишет пустоту. Чистим только по загруженным спискам,
  // чтобы не снести выбор до их приезда.
  useEffect(() => {
    if (hierarchy.classes.length > 0 && classId != null && !hierarchy.classes.some((c) => c.id === classId)) {
      setClassId(null);
      setSubclassId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hierarchy, classId]);
  useEffect(() => {
    if (speciesOptions.length > 0 && speciesId != null && !speciesOptions.some((s) => s.id === speciesId)) {
      setSpeciesId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speciesOptions, speciesId]);
  useEffect(() => {
    if (backgroundOptions.length > 0 && backgroundId != null && !backgroundOptions.some((b) => b.id === backgroundId)) {
      setBackgroundId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundOptions, backgroundId]);

  const classGrants = grantsFromEntry(classEntry ?? undefined, resolveSkill);
  const subclassGrants = grantsFromEntry(subclassEntry ?? undefined, resolveSkill);
  const speciesGrants = grantsFromEntry(speciesEntry ?? undefined, resolveSkill);
  const backgroundGrants = grantsFromEntry(backgroundEntry ?? undefined, resolveSkill);
  const featGrants = grantsFromEntry(featEntry ?? undefined, resolveSkill);
  // Выдачи выбранных черт боевого стиля (Воин-друид следопыта: 2 заговора
  // друида через spell_choices записи черты). Записи уже подтянуты для
  // описаний (styleFeatEntries) — перечитываем их же, сеть не дёргаем.
  const styleGrants = mergeGrants(
    chosenStyle.map((id) =>
      grantsFromEntry(
        typeof id === "number" ? styleFeatEntries[id] : undefined,
        resolveSkill
      )
    )
  );

  // Черта берётся подставленной из предыстории, пока её не сменили руками.
  // Вид, дающий выбор (Человек), подставленной черты не несёт — там пусто и
  // выбирать надо самому.
  const suggestedFeatId = backgroundGrants.originFeat?.id ?? null;
  const effectiveFeatId = featTouched ? featId : featId ?? suggestedFeatId;
  // Свой вариант вида/предыстории черты не несёт, но выбрать черту вручную
  // уже можно — Мастер разрешает.
  const featNeeded = !!backgroundId || backgroundCustom !== null || speciesGrants.originFeatChoice || speciesCustom !== null;

  useEffect(() => {
    if (!effectiveFeatId) {
      setFeatEntry(null);
      return;
    }
    const ac = new AbortController();
    readResource<CompendiumEntry>(`/systems/entries/${effectiveFeatId}`)
      .then((entry) => {
        if (!ac.signal.aborted) setFeatEntry(entry);
      })
      .catch((e) => {
        if (!ac.signal.aborted && !isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [effectiveFeatId]);

  // Определения выборов (data.choices) из умений класса и подкласса.
  // Ошибка — тихий []: выборы это улучшение, а не гейт; класть создание
  // при офлайне нельзя (тот же антитупик, что у навыков).
  useEffect(() => {
    if (!systemId || !classId) {
      setChoiceDefs(null);
      return;
    }
    setChoiceDefs(null);
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all([
      loadDndClassFeatures(systemId, classId, opts).then((es) => choicesFromEntries(es, true)),
      subclassId
        ? loadDndClassFeatures(systemId, subclassId, opts).then((es) => choicesFromEntries(es, false))
        : Promise.resolve([] as ChoiceDef[]),
    ])
      .then(([a, b]) => setChoiceDefs([...a, ...b]))
      .catch((e) => {
        if (!isAbortError(e)) setChoiceDefs([]);
      });
    return () => ac.abort();
  }, [systemId, classId, subclassId]);

  // Слоты черт боевого стиля: определения kind feat, открытые уровнем.
  // Слот = одно определение × count; у Чемпиона 7+ их два (1 ур. + 7 ур.).
  // Пики живут по индексам слотов; лишнее при даунгрейде НЕ режем молча —
  // висит строкой «сверх лимита» ниже, в персонажа не попадает (см. finish).
  const styleSlots: ChoiceDef[] = (choiceDefs ?? []).flatMap((d) =>
    d.kind === "feat" && d.minLevel <= level ? Array<ChoiceDef>(d.count).fill(d) : []
  );

  async function fetchStyleEntry(id: number) {
    if (styleFeatEntries[id] || styleInflight.current.has(id)) return;
    styleInflight.current.add(id);
    try {
      const entry = await readResource<CompendiumEntry>(`/systems/entries/${id}`);
      setStyleFeatEntries((prev) => (prev[id] ? prev : { ...prev, [id]: entry }));
    } catch {
      /* офлайн — выбор живёт без описания */
    } finally {
      styleInflight.current.delete(id);
    }
  }

  // Считаем только пики в слотах: хвост сверх лимита (даунгрейд) гейт
  // не закрывает и в персонажа не попадает.
  const styleSlotted = styleSlots
    .map((_, i) => chosenStyle[i])
    .filter((v): v is number => typeof v === "number");
  const stylePicked = styleSlotted.length;
  // Гейт только по загруженным определениям: null (грузятся) и [] (офлайн
  // или выборы не положены) — не гейтят, иначе тупик.
  const styleMissing = choiceDefs == null ? 0 : Math.max(0, styleSlots.length - stylePicked);
  const styleComplete = styleMissing === 0;

  // Выборы записей каталога (приёмы/выстрелы, тикет 05; воззвания, тикет 02
  // warlock): дефы kind entry. Слоты по ключу — сумма count открытых уровнем
  // дефов (лесенка БМ: 3 +2@7 +2@10 +2@15 собирается в один общий лимит).
  // Считает общий хелпер sumEntrySlots — он же у счётчика листа.
  const entrySlots = sumEntrySlots(
    (choiceDefs ?? [])
      .filter((d) => d.kind === "entry" && d.group)
      .map((d) => ({ def: d, level }))
  );
  // Каталог групп: полные записи с описаниями (выбирать вслепую нельзя).
  const [entryCatalog, setEntryCatalog] = useState<Record<string, CompendiumEntry[]>>({});
  const entryGroupsKey = [...new Set((choiceDefs ?? []).filter((d) => d.kind === "entry").map((d) => d.group ?? "").filter(Boolean))].sort().join("|");
  const loadedEntryGroups = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!systemId || !entryGroupsKey) return;
    const missing = entryGroupsKey.split("|").filter((g) => !loadedEntryGroups.current.has(g));
    if (missing.length === 0) return;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all(
      missing.map((g) => loadDndMechanicsGroupEntries(systemId, g, opts).then((es) => [g, es] as const))
    )
      .then((pairs) => {
        setEntryCatalog((prev) => {
          const next = { ...prev };
          for (const [g, es] of pairs) next[g] = es;
          return next;
        });
        for (const [g] of pairs) loadedEntryGroups.current.add(g);
      })
      .catch(() => {
        // Ошибка — пустые группы, а не вечная «Загрузка…»: пик недоступен,
        // гейт ниже режется доступным (available 0 → недобора нет).
        setEntryCatalog((prev) => {
          const next = { ...prev };
          for (const g of missing) if (!(g in next)) next[g] = [];
          return next;
        });
        for (const g of missing) loadedEntryGroups.current.add(g);
      });
    return () => ac.abort();
  }, [systemId, entryGroupsKey]);

  function toggleEntry(key: string, id: number, limit: number) {
    setChosenEntries((prev) => {
      const cur = prev[key] ?? [];
      if (cur.includes(id)) {
        const next = cur.filter((x) => x !== id);
        return { ...prev, [key]: next };
      }
      if (cur.length >= limit) return prev;
      return { ...prev, [key]: [...cur, id] };
    });
  }
  // Недобор — честный гейт с тем же антитупиком: нет каталога — нет гейта.
  const entryShortfall = entrySlots
    .map((s) => {
      const picked = (chosenEntries[s.key] ?? []).length;
      const available = entryCatalog[s.group]?.length ?? 0;
      return { ...s, picked, missing: Math.max(0, Math.min(s.total, available) - picked) };
    })
    .filter((s) => s.missing > 0);
  const entryComplete = entryShortfall.length === 0;

  const [weaponCatalog, setWeaponCatalog] = useState<CompendiumEntry[] | null>(null);
  useEffect(() => {
    if (!systemId) {
      setWeaponCatalog(null);
      return;
    }
    const ac = new AbortController();
    loadDndEquipmentEntries(systemId, { signal: ac.signal })
      .then((rows) => setWeaponCatalog(rows.filter(isMasterableWeapon)))
      .catch(() => {
        setWeaponCatalog([]);
      });
    return () => ac.abort();
  }, [systemId]);
  const weaponSlots = (choiceDefs ?? [])
    .filter((d) => d.kind === "weapon" && d.minLevel <= level)
    .reduce((n, d) => n + d.count, 0);
  function toggleMastered(entry: CompendiumEntry) {
    setMasteredWeapons((prev) => {
      if (prev.some((w) => w.entryId === entry.id)) return prev.filter((w) => w.entryId !== entry.id);
      if (prev.length >= weaponSlots) return prev;
      return [...prev, { entryId: entry.id, name: entry.name }];
    });
  }
  // Недобор — гейт с антитупиком: нет каталога — нет гейта.
  const weaponMissing =
    choiceDefs == null || weaponCatalog == null
      ? 0
      : Math.max(0, Math.min(weaponSlots, weaponCatalog.length) - masteredWeapons.length);
  const weaponComplete = weaponMissing === 0;

  // Экспертность из выборов умений (deft_explorer_expertise следопыта 2 ур.,
  // ranger_expertise 9 ур.): слоты суммой count открытых уровнем дефов.
  // Брать можно любой навык из каталога — владение им проверяет стол, а не
  // визард (итоговые владения на этом шаге ещё не собраны).
  const expertiseSlots = (choiceDefs ?? [])
    .filter((d) => d.kind === "skill" && d.minLevel <= level)
    .reduce((n, d) => n + d.count, 0);
  function toggleExpertise(key: string) {
    setChosenExpertise((prev) => {
      if (prev.includes(key)) return prev.filter((s) => s !== key);
      return prev.length < expertiseSlots ? [...prev, key] : prev;
    });
  }
  const expertiseMissing =
    choiceDefs == null ? 0 : Math.max(0, expertiseSlots - chosenExpertise.length);
  const expertiseComplete = expertiseMissing === 0;

  // Индекс заклинаний для шага выбора: фильтруем кандидатов по списку
  // классов и школе здесь, короткими именами тут не обойтись.
  useEffect(() => {
    if (!systemId) {
      setSpellIndex(null);
      return;
    }
    const ac = new AbortController();
    loadDndSpellIndex(systemId, { signal: ac.signal })
      .then((rows) => setSpellIndex(rows.filter((e) => e.kind === "spell")))
      .catch((e) => {
        if (!isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [systemId]);

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
  } else if (speciesCustom !== null && speciesCustom.trim() !== "") {
    // Свой вариант вида: 1 навык на выбор из любых (Хвосты 2.1).
    skillGroups.push({
      key: "species",
      label: "От вида (свой вариант)",
      count: 1,
      options: [],
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
  // Подкласс выбирает наравне с остальными (Ученик войны, Посланник
  // рыцарства): свой список из книги, своя квота — в кучу не складываем.
  if (subclassGrants.skillChoice) {
    skillGroups.push({
      key: "subclass",
      label: `От подкласса${subclassEntry ? ` (${subclassEntry.name})` : ""}`,
      count: subclassGrants.skillChoice.count,
      options: subclassGrants.skillChoice.options,
    });
  }
  // Свой вариант предыстории: 2 навыка на выбор из любых (Хвосты 2.1).
  // У обычной предыстории выбора нет — навыки выданы фиксированно.
  if (backgroundCustom !== null && backgroundCustom.trim() !== "") {
    skillGroups.push({
      key: "background",
      label: "От предыстории (свой вариант)",
      count: 2,
      options: [],
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
  // владение дважды нельзя, а место в выборе оно бы съело. Выдачи подкласса
  // (Орудия милосердия) — наравне с остальными.
  const grantedSkills = new Set([...backgroundSkills, ...classGrants.skills, ...subclassGrants.skills, ...speciesGrants.skills, ...featGrants.skills]);

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

  // Недобор навыков — честный гейт: «Далее» на шаге навыков ждёт полного
  // выбора, а Обзор показывает чего не хватает. Требование режется
  // доступным: если справочник не отдал список (офлайн), выбрать не из чего —
  // и гейта нет, иначе был бы тупик.
  const skillShortfall = skillGroups
    .map((g) => {
      const available = optionsFor(g).filter((k) => !grantedSkills.has(k)).length;
      // Выбор, ставший выдачей после смены источника, квоту не закрывает:
      // иначе гейт проходится без валидного пика.
      const picked = chosenIn(g.key).filter((t) => !grantedSkills.has(t.slice(t.indexOf(":") + 1))).length;
      return { group: g, picked, missing: Math.max(0, Math.min(g.count, available) - picked) };
    })
    .filter((s) => s.missing > 0);
  const skillsComplete = skillShortfall.length === 0;
  // Черта происхождения обязательна по правилам, когда её даёт предыстория
  // или вид, — без неё лист недособран.
  const featMissing = featNeeded && !effectiveFeatId;

  // Обычные vs редкие — хардкод по Книге игрока: в данных категорий нет
  // (проверено чтением базы: 19 записей плоско). Несовпавшее с группой —
  // в «прочие», mismatch виден, а не молчит.
  const COMMON_LANGUAGES = [
    "Общий",
    "Общий язык жестов",
    "Дварфский",
    "Эльфийский",
    "Великаний",
    "Гномий",
    "Гоблинский",
    "Полуросликов",
    "Орочий",
    "Драконий",
  ];
  const RARE_LANGUAGES = [
    "Бездны",
    "Небесный",
    "Глубинная речь",
    "Друидический",
    "Инфернальный",
    "Первичный",
    "Сильван",
    "Воровской жаргон",
    "Подземный",
  ];
  const commonLangs = languageOptions.filter((o) => COMMON_LANGUAGES.includes(o.name));
  const rareLangs = languageOptions.filter((o) => RARE_LANGUAGES.includes(o.name));
  const otherLangs = languageOptions.filter(
    (o) => !COMMON_LANGUAGES.includes(o.name) && !RARE_LANGUAGES.includes(o.name)
  );
  // Автовыдача классовых: только классы — подклассы такого не дают
  // (проверено по всем 57). Видна строкой, снимается на листе.
  // Матчим и русские, и английские имена — хоумбрю иначе молча мимо.
  const autoLanguages: string[] = [];
  {
    const cn = classOption?.name.toLowerCase() ?? "";
    if (cn.includes("плут") || cn.includes("rogue")) autoLanguages.push("Воровской жаргон");
    if (cn.includes("друид") || cn.includes("druid")) autoLanguages.push("Друидический");
  }
  function toggleLanguage(name: string) {
    setChosenLanguages((prev) => (prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name]));
  }
  const dossierLangNames = [...new Set([...chosenLanguages, ...autoLanguages])];

  // Выборы заклинаний — блоками по одному на выбор, как навыки: у черты свои
  // круги и списки, у вида свои, у подкласса свои (Мистический рыцарь).
  // В одну кучу не складываем по той же причине.
  interface SpellPickGroup {
    key: string;
    label: string;
    count: number;
    level: number | null;
    classIds: number[];
    schools: string[];
    outsideLimit: boolean;
    /** Потолок круга для групп «любой круг» (подготовленные ЭК — только
     *  круги, на которые есть ячейки). null — без потолка. */
    maxCircle: number | null;
    /** Только эти заклинания (заговор стрелка); пусто — любые кандидаты. */
    names: string[];
  }
  // Число выбора: фиксированное или из колонки прогрессии на уровне
  // (заговоры/подготовленные ЭК растут; прогрессия класса первична,
  // подкласса — запасная, как в слотах).
  function choiceCount(
    c: { count: number; countFrom?: "cantrips" | "prepared" },
    classProg: ClassProgression | undefined,
    subProg: ClassProgression | undefined
  ): number {
    if (c.countFrom === "cantrips") {
      return cantripsAtLevel(classProg, level) ?? cantripsAtLevel(subProg, level) ?? c.count;
    }
    if (c.countFrom === "prepared") {
      return preparedAtLevel(classProg, level) ?? preparedAtLevel(subProg, level) ?? c.count;
    }
    return c.count;
  }
  // Высший круг с ячейками на уровне (потолок «любого круга» ЭК).
  function slotTopCircle(): number | null {
    const prog = (subclassEntry?.data.progression ?? classEntry?.data.progression) as ClassProgression | undefined;
    const slots = spellSlotsAtLevel(prog, level);
    if (!slots) return null;
    let top = 0;
    for (let i = 0; i < slots.length; i += 1) if (slots[i] > 0) top = i + 1;
    return top > 0 ? top : null;
  }
  const spellGroups: SpellPickGroup[] = [];
  {
    const topCircle = slotTopCircle();
      const choiceSources: [string, string, typeof featGrants][] = [
        ["class", `От класса${classOption ? ` (${classOption.name})` : ""}`, classGrants],
        ["subclass", `От подкласса${subclassEntry ? ` (${subclassEntry.name})` : ""}`, subclassGrants],
        ["species", `От вида${speciesEntry ? ` (${speciesEntry.name})` : ""}`, speciesGrants],
        ["feat", `От черты${featEntry ? ` (${featEntry.name})` : ""}`, featGrants],
        ["style", "От черты боевого стиля", styleGrants],
      ];
    for (const [src, label, g] of choiceSources) {
      const isSub = src === "subclass";
      const classProg = (src === "class" ? classEntry?.data.progression : undefined) as ClassProgression | undefined;
      const subProg = (isSub ? subclassEntry?.data.progression : undefined) as ClassProgression | undefined;
      g.spellChoices.forEach((c, i) => {
        // Ключ с префиксом spell: — токены навыков матчат группы через
        // startsWith("class:") и чужие токены им не нужны.
        spellGroups.push({
          key: `spell:${src}:${i}`,
          label,
          count: choiceCount(c, classProg, subProg),
          level: c.level,
          classIds: c.classIds,
          schools: c.schools,
          outsideLimit: c.outsideLimit,
          maxCircle: isSub && c.level == null ? topCircle : null,
          names: c.names ?? [],
        });
      });
    }
  }
  // Заклинания, которые придут сами пересчётом выдач (не выбор, а грант), —
  // их в кандидатах помечаем, а не даём взять дублем.
  const grantedSpellIds = new Set(
    [...classGrants.spells, ...speciesGrants.spells, ...featGrants.spells].map((s) => s.id)
  );
  const grantedSpellNames = [...classGrants.spells, ...speciesGrants.spells, ...featGrants.spells].map((s) => s.name);
  function spellCandidates(group: SpellPickGroup): CompendiumEntry[] {
    if (!spellIndex) return [];
    return spellIndex.filter((e) => {
      const circle = e.level ?? 0;
      if (group.level != null && circle !== group.level) return false;
      // Потолок «любого круга»: подготовленные ЭК — только круги с ячейками.
      if (group.level == null && group.maxCircle != null && circle > group.maxCircle) return false;
      if (group.names.length > 0) {
        const hit = group.names.some((n) => n === e.name || n === e.name_original);
        if (!hit) return false;
      }
      if (group.classIds.length > 0) {
        const lists = Array.isArray(e.data.classes) ? (e.data.classes as { id?: number }[]) : [];
        if (!lists.some((c) => c.id != null && group.classIds.includes(c.id))) return false;
      }
      if (group.schools.length > 0) {
        const school = (e.data.school as { name?: string } | undefined)?.name ?? "";
        if (!group.schools.includes(school)) return false;
      }
      return true;
    });
  }
  const chosenSpellEntryIds = new Set(chosenSpells.map((t) => Number(t.slice(t.lastIndexOf(":") + 1))));
  function toggleSpell(groupKey: string, entryId: number, limit: number) {
    const token = `${groupKey}:${entryId}`;
    // Одно заклинание дважды не учится — ни внутри блока, ни между блоками.
    if (!chosenSpells.includes(token) && chosenSpellEntryIds.has(entryId)) return;
    setChosenSpells((prev) => {
      if (prev.includes(token)) return prev.filter((s) => s !== token);
      const used = prev.filter((s) => s.startsWith(`${groupKey}:`)).length;
      return used < limit ? [...prev, token] : prev;
    });
  }
  const chosenSpellsIn = (groupKey: string) => chosenSpells.filter((s) => s.startsWith(`${groupKey}:`));
  // Тот же антитупик, что у навыков: требование режется доступным.
  const spellShortfall = spellGroups
    .map((g) => {
      const available = spellCandidates(g).filter((e) => !grantedSpellIds.has(e.id)).length;
      const picked = chosenSpellsIn(g.key).length;
      return { group: g, picked, missing: Math.max(0, Math.min(g.count, available) - picked) };
    })
    .filter((s) => s.missing > 0);
  const spellsComplete = spellShortfall.length === 0;

  // Прибавка от предыстории. Три характеристики предлагает сама предыстория
  // (`abilities`), а как их разложить — выбор игрока. Свой вариант списка
  // не несёт — разрешены любые (договор с Мастером, Хвосты 2.1).
  const awardOptions =
    backgroundCustom !== null && backgroundCustom.trim() !== ""
      ? Object.keys(ABILITY_NAME_TO_KEY)
      : backgroundGrants.abilityOptions;
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
    // Без системы собирать нечего: ссылки на компендиум повисли бы в воздухе.
    // Проверка вместо восклицательного знака — кампания без системы роняла визард крашем.
    if (!systemId) {
      setSaveError("У кампании не указана система — создание недоступно. Выберите систему и попробуйте ещё раз.");
      return;
    }
    const sid = systemId;
    setSaving(true);
    setSaveError(null);
    setAvatarFailed(false);
    // Внешний try/finally: любой обвал на сборке (сеть в середине, битый
    // компендиум) оставляет семь шагов на месте, а кнопку — живой.
    // Внутренние try/catch вокруг отдельных выдач сохранены: недоступный
    // справочник даёт пустую секцию, а не срыв всего создания.
    try {
    const character = emptyDndCharacter();
    character.systemId = sid;
    character.characterName = characterName.trim();
    character.playerName = playerName.trim();
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
      // Хиты пишутся сразу тем же счётом, что превью Обзора: кость + ВЫН,
      // выше 1-го — среднее + ВЫН. lump хранит только кубовую часть
      // (движок левелапа прибавляет ВЫН×уровень сам), иначе двойной счёт.
      {
        const dieNum = hitDieMatch ? Number.parseInt(hitDieMatch[0], 10) : NaN;
        if (Number.isFinite(dieNum)) {
          const conMod = abilityModifier(awardedAbilities.con);
          const avg = Math.floor(dieNum / 2) + 1;
          const max = Math.max(1, dieNum + conMod + (level - 1) * (avg + conMod));
          character.hitPointMax = String(max);
          character.hitPointsCurrent = String(max);
          character.hpLump = dieNum + (level - 1) * avg;
          character.hpRolls = [];
          character.hpMiscPerLevel = 0;
        }
      }

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
        // Инструменты подкласса (Набор травника Орудий милосердия) — той же
        // строкой без характеристики, как классовые выше; способность
        // подтянется на листе при смене класса/подкласса.
        const subclassToolPicks =
          subclassId && Array.isArray(subclassEntry?.data.tool_profs)
            ? (subclassEntry!.data.tool_profs as { id: number; name: string }[])
            : [];
        for (const t of subclassToolPicks) {
          if (!character.proficiencies.some((p) => p.name === t.name)) {
            character.proficiencies = [...character.proficiencies, { entryId: t.id, name: t.name, abilityKey: null }];
          }
        }
      }
      try {
        const classFeatureEntries = await loadDndClassFeatures(sid, classId);
          let classFeatures = featuresFromEntries(classFeatureEntries, classId, level);
          if (subclassId) {
            const subclassFeatureEntries = await loadDndClassFeatures(sid, subclassId);
          classFeatures = [...classFeatures, ...featuresFromEntries(subclassFeatureEntries, subclassId, level)];
        }
        character.classFeatures = classFeatures;
      } catch {
        // compendium unreachable — leave classFeatures empty, editable later
      }
    }

    if (speciesId || speciesCustom?.trim()) {
      const species = speciesOptions.find((s) => s.id === speciesId);
      character.raceId = speciesId;
      // Свой вариант — именем без привязки: выдач нет, скорость и умения
      // берутся только из записи справочника.
      character.raceName = species?.name ?? speciesCustom?.trim() ?? "";
      character.raceTypeName = species?.creatureTypeName ?? "";
      if (speciesId && species?.walkSpeed) {
        character.speed = `${species.walkSpeed} фт.`;
        // Кость скорости читает структуру, а не строку (иначе «—» в кости).
        // walkSpeed вида — строка, в структуру ложится числом.
        const walk = Number(species.walkSpeed);
        if (Number.isFinite(walk)) character.speeds = { ...character.speeds, walk };
      }
      if (speciesId) {
        try {
          const speciesFeatureEntries = await loadDndSpeciesFeatures(sid, speciesId);
          character.speciesFeatures = featuresFromEntries(speciesFeatureEntries, speciesId, level);
        } catch {
          // ignore — editable later
        }
      }
    }

    if (backgroundId || backgroundCustom?.trim()) {
      const bg = backgroundOptions.find((b) => b.id === backgroundId);
      character.backgroundId = backgroundId;
      character.backgroundName = bg?.name ?? backgroundCustom?.trim() ?? "";
      character.backgroundSkillNames = backgroundSkills;
      if (backgroundId) {
        try {
          const entry = await readResource<CompendiumEntry>(`/systems/entries/${backgroundId}`);
          const tools = typeof entry.data.tools === "string" ? entry.data.tools : "";
          if (tools) character.proficiencies = [...character.proficiencies, { entryId: null, name: tools, abilityKey: null }];
        } catch {
          /* background has no compendium entry (freehand) — nothing to fill */
        }
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

    // Черты боевого стиля (тикет 03): с entryId, чтобы жили связанными, —
    // описание и так лежит в записи, дублируем снимком на случай офлайна.
    // Пишем всё выбранное, включая хвост сверх лимита: эксцесс виден
    // счётчиком на листе, молча не режем — как заклинания/приёмы/оружие.
    for (const id of chosenStyle) {
      if (typeof id !== "number") continue;
      let entry: CompendiumEntry | undefined = styleFeatEntries[id];
      if (!entry) {
        try {
          entry = await readResource<CompendiumEntry>(`/systems/entries/${id}`);
        } catch {
          entry = undefined;
        }
      }
      const name =
        entry?.name ?? styleFeats.find((f) => f.id === id)?.name ?? "Черта боевого стиля";
      if (character.feats.some((f) => f.name === name)) continue;
      character.feats = [...character.feats, { name, description: entry?.description ?? "", entryId: id }];
    }

    // Освоенное оружие — снимком {entryId, name} (тикет 06). Дедуп по entryId.
    for (const w of masteredWeapons) {
      if (character.masteredWeapons.some((m) => m.entryId === w.entryId)) continue;
      character.masteredWeapons = [...character.masteredWeapons, { entryId: w.entryId, name: w.name }];
    }

    // Приёмы/выстрелы (тикет 05) — в «Особые умения» с entryId и БЕЗ
    // sourceParentId: ресинк классовых особенностей при апе по
    // sourceParentId вычищает своё, а ручные пики должны пережить.
    // Описания — из уже загруженного каталога, дожимать нечего.
    {
      const seen = new Set(
        [...character.classFeatures, ...character.specialAbilities]
          .map((f) => f.entryId)
          .filter((id): id is number => typeof id === "number")
      );
      for (const slot of entrySlots) {
        const catalog = entryCatalog[slot.group] ?? [];
        for (const id of chosenEntries[slot.key] ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const e = catalog.find((x) => x.id === id);
          character.specialAbilities = [
            ...character.specialAbilities,
            { name: e?.name ?? "Приём", description: e?.description ?? "", entryId: id },
          ];
        }
      }
    }

    character.alignment = alignment;
    character.personalityTraits = personalityTraits.trim();
    character.ideals = ideals.trim();
    character.bonds = bonds.trim();
    character.flaws = flaws.trim();
    character.notes = dossierNotes.trim();
    // Языки — во «Владения и языки» строкой, как лист их и показывает:
    // отдельного поля у D&D-персонажа нет.
    for (const name of dossierLangNames) {
      if (character.proficiencies.some((p) => p.name === name)) continue;
      const opt = languageOptions.find((o) => o.name === name);
      character.proficiencies = [...character.proficiencies, { entryId: opt?.id ?? null, name, abilityKey: null }];
    }

    character.skillProfs = { ...character.skillProfs };
    for (const s of chosenSkillKeys) character.skillProfs[s] = 1;
    for (const s of grantedSkills) character.skillProfs[s] = 1;
    // Экспертность из выборов умений — уровнем владения 2, поверх выданного.
    for (const s of chosenExpertise) character.skillProfs[s] = 2;

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
          const { entryId: _eid, ...restMeta } = (metas[idx] ?? {}) as Record<string, unknown>;
          addedItems.push({
            ...EMPTY_EQUIPMENT_ITEM,
            ...(restMeta as object),
            id: makeEquipmentId(),
            name: item.name,
            qty: item.qty > 1 ? String(item.qty) : "",
            entryId: item.entryId,
          });
        });
        // Выборные позиции кладутся строкой: выбрать за игрока приложение не
        // вправе, а потерять их из набора тем более.
        for (const text of set.manual) {
          addedItems.push({ ...EMPTY_EQUIPMENT_ITEM, id: makeEquipmentId(), name: text, notes: "выбрать самому" });
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

    // Выбранные заклинания — ручными записями (без sourceParentId): пересчёт
    // ниже такие не трогает, а лист резолвит их вживую по entryId.
    // prepared: 2 — выученное всегда готово, как автовыданное.
    for (const token of chosenSpells) {
      const sep = token.lastIndexOf(":");
      const group = spellGroups.find((g) => g.key === token.slice(0, sep));
      if (!group) continue;
      const entryId = Number(token.slice(sep + 1));
      if (!Number.isFinite(entryId)) continue;
      const entry = spellIndex?.find((e) => e.id === entryId);
      const lvl = entry?.level ?? group.level ?? 0;
      const rec = {
        entryId,
        name: entry?.name ?? "Заклинание",
        prepared: 2 as const,
        outsideLimit: group.outsideLimit,
      };
      if (lvl <= 0) {
        character.cantrips = [...character.cantrips, rec];
      } else {
        while (character.spellsByLevel.length < lvl) character.spellsByLevel.push([]);
        character.spellsByLevel[lvl - 1] = [...character.spellsByLevel[lvl - 1], rec];
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

    // Отвал сети на сохранении больше не выбрасывает шаги: ошибка
    // показывается, черновик остаётся, кнопка становится повтором.
    // Повтор после «создался, а фото нет» статблок не дублирует.
    if (!createdRef.current) {
      try {
        // Список владельца обновит onDone → StatblockList.refresh.
        await write.post("/statblocks", {
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
      }
      createdRef.current = true;
      clearWizardDraft();
    }
    // Портрет — после создания: файл держали до сих пор, чтобы отмена
    // ничего не заливала. Не залилось — персонаж уже создан, чинится
    // повтором, а не дублем.
    if (portraitFile) {
      try {
        const form = new FormData();
        form.append("file", portraitFile);
        const path =
          ownerType === "character" ? `/characters/${ownerId}/avatar` : `/setting-beings/${ownerId}/avatar`;
        // Заливка фото до 15МБ на дефолтных 10с стабильно уходила в таймаут
        // на медленной связи — даём минуту, это не управляющий запрос.
        await write.post(path, form, { timeoutMs: 60000 });
        afterWriteAnywhere([{ kind: ownerType === "character" ? "character" : "being", id: ownerId }]);
      } catch (e) {
        setSaveError(
          e instanceof Error && e.message
            ? `Персонаж создан, но фото не загрузилось: ${e.message}`
            : "Персонаж создан, но фото не загрузилось — попробуйте ещё раз."
        );
        setAvatarFailed(true);
        return;
      }
    }
    } catch (e) {
      setSaveError(
        e instanceof Error && e.message
          ? `Не удалось собрать персонажа: ${e.message}`
          : "Не удалось собрать персонажа — проверьте связь и попробуйте ещё раз."
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
      if (chosenExpertise.length > 0) {
        classLines.push(`экспертность: ${chosenExpertise.map((k) => skills.nameOf(k)).join(", ")}`);
      }
      const subclassPicked = named(chosenIn("subclass").map((t) => t.slice(t.indexOf(":") + 1)));
      if (subclassPicked.length > 0) classLines.push(`навыки подкласса: ${subclassPicked.join(", ")}`);
      const stylePickedNames = chosenStyle
        .filter((id): id is number => typeof id === "number")
        .map((id) => styleFeatEntries[id]?.name ?? styleFeats.find((f) => f.id === id)?.name ?? "черта стиля");
      if (stylePickedNames.length > 0) classLines.push(`боевой стиль: ${stylePickedNames.join(", ")}`);
      if (masteredWeapons.length > 0) {
        classLines.push(`приёмы: ${masteredWeapons.map((w) => w.name).join(", ")}`);
      }
      for (const slot of entrySlots) {
        const ids = chosenEntries[slot.key] ?? [];
        if (ids.length === 0) continue;
        const names = ids.map(
          (id) => entryCatalog[slot.group]?.find((e) => e.id === id)?.name ?? "запись"
        );
        classLines.push(`${slot.group.toLowerCase()}: ${names.join(", ")}`);
      }
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
      speciesLines.push(speciesOpt.name);      const picked = named(chosenIn("species").map((t) => t.slice(t.indexOf(":") + 1)));
      if (picked.length > 0) speciesLines.push(`навыки: ${picked.join(", ")}`);
      if (speciesGrants.originFeatChoice) speciesLines.push("черта происхождения на выбор");
      if (speciesGrants.spells.length > 0) {
        speciesLines.push(`заклинания: ${speciesGrants.spells.map((sp) => sp.name).join(", ")}`);
      }
      if (speciesOpt.walkSpeed) speciesLines.push(`скорость ${speciesOpt.walkSpeed} фт.`);
    } else if (speciesCustom?.trim()) {
      speciesLines.push(`${speciesCustom.trim()} (свой вариант)`);
      const picked = named(chosenIn("species").map((t) => t.slice(t.indexOf(":") + 1)));
      if (picked.length > 0) speciesLines.push(`навыки: ${picked.join(", ")}`);
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
    } else if (backgroundCustom?.trim()) {
      bgLines.push(`${backgroundCustom.trim()} (свой вариант)`);
      const picked = named(chosenIn("background").map((t) => t.slice(t.indexOf(":") + 1)));
      if (picked.length > 0) bgLines.push(`навыки: ${picked.join(", ")}`);
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

  // Выборы инструментов, которые визард не делает за игрока («Музыкант»),
  // честно показываются как «добрать на листе». Выборы заклинаний живут на
  // своём шаге — сюда не дублируются.
  function spellChoiceText(c: GrantedSpellChoice & { maxCircle?: number | null }): string {
    const what =
      c.level === 0
        ? `${c.count} заговора`
        : c.level == null
          ? `${c.count} заклинаний${c.maxCircle != null ? ` 1–${c.maxCircle} кругов` : ""}`
          : `${c.count} ${c.level} круга`;
    const lists =
      c.classIds.length > 0
        ? c.classIds.map((id) => hierarchy.classes.find((cl) => cl.id === id)?.name ?? "класс").join("/")
        : null;
    const scope = [lists && `списки: ${lists}`, c.schools.length > 0 && `школы: ${c.schools.join("/")}`]
      .filter(Boolean)
      .join(", ");
    return scope ? `${what} (${scope})` : what;
  }
  const pendingPicks: { label: string; text: string }[] = [];
  {
    const choiceSources: [string, typeof featGrants][] = [
      ["Класс", classGrants],
      ["Подкласс", subclassGrants],
      ["Вид", speciesGrants],
      ["Черта", featGrants],
    ];
    for (const [src, g] of choiceSources) {
      if (g.toolChoice) {
        pendingPicks.push({ label: src, text: `владения на выбор: ${g.toolChoice.group} — ${g.toolChoice.count}` });
      }
    }
    // Язык Баннерета («Посланник рыцарства»): модели выбора языка нет,
    // берётся руками на шаге языков — как автовыдачи плута/друида выше,
    // матчим по имени подкласса тем же приёмом.
    if (subclassId != null && subclassEntry && nameMatches(subclassEntry.name, "Баннерет")) {
      pendingPicks.push({ label: "Подкласс", text: "язык на выбор (Посланник рыцарства) — отметь на шаге языков" });
    }
  }

  // Стартовые числа тем же счётом, что лист: БМ — общей формулой (вызов, не
  // копия правила), хиты — кость класса + ВЫН, КД — без доспеха (10 + ЛОВ).
  // Форма записи класса — та же, что собирает finish() ниже.
  const previewDie = classOption ? (/\d+/.exec(classOption.hitDie)?.[0] ?? null) : null;
  const previewDieNum = previewDie !== null ? Number.parseInt(previewDie, 10) : null;
  const previewConMod = abilityModifier(awardedAbilities.con);
  const previewDexMod = abilityModifier(awardedAbilities.dex);
  const previewHp =
    previewDieNum !== null && Number.isFinite(previewDieNum)
      ? Math.max(1, previewDieNum + previewConMod + (level - 1) * (Math.floor(previewDieNum / 2) + 1 + previewConMod))
      : null;
  const previewClasses =
    classId && classOption
      ? [
          {
            classId,
            className: classOption.name,
            subclassId,
            subclassName: subclassOptions.find((s) => s.id === subclassId)?.name ?? "",
            level,
            skillChoiceOptions: classGrants.skillChoice?.options ?? [],
            skillChoiceCount: classGrants.skillChoice?.count ?? 0,
            spellcastingAbility:
              typeof classEntry?.data.spellcasting_ability === "string"
                ? (classEntry!.data.spellcasting_ability as string)
                : "",
          },
        ]
      : [];
  const previewSpeed = speciesOptions.find((x) => x.id === speciesId)?.walkSpeed ?? null;

  // Данные мини-чарника (D0): чеклист, снаряжение и имена заклинаний
  // считаются здесь, показ — в WizardMiniSheet (один источник для
  // Обзора, сплита D1 и оборота D2).
  const overviewProblems: MiniSheetProblem[] = [];
  if (!characterName.trim()) overviewProblems.push({ text: "Нет имени", target: "Личность" });
  if (!classId) overviewProblems.push({ text: "Не выбран класс", target: "Класс" });
  if (!speciesId && !speciesCustom?.trim()) overviewProblems.push({ text: "Не выбран вид", target: "Вид" });
  if (!backgroundId && !backgroundCustom?.trim())
    overviewProblems.push({ text: "Не выбрана предыстория", target: "Предыстория" });
  if (featMissing) overviewProblems.push({ text: "Не выбрана черта происхождения", target: "Черта" });
  if (!pointBuyValid) {
    overviewProblems.push({ text: "Покупка характеристик: значения вне 8–15 или превышен бюджет", target: "Характеристики" });
  }
  if (styleMissing > 0) {
    overviewProblems.push({ text: `Боевой стиль: ещё ${styleMissing}`, target: "Класс" });
  }
  for (const s of entryShortfall) {
    overviewProblems.push({ text: `${s.group}: ещё ${s.missing}`, target: "Класс" });
  }
  if (weaponMissing > 0) {
    overviewProblems.push({ text: `Оружейные приёмы: ещё ${weaponMissing}`, target: "Класс" });
  }
  for (const s of skillShortfall) {
    overviewProblems.push({ text: `Навыки (${s.group.label}): ещё ${s.missing}`, target: "Навыки" });
  }
  for (const s of spellShortfall) {
    overviewProblems.push({ text: `Заклинания (${s.group.label}): ещё ${s.missing}`, target: "Заклинания" });
  }
  const overviewTaken = startingSets.filter((s) => setTaken(s.label));
  const overviewSpellNames = chosenSpells
    .filter((t) => spellGroups.some((g) => t.startsWith(`${g.key}:`)))
    .map((t) => {
      const id = Number(t.slice(t.lastIndexOf(":") + 1));
      return spellIndex?.find((e) => e.id === id)?.name ?? `#${id}`;
    });

  const stepIndex = STEPS.indexOf(step);
  // D2: оборот на мобиле — лицо (шаг) ↔ оборот (живой чарник). Без 3D-сцены:
  // лицо прячется, оборот доворачивается (прецедент .dnd-card-back).
  // Любая смена шага возвращает лицо; на десктопе состояние сбрасывается.
  const [mobilePreview, setMobilePreview] = useState(false);
  useEffect(() => {
    setMobilePreview(false);
  }, [step]);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1001px)");
    const reset = () => {
      if (mq.matches) setMobilePreview(false);
    };
    mq.addEventListener("change", reset);
    return () => mq.removeEventListener("change", reset);
  }, []);
  // Данные постера собираются в момент нажатия (кнопки зовут колбэк),
  // поэтому черновик и правки между рендерами не протухают.
  function posterData(): PosterData {
    const speciesName =
      speciesOptions.find((x) => x.id === speciesId)?.name ?? speciesCustom?.trim() ?? "";
    return {
      name: characterName.trim() || "Без имени",
      subtitle: [classOption ? `${classOption.name} ${level}` : "", speciesName]
        .filter(Boolean)
        .join(" · "),
      hp: previewHp != null ? String(previewHp) : "—",
      ac: String(10 + previewDexMod),
      pb: computeProficiencyBonus(previewClasses),
      extra: previewSpeed ? { label: "СКОР", value: previewSpeed } : undefined,
      abilities: ABILITY_LABELS.map(({ key, label }) => ({ label, value: awardedAbilities[key] })),
      portraitSrc: portraitPreview,
    };
  }
  // Живой мини-чарник одним источником: Обзор, сплит D1 и оборот D2
  // рисуют одно и то же, двух расходящихся превью нет.
  function miniSheet() {
    const dossier: { label: string; text: string }[] = [];
    if (personalityTraits.trim()) dossier.push({ label: "Черты", text: personalityTraits.trim() });
    if (ideals.trim()) dossier.push({ label: "Идеалы", text: ideals.trim() });
    if (bonds.trim()) dossier.push({ label: "Узы", text: bonds.trim() });
    if (flaws.trim()) dossier.push({ label: "Изъяны", text: flaws.trim() });
    if (dossierNotes.trim()) dossier.push({ label: "Заметки", text: dossierNotes.trim() });
    return (
      <WizardMiniSheet
        characterName={characterName}
        playerName={playerName}
        problems={overviewProblems}
        onFix={(t) => {
          if (isWizardStep(t)) setStep(t);
        }}
        abilities={abilities}
        awardedAbilities={awardedAbilities}
        proficiencyBonus={computeProficiencyBonus(previewClasses)}
        previewHp={previewHp}
        dexMod={previewDexMod}
        speed={previewSpeed}
        alignment={alignment}
        languages={dossierLangNames}
        dossier={dossier}
        sources={overviewSources}
        equipmentTaken={overviewTaken.map((s) => s.label)}
        equipmentItems={takenSummary.items}
        equipmentGold={takenSummary.gold}
        pendingPicks={pendingPicks}
        chosenSpellNames={overviewSpellNames}
      />
    );
  }
  function next() {
    setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]);
  }
  function back() {
    setStep(STEPS[Math.max(0, stepIndex - 1)]);
  }
  function cancelWizard() {
    // Черновик уже лежит в localStorage — закрытие ничего не стирает,
    // вопрос лишь страхует от случайного промаха.
    if (
      wizardDirty &&
      !window.confirm("Закрыть без создания? Введённое сохранено как черновик и восстановится при следующем открытии.")
    ) {
      return;
    }
    onCancel();
  }
  function resetWizard() {
    // После «создался, а фото нет» сброс означал бы дубль статблока
    // повторной кнопкой «Создать» — в этом состоянии сброса нет в UI,
    // гард на всякий случай.
    if (createdRef.current) return;
    if (!window.confirm("Очистить черновик и начать заново? Это действие не отменить.")) return;
    clearWizardDraft();
    setHadDraft(false);
    setStep("Личность");
    setCharacterName(ownerName ?? "");
    setPlayerName(ownerType === "character" ? ownerPlayerName ?? "" : "");
    setClassId(null);
    setSubclassId(null);
    setLevel(1);
    setLevelText(null);
    setSpeciesId(null);
    setSpeciesCustom(null);
    setBackgroundId(null);
    setBackgroundCustom(null);
    setFeatId(null);
    setFeatTouched(false);
    setAwardMode("2+1");
    setAwardPrimary(null);
    setAwardSecondary(null);
    setTakenSets({});
    setMethod("standard");
    const a = emptyAbilities();
    (Object.keys(a) as (keyof DndAbilityScores)[]).forEach((k, i) => (a[k] = STANDARD_ARRAY[i]));
    setAbilities(a);
    setRolledPool(STANDARD_ARRAY.slice());
    setChosenSkills([]);
    setChosenSpells([]);
    setSpellSearch("");
    setAlignment("");
    setChosenLanguages([]);
    setPersonalityTraits("");
    setIdeals("");
    setBonds("");
    setFlaws("");
    setDossierNotes("");
    clearPortrait();
    setAvatarFailed(false);
    createdRef.current = false;
    setSaveError(null);
  }

  return (
    // Визард — модалкой, как SettingWizard: фокус на семи шагах, фокус-трап и
    // возврат фокуса из коробки. Клик по фону отключён (черновик и так
    // спасает, но выход — только через явную кнопку), ESC идёт в cancelWizard
    // с вопросом. Внутренняя .card остаётся — вёрстка не едет, а класс
    // .wizard включает готовые 620px (.modal:has(.wizard)).
    <Modal onClose={cancelWizard} closeOnBackdropClick={false} ariaLabel="Создание персонажа">
    <div className="card stack wizard">
      {/* Шапка-инверсия §1.4: плашка называет карточку, счётчик — справа. */}
      <div className="campaign-player-header">
        <span>Создание персонажа</span>
        <span>
          Шаг {stepIndex + 1} из {STEPS.length} · {step}
        </span>
      </div>
      <div className="row wizard-step-row">
        {/* Мобильный пикер вместо ленты табов: 12 язычков не влезают в 390px.
            Тот же приём, что .dnd-section-picker у листа персонажа.
            Шаги не залочены: заглядывать вперёд и в Обзор можно, гейты
            держат «Далее» (навыки/заклинания) и «Создать» (чеклист). */}
        <select
          className="wizard-step-picker"
          aria-label="Шаг создания персонажа"
          value={step}
          onChange={(e) => setStep(e.target.value as Step)}
        >
          {STEPS.map((s, i) => (
            <option key={s} value={s}>
              {i + 1}. {s}
            </option>
          ))}
        </select>
      </div>
      <div className="tabs wizard-steps-tabs" role="tablist" aria-label="Шаги создания персонажа">
        {STEPS.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={step === s}
            aria-current={step === s ? "step" : undefined}
            className={step === s ? "active" : ""}
            onClick={() => setStep(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {/* D2: кнопка оборота — только там, где нет сайдбара (≤1000px).
          На «Обзоре» не нужна: чарник уже показан. */}
      {step !== "Обзор" && (
        <div className="row wizard-flip-row">
          <button type="button" onClick={() => setMobilePreview((v) => !v)} aria-expanded={mobilePreview}>
            {mobilePreview ? "К шагам" : "Предпросмотр"}
          </button>
        </div>
      )}

      {/* D1: десктоп-сплит — шаги слева, живой чарник справа липко.
          На шаге «Обзор» сайдбар прячем: чарник уже во всю ширину. */}
      <div className="wizard-split">
      <div className="wizard-main stack">
      {mobilePreview && step !== "Обзор" ? (
        <div className="wizard-back">
          {miniSheet()}
          <button
            type="button"
            className="wizard-back-corner"
            aria-label="К шагам"
            onClick={() => setMobilePreview(false)}
          />
        </div>
      ) : (
      <>
      {step === "Личность" && (
        <div className="stack">
          <label>
            Имя персонажа
            <input value={characterName} onChange={(e) => setCharacterName(e.target.value)} maxLength={80} />
          </label>
          <label>
            Имя игрока
            <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={80} />
          </label>
          <span className="muted">Имя можно придумать позже — для создания оно понадобится на шаге «Обзор».</span>
        </div>
      )}

      {step === "Портрет" && (
        <div className="stack">
          <span className="muted">Необязательный шаг — можно пропустить. Фото зальётся при создании персонажа.</span>
          {portraitPreview ? (
            <div className="row">
              <img src={portraitPreview} alt="Портрет персонажа" className="wizard-avatar-preview" />
              <button type="button" onClick={clearPortrait}>
                Убрать фото
              </button>
            </div>
          ) : (
            <>
              <label className="row">
                Выбрать фото
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    portraitCrop.onSelect(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
              </label>
              {ownerPortraitUrl && (
                <div className="row">
                  <button type="button" onClick={takeOwnerPortrait} disabled={portraitFetching}>
                    {portraitFetching ? "Загружаю…" : "Взять как у владельца"}
                  </button>
                </div>
              )}
            </>
          )}
          {portraitCrop.modal}
          {portraitError && (
            <div className="sb-save-status is-error" role="alert">
              {portraitError}
            </div>
          )}
        </div>
      )}

      {step === "Класс" && (
        <div className="stack">
          {!systemId && <span className="muted">У кампании не указана система — выбор класса недоступен, можно будет добавить позже.</span>}
          <label className="row">
            Поиск
            <input
              value={classQ}
              onChange={(e) => setClassQ(e.target.value)}
              placeholder="Название класса"
              aria-label="Поиск класса"
            />
          </label>
          <div className="row">
              <select value={classId ?? ""} onChange={(e) => { setClassId(e.target.value ? Number(e.target.value) : null); setSubclassId(null); setChosenStyle([]); setChosenEntries({}); setChosenExpertise([]); setMasteredWeapons([]); setChosenSkills((prev) => prev.filter((t) => !t.startsWith("class:"))); setChosenSpells((prev) => prev.filter((t) => !t.startsWith("spell:class:") && !t.startsWith("spell:subclass:"))); }}>
              <option value="">— класс —</option>
              {hierarchy.classes.filter((c) => matchQ(c.name, classQ)).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {subclassOptions.length > 0 &&
              (subclassLocked ? (
                <span className="muted">подкласс с {classOption?.subclassLevel} уровня</span>
              ) : (
                <select value={subclassId ?? ""} onChange={(e) => { setSubclassId(e.target.value ? Number(e.target.value) : null); setChosenSkills((prev) => prev.filter((t) => !t.startsWith("subclass:"))); setChosenSpells((prev) => prev.filter((t) => !t.startsWith("spell:subclass:"))); setChosenEntries((prev) => { const drop = new Set((choiceDefs ?? []).filter((d) => !d.fromClass && d.kind === "entry").map((d) => d.key)); if (drop.size === 0) return prev; const next = { ...prev }; let changed = false; for (const k of drop) if (k in next) { delete next[k]; changed = true; } return changed ? next : prev; }); }}>
                  <option value="">— подкласс —</option>
                  {subclassOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ))}
            <label className="row">
              Уровень
              <span className="dnd-class-level-stepper">
                <button
                  type="button"
                  className="dnd-level-step-btn wizard-touch"
                  aria-label="Уровень −1"
                  disabled={level <= 1}
                  onClick={() => stepLevel(-1)}
                >
                  <NavIcon name="minus" />
                </button>
                <button
                  type="button"
                  className="dnd-level-step-btn wizard-touch"
                  aria-label="Уровень +1"
                  disabled={level >= 20}
                  onClick={() => stepLevel(1)}
                >
                  <NavIcon name="plus" />
                </button>
              </span>
              <input
                type="number"
                min={1}
                max={20}
                className="wizard-level-input"
                value={levelText ?? level}
                onChange={(e) => setLevelText(e.target.value)}
                onBlur={(e) => commitLevel(e.target.value)}
              />
            </label>
          </div>
          <EntryBlurb text={classEntry?.description} />
          {styleSlots.length > 0 && (
            <div className="stack">
              <span className="muted">
                Боевой стиль — выбери черту{styleSlots.length > 1 ? " (у Чемпиона их две)" : ""} ({stylePicked}/{styleSlots.length})
              </span>
              {styleSlots.map((def, i) => {
                const takenElsewhere = new Set(chosenStyle.filter((_, j) => j !== i));
                return (
                  <div key={`${def.sourceEntryId}:${i}`} className="stack" style={{ gap: "var(--sp-1)" }}>
                    <div className="row">
                      <select
                        value={chosenStyle[i] ?? ""}
                        onChange={(e) => {
                          const id = e.target.value ? Number(e.target.value) : null;
                          setChosenStyle((prev) => prev.map((v, j) => (j === i ? id : v)));
                          if (id != null) void fetchStyleEntry(id);
                        }}
                      >
                        <option value="">— черта стиля —</option>
                        {styleFeats
                          .filter((f) => !takenElsewhere.has(f.id))
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                      </select>
                      <span className="muted">от умения «{def.sourceName}»</span>
                    </div>
                    {chosenStyle[i] != null && styleFeatEntries[chosenStyle[i]!] && (
                      <EntryBlurb text={styleFeatEntries[chosenStyle[i]!].description} />
                    )}
                  </div>
                );
              })}
              {styleFeats.length === 0 && styleSlots.length > 0 && (
                <span className="muted">Черты стиля не загрузились — выбери позже на листе.</span>
              )}
              {chosenStyle.slice(styleSlots.length).map(
                (id, k) =>
                  id != null && (
                    <div key={`orphan:${k}`} className="row">
                      <span>
                        {styleFeatEntries[id]?.name ?? styleFeats.find((f) => f.id === id)?.name ?? "Черта"} — сверх
                        лимита (уровень снижен), на листе подсветит.
                      </span>
                      <button
                        type="button"
                        className="comp-mini"
                        onClick={() =>
                          setChosenStyle((prev) => prev.filter((_, j) => j !== styleSlots.length + k))
                        }
                      >
                        Убрать
                      </button>
                    </div>
                  )
              )}
            </div>
          )}
          {entrySlots.length > 0 && (
            <div className="stack">
              {entrySlots.map((slot) => {
                const picked = chosenEntries[slot.key] ?? [];
                const catalog = entryCatalog[slot.group];
                return (
                  <fieldset key={slot.key} className="stack wizard-fieldset" style={{ gap: "var(--sp-1)" }}>
                    <legend className="muted wizard-legend">
                      {slot.group}: выбери {slot.total} ({picked.length}/{slot.total})
                    </legend>
                    {catalog === undefined && (
                      <span className="muted">Загружаю {slot.group.toLowerCase()}…</span>
                    )}
                    {catalog !== undefined && catalog.length === 0 && (
                      <span className="muted">Список пуст — выбери позже на листе.</span>
                    )}
                    {(catalog ?? []).map((e) => {
                      // Требование уровня — полем записи (воззвания, тикет 02
                      // warlock): недоступное видно, но не жмётся. У приёмов
                      // поля нет — для них ничего не меняется.
                      const needLevel = e.level ?? 1;
                      const locked = needLevel > level;
                      return (
                        <div key={e.id}>
                          <label className="row">
                            <input
                              type="checkbox"
                              checked={picked.includes(e.id)}
                              disabled={locked}
                              onChange={() => toggleEntry(slot.key, e.id, slot.total)}
                            />
                            {e.name}
                            {locked && <span className="muted"> · с {needLevel} ур.</span>}
                          </label>
                        {e.description && (
                          <details className="muted wizard-blurb">
                            <summary>Описание</summary>
                            <div className="wizard-blurb-more">{e.description}</div>
                          </details>
                        )}
                        </div>
                      );
                    })}
                  </fieldset>
                );
              })}
            </div>
          )}
          {weaponSlots > 0 && (
            <div className="stack">
              {weaponCatalog === null && <span className="muted">Загружаю оружие…</span>}
              {weaponCatalog !== null && (
                <WeaponMasteryPicker
                  title="Оружейные приёмы"
                  entries={weaponCatalog}
                  pickedIds={masteredWeapons.map((w) => w.entryId)}
                  limit={weaponSlots}
                  onToggle={toggleMastered}
                />
              )}
            </div>
          )}
        </div>
      )}

      {step === "Вид" && (
        <div className="stack">
          <label className="row">
            Поиск
            <input
              value={speciesQ}
              onChange={(e) => setSpeciesQ(e.target.value)}
              placeholder="Название вида"
              aria-label="Поиск вида"
            />
          </label>
          <select
            value={speciesId ?? (speciesCustom !== null ? "__custom" : "")}
            onChange={(e) => {
              if (e.target.value === "__custom") {
                setSpeciesId(null);
                setSpeciesCustom("");
              } else {
                setSpeciesId(e.target.value ? Number(e.target.value) : null);
                setSpeciesCustom(null);
              }
              setChosenSkills((prev) => prev.filter((t) => !t.startsWith("species:")));
              setChosenSpells((prev) => prev.filter((t) => !t.startsWith("spell:species:")));
            }}
          >
            <option value="">— вид —</option>
            {speciesOptions.filter((s) => matchQ(s.name, speciesQ)).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__custom">Свой вариант…</option>
          </select>
          {speciesCustom !== null && (
            <>
              <input
                value={speciesCustom}
                onChange={(e) => setSpeciesCustom(e.target.value)}
                placeholder="Название вида"
                maxLength={80}
              />
              <span className="muted">
                Свой вид: 1 навык на выбор — на шаге «Навыки», черта происхождения — вручную на своём шаге.
                Остальное договоритесь с Мастером и доберёте на листе.
              </span>
            </>
          )}
          <EntryBlurb text={speciesEntry?.description} />
        </div>
      )}

      {step === "Предыстория" && (
        <div className="stack">
          <label className="row">
            Поиск
            <input
              value={backgroundQ}
              onChange={(e) => setBackgroundQ(e.target.value)}
              placeholder="Название предыстории"
              aria-label="Поиск предыстории"
            />
          </label>
          <select
            value={backgroundId ?? (backgroundCustom !== null ? "__custom" : "")}
            onChange={(e) => {
              if (e.target.value === "__custom") {
                setBackgroundId(null);
                setBackgroundCustom("");
              } else {
                setBackgroundId(e.target.value ? Number(e.target.value) : null);
                setBackgroundCustom(null);
              }
              setAwardPrimary(null);
              setAwardSecondary(null);
              setChosenSkills((prev) => prev.filter((t) => !t.startsWith("background:")));
            }}
          >
            <option value="">— предыстория —</option>
            {backgroundOptions.filter((b) => matchQ(b.name, backgroundQ)).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            <option value="__custom">Свой вариант…</option>
          </select>
          {backgroundCustom !== null && (
            <>
              <input
                value={backgroundCustom}
                onChange={(e) => setBackgroundCustom(e.target.value)}
                placeholder="Название предыстории"
                maxLength={80}
              />
              <span className="muted">
                Своя предыстория: прибавка из любых характеристик и 2 навыка — на своих шагах, черта — вручную.
                Набор снаряжения из справочника не придёт — договоритесь с Мастером и доберёте на листе.
              </span>
            </>
          )}
          <EntryBlurb text={backgroundEntry?.description} />
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
              <label className="row">
                Поиск
                <input
                  value={featQ}
                  onChange={(e) => setFeatQ(e.target.value)}
                  placeholder="Название черты"
                  aria-label="Поиск черты"
                />
              </label>
              <select
                value={effectiveFeatId ?? ""}
                onChange={(e) => {
                  setFeatTouched(true);
                  setFeatId(e.target.value ? Number(e.target.value) : null);
                  setChosenSkills((prev) => prev.filter((t) => !t.startsWith("feat:")));
                  setChosenSpells((prev) => prev.filter((t) => !t.startsWith("spell:feat:")));
                }}
              >
                <option value="">— черта —</option>
                {originFeats.filter((f) => matchQ(f.name, featQ)).map((f) => (
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
                featEntry.description.length > 400 ? (
                  <details className="muted wizard-blurb">
                    <summary>
                      {`${featEntry.description.replace(/\s+/g, " ").trim().split(" ").slice(0, 25).join(" ")}… Показать полностью`}
                    </summary>
                    <div className="wizard-blurb-more">{featEntry.description}</div>
                  </details>
                ) : (
                  <div className="muted wizard-blurb">
                    {featEntry.description}
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}

      {step === "Характеристики" && (
        <div className="stack">
          <fieldset className="row wizard-fieldset">
            <legend className="muted wizard-legend">Способ определения характеристик</legend>
            <label className="row">
              <input type="radio" name="dnd-ability-method" checked={method === "standard"} onChange={() => applyMethod("standard")} />
              Стандартный массив
            </label>
            <label className="row">
              <input type="radio" name="dnd-ability-method" checked={method === "pointbuy"} onChange={() => applyMethod("pointbuy")} />
              Point-buy
            </label>
            <label className="row">
              <input type="radio" name="dnd-ability-method" checked={method === "roll"} onChange={() => applyMethod("roll")} />
              Бросок костей
            </label>
            <label className="row">
              <input type="radio" name="dnd-ability-method" checked={method === "manual"} onChange={() => applyMethod("manual")} />
              Вручную
            </label>
          </fieldset>
          <span className="muted">Не знаете что выбрать — берите стандартный массив.</span>

          {method === "pointbuy" && <div className="muted">Осталось очков: <span className="wizard-data">{pointBuyRemaining}</span> из <span className="wizard-data">{POINT_BUY_BUDGET}</span></div>}
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
                    {rolledPool.map((v, i) => (
                      <option key={`${v}-${i}`} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : method === "pointbuy" ? (
                  <div className="row" style={{ gap: "var(--sp-1)" }}>
                    <button type="button" aria-label={`Уменьшить ${label}`} className="wizard-touch" onClick={() => adjustPointBuy(key, -1)}>
                      <NavIcon name="minus" />
                    </button>
                    <span className="dnd-ability-score">{abilities[key]}</span>
                    <button type="button" aria-label={`Увеличить ${label}`} className="wizard-touch" onClick={() => adjustPointBuy(key, 1)}>
                      <NavIcon name="plus" />
                    </button>
                  </div>
                ) : (
                  <input
                    type="number"
                    min={1}
                    max={30}
                    className="dnd-ability-input"
                    value={abilities[key]}
                    onChange={(e) => setAbilities({ ...abilities, [key]: clampAbilityScore(Number(e.target.value)) })}
                  />
                )}
                <span className={abilityAward[key] ? "dnd-ability-mod is-boosted" : "dnd-ability-mod"}>
                  {formatModifier(abilityModifier(abilities[key]))}
                </span>
              </div>
            ))}
          </div>

          {awardOptions.length > 0 && (
            <div className="stack" style={{ gap: "var(--sp-1)" }}>
              <span className="muted">
                {backgroundCustom !== null
                  ? "Прибавка (свой вариант — любые характеристики)"
                  : `Прибавка от предыстории: ${awardOptions.join(", ")}`}
              </span>
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
              <fieldset key={group.key} className="stack wizard-fieldset" style={{ gap: "var(--sp-1)" }}>
                <legend className="muted wizard-legend">
                  {group.label}: выберите {group.count} ({picked.length}/{group.count})
                </legend>
                <div className="stack" style={{ gap: "var(--sp-1)" }}>
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
              </fieldset>
            );
          })}
          {skillShortfall.length > 0 && (
            <span className="muted">
              Чтобы идти дальше: {skillShortfall.map((s) => `${s.group.label} — ещё ${s.missing}`).join("; ")}.
            </span>
          )}
          {[...grantedSkills].length > 0 && (
            <span className="muted">
              Уже выдано без выбора: {[...grantedSkills].map((k) => skills.nameOf(k)).join(", ")}
            </span>
          )}
          {expertiseSlots > 0 && (
            <fieldset className="stack wizard-fieldset" style={{ gap: "var(--sp-1)" }}>
              <legend className="muted wizard-legend">
                Экспертность (умение класса): выберите {expertiseSlots} ({chosenExpertise.length}/{expertiseSlots})
              </legend>
              <div className="stack" style={{ gap: "var(--sp-1)" }}>
                {skills.rows.map((r) => (
                  <label key={r.original} className="row">
                    <input
                      type="checkbox"
                      checked={chosenExpertise.includes(r.original)}
                      onChange={() => toggleExpertise(r.original)}
                    />
                    {skills.nameOf(r.original)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {expertiseMissing > 0 && (
            <span className="muted">Чтобы идти дальше: экспертность — ещё {expertiseMissing}.</span>
          )}
        </div>
      )}

      {step === "Заклинания" && (
        <div className="stack">
          {spellIndex === null && !loadError && <span className="muted">Загружаю заклинания…</span>}
          {spellIndex === null && loadError && (
            <span className="muted">Список заклинаний не загрузился — выбрать не из чего, шаг пропускается.</span>
          )}
          {spellGroups.length === 0 && spellIndex !== null && (
            <span className="muted">Ни класс, ни подкласс, ни вид, ни черта не дают заклинаний на выбор.</span>
          )}
          {grantedSpellNames.length > 0 && (
            <span className="muted">Придут сами, выбирать не надо: {grantedSpellNames.join(", ")}</span>
          )}
          {spellGroups.length > 0 && spellIndex !== null && (
            <label className="row">
              Поиск
              <input
                value={spellSearch}
                onChange={(e) => setSpellSearch(e.target.value)}
                placeholder="Название заклинания"
              />
            </label>
          )}
          {spellGroups.map((group) => {
            const picked = chosenSpellsIn(group.key);
            const q = spellSearch.trim().toLowerCase();
            const cands = spellCandidates(group).filter((e) => !q || e.name.toLowerCase().includes(q));
            return (
              <fieldset key={group.key} className="stack wizard-fieldset" style={{ gap: "var(--sp-1)" }}>
                <legend className="muted wizard-legend">
                  {group.label}: выберите {group.count} ({picked.length}/{group.count})
                </legend>
                <span className="muted">
                  {spellChoiceText({
                    count: group.count,
                    classIds: group.classIds,
                    schools: group.schools,
                    level: group.level,
                    outsideLimit: group.outsideLimit,
                    maxCircle: group.maxCircle,
                  })}
                </span>
                {cands.map((e) => {
                  const token = `${group.key}:${e.id}`;
                  const isHere = chosenSpells.includes(token);
                  const elsewhere =
                    !isHere
                      ? spellGroups.find((g) => g.key !== group.key && chosenSpells.includes(`${g.key}:${e.id}`))
                      : undefined;
                  // Круг и школа видны в момент выбора — вслепую по одному
                  // имени брать не приходится. Данные уже загружены кандидатами.
                  const circle = e.level ?? 0;
                  const school = (e.data.school as { name?: string } | undefined)?.name ?? "";
                  const meta = `${circle === 0 ? "заговор" : `${circle} круг`}${school ? ` · ${school}` : ""}`;
                  if (grantedSpellIds.has(e.id)) {
                    return (
                      <div key={e.id} className="row">
                        <span className="muted">{e.name} <span className="muted">({meta})</span> — уже есть</span>
                      </div>
                    );
                  }
                  return (
                    <label key={e.id} className="row">
                      <input
                        type="checkbox"
                        checked={isHere}
                        disabled={!!elsewhere}
                        onChange={() => toggleSpell(group.key, e.id, group.count)}
                      />
                      {e.name} <span className="muted">({meta})</span>
                      {elsewhere && <span className="muted"> — выбрано ({elsewhere.label})</span>}
                    </label>
                  );
                })}
                {cands.length === 0 && <span className="muted">Ничего не найдено.</span>}
              </fieldset>
            );
          })}
          {spellShortfall.length > 0 && (
            <span className="muted">
              Чтобы идти дальше: {spellShortfall.map((s) => `${s.group.label} — ещё ${s.missing}`).join("; ")}.
            </span>
          )}
        </div>
      )}

      {step === "Досье" && (
        <div className="stack">
          <label>
            Мировоззрение
            <select value={alignment} onChange={(e) => setAlignment(e.target.value)}>
              <option value="">— мировоззрение —</option>
              {alignment && !alignmentOptions.some((o) => o.name === alignment) && (
                <option value={alignment}>{alignment}</option>
              )}
              {alignmentOptions.map((o) => (
                <option key={o.id} value={o.name}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          {autoLanguages.length > 0 && <span className="muted">От класса: {autoLanguages.join(", ")}</span>}
          <fieldset className="stack wizard-fieldset" style={{ gap: "var(--sp-1)" }}>
            <legend className="muted wizard-legend">Языки — обычные</legend>
            {commonLangs
              .filter((o) => !autoLanguages.includes(o.name))
              .map((o) => (
                <label key={o.id} className="row">
                  <input
                    type="checkbox"
                    checked={chosenLanguages.includes(o.name)}
                    onChange={() => toggleLanguage(o.name)}
                  />
                  {o.name}
                </label>
              ))}
          </fieldset>
          {rareLangs.filter((o) => !autoLanguages.includes(o.name)).length > 0 && (
            <fieldset className="stack wizard-fieldset" style={{ gap: "var(--sp-1)" }}>
              <legend className="muted wizard-legend">Языки — редкие, только с разрешения Мастера</legend>
              {rareLangs
                .filter((o) => !autoLanguages.includes(o.name))
                .map((o) => (
                  <label key={o.id} className="row">
                    <input
                      type="checkbox"
                      checked={chosenLanguages.includes(o.name)}
                      onChange={() => toggleLanguage(o.name)}
                    />
                    {o.name}
                  </label>
                ))}
            </fieldset>
          )}
          {otherLangs.length > 0 && (
            <fieldset className="stack wizard-fieldset" style={{ gap: "var(--sp-1)" }}>
              <legend className="muted wizard-legend">Языки — прочие из справочника</legend>
              {otherLangs.map((o) => (
                <label key={o.id} className="row">
                  <input
                    type="checkbox"
                    checked={chosenLanguages.includes(o.name)}
                    onChange={() => toggleLanguage(o.name)}
                  />
                  {o.name}
                </label>
              ))}
            </fieldset>
          )}
          <label>
            Черты характера
            <textarea
              value={personalityTraits}
              onChange={(e) => setPersonalityTraits(e.target.value)}
              placeholder="Как ведёт себя персонаж"
              rows={2}
              maxLength={500}
            />
          </label>
          <label>
            Идеалы
            <textarea
              value={ideals}
              onChange={(e) => setIdeals(e.target.value)}
              placeholder="Во что верит"
              rows={2}
              maxLength={500}
            />
          </label>
          <label>
            Узы
            <textarea
              value={bonds}
              onChange={(e) => setBonds(e.target.value)}
              placeholder="Кто и что дорого"
              rows={2}
              maxLength={500}
            />
          </label>
          <label>
            Изъяны
            <textarea
              value={flaws}
              onChange={(e) => setFlaws(e.target.value)}
              placeholder="Слабости и пороки"
              rows={2}
              maxLength={500}
            />
          </label>
          <label>
            Заметки
            <textarea
              value={dossierNotes}
              onChange={(e) => setDossierNotes(e.target.value)}
              placeholder="Внешность, биография, прочее"
              rows={2}
              maxLength={1000}
            />
          </label>
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
              <label key={set.label} className="row" style={{ alignItems: "flex-start", gap: "var(--sp-2)" }}>
                <input
                  type="checkbox"
                  checked={setTaken(set.label)}
                  onChange={(e) => setTakenSets({ ...takenSets, [set.label]: e.target.checked })}
                />
                <span className="stack" style={{ gap: "var(--sp-1)" }}>
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
        <>
          {miniSheet()}
          <PosterButtons
            getBlob={() => renderPosterBlob(posterData())}
            fileBase={characterName.trim() || "personazh"}
            shareTitle={characterName.trim() || "Без имени"}
          />
        </>
      )}
      </>
      )}
      </div>
      {step !== "Обзор" && (
        <aside className="wizard-side" aria-label="Живой предпросмотр персонажа">
          {miniSheet()}
        </aside>
      )}
      </div>

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

      {avatarFailed && (
        <div className="row">
          <button className="primary" onClick={finish} disabled={saving}>
            {saving ? "Загружаю…" : "Повторить загрузку фото"}
          </button>
          <button onClick={onDone}>Готово без фото</button>
        </div>
      )}

      {(hadDraft || wizardDirty) && !avatarFailed && (
        <div className="row wizard-spread">
          <span className="muted">
            {hadDraft ? "Восстановлен черновик — можно продолжить с места." : "Есть несохранённый ввод — можно очистить всё."}
          </span>
          <button type="button" onClick={resetWizard}>
            Начать заново
          </button>
        </div>
      )}

      <div className="row wizard-footer wizard-spread">
        <div className="row">
          {/* На время сохранения уход запрещён: finish пишет и зовёт onDone,
              отмена в середине давала setState на размонтированном. */}
          <button onClick={cancelWizard} disabled={saving}>Отмена</button>
          {stepIndex > 0 && <button onClick={back} disabled={saving}>Назад</button>}
        </div>
        {step === "Обзор" ? (
          <button className="primary" onClick={finish} disabled={saving || !pointBuyValid || !characterName.trim() || !skillsComplete || !expertiseComplete || !spellsComplete || !styleComplete || !entryComplete || !weaponComplete || featMissing}>
            {saving ? "Создаю…" : saveError ? "Попробовать ещё раз" : "Создать персонажа"}
          </button>
        ) : (
          <button className="primary" onClick={next} disabled={(step === "Навыки" && (!skillsComplete || !expertiseComplete)) || (step === "Заклинания" && !spellsComplete)}>
            Далее
          </button>
        )}
      </div>
    </div>
    </Modal>
  );
}
