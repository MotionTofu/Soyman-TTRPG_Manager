import { Fragment, useEffect, useRef, useState } from "react";
import { useDndRuntime } from './DndRuntime';
import { selectedStartingSet } from './startingSetChoice';
import { classSpellPicks, wizardBookPicks } from './classSpellPicks';
import { write } from "../../data/hooks";
import { afterWriteAnywhere, readResource } from "../../data/imperative";
import { Modal } from "../Modal";
import { NavIcon } from "../NavIcons";
import type { CompendiumEntry, DndAbilityKey, DndAbilityScores } from "../../types";
import { DndCharacterView, emptyDndCharacter, recomputeGrantedSpells } from "./DndCharacterForm";
import {
  armorProfNames,
  isWeaponProficient,
  EMPTY_EQUIPMENT_ITEM,
  fetchEquipmentMeta,
  isArmorProficient,
  makeEquipmentId,
  startingSetsFrom,
  type StartingSet,
} from "./dndEquipment";
import { isMasterableWeapon, weaponMasteryName } from "./StartingEquipmentPicker";
import { PosterButtons } from "./PosterButtons";
import { renderPosterBlob, type PosterData } from "./CharacterPoster";
import { WizardMiniSheet, type MiniSheetProblem } from "./WizardMiniSheet";
import { type CardOption } from "./DndCards";
import { CardRibbon, CardStage, CUSTOM_CARD_ID, EntryPlate, EntrySheet, PickHead, PickList, SearchField, Sheet, SetDuel, StepStaff, useIsDesktop } from "./wizardUi";
import { MentionText } from "../mentions/MentionText";
import { choicesFromEntries, featuresFromEntries, sumEntrySlots, type ChoiceDef } from "./dndFeatures";
import { cantripsAtLevel, preparedAtLevel, spellSlotsAtLevel, type ClassProgression } from "./progression";
import { useDndSkills } from "./useDndSkills";
import { grantsFromEntry, mergeGrants } from "./dndGrants";
import { FeatChoices } from "./FeatChoices";
import {
  bestMental,
  EMPTY_FEAT_PICK,
  featHitPoints,
  featPickMissing,
  resistanceChoice,
  type FeatCtx,
  type FeatPart,
  type FeatPick,
} from "./featPick";
import type { GrantedSpellChoice, GrantedToolChoice, SourceGrants } from "./dndGrants";
import { nameMatches } from "./dndResources";
import { multiclassPrereqUnmet, multiclassProfs } from "./multiclass";
import { PortraitFrameModal } from "./PortraitFrameModal";
import type { PortraitFocus } from "./portraitFrame";
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
  featFitsClasses,
  loadDndFeatsByCategory,
  loadDndClassFeatures,
  loadDndClassHierarchy,
  loadDndEquipmentEntries,
  loadDndMechanicsGroupEntries,
  loadDndSpeciesChildren,
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
// Мобильный редизайн (гриллинг 2026-09-24, Q5, Q16, Q17): имя и портрет ушли
// в Досье, выборы класса — отдельным шагом сразу за классом, языки — к
// навыкам. Шаги, где выбирать нечего, из пути выпадают (stepVisible).
const STEPS = [
  "Класс",
  "Умения класса",
  "Вид",
  // Драконий предок Драконорождённого (гриллинг 2026-09-25): свой шаг с
  // картами, только если у вида есть записи kind "lineage".
  "Предок",
  "Предыстория",
  "Черта",
  "Характеристики",
  "Навыки и языки",
  "Заклинания",
  "Снаряжение",
  "Досье",
  "Обзор",
] as const;
type Step = (typeof STEPS)[number];
// Черновики до редизайна помнят старые имена шагов.
const LEGACY_STEPS: Record<string, Step> = { Личность: "Досье", Портрет: "Досье", Навыки: "Навыки и языки" };
// По правилам 2024: Общий плюс два языка на выбор.
const LANGUAGE_PICKS = 2;

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
  lineageId?: unknown;
  speciesResist?: unknown;
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
  speciesFeatId?: unknown;
  chosenTools?: unknown;
  setChoicePicks?: unknown;
  abilitiesTouched?: unknown;
  featSel?: unknown;
  extraClasses?: unknown;
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
function draftStep(v: unknown): Step {
  if (isWizardStep(v)) return v;
  return (typeof v === "string" && LEGACY_STEPS[v]) || "Класс";
}
function strList(v: unknown, max = 60): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string").slice(0, max) : [];
}
/** Выбор внутри черты происхождения на слот («feat» — от предыстории, «feat2» — от вида). */
interface WizardFeatSel {
  spellList?: number;
  spellAbility?: DndAbilityKey;
  resistances?: string[];
}
function featSelFrom(v: unknown): Record<string, WizardFeatSel> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, WizardFeatSel> = {};
  for (const slot of ["feat", "feat2"]) {
    const r = (v as Record<string, unknown>)[slot] as Record<string, unknown> | undefined;
    if (!r || typeof r !== "object") continue;
    out[slot] = {
      ...(typeof r.spellList === "number" ? { spellList: r.spellList } : {}),
      ...(r.spellAbility === "int" || r.spellAbility === "wis" || r.spellAbility === "cha" ? { spellAbility: r.spellAbility } : {}),
      resistances: strList(r.resistances, 9),
    };
  }
  return out;
}
/** Второй и следующие классы (гриллинг 2026-09-25, Q15): свой уровень,
 *  подкласс и выборы умений. Навыки, инструменты и заклинания — общими
 *  токенами с ключом строки: mc-<uid> — класс, ms-<uid> — подкласс. */
interface ExtraClassRow {
  uid: string;
  classId: number | null;
  subclassId: number | null;
  level: number;
  style: (number | null)[];
  expertise: string[];
  weapons: { entryId: number; name: string }[];
}
const mcKey = (r: { uid: string }) => `mc-${r.uid}`;
const mcsKey = (r: { uid: string }) => `ms-${r.uid}`;
function extraClassesFrom(v: unknown): ExtraClassRow[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 11).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const o = raw as Record<string, unknown>;
    if (typeof o.uid !== "string" || !o.uid) return [];
    return [
      {
        uid: o.uid,
        classId: numOrNull(o.classId),
        subclassId: numOrNull(o.subclassId),
        level: Math.min(19, Math.max(1, Math.round(numOrNull(o.level) ?? 1))),
        style: Array.isArray(o.style) ? o.style.slice(0, 4).map((x) => (typeof x === "number" ? x : null)) : [],
        expertise: strList(o.expertise, 8),
        weapons: (Array.isArray(o.weapons) ? (o.weapons as unknown[]) : [])
          .filter(
            (w): w is { entryId: number; name: string } =>
              !!w && typeof (w as { entryId?: unknown }).entryId === "number" && typeof (w as { name?: unknown }).name === "string"
          )
          .slice(0, 8),
      },
    ];
  });
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
// Описание выбранной записи компендиума под селектом: предысторию и черту
// вслепую не выбирают. Всегда целиком (владелец, 2026-09-18): «Показать
// полностью» прятало ровно то, ради чего запись выбирают. Экспортирован для
// визарда левелапа (описания черт).
export function EntryBlurb({ text }: { text?: string }) {
  if (!text?.trim()) return null;
  return (
    <div className="muted wizard-blurb">
      <MentionText text={text} />
    </div>
  );
}

function rollAbilityScore(): number {
  const rolls = Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6));
  rolls.sort((a, b) => a - b);
  return rolls[1] + rolls[2] + rolls[3];
}

// Раскладка стандартного массива под класс (Q7): таблица PHB 2024 из
// справочника (`standard_array`, миграция dndWizardData). Нет таблицы —
// основная характеристика класса получает 15, дальше ТЕЛ, ЛОВ, МДР…
const FALLBACK_ORDER: (keyof DndAbilityScores)[] = ["con", "dex", "wis", "int", "cha", "str"];
function classStandardArray(entry: CompendiumEntry | null): DndAbilityScores | null {
  if (!entry) return null;
  const keys = Object.keys(emptyAbilities()) as (keyof DndAbilityScores)[];
  const raw = entry.data.standard_array as Record<string, unknown> | undefined;
  const a = emptyAbilities();
  if (raw && keys.every((k) => typeof raw[k] === "number")) {
    for (const k of keys) a[k] = raw[k] as number;
    return a;
  }
  const primary = parseAbilityNames(entry.data.primary_abilities);
  if (primary.length === 0) return null;
  const order = [...new Set([...primary, ...FALLBACK_ORDER])];
  order.forEach((k, i) => (a[k] = STANDARD_ARRAY[i]));
  return a;
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
  // OneShot opts into its own visual layer without changing the shared wizard.
  visualVariant?: "oneshot";
}

// Guided step-by-step creation for a brand-new D&D 5.5 character statblock —
// used only when adding a fresh dnd_character (see StatblockList's addStatblock).
// Leveling up / editing an existing character stays in the regular
// DndCharacterEdit form; this wizard is a one-time onboarding path only.
export function DndCharacterWizard({ ownerType, ownerId, ownerName, ownerPlayerName, onDone, onCancel, initialSystemId, ownerPortraitUrl, visualVariant }: Props) {
  const { allowDiceRolls } = useDndRuntime();
  const draftKey = wizardDraftKey(ownerType, ownerId);
  // Читается один раз при монтировании — поэтому сбросы протухших выборов
  // в обработчиках ниже не видят «смену» при восстановлении черновика.
  const [savedDraft] = useState<WizardDraftV1 | null>(() => loadWizardDraft(draftKey));
  const [hadDraft, setHadDraft] = useState(() => savedDraft !== null);
  const [step, setStep] = useState<Step>(() => draftStep(savedDraft?.step));
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
  // Мультикласс (гриллинг 2026-09-25, Q15): строки второго и следующих
  // классов. Стартовый — classId/subclassId/level выше: он даёт спасброски,
  // полные владения и снаряжение.
  const [extraClasses, setExtraClasses] = useState<ExtraClassRow[]>(() => extraClassesFrom(savedDraft?.extraClasses));
  // Строка, к которой привязан выбор карты на шаге «Класс»: 0 — стартовый.
  const [activeRow, setActiveRow] = useState(0);
  const extraLevels = extraClasses.reduce((n, r) => n + r.level, 0);
  const totalLevel = level + extraLevels;
  function patchExtra(uid: string, patch: Partial<ExtraClassRow>) {
    setExtraClasses((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
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
  // Дети вида: умения (сопротивление на выбор у Возрождённого) и предки.
  const [speciesChildren, setSpeciesChildren] = useState<CompendiumEntry[]>([]);
  const [lineageId, setLineageId] = useState<number | null>(() => numOrNull(savedDraft?.lineageId));
  const [speciesResist, setSpeciesResist] = useState<string[]>(() =>
    Array.isArray(savedDraft?.speciesResist) ? savedDraft.speciesResist.filter((x): x is string => typeof x === "string") : []
  );
  const lineageOptions: CardOption[] = speciesChildren
    .filter((e) => e.kind === "lineage")
    .sort((a, b) => a.position - b.position)
    .map((e) => ({ id: e.id, name: e.name, card: e.avatar_image_url ?? null }));
  const resistFeature = speciesChildren.find((e) => e.kind === "feature" && resistanceChoice(e));
  const speciesResistChoice = resistFeature ? resistanceChoice(resistFeature) : null;

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
  // Кадр портрета — то же окно, что в листе (гриллинг 2026-09-25, Q5):
  // копия портретной зоны карты этого устройства вместо квадратной обрезки.
  const [portraitFrame, setPortraitFrame] = useState<{ focus: PortraitFocus; zoom: number } | null>(null);
  const [framing, setFraming] = useState<{ src: string; file?: File } | null>(null);
  function closeFraming() {
    if (framing?.file) URL.revokeObjectURL(framing.src);
    setFraming(null);
  }
  function startFraming(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPortraitError("Можно загружать только изображения");
      return;
    }
    setFraming({ src: URL.createObjectURL(file), file });
  }
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
      startFraming(new File([blob], "portrait", { type: blob.type }));
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
  // Вторая черта происхождения — от вида («Универсальность» Человека):
  // своя, не делит слот с чертой предыстории.
  const [speciesFeatId, setSpeciesFeatId] = useState<number | null>(() => numOrNull(savedDraft?.speciesFeatId));
  const [speciesFeatEntry, setSpeciesFeatEntry] = useState<CompendiumEntry | null>(null);
  // Выбор внутри черт происхождения (гриллинг черт 2026-09-24): список и
  // характеристика «Посвящённого», сопротивление «Портального странника».
  // Характеристика пустая — «самая высокая» на момент создания (Q2).
  const [featSel, setFeatSel] = useState<Record<string, WizardFeatSel>>(() => featSelFrom(savedDraft?.featSel));
  // Инструменты «на ваш выбор» (Q10): «источник:id записи», как навыки.
  const [chosenTools, setChosenTools] = useState<string[]>(() => strList(savedDraft?.chosenTools));
  // Выборы внутри стартового набора: «метка набора#номер выбора» → id предметов.
  const [setChoicePicks, setSetChoicePicks] = useState<Record<string, number[]>>(() => {
    const d = savedDraft?.setChoicePicks;
    if (!d || typeof d !== "object") return {};
    const next: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
      if (Array.isArray(v)) next[k] = v.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    }
    return next;
  });

  // Прибавка от предыстории: либо +2 одной и +1 другой, либо +1 каждой из
  // трёх (решение W5).
  const [awardMode, setAwardMode] = useState<"2+1" | "1+1+1">(() =>
    savedDraft?.awardMode === "1+1+1" ? "1+1+1" : "2+1"
  );
  const [awardPrimary, setAwardPrimary] = useState<string | null>(() => strOrNull(savedDraft?.awardPrimary));
  const [awardSecondary, setAwardSecondary] = useState<string | null>(() => strOrNull(savedDraft?.awardSecondary));

  // Сохраняем прежний формат черновика; ниже выбираем ровно одну
  // альтернативу из каждого источника, в том числе в старых черновиках.
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
    savedDraft?.method === "pointbuy" || (allowDiceRolls && savedDraft?.method === "roll") || savedDraft?.method === "manual"
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
  // Игрок переставлял характеристики руками — смена класса раскладку не трогает
  // (Q7). Без касания массив ложится по таблице класса.
  const [abilitiesTouched, setAbilitiesTouched] = useState(() => savedDraft?.abilitiesTouched === true);
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
    step !== "Класс" ||
    extraClasses.length > 0 ||
    speciesFeatId !== null ||
    chosenTools.length > 0 ||
    Object.values(setChoicePicks).some((a) => a.length > 0) ||
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
      lineageId,
      speciesResist,
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
      speciesFeatId,
      chosenTools,
      setChoicePicks,
      abilitiesTouched,
      featSel,
      extraClasses,
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
    lineageId,
    speciesResist,
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
    speciesFeatId,
    chosenTools,
    setChoicePicks,
    abilitiesTouched,
    featSel,
    extraClasses,
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
  useEffect(() => {
    setSpeciesChildren([]);
    if (!speciesId || !systemId) return;
    let alive = true;
    loadDndSpeciesChildren(systemId, speciesId)
      .then((list) => {
        if (alive) setSpeciesChildren(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [speciesId, systemId]);

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
    setAbilitiesTouched(true);
  }

  function applyMethod(next: AbilityMethod) {
    if (next === 'roll' && !allowDiceRolls) return;
    setMethod(next);
    if (next === "standard") {
      setRolledPool(STANDARD_ARRAY);
      const keys = Object.keys(abilities) as (keyof DndAbilityScores)[];
      const a = classStandardArray(classEntry) ?? emptyAbilities();
      if (!classStandardArray(classEntry)) keys.forEach((k, i) => (a[k] = STANDARD_ARRAY[i]));
      setAbilities(a);
      setAbilitiesTouched(false);
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
    if (!allowDiceRolls) return;
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

  // Класс сменился, а игрок массив не трогал — раскладка идёт за классом.
  useEffect(() => {
    if (method !== "standard" || abilitiesTouched) return;
    const a = classStandardArray(classEntry);
    if (a) setAbilities(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classEntry]);

  const classOption = hierarchy.classes.find((c) => c.id === classId);
  const subclassOptions = classId ? hierarchy.subclassesByClass[classId] ?? [] : [];
  // Подкласс доступен с уровня класса (subclass_level, у монаха 3): карточка
  // этот порог знает, а визард раньше отдавал подкласс уже на 1–2 уровне.
  const subclassLocked = (classOption?.subclassLevel ?? 0) > level;
  useEffect(() => {
    if (subclassLocked) setSubclassId((prev) => (prev == null ? prev : null));
  }, [subclassLocked]);

  function pickClass(id: number | null) {
    setClassId(id);
    setSubclassId(null);
    setChosenStyle([]);
    setChosenEntries({});
    setChosenExpertise([]);
    setMasteredWeapons([]);
    setChosenSkills((prev) => prev.filter((t) => !t.startsWith("class:")));
    setChosenSpells((prev) => prev.filter((t) => !t.startsWith("spell:class:") && !t.startsWith("spell:subclass:")));
  }
  function pickSubclass(id: number | null) {
    setSubclassId(id);
    setChosenSkills((prev) => prev.filter((t) => !t.startsWith("subclass:")));
    setChosenSpells((prev) => prev.filter((t) => !t.startsWith("spell:subclass:")));
    setChosenEntries((prev) => {
      const drop = new Set((choiceDefs ?? []).filter((d) => !d.fromClass && d.kind === "entry").map((d) => d.key));
      if (drop.size === 0) return prev;
      const next = { ...prev };
      let changed = false;
      for (const k of drop) if (k in next) { delete next[k]; changed = true; }
      return changed ? next : prev;
    });
  }
  function pickSpecies(id: number | "custom") {
    if (id === "custom") {
      setSpeciesId(null);
      setSpeciesCustom((prev) => prev ?? "");
    } else {
      setSpeciesId(id);
      setSpeciesCustom(null);
    }
    setChosenSkills((prev) => prev.filter((t) => !t.startsWith("species:")));
    setChosenSpells((prev) => prev.filter((t) => !t.startsWith("spell:species:")));
    setLineageId(null);
    setSpeciesResist([]);
  }
  function pickSpeciesFeat(id: number | null) {
    setSpeciesFeatId(id);
    setFeatSel((prev) => ({ ...prev, feat2: {} }));
    setChosenSkills((prev) => prev.filter((t) => !t.startsWith("feat2:")));
    setChosenSpells((prev) => prev.filter((t) => !t.startsWith("spell:feat2:")));
    setChosenTools((prev) => prev.filter((t) => !t.startsWith("feat2:")));
  }
  function pickBackgroundFeat(id: number | null) {
    setFeatTouched(true);
    setFeatId(id);
    setFeatSel((prev) => ({ ...prev, feat: {} }));
    setChosenSkills((prev) => prev.filter((t) => !t.startsWith("feat:")));
    setChosenSpells((prev) => prev.filter((t) => !t.startsWith("spell:feat:")));
    setChosenTools((prev) => prev.filter((t) => !t.startsWith("feat:")));
  }
  const subLockNote = `с ${classOption?.subclassLevel ?? 0} ур.`;
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
  const equipmentGroups = [
    startingSetsFrom(classEntry ?? undefined, classOption?.name ?? "Класс"),
    startingSetsFrom(backgroundEntry ?? undefined, backgroundEntry?.name ?? "Предыстория"),
  ];
  const startingSets: StartingSet[] = equipmentGroups.flat();
  const setTaken = (label: string) => equipmentGroups.some(group => selectedStartingSet(group, takenSets)?.label === label);
  function chooseStartingSet(label: string) {
    const group = equipmentGroups.find(group => group.some(set => set.label === label));
    if (!group) return;
    setTakenSets(previous => ({ ...previous, ...Object.fromEntries(group.map(set => [set.label, set.label === label])) }));
  }
  // Класс или предыстория выбраны, а их запись ещё не приехала — набора
  // просто ещё нет, и это не то же самое, что «набора нет в справочнике».
  const setsStillLoading = (!!classId && !classEntry) || (!!backgroundId && !backgroundEntry);
  const takenSummary = startingSets
    .filter((s) => setTaken(s.label))
    .reduce(
      (acc, s) => ({
        items: acc.items + s.items.length + s.manual.length + s.choices.reduce((n, c) => n + c.count, 0),
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
    const gone = (id: number | null) => hierarchy.classes.length > 0 && id != null && !hierarchy.classes.some((c) => c.id === id);
    if (extraClasses.some((r) => gone(r.classId))) {
      setExtraClasses((prev) => prev.map((r) => (gone(r.classId) ? { ...r, classId: null, subclassId: null } : r)));
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
  const featNeeded = !!backgroundId || backgroundCustom !== null || speciesCustom !== null;
  // Вторая черта — от вида, который даёт её выбрать («Универсальность»).
  // Раньше вид и предыстория делили один слот, и Человек терял черту.
  const speciesFeatNeeded = speciesGrants.originFeatChoice;
  const effectiveSpeciesFeatId = speciesFeatNeeded ? speciesFeatId : null;

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

  useEffect(() => {
    if (!effectiveSpeciesFeatId) {
      setSpeciesFeatEntry(null);
      return;
    }
    const ac = new AbortController();
    readResource<CompendiumEntry>(`/systems/entries/${effectiveSpeciesFeatId}`)
      .then((entry) => {
        if (!ac.signal.aborted) setSpeciesFeatEntry(entry);
      })
      .catch((e) => {
        if (!ac.signal.aborted && !isAbortError(e)) setLoadError(errorMessage(e));
      });
    return () => ac.abort();
  }, [effectiveSpeciesFeatId]);
  const speciesFeatGrants = grantsFromEntry(speciesFeatEntry ?? undefined, resolveSkill);

  // Список «Посвящённого» у Послушника, Мудреца и Путешественника закреплён
  // предысторией (PHB 2024) — пока черта та самая, что она предлагает.
  const fixedFeatList =
    effectiveFeatId != null && effectiveFeatId === suggestedFeatId && typeof backgroundEntry?.data.origin_feat_list === "number"
      ? (backgroundEntry.data.origin_feat_list as number)
      : undefined;
  const fixedListName = hierarchy.classes.find((c) => c.id === fixedFeatList)?.name;
  const slotList = (slot: "feat" | "feat2"): number | undefined =>
    slot === "feat" ? fixedFeatList ?? featSel.feat?.spellList : featSel.feat2?.spellList;
  const slotAbility = (slot: "feat" | "feat2"): DndAbilityKey => featSel[slot]?.spellAbility ?? bestMental(awardedAbilities);
  const slotGrants = (slot: "feat" | "feat2") => (slot === "feat" ? featGrants : speciesFeatGrants);
  const slotEntry = (slot: "feat" | "feat2") => (slot === "feat" ? featEntry : speciesFeatEntry);
  // Второй «Посвящённый» — с другим списком (Q5): занятое другим слотом.
  const slotTaken = (slot: "feat" | "feat2"): number[] => {
    const other = slot === "feat" ? "feat2" : "feat";
    const same = slotEntry(slot) && slotEntry(other) && slotEntry(slot)!.id === slotEntry(other)!.id;
    const l = slotList(other);
    return same && l != null ? [l] : [];
  };
  const slotPick = (slot: "feat" | "feat2"): FeatPick => ({
    ...EMPTY_FEAT_PICK,
    spellList: slotList(slot),
    spellAbility: slotAbility(slot),
    resistances: featSel[slot]?.resistances ?? [],
  });
  const slotCtx = (slot: "feat" | "feat2"): FeatCtx => ({
    abilities: awardedAbilities,
    saves: emptySavingThrowProfs(),
    skills: {},
    pb: 2,
    takenLists: slotTaken(slot),
    knownSpellIds: [],
    masteredNames: [],
    profNames: [],
  });
  const WIZARD_FEAT_PARTS: FeatPart[] = ["spellList", "spellAbility", "resist"];
  const slotMissing = (slot: "feat" | "feat2"): string[] => {
    const g = slotGrants(slot);
    const entry = slotEntry(slot);
    if (!entry) return [];
    const miss = featPickMissing(entry, g, slotPick(slot), slotCtx(slot), WIZARD_FEAT_PARTS);
    const l = slotList(slot);
    if (l != null && slotTaken(slot).includes(l)) miss.push("другой список (этот уже у первой черты)");
    return miss;
  };
  const featChoicesFor = (slot: "feat" | "feat2") => {
    const entry = slotEntry(slot);
    if (!entry) return undefined;
    const list = slotList(slot);
    return {
      ...(list != null ? { spellList: list } : {}),
      ...(slotGrants(slot).spellAbilityChoice ? { spellAbility: slotAbility(slot) } : {}),
      ...(featSel[slot]?.resistances?.length ? { resistances: featSel[slot]!.resistances } : {}),
    };
  };

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

  // Строки мультикласса: записи классов/подклассов и определения выборов —
  // кэшем по id (строк немного, класс дважды не берётся).
  const [rowEntries, setRowEntries] = useState<Record<number, CompendiumEntry>>({});
  const [rowDefs, setRowDefs] = useState<Record<number, ChoiceDef[]>>({});
  const extraIdsKey = extraClasses
    .flatMap((r) => [r.classId != null ? `c${r.classId}` : "", r.subclassId != null ? `s${r.subclassId}` : ""])
    .filter(Boolean)
    .join("|");
  useEffect(() => {
    if (!systemId || !extraIdsKey) return;
    const ac = new AbortController();
    for (const tok of extraIdsKey.split("|")) {
      const id = Number(tok.slice(1));
      if (!rowEntries[id]) {
        readResource<CompendiumEntry>(`/systems/entries/${id}`)
          .then((e) => {
            if (!ac.signal.aborted) setRowEntries((p) => ({ ...p, [id]: e }));
          })
          .catch((e) => {
            if (!ac.signal.aborted && !isAbortError(e)) setLoadError(errorMessage(e));
          });
      }
      if (!rowDefs[id]) {
        loadDndClassFeatures(systemId, id, { signal: ac.signal })
          .then((es) => {
            if (!ac.signal.aborted) setRowDefs((p) => ({ ...p, [id]: choicesFromEntries(es, tok[0] === "c") }));
          })
          .catch((e) => {
            // Как у стартового: выборы — улучшение, а не гейт.
            if (!isAbortError(e)) setRowDefs((p) => ({ ...p, [id]: [] }));
          });
      }
    }
    return () => ac.abort();
    // Кэши читаются как «уже есть» — зависимость по ключу строк.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, extraIdsKey]);
  const extraModels = extraClasses.map((r) => {
    const opt = hierarchy.classes.find((c) => c.id === r.classId);
    const entry = r.classId != null ? rowEntries[r.classId] : undefined;
    const subEntry = r.subclassId != null ? rowEntries[r.subclassId] : undefined;
    const defs = [...(r.classId != null ? rowDefs[r.classId] ?? [] : []), ...(r.subclassId != null ? rowDefs[r.subclassId] ?? [] : [])];
    const upTo = (kind: string) => defs.filter((d) => d.kind === kind && d.minLevel <= r.level);
    return {
      row: r,
      opt,
      entry,
      subEntry,
      subOptions: r.classId != null ? hierarchy.subclassesByClass[r.classId] ?? [] : [],
      subLocked: (opt?.subclassLevel ?? 0) > r.level,
      defs,
      defsLoaded: r.classId == null || (r.classId in rowDefs && (r.subclassId == null || r.subclassId in rowDefs)),
      styleSlots: upTo("feat").flatMap((d) => Array<ChoiceDef>(d.count).fill(d)),
      // Ключи приёмов — со строкой: группа у двух классов может совпасть.
      entrySlots: sumEntrySlots(
        defs.filter((d) => d.kind === "entry" && d.group).map((d) => ({ def: { ...d, key: `${mcKey(r)}|${d.key}` }, level: r.level }))
      ),
      weaponSlots: upTo("weapon").reduce((n, d) => n + d.count, 0),
      expertiseSlots: upTo("skill").reduce((n, d) => n + d.count, 0),
      grants: grantsFromEntry(entry, resolveSkill),
      subGrants: grantsFromEntry(subEntry, resolveSkill),
      mc: multiclassProfs(entry?.data),
    };
  });
  type ExtraModel = (typeof extraModels)[number];
  // Чистка выборов строки: токены навыков/инструментов «ключ:…»,
  // заклинаний «spell:ключ:…», приёмы — ключом «mc-uid|…».
  function purgeRow(keys: string[], entryPrefix?: string) {
    const hit = (t: string) => keys.some((k) => t.startsWith(`${k}:`) || t.startsWith(`spell:${k}:`));
    setChosenSkills((prev) => prev.filter((t) => !hit(t)));
    setChosenSpells((prev) => prev.filter((t) => !hit(t)));
    setChosenTools((prev) => prev.filter((t) => !hit(t)));
    if (entryPrefix) setChosenEntries((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(entryPrefix))));
  }
  function addExtraClass() {
    const uid = Math.random().toString(36).slice(2, 8);
    setExtraClasses((prev) => [...prev, { uid, classId: null, subclassId: null, level: 1, style: [], expertise: [], weapons: [] }]);
    setActiveRow(extraClasses.length + 1);
    setLevelText(null);
  }
  function removeExtraClass(r: ExtraClassRow) {
    purgeRow([mcKey(r), mcsKey(r)], `${mcKey(r)}|`);
    setExtraClasses((prev) => prev.filter((x) => x.uid !== r.uid));
    setActiveRow(0);
    setLevelText(null);
  }
  function pickExtraClass(r: ExtraClassRow, id: number) {
    purgeRow([mcKey(r), mcsKey(r)], `${mcKey(r)}|`);
    patchExtra(r.uid, { classId: id, subclassId: null, style: [], expertise: [], weapons: [] });
  }
  function pickExtraSubclass(r: ExtraClassRow, id: number | null) {
    purgeRow([mcsKey(r)]);
    // Приёмы подкласса уходят вместе с ним — как у стартового (pickSubclass).
    const drop = new Set((r.subclassId != null ? rowDefs[r.subclassId] ?? [] : []).map((d) => `${mcKey(r)}|${d.key}`));
    if (drop.size > 0) setChosenEntries((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !drop.has(k))));
    patchExtra(r.uid, { subclassId: id });
  }
  function setExtraLevel(m: ExtraModel, n: number) {
    if ((m.opt?.subclassLevel ?? 0) > n && m.row.subclassId != null) pickExtraSubclass(m.row, null);
    patchExtra(m.row.uid, { level: n });
  }

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
  const entryGroupsKey = [...new Set([...(choiceDefs ?? []), ...extraModels.flatMap((m) => m.defs)].filter((d) => d.kind === "entry").map((d) => d.group ?? "").filter(Boolean))].sort().join("|");
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
      if (limit === 1) return { ...prev, [key]: [id] };
      if (cur.length >= limit) return prev;
      return { ...prev, [key]: [...cur, id] };
    });
  }
  // Недобор — честный гейт с тем же антитупиком: нет каталога — нет гейта.
  const entryShortfall = [...entrySlots, ...extraModels.flatMap((m) => m.entrySlots)]
    .map((s) => {
      const picked = (chosenEntries[s.key] ?? []).length;
      const available = entryCatalog[s.group]?.length ?? 0;
      return { ...s, picked, missing: Math.max(0, Math.min(s.total, available) - picked) };
    })
    .filter((s) => s.missing > 0);

  const [weaponCatalog, setWeaponCatalog] = useState<CompendiumEntry[] | null>(null);
  // Инструменты с разметкой `tool_kind` (миграция dndWizardData): из них
  // выбирается «музыкальный инструмент на ваш выбор».
  const [toolCatalog, setToolCatalog] = useState<CompendiumEntry[]>([]);
  useEffect(() => {
    if (!systemId) {
      setWeaponCatalog(null);
      return;
    }
    const ac = new AbortController();
    loadDndEquipmentEntries(systemId, { signal: ac.signal })
      .then((rows) => {
        setWeaponCatalog(rows.filter(isMasterableWeapon));
        setToolCatalog(rows.filter((r) => typeof r.data.tool_kind === "string"));
      })
      .catch(() => {
        setWeaponCatalog([]);
      });
    return () => ac.abort();
  }, [systemId]);

  // Выборы инструментов по источникам — как навыки: у каждого своя квота.
  // Группа «А|Б» — выбор из двух видов (Монах: ремесленные или музыкальные).
  interface ToolGroup {
    key: string;
    label: string;
    group: string;
    count: number;
    options: CompendiumEntry[];
  }
  const toolSources: [string, string, GrantedToolChoice | null][] = [
    ["class", `От класса${classOption ? ` (${classOption.name})` : ""}`, classGrants.toolChoice],
    ["subclass", `От подкласса${subclassEntry ? ` (${subclassEntry.name})` : ""}`, subclassGrants.toolChoice],
    ["background", `От предыстории${backgroundEntry ? ` (${backgroundEntry.name})` : ""}`, backgroundGrants.toolChoice],
    ["feat", `От черты${featEntry ? ` (${featEntry.name})` : ""}`, featGrants.toolChoice],
    ["feat2", `От черты вида${speciesFeatEntry ? ` (${speciesFeatEntry.name})` : ""}`, speciesFeatGrants.toolChoice],
    // Мультикласс: урезанный выбор класса (инструмент Барда) и подкласс строки.
    ...extraModels.flatMap((m): [string, string, GrantedToolChoice | null][] => [
      [mcKey(m.row), `Мультикласс (${m.opt?.name ?? "класс"})`, m.mc?.toolChoice ?? null],
      [mcsKey(m.row), `От подкласса${m.subEntry ? ` (${m.subEntry.name})` : ""}`, m.subGrants.toolChoice],
    ]),
  ];
  const toolGroups: ToolGroup[] = toolSources.flatMap(([key, label, tc]) => {
    if (!tc) return [];
    const kinds = tc.group.split("|").map((k) => k.trim()).filter(Boolean);
    const options = toolCatalog.filter((e) => kinds.length === 0 || kinds.includes(String(e.data.tool_kind)));
    return [{ key, label, group: tc.group.replace("|", " или "), count: tc.count, options }];
  });
  const chosenToolsIn = (key: string) =>
    chosenTools.filter((t) => t.startsWith(`${key}:`)).map((t) => Number(t.slice(t.indexOf(":") + 1)));
  function toggleTool(key: string, id: number, limit: number) {
    const token = `${key}:${id}`;
    setChosenTools((prev) => {
      if (prev.includes(token)) return prev.filter((t) => t !== token);
      const mine = prev.filter((t) => t.startsWith(`${key}:`));
      // Квота 1 — тап по другому меняет выбор, а не упирается в лимит.
      if (limit === 1) return [...prev.filter((t) => !t.startsWith(`${key}:`)), token];
      return mine.length < limit ? [...prev, token] : prev;
    });
  }
  // Выборы внутри взятых наборов («музыкальный инструмент по вашему
  // выбору»). «Тот, владение которым выбрали» берётся из выбранных владений
  // того же вида — и подставляется сам, если выбирать уже нечего.
  interface SetChoiceSlot {
    key: string;
    setLabel: string;
    label: string;
    count: number;
    options: CompendiumEntry[];
    auto: boolean;
  }
  const chosenToolIds = new Set(chosenTools.map((t) => Number(t.slice(t.indexOf(":") + 1))));
  const setChoiceSlots: SetChoiceSlot[] = startingSets
    .filter((set) => setTaken(set.label))
    .flatMap((set) =>
      set.choices.map((c, i) => {
        const kinds = c.group.split("|").map((k) => k.trim());
        const all = toolCatalog.filter((e) => kinds.includes(String(e.data.tool_kind)));
        const own = c.fromProficiency ? all.filter((e) => chosenToolIds.has(e.id)) : [];
        return {
          key: `${set.label}#${i}`,
          setLabel: set.label,
          label: kinds.join(" или ").toLowerCase(),
          count: c.count,
          options: own.length > 0 ? own : all,
          auto: own.length > 0 && own.length <= c.count,
        };
      })
    );
  const setChoicePicked = (slot: SetChoiceSlot) =>
    slot.auto
      ? slot.options.map((o) => o.id)
      : (setChoicePicks[slot.key] ?? []).filter((id) => slot.options.some((o) => o.id === id));
  function toggleSetChoice(slot: SetChoiceSlot, id: number) {
    setSetChoicePicks((prev) => {
      const cur = (prev[slot.key] ?? []).filter((x) => slot.options.some((o) => o.id === x));
      if (cur.includes(id)) return { ...prev, [slot.key]: cur.filter((x) => x !== id) };
      if (slot.count === 1) return { ...prev, [slot.key]: [id] };
      return cur.length < slot.count ? { ...prev, [slot.key]: [...cur, id] } : prev;
    });
  }
  const setChoiceMissing = setChoiceSlots.filter(
    (sl) => sl.options.length > 0 && setChoicePicked(sl).length < Math.min(sl.count, sl.options.length)
  );

  const toolMissing = (keys: string[]) =>
    toolGroups
      .filter((g) => keys.includes(g.key))
      .map((g) => ({ g, missing: Math.max(0, Math.min(g.count, g.options.length) - chosenToolsIn(g.key).length) }))
      .filter((x) => x.missing > 0);
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

  // Экспертность из выборов умений (deft_explorer_expertise следопыта 2 ур.,
  // ranger_expertise 9 ур.): слоты суммой count открытых уровнем дефов.
  // Список навыков — ниже, после навыков шага (expertiseOptions).
  const expertiseSlots = (choiceDefs ?? [])
    .filter((d) => d.kind === "skill" && d.minLevel <= level)
    .reduce((n, d) => n + d.count, 0);
  // Недобор строк мультикласса — тем же антитупиком, что у стартового.
  const extraMissing = (m: ExtraModel) => ({
    style: m.defsLoaded ? m.styleSlots.filter((_, i) => m.row.style[i] == null).length : 0,
    weapons: !m.defsLoaded || weaponCatalog == null ? 0 : Math.max(0, Math.min(m.weaponSlots, weaponCatalog.length) - m.row.weapons.length),
    expertise: m.defsLoaded ? Math.max(0, Math.min(m.expertiseSlots, rowExpertiseOpts(m).length) - rowExpertise(m).length) : 0,
  });

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
  if (speciesFeatGrants.skillChoice) {
    skillGroups.push({
      key: "feat2",
      label: `От черты вида${speciesFeatEntry ? ` (${speciesFeatEntry.name})` : ""}`,
      count: speciesFeatGrants.skillChoice.count,
      options: speciesFeatGrants.skillChoice.options,
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
  for (const m of extraModels) {
    // Урезанный выбор мультикласса (PHB 2024): 1 навык у Барда (любой),
    // Следопыта и Плута (из списка класса); у остальных — ничего.
    if (m.mc && m.mc.skillCount > 0) {
      skillGroups.push({
        key: mcKey(m.row),
        label: `По мультиклассу (${m.opt?.name ?? "класс"})`,
        count: m.mc.skillCount,
        options: m.mc.skillAny ? [] : m.grants.skillChoice?.options ?? [],
      });
    }
    if (m.subGrants.skillChoice) {
      skillGroups.push({
        key: mcsKey(m.row),
        label: `От подкласса${m.subEntry ? ` (${m.subEntry.name})` : ""}`,
        count: m.subGrants.skillChoice.count,
        options: m.subGrants.skillChoice.options,
      });
    }
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
  const grantedSkills = new Set([...backgroundSkills, ...classGrants.skills, ...subclassGrants.skills, ...speciesGrants.skills, ...featGrants.skills, ...speciesFeatGrants.skills, ...extraModels.flatMap((m) => [...m.grants.skills, ...m.subGrants.skills])]);

  // Ключ выбора — «источник:навык», чтобы один навык, выбранный по двум
  // источникам, не схлопнулся в одну отметку и не сбил счётчики.
  function toggleSkill(groupKey: string, name: string, limit: number) {
    const token = `${groupKey}:${name}`;
    setChosenSkills((prev) => {
      if (prev.includes(token)) return prev.filter((s) => s !== token);
      if (limit === 1) return [...prev.filter((s) => !s.startsWith(`${groupKey}:`)), token];
      const used = prev.filter((s) => s.startsWith(`${groupKey}:`)).length;
      return used < limit ? [...prev, token] : prev;
    });
  }
  const chosenIn = (groupKey: string) => chosenSkills.filter((s) => s.startsWith(`${groupKey}:`));
  /** Выбранные навыки без пометки источника — то, что реально ляжет на лист. */
  const chosenSkillKeys = [...new Set(chosenSkills.map((s) => s.slice(s.indexOf(":") + 1)))];

  // Экспертность — только в навыке, которым персонаж владеет (выдан или
  // выбран на этом же шаге), и из списка дефа, если он задан («Учёный»
  // волшебника). Пик, потерявший владение, в зачёт и на лист не идёт.
  const ownedSkills = new Set([...grantedSkills, ...chosenSkillKeys]);
  function expertiseOptions(defs: ChoiceDef[], lvl: number): string[] {
    const lists = defs.filter((d) => d.kind === "skill" && d.minLevel <= lvl).map((d) => d.options ?? []);
    const allow = lists.length > 0 && lists.every((l) => l.length > 0) ? new Set(lists.flat().map((n) => resolveSkill(n) ?? n)) : null;
    return allSkillKeys.filter((k) => ownedSkills.has(k) && (!allow || allow.has(k)));
  }
  const expertiseOpts = expertiseOptions(choiceDefs ?? [], level);
  const validExpertise = chosenExpertise.filter((k) => expertiseOpts.includes(k));
  function toggleExpertise(key: string) {
    setChosenExpertise((prev) => {
      const valid = prev.filter((k) => expertiseOpts.includes(k));
      if (valid.includes(key)) return valid.filter((s) => s !== key);
      return valid.length < expertiseSlots ? [...valid, key] : valid;
    });
  }
  const expertiseMissing =
    choiceDefs == null ? 0 : Math.max(0, Math.min(expertiseSlots, expertiseOpts.length) - validExpertise.length);
  function rowExpertiseOpts(m: ExtraModel): string[] {
    return expertiseOptions(m.defs, m.row.level);
  }
  function rowExpertise(m: ExtraModel): string[] {
    const opts = rowExpertiseOpts(m);
    return m.row.expertise.filter((k) => opts.includes(k));
  }

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
    const cn = [classOption?.name, ...extraModels.map((m) => m.opt?.name)].join(" ").toLowerCase();
    if (cn.includes("плут") || cn.includes("rogue")) autoLanguages.push("Воровской жаргон");
    if (cn.includes("друид") || cn.includes("druid")) autoLanguages.push("Друидический");
  }
  function toggleLanguage(name: string) {
    setChosenLanguages((prev) => (prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name]));
  }
  const dossierLangNames = [...new Set(["Общий", ...chosenLanguages, ...autoLanguages])];

  // Прибавка от предыстории. Три характеристики предлагает сама предыстория
  // (`abilities`), а как их разложить — выбор игрока. Свой вариант списка
  // не несёт — разрешены любые (договор с Мастером, Хвосты 2.1).
  const awardOptions =
    backgroundCustom !== null && backgroundCustom.trim() !== ""
      ? Object.keys(ABILITY_NAME_TO_KEY)
      : backgroundGrants.abilityOptions;
  // По умолчанию +2 и +1 — в самые важные для класса из предложенных (Q7):
  // порядок — по раскладке массива класса, без класса — как в предыстории.
  const classArray = classStandardArray(classEntry);
  const awardByPriority = classArray
    ? [...awardOptions].sort(
        (a, b) => (classArray[ABILITY_NAME_TO_KEY[b]] ?? 0) - (classArray[ABILITY_NAME_TO_KEY[a]] ?? 0)
      )
    : awardOptions;
  const effectiveAwardPrimary =
    awardPrimary && awardOptions.includes(awardPrimary) ? awardPrimary : awardByPriority[0] ?? null;
  const effectiveAwardSecondary =
    awardSecondary && awardSecondary !== effectiveAwardPrimary && awardOptions.includes(awardSecondary)
      ? awardSecondary
      : awardByPriority.find((a) => a !== effectiveAwardPrimary) ?? null;
  const abilityAward: Partial<Record<keyof DndAbilityScores, number>> = {};
  if (awardOptions.length > 0) {
    if (awardMode === "1+1+1") {
      for (const name of awardOptions) {
        const key = ABILITY_NAME_TO_KEY[name];
        if (key) abilityAward[key] = (abilityAward[key] ?? 0) + 1;
      }
    } else {
      const primary = effectiveAwardPrimary;
      const secondary = effectiveAwardSecondary;
      const pk = primary ? ABILITY_NAME_TO_KEY[primary] : null;
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
    dailyPreparation?: boolean;
    bookAcquisition?: boolean;
    fromBook?: boolean;
    /** Своя заклинательная характеристика выбранных (стиль Паладина — Хар). */
    ability?: DndAbilityKey;
    /** Раз в долгий отдых без ячейки (заклинание 1 круга «Посвящённого»). */
    freeCast?: boolean;
  }
  // Число выбора: фиксированное или из колонки прогрессии на уровне
  // (заговоры/подготовленные ЭК растут; прогрессия класса первична,
  // подкласса — запасная, как в слотах).
  function choiceCount(
    c: { count: number; countFrom?: "cantrips" | "prepared" },
    classProg: ClassProgression | undefined,
    subProg: ClassProgression | undefined,
    lvl: number
  ): number {
    if (c.countFrom === "cantrips") {
      return cantripsAtLevel(classProg, lvl) ?? cantripsAtLevel(subProg, lvl) ?? c.count;
    }
    if (c.countFrom === "prepared") {
      return preparedAtLevel(classProg, lvl) ?? preparedAtLevel(subProg, lvl) ?? c.count;
    }
    return c.count;
  }
  // Высший круг с ячейками на уровне класса (потолок «любого круга» ЭК).
  function slotTopCircle(sub: CompendiumEntry | null | undefined, cls: CompendiumEntry | null | undefined, lvl: number): number | null {
    const prog = (sub?.data.progression ?? cls?.data.progression) as ClassProgression | undefined;
    const slots = spellSlotsAtLevel(prog, lvl);
    if (!slots) return null;
    let top = 0;
    for (let i = 0; i < slots.length; i += 1) if (slots[i] > 0) top = i + 1;
    return top > 0 ? top : null;
  }
  const spellGroups: SpellPickGroup[] = [];
  // Заговоры, книга и подготовленные класса — по его собственному уровню: при
  // мультиклассе каждый класс готовит заклинания как одноклассовый (PHB 2024).
  // Второй и следующие колдуют своей характеристикой — она пишется в запись.
  function pushClassAuto(entry: CompendiumEntry, lvl: number, key: string, withAbility: boolean) {
    const abilityKey = ABILITY_NAME_TO_KEY[String(entry.data.spellcasting_ability || '')];
    const picks = classSpellPicks(entry.data, lvl, abilityKey ? abilityModifier(awardedAbilities[abilityKey]) : 0);
    const hasBook = nameMatches(entry.name, 'Волшебник') || nameMatches(entry.name_original || '', 'Wizard');
    const own = withAbility && abilityKey ? { ability: abilityKey } : {};
    if (picks.cantrips > 0) spellGroups.push({ key: `spell:${key}:auto:cantrips`, label: `Заговоры класса (${entry.name})`, count: picks.cantrips, level: 0, maxCircle: 0, classIds: [entry.id], schools: [], names: [], outsideLimit: false, ...own });
    if (hasBook) for (const book of wizardBookPicks(entry.data, lvl)) spellGroups.push({ key: `spell:${key}:book:${book.level}`, label: `Книга заклинаний — ${book.level === 1 ? 'начальные заклинания' : `получены на уровне ${book.level}`}`, count: book.count, level: null, maxCircle: book.topCircle, classIds: [entry.id], schools: [], names: [], outsideLimit: false, bookAcquisition: true, ...own });
    if (picks.prepared > 0) spellGroups.push({ key: `spell:${key}:auto:prepared`, label: `Подготовленные заклинания (${entry.name})`, count: picks.prepared, level: null, maxCircle: picks.topCircle, classIds: [entry.id], schools: [], names: [], outsideLimit: false, dailyPreparation: true, fromBook: hasBook, ...own });
  }
  if (classEntry && classGrants.spellChoices.length === 0) pushClassAuto(classEntry, level, "class", false);
  for (const m of extraModels) if (m.entry && m.grants.spellChoices.length === 0) pushClassAuto(m.entry, m.row.level, mcKey(m.row), true);
  {
    interface ChoiceSource {
      src: string;
      label: string;
      g: SourceGrants;
      classProg?: unknown;
      subProg?: unknown;
      lvl: number;
      /** Потолок «любого круга» — только у подклассов-полузаклинателей. */
      top?: number | null;
    }
    const choiceSources: ChoiceSource[] = [
      { src: "class", label: `От класса${classOption ? ` (${classOption.name})` : ""}`, g: classGrants, classProg: classEntry?.data.progression, lvl: level },
      { src: "subclass", label: `От подкласса${subclassEntry ? ` (${subclassEntry.name})` : ""}`, g: subclassGrants, subProg: subclassEntry?.data.progression, lvl: level, top: slotTopCircle(subclassEntry, classEntry, level) },
      { src: "species", label: `От вида${speciesEntry ? ` (${speciesEntry.name})` : ""}`, g: speciesGrants, lvl: totalLevel },
      { src: "feat", label: `От черты${featEntry ? ` (${featEntry.name})` : ""}`, g: featGrants, lvl: totalLevel },
      { src: "feat2", label: `От черты вида${speciesFeatEntry ? ` (${speciesFeatEntry.name})` : ""}`, g: speciesFeatGrants, lvl: totalLevel },
      { src: "style", label: "От черты боевого стиля", g: styleGrants, lvl: totalLevel },
      ...extraModels.flatMap((m): ChoiceSource[] => [
        { src: mcKey(m.row), label: `От класса (${m.opt?.name ?? "класс"})`, g: m.grants, classProg: m.entry?.data.progression, lvl: m.row.level },
        { src: mcsKey(m.row), label: `От подкласса${m.subEntry ? ` (${m.subEntry.name})` : ""}`, g: m.subGrants, subProg: m.subEntry?.data.progression, lvl: m.row.level, top: slotTopCircle(m.subEntry, m.entry, m.row.level) },
      ]),
    ];
    for (const { src, label, g, classProg, subProg, lvl, top } of choiceSources) {
      const featSlot = src === "feat" || src === "feat2" ? (src as "feat" | "feat2") : null;
      g.spellChoices.forEach((c, i) => {
        // Список «Посвящённого» выбирается на шаге «Черта»; пока не выбран —
        // кандидатов нет (id −1 не совпадёт ни с одним классом).
        const list = featSlot && g.spellListChoice.length ? slotList(featSlot) ?? -1 : null;
        // Ключ с префиксом spell: — токены навыков матчат группы через
        // startsWith("class:") и чужие токены им не нужны.
        spellGroups.push({
          key: `spell:${src}:${i}`,
          label,
          count: choiceCount(c, classProg as ClassProgression | undefined, subProg as ClassProgression | undefined, lvl),
          level: c.level,
          classIds: list != null ? [list] : c.classIds,
          schools: c.schools,
          outsideLimit: c.outsideLimit,
          maxCircle: top != null && c.level == null ? top : null,
          names: c.names ?? [],
          ability: c.ability ?? (featSlot && g.spellAbilityChoice ? slotAbility(featSlot) : undefined),
          freeCast: c.freeCast,
        });
      });
    }
  }
  // Заклинания, которые придут сами пересчётом выдач (не выбор, а грант), —
  // их в кандидатах помечаем, а не даём взять дублем.
  const grantedSpellRefs = [...classGrants.spells, ...speciesGrants.spells, ...featGrants.spells, ...speciesFeatGrants.spells, ...extraModels.flatMap((m) => m.grants.spells)];
  const grantedSpellIds = new Set(grantedSpellRefs.map((s) => s.id));
  const grantedSpellNames = grantedSpellRefs.map((s) => s.name);
  function spellCandidates(group: SpellPickGroup): CompendiumEntry[] {
    if (!spellIndex) return [];
    return spellIndex.filter((e) => {
      const circle = e.level ?? 0;
      if ((group.dailyPreparation || group.bookAcquisition) && circle === 0) return false;
      if (group.fromBook && !spellGroups.some(g => g.bookAcquisition && chosenSpells.includes(`${g.key}:${e.id}`))) return false;
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
    const group = spellGroups.find(g => g.key === groupKey);
    // Одно заклинание дважды не учится — ни внутри блока, ни между блоками.
    if (!chosenSpells.includes(token) && chosenSpellEntryIds.has(entryId) && !group?.fromBook) return;
    setChosenSpells((prev) => {
      if (prev.includes(token)) return prev.filter(s => s !== token && !(group?.bookAcquisition && spellGroups.some(g => g.fromBook && s === `${g.key}:${entryId}`)));
      if (limit === 1 && !group?.fromBook) return [...prev.filter((s) => !s.startsWith(`${groupKey}:`)), token];
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

  async function finish() {
    // Recheck against current choices: changing level or restoring an old
    // draft must not admit spells above the limit or from another class.
    if (spellGroups.some(group => {
      const selected = chosenSpellsIn(group.key);
      const candidates = new Set(spellCandidates(group).map(e => e.id));
      return selected.length > group.count || selected.some(token => !candidates.has(Number(token.slice(token.lastIndexOf(':') + 1))));
    })) {
      setSaveError('Выбор заклинаний больше не соответствует классу или уровню. Вернитесь к шагу «Заклинания» и обновите выбор.');
      return;
    }
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
    if (portraitFile && portraitFrame) {
      character.portraitFocus = portraitFrame.focus;
      if (portraitFrame.zoom > 1) character.portraitZoom = portraitFrame.zoom;
    }
    character.playerName = playerName.trim();
    character.abilities = awardedAbilities;
    // Бонус предыстории — в журнал: база = итог − журнал (гриллинг Q8).
    const bgSource = `Предыстория: ${backgroundEntry?.name ?? (backgroundCustom?.trim() || "своя")}`;
    character.abilityBonuses = Object.entries(abilityAward)
      .filter(([, v]) => v)
      .map(([k, v]) => ({ key: k as DndAbilityKey, amount: v as number, source: bgSource }));

    if (classId && classOption) {
      character.classes = previewClasses;
      character.proficiencyBonus = computeProficiencyBonus(character.classes);
      // Кости хитов по классам — «3к10 + 2к8», как собирает лист.
      character.hitDice = hitDiceRows.map((d) => `${d.levels}к${d.die}`).join(" + ");
      // Хиты — тем же счётом, что превью Обзора (hpCalc). lump хранит только
      // кубовую часть: движок левелапа прибавляет ВЫН×уровень сам.
      if (hpCalc) {
        character.hitPointMax = String(hpCalc.max);
        character.hitPointsCurrent = String(hpCalc.max);
        character.hpLump = hpCalc.lump;
        character.hpRolls = [];
        character.hpMiscPerLevel = 0;
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
        // Доспехи класса — теми же строками: по ним лист решает «без владения».
        const armorPicks = Array.isArray(classEntry.data.armor_profs)
          ? (classEntry.data.armor_profs as { id: number; name: string }[])
          : [];
        for (const a of armorPicks) {
          if (a?.name && !character.proficiencies.some((p) => p.name === a.name)) {
            character.proficiencies = [...character.proficiencies, { entryId: a.id ?? null, name: a.name, abilityKey: null }];
          }
        }
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
      // Второй и следующие классы (Q15): урезанные владения мультикласса,
      // без спасбросков и снаряжения; умения — по уровню своей строки.
      for (const m of extraModels) {
        if (m.row.classId == null) continue;
        const addProf = (pr: { id: number | null; name: string }) => {
          if (!character.proficiencies.some((x) => x.name === pr.name)) {
            character.proficiencies = [...character.proficiencies, { entryId: pr.id, name: pr.name, abilityKey: null }];
          }
        };
        for (const pr of [...(m.mc?.armor ?? []), ...(m.mc?.tools ?? [])]) addProf(pr);
        const subTools = Array.isArray(m.subEntry?.data.tool_profs) ? (m.subEntry!.data.tool_profs as { id: number; name: string }[]) : [];
        for (const t of subTools) addProf({ id: t.id, name: t.name });
        try {
          const own = featuresFromEntries(await loadDndClassFeatures(sid, m.row.classId), m.row.classId, m.row.level);
          const sub = m.row.subclassId != null ? featuresFromEntries(await loadDndClassFeatures(sid, m.row.subclassId), m.row.subclassId, m.row.level) : [];
          character.classFeatures = [...character.classFeatures, ...own, ...sub];
        } catch {
          // справочник недоступен — умения добавятся на листе
        }
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
          character.speciesFeatures = featuresFromEntries(speciesFeatureEntries, speciesId, totalLevel).map((f) =>
            // Сопротивление на выбор (Возрождённый) — выбор в самой строке, как у черт.
            resistFeature && f.entryId === resistFeature.id && speciesResist.length > 0
              ? { ...f, choices: { resistances: speciesResist } }
              : f
          );
          // Предок — строкой умений вида: его сопротивление считается само,
          // и видно, откуда оно.
          const lineage = speciesChildren.find((e) => e.id === lineageId && e.kind === "lineage");
          if (lineage) {
            const [row] = featuresFromEntries([lineage], speciesId);
            character.speciesFeatures = [...character.speciesFeatures, { ...row, name: `Предок: ${lineage.name}` }];
          }
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
        // Со ссылкой на запись: по ней лист подставляет эффекты черты
        // («Бдительный» → инициатива) и выдаваемые чувства. Без entryId черта
        // оставалась текстом, и её механика до чисел не доходила.
        character.feats = [
          ...character.feats,
          { name: chosenFeat.name, description: featEntry?.description ?? "", entryId: chosenFeat.id, choices: featChoicesFor("feat") ?? {} },
        ];
      }
    }
    // Черта вида («Универсальность» Человека) — вторая, своя запись.
    // Дубль не кладём — кроме повторяемой черты («Посвящённый» со вторым
    // списком, Q5).
    const repeatable = /повторяем/i.test(String(speciesFeatEntry?.data.prerequisite ?? ""));
    if (
      effectiveSpeciesFeatId &&
      speciesFeatEntry &&
      (repeatable || !character.feats.some((f) => f.entryId === speciesFeatEntry.id))
    ) {
      character.feats = [
        ...character.feats,
        {
          name: speciesFeatEntry.name,
          description: speciesFeatEntry.description ?? "",
          entryId: speciesFeatEntry.id,
          choices: featChoicesFor("feat2") ?? {},
        },
      ];
    }
    // Инструменты «на ваш выбор» (Q10): выбранные в визарде — ссылкой на
    // запись; не из чего было выбрать (справочник без разметки) — строкой,
    // как раньше, чтобы выбор не потерялся.
    for (const g of toolGroups) {
      const picked = chosenToolsIn(g.key);
      for (const id of picked) {
        const e = toolCatalog.find((x) => x.id === id);
        if (e && !character.proficiencies.some((p) => p.entryId === e.id)) {
          character.proficiencies = [...character.proficiencies, { entryId: e.id, name: e.name, abilityKey: null }];
        }
      }
      if (g.options.length === 0) {
        character.proficiencies = [
          ...character.proficiencies,
          { entryId: null, name: `${g.group} — выбрать ${g.count}`, abilityKey: null },
        ];
      }
    }

    // Черты боевого стиля (тикет 03): с entryId, чтобы жили связанными, —
    // описание и так лежит в записи, дублируем снимком на случай офлайна.
    // Пишем всё выбранное, включая хвост сверх лимита: эксцесс виден
    // счётчиком на листе, молча не режем — как заклинания/приёмы/оружие.
    for (const id of [...chosenStyle, ...extraModels.flatMap((m) => m.styleSlots.map((_, i) => m.row.style[i]))]) {
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
    for (const w of [...masteredWeapons, ...extraModels.flatMap((m) => m.row.weapons)]) {
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
      for (const slot of [...entrySlots, ...extraModels.flatMap((m) => m.entrySlots)]) {
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
    for (const s of [...validExpertise, ...extraModels.flatMap(rowExpertise)]) character.skillProfs[s] = 2;

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
        // Выбор внутри набора — выбранным предметом со снимком полей; не из
        // чего было выбрать — строкой, чтобы позиция не пропала.
        for (const slot of setChoiceSlots.filter((sl) => sl.setLabel === set.label)) {
          const ids = setChoicePicked(slot);
          if (ids.length === 0) {
            addedItems.push({ ...EMPTY_EQUIPMENT_ITEM, id: makeEquipmentId(), name: slot.label, notes: "выбрать самому" });
          }
          for (const id of ids) {
            const e = toolCatalog.find((x) => x.id === id);
            const { entryId: _eid, ...restMeta } = (await fetchEquipmentMeta(id).catch(() => ({}))) as Record<string, unknown>;
            addedItems.push({
              ...EMPTY_EQUIPMENT_ITEM,
              ...(restMeta as object),
              id: makeEquipmentId(),
              name: e?.name ?? slot.label,
              entryId: id,
            });
          }
        }
        // Выборные позиции кладутся строкой: выбрать за игрока приложение не
        // вправе, а потерять их из набора тем более.
        for (const text of set.manual) {
          addedItems.push({ ...EMPTY_EQUIPMENT_ITEM, id: makeEquipmentId(), name: text, notes: "выбрать самому" });
        }
        const gold = Number.parseInt((set.gold ?? "").trim(), 10);
        if (Number.isFinite(gold)) goldToAdd += gold;
      }
      // Доспех и щит из набора сразу надеты, если персонаж ими владеет
      // (гриллинг 2026-09-23): иначе КЗ после создания считался без доспеха.
      const armorNames = armorProfNames(character.proficiencies);
      const wearable = (item: (typeof addedItems)[number], shield: boolean) => {
        const type = (item.armorType ?? "").trim().toLowerCase();
        const matches = shield ? type.startsWith("щит") : /^(л[её]гк|средн|тяж)/.test(type);
        return matches && isArmorProficient(item.armorType, armorNames);
      };
      for (const shield of [false, true]) {
        const item = addedItems.find((i) => wearable(i, shield));
        if (item) item.equipped = true;
      }
      // Оружие, которым владеет класс, — тоже надето (гриллинг 2026-09-24,
      // Q7): строки атак считаются только по надетому.
      const weaponProfs = Array.isArray(classEntry?.data.weapon_profs)
        ? (classEntry!.data.weapon_profs as { name?: string }[]).map((p) => p?.name ?? "").filter(Boolean)
        : [];
      for (const item of addedItems) {
        if (item.weaponDamage && isWeaponProficient(item, weaponProfs)) item.equipped = true;
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
      if (group.fromBook) continue; // Stored once by its acquisition group below.
      const lvl = entry?.level ?? group.level ?? 0;
      const rec = {
        entryId,
        name: entry?.name ?? "Заклинание",
        prepared: group.bookAcquisition
          ? (spellGroups.some(g => g.fromBook && chosenSpells.includes(`${g.key}:${entryId}`)) ? 1 as const : 0 as const)
          : group.dailyPreparation ? 1 as const : 2 as const,
        outsideLimit: group.outsideLimit,
        ...(group.ability ? { ability: group.ability } : {}),
        ...(group.freeCast ? { freeCast: true } : {}),
      };
      if (lvl <= 0) {
        character.cantrips = [...character.cantrips, rec];
      } else {
        while (character.spellsByLevel.length < lvl) character.spellsByLevel.push([]);
        character.spellsByLevel[lvl - 1] = [...character.spellsByLevel[lvl - 1], rec];
        // Круг без ячеек (Воин с «Посвящённым») тоже виден на листе — иначе
        // заклинание 1 круга лежало в данных, а раздела не было.
        character.spellSlotLevels = Math.max(character.spellSlotLevels, lvl);
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
      if (validExpertise.length > 0) {
        classLines.push(`экспертность: ${validExpertise.map((k) => skills.nameOf(k)).join(", ")}`);
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
    for (const m of extraModels) {
      if (!m.opt) continue;
      const lines = [`${m.opt.name} ${m.row.level}`];
      const sub = m.subOptions.find((x) => x.id === m.row.subclassId);
      if (sub) lines.push(sub.name);
      const profs = [...(m.mc?.armor ?? []), ...(m.mc?.tools ?? [])].map((pr) => pr.name);
      if (profs.length > 0) lines.push(`владения: ${profs.join(", ")}`);
      const picked = named([...chosenIn(mcKey(m.row)), ...chosenIn(mcsKey(m.row))].map((t) => t.slice(t.indexOf(":") + 1)));
      if (picked.length > 0) lines.push(`навыки: ${picked.join(", ")}`);
      if (rowExpertise(m).length > 0) lines.push(`экспертность: ${named(rowExpertise(m)).join(", ")}`);
      const style = m.styleSlots
        .map((_, i) => m.row.style[i])
        .filter((id): id is number => typeof id === "number")
        .map((id) => styleFeatEntries[id]?.name ?? styleFeats.find((f) => f.id === id)?.name ?? "черта стиля");
      if (style.length > 0) lines.push(`боевой стиль: ${style.join(", ")}`);
      if (m.row.weapons.length > 0) lines.push(`приёмы: ${m.row.weapons.map((w) => w.name).join(", ")}`);
      for (const slot of m.entrySlots) {
        const ids = chosenEntries[slot.key] ?? [];
        if (ids.length > 0) lines.push(`${slot.group.toLowerCase()}: ${ids.map((id) => entryCatalog[slot.group]?.find((e) => e.id === id)?.name ?? "запись").join(", ")}`);
      }
      overviewSources.push({ label: `Мультикласс · ${m.opt.name}`, lines });
    }

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
      if (featGrants.resources.length > 0) featLines.push(`ресурсы: ${featGrants.resources.map((r) => r.label).join(", ")}`);
      if (featGrants.spellChoices.length > 0) {
        featLines.push(
          `заклинания на выбор: ${featGrants.spellChoices
            .map((c) => (c.level === 0 ? `${c.count} заговора` : `${c.count} ${c.level} круга`))
            .join(", ")}`
        );
      }
    }
    if (speciesFeatEntry && effectiveSpeciesFeatId) {
      featLines.push(`${speciesFeatEntry.name} (от вида)`);
      const picked = named(chosenIn("feat2").map((t) => t.slice(t.indexOf(":") + 1)));
      if (picked.length > 0) featLines.push(`навыки: ${picked.join(", ")}`);
    }
    const toolNames = toolGroups.flatMap((g) => chosenToolsIn(g.key).map((id) => toolCatalog.find((e) => e.id === id)?.name ?? ""));
    if (toolNames.filter(Boolean).length > 0) featLines.push(`инструменты: ${toolNames.filter(Boolean).join(", ")}`);
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
    // Инструменты выбираются в визарде; «добрать» остаётся только там, где
    // справочник не размечен и выбирать не из чего.
    for (const g of toolGroups) {
      if (g.options.length === 0) pendingPicks.push({ label: g.label, text: `владения на выбор: ${g.group} — ${g.count}` });
    }
    // Язык Баннерета («Посланник рыцарства»): модели выбора языка нет,
    // берётся руками на шаге языков — как автовыдачи плута/друида выше,
    // матчим по имени подкласса тем же приёмом.
    if (subclassId != null && subclassEntry && nameMatches(subclassEntry.name, "Баннерет")) {
      pendingPicks.push({ label: "Подкласс", text: "язык на выбор (Посланник рыцарства) — отметь на шаге языков" });
    }
    for (const m of extraModels) {
      if (m.entry && !m.mc) {
        pendingPicks.push({ label: "Мультикласс", text: `владения мультикласса (${m.entry.name}) не размечены в справочнике — добери на листе` });
      }
    }
  }

  // Стартовые числа тем же счётом, что лист: БМ — общей формулой (вызов, не
  // копия правила), хиты — кость класса + ВЫН, КД — без доспеха (10 + ЛОВ).
  // Форма записи класса — та же, что собирает finish() ниже.
  // Кости по классам, стартовый первым (Q17: его 1-й уровень — максимумом).
  const dieOf = (hitDie: string | undefined) => Number.parseInt(/\d+/.exec(hitDie ?? "")?.[0] ?? "", 10);
  const hitDiceRows = [
    { die: dieOf(classOption?.hitDie), levels: level },
    ...extraModels.flatMap((m) => (m.opt ? [{ die: dieOf(m.opt.hitDie), levels: m.row.level }] : [])),
  ].filter((d) => Number.isFinite(d.die));
  const previewConMod = abilityModifier(awardedAbilities.con);
  const previewDexMod = abilityModifier(awardedAbilities.dex);
  const previewFeatHp = featHitPoints([featEntry, effectiveSpeciesFeatId ? speciesFeatEntry : null]);
  // Хиты (Q17): кость стартового на 1-м уровне целиком, дальше среднее вверх
  // по кости своего класса; ВЫН и хиты черт («Крепкий») — за каждый уровень.
  const avgDie = (d: number) => Math.floor(d / 2) + 1;
  const hpCalc = Number.isFinite(dieOf(classOption?.hitDie))
    ? (() => {
        const lump = hitDiceRows.reduce((n, d, i) => n + (i === 0 ? d.die + (d.levels - 1) * avgDie(d.die) : d.levels * avgDie(d.die)), 0);
        return { lump, max: Math.max(1, lump + (previewConMod + previewFeatHp.perLevel) * totalLevel + previewFeatHp.flat) };
      })()
    : null;
  const previewHp = hpCalc?.max ?? null;
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
          ...extraModels.flatMap((m) =>
            m.row.classId != null && m.opt
              ? [
                  {
                    classId: m.row.classId,
                    className: m.opt.name,
                    subclassId: m.row.subclassId,
                    subclassName: m.subOptions.find((s) => s.id === m.row.subclassId)?.name ?? "",
                    level: m.row.level,
                    skillChoiceOptions: m.mc?.skillAny ? [] : m.grants.skillChoice?.options ?? [],
                    skillChoiceCount: m.mc?.skillCount ?? 0,
                    spellcastingAbility: typeof m.entry?.data.spellcasting_ability === "string" ? (m.entry.data.spellcasting_ability as string) : "",
                  },
                ]
              : []
          ),
        ]
      : [];
  const classLine = [classOption ? `${classOption.name} ${level}` : "", ...extraModels.map((m) => (m.opt ? `${m.opt.name} ${m.row.level}` : ""))]
    .filter(Boolean)
    .join(" · ");
  const previewSpeed = speciesOptions.find((x) => x.id === speciesId)?.walkSpeed ?? null;

  // Данные мини-чарника (D0): чеклист, снаряжение и имена заклинаний
  // считаются здесь, показ — в WizardMiniSheet (один источник для
  // Обзора, сплита D1 и оборота D2).
  // Языки: Общий всем, плюс два на выбор (плюс язык Баннерета). Без
  // справочника языков выбирать не из чего — и гейта нет.
  const bonusLanguage = subclassId != null && !!subclassEntry && nameMatches(subclassEntry.name, "Баннерет") ? 1 : 0;
  const languagePicks = chosenLanguages.filter((l) => l !== "Общий" && !autoLanguages.includes(l)).length;
  const languageMissing = languageOptions.length === 0 ? 0 : Math.max(0, LANGUAGE_PICKS + bonusLanguage - languagePicks);

  // Что держит «Далее» на каждом шаге (Q6) — и чеклист Обзора тем же списком.
  function stepMissing(st: Step): string[] {
    const out: string[] = [];
    const more = (label: string, n: number) => n > 0 && out.push(`${label} — ещё ${n}`);
    switch (st) {
      case "Класс":
        if (!systemId) break;
        if (!classId) out.push("выбери класс");
        else if (!classEntry || choiceDefs == null) out.push("загружаю класс…");
        else if (!subclassLocked && subclassOptions.length > 0 && !subclassId) out.push("выбери подкласс");
        for (const m of extraModels) {
          if (m.row.classId == null) out.push("выбери класс в новой строке или убери её");
          else if (!m.entry || !m.defsLoaded) out.push(`загружаю ${m.opt?.name ?? "класс"}…`);
          else if (!m.subLocked && m.subOptions.length > 0 && m.row.subclassId == null) out.push(`выбери подкласс (${m.opt?.name})`);
        }
        break;
      case "Умения класса":
        more("Боевой стиль", styleMissing);
        for (const x of entryShortfall) more(x.group, x.missing);
        more("Оружейные приёмы", weaponMissing);
        for (const m of extraModels) {
          const x = extraMissing(m);
          more(`Боевой стиль (${m.opt?.name})`, x.style);
          more(`Оружейные приёмы (${m.opt?.name})`, x.weapons);
        }
        for (const x of toolMissing(["class", "subclass", ...extraModels.flatMap((m) => [mcKey(m.row), mcsKey(m.row)])])) {
          more(`Инструменты (${x.g.group.toLowerCase()})`, x.missing);
        }
        break;
      case "Вид":
        if (!speciesId && speciesCustom === null) out.push("выбери вид");
        else if (speciesCustom !== null && !speciesCustom.trim()) out.push("впиши название своего вида");
        if (speciesId && speciesResistChoice && speciesResist.length < speciesResistChoice.count) out.push("выбери сопротивление");
        break;
      case "Предок":
        if (lineageOptions.length > 0 && !lineageOptions.some((o) => o.id === lineageId)) out.push("выбери предка");
        break;
      case "Предыстория":
        if (!backgroundId && backgroundCustom === null) out.push("выбери предысторию");
        else if (backgroundCustom !== null && !backgroundCustom.trim()) out.push("впиши название своей предыстории");
        for (const x of toolMissing(["background"])) more(`Инструменты (${x.g.group.toLowerCase()})`, x.missing);
        break;
      case "Черта":
        if (featNeeded && !effectiveFeatId) out.push("выбери черту предыстории");
        if (speciesFeatNeeded && !effectiveSpeciesFeatId) out.push("выбери черту вида");
        if (featNeeded) for (const m of slotMissing("feat")) out.push(`черта предыстории: ${m}`);
        if (speciesFeatNeeded) for (const m of slotMissing("feat2")) out.push(`черта вида: ${m}`);
        for (const x of toolMissing(["feat", "feat2"])) more(`Инструменты (${x.g.group.toLowerCase()})`, x.missing);
        break;
      case "Характеристики":
        if (!pointBuyValid) out.push("покупка: значения вне 8–15 или превышен бюджет");
        break;
      case "Навыки и языки":
        for (const x of skillShortfall) more(`Навыки ${x.group.label.charAt(0).toLowerCase()}${x.group.label.slice(1)}`, x.missing);
        more("Экспертность", expertiseMissing);
        for (const m of extraModels) more(`Экспертность (${m.opt?.name})`, extraMissing(m).expertise);
        more("Языки", languageMissing);
        break;
      case "Заклинания":
        for (const x of spellShortfall) more(x.group.label, x.missing);
        break;
      case "Снаряжение":
        for (const sl of setChoiceMissing) out.push(`выбери: ${sl.label}`);
        break;
      case "Досье":
        if (!characterName.trim()) out.push("впиши имя персонажа");
        break;
    }
    return out;
  }
  // Шаг виден, только если на нём есть что выбирать (Q5, Q16).
  const classChoiceCount =
    styleSlots.length +
    entrySlots.length +
    (weaponSlots > 0 ? 1 : 0) +
    extraModels.reduce((n, m) => n + m.styleSlots.length + m.entrySlots.length + (m.weaponSlots > 0 ? 1 : 0), 0) +
    toolGroups.filter((g) => !["background", "feat", "feat2"].includes(g.key)).length;
  function stepVisible(st: Step): boolean {
    if (st === "Умения класса") return classChoiceCount > 0;
    if (st === "Черта") return featNeeded || speciesFeatNeeded;
    if (st === "Заклинания") return spellGroups.length > 0;
    if (st === "Предок") return lineageOptions.length > 0;
    return true;
  }
  const visibleSteps = STEPS.filter((st) => stepVisible(st) || st === step);
  const overviewProblems: MiniSheetProblem[] = visibleSteps.flatMap((st) =>
    st === "Обзор" ? [] : stepMissing(st).map((text) => ({ text, target: st }))
  );
  // Требование 13+ (Q16) предупреждает, а не запирает — у стартового и у
  // каждого следующего, как в книге.
  const prereqWarnings =
    extraClasses.length === 0
      ? []
      : [classOption, ...extraModels.map((m) => m.opt)]
          .filter((o): o is NonNullable<typeof o> => !!o?.multiclassPrereq && multiclassPrereqUnmet(o.multiclassPrereq, awardedAbilities))
          .map((o) => `Мультикласс: ${o.name} требует «${o.multiclassPrereq}» — сейчас не хватает. Поправь на шаге «Характеристики» или договорись с Мастером.`);
  // Предупреждения Обзора (Q11): законно, но сомнительно — создать можно.
  const overviewWarnings: string[] = [...prereqWarnings];
  {
    const primary = classEntry ? parseAbilityNames(classEntry.data.primary_abilities) : [];
    if (primary.length > 0 && Math.max(...primary.map((k) => awardedAbilities[k])) < 13) {
      const names = primary.map((k) => ABILITY_LABELS.find((a) => a.key === k)?.label ?? k).join(" / ");
      overviewWarnings.push(
        `Основная характеристика класса (${names}) — ${Math.max(...primary.map((k) => awardedAbilities[k]))}. Классу она нужна больше всего: уверен?`
      );
    }
    if (abilityModifier(awardedAbilities.con) < 0) overviewWarnings.push("Телосложение ниже 10 — хитов будет меньше обычного.");
  }
  const overviewTaken = startingSets.filter((s) => setTaken(s.label));
  const overviewSpellNames = chosenSpells
    .filter((t) => spellGroups.some((g) => t.startsWith(`${g.key}:`)))
    .map((t) => {
      const id = Number(t.slice(t.lastIndexOf(":") + 1));
      return spellIndex?.find((e) => e.id === id)?.name ?? `#${id}`;
    });

  // Навигация — по видимым шагам: пустые (нечего выбирать) пропускаются.
  const stepPos = Math.max(0, visibleSteps.indexOf(step));
  const missingHere = stepMissing(step);
  // D2: оборот на мобиле — лицо (шаг) ↔ оборот (живой чарник). Любая смена
  // шага возвращает лицо; на десктопе состояние сбрасывается.
  const [mobilePreview, setMobilePreview] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const desktop = useIsDesktop();
  useEffect(() => {
    setMobilePreview(false);
    setSheet(null);
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1001px)");
    const reset = () => {
      if (mq.matches) setMobilePreview(false);
    };
    mq.addEventListener("change", reset);
    return () => mq.removeEventListener("change", reset);
  }, []);
  // Шторка: описание записи, состав набора или список шагов.
  type SheetState =
    | {
        kind: "entry";
        entryId: number;
        entry?: CompendiumEntry | null;
        meta?: string;
        picked: boolean;
        onToggle: () => void;
        disabled?: boolean;
      }
    | { kind: "set"; label: string }
    | { kind: "steps" }
    | null;
  const [sheet, setSheet] = useState<SheetState>(null);
  // Перестановка характеристик тапом: первая «взведена», вторая меняется с ней.
  const [armedAbility, setArmedAbility] = useState<keyof DndAbilityScores | null>(null);
  const [weaponQ, setWeaponQ] = useState("");

  // Данные постера собираются в момент нажатия (кнопки зовут колбэк),
  // поэтому черновик и правки между рендерами не протухают.
  function posterData(): PosterData {
    const speciesName =
      speciesOptions.find((x) => x.id === speciesId)?.name ?? speciesCustom?.trim() ?? "";
    return {
      name: characterName.trim() || "Без имени",
      subtitle: [classLine, speciesName]
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
  function miniSheet(withoutCore = false) {
    const dossier: { label: string; text: string }[] = [];
    if (personalityTraits.trim()) dossier.push({ label: "Черты", text: personalityTraits.trim() });
    if (ideals.trim()) dossier.push({ label: "Идеалы", text: ideals.trim() });
    if (bonds.trim()) dossier.push({ label: "Узы", text: bonds.trim() });
    if (flaws.trim()) dossier.push({ label: "Изъяны", text: flaws.trim() });
    if (dossierNotes.trim()) dossier.push({ label: "Заметки", text: dossierNotes.trim() });
    return (
      <WizardMiniSheet
        banner={portraitPreview ? { src: portraitPreview, placeholder: false } : classOption?.card ? { src: classOption.card, placeholder: true } : null}
        subtitle={[classLine, speciesOptions.find((x) => x.id === speciesId)?.name ?? ""].filter(Boolean).join(" · ")}
        withoutCore={withoutCore}
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
    setStep(visibleSteps[Math.min(visibleSteps.length - 1, stepPos + 1)]);
  }
  function back() {
    setStep(visibleSteps[Math.max(0, stepPos - 1)]);
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
    setSheet(null);
    setStep("Класс");
    setCharacterName(ownerName ?? "");
    setPlayerName(ownerType === "character" ? ownerPlayerName ?? "" : "");
    setClassId(null);
    setSubclassId(null);
    setLevel(1);
    setLevelText(null);
    setExtraClasses([]);
    setActiveRow(0);
    setSpeciesId(null);
    setSpeciesCustom(null);
    setBackgroundId(null);
    setBackgroundCustom(null);
    setFeatId(null);
    setFeatTouched(false);
    setSpeciesFeatId(null);
    setAwardMode("2+1");
    setAwardPrimary(null);
    setAwardSecondary(null);
    setTakenSets({});
    setSetChoicePicks({});
    setMethod("standard");
    const a = emptyAbilities();
    (Object.keys(a) as (keyof DndAbilityScores)[]).forEach((k, i) => (a[k] = STANDARD_ARRAY[i]));
    setAbilities(a);
    setAbilitiesTouched(false);
    setRolledPool(STANDARD_ARRAY.slice());
    setChosenSkills([]);
    setChosenExpertise([]);
    setChosenSpells([]);
    setChosenStyle([]);
    setChosenEntries({});
    setMasteredWeapons([]);
    setChosenTools([]);
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

  // Шторка записи: тап по строке списка.
  function openEntry(
    entryId: number,
    picked: boolean,
    onToggle: () => void,
    extra?: { entry?: CompendiumEntry | null; meta?: string; disabled?: boolean }
  ) {
    setSheet({ kind: "entry", entryId, picked, onToggle, ...extra });
  }

  const abilityLabel = (k: keyof DndAbilityScores) => ABILITY_LABELS.find((a) => a.key === k)?.label ?? k;
  const classPrimary = classEntry ? parseAbilityNames(classEntry.data.primary_abilities) : [];

  function renderToolGroups(keys: string[]) {
    return toolGroups
      .filter((g) => keys.includes(g.key))
      .map((g) => {
        const picked = chosenToolsIn(g.key);
        return (
          <section key={`tools:${g.key}`}>
            <PickHead label={`Инструменты: ${g.group.toLowerCase()}`} picked={picked.length} total={g.count} hint={g.label} />
            {g.options.length === 0 ? (
              <span className="muted">Справочник не знает вариантов — выбор ляжет строкой на лист.</span>
            ) : (
              <PickList
                rows={g.options.map((e) => {
                  // Владение одним инструментом дважды не берётся.
                  const other = toolGroups.find((o) => o.key !== g.key && chosenToolsIn(o.key).includes(e.id));
                  return { key: String(e.id), title: e.name, meta: other ? `уже есть: ${other.label}` : undefined, picked: picked.includes(e.id), disabled: !!other };
                })}
                full={g.count > 1 && picked.length >= g.count}
                collapse={picked.length >= g.count}
                onToggle={(k) => toggleTool(g.key, Number(k), g.count)}
                // Описание инструмента — как у черт: у ремесленных характеристика
                // и использование лежат полями записи, не в тексте.
                onOpen={(k) => {
                  const e = g.options.find((x) => x.id === Number(k));
                  const other = toolGroups.find((o) => o.key !== g.key && chosenToolsIn(o.key).includes(Number(k)));
                  const meta = [e?.data.ability, e?.data.usage].filter((x): x is string => typeof x === "string" && !!x).join(" · ");
                  openEntry(Number(k), picked.includes(Number(k)), () => toggleTool(g.key, Number(k), g.count), {
                    entry: e,
                    meta: meta || undefined,
                    disabled: !!other,
                  });
                }}
              />
            )}
          </section>
        );
      });
  }

  function renderClass() {
    // Карта, подкласс и уровень — у активной строки (0 — стартовый класс).
    const act = activeRow > 0 ? extraModels[activeRow - 1] : undefined;
    const cur = act
      ? {
          key: act.row.uid,
          classId: act.row.classId,
          subOptions: act.subOptions,
          subclassId: act.row.subclassId,
          subLocked: act.subLocked,
          subNote: `с ${act.opt?.subclassLevel ?? 0} ур.`,
          level: act.row.level,
          pickClass: (id: number) => id !== act.row.classId && pickExtraClass(act.row, id),
          pickSub: (id: number) => pickExtraSubclass(act.row, id),
          setLevel: (n: number) => setExtraLevel(act, n),
        }
      : {
          key: "start",
          classId,
          subOptions: subclassOptions,
          subclassId,
          subLocked: subclassLocked,
          subNote: subLockNote,
          level,
          pickClass: (id: number) => id !== classId && pickClass(id),
          pickSub: (id: number) => pickSubclass(id),
          setLevel: (n: number) => setLevel(n),
        };
    const curName = hierarchy.classes.find((c) => c.id === cur.classId)?.name;
    const maxLevel = 20 - (totalLevel - cur.level);
    const clampLevel = (n: number) => Math.min(maxLevel, Math.max(1, n));
    // Класс берётся один раз: занятые другими строками в выборе не видны.
    const taken = new Set([classId, ...extraClasses.map((r) => r.classId)].filter((id) => id != null && id !== cur.classId));
    const classOptions = hierarchy.classes.filter((c) => !taken.has(c.id));
    const levelControl = (
    <div className="wz-level" role="group" aria-label="Уровень">
      <button type="button" aria-label="Уровень −1" disabled={cur.level <= 1} onClick={() => cur.setLevel(clampLevel(cur.level - 1))}>
        <NavIcon name="minus" />
      </button>
      <label className="wz-level-num">
        <span>ур</span>
        <input
          type="number"
          min={1}
          max={maxLevel}
          inputMode="numeric"
          aria-label="Уровень"
          value={levelText ?? cur.level}
          onChange={(e) => setLevelText(e.target.value)}
          onBlur={(e) => {
            cur.setLevel(clampLevel(Math.round(Number(e.target.value)) || 1));
            setLevelText(null);
          }}
        />
      </label>
      <button type="button" aria-label="Уровень +1" disabled={cur.level >= maxLevel} onClick={() => cur.setLevel(clampLevel(cur.level + 1))}>
        <NavIcon name="plus" />
      </button>
    </div>
    );
    const toRow = (n: number) => {
      setActiveRow(n);
      setLevelText(null);
    };
    return (
      <div className="wz-step">
        {!systemId && <span className="muted">У кампании не указана система — выбор класса недоступен, можно будет добавить позже.</span>}
        {/* Мультикласс (Q15): строки «класс · уровень», первая — стартовая. */}
        {classId != null && (
          <div className="wz-chips wz-class-rows" role="group" aria-label="Классы персонажа">
            <button type="button" className="wz-chip" aria-pressed={activeRow === 0} onClick={() => toRow(0)}>
              {classOption ? `${classOption.name} ${level}` : "Класс"}
              {extraClasses.length > 0 && " · стартовый"}
            </button>
            {extraModels.map((m, i) => (
              <Fragment key={m.row.uid}>
                <button type="button" className="wz-chip" aria-pressed={activeRow === i + 1} onClick={() => toRow(i + 1)}>
                  {m.opt ? `${m.opt.name} ${m.row.level}` : "Новый класс"}
                </button>
                <button
                  type="button"
                  className="wz-chip wz-chip-x"
                  aria-label={`Убрать: ${m.opt?.name ?? "новый класс"}`}
                  title="Убрать класс"
                  onClick={() => removeExtraClass(m.row)}
                >
                  ×
                </button>
              </Fragment>
            ))}
            {totalLevel < 20 && extraClasses.every((r) => r.classId != null) && (
              <button type="button" className="wz-chip" onClick={addExtraClass}>
                + Ещё класс
              </button>
            )}
          </div>
        )}
        {prereqWarnings.map((w) => (
          <div key={w} className="wz-warn" role="note">
            {w}
          </div>
        ))}
        {desktop ? (
          <CardStage
            key={cur.key}
            systemId={systemId}
            searchPlaceholder="Поиск класса"
            aside={levelControl}
            groups={[
              { key: "class", label: act ? "Ещё класс" : "Класс", note: curName ? `${curName} выбран` : "выбери один", options: classOptions, selectedId: cur.classId, onPick: cur.pickClass },
              ...(cur.classId != null && cur.subOptions.length > 0
                ? [
                    {
                      key: `sub:${cur.classId}`,
                      label: "Подкласс",
                      note: cur.subLocked ? `выбирается ${cur.subNote}` : "выбери один",
                      options: cur.subOptions,
                      selectedId: cur.subclassId,
                      onPick: cur.pickSub,
                      pickDisabled: cur.subLocked ? `Подкласс выбирается ${cur.subNote} — на листе при повышении уровня.` : undefined,
                    },
                  ]
                : []),
            ]}
          />
        ) : (
        <CardRibbon
          key={cur.key}
          systemId={systemId}
          options={classOptions}
          selectedId={cur.classId}
          onPick={cur.pickClass}
          searchPlaceholder="Поиск класса"
          aside={levelControl}
        />
        )}
        {!desktop && cur.classId != null && cur.subOptions.length > 0 && (
          <section>
            <PickHead label="Подкласс" />
            {cur.subLocked ? (
              <span className="muted">Подкласс выбирается {cur.subNote} — на листе при повышении уровня.</span>
            ) : (
              <CardRibbon key={`${cur.key}:${cur.classId}`} systemId={systemId} options={cur.subOptions} selectedId={cur.subclassId} onPick={cur.pickSub} />
            )}
          </section>
        )}
      </div>
    );
  }

  function renderClassChoices() {
    // Разделы по классам (Q18): стартовый и каждая строка мультикласса со
    // своими выборами; пустые строки мультикласса не показываются.
    interface Block {
      key: string;
      name: string;
      level: number;
      classId: number | null;
      styleSlots: ChoiceDef[];
      style: (number | null)[];
      setStyle: (i: number, id: number | null) => void;
      entrySlots: typeof entrySlots;
      weaponSlots: number;
      weapons: { entryId: number; name: string }[];
      toggleWeapon: (e: CompendiumEntry) => void;
      toolKeys: string[];
    }
    const put = (arr: (number | null)[], i: number, id: number | null) => {
      const out = [...arr];
      while (out.length <= i) out.push(null);
      out[i] = id;
      return out;
    };
    const blocks: Block[] = [
      {
        key: "start",
        name: classOption?.name ?? "класс",
        level,
        classId,
        styleSlots,
        style: chosenStyle,
        setStyle: (i: number, id: number | null) => setChosenStyle((prev) => put(prev, i, id)),
        entrySlots,
        weaponSlots,
        weapons: masteredWeapons,
        toggleWeapon: toggleMastered,
        toolKeys: ["class", "subclass"],
      },
      ...extraModels.map(
        (m): Block => ({
          key: m.row.uid,
          name: m.opt?.name ?? "класс",
          level: m.row.level,
          classId: m.row.classId,
          styleSlots: m.styleSlots,
          style: m.row.style,
          setStyle: (i, id) => setExtraClasses((prev) => prev.map((r) => (r.uid === m.row.uid ? { ...r, style: put(r.style, i, id) } : r))),
          entrySlots: m.entrySlots,
          weaponSlots: m.weaponSlots,
          weapons: m.row.weapons,
          toggleWeapon: (e) =>
            setExtraClasses((prev) =>
              prev.map((r) => {
                if (r.uid !== m.row.uid) return r;
                if (r.weapons.some((w) => w.entryId === e.id)) return { ...r, weapons: r.weapons.filter((w) => w.entryId !== e.id) };
                return r.weapons.length >= m.weaponSlots ? r : { ...r, weapons: [...r.weapons, { entryId: e.id, name: e.name }] };
              })
            ),
          toolKeys: [mcKey(m.row), mcsKey(m.row)],
        })
      ),
    ].filter((b, bi) => bi === 0 || b.styleSlots.length + b.entrySlots.length + b.weaponSlots + toolGroups.filter((g) => b.toolKeys.includes(g.key)).length > 0);
    return (
      <div className="wz-step">
        {blocks.map((b, bi) => (
          <Fragment key={b.key}>
            <p className="wz-step-lead">
              Что {b.name} выбирает на {b.level} уровне.{b.styleSlots.length + b.entrySlots.length > 0 && " Тап по названию — описание."}
            </p>
            {b.styleSlots.map((def, i) => {
              // Черта стиля берётся один раз — и в другом слоте, и у другого класса.
              const takenElsewhere = new Set([...b.style.filter((_, j) => j !== i), ...blocks.filter((o) => o.key !== b.key).flatMap((o) => o.style)]);
              const options = styleFeats.filter((f) => !takenElsewhere.has(f.id) && featFitsClasses(f, [b.classId]));
              const pick = (id: number) => {
                const nextId = b.style[i] === id ? null : id;
                b.setStyle(i, nextId);
                if (nextId != null) void fetchStyleEntry(nextId);
              };
              return (
                <section key={`${def.sourceEntryId}:${i}`}>
                  <PickHead label="Боевой стиль" picked={b.style[i] != null ? 1 : 0} total={1} hint={`от умения «${def.sourceName}»`} />
                  {styleFeats.length === 0 ? (
                    <span className="muted">Черты стиля не загрузились — выбери позже на листе.</span>
                  ) : (
                    <PickList
                      rows={options.map((f) => ({ key: String(f.id), title: f.name, picked: b.style[i] === f.id }))}
                      collapse
                      onToggle={(k) => pick(Number(k))}
                      onOpen={(k) => openEntry(Number(k), b.style[i] === Number(k), () => pick(Number(k)), { entry: styleFeatEntries[Number(k)] })}
                    />
                  )}
                </section>
              );
            })}
            {bi === 0 &&
              chosenStyle.slice(styleSlots.length).map(
                (id, k) =>
                  id != null && (
                    <div key={`orphan:${k}`} className="row wz-warn">
                      <span>
                        {styleFeatEntries[id]?.name ?? styleFeats.find((f) => f.id === id)?.name ?? "Черта"} — сверх лимита (уровень снижен).
                      </span>
                      <button type="button" onClick={() => setChosenStyle((prev) => prev.filter((_, j) => j !== styleSlots.length + k))}>
                        Убрать
                      </button>
                    </div>
                  )
              )}
            {b.entrySlots.map((slot) => {
              const picked = chosenEntries[slot.key] ?? [];
              const catalog = entryCatalog[slot.group];
              return (
                <section key={slot.key}>
                  <PickHead label={slot.group} picked={picked.length} total={slot.total} />
                  {catalog === undefined ? (
                    <span className="muted">Загружаю…</span>
                  ) : catalog.length === 0 ? (
                    <span className="muted">Список пуст — выбери позже на листе.</span>
                  ) : (
                    <PickList
                      rows={catalog.map((e) => {
                        const needLevel = e.level ?? 1;
                        return {
                          key: String(e.id),
                          title: e.name,
                          meta: needLevel > b.level ? `с ${needLevel} ур.` : undefined,
                          picked: picked.includes(e.id),
                          disabled: needLevel > b.level,
                        };
                      })}
                      full={slot.total > 1 && picked.length >= slot.total}
                      collapse={picked.length >= slot.total}
                      onToggle={(k) => toggleEntry(slot.key, Number(k), slot.total)}
                      onOpen={(k) => {
                        const e = catalog.find((x) => x.id === Number(k));
                        openEntry(Number(k), picked.includes(Number(k)), () => toggleEntry(slot.key, Number(k), slot.total), {
                          entry: e,
                          disabled: (e?.level ?? 1) > b.level,
                        });
                      }}
                    />
                  )}
                </section>
              );
            })}
            {b.weaponSlots > 0 && (
              <section>
                <PickHead label="Оружейные приёмы" picked={b.weapons.length} total={b.weaponSlots} />
                {weaponCatalog === null ? (
                  <span className="muted">Загружаю оружие…</span>
                ) : (
                  <>
                    <SearchField value={weaponQ} onChange={setWeaponQ} placeholder="Поиск оружия" />
                    <PickList
                      rows={weaponCatalog
                        .filter((e) => matchQ(`${e.name} ${e.name_original ?? ""}`, weaponQ))
                        .slice(0, 60)
                        .map((e) => {
                          const damage = typeof e.data.damage === "string" ? e.data.damage : "";
                          const mastery = weaponMasteryName(e);
                          return {
                            key: String(e.id),
                            title: e.name,
                            meta: [damage, mastery && `мастерство: ${mastery}`].filter(Boolean).join(" · "),
                            picked: b.weapons.some((w) => w.entryId === e.id),
                          };
                        })}
                      full={b.weapons.length >= b.weaponSlots}
                      collapse={b.weapons.length >= b.weaponSlots}
                      onToggle={(k) => {
                        const e = weaponCatalog.find((x) => x.id === Number(k));
                        if (e) b.toggleWeapon(e);
                      }}
                    />
                  </>
                )}
              </section>
            )}
            {renderToolGroups(b.toolKeys)}
          </Fragment>
        ))}
      </div>
    );
  }

  function renderSpecies() {
    const options: CardOption[] = [...speciesOptions, { id: CUSTOM_CARD_ID, name: "Свой вариант", card: null }];
    return (
      <div className="wz-step">
        <CardRibbon
          key="species"
          systemId={systemId}
          options={options}
          selectedId={speciesCustom !== null ? CUSTOM_CARD_ID : speciesId}
          onPick={(id) => (id === CUSTOM_CARD_ID ? pickSpecies("custom") : id !== speciesId && pickSpecies(id))}
          searchPlaceholder="Поиск вида"
        />
        {speciesResistChoice && (
          <section>
            <PickHead label="Сопротивление" picked={speciesResist.length} total={speciesResistChoice.count} />
            <div className="wz-chips">
              {speciesResistChoice.options.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="wz-chip"
                  aria-pressed={speciesResist.includes(n)}
                  onClick={() =>
                    setSpeciesResist((prev) =>
                      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].slice(-speciesResistChoice.count)
                    )
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          </section>
        )}
        {speciesCustom !== null && (
          <label className="wz-field">
            Название своего вида
            <input value={speciesCustom} onChange={(e) => setSpeciesCustom(e.target.value)} placeholder="Например, полуогр" maxLength={80} />
            <span className="muted">
              1 навык на выбор — на шаге «Навыки», черта происхождения — на своём шаге. Остальное договоритесь с Мастером и
              доберёте на листе.
            </span>
          </label>
        )}
      </div>
    );
  }

  function renderLineage() {
    return (
      <div className="wz-step">
        {/* Свой key: иначе React берёт ленту шага «Вид» с её состоянием (сцена
            вместо плитки, текущая карта). */}
        <CardRibbon key="lineage" systemId={systemId} options={lineageOptions} selectedId={lineageId} onPick={setLineageId} />
      </div>
    );
  }

  function selectBackground(id: number | "custom" | null) {
    if (id === "custom") {
      setBackgroundId(null);
      setBackgroundCustom((prev) => prev ?? "");
    } else {
      setBackgroundId(id);
      setBackgroundCustom(null);
    }
    setAwardPrimary(null);
    setAwardSecondary(null);
    setChosenSkills((prev) => prev.filter((t) => !t.startsWith("background:")));
    setChosenTools((prev) => prev.filter((t) => !t.startsWith("background:")));
  }

  function renderBackground() {
    const rows = backgroundOptions
      .filter((b) => matchQ(b.name, backgroundQ))
      .map((b) => ({ key: String(b.id), title: b.name, meta: b.summary, picked: backgroundId === b.id }));
    rows.push({ key: "custom", title: "Свой вариант", meta: "договоритесь с Мастером", picked: backgroundCustom !== null });
    return (
      <div className="wz-step">
        {backgroundCustom !== null && (
          <label className="wz-field">
            Название своей предыстории
            <input value={backgroundCustom} onChange={(e) => setBackgroundCustom(e.target.value)} placeholder="Например, контрабандист" maxLength={80} />
            <span className="muted">
              Прибавка из любых характеристик и 2 навыка — на своих шагах, черта — на своём шаге. Набора снаряжения из справочника не
              будет — договоритесь с Мастером.
            </span>
          </label>
        )}
        {backgroundId != null && backgroundEntry && (
          <div className="stack wz-warn" aria-live="polite">
            <strong>{backgroundEntry.name}</strong>
            {backgroundGrants.skills.length > 0 && <span>Навыки: {backgroundGrants.skills.map((k) => skills.nameOf(k)).join(", ")}</span>}
            {backgroundGrants.toolNames.length > 0 && <span>Владения: {backgroundGrants.toolNames.join(", ")}</span>}
            {backgroundGrants.originFeat && <span>Черта происхождения: {backgroundGrants.originFeat.name}</span>}
            {backgroundGrants.abilityOptions.length > 0 && (
              <span>Характеристики: {backgroundGrants.abilityOptions.join(", ")} — +2/+1 или +1 каждой</span>
            )}
          </div>
        )}
        {renderToolGroups(["background"])}
        <SearchField value={backgroundQ} onChange={setBackgroundQ} placeholder="Поиск предыстории" />
        <PickList
          rows={rows}
          collapse
          onToggle={(k) => (k === "custom" ? selectBackground("custom") : selectBackground(backgroundId === Number(k) ? null : Number(k)))}
          onOpen={(k) =>
            k === "custom"
              ? selectBackground("custom")
              : openEntry(Number(k), backgroundId === Number(k), () => selectBackground(backgroundId === Number(k) ? null : Number(k)), {
                  meta: backgroundOptions.find((b) => b.id === Number(k))?.summary,
                })
          }
        />
      </div>
    );
  }

  // Выбор внутри черты: список «Посвящённого», характеристика, сопротивление.
  // Навыки, инструменты и заклинания черты — на своих шагах.
  function renderFeatChoices(slot: "feat" | "feat2") {
    const entry = slotEntry(slot);
    const g = slotGrants(slot);
    if (!entry) return null;
    const fixed = slot === "feat" && fixedFeatList != null;
    const parts = WIZARD_FEAT_PARTS.filter((p) => !(fixed && p === "spellList"));
    const hasAny = (g.spellListChoice.length > 0 && !fixed) || g.spellAbilityChoice || !!resistanceChoice(entry);
    if (!hasAny && !fixed) return null;
    return (
      <div className="wz-feat-inline">
        {fixed && <p className="wz-step-lead">Список заклинаний закреплён предысторией: {fixedListName ?? "…"}.</p>}
        <FeatChoices
          entry={entry}
          grants={g}
          ctx={slotCtx(slot)}
          pick={slotPick(slot)}
          parts={parts}
          onChange={(next) => {
            const prev = featSel[slot] ?? {};
            if (next.spellList !== slotList(slot)) {
              // Смена списка сбрасывает выбранные заклинания этой черты (Q1).
              setChosenSpells((cur) => cur.filter((t) => !t.startsWith(`spell:${slot}:`)));
            }
            setFeatSel((all) => ({
              ...all,
              [slot]: {
                ...prev,
                spellList: next.spellList,
                // Умолчание («самая высокая») не записываем: пусть следует за
                // характеристиками, пока игрок не выбрал сам.
                spellAbility: prev.spellAbility || next.spellAbility !== slotAbility(slot) ? next.spellAbility : undefined,
                resistances: next.resistances,
              },
            }));
          }}
          spellIndex={[]}
          tools={[]}
          weapons={[]}
          skills={[]}
        />
      </div>
    );
  }

  function renderFeat() {
    const featRows = (pickedId: number | null, exclude: number | null, fromBackground: boolean) =>
      originFeats
        // Черта, взятая другим слотом, скрыта — кроме повторяемых
        // («Посвящённый» с другим списком, Q5).
        .filter((f) => (f.id !== exclude || /повторяем/i.test(f.prerequisite ?? "")) && matchQ(f.name, featQ))
        .map((f) => ({ key: String(f.id), title: f.name, meta: fromBackground && f.id === suggestedFeatId ? "черта предыстории" : undefined, picked: pickedId === f.id }));
    return (
      <div className="wz-step">
        <SearchField value={featQ} onChange={setFeatQ} placeholder="Поиск черты" />
        {featNeeded && (
          <section>
            <PickHead
              label="Черта предыстории"
              picked={effectiveFeatId ? 1 : 0}
              total={1}
              hint={
                suggestedFeatId
                  ? "Предыстория уже предлагает черту — можно просто идти дальше. Другую — с разрешения Мастера."
                  : "Выбери черту происхождения."
              }
            />
            {featTouched && suggestedFeatId && effectiveFeatId !== suggestedFeatId && (
              <button
                type="button"
                className="wz-wide-btn"
                onClick={() => {
                  setFeatTouched(false);
                  setFeatId(null);
                }}
              >
                Вернуть черту предыстории
              </button>
            )}
            <PickList
              rows={featRows(effectiveFeatId, effectiveSpeciesFeatId, true)}
              collapse
              onToggle={(k) => pickBackgroundFeat(effectiveFeatId === Number(k) ? null : Number(k))}
              onOpen={(k) =>
                openEntry(Number(k), effectiveFeatId === Number(k), () =>
                  pickBackgroundFeat(effectiveFeatId === Number(k) ? null : Number(k))
                )
              }
            />
            {renderFeatChoices("feat")}
          </section>
        )}
        {speciesFeatNeeded && (
          <section>
            <PickHead
              label={`Черта вида${speciesEntry ? ` (${speciesEntry.name})` : ""}`}
              picked={effectiveSpeciesFeatId ? 1 : 0}
              total={1}
              hint="Вид даёт ещё одну черту происхождения на выбор."
            />
            <PickList
              rows={featRows(effectiveSpeciesFeatId, effectiveFeatId, false)}
              collapse
              onToggle={(k) => pickSpeciesFeat(effectiveSpeciesFeatId === Number(k) ? null : Number(k))}
              onOpen={(k) =>
                openEntry(Number(k), effectiveSpeciesFeatId === Number(k), () =>
                  pickSpeciesFeat(effectiveSpeciesFeatId === Number(k) ? null : Number(k))
                )
              }
            />
            {renderFeatChoices("feat2")}
          </section>
        )}
        {renderToolGroups(["feat", "feat2"])}
      </div>
    );
  }

  function renderAbilities() {
    const methods: [AbilityMethod, string][] = [
      ["standard", "Стандарт"],
      ["pointbuy", "Покупка"],
      ...(allowDiceRolls ? ([["roll", "Кубы"]] as [AbilityMethod, string][]) : []),
      ["manual", "Вручную"],
    ];
    const swapMode = method === "standard" || method === "roll";
    return (
      <div className="wz-step">
        <div className="wz-seg" role="group" aria-label="Способ определения характеристик">
          {methods.map(([m, label]) => (
            <button key={m} type="button" aria-pressed={method === m} onClick={() => applyMethod(m)}>
              {label}
            </button>
          ))}
        </div>
        {method === "standard" && (
          <p className="wz-step-lead">
            {classArray ? `Массив уже разложен под класс ${classOption?.name ?? ""}.` : "Стандартный массив."} Тапни две характеристики —
            они поменяются местами.
          </p>
        )}
        {method === "pointbuy" && (
          <p className="wz-step-lead">
            Осталось очков: <span className="wizard-data">{pointBuyRemaining}</span> из <span className="wizard-data">{POINT_BUY_BUDGET}</span>
          </p>
        )}
        {allowDiceRolls && method === "roll" && (
          <div className="row">
            <span className="muted">Выпало: {rolledPool.join(", ")}. Тапни две характеристики, чтобы поменять.</span>
            <button type="button" onClick={reroll}>
              Перебросить
            </button>
          </div>
        )}
        <div className="wz-abil-grid">
          {ABILITY_LABELS.map(({ key, label }) => {
            const boosted = !!abilityAward[key];
            const final = (
              <span className={`wz-abil-final${boosted ? " is-boosted" : ""}`}>
                {boosted ? `→ ${awardedAbilities[key]} ` : ""}({formatModifier(abilityModifier(awardedAbilities[key]))})
              </span>
            );
            const cls = `wz-abil${armedAbility === key ? " is-armed" : ""}${classPrimary.includes(key) ? " is-key" : ""}`;
            if (swapMode) {
              return (
                <button
                  key={key}
                  type="button"
                  className={cls}
                  aria-pressed={armedAbility === key}
                  onClick={() => {
                    if (armedAbility == null) return setArmedAbility(key);
                    if (armedAbility !== key) assignFromPool(armedAbility, abilities[key]);
                    setArmedAbility(null);
                  }}
                >
                  <span className="wz-die">
                    <span className="wz-abil-value">{awardedAbilities[key]}</span>
                    <span className="wz-abil-mod">{formatModifier(abilityModifier(awardedAbilities[key]))}</span>
                    {boosted && <span className="wz-abil-boost">+{awardedAbilities[key] - abilities[key]}</span>}
                  </span>
                  <span className="wz-abil-label">{label}</span>
                  {boosted && <span className="wz-abil-was">было {abilities[key]}</span>}
                  {armedAbility === key && (
                    <span className="wz-abil-armed">
                      <span>выбрана</span>
                      <span>нажми вторую</span>
                    </span>
                  )}
                </button>
              );
            }
            return (
              <div key={key} className={cls}>
                <span className="wz-abil-label">{label}</span>
                {method === "pointbuy" ? (
                  <span className="wz-abil-pb">
                    <button type="button" aria-label={`Уменьшить ${label}`} onClick={() => adjustPointBuy(key, -1)}>
                      <NavIcon name="minus" />
                    </button>
                    <span className="wz-abil-value">{abilities[key]}</span>
                    <button type="button" aria-label={`Увеличить ${label}`} onClick={() => adjustPointBuy(key, 1)}>
                      <NavIcon name="plus" />
                    </button>
                  </span>
                ) : (
                  <input
                    type="number"
                    min={1}
                    max={30}
                    aria-label={label}
                    value={abilities[key]}
                    onChange={(e) => setAbilities({ ...abilities, [key]: clampAbilityScore(Number(e.target.value)) })}
                  />
                )}
                {final}
              </div>
            );
          })}
        </div>
        {classPrimary.length > 0 && <span className="muted">★ — основная характеристика класса.</span>}
        {awardOptions.length > 0 && (
          <section className="stack">
            <PickHead
              label="Прибавка от предыстории"
              hint={backgroundCustom !== null ? "Свой вариант — любые характеристики." : `Из: ${awardOptions.join(", ")}.`}
            />
            <div className="wz-seg" role="group" aria-label="Как распределить прибавку">
              <button type="button" aria-pressed={awardMode === "2+1"} onClick={() => setAwardMode("2+1")}>
                +2 и +1
              </button>
              <button type="button" aria-pressed={awardMode === "1+1+1"} onClick={() => setAwardMode("1+1+1")}>
                +1 каждой
              </button>
            </div>
            {awardMode === "2+1" && (
              <>
                <span className="wz-group-label">+2</span>
                <div className="wz-chips">
                  {awardOptions.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className="wz-chip"
                      aria-pressed={effectiveAwardPrimary === a}
                      onClick={() => {
                        setAwardPrimary(a);
                        if (a === effectiveAwardSecondary) setAwardSecondary(null);
                      }}
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <span className="wz-group-label">+1</span>
                <div className="wz-chips">
                  {awardOptions
                    .filter((a) => a !== effectiveAwardPrimary)
                    .map((a) => (
                      <button key={a} type="button" className="wz-chip" aria-pressed={effectiveAwardSecondary === a} onClick={() => setAwardSecondary(a)}>
                        {a}
                      </button>
                    ))}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    );
  }

  function renderSkills() {
    const common = commonLangs.filter((o) => o.name !== "Общий" && !autoLanguages.includes(o.name));
    const rare = rareLangs.filter((o) => !autoLanguages.includes(o.name));
    const langRow = (o: DndMechanicsOption) => ({ key: o.name, title: o.name, picked: chosenLanguages.includes(o.name) });
    const skillMeta = (key: string) => {
      const ab = skills.rows.find((r) => r.original === key)?.ability;
      return ab ? `${abilityLabel(ab)} ${formatModifier(abilityModifier(awardedAbilities[ab]))}` : undefined;
    };
    return (
      <div className="wz-step">
        {skillGroups.length === 0 && <span className="muted">Ни класс, ни вид, ни черта не дают навыков на выбор.</span>}
        {skillGroups.map((group) => {
          const picked = chosenIn(group.key);
          return (
            <section key={group.key}>
              <PickHead label={group.label} picked={picked.length} total={group.count} />
              <PickList
                rows={optionsFor(group)
                  .filter((key) => !grantedSkills.has(key))
                  .map((key) => {
                    // Навык, взятый по другому источнику, второй раз не берётся:
                    // владение не складывается, а место в квоте сгорело бы.
                    const other = skillGroups.find((g) => g.key !== group.key && chosenSkills.includes(`${g.key}:${key}`));
                    return {
                      key,
                      title: skills.nameOf(key),
                      meta: other ? `${skillMeta(key) ?? ""} · уже взят (${other.label.toLowerCase()})` : skillMeta(key),
                      picked: chosenSkills.includes(`${group.key}:${key}`),
                      disabled: !!other,
                    };
                  })}
                full={group.count > 1 && picked.length >= group.count}
                collapse={picked.length >= group.count}
                onToggle={(k) => toggleSkill(group.key, k, group.count)}
              />
            </section>
          );
        })}
        {grantedSkills.size > 0 && (
          <span className="muted">Уже есть без выбора: {[...grantedSkills].map((k) => skills.nameOf(k)).join(", ")}</span>
        )}
        {expertiseSlots > 0 && (
          <section>
            <PickHead label="Экспертность" picked={validExpertise.length} total={expertiseSlots} hint="Удвоенный бонус мастерства к навыку, которым вы владеете." />
            {expertiseOpts.length === 0 ? <span className="muted">Сначала выберите владения навыками выше.</span> : <PickList
              rows={expertiseOpts.map((k) => ({ key: k, title: skills.nameOf(k), meta: skillMeta(k), picked: validExpertise.includes(k) }))}
              full={validExpertise.length >= expertiseSlots}
              onToggle={(k) => toggleExpertise(k)}
            />}
          </section>
        )}
        {extraModels.map(
          (m) =>
            m.expertiseSlots > 0 && (
              <section key={`exp:${m.row.uid}`}>
                <PickHead
                  label={`Экспертность (${m.opt?.name ?? "класс"})`}
                  picked={rowExpertise(m).length}
                  total={m.expertiseSlots}
                  hint="Удвоенный бонус мастерства к навыку, которым вы владеете."
                />
                {rowExpertiseOpts(m).length === 0 ? <span className="muted">Сначала выберите владения навыками выше.</span> : <PickList
                  rows={rowExpertiseOpts(m).map((k) => ({
                    key: k,
                    title: skills.nameOf(k),
                    meta: skillMeta(k),
                    picked: rowExpertise(m).includes(k),
                    // Экспертность в одном навыке дважды не берётся.
                    disabled: validExpertise.includes(k) || extraModels.some((x) => x.row.uid !== m.row.uid && rowExpertise(x).includes(k)),
                  }))}
                  full={rowExpertise(m).length >= m.expertiseSlots}
                  onToggle={(k) => {
                    const cur = rowExpertise(m);
                    patchExtra(m.row.uid, {
                      expertise: cur.includes(k) ? cur.filter((s) => s !== k) : cur.length < m.expertiseSlots ? [...cur, k] : cur,
                    });
                  }}
                />}
              </section>
            )
        )}
        {languageOptions.length > 0 && (
          <section>
            <PickHead
              label="Языки"
              picked={languagePicks}
              total={LANGUAGE_PICKS + bonusLanguage}
              hint={`Общий знают все${autoLanguages.length > 0 ? `, от класса: ${autoLanguages.join(", ")}` : ""}.${bonusLanguage ? " Посланник рыцарства даёт ещё один." : ""}`}
            />
            <PickList rows={common.map(langRow)} onToggle={toggleLanguage} />
            {rare.length > 0 && (
              <>
                <PickHead label="Редкие — с разрешения Мастера" />
                <PickList rows={rare.map(langRow)} onToggle={toggleLanguage} />
              </>
            )}
            {otherLangs.length > 0 && (
              <>
                <PickHead label="Прочие из справочника" />
                <PickList rows={otherLangs.map(langRow)} onToggle={toggleLanguage} />
              </>
            )}
          </section>
        )}
      </div>
    );
  }

  function renderSpells() {
    return (
      <div className="wz-step">
        {spellIndex === null && !loadError && <span className="muted">Загружаю заклинания…</span>}
        {spellIndex === null && loadError && <span className="muted">Список заклинаний не загрузился — выбрать не из чего.</span>}
        {grantedSpellNames.length > 0 && <span className="muted">Придут сами: {grantedSpellNames.join(", ")}</span>}
        {spellIndex !== null && <SearchField value={spellSearch} onChange={setSpellSearch} placeholder="Поиск заклинания" />}
        {spellIndex !== null &&
          spellGroups.map((group) => {
            const picked = chosenSpellsIn(group.key);
            const q = spellSearch.trim().toLowerCase();
            // По кругам (владелец 2026-09-25): заговоры, 1 круг, 2 круг…
            const cands = spellCandidates(group)
              .filter((e) => !q || e.name.toLowerCase().includes(q))
              .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
            const circles = new Set(cands.map((e) => e.level ?? 0)).size > 1;
            const meta = (e: CompendiumEntry) => {
              const circle = e.level ?? 0;
              const school = (e.data.school as { name?: string } | undefined)?.name ?? "";
              return [circle === 0 ? "заговор" : `${circle} круг`, school, e.data.casting_timing, e.data.range]
                .filter((x) => typeof x === "string" && x)
                .join(" · ");
            };
            return (
              <section key={group.key} className={`wz-spell-group${picked.length >= group.count ? " is-done" : ""}`}>
                <PickHead
                  label={group.label}
                  picked={picked.length}
                  total={group.count}
                  hint={spellChoiceText({
                    count: group.count,
                    classIds: group.classIds,
                    schools: group.schools,
                    level: group.level,
                    outsideLimit: group.outsideLimit,
                    maxCircle: group.maxCircle,
                  })}
                />
                <PickList
                  rows={cands.map((e) => {
                    const isHere = chosenSpells.includes(`${group.key}:${e.id}`);
                    const elsewhere =
                      !isHere && !group.fromBook
                        ? spellGroups.find((g) => g.key !== group.key && chosenSpells.includes(`${g.key}:${e.id}`))
                        : undefined;
                    const granted = grantedSpellIds.has(e.id);
                    return {
                      key: String(e.id),
                      title: e.name,
                      meta: granted ? `${meta(e)} · уже есть` : elsewhere ? `${meta(e)} · выбрано: ${elsewhere.label}` : meta(e),
                      picked: isHere,
                      disabled: granted || !!elsewhere,
                      group: circles ? ((e.level ?? 0) === 0 ? "Заговоры" : `${e.level} круг`) : undefined,
                    };
                  })}
                  full={group.count > 1 && picked.length >= group.count}
                  collapse={picked.length >= group.count}
                  onToggle={(k) => toggleSpell(group.key, Number(k), group.count)}
                  onOpen={(k) => {
                    const e = cands.find((x) => x.id === Number(k));
                    openEntry(Number(k), chosenSpells.includes(`${group.key}:${k}`), () => toggleSpell(group.key, Number(k), group.count), {
                      entry: e,
                      meta: e ? meta(e) : undefined,
                      disabled: grantedSpellIds.has(Number(k)),
                    });
                  }}
                />
              </section>
            );
          })}
      </div>
    );
  }

  const setItemNames = (set: StartingSet) => [
    ...set.items.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)),
    ...set.manual,
    ...set.choices.map((c) => `${c.group.split("|").join(" или ").toLowerCase()} на выбор`),
  ];

  function renderEquipment() {
    const sources = [
      { title: `От класса${classOption ? ` (${classOption.name})` : ""}`, sets: equipmentGroups[0] },
      { title: `От предыстории${backgroundEntry ? ` (${backgroundEntry.name})` : ""}`, sets: equipmentGroups[1] },
    ].filter((s) => s.sets.length > 0);
    return (
      <div className="wz-step">
        {startingSets.length === 0 && setsStillLoading && <span className="muted">Справочник ещё грузится — подождите секунду.</span>}
        {startingSets.length === 0 && !setsStillLoading && (
          <span className="muted">
            {classId || backgroundId
              ? "У выбранных класса и предыстории набора в справочнике нет — снаряжение добавите во вкладке «Инвентарь»."
              : "Класс и предыстория не выбраны — набор брать неоткуда."}
          </span>
        )}
        {sources.map((src) => (
          <SetDuel
            key={src.title}
            title={src.title}
            selected={selectedStartingSet(src.sets, takenSets)?.label ?? null}
            onSelect={chooseStartingSet}
            onOpen={(label) => setSheet({ kind: "set", label })}
            options={src.sets.map((set) => ({
              label: set.label,
              letter: set.letter,
              gold: Number.parseInt(set.gold, 10) || 0,
              items: set.items.length + set.manual.length + set.choices.length > 0 ? setItemNames(set) : [],
              pending: setChoiceMissing.filter((sl) => sl.setLabel === set.label).map((sl) => sl.label),
            }))}
          />
        ))}
        {startingSets.length > 0 && (
          <span className="wz-total">
            Итого: {takenSummary.items} предметов{takenSummary.gold > 0 && `, ${takenSummary.gold} ЗМ`}
          </span>
        )}
      </div>
    );
  }

  function renderDossier() {
    return (
      <div className="wz-step">
        <p className="wz-step-lead">Всё, кроме имени, можно оставить пустым и дописать на листе.</p>
        <label className="wz-field">
          Имя персонажа *
          <input value={characterName} onChange={(e) => setCharacterName(e.target.value)} maxLength={80} />
        </label>
        <label className="wz-field">
          Имя игрока
          <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={80} />
        </label>
        <div className="stack">
          <span className="wz-group-label">Портрет</span>
          <div className="wz-portrait">
            {portraitPreview ? (
              <>
                <img src={portraitPreview} alt="Портрет персонажа" />
                <button type="button" onClick={() => setFraming({ src: portraitPreview })}>
                  Кадр
                </button>
                <button type="button" onClick={() => { clearPortrait(); setPortraitFrame(null); }}>
                  Убрать фото
                </button>
              </>
            ) : (
              <>
                <label className="wz-file-btn">
                  Выбрать фото
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      startFraming(e.target.files?.[0] ?? null);
                      e.target.value = "";
                    }}
                  />
                </label>
                {ownerPortraitUrl && (
                  <button type="button" onClick={takeOwnerPortrait} disabled={portraitFetching}>
                    {portraitFetching ? "Загружаю…" : "Взять как у владельца"}
                  </button>
                )}
              </>
            )}
          </div>
          {framing && (
            <PortraitFrameModal
              src={framing.src}
              focus={framing.file ? undefined : portraitFrame?.focus}
              zoom={framing.file ? undefined : portraitFrame?.zoom}
              name={characterName.trim()}
              subtitle={classOption?.name}
              onClose={closeFraming}
              onApply={(focus, zoom) => {
                if (framing.file) takePortrait(framing.file);
                setPortraitFrame({ focus, zoom });
                closeFraming();
              }}
            />
          )}
          {portraitError && (
            <div className="sb-save-status is-error" role="alert">
              {portraitError}
            </div>
          )}
        </div>
        <label className="wz-field">
          Мировоззрение
          <select value={alignment} onChange={(e) => setAlignment(e.target.value)}>
            <option value="">— не выбрано —</option>
            {alignment && !alignmentOptions.some((o) => o.name === alignment) && <option value={alignment}>{alignment}</option>}
            {alignmentOptions.map((o) => (
              <option key={o.id} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <div className="wizard-dossier-grid">
          <label>
            Черты характера
            <textarea value={personalityTraits} onChange={(e) => setPersonalityTraits(e.target.value)} placeholder="Как ведёт себя персонаж" rows={2} maxLength={500} />
          </label>
          <label>
            Идеалы
            <textarea value={ideals} onChange={(e) => setIdeals(e.target.value)} placeholder="Во что верит" rows={2} maxLength={500} />
          </label>
          <label>
            Узы
            <textarea value={bonds} onChange={(e) => setBonds(e.target.value)} placeholder="Кто и что дорого" rows={2} maxLength={500} />
          </label>
          <label>
            Изъяны
            <textarea value={flaws} onChange={(e) => setFlaws(e.target.value)} placeholder="Слабости и пороки" rows={2} maxLength={500} />
          </label>
          <label className="wizard-dossier-wide">
            Заметки
            <textarea value={dossierNotes} onChange={(e) => setDossierNotes(e.target.value)} placeholder="Внешность, биография, прочее" rows={3} maxLength={1000} />
          </label>
        </div>
      </div>
    );
  }

  // Лицевая карта листа для Обзора на ПК: те же числа, что покажет лист, из
  // текущих выборов. Снаряжения на ней нет (КЗ — без доспеха, как в мини-листе):
  // вещи наборов собираются только при создании.
  function previewCharacter() {
    const c = emptyDndCharacter();
    if (systemId) c.systemId = systemId;
    c.characterName = characterName.trim();
    if (portraitFrame) {
      c.portraitFocus = portraitFrame.focus;
      if (portraitFrame.zoom > 1) c.portraitZoom = portraitFrame.zoom;
    }
    c.playerName = playerName.trim();
    c.abilities = awardedAbilities;
    c.classes = previewClasses;
    c.proficiencyBonus = computeProficiencyBonus(previewClasses);
    c.raceId = speciesId;
    c.raceName = speciesOptions.find((x) => x.id === speciesId)?.name ?? "";
    c.backgroundName = backgroundEntry?.name ?? "";
    c.alignment = alignment;
    if (previewHp !== null) c.hitPointMax = c.hitPointsCurrent = String(previewHp);
    if (previewSpeed) c.speed = String(previewSpeed);
    return c;
  }

  function renderOverview() {
    // На ПК — пополам (владелец 2026-09-24): слева главная карта листа,
    // справа всё остальное из мини-листа.
    const body = desktop ? (
      <div className="wz-overview-split">
        <div className="wz-overview-card">
          <DndCharacterView value={previewCharacter()} portraitUrl={portraitPreview ?? classOption?.card ?? null} cardOnly readOnly />
        </div>
        <div className="wz-overview-rest">{miniSheet(true)}</div>
      </div>
    ) : (
      miniSheet()
    );
    return (
      <div className="wz-step">
        {overviewWarnings.map((w) => (
          <div key={w} className="wz-warn" role="note">
            {w}
          </div>
        ))}
        {body}
        <PosterButtons
          getBlob={() => renderPosterBlob(posterData())}
          fileBase={characterName.trim() || "personazh"}
          shareTitle={characterName.trim() || "Без имени"}
        />
      </div>
    );
  }

  // Шаги, где строка открывает описание: на ПК оно в рамке рядом, а не шторкой.
  const PLATE_STEPS: Step[] = ["Умения класса", "Предыстория", "Черта", "Заклинания"];
  function renderStepLaid() {
    if (!desktop || !PLATE_STEPS.includes(step)) return renderStep();
    const viewed = sheet?.kind === "entry" ? sheet : null;
    return (
      <div className="wz-listplate">
        <div className="wz-listplate-list">{renderStep()}</div>
        <EntryPlate
          entryId={viewed?.entryId ?? null}
          entry={viewed?.entry}
          meta={viewed?.meta}
          action={
            viewed
              ? {
                  label: viewed.picked ? "Убрать" : "Выбрать",
                  disabled: viewed.disabled,
                  onClick: () => {
                    viewed.onToggle();
                    setSheet({ ...viewed, picked: !viewed.picked });
                  },
                }
              : undefined
          }
        />
      </div>
    );
  }

  function renderStep() {
    switch (step) {
      case "Класс":
        return renderClass();
      case "Умения класса":
        return renderClassChoices();
      case "Вид":
        return renderSpecies();
      case "Предок":
        return renderLineage();
      case "Предыстория":
        return renderBackground();
      case "Черта":
        return renderFeat();
      case "Характеристики":
        return renderAbilities();
      case "Навыки и языки":
        return renderSkills();
      case "Заклинания":
        return renderSpells();
      case "Снаряжение":
        return renderEquipment();
      case "Досье":
        return renderDossier();
      case "Обзор":
        return renderOverview();
    }
  }

  function renderSheet() {
    if (!sheet) return null;
    // На ПК описание записи — в рамке шага (renderStepLaid), не шторкой.
    if (desktop && sheet.kind === "entry" && PLATE_STEPS.includes(step)) return null;
    const close = () => setSheet(null);
    if (sheet.kind === "steps") {
      return (
        <Sheet
          title="Шаги"
          onClose={close}
          actions={
            wizardDirty &&
            !avatarFailed && (
              <button type="button" className="wz-wide-btn" onClick={resetWizard}>
                Начать заново
              </button>
            )
          }
        >
          <ol className="wz-steplist">
            {visibleSteps.map((st, i) => {
              const miss = st !== "Обзор" && stepMissing(st).length > 0;
              return (
                <li key={st}>
                  <button
                    type="button"
                    aria-current={st === step ? "step" : undefined}
                    onClick={() => {
                      setStep(st);
                      close();
                    }}
                  >
                    <span className="wz-step-num">{i + 1}</span>
                    <span>{st}</span>
                    <span className={`wz-step-state${miss ? " is-missing" : ""}`}>{miss ? "не готово" : i < stepPos ? "✓" : ""}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </Sheet>
      );
    }
    if (sheet.kind === "set") {
      const set = startingSets.find((s) => s.label === sheet.label);
      if (!set) return null;
      const taken = setTaken(set.label);
      const slots = setChoiceSlots.filter((sl) => sl.setLabel === set.label);
      return (
        <Sheet
          title={set.label}
          onClose={close}
          actions={
            <button
              type="button"
              className="primary wz-wide-btn"
              onClick={() => {
                if (!taken) chooseStartingSet(set.label);
                if (taken) close();
              }}
            >
              {taken ? "Готово" : "Взять набор"}
            </button>
          }
        >
          <ul className="wz-list">
            {set.items.map((i) => (
              <li key={`${i.entryId}:${i.name}`} className="wz-row">
                <span className="wz-row-main">{i.qty > 1 ? `${i.name} ×${i.qty}` : i.name}</span>
              </li>
            ))}
            {set.manual.map((text) => (
              <li key={text} className="wz-row">
                <span className="wz-row-main">{text}</span>
              </li>
            ))}
            {Number.parseInt(set.gold, 10) > 0 && (
              <li className="wz-row">
                <span className="wz-row-main">{set.gold} ЗМ</span>
              </li>
            )}
          </ul>
          {!taken &&
            set.choices.map((c, i) => (
              <span key={i} className="muted">
                На выбор: {c.group.split("|").join(" или ").toLowerCase()} — после того, как возьмёшь набор.
              </span>
            ))}
          {slots.map((sl) => {
            const picked = setChoicePicked(sl);
            return (
              <section key={sl.key}>
                <PickHead label={`На выбор: ${sl.label}`} picked={picked.length} total={sl.count} />
                {sl.auto ? (
                  <span className="muted">Тот, которым владеешь: {sl.options.map((o) => o.name).join(", ")}.</span>
                ) : sl.options.length === 0 ? (
                  <span className="muted">Вариантов в справочнике нет — ляжет строкой «выбрать самому».</span>
                ) : (
                  <PickList
                    rows={sl.options.map((o) => ({ key: String(o.id), title: o.name, picked: picked.includes(o.id) }))}
                    full={sl.count > 1 && picked.length >= sl.count}
                    onToggle={(k) => toggleSetChoice(sl, Number(k))}
                  />
                )}
              </section>
            );
          })}
        </Sheet>
      );
    }
    return (
      <EntrySheet
        key={sheet.entryId}
        entryId={sheet.entryId}
        entry={sheet.entry}
        meta={sheet.meta}
        onClose={close}
        action={{
          label: sheet.picked ? "Убрать" : "Взять",
          disabled: sheet.disabled,
          onClick: () => {
            sheet.onToggle();
            close();
          },
        }}
      />
    );
  }

  const createBlocked = saving || overviewProblems.length > 0;

  return (
    // Визард — модалкой: фокус-трап и возврат фокуса из коробки. Клик по фону
    // отключён (черновик и так спасает, но выход — только явной кнопкой), ESC
    // идёт в cancelWizard с вопросом. На телефоне окно во весь экран.
    <Modal onClose={cancelWizard} closeOnBackdropClick={false} ariaLabel="Создание персонажа" className="wz-modal" autoFocus={false}>
      <div className={`wizard wz${visualVariant === "oneshot" ? " wizard--oneshot" : ""}`}>
        {desktop && (
          <nav className="wz-rail" aria-label="Шаги создания">
            {visualVariant === "oneshot" && <img className="wz-rail-logo" src="/ui/oneshot/branding/logo-soyman-1shot.webp" alt="SoyMan 1shot" />}
            <div className="wz-rail-head">
              <span>Создание персонажа</span>
              <small>Главы можно открывать в любом порядке</small>
            </div>
            <ol className="wz-rail-steps">
              {visibleSteps.map((st, i) => {
                // Галка — пройденный и закрытый шаг; впереди — номер, даже
                // если выбирать там нечего.
                const cur = st === step;
                const done = i < stepPos && (st === "Обзор" || stepMissing(st).length === 0);
                return (
                  <li key={st}>
                    <button type="button" aria-current={cur ? "step" : undefined} className={done ? "is-done" : ""} onClick={() => setStep(st)}>
                      <span className="wz-rail-num">{done ? "✓" : String(i + 1).padStart(2, "0")}</span>
                      <span>{st}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="wz-rail-foot">
              <small>Черновик сохраняется на устройстве</small>
              {wizardDirty && !avatarFailed && (
                <button type="button" onClick={resetWizard}>
                  Начать заново
                </button>
              )}
              <button type="button" onClick={cancelWizard} disabled={saving}>
                Закрыть визард
              </button>
            </div>
          </nav>
        )}
        {desktop && (
          <header className="wz-stage-head">
            <span className="wz-stage-no">
              {String(stepPos + 1).padStart(2, "0")}
              <small> / {visibleSteps.length}</small>
            </span>
            <h1 className="wz-stage-title">{step}</h1>
            <div className="wz-stage-slot" />
          </header>
        )}
        <header className="wz-top">
          <button type="button" className="wz-steps-btn" aria-haspopup="dialog" onClick={() => setSheet({ kind: "steps" })}>
            <span className="wz-step-no" aria-hidden="true">
              {String(stepPos + 1).padStart(2, "0")}
            </span>
            <span className="wz-step-txt">
              <small>
                Шаг {stepPos + 1} из {visibleSteps.length} · все шаги
              </small>
              <strong>{step} ▾</strong>
            </span>
          </button>
          {step !== "Обзор" ? (
            <button
              type="button"
              className="wz-icon-btn wz-preview-btn"
              aria-pressed={mobilePreview}
              aria-label={mobilePreview ? "К шагу" : "Предпросмотр листа"}
              title={mobilePreview ? "К шагу" : "Предпросмотр листа"}
              onClick={() => setMobilePreview((v) => !v)}
            >
              <NavIcon name="eye" />
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="wz-icon-btn" aria-label="Закрыть" title="Закрыть" onClick={cancelWizard} disabled={saving}>
            ×
          </button>
          <StepStaff index={stepPos} total={visibleSteps.length} onOpen={() => setSheet({ kind: "steps" })} />
        </header>

        <div className="wz-body" ref={bodyRef}>
          {hadDraft && (
            <div className="wz-toast" role="status">
              Продолжаем с места — черновик восстановлен.
            </div>
          )}
          {/* D1: десктоп-сплит — шаги слева, живой чарник справа липко. */}
          <div className="wizard-split">
            <div className="wizard-main">
              {mobilePreview && step !== "Обзор" ? <div className="wizard-back">{miniSheet()}</div> : renderStepLaid()}
            </div>
          </div>

          {loadError && (
            <div className="sb-save-status is-error" role="alert">
              Справочник не загрузился: {loadError}. Выбор класса, вида и предыстории будет пустым — закройте визард и попробуйте
              ещё раз.
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
        </div>

        {/* Живой лист — правый блок во всю высоту окна (владелец, 2026-09-25);
            на узком экране скрыт, там предпросмотр — кнопкой «глаз». */}
        {step !== "Обзор" && (
          <aside className="wizard-side" aria-label="Живой предпросмотр персонажа">
            {miniSheet()}
          </aside>
        )}
        <footer className="wz-foot">
          {step !== "Обзор" && missingHere.length > 0 && <span className="wz-foot-hint">Чтобы идти дальше: {missingHere.join("; ")}.</span>}
          {step === "Обзор" && overviewProblems.length > 0 && (
            <span className="wz-foot-hint">Чтобы создать: {overviewProblems.map((p) => p.text).join("; ")}.</span>
          )}
          {/* На время сохранения уход запрещён: finish пишет и зовёт onDone. */}
          <button type="button" onClick={back} disabled={saving || stepPos === 0}>
            Назад
          </button>
          {/* Сюда сцена карт кладёт «К плитке». */}
          <span className="wz-foot-slot" />
          <span className="wz-shadow">
            {step === "Обзор" ? (
              <button type="button" className="primary" onClick={finish} disabled={createBlocked}>
                {saving ? "Создаю…" : saveError ? "Попробовать ещё раз" : "Создать персонажа"}
              </button>
            ) : (
              <button type="button" className="primary" onClick={next} disabled={missingHere.length > 0}>
                Далее
              </button>
            )}
          </span>
        </footer>
        {renderSheet()}
      </div>
    </Modal>
  );
}
